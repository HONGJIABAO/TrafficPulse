from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "module2_capacity_screening" / "raw"


def read_gtfs_table(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with zf.open(name) as f:
        text = io.TextIOWrapper(f, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


def inspect_ktmb_gtfs() -> None:
    print("=== KTMB GTFS ===")
    with zipfile.ZipFile(RAW_DIR / "ktmb_gtfs.zip") as zf:
        routes = read_gtfs_table(zf, "routes.txt")
        stops = read_gtfs_table(zf, "stops.txt")
        trips = read_gtfs_table(zf, "trips.txt")
        stop_times = read_gtfs_table(zf, "stop_times.txt")
        calendar = read_gtfs_table(zf, "calendar.txt")
        calendar_dates = read_gtfs_table(zf, "calendar_dates.txt")

    print("Routes:")
    for r in routes:
        print(" ", dict(r))
    print("Calendar:")
    for c in calendar:
        print(" ", dict(c))
    print("Calendar dates:")
    for cd in calendar_dates:
        print(" ", dict(cd))

    trip_counts = Counter((t["route_id"], t["service_id"], t.get("direction_id", "")) for t in trips)
    print("Trip counts by (route_id, service_id, direction_id):")
    for k, v in sorted(trip_counts.items()):
        print(f"  {k}: {v}")

    print(f"Total GTFS stops: {len(stops)}")
    seg_matches = [s for s in stops if "segambut" in s["stop_name"].lower() or "kenton" in s["stop_name"].lower() or "mid" in s["stop_name"].lower() or "klang" in s["stop_name"].lower() or "tasek" in s["stop_name"].lower() or "tasik" in s["stop_name"].lower()]
    print("Interesting stops:", [(s["stop_id"], s["stop_name"], s["stop_lat"], s["stop_lon"]) for s in seg_matches])

    st_by_trip: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in stop_times:
        st_by_trip[row["trip_id"]].append(row)
    for tid in st_by_trip:
        st_by_trip[tid].sort(key=lambda r: int(r["stop_sequence"]))

    stop_name_by_id = {s["stop_id"]: s["stop_name"] for s in stops}
    trips_by_route = defaultdict(list)
    for t in trips:
        trips_by_route[t["route_id"]].append(t)

    print("\nDistinct stop sequences per route & direction:")
    for rid, rtrips in sorted(trips_by_route.items()):
        seq_counter = Counter()
        sample_times = {}
        for t in rtrips:
            st_list = st_by_trip[t["trip_id"]]
            seq = tuple((r["stop_id"], stop_name_by_id.get(r["stop_id"], "?")) for r in st_list)
            key = (t["service_id"], t.get("direction_id", ""), seq)
            seq_counter[key] += 1
            if key not in sample_times and st_list:
                sample_times[key] = (t["trip_id"], st_list[0]["departure_time"], st_list[-1]["arrival_time"])
        print(f"Route {rid}:")
        for (sid, did, seq), cnt in sorted(seq_counter.items(), key=lambda x: (-x[1], x[0][0], x[0][1])):
            tid, dep0, arrn = sample_times[(sid, did, seq)]
            print(f"  service={sid} dir={did} count={cnt} ({seq[0][1]} -> {seq[-1][1]}, {len(seq)} stops, e.g. {tid} {dep0}->{arrn})")

    print("\nAll KTMB stop names (sorted):")
    for s in sorted(stops, key=lambda x: x["stop_id"]):
        print(f"  {s['stop_id']}: {s['stop_name']} ({s['stop_lat']}, {s['stop_lon']})")


def inspect_rapidrail_gtfs() -> None:
    print("\n=== RAPID RAIL GTFS ===")
    with zipfile.ZipFile(RAW_DIR / "rapid_rail_gtfs.zip") as zf:
        routes = read_gtfs_table(zf, "routes.txt")
        stops = read_gtfs_table(zf, "stops.txt")
        trips = read_gtfs_table(zf, "trips.txt")
        calendar = read_gtfs_table(zf, "calendar.txt")
        freqs = read_gtfs_table(zf, "frequencies.txt") if "frequencies.txt" in zf.namelist() else []
    print("Routes:", [dict(r) for r in routes])
    print("Calendar:", [dict(c) for c in calendar])
    print("Trips count:", len(trips), "Stops count:", len(stops), "Frequencies count:", len(freqs))
    print("Trips by (route_id, service_id, direction_id):", sorted(Counter((t["route_id"], t["service_id"], t.get("direction_id", "")) for t in trips).items()))


def inspect_csv_stations(filename: str) -> None:
    path = RAW_DIR / filename
    origs: Counter[str] = Counter()
    dests: Counter[str] = Counter()
    daily: Counter[str] = Counter()
    same_cnt = 0
    rows = 0
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            rows += 1
            val = int(float(r["ridership"]))
            origs[r["origin"]] += val
            dests[r["destination"]] += val
            daily[r["date"]] += val
            if r["origin"] == r["destination"]:
                same_cnt += val
    all_st = sorted(set(origs) | set(dests))
    print(f"\n=== {filename} === rows={rows:,} total_pax={sum(daily.values()):,} same_station_pax={same_cnt:,} unique_stations={len(all_st)} dates={min(daily)}..{max(daily)} ({len(daily)} days)")
    print("Stations:", all_st)


def inspect_html_docs() -> None:
    print("\n=== HTML DOCS ===")
    for name in ["TrainTime.html", "Komuter.html"]:
        p = RAW_DIR / "docs" / name
        if p.exists():
            txt = p.read_text(encoding="utf-8", errors="ignore")
            pdfs = sorted(set(re.findall(r'https?://[^\s"\'<>]+\.pdf|[^\s"\'<>]+\.pdf', txt, re.I)))
            print(f"{name} PDF links ({len(pdfs)}):", pdfs[:40])


def main() -> None:
    inspect_ktmb_gtfs()
    inspect_rapidrail_gtfs()
    for fn in ["komuter_2026.csv", "komuter_utara_2026.csv", "ets_2026.csv", "intercity_2026.csv", "shuttle_tebrau_2026.csv"]:
        inspect_csv_stations(fn)
    inspect_html_docs()


if __name__ == "__main__":
    main()
