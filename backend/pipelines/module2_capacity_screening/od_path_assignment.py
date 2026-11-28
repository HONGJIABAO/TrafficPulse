from __future__ import annotations

import csv
import json
from collections import Counter, defaultdict
from pathlib import Path

from gtfs_utils import (
    GTFS_WINDOW_END,
    GTFS_WINDOW_START,
    OUT_DIR,
    RAW_DIR,
    load_topology_and_paths,
)


def classify_station_pair(
    net: str,
    orig_raw: str,
    dest_raw: str,
    csv_map: dict[str, str],
    excl_buckets: dict[str, str],
    station_meta: dict[str, dict],
) -> tuple[str, str | None, str | None]:
    if orig_raw == dest_raw:
        return "excluded_same_station", None, None

    # Check explicit non-station / unverified / out-of-scope station buckets
    bucket_o = excl_buckets.get(orig_raw)
    bucket_d = excl_buckets.get(dest_raw)
    if bucket_o or bucket_d:
        # Priority order: admin non-station -> unverified GTFS stop -> out of service scope
        priority = [
            "excluded_admin_non_station",
            "excluded_unverified_gtfs_stop",
            "excluded_out_of_service_scope",
        ]
        chosen = next((b for b in priority if b in {bucket_o, bucket_d}), bucket_o or bucket_d)
        return chosen, None, None

    o_id = csv_map.get(orig_raw)
    d_id = csv_map.get(dest_raw)
    if not o_id or not d_id:
        return "excluded_unresolved_station", o_id, d_id

    o_routes = set(station_meta[f"{net}:{o_id}"]["routes_serving"])
    d_routes = set(station_meta[f"{net}:{d_id}"]["routes_serving"])
    if o_routes & d_routes:
        return "assigned_direct", o_id, d_id
    return "assigned_cross_line_unique_physical", o_id, d_id


