from __future__ import annotations

import csv
import datetime as dt
import json
from collections import defaultdict
from pathlib import Path

from gtfs_utils import (
    GTFS_WINDOW_END,
    GTFS_WINDOW_START,
    OUT_DIR,
    SERVICE_CAPACITY_CONFIG,
    load_expanded_gtfs_trips,
    load_topology_and_paths,
    resolve_active_services_by_date,
)


def compute_scheduled_capacity() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    reg, segs_by_net, _ = load_topology_and_paths()
    active_by_date = resolve_active_services_by_date(GTFS_WINDOW_START, GTFS_WINDOW_END)
    trips_by_svc = load_expanded_gtfs_trips(reg)

    # Precompute hourly train crossing counts per (network_code, service_id): (segment_id, day_off, clock_hour) -> (train_count, interp_count)
    pattern_crossings: dict[tuple[str, str], dict[tuple[str, int, int], list[int]]] = defaultdict(
        lambda: defaultdict(lambda: [0, 0])
    )
    all_seg_ids: dict[str, set[str]] = defaultdict(set)
    seg_meta: dict[str, dict[str, str]] = {}
    for net, rows in segs_by_net.items():
        for r in rows:
            all_seg_ids[net].add(r["segment_id"])
            seg_meta[r["segment_id"]] = r

    for (net, sid), tlist in trips_by_svc.items():
        for tr in tlist:
            for (u, v, dep_u_secs, _, is_interp) in tr["edges"]:
                seg_id = f"{net}:{u}->{v}"
                assert seg_id in all_seg_ids[net], f"Trip segment {seg_id} missing from verified segments!"
                day_off = dep_u_secs // 86400
                clock_hr = (dep_u_secs // 3600) % 24
                acc = pattern_crossings[(net, sid)][(seg_id, day_off, clock_hr)]
                acc[0] += 1
                if is_interp:
                    acc[1] += 1

    # Expand across every actual date in GTFS window (handling midnight day_off spill safely within window)
    daily_cap_counts: dict[tuple[str, str, int, str], list[int]] = defaultdict(lambda: [0, 0])
    for d_str, info in sorted(active_by_date.items()):
        d_obj = dt.date.fromisoformat(d_str)
        for net in ("ktm_komuter_kv", "ktm_komuter_utara"):
            sid = info[net]
            for (seg_id, day_off, clock_hr), (n_tr, n_int) in pattern_crossings[(net, sid)].items():
                target_d = d_str if day_off == 0 else (d_obj + dt.timedelta(days=day_off)).isoformat()
                if GTFS_WINDOW_START <= target_d <= GTFS_WINDOW_END:
                    acc = daily_cap_counts[(net, target_d, clock_hr, seg_id)]
                    acc[0] += n_tr
                    acc[1] += n_int

    out_path = OUT_DIR / "scheduled_segment_capacity.csv"
    rows_written = 0
    total_train_crossings = defaultdict(int)

    with out_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "network_code",
                "date",
                "day_profile",
                "active_service_id",
                "clock_hour",
                "segment_id",
                "from_stop_id",
                "to_stop_id",
                "routes_serving",
                "scheduled_trains_n",
                "train_capacity_nominal_c",
                "scheduled_capacity_nominal_s",
                "train_capacity_80pct_c",
                "scheduled_capacity_80pct_s",
                "interpolated_train_crossings",
            ]
        )
        for (net, d_str, hr, seg_id) in sorted(daily_cap_counts):
            n_tr, n_int = daily_cap_counts[(net, d_str, hr, seg_id)]
            cfg = SERVICE_CAPACITY_CONFIG[net]
            c_nom = cfg["official_2023_nominal"]
            c_80 = cfg["planning_sensitivity_80pct"]
            sr = seg_meta[seg_id]
            writer.writerow(
                [
                    net,
                    d_str,
                    active_by_date[d_str]["day_profile"],
                    active_by_date[d_str][net],
                    hr,
                    seg_id,
                    sr["from_stop_id"],
                    sr["to_stop_id"],
                    sr["routes_serving"],
                    n_tr,
                    c_nom,
                    n_tr * c_nom,
                    c_80,
                    n_tr * c_80,
                    n_int,
                ]
            )
            rows_written += 1
            total_train_crossings[net] += n_tr

    summary = {
        "gtfs_window": f"{GTFS_WINDOW_START}..{GTFS_WINDOW_END}",
        "excluded_pre_gtfs_window": "2026-01-01..2026-08-17 (excluded from capacity deficit comparisons because ktmb_gtfs.zip calendar starts 2026-08-18)",
        "unverified_kv_holiday_excluded_from_matched": ["2026-11-09 (Deepavali replacement holiday lacks calendar_dates.txt exception; isolated in holiday sensitivity)"],
        "reference_timetable_validity": {
            "ktm_komuter_kv": (
                "Reference-Timetable Scenario vs published Nov 2026 KTMB GTFS feed (BC-PS Nov 10/14 + TM-PK Nov 23/28-29 RIDT works "
                "backdated to 2026-08-18 in calendar.txt); exact matched schedule across Nov 10-26 and indicative reference baseline for Aug 18-Nov 9."
            ),
            "ktm_komuter_utara": (
                "Verified continuous fixed schedule across 2026-08-18..2026-11-26 matching KTMB official 24 Jul 2026 timetable PDF daily (1,1,1,1,1,1,1)."
            ),
        },
        "rows_written": rows_written,
        "total_segment_train_crossings": dict(total_train_crossings),
        "capacity_assumptions": SERVICE_CAPACITY_CONFIG,
    }
    (OUT_DIR / "scheduled_capacity_audit.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("Backend D Summary:", json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    compute_scheduled_capacity()
