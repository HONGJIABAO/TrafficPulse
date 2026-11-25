"""Crosswalk published OD origin codes and roll up reconciled activity."""

import math
import re
from collections import Counter, defaultdict
from itertools import combinations

import pyarrow.parquet as pq

from network_od import A0, LABEL_PATTERN, window_dates


OD_SOURCE = "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily"
MRT_BUKIT_BINTANG = "https://www.mymrt.com.my/projects/kajang-line/stations/bukit-bintang/"
MRT_BUKIT_BINTANG_ID = "https://www.mymrt.com.my/business/retail-space/"
CODE_PATTERN = re.compile(r"([A-Z]+)(\d+)([A-Z]?)")
PREFIX_ALIASES = {"PH": "SP", "KGL": "KG", "PYL": "PY"}
CODE_ALIASES = {"KG18": ("KG18A", "documented_kajang_bukit_bintang_code_suffix", MRT_BUKIT_BINTANG)}


def normalize_code(code):
    parsed = CODE_PATTERN.fullmatch(code)
    if not parsed:
        return None
    route, number, suffix = parsed.groups()
    return f"{PREFIX_ALIASES.get(route, route)}{int(number):02d}{suffix}"


def label_code(label):
    return label.split(":", 1)[0] if LABEL_PATTERN.fullmatch(label) else None


def comparable_name(name):
    return " ".join(re.sub(r"[^A-Z0-9]+", " ", name.upper()).split())


def crosswalk(mapping, audit):
    gtfs = defaultdict(list)
    for row in mapping:
        gtfs[normalize_code(row["gtfs_stop_id"])].append(row)
    origins, destinations = map(set, (audit["window_origin_labels"], audit["window_destination_labels"]))
    rows = []
    for label in sorted(origins | destinations):
        code = label_code(label)
        normalized = normalize_code(code) if code else None
        key, method, source = CODE_ALIASES.get(normalized, (normalized, "station_code_after_prefix_and_padding_normalization", "station_district_mapping.csv"))
        matches = gtfs.get(key, [])
        stop = matches[0] if len(matches) == 1 else {}
        station_name = label.split(":", 1)[-1].strip()
        if not matches:
            status = "unresolved_no_gtfs_station_code"
        elif len(matches) != 1:
            status = "unresolved_multiple_gtfs_station_codes"
        elif stop["physical_station_mapping_status"] != "mapped":
            status = "unresolved_step4_district_mapping"
        else:
            status = "mapped"
        rows.append({"crosswalk_id": "OD:" + label, "raw_od_code": code, "raw_od_label": label,
                     "published_origin": label in origins, "published_destination": label in destinations,
                     **stop_fields(stop), "canonical_origin_code": key if label in origins and status == "mapped" else None,
                     "candidate_gtfs_stop_ids": "|".join(r["gtfs_stop_id"] for r in matches) or None,
                     "mapping_status": status, "mapping_evidence": method if matches else None,
                     "od_gtfs_name_difference": (comparable_name(station_name) != comparable_name(stop["station_name"])) if stop else None,
                     "source_reference": source if matches else None})
    by_canonical = Counter(r["canonical_origin_code"] for r in rows if r["canonical_origin_code"])
    for row in rows:
        canonical = row["canonical_origin_code"]
        if canonical and by_canonical[canonical] > 1:
            row["mapping_status"] = "unresolved_multiple_od_labels_for_one_origin_code"
            row["canonical_origin_code"] = None
        if row["published_origin"] and not row["canonical_origin_code"]:
            row["canonical_origin_code"] = "unresolved:" + row["raw_od_label"]

    direct_stops = {r["gtfs_stop_id"] for r in rows if r["mapping_status"] == "mapped" and r["published_origin"]}
    physical_origin_codes = defaultdict(list)
    for row in rows:
        if row["mapping_status"] == "mapped" and row["published_origin"]:
            physical_origin_codes[row["physical_station_id"]].append(row["canonical_origin_code"])
    for stop in mapping:
        if stop["gtfs_stop_id"] in direct_stops:
            continue
        representatives = physical_origin_codes.get(stop["physical_station_id"], [])
        status = "no_separate_od_origin_physical_station_represented" if representatives else "unresolved_gtfs_physical_station_without_od_origin"
        rows.append({"crosswalk_id": "GTFS:" + stop["gtfs_stop_id"], "raw_od_code": None, "raw_od_label": None,
                     "published_origin": False, "published_destination": False, **stop_fields(stop),
                     "canonical_origin_code": None, "candidate_gtfs_stop_ids": stop["gtfs_stop_id"],
                     "mapping_status": status, "mapping_evidence": stop["station_identity_evidence"],
                     "od_gtfs_name_difference": None, "source_reference": stop["station_identity_source"]})
    for row in rows:
        row["codes_published_at_physical_station"] = "|".join(sorted(physical_origin_codes.get(row["physical_station_id"], []))) or None
    return rows