def run_path_assignment_audit() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    reg, _, paths = load_topology_and_paths()
    excl_buckets = reg["excluded_station_buckets"]
    station_meta = reg["stations"]

    # Load ridership_ktmb_daily reference for exact daily reconciliation
    headline_daily: dict[tuple[str, str], int] = {}
    with (RAW_DIR / "ridership_ktmb_daily.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            headline_daily[(r["service"], r["date"])] = int(float(r["ridership"]))

    datasets = [
        ("ktm_komuter_kv", "komuter", "komuter_2026.csv"),
        ("ktm_komuter_utara", "komuter_utara", "komuter_utara_2026.csv"),
    ]

    full_audit = {}
    reconciliation_rows = []

    for net, headline_svc, csv_name in datasets:
        csv_map = reg["csv_to_stop_id"][net]
        all_buckets_rows = Counter()
        all_buckets_pax = Counter()
        win_buckets_rows = Counter()
        win_buckets_pax = Counter()
        pair_cache: dict[tuple[str, str], tuple[str, str | None, str | None]] = {}
        excluded_station_pax = Counter()
        excluded_station_win_pax = Counter()

        daily_raw_pax = defaultdict(int)
        daily_assigned_pax = defaultdict(int)
        daily_excluded_pax = defaultdict(int)
        daily_in_gtfs_win = set()

        with (RAW_DIR / csv_name).open("r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                d = r["date"][:10]
                if d > GTFS_WINDOW_END:
                    continue
                orig, dest = r["origin"], r["destination"]
                pax = int(float(r["ridership"]))
                in_win = GTFS_WINDOW_START <= d <= GTFS_WINDOW_END
                if in_win:
                    daily_in_gtfs_win.add(d)

                key = (orig, dest)
                cls = pair_cache.get(key)
                if cls is None:
                    status, o_id, d_id = classify_station_pair(
                        net, orig, dest, csv_map, excl_buckets, station_meta
                    )
                    if status.startswith("assigned_"):
                        assert (net, o_id, d_id) in paths, f"Missing physical path for {(net, o_id, d_id)}"
                    cls = (status, o_id, d_id)
                    pair_cache[key] = cls

                status = cls[0]
                all_buckets_rows[status] += 1
                all_buckets_pax[status] += pax
                daily_raw_pax[d] += pax
                if status.startswith("assigned_"):
                    daily_assigned_pax[d] += pax
                else:
                    daily_excluded_pax[d] += pax
                    for st in (orig, dest):
                        if st in excl_buckets:
                            excluded_station_pax[st] += pax
                            if in_win:
                                excluded_station_win_pax[st] += pax

                if in_win:
                    win_buckets_rows[status] += 1
                    win_buckets_pax[status] += pax

        assert all_buckets_rows["excluded_unresolved_station"] == 0, f"Unresolved stations in {csv_name}!"
        assert all_buckets_rows["excluded_ambiguous_path"] == 0, f"Ambiguous paths in {csv_name}!"

        max_headline_diff = 0
        for d in sorted(daily_raw_pax):
            h_val = headline_daily.get((headline_svc, d))
            diff = (daily_raw_pax[d] - h_val) if h_val is not None else None
            if diff is not None:
                max_headline_diff = max(max_headline_diff, abs(diff))
            in_win = GTFS_WINDOW_START <= d <= GTFS_WINDOW_END
            reconciliation_rows.append(
                {
                    "network_code": net,
                    "date": d,
                    "in_gtfs_window": str(in_win).lower(),
                    "csv_total_pax": daily_raw_pax[d],
                    "assigned_pax": daily_assigned_pax[d],
                    "excluded_pax": daily_excluded_pax[d],
                    "conservation_diff": daily_raw_pax[d] - (daily_assigned_pax[d] + daily_excluded_pax[d]),
                    "ridership_ktmb_daily_pax": h_val if h_val is not None else "",
                    "headline_diff": diff if diff is not None else "",
                }
            )

        assert max_headline_diff == 0, f"Daily mismatch vs headline in {net}: {max_headline_diff}"

        total_all_pax = sum(all_buckets_pax.values())
        assigned_all_pax = all_buckets_pax["assigned_direct"] + all_buckets_pax["assigned_cross_line_unique_physical"]
        total_win_pax = sum(win_buckets_pax.values())
        assigned_win_pax = win_buckets_pax["assigned_direct"] + win_buckets_pax["assigned_cross_line_unique_physical"]

        full_audit[net] = {
            "source_file": csv_name,
            "full_period": {
                "date_range": f"{min(daily_raw_pax)}..{max(daily_raw_pax)}",
                "days": len(daily_raw_pax),
                "total_rows": sum(all_buckets_rows.values()),
                "total_pax": total_all_pax,
                "assigned_pax": assigned_all_pax,
                "assigned_share_pct": round(assigned_all_pax / total_all_pax * 100, 3),
                "buckets_rows": dict(all_buckets_rows),
                "buckets_pax": dict(all_buckets_pax),
            },
            "gtfs_overlap_window": {
                "date_range": f"{GTFS_WINDOW_START}..{GTFS_WINDOW_END}",
                "days": len(daily_in_gtfs_win),
                "total_rows": sum(win_buckets_rows.values()),
                "total_pax": total_win_pax,
                "assigned_pax": assigned_win_pax,
                "assigned_share_pct": round(assigned_win_pax / total_win_pax * 100, 3),
                "buckets_rows": dict(win_buckets_rows),
                "buckets_pax": dict(win_buckets_pax),
            },
            "excluded_special_stations_full_period": dict(sorted(excluded_station_pax.items())),
            "excluded_special_stations_gtfs_window": dict(sorted(excluded_station_win_pax.items())),
            "max_daily_diff_vs_ridership_ktmb_daily": max_headline_diff,
        }
        print(
            f"[{net}] Full: {assigned_all_pax:,}/{total_all_pax:,} ({full_audit[net]['full_period']['assigned_share_pct']}%), "
            f"GTFS win: {assigned_win_pax:,}/{total_win_pax:,} ({full_audit[net]['gtfs_overlap_window']['assigned_share_pct']}%), "
            f"headline diff=0"
        )

    (OUT_DIR / "od_path_assignment_audit.json").write_text(json.dumps(full_audit, indent=2), encoding="utf-8")
    rec_path = OUT_DIR / "od_daily_reconciliation.csv"
    with rec_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(reconciliation_rows[0].keys()))
        writer.writeheader()
        writer.writerows(reconciliation_rows)

    return full_audit


if __name__ == "__main__":
    run_path_assignment_audit()
