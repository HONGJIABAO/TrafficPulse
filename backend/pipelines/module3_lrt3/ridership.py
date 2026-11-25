"""Validate Rapid Rail OD records and reconcile the independent headline series."""

from collections import Counter

import numpy as np
import pandas as pd


OD_COLUMNS = ["origin", "destination", "date", "ridership"]
HEADLINE_COLUMN = "rail_lrt_shah_alam"
A0 = "A0: All Stations"
CODE_PATTERN = r"^([A-Z]+\d+):\s*(.+)$"
OD_METHOD = "od_aggregate_ridership"
DATE_FORMAT = "%Y-%m-%d"


def valid_counts(values):
    numbers = pd.to_numeric(values, errors="coerce")
    good = numbers.ge(0)
    if not pd.api.types.is_integer_dtype(numbers.dtype):
        good &= numbers.mod(1).eq(0)
    return numbers.where(good.fillna(False)).astype("Int64"), numbers


def dates_between(values):
    return pd.date_range(values.min(), values.max(), name="date")


def summarize_series(frame, value, status):
    observed = frame.loc[frame[value].notna(), "date"]
    positive = frame.loc[frame[value].gt(0).fillna(False), "date"]
    return {
        "first_calendar_date": frame["date"].min(),
        "last_calendar_date": frame["date"].max(),
        "first_non_null_date": observed.min(),
        "last_non_null_date": observed.max(),
        "first_positive_date": positive.min(),
        "last_positive_date": positive.max(),
        "status_counts": frame[status].value_counts().to_dict(),
        "zero_dates": frame.loc[frame[value].eq(0).fillna(False), "date"].tolist(),
        "null_dates": frame.loc[frame[status].eq("null"), "date"].tolist(),
        "missing_dates": frame.loc[frame[status].eq("missing"), "date"].tolist(),
        "invalid_or_partial_dates": frame.loc[
            frame[status].isin(["invalid", "duplicate", "partial"]), "date"
        ].tolist(),
    }


def statuses(values, rows, invalid, duplicate):
    result = pd.Series("observed_positive", index=values.index, dtype="string")
    result.loc[values.eq(0).fillna(False)] = "observed_zero"
    result.loc[values.isna()] = "null"
    result.loc[rows.eq(0)] = "missing"
    result.loc[invalid] = "invalid"
    result.loc[duplicate] = "duplicate"
    return result


def encode_keys(chunk, dictionaries):
    # Exact field IDs preserve cross-chunk duplicates without holding every string row.
    bits_per_field = 21
    packed = np.zeros(len(chunk), dtype=np.uint64)
    for field, dictionary in dictionaries.items():
        codes, unique = pd.factorize(chunk[field])
        field_ids = np.array(
            [dictionary.setdefault(value, len(dictionary) + 1) for value in unique],
            dtype=np.uint64,
        )
        if len(dictionary) >= 1 << bits_per_field:
            raise ValueError(f"OD key encoding exceeded its field limit for {field}")
        packed <<= bits_per_field
        packed |= np.append(field_ids, np.uint64(0))[codes]
    return packed


