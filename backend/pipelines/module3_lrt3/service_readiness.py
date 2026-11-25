"""Pair demand projections with defensible GTFS reference supply."""

import numpy as np
import pandas as pd

from forecast_inputs import HEADLINE, OD, SERVICES
from run_validation import require
from scheduled_service import DIRECTIONS, HOUR, ROUTE_TO_SERVICE, SHAH_ROUTE, SHARED_REASON, clock


UNAVAILABLE = "unavailable"
HOLIDAY = "unavailable_no_holiday_timetable"
IN_RANGE = "ordinary_day_GTFS_reference"
HELD = "reference_held_beyond_GTFS_validity"
SCENARIOS = ("low", "base", "high")
MEASURES = ("reference_departures", "exact_scheduled_departures", "frequency_implied_departures")


def dated_status(frame, config, audit):
    dates = frame["date"]
    day_type = np.asarray(["weekday"] * 5 + ["saturday", "sunday"])[dates.dt.dayofweek]
    in_range = dates.between(audit["declared_valid_from"], audit["declared_valid_to"])
    exception_dates = [entry["date"] for entry in audit["calendar_date_exceptions"]]
    holiday = frame["verified_holiday"] | dates.isin(exception_dates)
    return frame.assign(
        day_type=day_type, within_declared_calendar=in_range, flagged_holiday_or_exception=holiday,
        supply_status=np.select(
            [holiday, ~frame["holiday_calendar_known"], in_range],
            [HOLIDAY, "unavailable_unknown_holiday_calendar", IN_RANGE], default=HELD,
        ), as_of_date=pd.Timestamp(config["as_of_date"]),
    )


def future_forecast(frame, config, audit):
    out = frame.loc[frame["date"].gt(pd.Timestamp(config["as_of_date"]))].copy()
    require(not out.empty and out["date"].gt(out["data_cutoff"]).all()
            and np.isfinite(out["forecast_trips"]).all() and out["forecast_trips"].ge(0).all(),
            "Missing or invalid future-only forecasts")
    return dated_status(out, config, audit)


