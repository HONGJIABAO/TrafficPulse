"""Compare Komuter source snapshots and build transaction-hour proxy profiles."""

from itertools import combinations

import pandas as pd
import pyarrow.parquet as pq

from ridership import dates_between, valid_counts


KTM_COLUMNS = ["date", "time", "origin", "destination", "ridership"]
KTM_KEYS = ["date", "hour", "origin", "destination"]
SPECIAL_ENDPOINTS = {"Penalty", "Unknown"}
AGGREGATE_PATTERN = r"(?i)^(?:A0(?::.*)?|all(?:\s+stations?)?|(?:grand\s+)?totals?|systemwide|networkwide)$"
PORT_KLANG_WEST = (
    "Abdullah Hukum", "Angkasapuri", "Pantai Dalam", "Petaling", "Jalan Templer",
    "Kampung Dato Harun", "Seri Setia", "Setia Jaya", "Subang Jaya", "Batu Tiga",
    "Shah Alam", "Padang Jawa", "Bukit Badak", "Klang", "Telok Pulai", "Telok Gadong",
    "Kampung Raja Uda", "Jalan Kastam", "Pelabuhan Klang Selatan",
)
CORRIDOR_SOURCE = "https://www.ktmb.com.my/assets/pdf/2025/thaipusam2025.pdf"
AM_HOURS = (7, 8)
PM_HOURS = (18, 19)


def read_komuter(path, year):
    if path.suffix == ".parquet":
        parquet = pq.ParquetFile(path)
        raw = parquet.read().to_pandas(types_mapper=pd.ArrowDtype)
        schema = {field.name: str(field.type) for field in parquet.schema_arrow}
    else:
        raw = pd.read_csv(path, dtype="string[pyarrow]", encoding="utf-8-sig")
        schema = {column: "CSV text" for column in raw}
    if set(raw) != set(KTM_COLUMNS):
        raise ValueError(f"Unexpected Komuter columns in {path.name}: {list(raw)}")

    parsed_date = pd.to_datetime(raw["date"].astype("string"), format="ISO8601", errors="coerce")
    dates = parsed_date.dt.normalize()
    hour = pd.to_numeric(
        raw["time"].astype("string").str.extract(r"^([01]\d|2[0-3]):00(?::00)?$", expand=False),
        errors="coerce",
    ).astype("Int8")
    counts, numeric = valid_counts(raw["ridership"])
    source = pd.DataFrame({"date": dates, "hour": hour, "ridership": counts})
    for endpoint in ["origin", "destination"]:
        source[endpoint] = raw[endpoint].astype("string[pyarrow]").str.strip().replace("", pd.NA)
    invalid = source.isna().any(axis=1) | dates.dt.year.ne(year) | parsed_date.ne(dates)
    valid = source.loc[~invalid]
    dup = valid.duplicated(KTM_KEYS, keep=False)
    aggregates = (
        valid["origin"].str.match(AGGREGATE_PATTERN) | valid["destination"].str.match(AGGREGATE_PATTERN)
    )
    special = valid["origin"].isin(SPECIAL_ENDPOINTS) | valid["destination"].isin(SPECIAL_ENDPOINTS)
    labels = sorted(set(valid["origin"]) | set(valid["destination"]))
    available_dates = pd.DatetimeIndex(valid["date"].unique()).sort_values()
    day_groups = valid.groupby("date")["ridership"].sum()
    report = {
        "file": path.name, "source_schema": schema,
        "normalized_schema": {"date": "calendar date", "hour": "integer 0–23",
                              "origin": "string", "destination": "string", "ridership": "integer"},
        "rows": len(raw), "total_ridership": valid["ridership"].sum(),
        "date_min": available_dates.min(), "date_max": available_dates.max(),
        "observed_dates": len(available_dates),
        "missing_dates_inside_snapshot": dates_between(available_dates).difference(available_dates).tolist(),
        "days_outside_snapshot_in_year": (366 if pd.Timestamp(year, 12, 31).dayofyear == 366 else 365)
        - len(dates_between(available_dates)),
        "last_date_hours_present": sorted(valid.loc[
            valid["date"].eq(available_dates.max()), "hour"
        ].unique()),
        "last_date_ridership": day_groups.iloc[-1],
        "endpoint_labels": labels, "missing_values": raw.isna().sum().to_dict(),
        "invalid_rows": invalid.sum(), "negative_ridership": numeric.lt(0).sum(),
        "rows_in_duplicate_keys": dup.sum(),
        "duplicate_key_rows_beyond_first": valid.duplicated(KTM_KEYS).sum(),
        "aggregate_rows": aggregates.sum(),
        "aggregate_labels": sorted({
            label for label in labels if pd.Series([label]).str.match(AGGREGATE_PATTERN).iat[0]
        }),
        "aggregate_ridership": valid.loc[aggregates, "ridership"].sum(),
        "special_endpoint_rows": special.sum(),
        "special_endpoint_ridership": valid.loc[special, "ridership"].sum(),
        "same_station_rows": valid["origin"].eq(valid["destination"]).sum(),
        "same_station_ridership": valid.loc[
            valid["origin"].eq(valid["destination"]), "ridership"
        ].sum(),
        "corridor_labels_missing_from_source": sorted(set(PORT_KLANG_WEST) - set(labels)),
    }
    if invalid.any() or dup.any():
        raise ValueError(f"Invalid or duplicate Komuter keys in {path.name}: {report}")
    return valid, report, ~aggregates & ~special