def read_rapidrail(path):
    quality = Counter()
    missing = Counter()
    labels = {"origin": set(), "destination": set()}
    dictionaries = {field: {} for field in ["origin", "destination", "date"]}
    key_arrays = []
    station_arrays = []
    valid_dates = set()
    with pd.read_csv(
        path, dtype="string[pyarrow]", chunksize=250_000, encoding="utf-8-sig"
    ) as chunks:
        for chunk in chunks:
            if list(chunk) != OD_COLUMNS:
                raise ValueError(f"Unexpected Rapid Rail columns: {list(chunk)}")
            chunk = chunk.apply(lambda column: column.str.strip().replace("", pd.NA))
            missing.update(chunk.isna().sum().to_dict())
            date = pd.to_datetime(chunk["date"], format="ISO8601", errors="coerce")
            day = date.dt.normalize()
            count, numeric = valid_counts(chunk["ridership"])
            quality["rows"] += len(chunk)
            quality["invalid_dates"] += (date.isna() & chunk["date"].notna()).sum()
            quality["non_midnight_dates"] += (date.ne(day) & date.notna()).sum()
            quality["negative_ridership"] += numeric.lt(0).sum()
            quality["non_numeric_or_non_integer_ridership"] += (
                (numeric.isna() & chunk["ridership"].notna())
                | (numeric.notna() & numeric.mod(1).ne(0).fillna(False))
            ).sum()
            quality["A0_origin_rows"] += chunk["origin"].eq(A0).sum()
            quality["A0_destination_rows"] += chunk["destination"].eq(A0).sum()
            quality["A0_to_A0_rows"] += (
                chunk["origin"].eq(A0) & chunk["destination"].eq(A0)
            ).sum()
            valid_dates.update(day.dropna().unique())
            for field, values in labels.items():
                values.update(chunk[field].dropna().unique())

            valid_key = day.notna() & chunk[["origin", "destination"]].notna().all(axis=1)
            keys = chunk.loc[valid_key, ["origin", "destination"]].assign(date=day[valid_key])
            key_arrays.append(encode_keys(keys, dictionaries))
            quality["rows_without_valid_od_key"] += (~valid_key).sum()

            sa = chunk["origin"].str.match(r"^SA\d+:").fillna(False)
            quality["SA_origin_rows_with_invalid_or_missing_date"] += (sa & day.isna()).sum()
            selected = chunk.loc[sa & day.notna(), ["origin", "destination"]].copy()
            selected["date"] = day.loc[selected.index]
            selected["count"] = count.loc[selected.index]
            selected["invalid_count"] = (
                count.isna() & chunk["ridership"].notna()
            ).loc[selected.index]
            station_arrays.append(selected)

    # Sort packed keys once, then measure duplicate groups and excess rows exactly.
    key_counts = np.unique(np.concatenate(key_arrays), return_counts=True)[1]
    duplicate_counts = key_counts[key_counts > 1]
    quality.update({
        "duplicate_od_keys": len(duplicate_counts),
        "rows_in_duplicate_od_keys": duplicate_counts.sum(),
        "duplicate_od_rows_beyond_first": (duplicate_counts - 1).sum(),
    })
    catalogue = pd.Series(sorted(set.union(*labels.values())), dtype="string")
    parsed = catalogue.str.extract(CODE_PATTERN)
    station_labels = catalogue[parsed[0].notna() & parsed[0].ne("A0")]
    unknown_labels = catalogue[parsed[0].isna()].tolist()
    coded_labels = set(catalogue[parsed[0].notna()])
    prefixes = {
        field: sorted({
            label.split(":", 1)[0].rstrip("0123456789")
            for label in values & coded_labels
        })
        for field, values in labels.items()
    }
    sa_labels = catalogue[parsed[0].str.match(r"^SA\d+$").fillna(False)]
    sa_catalogue = pd.DataFrame({"label": sa_labels, "station_code": parsed.loc[sa_labels.index, 0],
                                 "station_name": parsed.loc[sa_labels.index, 1]})
    if sa_catalogue.empty or sa_catalogue["station_code"].duplicated().any():
        raise ValueError("Missing SA stations or conflicting SA names for a single station code")

    calendar = dates_between(pd.DatetimeIndex(sorted(valid_dates)))
    source = pd.concat(station_arrays, ignore_index=True)
    source["method"] = source["destination"].map(
        {label: "od_individual" for label in station_labels} | {A0: "od_aggregate"}
    )
    source["duplicate_key"] = source.duplicated(["origin", "destination", "date"], keep=False)
    quality["SA_origin_rows_with_valid_date"] = len(source)
    quality["SA_origin_rows_with_duplicate_key"] = source["duplicate_key"].sum()
    quality["SA_origin_rows_with_unclassified_destination"] = source["method"].isna().sum()
    quality["SA_origin_unclassified_destination_labels"] = sorted(
        source.loc[source["method"].isna(), "destination"].dropna().unique()
    )

    station_index = pd.MultiIndex.from_product([calendar, sa_catalogue["label"]],
                                                names=["date", "origin"])
    station = pd.DataFrame(index=station_index)
    for method in ["od_aggregate", "od_individual"]:
        rows = source[source["method"].eq(method)]
        grouped = rows.groupby(["date", "origin"], observed=True)
        row_count = grouped.size().reindex(station_index, fill_value=0)
        recorded_sum = grouped["count"].sum(min_count=1).reindex(station_index)
        null_rows = grouped["count"].count().reindex(station_index, fill_value=0).ne(row_count)
        invalid = grouped["invalid_count"].any().reindex(station_index, fill_value=False)
        duplicated = grouped["duplicate_key"].any().reindex(station_index, fill_value=False)
        status = statuses(recorded_sum.mask(null_rows), row_count, invalid, duplicated)
        station[f"{method}_rows"] = row_count
        station[f"{method}_status"] = status
        station[f"{method}_ridership"] = recorded_sum.where(
            status.isin(["observed_positive", "observed_zero"])
        )
        if method == "od_individual":
            # The roster is empirical per origin. No unlisted OD pairs are filled with zero.
            destinations = rows.groupby("origin")["destination"].nunique()
            expected = station.index.get_level_values("origin").map(destinations).fillna(0).astype(int)
            observed = grouped["destination"].nunique().reindex(station_index, fill_value=0)
            station["individual_destinations_in_snapshot"] = expected
            station["individual_destinations_missing"] = expected - observed
    station = station.reset_index().merge(sa_catalogue, left_on="origin", right_on="label")
    station = station.drop(columns="label").sort_values(["date", "station_code"])
    station["aggregate_minus_individual"] = (
        station[OD_METHOD] - station["od_individual_ridership"]
    )
    station["station_origin_trips"] = station[OD_METHOD]
    station["station_origin_status"] = station["od_aggregate_status"]

    report = dict(quality)
    report.update({
        "file": path.name,
        "types": {"origin": "string", "destination": "string", "date": "calendar date",
                  "ridership": "nullable integer trip count"},
        "missing_by_column": dict(missing),
        "date_min": calendar.min(),
        "date_max": calendar.max(),
        "date_count": len(valid_dates),
        "missing_network_dates": calendar.difference(pd.DatetimeIndex(sorted(valid_dates))).tolist(),
        "prefixes_by_field": prefixes,
        "all_prefixes": sorted(set(prefixes["origin"]) | set(prefixes["destination"])),
        "unclassified_labels": unknown_labels,
        "sa_stations": sa_catalogue.drop(columns="label").to_dict("records"),
        "sa_stations_by_field": {
            field: sorted(values & set(sa_labels)) for field, values in labels.items()
        },
        "comparison": comparison_metrics(station),
    })
    return station, roll_up_stations(station), report