def network_intensity(forecasts, history, summary, config, audit):
    published = forecasts.loc[forecasts["series_id"].isin(SERVICES)].copy()
    require(set(published["series_id"]) == set(SERVICES) and published["target_id"].eq(HEADLINE).all()
            and published["unit"].eq("headline_service_trips").all()
            and not published.duplicated(["series_id", "date"]).any(), "Invalid headline forecast targets")
    future = future_forecast(published, config, audit)
    aligned = future.groupby("date")
    require(aligned.size().eq(len(SERVICES)).all()
            and aligned["supply_status"].nunique().eq(1).all()
            and future["data_cutoff"].nunique() == 1, "Headline forecast calendars are incomparable")
    ordinary = summary.loc[summary["period"].eq("all_day") & summary["direction_id"].eq("both")]
    departures = ordinary.set_index(["route_id", "day_type"])["reference_departures"]
    rows = []
    for key, part in future.groupby("series_id", sort=False):
        original = published.loc[published["series_id"].eq(key)]
        routes = [route for route, series_id in ROUTE_TO_SERVICE.items() if series_id == key]
        recent = history.loc[history["series_id"].eq(key) & history["date"].le(part["data_cutoff"].iat[0])]
        recent = recent.sort_values("date").iloc[-config["recent_baseline_days"]:]
        expected_recent = pd.date_range(end=part["data_cutoff"].iat[0], periods=config["recent_baseline_days"])
        require(pd.DatetimeIndex(recent["date"]).equals(expected_recent) and recent["actual_trips"].notna().all()
                and recent["unit"].eq("headline_service_trips").all(), "Recent headline data incomplete")
        recent_weekday = recent.groupby(recent["date"].dt.dayofweek)["actual_trips"].mean()
        full_baseline = part["date"].dt.dayofweek.map(recent_weekday).mean()
        full_mean = part["forecast_trips"].mean()
        paired = part.loc[part["supply_status"].isin([IN_RANGE, HELD])]
        route_denominator = len(routes) == 1
        available = route_denominator and not paired.empty
        values = pd.Series(dtype=float)
        if available:
            values = paired["day_type"].map(departures.loc[routes[0]])
            require(values.notna().all() and values.gt(0).all(), "Missing positive route supply")
        paired_forecast = paired["forecast_trips"].sum() if available else np.nan
        paired_recent = paired["date"].dt.dayofweek.map(recent_weekday).sum() if available else np.nan
        denominator = values.sum() if available else np.nan
        rows.append({
            "series_id": key, "service_name": SERVICES[key], "target_id": HEADLINE, "unit": "headline_service_trips",
            "route_ids": "|".join(routes), "direction_scope": "both_directions",
            "day_type": "calendar_mix_ordinary_days_for_intensity", "as_of_date": part["as_of_date"].iat[0],
            "data_cutoff": part["data_cutoff"].iat[0], "original_forecast_start": original["date"].min(),
            "original_forecast_end": original["date"].max(), "future_start": part["date"].min(),
            "future_end": part["date"].max(), "future_forecast_days": len(part),
            "forecast_average_daily_trips": full_mean, "recent_weekday_matched_daily_trips": full_baseline,
            "forecast_change_vs_recent_pct": 100 * (full_mean / full_baseline - 1),
            "calendar_comparable_days": len(paired), "days_excluded_from_schedule_comparison": len(part) - len(paired),
            "intensity_covered_days": len(paired) if available else 0,
            "intensity_dates_within_declared_calendar": int(paired["within_declared_calendar"].sum()) if available else 0,
            "intensity_dates_held_beyond_validity": int((~paired["within_declared_calendar"]).sum()) if available else 0,
            "paused_supply_dates": "|".join(part.loc[~part.index.isin(paired.index), "date"].dt.strftime("%Y-%m-%d")),
            "intensity_status": "available_fixed_reference" if available
            else "unavailable_shared_trunk" if not route_denominator else "unavailable_no_supported_dates",
            "intensity_reason": "One compatible route with an ordinary-day reference timetable."
            if available else SHARED_REASON if not route_denominator else "No dates with a comparable reference supply.",
            "reference_departures_total": denominator,
            "reference_departures_per_ordinary_day": denominator / len(paired) if available else np.nan,
            "paired_forecast_published_trips": paired_forecast, "paired_recent_matched_trips": paired_recent,
            "forecast_published_trips_per_reference_departure": paired_forecast / denominator if available else np.nan,
            "recent_published_trips_per_same_reference_departure": paired_recent / denominator if available else np.nan,
            "change_in_trips_per_departure_pct": 100 * (paired_forecast / paired_recent - 1) if available else np.nan,
            "assumed_service_change_pct": 0.0 if available else np.nan,
            "intensity_unit": "published_service_trips_per_reference_terminal_departure",
            "demand_evidence": "Step_2_headline_forecast_and_observed_recent_baseline",
            "supply_evidence": "fixed_GTFS_reference_timetable",
        })
    return pd.DataFrame(rows), future[["date", "supply_status", "within_declared_calendar"]].drop_duplicates()


def capacity_parameter(config):
    source = config["nominal_train_capacity"]
    value = source["passenger_places"]
    require(np.isfinite(value) and value > 0 and int(value) == value, "Nominal train capacity must be a positive integer")
    return source | {
        "verification_status": "verified_documented_design_capacity" if value == source["source_reported_passenger_places"]
        else "user_configured_unverified_assumption",
        "supply_classification": "conditional_nominal_planning_estimate",
    }


