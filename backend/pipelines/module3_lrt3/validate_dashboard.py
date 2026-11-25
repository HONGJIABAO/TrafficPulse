"""Check the saved dashboard assets and key foundations against the local research artifacts."""

import json
from collections import defaultdict

from dashboard_progress import folder, record, verify_preservation
from export_dashboard import DATA, Inputs, NETWORK, OD, close, require
from run_equity import OUTPUT, ROOT, check_memory, peak_memory, sha


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError(f"Non-JSON numeric value: {value}")


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object, parse_constant=reject_constant)


def unique_rows(rows, fields, label):
    keys = {tuple(row[field] for field in fields) for row in rows}
    require(len(keys) == len(rows), f"Duplicate {label} rows")


def validate_forecasts(data):
    network, history, research, patterns = (data[key] for key in ("network", "history", "research", "patterns"))
    require(network["asOf"] == "2026-11-24", "Fixed reference date differs")
    require(len(network["components"]) == 6 and OD not in network["components"], "Headline scope")
    require(set(network["targets"]) == set(history["series"]) == set(network["daily"]), "Forecast target contracts differ")
    unique_rows(network["outlook"], ("series_id", "horizon", "scope"), "forecast outlook")
    unique_rows(network["watchlist"], ("series_id", "view"), "watchlist")
    for target, points in network["daily"].items():
        observations = history["series"][target]
        require(len({date for date, _, _ in observations}) == len(observations), f"Duplicate history for {target}")
        require(len({date for date, _, _ in points}) == len(points) == 90, f"Daily forecast calendar for {target}")
        require(points[0][0] > network["targets"][target]["data_cutoff"], f"Forecast overlaps cutoff for {target}")
        for _, value, status in observations:
            require((value is None) == (not status.startswith("observed_")), f"Observation availability for {target}")
    for index, (_, value, _) in enumerate(network["daily"][NETWORK]):
        require(close(value, sum(network["daily"][key][index][1] for key in network["components"])), "Network sum differs")
    for date, lead, low, base, high in network["scenarios"]:
        require(low <= base <= high and network["daily"][OD][lead - 1] == [date, base, lead], "LRT3 scenario order or Base differs")
    for row in network["outlook"]:
        points = [v for date, v, _ in network["daily"][row["series_id"]][:row["horizon"]]
                  if row["scope"] == "full" or date > network["asOf"]]
        require(len(points) == row["days"] and close(sum(points), row["total"]), "Outlook window differs")
    research_keys = {
        "metrics": ("series_id", "phase", "training_policy", "model_id", "horizon_days"),
        "cold": ("series_id", "arm", "horizon_days"),
        "coldFolds": ("series_id", "arm", "horizon_days", "origin"),
        "stability": ("series_id", "phase", "variant", "model_id", "horizon_days"),
        "ablation": ("series_id", "variant", "horizon_days"),
    }
    for kind, names in research_keys.items():
        unique_rows(research[kind], names, kind)
    require({key.split("|")[0] for key in research["alternatives"]} == set(network["targets"]), "Alternative forecast scope")
    unique_rows(patterns["patterns"], ("series_id", "pattern", "group"), "demand patterns")
    require(any(r["pattern"] == "calendar_month" and r["observed_days"] < r["expected_days"] for r in patterns["patterns"]), "Partial month coverage")


def validate_service(data):
    unique_rows(data["routes"], ("route_id",), "GTFS route")
    unique_rows(data["hourly"], ("route_id", "day_type", "direction_id", "service_hour"), "hourly GTFS")
    unique_rows(data["periods"], ("route_id", "day_type", "direction_id", "period"), "GTFS period")
    unique_rows(data["nominal"], ("day_type", "direction_id", "period"), "nominal capacity")
    unique_rows(data["calendar"], ("date",), "dated readiness")
    require(len(data["routes"]) == 8 and sum(row["is_rail"] for row in data["routes"]) == 7, "Archived route coverage")
    places = data["capacity"]["passenger_places"]
    require(places == data["capacity"]["source_reported_passenger_places"], "Nominal design evidence")
    hours = defaultdict(list)
    for row in data["hourly"]:
        hours[row["route_id"], row["day_type"], row["direction_id"]].append(row["reference_departures"])
    for row in data["periods"]:
        if row["period"] == "all_day":
            daily_hours = hours[row["route_id"], row["day_type"], row["direction_id"]]
            require(len(daily_hours) == 24 and close(sum(daily_hours), row["reference_departures"]), "Hourly and daily departures differ")
    for row in data["nominal"]:
        require(close(row["departures"] * places, row["nominal_places"]), "Nominal capacity arithmetic differs")
    weekday = next(row for row in data["nominal"] if (row["day_type"], row["direction_id"], row["period"]) == ("weekday", "both", "all_day"))
    require(data["validatedPeakRows"] == 67_080, "Peak sensitivity row reconciliation")
    require(any(row["supply_status"].startswith("unavailable_") for row in data["calendar"]), "Holiday supply availability")
    ampang = next(row for row in data["intensity"] if row["route_ids"] == "AG|PH")
    require(ampang["forecast_published_trips_per_reference_departure"] is None, "Unavailable combined branch intensity")
    return weekday


