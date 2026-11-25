"""Compute district indicators and descriptive equity screens from local inputs."""

import math
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal

import pyarrow.compute as pc
import pyarrow.parquet as pq

from equity_geography import DISTRICTS, district_key


DOSM = "https://open.dosm.gov.my/data-catalogue/"
OD_SOURCE = "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily"
POLICY = {
    "name": "Thirteenth Malaysia Plan (RMK13)",
    "target_percent": 40, "target_year": 2030, "geographical_scope": "Klang Valley",
    "indicator": "public transport modal share across modes", "status": "verified_policy_target",
    "official_faq": "https://rmk13.ekonomi.gov.my/rmk13-soalan-lazim/",
    "primary_plan": "https://rmk13.ekonomi.gov.my/wp-content/uploads/2025/07/Buku_Utama_RMK13-1.pdf",
    "plan_location": "Chapter 2, Strategy A8.3, page 2-34",
}
INDICATORS = {
    "hh_income_district": ("income_median", "nominal MYR per household per month"),
    "hh_poverty_district": ("poverty_absolute", "percent of households"),
    "population_district": ("population", "thousand residents in source; residents in exports"),
}
DEMO_TOTAL = {"sex": "both", "age": "overall", "ethnicity": "overall"}


def source_rows(raw, dataset, column, guard):
    source = pq.ParquetFile(raw / (dataset + ".parquet"))
    keys = ["state", "district", "date"]
    dimensions = list(DEMO_TOTAL) if dataset == "population_district" else []
    columns = keys + dimensions + [column]
    if not set(columns) <= set(source.schema_arrow.names):
        raise ValueError(f"Unsupported {dataset} schema: {source.schema_arrow}")
    all_nulls = Counter()
    categories = {dimension: set() for dimension in dimensions}
    years = set()
    rows = {}
    for batch in source.iter_batches(batch_size=16_384, columns=columns, use_threads=False):
        guard()
        for name in columns:
            all_nulls[name] += batch[name].null_count
        if dimensions:
            selected = None
            for dim, total in DEMO_TOTAL.items():
                categories[dim].update(pc.unique(batch[dim]).to_pylist())
                match = pc.equal(batch[dim], total)
                selected = match if selected is None else pc.and_(selected, match)
            batch = batch.filter(selected)
        for row in batch.to_pylist():
            when = row["date"]
            if not when or (when.month, when.day) != (1, 1) or not row["state"] or not row["district"]:
                raise ValueError(f"Blank or invalid annual district key in {dataset}")
            key = (*district_key(row["state"], row["district"]), when.year)
            if key in rows:
                raise ValueError(f"Duplicate demographic aggregate or socioeconomic key in {dataset}: {key}")
            value = row[column]
            if value is not None and (not math.isfinite(value) or value < 0 or (column == "poverty_absolute" and value > 100)):
                raise ValueError(f"Invalid indicator value in {dataset}: {key}")
            years.add(when.year)
            rows[key] = value
    audit = {
        "path": f"backend/data/raw/{dataset}.parquet", "catalogue": DOSM + dataset,
        "schema": {field.name: str(field.type) for field in source.schema_arrow},
        "rows_in_source": source.metadata.num_rows, "unique_annual_rows_used_for_lookup": len(rows),
        "years_in_source": sorted(years), "null_counts_in_read_columns": dict(all_nulls),
        "demographic_categories": {dim: sorted(labels, key=str) for dim, labels in categories.items()},
        "population_total_filter": DEMO_TOTAL if dimensions else None,
        "indicator_column": column, "unit": INDICATORS[dataset][1],
    }
    return rows, audit


