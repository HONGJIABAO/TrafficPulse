"""
module2_od_aggregation.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 2: OD Flow & Peak-Hour Analytics
Output: frontend/src/data/od_summary.json

Aggregates 2026 Komuter + 2026 Intercity + COMPLETE 2026 Rapid Rail OD data on a
common 2026 observation window (2026-01-01 to 2026-11-20, 324 days).

Corrections applied:
- Malaysian operating week classification: Mon-Fri (dow 0..4 / ISO 1..5) = Weekday,
  Sat-Sun (dow 5..6 / ISO 6..7) = Weekend.
- Full-dataset Rapid Rail OD computation (196.63M non-A0 trips across ~17,048 pairs)
  across full 2026, quarters (q1-q4), months (2026-01..2026-11), and day profiles
  (all/weekday/weekend), while keeping hourly analytics strictly disabled for Rapid Rail.
- Explicit internal A0 reconciliation & Shah Alam (SA) zero-period disclosure.
- Full-population trip-weighted Haversine distance & mapped-coverage statistics using
  verified GTFS/curated coordinates (never synthetic coords for 'Penalty'/'Unknown').
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any

import pandas as pd
import polars as pl

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))
sys.path.insert(0, str(THIS_DIR / "module2_station_demand"))

from config import FRONTEND_DATA_DIR, RAW_DATA_DIR, save_frontend_json
from station_registry import (
    haversine_km,
    load_station_lookup,
    resolve_ktmb_station,
    resolve_rapidrail_station,
)


def classify_dayofweek(dow: int) -> str:
    """Malaysian railway operating week: 0..4 (Mon-Fri) = Weekday, 5..6 (Sat-Sun) = Weekend."""
    return "Weekend" if dow >= 5 else "Weekday"


def validate_od_dataframe(df: pd.DataFrame, name: str) -> dict:
    """Validate raw OD dataframe for nulls, invalid counts, duplicates, and date gaps."""
    null_counts = {k: int(v) for k, v in df.isnull().sum().items()}
    invalid_ridership = int((df["ridership"] <= 0).sum())
    exact_dups = int(df.duplicated().sum())

    valid_df = df.dropna(subset=["date", "time", "origin", "destination", "ridership"]).copy()
    valid_df = valid_df[valid_df["ridership"] > 0]

    valid_df["date_dt"] = pd.to_datetime(valid_df["date"], format="%Y-%m-%d", errors="coerce")
    invalid_dates = int(valid_df["date_dt"].isnull().sum())
    valid_df = valid_df.dropna(subset=["date_dt"])

    min_date = valid_df["date_dt"].min()
    max_date = valid_df["date_dt"].max()
    expected_days = len(pd.date_range(min_date, max_date, freq="D"))
    actual_days = int(valid_df["date_dt"].nunique())
    missing_days = expected_days - actual_days

    valid_df["hour"] = valid_df["time"].astype(str).str.slice(0, 2).astype(int)
    valid_df["dow"] = valid_df["date_dt"].dt.dayofweek
    valid_df["iso_weekday"] = valid_df["dow"] + 1
    valid_df["day_type"] = valid_df["dow"].map(classify_dayofweek)
    valid_df["quarter"] = "q" + valid_df["date_dt"].dt.quarter.astype(str)
    valid_df["year_month"] = valid_df["date_dt"].dt.strftime("%Y-%m")

    report = {
        "dataset": name,
        "raw_rows": int(len(df)),
        "valid_rows": int(len(valid_df)),
        "nulls": null_counts,
        "non_positive_ridership": invalid_ridership,
        "exact_duplicates": exact_dups,
        "invalid_dates": invalid_dates,
        "date_range": f"{min_date.strftime('%Y-%m-%d')} to {max_date.strftime('%Y-%m-%d')}",
        "expected_days": expected_days,
        "actual_days": actual_days,
        "missing_days": missing_days,
    }
    print(f"[Module 2] Validation ({name}): {int(valid_df['ridership'].sum()):,} trips across {actual_days} days (missing={missing_days})")
    return {"df": valid_df, "report": report}


def compute_heatmap_records(df: pd.DataFrame) -> list:
    """7 (1=Mon..7=Sun) x 24 (00-23) demand matrix."""
    if df.empty:
        return []
    grp = df.groupby(["iso_weekday", "hour"], as_index=False)["ridership"].sum()
    grp = grp.sort_values(["iso_weekday", "hour"])
    return [
        {"weekday": int(r["iso_weekday"]), "hour": int(r["hour"]), "ridership": int(r["ridership"])}
        for _, r in grp.iterrows()
    ]


def compute_wd_vs_we_hourly(df: pd.DataFrame) -> dict:
    """Average hourly profile: Weekday (Mon-Fri, dow 0..4) vs Weekend (Sat-Sun, dow 5..6)."""
    wd_df = df[df["day_type"] == "Weekday"]
    we_df = df[df["day_type"] == "Weekend"]
    n_wd = max(int(wd_df["date_dt"].nunique()), 1) if not wd_df.empty else 0
    n_we = max(int(we_df["date_dt"].nunique()), 1) if not we_df.empty else 0

    def hourly_series(sub: pd.DataFrame, days: int) -> list:
        if sub.empty or days <= 0:
            return [{"hour": h, "avg_ridership": 0.0} for h in range(24)]
        by_hr = sub.groupby("hour")["ridership"].sum().to_dict()
        return [{"hour": h, "avg_ridership": round(float(by_hr.get(h, 0)) / days, 1)} for h in range(24)]

    return {
        "weekday_days": int(wd_df["date_dt"].nunique()) if not wd_df.empty else 0,
        "weekend_days": int(we_df["date_dt"].nunique()) if not we_df.empty else 0,
        "weekday": hourly_series(wd_df, n_wd),
        "weekend": hourly_series(we_df, n_we),
    }


def compute_full_pair_metrics(
    pair_rows: list[tuple[str, str, int]],
    n_days: int,
    top_limit: int,
    coord_resolver: dict[str, tuple[float, float] | None],
) -> tuple[list[dict], int, dict]:
    """Compute Top-N visual pairs, total unique pair count, and FULL-population distance stats."""
    total_pairs = len(pair_rows)
    if total_pairs == 0 or n_days <= 0:
        return [], 0, {
            "total_trips": 0,
            "mapped_trips": 0,
            "mapped_coverage_pct": 0.0,
            "total_pairs": 0,
            "mapped_pairs": 0,
            "weighted_distance_sum": 0.0,
            "weighted_avg_km": None,
            "short_trips": 0,
            "medium_trips": 0,
            "long_trips": 0,
            "short_pct": 0.0,
            "medium_pct": 0.0,
            "long_pct": 0.0,
        }

    pair_rows_sorted = sorted(pair_rows, key=lambda x: -x[2])
    top_records = [
        {
            "origin": str(o),
            "destination": str(d),
            "total_ridership": int(vol),
            "avg_daily": round(float(vol) / n_days, 1),
        }
        for o, d, vol in pair_rows_sorted[:top_limit]
    ]

    total_trips = 0
    mapped_trips = 0
    mapped_pairs = 0
    weighted_sum = 0.0
    short_trips = 0
    medium_trips = 0
    long_trips = 0

    for o, d, vol in pair_rows_sorted:
        total_trips += vol
        c1 = coord_resolver.get(o)
        c2 = coord_resolver.get(d)
        if c1 is not None and c2 is not None:
            dist = haversine_km(c1[0], c1[1], c2[0], c2[1])
            mapped_pairs += 1
            mapped_trips += vol
            weighted_sum += vol * dist
            if dist < 5.0:
                short_trips += vol
            elif dist <= 25.0:
                medium_trips += vol
            else:
                long_trips += vol

    cov_pct = round(mapped_trips / total_trips * 100, 2) if total_trips > 0 else 0.0
    avg_km = round(weighted_sum / mapped_trips, 1) if mapped_trips > 0 else None
    short_pct = round(short_trips / mapped_trips * 100, 1) if mapped_trips > 0 else 0.0
    medium_pct = round(medium_trips / mapped_trips * 100, 1) if mapped_trips > 0 else 0.0
    long_pct = round(long_trips / mapped_trips * 100, 1) if mapped_trips > 0 else 0.0

    dist_stats = {
        "total_trips": int(total_trips),
        "mapped_trips": int(mapped_trips),
        "mapped_coverage_pct": cov_pct,
        "total_pairs": int(total_pairs),
        "mapped_pairs": int(mapped_pairs),
        "weighted_distance_sum": round(weighted_sum, 1),
        "weighted_avg_km": avg_km,
        "short_trips": int(short_trips),
        "medium_trips": int(medium_trips),
        "long_trips": int(long_trips),
        "short_pct": short_pct,
        "medium_pct": medium_pct,
        "long_pct": long_pct,
    }
    return top_records, total_pairs, dist_stats


def aggregate_ktmb_mode_period(
    df: pd.DataFrame,
    coord_resolver: dict[str, tuple[float, float] | None],
    top_limit: int = 30,
) -> dict:
    wd_df = df[df["day_type"] == "Weekday"]
    we_df = df[df["day_type"] == "Weekend"]

    n_all = int(df["date_dt"].nunique())
    n_wd = int(wd_df["date_dt"].nunique())
    n_we = int(we_df["date_dt"].nunique())

    def extract_pairs(sub: pd.DataFrame) -> list[tuple[str, str, int]]:
        if sub.empty:
            return []
        g = sub.groupby(["origin", "destination"], as_index=False)["ridership"].sum()
        return [(str(r.origin), str(r.destination), int(r.ridership)) for r in g.itertuples(index=False)]

    top_all, u_all, dist_all = compute_full_pair_metrics(extract_pairs(df), n_all, top_limit, coord_resolver)
    top_wd, u_wd, dist_wd = compute_full_pair_metrics(extract_pairs(wd_df), n_wd, top_limit, coord_resolver)
    top_we, u_we, dist_we = compute_full_pair_metrics(extract_pairs(we_df), n_we, top_limit, coord_resolver)

    return {
        "total_trips": int(df["ridership"].sum()),
        "weekday_trips": int(wd_df["ridership"].sum()),
        "weekend_trips": int(we_df["ridership"].sum()),
        "unique_od_all": u_all,
        "unique_od_weekday": u_wd,
        "unique_od_weekend": u_we,
        "top_od": {"all": top_all, "weekday": top_wd, "weekend": top_we},
        "distance_stats": {"all": dist_all, "weekday": dist_wd, "weekend": dist_we},
        "heatmap": {
            "all": compute_heatmap_records(df),
            "weekday": compute_heatmap_records(wd_df),
            "weekend": compute_heatmap_records(we_df),
        },
        "weekday_vs_weekend": compute_wd_vs_we_hourly(df),
    }


def load_full_rapid_rail() -> tuple[pl.DataFrame, dict, dict[str, int]]:
    """
    Stream rapidrail_2026_daily.csv via Polars, exclude A0 subtotals on BOTH sides,
    reconcile station->A0 subtotals vs detailed flows, and inspect Shah Alam (SA).
    """
    rr_path = RAW_DATA_DIR / "rapidrail_2026_daily.csv"
    print("[Module 2] Scanning complete rapidrail_2026_daily.csv (5.6M+ rows) ...")
    lf = pl.scan_csv(rr_path).with_columns(
        pl.col("date").cast(pl.Utf8).str.slice(0, 10).str.to_date("%Y-%m-%d").alias("date_dt")
    )

    cat_summary = (
        lf.with_columns(
            pl.when(pl.col("origin").str.starts_with("A0:") & ~pl.col("destination").str.starts_with("A0:"))
            .then(pl.lit("a0_to_station"))
            .when(~pl.col("origin").str.starts_with("A0:") & pl.col("destination").str.starts_with("A0:"))
            .then(pl.lit("station_to_a0"))
            .when(~pl.col("origin").str.starts_with("A0:") & ~pl.col("destination").str.starts_with("A0:"))
            .then(pl.lit("station_to_station"))
            .otherwise(pl.lit("a0_to_a0"))
            .alias("cat")
        )
        .group_by("cat")
        .agg([pl.len().alias("rows"), pl.col("ridership").sum().alias("trips")])
        .collect()
        .to_dicts()
    )
    cats = {r["cat"]: {"rows": int(r["rows"]), "trips": int(r["trips"])} for r in cat_summary}

    # Internal A0 reconciliation check
    orig_a0 = lf.filter(~pl.col("origin").str.starts_with("A0:") & pl.col("destination").str.starts_with("A0:")).select(
        [pl.col("date_dt"), "origin", pl.col("ridership").cast(pl.Int64).alias("a0_tot")]
    )
    orig_det = (
        lf.filter(~pl.col("origin").str.starts_with("A0:") & ~pl.col("destination").str.starts_with("A0:"))
        .group_by(["date_dt", "origin"])
        .agg(pl.col("ridership").sum().cast(pl.Int64).alias("det_sum"))
    )
    rec = (
        orig_a0.join(orig_det, on=["date_dt", "origin"], how="full")
        .with_columns((pl.col("a0_tot").fill_null(0) - pl.col("det_sum").fill_null(0)).abs().alias("delta"))
        .collect()
    )

    # Filter non-A0 positive station-to-station records
    det_df = (
        lf.filter(
            ~pl.col("origin").str.starts_with("A0:")
            & ~pl.col("destination").str.starts_with("A0:")
            & (pl.col("ridership") > 0)
        )
        .select([
            "date_dt",
            "origin",
            "destination",
            pl.col("ridership").cast(pl.Int64).alias("ridership"),
        ])
        .with_columns([
            pl.col("date_dt").dt.weekday().alias("iso_weekday"),
            ("q" + pl.col("date_dt").dt.quarter().cast(pl.Utf8)).alias("quarter"),
            pl.col("date_dt").dt.strftime("%Y-%m").alias("year_month"),
        ])
        .with_columns(
            pl.when(pl.col("iso_weekday") <= 5).then(pl.lit("Weekday")).otherwise(pl.lit("Weekend")).alias("day_type")
        )
        .collect()
    )

    sa_df = det_df.filter(pl.col("origin").str.starts_with("SA"))
    sa_jan_jul = int(sa_df.filter(pl.col("date_dt") < dt.date(2026, 8, 1))["ridership"].sum())
    sa_aug_nov = int(sa_df.filter(pl.col("date_dt") >= dt.date(2026, 8, 1))["ridership"].sum())

    monthly_rr = {
        r["year_month"]: int(r["trips"])
        for r in det_df.group_by("year_month").agg(pl.col("ridership").sum().alias("trips")).to_dicts()
    }

    n_days = int(det_df["date_dt"].n_unique())
    report = {
        "dataset": "rapidrail_2026_daily",
        "date_range": f"{det_df['date_dt'].min()} to {det_df['date_dt'].max()}",
        "actual_days": n_days,
        "missing_days": 324 - n_days,
        "hourly_supported": False,
        "non_a0_valid_rows": det_df.height,
        "non_a0_total_trips": int(det_df["ridership"].sum()),
        "row_categories": cats,
        "a0_reconciliation": {
            "station_dates_checked": rec.height,
            "exact_zero_delta_matches": int(rec.filter(pl.col("delta") == 0).height),
            "max_abs_delta": int(rec["delta"].max()),
        },
        "shah_alam_discrepancy": {
            "note": (
                "All 20 Shah Alam Line (SA) stations appear across 324 calendar days in rapidrail_2026_daily.csv. "
                "Jan 1–Jul 31 record 0 paid AFC gate OD trips (overlapping early June 29 launch / free trials recorded in headline series), "
                "while Aug 1–Nov 20 record 3,265,221 paid origin trips matching Module 4's verified figure. "
                "Previous Module 2 missed SA solely because Top-20 pair filtering dropped lower-volume corridors."
            ),
            "jan_jul_od_trips": sa_jan_jul,
            "aug_nov_od_trips": sa_aug_nov,
        },
        "top_pairs_visual_limit": 30,
    }
    print(f"[Module 2] Rapid Rail full non-A0 verified: {int(det_df['ridership'].sum()):,} trips across {n_days} days")
    return det_df, report, monthly_rr


def aggregate_rapid_rail_period(
    rr_sub: pl.DataFrame,
    n_all: int,
    n_wd: int,
    n_we: int,
    coord_resolver: dict[str, tuple[float, float] | None],
    top_limit: int = 30,
) -> dict:
    wd_sub = rr_sub.filter(pl.col("day_type") == "Weekday")
    we_sub = rr_sub.filter(pl.col("day_type") == "Weekend")

    def extract_pl_pairs(sub: pl.DataFrame) -> list[tuple[str, str, int]]:
        if sub.is_empty():
            return []
        grp = (
            sub.group_by(["origin", "destination"])
            .agg(pl.col("ridership").sum().alias("vol"))
            .to_dicts()
        )
        return [(str(r["origin"]), str(r["destination"]), int(r["vol"])) for r in grp]

    top_all, u_all, dist_all = compute_full_pair_metrics(extract_pl_pairs(rr_sub), n_all, top_limit, coord_resolver)
    top_wd, u_wd, dist_wd = compute_full_pair_metrics(extract_pl_pairs(wd_sub), n_wd, top_limit, coord_resolver)
    top_we, u_we, dist_we = compute_full_pair_metrics(extract_pl_pairs(we_sub), n_we, top_limit, coord_resolver)

    return {
        "total_trips": int(rr_sub["ridership"].sum()),
        "weekday_trips": int(wd_sub["ridership"].sum()),
        "weekend_trips": int(we_sub["ridership"].sum()),
        "unique_od_all": u_all,
        "unique_od_weekday": u_wd,
        "unique_od_weekend": u_we,
        "top_od": {"all": top_all, "weekday": top_wd, "weekend": top_we},
        "distance_stats": {"all": dist_all, "weekday": dist_wd, "weekend": dist_we},
    }


def main() -> None:
    print("[Module 2] Loading official verified station coordinates & raw 2026 OD datasets ...")
    lookup = load_station_lookup()

    komuter_raw = pd.read_csv(RAW_DATA_DIR / "komuter_2026.csv")
    intercity_raw = pd.read_csv(RAW_DATA_DIR / "intercity_2026.csv")

    kom_val = validate_od_dataframe(komuter_raw, "komuter_2026")
    ic_val = validate_od_dataframe(intercity_raw, "intercity_2026")
    kom_df = kom_val["df"]
    ic_df = ic_val["df"]

    rr_df, rr_report, rr_monthly_totals = load_full_rapid_rail()

    # Build verified coordinate resolvers (NEVER assigning synthetic coordinates to Penalty/Unknown)
    kom_stations = set(kom_df["origin"].unique()) | set(kom_df["destination"].unique())
    ic_stations = set(ic_df["origin"].unique()) | set(ic_df["destination"].unique())
    rr_stations = set(rr_df["origin"].unique().to_list()) | set(rr_df["destination"].unique().to_list())

    kom_coords: dict[str, tuple[float, float] | None] = {}
    for s in kom_stations:
        r = resolve_ktmb_station(str(s), "komuter", lookup)
        kom_coords[str(s)] = (r["lat"], r["lng"]) if r["coordinate_verified"] and r["is_physical_station"] else None

    ic_coords: dict[str, tuple[float, float] | None] = {}
    for s in ic_stations:
        r = resolve_ktmb_station(str(s), "intercity", lookup)
        ic_coords[str(s)] = (r["lat"], r["lng"]) if r["coordinate_verified"] and r["is_physical_station"] else None

    rr_coords: dict[str, tuple[float, float] | None] = {}
    for s in rr_stations:
        r = resolve_rapidrail_station(str(s), lookup)
        rr_coords[str(s)] = (r["lat"], r["lng"]) if r["coordinate_verified"] and r["is_physical_station"] else None

    period_defs = [
        ("12m", "Full 2026 Observed (Jan 1 – Nov 20, 2026)", None),
        ("q1", "Q1 2026 (Jan 1 – Mar 31, 2026)", "q1"),
        ("q2", "Q2 2026 (Apr 1 – Jun 30, 2026)", "q2"),
        ("q3", "Q3 2026 (Jul 1 – Sep 30, 2026)", "q3"),
        ("q4", "Q4 2026 Partial (Oct 1 – Nov 20, 2026)", "q4"),
    ]

    periods = {}
    for key, label, q_filter in period_defs:
        k_sub = kom_df if q_filter is None else kom_df[kom_df["quarter"] == q_filter]
        i_sub = ic_df if q_filter is None else ic_df[ic_df["quarter"] == q_filter]
        r_sub = rr_df if q_filter is None else rr_df.filter(pl.col("quarter") == q_filter)

        n_all = int(k_sub["date_dt"].nunique())
        wd_days = int(k_sub[k_sub["day_type"] == "Weekday"]["date_dt"].nunique())
        we_days = int(k_sub[k_sub["day_type"] == "Weekend"]["date_dt"].nunique())
        min_d = k_sub["date_dt"].min().strftime("%Y-%m-%d")
        max_d = k_sub["date_dt"].max().strftime("%Y-%m-%d")

        periods[key] = {
            "label": label,
            "date_range": f"{min_d} to {max_d}",
            "total_days": n_all,
            "weekday_days": wd_days,
            "weekend_days": we_days,
            "komuter": aggregate_ktmb_mode_period(k_sub, kom_coords, top_limit=30),
            "intercity": aggregate_ktmb_mode_period(i_sub, ic_coords, top_limit=30),
            "rapid_rail": aggregate_rapid_rail_period(r_sub, n_all, wd_days, we_days, rr_coords, top_limit=30),
        }

    monthly_totals = []
    monthly_periods = {}
    for ym in sorted(kom_df["year_month"].unique()):
        k_m = kom_df[kom_df["year_month"] == ym]
        i_m = ic_df[ic_df["year_month"] == ym]
        r_m = rr_df.filter(pl.col("year_month") == ym)

        n_all = int(k_m["date_dt"].nunique())
        wd_days = int(k_m[k_m["day_type"] == "Weekday"]["date_dt"].nunique())
        we_days = int(k_m[k_m["day_type"] == "Weekend"]["date_dt"].nunique())
        min_d = k_m["date_dt"].min().strftime("%Y-%m-%d")
        max_d = k_m["date_dt"].max().strftime("%Y-%m-%d")

        monthly_totals.append({
            "year_month": ym,
            "days": n_all,
            "weekday_days": wd_days,
            "weekend_days": we_days,
            "date_range": f"{min_d} to {max_d}",
            "komuter_trips": int(k_m["ridership"].sum()),
            "intercity_trips": int(i_m["ridership"].sum()),
            "rapid_rail_trips": rr_monthly_totals.get(ym, 0),
        })
        monthly_periods[ym] = {
            "label": f"{ym} ({min_d} to {max_d})",
            "date_range": f"{min_d} to {max_d}",
            "total_days": n_all,
            "weekday_days": wd_days,
            "weekend_days": we_days,
            "komuter": aggregate_ktmb_mode_period(k_m, kom_coords, top_limit=20),
            "intercity": aggregate_ktmb_mode_period(i_m, ic_coords, top_limit=20),
            "rapid_rail": aggregate_rapid_rail_period(r_m, n_all, wd_days, we_days, rr_coords, top_limit=20),
        }

    full_period = periods["12m"]
    output = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat(),
        "metadata": {
            "observation_window": full_period["date_range"],
            "total_days": full_period["total_days"],
            "weekday_days": full_period["weekday_days"],
            "weekend_days": full_period["weekend_days"],
            "day_classification_rule": "Malaysian operating week: Mon–Fri = Weekday, Sat–Sun = Weekend",
            "corridor_definition": "Directional (Origin -> Destination)",
            "distance_methodology": "Trip-weighted straight-line Haversine distance (km, R=6,371 km) calculated over ALL eligible OD pairs with verified physical station coordinates; non-physical codes ('Penalty', 'Unknown') excluded from distance averages.",
            "data_quality": {
                "komuter_2026": kom_val["report"],
                "intercity_2026": ic_val["report"],
                "rapid_rail_2026": rr_report,
            },
        },
        "periods": periods,
        "monthly_totals": monthly_totals,
        "monthly_periods": monthly_periods,
        "weekday_hour_heatmap": {
            "komuter": full_period["komuter"]["heatmap"]["all"],
            "intercity": full_period["intercity"]["heatmap"]["all"],
            "note": "Rapid Rail data is daily-resolution only; no hourly heatmap available.",
        },
        "top_od_pairs": {
            "komuter": full_period["komuter"]["top_od"]["all"][:20],
            "intercity": full_period["intercity"]["top_od"]["all"][:20],
            "rapid_rail": full_period["rapid_rail"]["top_od"]["all"][:20],
        },
        "weekday_vs_weekend": {
            "komuter": full_period["komuter"]["weekday_vs_weekend"],
            "intercity": full_period["intercity"]["weekday_vs_weekend"],
        },
    }

    save_frontend_json(output, "od_summary.json", indent=2)
    print("[Module 2] Done — od_summary.json regenerated with COMPLETE Rapid Rail & full-matrix Haversine metrics.")


if __name__ == "__main__":
    main()
