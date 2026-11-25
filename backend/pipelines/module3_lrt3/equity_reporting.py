"""Describe findings and expose their definitions for dashboard consumers."""

from collections import defaultdict

from equity_analysis import OD_SOURCE, POLICY
from equity_geography import DISTRICTS, RAIL_OPERATOR, SCOPE_SOURCE


ALL_RAIL_REQUIREMENT = {
    "dataset": "Validated Rapid Rail station-origin daily extract for all seven rail routes",
    "coverage": "All Rapid Rail physical stations on AG, PH, KJ, KGL, PYL, MR and SA across the eight comparison units",
    "period": "The same inclusive observation dates as the LRT3 extract for a comparable district rollup",
    "format_and_fields": "CSV or Parquet with service date in Asia/Kuala_Lumpur, canonical origin stop code, observed origin trips, and observation status; a route/stop crosswalk for codes differing from GTFS",
    "aggregation_evidence": "Confirm treatment of shared trunks, interchanges, missing records, true zeros and any OD aggregate rows before summation",
    "source": OD_SOURCE,
}
LIMITATIONS = [
    "Station densities count GTFS-linked infrastructure divided by whole-district residents. Station footprints, walking distance, first- and last-mile connections, feeder bus coverage and frequency, fare affordability, and passenger residential locations were unmeasured.",
    "A station-origin trip is attributed to the origin station's district. Transfers and travel across district boundaries prevent treating these trips as resident travel behaviour.",
    "Coverage is specific to Rapid Rail LRT, MRT and Monorail in the local timetable. KTM, ERL, BRT, planned stations, and other bus services are outside these counts.",
    "Station point assignments are conditional on this GTFS feed and the dates and precision of the recovered boundary snapshot. Close-to-edge stop coordinates warrant care in district interpretation.",
    "Household survey point estimates and whole-district aggregates can mask pockets of vulnerability within station catchments. Sampling uncertainty is unavailable in the supplied extracts.",
    "A district screening flag is a descriptive priority for follow-up. Evidence of unmet demand would require catchment, access and household travel information.",
]