def compute_socioeconomic(raw, reference_year, guard):
    datasets, audit = {}, {}
    for name, (column, _) in INDICATORS.items():
        datasets[column], audit[name] = source_rows(raw, name, column, guard)
    incomes = datasets["income_median"]
    poverty = datasets["poverty_absolute"]
    population = datasets["population"]

    def latest_year(dataset, key):
        return max((k[2] for k, v in dataset.items() if k[:2] == key and v is not None), default=None)

    keys = [district_key(*pair) for pair in DISTRICTS.values()]
    shared_years = set.intersection(*(
        {k[2] for k, v in incomes.items() if k[:2] == key and v is not None and poverty.get(k) is not None}
        for key in keys
    ))
    if not shared_years:
        raise ValueError("No common income and poverty survey year for the district comparison")
    common_year = max(shared_years)
    latest_survey_year = max(k[2] for k, value in incomes.items() if value is not None and poverty.get(k) is not None)
    rows = []
    for district_id, (state, district) in DISTRICTS.items():
        key = district_key(state, district)
        income_year = latest_year(incomes, key)
        poverty_year = latest_year(poverty, key)
        raw_population = population.get((*key, reference_year))
        residents = int(Decimal(str(raw_population)) * 1_000) if raw_population is not None else None
        if residents is not None and residents <= 0:
            raise ValueError(f"Population denominator must be positive for {key}")
        rows.append({"district_id": district_id, "state": state, "district": district,
                     "geographical_unit": "federal_territory_district_equivalent" if state.startswith("W.P.") else "administrative_district",
                     "median_monthly_household_income_myr": incomes.get((*key, income_year)),
                     "income_reference_year": income_year, "absolute_poverty_households_pct": poverty.get((*key, poverty_year)),
                     "poverty_reference_year": poverty_year, "total_population_residents": residents,
                     "population_reference_year": reference_year if residents is not None else None,
                     "population_source_thousands": raw_population,
                     "common_socioeconomic_reference_year": common_year,
                     "common_year_median_monthly_household_income_myr": incomes[(*key, common_year)],
                     "common_year_absolute_poverty_households_pct": poverty[(*key, common_year)],
                     "latest_survey_reference_year": latest_survey_year,
                     "latest_survey_income_available": incomes.get((*key, latest_survey_year)) is not None,
                     "latest_survey_poverty_available": poverty.get((*key, latest_survey_year)) is not None,
                     "population_availability": "available" if residents is not None else "unavailable_reference_year",
                     "income_availability": "available" if income_year else "unavailable",
                     "poverty_availability": "available" if poverty_year else "unavailable"})
    return rows, {"sources": audit, "all_scope_common_survey_year": common_year,
                  "latest_survey_year": latest_survey_year, "population_reference_year": reference_year,
                  "latest_survey_missing_district_ids": [r["district_id"] for r in rows if not (
                      r["latest_survey_income_available"] and r["latest_survey_poverty_available"])]}


def geography_columns(row):
    return {name: row[name] for name in ("district_id", "state", "district")}


def compute_coverage(socioeconomic, mapping, schedule_date):
    by_district = defaultdict(list)
    unresolved = set()
    for row in mapping:
        if row["physical_station_mapping_status"] == "mapped":
            by_district[row["district_id"]].append(row)
        elif row["physical_station_mapping_status"] != "mapped_outside_comparison_scope":
            unresolved.add(row["physical_station_id"])
    rows = []
    for s in socioeconomic:
        station_rows = by_district[s["district_id"]]
        stations = {r["physical_station_id"] for r in station_rows}
        routes = {route for r in station_rows for route in r["route_ids"].split("|")}
        mode_sets = {mode: {r["physical_station_id"] for r in station_rows if mode in r["modes"].split("|")}
                     for mode in ("LRT", "MRT", "Monorail")}
        count = len(stations) if not unresolved else None
        population = s["total_population_residents"]
        ratio = 100_000 * count / population if count is not None and population else None
        if unresolved:
            status = "unavailable_unresolved_station_mapping"
        else:
            status = "available" if count else "confirmed_zero_in_gtfs_scope"
        rows.append({**geography_columns(s), "gtfs_schedule_reference_date": schedule_date,
                     "coverage_status": status, "unique_rapid_rail_physical_stations": count,
                     "mapped_physical_stations_lower_bound": len(stations), "rapid_rail_services": len(routes) if not unresolved else None,
                     "mapped_gtfs_route_ids": "|".join(sorted(routes)) or None,
                     "lrt_stations": len(mode_sets["LRT"]) if not unresolved else None,
                     "mrt_stations": len(mode_sets["MRT"]) if not unresolved else None,
                     "monorail_stations": len(mode_sets["Monorail"]) if not unresolved else None,
                     "lrt3_stations": sum(bool(r["lrt3_station_code"]) for r in station_rows) if not unresolved else None,
                     "mapped_stop_records_within_100m_of_district_edge": sum(bool(r["within_100m_of_district_edge"]) for r in station_rows),
                     "total_population_residents": population, "population_reference_year": s["population_reference_year"],
                     "stations_per_100k_residents": round(ratio, 6) if ratio is not None else None,
                     "residents_per_station": round(population / count, 2) if population and count else None})
    mapped_count = len({r["physical_station_id"] for r in mapping if r["physical_station_mapping_status"] == "mapped"})
    if sum(r["mapped_physical_stations_lower_bound"] for r in rows) != mapped_count:
        raise ValueError("A physical station was counted across multiple districts")
    return rows, {"unresolved_physical_station_ids": sorted(unresolved), "mapped_physical_stations_in_scope": mapped_count}


