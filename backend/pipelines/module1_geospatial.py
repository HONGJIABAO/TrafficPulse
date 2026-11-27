"""
module1_geospatial.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 1: Network Overview & Spatial Map
Output: frontend/src/data/network_overview.json

Computes validated network KPIs, monthly trends, line performance, KTMB service
breakdowns, and observed KTM Komuter hourly peak profiles directly from
official OpenDOSM / data.gov.my datasets without hardcoded analytical metrics.
"""

from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import polars as pl
from config import RAW_DATA_DIR, save_frontend_json

MYT = timezone(timedelta(hours=8))

RAIL_COLS = [
    "rail_lrt_ampang",
    "rail_mrt_kajang",
    "rail_lrt_kj",
    "rail_monorail",
    "rail_mrt_pjy",
    "rail_lrt_shah_alam",
    "rail_ets",
    "rail_intercity",
    "rail_komuter_utara",
    "rail_tebrau",
    "rail_komuter",
]

RAIL_LABELS = {
    "rail_lrt_ampang": "LRT Ampang–Sri Petaling",
    "rail_mrt_kajang": "MRT Kajang",
    "rail_lrt_kj": "LRT Kelana Jaya",
    "rail_monorail": "KL Monorail",
    "rail_mrt_pjy": "MRT Putrajaya",
    "rail_lrt_shah_alam": "LRT Shah Alam",
    "rail_ets": "KTM ETS",
    "rail_intercity": "KTM Intercity",
    "rail_komuter_utara": "KTM Komuter Utara",
    "rail_tebrau": "KTM Tebrau Shuttle",
    "rail_komuter": "KTM Komuter",
}


def format_month_label(d) -> str:
    return d.strftime("%b %Y") if d is not None else "Unavailable"


def format_12h_window(start_hour: int, end_hour: int) -> str:
    """Format a 24h hour span as compact KpiCard peak string (e.g. '7 – 9 AM')."""
    meridiem = "AM" if end_hour <= 12 else "PM"

    def to_12(h: int) -> int:
        if h == 0 or h == 24:
            return 12
        return h if h <= 12 else h - 12

    return f"{to_12(start_hour)} – {to_12(end_hour)} {meridiem}"


def _summarize_cohort(df: pl.DataFrame, cohort_name: str) -> dict:
    """Compute hourly mean ridership per observed day for an ISO-weekday cohort."""
    observed_days = int(df["date"].n_unique())
    if observed_days == 0:
        raise ValueError(f"Komuter cohort '{cohort_name}' has zero observed dates.")

    hourly = (
        df.group_by("hour")
        .agg(pl.col("ridership").sum().alias("total_trips"))
        .sort("hour")
    )
    hour_totals = {int(r["hour"]): int(r["total_trips"]) for r in hourly.iter_rows(named=True)}
    profile = []
    for h in range(24):
        tot = hour_totals.get(h, 0)
        profile.append({
            "hour": h,
            "avg_trips": round(tot / observed_days, 1),
            "total_trips": tot,
        })

    total_avg_daily = sum(p["avg_trips"] for p in profile)
    single_peak = max(profile, key=lambda p: p["avg_trips"])

    def best_two_hour_window(hours_range: range) -> dict:
        candidates = []
        for h in hours_range:
            avg_2h = profile[h]["avg_trips"] + profile[h + 1]["avg_trips"]
            candidates.append((h, avg_2h))
        best_h, best_avg = max(candidates, key=lambda item: item[1])
        share = round(best_avg / total_avg_daily * 100, 1) if total_avg_daily else 0.0
        return {
            "window_24h": f"{best_h:02d}:00–{best_h + 2:02d}:00",
            "window_display": format_12h_window(best_h, best_h + 2),
            "start_hour": best_h,
            "end_hour": best_h + 2,
            "avg_daily_trips": round(best_avg, 1),
            "share_of_daily_pct": share,
        }

    return {
        "observed_days": observed_days,
        "avg_daily_trips": round(total_avg_daily, 1),
        "single_peak_hour": {
            "window_24h": f"{single_peak['hour']:02d}:00–{single_peak['hour'] + 1:02d}:00",
            "hour": single_peak["hour"],
            "avg_daily_trips": single_peak["avg_trips"],
        },
        "am_peak_2h": best_two_hour_window(range(5, 11)),   # 05:00..11:59 start
        "pm_peak_2h": best_two_hour_window(range(15, 22)),  # 15:00..22:59 start
        "hourly_profile": profile,
    }