def compare_komuter_snapshots(parquet, csv):
    parquet_dates = pd.DatetimeIndex(parquet["date"].unique())
    csv_dates = pd.DatetimeIndex(csv["date"].unique())
    shared = parquet_dates.intersection(csv_dates).sort_values()
    only_p = parquet_dates.difference(csv_dates)
    only_c = csv_dates.difference(parquet_dates)
    date_hour = ["date", "hour"]

    def compare_groups(keys):
        grouped_p = parquet[parquet["date"].isin(shared)].groupby(keys)["ridership"].sum()
        grouped_c = csv[csv["date"].isin(shared)].groupby(keys)["ridership"].sum()
        paired = pd.concat([grouped_p.rename("parquet"), grouped_c.rename("csv")], axis=1)
        both = paired.notna().all(axis=1)
        differences = (paired["parquet"] - paired["csv"]).dropna()
        return {
            "parquet_groups": len(grouped_p), "csv_groups": len(grouped_c),
            "groups_in_both": both.sum(),
            "groups_missing_from_parquet": paired["parquet"].isna().sum(),
            "groups_missing_from_csv": paired["csv"].isna().sum(),
            "unequal_shared_groups": differences.ne(0).sum(),
            "max_absolute_shared_difference": differences.abs().max(),
            "parquet_ridership": grouped_p.sum(), "csv_ridership": grouped_c.sum(),
        }

    def exclusive(frame, dates):
        return frame.loc[frame["date"].isin(dates)].groupby("date")["ridership"].agg(
            rows="size", trips="sum"
        ).reset_index().to_dict("records")

    full_keys = compare_groups(KTM_KEYS)
    consistent = len(shared) > 0 and all(full_keys[field] == 0 for field in [
        "groups_missing_from_parquet", "groups_missing_from_csv", "unequal_shared_groups",
    ])
    return {
        "shared_dates": len(shared), "first_shared_date": shared.min(),
        "last_shared_date": shared.max(), "daily_totals_on_shared_dates": compare_groups(["date"]),
        "date_hour_totals_on_shared_dates": compare_groups(date_hour),
        "od_hour_totals_on_shared_dates": full_keys,
        "parquet_only_dates": exclusive(parquet, only_p), "csv_only_dates": exclusive(csv, only_c),
        "same_measurement_on_shared_dates": consistent,
        "identical_coverage": not len(only_p) and not len(only_c),
    }


