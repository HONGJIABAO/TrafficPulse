from __future__ import annotations

import csv
import datetime as dt
import io
import json
import zipfile
from collections import defaultdict, deque
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data" / "module2_capacity_screening"
RAW_DIR = DATA_DIR / "raw"
OUT_DIR = DATA_DIR / "processed"

GTFS_WINDOW_START = "2026-08-18"
GTFS_WINDOW_END = "2026-11-26"

UNVERIFIED_HOLIDAY_EXCEPTIONS: dict[str, dict] = {
    "2026-11-09": {
        "name": "Deepavali Replacement Public Holiday",
        "weekday": "Monday",
        "affects_networks": ["ktm_komuter_kv"],
        "notes": (
            "Malaysian federal replacement holiday omitted from ktmb_gtfs.zip calendar_dates.txt "
            "(which ends exceptions after 2026-09-16). Klang Valley ridership dropped to 14,870 pax "
            "(64.9% of weekday median); excluded from KV matched scheduled comparisons and isolated in "
            "nov09_holiday_sensitivity. Komuter Utara runs an identical 1,1,1,1,1,1,1 daily timetable "
            "(effective 24 Jul 2026) and remains schedule-valid on 2026-11-09 (excluded from normal weekday average)."
        ),
    }
}

KITS_BATCH_ANOMALY_HOURS: list[tuple[str, int, str]] = [
    (
        "2026-11-06",
        10,
        "Simultaneous KITS 10:00 AM batch/transaction spike (KV 4.59x, Utara 4.89x, Intercity 3.65x vs median)",
    ),
    (
        "2026-11-08",
        1,
        "Simultaneous KITS 01:00 AM offline settlement spike (KV 3,775 / 943.8x, Utara 2,392 / 61.3x while zero trains operate)",
    ),
]

SERVICE_CAPACITY_CONFIG = {
    "ktm_komuter_kv": {
        "official_2023_nominal": 1118,
        "planning_sensitivity_80pct": 894,
        "label": "KTM Komuter Klang Valley (6-Car SCS)",
    },
    "ktm_komuter_utara": {
        "official_2023_nominal": 400,
        "planning_sensitivity_80pct": 320,
        "label": "KTM Komuter Utara (3-Car EMU)",
    },
}


def read_gtfs_table(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline="")))


def parse_gtfs_secs(t_str: str) -> int:
    hh, mm, ss = (int(x) for x in t_str.strip().split(":"))
    return hh * 3600 + mm * 60 + ss


def iter_dates(start_str: str = GTFS_WINDOW_START, end_str: str = GTFS_WINDOW_END) -> list[str]:
    d = dt.date.fromisoformat(start_str)
    end = dt.date.fromisoformat(end_str)
    out = []
    while d <= end:
        out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def resolve_active_services_by_date(
    start_str: str = GTFS_WINDOW_START,
    end_str: str = GTFS_WINDOW_END,
) -> dict[str, dict]:
    """
    For each date in [start_str, end_str], resolve active GTFS service_id for each network:
      - ktm_komuter_kv: komuter_weekday or komuter_weekend (honoring calendar.txt & calendar_dates.txt)
      - ktm_komuter_utara: komuter_utara (identical 1,1,1,1,1,1,1 Mon-Sun/Holiday schedule since 24 Jul 2026)
      - Distinguishes verified GTFS weekend/holiday overrides from late-2026 unverified holiday dates
        (2026-11-09 Deepavali replacement holiday lacking a GTFS calendar_dates.txt override).
    """
    with zipfile.ZipFile(RAW_DIR / "ktmb_gtfs.zip") as zf:
        calendars = read_gtfs_table(zf, "calendar.txt")
        cal_dates = read_gtfs_table(zf, "calendar_dates.txt")

    dow_keys = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    cal_by_id = {c["service_id"]: c for c in calendars}
    exceptions: dict[tuple[str, str], str] = {
        (cd["date"], cd["service_id"]): cd["exception_type"] for cd in cal_dates
    }

    result: dict[str, dict] = {}
    for d_str in iter_dates(start_str, end_str):
        d_obj = dt.date.fromisoformat(d_str)
        d_compact = d_obj.strftime("%Y%m%d")
        dow_col = dow_keys[d_obj.weekday()]

        active = set()
        for sid, cal in cal_by_id.items():
            if cal["start_date"] <= d_compact <= cal["end_date"] and cal[dow_col] == "1":
                active.add(sid)
        for (ex_date, sid), ex_type in exceptions.items():
            if ex_date == d_compact:
                if ex_type == "1":
                    active.add(sid)
                elif ex_type == "2":
                    active.discard(sid)

        kv_sid = "komuter_weekend" if "komuter_weekend" in active else "komuter_weekday"
        assert kv_sid in active, f"No active KV service on {d_str}: {active}"
        assert "komuter_utara" in active, f"No active Komuter Utara service on {d_str}: {active}"

        holiday_meta = UNVERIFIED_HOLIDAY_EXCEPTIONS.get(d_str)
        if holiday_meta is not None:
            day_profile = "holiday_unverified"
        elif kv_sid == "komuter_weekend":
            day_profile = "weekend"
        else:
            day_profile = "weekday"

        result[d_str] = {
            "ktm_komuter_kv": kv_sid,
            "ktm_komuter_utara": "komuter_utara",
            "day_profile": day_profile,
            "kv_matched_eligible": holiday_meta is None or ("ktm_komuter_kv" not in holiday_meta["affects_networks"]),
            "utara_matched_eligible": holiday_meta is None or ("ktm_komuter_utara" not in holiday_meta["affects_networks"]),
            "is_unverified_holiday": holiday_meta is not None,
        }
    return result


