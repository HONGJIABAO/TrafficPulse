"""Independent source, GTFS, proxy and equity checks for the V1 audit."""
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal
from fractions import Fraction
from math import cos, hypot, radians
from statistics import mean
from zipfile import ZipFile
import csv

from v1_audit import OUT, PIPE, RAW, asset, csv_rows, identical, iso, memory_guard, parquet, read_json, relative, sha


OD_COLUMNS = (
    "date", "canonical_origin_code", "raw_od_label", "physical_station_id", "district_id", "lrt3_station_code",
    "published_destination_code", "a0_destination_rows", "a0_destination_trips", "individual_destination_rows",
    "individual_destination_trips", "empirical_destination_roster_size", "has_duplicate_od_key",
    "station_origin_trips", "station_origin_status", "district_allocation_status",
)


def raw_od_samples(path, samples):
    days = {day.encode() for _, day in samples}
    prefixes = tuple(label.encode() + b"," for label, _ in samples)
    chosen = {key: {} for key in samples}
    rows = 0
    with path.open("rb", buffering=1024 * 1024) as handle:
        fieldnames = next(handle).strip().decode("utf-8-sig").split(",")
        for line in handle:
            if not line.strip():
                continue
            rows += 1
            if not rows % 1_000_000:
                memory_guard()
            if not line.lstrip(b'"').startswith(prefixes) or not any(day in line for day in days):
                continue
            origin, destination, at, trips = next(csv.reader([line.decode("utf-8")], strict=True))
            key = (origin, at[:10])
            if key in chosen:
                if destination in chosen[key]:
                    raise ValueError(f"Sample duplicate: {key}, {destination}")
                chosen[key][destination] = int(trips)
    return fieldnames, rows, chosen


