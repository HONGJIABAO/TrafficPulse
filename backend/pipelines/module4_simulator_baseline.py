"""
module4_simulator_baseline.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 4: What-If Service Simulator Baseline
Output: frontend/src/data/simulator_baseline.json

Computes real average hourly passenger demand curves (00:00–23:00) per
service/line, baseline capacity metrics, CO2 benchmarks, and slider
boundaries for the frontend What-If Simulator.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import polars as pl
import numpy as np
from config import RAW_DATA_DIR, save_frontend_json

# ── Industry Benchmarks (Malaysian rail, public sources) ──────────────────────
CO2_KG_PER_PASSENGER_KM = 0.0141  # Rail vs car: 0.0141 kg CO2/pass-km (UITP 2023)
AVG_TRIP_DISTANCE_KM = {
    "komuter":          25.0,
    "intercity":        150.0,
    "rapid_rail":       12.0,
}
DEFAULT_SEATS = {
    "komuter":          200,
    "intercity":        100,
    "rapid_rail":       300,
}
DEFAULT_TRAINS_PER_HOUR = {
    "komuter":          4,
    "intercity":        2,
    "rapid_rail":       6,
}
SLIDER_BOUNDS = {
    "trains_per_hour": {"min": 1, "max": 20, "step": 1},
    "seats_per_train":  {"min": 50, "max": 600, "step": 10},
}


def compute_hourly_profile(df: pl.DataFrame, service_name: str) -> dict:
    """Average ridership per hour across all days in the dataset."""
    n_days = df["date"].n_unique()
    hourly = (
        df.group_by("hour")
        .agg(pl.col("ridership").sum().alias("total"))
        .with_columns((pl.col("total") / n_days).round(1).alias("avg_ridership"))
        .sort("hour")
    )
    total_avg_daily = round(float(hourly["avg_ridership"].sum()), 1)
    peak_hour_row = hourly.sort("avg_ridership", descending=True).row(0, named=True)

    return {
        "service": service_name,
        "n_days_observed": n_days,
        "avg_daily_ridership": total_avg_daily,
        "peak_hour": int(peak_hour_row["hour"]),
        "peak_hour_avg_ridership": float(peak_hour_row["avg_ridership"]),
        "hourly_profile": [
            {"hour": int(r["hour"]), "avg_ridership": float(r["avg_ridership"])}
            for r in hourly.iter_rows(named=True)
        ],
    }


def compute_capacity_metrics(profile: dict, service_key: str,
                              trains_per_hour: int, seats_per_train: int) -> dict:
    """Compute load factor, hours above capacity, and CO2 reduction vs car."""
    hourly = profile["hourly_profile"]
    capacity_per_hour = trains_per_hour * seats_per_train

    hours_above = sum(1 for h in hourly if h["avg_ridership"] > capacity_per_hour)
    max_demand = max(h["avg_ridership"] for h in hourly) if hourly else 0
    avg_load_factor = round(
        profile["avg_daily_ridership"] / (capacity_per_hour * 24) * 100, 1
    ) if capacity_per_hour > 0 else 0

    # CO2 reduction vs private car (car = 0.192 kg CO2/pass-km, IPCC AR6)
    daily_pass_km = profile["avg_daily_ridership"] * AVG_TRIP_DISTANCE_KM.get(service_key, 15.0)
    co2_saved_kg = round(daily_pass_km * (0.192 - CO2_KG_PER_PASSENGER_KM), 1)

    return {
        "trains_per_hour_default": trains_per_hour,
        "seats_per_train_default": seats_per_train,
        "capacity_per_hour_default": capacity_per_hour,
        "avg_load_factor_pct": avg_load_factor,
        "hours_above_capacity_default": hours_above,
        "peak_demand": round(max_demand, 1),
        "co2_saved_vs_car_kg_per_day": co2_saved_kg,
        "avg_trip_distance_km": AVG_TRIP_DISTANCE_KM.get(service_key, 15.0),
    }


def main():
    # ── Load Komuter ─────────────────────────────────────────────────────────
    print("[Module 4] Reading Komuter files ...")
    komuter_dfs = []
    for fname in ["komuter_2023.parquet", "komuter_2024.parquet", "komuter_2025.parquet"]:
        df = pl.read_parquet(RAW_DATA_DIR / fname)
        df = df.with_columns(pl.col("date").cast(pl.Date))
        komuter_dfs.append(df)
    df_26 = pl.read_csv(RAW_DATA_DIR / "komuter_2026.csv")
    df_26 = df_26.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    komuter_dfs.append(df_26)
    komuter = pl.concat(komuter_dfs)
    komuter = komuter.with_columns(
        pl.col("time").str.slice(0, 2).cast(pl.Int32).alias("hour")
    )

    # ── Load Intercity ───────────────────────────────────────────────────────
    print("[Module 4] Reading intercity_2026.csv ...")
    intercity = pl.read_csv(RAW_DATA_DIR / "intercity_2026.csv")
    intercity = intercity.with_columns([
        pl.col("date").str.to_date("%Y-%m-%d"),
        pl.col("time").str.slice(0, 2).cast(pl.Int32).alias("hour"),
    ])

    # ── Rapid Rail: daily OD → scale to synthetic hourly via fixed profile ───
    print("[Module 4] Reading rapidrail_2026_daily.csv (lazy scan) ...")
    rr = pl.scan_csv(RAW_DATA_DIR / "rapidrail_2026_daily.csv")
    rr = rr.filter(
        ~pl.col("origin").str.starts_with("A0:") &
        ~pl.col("destination").str.starts_with("A0:")
    )
    rr = rr.with_columns(
        pl.col("date").str.slice(0, 10).str.to_date("%Y-%m-%d").alias("date")
    )
    rr_daily = (
        rr.group_by("date")
        .agg(pl.col("ridership").sum().alias("ridership"))
        .sort("date")
        .collect()
    )
    rr_avg_daily = float(rr_daily["ridership"].mean())
    rr_n_days = rr_daily["date"].n_unique()

    # Typical rail hourly distribution (% of daily) — from komuter profile as proxy
    komuter_profile = compute_hourly_profile(komuter, "komuter")
    komuter_total = sum(h["avg_ridership"] for h in komuter_profile["hourly_profile"])
    rr_hourly_profile = []
    for h in komuter_profile["hourly_profile"]:
        share = h["avg_ridership"] / komuter_total if komuter_total > 0 else 1/24
        rr_hourly_profile.append({
            "hour": h["hour"],
            "avg_ridership": round(rr_avg_daily * share, 1),
        })
    rr_peak = max(rr_hourly_profile, key=lambda h: h["avg_ridership"])
    rr_profile = {
        "service": "rapid_rail",
        "n_days_observed": rr_n_days,
        "avg_daily_ridership": round(rr_avg_daily, 1),
        "peak_hour": rr_peak["hour"],
        "peak_hour_avg_ridership": rr_peak["avg_ridership"],
        "hourly_profile": rr_hourly_profile,
        "note": "Hourly profile scaled from Komuter distribution (Rapid Rail data is daily only)",
    }

    # ── Compute profiles ─────────────────────────────────────────────────────
    print("[Module 4] Computing hourly demand profiles ...")
    intercity_profile = compute_hourly_profile(intercity, "intercity")

    # ── Capacity Baselines ───────────────────────────────────────────────────
    komuter_capacity = compute_capacity_metrics(
        komuter_profile, "komuter", DEFAULT_TRAINS_PER_HOUR["komuter"], DEFAULT_SEATS["komuter"]
    )
    intercity_capacity = compute_capacity_metrics(
        intercity_profile, "intercity", DEFAULT_TRAINS_PER_HOUR["intercity"], DEFAULT_SEATS["intercity"]
    )
    rr_capacity = compute_capacity_metrics(
        rr_profile, "rapid_rail", DEFAULT_TRAINS_PER_HOUR["rapid_rail"], DEFAULT_SEATS["rapid_rail"]
    )

    output = {
        "generated_at": "2026-11-22",
        "slider_bounds": SLIDER_BOUNDS,
        "co2_model": {
            "rail_co2_kg_per_pass_km": CO2_KG_PER_PASSENGER_KM,
            "car_co2_kg_per_pass_km": 0.192,
            "source": "UITP 2023, IPCC AR6",
        },
        "services": {
            "komuter": {
                "profile": komuter_profile,
                "capacity_baseline": komuter_capacity,
            },
            "intercity": {
                "profile": intercity_profile,
                "capacity_baseline": intercity_capacity,
            },
            "rapid_rail": {
                "profile": rr_profile,
                "capacity_baseline": rr_capacity,
            },
        },
    }

    save_frontend_json(output, "simulator_baseline.json")
    print("[Module 4] Done — simulator_baseline.json written.")


if __name__ == "__main__":
    main()