def is_date_eligible_for_slice(date_info: dict, net: str, day_prof: str) -> bool:
    """Return True if date_info participates in matched capacity evaluation for (net, day_prof)."""
    eligible_key = "kv_matched_eligible" if net == "ktm_komuter_kv" else "utara_matched_eligible"
    if not date_info.get(eligible_key, True):
        return False
    dp = date_info["day_profile"]
    if day_prof == "all":
        return True
    if day_prof == "weekday":
        return dp == "weekday"
    if day_prof == "weekend":
        return dp == "weekend"
    return False


def load_topology_and_paths() -> tuple[dict, dict[str, list[dict[str, str]]], dict[tuple[str, str, str], list[str]]]:
    reg = json.loads((OUT_DIR / "station_registry_local.json").read_text(encoding="utf-8"))
    with (OUT_DIR / "verified_directed_segments.csv").open("r", encoding="utf-8", newline="") as f:
        seg_rows = list(csv.DictReader(f))

    adj: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    segs_by_net: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in seg_rows:
        net = r["network_code"]
        segs_by_net[net].append(r)
        adj[net][r["from_stop_id"]].append(r["to_stop_id"])

    # Precompute unique shortest physical node paths for every (network, o_stop, d_stop)
    paths: dict[tuple[str, str, str], list[str]] = {}
    nodes_by_net: dict[str, list[str]] = defaultdict(list)
    for key, meta in reg["stations"].items():
        nodes_by_net[meta["network_code"]].append(meta["stop_id"])

    for net, nodes in nodes_by_net.items():
        for src in nodes:
            parent: dict[str, str | None] = {src: None}
            q = deque([src])
            while q:
                u = q.popleft()
                for v in adj[net][u]:
                    if v not in parent:
                        parent[v] = u
                        q.append(v)
            for dst in nodes:
                if dst == src:
                    continue
                cur: str | None = dst
                chain = []
                while cur is not None:
                    chain.append(cur)
                    cur = parent[cur]
                paths[(net, src, dst)] = list(reversed(chain))

    return reg, segs_by_net, paths


def load_expanded_gtfs_trips(reg: dict) -> dict[tuple[str, str], list[dict]]:
    """
    Load every trip for eligible networks, expanding asymmetric GTFS omission/bypass legs
    into physical intermediate segments with proportional interpolated passing seconds.
    Returns mapping (network_code, service_id) -> list of trip dicts:
      {
        "trip_id": str,
        "route_id": str,
        "stops": list[str],
        "arr_secs": list[int],
        "dep_secs": list[int],
        "edges": list[tuple[str, str, int, int, bool]],  # (u, v, dep_u_secs, arr_v_secs, is_interpolated)
      }
    """
    route_to_net = {r: net for net, rids in reg["networks"].items() for r in rids}
    expansions = reg.get("bypass_expansions", {})

    with zipfile.ZipFile(RAW_DIR / "ktmb_gtfs.zip") as zf:
        trips = read_gtfs_table(zf, "trips.txt")
        stop_times = read_gtfs_table(zf, "stop_times.txt")

    st_by_trip: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in stop_times:
        st_by_trip[row["trip_id"]].append(row)
    for tid in st_by_trip:
        st_by_trip[tid].sort(key=lambda r: int(r["stop_sequence"]))

    grouped: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for t in trips:
        net = route_to_net.get(t["route_id"])
        if not net:
            continue
        seq = st_by_trip[t["trip_id"]]
        if len(seq) < 2:
            continue

        phys_stops = [seq[0]["stop_id"]]
        phys_arr = [parse_gtfs_secs(seq[0]["arrival_time"])]
        phys_dep = [parse_gtfs_secs(seq[0]["departure_time"])]
        phys_edges: list[tuple[str, str, int, int, bool]] = []

        for i in range(len(seq) - 1):
            u, v = seq[i]["stop_id"], seq[i + 1]["stop_id"]
            dep_u = parse_gtfs_secs(seq[i]["departure_time"])
            arr_v = parse_gtfs_secs(seq[i + 1]["arrival_time"])
            dep_v = parse_gtfs_secs(seq[i + 1]["departure_time"])

            exp_key = f"{net}:{u}->{v}"
            if exp_key in expansions:
                chain = expansions[exp_key]["chain"]
                fracs = expansions[exp_key]["fractions"]
                dt_span = max(60, arr_v - dep_u)
                for k in range(len(chain) - 1):
                    a, b = chain[k], chain[k + 1]
                    t_a = int(round(dep_u + fracs[k] * dt_span))
                    t_b = int(round(dep_u + fracs[k + 1] * dt_span))
                    phys_edges.append((a, b, t_a, t_b, True))
                    if k < len(chain) - 2:
                        phys_stops.append(b)
                        phys_arr.append(t_b)
                        phys_dep.append(t_b)
                phys_stops.append(v)
                phys_arr.append(arr_v)
                phys_dep.append(dep_v)
            else:
                phys_edges.append((u, v, dep_u, arr_v, False))
                phys_stops.append(v)
                phys_arr.append(arr_v)
                phys_dep.append(dep_v)

        grouped[(net, t["service_id"])].append(
            {
                "trip_id": t["trip_id"],
                "route_id": t["route_id"],
                "stops": phys_stops,
                "arr_secs": phys_arr,
                "dep_secs": phys_dep,
                "edges": phys_edges,
            }
        )

    return grouped
