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


def main() -> None:
    print("=== HTML PDF FULL LINKS & TITLES ===")
    for name in ["TrainTime.html", "Komuter.html"]:
        p = RAW_DIR / "docs" / name
        txt = p.read_text(encoding="utf-8", errors="ignore")
        for m in re.finditer(r'<a[^>]+href=["\']([^"\']+\.pdf[^"\']*)["\'][^>]*>(.*?)</a>', txt, re.I | re.S):
            href = m.group(1)
            label = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", m.group(2))).strip()
            print(f"[{name}] {label} -> {href}")
        if "segambut" in txt.lower():
            print(f"[{name}] contains segambut!")

    print("\n=== RAPID RAIL GTFS DETAILS ===")
    with zipfile.ZipFile(RAW_DIR / "rapid_rail_gtfs.zip") as zf:
        routes = read_gtfs_table(zf, "routes.txt")
        calendar = read_gtfs_table(zf, "calendar.txt")
        stops = read_gtfs_table(zf, "stops.txt")
        trips = read_gtfs_table(zf, "trips.txt")
        freqs = read_gtfs_table(zf, "frequencies.txt")
        print("Routes:")
        for r in routes:
            print(" ", dict(r))
        print("Calendar:")
        for c in calendar:
            print(" ", dict(c))
        print("Frequencies sample (first 10):")
        for fr in freqs[:10]:
            print(" ", dict(fr))

    print("\n=== KOMUTER 2026 UNUSUAL STATIONS DATES & COUNTS ===")
    unusual = {
        "Segambut Utara", "Segambut 2", "Penalty", "Unknown",
        "Kampar", "Slim River", "Sungkai", "Tapah Road",
        "Kempas Baru", "Kulai", "Layang-Layang", "Pasir Gudang", "Rengam",
    }
    stats = defaultdict(lambda: {"pax": 0, "min_date": "9999", "max_date": "0000", "rows": 0})
    with (RAW_DIR / "komuter_2026.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            pax = int(float(r["ridership"]))
            d = r["date"]
            for col in ("origin", "destination"):
                st = r[col]
                if st in unusual:
                    s = stats[st]
                    s["pax"] += pax
                    s["rows"] += 1
                    if d < s["min_date"]:
                        s["min_date"] = d
                    if d > s["max_date"]:
                        s["max_date"] = d
    for st in sorted(stats):
        print(f"  {st}: {stats[st]}")

    print("\n=== KOMUTER UTARA UNUSUAL STATIONS ===")
    ku_stats = defaultdict(int)
    with (RAW_DIR / "komuter_utara_2026.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            pax = int(float(r["ridership"]))
            for col in ("origin", "destination"):
                if r[col] in {"Penalty", "Unknown"}:
                    ku_stats[r[col]] += pax
    print(" ", dict(ku_stats))

    print("\n=== RAPIDRAIL DAILY STATIONS SAMPLE & COUNTS ===")
    rr_origs = Counter()
    rr_dates = set()
    rr_rows = 0
    with (RAW_DIR / "rapidrail_2026_daily.csv").open("r", encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            rr_rows += 1
            rr_origs[r["origin"]] += int(float(r["ridership"]))
            rr_dates.add(r["date"])
    print(f"  rows={rr_rows:,} total_pax={sum(rr_origs.values()):,} unique_origs={len(rr_origs)} dates={min(rr_dates)}..{max(rr_dates)} ({len(rr_dates)} days)")
    print("  top 10 stations:", rr_origs.most_common(10))


if __name__ == "__main__":
    main()