def readiness(forecast, scenarios, summary, config, audit, capacity):
    require(forecast["series_id"].eq(OD).all() and forecast["unit"].eq("station_origin_trips").all()
            and scenarios["series_id"].eq(OD).all() and scenarios["unit"].eq("station_origin_trips").all()
            and forecast["date"].is_unique and scenarios["date"].is_unique,
            "LRT3 forecasts and planning scenarios do not match the station-origin target")
    scenarios = scenarios.set_index("date").reindex(forecast["date"])
    require(scenarios["data_cutoff"].eq(forecast.set_index("date")["data_cutoff"]).all()
            and scenarios["lead_day"].eq(forecast.set_index("date")["lead_day"]).all(),
            "OD planning scenario cutoff or lead differs from Base")
    np.testing.assert_array_equal(scenarios["base_trips"], forecast["forecast_trips"])
    require(np.isfinite(scenarios[[f"{s}_trips" for s in SCENARIOS]]).all().all()
            and scenarios["low_trips"].ge(0).all() and scenarios["low_trips"].le(scenarios["base_trips"]).all()
            and scenarios["base_trips"].le(scenarios["high_trips"]).all(), "Invalid ordered OD scenarios")
    future = future_forecast(forecast, config, audit).merge(
        scenarios[[f"{s}_trips" for s in SCENARIOS]], left_on="date", right_index=True, validate="one_to_one",
    )
    tags = ["date", "as_of_date", "data_cutoff", "lead_day", "day_type", "supply_status",
            "within_declared_calendar", "flagged_holiday_or_exception", "series_id", "target_id", "model_id"]
    long = future.melt(
        id_vars=tags, value_vars=[f"{s}_trips" for s in SCENARIOS],
        var_name="scenario", value_name="daily_station_origin_trips",
    )
    long["scenario"] = long["scenario"].str.removesuffix("_trips")
    long["demand_evidence"] = np.where(long["scenario"].eq("base"), "Step_2_station_origin_forecast",
                                       "Step_2_planning_scenario")
    refs = summary.loc[summary["route_id"].eq(SHAH_ROUTE)]
    reference = refs.pivot(index=["day_type", "direction_id", "direction_label"], columns="period",
                           values="reference_departures").reset_index()
    reference.columns.name = None
    periods = ("all_day", *config["windows_hours"])
    ready = long.merge(reference, on="day_type", validate="many_to_many")
    require(len(ready) == len(long) * len(DIRECTIONS), "Missing LRT3 directions")
    ready["route_id"] = SHAH_ROUTE
    ready["demand_unit"] = "station_origin_trips_per_day"
    ready["supply_unit"] = "nominal_passenger_places_at_terminal_departures_per_period"
    ready["nominal_places_per_train"] = capacity["passenger_places"]
    ready["capacity_verification_status"] = capacity["verification_status"]
    ready["supply_evidence"] = capacity["supply_classification"]
    ready["directional_demand_status"] = np.where(
        ready["direction_id"].eq("both"), "line_total_undirected", "unavailable_no_directional_demand",
    )
    ready["daily_station_origin_trips"] = ready["daily_station_origin_trips"].where(ready["direction_id"].eq("both"))
    for period in periods:
        supported = ready["supply_status"].isin([IN_RANGE, HELD])
        ready[f"{period}_reference_departures"] = ready.pop(period).where(supported)
        ready[f"{period}_nominal_passenger_places"] = ready[f"{period}_reference_departures"] * capacity["passenger_places"]
    return ready.sort_values(["date", "scenario", "direction_id"]).reset_index(drop=True), long