def build_reporting(socio, mapping, coverage, activity, screen, provenance, input_info, schemas):
    sr, sa = socio["rows"], socio["audit"]
    cr, ca = coverage["rows"], coverage["audit"]
    dr, da = activity["rows"], activity["audit"]
    ma = mapping["audit"]
    primary, sensitivity = screen["primary"], screen["sensitivity"]
    labels = {code: name for code, (_, name) in DISTRICTS.items()}
    scenarios = defaultdict(list)
    for row in sensitivity:
        scenarios[row["scenario_id"]].append(row)
    scenario_audit = {}
    for name, rows in scenarios.items():
        first = rows[0]
        scenario_audit[name] = {
            key: first[key] for key in ("comparison_cohort_size", "socioeconomic_reference_year", "vulnerability_rule",
                                        "income_cutoff_myr", "poverty_cutoff_pct", "coverage_cutoff_stations_per_100k")
        }
        scenario_audit[name]["priority_district_ids"] = [r["district_id"] for r in rows if r["priority_for_further_investigation"]]
        scenario_audit[name]["unavailable_district_ids"] = [r["district_id"] for r in rows if r["screen_status"] != "available"]

    metadata = {
        "analysis": "TrafficPulse Module 3 Step 4 equity, accessibility and Rapid Rail coverage",
        "geography": {
            "definition": "Eight whole administrative units used as a district proxy for districts referenced in the PLANMalaysia National Conurbation glossary. The planning extent encompasses parts of Selangor; whole districts enable consistent joins and denominators.",
            "source": SCOPE_SOURCE, "districts": {code: {"state": state, "district": name} for code, (state, name) in DISTRICTS.items()},
            "excluded_selangor_districts": ["Hulu Selangor", "Kuala Selangor", "Sabak Bernam"],
            "join_aliases": {"Ulu Langat": "Hulu Langat", "W.P. Kuala Lumpur": "Kuala Lumpur as district label", "W.P. Putrajaya": "Putrajaya as district label"},
            "boundary_provenance": provenance, "geojson_crs": "WGS84 longitude/latitude (EPSG:4326)",
        },
        "socioeconomic": sa,
        "station_mapping": {**ma, "operator_reference": RAIL_OPERATOR,
                            "point_assignment": "One unambiguous polygon interior contains the GTFS point; touching or overlapping matches are unresolved.",
                            "physical_station_definition": "Shared trunk records and documented integrated interchange facilities are grouped. Separate structures connected by public walks retain separate station IDs.",
                            "boundary_quality": "Distance is approximate, measured from the GTFS point to the assigned polygon edge. The 100 m flag is for review and does not change exact point assignments."},
        "coverage": {**ca, "unit": "Unique stations, route IDs, residents and stations per 100,000 residents",
                     "schedule_reference_date": cr[0]["gtfs_schedule_reference_date"],
                     "mode_count_rule": "Mode counts can overlap for a station served by several modes. LRT3 counts are included in LRT. Ampang and Sri Petaling are separate routes using common physical stops.",
                     "zero_rule": "Zero means no mapped facilities within the complete snapshot scope. Residents per station is unavailable for zero stations. Unknown exact coverage retains a mapped lower bound."},
        "activity": {**da, "source": OD_SOURCE, "processed_source": "lrt3_station_daily.parquet",
                     "unit": "Observed station-origin OD trips", "ratio_unit": "Period station-origin trips per 1,000 district residents",
                     "network_activity_availability": "unavailable_no_validated_network_station_origin_extract", "missing_network_input": ALL_RAIL_REQUIREMENT,
                     "forecast_allocation": "No forecast inputs or allocations were used."},
        "screening": {"primary_scenario_id": primary[0]["scenario_id"], "scenarios": scenario_audit,
                      "method": "Use the latest common survey year for all eight units and repeat for the newest locally available survey cohort. Linear unweighted district quantiles use inclusive comparisons. A priority requires low station density and the specified either/both household vulnerability condition. Observed LRT3 activity is contextual evidence only."},
        "policy": POLICY,
        "limitations": LIMITATIONS,
        "availability": {"district_boundaries": "available", "lrt3_station_origin_activity": "see district_demand_activity.csv statuses",
                         "measured_accessibility": "unavailable", "observed_modal_share": "unavailable",
                         "whole_network_district_station_origin_activity": "unavailable",
                         "source_for_exact_all_network_activity": ALL_RAIL_REQUIREMENT},
        "dashboard_contract": {"join_key": "district_id (string)", "csv_missing_value": "NA", "boolean_encoding": ["true", "false", "NA"],
                               "output_schemas": schemas},
        "input_fingerprints": input_info,
        "validation": {
            "unique_eight_district_ids_and_state_district_keys": len({(r["state"], r["district"]) for r in sr}) == len(sr) == len(DISTRICTS),
            "population_uses_unique_demographic_totals": sa["sources"]["population_district"]["population_total_filter"] is not None,
            "reconciled_lrt3_station_days_and_line_trips": da["lrt3_station_day_rows_reconciled"] == da["days"] * len(ma["lrt3_station_codes"]),
            "all_lrt3_trips_geocoded": da["unmapped_station_origin_trips"] == 0,
            "all_rail_physical_stations_mapped": not ca["unresolved_physical_station_ids"],
        },
    }

    def fmt(value, decimals=2):
        if value is None:
            return "NA"
        if isinstance(value, int):
            return f"{value:,}"
        return f"{value:,.{decimals}f}"

    def districts_text(ids):
        return ", ".join(labels[code] for code in ids) if ids else "None"

    summary = [
        "# Module 3 Step 4 · District equity and Rapid Rail coverage", "",
        f"The comparison covers {len(sr)} administrative units and the Rapid Rail reference feed dated {cr[0]['gtfs_schedule_reference_date']}. "
        f"LRT3 activity covers the {da['days']} inclusive dates from {da['period_start']} to {da['period_end']}.", "",
        "## Socioeconomic and geographical scope", "",
        "The district proxy covers Klang, Kuala Langat, Hulu Langat, Petaling, Gombak and Sepang in Selangor, plus the federal territories of Kuala Lumpur and Putrajaya as district equivalents. Whole districts are used because the DOSM datasets provide district totals. "
        f"[PLANMalaysia National Conurbation glossary]({SCOPE_SOURCE})", "",
        f"The latest locally available income and poverty reference year is {sa['latest_survey_year']} for six Selangor units. The two federal territories have {sa['all_scope_common_survey_year']} as their most recent local survey year. "
        f"The primary comparison uses {sa['all_scope_common_survey_year']} for every district and the station-density and activity denominators use {sa['population_reference_year']} population estimates. "
        "Population uses the `both / overall / overall` aggregate once per district and year and converts thousands of residents to residents.", "",
        "| District | Latest median income (RM/month) | Latest absolute poverty (% households) | Survey year | Residents | Physical Rapid Rail stations | Rapid Rail stations / 100k | LRT3 stations | LRT3 origin trips |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for s, c, d in zip(sr, cr, dr, strict=True):
        year = str(s["income_reference_year"]) if s["income_reference_year"] == s["poverty_reference_year"] else f"{s['income_reference_year']} / {s['poverty_reference_year']}"
        summary.append(f"| {s['district']} | {fmt(s['median_monthly_household_income_myr'])} | {fmt(s['absolute_poverty_households_pct'], 1)} | {year} | "
                       f"{fmt(s['total_population_residents'])} | {fmt(c['unique_rapid_rail_physical_stations'])} | {fmt(c['stations_per_100k_residents'])} | "
                       f"{fmt(c['lrt3_stations'])} | {fmt(d['observed_lrt3_station_origin_trips'])} |")

    summary.extend(["", "## Infrastructure and observed activity", "",
                    f"The GTFS stop times contain {ma['feed_rail_stop_records']} rail stop records. Documented shared stations and integrated facilities yield {ma['unique_physical_station_ids']} physical station IDs. "
                    f"Of these, {ca['mapped_physical_stations_in_scope']} map to the eight comparison districts. "
                    f"The audit flags {len(ma['within_edge_threshold'])} stop records within {ma['edge_review_threshold_metres']} metres of a district edge.", "",
                    f"The station-day records sum to {da['line_station_origin_trips']:,} LRT3 station-origin trips, matching the prior validated daily series. "
                    f"{da['unmapped_station_origin_trips']:,} trips have unresolved station geography. The five highest-volume station origins are shown below.", "",
                    "| Station | District | Period trips | Share of LRT3 (%) |", "|---|---|---:|---:|"])
    for row in da["station_contribution"][:5]:
        summary.append(f"| {row['station_name']} ({row['station_code']}) | {labels.get(row['district_id'], 'NA')} | "
                       f"{row['station_origin_trips']:,} | {fmt(row['line_share_pct'])} |")

    for row in dr:
        if row["observed_lrt3_station_origin_trips"]:
            summary.extend(["", f"{row['district']} accounted for {fmt(row['lrt3_share_of_line_station_origin_trips_pct'])}% of observed LRT3 station origins, "
                                 f"averaging {fmt(row['average_daily_lrt3_station_origin_trips'])} per day and "
                                 f"{fmt(row['lrt3_station_origin_trips_per_1k_residents_period'])} per 1,000 district residents across the observation period."])

    summary.extend(["", "## Equity screen and sensitivity", "",
                    "Low coverage means station density at or below the scenario cut-off. Relative vulnerability uses low median household income and high absolute poverty with the stated either or both rule. "
                    "Quantiles are linear, computed across complete districts, and inclusive at ties. Activity is shown alongside the flags and does not determine them.", "",
                    "| Survey | Cohort | Rule | Income ≤ RM | Poverty ≥ % | Stations / 100k ≤ | Priorities |", "|---:|---:|---|---:|---:|---:|---|"])
    for name, group in scenario_audit.items():
        rule = ("Outer quartiles, " if "quartiles" in name else "Medians, ") + group["vulnerability_rule"]
        summary.append(f"| {group['socioeconomic_reference_year']} | {group['comparison_cohort_size']} | {rule} | "
                       f"{fmt(group['income_cutoff_myr'])} | {fmt(group['poverty_cutoff_pct'])} | {fmt(group['coverage_cutoff_stations_per_100k'])} | "
                       f"{districts_text(group['priority_district_ids'])} |")

    corridor = [r for r in cr if r["lrt3_stations"]]
    corridor_activity = [r for r in dr if r["observed_lrt3_station_origin_trips"]]
    summary.extend(["", "## Competition findings and interpretation", ""])
    if corridor:
        summary.append(f"The Shah Alam Line is represented in {districts_text([r['district_id'] for r in corridor])}. Its presence alone does not account for the full network coverage gap between the districts.")
    for record in corridor_activity:
        key = record["district_id"]
        econ = next(r for r in sr if r["district_id"] == key)
        rail = next(r for r in cr if r["district_id"] == key)
        summary.extend(["", f"{record['district']} combines a latest local median income of RM{fmt(econ['median_monthly_household_income_myr'])}, "
                             f"absolute poverty of {fmt(econ['absolute_poverty_households_pct'], 1)}%, station density of {fmt(rail['stations_per_100k_residents'])} per 100,000, "
                             f"and {fmt(record['lrt3_share_of_line_station_origin_trips_pct'])}% of observed LRT3 station origins. All-network district activity remains unavailable."])

    summary.extend(["", "## Policy, limitations and data gap", "",
                    f"RMK13 sets a {POLICY['target_percent']}% public transport modal share target for the Klang Valley by {POLICY['target_year']}. "
                    f"Estimating achieved modal share would require trip counts across transport modes. [Official RMK13 FAQ]({POLICY['official_faq']}) · [RMK13 main plan, p. 2-34]({POLICY['primary_plan']})", ""])
    summary.extend(f"- {item}" for item in LIMITATIONS)
    summary.extend(["", "The remaining coverage gap concerns trips on the other six rail routes. For an all-network district activity table, provide a validated station-origin daily CSV or Parquet for the seven routes over the observation dates above, including service date, canonical origin code, count, observation status, and a GTFS crosswalk when IDs differ. "
                    f"[Official OD catalogue]({OD_SOURCE})", "",
                    "The CSVs use `district_id` for joins, `NA` for unavailable fields, and numeric zero only within documented evidence scope. Station rows join to district polygons by `district_id` and to LRT3 activity by `lrt3_station_code`.", ""])
    return metadata, "\n".join(summary)
