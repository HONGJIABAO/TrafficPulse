"""
module1_station_ridership.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 1: Station Monthly Ridership Pre-aggregator
Output: frontend/src/data/station_monthly_ridership.json

Aggregates actual monthly boardings (origin trips) per station from:
- rapidrail_2026_daily.csv (Rapid Rail LRT/MRT/Monorail, 2026)
- komuter_2023-2025.parquet & komuter_2026.csv (KTM Komuter, 2023-2026)
- intercity_2026.csv (KTM Intercity & ETS, 2026)
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import json
import polars as pl
from config import RAW_DATA_DIR, FRONTEND_DATA_DIR, save_frontend_json


def main():
    print("[Module 1 Ridership] Aggregating monthly station ridership...")

    # Load stations metadata
    stations_path = FRONTEND_DATA_DIR / "stations.json"
    with open(stations_path, "r", encoding="utf-8") as f:
        stations = json.load(f)["stations"]

    # 1. Rapid Rail 2026
    print("  -> Aggregating Rapid Rail 2026...")
    rr = pl.scan_csv(RAW_DATA_DIR / "rapidrail_2026_daily.csv").filter(
        ~pl.col("origin").str.starts_with("A0:")
    ).with_columns([
        pl.col("date").str.slice(0, 7).alias("ym"),
        pl.col("origin").str.split(":").list.get(0).str.strip_chars().alias("code"),
    ]).group_by(["ym", "code"]).agg(pl.col("ridership").sum()).collect()

    # 2. KTM Komuter 2023-2026
    print("  -> Aggregating KTM Komuter...")
    kom_parts = []
    for fname in ["komuter_2023.parquet", "komuter_2024.parquet", "komuter_2025.parquet"]:
        fpath = RAW_DATA_DIR / fname
        if fpath.exists():
            df = pl.read_parquet(fpath).with_columns([
                pl.col("date").cast(pl.Date).dt.strftime("%Y-%m").alias("ym"),
                pl.col("origin").alias("name")
            ])
            kom_parts.append(df.group_by(["ym", "name"]).agg(pl.col("ridership").sum()))

    f26 = RAW_DATA_DIR / "komuter_2026.csv"
    if f26.exists():
        df26 = pl.read_csv(f26).with_columns([
            pl.col("date").str.slice(0, 7).alias("ym"),
            pl.col("origin").alias("name")
        ])
        kom_parts.append(df26.group_by(["ym", "name"]).agg(pl.col("ridership").sum()))
    kom = pl.concat(kom_parts)

    # 3. KTM Intercity 2026
    print("  -> Aggregating KTM Intercity / ETS 2026...")
    ic = pl.read_csv(RAW_DATA_DIR / "intercity_2026.csv").with_columns([
        pl.col("date").str.slice(0, 7).alias("ym"),
        pl.col("origin").alias("name")
    ]).group_by(["ym", "name"]).agg(pl.col("ridership").sum())

    # Build monthly lookup
    monthly_station = {}
    max_val = 0

    # Rapid Rail indexed by code_
    for row in rr.iter_rows(named=True):
        ym = row["ym"]
        code = row["code"]
        val = int(row["ridership"])
        if val > max_val:
            max_val = val
        if ym not in monthly_station:
            monthly_station[ym] = {}
        monthly_station[ym][f"code_{code}"] = val

    # Komuter indexed by kom_
    for row in kom.iter_rows(named=True):
        ym = row["ym"]
        name = row["name"]
        val = int(row["ridership"])
        if val > max_val:
            max_val = val
        if ym not in monthly_station:
            monthly_station[ym] = {}
        monthly_station[ym][f"kom_{name}"] = val

    # Intercity indexed by ic_
    for row in ic.iter_rows(named=True):
        ym = row["ym"]
        name = row["name"]
        val = int(row["ridership"])
        if val > max_val:
            max_val = val
        if ym not in monthly_station:
            monthly_station[ym] = {}
        monthly_station[ym][f"ic_{name}"] = val

    # YoY calculations
    yoy_data = {}
    for ym, stations_map in monthly_station.items():
        y, m = int(ym[:4]), int(ym[5:7])
        prev_ym = f"{y-1}-{m:02d}"
        yoy_data[ym] = {}
        for k, val in stations_map.items():
            if prev_ym in monthly_station and k in monthly_station[prev_ym]:
                prev_val = monthly_station[prev_ym][k]
                if prev_val > 0:
                    yoy_data[ym][k] = round((val - prev_val) / prev_val * 100, 1)

    output = {
        "global_max_ridership": max_val,
        "ridership_by_month": monthly_station,
        "yoy_by_month": yoy_data,
    }

    save_frontend_json(output, "station_monthly_ridership.json")
    print(f"[Module 1 Ridership] Done — global max: {max_val}, months: {len(monthly_station)}")


if __name__ == "__main__":
    main()
