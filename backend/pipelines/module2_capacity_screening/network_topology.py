from __future__ import annotations

import csv
import io
import json
import zipfile
from collections import defaultdict, deque
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = BASE_DIR / "data" / "module2_capacity_screening"
RAW_DIR = DATA_DIR / "raw"
OUT_DIR = DATA_DIR / "processed"

ELIGIBLE_ROUTES = {
    "ktm_komuter_kv": {"KC05_KB18", "KA15_KD19"},
    "ktm_komuter_utara": {"100_47300", "100_9000"},
}

CSV_TO_GTFS_STOP_NAME_ALIASES = {
    "Bandar Tasek Selatan": "BDR TASEK SELATAN",
    "Batu Kentonmen": "BATU KENTOMENN",
    "Jalan Kastam": "JLN KASTAM",
    "Kampung Dato Harun": "KG DATO HARUN",
    "Kampung Raja Uda": "KG RAJA UDA",
    "Midvalley": "PERHENTIAN MIDVALLEY",
    "Pelabuhan Klang Selatan": "PEL KLANG SEL",
    "Pulau Sebang (Tampin)": "PULAU SEBANG/TAMPIN",
}

EXCLUDED_STATION_BUCKETS = {
    "Penalty": "excluded_admin_non_station",
    "Unknown": "excluded_admin_non_station",
    "Segambut Utara": "excluded_unverified_gtfs_stop",
    "Segambut 2": "excluded_unverified_gtfs_stop",
    "Kampar": "excluded_out_of_service_scope",
    "Kempas Baru": "excluded_out_of_service_scope",
    "Kulai": "excluded_out_of_service_scope",
    "Layang-Layang": "excluded_out_of_service_scope",
    "Pasir Gudang": "excluded_out_of_service_scope",
    "Rengam": "excluded_out_of_service_scope",
    "Slim River": "excluded_out_of_service_scope",
    "Sungkai": "excluded_out_of_service_scope",
    "Tapah Road": "excluded_out_of_service_scope",
}

DISPLAY_NAME_OVERRIDES = {
    "19600": "Bandar Tasek Selatan",
    "50300": "Batu Kentonmen",
    "55100": "Jalan Kastam",
    "53400": "Kampung Dato Harun",
    "55000": "Kampung Raja Uda",
    "19205": "Midvalley",
    "55200": "Pelabuhan Klang Selatan",
    "25100": "Pulau Sebang (Tampin)",
    "19100": "KL Sentral",
    "20500": "UKM",
    "37500": "JB Sentral",
    "37600": "Woodlands CIQ",
}


def pretty_station_name(stop_id: str, gtfs_name: str) -> str:
    if stop_id in DISPLAY_NAME_OVERRIDES:
        return DISPLAY_NAME_OVERRIDES[stop_id]
    words = gtfs_name.strip().split()
    out = []
    for w in words:
        if w.upper() in {"KL", "UKM", "JB", "CIQ"}:
            out.append(w.upper())
        else:
            out.append(w.capitalize())
    return " ".join(out)


