"""Run Step 3 from the local GTFS and saved forecasts, with atomic publication."""

import json
import os
import platform
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

if __name__ == "__main__":
    for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "BLIS_NUM_THREADS"):
        os.environ[variable] = "2"

import pandas as pd
import pyarrow as pa

from forecast_inputs import file_details
from gtfs import TABLES
from innovation_reporting import markdown_table
from run_forecast import BACKEND, MODULE, OUTPUT, save_json, write_tables
from run_validation import require
from scheduled_service import ROUTE_TO_SERVICE, SHAH_ROUTE, load_patterns, make_schedule, read_feed
from service_readiness import (
    HELD, HOLIDAY, IN_RANGE, capacity_parameter, network_intensity, readiness, sensitivity, validate_comparisons,
)


RAW = BACKEND / "data" / "raw"
SETTINGS = MODULE / "capacity_settings.json"
ARTIFACTS = (
    "gtfs_service_mapping.csv", "scheduled_service_hourly.parquet", "scheduled_service_summary.csv",
    "network_service_intensity.csv", "lrt3_service_readiness.csv", "lrt3_peak_sensitivity.csv",
    "capacity_config.json", "capacity_metadata.json", "capacity_summary.md",
)
SOURCES = {
    "GTFS_schedule_reference": "https://gtfs.org/documentation/schedule/reference/#frequenciestxt",
    "Ampang_Sri_Petaling_branch_evidence": "https://myrapid.com.my/wp-content/uploads/2024/01/"
    "RAPID-RAIL-SIARAN-MEDIA-PENUMPANG-LRT-DARI-ARAH-AMPANG-DAN-PUTRA-HEIGHTS-BOLEH-TERUS-KE-MASJID-JAMEK-BERMULA-1-FEBRUARI-2024_FINAL1.pdf",
    "Sunway_BRT_operator": "https://myrapid.com.my/wp-content/uploads/2024/07/"
    "RAPID-BUS-SIARAN-MEDIA-PERUBAHAN-OPERASI-BRT-LALUAN-SUNWAY-BAGI-LARIAN-SUNWAY-RAPID-KL-GOOD-RUN_2024_v2.pdf",
    "headline_measures": "https://data.gov.my/data-catalogue/ridership_headline",
}


def existing_outputs():
    return {
        path.relative_to(OUTPUT).as_posix(): file_details(path, BACKEND)["sha256"]
        for path in sorted(OUTPUT.rglob("*")) if path.is_file() and path.name not in ARTIFACTS
        and not path.relative_to(OUTPUT).parts[0].startswith("capacity-validation-")
    }


def validate_config(config):
    require(config["recent_baseline_days"] >= 7, "The demand baseline must cover all weekdays")
    windows = config["windows_hours"]
    require(set(windows) == {"am_peak", "pm_peak", "off_peak"}
            and windows["am_peak"] == [7, 9] and windows["pm_peak"] == [18, 20],
            "Peak intervals must remain 07:00–09:00 and 18:00–20:00")
    start, end = windows["off_peak"]
    require(isinstance(start, int) and isinstance(end, int) and 9 <= start < end <= 18,
            "Choose a full-hour off-peak window between the two peaks")