def compute_activity(socioeconomic, mapping, processed, reference):
    start, end = (date.fromisoformat(reference[k]) for k in ("window_start", "data_cutoff"))
    expected_days = {start + timedelta(days=i) for i in range((end - start).days + 1)}
    if len(expected_days) != reference["observed_days"]:
        raise ValueError("Validated OD observation window is not continuous")
    station_map = {row["lrt3_station_code"]: row for row in mapping if row["lrt3_station_code"]}
    source = pq.read_table(processed / "lrt3_station_daily.parquet", use_threads=False,
                           columns=["date", "station_code", "station_origin_trips", "station_origin_status"]).to_pylist()
    daily_by_station, daily_line, station_totals = defaultdict(set), Counter(), Counter()
    pre_window_rows = 0
    for row in source:
        when = row["date"].date()
        if when < start:
            pre_window_rows += 1
            continue
        if when not in expected_days:
            continue
        code, trips = row["station_code"], row["station_origin_trips"]
        status = "observed_positive" if trips and trips > 0 else "observed_zero"
        if code not in station_map or code in daily_by_station[when] or trips is None or trips < 0 or row["station_origin_status"] != status:
            raise ValueError(f"Invalid or duplicate observed LRT3 station-day at {code} on {when}")
        daily_by_station[when].add(code)
        daily_line[when] += trips
        station_totals[code] += trips
    if daily_by_station.keys() != expected_days or any(codes != station_map.keys() for codes in daily_by_station.values()):
        raise ValueError("Expected complete LRT3 station coverage on every observation day")
    line = pq.read_table(processed / "lrt3_daily.parquet", use_threads=False,
                         columns=["date", "station_origin_trips", "in_observed_demand_window"]).to_pylist()
    expected_line = {row["date"].date(): row["station_origin_trips"] for row in line if row["in_observed_demand_window"]}
    total_line = sum(daily_line.values())
    if dict(daily_line) != expected_line or total_line != reference["trips"]:
        raise ValueError("Station-origin counts fail reconciliation with the validated line series")

    by_district = Counter()
    station_contribution = []
    unmapped_trips = 0
    for code, trips in station_totals.most_common():
        station = station_map[code]
        if station["district_id"]:
            by_district[station["district_id"]] += trips
        else:
            unmapped_trips += trips
        station_contribution.append({"station_code": code, "station_name": station["station_name"],
                                     "district_id": station["district_id"], "station_origin_trips": trips,
                                     "line_share_pct": round(100 * trips / total_line, 6) if total_line else None})
    if sum(by_district.values()) + unmapped_trips != total_line:
        raise ValueError("LRT3 district demand totals do not reconcile")
    has_mapping_gap = any(row["district_id"] is None for row in station_map.values())
    rows = []
    for s in socioeconomic:
        population = s["total_population_residents"]
        district = s["district_id"]
        trips = by_district[district] if not has_mapping_gap else None
        if has_mapping_gap:
            status = "unavailable_unresolved_lrt3_station_mapping"
        else:
            status = "available" if district in by_district else "confirmed_no_lrt3_station_in_gtfs_scope"
        rows.append({**geography_columns(s), "observation_start": start.isoformat(), "observation_end": end.isoformat(),
                     "observation_days": len(expected_days), "lrt3_activity_status": status,
                     "observed_lrt3_station_origin_trips": trips, "mapped_lrt3_station_origin_trips_lower_bound": by_district[district],
                     "average_daily_lrt3_station_origin_trips": round(trips / len(expected_days), 6) if trips is not None else None,
                     "lrt3_station_origin_trips_per_1k_residents_period": round(1_000 * trips / population, 6) if population and trips is not None else None,
                     "lrt3_share_of_line_station_origin_trips_pct": round(100 * trips / total_line, 6) if total_line and trips is not None else None,
                     "all_rapid_rail_station_origin_trips": None, "all_rapid_rail_average_daily_station_origin_trips": None,
                     "all_rapid_rail_station_origin_trips_per_1k_residents_period": None,
                     "all_rapid_rail_activity_status": "unavailable_no_validated_network_station_origin_extract",
                     "total_population_residents": population, "population_reference_year": s["population_reference_year"]})
    return rows, {"period_start": start.isoformat(), "period_end": end.isoformat(), "days": len(expected_days),
                  "lrt3_station_day_rows_reconciled": sum(map(len, daily_by_station.values())),
                  "pre_observation_station_day_rows_excluded": pre_window_rows, "line_station_origin_trips": total_line,
                  "mapped_station_origin_trips": sum(by_district.values()), "unmapped_station_origin_trips": unmapped_trips,
                  "station_contribution": station_contribution}


