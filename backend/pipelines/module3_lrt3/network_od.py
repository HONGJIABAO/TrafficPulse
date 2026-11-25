"""Bounded scan of the validated Rapid Rail daily OD snapshot."""

import re
from collections import Counter
from datetime import date, timedelta

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.csv as csv


COLUMNS = ["origin", "destination", "date", "ridership"]
A0 = "A0: All Stations"
LABEL_PATTERN = re.compile(r"^([A-Z]+)(\d+)([A-Z]?):\s*(.+)$")
MAX_LABELS = 256
BLOCK_SIZE = 512 * 1024


def prefix(label):
    match = LABEL_PATTERN.fullmatch(label)
    return match[1] if match else "unclassified"


def window_dates(first, last):
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def scan(path, first, last, guard, progress):
    dates = window_dates(first, last)
    shape = (len(dates), MAX_LABELS)
    # Retain only membership for OD pairs, and aggregate counts into day/origin
    # and day/destination totals. There is no retained matrix of OD trip counts.
    seen = np.zeros((*shape, MAX_LABELS), dtype=bool)
    repeated = np.zeros(shape, dtype=bool)
    totals = np.zeros(shape, dtype=np.int64)
    destination_totals = np.zeros(shape, dtype=np.int64)
    a0_dest = np.zeros(shape, dtype=np.int64)
    a0_origin = np.zeros(shape, dtype=np.int64)
    destination_routes = Counter()
    stats = Counter()
    labels = {A0: 0}
    days_full = Counter()
    first_day, last_day = (value.toordinal() - date(1970, 1, 1).toordinal() for value in (first, last))

    def label_ids(values):
        encoded = pc.dictionary_encode(values)
        ids = []
        for label in encoded.dictionary.to_pylist():
            if not label or label != label.strip():
                raise ValueError(f"Malformed origin or destination label: {label!r}")
            if label not in labels:
                if len(labels) >= MAX_LABELS:
                    raise ValueError(f"The OD catalogue exceeds the {MAX_LABELS} label allocation")
                labels[label] = len(labels)
            ids.append(labels[label])
        return np.asarray(ids, dtype=np.int32)[encoded.indices.to_numpy()]

    reader = csv.open_csv(
        path, read_options=csv.ReadOptions(block_size=BLOCK_SIZE, use_threads=False),
        convert_options=csv.ConvertOptions(include_columns=COLUMNS, column_types={
            "origin": pa.string(), "destination": pa.string(), "date": pa.timestamp("s"), "ridership": pa.int64(),
        }),
    )
    for batch in reader:
        guard()
        if any(column.null_count for column in batch.columns):
            raise ValueError("Null fields in the fingerprinted Rapid Rail OD CSV")
        seconds = batch["date"].cast(pa.int64()).to_numpy()
        trips = batch["ridership"].to_numpy()
        if np.any(seconds % 86_400) or np.any(trips < 0):
            raise ValueError("Invalid Malaysian service date or negative ridership in the OD CSV")
        days = seconds // 86_400
        unique_days, daily_rows = np.unique(days, return_counts=True)
        days_full.update(dict(zip(map(int, unique_days), map(int, daily_rows))))
        stats["snapshot_rows"] += batch.num_rows
        selected = (days >= first_day) & (days <= last_day)
        if not selected.any():
            continue
        batch = batch.filter(pa.array(selected))
        d = days[selected] - first_day
        origin = label_ids(batch["origin"])
        dest = label_ids(batch["destination"])
        count = batch["ridership"].to_numpy()
        stats["window_rows"] += batch.num_rows
        flat = (d * MAX_LABELS + origin) * MAX_LABELS + dest
        _, indexes, repeats = np.unique(flat, return_index=True, return_counts=True)
        d, origin, dest, count = (x[indexes] for x in (d, origin, dest, count))
        prior = seen[d, origin, dest]
        duplicate = (repeats > 1) | prior
        repeated[d[duplicate], origin[duplicate]] = True
        stats["extra_duplicate_rows"] += int((repeats - 1).sum() + prior.sum())
        seen[d, origin, dest] = True
        stats["a0_to_a0_rows"] += int(((origin == 0) & (dest == 0)).sum())
        outgoing_aggregate = (origin != 0) & (dest == 0) & ~prior
        incoming_aggregate = (origin == 0) & (dest != 0) & ~prior
        individual = (origin != 0) & (dest != 0) & ~prior
        a0_dest[d[outgoing_aggregate], origin[outgoing_aggregate]] = count[outgoing_aggregate]
        a0_origin[d[incoming_aggregate], dest[incoming_aggregate]] = count[incoming_aggregate]
        np.add.at(totals, (d[individual], origin[individual]), count[individual])
        np.add.at(destination_totals, (d[individual], dest[individual]), count[individual])
        if stats["snapshot_rows"] // 1_000_000 > stats["million_logged"]:
            stats["million_logged"] = stats["snapshot_rows"] // 1_000_000
            progress(stats["snapshot_rows"])

    if not days_full:
        raise ValueError("Empty Rapid Rail OD CSV")
    epoch = date(1970, 1, 1)
    appears_as_origin = seen.any(axis=(0, 2))
    appears_as_destination = seen.any(axis=(0, 1))
    distinct_individual_destinations = seen[:, :, 1:].any(axis=0)
    expected = distinct_individual_destinations.sum(axis=1)
    pair_count = seen[:, :, 1:].sum(axis=2)
    indexed_labels = list(labels)
    records = []
    for label, i in labels.items():
        if i == 0 or not appears_as_origin[i]:
            continue
        for dest_id in np.flatnonzero(distinct_individual_destinations[i]):
            destination_routes[(prefix(label), prefix(indexed_labels[dest_id + 1]))] += 1
        for j, day in enumerate(dates):
            records.append({"date": day, "raw_origin": label,
                            "a0_destination_rows": int(seen[j, i, 0]),
                            "a0_destination_trips": int(a0_dest[j, i]) if seen[j, i, 0] else None,
                            "individual_destination_rows": int(pair_count[j, i]),
                            "individual_destination_trips": int(totals[j, i]) if pair_count[j, i] else None,
                            "empirical_destination_roster_size": int(expected[i]),
                            "has_duplicate_od_key": bool(repeated[j, i])})
    raw_start, raw_end = min(days_full), max(days_full)
    origins = sorted(label for label, i in labels.items() if i and appears_as_origin[i])
    destinations = sorted(label for label, i in labels.items() if i and appears_as_destination[i])
    aggregate_destination_mask = seen[:, 0, 1:]
    incoming_compare = a0_origin[:, 1:][aggregate_destination_mask] - destination_totals[:, 1:][aggregate_destination_mask]
    stats.pop("million_logged", None)
    audit = {
        **dict(stats), "snapshot_first_date": (epoch + timedelta(days=raw_start)).isoformat(),
        "snapshot_last_date": (epoch + timedelta(days=raw_end)).isoformat(), "snapshot_date_count": len(days_full),
        "window_first_date": first.isoformat(), "window_last_date": last.isoformat(), "window_days": len(dates),
        "window_origin_labels": origins, "window_destination_labels": destinations,
        "origin_prefix_counts": dict(Counter(map(prefix, origins))), "destination_prefix_counts": dict(Counter(map(prefix, destinations))),
        "outgoing_a0_rows": int(seen[:, 1:, 0].sum()), "incoming_a0_rows": int(aggregate_destination_mask.sum()),
        "incoming_a0_compared_days": int(incoming_compare.size), "incoming_a0_matching_days": int((incoming_compare == 0).sum()),
        "incoming_a0_minus_individual_sum": int(incoming_compare.sum()),
        "outgoing_a0_row_trip_sum": int(a0_dest.sum()), "individual_destination_trip_sum": int(totals[:, 1:].sum()),
        "empirical_pairs_by_origin_destination_prefix": {"/".join(key): n for key, n in sorted(destination_routes.items())},
        "distinct_valid_keys_within_window": int(seen.sum()),
    }
    return records, audit