def comparison_metrics(station):
    difference = station["aggregate_minus_individual"].dropna()
    unmatched = station.loc[station["aggregate_minus_individual"].ne(0).fillna(False)]
    missing_a = station["od_aggregate_status"].eq("missing")
    missing_b = station["od_individual_status"].eq("missing")
    matches = difference.eq(0).sum()
    return {
        "station_dates": len(station),
        "comparable_station_dates": len(difference),
        "matching_station_dates": matches,
        "matching_percent_of_comparable": 100 * matches / len(difference) if len(difference) else None,
        "matching_percent_of_all_station_dates": 100 * matches / len(station),
        "mismatching_station_dates": len(unmatched),
        "missing_aggregate_station_dates": missing_a.sum(),
        "missing_individual_station_dates": missing_b.sum(),
        "missing_both_station_dates": (missing_a & missing_b).sum(),
        "station_dates_with_missing_empirical_destination": station[
            "individual_destinations_missing"
        ].gt(0).sum(),
        "missing_empirical_destination_rows": station["individual_destinations_missing"].sum(),
        "empirical_individual_destination_counts_by_origin": station.groupby("station_code")[
            "individual_destinations_in_snapshot"
        ].first().to_dict(),
        "aggregate_status_counts": station["od_aggregate_status"].value_counts().to_dict(),
        "individual_status_counts": station["od_individual_status"].value_counts().to_dict(),
        "signed_difference_sum": difference.sum(min_count=1),
        "mean_absolute_difference": difference.abs().mean(),
        "max_absolute_difference": difference.abs().max(),
        "largest_mismatches": unmatched.reindex(
            unmatched["aggregate_minus_individual"].abs().nlargest(10).index
        )[["date", "station_code", OD_METHOD, "od_individual_ridership",
           "aggregate_minus_individual"]].to_dict("records"),
    }


def roll_up_stations(station):
    grouped = station.groupby("date", sort=True)
    daily = pd.DataFrame(index=grouped.size().index)
    daily["expected_stations"] = grouped.size()
    for method in ["od_aggregate", "od_individual"]:
        status = station[f"{method}_status"]
        station_count = grouped[f"{method}_ridership"].count()
        present = status.ne("missing").groupby(station["date"]).sum()
        all_null = status.eq("null").groupby(station["date"]).all()
        full = station_count.eq(daily["expected_stations"])
        reported_sum = grouped[f"{method}_ridership"].sum(min_count=1)
        daily[f"{method}_observed_stations"] = station_count
        daily[f"{method}_ridership"] = reported_sum.where(full)
        day_status = pd.Series("observed_positive", index=daily.index, dtype="string")
        day_status.loc[reported_sum.eq(0).fillna(False)] = "observed_zero"
        day_status.loc[~full] = "partial"
        day_status.loc[all_null] = "null"
        day_status.loc[present.eq(0)] = "missing"
        daily[f"{method}_status"] = day_status
    daily["aggregate_minus_individual"] = daily[OD_METHOD] - daily["od_individual_ridership"]
    daily["mismatching_stations"] = station["aggregate_minus_individual"].ne(0).fillna(False).groupby(
        station["date"]
    ).sum()
    daily["comparable_stations"] = grouped["aggregate_minus_individual"].count()
    daily["station_origin_trips"] = daily[OD_METHOD]
    daily["station_origin_status"] = daily["od_aggregate_status"]
    return daily.reset_index()