def read_gtfs_table(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with zf.open(name) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig", newline="")))


def parse_gtfs_secs(t_str: str) -> int:
    hh, mm, ss = (int(x) for x in t_str.strip().split(":"))
    return hh * 3600 + mm * 60 + ss


def bfs_all_shortest_paths(adj: dict[str, set[str]], start: str, goal: str) -> list[list[str]]:
    if start == goal:
        return [[start]]
    dist: dict[str, int] = {start: 0}
    parents: dict[str, list[str]] = defaultdict(list)
    q = deque([start])
    while q:
        u = q.popleft()
        if goal in dist and dist[u] >= dist[goal]:
            continue
        for v in sorted(adj.get(u, ())):
            if v not in dist:
                dist[v] = dist[u] + 1
                parents[v].append(u)
                q.append(v)
            elif dist[v] == dist[u] + 1:
                parents[v].append(u)
    if goal not in dist:
        return []

    paths: list[list[str]] = []

    def backtrack(node: str, acc: list[str]) -> None:
        if node == start:
            paths.append(list(reversed(acc)))
            return
        for p in parents[node]:
            acc.append(p)
            backtrack(p, acc)
            acc.pop()

    backtrack(goal, [goal])
    return paths


def detect_bypass_and_gtfs_omission_edges(
    trips: list[dict[str, str]],
    st_by_trip: dict[str, list[dict[str, str]]],
    stop_names: dict[str, str],
) -> tuple[dict[str, dict[tuple[str, str], list[str]]], dict[str, dict[tuple[str, str], list[float]]]]:
    """
    Detect:
      1) same-direction skip-stop bypass edges (u -> v when same-direction u -> ... -> v exists),
      2) asymmetric GTFS stop-omission edges (u -> v missing reverse edge v -> u, where opposite direction has v -> ... -> u).
    Compute fractional intermediate timestamps from typical GTFS travel times along the physical chain.
    """
    route_to_net = {r: net for net, rids in ELIGIBLE_ROUTES.items() for r in rids}
    raw_edges: dict[str, set[tuple[str, str]]] = defaultdict(set)
    edge_durations: dict[tuple[str, str, str], list[int]] = defaultdict(list)

    for t in trips:
        net = route_to_net.get(t["route_id"])
        if not net:
            continue
        seq = st_by_trip[t["trip_id"]]
        for i in range(len(seq) - 1):
            u, v = seq[i]["stop_id"], seq[i + 1]["stop_id"]
            if u != v:
                raw_edges[net].add((u, v))
                dt = parse_gtfs_secs(seq[i + 1]["arrival_time"]) - parse_gtfs_secs(seq[i]["departure_time"])
                if dt > 0:
                    edge_durations[(net, u, v)].append(dt)

    expansions: dict[str, dict[tuple[str, str], list[str]]] = defaultdict(dict)
    fracs: dict[str, dict[tuple[str, str], list[float]]] = defaultdict(dict)

    for net, edges in raw_edges.items():
        adj: dict[str, set[str]] = defaultdict(set)
        for u, v in edges:
            adj[u].add(v)

        for u, v in sorted(edges):
            # Case 1: same-direction indirect path >= 2 edges
            q = deque([(u, [u])])
            same_dir_path = None
            seen_d: dict[str, int] = {u: 0}
            while q:
                curr, path = q.popleft()
                if len(path) > 6:
                    continue
                for nxt in sorted(adj[curr]):
                    if curr == u and nxt == v:
                        continue
                    if nxt == v:
                        same_dir_path = path + [nxt]
                        break
                    if nxt not in path and (nxt not in seen_d or seen_d[nxt] >= len(path)):
                        seen_d[nxt] = len(path)
                        q.append((nxt, path + [nxt]))
                if same_dir_path:
                    break
            if same_dir_path:
                expansions[net][(u, v)] = same_dir_path
                continue

            # Case 2: (v, u) does NOT exist in edges, check reverse physical chain from v to u.
            # On a skip-stop cycle (u0 -> u1 -> ... -> uk -> u0), ONLY expand the chord edge (u -> v)
            # whose typical travel duration exceeds every individual hop of the reverse chain (uk-1 -> ... -> u0).
            if (v, u) not in edges:
                rev_paths = bfs_all_shortest_paths(adj, v, u)
                if len(rev_paths) == 1 and len(rev_paths[0]) >= 3:
                    phys = list(reversed(rev_paths[0]))
                    chord_durs = edge_durations.get((net, u, v), [])
                    chord_med = sorted(chord_durs)[len(chord_durs) // 2] if chord_durs else 0
                    hop_meds = [
                        sorted(edge_durations[(net, rev_paths[0][k], rev_paths[0][k + 1])])[
                            len(edge_durations[(net, rev_paths[0][k], rev_paths[0][k + 1])]) // 2
                        ]
                        for k in range(len(rev_paths[0]) - 1)
                        if edge_durations.get((net, rev_paths[0][k], rev_paths[0][k + 1]))
                    ]
                    if hop_meds and chord_med > max(hop_meds):
                        expansions[net][(u, v)] = phys
                        print(
                            f"  [{net}] Asymmetric GTFS omission edge {u} ({stop_names[u]}) -> {v} ({stop_names[v]}) "
                            f"[{chord_med}s] expanded via physical corridor: {' -> '.join(stop_names[x] for x in phys)} "
                            f"[sum={sum(hop_meds)}s]"
                        )

        # Compute cumulative fraction offsets [0.0, ..., 1.0] for each expanded bypass/omission edge
        for (u, v), chain in expansions[net].items():
            seg_meds = []
            for k in range(len(chain) - 1):
                a, b = chain[k], chain[k + 1]
                durs = edge_durations.get((net, a, b)) or edge_durations.get((net, b, a)) or [60]
                seg_meds.append(sorted(durs)[len(durs) // 2])
            tot = sum(seg_meds) or 1
            cum = [0.0]
            running = 0
            for d in seg_meds:
                running += d
                cum.append(running / tot)
            fracs[net][(u, v)] = cum

    return expansions, fracs


def build_topology() -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(RAW_DIR / "ktmb_gtfs.zip") as zf:
        stops = read_gtfs_table(zf, "stops.txt")
        trips = read_gtfs_table(zf, "trips.txt")
        stop_times = read_gtfs_table(zf, "stop_times.txt")

    stop_by_id = {s["stop_id"]: s for s in stops}
    stop_names = {s["stop_id"]: s["stop_name"] for s in stops}
    st_by_trip: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in stop_times:
        st_by_trip[row["trip_id"]].append(row)
    for tid in st_by_trip:
        st_by_trip[tid].sort(key=lambda r: int(r["stop_sequence"]))

    expansions, expansion_fracs = detect_bypass_and_gtfs_omission_edges(trips, st_by_trip, stop_names)

    route_to_net = {r: net for net, rids in ELIGIBLE_ROUTES.items() for r in rids}
    physical_edges: dict[str, set[tuple[str, str]]] = defaultdict(set)
    edge_routes: dict[tuple[str, str, str], set[str]] = defaultdict(set)
    interpolated_edges: set[tuple[str, str, str]] = set()

    for t in trips:
        net = route_to_net.get(t["route_id"])
        if not net:
            continue
        seq = st_by_trip[t["trip_id"]]
        for i in range(len(seq) - 1):
            u, v = seq[i]["stop_id"], seq[i + 1]["stop_id"]
            if u == v:
                continue
            chain = expansions[net].get((u, v))
            if chain:
                for k in range(len(chain) - 1):
                    a, b = chain[k], chain[k + 1]
                    physical_edges[net].add((a, b))
                    edge_routes[(net, a, b)].add(t["route_id"])
                    interpolated_edges.add((net, a, b))
            else:
                physical_edges[net].add((u, v))
                edge_routes[(net, u, v)].add(t["route_id"])

    adj_by_net: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    network_nodes: dict[str, set[str]] = defaultdict(set)
    for net, edges in physical_edges.items():
        for u, v in edges:
            adj_by_net[net][u].add(v)
            network_nodes[net].add(u)
            network_nodes[net].add(v)

    # Assert strict bidirectional symmetry and uniqueness
    for net, edges in physical_edges.items():
        for u, v in edges:
            assert (v, u) in edges, f"Missing reverse edge for {(net, u, v)}"
        n_nodes = len(network_nodes[net])
        assert len(edges) == 2 * (n_nodes - 1), f"[{net}] Expected tree graph edges={2*(n_nodes-1)}, got {len(edges)}"

    disconnected = []
    ambiguous = []
    for net, nodes in network_nodes.items():
        s_nodes = sorted(nodes)
        for o in s_nodes:
            for d in s_nodes:
                if o == d:
                    continue
                paths = bfs_all_shortest_paths(adj_by_net[net], o, d)
                if len(paths) == 0:
                    disconnected.append((net, o, d))
                elif len(paths) > 1:
                    ambiguous.append((net, o, d, paths))
    assert not disconnected and not ambiguous, f"disconnected={len(disconnected)}, ambiguous={len(ambiguous)}"

    in_deg: dict[tuple[str, str], int] = defaultdict(int)
    out_deg: dict[tuple[str, str], int] = defaultdict(int)
    for net, edges in physical_edges.items():
        for u, v in edges:
            out_deg[(net, u)] += 1
            in_deg[(net, v)] += 1

    seg_rows: list[dict[str, str]] = []
    for net in sorted(physical_edges):
        for u, v in sorted(physical_edges[net], key=lambda pair: (stop_names[pair[0]], stop_names[pair[1]])):
            routes_str = "|".join(sorted(edge_routes[(net, u, v)]))
            su, sv = stop_by_id[u], stop_by_id[v]
            seg_rows.append(
                {
                    "network_code": net,
                    "segment_id": f"{net}:{u}->{v}",
                    "reverse_segment_id": f"{net}:{v}->{u}",
                    "from_stop_id": u,
                    "to_stop_id": v,
                    "from_station_name": pretty_station_name(u, su["stop_name"]),
                    "to_station_name": pretty_station_name(v, sv["stop_name"]),
                    "from_gtfs_name": su["stop_name"],
                    "to_gtfs_name": sv["stop_name"],
                    "from_lat": su["stop_lat"],
                    "from_lon": su["stop_lon"],
                    "to_lat": sv["stop_lat"],
                    "to_lon": sv["stop_lon"],
                    "routes_serving": routes_str,
                    "is_shared_trunk": str(len(edge_routes[(net, u, v)]) > 1).lower(),
                    "from_is_junction": str(in_deg[(net, u)] > 2 or out_deg[(net, u)] > 2).lower(),
                    "to_is_junction": str(in_deg[(net, v)] > 2 or out_deg[(net, v)] > 2).lower(),
                    "gtfs_interpolated_missing_stop": str((net, u, v) in interpolated_edges).lower(),
                }
            )

    seg_path = OUT_DIR / "verified_directed_segments.csv"
    with seg_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(seg_rows[0].keys()))
        writer.writeheader()
        writer.writerows(seg_rows)

    gtfs_name_to_id_by_net: dict[str, dict[str, str]] = defaultdict(dict)
    for net, nodes in network_nodes.items():
        for sid in nodes:
            gtfs_name_to_id_by_net[net][stop_names[sid].upper()] = sid

    csv_to_stop_id: dict[str, dict[str, str]] = {"ktm_komuter_kv": {}, "ktm_komuter_utara": {}}
    station_meta: dict[str, dict] = {}
    for net, nodes in network_nodes.items():
        for sid in sorted(nodes):
            s = stop_by_id[sid]
            disp = pretty_station_name(sid, s["stop_name"])
            node_routes = sorted(
                {
                    r
                    for (n, u, v), rs in edge_routes.items()
                    if n == net and (u == sid or v == sid)
                    for r in rs
                }
            )
            station_meta[f"{net}:{sid}"] = {
                "network_code": net,
                "stop_id": sid,
                "station_name": disp,
                "gtfs_stop_name": s["stop_name"],
                "lat": float(s["stop_lat"]),
                "lon": float(s["stop_lon"]),
                "routes_serving": node_routes,
                "in_degree": in_deg[(net, sid)],
                "out_degree": out_deg[(net, sid)],
                "is_junction": in_deg[(net, sid)] > 2 or out_deg[(net, sid)] > 2,
                "is_terminal": in_deg[(net, sid)] == 1 and out_deg[(net, sid)] == 1,
            }

    for net, fn in [("ktm_komuter_kv", "komuter_2026.csv"), ("ktm_komuter_utara", "komuter_utara_2026.csv")]:
        csv_stations = set()
        with (RAW_DIR / fn).open("r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                csv_stations.add(r["origin"])
                csv_stations.add(r["destination"])
        for st in sorted(csv_stations):
            if st in EXCLUDED_STATION_BUCKETS:
                continue
            target_gtfs = CSV_TO_GTFS_STOP_NAME_ALIASES.get(st, st).upper()
            assert target_gtfs in gtfs_name_to_id_by_net[net], f"Unresolved station {st!r} in {fn}!"
            csv_to_stop_id[net][st] = gtfs_name_to_id_by_net[net][target_gtfs]
            station_meta[f"{net}:{csv_to_stop_id[net][st]}"]["csv_name"] = st

    registry = {
        "networks": {k: sorted(v) for k, v in ELIGIBLE_ROUTES.items()},
        "csv_to_stop_id": csv_to_stop_id,
        "excluded_station_buckets": EXCLUDED_STATION_BUCKETS,
        "stations": station_meta,
        "bypass_expansions": {
            f"{net}:{u}->{v}": {
                "chain": chain,
                "fractions": expansion_fracs[net][(u, v)],
            }
            for net, m in expansions.items()
            for (u, v), chain in sorted(m.items())
        },
        "total_directed_segments": len(seg_rows),
    }

    (OUT_DIR / "station_registry_local.json").write_text(json.dumps(registry, indent=2), encoding="utf-8")
    print(f"Wrote {len(seg_rows)} verified symmetric directed segments across {len(station_meta)} stations.")
    return registry


if __name__ == "__main__":
    build_topology()
