from __future__ import annotations

import csv
import io
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

RAW_DIR = Path(__file__).resolve().parents[2] / "data" / "module2_capacity_screening" / "raw"


def main() -> None:
    print("=== SEGAMBUT vs SEGAMBUT UTARA BY MONTH ===")
    seg_month = defaultdict(Counter)
    with (RAW_DIR / "komuter_2026.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            ym = r["date"][:7]
            pax = int(float(r["ridership"]))
            for col in ("origin", "destination"):
                st = r[col]
                if "Segambut" in st:
                    seg_month[st][ym] += pax
    for st in sorted(seg_month):
        print(f"  {st}: {dict(sorted(seg_month[st].items()))}")

    print("\n=== KC05_KB18 SAMPLE TRIPS IN GTFS vs NOV 2026 PDF ===")
    with zipfile.ZipFile(RAW_DIR / "ktmb_gtfs.zip") as zf:
        with zf.open("trips.txt") as f:
            trips = list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))
        with zf.open("stop_times.txt") as f:
            stop_times = list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))
    st_by_trip = defaultdict(list)
    for r in stop_times:
        st_by_trip[r["trip_id"]].append(r)
    for tid in st_by_trip:
        st_by_trip[tid].sort(key=lambda x: int(x["stop_sequence"]))

    for sid, did in [("komuter_weekday", "1"), ("komuter_weekday", "0"), ("komuter_weekend", "1"), ("komuter_weekend", "0")]:
        deps = []
        for t in trips:
            if t["route_id"] == "KC05_KB18" and t["service_id"] == sid and t["direction_id"] == did:
                stl = st_by_trip[t["trip_id"]]
                deps.append((stl[0]["departure_time"], stl[0]["stop_id"], stl[-1]["stop_id"], len(stl), t["trip_id"]))
        deps.sort()
        print(f"KC05_KB18 {sid} dir={did} ({len(deps)} trips): first 5 = {deps[:5]} ... last 3 = {deps[-3:]}")

    print("\n=== RIDERSHIP_KTMB_DAILY vs CSV DAILY TOTALS (2026-08-18..2026-11-26) ===")
    headline = defaultdict(int)
    with (RAW_DIR / "ridership_ktmb_daily.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            if "2026-08-18" <= r["date"] <= "2026-11-26":
                headline[r["service"]] += int(float(r["ridership"]))
    print("ridership_ktmb_daily (Aug 18..Nov 26):", dict(sorted(headline.items())))

    for svc, fn in [("komuter", "komuter_2026.csv"), ("komuter_utara", "komuter_utara_2026.csv"), ("ets", "ets_2026.csv"), ("shuttle_tebrau", "shuttle_tebrau_2026.csv")]:
        tot = 0
        with (RAW_DIR / fn).open("r", encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                if "2026-08-18" <= r["date"] <= "2026-11-26":
                    tot += int(float(r["ridership"]))
        print(f"  {fn} (Aug 18..Nov 26): {tot:,} vs headline={headline.get(svc):,} diff={tot - headline.get(svc, 0):,}")


if __name__ == "__main__":
    main()
