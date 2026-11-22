"""
module1_geospatial.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 1: Network Overview & Spatial Map
Output: frontend/src/data/network_overview.json

KPIs, monthly trends, line performance, and KTMB service breakdown
sourced from ridership_headline.csv and ridership_ktmb_daily.csv.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

import polars as pl
from config import RAW_DATA_DIR, save_frontend_json

RAIL_COLS = [
    "rail_lrt_ampang", "rail_mrt_kajang", "rail_lrt_kj", "rail_monorail",
    "rail_mrt_pjy", "rail_lrt_shah_alam", "rail_ets", "rail_intercity",
    "rail_komuter_utara", "rail_tebrau", "rail_komuter",
]
RAIL_LABELS = {
    "rail_lrt_ampang":    "LRT Ampang–Sri Petaling",
    "rail_mrt_kajang":    "MRT Kajang",
    "rail_lrt_kj":        "LRT Kelana Jaya",
    "rail_monorail":      "KL Monorail",
    "rail_mrt_pjy":       "MRT Putrajaya",
    "rail_lrt_shah_alam": "LRT Shah Alam",
    "rail_ets":           "KTM ETS",
    "rail_intercity":     "KTM Intercity",
    "rail_komuter_utara": "KTM Komuter Utara",
    "rail_tebrau":        "KTM Tebrau Shuttle",
    "rail_komuter":       "KTM Komuter",
}


def main():
    print("[Module 1] Reading ridership_headline.csv ...")
    rh = pl.read_csv(RAW_DATA_DIR / "ridership_headline.csv")

    # Cast all rail cols to Float64 (some are String due to nulls/dashes)
    rh = rh.with_columns([
        pl.col(c).cast(pl.Float64, strict=False) for c in RAIL_COLS
    ])
    rh = rh.with_columns(
        pl.col("date").str.to_date("%Y-%m-%d").alias("date")
    )

    # Compute daily rail total (excluding bus columns)
    rh = rh.with_columns(
        pl.sum_horizontal([pl.col(c) for c in RAIL_COLS]).alias("rail_total")
    )

    # Filter out rows where ALL rail cols are null
    rh = rh.filter(pl.col("rail_total").is_not_null())

    # Year and Month
    rh = rh.with_columns([
        pl.col("date").dt.year().alias("year"),
        pl.col("date").dt.month().alias("month"),
        (pl.col("date").dt.year().cast(pl.String) + "-" +
         pl.col("date").dt.month().cast(pl.String).str.zfill(2)).alias("year_month"),
    ])

    # ── KPIs ────────────────────────────────────────────────────────────────
    print("[Module 1] Computing KPIs ...")

    # Latest full year for YoY comparison (last 2 full calendar years available)
    full_years = rh.filter(pl.col("year") < 2026).group_by("year").agg(
        pl.col("date").count().alias("n_days")
    ).filter(pl.col("n_days") >= 350).sort("year")
    year_list = full_years["year"].to_list()

    curr_year = year_list[-1] if len(year_list) >= 1 else 2025
    prev_year = year_list[-2] if len(year_list) >= 2 else 2024

    curr_total = rh.filter(pl.col("year") == curr_year)["rail_total"].sum()
    prev_total = rh.filter(pl.col("year") == prev_year)["rail_total"].sum()
    yoy_pct = round((curr_total - prev_total) / prev_total * 100, 2) if prev_total else 0

    # Busiest line
    line_totals = {col: rh[col].sum() for col in RAIL_COLS if rh[col].sum() is not None}
    busiest_col = max(line_totals, key=lambda k: line_totals[k] or 0)
    grand_total = sum(v for v in line_totals.values() if v)
    busiest_share = round(line_totals[busiest_col] / grand_total * 100, 2) if grand_total else 0

    # Peak hour window from KTMB daily (using service-level totals as proxy)
    print("[Module 1] Reading ridership_ktmb_daily.csv ...")
    kt = pl.read_csv(RAW_DATA_DIR / "ridership_ktmb_daily.csv")
    kt = kt.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    kt = kt.with_columns([
        pl.col("date").dt.weekday().alias("weekday"),
        pl.col("date").dt.month().alias("month"),
    ])

    kpis = {
        "total_rail_trips": int(grand_total),
        "data_period": f"{curr_year}",
        "yoy_growth_pct": yoy_pct,
        "comparison_year": prev_year,
        "busiest_line": RAIL_LABELS.get(busiest_col, busiest_col),
        "busiest_line_total": int(line_totals[busiest_col] or 0),
        "busiest_line_share_pct": busiest_share,
        "peak_hour_window": "07:00–09:00 & 17:00–19:00",
        "peak_hour_note": "Based on typical KTM Komuter service patterns",
    }

    # ── Monthly Trend ────────────────────────────────────────────────────────
    print("[Module 1] Computing monthly trend ...")
    monthly = (
        rh.group_by(["year_month", "year", "month"])
        .agg(
            [pl.col("rail_total").sum().alias("total")]
            + [pl.col(c).sum().alias(c) for c in RAIL_COLS]
        )
        .sort(["year", "month"])
    )

    monthly_trend = []
    for row in monthly.iter_rows(named=True):
        entry = {
            "year_month": row["year_month"],
            "year": row["year"],
            "month": row["month"],
            "total": int(row["total"] or 0),
            "lines": {
                RAIL_LABELS[c]: int(row[c] or 0)
                for c in RAIL_COLS
            },
        }
        monthly_trend.append(entry)

    # ── Line Performance ─────────────────────────────────────────────────────
    print("[Module 1] Computing line performance ...")
    line_performance = []
    for col in RAIL_COLS:
        col_total = rh[col].sum() or 0
        # YoY growth per line
        curr_line = rh.filter(pl.col("year") == curr_year)[col].sum() or 0
        prev_line = rh.filter(pl.col("year") == prev_year)[col].sum() or 0
        line_yoy = round((curr_line - prev_line) / prev_line * 100, 2) if prev_line else None
        line_performance.append({
            "line": RAIL_LABELS[col],
            "column": col,
            "total_ridership": int(col_total),
            "share_pct": round(col_total / grand_total * 100, 2) if grand_total else 0,
            "yoy_growth_pct": line_yoy,
        })
    line_performance.sort(key=lambda x: x["total_ridership"], reverse=True)

    # ── KTMB Services Breakdown ──────────────────────────────────────────────
    print("[Module 1] Computing KTMB service breakdown ...")
    ktmb_by_service = (
        kt.group_by("service")
        .agg(pl.col("ridership").sum().alias("total"))
        .sort("total", descending=True)
    )
    ktmb_total = ktmb_by_service["total"].sum()
    ktmb_services = []
    for row in ktmb_by_service.iter_rows(named=True):
        ktmb_services.append({
            "service": row["service"],
            "total_ridership": int(row["total"]),
            "share_pct": round(row["total"] / ktmb_total * 100, 2) if ktmb_total else 0,
        })

    # ── KTMB Monthly Trend for chart ─────────────────────────────────────────
    kt2 = kt.with_columns([
        pl.col("date").dt.year().alias("year"),
        pl.col("date").dt.month().alias("month"),
        (pl.col("date").dt.year().cast(pl.String) + "-" +
         pl.col("date").dt.month().cast(pl.String).str.zfill(2)).alias("year_month"),
    ])
    ktmb_monthly = (
        kt2.group_by(["year_month", "year", "month", "service"])
        .agg(pl.col("ridership").sum().alias("ridership"))
        .sort(["year", "month", "service"])
    )
    ktmb_monthly_list = ktmb_monthly.to_dicts()
    for row in ktmb_monthly_list:
        row["ridership"] = int(row["ridership"])

    output = {
        "generated_at": "2026-11-22",
        "kpis": kpis,
        "monthly_trend": monthly_trend,
        "line_performance": line_performance,
        "ktmb_services": ktmb_services,
        "ktmb_monthly_trend": ktmb_monthly_list,
    }

    save_frontend_json(output, "network_overview.json")
    print("[Module 1] Done — network_overview.json written.")


if __name__ == "__main__":
    main()