def summary_md(mapping, schedule, intensity, readiness_rows, peak, metadata, config):
    audit = metadata["GTFS"]
    parameter = config["nominal_train_capacity"]
    lrt3 = schedule.loc[schedule["route_id"].eq(SHAH_ROUTE)]
    both = schedule.loc[schedule["direction_id"].eq("both")]
    counts = both.loc[both["period"].eq("all_day")].pivot(
        index="route_id", columns="day_type", values="reference_departures",
    )
    rates = both.loc[both["day_type"].eq("weekday")].pivot(
        index="route_id", columns="period", values="departures_per_hour",
    )
    supply = lrt3.pivot(index=["day_type", "direction_id"], columns="period", values="reference_departures")
    places = parameter["passenger_places"]
    base = peak.loc[peak["scenario"].eq("base") & peak["resolution"].eq("peak_period")
                    & peak["proxy_period"].eq("combined") & peak["supply_status"].isin([IN_RANGE, HELD])]
    base_by_proxy = base.groupby(["day_type", "proxy_scope", "window"], as_index=False).agg(
        share=("proxy_share", "first"), demand=("proxy_station_origin_trips_in_window", "mean"),
        supply=("nominal_passenger_places_in_window", "first"),
    )
    annual = peak.loc[peak["proxy_period"].ne("combined") & peak["resolution"].eq("peak_period")]
    year_range = annual.groupby(["proxy_scope", "proxy_day_type", "window"])["proxy_share"].agg(["min", "max"])
    supported = intensity.iloc[0]
    start_off, end_off = config["windows_hours"]["off_peak"]
    counts_lrt3 = readiness_rows.loc[readiness_rows["scenario"].eq("base") & readiness_rows["direction_id"].eq("both")]
    observed = metadata["LRT3_OD_observed"]
    def number(value, decimals=1):
        return "Unavailable" if pd.isna(value) else f"{value:,.{decimals}f}"

    return "\n\n".join([
        "# Module 3 Step 3 scheduled service and predictive service readiness",
        "Inputs combine a reference timetable, observed recent demand, saved forecasts, planning scenarios, "
        "and exploratory Komuter time-of-day shares. The resulting service intensity is a monitoring indicator.",
        "## GTFS snapshot",
        f"The archive {audit['archive']['path']} covers {len(mapping)} route definitions. "
        f"The calendar rows used by the templates declare {audit['declared_valid_from'].date()} through "
        f"{audit['declared_valid_to'].date()}. This snapshot lacks a publication date and its declared calendar "
        "does not establish real-world operating history. Ordinary-day patterns are held fixed past expiry. "
        "Holiday dates flagged in the saved forecast calendar are excluded from dated supply comparisons.",
        markdown_table(("Table", "Rows"), [
            (f"{name}.txt", row["rows"] if row["present"] else "Absent") for name, row in audit["tables"].items()
        ]),
        f"The feed has {audit['frequency_templates']} frequency-based templates and "
        f"{audit['frequency_modes']['implied']} implied intervals. The absent exact_times column defaults to 0. "
        f"{audit['intervals_ending_at_24']} intervals end at exactly 24:00 and none extend past it. "
        "Departures use service-day seconds at the first stop. An interval ending at midnight contributes "
        "no departure at midnight. "
        f"Inferred arrivals can extend past midnight on {len(audit['templates_with_possible_arrival_after_24'])} "
        "templates, while departures remain on the original service day. "
        "Terminal pairs and path counts are in the mapping export. No short-turn variants occur in this snapshot.",
        "## Network timetable",
        f"Both-direction reference departures are the sum of the two terminal streams for a route. "
        f"Peak windows are [07:00, 09:00) and [18:00, 20:00), with [{start_off:02d}:00, {end_off:02d}:00) "
        "as the off-peak comparison. Divide a window's implied departures by its duration for the hourly rate. "
        "Directional effective headway is 60 divided by that rate. No joint rail total is calculated from the "
        "shared Ampang and Sri Petaling patterns. Sunway BRT is shown separately as nonrail.",
        markdown_table(("Route", "Weekday/day", "Saturday/day", "Sunday/day", "Weekday AM/h", "Weekday PM/h", "Off-peak/h"), [
            (row.route_name, number(counts.at[row.route_id, "weekday"]), number(counts.at[row.route_id, "saturday"]),
             number(counts.at[row.route_id, "sunday"]), number(rates.at[row.route_id, "am_peak"]),
             number(rates.at[row.route_id, "pm_peak"]), number(rates.at[row.route_id, "off_peak"]))
            for row in mapping.itertuples()
        ]),
        "## Headline demand and service intensity",
        f"The common future-only projection runs {supported.future_start.date()} to {supported.future_end.date()} "
        f"({supported.future_forecast_days} dates, cutoff {supported.data_cutoff.date()}). The same "
        f"{supported.calendar_comparable_days} ordinary dates enter each supported intensity comparison. "
        f"Omitted dates are {supported.paused_supply_dates.replace('|', ', ')}. Ratios divide aggregate "
        "published trips by terminal departures over the paired dates. The recent weekday mix is evaluated "
        "with the same reference supply. These ratios describe line service intensity.",
        markdown_table(("Headline service", "Future trips/day", "Trips/reference departure", "Intensity change (%)"), [
            (row.service_name, number(row.forecast_average_daily_trips, 0),
             number(row.forecast_published_trips_per_reference_departure),
             number(row.change_in_trips_per_departure_pct, 2)) for row in intensity.itertuples()
        ]),
        "## Shah Alam nominal places",
        f"MRCB documents {parameter['source_reported_passenger_places']} passenger places including "
        f"{parameter['source_reported_seats']} seats per three-car train. The configured value is {places} "
        f"and its status is {parameter['verification_status']}. Reported supply multiplies this value by "
        f"the reference departures for each period. Nominal places are conditional on the reference "
        f"frequency and train formation. [MRCB Integrated Annual Report 2024]({parameter['source_url']})",
        markdown_table(("Day type", "Direction", "Daily departures", "Daily places", "AM places", "PM places"), [
            (day, direction, number(row.all_day), number(row.all_day * places, 0),
             number(row.am_peak * places, 0), number(row.pm_peak * places, 0))
            for (day, direction), row in supply.iterrows()
        ]),
        f"The validated OD history contains {observed['observed_days']} positive days and "
        f"{observed['trips']:,} trips from {observed['window_start']} through {observed['data_cutoff']}. "
        f"The forward view retains {len(counts_lrt3)} scenario dates. Demand remains a line-wide station-origin "
        "total. Directional supply is available, and directional demand is unavailable.",
        "## Peak proxy sensitivity",
        "Each forecast date uses its actual weekday/weekend class. Saturday and Sunday share the Komuter "
        "weekend profile but retain separate GTFS supply. The table shows average Base peak trips and "
        "two-direction nominal places over ordinary forecast dates. The AM and PM rows are two-hour totals.",
        markdown_table(("Day type", "Komuter proxy", "Peak", "Share", "Base peak trips", "Nominal places"), [
            (row.day_type, row.proxy_scope, row.window, f"{100 * row.share:.2f}%", number(row.demand, 0),
             number(row.supply, 0)) for row in base_by_proxy.itertuples()
        ]),
        markdown_table(("Proxy", "Day type", "Peak", "2023–2026 observed proxy share range"), [
            (scope, day, window, f"{100 * row['min']:.2f}–{100 * row['max']:.2f}%")
            for (scope, day, window), row in year_range.iterrows()
        ]),
        "The proxy shares were preserved in all 24 clock bins. A positive proxy estimate in an hour without "
        "a terminal start is flagged. The available data do not support allocating demand by direction or segment. "
        "Trips and places are exported as separate measures.",
        "## Operator use",
        "Refresh the GTFS reference before interpreting dates beyond December. Request verified holiday and "
        "Ampang/Sri Petaling branch schedules. Monitor the Shah Alam headline forecast and collect actual "
        "peak boarding and alighting counts by direction and station before assessing section crowding. "
        "Review late-afternoon Shah Alam service against those counts because the 18:00–20:00 window crosses "
        "a headway change in the reference timetable.",
        "## Chart-ready views",
        "Plot terminal departures by hour with direction and day-type filters. Show future headline intensity "
        "with unavailable comparisons labelled. Plot daily Low/Base/High station-origin forecasts with a marker "
        "at GTFS expiry. Use aligned peak demand and nominal supply panels with separate units, clear proxy "
        "labels, and missing supply markers on flagged special dates.",
    ]) + "\n"


