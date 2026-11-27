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
    rr_scan = pl.scan_csv(RAW_DATA_DIR / "rapidrail_2026_daily.csv").filter(
        ~pl.col("origin").str.starts_with("A0:")
    ).with_columns([
        pl.col("date").str.slice(0, 7).alias("ym"),
        pl.col("date").str.slice(0, 10).alias("d"),
        pl.col("origin").str.split(":").list.get(0).str.strip_chars().alias("code"),
    ])
    rr = rr_scan.group_by(["ym", "code"]).agg(pl.col("ridership").sum()).collect()
    rr_days_df = rr_scan.group_by("ym").agg(pl.col("d").n_unique().alias("n_days")).collect()
    rr_days = {r["ym"]: int(r["n_days"]) for r in rr_days_df.iter_rows(named=True)}

    # 2. KTM Komuter 2023-2026
    print("  -> Aggregating KTM Komuter...")
    kom_parts = []
    kom_day_parts = []
    for fname in ["komuter_2023.parquet", "komuter_2024.parquet", "komuter_2025.parquet"]:
        fpath = RAW_DATA_DIR / fname
        if fpath.exists():
            df = pl.read_parquet(fpath).with_columns([
                pl.col("date").cast(pl.Date).dt.strftime("%Y-%m").alias("ym"),
                pl.col("date").cast(pl.Date).alias("d"),
                pl.col("origin").alias("name"),
            ])
            kom_parts.append(df.group_by(["ym", "name"]).agg(pl.col("ridership").sum()))
            kom_day_parts.append(df.select(["ym", "d"]).unique())

    f26 = RAW_DATA_DIR / "komuter_2026.csv"
    if f26.exists():
        df26 = pl.read_csv(f26).with_columns([
            pl.col("date").str.slice(0, 7).alias("ym"),
            pl.col("date").str.slice(0, 10).alias("d_str"),
            pl.col("origin").alias("name"),
        ])
        kom_parts.append(df26.group_by(["ym", "name"]).agg(pl.col("ridership").sum()))
        kom_day_parts.append(
            df26.select(["ym", pl.col("d_str").str.to_date("%Y-%m-%d").alias("d")]).unique()
        )
    kom = pl.concat(kom_parts)
    kom_days_df = (
        pl.concat(kom_day_parts).unique().group_by("ym").agg(pl.len().alias("n_days"))
    )
    kom_days = {r["ym"]: int(r["n_days"]) for r in kom_days_df.iter_rows(named=True)}

    # 3. KTM Intercity 2026
    print("  -> Aggregating KTM Intercity / ETS 2026...")
    ic_df = pl.read_csv(RAW_DATA_DIR / "intercity_2026.csv").with_columns([
        pl.col("date").str.slice(0, 7).alias("ym"),
        pl.col("date").str.slice(0, 10).alias("d"),
        pl.col("origin").alias("name"),
    ])
    ic = ic_df.group_by(["ym", "name"]).agg(pl.col("ridership").sum())
    ic_days_df = ic_df.group_by("ym").agg(pl.col("d").n_unique().alias("n_days"))
    ic_days = {r["ym"]: int(r["n_days"]) for r in ic_days_df.iter_rows(named=True)}

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

    observed_days_by_month = {
        "rapidrail": rr_days,
        "komuter": kom_days,
        "intercity": ic_days,
    }

    def source_for_key(key: str) -> str:
        if key.startswith("code_"):
            return "rapidrail"
        if key.startswith("kom_"):
            return "komuter"
        return "intercity"

    # YoY calculations using average daily boardings per observed month
    yoy_data = {}
    within_2026_data = {}
    for ym, stations_map in monthly_station.items():
        y, m = int(ym[:4]), int(ym[5:7])
        prev_ym = f"{y-1}-{m:02d}"
        yoy_data[ym] = {}
        within_2026_data[ym] = {}
        for k, val in stations_map.items():
            src = source_for_key(k)
            days_curr = observed_days_by_month[src].get(ym, 0)
            if days_curr <= 0:
                continue
            curr_daily = val / days_curr

            # 1) Equivalent-month YoY using avg daily rate (handles leap Feb & Komuter partial Sep 2023)
            if prev_ym in monthly_station and k in monthly_station[prev_ym]:
                prev_val = monthly_station[prev_ym][k]
                days_prev = observed_days_by_month[src].get(prev_ym, 0)
                if prev_val > 0 and days_prev > 0:
                    prev_daily = prev_val / days_prev
                    yoy_data[ym][k] = round((curr_daily - prev_daily) / prev_daily * 100, 1)

            # 2) Within-2026 comparison vs Jan 2026 daily baseline (strictly non-YoY, non-zero baseline)
            if ym > "2026-01" and "2026-01" in monthly_station and k in monthly_station["2026-01"]:
                jan_val = monthly_station["2026-01"][k]
                days_jan = observed_days_by_month[src].get("2026-01", 0)
                if jan_val > 0 and days_jan > 0:
                    jan_daily = jan_val / days_jan
                    within_2026_data[ym][k] = round((curr_daily - jan_daily) / jan_daily * 100, 1)

    output = {
        "global_max_ridership": max_val,
        "observed_days_by_month": observed_days_by_month,
        "ridership_by_month": monthly_station,
        "yoy_by_month": yoy_data,
        "within_2026_by_month": within_2026_data,
    }

    save_frontend_json(output, "station_monthly_ridership.json")
    print(f"[Module 1 Ridership] Done — global max: {max_val}, months: {len(monthly_station)}")


if __name__ == "__main__":
    main()
