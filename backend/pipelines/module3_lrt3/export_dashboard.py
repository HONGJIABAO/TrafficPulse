"""Generate compact, validated Module 3 frontend data from processed artifacts."""

import argparse
import csv
import hashlib
import json
import math
import os
import statistics
from collections import defaultdict
from datetime import date, datetime

from run_equity import OUTPUT, ROOT, check_memory, flushed_create, load, sha, stamp

import pyarrow.parquet as pq

from dashboard_progress import FRONTEND, verify_preservation
from v1_calendar_corrections import (
    AVAILABLE_SUPPLY, CORRECTION_ARTIFACT, REVISION as DESCRIPTIVE_REVISION, archived_calendar, corrected_supply,
    holiday_contrasts, holiday_status,
)
from v1_calendar_dependency import MODEL_OUTPUTS, PREDICTIONS, REVISION
from equity_publication import (
    DEDUPLICATION, DISPLAY_GEOGRAPHY_NAME, DISPLAY_REVISION, GTFS_CATALOGUE, HISTORICAL_LAYER, OD_AGGREGATION,
    ODBL_URL, OSM_ATTRIBUTION_URL, POINT_METHOD, PUBLICATION_NOTE, SCOPE_DEFINITION, SCOPE_SOURCE, SCREENING_METHOD,
    publication_sources, regenerate_equity,
)


SCHEMA_VERSION = 1
OD = "lrt3_station_origin_od"
NETWORK = "rapid_rail_published_sum"
SHAH_ALAM = "rail_lrt_shah_alam"
DATA = FRONTEND / "data"
MISSING = {"", "NA", "NaN", "nan", "None", "null"}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def close(a, b):
    if a is None or b is None:
        return a is b
    return math.isclose(a, b, rel_tol=1e-11, abs_tol=1e-9)


def csv_scalar(value):
    if value in MISSING:
        return None
    if value.casefold() in {"true", "false"}:
        return value.casefold() == "true"
    try:
        return int(value)
    except ValueError:
        try:
            numeric = float(value)
        except ValueError:
            return value
        return numeric if math.isfinite(numeric) else None