def main():
    pa.set_cpu_count(2)
    pa.set_io_thread_count(2)
    original = existing_outputs()
    config = json.loads(SETTINGS.read_text(encoding="utf-8"))
    validate_config(config)
    capacity = capacity_parameter(config)
    config["nominal_train_capacity"] = capacity
    reference_date = pd.Timestamp(config["as_of_date"])
    print("Validating the local Rapid Rail GTFS", flush=True)
    archive, tables, entries, ignored = read_feed(RAW)
    patterns, calendar, audit = load_patterns(tables, reference_date)
    mapping, hourly, summary = make_schedule(tables, patterns, calendar, audit, config)
    forecast_meta = json.loads((OUTPUT / "forecast_metadata.json").read_text(encoding="utf-8"))
    first_step = json.loads((OUTPUT / "data_quality_report.json").read_text(encoding="utf-8"))
    gtfs_details = file_details(archive, BACKEND)
    audit.update({
        "archive": gtfs_details, "ZIP_entries": entries, "ignored_resource_fork_entries": ignored,
        "matches_step_1_snapshot": gtfs_details["sha256"] == first_step["inputs"][
            Path(first_step["gtfs"]["file"]).name
        ]["sha256"],
        "tables": {name: {"present": name in tables, "rows": len(tables[name]) if name in tables else None}
                   for name in TABLES},
        "feed_info_present": any(Path(name).name == "feed_info.txt" for name in entries),
        "timezone": "Asia/Kuala_Lumpur", "future_status": "reference_patterns_held_constant",
    })
    print("Pairing saved demand projections with ordinary-day reference supply", flush=True)
    network_forecast = pd.read_parquet(OUTPUT / "network_service_forecast.parquet")
    history = pd.read_parquet(OUTPUT / "network_service_history.parquet")
    od_forecast = pd.read_parquet(OUTPUT / "lrt3_forecast_daily.parquet")
    scenarios = pd.read_csv(OUTPUT / "lrt3_scenarios.csv", parse_dates=["date", "data_cutoff"])
    profiles = pd.read_parquet(OUTPUT / "komuter_hourly_profiles.parquet")
    intensity, network_calendar = network_intensity(network_forecast, history, summary, config, audit)
    ready, demand = readiness(od_forecast, scenarios, summary, config, audit, capacity)
    peak = sensitivity(demand, profiles, hourly, summary, config, capacity)
    validate_comparisons(hourly, summary, intensity, ready, peak, demand, config, capacity)
    dates = demand[["date", "supply_status", "within_declared_calendar"]].drop_duplicates()
    outputs = {
        "gtfs_service_mapping.csv": (mapping, ["route_id"]),
        "scheduled_service_hourly.parquet": (hourly, ["route_id", "day_type", "direction_id", "service_hour"]),
        "scheduled_service_summary.csv": (summary, ["route_id", "day_type", "direction_id", "period"]),
        "network_service_intensity.csv": (intensity, ["series_id"]),
        "lrt3_service_readiness.csv": (ready, ["date", "scenario", "direction_id"]),
        "lrt3_peak_sensitivity.csv": (peak, ["date", "scenario", "proxy_scope", "proxy_period", "window"]),
    }
    model_sources = ("scheduled_service.py", "service_readiness.py", "run_capacity.py", "capacity_settings.json")
    metadata = {
        "as_of_date": reference_date, "settings_source": file_details(SETTINGS, BACKEND),
        "environment": {"python": platform.python_version(), **{
            name: version(name) for name in ("numpy", "pandas", "pyarrow")
        }},
        "module_source_hashes": {name: file_details(MODULE / name, BACKEND)["sha256"] for name in model_sources},
        "protected_processed_hashes": original, "external_references": SOURCES,
        "GTFS": audit, "route_to_headline_service": ROUTE_TO_SERVICE, "capacity_parameter": capacity,
        "headline_observation_source": forecast_meta["headline"]["selected"], "LRT3_OD_observed": forecast_meta["od"],
        "headline_future_comparison_calendar": network_calendar.to_dict("records"),
        "LRT3_future_supply_calendar": dates.to_dict("records"),
        "definitions": {
            "terminal_departure": "Count each journey's first-stop departure only. Exact schedules use a departure "
                                  "event. Frequency intervals contribute overlap seconds divided by headway seconds. "
                                  "Both directions add two terminal streams for the same route, without cross-route sums.",
            "schedule_lifespan": "Future activity uses a fixed reference schedule. The archive contains no "
                                 "GTFS calendar_dates table. Dates flagged by the archived holiday calendar or "
                                 "without a covered holiday calendar have no paired dated supply.",
            "intensity": "Ratio of forecast published trips to reference two-direction departures on the same set "
                         "of included days. Historical weekday-matched baseline uses the same denominator.",
            "nominal_supply": "Terminal departures times editable nominal design places per three-car train. "
                              "Estimates depend on train formation and reference service being delivered.",
            "peak_proxy": "Saved Komuter hourly shares multiply daily OD scenarios. Network and Port Klang West, "
                          "pooled and each observed year, are separate sensitivities. Each day retains all 24 bins. "
                          "Peak windows sum the two matching hourly demand and supply values.",
            "coverage": "Station-origin demand has no directional or segment distribution. Supply remains separate "
                        "from demand in the peak export. No occupancy or pressure ratio is calculated.",
        },
        "profile": {"source": "komuter_hourly_profiles.parquet", "scopes": sorted(profiles["scope"].unique()),
                    "periods": sorted(profiles["year"].unique()), "proxy_source_day_types": sorted(profiles["day_type"].unique()),
                    "zero_departure_hours_with_proxy_demand_rows": int(peak["zero_terminal_departure_hour_with_proxy_demand"].sum())},
        "dates_without_holiday_supply": {
            "headline": network_calendar.loc[network_calendar["supply_status"].eq(HOLIDAY), "date"].tolist(),
            "LRT3": dates.loc[dates["supply_status"].eq(HOLIDAY), "date"].tolist(),
        },
    }
    print("Reopening and validating staged outputs", flush=True)
    with TemporaryDirectory(dir=OUTPUT, prefix="capacity-validation-") as temp:
        stage = Path(temp)
        checks = write_tables(stage, outputs)
        save_json(stage / "capacity_config.json", config)
        text = summary_md(mapping, summary, intensity, ready, peak, metadata, config)
        (stage / "capacity_summary.md").write_text(text, encoding="utf-8")
        require(text == (stage / "capacity_summary.md").read_text(encoding="utf-8"), "Summary readback failed")
        require(original == existing_outputs(), "A prior processed file changed during Step 3")
        metadata["validation"] = {
            "passed": True, "output_tables": checks, "no_duplicate_departure_counting": True,
            "route_to_headline_mapping_checked": True, "hourly_peak_and_daily_counts_reconcile": True,
            "service_day_and_direction_arithmetic_checked": True,
            "hourly_proxy_demand_conserved": True, "unsupported_supply_retained_as_missing": True,
            "nominal_supply_and_finite_nonnegative_values_checked": True,
            "prior_files_unchanged": True, "prior_file_count": len(original),
        }
        save_json(stage / "capacity_metadata.json", metadata)
        for name in ARTIFACTS:
            (stage / name).replace(OUTPUT / name)
    require(original == existing_outputs(), "A prior processed file changed after publication")
    print(f"Validated {len(ARTIFACTS)} Step 3 files and preserved {len(original)} prior files", flush=True)


if __name__ == "__main__":
    main()
