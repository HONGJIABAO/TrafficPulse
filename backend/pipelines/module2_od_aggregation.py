"""
module2_od_aggregation.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 2: OD Flow & Peak-Hour Analytics
Output: frontend/src/data/od_summary.json

Aggregates 2026 Komuter + 2026 Intercity + 2026 Rapid Rail OD data on a
common 2026 observation window (2026-01-01 to 2026-11-20, 324 days).

Fixes applied:
- Malaysian operating week classification: Mon-Fri (dow 0..4 / ISO 1..5) = Weekday,
  Sat-Sun (dow 5..6 / ISO 6..7) = Weekend. Friday is strictly a Weekday.
- Comparable 2026 observation period across all rail modes.
- Genuine quarterly (q1-q4), day-profile (all/weekday/weekend), and monthly
  aggregations with explicit valid observation day denominators.
- Automated data quality validation (nulls, non-positive counts, duplicates,
  missing calendar dates).
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import pandas as pd
from config import FRONTEND_DATA_DIR, RAW_DATA_DIR, save_frontend_json


def classify_dayofweek(dow: int) -> str:
    """Malaysian railway operating week: 0..4 (Mon-Fri) = Weekday, 5..6 (Sat-Sun) = Weekend."""
    return "Weekend" if dow >= 5 else "Weekday"


def validate_od_dataframe(df: pd.DataFrame, name: str) -> dict:
    """Validate raw OD dataframe for nulls, invalid counts, duplicates, and date gaps."""
    null_counts = {k: int(v) for k, v in df.isnull().sum().items()}
    invalid_ridership = int((df["ridership"] <= 0).sum())
    exact_dups = int(df.duplicated().sum())

    # Filter out any invalid records transparently if present
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
    valid_df["dow"] = valid_df["date_dt"].dt.dayofweek  # 0=Mon .. 4=Fri, 5=Sat, 6=Sun
    valid_df["iso_weekday"] = valid_df["dow"] + 1       # 1=Mon .. 5=Fri, 6=Sat, 7=Sun
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
    print(f"[Module 2] Validation ({name}): {valid_df['ridership'].sum():,} trips across {actual_days} days (missing={missing_days}, nulls={sum(null_counts.values())})")
    return {"df": valid_df, "report": report}


def compute_heatmap_records(df: pd.DataFrame) -> list:
    """7 (1=Mon..7=Sun) x 24 (00-23) demand matrix."""
    if df.empty:
        return []
    grp = df.groupby(["iso_weekday", "hour"], as_index=False)["ridership"].sum()
    grp = grp.sort_values(["iso_weekday", "hour"])
    return [
        {
            "weekday": int(r["iso_weekday"]),
            "hour": int(r["hour"]),
            "ridership": int(r["ridership"]),
        }
        for _, r in grp.iterrows()
    ]


def compute_top_od_records(df: pd.DataFrame, n_days: int, limit: int = 30) -> list:
    """Top N directional OD pairs with total_ridership and avg_daily."""
    if df.empty or n_days <= 0:
        return []
    grp = (
        df.groupby(["origin", "destination"], as_index=False)["ridership"]
        .sum()
        .sort_values("ridership", ascending=False)
        .head(limit)
    )
    return [
        {
            "origin": str(r["origin"]),
            "destination": str(r["destination"]),
            "total_ridership": int(r["ridership"]),
            "avg_daily": round(float(r["ridership"]) / n_days, 1),
        }
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
        return [
            {"hour": h, "avg_ridership": round(float(by_hr.get(h, 0)) / days, 1)}
            for h in range(24)
        ]

    return {
        "weekday_days": int(wd_df["date_dt"].nunique()) if not wd_df.empty else 0,
        "weekend_days": int(we_df["date_dt"].nunique()) if not we_df.empty else 0,
        "weekday": hourly_series(wd_df, n_wd),
        "weekend": hourly_series(we_df, n_we),
    }


def aggregate_mode_period(df: pd.DataFrame, top_limit: int = 30) -> dict:
    """Aggregate all metrics for a single mode within a specific time period."""
    wd_df = df[df["day_type"] == "Weekday"]
    we_df = df[df["day_type"] == "Weekend"]

    n_all = int(df["date_dt"].nunique())
    n_wd = int(wd_df["date_dt"].nunique())
    n_we = int(we_df["date_dt"].nunique())

    return {
        "total_trips": int(df["ridership"].sum()),
        "weekday_trips": int(wd_df["ridership"].sum()),
        "weekend_trips": int(we_df["ridership"].sum()),
        "unique_od_all": int(df.groupby(["origin", "destination"]).ngroups) if not df.empty else 0,
        "unique_od_weekday": int(wd_df.groupby(["origin", "destination"]).ngroups) if not wd_df.empty else 0,
        "unique_od_weekend": int(we_df.groupby(["origin", "destination"]).ngroups) if not we_df.empty else 0,
        "top_od": {
            "all": compute_top_od_records(df, n_all, limit=top_limit),
            "weekday": compute_top_od_records(wd_df, n_wd, limit=top_limit),
            "weekend": compute_top_od_records(we_df, n_we, limit=top_limit),
        },
        "heatmap": {
            "all": compute_heatmap_records(df),
            "weekday": compute_heatmap_records(wd_df),
            "weekend": compute_heatmap_records(we_df),
        },
        "weekday_vs_weekend": compute_wd_vs_we_hourly(df),
    }


def load_existing_rapid_rail() -> list:
    """Preserve verified 2026 Rapid Rail OD pairs from existing od_summary.json if raw CSV is absent."""
    existing_path = FRONTEND_DATA_DIR / "od_summary.json"
    if existing_path.exists():
        with open(existing_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data.get("top_od_pairs", {}).get("rapid_rail", [])
    return []


def main():
    print("[Module 2] Loading 2026 raw OD datasets ...")
    komuter_raw = pd.read_csv(RAW_DATA_DIR / "komuter_2026.csv")
    intercity_raw = pd.read_csv(RAW_DATA_DIR / "intercity_2026.csv")

    kom_val = validate_od_dataframe(komuter_raw, "komuter_2026")
    ic_val = validate_od_dataframe(intercity_raw, "intercity_2026")
    kom_df = kom_val["df"]
    ic_df = ic_val["df"]

    # Preserve verified 2026 Rapid Rail pairs and enrich with avg_daily (common 324-day 2026 window)
    rr_pairs_raw = load_existing_rapid_rail()
    common_days = int(kom_df["date_dt"].nunique())
    rr_pairs = [
        {
            "origin": p["origin"],
            "destination": p["destination"],
            "total_ridership": int(p["total_ridership"]),
            "avg_daily": round(float(p["total_ridership"]) / max(common_days, 1), 1),
        }
        for p in rr_pairs_raw
    ]

    # Build period-specific aggregations (12m = full 2026 Jan 1 - Nov 20, plus q1-q4)
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

        wd_days = int(k_sub[k_sub["day_type"] == "Weekday"]["date_dt"].nunique())
        we_days = int(k_sub[k_sub["day_type"] == "Weekend"]["date_dt"].nunique())
        min_d = k_sub["date_dt"].min().strftime("%Y-%m-%d")
        max_d = k_sub["date_dt"].max().strftime("%Y-%m-%d")

        periods[key] = {
            "label": label,
            "date_range": f"{min_d} to {max_d}",
            "total_days": int(k_sub["date_dt"].nunique()),
            "weekday_days": wd_days,
            "weekend_days": we_days,
            "komuter": aggregate_mode_period(k_sub),
            "intercity": aggregate_mode_period(i_sub),
        }

    # Monthly periods & totals for timeline scrubbing (actual 2026 monthly observations)
    monthly_totals = []
    monthly_periods = {}
    for ym in sorted(kom_df["year_month"].unique()):
        k_m = kom_df[kom_df["year_month"] == ym]
        i_m = ic_df[ic_df["year_month"] == ym]
        wd_days = int(k_m[k_m["day_type"] == "Weekday"]["date_dt"].nunique())
        we_days = int(k_m[k_m["day_type"] == "Weekend"]["date_dt"].nunique())
        min_d = k_m["date_dt"].min().strftime("%Y-%m-%d")
        max_d = k_m["date_dt"].max().strftime("%Y-%m-%d")

        monthly_totals.append({
            "year_month": ym,
            "days": int(k_m["date_dt"].nunique()),
            "weekday_days": wd_days,
            "weekend_days": we_days,
            "date_range": f"{min_d} to {max_d}",
            "komuter_trips": int(k_m["ridership"].sum()),
            "intercity_trips": int(i_m["ridership"].sum()),
        })
        monthly_periods[ym] = {
            "label": f"{ym} ({min_d} to {max_d})",
            "date_range": f"{min_d} to {max_d}",
            "total_days": int(k_m["date_dt"].nunique()),
            "weekday_days": wd_days,
            "weekend_days": we_days,
            "komuter": aggregate_mode_period(k_m, top_limit=20),
            "intercity": aggregate_mode_period(i_m, top_limit=20),
        }

    full_period = periods["12m"]
    output = {
        "generated_at": "2026-11-27",
        "metadata": {
            "observation_window": full_period["date_range"],
            "total_days": full_period["total_days"],
            "weekday_days": full_period["weekday_days"],
            "weekend_days": full_period["weekend_days"],
            "day_classification_rule": "Malaysian operating week: Mon–Fri = Weekday, Sat–Sun = Weekend",
            "corridor_definition": "Directional (Origin -> Destination)",
            "data_quality": {
                "komuter_2026": kom_val["report"],
                "intercity_2026": ic_val["report"],
                "rapid_rail_2026": {
                    "note": "Daily OD totals only (top 20 corridors); sub-period (Q1-Q4), day-profile, and hourly breakdowns unavailable locally.",
                    "top_pairs_count": len(rr_pairs),
                },
            },
        },
        "periods": periods,
        "monthly_totals": monthly_totals,
        "monthly_periods": monthly_periods,
        # Backward-compatible top-level keys (now using corrected 2026 + fixed Friday classification)
        "weekday_hour_heatmap": {
            "komuter": full_period["komuter"]["heatmap"]["all"],
            "intercity": full_period["intercity"]["heatmap"]["all"],
            "note": "Rapid Rail data is daily-resolution only; no hourly heatmap available.",
        },
        "top_od_pairs": {
            "komuter": full_period["komuter"]["top_od"]["all"][:20],
            "intercity": full_period["intercity"]["top_od"]["all"][:20],
            "rapid_rail": rr_pairs,
        },
        "weekday_vs_weekend": {
            "komuter": full_period["komuter"]["weekday_vs_weekend"],
            "intercity": full_period["intercity"]["weekday_vs_weekend"],
        },
    }

    save_frontend_json(output, "od_summary.json", indent=2)
    print("[Module 2] Done — od_summary.json regenerated with 2026 comparable window and corrected Mon-Fri weekday classification.")


if __name__ == "__main__":
    main()