def hourly_totals(source, eligible, year):
    network = source.loc[eligible, ["date", "hour", "origin", "destination", "ridership"]].copy()
    corridor = network["origin"].isin(PORT_KLANG_WEST) & network["destination"].isin(PORT_KLANG_WEST)
    network["day_type"] = network["date"].dt.dayofweek.ge(5).map({False: "weekday", True: "weekend"})
    frames = []
    for name, subset in [("network", network), ("port_klang_west", network[corridor])]:
        keys = ["day_type", "hour"]
        index = pd.MultiIndex.from_product([["weekday", "weekend"], range(24)], names=keys)
        counts = subset.groupby(keys)["ridership"].sum().reindex(index, fill_value=0)
        coverage = subset.groupby(["day_type"])["date"].nunique()
        frame = counts.rename("hourly_trips").reset_index()
        frame["year"] = str(year)
        frame["scope"] = name
        frame["covered_dates"] = frame["day_type"].map(coverage).fillna(0).astype(int)
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def build_komuter_profiles(raw):
    sources = {}
    yearly = []
    comparison = None
    selected = {}
    for year in range(2023, 2027):
        parquet_file = raw / f"komuter_{year}.parquet"
        if year < 2026 or parquet_file.is_file():
            source, details, eligible = read_komuter(parquet_file, year)
            sources[parquet_file.name] = details
            chosen = parquet_file.name
        if year == 2026:
            csv_file = raw / "komuter_2026.csv"
            csv, details, csv_eligible = read_komuter(csv_file, year)
            sources[csv_file.name] = details
            if parquet_file.is_file():
                comparison = compare_komuter_snapshots(source, csv)
                if not comparison["same_measurement_on_shared_dates"]:
                    source, eligible, chosen = csv, csv_eligible, csv_file.name
                    reason = "Shared keys or counts differ. The CSV is the documented fallback."
                elif csv["date"].nunique() > source["date"].nunique():
                    source, eligible, chosen = csv, csv_eligible, csv_file.name
                    reason = "Shared keys and counts agree. The CSV covers more dates."
                else:
                    reason = "Shared keys and counts agree. Parquet has at least as many dates."
                comparison["selection_reason"] = reason
            else:
                source, eligible, chosen = csv, csv_eligible, csv_file.name
                comparison = {"selection_reason": "The 2026 Parquet is missing. Used the 2026 CSV."}
        selected[str(year)] = chosen
        yearly.append(hourly_totals(source, eligible, year))
        del source, eligible
        if year == 2026:
            del csv, csv_eligible

    annual = pd.concat(yearly, ignore_index=True)
    combined = annual.groupby(["scope", "day_type", "hour"], as_index=False)[
        ["hourly_trips", "covered_dates"]
    ].sum()
    combined["year"] = "combined"
    profiles = pd.concat([annual, combined], ignore_index=True)
    groups = ["scope", "year", "day_type"]
    profiles["profile_trips"] = profiles.groupby(groups)["hourly_trips"].transform("sum")
    if profiles["profile_trips"].le(0).any():
        raise ValueError("No observations for one or more Komuter profiles")
    profiles["hourly_share"] = profiles["hourly_trips"] / profiles["profile_trips"]
    profiles["am_peak_member"] = profiles["hour"].isin(AM_HOURS)
    profiles["pm_peak_member"] = profiles["hour"].isin(PM_HOURS)
    peaks = profiles.assign(
        am_share=profiles["hourly_share"].where(profiles["am_peak_member"], 0),
        pm_share=profiles["hourly_share"].where(profiles["pm_peak_member"], 0),
    ).groupby(groups).agg(
        am_share=("am_share", "sum"), pm_share=("pm_share", "sum"),
        share_sum=("hourly_share", "sum"), trips=("profile_trips", "first"),
        covered_dates=("covered_dates", "first"),
    ).reset_index()
    peaks["am_pm_share"] = peaks["am_share"] + peaks["pm_share"]
    stability = []
    for (scope, day_type), group in annual.groupby(["scope", "day_type"]):
        shares = profiles.loc[
            profiles["scope"].eq(scope) & profiles["day_type"].eq(day_type)
            & profiles["year"].ne("combined")
        ].pivot(index="hour", columns="year", values="hourly_share")
        pairwise = [
            {"years": [first, second], "total_variation": (shares[first] - shares[second]).abs().sum() / 2}
            for first, second in combinations(sorted(group["year"].unique()), 2)
        ]
        yearly_peaks = peaks.loc[
            peaks["scope"].eq(scope) & peaks["day_type"].eq(day_type) & peaks["year"].ne("combined")
        ]
        stability.append({
            "scope": scope, "day_type": day_type,
            "am_max_minus_min": yearly_peaks["am_share"].max() - yearly_peaks["am_share"].min(),
            "pm_max_minus_min": yearly_peaks["pm_share"].max() - yearly_peaks["pm_share"].min(),
            "am_pm_max_minus_min": yearly_peaks["am_pm_share"].max() - yearly_peaks["am_pm_share"].min(),
            "largest_pairwise_shift": max(pairwise, key=lambda pair: pair["total_variation"]),
            "all_pairwise_shifts": pairwise,
        })
    report = {
        "sources": sources, "comparison_2026": comparison, "selected_by_year": selected,
        "weighting": "Hourly trips divided by total trips within each scope, day type and period. "
        "The combined profile pools trip counts, giving more weight to higher-volume dates and years.",
        "day_types": "Monday–Friday and Saturday–Sunday based on source calendar dates.",
        "hour_definition": "Source transaction hour, floored to the hour. Zero in an output bin "
        "means no eligible trips were recorded in that bin among the included dates.",
        "inclusion": "One count per source OD-hour row. Exclude aggregate endpoints and records "
        "touching Penalty or Unknown. Retain same-station rows as published and report their counts.",
        "corridor_definition": "Both origin and destination on the west segment of the Port Klang "
        "corridor from Abdullah Hukum through Pelabuhan Klang. Published source labels are used.",
        "corridor_stations": PORT_KLANG_WEST, "corridor_source": CORRIDOR_SOURCE,
        "am_interval": "[07:00, 09:00)", "pm_interval": "[18:00, 20:00)",
        "peak_shares": peaks.to_dict("records"), "stability": stability,
    }
    return profiles, report