def read_headline(path):
    raw = pd.read_csv(path, dtype={"date": "string", HEADLINE_COLUMN: "string"})
    date = pd.to_datetime(raw["date"], format=DATE_FORMAT, errors="coerce")
    if date.isna().any() or date.duplicated().any():
        raise ValueError("Missing, invalid or duplicate dates in the headline source")
    count, _ = valid_counts(raw[HEADLINE_COLUMN])
    source = pd.DataFrame({"date": date, "headline_trips": count, "headline_row_present": True})
    source["headline_status"] = statuses(
        count, pd.Series(1, index=raw.index), count.isna() & raw[HEADLINE_COLUMN].notna(),
        pd.Series(False, index=raw.index),
    )
    daily = source.set_index("date").reindex(dates_between(date)).reset_index()
    daily["headline_row_present"] = daily["headline_row_present"].eq(True)
    daily["headline_status"] = daily["headline_status"].fillna("missing")
    report = summarize_series(daily, "headline_trips", "headline_status")
    report.update({
        "file": path.name, "series_column": HEADLINE_COLUMN, "source_rows": len(raw),
        "first_source_row_date": date.min(), "last_source_row_date": date.max(),
    })
    return daily, report


def compare_sources(daily, headline):
    overlap = daily.merge(headline, on="date")
    overlap["headline_minus_od"] = overlap["headline_trips"] - overlap["station_origin_trips"]
    overlap["absolute_difference"] = overlap["headline_minus_od"].abs()
    od = overlap["station_origin_trips"]
    hl = overlap["headline_trips"]
    overlap["pct_difference_vs_od"] = 100 * overlap["headline_minus_od"] / od.mask(od.eq(0))
    overlap["pct_difference_vs_headline"] = (
        100 * overlap["headline_minus_od"] / hl.mask(hl.eq(0))
    )
    overlap["absolute_pct_difference_vs_od"] = overlap["pct_difference_vs_od"].abs()
    paired = overlap.dropna(subset=["headline_minus_od"])
    positive = paired[paired["station_origin_trips"].gt(0) & paired["headline_trips"].gt(0)]

    def measures(frame):
        return {
            "days": len(frame), "first": frame["date"].min(), "last": frame["date"].max(),
            "equal_days": frame["headline_minus_od"].eq(0).sum(),
            "headline_higher_days": frame["headline_minus_od"].gt(0).sum(),
            "od_higher_days": frame["headline_minus_od"].lt(0).sum(),
            "mean_headline_minus_od": frame["headline_minus_od"].mean(),
            "mean_absolute_difference": frame["absolute_difference"].mean(),
            "mean_pct_difference_vs_od": frame["pct_difference_vs_od"].mean(),
            "mean_absolute_pct_difference_vs_od": frame["absolute_pct_difference_vs_od"].mean(),
            "pearson_correlation": frame["station_origin_trips"].corr(frame["headline_trips"])
            if len(frame) > 1 and all(frame[column].nunique() > 1 for column in
                                     ["station_origin_trips", "headline_trips"]) else None,
        }

    dates_under_review = ["2026-06-29", "2026-08-01", "2026-08-31"]
    report = {
        "overlap_calendar_days": len(overlap),
        "first_overlap_date": overlap["date"].min(), "last_overlap_date": overlap["date"].max(),
        "od_dates_after_headline_snapshot": daily.loc[
            daily["date"].gt(headline["date"].max()), "date"
        ].tolist(),
        "all_numeric_pairs": measures(paired),
        "both_positive": measures(positive),
        "headline_positive_od_zero_dates": overlap.loc[
            hl.gt(0).fillna(False) & od.eq(0).fillna(False), "date"
        ].tolist(),
        "dates_under_review": overlap.loc[overlap["date"].isin(pd.to_datetime(dates_under_review)), [
            "date", OD_METHOD, "od_individual_ridership", "station_origin_status",
            "headline_trips", "headline_status", "headline_minus_od", "pct_difference_vs_od",
            "pct_difference_vs_headline",
        ]].to_dict("records"),
    }
    return overlap, report