def clean(value):
    if isinstance(value, (date, datetime)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    if isinstance(value, dict):
        return {key: clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(item) for item in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


class Inputs:
    def __init__(self):
        self.hashes = {}

    def path(self, name):
        path = OUTPUT / name
        if name not in self.hashes:
            self.hashes[name] = sha(path)
        return path

    def json(self, name):
        return load(self.path(name))

    def csv(self, name):
        text_keys = {"district_id", "direction_id", "proxy_period", "group"}
        with self.path(name).open(encoding="utf-8-sig", newline="") as handle:
            for row in csv.DictReader(handle, strict=True):
                yield {key: value if key in text_keys and value not in MISSING else csv_scalar(value) for key, value in row.items()}

    def parquet(self, name, columns):
        for batch in pq.ParquetFile(self.path(name)).iter_batches(columns=columns, batch_size=4096, use_threads=False):
            yield from batch.to_pylist()


def target_series(inputs, forecast, innovation):
    columns = ["date", "series_id", "unit", "service_name", "data_cutoff", "forecast_trips", "lead_day", "model_id", "training_policy"]
    rows = [*inputs.parquet("network_service_forecast.parquet", columns), *inputs.parquet("lrt3_forecast_daily.parquet", columns)]
    daily, history, targets = defaultdict(list), defaultdict(list), {}
    for row in rows:
        key = row["series_id"]
        daily[key].append((row["date"], row["forecast_trips"], row["lead_day"]))
        targets[key] = {field: row[field] for field in ("series_id", "service_name", "unit", "data_cutoff", "model_id", "training_policy")}
    for row in inputs.parquet("network_service_history.parquet", ["date", "series_id", "actual_trips", "source_status", "in_model_calendar"]):
        if row["in_model_calendar"]:
            history[row["series_id"]].append((row["date"], row["actual_trips"], row["source_status"]))
    for row in inputs.parquet("lrt3_daily.parquet", ["date", "station_origin_trips", "station_origin_status", "in_observed_demand_window"]):
        if row["in_observed_demand_window"]:
            history[OD].append((row["date"], row["station_origin_trips"], row["station_origin_status"]))
    for key in targets:
        daily[key].sort()
        history[key].sort()
        targets[key]["first_observed"] = history[key][0][0]
        targets[key]["last_observed"] = history[key][-1][0]
        require(len(daily[key]) == 90 and [r[2] for r in daily[key]] == list(range(1, 91)), f"Forecast calendar for {key}")
        require(daily[key][0][0] > history[key][-1][0], f"Forecast overlaps observations for {key}")
    components = forecast["network"]["components"]
    for i, (day, count, _) in enumerate(daily[NETWORK]):
        require(all(daily[key][i][0] == day for key in components) and close(count, sum(daily[key][i][1] for key in components)), "Network forecast component coherence")
    require(len(history[OD]) == 112 and sum(row[1] for row in history[OD]) == 3_265_221, "LRT3 observation window")

    watchlist = list(inputs.csv("demand_watchlist.csv"))
    published = {(r["series_id"], r["view_days"]): r for r in forecast["dashboard_views"]}
    watches = {(r["series_id"], r["view"]): r for r in watchlist}
    csv_summaries = list(inputs.csv("network_service_summary.csv"))
    for row in csv_summaries:
        saved = published[(row["series_id"], row["view_days"])]
        require(close(saved["forecast_total_trips"], row["forecast_total_trips"]), "CSV forecast summary differs from metadata")
    as_of = date.fromisoformat(forecast["evaluation_as_of_date"])
    outlook = []
    for key in [*components, NETWORK, OD]:
        bins = defaultdict(list)
        for day, number, _ in history[key][-innovation["settings"]["recent_baseline_days"]:]:
            if number is not None:
                bins[day.weekday()].append(number)
        means = {weekday: statistics.mean(values) for weekday, values in bins.items()}
        for horizon in (30, 60, 90):
            for kind in ("full", "future"):
                points = [r for r in daily[key][:horizon] if kind == "full" or r[0].date() > as_of]
                baseline = statistics.mean(means[day.weekday()] for day, *_ in points) if points and all(day.weekday() in means for day, *_ in points) else None
                total = sum(n for _, n, _ in points) if points else None
                avg = total / len(points) if points else None
                delta = avg - baseline if avg is not None and baseline is not None else None
                pct = 100 * (avg / baseline - 1) if avg is not None and baseline else None
                if kind == "full":
                    saved = published[(key, horizon)]
                    require(all(close(a, saved[b]) for a, b in ((total, "forecast_total_trips"), (baseline, "weekday_matched_recent_daily_mean"), (pct, "change_vs_weekday_matched_recent_pct"))), "Forecast total or weekday baseline differs from saved summary")
                if horizon == 90 and key in components:
                    saved = watches[key, "full_90_day" if kind == "full" else "future_only_after_as_of"]
                    require(len(points) == saved["forecast_days"] and close(total, saved["forecast_total_trips"]) and close(pct, saved["change_pct"]), "Published 90-day watchlist comparison differs")
                outlook.append({"series_id": key, "horizon": horizon, "scope": kind, "days": len(points),
                                "start": points[0][0] if points else None, "end": points[-1][0] if points else None,
                                "total": total, "average": avg, "baseline": baseline, "delta": delta, "change_pct": pct})
    scenarios = []
    assumptions = forecast["od_scenarios"]["planning_scenarios"]
    for row in inputs.csv("lrt3_scenarios.csv"):
        saved = daily[OD][row["lead_day"] - 1]
        require(saved[0].date().isoformat() == row["date"] and close(saved[1], row["base_trips"]), "Saved LRT3 Base scenarios differ from forecast")
        for key in ("low", "high"):
            expected = row["base_trips"] * (1 + assumptions[key + "_offset_at_day_90"] * row["lead_day"] / 90)
            require(close(expected, row[key + "_trips"]), "Saved LRT3 scenario value differs from its documented formula")
        scenarios.append((row["date"], row["lead_day"], row["low_trips"], row["base_trips"], row["high_trips"]))
    return ({"asOf": as_of, "networkId": NETWORK, "odId": OD, "components": components, "targets": targets,
             "daily": daily, "outlook": outlook, "watchlist": watchlist, "watchRules": innovation["settings"]["watchlist"],
             "scenarios": scenarios, "scenarioAssumptions": assumptions}, {"series": history})


def research(inputs, forecast, innovation):
    alternatives = defaultdict(list)
    for row in inputs.parquet("alternative_forecasts.parquet", ["series_id", "variant", "model_id", "date", "forecast_trips"]):
        alternatives[f"{row['series_id']}|{row['variant']}|{row['model_id']}"].append((row["date"], row["forecast_trips"]))
    for key, points in alternatives.items():
        points.sort()
        require(len(points) == len({day for day, _ in points}) == 90, f"Alternative forecast calendar for {key}")
    metrics = list(inputs.csv("model_backtesting.csv"))
    fields = ("series_id", "phase", "model_id", "training_policy")
    predictions = defaultdict(list)
    for row in inputs.parquet("backtest_predictions.parquet", [*fields, "origin", "date", "lead_day", "actual_trips"]):
        predictions[tuple(row[key] for key in fields)].append(row)
    for row in metrics:
        group = predictions[tuple(row[key] for key in fields)]
        horizon = [item for item in group if item["lead_day"] <= row["horizon_days"]]
        scored = [item for item in horizon if item["actual_trips"] is not None and math.isfinite(item["actual_trips"])]
        require(len(scored) == row["scored_predictions"] and len({item["origin"] for item in horizon}) == row["folds"],
                "Evaluation prediction and origin counts differ from the saved metric row")
        row["unique_target_dates"] = len({item["date"] for item in scored})
    cold = list(inputs.csv("cold_start_backtesting.csv"))
    ablation = list(inputs.csv("feature_ablation.csv"))
    require(len(metrics) == 226 and len(cold) == 36 and len(ablation) == 45, "Evaluation table counts differ")
    intervention = forecast["models"][SHAH_ALAM]["intervention"]
    return {"metrics": metrics, "cold": cold, "coldFolds": list(inputs.csv("cold_start_fold_metrics.csv")),
            "stability": list(inputs.csv("model_stability.csv")), "alternatives": alternatives,
            "ablation": ablation, "uncertainty": inputs.json("uncertainty_audit.json"),
            "experimentContext": {
                "paidServiceBoundary": intervention["post_boundary"], "matchedInterventionFolds": len(intervention["matched_origins"]),
                "minimumInterventionFolds": intervention["minimum_matched_folds_for_switch"], "postInterventionSelected": intervention["post_selected"],
                "commonNetworkHistoryDays": innovation["network_common_history_days"],
                "matchedNetworkOrigins": len(innovation["network_common_origins"]), "reusedNetworkHoldout": True,
            }}


def patterns(inputs, history, forecast, calendar):
    totals = defaultdict(list)
    for service, rows in history["series"].items():
        for day, value, _ in rows:
            if value is not None:
                totals[service, day.strftime("%Y-%m")].append(value)
    output, historical_holidays = [], []
    for row in inputs.csv("demand_patterns.csv"):
        if row["pattern"] == "holiday_vs_comparable_nonholiday":
            historical_holidays.append(row)
            continue
        if row["pattern"] == "calendar_month":
            values = totals[row["series_id"], row["group"]]
            require(len(values) == row["observed_days"] and close(statistics.mean(values), row["mean_daily_trips"]), "Monthly demand differs between history and pattern output")
            row["observed_total_trips"] = sum(values)
        output.append(row)
    corrected, comparisons = holiday_contrasts(history["series"], historical_holidays, calendar)
    return {"patterns": output + corrected, "holidayCalendar": calendar,
            "holidaySource": forecast["sources"]["holidays"]}, comparisons


def service(inputs, capacity, network, correction_calendar):
    config = inputs.json("capacity_config.json")
    route_cols = ("route_id", "route_name", "mode", "is_rail", "intensity_status", "mapping_notes")
    routes = [{key: r[key] for key in route_cols} for r in inputs.csv("gtfs_service_mapping.csv")]
    columns = ["route_id", "is_rail", "day_type", "direction_id", "direction_label", "service_hour", "reference_departures"]
    hourly = []
    supply_reference = {}
    all_hours = defaultdict(list)
    for r in inputs.parquet("scheduled_service_hourly.parquet", columns):
        hourly.append({key: value for key, value in r.items() if key != "is_rail"})
        all_hours[r["route_id"], r["day_type"], r["direction_id"]].append(r)
        if r["route_id"] == "SA" and r["direction_id"] == "both":
            lookup = r["day_type"], f"hour_{r['service_hour']:02d}"
            supply_reference[lookup] = r["reference_departures"]
    periods = list(inputs.csv("scheduled_service_summary.csv"))
    nominal_capacity = capacity["capacity_parameter"]["passenger_places"]
    nominal = []
    for row in periods:
        code, day, direction, period = (row[k] for k in ("route_id", "day_type", "direction_id", "period"))
        begins, ends = (int(row[k][:2]) for k in ("period_start", "period_end_exclusive"))
        selected = [r for d in (["0", "1"] if direction == "both" else [direction]) for r in all_hours[code, day, d]
                    if begins <= r["service_hour"] < ends]
        require(close(sum(r["reference_departures"] for r in selected), row["reference_departures"]), "GTFS hourly and period departures differ")
        rate = row["departures_per_hour"]
        if direction != "both" and rate and row["effective_headway_minutes"] is not None:
            require(close(60 / rate, row["effective_headway_minutes"]), "GTFS effective headway differs")
        if code == "SA":
            if direction == "both" and period in ("am_peak", "pm_peak"):
                supply_reference[day, period] = row["reference_departures"]
            nominal.append({"day_type": day, "direction_id": direction, "direction_label": row["direction_label"], "period": period,
                            "departures": row["reference_departures"], "nominal_places": row["reference_departures"] * nominal_capacity})
    nominal_lookup = {(r["day_type"], r["direction_id"], r["period"]): r for r in nominal}
    calendar = {}
    scenario_lookup = {r[0]: dict(zip(("low", "base", "high"), r[2:], strict=True)) for r in network["scenarios"]}
    for row in inputs.csv("lrt3_service_readiness.csv"):
        day, direction, d = (row[key] for key in ("day_type", "direction_id", "date"))
        available = row["supply_status"] in AVAILABLE_SUPPLY
        for period in ("all_day", "am_peak", "pm_peak", "off_peak"):
            reference = nominal_lookup[day, direction, period]
            require(close(row[period + "_nominal_passenger_places"], reference["nominal_places"] if available else None), "Saved dated nominal supply differs")
            require(close(row[period + "_reference_departures"], reference["departures"] if available else None), "Saved dated GTFS supply differs")
        if direction == "both":
            require(close(row["daily_station_origin_trips"], scenario_lookup[d][row["scenario"]]), "Saved readiness scenario differs")
            classified = corrected_supply(correction_calendar, date.fromisoformat(d), row["supply_status"], row["within_declared_calendar"])
            require(available == (classified in AVAILABLE_SUPPLY), "Corrected supply cohort differs from archived derived supply")
            calendar[d] = {"date": d, "day_type": day, "supply_status": row["supply_status"],
                           "calendar_status": holiday_status(correction_calendar, date.fromisoformat(d)),
                           "corrected_supply_status": classified,
                           "within_declared_calendar": row["within_declared_calendar"], "scenarios": scenario_lookup[d]}
        else:
            require(row["daily_station_origin_trips"] is None, "Directional station-origin demand must remain unavailable")
    profiles = {}
    cells = 0
    for row in inputs.csv("lrt3_peak_sensitivity.csv"):
        if cells % 10_000 == 0:
            check_memory()
        cells += 1
        key = "|".join(row[field] for field in ("proxy_scope", "proxy_period", "day_type"))
        window = row["window"]
        profile = profiles.setdefault(key, {})
        values = {"window": window, "start": row["window_start"], "end": row["window_end_exclusive"], "share": row["proxy_share"], "resolution": row["resolution"]}
        require(profile.setdefault(window, values) == values, "Proxy profile share varies by forecast scenario or service date")
        date_info = calendar[row["date"]]
        daily = date_info["scenarios"][row["scenario"]]
        require(close(daily * values["share"], row["proxy_station_origin_trips_in_window"]), "Peak sensitivity demand differs from the saved data")
        departures = supply_reference[row["day_type"], window] if date_info["supply_status"] in AVAILABLE_SUPPLY else None
        require(close(departures, row["reference_departures"]) and close(departures * nominal_capacity if departures is not None else None, row["nominal_passenger_places_in_window"]),
                f"Peak sensitivity supply differs on {row['date']} ({key}, {window}): {departures} versus {row['reference_departures']}")
    require(cells == len(calendar) * 3 * 2 * 5 * 26 == 67_080, "Peak-sensitivity dimensionality differs")
    for profile in profiles.values():
        require(len(profile) == 26 and close(sum(v["share"] for k, v in profile.items() if k.startswith("hour_")), 1), "Proxy shares or clocks are incomplete")
    for row in calendar.values():
        row["supply_status"] = row.pop("corrected_supply_status")
    return {"routes": routes, "hourly": hourly, "periods": periods, "intensity": list(inputs.csv("network_service_intensity.csv")),
            "capacity": capacity["capacity_parameter"], "nominal": nominal, "config": config,
            "calendar": sorted(calendar.values(), key=lambda row: row["date"]), "profiles": {key: list(value.values()) for key, value in profiles.items()},
            "supply": {day: {window: supply_reference[day, window] for window in profiles["network|combined|" + day]}
                       for day in ("weekday", "saturday", "sunday")},
            "referenceDate": capacity["GTFS"]["pattern_reference_date"], "calendarStart": capacity["GTFS"]["declared_valid_from"],
            "calendarEnd": capacity["GTFS"]["declared_valid_to"], "windows": config["windows_hours"],
            "profileDimensions": capacity["profile"], "holidayDatesWithoutSupply": capacity["dates_without_holiday_supply"]["LRT3"],
            "validatedPeakRows": cells, "definitions": capacity["definitions"]}


def methodology(inputs, forecast, innovation, capacity, equity_data, equity_evidence, research_data, calendar):
    quality = inputs.json("data_quality_report.json")
    source = quality["methodology_sources"]
    definitions = forecast["definitions"]
    aggregated = [r for r in research_data["metrics"] if r["series_id"] == NETWORK and r["phase"] == "terminal_holdout"]
    holdout = {r["model_id"]: r for r in aggregated}
    stab = next(r for r in research_data["stability"] if r["series_id"] == SHAH_ALAM and r["phase"] == "forecast_sensitivity" and
                r["variant"] == "full_eligible_history" and r["model_id"] == "holt_winters_additive_damped")
    cold = defaultdict(list)
    for r in research_data["cold"]:
        if r["arm"] in ("seasonal_naive", "transfer_50"):
            cold[r["series_id"], r["arm"]].append(r["wape_pct"])
    return {
        "sources": [
            {"label": "Published daily service counts", "url": source["headline"], "detail": "Prasarana / data.gov.my"},
            {"label": "Rapid Rail station-origin OD", "url": source["rapidrail"],
             "detail": "Prasarana and the Ministry of Transport via data.gov.my. Reconciled origin counts from CC BY 4.0 data."},
            {"label": "Rapid Rail operator", "url": forecast["sources"]["rapid_rail_operator"], "detail": "Operator service scope"},
            {"label": "Official public holiday calendars", "url": forecast["sources"]["holidays"],
             "detail": f"Extracted jurisdictions: {', '.join(calendar['regions'])}", "regions": calendar["regions"]},
            {"label": "GTFS frequency specification", "url": capacity["external_references"]["GTFS_schedule_reference"], "detail": "Reference terminal departures"},
            {"label": "KTM Komuter OD data", "url": source["komuter"], "detail": "Exploratory hourly proxy"},
            {"label": "Shah Alam LRV formation and design capacity", "url": capacity["capacity_parameter"]["source_url"], "detail": capacity["capacity_parameter"]["source_description"]},
            {"label": "Historical PLANMalaysia research boundaries", "url": HISTORICAL_LAYER,
             "detail": "Boundary source for the archived Step 4 and 4B study"},
            {"label": "OpenStreetMap contributors", "url": OSM_ATTRIBUTION_URL,
             "detail": "ODbL 1.0 display and publication boundaries for the eight comparison units"},
            {"label": "Prasarana Rapid Rail KL GTFS", "url": GTFS_CATALOGUE,
             "detail": "CC BY 4.0 stop coordinates and routes used for the regenerated spatial joins"},
            {"label": "PLANMalaysia comparison scope", "url": SCOPE_SOURCE, "detail": "National Conurbation district reference"},
            *[{"label": item["label"], "url": item["url"], "detail": "Independent DOSM source under CC BY 4.0"}
              for item in publication_sources()[3:]],
            {"label": "RMK13 Klang Valley modal share target", "url": equity_data["policy"]["official_faq"], "detail": "Ministry of Economy policy context"},
            {"label": "SDG 9 · Industry, innovation and infrastructure", "url": "https://sdgs.un.org/goals/goal9", "detail": "Reliable transport infrastructure and equitable access"},
            {"label": "SDG 11 · Sustainable cities and communities", "url": "https://sdgs.un.org/goals/goal11", "detail": "Accessible and sustainable urban transport"},
        ],
        "sections": [
            {"title": "Observed demand and A0 checks", "text": [quality["definitions"]["station_origin_trips"], quality["definitions"]["itemized_check"],
                                                                  quality["definitions"]["headline"], forecast["network"]["definition"], OD_AGGREGATION]},
            {"title": "Model selection and rolling-origin evaluation", "text": [definitions[k] for k in
                 ("score", "training", "forecast_comparison", "near_term_accuracy", "revisions")]},
            {"title": "Cold-start, stability and feature experiments", "text": [innovation["methodology"][k] for k in
                 ("transfer", "stability", "holdout", "feature_ablation", "watchlist")] + [definitions["variables"], research_data["uncertainty"]["limitations"]]},
            {"title": "Holiday evidence and archived forecasts", "text": [
                "Observed holiday comparisons use dates verified in at least one extracted jurisdiction and controls with known non-holiday status. Tentative and uncovered dates are excluded from both samples.",
                "Per-jurisdiction records and Sunday substitution provenance are retained. The archive cannot establish later gazettes or separate Putrajaya coverage.",
                "The published forecasts and evaluation metrics retain the original Ridge feature, which included tentative dates. The Step 2B ablation treats tentative-only dates as unknown and evaluates the holiday and coverage features together.",
            ]},
            {"title": "Scheduled reference and nominal supply", "text": [capacity["definitions"][k] for k in
                 ("terminal_departure", "schedule_lifespan", "intensity", "nominal_supply", "peak_proxy", "coverage")]},
            {"title": "District scope, mapping and thresholds", "text": [
                SCOPE_DEFINITION, POINT_METHOD, DEDUPLICATION, SCREENING_METHOD, *equity_data["limitations"][:5], PUBLICATION_NOTE,
            ]},
            {"title": "SDG relevance", "text": ["Demand and reference supply support discussion of reliable transport infrastructure under SDG 9. District access questions also relate to urban transport under SDG 11. The dashboard reports descriptive indicators for the available data."]},
        ],
        "snapshot": {"headlineStart": forecast["headline"]["selected"]["date_min"], "headlineCutoff": forecast["headline"]["selected"]["date_max"],
                     "odStart": forecast["od"]["window_start"], "odCutoff": forecast["od"]["data_cutoff"],
                     "sourceRows": quality["rapidrail_od"]["rows"], "stationDates": quality["rapidrail_od"]["comparison"]["station_dates"],
                     "stationDateMatches": quality["rapidrail_od"]["comparison"]["matching_station_dates"],
                     "networkOriginDays": equity_evidence["originDayRows"], "surveyYears": [
                         equity_evidence["commonSurveyYear"], equity_evidence["latestSurveyYear"]],
                     "calendarYears": calendar["coveredYears"]},
        "outcomes": {"selectedNetworkWape": holdout["bottom_up_selected_components"]["wape_pct"],
                     "baselineNetworkWape": holdout["bottom_up_seasonal_naive_7"]["wape_pct"],
                     "networkHoldoutDays": holdout["bottom_up_selected_components"]["horizon_days"],
                     "shahAlamPublishedChangePct": stab["change_vs_recent_pct"],
                     "coldStart": [{"seriesId": key, "baselineWape": statistics.mean(cold[key, "seasonal_naive"]),
                                    "primaryDonorWape": statistics.mean(cold[key, "transfer_50"])} for key in (SHAH_ALAM, OD)]},
        "interventions": forecast["interventions"],
    }


def serialize(value):
    result = (json.dumps(clean(value), ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n").encode("utf-8")
    json.loads(result)
    return result


def schemas(data):
    return {name: {key: {"kind": type(value).__name__, "items": len(value) if isinstance(value, (dict, list)) else None,
                         "rowFields": list(value[0]) if isinstance(value, list) and value and isinstance(value[0], dict) else None}
                   for key, value in payload.items() if key != "schemaVersion"} for name, payload in data.items()}


def write_asset(path, content, verify):
    if path.is_file() and path.read_bytes() == content:
        return
    if verify:
        raise ValueError(f"Asset differs from the regenerated contract: {path}")
    pending = path.with_name(f"{path.name}.{stamp()}.pending")
    flushed_create(pending, content)
    require(pending.read_bytes() == content, f"Staged frontend asset failed read-back: {path.name}")
    os.replace(pending, path)


def apply_calendar_revision(assets, inputs):
    revision = inputs.json(MODEL_OUTPUTS)
    inputs.path(PREDICTIONS)
    require(revision["revision"] == REVISION and revision["disposition"] == "A", "Unexpected active forecast revision")
    require(inputs.hashes[PREDICTIONS] == revision["prediction_sha256"], "Calendar replay evidence checksum differs")
    for name, digest in revision["inputs"].items():
        require(sha(ROOT / name) == digest, f"Calendar revision source changed: {name}")
    network = assets["network.json"]
    research = assets["research.json"]
    service = assets["service.json"]
    methodology_data = assets["methodology.json"]
    require(len(revision["network"]["outlook"]) == 48 and len(revision["research"]["metrics"]) == len(research["metrics"]),
            "Calendar revision is missing forecast windows or metrics")
    network.update(revision["network"])
    research.update(revision["research"])
    service["intensity"] = revision["intensity"]
    for asset in (network, research, service, methodology_data):
        asset["forecastRevision"] = REVISION
    holdout = revision["terminal_14_day"]
    methodology_data["outcomes"]["selectedNetworkWape"] = holdout["bottom_up_selected_components"]
    methodology_data["outcomes"]["baselineNetworkWape"] = holdout["bottom_up_seasonal_naive_7"]
    for section in methodology_data["sections"]:
        if section["title"] == "Holiday evidence and archived forecasts":
            section["title"] = "Holiday evidence and active forecasting policy"
            section["text"][-1:] = [
                "Active Ridge forecasts and affected comparisons use the same verified-holiday indicator in fitting and prediction. Tentative and unknown statuses remain distinct in provenance. They receive no verified adjustment.",
                "The release keeps the original model families, training policies and hyperparameters. Corrected metrics reuse the original dates and origins. The Step 2B ablation retains its separate holiday and coverage feature bundle.",
                "The replay uses one archived calendar snapshot. Historical release and revision vintages are unavailable, and the terminal window had already been inspected. The replay does not establish fresh independent performance or 90-day accuracy.",
            ]
        if section["title"] == "Model selection and rolling-origin evaluation":
            section["text"][3] = "Original selections used 7-, 14- and 28-lead rolling scores. The active fixed-policy replay reports the already inspected terminal window separately. Overlapping origins can reuse observations."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Rebuild in memory and compare the published JSON bytes")
    args = parser.parse_args()
    check_memory()
    inputs = Inputs()
    forecast = inputs.json("forecast_metadata.json")
    innovation = inputs.json("innovation_metadata.json")
    capacity = inputs.json("capacity_metadata.json")
    network, history = target_series(inputs, forecast, innovation)
    calendar = archived_calendar(forecast["holidays"])
    patterns_data, comparisons = patterns(inputs, history, forecast, calendar)
    experiments = research(inputs, forecast, innovation)
    equity_data, display, equity_evidence = regenerate_equity()
    assets = {
        "network.json": network, "history.json": history, "research.json": experiments,
        "patterns.json": patterns_data, "service.json": service(inputs, capacity, network, calendar),
        "equity.json": equity_data, DISPLAY_GEOGRAPHY_NAME: display,
        "methodology.json": methodology(inputs, forecast, innovation, capacity, equity_data, equity_evidence, experiments, calendar),
    }
    apply_calendar_revision(assets, inputs)
    calendar_output = serialize({
        "revision": DESCRIPTIVE_REVISION, "analysisReferenceDate": network["asOf"], "calendar": calendar,
        "matchedHolidayComparisons": comparisons, "supplyEligibilityChanges": 0,
        "inputs": {name: inputs.hashes[name] for name in ("forecast_metadata.json", "demand_patterns.csv",
                   "network_service_history.parquet", "lrt3_daily.parquet", "lrt3_service_readiness.csv")},
        "publishedForecastPolicy": "Archived published values and metrics are preserved; calendar sensitivity is not a model selection.",
    })
    serialized = {name: serialize({"schemaVersion": SCHEMA_VERSION, **value}) for name, value in assets.items()}
    protected = verify_preservation()
    manifest = {"schemaVersion": SCHEMA_VERSION, "dataRevision": REVISION, "analysisReferenceDate": network["asOf"],
                "assets": {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} for name, content in serialized.items()},
                "inputSha256": {**inputs.hashes, CORRECTION_ARTIFACT: hashlib.sha256(calendar_output).hexdigest()}, "schemas": schemas(assets),
                "displayGeography": {"asset": DISPLAY_GEOGRAPHY_NAME, "revision": DISPLAY_REVISION, "license": "ODbL-1.0",
                                     "licenseUrl": ODBL_URL, "attributionUrl": OSM_ATTRIBUTION_URL},
                "equityPublication": {"asset": "equity.json", "revision": equity_evidence["revision"],
                                      "inputSha256": equity_evidence["inputSha256"]},
                "validation": {"forecastComponentsCoherent": True, "horizonTotalsAndBaselinesReconciled": True, "scenarioValuesReconciled": True,
                               "modelAndExperimentRowsReconciled": True, "gtfsDeparturesAndHeadwaysReconciled": True, "peakRowsReconciled": assets["service.json"]["validatedPeakRows"],
                               "districtGeometryAndPopulationChecked": True, "missingAndZeroSeparated": True, "protectedBackendFileCount": protected}}
    serialized["manifest.json"] = serialize(manifest)
    if not args.verify:
        DATA.mkdir(exist_ok=True)
    write_asset(OUTPUT / CORRECTION_ARTIFACT, calendar_output, args.verify)
    for name, content in serialized.items():
        write_asset(DATA / name, content, args.verify)
        print(f"{name}: {len(content):,} bytes", flush=True)
    print(f"{len(serialized)} assets validated against {len(manifest['inputSha256'])} processed inputs; {protected} protected checksums match.", flush=True)


if __name__ == "__main__":
    main()
