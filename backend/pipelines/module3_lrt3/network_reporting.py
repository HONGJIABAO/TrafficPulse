"""Publish the scope, evidence and equity interpretation of the OD rollup."""

from statistics import median

from network_equity import CODE_ALIASES, MRT_BUKIT_BINTANG_ID, OD_SOURCE, PREFIX_ALIASES


SOURCE_LIMITS = [
    "Observed counts describe trips published in this local tap-in/tap-out OD snapshot. Source-internal reconciliation is exact where reported and does not establish capture of every underlying journey.",
    "Destination coverage is asymmetric. The published destination roster has substantially fewer Putrajaya Line codes than the origin roster. An absent OD pair is outside the observed roster, with no zero or trip estimate assigned.",
    "Separate source origin codes at the same physical facility remain separate categories of published activity. The diagnostic checks for identical daily series. Transaction-level evidence would be needed to test partial overlap or transfer counting.",
    "KTM, ERL, BRT and other modes are outside the Rapid Rail scope. Station-origin trips can include travellers from other districts, repeated trips by one person and transfers recorded by the source.",
    "Per-resident figures scale origins by district population. Per-station figures are district averages over physical facilities. Neither metric measures congestion, walking access, resident modal share or unmet demand.",
    "The district boundaries and station point assignments are inherited from Step 4, including the near-boundary flags. The original equity rules and flags remain the basis for comparison.",
]
MISSING_DETAIL = {
    "status": "observed_snapshot_available; underlying_capture_completeness_unverified",
    "needed_to_verify_broader_capture": "Publisher documentation of why certain destination station codes are absent, or an authoritative corrected 112-day OD extract with date, origin and destination codes, nonnegative trip counts and explicit missing/zero status, plus a station and gate codebook to verify coverage and shared-facility categories.",
}