def stop_fields(stop):
    names = ("gtfs_stop_id", "station_name", "physical_station_id", "route_ids", "district_id", "state", "district",
             "lrt3_station_code", "connecting_station_group", "station_identity_evidence", "within_100m_of_district_edge")
    return {name: stop.get(name) if stop.get(name) != "NA" else None for name in names}


def reconcile(scan_rows, crosswalk_rows, first, last, processed):
    origins = {r["raw_od_label"]: r for r in crosswalk_rows if r["published_origin"]}
    rows = []
    daily_series = defaultdict(dict)
    for record in scan_rows:
        identity = origins[record["raw_origin"]]
        a0, individual = (record[k] for k in ("a0_destination_trips", "individual_destination_trips"))
        delta = a0 - individual if a0 is not None and individual is not None else None
        omitted = record["empirical_destination_roster_size"] - record["individual_destination_rows"]
        if record["has_duplicate_od_key"]:
            reconciliation = "duplicate_od_key"
        elif a0 is None or individual is None:
            reconciliation = "missing_aggregate_or_detail"
        elif omitted:
            reconciliation = "incomplete_empirical_destination_roster"
        elif delta:
            reconciliation = "aggregate_detail_disagreement"
        else:
            reconciliation = "a0_matches_complete_published_detail"
        accepted = a0 if reconciliation == "a0_matches_complete_published_detail" else None
        date = record["date"]
        code = identity["canonical_origin_code"]
        if date in daily_series[code]:
            raise ValueError(f"Duplicate canonical origin-date key for {code} on {date}")
        daily_series[code][date] = accepted
        rows.append({"date": date, "canonical_origin_code": code,
                     **{k: identity[k] for k in ("raw_od_code", "raw_od_label", "gtfs_stop_id", "physical_station_id",
                                                 "district_id", "state", "district", "lrt3_station_code", "mapping_status")},
                     "published_destination_code": identity["published_destination"],
                     **{k: v for k, v in record.items() if k not in ("date", "raw_origin")},
                     "missing_empirical_destination_rows": omitted, "a0_minus_individual_trips": delta,
                     "reconciliation_status": reconciliation, "station_origin_trips": accepted,
                     "station_origin_status": "unavailable" if accepted is None else "observed_positive" if accepted else "observed_zero"})
    expected_dates = set(window_dates(first, last))
    if any(expected_dates != series.keys() for series in daily_series.values()) or len(daily_series) != len(origins):
        raise ValueError("Canonical origin-date audit grid is incomplete")

    by_physical = defaultdict(set)
    for row in origins.values():
        if row["mapping_status"] == "mapped":
            by_physical[row["physical_station_id"]].add(row["canonical_origin_code"])
    comparisons = []
    overlap = set()
    for physical, codes in sorted(by_physical.items()):
        for a, b in combinations(sorted(codes), 2):
            pairs = [(daily_series[a][d], daily_series[b][d]) for d in expected_dates]
            matching = sum(x == y for x, y in pairs if x is not None and y is not None)
            concurrent = sum(x > 0 and y > 0 for x, y in pairs if x is not None and y is not None)
            if matching == len(expected_dates) and concurrent:
                overlap.update((a, b))
            comparisons.append({"physical_station_id": physical, "first_origin_code": a, "second_origin_code": b,
                                "dates_with_identical_totals": matching, "dates_with_both_positive": concurrent})

    for row in rows:
        row["district_allocation_status"] = "mapped_available"
        if row["canonical_origin_code"] in overlap:
            row["district_allocation_status"] = "unavailable_possible_duplicate_origin_series"
        elif row["mapping_status"] != "mapped":
            row["district_allocation_status"] = "unavailable_unresolved_station_mapping"
        elif row["station_origin_trips"] is None:
            row["district_allocation_status"] = "unavailable_origin_day_reconciliation"
    rows.sort(key=lambda row: (row["date"], row["canonical_origin_code"]))

    prior = pq.read_table(processed / "lrt3_station_daily.parquet", use_threads=False,
                          columns=["date", "station_code", "station_origin_trips"]).to_pylist()
    expected = {(r["date"].date(), r["station_code"]): r["station_origin_trips"] for r in prior if first <= r["date"].date() <= last}
    observed = {(r["date"], r["lrt3_station_code"]): r["station_origin_trips"] for r in rows if r["lrt3_station_code"]}
    if observed != expected or len(observed) != 20 * len(expected_dates) or sum(observed.values()) != 3_265_221:
        raise ValueError("Recovered LRT3 origin-date results differ from Step 1")
    audit = {
        "origin_day_rows": len(rows), "origin_codes": len(origins),
        "reconciliation_status_counts": dict(Counter(r["reconciliation_status"] for r in rows)),
        "observation_status_counts": dict(Counter(r["station_origin_status"] for r in rows)),
        "mapped_origin_count": sum(r["mapping_status"] == "mapped" for r in origins.values()),
        "unresolved_crosswalk_ids": [r["crosswalk_id"] for r in crosswalk_rows if r["mapping_status"].startswith("unresolved")],
        "shared_gtfs_stop_records_without_separate_od_origin": [r["gtfs_stop_id"] for r in crosswalk_rows if r["mapping_status"] == "no_separate_od_origin_physical_station_represented"],
        "physical_ids_with_multiple_distinct_origin_series": sorted(k for k, v in by_physical.items() if len(v) > 1),
        "diagnostic_identical_origin_series": sorted(overlap), "same_physical_station_code_comparisons": comparisons,
        "lrt3_station_days_matching_validated_step1": len(observed), "lrt3_trips_matching_validated_step1": sum(observed.values()),
    }
    return rows, audit