def data_integrity(a):
    origins = list(parquet(OUT / "network_station_origin_daily.parquet", OD_COLUMNS))
    scan_file = next((OUT / "network_activity_checkpoints").glob("01_od_scan_*/origin_audit.parquet"))
    scan = {(row["raw_origin"], iso(row["date"])): row for row in parquet(scan_file)}
    keys = {(row["canonical_origin_code"], iso(row["date"])) for row in origins}
    raw_by_day = {(row["raw_od_label"], iso(row["date"])): row for row in origins}
    wanted = {}
    for prefix in ("AG", "SA", "PYL"):
        for day in ("2026-08-01", "2026-11-20"):
            key = next(key for key in raw_by_day if key[0].startswith(prefix) and key[1] == day)
            wanted[key] = raw_by_day[key]
    raw_path = RAW / "rapidrail_2026_daily.csv"
    header, count, samples = raw_od_samples(raw_path, wanted)
    a.check("Raw OD archive record count and header", count == 5_623_020 and header == ["origin", "destination", "date", "ridership"],
            "One sequential buffered line count; only six selected origin-day groups were parsed.", source=relative(raw_path),
            expected="5,623,020 and four named fields", actual=f"{count:,}; {header}")
    sample_results = {}
    for key, destinations in samples.items():
        aggregate = destinations.get("A0: All Stations")
        detail = sum(value for name, value in destinations.items() if name != "A0: All Stations")
        saved = scan[key]
        sample_results[" / ".join(key)] = {"aggregate": aggregate, "individual_sum": detail, "destinations": len(destinations) - 1,
            "agree": aggregate == detail == saved["a0_destination_trips"] == wanted[key]["station_origin_trips"]
                and len(destinations) - 1 == saved["empirical_destination_roster_size"]
                and all(value >= 0 for value in destinations.values())}
    a.check("Sampled raw outgoing A0 and named destinations", all(row["agree"] for row in sample_results.values()),
            "Independently summed every named destination for six AG, SA and PYL origin-date groups. A0 was excluded from detail.",
            source="network_activity_checkpoints/01_od_scan_*/origin_audit.parquet; raw OD CSV", actual=f"{sum(r['agree'] for r in sample_results.values())}/6")
    a.check("Full processed origin-day reconciliation", len(origins) == len(keys) == len(scan) == 18592 and
            all(row["station_origin_trips"] == row["a0_destination_trips"] == row["individual_destination_trips"]
                and row["individual_destination_rows"] == row["empirical_destination_roster_size"]
                and row["a0_destination_rows"] == 1 and not row["has_duplicate_od_key"] and row["station_origin_trips"] > 0
                and row["station_origin_status"] == "observed_positive" and row["district_allocation_status"] == "mapped_available"
                and scan[row["raw_od_label"], iso(row["date"])]["a0_destination_trips"] == row["station_origin_trips"] for row in origins),
            "Each accepted processed origin-day uses one positive subtotal, complete published detail, and a unique canonical key.",
            source="network_station_origin_daily.parquet; origin_audit.parquet", expected="18,592", actual=f"{len(keys):,}")
    crosswalk = list(csv_rows(OUT / "network_station_origin_crosswalk.csv", ("district_id",)))
    o_codes = {row["canonical_origin_code"] for row in origins}
    cross_codes = {row["canonical_origin_code"] for row in crosswalk if row["published_origin"]}
    days = {when for _, when in keys}
    p_orig = {row["raw_od_code"] for row in crosswalk if row["published_origin"] and str(row["raw_od_code"]).startswith("PYL")}
    p_dest = {row["raw_od_code"] for row in crosswalk if row["published_destination"] and str(row["raw_od_code"]).startswith("PYL")}
    a.check("Scope, observation period and Putrajaya asymmetry",
            len(days) == 112 and min(days) == "2026-08-01" and max(days) == "2026-11-20" and o_codes == cross_codes
            and len(o_codes) == 166 and (len(p_orig), len(p_dest)) == (34, 2),
            "Crosswalk rosters and observed station-day keys. Published destination roster is materially asymmetric.",
            source="network_station_origin_crosswalk.csv; network_station_origin_daily.parquet", actual=f"{len(days)} days, {len(o_codes)} origins, PYL {len(p_orig)}/{len(p_dest)}")
    station = {(row["lrt3_station_code"], iso(row["date"])): row["station_origin_trips"] for row in origins if row["lrt3_station_code"]}
    step1 = {(row["station_code"], iso(row["date"])): row["station_origin_trips"] for row in parquet(OUT / "lrt3_station_daily.parquet")
             if iso(row["date"]) in days}
    all_trips = sum(row["station_origin_trips"] for row in origins)
    station_ids = {item["physical_station_id"] for item in origins}
    a.check("Network and LRT3 published origins", all_trips == 71_714_309 and sum(station.values()) == 3_265_221 and
            station == step1 and len(station) == 2240,
            "Summed one reconciled published subtotal per origin date and joined all shared-period LRT3 station-days to Step 1.",
            source="network_station_origin_daily.parquet; lrt3_station_daily.parquet", actual=f"{all_trips:,}; {sum(station.values()):,}; {len(station_ids)} facilities with published origins")
    physical = defaultdict(dict)
    for row in origins:
        physical[row["physical_station_id"]].setdefault(row["canonical_origin_code"], []).append(row["station_origin_trips"])
    comparisons = sum(len(series) * (len(series) - 1) // 2 for series in physical.values())
    identical_paths = [key for key, series in physical.items() if len({tuple(x) for x in series.values()}) != len(series)]
    a.check("Separate codes at shared facilities", not identical_paths and comparisons > 0,
            "Compared full daily series within each shared facility. No exactly identical series in the window. Transaction independence remains unverified.",
            source="network_station_origin_daily.parquet; EquityAccessibility.tsx:163–178", actual=f"{comparisons} pairs, {len(identical_paths)} identical")
    quality = read_json(OUT / "data_quality_report.json")
    source_paths = read_json(OUT / "forecast_metadata.json")["headline"]["selected"]
    a.check("Selected headline and OD provenance", sha(RAW / raw_path.name) == read_json(OUT / "v1_audit_protection.json")["files"][relative(raw_path)]
            and sha(PIPE.parents[2] / source_paths["path"]) == source_paths["sha256"] and source_paths["date_max"] == "2026-10-31",
            "Fingerprint and cutoff of selected archived headline; raw OD checksum compared with independent protection baseline.",
            source="forecast_metadata.json; v1_audit_protection.json", actual=source_paths["path"])
    a.add("Whole-archive duplicate, invalid-value and incoming-A0 rederivation", "PARTIALLY VERIFIED",
          "Inspected Step 1/4B quarantine and no-addition rules. Reconciled full processed outgoing range and sampled raw detail. Incoming checksum counts and whole-archive invalidity diagnostics rely on the archived reports.",
          source="ridership.py:17–56,76–218; network_od.py:55–114; network_equity.py:100–176; data_quality_report.json")
    a.add("Journey completeness and transaction-level independence", "NOT VERIFIED",
          "The local OD dataset is aggregate and asymmetric. Internal reconciliation cannot establish underlying journey capture, transfer deduplication, or passenger uniqueness.",
          source="network_district_activity_metadata.json; EquityAccessibility.tsx:163–178")
    a.details.update(raw_rows=count, origin_days=len(keys), published_origins=len(o_codes), observation_days=len(days), network_trips=all_trips,
                     lrt3_trips=sum(station.values()), lrt3_stations=len({key for key, _ in station}), raw_samples=sample_results,
                     step1_inspected_rows=quality["rapidrail_od"]["rows"], putrajaya_origin_codes=len(p_orig), putrajaya_destination_codes=len(p_dest),
                     origin_matched_physical_facilities=len(station_ids), shared_facility_code_pairs=comparisons)


DAY_FIELDS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
DAY_TYPES = {0: "weekday", 5: "saturday", 6: "sunday"}
WINDOWS = {"all_day": (0, 24), "am_peak": (7, 9), "pm_peak": (18, 20), "off_peak": (11, 16)}


def seconds(value):
    hh, mm, ss = map(int, value.split(":"))
    return hh * 3600 + mm * 60 + ss


def archived_gtfs():
    file = next(RAW.glob("gtfs_rapid_rail_kl*.zip"))
    with ZipFile(file) as archive:
        tables = {name: list(csv.DictReader(archive.read(name + ".txt").decode("utf-8-sig").splitlines()))
                  for name in ("routes", "calendar", "trips", "frequencies", "stop_times")}
        no_exceptions = "calendar_dates.txt" not in archive.namelist()
    return tables, no_exceptions


def gtfs(a):
    tables, no_exceptions = archived_gtfs()
    trip = {r["trip_id"]: r for r in tables["trips"]}
    cal = {r["service_id"]: r for r in tables["calendar"]}
    templates = defaultdict(list)
    for r in tables["stop_times"]:
        templates[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"]))
    intervals = defaultdict(list)
    for row in tables["frequencies"]:
        r = trip[row["trip_id"]]
        cal_row = cal[r["service_id"]]
        entry = (seconds(row["start_time"]), seconds(row["end_time"]), int(row["headway_secs"]))
        for week_idx, day in DAY_TYPES.items():
            if cal_row[DAY_FIELDS[week_idx]] == "1":
                intervals[r["route_id"], day, r["direction_id"]].append(entry)
                intervals[r["route_id"], day, "both"].append(entry)

    def departures(route, day, direction, start, end):
        return sum(Fraction(max(0, min(end * 3600, hi) - max(start * 3600, lo)), headway)
                   for lo, hi, headway in intervals[route, day, direction])

    rows = list(csv_rows(OUT / "scheduled_service_summary.csv", ("direction_id",)))
    hrows = list(parquet(OUT / "scheduled_service_hourly.parquet"))
    gtfs_rows = 0
    for row in rows:
        start, end = WINDOWS[row["period"]]
        dep = departures(row["route_id"], row["day_type"], row["direction_id"], start, end)
        rate = float(dep / (end - start))
        gtfs_rows += identical(float(dep), row["reference_departures"]) and identical(rate, row["departures_per_hour"]) and (
            row["direction_id"] == "both" or not rate or identical(60 / rate, row["effective_headway_minutes"]))
    hmatches = sum(identical(float(departures(r["route_id"], r["day_type"], str(r["direction_id"]), r["service_hour"], r["service_hour"] + 1)),
                             r["reference_departures"]) for r in hrows)
    a.check("Independent terminal-frequency counts and headways", gtfs_rows == len(rows) and hmatches == len(hrows)
            and len({r["route_id"] for r in tables["routes"]}) == 8 and set(templates) == set(trip) == {r["trip_id"] for r in tables["frequencies"]},
            "Used the archived trip-to-calendar joins and exact rational interval overlap for all hours and periods. Frequency templates count terminal streams once.",
            source="gtfs_rapid_rail_kl (1).zip; scheduled_service_summary.csv; scheduled_service_hourly.parquet",
            actual=f"{gtfs_rows}/{len(rows)} periods and {hmatches}/{len(hrows)} hours", tolerance="1e-8 absolute and 1e-11 relative")
    capacities = asset("service")["capacity"]
    nominal = {day: {k: float(departures("SA", day, "both", *hours)) for k, hours in WINDOWS.items()} for day in DAY_TYPES.values()}
    places = capacities["passenger_places"]
    computed = {day: {key: dep * places for key, dep in values.items()} for day, values in nominal.items()}
    a.check("Shah Alam nominal supply", places == 624 and capacities["source_reported_seats"] == 102
            and [nominal[k]["all_day"] for k in DAY_TYPES.values()] == [229, 214, 208]
            and [computed[k]["all_day"] for k in DAY_TYPES.values()] == [142896, 133536, 129792]
            and (computed["weekday"]["am_peak"], computed["weekday"]["pm_peak"]) == (18720, 17784),
            "Raw GTFS counts multiplied by archived MRCB three-car design capacity. Physical delivered supply remains unmeasured.",
            source="capacity_metadata.json; service.json; archived frequencies.txt", actual=str(computed),
            expected="624 places, 102 seats; weekday/Sat/Sun 142,896 / 133,536 / 129,792")
    expiry = min(cal[row["service_id"]]["end_date"] for row in trip.values())
    dated = {row["date"]: row for row in asset("service")["calendar"]}
    predicted = {iso(row["date"]): row for row in parquet(OUT / "lrt3_forecast_daily.parquet") if iso(row["date"]) > "2026-11-24"}
    statuses = {when: "unavailable_no_holiday_timetable" if row["verified_holiday"]
                else "unavailable_unknown_holiday_calendar" if not row["holiday_calendar_known"]
                else "ordinary_day_GTFS_reference" if when.replace("-", "") <= expiry
                else "reference_held_beyond_GTFS_validity" for when, row in predicted.items()}
    days = Counter(statuses.values())
    a.check("Dated supply holds and holiday exclusions", no_exceptions and expiry == "20261231" and len(dated) == len(predicted) == 86 and
            all(dated[when]["supply_status"] == status for when, status in statuses.items()),
            "Calculated validity and dated status from archived GTFS calendar end and stored forecast holiday flags.",
            source="GTFS calendar.txt; lrt3_forecast_daily.parquet; service.json", actual=str(dict(days)))
    forecasts = defaultdict(dict)
    history = defaultdict(dict)
    for row in parquet(OUT / "network_service_forecast.parquet"):
        if iso(row["date"]) > "2026-11-24":
            forecasts[row["series_id"]][iso(row["date"])] = row
    for row in parquet(OUT / "network_service_history.parquet"):
        if row["in_model_calendar"] and row["actual_trips"] is not None:
            history[row["series_id"]][iso(row["date"])] = row["actual_trips"]
    intensity = list(csv_rows(OUT / "network_service_intensity.csv"))
    status_ok = True
    for row in intensity:
        if row["route_ids"] == "AG|PH":
            status_ok &= row["forecast_published_trips_per_reference_departure"] is None
            continue
        key = row["series_id"]
        dated_rows = [r for r in forecasts[key].values() if r["holiday_calendar_known"] and not r["verified_holiday"]]
        depart = lambda row: float(departures(row_route, "weekday" if row["date"].weekday() < 5 else DAY_TYPES[row["date"].weekday()], "both", 0, 24))
        row_route = row["route_ids"]
        denominator = sum(depart(r) for r in dated_rows)
        past = sorted(history[key])[-28:]
        matched = {i: mean(history[key][day] for day in past if date.fromisoformat(day).weekday() == i) for i in range(7)}
        status_ok &= all(identical(actual, expected) for actual, expected in [
            (row["reference_departures_total"], denominator),
            (row["forecast_published_trips_per_reference_departure"], sum(r["forecast_trips"] for r in dated_rows) / denominator),
            (row["recent_published_trips_per_same_reference_departure"], sum(matched[r["date"].weekday()] for r in dated_rows) / denominator),
            (row["intensity_covered_days"], len(dated_rows)),
        ])
    a.check("Published service intensity and shared-trunk withholding", status_ok,
            "Independently paired projected trips and weekday-matched historic trips to the same dated denominator for five route matches. AG/PH combined rate remains null.",
            source="network_service_intensity.csv; GTFS frequencies.txt; network_service_forecast/history.parquet")
    a.add("Train formation and actual throughput", "NOT VERIFIED", "Design capacity is supported by the archived operator-report citation. No observed formation, headways, load or throughput data were available.",
          source="capacity_metadata.json; service.json")
    a.details.update(counts=nominal, nominal_places=computed, seats=capacities["source_reported_seats"], expiry=expiry, status_days=dict(days))


def peak_proxy(a):
    data = asset("service")
    hours = defaultdict(dict)
    for row in parquet(OUT / "komuter_hourly_profiles.parquet"):
        key = row["scope"], str(row["year"]), row["day_type"]
        hours[key][row["hour"]] = row["hourly_trips"]
    calendar = {r["date"]: r for r in data["calendar"]}
    scenarios = {r["date"]: r for r in csv_rows(OUT / "lrt3_scenarios.csv")}
    selected = defaultdict(lambda: {"all": [], "ordinary": []})
    keys = set()
    errors = Counter()
    max_diff = 0
    for r in csv_rows(OUT / "lrt3_peak_sensitivity.csv", ("proxy_period",)):
        key = (r["date"], r["scenario"], r["proxy_scope"], r["proxy_period"], r["window"])
        if key in keys:
            errors["duplicate"] += 1
        keys.add(key)
        if len(keys) % 12_000 == 0:
            memory_guard()
        source_hours = hours[r["proxy_scope"], r["proxy_period"], "weekday" if r["day_type"] == "weekday" else "weekend"]
        first, last = seconds(r["window_start"]) // 3600, seconds(r["window_end_exclusive"]) // 3600
        share = sum(source_hours[h] for h in range(first, last)) / sum(source_hours.values())
        saved_ref = data["supply"][r["day_type"]][r["window"]]
        demand = scenarios[r["date"]][r["scenario"] + "_trips"] * share
        available = r["supply_status"] in ("ordinary_day_GTFS_reference", "reference_held_beyond_GTFS_validity")
        places = saved_ref * data["capacity"]["passenger_places"] if available else None
        max_diff = max(max_diff, abs(demand - r["proxy_station_origin_trips_in_window"]))
        exported = next(item for item in data["profiles"]["|".join((r["proxy_scope"], r["proxy_period"], r["day_type"]))] if item["window"] == r["window"])
        for name, left, right in (
            ("share", share, r["proxy_share"]), ("demand", demand, r["proxy_station_origin_trips_in_window"]),
            ("export_share", share, exported["share"]), ("calendar_cases", scenarios[r["date"]][r["scenario"] + "_trips"], calendar[r["date"]]["scenarios"][r["scenario"]]),
            ("supply", places, r["nominal_passenger_places_in_window"]), ("day", r["day_type"], calendar[r["date"]]["day_type"]),
        ):
            if not identical(left, right):
                errors[name] += 1
        if r["day_type"] == "weekday" and r["scenario"] == "base" and r["proxy_period"] == "combined" and r["window"] == "am_peak":
            selected[r["proxy_scope"]]["all"].append(demand)
            if available:
                selected[r["proxy_scope"]]["ordinary"].append(demand)
    a.check("Peak proxy rederivation across all keys", not errors and len(keys) == 67080,
            "Derived normalized shares from hour counts and joined daily scenario totals, day type and supply availability for every record.",
            source="komuter_hourly_profiles.parquet; lrt3_peak_sensitivity.csv; lrt3_scenarios.csv; service.json",
            expected="67,080 unique records", actual=f"{len(keys):,} records; differences {dict(errors)}; max trip error {max_diff:.3g}", tolerance="1e-8 absolute and 1e-11 relative")
    views = {scope: {group: {"mean": mean(points), "days": len(points)} for group, points in groups.items()}
             for scope, groups in selected.items()}
    a.check("Step 3 weekday Base AM references", round(views["network"]["ordinary"]["mean"]) == 8445
            and round(views["port_klang_west"]["ordinary"]["mean"]) == 11010,
            "Recomputed the published comparison using ordinary date rows eligible for reference supply.",
            source="capacity_summary.md:73–87; run_capacity.py:77–84", expected="8,445 and 11,010", actual=str(views))
    a.check("Peak chart cohort parity with paired supply", all(v["all"]["days"] == v["ordinary"]["days"] for v in views.values()),
            "The frontend helper includes every demand date while nominal supply is conditional on supported dates. Both are presented on a shared chart.",
            source="analytics.ts:71–81; tabs/ServiceReadiness.tsx:98–133", actual=str(views), issues="M3-01")
    a.add("Peak utilisation, spare capacity and occupancy", "NOT VERIFIED",
          "KTM entry-time shape is a sensitivity assumption; direction, segment and delivered supply are unavailable. Bars sharing one scale visually encourage a capacity readout.",
          source="tabs/ServiceReadiness.tsx:105–112,128–133", issues="M3-01")
    a.details.update(checked_rows=len(keys), differences=dict(errors), weekday_base_am=views, maximum_demand_difference=max_diff)


def district_key(state, district):
    names = {"ulu langat": "hulu langat", "w.p. kuala lumpur": "kuala lumpur", "w.p. putrajaya": "putrajaya"}
    text = district.strip().casefold()
    return state.strip().casefold(), names.get(text, text)


def empirical_quantile(values, p):
    ordered = sorted(values)
    step = (len(ordered) - 1) * p
    first = int(step)
    frac = step - first
    return mean([ordered[first]]) if not frac else ordered[first] * (1 - frac) + ordered[first + 1] * frac


def rings(feature):
    geometry = feature["geometry"]
    return [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]


def inside_ring(point, vertices):
    x, y = point
    crossing = 0
    for (ax, ay), (bx, by) in zip(vertices, vertices[1:]):
        if (ay <= y < by) or (by <= y < ay):
            crossing += x < (bx - ax) * (y - ay) / (by - ay) + ax
    return bool(crossing % 2)


def edge_distance(point, polygons):
    x, y = point
    mx, my = 111320 * cos(radians(y)), 110574
    best = float("inf")
    for polygon in polygons:
        for ring in polygon:
            for (ax, ay), (bx, by) in zip(ring, ring[1:]):
                ux, uy = (ax - x) * mx, (ay - y) * my
                vx, vy = (bx - ax) * mx, (by - ay) * my
                length = vx * vx + vy * vy
                fraction = min(1, max(0, -(ux * vx + uy * vy) / length)) if length else 0
                best = min(best, hypot(ux + vx * fraction, uy + vy * fraction))
    return best


def equity(a):
    ui = asset("equity")
    geo = asset("district-geography")
    backend_geo = read_json(OUT / "district_boundaries.geojson")
    geo_provenance = read_json(PIPE / "equity_inputs/boundary_sources.json")[0]
    features = {row["properties"]["district_id"]: rings(row) for row in geo["features"]}
    dists = {r["district_id"]: r for r in ui["districts"]}
    mapped = list(csv_rows(OUT / "station_district_mapping.csv", ("district_id",)))
    archived, _ = archived_gtfs()
    linked_stops = {r["stop_id"] for r in archived["stop_times"] if r["route_id"] != "BRT"}
    boxes = {key: [(min(x for x, y in p[0]), max(x for x, y in p[0]), min(y for x, y in p[0]), max(y for x, y in p[0]), p) for p in parts]
             for key, parts in features.items()}
    assignment_errors = []
    for row in mapped:
        x, y = row["longitude"], row["latitude"]
        found = {key for key, polygons in boxes.items() for xmin, xmax, ymin, ymax, p in polygons
                 if xmin <= x <= xmax and ymin <= y <= ymax and inside_ring((x, y), p[0])
                 and not any(inside_ring((x, y), hole) for hole in p[1:])}
        if found != {row["district_id"]}:
            assignment_errors.append(row["gtfs_stop_id"])
    edge_sample = sorted(mapped, key=lambda row: row["district_edge_distance_m_approx"])[:12]
    edge_check = all(abs(edge_distance((r["longitude"], r["latitude"]), features[r["district_id"]]) - r["district_edge_distance_m_approx"]) <= .051
                     for r in edge_sample)
    a.check("Eight WGS84 district geometries and independent station assignment",
            set(dists) == set(features) and len(features) == 8 and geo["features"] == backend_geo["features"]
            and geo_provenance["output_crs"] == "EPSG:4326" and not assignment_errors and linked_stops == {r["gtfs_stop_id"] for r in mapped},
            "Reperformed point-in-polygon with bounding-box prefilters and holes for every mapped stop; matched frontend polygons and archived rail stop IDs.",
            source="district_boundaries.geojson; station_district_mapping.csv; equity_inputs/boundary_sources.json", actual=f"{len(mapped)} stops; mismatches {assignment_errors}")
    a.check("Approximate district edge flags", edge_check and all((r["district_edge_distance_m_approx"] <= 100) == r["within_100m_of_district_edge"] for r in mapped),
            "Recomputed nearest segment distance for the 12 closest stops and verified each retained flag against its recorded 100 m cutoff.",
            source="station_district_mapping.csv; district_boundaries.geojson", tolerance="0.051 m for rounded source fields")
    coverage = {r["district_id"]: r for r in csv_rows(OUT / "district_rail_coverage.csv", ("district_id",))}
    od_totals, line_totals = Counter(), Counter()
    for r in parquet(OUT / "network_station_origin_daily.parquet", ["district_id", "station_origin_trips", "lrt3_station_code"]):
        od_totals[r["district_id"]] += r["station_origin_trips"]
        if r["lrt3_station_code"]:
            line_totals[r["district_id"]] += r["station_origin_trips"]
    group = defaultdict(set)
    corridor = Counter()
    for r in mapped:
        group[r["district_id"]].add(r["physical_station_id"])
        corridor[r["district_id"]] += bool(r["lrt3_station_code"])
    totals = set.union(*group.values())
    units = {(district_key(r["state"], r["district"])): k for k, r in dists.items()}
    source = {}
    for file, col in (("hh_income_district", "income_median"), ("hh_poverty_district", "poverty_absolute"), ("population_district", "population")):
        vals = {}
        population = col == "population"
        dims = ["sex", "age", "ethnicity"] if population else []
        for row in parquet(RAW / f"{file}.parquet", ["date", "state", "district", col, *dims]):
            yr = row["date"].year
            if yr not in ({2026} if population else {2022, 2024}) or (population and (row["sex"], row["age"], row["ethnicity"]) != ("both", "overall", "overall")):
                continue
            key = units.get(district_key(row["state"], row["district"]))
            if key:
                if (key, yr) in vals:
                    raise ValueError("Duplicate audited population or survey estimate")
                vals[key, yr] = int(Decimal(str(row[col])) * 1000) if population else row[col]
        source[col] = vals
    roll_ok = len(totals) == 157 and sum(map(len, group.values())) == 157 and sum(corridor.values()) == 20
    for k, r in dists.items():
        n, pop, trips, lrt = len(group[k]), source["population"][k, 2026], od_totals[k], line_totals[k]
        roll_ok &= all(identical(left, right, tol) for left, right, tol in (
            (r["population_reference_year"], 2026, 0), (r["total_population_residents"], pop, 0),
            (r["rapid_rail_physical_stations"], n, 0), (r["observed_rapid_rail_station_origin_trips"], trips, 0),
            (r["observed_lrt3_station_origin_trips_step4"], lrt, 0), (coverage[k]["lrt3_stations"], corridor[k], 0),
            (r["rapid_rail_stations_per_100k_residents"], n * 100000 / pop, .00000051),
            (coverage[k]["residents_per_station"], pop / n if n else None, .00501),
            (r["average_daily_rapid_rail_station_origin_trips"], trips / 112, .00000051),
            (r["average_daily_rapid_rail_station_origin_trips_per_physical_station"], trips / 112 / n if n else None, .00000051),
            (r["rapid_rail_station_origin_trips_per_1k_residents_period"], trips * 1000 / pop, .00000051),
            (r["share_of_published_network_station_origin_trips_pct"], trips * 100 / sum(od_totals.values()), .00000051),
            (r["lrt3_share_of_observed_district_station_origin_trips_pct"], lrt * 100 / trips if trips else None, .00000051),
        ))
    a.check("All eight district ratios and structural-zero semantics", roll_ok and
            (corridor["1008"], line_totals["1008"], corridor["1001"], line_totals["1001"]) == (11, 2391755, 9, 873466),
            "Used deduplicated physical station IDs, archived DOSM demographic totals, and summed Step 4B origin-days. Kuala Langat has zero origins and no per-station denominator.",
            source="network_station_origin_daily.parquet; raw DOSM population; district_rail_coverage.csv; equity.json",
            tolerance="Half unit at each export precision", actual=f"{len(totals)} physical stations; corridor Petaling {corridor['1008']}/{line_totals['1008']:,}, Klang {corridor['1001']}/{line_totals['1001']:,}")
    saved = defaultdict(list)
    for r in ui["screens"]:
        saved[r["scenario_id"]].append(r)
    result = {}
    for name, rows in saved.items():
        year = 2024 if name.startswith("latest") else 2022
        quantiles = (.25, .75, .25) if name.endswith("quartiles") else (.5, .5, .5)
        both = name.endswith("both")
        cohort = {k: (source["income_median"].get((k, year)), source["poverty_absolute"].get((k, year)), coverage[k]["stations_per_100k_residents"])
                  for k in dists}
        eligible = {key: vals for key, vals in cohort.items() if None not in vals}
        cutoffs = [empirical_quantile([v[i] for v in eligible.values()], p) for i, p in enumerate(quantiles)]
        flags = {}
        expected_priority = []
        checks = []
        for r in rows:
            key = r["district_id"]
            income, poverty, density = cohort[key]
            flags[key] = (income <= cutoffs[0], poverty >= cutoffs[1], density <= cutoffs[2]) if key in eligible else (None, None, None)
            low, poor, sparse = flags[key]
            flag = (((low and poor) if both else (low or poor)) and sparse) if key in eligible else None
            if flag:
                expected_priority.append(dists[key]["district"])
            checks.append(all(identical(x, y) for x, y in (
                (r["income_cutoff_myr"], cutoffs[0]), (r["poverty_cutoff_pct"], cutoffs[1]), (r["coverage_cutoff_stations_per_100k"], cutoffs[2]),
                (r["median_monthly_household_income_myr"], income), (r["absolute_poverty_households_pct"], poverty),
                (r["income_at_or_below_cutoff"], low), (r["poverty_at_or_above_cutoff"], poor), (r["coverage_at_or_below_cutoff"], sparse),
                (r["priority_for_further_investigation"], flag), (r["socioeconomic_reference_year"], year), (r["comparison_cohort_size"], len(eligible)),
            )))
        result[name] = {"year": year, "eligible": len(eligible), "cutoffs": cutoffs, "passed": len(rows) == 8 and all(checks),
                        "priorities": expected_priority, "out_of_cohort": [dists[k]["district"] for k in cohort if k not in eligible]}
    a.check("Six screening scenarios and survey cohort membership", len(result) == 6 and all(x["passed"] and
            x["eligible"] == (6 if x["year"] == 2024 else 8) and (x["year"] == 2022 or set(x["out_of_cohort"]) == {"Kuala Lumpur", "Putrajaya"})
            for x in result.values()),
            "Rebuilt each cohort from archived household datasets and derived type-7 quantiles, inclusive flags and priority classes. No OD weighting.",
            source="raw DOSM income/poverty; district_rail_coverage.csv; equity.json", tolerance="1e-8 absolute")
    a.add("External interchange identity and policy impact", "PARTIALLY VERIFIED",
          "Verified archived grouping, point assignment and policy text. Transport interchange footpaths and achieved modal share require separate evidence.",
          source="equity_geography.py:29–50; equity_metadata.json; EquityAccessibility.tsx:181–185")
    a.details.update(districts=sorted(dists), assigned_stop_records=len(mapped), physical_stations=len(totals), lrt3_stations=sum(corridor.values()),
                     district_origin_totals={dists[k]["district"]: od_totals[k] for k in dists},
                     corridor={dists[k]["district"]: {"lrt3_stations": corridor[k], "lrt3_origins": line_totals[k]} for k in ("1008", "1001")}, screening=result)
