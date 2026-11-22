"""
module2_od_aggregation.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 2: OD Flow & Peak-Hour Analytics
Output: frontend/src/data/od_summary.json

Aggregates Komuter (2023–2026) + Intercity (2026) + Rapid Rail (2026) OD data
into heatmaps, top OD pairs, and weekday vs weekend hourly profiles.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import polars as pl
from config import RAW_DATA_DIR, save_frontend_json


def load_od_files() -> tuple[pl.DataFrame, pl.DataFrame, pl.DataFrame]:
    """Load and standardise Komuter, Intercity, and Rapid Rail OD frames."""

    # -- Komuter: concat 2023-2026 --
    print("[Module 2] Reading Komuter parquet files ...")
    komuter_parts = []
    for fname in ["komuter_2023.parquet", "komuter_2024.parquet", "komuter_2025.parquet"]:
        df = pl.read_parquet(RAW_DATA_DIR / fname)
        df = df.with_columns(pl.col("date").cast(pl.Date))
        komuter_parts.append(df)
    df_26 = pl.read_csv(RAW_DATA_DIR / "komuter_2026.csv")
    df_26 = df_26.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    komuter_parts.append(df_26)
    komuter = pl.concat(komuter_parts)
    komuter = komuter.with_columns(
        pl.col("time").str.slice(0, 2).cast(pl.Int32).alias("hour")
    )
    komuter = komuter.with_columns([
        pl.col("date").dt.weekday().alias("weekday"),  # 0=Mon, 6=Sun
        pl.col("date").dt.year().alias("year"),
    ])

    # -- Intercity 2026 --
    print("[Module 2] Reading intercity_2026.csv ...")
    intercity = pl.read_csv(RAW_DATA_DIR / "intercity_2026.csv")
    intercity = intercity.with_columns(
        pl.col("date").str.to_date("%Y-%m-%d"),
        pl.col("time").str.slice(0, 2).cast(pl.Int32).alias("hour"),
    )
    intercity = intercity.with_columns([
        pl.col("date").dt.weekday().alias("weekday"),
        pl.col("date").dt.year().alias("year"),
    ])

    # -- Rapid Rail 2026: OD-level daily, exclude A0 --
    print("[Module 2] Reading rapidrail_2026_daily.csv (lazy scan) ...")
    rr = pl.scan_csv(RAW_DATA_DIR / "rapidrail_2026_daily.csv")
    rr = rr.filter(
        ~pl.col("origin").str.starts_with("A0:") &
        ~pl.col("destination").str.starts_with("A0:")
    )
    rr = rr.with_columns(
        pl.col("date").str.slice(0, 10).str.to_date("%Y-%m-%d").alias("date")
    )
    rr = rr.with_columns([
        pl.col("date").dt.weekday().alias("weekday"),
        pl.lit(0).alias("hour"),  # daily, no hourly resolution
    ])
    rr = rr.collect()

    return komuter, intercity, rr


def compute_heatmap(df: pl.DataFrame, label: str) -> list:
    """7 (Mon-Sun) x 24 (00-23) demand matrix."""
    heatmap = (
        df.group_by(["weekday", "hour"])
        .agg(pl.col("ridership").sum().alias("ridership"))
        .sort(["weekday", "hour"])
    )
    result = []
    for row in heatmap.iter_rows(named=True):
        result.append({
            "weekday": int(row["weekday"]),
            "hour": int(row["hour"]),
            "ridership": int(row["ridership"]),
        })
    return result


def compute_top_od(df: pl.DataFrame, n: int = 20) -> list:
    """Top N OD pairs by total ridership."""
    top = (
        df.group_by(["origin", "destination"])
        .agg(pl.col("ridership").sum().alias("total_ridership"))
        .sort("total_ridership", descending=True)
        .head(n)
    )
    return top.to_dicts()


def compute_weekday_vs_weekend(df: pl.DataFrame, has_hours: bool = True) -> dict:
    """Average hourly profile: weekday (Mon–Fri) vs weekend (Sat–Sun)."""
    if not has_hours:
        # Daily data without hour — just compare day counts
        wd = df.filter(pl.col("weekday") < 5)
        we = df.filter(pl.col("weekday") >= 5)
        return {
            "weekday_avg_daily": round(wd["ridership"].sum() / max(wd["date"].n_unique(), 1), 1) if "date" in wd.columns else None,
            "weekend_avg_daily": round(we["ridership"].sum() / max(we["date"].n_unique(), 1), 1) if "date" in we.columns else None,
        }

    wd_hourly = (
        df.filter(pl.col("weekday") < 5)
        .group_by("hour")
        .agg(pl.col("ridership").sum().alias("total"), pl.col("date").n_unique().alias("n_days"))
        .with_columns((pl.col("total") / pl.col("n_days")).round(1).alias("avg_ridership"))
        .sort("hour")
    )
    we_hourly = (
        df.filter(pl.col("weekday") >= 5)
        .group_by("hour")
        .agg(pl.col("ridership").sum().alias("total"), pl.col("date").n_unique().alias("n_days"))
        .with_columns((pl.col("total") / pl.col("n_days")).round(1).alias("avg_ridership"))
        .sort("hour")
    )
    return {
        "weekday": [{"hour": int(r["hour"]), "avg_ridership": float(r["avg_ridership"])} for r in wd_hourly.iter_rows(named=True)],
        "weekend": [{"hour": int(r["hour"]), "avg_ridership": float(r["avg_ridership"])} for r in we_hourly.iter_rows(named=True)],
    }


def main():
    komuter, intercity, rr = load_od_files()

    print("[Module 2] Computing weekday x hour heatmaps ...")
    komuter_heatmap = compute_heatmap(komuter, "komuter")
    intercity_heatmap = compute_heatmap(intercity, "intercity")

    print("[Module 2] Computing top OD pairs ...")
    komuter_top_od = compute_top_od(komuter, 20)
    intercity_top_od = compute_top_od(intercity, 20)
    rr_top_od = compute_top_od(rr, 20)
    # Rename cols to string for JSON
    for d in rr_top_od:
        d["total_ridership"] = int(d["total_ridership"])

    print("[Module 2] Computing weekday vs weekend profiles ...")
    komuter_wdwe = compute_weekday_vs_weekend(komuter, has_hours=True)
    intercity_wdwe = compute_weekday_vs_weekend(intercity, has_hours=True)

    output = {
        "generated_at": "2026-11-22",
        "weekday_hour_heatmap": {
            "komuter": komuter_heatmap,
            "intercity": intercity_heatmap,
            "note": "Rapid Rail data is daily-resolution only; no hourly heatmap available.",
        },
        "top_od_pairs": {
            "komuter": komuter_top_od,
            "intercity": intercity_top_od,
            "rapid_rail": rr_top_od,
        },
        "weekday_vs_weekend": {
            "komuter": komuter_wdwe,
            "intercity": intercity_wdwe,
        },
    }

    save_frontend_json(output, "od_summary.json")
    print("[Module 2] Done — od_summary.json written.")


if __name__ == "__main__":
    main()
