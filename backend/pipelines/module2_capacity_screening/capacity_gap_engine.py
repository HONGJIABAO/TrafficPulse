from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from gtfs_utils import (
    GTFS_WINDOW_END,
    GTFS_WINDOW_START,
    OUT_DIR,
    SERVICE_CAPACITY_CONFIG,
    load_topology_and_paths,
    resolve_active_services_by_date,
)


def compute_capacity_gaps_and_boarding() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    reg, segs_by_net, _ = load_topology_and_paths()
    active_by_date = resolve_active_services_by_date(GTFS_WINDOW_START, GTFS_WINDOW_END)

    seg_meta: dict[str, dict[str, str]] = {}
    neighbors_by_net_stop: dict[tuple[str, str], set[str]] = defaultdict(set)
    for net, rows in segs_by_net.items():
        for r in rows:
            seg_meta[r["segment_id"]] = r
            neighbors_by_net_stop[(net, r["from_stop_id"])].add(r["to_stop_id"])
            neighbors_by_net_stop[(net, r["to_stop_id"])].add(r["from_stop_id"])

    # Load Backend C segment demand: (net, date, hr, seg_id) -> (tx, base, tight)
    demand_map: dict[tuple[str, str, int, str], tuple[float, float, float]] = {}
    with (OUT_DIR / "directional_segment_demand.csv").open("r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            demand_map[(r["network_code"], r["date"], int(r["clock_hour"]), r["segment_id"])] = (
                float(r["demand_tx_cohort"]),
                float(r["demand_sched_base"]),
                float(r["demand_sched_tight_0m"]),
            )

    # Load Backend D scheduled capacity: (net, date, hr, seg_id) -> (n_tr, c_nom, s_nom, c_80, s_80, n_int)
    cap_map: dict[tuple[str, str, int, str], tuple[int, int, int, int, int, int]] = {}
    with (OUT_DIR / "scheduled_segment_capacity.csv").open("r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            cap_map[(r["network_code"], r["date"], int(r["clock_hour"]), r["segment_id"])] = (
                int(r["scheduled_trains_n"]),
                int(r["train_capacity_nominal_c"]),
                int(r["scheduled_capacity_nominal_s"]),
                int(r["train_capacity_80pct_c"]),
                int(r["scheduled_capacity_80pct_s"]),
                int(r["interpolated_train_crossings"]),
            )

    all_keys = sorted(set(demand_map.keys()) | set(cap_map.keys()))

    # ------------------------------------------------------------------
    # Backend E: Segment Capacity Gap
    # ------------------------------------------------------------------
    gap_path = OUT_DIR / "potential_capacity_gap.csv"
    e_stats = {
        "rows": 0,
        "deficit_rows_nominal_base": 0,
        "deficit_rows_80pct_base": 0,
        "no_service_with_demand_rows": 0,
        "max_load_ratio_nominal_base": 0.0,
        "max_extra_trains_nominal_base": 0,
    }

    with gap_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "network_code",
                "date",
                "day_profile",
                "clock_hour",
                "segment_id",
                "from_stop_id",
                "to_stop_id",
                "routes_serving",
                "demand_tx_cohort",
                "demand_sched_base",
                "demand_sched_tight_0m",
                "scheduled_trains_n",
                "capacity_nominal_c",
                "scheduled_capacity_nominal_s",
                "load_ratio_nominal_base_pct",
                "capacity_deficit_nominal_base",
                "extra_trains_nominal_base",
                "load_ratio_80pct_base_pct",
                "capacity_deficit_80pct_base",
                "extra_trains_80pct_base",
                "status_nominal_base",
                "interpolated_train_crossings",
            ]
        )

        for key in all_keys:
            net, d_str, hr, seg_id = key
            sr = seg_meta[seg_id]
            d_tx, d_base, d_tight = demand_map.get(key, (0.0, 0.0, 0.0))
            cfg = SERVICE_CAPACITY_CONFIG[net]
            c_nom = cfg["official_2023_nominal"]
            c_80 = cfg["planning_sensitivity_80pct"]
            n_tr, _, s_nom, _, s_80, n_int = cap_map.get(key, (0, c_nom, 0, c_80, 0, 0))

            if s_nom > 0:
                lr_nom = round(d_base / s_nom * 100.0, 1)
                def_nom = max(0.0, d_base - s_nom)
                if def_nom > 1e-6:
                    ext_nom = math.ceil((def_nom - 1e-9) / c_nom)
                    ext_check = max(0, math.ceil((d_base - 1e-9) / c_nom) - n_tr)
                    assert ext_nom == ext_check, f"Extra train formula mismatch: {ext_nom} vs {ext_check} on {key}"
                    status = "deficit"
                    e_stats["deficit_rows_nominal_base"] += 1
                else:
                    ext_nom = 0
                    status = "watch" if lr_nom >= 80.0 else "within_capacity"

                lr_80 = round(d_base / s_80 * 100.0, 1)
                def_80 = max(0.0, d_base - s_80)
                if def_80 > 1e-6:
                    ext_80 = math.ceil((def_80 - 1e-9) / c_80)
                    e_stats["deficit_rows_80pct_base"] += 1
                else:
                    ext_80 = 0

                if lr_nom > e_stats["max_load_ratio_nominal_base"]:
                    e_stats["max_load_ratio_nominal_base"] = lr_nom
                if ext_nom > e_stats["max_extra_trains_nominal_base"]:
                    e_stats["max_extra_trains_nominal_base"] = ext_nom
            else:
                lr_nom = None
                def_nom = None
                ext_nom = None
                lr_80 = None
                def_80 = None
                ext_80 = None
                if d_base > 1e-6 or d_tx > 1e-6:
                    status = "no_scheduled_service_in_hour"
                    if d_base > 1e-6:
                        e_stats["no_service_with_demand_rows"] += 1
                else:
                    status = "no_service_no_demand"

            writer.writerow(
                [
                    net,
                    d_str,
                    active_by_date[d_str]["day_profile"],
                    hr,
                    seg_id,
                    sr["from_stop_id"],
                    sr["to_stop_id"],
                    sr["routes_serving"],
                    round(d_tx, 2),
                    round(d_base, 2),
                    round(d_tight, 2),
                    n_tr,
                    c_nom,
                    s_nom,
                    "" if lr_nom is None else lr_nom,
                    "" if def_nom is None else round(def_nom, 2),
                    "" if ext_nom is None else ext_nom,
                    "" if lr_80 is None else lr_80,
                    "" if def_80 is None else round(def_80, 2),
                    "" if ext_80 is None else ext_80,
                    status,
                    n_int,
                ]
            )
            e_stats["rows"] += 1

    # ------------------------------------------------------------------
    # Backend F: Station Boarding Capacity Screening
    # ------------------------------------------------------------------
    flow_dump = json.loads((OUT_DIR / "station_flow_events.json").read_text(encoding="utf-8"))
    # Reorganize outbound & incoming alighting events for base schedule
    # Outbound key: (net, date, hr, u_stop, seg_id) -> [d_in_thru, 0, b_board, d_out]
    # Incoming alight key: (net, date, hr, v_stop, f"FROM:{u}") -> [d_in_al, a_al, 0, 0]
    outbound_base: dict[tuple[str, str, int, str, str], list[float]] = {}
    alight_base: dict[tuple[str, str, int, str, str], list[float]] = {}
    for k_str, vals in flow_dump["base"].items():
        net, d_str, hr_s, st_id, key2 = k_str.split("|")
        hr = int(hr_s)
        if key2.startswith("FROM:"):
            alight_base[(net, d_str, hr, st_id, key2[5:])] = vals
        else:
            outbound_base[(net, d_str, hr, st_id, key2)] = vals

    outbound_tight: dict[tuple[str, str, int, str, str], list[float]] = {}
    alight_tight: dict[tuple[str, str, int, str, str], list[float]] = {}
    for k_str, vals in flow_dump["tight_0m"].items():
        net, d_str, hr_s, st_id, key2 = k_str.split("|")
        hr = int(hr_s)
        if key2.startswith("FROM:"):
            alight_tight[(net, d_str, hr, st_id, key2[5:])] = vals
        else:
            outbound_tight[(net, d_str, hr, st_id, key2)] = vals

    # Determine all (net, date, hr, seg_id) where either outbound flow or capacity exists
    all_st_keys = sorted(set(outbound_base.keys()) | {(net, d_str, hr, seg_meta[seg_id]["from_stop_id"], seg_id) for (net, d_str, hr, seg_id) in cap_map})

    station_path = OUT_DIR / "station_boarding_capacity.csv"
    f_stats = {
        "rows": 0,
        "full_boarding_rows": 0,
        "fallback_downstream_rows": 0,
        "upstream_already_full_rows": 0,
        "boarding_deficit_rows_nominal": 0,
        "max_conservation_abs_error": 0.0,
    }

    station_meta = reg["stations"]
    with station_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "network_code",
                "date",
                "day_profile",
                "clock_hour",
                "station_stop_id",
                "station_name",
                "outbound_segment_id",
                "outbound_to_stop_id",
                "outbound_to_station_name",
                "routes_serving",
                "boarding_screening_mode",
                "d_in_arriving",
                "a_alighting",
                "t_through_onboard",
                "b_boarding_demand",
                "d_out_segment_demand",
                "conservation_error",
                "scheduled_trains_n",
                "scheduled_capacity_nominal_s",
                "available_boarding_capacity_nominal",
                "boarding_capacity_gap_nominal",
                "available_boarding_capacity_80pct",
                "boarding_capacity_gap_80pct",
                "upstream_already_full",
                "b_boarding_tight_0m",
                "d_out_tight_0m",
            ]
        )

        for net, d_str, hr, st_id, seg_id in all_st_keys:
            sr = seg_meta[seg_id]
            to_id = sr["to_stop_id"]
            st_info = station_meta[f"{net}:{st_id}"]
            # True Y/multi-branch junction (>= 3 distinct physical neighbors) falls back to downstream segment screening
            is_ambiguous_junction = len(neighbors_by_net_stop[(net, st_id)]) >= 3

            ob = outbound_base.get((net, d_str, hr, st_id, seg_id), [0.0, 0.0, 0.0, 0.0])
            ob_t = outbound_tight.get((net, d_str, hr, st_id, seg_id), [0.0, 0.0, 0.0, 0.0])
            t_thru = ob[0]
            b_board = ob[2]
            d_out = ob[3]

            cfg = SERVICE_CAPACITY_CONFIG[net]
            n_tr, _, s_nom, _, s_80, _ = cap_map.get((net, d_str, hr, seg_id), (0, cfg["official_2023_nominal"], 0, cfg["planning_sensitivity_80pct"], 0, 0))

            if is_ambiguous_junction:
                mode = "fallback_downstream_segment"
                f_stats["fallback_downstream_rows"] += 1
                d_in_val = None
                a_val = None
                t_val = None
                err_val = None
                avail_nom = None
                gap_nom = None
                avail_80 = None
                gap_80 = None
                up_full = False
            else:
                mode = "full_station_boarding"
                f_stats["full_boarding_rows"] += 1
                # Linear / terminal station: opposite neighbor of to_id (if any) is unique inbound corridor prev
                nbrs = neighbors_by_net_stop[(net, st_id)]
                other_nbrs = [x for x in nbrs if x != to_id]
                if other_nbrs:
                    assert len(other_nbrs) == 1, f"Non-junction expected single other neighbor at {st_id}, got {other_nbrs}"
                    al_row = alight_base.get((net, d_str, hr, st_id, other_nbrs[0]), [0.0, 0.0, 0.0, 0.0])
                    a_val = al_row[1]
                    d_in_val = t_thru + al_row[0]
                    # Sanity check: al_row[0] == al_row[1] identically
                    assert abs(al_row[0] - al_row[1]) < 1e-4, f"Alight mismatch: {al_row}"
                else:
                    # Terminal outbound direction: originating trains have 0 through/arriving upstream load
                    a_val = 0.0
                    d_in_val = t_thru  # 0.0
                t_val = t_thru
                err_val = (d_in_val - a_val + b_board) - d_out
                assert abs(err_val) < 1e-4, f"Conservation failed at {(net, d_str, hr, st_id, seg_id)}: err={err_val}"
                f_stats["max_conservation_abs_error"] = max(f_stats["max_conservation_abs_error"], abs(err_val))

                if s_nom > 0:
                    up_full = t_val > (s_nom + 1e-6)
                    if up_full:
                        f_stats["upstream_already_full_rows"] += 1
                    avail_nom = max(0.0, s_nom - t_val)
                    gap_nom = max(0.0, b_board - avail_nom)
                    if gap_nom > 1e-6:
                        f_stats["boarding_deficit_rows_nominal"] += 1
                    avail_80 = max(0.0, s_80 - t_val)
                    gap_80 = max(0.0, b_board - avail_80)
                else:
                    up_full = False
                    avail_nom = None
                    gap_nom = None
                    avail_80 = None
                    gap_80 = None

            writer.writerow(
                [
                    net,
                    d_str,
                    active_by_date[d_str]["day_profile"],
                    hr,
                    st_id,
                    st_info["station_name"],
                    seg_id,
                    to_id,
                    sr["to_station_name"],
                    sr["routes_serving"],
                    mode,
                    "" if d_in_val is None else round(d_in_val, 2),
                    "" if a_val is None else round(a_val, 2),
                    "" if t_val is None else round(t_val, 2),
                    round(b_board, 2),
                    round(d_out, 2),
                    "" if err_val is None else round(err_val, 6),
                    n_tr,
                    s_nom,
                    "" if avail_nom is None else round(avail_nom, 2),
                    "" if gap_nom is None else round(gap_nom, 2),
                    "" if avail_80 is None else round(avail_80, 2),
                    "" if gap_80 is None else round(gap_80, 2),
                    str(up_full).lower(),
                    round(ob_t[2], 2),
                    round(ob_t[3], 2),
                ]
            )
            f_stats["rows"] += 1

    out_summary = {"backend_e_segment_gap": e_stats, "backend_f_station_boarding": f_stats}
    (OUT_DIR / "gap_and_boarding_audit.json").write_text(json.dumps(out_summary, indent=2), encoding="utf-8")
    print("Backends E & F Summary:", json.dumps(out_summary, indent=2))
    return out_summary


if __name__ == "__main__":
    compute_capacity_gaps_and_boarding()