def compute_komuter_peak_analysis(kt_daily: pl.DataFrame) -> dict:
    """
    Derive peak-hour metrics dynamically from official KTM Komuter hourly OD files
    (komuter_2023..2026) in Malaysia Time (MYT, UTC+8), dividing strictly by actual
    observed days per cohort (weekday ISO 1–5 vs weekend ISO 6–7).
    """
    parts = []
    for fname in ["komuter_2023.parquet", "komuter_2024.parquet", "komuter_2025.parquet"]:
        df = pl.read_parquet(RAW_DATA_DIR / fname).select(["date", "time", "ridership"])
        parts.append(df.with_columns(pl.col("date").cast(pl.Date)))

    df_26 = pl.read_csv(RAW_DATA_DIR / "komuter_2026.csv").select(["date", "time", "ridership"])
    parts.append(df_26.with_columns(pl.col("date").str.to_date("%Y-%m-%d")))

    kom = pl.concat(parts).filter(
        pl.col("date").is_not_null() & pl.col("time").is_not_null() & pl.col("ridership").is_not_null()
    ).with_columns([
        pl.col("time").str.slice(0, 2).cast(pl.Int32).alias("hour"),
        pl.col("date").dt.weekday().alias("iso_weekday"),  # Polars: 1=Mon .. 5=Fri, 6=Sat, 7=Sun
    ]).filter((pl.col("hour") >= 0) & (pl.col("hour") <= 23))

    dmin, dmax = kom["date"].min(), kom["date"].max()
    obs_days = int(kom["date"].n_unique())
    cal_span_days = (dmax - dmin).days + 1
    missing_dates = cal_span_days - obs_days

    # Reconcile daily OD hourly sums against ridership_ktmb_daily.csv (service == 'komuter')
    od_daily = kom.group_by("date").agg(pl.col("ridership").sum().alias("od_sum"))
    kt_kom = kt_daily.filter(pl.col("service") == "komuter").select(["date", "ridership"])
    rec = kt_kom.join(od_daily, on="date", how="inner").with_columns(
        (pl.col("ridership") - pl.col("od_sum")).abs().alias("abs_delta")
    )

    all_days = _summarize_cohort(kom, "all_days")
    weekdays = _summarize_cohort(kom.filter(pl.col("iso_weekday") <= 5), "weekday_mon_fri")
    weekends = _summarize_cohort(kom.filter(pl.col("iso_weekday") >= 6), "weekend_sat_sun")

    return {
        "service_scope": "KTM Komuter (hourly OD only; Rapid Rail OD lacks hourly timestamps)",
        "timezone": "Asia/Kuala_Lumpur (MYT, UTC+8)",
        "observation_start": str(dmin),
        "observation_end": str(dmax),
        "observed_days": obs_days,
        "calendar_span_days": cal_span_days,
        "missing_calendar_days": missing_dates,
        "total_hourly_od_rows": int(kom.height),
        "total_hourly_trips": int(kom["ridership"].sum()),
        "daily_reconciliation": {
            "matched_dates": int(rec.height),
            "exact_matches": int(rec.filter(pl.col("abs_delta") == 0).height),
            "max_abs_delta": int(rec["abs_delta"].max()) if rec.height else None,
        },
        "methodology": (
            "Hourly trip totals summed across all OD pairs per cohort and divided strictly by "
            "unique observed dates (ISO weekday <= 5 Mon-Fri vs >= 6 Sat-Sun). Peak 2-hour windows "
            "maximize consecutive 2-hour mean ridership in AM (05:00-12:00) and PM (15:00-23:00)."
        ),
        "all_days": all_days,
        "weekday_mon_fri": weekdays,
        "weekend_sat_sun": weekends,
    }