def number(value, cast=int):
    return cast(value) if value not in (None, "NA", "") else None


def district_activity(station_rows, crosswalk_rows, rail_rows, step4_activity, first, last):
    days = len(window_dates(first, last))
    mapped, lrt3, valid_days = Counter(), Counter(), Counter()
    represented, published_codes, missing_by_district = defaultdict(set), defaultdict(set), Counter()
    complete_by_date = defaultdict(set)
    unidentified_origins = set()
    for row in crosswalk_rows:
        if row["published_origin"]:
            if row["mapping_status"] == "mapped":
                represented[row["district_id"]].add(row["physical_station_id"])
                published_codes[row["district_id"]].add(row["canonical_origin_code"])
            else:
                unidentified_origins.add(row["canonical_origin_code"])
    for row in station_rows:
        district = row["district_id"]
        count = row["station_origin_trips"]
        if row["district_allocation_status"] == "mapped_available":
            mapped[district] += count
            valid_days[district] += 1
            complete_by_date[district, row["date"]].add(row["canonical_origin_code"])
            if row["lrt3_station_code"]:
                lrt3[district] += count
        elif district is not None:
            missing_by_district[district] += 1
    step4_lrt3 = {r["district_id"]: number(r["observed_lrt3_station_origin_trips"]) for r in step4_activity}
    if any(lrt3[district] != value for district, value in step4_lrt3.items() if value is not None):
        raise ValueError("Step 4B LRT3 district subtotals differ from Step 4")

    accepted_total = sum(r["station_origin_trips"] or 0 for r in station_rows)
    mapped_total = sum(mapped.values())
    if mapped_total > accepted_total:
        raise ValueError("District totals exceed accepted published origin totals")
    rail_ids = {r["district_id"] for r in rail_rows}
    if set(mapped) - rail_ids:
        raise ValueError("An allocated origin falls outside the declared district scope")
    expected_origins = len({r["canonical_origin_code"] for r in station_rows})
    source_complete = len(station_rows) == expected_origins * days and all(r["station_origin_trips"] is not None for r in station_rows)
    network_exact = source_complete and accepted_total == mapped_total and not unidentified_origins and not missing_by_district and all(
        number(r["unique_rapid_rail_physical_stations"]) == len(represented[r["district_id"]]) for r in rail_rows
    )

    def divide(numerator, denominator, factor=1):
        return round(factor * numerator / denominator, 6) if numerator is not None and denominator else None

    result = []
    for rail in rail_rows:
        district = rail["district_id"]
        count = number(rail["unique_rapid_rail_physical_stations"])
        covered = len(represented[district])
        residents = number(rail["total_population_residents"])
        if unidentified_origins or covered != count or missing_by_district[district]:
            status = "partial_mapped_lower_bound_only"
        else:
            status = "available_observed_snapshot" if count else "confirmed_zero_no_rapid_rail_station_in_scope"
        trips = mapped[district] if status != "partial_mapped_lower_bound_only" else None
        result.append({"district_id": district, "state": rail["state"], "district": rail["district"],
                       "observation_start": first.isoformat(), "observation_end": last.isoformat(), "observation_days": days,
                       "district_activity_status": status,
                       "od_capture_completeness": "unverified_destination_roster_asymmetry",
                       "rapid_rail_physical_stations": count, "physical_stations_with_mapped_od_origin": covered,
                       "mapped_published_origin_codes": len(published_codes[district]),
                       "mapped_reconciled_origin_days": valid_days[district],
                       "expected_mapped_origin_days": days * len(published_codes[district]),
                       "days_with_all_mapped_origin_codes_reconciled": sum(
                           complete_by_date[district, d] == published_codes[district] for d in window_dates(first, last)
                       ),
                       "observed_rapid_rail_station_origin_trips": trips, "mapped_station_origin_trips_lower_bound": mapped[district],
                       "average_daily_rapid_rail_station_origin_trips": divide(trips, days),
                       "share_of_published_network_station_origin_trips_pct": divide(trips, accepted_total, 100) if network_exact else None,
                       "rapid_rail_station_origin_trips_per_1k_residents_period": divide(trips, residents, 1_000),
                       "rapid_rail_station_origin_trips_per_physical_station_period": divide(trips, count),
                       "average_daily_rapid_rail_station_origin_trips_per_physical_station": divide(trips, count * days if count else None),
                       "observed_lrt3_station_origin_trips_step4": step4_lrt3[district],
                       "lrt3_share_of_observed_district_station_origin_trips_pct": divide(step4_lrt3[district], trips, 100),
                       "total_population_residents": residents, "population_reference_year": number(rail["population_reference_year"])})
    if network_exact and sum(r["observed_rapid_rail_station_origin_trips"] for r in result) != accepted_total:
        raise ValueError("Published station totals fail district reconciliation")
    shares = [r["share_of_published_network_station_origin_trips_pct"] for r in result]
    if network_exact and accepted_total and not math.isclose(sum(shares), 100, abs_tol=0.00001):
        raise ValueError("Network shares do not sum to 100 percent")
    return result, {"published_origin_trips_reconciled": accepted_total, "district_trips_allocated": mapped_total,
                    "trips_unallocated_or_possible_overlap": accepted_total - mapped_total,
                    "published_origin_codes_all_days_reconciled": source_complete,
                    "district_rollup_complete_for_published_snapshot": network_exact,
                    "gtfs_physical_stations_represented": sum(map(len, represented.values()))}


