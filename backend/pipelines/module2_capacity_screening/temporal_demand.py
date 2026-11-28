from __future__ import annotations

import bisect
import csv
import datetime as dt
import json
import math
from collections import defaultdict
from pathlib import Path

from gtfs_utils import (
    GTFS_WINDOW_END,
    GTFS_WINDOW_START,
    KITS_BATCH_ANOMALY_HOURS,
    OUT_DIR,
    RAW_DIR,
    SERVICE_CAPACITY_CONFIG,
    load_expanded_gtfs_trips,
    load_topology_and_paths,
    resolve_active_services_by_date,
)
from od_path_assignment import classify_station_pair


class ItineraryPlanner:
    """
    Deterministic schedule-traversal planner along verified unique physical paths P.

    Empirical KTMB ticketing reconciliation:
      - ktm_komuter_kv (AFC gantry tap-out timestamps): primarily arrival-aligned
        (latest itinerary arriving at destination within [t_tx - 5400, t_tx - buffer]),
        with bounded forward fallback [t_tx + buffer, t_tx + 5400] for pre-departure QR/token purchases.
      - ktm_komuter_utara (KITS mixed gate/counter/mobile timestamps; 20-31% of long-corridor OD rows fall in
        arrival-only zero-departure hours): adopted baseline uses symmetric 50/50 bounded mixed matching
        (50% arrival-aligned within 120m w/ forward fallback <= 120m + 50% forward departure-aligned <= 120m),
        eliminating unbounded overnight (01:00 AM -> 05:30 AM) and 2h off-peak gap distortion while computing
        full sensitivity envelopes across forward (+5m), arrival-hybrid, and transaction-hour assumptions.
    """

    def __init__(self, reg: dict, paths: dict[tuple[str, str, str], list[str]]):
        self.reg = reg
        self.paths = paths
        self.trips_by_svc = load_expanded_gtfs_trips(reg)
        self.trip_list: dict[tuple[str, str], list[dict]] = {}
        self.trip_stop_pos: dict[tuple[str, str], list[dict[str, int]]] = {}
        self.departures_at_stop: dict[tuple[str, str, str], list[tuple[int, int, int]]] = defaultdict(list)

        for (net, sid), tlist in self.trips_by_svc.items():
            self.trip_list[(net, sid)] = tlist
            pos_list = []
            for tidx, t in enumerate(tlist):
                pmap = {s: idx for idx, s in enumerate(t["stops"])}
                pos_list.append(pmap)
                for pos, s in enumerate(t["stops"][:-1]):
                    self.departures_at_stop[(net, sid, s)].append((t["dep_secs"][pos], tidx, pos))
            self.trip_stop_pos[(net, sid)] = pos_list

        for key in self.departures_at_stop:
            self.departures_at_stop[key].sort(key=lambda x: x[0])

        self._itineraries_cache: dict[
            tuple[str, str, str, str],
            tuple[list[tuple[int, int, int, list[tuple[int, int, int]]]], list[tuple[int, int, int, list[tuple[int, int, int]]]]],
        ] = {}
        self._hour_cache: dict[
            tuple,
            tuple[
                dict[tuple[str, int, int], float],
                dict[tuple[str, str, int, int], tuple[float, float, float, float]],
                float,  # matched_arrival_frac
                float,  # matched_forward_frac
            ],
        ] = {}

    def _find_best_forward(
        self, net: str, sid: str, path: list[str], t_ready: float
    ) -> tuple[int, int, list[tuple[int, int, int]]] | None:
        o_stop, d_stop = path[0], path[-1]
        tlist = self.trip_list.get((net, sid), [])
        pos_maps = self.trip_stop_pos.get((net, sid), [])
        deps_o = self.departures_at_stop.get((net, sid, o_stop), [])
        if not deps_o:
            return None

        start_idx = bisect.bisect_left(deps_o, (int(t_ready + 0.9999), -1, -1))
        if start_idx >= len(deps_o):
            return None

        best_score: tuple[int, int, int] | None = None
        best_legs: list[tuple[int, int, int]] | None = None

        for dep_o_secs, tidx1, pos1_start in deps_o[start_idx:]:
            if best_score is not None and dep_o_secs > best_score[0]:
                break
            t1 = tlist[tidx1]
            if pos1_start + 1 >= len(t1["stops"]) or t1["stops"][pos1_start + 1] != path[1]:
                continue

            max_p = 1
            while (
                pos1_start + max_p + 1 < len(t1["stops"])
                and max_p + 1 < len(path)
                and t1["stops"][pos1_start + max_p + 1] == path[max_p + 1]
            ):
                max_p += 1

            if max_p == len(path) - 1:
                arr_d = t1["arr_secs"][pos1_start + max_p]
                score = (arr_d, 0, dep_o_secs)
                if best_score is None or score < best_score:
                    best_score = score
                    best_legs = [(tidx1, pos1_start, pos1_start + max_p)]
                continue

            for p_k in range(1, max_p + 1):
                xfer_stop = path[p_k]
                xfer_ready = t1["arr_secs"][pos1_start + p_k] + 300
                if best_score is not None and xfer_ready >= best_score[0]:
                    break
                deps_x = self.departures_at_stop.get((net, sid, xfer_stop), [])
                x_idx = bisect.bisect_left(deps_x, (xfer_ready, -1, -1))
                for dep_x_secs, tidx2, pos2_start in deps_x[x_idx:]:
                    if best_score is not None and dep_x_secs >= best_score[0]:
                        break
                    t2 = tlist[tidx2]
                    if pos2_start + 1 >= len(t2["stops"]) or t2["stops"][pos2_start + 1] != path[p_k + 1]:
                        continue
                    pos2_map = pos_maps[tidx2]
                    if d_stop in pos2_map:
                        pos2_end = pos2_map[d_stop]
                        if pos2_end > pos2_start and t2["stops"][pos2_start : pos2_end + 1] == path[p_k:]:
                            arr_d = t2["arr_secs"][pos2_end]
                            score = (arr_d, 1, dep_o_secs)
                            if best_score is None or score < best_score:
                                best_score = score
                                best_legs = [
                                    (tidx1, pos1_start, pos1_start + p_k),
                                    (tidx2, pos2_start, pos2_end),
                                ]
                            break

        if best_legs is None or best_score is None:
            return None
        return best_score[0], best_score[2], best_legs  # (dest_arr, first_dep, legs)

    def _get_network_itineraries(
        self, net: str, sid: str, o_stop: str, d_stop: str
    ) -> tuple[
        list[tuple[int, int, int, list[tuple[int, int, int]]]],
        list[tuple[int, int, int, list[tuple[int, int, int]]]],
    ]:
        """
        Enumerate every feasible direct (0-transfer) and minimal-transfer (1-transfer) departure from o_stop to d_stop.
        Returns two sorted views:
          - by_arr: [(dest_arr, first_dep, transfers, legs)] sorted ascending by (dest_arr, -first_dep, transfers)
          - by_dep: [(first_dep, dest_arr, transfers, legs)] sorted ascending by (first_dep, dest_arr, transfers)
        """
        ck = (net, sid, o_stop, d_stop)
        if ck in self._itineraries_cache:
            return self._itineraries_cache[ck]

        path = self.paths[(net, o_stop, d_stop)]
        tlist = self.trip_list.get((net, sid), [])
        pos_maps = self.trip_stop_pos.get((net, sid), [])
        deps_o = self.departures_at_stop.get((net, sid, o_stop), [])

        candidates: list[tuple[int, int, int, list[tuple[int, int, int]]]] = []
        for dep_o_secs, tidx1, pos1_start in deps_o:
            t1 = tlist[tidx1]
            if pos1_start + 1 >= len(t1["stops"]) or t1["stops"][pos1_start + 1] != path[1]:
                continue

            max_p = 1
            while (
                pos1_start + max_p + 1 < len(t1["stops"])
                and max_p + 1 < len(path)
                and t1["stops"][pos1_start + max_p + 1] == path[max_p + 1]
            ):
                max_p += 1

            if max_p == len(path) - 1:
                arr_d = t1["arr_secs"][pos1_start + max_p]
                candidates.append((arr_d, dep_o_secs, 0, [(tidx1, pos1_start, pos1_start + max_p)]))
                continue

            best_arr_1t: int | None = None
            best_legs_1t: list[tuple[int, int, int]] | None = None
            for p_k in range(1, max_p + 1):
                xfer_stop = path[p_k]
                xfer_ready = t1["arr_secs"][pos1_start + p_k] + 300
                deps_x = self.departures_at_stop.get((net, sid, xfer_stop), [])
                x_idx = bisect.bisect_left(deps_x, (xfer_ready, -1, -1))
                for _, tidx2, pos2_start in deps_x[x_idx:]:
                    t2 = tlist[tidx2]
                    if pos2_start + 1 >= len(t2["stops"]) or t2["stops"][pos2_start + 1] != path[p_k + 1]:
                        continue
                    pos2_map = pos_maps[tidx2]
                    if d_stop in pos2_map:
                        pos2_end = pos2_map[d_stop]
                        if pos2_end > pos2_start and t2["stops"][pos2_start : pos2_end + 1] == path[p_k:]:
                            arr_d = t2["arr_secs"][pos2_end]
                            if best_arr_1t is None or arr_d < best_arr_1t:
                                best_arr_1t = arr_d
                                best_legs_1t = [
                                    (tidx1, pos1_start, pos1_start + p_k),
                                    (tidx2, pos2_start, pos2_end),
                                ]
                            break
            if best_arr_1t is not None and best_legs_1t is not None:
                candidates.append((best_arr_1t, dep_o_secs, 1, best_legs_1t))

        by_arr = sorted(candidates, key=lambda x: (x[0], -x[1], x[2]))
        by_dep = sorted(((c[1], c[0], c[2], c[3]) for c in candidates), key=lambda x: (x[0], x[1], x[2]))
        self._itineraries_cache[ck] = (by_arr, by_dep)
        return by_arr, by_dep

    def _get_kv_itineraries(
        self, sid: str, o_stop: str, d_stop: str
    ) -> tuple[
        list[tuple[int, int, int, list[tuple[int, int, int]]]],
        list[tuple[int, int, int, list[tuple[int, int, int]]]],
    ]:
        return self._get_network_itineraries("ktm_komuter_kv", sid, o_stop, d_stop)

    def _accumulate_legs(
        self,
        net: str,
        sid: str,
        legs: list[tuple[int, int, int]],
        w: float,
        seg_weights: dict[tuple[str, int, int], float],
        station_deltas: dict[tuple[str, str, int, int], list[float]],
    ) -> None:
        tlist = self.trip_list[(net, sid)]
        for tidx, ps, pe in legs:
            tr = tlist[tidx]
            for pos in range(ps, pe):
                u = tr["stops"][pos]
                v = tr["stops"][pos + 1]
                dep_u = tr["dep_secs"][pos]
                arr_v = tr["arr_secs"][pos + 1]
                v_st_clock = tr["dep_secs"][pos + 1] if (pos + 1) < len(tr["stops"]) - 1 else arr_v

                day_off_u = dep_u // 86400
                hr_u = (dep_u // 3600) % 24
                seg_id = f"{net}:{u}->{v}"
                seg_weights[(seg_id, day_off_u, hr_u)] += w

                sd_u = station_deltas[(u, seg_id, day_off_u, hr_u)]
                if pos == ps:
                    sd_u[2] += w  # Boarded at u
                else:
                    sd_u[0] += w  # Arrived onboard at u
                sd_u[3] += w      # Exits u onto u->v

                if (pos + 1) == pe:
                    day_off_v = v_st_clock // 86400
                    hr_v = (v_st_clock // 3600) % 24
                    sd_v = station_deltas[(v, f"FROM:{u}", day_off_v, hr_v)]
                    sd_v[0] += w
                    sd_v[1] += w

    def get_hour_projection(
        self,
        net: str,
        sid: str,
        orig: str,
        dest: str,
        buffer_secs: int,
        hour: int,
        utara_mode: str = "mixed_50_50_120m",
    ) -> tuple[
        dict[tuple[str, int, int], float],
        dict[tuple[str, str, int, int], tuple[float, float, float, float]],
        float,
        float,
    ]:
        ckey = (net, sid, orig, dest, buffer_secs, hour, utara_mode if net == "ktm_komuter_utara" else "kv")
        if ckey in self._hour_cache:
            return self._hour_cache[ckey]

        path = self.paths[(net, orig, dest)]
        seg_weights: dict[tuple[str, int, int], float] = defaultdict(float)
        station_deltas: dict[tuple[str, str, int, int], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])

        arr_mins = 0.0
        fwd_mins = 0.0

        if net == "ktm_komuter_utara" and utara_mode == "forward_5m_unbounded":
            m = 0
            while m < 60:
                t_ready = hour * 3600.0 + (m + 0.5) * 60.0 + buffer_secs
                res = self._find_best_forward(net, sid, path, t_ready)
                if res is None:
                    break
                _, first_dep, legs = res
                max_m_same = int((first_dep - hour * 3600.0 - 30.0 - buffer_secs) // 60.0)
                end_m = min(59, max(m, max_m_same))
                span = end_m - m + 1
                fwd_mins += span
                self._accumulate_legs(net, sid, legs, span / 60.0, seg_weights, station_deltas)
                m = end_m + 1
        elif net == "ktm_komuter_utara":
            # Generalized bounded matching for Komuter Utara (supports mixed_50_50_120m, forward_5m_120m, arrival_120m_hybrid)
            by_arr, by_dep = self._get_network_itineraries(net, sid, orig, dest)
            arr_times = [x[0] for x in by_arr]
            dep_times = [x[0] for x in by_dep]
            win_secs = 7200

            chosen_weights: dict[tuple[tuple[int, int, int], ...], float] = defaultdict(float)
            for m in range(60):
                t_tx = hour * 3600.0 + (m + 0.5) * 60.0
                target_dep_min = int(t_tx + buffer_secs + 0.9999)
                idx_d = bisect.bisect_left(dep_times, target_dep_min)
                fwd_legs: tuple[tuple[int, int, int], ...] | None = None
                if idx_d < len(dep_times) and (dep_times[idx_d] - t_tx) <= win_secs:
                    fwd_legs = tuple(by_dep[idx_d][3])

                target_arr_max = int(t_tx - buffer_secs)
                idx_a = bisect.bisect_right(arr_times, target_arr_max) - 1
                arr_legs: tuple[tuple[int, int, int], ...] | None = None
                arr_is_direct_arr = False
                if idx_a >= 0 and (t_tx - arr_times[idx_a]) <= win_secs:
                    arr_legs = tuple(by_arr[idx_a][3])
                    arr_is_direct_arr = True
                elif fwd_legs is not None:
                    arr_legs = fwd_legs

                if utara_mode == "forward_5m_120m":
                    if fwd_legs is not None:
                        chosen_weights[fwd_legs] += 1.0 / 60.0
                        fwd_mins += 1.0
                elif utara_mode == "arrival_120m_hybrid":
                    if arr_legs is not None:
                        chosen_weights[arr_legs] += 1.0 / 60.0
                        if arr_is_direct_arr:
                            arr_mins += 1.0
                        else:
                            fwd_mins += 1.0
                else:
                    # Symmetric mixed_50_50_120m reflecting KITS mixed entry/counter/exit timestamps
                    if arr_legs is not None:
                        chosen_weights[arr_legs] += 0.5 / 60.0
                        if arr_is_direct_arr:
                            arr_mins += 0.5
                        else:
                            fwd_mins += 0.5
                    if fwd_legs is not None:
                        chosen_weights[fwd_legs] += 0.5 / 60.0
                        fwd_mins += 0.5

            for key_legs, total_w in chosen_weights.items():
                self._accumulate_legs(net, sid, list(key_legs), total_w, seg_weights, station_deltas)
        else:
            # KV: Arrival-aligned AFC primary (latest arrival <= t_tx - buffer within 90m)
            # + bounded forward fallback (earliest departure in [t_tx + buffer, t_tx + 5400])
            by_arr, by_dep = self._get_network_itineraries("ktm_komuter_kv", sid, orig, dest)
            arr_times = [x[0] for x in by_arr]
            dep_times = [x[0] for x in by_dep]

            chosen_spans: dict[tuple[tuple[int, int, int], ...], list[int]] = defaultdict(lambda: [0, 0])
            for m in range(60):
                t_tx = hour * 3600.0 + (m + 0.5) * 60.0
                target_arr_max = int(t_tx - buffer_secs)
                idx_a = bisect.bisect_right(arr_times, target_arr_max) - 1
                chosen_legs: list[tuple[int, int, int]] | None = None
                is_arr_mode = False

                if idx_a >= 0 and (t_tx - arr_times[idx_a]) <= 5400:
                    chosen_legs = by_arr[idx_a][3]
                    is_arr_mode = True
                else:
                    target_dep_min = int(t_tx + buffer_secs + 0.9999)
                    idx_d = bisect.bisect_left(dep_times, target_dep_min)
                    if idx_d < len(dep_times) and (dep_times[idx_d] - t_tx) <= 5400:
                        chosen_legs = by_dep[idx_d][3]

                if chosen_legs is not None:
                    key_legs = tuple(chosen_legs)
                    if is_arr_mode:
                        chosen_spans[key_legs][0] += 1
                        arr_mins += 1.0
                    else:
                        chosen_spans[key_legs][1] += 1
                        fwd_mins += 1.0

            for key_legs, (ac, fc) in chosen_spans.items():
                self._accumulate_legs(net, sid, list(key_legs), (ac + fc) / 60.0, seg_weights, station_deltas)

        frozen_st = {k: tuple(v) for k, v in station_deltas.items()}
        out = (dict(seg_weights), frozen_st, arr_mins / 60.0, fwd_mins / 60.0)
        self._hour_cache[ckey] = out
        return out


def _compute_utara_temporal_sensitivity(
    segs_by_net: dict[str, list[dict[str, str]]],
    paths: dict[tuple[str, str, str], list[str]],
    active_by_date: dict[str, dict],
    planner: ItineraryPlanner,
    ut_cached_rows: list[tuple[str, int, str, str, int]],
) -> dict:
    """
    Evaluate Komuter Utara temporal-assignment sensitivity across 6 transparent scenarios,
    quantifying both structural bottleneck robustness and max-surge KITS assumption uncertainty.
    """
    net = "ktm_komuter_utara"
    c_nom = SERVICE_CAPACITY_CONFIG[net]["official_2023_nominal"]
    ut_segs = sorted(segs_by_net[net], key=lambda s: s["segment_id"])
    seg_ids = [s["segment_id"] for s in ut_segs]
    seg_labels = {s["segment_id"]: f"{s['from_station_name']} -> {s['to_station_name']}" for s in ut_segs}
    all_dates = sorted(active_by_date)
    n_days = len(all_dates)

    # Precompute hourly scheduled train crossings for komuter_utara
    sched_n: dict[tuple[str, str, int], int] = defaultdict(int)
    for (n_c, sid), tlist in planner.trips_by_svc.items():
        if n_c != net:
            continue
        for tr in tlist:
            for (u, v, dep_u_secs, _, _) in tr["edges"]:
                sched_n[(sid, f"{net}:{u}->{v}", (dep_u_secs // 3600) % 24)] += 1

    anomaly_hours = {(d, h) for (d, h, _) in KITS_BATCH_ANOMALY_HOURS}
    scenario_specs = [
        ("mixed_50_50_120m", "Symmetric 50/50 Mixed (<=120m, +5m) [Adopted Baseline]", "mixed_50_50_120m", False),
        ("mixed_50_50_120m_excl_kits_batch", "Symmetric 50/50 Excl. KITS Batch Spikes (Nov 6 10:00, Nov 8 01:00)", "mixed_50_50_120m", True),
        ("forward_5m_120m", "Forward Departure-Aligned (<=120m, +5m)", "forward_5m_120m", False),
        ("forward_5m_unbounded", "Forward Departure-Aligned (Unbounded Wait, +5m Legacy)", "forward_5m_unbounded", False),
        ("arrival_120m_hybrid", "Arrival-Aligned Primary + Forward Fallback (<=120m, +5m)", "arrival_120m_hybrid", False),
        ("transaction_hour_cohort", "Instantaneous Transaction Clock Hour (No Shift)", "transaction_hour_cohort", False),
    ]

    key_corridor_ids = [
        "ktm_komuter_utara:42400->41400",
        "ktm_komuter_utara:41400->40500",
        "ktm_komuter_utara:43100->42400",
        "ktm_komuter_utara:44400->44000",
        "ktm_komuter_utara:44000->43100",
        "ktm_komuter_utara:40500->600",
    ]
    corridor_results: dict[str, dict[str, dict]] = {cid: {} for cid in key_corridor_ids if cid in seg_labels}
    per_seg_ranges: dict[str, dict[str, list[float]]] = {
        sid_s: {"max_lr": [], "p90_lr": [], "mean_lr": [], "ext_max": []}
        for sid_s in seg_ids
    }
    excl_kits_max_by_seg: dict[str, float] = {}
    network_scenarios = []

    date_cache_obj = {d: dt.date.fromisoformat(d) for d in all_dates}

    for sc_id, sc_label, mode_arg, excl_batch in scenario_specs:
        demand_dh: dict[tuple[str, int, str], float] = defaultdict(float)
        total_pax = 0
        matched_pax = 0.0

        for d_str, hr, o_id, d_id, pax in ut_cached_rows:
            if excl_batch and (d_str, hr) in anomaly_hours:
                continue
            total_pax += pax
            svc_id = active_by_date[d_str][net]
            d_obj = date_cache_obj[d_str]
            if mode_arg == "transaction_hour_cohort":
                p = paths[(net, o_id, d_id)]
                matched_pax += pax
                for i in range(len(p) - 1):
                    demand_dh[(d_str, hr, f"{net}:{p[i]}->{p[i+1]}")] += pax
            else:
                sw, _, af, ff = planner.get_hour_projection(net, svc_id, o_id, d_id, 300, hr, utara_mode=mode_arg)
                matched_pax += pax * (af + ff)
                for (seg_id, day_off, cross_hr), w in sw.items():
                    target_d = d_str if day_off == 0 else (d_obj + dt.timedelta(days=day_off)).isoformat()
                    if target_d <= GTFS_WINDOW_END:
                        demand_dh[(target_d, cross_hr, seg_id)] += pax * w

        top_seg = ("", -1.0, "", -1, 0.0, 0)
        segs_gt100_max = 0
        segs_gt100_p90 = 0
        segs_gt100_mean = 0
        max_def_all = 0.0
        max_ext_all = 0

        for seg_id in seg_ids:
            daily_peaks = []
            seg_max = (-1.0, "", -1, 0.0, 0)
            hr_sum_d = [0.0] * 24
            hr_sum_s = [0] * 24
            for d_str in all_dates:
                svc_id = active_by_date[d_str][net]
                day_best_lr = -1.0
                for h in range(24):
                    dem = demand_dh.get((d_str, h, seg_id), 0.0)
                    n_tr = sched_n.get((svc_id, seg_id, h), 0)
                    s_cap = n_tr * c_nom
                    hr_sum_d[h] += dem
                    hr_sum_s[h] += s_cap
                    if s_cap > 0:
                        lr = dem / s_cap * 100.0
                        if lr > day_best_lr:
                            day_best_lr = lr
                        if lr > seg_max[0]:
                            seg_max = (lr, d_str, h, dem, s_cap)
                if day_best_lr >= 0:
                    daily_peaks.append(day_best_lr)

            daily_peaks.sort()
            p90_idx = max(0, min(len(daily_peaks) - 1, math.ceil(0.90 * len(daily_peaks)) - 1)) if daily_peaks else 0
            p90_lr = round(daily_peaks[p90_idx], 1) if daily_peaks else 0.0
            mean_lr = round(
                max((hr_sum_d[h] / hr_sum_s[h] * 100.0 for h in range(24) if hr_sum_s[h] > 0), default=0.0),
                1,
            )
            max_lr_val = round(max(0.0, seg_max[0]), 1)
            def_max = max(0.0, seg_max[3] - seg_max[4])
            ext_max = math.ceil((def_max - 1e-9) / c_nom) if def_max > 1e-6 else 0

            if max_lr_val > 100.0:
                segs_gt100_max += 1
            if p90_lr > 100.0:
                segs_gt100_p90 += 1
            if mean_lr > 100.0:
                segs_gt100_mean += 1
            if max_lr_val > top_seg[1]:
                top_seg = (seg_id, max_lr_val, seg_max[1], seg_max[2], def_max, ext_max)
            max_def_all = max(max_def_all, def_max)
            max_ext_all = max(max_ext_all, ext_max)

            if sc_id != "mixed_50_50_120m_excl_kits_batch" and sc_id != "transaction_hour_cohort":
                per_seg_ranges[seg_id]["max_lr"].append(max_lr_val)
                per_seg_ranges[seg_id]["p90_lr"].append(p90_lr)
                per_seg_ranges[seg_id]["mean_lr"].append(mean_lr)
                per_seg_ranges[seg_id]["ext_max"].append(float(ext_max))
            if sc_id == "mixed_50_50_120m_excl_kits_batch":
                excl_kits_max_by_seg[seg_id] = max_lr_val
                per_seg_ranges[seg_id]["max_lr"].append(max_lr_val)

            if seg_id in corridor_results:
                corridor_results[seg_id][sc_id] = {
                    "max_lr_pct": max_lr_val,
                    "max_date": seg_max[1],
                    "max_hr": seg_max[2],
                    "p90_lr_pct": p90_lr,
                    "mean_lr_pct": mean_lr,
                    "extra_trains_max": ext_max,
                }

        network_scenarios.append(
            {
                "id": sc_id,
                "label": sc_label,
                "assigned_pax": total_pax,
                "matched_pax": round(matched_pax, 1),
                "matched_pct": round(matched_pax / max(total_pax, 1) * 100.0, 2),
                "unmatched_pax": round(total_pax - matched_pax, 1),
                "top_segment_id": top_seg[0],
                "top_segment_label": seg_labels.get(top_seg[0], top_seg[0]),
                "max_lr_pct": top_seg[1],
                "max_date": top_seg[2],
                "max_hr": top_seg[3],
                "max_deficit": round(max_def_all, 1),
                "max_extra_trains": max_ext_all,
                "segments_gt_100_max": segs_gt100_max,
                "segments_gt_100_p90": segs_gt100_p90,
                "segments_gt_100_mean": segs_gt100_mean,
            }
        )

    per_seg_summary = {}
    for seg_id in seg_ids:
        r = per_seg_ranges[seg_id]
        per_seg_summary[seg_id] = {
            "max_lr_range": [min(r["max_lr"]), max(r["max_lr"])],
            "p90_lr_range": [min(r["p90_lr"]), max(r["p90_lr"])],
            "mean_lr_range": [min(r["mean_lr"]), max(r["mean_lr"])],
            "extra_trains_range": [int(min(r["ext_max"])), int(max(r["ext_max"]))],
            "excl_kits_max_lr": excl_kits_max_by_seg.get(seg_id),
            "robust_p90_gt_100": min(r["p90_lr"]) > 100.0,
            "robust_mean_gt_100": min(r["mean_lr"]) > 100.0,
        }

    out = {
        "gtfs_window": f"{GTFS_WINDOW_START}..{GTFS_WINDOW_END}",
        "days_evaluated": n_days,
        "kits_batch_anomaly_hours": [{"date": d, "hour": h, "note": n} for d, h, n in KITS_BATCH_ANOMALY_HOURS],
        "network_scenarios": network_scenarios,
        "corridor_scenarios": {
            cid: {"label": seg_labels[cid], "scenarios": corridor_results[cid]}
            for cid in corridor_results
        },
        "per_segment": per_seg_summary,
    }
    (OUT_DIR / "utara_temporal_sensitivity.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    return out


def compute_temporal_demand() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    reg, segs_by_net, paths = load_topology_and_paths()
    active_by_date = resolve_active_services_by_date(GTFS_WINDOW_START, GTFS_WINDOW_END)
    planner = ItineraryPlanner(reg, paths)

    seg_demand = defaultdict(lambda: [0.0, 0.0, 0.0])
    station_events_base = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
    station_events_tight = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])

    total_assigned_win_pax = defaultdict(int)
    matched_arr_base = defaultdict(float)
    matched_fwd_base = defaultdict(float)
    unmatched_base = defaultdict(float)
    matched_arr_tight = defaultdict(float)
    matched_fwd_tight = defaultdict(float)
    unmatched_tight = defaultdict(float)
    out_of_window_spill_base = defaultdict(float)

    datasets = [
        ("ktm_komuter_kv", "komuter_2026.csv"),
        ("ktm_komuter_utara", "komuter_utara_2026.csv"),
    ]

    date_cache_obj = {d: dt.date.fromisoformat(d) for d in active_by_date}
    excl_buckets = reg["excluded_station_buckets"]
    station_meta = reg["stations"]

    ut_cached_rows: list[tuple[str, int, str, str, int]] = []

    for net, csv_name in datasets:
        csv_map = reg["csv_to_stop_id"][net]
        pair_cache: dict[tuple[str, str], tuple[str, str | None, str | None]] = {}
        print(f"Processing temporal demand for {net} ({csv_name})...")

        with (RAW_DIR / csv_name).open("r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                d_str = r["date"][:10]
                if not (GTFS_WINDOW_START <= d_str <= GTFS_WINDOW_END):
                    continue
                orig, dest = r["origin"], r["destination"]
                cls = pair_cache.get((orig, dest))
                if cls is None:
                    cls = classify_station_pair(net, orig, dest, csv_map, excl_buckets, station_meta)
                    pair_cache[(orig, dest)] = cls
                if not cls[0].startswith("assigned_"):
                    continue

                o_id, d_id = cls[1], cls[2]
                assert o_id is not None and d_id is not None
                pax = int(float(r["ridership"]))
                hr = int(r["time"].split(":")[0])
                total_assigned_win_pax[net] += pax
                if net == "ktm_komuter_utara":
                    ut_cached_rows.append((d_str, hr, o_id, d_id, pax))

                p = paths[(net, o_id, d_id)]
                for i in range(len(p) - 1):
                    sid_seg = f"{net}:{p[i]}->{p[i+1]}"
                    seg_demand[(net, d_str, hr, sid_seg)][0] += pax

                svc_id = active_by_date[d_str][net]
                d_obj = date_cache_obj[d_str]

                # Base (+5m buffer)
                sw_base, st_base, af_b, ff_b = planner.get_hour_projection(net, svc_id, o_id, d_id, 300, hr)
                matched_arr_base[net] += pax * af_b
                matched_fwd_base[net] += pax * ff_b
                unmatched_base[net] += pax * max(0.0, 1.0 - af_b - ff_b)

                for (sid_seg, day_off, cross_hr), w in sw_base.items():
                    target_d = d_str if day_off == 0 else (d_obj + dt.timedelta(days=day_off)).isoformat()
                    if target_d > GTFS_WINDOW_END:
                        out_of_window_spill_base[net] += pax * w
                        continue
                    seg_demand[(net, target_d, cross_hr, sid_seg)][1] += pax * w

                for (st_id, key2, day_off, st_hr), (di, al, bd, do) in st_base.items():
                    target_d = d_str if day_off == 0 else (d_obj + dt.timedelta(days=day_off)).isoformat()
                    if target_d > GTFS_WINDOW_END:
                        continue
                    acc = station_events_base[(net, target_d, st_hr, st_id, key2)]
                    acc[0] += pax * di
                    acc[1] += pax * al
                    acc[2] += pax * bd
                    acc[3] += pax * do

                # Tight (0m buffer sensitivity)
                sw_tight, st_tight, af_t, ff_t = planner.get_hour_projection(net, svc_id, o_id, d_id, 0, hr)
                matched_arr_tight[net] += pax * af_t
                matched_fwd_tight[net] += pax * ff_t
                unmatched_tight[net] += pax * max(0.0, 1.0 - af_t - ff_t)

                for (sid_seg, day_off, cross_hr), w in sw_tight.items():
                    target_d = d_str if day_off == 0 else (d_obj + dt.timedelta(days=day_off)).isoformat()
                    if target_d > GTFS_WINDOW_END:
                        continue
                    seg_demand[(net, target_d, cross_hr, sid_seg)][2] += pax * w

                for (st_id, key2, day_off, st_hr), (di, al, bd, do) in st_tight.items():
                    target_d = d_str if day_off == 0 else (d_obj + dt.timedelta(days=day_off)).isoformat()
                    if target_d > GTFS_WINDOW_END:
                        continue
                    acc = station_events_tight[(net, target_d, st_hr, st_id, key2)]
                    acc[0] += pax * di
                    acc[1] += pax * al
                    acc[2] += pax * bd
                    acc[3] += pax * do

    seg_csv_path = OUT_DIR / "directional_segment_demand.csv"
    seg_meta_lookup = {sr["segment_id"]: sr for rows in segs_by_net.values() for sr in rows}

    with seg_csv_path.open("w", encoding="utf-8", newline="") as f:
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
            ]
        )
        for (net, d_str, hr, sid_seg) in sorted(seg_demand):
            vals = seg_demand[(net, d_str, hr, sid_seg)]
            sr = seg_meta_lookup[sid_seg]
            writer.writerow(
                [
                    net,
                    d_str,
                    active_by_date[d_str]["day_profile"],
                    hr,
                    sid_seg,
                    sr["from_stop_id"],
                    sr["to_stop_id"],
                    sr["routes_serving"],
                    round(vals[0], 4),
                    round(vals[1], 4),
                    round(vals[2], 4),
                ]
            )

    station_flow_dump = {
        "base": {f"{k[0]}|{k[1]}|{k[2]}|{k[3]}|{k[4]}": [round(x, 6) for x in v] for k, v in station_events_base.items()},
        "tight_0m": {f"{k[0]}|{k[1]}|{k[2]}|{k[3]}|{k[4]}": [round(x, 6) for x in v] for k, v in station_events_tight.items()},
    }
    (OUT_DIR / "station_flow_events.json").write_text(json.dumps(station_flow_dump), encoding="utf-8")

    ut_sensitivity = _compute_utara_temporal_sensitivity(segs_by_net, paths, active_by_date, planner, ut_cached_rows)

    summary = {
        "gtfs_window": f"{GTFS_WINDOW_START}..{GTFS_WINDOW_END}",
        "total_assigned_window_pax": dict(total_assigned_win_pax),
        "matched_arrival_aligned_base_pax": {k: round(v, 2) for k, v in matched_arr_base.items()},
        "matched_forward_aligned_base_pax": {k: round(v, 2) for k, v in matched_fwd_base.items()},
        "unmatched_outside_schedule_base_pax": {k: round(v, 2) for k, v in unmatched_base.items()},
        "unmatched_outside_schedule_tight_0m_pax": {k: round(v, 2) for k, v in unmatched_tight.items()},
        "unmatched_share_base_pct": {
            k: round(unmatched_base[k] / total_assigned_win_pax[k] * 100, 3)
            for k in total_assigned_win_pax
        },
        "out_of_window_midnight_spill_base_pax": {k: round(v, 2) for k, v in out_of_window_spill_base.items()},
        "segment_demand_rows": len(seg_demand),
        "utara_primary_model": "mixed_50_50_120m",
        "utara_sensitivity_scenarios": ut_sensitivity["network_scenarios"],
    }
    (OUT_DIR / "temporal_demand_audit.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print("Backend C Updated Summary:", json.dumps(summary, indent=2))
    return summary


if __name__ == "__main__":
    compute_temporal_demand()