def main():
    print("[Module 1] Reading ridership_headline.csv ...")
    rh = pl.read_csv(RAW_DATA_DIR / "ridership_headline.csv")

    rh = rh.with_columns([
        pl.col(c).cast(pl.Float64, strict=False) for c in RAIL_COLS
    ]).with_columns(
        pl.col("date").str.to_date("%Y-%m-%d").alias("date")
    )

    # Compute daily rail total (excluding bus columns)
    rh = rh.with_columns(
        pl.sum_horizontal([pl.col(c) for c in RAIL_COLS]).alias("rail_total")
    ).filter(pl.col("rail_total").is_not_null())

    rh = rh.with_columns([
        pl.col("date").dt.year().alias("year"),
        pl.col("date").dt.month().alias("month"),
        (
            pl.col("date").dt.year().cast(pl.String)
            + "-"
            + pl.col("date").dt.month().cast(pl.String).str.zfill(2)
        ).alias("year_month"),
    ])

    hl_start = rh["date"].min()
    hl_end = rh["date"].max()
    hl_days = int(rh["date"].n_unique())

    # ── KPIs ────────────────────────────────────────────────────────────────
    print("[Module 1] Computing headline & equivalent-period YTD KPIs ...")

    # Full calendar years only (>= 365 days) so incomplete current year is never compared raw vs 12m
    full_years = (
        rh.group_by("year")
        .agg(pl.col("date").n_unique().alias("n_days"))
        .filter(pl.col("n_days") >= 365)
        .sort("year")
    )
    year_list = full_years["year"].to_list()
    curr_year = int(year_list[-1])
    prev_year = int(year_list[-2])

    curr_total = float(rh.filter(pl.col("year") == curr_year)["rail_total"].sum())
    prev_total = float(rh.filter(pl.col("year") == prev_year)["rail_total"].sum())
    yoy_pct = round((curr_total - prev_total) / prev_total * 100, 2) if prev_total else 0.0

    # Equivalent YTD comparison for partial latest year (e.g. Jan-Aug 2026 vs Jan-Aug 2025)
    latest_year = int(hl_end.year)
    ytd_yoy_pct = None
    ytd_label = None
    if latest_year > curr_year:
        ytd_curr_df = rh.filter(
            (pl.col("date") >= pl.date(latest_year, 1, 1)) & (pl.col("date") <= hl_end)
        )
        prev_end = hl_end.replace(year=latest_year - 1)
        ytd_prev_df = rh.filter(
            (pl.col("date") >= pl.date(latest_year - 1, 1, 1)) & (pl.col("date") <= prev_end)
        )
        ytd_curr = float(ytd_curr_df["rail_total"].sum())
        ytd_prev = float(ytd_prev_df["rail_total"].sum())
        if ytd_prev > 0 and ytd_curr_df.height == ytd_prev_df.height:
            ytd_yoy_pct = round((ytd_curr - ytd_prev) / ytd_prev * 100, 2)
            ytd_label = f"Jan–{hl_end.strftime('%b')} {latest_year} vs {latest_year - 1}"

    line_totals = {col: float(rh[col].sum() or 0.0) for col in RAIL_COLS}
    busiest_col = max(line_totals, key=lambda k: line_totals[k])
    grand_total = sum(line_totals.values())
    busiest_share = round(line_totals[busiest_col] / grand_total * 100, 2) if grand_total else 0.0

    # ── KTMB Daily + Komuter Hourly Peak Hour ───────────────────────────────
    print("[Module 1] Reading ridership_ktmb_daily.csv & komuter hourly OD ...")
    kt = pl.read_csv(RAW_DATA_DIR / "ridership_ktmb_daily.csv").with_columns(
        pl.col("date").str.to_date("%Y-%m-%d").alias("date")
    ).filter(pl.col("date").is_not_null() & pl.col("ridership").is_not_null())

    peak_analysis = compute_komuter_peak_analysis(kt)
    wk_am = peak_analysis["weekday_mon_fri"]["am_peak_2h"]
    wk_pm = peak_analysis["weekday_mon_fri"]["pm_peak_2h"]

    headline_period_str = f"{format_month_label(hl_start)}–{format_month_label(hl_end)}"
    kpis = {
        "total_rail_trips": int(round(grand_total)),
        "data_period": str(curr_year),
        "yoy_growth_pct": yoy_pct,
        "comparison_year": prev_year,
        "headline_start": str(hl_start),
        "headline_end": str(hl_end),
        "headline_period": headline_period_str,
        "ytd_yoy_growth_pct": ytd_yoy_pct,
        "ytd_comparison_label": ytd_label,
        "busiest_line": RAIL_LABELS.get(busiest_col, busiest_col),
        "busiest_line_total": int(round(line_totals[busiest_col])),
        "busiest_line_share_pct": busiest_share,
        "peak_hour_window": wk_am["window_display"],
        "peak_hour_am_24h": wk_am["window_24h"],
        "peak_hour_pm_24h": wk_pm["window_24h"],
        "peak_hour_sub": f"KTM Komuter · PM {wk_pm['window_24h']}",
        "peak_hour_note": (
            f"KTM Komuter weekday Mon–Fri observed AM peak {wk_am['window_24h']} "
            f"({wk_am['share_of_daily_pct']}%, peak hour {peak_analysis['weekday_mon_fri']['single_peak_hour']['window_24h']}) "
            f"& PM peak {wk_pm['window_24h']} ({wk_pm['share_of_daily_pct']}%) across "
            f"{peak_analysis['weekday_mon_fri']['observed_days']} weekdays "
            f"({peak_analysis['observation_start']} to {peak_analysis['observation_end']}, MYT). "
            "Rapid Rail hourly timestamps are unavailable."
        ),
    }

    # ── Monthly Trend (with positive observed days per line for zero-bias YTD) ──
    print("[Module 1] Computing monthly trend ...")
    monthly = (
        rh.group_by(["year_month", "year", "month"])
        .agg(
            [
                pl.col("rail_total").sum().alias("total"),
                pl.len().alias("n_days"),
            ]
            + [pl.col(c).sum().alias(c) for c in RAIL_COLS]
            + [
                (pl.col(c).is_not_null() & (pl.col(c) > 0)).sum().alias(f"{c}_days")
                for c in RAIL_COLS
            ]
        )
        .sort(["year", "month"])
    )

    monthly_trend = []
    for row in monthly.iter_rows(named=True):
        monthly_trend.append({
            "year_month": row["year_month"],
            "year": int(row["year"]),
            "month": int(row["month"]),
            "days": int(row["n_days"]),
            "total": int(round(row["total"] or 0)),
            "lines": {
                RAIL_LABELS[c]: int(round(row[c] or 0))
                for c in RAIL_COLS
            },
            "line_days": {
                RAIL_LABELS[c]: int(row[f"{c}_days"] or 0)
                for c in RAIL_COLS
            },
        })

    # ── Pre-COVID 2019 Continuous 4-Line Rapid Rail Baseline (RO1 / SDG 9) ──
    print("[Module 1] Computing Pre-COVID 2019 4-line continuous legacy comparison ...")
    legacy_cols = ["rail_lrt_ampang", "rail_mrt_kajang", "rail_lrt_kj", "rail_monorail"]
    rh_leg = rh.with_columns(
        pl.sum_horizontal([pl.col(c) for c in legacy_cols]).alias("legacy_total")
    )
    leg_full_19 = rh_leg.filter(pl.col("year") == 2019)
    leg_ytd_19 = rh_leg.filter(
        (pl.col("date") >= pl.date(2019, 1, 1)) & (pl.col("date") <= hl_end.replace(year=2019))
    )
    leg_ytd_latest = rh_leg.filter(
        (pl.col("date") >= pl.date(latest_year, 1, 1)) & (pl.col("date") <= hl_end)
    )

    full19_tot = float(leg_full_19["legacy_total"].sum())
    full19_days = int(leg_full_19.height)
    full19_daily = full19_tot / full19_days if full19_days else 0.0

    ytd19_tot = float(leg_ytd_19["legacy_total"].sum())
    ytd19_days = int(leg_ytd_19.height)
    ytd19_daily = ytd19_tot / ytd19_days if ytd19_days else 0.0

    ytd_lat_tot = float(leg_ytd_latest["legacy_total"].sum())
    ytd_lat_days = int(leg_ytd_latest.height)
    ytd_lat_daily = ytd_lat_tot / ytd_lat_days if ytd_lat_days else 0.0

    legacy_per_line = []
    for c in legacy_cols:
        c_f19_d = float(leg_full_19[c].sum()) / full19_days if full19_days else 0.0
        c_y19_d = float(leg_ytd_19[c].sum()) / ytd19_days if ytd19_days else 0.0
        c_ylat_d = float(leg_ytd_latest[c].sum()) / ytd_lat_days if ytd_lat_days else 0.0
        legacy_per_line.append({
            "line": RAIL_LABELS[c],
            "column": c,
            "full_2019_daily_avg": round(c_f19_d, 1),
            "ytd_2019_daily_avg": round(c_y19_d, 1),
            "ytd_latest_daily_avg": round(c_ylat_d, 1),
            "vs_full_2019_pct": round((c_ylat_d - c_f19_d) / c_f19_d * 100, 2) if c_f19_d else None,
            "vs_same_period_2019_pct": round((c_ylat_d - c_y19_d) / c_y19_d * 100, 2) if c_y19_d else None,
        })

    legacy_comparison = {
        "lines_included": [RAIL_LABELS[c] for c in legacy_cols],
        "full_2019_total": int(round(full19_tot)),
        "full_2019_days": full19_days,
        "full_2019_daily_avg": round(full19_daily, 1),
        "ytd_2019_label": f"Jan–{hl_end.strftime('%b')} 2019",
        "ytd_2019_total": int(round(ytd19_tot)),
        "ytd_2019_days": ytd19_days,
        "ytd_2019_daily_avg": round(ytd19_daily, 1),
        "ytd_latest_label": f"Jan–{hl_end.strftime('%b')} {latest_year}",
        "ytd_latest_total": int(round(ytd_lat_tot)),
        "ytd_latest_days": ytd_lat_days,
        "ytd_latest_daily_avg": round(ytd_lat_daily, 1),
        "vs_full_2019_daily_pct": round((ytd_lat_daily - full19_daily) / full19_daily * 100, 2) if full19_daily else None,
        "vs_same_period_2019_daily_pct": round((ytd_lat_daily - ytd19_daily) / ytd19_daily * 100, 2) if ytd19_daily else None,
        "per_line": legacy_per_line,
    }

    # ── Line Performance ─────────────────────────────────────────────────────
    print("[Module 1] Computing line performance ...")
    line_performance = []
    for col in RAIL_COLS:
        col_total = line_totals[col]
        curr_df = rh.filter((pl.col("year") == curr_year) & (pl.col(col).is_not_null()) & (pl.col(col) > 0))
        prev_df = rh.filter((pl.col("year") == prev_year) & (pl.col(col).is_not_null()) & (pl.col(col) > 0))
        # Require near-full-year active service in both comparison years to prevent partial-year YoY bias
        if curr_df.height >= 350 and prev_df.height >= 350:
            curr_line = float(curr_df[col].sum())
            prev_line = float(prev_df[col].sum())
            line_yoy = round((curr_line - prev_line) / prev_line * 100, 2) if prev_line else None
        else:
            line_yoy = None

        pos_df = rh.filter(pl.col(col).is_not_null() & (pl.col(col) > 0))
        act_start = pos_df["date"].min() if pos_df.height else None
        act_end = pos_df["date"].max() if pos_df.height else None

        line_performance.append({
            "line": RAIL_LABELS[col],
            "column": col,
            "total_ridership": int(round(col_total)),
            "share_pct": round(col_total / grand_total * 100, 2) if grand_total else 0.0,
            "yoy_growth_pct": line_yoy,
            "observation_start": str(act_start) if act_start else None,
            "observation_end": str(act_end) if act_end else None,
            "observed_days": int(pos_df.height),
            "active_period": f"{format_month_label(act_start)}–{format_month_label(act_end)}" if act_start else "Unavailable",
        })
    line_performance.sort(key=lambda x: x["total_ridership"], reverse=True)

    # ── KTMB Services Breakdown ──────────────────────────────────────────────
    print("[Module 1] Computing KTMB service breakdown ...")
    kt_with_yr = kt.with_columns(pl.col("date").dt.year().alias("year"))
    ktmb_by_service = (
        kt_with_yr.group_by("service")
        .agg([
            pl.col("ridership").sum().alias("total"),
            pl.col("date").min().alias("d0"),
            pl.col("date").max().alias("d1"),
            pl.len().alias("n_days"),
        ])
        .sort("total", descending=True)
    )
    ktmb_total = float(ktmb_by_service["total"].sum())
    ktmb_services = []
    for row in ktmb_by_service.iter_rows(named=True):
        svc = row["service"]
        s25 = float(kt_with_yr.filter((pl.col("service") == svc) & (pl.col("year") == curr_year))["ridership"].sum())
        s24 = float(kt_with_yr.filter((pl.col("service") == svc) & (pl.col("year") == prev_year))["ridership"].sum())
        n25 = kt_with_yr.filter((pl.col("service") == svc) & (pl.col("year") == curr_year)).height
        n24 = kt_with_yr.filter((pl.col("service") == svc) & (pl.col("year") == prev_year)).height
        svc_yoy = round((s25 - s24) / s24 * 100, 2) if (s24 > 0 and n25 >= 350 and n24 >= 350) else None
        ktmb_services.append({
            "service": svc,
            "total_ridership": int(row["total"]),
            "share_pct": round(row["total"] / ktmb_total * 100, 2) if ktmb_total else 0.0,
            "observation_start": str(row["d0"]),
            "observation_end": str(row["d1"]),
            "observed_days": int(row["n_days"]),
            "yoy_growth_pct": svc_yoy,
        })

    # ── KTMB Monthly Trend ───────────────────────────────────────────────────
    kt2 = kt.with_columns([
        pl.col("date").dt.year().alias("year"),
        pl.col("date").dt.month().alias("month"),
        (
            pl.col("date").dt.year().cast(pl.String)
            + "-"
            + pl.col("date").dt.month().cast(pl.String).str.zfill(2)
        ).alias("year_month"),
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
        "generated_at": datetime.now(MYT).date().isoformat(),
        "kpis": kpis,
        "peak_analysis": peak_analysis,
        "coverage": {
            "headline_ridership": {
                "start": str(hl_start),
                "end": str(hl_end),
                "days": hl_days,
            },
            "ktmb_daily": {
                "start": str(kt["date"].min()),
                "end": str(kt["date"].max()),
                "services": 5,
            },
            "komuter_hourly": {
                "start": peak_analysis["observation_start"],
                "end": peak_analysis["observation_end"],
                "observed_days": peak_analysis["observed_days"],
            },
        },
        "sources": [
            {
                "dataset": "Daily Headline Public Transport Ridership",
                "publisher": "Prasarana, KTMB & Ministry of Transport via OpenDOSM / data.gov.my",
                "url": "https://data.gov.my/data-catalogue/ridership_headline",
                "period": f"{hl_start} to {hl_end}",
                "granularity": "Daily by rail service (11 rail series)",
                "license": "CC BY 4.0",
            },
            {
                "dataset": "KTM Komuter Hourly Origin-Destination Ridership",
                "publisher": "KTMB & Ministry of Transport via data.gov.my",
                "url": "https://data.gov.my/data-catalogue/ridership_od_komuter",
                "period": f"{peak_analysis['observation_start']} to {peak_analysis['observation_end']}",
                "granularity": "Hourly OD pairs (MYT, UTC+8)",
                "license": "CC BY 4.0",
            },
            {
                "dataset": "KTMB Daily Ridership by Service",
                "publisher": "KTMB via data.gov.my",
                "period": f"{kt['date'].min()} to {kt['date'].max()}",
                "granularity": "Daily by KTMB service (5 services)",
                "license": "CC BY 4.0",
            },
            {
                "dataset": "Rapid Rail Station-Origin Daily OD Ridership",
                "publisher": "Prasarana & Ministry of Transport via data.gov.my",
                "url": "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily",
                "period": "2026-01-01 to 2026-11-20",
                "granularity": "Daily OD pairs (station boardings on atlas)",
                "license": "CC BY 4.0",
            },
            {
                "dataset": "Rapid Rail KL & KTMB Static GTFS Feeds",
                "publisher": "Prasarana & KTMB via data.gov.my Developer API",
                "url": "https://developer.data.gov.my/realtime-api/gtfs-static",
                "granularity": "Route shapes (Rapid Rail), stop_times/trips (Rapid Rail & KTMB)",
                "license": "CC BY 4.0",
            },
            {
                "dataset": "Malaysia Administrative Country & State Geodata",
                "publisher": "Department of Statistics Malaysia (DOSM)",
                "url": "https://github.com/dosm-malaysia/data-open/tree/main/datasets/geodata",
                "granularity": "National & 16 state/territory polygons",
                "license": "CC BY 4.0",
            },
        ],
        "monthly_trend": monthly_trend,
        "legacy_comparison": legacy_comparison,
        "line_performance": line_performance,
        "ktmb_services": ktmb_services,
        "ktmb_monthly_trend": ktmb_monthly_list,
    }

    save_frontend_json(output, "network_overview.json")
    print("[Module 1] Done — network_overview.json written.")


if __name__ == "__main__":
    main()