def validate_equity(data, geography, inputs):
    districts = data["districts"]
    unique_rows(districts, ("district_id",), "district")
    unique_rows(data["screens"], ("scenario_id", "district_id"), "screening")
    unique_rows(data["stationContributions"], ("station_code",), "LRT3 station contribution")
    ids = {row["district_id"] for row in districts}
    require(len(ids) == len(geography["features"]) == 8 and ids == {f["properties"]["district_id"] for f in geography["features"]}, "District Geography")
    station_map = list(inputs.csv("station_district_mapping.csv"))
    station_ids = {row["physical_station_id"] for row in station_map if row["district_id"] in ids}
    lrt_ids = {row["lrt3_station_code"] for row in station_map if row["lrt3_station_code"]}
    require(len(station_ids) == data["physicalStations"] == sum(row["rapid_rail_physical_stations"] for row in districts), "Mapped physical station count")
    require(len(lrt_ids) == data["lrt3Stations"] and lrt_ids == {r["station_code"] for r in data["stationContributions"]}, "LRT3 station codes")
    origins = set()
    origin_days = set()
    origin_trips = defaultdict(int)
    lrt_total = 0
    columns = ["date", "canonical_origin_code", "lrt3_station_code", "district_id", "station_origin_trips"]
    for row in inputs.parquet("network_station_origin_daily.parquet", columns):
        key = row["canonical_origin_code"]
        origins.add(key)
        origin_days.add((key, row["date"]))
        origin_trips[row["district_id"]] += row["station_origin_trips"]
        if row["lrt3_station_code"]:
            lrt_total += row["station_origin_trips"]
    require(len(origins) == sum(row["mapped_published_origin_codes"] for row in districts), "Published origin code count")
    require(len(origin_days) == len(origins) * data["observation"]["days"], "Observed origin-day rows")
    require(lrt_total == data["lrt3Trips"] == sum(r["station_origin_trips"] for r in data["stationContributions"]), "LRT3 origin totals differ")
    require(sum(origin_trips.values()) == data["activityTotal"], "Network origin totals differ")
    for row in districts:
        require(origin_trips[row["district_id"]] == row["observed_rapid_rail_station_origin_trips"], "District origin totals differ")
        if row["rapid_rail_physical_stations"] == 0:
            require(row["observed_rapid_rail_station_origin_trips"] == 0 and row["average_daily_rapid_rail_station_origin_trips_per_physical_station"] is None, "Structural zero versus unavailable ratio")
    scenarios = {r["scenario_id"] for r in data["screens"]}
    require(len(scenarios) == 6 and len(data["screens"]) == len(ids) * len(scenarios), "Equity cohort completeness")
    for row in data["screens"]:
        if row["screen_status"] != "available":
            require(row["priority_for_further_investigation"] is None, "Unavailable priority flag")
            continue
        low_income = row["median_monthly_household_income_myr"] <= row["income_cutoff_myr"]
        high_poverty = row["absolute_poverty_households_pct"] >= row["poverty_cutoff_pct"]
        low_coverage = row["stations_per_100k_residents"] <= row["coverage_cutoff_stations_per_100k"]
        vulnerable = (low_income or high_poverty) if row["vulnerability_rule"] == "either" else (low_income and high_poverty)
        require(vulnerable == row["relative_vulnerability_flag"] and (vulnerable and low_coverage) == row["priority_for_further_investigation"],
                f"Saved classification differs for {row['district_id']} in {row['scenario_id']}")


def main():
    free = check_memory()
    manifest = read_json(DATA / "manifest.json")
    assets = {}
    for name, info in manifest["assets"].items():
        path = DATA / name
        require(path.stat().st_size == info["bytes"] and sha(path) == info["sha256"], f"Manifest differs for {name}")
        asset = read_json(path)
        require(asset["schemaVersion"] == manifest["schemaVersion"] == 1, f"Schema version invalid in {name}")
        assets[path.stem] = asset
    for name, checksum in manifest["inputSha256"].items():
        require(sha(OUTPUT / name) == checksum, f"Source checksum differs for {name}")
    validate_forecasts(assets)
    weekday = validate_service(assets["service"])
    validate_equity(assets["equity"], assets["district-geography"], Inputs())
    step4b = read_json(OUTPUT / "network_activity_checkpoints/preservation_baseline.json")
    for relative, checksum in step4b["file_hashes"].items():
        require(sha(ROOT / relative) == checksum, f"Step 4B original baseline differs for {relative}")
    protected = verify_preservation()
    latest = read_json(folder() / "baseline.json")
    for name, checksum in latest["verified_step4b"].items():
        path = ROOT / name if "/" in name else OUTPUT / name
        require(sha(path) == checksum, f"Step 4B published checksum differs for {name}")
    print(f"Validated {len(assets) + 1} JSON assets, {protected} protected Step 5 hashes, and {len(step4b['file_hashes'])} original Step 4B hashes.")
    print(f"LRT3 weekday reference: {weekday['departures']:,} departures, {weekday['nominal_places']:,} nominal places.")
    print(f"Station-origin totals: LRT3 {assets['equity']['lrt3Trips']:,}, network {assets['equity']['activityTotal']:,}.")
    print(f"Available RAM before validation: {free} MiB; peak validation process: {peak_memory()} MiB.")
    record("accuracy_validated", [DATA / "manifest.json"], step4b_original_hashes=len(step4b["file_hashes"]),
           protected_backend_files=protected, available_memory_mib=free, peak_process_working_set_mib=peak_memory())


if __name__ == "__main__":
    main()