def sensitivity(demand, profiles, hourly, summary, config, capacity):
    keys = ["scope", "year", "day_type"]
    require(set(profiles["scope"]) == {"network", "port_klang_west"}
            and {"combined", "2023", "2024", "2025", "2026"}.issubset(profiles["year"])
            and set(profiles["day_type"]) == {"weekday", "weekend"}
            and profiles.groupby(keys)["hour"].agg(list).map(lambda hours: sorted(hours) == list(range(24))).all()
            and profiles["hourly_share"].between(0, 1).all(), "Missing or invalid Komuter proxy inputs")
    np.testing.assert_allclose(profiles.groupby(keys)["hourly_share"].sum(), 1, atol=1e-12)
    profile = profiles[keys + ["hour", "hourly_share"]].rename(columns={
        "scope": "proxy_scope", "year": "proxy_period", "day_type": "proxy_day_type", "hourly_share": "proxy_share",
    })
    hourly_profile = profile.assign(
        window=lambda f: f["hour"].map(lambda h: f"hour_{h:02d}"),
        window_start=lambda f: f["hour"].map(lambda h: clock(h * HOUR)),
        window_end_exclusive=lambda f: f["hour"].map(lambda h: clock((h + 1) * HOUR)),
        window_hours=1, resolution="hourly",
    ).drop(columns="hour")
    profile_parts = [hourly_profile]
    hourly_supply = hourly.loc[hourly["route_id"].eq(SHAH_ROUTE) & hourly["direction_id"].eq("both")
                               & hourly["service_hour"].lt(24)]
    supply_parts = [hourly_supply.assign(window=lambda f: f["service_hour"].map(lambda h: f"hour_{h:02d}"))]
    for period in ("am_peak", "pm_peak"):
        start, stop = config["windows_hours"][period]
        peak = profile.loc[profile["hour"].ge(start) & profile["hour"].lt(stop)]
        profile_parts.append(peak.groupby(["proxy_scope", "proxy_period", "proxy_day_type"], as_index=False)[
            "proxy_share"
        ].sum().assign(
            window=period, window_start=clock(start * HOUR), window_end_exclusive=clock(stop * HOUR),
            window_hours=stop - start, resolution="peak_period",
        ))
        supply_parts.append(summary.loc[summary["route_id"].eq(SHAH_ROUTE) & summary["direction_id"].eq("both")
                                        & summary["period"].eq(period)].assign(window=period))
    weights = pd.concat(profile_parts, ignore_index=True)
    supply = pd.concat([chunk[["day_type", "window", *MEASURES]] for chunk in supply_parts], ignore_index=True)
    demand = demand.assign(proxy_day_type=np.where(demand["day_type"].eq("weekday"), "weekday", "weekend"))
    peak = demand.merge(weights, on="proxy_day_type", validate="many_to_many").merge(
        supply, on=["day_type", "window"], validate="many_to_one",
    )
    peak["route_id"] = SHAH_ROUTE
    peak["direction_scope"] = "line_demand_undirected_and_supply_both_directions"
    peak["proxy_station_origin_trips_in_window"] = peak["daily_station_origin_trips"] * peak["proxy_share"]
    peak["proxy_station_origin_trips_per_hour"] = peak["proxy_station_origin_trips_in_window"] / peak["window_hours"]
    supported = peak["supply_status"].isin([IN_RANGE, HELD])
    for field in MEASURES:
        peak[field] = peak[field].where(supported)
    peak["reference_departures_per_hour"] = peak["reference_departures"] / peak["window_hours"]
    peak["nominal_passenger_places_in_window"] = peak["reference_departures"] * capacity["passenger_places"]
    peak["nominal_passenger_places_per_hour"] = peak["nominal_passenger_places_in_window"] / peak["window_hours"]
    peak["nominal_places_per_train"] = capacity["passenger_places"]
    peak["zero_terminal_departure_hour_with_proxy_demand"] = (
        peak["resolution"].eq("hourly") & peak["reference_departures"].eq(0)
        & peak["proxy_station_origin_trips_in_window"].gt(0)
    )
    peak["proxy_evidence"] = "exploratory_Komuter_transaction_hour_share"
    peak["supply_evidence"] = capacity["supply_classification"]
    peak["demand_unit"] = "station_origin_trips_per_window"
    peak["supply_unit"] = "nominal_passenger_places_per_window"
    order = ["date", "scenario", "proxy_scope", "proxy_period", "window"]
    return peak.sort_values(order).reset_index(drop=True)


