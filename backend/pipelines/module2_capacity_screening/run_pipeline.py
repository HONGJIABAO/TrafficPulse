from __future__ import annotations

import csv
import datetime as dt
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

from build_references import build_scheduled_service_reference, build_train_capacity_reference
from capacity_gap_engine import compute_capacity_gaps_and_boarding
from gtfs_utils import (
    BASE_DIR,
    DATA_DIR,
    GTFS_WINDOW_END,
    GTFS_WINDOW_START,
    KITS_BATCH_ANOMALY_HOURS,
    OUT_DIR,
    RAW_DIR,
    SERVICE_CAPACITY_CONFIG,
    UNVERIFIED_HOLIDAY_EXCEPTIONS,
    is_date_eligible_for_slice,
    load_topology_and_paths,
    resolve_active_services_by_date,
)
from network_topology import build_topology
from od_path_assignment import run_path_assignment_audit
from scheduled_capacity import compute_scheduled_capacity
from temporal_demand import compute_temporal_demand

REPO_ROOT = BASE_DIR.parent
FRONTEND_DATA_DIR = REPO_ROOT / "frontend" / "src" / "data" / "module2_capacity_screening"
PIPELINE_DIR = Path(__file__).resolve().parent


def percentile_nearest_rank(sorted_vals: list[float], pct: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = min(len(sorted_vals) - 1, max(0, math.ceil(pct * len(sorted_vals)) - 1))
    return sorted_vals[idx]


def collect_unavailable_network_stations(screened_station_names_by_net: dict[str, set[str]]) -> tuple[list[dict], dict]:
    """
    Scan ETS, Intercity, Shuttle Tebrau, Rapid Rail, and excluded Komuter CSV stations
    so every non-screened station/service is searchable with observed ridership and explicit unavailable reason.
    Strictly excludes Rapid Rail 'A0: All Stations' aggregate summary rows!
    """
    unavailable_rows: list[dict] = []
    manifest = json.loads((DATA_DIR / "source_manifest.json").read_text(encoding="utf-8"))

    # 1. Segambut Utara, Segambut 2, Shuttle Selatan stops appearing in komuter_2026.csv
    reg = json.loads((OUT_DIR / "station_registry_local.json").read_text(encoding="utf-8"))
    excl_buckets = reg["excluded_station_buckets"]
    audit_b = json.loads((OUT_DIR / "od_path_assignment_audit.json").read_text(encoding="utf-8"))
    kv_excl_full = audit_b["ktm_komuter_kv"]["excluded_special_stations_full_period"]
    kv_excl_win = audit_b["ktm_komuter_kv"]["excluded_special_stations_gtfs_window"]
    ku_excl_full = audit_b["ktm_komuter_utara"]["excluded_special_stations_full_period"]

    reason_text = {
        "excluded_admin_non_station": "Administrative / penalty ticketing pseudo-station; excluded from physical segment loading.",
        "excluded_unverified_gtfs_stop": "Observed in Komuter OD ticketing (May-Nov 2026), absent from active ktmb_gtfs.zip stops.txt and timetables; capacity screening unavailable without verified GTFS stop sequence.",
        "excluded_out_of_service_scope": "Outside Klang Valley Komuter GTFS corridor (Shuttle Selatan / ETS feeder ticketing sold on Komuter gates).",
    }
    for st_name, bucket in sorted(excl_buckets.items()):
        if bucket == "excluded_admin_non_station":
            continue  # Keep Penalty/Unknown in audit totals rather than polluting real station search
        pax_full = kv_excl_full.get(st_name, 0)
        pax_win = kv_excl_win.get(st_name, 0)
        if pax_full == 0:
            continue
        unavailable_rows.append(
            {
                "station_key": f"unavail:komuter_kv:{st_name}",
                "station_name": st_name,
                "network_code": "ktm_komuter_kv_unmapped",
                "network_label": "KTM Komuter KV (Unverified GTFS Stop)" if bucket == "excluded_unverified_gtfs_stop" else "KTM Cross-Service Ticketing",
                "status": "unavailable",
                "unavailable_code": bucket,
                "unavailable_reason": reason_text[bucket],
                "observed_pax_gtfs_window": pax_win,
                "observed_pax_full_2026": pax_full,
            }
        )

    # 2. ETS, Intercity, Shuttle Tebrau
    other_ktmb_specs = [
        (
            "ets_2026.csv",
            "ktm_ets",
            "KTM ETS (Intercity Electric)",
            "unavailable_seated_and_express_mismatch",
            "Hourly OD available, but ETS-REDCARD provides seated-only capacity (315 pax) without train_number attribution across variable skip-stop express patterns.",
        ),
        (
            "intercity_2026.csv",
            "ktm_intercity",
            "KTM Intercity (SH & ERT)",
            "unavailable_seated_and_mixed_stock",
            "intercity_2026.csv pools SH (4-car DMU, 198 seated-only) and ERT (loco-hauled) without train_id; total train capacity unavailable.",
        ),
        (
            "shuttle_tebrau_2026.csv",
            "ktm_shuttle_tebrau",
            "KTM Shuttle Tebrau",
            "unavailable_no_capacity_reference",
            "Hourly OD available (shuttle_tebrau_2026.csv), but rolling-stock capacity specification is absent from ETS-REDCARD.pdf.",
        ),
    ]
    other_totals = {}
    for fn, ncode, nlabel, ucode, ureason in other_ktmb_specs:
        st_full = Counter()
        st_win = Counter()
        tot_full = 0
        tot_win = 0
        with (RAW_DIR / fn).open("r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                d_str = r["date"][:10]
                if d_str > GTFS_WINDOW_END:
                    continue
                pax = int(float(r["ridership"]))
                tot_full += pax
                in_win = GTFS_WINDOW_START <= d_str <= GTFS_WINDOW_END
                if in_win:
                    tot_win += pax
                for col in ("origin", "destination"):
                    st_full[r[col]] += pax
                    if in_win:
                        st_win[r[col]] += pax
        other_totals[ncode] = {"full_pax": tot_full, "gtfs_win_pax": tot_win, "stations": len(st_full)}
        for st_name in sorted(st_full):
            unavailable_rows.append(
                {
                    "station_key": f"unavail:{ncode}:{st_name}",
                    "station_name": st_name,
                    "network_code": ncode,
                    "network_label": nlabel,
                    "status": "unavailable",
                    "unavailable_code": ucode,
                    "unavailable_reason": ureason,
                    "observed_pax_gtfs_window": st_win[st_name],
                    "observed_pax_full_2026": st_full[st_name],
                }
            )

    # 3. Rapid Rail daily OD (strictly exclude 'A0: All Stations' aggregate row!)
    rr_full = Counter()
    rr_win = Counter()
    rr_a0_excluded_pax = 0
    rr_net_full_pax = 0
    rr_net_win_pax = 0
    with (RAW_DIR / "rapidrail_2026_daily.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            o, d = r["origin"], r["destination"]
            d_str = r["date"][:10]
            if d_str > GTFS_WINDOW_END:
                continue
            pax = int(float(r["ridership"]))
            if o.startswith("A0:") or d.startswith("A0:"):
                rr_a0_excluded_pax += pax
                continue
            rr_net_full_pax += pax
            in_win = GTFS_WINDOW_START <= d_str <= GTFS_WINDOW_END
            if in_win:
                rr_net_win_pax += pax
            rr_full[o] += pax
            rr_full[d] += pax
            if in_win:
                rr_win[o] += pax
                rr_win[d] += pax

    other_totals["rapid_rail"] = {
        "full_pax_excl_a0": rr_net_full_pax,
        "gtfs_win_pax_excl_a0": rr_net_win_pax,
        "a0_aggregate_rows_excluded_pax": rr_a0_excluded_pax,
        "stations": len(rr_full),
    }
    for st_name in sorted(rr_full):
        unavailable_rows.append(
            {
                "station_key": f"unavail:rapid_rail:{st_name}",
                "station_name": st_name,
                "network_code": "rapid_rail",
                "network_label": "Rapid Rail (LRT / MRT / Monorail)",
                "status": "unavailable",
                "unavailable_code": "unavailable_daily_od_only",
                "unavailable_reason": "rapidrail_2026_daily.csv reports daily-only OD without hourly timestamps and mixes 2/4/6-car fleet frequencies; hourly demand & capacity screening unavailable.",
                "observed_pax_gtfs_window": rr_win[st_name],
                "observed_pax_full_2026": rr_full[st_name],
            }
        )

    other_totals["ktmb_komuter_admin_excluded_pax"] = {
        "kv_penalty": kv_excl_full.get("Penalty", 0),
        "kv_unknown": kv_excl_full.get("Unknown", 0),
        "utara_penalty": ku_excl_full.get("Penalty", 0),
        "utara_unknown": ku_excl_full.get("Unknown", 0),
    }
    other_totals["observation_window_comparison"] = {
        "panel1_station_demand_period": "2026-01-01..2026-11-20 (324 days; aligned pre-freeze snapshot)",
        "panel2_unavailable_full_period": f"2026-01-01..{GTFS_WINDOW_END} (330 days; bounded KTMB/Prasarana 2026 archive)",
        "panel2_screening_gtfs_window": f"{GTFS_WINDOW_START}..{GTFS_WINDOW_END} (100 matched KV days excl. 2026-11-09 unverified holiday; 101 operational Utara days)",
    }
    other_totals["manifest_raw_files"] = manifest.get("sources", [])
    return unavailable_rows, other_totals


def export_frontend_bundles() -> dict:
    FRONTEND_DATA_DIR.mkdir(parents=True, exist_ok=True)
    reg, segs_by_net, _ = load_topology_and_paths()
    active_by_date = resolve_active_services_by_date(GTFS_WINDOW_START, GTFS_WINDOW_END)

    seg_meta = {sr["segment_id"]: sr for rows in segs_by_net.values() for sr in rows}
    station_meta = reg["stations"]

    # Determine verified eligible dates per (network_code, period_scope, day_profile)
    # Excludes 2026-11-09 (Deepavali replacement holiday omitted from calendar_dates.txt) from
    # normal weekdays across both networks and from KV matched capacity comparisons altogether,
    # while Utara keeps its constant 1,1,1,1,1,1,1 daily schedule in 'all' (101d).
    slice_dates_by_net: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for d_str, info in sorted(active_by_date.items()):
        ym = d_str[:7]
        for net in ("ktm_komuter_kv", "ktm_komuter_utara"):
            for p in ("aug18_nov26_all", ym):
                for prof in ("all", "weekday", "weekend"):
                    if is_date_eligible_for_slice(info, net, prof):
                        slice_dates_by_net[(net, p, prof)].append(d_str)

    # Read Backend E CSV once into memory keyed by (segment_id, date, clock_hour)
    seg_obs: dict[str, dict[tuple[str, int], tuple[float, float, float, int, int, int]]] = defaultdict(dict)
    # Value tuple: (d_tx, d_base, d_tight, n_tr, s_nom, s_80)
    with (OUT_DIR / "potential_capacity_gap.csv").open("r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            seg_obs[r["segment_id"]][(r["date"], int(r["clock_hour"]))] = (
                float(r["demand_tx_cohort"]),
                float(r["demand_sched_base"]),
                float(r["demand_sched_tight_0m"]),
                int(r["scheduled_trains_n"]),
                int(r["scheduled_capacity_nominal_s"]),
                int(r["scheduled_trains_n"]) * SERVICE_CAPACITY_CONFIG[r["network_code"]]["planning_sensitivity_80pct"],
            )

    # Read Backend F CSV into memory keyed by (outbound_segment_id, date, clock_hour)
    st_obs: dict[str, dict[tuple[str, int], tuple[float | None, float | None, float | None, float, float, float | None, float | None]]] = defaultdict(dict)
    # Value tuple: (d_in, a_al, t_thru, b_board, d_out, avail_nom, avail_80)
    with (OUT_DIR / "station_boarding_capacity.csv").open("r", encoding="utf-8", newline="") as f:
        for r in csv.DictReader(f):
            st_obs[r["outbound_segment_id"]][(r["date"], int(r["clock_hour"]))] = (
                None if r["d_in_arriving"] == "" else float(r["d_in_arriving"]),
                None if r["a_alighting"] == "" else float(r["a_alighting"]),
                None if r["t_through_onboard"] == "" else float(r["t_through_onboard"]),
                float(r["b_boarding_demand"]),
                float(r["d_out_segment_demand"]),
                None if r["available_boarding_capacity_nominal"] == "" else float(r["available_boarding_capacity_nominal"]),
                None if r["available_boarding_capacity_80pct"] == "" else float(r["available_boarding_capacity_80pct"]),
            )

    ut_sens_path = OUT_DIR / "utara_temporal_sensitivity.json"
    ut_sensitivity = json.loads(ut_sens_path.read_text(encoding="utf-8")) if ut_sens_path.exists() else {}
    ut_per_seg_sens = ut_sensitivity.get("per_segment", {})

    def _compact_nums(arr: list[float]) -> list[int | float]:
        return [0 if abs(v) < 1e-6 else (int(round(v)) if abs(v - round(v)) < 1e-6 else round(v, 1)) for v in arr]

    # Deduplicated 24h single-day GTFS schedule profiles [cap_nom_24, trains_24]
    sched_catalog: list[list[list[int]]] = []
    sched_index_map: dict[tuple[int, ...], int] = {}

    def _register_day_schedule(obs_map: dict[tuple[str, int], tuple], d_str: str) -> int | None:
        if not d_str:
            return None
        caps = [obs_map.get((d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[4] for h in range(24)]
        trs = [obs_map.get((d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[3] for h in range(24)]
        sig = tuple(caps) + tuple(trs)
        if sig not in sched_index_map:
            sched_index_map[sig] = len(sched_catalog)
            sched_catalog.append([caps, trs])
        return sched_index_map[sig]

    # Aggregate each segment across every (period_scope, day_profile) and compute peak-hour + coherent P90/Max profiles
    segment_rows_out: list[dict] = []
    hourly_profiles_out: dict[str, dict] = {}
    slice_day_counts = {
        f"{p}|{prof}": len(ds)
        for (net_k, p, prof), ds in sorted(slice_dates_by_net.items())
        if net_k == "ktm_komuter_kv"
    }
    slice_day_counts_by_net = {
        net_k: {
            f"{p}|{prof}": len(ds)
            for (n2, p, prof), ds in sorted(slice_dates_by_net.items())
            if n2 == net_k
        }
        for net_k in ("ktm_komuter_kv", "ktm_komuter_utara")
    }

    all_slice_keys = sorted({(p, prof) for (_, p, prof) in slice_dates_by_net.keys()})

    for seg_id in sorted(seg_meta):
        sr = seg_meta[seg_id]
        net = sr["network_code"]
        cfg = SERVICE_CAPACITY_CONFIG[net]
        c_nom = cfg["official_2023_nominal"]
        c_80 = cfg["planning_sensitivity_80pct"]
        obs_by_dh = seg_obs.get(seg_id, {})
        st_by_dh = st_obs.get(seg_id, {})
        is_fallback = (
            station_meta[f"{net}:{sr['from_stop_id']}"]["in_degree"] > 2
            or station_meta[f"{net}:{sr['from_stop_id']}"]["out_degree"] > 2
        )

        seg_metrics_by_slice: dict[str, dict] = {}

        for (period_code, day_prof) in all_slice_keys:
            dates = slice_dates_by_net[(net, period_code, day_prof)]
            n_days = len(dates)
            skey = f"{period_code}|{day_prof}"

            hr_base = [[] for _ in range(24)]
            hr_tight = [[] for _ in range(24)]
            hr_tx = [[] for _ in range(24)]
            hr_cap_nom = [[] for _ in range(24)]
            hr_trains = [[] for _ in range(24)]
            hr_b_board = [[] for _ in range(24)]
            hr_t_thru = [[] for _ in range(24)]

            # Collect coherent per-date peak records (lr_nom, d_base, hr, d_str, s_nom, n_tr)
            daily_peak_records: list[tuple[float, float, int, str, int, int]] = []
            best_base_peak = (-1.0, 0.0, -1, "", 0, 0)  # (lr_nom, d_base, hr, d_str, s_nom, n_tr)
            days_with_deficit_nom = 0
            days_with_deficit_80 = 0
            total_base_demand_slice = 0.0
            total_b_board_slice = 0.0

            for d_str in dates:
                day_best: tuple[float, float, int, str, int, int] | None = None
                had_def_nom = False
                had_def_80 = False

                for hr in range(24):
                    d_tx, d_base, d_tight, n_tr, s_nom, s_80 = obs_by_dh.get((d_str, hr), (0.0, 0.0, 0.0, 0, 0, 0))
                    hr_base[hr].append(d_base)
                    hr_tight[hr].append(d_tight)
                    hr_tx[hr].append(d_tx)
                    hr_cap_nom[hr].append(s_nom)
                    hr_trains[hr].append(n_tr)
                    total_base_demand_slice += d_base

                    st_t = st_by_dh.get((d_str, hr))
                    if st_t is not None:
                        hr_b_board[hr].append(st_t[3])
                        total_b_board_slice += st_t[3]
                        if not is_fallback and st_t[2] is not None:
                            hr_t_thru[hr].append(st_t[2])
                    else:
                        hr_b_board[hr].append(0.0)

                    if s_nom > 0:
                        lr_n = d_base / s_nom * 100.0
                        def_n = max(0.0, d_base - s_nom)
                        def_8 = max(0.0, d_base - s_80)
                        if def_n > 1e-6:
                            had_def_nom = True
                        if def_8 > 1e-6:
                            had_def_80 = True
                        rec = (lr_n, d_base, hr, d_str, s_nom, n_tr)
                        if day_best is None or rec > day_best:
                            day_best = rec
                        if rec > best_base_peak:
                            best_base_peak = rec

                if day_best is not None:
                    daily_peak_records.append(day_best)
                if had_def_nom:
                    days_with_deficit_nom += 1
                if had_def_80:
                    days_with_deficit_80 += 1

            # Per-hour means across this slice
            mean_base_h = [round(sum(x) / n_days, 1) if n_days > 0 else 0.0 for x in hr_base]
            mean_tight_h = [round(sum(x) / n_days, 1) if n_days > 0 else 0.0 for x in hr_tight]
            mean_tx_h = [round(sum(x) / n_days, 1) if n_days > 0 else 0.0 for x in hr_tx]
            mean_cap_nom_h = [round(sum(x) / n_days, 1) if n_days > 0 else 0.0 for x in hr_cap_nom]
            mean_trains_h = [round(sum(x) / n_days, 2) if n_days > 0 else 0.0 for x in hr_trains]
            mean_b_h = [round(sum(x) / n_days, 1) if n_days > 0 else 0.0 for x in hr_b_board]
            mean_t_h = [round(sum(x) / n_days, 1) if x else None for x in hr_t_thru]

            # Find peak mean hour (highest ratio-of-means among hours with service)
            best_mean_hr = 0
            best_mean_lr_nom = -1.0
            for hr in range(24):
                if mean_cap_nom_h[hr] > 0:
                    lr = mean_base_h[hr] / mean_cap_nom_h[hr] * 100.0
                    if lr > best_mean_lr_nom:
                        best_mean_lr_nom = lr
                        best_mean_hr = hr

            # Coherent Nearest-Rank P90 representative single-day observation
            if daily_peak_records:
                sorted_daily = sorted(daily_peak_records)
                p90_idx = min(len(sorted_daily) - 1, max(0, math.ceil(0.90 * len(sorted_daily)) - 1))
                p90_rec = sorted_daily[p90_idx]
                _, p90_d_raw, p90_hr, p90_d_str, p90_s_nom, p90_trains = p90_rec
                p90_d_val = round(p90_d_raw, 1)
                p90_s_80 = p90_trains * c_80
                p90_lr_nom = round(p90_d_raw / p90_s_nom * 100.0, 1) if p90_s_nom > 0 else None
                p90_def_nom = round(max(0.0, p90_d_raw - p90_s_nom), 1)
                p90_ext_nom = math.ceil((p90_def_nom - 1e-9) / c_nom) if p90_def_nom > 1e-6 else 0
                p90_lr_80 = round(p90_d_raw / p90_s_80 * 100.0, 1) if p90_s_80 > 0 else None
                p90_def_80 = round(max(0.0, p90_d_raw - p90_s_80), 1)
                p90_ext_80 = math.ceil((p90_def_80 - 1e-9) / c_80) if p90_def_80 > 1e-6 else 0

                p90_st_rec = st_by_dh.get((p90_d_str, p90_hr))
                p90_t_val = None if is_fallback or not p90_st_rec or p90_st_rec[2] is None else round(p90_st_rec[2], 1)
                p90_b_val = round(p90_st_rec[3], 1) if p90_st_rec else 0.0
                p90_avail_nom = None if is_fallback or p90_t_val is None else round(max(0.0, p90_s_nom - p90_t_val), 1)
                p90_bgap_nom = None if is_fallback or p90_avail_nom is None else round(max(0.0, p90_b_val - p90_avail_nom), 1)
                p90_up_full = bool(p90_t_val is not None and p90_s_nom > 0 and p90_t_val > p90_s_nom)
            else:
                p90_hr = 0
                p90_d_str = ""
                p90_d_val = 0.0
                p90_s_nom = 0
                p90_trains = 0
                p90_lr_nom = None
                p90_def_nom = 0.0
                p90_ext_nom = 0
                p90_lr_80 = None
                p90_def_80 = 0.0
                p90_ext_80 = 0
                p90_t_val = None
                p90_b_val = 0.0
                p90_avail_nom = None
                p90_bgap_nom = None
                p90_up_full = False

            # Max single-date peak observation
            max_has_obs = best_base_peak[0] >= 0 and best_base_peak[3] != ""
            max_pk_d_str = best_base_peak[3] if max_has_obs else ""
            max_pk_hr = best_base_peak[2] if max_has_obs else 0
            max_d_raw = best_base_peak[1] if max_has_obs else 0.0
            max_s_nom = best_base_peak[4] if max_has_obs else 0
            max_trains = best_base_peak[5] if max_has_obs else 0
            max_s_80 = max_trains * c_80
            max_lr_nom = round(max_d_raw / max_s_nom * 100.0, 1) if max_s_nom > 0 else None
            max_def_nom = round(max(0.0, max_d_raw - max_s_nom), 1) if max_s_nom > 0 else 0.0
            max_ext_nom = math.ceil((max_def_nom - 1e-9) / c_nom) if max_def_nom > 1e-6 else 0
            max_lr_80 = round(max_d_raw / max_s_80 * 100.0, 1) if max_s_80 > 0 else None
            max_def_80 = round(max(0.0, max_d_raw - max_s_80), 1) if max_s_80 > 0 else 0.0
            max_ext_80 = math.ceil((max_def_80 - 1e-9) / c_80) if max_def_80 > 1e-6 else 0

            # Export FULL coherent 24h profiles for ALL 5 periods x 3 dayProfiles!
            p90_day_d = _compact_nums([obs_by_dh.get((p90_d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[1] for h in range(24)]) if p90_d_str else [0] * 24
            p90_day_tight = _compact_nums([obs_by_dh.get((p90_d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[2] for h in range(24)]) if p90_d_str else [0] * 24
            p90_day_tx = _compact_nums([obs_by_dh.get((p90_d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[0] for h in range(24)]) if p90_d_str else [0] * 24

            max_day_d = _compact_nums([obs_by_dh.get((max_pk_d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[1] for h in range(24)]) if max_pk_d_str else [0] * 24
            max_day_tight = _compact_nums([obs_by_dh.get((max_pk_d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[2] for h in range(24)]) if max_pk_d_str else [0] * 24
            max_day_tx = _compact_nums([obs_by_dh.get((max_pk_d_str, h), (0.0, 0.0, 0.0, 0, 0, 0))[0] for h in range(24)]) if max_pk_d_str else [0] * 24

            hourly_profiles_out[f"{seg_id}|{skey}"] = {
                "mean_d": _compact_nums(mean_base_h),
                "mean_tight": _compact_nums(mean_tight_h),
                "mean_tx": _compact_nums(mean_tx_h),
                "cap_nom_mean": _compact_nums(mean_cap_nom_h),
                "trains_mean": [round(x, 2) if x % 1 else int(x) for x in mean_trains_h],
                "b_mean": _compact_nums(mean_b_h),
                "t_mean": mean_t_h if not is_fallback else None,
                "peak_mean_hr": best_mean_hr,
                "p90_date": p90_d_str,
                "p90_hr": p90_hr,
                "p90_sched_idx": _register_day_schedule(obs_by_dh, p90_d_str),
                "p90_d": p90_day_d,
                "p90_tight": p90_day_tight,
                "p90_tx": p90_day_tx,
                "max_date": max_pk_d_str,
                "max_hr": max_pk_hr,
                "max_sched_idx": _register_day_schedule(obs_by_dh, max_pk_d_str),
                "max_d": max_day_d,
                "max_tight": max_day_tight,
                "max_tx": max_day_tx,
            }

            mean_hr_d = mean_base_h[best_mean_hr]
            mean_hr_s_nom = mean_cap_nom_h[best_mean_hr]
            mean_hr_s_80 = round(mean_hr_s_nom * (c_80 / c_nom), 1)
            mean_hr_def_nom = round(max(0.0, mean_hr_d - mean_hr_s_nom), 1)
            mean_hr_def_80 = round(max(0.0, mean_hr_d - mean_hr_s_80), 1)
            mean_hr_ext_nom = math.ceil((mean_hr_def_nom - 1e-9) / c_nom) if mean_hr_def_nom > 1e-6 else 0
            mean_hr_ext_80 = math.ceil((mean_hr_def_80 - 1e-9) / c_80) if mean_hr_def_80 > 1e-6 else 0

            # Station peak-hour boarding values at peak mean hour and max-date peak hour
            pk_hr_m = best_mean_hr
            pk_b_mean = mean_b_h[pk_hr_m]
            pk_t_mean = None if is_fallback or mean_t_h[pk_hr_m] is None else mean_t_h[pk_hr_m]
            pk_avail_nom = None if is_fallback or pk_t_mean is None else round(max(0.0, mean_hr_s_nom - pk_t_mean), 1)
            pk_gap_nom = None if is_fallback or pk_avail_nom is None else round(max(0.0, pk_b_mean - pk_avail_nom), 1)

            max_st_rec = st_by_dh.get((max_pk_d_str, max_pk_hr)) if max_pk_d_str else None
            max_t_val = None if is_fallback or not max_st_rec or max_st_rec[2] is None else round(max_st_rec[2], 1)
            max_b_val = round(max_st_rec[3], 1) if max_st_rec else 0.0
            max_avail_nom = None if is_fallback or max_t_val is None else round(max(0.0, max_s_nom - max_t_val), 1)
            max_bgap_nom = None if is_fallback or max_avail_nom is None else round(max(0.0, max_b_val - max_avail_nom), 1)

            seg_metrics_by_slice[skey] = {
                "day_count": n_days,
                "daily_avg_flow": round(total_base_demand_slice / n_days, 1) if n_days > 0 else 0.0,
                "daily_avg_boardings": round(total_b_board_slice / n_days, 1) if n_days > 0 else 0.0,
                # Mean peak-hour metrics
                "mean_peak_hr": best_mean_hr,
                "mean_peak_d": mean_hr_d,
                "mean_peak_s_nom": mean_hr_s_nom,
                "mean_peak_lr_nom": round(best_mean_lr_nom, 1) if best_mean_lr_nom >= 0 else None,
                "mean_peak_def_nom": mean_hr_def_nom,
                "mean_peak_ext_nom": mean_hr_ext_nom,
                "mean_peak_lr_80": round(mean_hr_d / mean_hr_s_80 * 100.0, 1) if mean_hr_s_80 > 0 else None,
                "mean_peak_def_80": mean_hr_def_80,
                "mean_peak_ext_80": mean_hr_ext_80,
                # Coherent representative nearest-rank P90 metrics
                "p90_peak_hr": p90_hr,
                "p90_peak_date": p90_d_str,
                "p90_peak_d": p90_d_val,
                "p90_peak_s_nom": p90_s_nom,
                "p90_peak_trains": p90_trains,
                "p90_peak_lr_nom": p90_lr_nom,
                "p90_peak_def_nom": p90_def_nom,
                "p90_peak_ext_nom": p90_ext_nom,
                "p90_peak_lr_80": p90_lr_80,
                "p90_peak_def_80": p90_def_80,
                "p90_peak_ext_80": p90_ext_80,
                # Max observed single-date metrics
                "max_peak_hr": max_pk_hr,
                "max_peak_date": max_pk_d_str,
                "max_peak_d": round(max_d_raw, 1),
                "max_peak_s_nom": max_s_nom,
                "max_peak_trains": max_trains,
                "max_peak_lr_nom": max_lr_nom,
                "max_peak_def_nom": max_def_nom,
                "max_peak_ext_nom": max_ext_nom,
                "max_peak_lr_80": max_lr_80,
                "max_peak_def_80": max_def_80,
                "max_peak_ext_80": max_ext_80,
                "days_deficit_nom": days_with_deficit_nom,
                "days_deficit_80": days_with_deficit_80,
                "is_kits_anomaly_peak_date": max_pk_d_str in {"2026-11-06", "2026-11-08"},
                # Station boarding snapshots at Mean, coherent P90, and Max-date peak hours
                "st_mean_t": pk_t_mean,
                "st_mean_b": pk_b_mean,
                "st_mean_avail_nom": pk_avail_nom,
                "st_mean_gap_nom": pk_gap_nom,
                "st_p90_t": p90_t_val,
                "st_p90_b": p90_b_val,
                "st_p90_avail_nom": p90_avail_nom,
                "st_p90_gap_nom": p90_bgap_nom,
                "st_upstream_full_p90": p90_up_full,
                "st_max_t": max_t_val,
                "st_max_b": max_b_val,
                "st_max_avail_nom": max_avail_nom,
                "st_max_gap_nom": max_bgap_nom,
                "st_upstream_full_max": bool(max_t_val is not None and max_s_nom > 0 and max_t_val > max_s_nom),
                # Comparison deltas at exact peak-date tight & tx alternatives
                "tight_peak_max_d": round(obs_by_dh.get((max_pk_d_str, max_pk_hr), (0.0, 0.0, 0.0, 0, 0, 0))[2], 1) if max_pk_d_str else 0.0,
                "tx_peak_max_d": round(obs_by_dh.get((max_pk_d_str, max_pk_hr), (0.0, 0.0, 0.0, 0, 0, 0))[0], 1) if max_pk_d_str else 0.0,
            }

        segment_rows_out.append(
            {
                "segment_id": seg_id,
                "network_code": net,
                "from_stop_id": sr["from_stop_id"],
                "to_stop_id": sr["to_stop_id"],
                "from_station_name": sr["from_station_name"],
                "to_station_name": sr["to_station_name"],
                "routes_serving": sr["routes_serving"].split("|"),
                "is_shared_trunk": sr["is_shared_trunk"] == "true",
                "boarding_screening_mode": "fallback_downstream_segment" if is_fallback else "full_station_boarding",
                "gtfs_interpolated_missing_stop": sr["gtfs_interpolated_missing_stop"] == "true",
                "train_capacity_nom": c_nom,
                "train_capacity_80": c_80,
                "sensitivity": ut_per_seg_sens.get(seg_id),
                "metrics": seg_metrics_by_slice,
            }
        )

    # Assemble station directory (one entry per unique screened station with all outbound directions + unavailable stations)
    screened_names_by_net: dict[str, set[str]] = defaultdict(set)
    segs_from_station: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in segment_rows_out:
        segs_from_station[(row["network_code"], row["from_stop_id"])].append(row)

    station_entries_out: list[dict] = []
    for st_key in sorted(station_meta):
        sm = station_meta[st_key]
        net = sm["network_code"]
        sid = sm["stop_id"]
        screened_names_by_net[net].add(sm["station_name"])
        out_segs = segs_from_station[(net, sid)]
        station_entries_out.append(
            {
                "station_key": st_key,
                "station_name": sm["station_name"],
                "stop_id": sid,
                "network_code": net,
                "network_label": SERVICE_CAPACITY_CONFIG[net]["label"],
                "routes_serving": sm["routes_serving"],
                "is_junction": sm["is_junction"],
                "boarding_screening_mode": "fallback_downstream_segment" if sm["is_junction"] else "full_station_boarding",
                "status": "screened",
                "lat": sm["lat"],
                "lon": sm["lon"],
                "outbound_segments": [
                    {
                        "segment_id": osg["segment_id"],
                        "to_stop_id": osg["to_stop_id"],
                        "to_station_name": osg["to_station_name"],
                        "gtfs_interpolated_missing_stop": osg["gtfs_interpolated_missing_stop"],
                    }
                    for osg in out_segs
                ],
            }
        )

    unavailable_stations, other_network_stats = collect_unavailable_network_stations(screened_names_by_net)

    # Compute isolated Nov 9 Deepavali Replacement Holiday sensitivity
    nov09_kv_segs = []
    nov09_ut_segs = []
    nov09_ref_we_date = "2026-11-08"
    for seg_id in sorted(seg_meta):
        sr = seg_meta[seg_id]
        net = sr["network_code"]
        c_nom = SERVICE_CAPACITY_CONFIG[net]["official_2023_nominal"]
        obs_by_dh = seg_obs.get(seg_id, {})
        if net == "ktm_komuter_kv":
            for h in range(24):
                _, d_base, _, n_wd, s_wd, _ = obs_by_dh.get(("2026-11-09", h), (0.0, 0.0, 0.0, 0, 0, 0))
                _, _, _, n_we, s_we, _ = obs_by_dh.get((nov09_ref_we_date, h), (0.0, 0.0, 0.0, 0, 0, 0))
                if d_base > 0 and (s_wd > 0 or s_we > 0):
                    nov09_kv_segs.append(
                        (
                            d_base / s_wd * 100.0 if s_wd > 0 else 0.0,
                            seg_id,
                            f"{sr['from_station_name']} -> {sr['to_station_name']}",
                            h,
                            round(d_base, 1),
                            s_wd,
                            s_we,
                            round(d_base / s_we * 100.0, 1) if s_we > 0 else None,
                        )
                    )
        else:
            for h in range(24):
                _, d_base, _, n_tr, s_ut, _ = obs_by_dh.get(("2026-11-09", h), (0.0, 0.0, 0.0, 0, 0, 0))
                if s_ut > 0 and d_base > 0:
                    nov09_ut_segs.append(
                        (d_base / s_ut * 100.0, seg_id, f"{sr['from_station_name']} -> {sr['to_station_name']}", h, round(d_base, 1), s_ut)
                    )

    nov09_kv_segs.sort(reverse=True)
    nov09_ut_segs.sort(reverse=True)
    nov09_holiday_sensitivity = {
        "date": "2026-11-09",
        "holiday_name": "Deepavali Replacement Public Holiday (Monday)",
        "reason": UNVERIFIED_HOLIDAY_EXCEPTIONS["2026-11-09"]["notes"],
        "ktm_komuter_kv": {
            "treatment": "Excluded from matched KV weekday & all capacity slices; audited separately",
            "top_hour_under_gtfs_weekday_if_unexcluded": {
                "segment_id": nov09_kv_segs[0][1] if nov09_kv_segs else None,
                "label": nov09_kv_segs[0][2] if nov09_kv_segs else None,
                "clock_hour": nov09_kv_segs[0][3] if nov09_kv_segs else None,
                "demand": nov09_kv_segs[0][4] if nov09_kv_segs else 0.0,
                "gtfs_weekday_cap": nov09_kv_segs[0][5] if nov09_kv_segs else 0,
                "load_ratio_under_gtfs_weekday_pct": round(nov09_kv_segs[0][0], 1) if nov09_kv_segs else None,
                "hypothetical_weekend_cap": nov09_kv_segs[0][6] if nov09_kv_segs else 0,
                "load_ratio_under_weekend_cap_pct": nov09_kv_segs[0][7] if nov09_kv_segs else None,
            },
        },
        "ktm_komuter_utara": {
            "treatment": "Valid under constant 1,1,1,1,1,1,1 daily timetable (kept in 'all' 101d; excluded from normal non-holiday 'weekday' 69d)",
            "top_hour": {
                "segment_id": nov09_ut_segs[0][1] if nov09_ut_segs else None,
                "label": nov09_ut_segs[0][2] if nov09_ut_segs else None,
                "clock_hour": nov09_ut_segs[0][3] if nov09_ut_segs else None,
                "demand": nov09_ut_segs[0][4] if nov09_ut_segs else 0.0,
                "scheduled_cap": nov09_ut_segs[0][5] if nov09_ut_segs else 0,
                "load_ratio_pct": round(nov09_ut_segs[0][0], 1) if nov09_ut_segs else None,
            },
        },
    }

    summary_payload = {
        "metadata": {
            "gtfs_window_start": GTFS_WINDOW_START,
            "gtfs_window_end": GTFS_WINDOW_END,
            "excluded_pre_gtfs_window": "2026-01-01..2026-08-17",
            "slice_day_counts": slice_day_counts,
            "slice_day_counts_by_net": slice_day_counts_by_net,
            "capacity_config": SERVICE_CAPACITY_CONFIG,
            "default_filters": {
                "network": "all",
                "day_profile": "weekday",
                "period": "aug18_nov26_all",
                "capacity_mode": "official_2023_nominal",
                "stat_mode": "max_date",
                "temporal_method": "schedule_traversal_base",
            },
            "scenario_disclaimer": (
                "Decision-support scenario screening comparing 2026 KTMB OD demand against published GTFS reference schedules and "
                "official 2023 nominal train capacities (SCS=1,118 pax; Komuter Utara 3-car EMU=400 pax). Not physical onboard load measurement. "
                "Klang Valley uses the November 2026 GTFS reference timetable (excluding unverified 2026-11-09 holiday from matched checks); "
                "Komuter Utara adopts symmetric 50/50 bounded mixed matching with full scenario uncertainty range exposed."
            ),
        },
        "segments": segment_rows_out,
        "stations": station_entries_out,
        "unavailable_stations": unavailable_stations,
    }

    # Write 1) capacity_screening_summary.json
    p_sum = FRONTEND_DATA_DIR / "capacity_screening_summary.json"
    p_sum.write_text(json.dumps(summary_payload, separators=(",", ":")), encoding="utf-8")

    # Write 2) capacity_hourly_profiles.json (all 15 slices + exact deduplicated single-day schedules)
    p_hr = FRONTEND_DATA_DIR / "capacity_hourly_profiles.json"
    p_hr.write_text(
        json.dumps({"sched_catalog": sched_catalog, "profiles": hourly_profiles_out}, separators=(",", ":")),
        encoding="utf-8",
    )

    # Write 3) capacity_coverage.json
    audit_b = json.loads((OUT_DIR / "od_path_assignment_audit.json").read_text(encoding="utf-8"))
    audit_c = json.loads((OUT_DIR / "temporal_demand_audit.json").read_text(encoding="utf-8"))
    audit_d = json.loads((OUT_DIR / "scheduled_capacity_audit.json").read_text(encoding="utf-8"))
    audit_ef = json.loads((OUT_DIR / "gap_and_boarding_audit.json").read_text(encoding="utf-8"))

    ut_baseline_sc = next(
        (s for s in ut_sensitivity.get("network_scenarios", []) if s["id"] == "mixed_50_50_120m"),
        {},
    )
    ut_excl_sc = next(
        (s for s in ut_sensitivity.get("network_scenarios", []) if s["id"] == "mixed_50_50_120m_excl_kits_batch"),
        {},
    )

    feasibility_matrix = [
        {
            "service_name": "KTM Komuter Klang Valley (Seremban & Port Klang Lines)",
            "od_granularity": "Hourly OD (`komuter_2026.csv`, AFC tap-out timestamps; 100% full file up to 2026-11-26)",
            "timetable_coverage": "Reference-Timetable Scenario vs published Nov 2026 GTFS (`KC05_KB18`, `KA15_KD19` active `2026-08-18..2026-12-12`; matches Nov 10/14 BC-PS & Nov 23/28-29 TM-PK RIDT PDFs)",
            "capacity_reference": "6-car SCS: 1,118 pax (Seated & Standing, ETS-REDCARD p.3) + 894 comfort sensitivity",
            "hourly_segment_screening": "Supported (`2026-08-18..2026-11-26`, 100 matched days excl. unverified 2026-11-09 Deepavali holiday)",
            "station_boarding_screening": "Supported on 55 non-junction stations; fallback_downstream_segment at Putra & KL Sentral Y-junctions",
            "status_and_reason": "ELIGIBLE REFERENCE SCENARIO — Exact matched schedule across Nov 10-26, reference timetable baseline for Aug 18-Nov 9; `Segambut Utara` & `Segambut 2`, `Penalty`/`Unknown`, Shuttle Selatan, and 2026-11-09 unverified holiday excluded cleanly.",
        },
        {
            "service_name": "KTM Komuter Utara (Butterworth - Padang Besar & Ipoh Lines)",
            "od_granularity": "Hourly OD (`komuter_utara_2026.csv`, KITS transaction timestamps; 20-31% of long-corridor OD in arrival-only hours)",
            "timetable_coverage": "Verified constant daily timetable (`100_47300`, `100_9000`, `1,1,1,1,1,1,1`) identical to KTMB 24 Jul 2026 PDF across all 101 days",
            "capacity_reference": "3-car EMU: 400 pax (Seated & Standing, ETS-REDCARD p.3) + 320 comfort sensitivity",
            "hourly_segment_screening": "Supported (`2026-08-18..2026-11-26`, 101 operational days; 69 normal non-holiday weekdays)",
            "station_boarding_screening": "Supported on 22 non-junction stations; fallback_downstream_segment at Bukit Mertajam junction",
            "status_and_reason": (
                f"ELIGIBLE W/ TEMPORAL SENSITIVITY — Structural >100% corridor overload robust across all temporal models "
                f"(adopted 50/50 mixed peak {ut_baseline_sc.get('max_lr_pct', 'n/a')}% vs {ut_excl_sc.get('max_lr_pct', 'n/a')}% excl. Nov 6/8 KITS batch spikes; "
                f"full sensitivity band exposed)."
            ),
        },
        {
            "service_name": "KTM ETS (Padang Besar - Gemas / JB Sentral)",
            "od_granularity": "Hourly OD (`ets_2026.csv`; 5.80M trips up to 2026-11-26)",
            "timetable_coverage": "Full GTFS stop_times (`ETS` 93 trips/day variable skip-stop)",
            "capacity_reference": "6-car ETS: 315 pax (Seated only, ETS-REDCARD p.3; ETS1 vs ETS2 mixed)",
            "hourly_segment_screening": "Unavailable (Demand only / Capacity withheld)",
            "station_boarding_screening": "Unavailable",
            "status_and_reason": "UNAVAILABLE — ETS Red Card omits standing/coach-variant totals and OD rows lack train_id across skip-stop express patterns.",
        },
        {
            "service_name": "KTM Intercity (Shuttle Timur & Ekspres Rakyat Timuran)",
            "od_granularity": "Hourly OD (`intercity_2026.csv` pools SH + ERT; 0.98M trips up to 2026-11-26)",
            "timetable_coverage": "GTFS stop_times (`SH` + `ERT`, overnight 24:00+ spans)",
            "capacity_reference": "4-car DMU: 198 pax Seated-only (applies to SH only; ERT loco-hauled unverified)",
            "hourly_segment_screening": "Unavailable",
            "station_boarding_screening": "Unavailable",
            "status_and_reason": "UNAVAILABLE — Mixed DMU/loco-hauled rolling stock in unsplit OD dataset plus seated-only DMU metric.",
        },
        {
            "service_name": "KTM Shuttle Tebrau (JB Sentral - Woodlands CIQ)",
            "od_granularity": "Hourly OD (`shuttle_tebrau_2026.csv`; 2.83M trips up to 2026-11-26)",
            "timetable_coverage": "GTFS stop_times (`ST`, 31 trips/day)",
            "capacity_reference": "Not documented in ETS-REDCARD.pdf",
            "hourly_segment_screening": "Unavailable",
            "station_boarding_screening": "Unavailable",
            "status_and_reason": "UNAVAILABLE — Missing official trainset capacity reference; DMU 198 must not be assumed.",
        },
        {
            "service_name": "Prasarana Rapid Rail (LRT / MRT / Monorail / BRT)",
            "od_granularity": "Daily OD ONLY (`rapidrail_2026_daily.csv` up to 2026-11-26; A0 rows excluded from station sums)",
            "timetable_coverage": "Frequency-based GTFS (`frequencies.txt`, no individual trip stop_times; generic weekday expired 2026-03-31)",
            "capacity_reference": "Mixed 2/4/6-car automated fleets without per-trip assignment",
            "hourly_segment_screening": "Unavailable (Daily OD only; hourly unavailable)",
            "station_boarding_screening": "Unavailable",
            "status_and_reason": "UNAVAILABLE — Cannot reconstruct hourly demand curves from daily totals without synthetic fabrication; A0 aggregate rows excluded from station sums.",
        },
    ]

    coverage_payload = {
        "feasibility_matrix": feasibility_matrix,
        "date_window_disclosure": {
            "active_comparison_window": f"{GTFS_WINDOW_START} to {GTFS_WINDOW_END} (101 calendar days; 100 matched KV days excl. 2026-11-09, 101 operational Utara days)",
            "excluded_pre_gtfs_window": "2026-01-01 to 2026-08-17 (229 days excluded from capacity deficit calculations because active ktmb_gtfs.zip calendar starts 2026-08-18)",
            "gtfs_calendar_exceptions_honored": [
                {"date": "2026-08-25", "reason": "Maulidur Rasul — KTMB GTFS calendar_dates override -> komuter_weekend schedule (excluded from normal weekday slice)"},
                {"date": "2026-08-31", "reason": "Hari Merdeka — KTMB GTFS calendar_dates override -> komuter_weekend schedule (excluded from normal weekday slice)"},
                {"date": "2026-09-16", "reason": "Malaysia Day — KTMB GTFS calendar_dates override -> komuter_weekend schedule (excluded from normal weekday slice)"},
            ],
            "unverified_holiday_exceptions": [
                {
                    "date": d_k,
                    "name": v_k["name"],
                    "treatment": "Excluded from matched KV comparisons and from normal weekday slice across both networks; isolated in nov09_holiday_sensitivity",
                    "notes": v_k["notes"],
                }
                for d_k, v_k in UNVERIFIED_HOLIDAY_EXCEPTIONS.items()
            ],
            "additional_forensic_disclosures": [
                "KV Reference-Timetable Scope: ktmb_gtfs.zip publishes November 2026 KV schedules (matching BC-PS Nov 10/14 + TM-PK Nov 23/28-29 RIDT works) backdated to 2026-08-18 in calendar.txt. KV screening strictly represents a Reference-Timetable Scenario (exact timetable match Nov 10-26; indicative baseline Aug 18-Nov 9), whereas Komuter Utara matches KTMB's continuous 24 Jul 2026 timetable identically across all 101 days.",
                "Komuter Utara KITS Timestamp Sensitivity & Batch Anomalies: Empirical audits confirm 20-31% of long-distance Utara corridor OD flows appear in arrival-only zero-departure hours and reveal system-wide KITS batch flushes on 2026-11-06 10:00 (KV 4.59x, Utara 4.89x) and 2026-11-08 01:00 AM (KV 3,775 / 943.8x, Utara 2,392 / 61.3x while zero trains operate). Adopted symmetric 50/50 bounded mixed matching bounds multi-hour drift; all 6 temporal scenarios are disclosed.",
                "KVDT2 Closure (FAQ_KVDT_2.pdf): Salak Selatan-Seremban single-line works from 2026-04-18 to 2026-12-31 limit Seremban Line through-trips to 5 weekday peak pairs (2 weekend).",
                "GTFS Southbound Stop Omission: ktmb_gtfs.zip omits southbound KA15_KD19 stop_times at Kuala Kubu Bharu (16100) and Rasa (16300); topology reconstructs symmetric track traversal via proportional interpolation (+13m/+18m of 22m run) and flags affected segments.",
                "Late-2026 Holiday Calendar Exclusion: ktmb_gtfs.zip calendar_dates.txt ends exceptions after 2026-09-16; Deepavali replacement holiday (2026-11-09, KV 14,870 pax = 64.9% weekday median) lacks a GTFS override and is excluded from matched weekday/all comparisons.",
                "Segambut Utara & Window Alignment Disclosure: Panel 1 Station Demand covers 2026-01-01..2026-11-20 (324d), whereas Panel 2 Unavailable reference totals cover 2026-01-01..2026-11-26 (330d) and Segambut Utara/Segambut 2 remain unverified in GTFS stops.txt.",
            ],
        },
        "utara_temporal_sensitivity": ut_sensitivity,
        "nov09_holiday_sensitivity": nov09_holiday_sensitivity,
        "observation_window_comparison": other_network_stats.get("observation_window_comparison", {}),
        "path_assignment_audit": audit_b,
        "temporal_demand_audit": audit_c,
        "scheduled_capacity_audit": audit_d,
        "gap_and_boarding_audit": audit_ef,
        "other_networks_summary": other_network_stats,
    }
    p_cov = FRONTEND_DATA_DIR / "capacity_coverage.json"
    p_cov.write_text(json.dumps(coverage_payload, indent=2), encoding="utf-8")

    # Write 4) capacity_methodology.json
    methodology_payload = {
        "temporal_methods": [
            {
                "id": "schedule_traversal_base",
                "label": "Schedule-Aligned Traversal (+5m Base)",
                "description": (
                    "Maps hourly OD volume onto active GTFS scheduled trips along the unique physical path. "
                    "Klang Valley AFC tap-out timestamps align primarily via latest arrival within 90m before exit tap (+ bounded 90m forward fallback). "
                    "Komuter Utara KITS timestamps adopt symmetric 50/50 bounded mixed matching (50% arrival-aligned within 120m w/ 120m forward fallback + "
                    "50% forward departure-aligned within 120m, +5m buffer), preventing unbounded overnight/2h-gap pooling while exposing forward, arrival, "
                    "transaction-hour, and KITS anomaly-excluded scenario ranges."
                ),
            },
            {
                "id": "schedule_traversal_tight_0m",
                "label": "Tight Schedule Sensitivity (0m Buffer)",
                "description": "Zero-minute boarding buffer sensitivity testing boundary-minute sensitivity under the identical matching framework.",
            },
            {
                "id": "transaction_hour_cohort",
                "label": "Transaction-Hour Baseline (Diagnostic)",
                "description": "Projects raw OD volume instantaneously along all path segments in the transaction clock hour without timetable train concentration.",
            },
        ],
        "capacity_modes": [
            {
                "id": "official_2023_nominal",
                "label": "Official 2023 Rate Card Nominal (1,118 KV / 400 Utara)",
                "description": "KTMB ETS-REDCARD (2023) total seated + standing nominal capacity per scheduled trainset.",
            },
            {
                "id": "planning_sensitivity_80pct",
                "label": "80% Planning Comfort Sensitivity (894 KV / 320 Utara)",
                "description": "Derived 80% load comfort sensitivity benchmark; never presented as physical measurement or official regulation.",
            },
        ],
        "formulas": {
            "scheduled_capacity": "S = N * C (scheduled segment train crossings N in clock hour * nominal train capacity C)",
            "load_ratio_pct": "Load Ratio (%) = (D / S) * 100 when S > 0; null when S == 0 (never zero-divided)",
            "capacity_deficit": "Deficit = max(0, D - S)",
            "additional_trains_needed": "Extra Trains = ceil(Deficit / C) == max(0, ceil(D / C) - N) per individual segment-hour (never summed across adjacent segments)",
            "station_conservation": "D_in - A + B == D_out; Remaining = max(0, S_out - T); Boarding Gap = max(0, B - Remaining); Upstream Full Flag = (T > S_out)",
        },
        "stat_aggregations": {
            "mean": "Ratio of slice-mean hourly demand divided by slice-mean hourly scheduled capacity at the peak mean hour across verified dates in the slice.",
            "p90": "Coherent 90th-percentile daily-peak representative observation (nearest-rank P90 across verified operating dates), pulling exact matching date, hour, demand, scheduled trains, capacity, and upstream through-load.",
            "max_date": "Single highest observed verified date-hour overload within the selected slice, with matching same-date 24h scheduled capacity (never blended mean schedules).",
        },
    }
    p_meth = FRONTEND_DATA_DIR / "capacity_methodology.json"
    p_meth.write_text(json.dumps(methodology_payload, indent=2), encoding="utf-8")

    # Write SCHEMA_AND_METHODOLOGY.md
    md = f"""# Module 2 Capacity & Service Bottlenecks — Schema & Methodology

## Pipeline Architecture & Scientific Refinements
1. `protection_audit.py`: Verifies line-ending normalized SHA-256 baseline hashes of all 105 protected repository files outside Module 2 Capacity Screening ownership (explicitly validating commit `7b1935b` authorized `OdPeakHours.tsx` integration).
2. `fetch_official_sources.py`: Downloads official KTMB & Prasarana 2026 datasets, GTFS feeds, and KTMB official PDFs into `backend/data/module2_capacity_screening/raw/` with SHA-256 provenance manifest (`source_manifest.json`).
3. `build_references.py`: Builds `train_capacity_reference.csv` and `scheduled_service_reference.csv`.
4. `network_topology.py` (Backend A): Reconstructs **156 verified symmetric directed physical segments** across **80 Komuter stations** strictly from `stop_sequence`, expanding the GTFS southbound stop omission edge `15200 Tanjong Malim -> 16500 Batang Kali` proportionally across `16100 Kuala Kubu Bharu -> 16300 Rasa` (`1,260s` span).
5. `od_path_assignment.py` (Backend B): Audits 100% of rows in `komuter_2026.csv` and `komuter_utara_2026.csv` (bounded `<= {GTFS_WINDOW_END}`), cleanly isolating `Penalty`/`Unknown`, `Segambut Utara`/`Segambut 2`, and Shuttle Selatan tickets.
6. `temporal_demand.py` (Backend C): Projects `transaction_hour_cohort`, `schedule_traversal_base`, and `schedule_traversal_tight_0m` across `{GTFS_WINDOW_START}..{GTFS_WINDOW_END}` — using arrival-aligned AFC matching (`<=90m` + bounded forward fallback) for Klang Valley, and **symmetric 50/50 bounded mixed matching (`<=120m`)** for Komuter Utara while exporting complete 6-scenario sensitivity envelopes (`utara_temporal_sensitivity.json`).
7. `scheduled_capacity.py` (Backend D): Computes date-compatible `scheduled_trains_n` and nominal capacity `S`, flagging **2026-11-09 Deepavali Replacement Holiday** (`unverified_kv_holiday` excluded from KV matched comparisons and normal weekdays) and disclosing KV's November 2026 Reference-Timetable scope vs Utara's continuous 24 Jul 2026 daily schedule.
8. `capacity_gap_engine.py` (Backends E & F): Produces per-date-hour segment deficits and station boarding screening enforcing `D_in - A + B == D_out` (`max_abs_err <= 1e-6`) on non-junctions and `fallback_downstream_segment` at `Putra`, `KL Sentral`, and `Bukit Mertajam`.
9. `run_pipeline.py`: Exports all `5 periods x 3 dayProfiles` (`2,340` profiles) with deduplicated single-day schedules (`sched_catalog`), coherent representative nearest-rank `P90` observations, and complete holiday/temporal sensitivity disclosures.

## Exported Frontend File Sizes
- `capacity_screening_summary.json`: {p_sum.stat().st_size:,} bytes
- `capacity_hourly_profiles.json`: {p_hr.stat().st_size:,} bytes
- `capacity_coverage.json`: {p_cov.stat().st_size:,} bytes
- `capacity_methodology.json`: {p_meth.stat().st_size:,} bytes
"""
    (PIPELINE_DIR / "SCHEMA_AND_METHODOLOGY.md").write_text(md, encoding="utf-8")

    sizes = {
        "summary_bytes": p_sum.stat().st_size,
        "hourly_bytes": p_hr.stat().st_size,
        "coverage_bytes": p_cov.stat().st_size,
        "methodology_bytes": p_meth.stat().st_size,
    }
    sizes["total_bytes"] = sum(sizes.values())
    print("Exported Frontend JSON sizes:", json.dumps(sizes, indent=2))
    return sizes


def run_all() -> dict:
    build_train_capacity_reference()
    build_scheduled_service_reference()
    build_topology()
    run_path_assignment_audit()
    compute_temporal_demand()
    compute_scheduled_capacity()
    compute_capacity_gaps_and_boarding()
    return export_frontend_bundles()


if __name__ == "__main__":
    import sys
    if "--export-only" in sys.argv:
        export_frontend_bundles()
    else:
        run_all()
