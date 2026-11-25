"""Write a human-readable companion to the machine-readable quality report."""

import pandas as pd

from eda import HEADLINE_DOC, KOMUTER_DOC, RAPIDRAIL_DOC, TARGET


def date(value):
    return value.strftime("%Y-%m-%d") if pd.notna(value) else "unavailable"


def number(value, decimals=0):
    return f"{value:,.{decimals}f}" if pd.notna(value) else "—"


def table(headers, rows):
    return [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
        *["| " + " | ".join(map(str, row)) + " |" for row in rows],
        "",
    ]


def period_table(periods):
    return table(
        ["Start", "End", "Days observed", "Days in period", "Observed trips", "Mean/day", "Coverage"],
        [[date(row["period_start"]), date(row["period_end"]), row["days_with_values"],
          row["calendar_days"], number(row["trip_sum_observed_days"]),
          number(row["mean_per_observed_day"], 1), "Complete" if row["complete"] else "Partial"]
         for row in periods],
    )


def write_summary(path, report, profiles):
    od = report["rapidrail_od"]
    hl = report["headline"]
    compare = report["source_comparison"]
    daily = report["lrt3_daily"]
    match = od["comparison"]
    lines = [
        "# LRT3 data validation and exploration", "",
        "## Forecast target", "",
        f"Use daily Rapid Rail trips starting at the {len(od['sa_stations'])} Shah Alam stations, "
        "summing the A0 destination count once per station. The observed demand window runs "
        f"{date(daily['first_positive_date'])} through "
        f"{date(daily['latest_structurally_reconciled_observation'])}. The opening date and "
        "the reason for earlier OD zeros remain unverified. Line boardings, incoming transfers "
        "and on-train occupancy require different measurements. "
        f"[Rapid Rail OD methodology]({RAPIDRAIL_DOC})", "",
        "## Rapid Rail OD", "",
        f"The local file has {od['rows']:,} records from {date(od['date_min'])} through "
        f"{date(od['date_max'])}. The fields are origin, destination, date and ridership. The "
        "first two are station labels, and the latter two are calendar dates and integer trip counts.", "",
        f"- Missing values by field — {', '.join(f'{k} {v:,}' for k, v in od['missing_by_column'].items())}.",
        f"- Invalid dates {od['invalid_dates']:,}, negative counts {od['negative_ridership']:,}, "
        f"duplicate OD-date keys {od['duplicate_od_keys']:,}.",
        f"- Code prefixes — {', '.join(od['all_prefixes'])}. A identifies the A0 aggregate.",
        f"- A0 as origin {od['A0_origin_rows']:,}, A0 as destination {od['A0_destination_rows']:,}, "
        f"A0 to A0 {od['A0_to_A0_rows']:,}.",
        f"- {match['matching_station_dates']:,} of {match['comparable_station_dates']:,} comparable "
        f"station-dates agree ({number(match['matching_percent_of_comparable'], 2)}%). "
        f"Missing aggregate {match['missing_aggregate_station_dates']:,}, missing itemized "
        f"{match['missing_individual_station_dates']:,}, maximum absolute gap "
        f"{number(match['max_absolute_difference'])}.", "",
        f"The per-origin destination roster uses pairs observed anywhere in the snapshot. "
        f"{match['missing_empirical_destination_rows']:,} expected rows are absent under that check. "
        "The OD tables leave unlisted pairs unfilled.", "",
        "The station and daily Parquets contain both definitions. The selected series uses A0. A "
        "daily total requires a valid count at every SA station. Status columns distinguish "
        "reported zero, null count, absent record and partial coverage.", "",
        *table(["SA code", "Rapid Rail station name"],
               [[row["station_code"], row["station_name"]] for row in od["sa_stations"]]),
        "## Shah Alam headline", "",
        f"The local rail_lrt_shah_alam date rows run {date(hl['first_source_row_date'])} through "
        f"{date(hl['last_source_row_date'])}. Numeric values span {date(hl['first_non_null_date'])} "
        f"through {date(hl['last_non_null_date'])}. Positive values span "
        f"{date(hl['first_positive_date'])} through {date(hl['last_positive_date'])}. The file has "
        f"{len(hl['zero_dates']):,} zeros, {len(hl['null_dates']):,} nulls and "
        f"{len(hl['missing_dates']):,} missing dates within its calendar. The JSON lists the dates.", "",
        f"The OD snapshot covers {len(compare['od_dates_after_headline_snapshot']):,} additional days "
        "after the last local headline row.", "",
        f"The comparison CSV contains all {compare['overlap_calendar_days']} overlapping calendar "
        "dates, both statuses, signed and absolute differences, and percentages. The primary "
        "percentage divides the headline minus OD by OD trips. A zero denominator yields a blank.", "",
        *table(["Paired subset", "Days", "Equal", "Mean gap", "Mean abs. gap", "Mean % gap vs OD", "Pearson r"],
               [[label, row["days"], row["equal_days"], number(row["mean_headline_minus_od"], 1),
                 number(row["mean_absolute_difference"], 1), number(row["mean_pct_difference_vs_od"], 2),
                 number(row["pearson_correlation"], 3)]
                for label, row in [("All numeric pairs", compare["all_numeric_pairs"]),
                                   ("Both positive", compare["both_positive"])]]),
        *table(["Date", "OD A0", "OD itemized", "Headline", "Headline − OD", "Gap / OD %", "Gap / headline %"],
               [[date(row["date"]), number(row["od_aggregate_ridership"]),
                 number(row["od_individual_ridership"]), number(row["headline_trips"]),
                 number(row["headline_minus_od"]), number(row["pct_difference_vs_od"], 2),
                 number(row["pct_difference_vs_headline"], 2)] for row in compare["dates_under_review"]]),
        f"The headline is positive on {len(compare['headline_positive_od_zero_dates'])} overlapping "
        "dates when OD records zero, and it is higher throughout August. The publisher describes "
        "separate Prasarana line attribution at interchanges and a monthly headline audit. Keep "
        "the series separate. The cause of the earlier OD zeros and the exact allocation behind "
        f"the August gaps remain unresolved. [Headline methodology]({HEADLINE_DOC})", "",
        "## Daily OD patterns", "",
        f"The post-start window has {daily['observed_window_days']} observed days, "
        f"{number(daily['observed_window_total'])} trips, and {number(daily['observed_window_mean'], 1)} "
        f"trips/day. The {daily['pre_positive_zero_days']} earlier zeros remain in the series and "
        "are excluded from post-start averages. Holidays follow their calendar weekday.", "",
        *table(["Day type", "Days", "Mean trips/day", "Trips"],
               [[kind, row["days"], number(row["mean"], 1), number(row["total"])]
                for kind, row in daily["by_day_type"].items()]),
        daily["anomaly_rule"], "",
        *table(["Date", "Day type", "Trips", "Flag", "Robust z"],
               [[date(row["date"]), row["day_type"], number(row[TARGET]),
                 row["anomaly_flag"], number(row["robust_day_type_z"], 2)] for row in daily["anomalies"]]),
        "Partial periods have fewer observed days than the full period. Their totals cover observed days.", "",
        "### Monthly", "", *period_table(daily["monthly"]),
        "### Weekly, Monday through Sunday", "", *period_table(daily["weekly"]),
        *komuter_summary(report["komuter"], profiles),
        *gtfs_summary(report["gtfs"]),
        "## Reproducibility", "",
        "The module-local README provides the execution command. The quality report records input "
        "SHA-256 checksums, runtime versions and output checks.", "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def komuter_summary(komuter, profiles):
    check = komuter["comparison_2026"]
    lines = [
        "## KTM Komuter proxy profiles", "",
        komuter["weighting"], "", komuter["inclusion"], "", komuter["hour_definition"], "",
        f"{komuter['corridor_definition']} [KTMB network map]({komuter['corridor_source']})", "",
        "These transaction-hour proxies support sensitivity analysis. LRT3 hourly demand is "
        "unmeasured in the supplied data. Coverage begins partway through 2023 and ends partway "
        f"through 2026. [Komuter OD methodology]({KOMUTER_DOC})", "",
        *table(["Snapshot", "Rows", "Trips", "First day", "Last day", "Aggregate rows", "Special endpoint trips"],
               [[name, number(row["rows"]), number(row["total_ridership"]), date(row["date_min"]),
                 date(row["date_max"]), row["aggregate_rows"], number(row["special_endpoint_ridership"])]
                for name, row in komuter["sources"].items()]),
        check["selection_reason"], "",
    ]
    if "shared_dates" in check:
        keys = check["od_hour_totals_on_shared_dates"]
        chosen = komuter["sources"][komuter["selected_by_year"]["2026"]]
        lines.extend([
            f"The 2026 snapshots share {check['shared_dates']} dates and {keys['groups_in_both']:,} "
            f"OD-hour keys. Unequal shared counts total {keys['unequal_shared_groups']:,}. "
            f"2026 profiles use {komuter['selected_by_year']['2026']} once.", "",
            *table(["Date only in one snapshot", "Format", "Rows", "Trips"],
                   [[date(row["date"]), fmt, number(row["rows"]), number(row["trips"])]
                    for fmt in ["parquet", "csv"] for row in check[f"{fmt}_only_dates"]]),
            f"The last selected 2026 date ({date(chosen['date_max'])}) has rows in "
            f"{len(chosen['last_date_hours_present'])} hourly bins. This checks hour presence only.", "",
        ])
    lines.extend([
        f"AM is {komuter['am_interval']} and PM is {komuter['pm_interval']}.", "",
        *table(["Scope", "Period", "Day type", "Covered days", "AM", "PM", "AM + PM", "Share sum"],
               [[row["scope"], row["year"], row["day_type"], row["covered_dates"],
                 f"{row['am_share']:.2%}", f"{row['pm_share']:.2%}", f"{row['am_pm_share']:.2%}",
                 f"{row['share_sum']:.6f}"] for row in komuter["peak_shares"]]),
        "Total variation is half the sum of absolute changes in hourly shares. It measures the "
        "fraction of trips redistributed across hourly bins between two profiles.", "",
        *table(["Scope", "Day type", "AM range (pp)", "PM range (pp)", "AM + PM range (pp)", "Largest yearly shift"],
               [[row["scope"], row["day_type"], f"{100 * row['am_max_minus_min']:.2f}",
                 f"{100 * row['pm_max_minus_min']:.2f}", f"{100 * row['am_pm_max_minus_min']:.2f}",
                 f"{row['largest_pairwise_shift']['total_variation']:.2%} "
                 f"({' / '.join(row['largest_pairwise_shift']['years'])})"]
                for row in komuter["stability"]]),
    ])
    for scope, subset in profiles.groupby("scope", sort=True):
        hourly = subset.pivot(index="hour", columns=["year", "day_type"], values="hourly_share")
        lines.extend([f"### Hourly shares for {scope}", "", *table(
            ["Hour", *[f"{year} {day}" for year, day in hourly.columns]],
            [[f"{hour:02}:00", *[f"{share:.2%}" for share in row]] for hour, row in hourly.iterrows()],
        )])
    return lines


def gtfs_summary(gtfs):
    sa = gtfs["shah_alam"]
    sa_rows = {
        "stops": len(sa["stops"]), "trips": len(sa["trips"]), "stop_times": sa["stop_times_rows"],
        "calendar": len(sa["calendar"] or []), "frequencies": sa["frequency_rows"],
        "calendar_dates": len(sa["calendar_dates"] or []), "routes": 1,
    }
    return [
        "## GTFS", "",
        f"{gtfs['file']} contains {len(gtfs['routes'])} routes, including SA (Shah Alam Line). "
        "The JSON includes route metadata, stop and trip records, calendar details and archive members.", "",
        *table(["Table", "Feed rows", "SA rows"],
               [[name, row["rows"] if row["present"] else "Absent",
                 sa_rows.get(name, "—") if row["present"] else "Absent"]
                for name, row in gtfs["tables"].items()]),
        f"SA direction IDs are {', '.join(sa['directions'])}, with service IDs "
        f"{', '.join(sa['service_ids'])}. OD and GTFS codes can be compared after zero-padding "
        "single-digit SA numbers. The JSON lists label differences. GTFS supplies schedule metadata.", "",
    ]