def validate_comparisons(hourly, summary, intensity, ready, peak, demand, config, capacity):
    keys = ["route_id", "day_type", "direction_id"]
    for field in MEASURES:
        totals = hourly.groupby(keys)[field].sum()
        days = summary.loc[summary["period"].eq("all_day")].set_index(keys)[field].sort_index()
        np.testing.assert_allclose(totals, days, rtol=1e-12)
        for period, (start, end) in config["windows_hours"].items():
            totals = hourly.loc[hourly["service_hour"].ge(start) & hourly["service_hour"].lt(end)].groupby(keys)[
                field
            ].sum()
            periods = summary.loc[summary["period"].eq(period)].set_index(keys)[field].sort_index()
            np.testing.assert_allclose(totals, periods, rtol=1e-12)
        for frame, period_key in [(hourly, "service_hour"), (summary, "period")]:
            expected = frame.loc[frame["direction_id"].ne("both")].groupby(keys[:2] + [period_key])[field].sum()
            observed = frame.loc[frame["direction_id"].eq("both")].set_index(keys[:2] + [period_key])[field].sort_index()
            np.testing.assert_allclose(expected, observed, rtol=1e-12)
            require(np.isfinite(frame[field]).all() and frame[field].ge(0).all(), "Invalid scheduled departures")
    unavailable = intensity["intensity_status"].ne("available_fixed_reference")
    ratio = "forecast_published_trips_per_reference_departure"
    require(intensity[ratio].isna().eq(unavailable).all() and np.isfinite(intensity.loc[~unavailable, ratio]).all()
            and intensity.loc[~unavailable, ratio].ge(0).all(), "Unsupported service-intensity denominator")
    # Signed change metrics may be negative. Supply/demand magnitudes must remain nonnegative.
    for period in ("all_day", *config["windows_hours"]):
        departure_col = f"{period}_reference_departures"
        supply_col = f"{period}_nominal_passenger_places"
        np.testing.assert_allclose(ready[supply_col], ready[departure_col] * capacity["passenger_places"], equal_nan=True)
        grouped = ready.loc[ready["direction_id"].ne("both")].groupby(["date", "scenario"])[supply_col].sum(min_count=2)
        combined = ready.loc[ready["direction_id"].eq("both")].set_index(["date", "scenario"])[supply_col].sort_index()
        np.testing.assert_allclose(grouped, combined, rtol=1e-12, equal_nan=True)
    require(ready["daily_station_origin_trips"].isna().eq(ready["direction_id"].ne("both")).all(),
            "Directional demand was allocated without evidence")
    group = ["date", "scenario", "proxy_scope", "proxy_period"]
    hours = peak.loc[peak["resolution"].eq("hourly")]
    total = hours.groupby(group)["proxy_station_origin_trips_in_window"].sum()
    baseline = peak.groupby(group)["daily_station_origin_trips"].first()
    proxy_count = len(peak[["proxy_scope", "proxy_period"]].drop_duplicates())
    require(hours.groupby(group).size().eq(24).all() and len(baseline) == len(demand) * proxy_count,
            "Incomplete hourly or scenario grid")
    np.testing.assert_allclose(total, baseline, rtol=1e-12)
    for period in ("am_peak", "pm_peak"):
        start, end = config["windows_hours"][period]
        target = peak.loc[peak["window"].eq(period)].set_index(group).sort_index()
        selected = hours.loc[hours["window"].isin([f"hour_{h:02d}" for h in range(start, end)])]
        for field in ("reference_departures", "proxy_station_origin_trips_in_window", "nominal_passenger_places_in_window"):
            np.testing.assert_allclose(selected.groupby(group)[field].sum(min_count=end-start), target[field],
                                       rtol=1e-12, equal_nan=True)
    no_supply = ~peak["supply_status"].isin([IN_RANGE, HELD])
    require(peak["reference_departures"].isna().eq(no_supply).all(), "Invented supply on unsupported special dates")
    for field in ["proxy_station_origin_trips_in_window", "reference_departures", "nominal_passenger_places_in_window"]:
        values = peak[field].dropna()
        require(np.isfinite(values).all() and values.ge(0).all(), f"Invalid support for {field}")