def build_reports(scan, origin, rollup, equity, input_hashes, schemas, baseline):
    first, last, days = (scan[k] for k in ("window_first_date", "window_last_date", "window_days"))
    origin_only = sorted(set(scan["window_origin_labels"]) - set(scan["window_destination_labels"]))
    validated_baseline = len(baseline["file_hashes"])
    reported_total = rollup["published_origin_trips_reconciled"]
    coverage = rollup["gtfs_physical_stations_represented"]
    lrt3_total = origin["lrt3_trips_matching_validated_step1"]
    mapped = rollup["district_rollup_complete_for_published_snapshot"]
    levels = [r["average_daily_rapid_rail_station_origin_trips_per_physical_station"] for r in equity
              if r["average_daily_rapid_rail_station_origin_trips_per_physical_station"] is not None]
    station_rate_median = median(levels) if levels else None
    metadata = {
        "analysis": "TrafficPulse Module 3 Step 4B supplemental network district activity",
        "source": {"publisher": "Prasarana Malaysia and Ministry of Transport via data.gov.my", "catalogue": OD_SOURCE,
                   "local_path": "backend/data/raw/rapidrail_2026_daily.csv", "input_hashes": input_hashes},
        "observation_period": {"start": first, "end": last, "days": days, "inclusive": True, "timezone": "Asia/Kuala_Lumpur"},
        "scope": {"geography": "The eight Step 4 district-equivalent administrative units. See district_boundaries.geojson.",
                  "mode": "GTFS Rapid Rail LRT, MRT and Monorail", "population_reference_year": 2026,
                  "survey_reference_year_for_equity_flag": 2022},
        "aggregation": {"method": "Select a single destination A0 for each published origin and day when its unique present detail records cover its entire published destination roster and sum exactly to that subtotal. A0 origin records serve as a separate incoming check; neither type of aggregate is added to detail records.",
                        "missing_and_zero": "An unavailable origin-day has a null value. A reconciled A0 and detail sum of zero is observed zero. A district with zero network facilities and no allocation uncertainty has structural zero. A zero-station ratio uses NA.",
                        "discrepancy_rule": "Missing, duplicate, incomplete or disagreeing source rows withhold that origin-day from district ranks and exact totals. Preserve diagnostic sums and the safe mapped lower bound.",
                        "unit": "Published tap-in/tap-out station-origin trips; repeated trips by one passenger can be counted separately",
                        "headline_relation": "Headline service totals use a different measurement definition and were not used for calibration."},
        "scan": {**scan, "origin_only_labels": origin_only},
        "crosswalk": {"prefix_aliases": PREFIX_ALIASES, "format": "Canonical stop prefixes plus zero-padded numeric code and suffix.",
                      "code_suffix_aliases": CODE_ALIASES, "bukit_bintang_corroboration": MRT_BUKIT_BINTANG_ID,
                      "station_grouping_source": "station_district_mapping.csv", **origin},
        "district_rollup": {**rollup, "network_share_denominator": "All reconciled trips of published network origin codes when fully allocated.",
                            "lrt3_share_denominator": "All published station-origin trips allocated to the district over the same period.",
                            "descriptive_median_daily_trips_per_station_among_districts_with_stations": station_rate_median},
        "equity": {"flags_source": "equity_priority_screening.csv", "demand_role": "Contextual evidence presented alongside the unchanged Step 4 screening rules and flags.",
                   "priority_district_ids": [r["district_id"] for r in equity if r["step4_priority_for_further_investigation"] == "true"]},
        "limitations": SOURCE_LIMITS, "missing_data": MISSING_DETAIL,
        "dashboard": {"district_key": "district_id (string)", "station_origin_key": ["date", "canonical_origin_code"],
                      "physical_station_key": "physical_station_id", "csv_missing_value": "NA", "schemas": schemas},
        "validation": {"a0_origin_aggregate_rows_excluded_from_station_activity": True,
                       "station_origin_date_key_unique_and_complete_grid": True,
                       "lrt3_step1_origin_days_and_step4_districts_reconciled": True,
                       "all_supported_district_rollups_reconciled": mapped,
                       "prior_outputs_checksummed": baseline["prior_processed_outputs"],
                       "step4_primary_outputs_and_geojson_checksummed": len(baseline["validated_step4_outputs"]),
                       "all_baseline_files_to_recheck": validated_baseline},
        "execution_progress": "network_activity_progress.jsonl",
    }

    def fmt(value, digits=0):
        if value is None:
            return "NA"
        return f"{value:,.{digits}f}"

    summary = [
        "# Step 4B · Network-wide district station-origin activity", "",
        f"The local Rapid Rail OD snapshot provides {fmt(reported_total)} reconciled published origin trips over {days} days, from {first} through {last}. "
        f"Districts account for {fmt(rollup['district_trips_allocated'])} of those trips, and the OD origins represent {coverage} physical stations. "
        f"The LRT3 subtotal remains {fmt(lrt3_total)} trips. [Official Rapid Rail OD catalogue]({OD_SOURCE})", "",
        "## Source reconciliation and boundaries", "",
        f"The scan checked {scan['snapshot_rows']:,} raw rows, including {scan['window_rows']:,} rows inside the period. "
        f"It matched {origin['reconciliation_status_counts'].get('a0_matches_complete_published_detail', 0):,} destination A0 subtotals to individual destination sums. "
        f"A separate check matched {scan['incoming_a0_matching_days']:,} of {scan['incoming_a0_compared_days']:,} A0 origin subtotals to their detailed incoming counts. "
        "Only reconciled destination A0 records contributed to station activity.", "",
        f"The crosswalk maps {origin['mapped_origin_count']} of {origin['origin_codes']} published origin codes. "
        f"There are {len(origin['unresolved_crosswalk_ids'])} unresolved crosswalk rows. "
        f"{len(origin['shared_gtfs_stop_records_without_separate_od_origin'])} GTFS stop records have no separate published origin code but belong to a physical station represented by another code. "
        f"The diagnostic compared {len(origin['same_physical_station_code_comparisons'])} same-facility code pairs; {len(origin['diagnostic_identical_origin_series'])} origin series were flagged as identical. "
        "Published origin codes remain separate, while physical stations are deduplicated for denominator calculations.", "",
        f"The source contains {len(scan['window_destination_labels'])} destination codes and {len(origin_only)} origin-only codes. "
        f"The Putrajaya Line has {scan['origin_prefix_counts'].get('PYL', 0)} origin codes and {scan['destination_prefix_counts'].get('PYL', 0)} destination codes. "
        "This limits claims about underlying trip capture, even where every published subtotal reconciles.", "",
        "## District activity and equity context", "",
        "| District | Physical stations | Published origin trips | Share of published network (%) | Daily origins per station | Step 4 priority |",
        "| --- | ---: | ---: | ---: | ---: | --- |",
    ]
    for r in equity:
        summary.append(f"| {r['district']} | {fmt(r['rapid_rail_physical_stations'])} | {fmt(r['observed_rapid_rail_station_origin_trips'])} | "
                       f"{fmt(r['share_of_published_network_station_origin_trips_pct'], 2)} | "
                       f"{fmt(r['average_daily_rapid_rail_station_origin_trips_per_physical_station'])} | "
                       f"{r['step4_priority_for_further_investigation']} |")
    by_code = {r["district_id"]: r for r in equity}
    gombak, klang, putrajaya = (by_code[key] for key in ("1009", "1001", "1601"))
    summary.extend(["", f"Gombak pairs {fmt(gombak['rapid_rail_physical_stations'])} physical stations and 2022 absolute poverty of "
                    f"{fmt(gombak['step4_absolute_poverty_households_pct'], 1)}% with {fmt(gombak['observed_rapid_rail_station_origin_trips'])} published origins. "
                    f"Its {fmt(gombak['average_daily_rapid_rail_station_origin_trips_per_physical_station'])} daily origins per station compare with a median of "
                    f"{fmt(station_rate_median)} among districts with reported per-station activity.", "",
                    f"Klang's {fmt(klang['observed_rapid_rail_station_origin_trips'])} observed origins all come from the Shah Alam Line in this snapshot. "
                    f"Its {fmt(klang['average_daily_rapid_rail_station_origin_trips_per_physical_station'])} daily origins per station are below that district median. "
                    f"Putrajaya has {fmt(putrajaya['observed_rapid_rail_station_origin_trips'])} reported origins at one physical station, with the Putrajaya Line destination omission limiting interpretation. "
                    "Kuala Langat's structural zero is for Rapid Rail stations within the district boundary.", "",
                    "## Interpretation and missing information", ""])
    summary.extend(f"- {line}" for line in SOURCE_LIMITS)
    summary.extend(["", MISSING_DETAIL["needed_to_verify_broader_capture"], "",
                    "Join dashboard files on `district_id`. The daily Parquet uses `(date, canonical_origin_code)` and the CSVs use `NA` for unavailable values. "
                    "The metadata includes destination coverage, crosswalk exceptions, aggregate checks and import schemas.", ""])
    return metadata, "\n".join(summary)