def equity_comparison(demand, socioeconomic, rail, screening):
    cohort = {r["district_id"]: r for r in screening}
    social = {r["district_id"]: r for r in socioeconomic}
    coverage = {r["district_id"]: r for r in rail}
    rows = []
    for record in demand:
        district = record["district_id"]
        pop, screen = social[district], cohort[district]
        if number(screen["population_reference_year"]) != record["population_reference_year"]:
            raise ValueError("Population vintage differs between demand and Step 4 screening")
        if number(pop["total_population_residents"]) != record["total_population_residents"]:
            raise ValueError("Population differs between demand and Step 4 socioeconomic outputs")
        rows.append({**record, "latest_median_monthly_household_income_myr": number(pop["median_monthly_household_income_myr"]),
                     "latest_income_reference_year": number(pop["income_reference_year"]),
                     "latest_absolute_poverty_households_pct": number(pop["absolute_poverty_households_pct"], float),
                     "latest_poverty_reference_year": number(pop["poverty_reference_year"]),
                     "rapid_rail_stations_per_100k_residents": number(coverage[district]["stations_per_100k_residents"], float),
                     "step4_scenario_id": screen["scenario_id"], "step4_screen_status": screen["screen_status"],
                     "step4_socioeconomic_reference_year": number(screen["socioeconomic_reference_year"]),
                     "step4_median_monthly_household_income_myr": number(screen["median_monthly_household_income_myr"]),
                     "step4_absolute_poverty_households_pct": number(screen["absolute_poverty_households_pct"], float),
                     "step4_low_coverage_flag": screen["coverage_at_or_below_cutoff"],
                     "step4_relative_vulnerability_flag": screen["relative_vulnerability_flag"],
                     "step4_priority_for_further_investigation": screen["priority_for_further_investigation"]})
    return rows