def quantile(values, p):
    values = sorted(values)
    position = (len(values) - 1) * p
    lower = math.floor(position)
    upper = math.ceil(position)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def compute_screen(socioeconomic, coverage, activity, common_year, latest_year):
    coverage_by_id = {r["district_id"]: r for r in coverage}
    activity_by_id = {r["district_id"]: r for r in activity}
    scenarios = [
        ("all_districts_median_either", common_year, .5, .5, .5, "either"),
        ("all_districts_median_both", common_year, .5, .5, .5, "both"),
        ("all_districts_outer_quartiles", common_year, .25, .75, .25, "either"),
        ("latest_survey_cohort_median_either", latest_year, .5, .5, .5, "either"),
        ("latest_survey_cohort_median_both", latest_year, .5, .5, .5, "both"),
        ("latest_survey_cohort_outer_quartiles", latest_year, .25, .75, .25, "either"),
    ]
    rows = []
    for scenario, year, iq, pq, cq, rule in scenarios:
        measures = {}
        for s in socioeconomic:
            district = s["district_id"]
            if scenario.startswith("all_districts"):
                income = s["common_year_median_monthly_household_income_myr"]
                poverty = s["common_year_absolute_poverty_households_pct"]
            else:
                income = s["median_monthly_household_income_myr"] if s["income_reference_year"] == year else None
                poverty = s["absolute_poverty_households_pct"] if s["poverty_reference_year"] == year else None
            measures[district] = (income, poverty, coverage_by_id[district]["stations_per_100k_residents"])
        cohort = [v for v in measures.values() if None not in v]
        cuts = tuple(quantile([m[i] for m in cohort], p) for i, p in enumerate((iq, pq, cq))) if cohort else (None, None, None)
        for s in socioeconomic:
            district = s["district_id"]
            income, poverty, density = measures[district]
            if income is None or poverty is None:
                status = "unavailable_socioeconomic_year"
            else:
                status = "available" if density is not None else "unavailable_coverage"
            eligible = status == "available"
            low_income = income <= cuts[0] if eligible else None
            high_poverty = poverty >= cuts[1] if eligible else None
            low_coverage = density <= cuts[2] if eligible else None
            vulnerable = (low_income and high_poverty if rule == "both" else low_income or high_poverty) if eligible else None
            rows.append({"scenario_id": scenario, **geography_columns(s), "screen_status": status,
                         "comparison_cohort_size": len(cohort), "socioeconomic_reference_year": year,
                         "median_monthly_household_income_myr": income, "absolute_poverty_households_pct": poverty,
                         "stations_per_100k_residents": density, "population_reference_year": s["population_reference_year"],
                         "income_lower_quantile": iq, "poverty_upper_quantile": pq, "coverage_lower_quantile": cq,
                         "income_cutoff_myr": cuts[0], "poverty_cutoff_pct": cuts[1], "coverage_cutoff_stations_per_100k": cuts[2],
                         "vulnerability_rule": rule, "income_at_or_below_cutoff": low_income,
                         "poverty_at_or_above_cutoff": high_poverty, "coverage_at_or_below_cutoff": low_coverage,
                         "relative_vulnerability_flag": vulnerable,
                         "priority_for_further_investigation": (vulnerable and low_coverage) if eligible else None,
                         "observed_lrt3_station_origin_trips": activity_by_id[district]["observed_lrt3_station_origin_trips"],
                         "lrt3_activity_status": activity_by_id[district]["lrt3_activity_status"]})
    primary = [row for row in rows if row["scenario_id"] == scenarios[0][0]]
    return primary, rows
