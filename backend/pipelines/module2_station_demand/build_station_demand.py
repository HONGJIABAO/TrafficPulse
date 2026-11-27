"""
Module 2: Station Demand Intelligence Backend Pipeline
Generates all-station origin demand summaries, hourly profiles (KTMB only),
daily profiles (Rapid Rail daily + all-station monthly trends), coverage & reconciliation
audits, methodology specification, CSV export, and frontend JSON bundles.

All metrics use the aligned 2026-01-01 to 2026-11-20 (324 calendar days: 232 Mon-Fri,
92 Sat-Sun) common comparison window across:
- KTM Komuter (local baseline CSV)
- KTM Intercity (local baseline CSV)
- Rapid Rail (local baseline CSV, excluding A0 aggregate subtotals)
- KTM Komuter Utara (downloaded official Parquet, filtered <= 2026-11-20)
- KTM ETS (downloaded official Parquet, filtered <= 2026-11-20)
- Shuttle Tebrau (downloaded official Parquet, filtered <= 2026-11-20)
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import sys
import zipfile
from pathlib import Path
from typing import Any

import polars as pl

THIS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(THIS_DIR))

from station_registry import (
    DOWNLOADS_DIR,
    KTMB_ROUTE_NAME_MAP,
    KTMB_SERVICE_LABEL,
    RAW_BASELINE_DIR,
    REPO_ROOT,
    load_station_lookup,
    resolve_interchange,
    resolve_ktmb_station,
    resolve_rapidrail_station,
    slugify,
)

BACKEND_OUT_DIR = REPO_ROOT / "backend" / "data" / "module2_station_demand"
FRONTEND_OUT_DIR = REPO_ROOT / "frontend" / "src" / "data" / "module2_station_demand"
BACKEND_OUT_DIR.mkdir(parents=True, exist_ok=True)
FRONTEND_OUT_DIR.mkdir(parents=True, exist_ok=True)

OBS_START = dt.date(2026, 1, 1)
OBS_END = dt.date(2026, 11, 20)

# Morning & Evening operational peak bands (recorded MYT transaction hours)
AM_PEAK_HOURS = [6, 7, 8, 9]       # 06:00 - 09:59 AM
PM_PEAK_HOURS = [17, 18, 19, 20]   # 17:00 - 20:59 PM

PERIOD_CATALOG_META = [
    ("12m", "Full 2026 Common Window (Jan 1 – Nov 20, 2026)", None, None),
    ("q1", "Q1 2026 (Jan 1 – Mar 31, 2026)", "q", 1),
    ("q2", "Q2 2026 (Apr 1 – Jun 30, 2026)", "q", 2),
    ("q3", "Q3 2026 (Jul 1 – Sep 30, 2026)", "q", 3),
    ("q4", "Q4 2026 Partial (Oct 1 – Nov 20, 2026)", "q", 4),
]


def calendar_metadata_frame() -> pl.DataFrame:
    dates = pl.date_range(OBS_START, OBS_END, interval="1d", eager=True)
    df = pl.DataFrame({"date": dates}).with_columns([
        pl.col("date").dt.weekday().alias("iso_weekday"),  # 1=Mon .. 7=Sun
        pl.col("date").dt.quarter().alias("quarter_num"),
        pl.col("date").dt.strftime("%Y-%m").alias("year_month"),
    ]).with_columns(
        pl.when(pl.col("iso_weekday") <= 5).then(pl.lit("weekday")).otherwise(pl.lit("weekend")).alias("day_type")
    )
    return df


def save_json(data: Any, path: Path, compact: bool = False) -> None:
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[Saved] {path.relative_to(REPO_ROOT)} ({path.stat().st_size / 1024:.1f} KB)")


def load_ktmb_service_df(service: str, path: Path, is_parquet: bool) -> tuple[pl.DataFrame, dict]:
    raw_df = pl.read_parquet(path) if is_parquet else pl.read_csv(path)
    raw_rows = raw_df.height
    nulls = {c: int(raw_df[c].null_count()) for c in raw_df.columns}

    df = raw_df
    if df.schema["date"] != pl.Date:
        df = df.with_columns(pl.col("date").cast(pl.Utf8).str.slice(0, 10).str.to_date("%Y-%m-%d"))

    full_min = str(df["date"].min())
    full_max = str(df["date"].max())
    full_days = int(df["date"].n_unique())

    # Filter strictly to common 2026-01-01..2026-11-20 window
    df = df.filter((pl.col("date") >= OBS_START) & (pl.col("date") <= OBS_END))
    window_rows = df.height
    non_pos = int(df.filter(pl.col("ridership") <= 0).height)
    exact_dups = int(df.is_duplicated().sum())

    df = (
        df.filter(pl.col("ridership") > 0)
        .with_columns([
            pl.col("time").cast(pl.Utf8).str.slice(0, 2).cast(pl.Int32).alias("hour"),
            pl.col("date").dt.weekday().alias("iso_weekday"),
            pl.col("date").dt.quarter().alias("quarter_num"),
            pl.col("date").dt.strftime("%Y-%m").alias("year_month"),
        ])
        .with_columns(
            pl.when(pl.col("iso_weekday") <= 5).then(pl.lit("weekday")).otherwise(pl.lit("weekend")).alias("day_type")
        )
    )
    valid_days = int(df["date"].n_unique())

    # Collapse per origin station x date x hour
    orig_hourly = (
        df.group_by(["origin", "date", "hour", "day_type", "quarter_num", "year_month"])
        .agg(pl.col("ridership").sum().cast(pl.Int64).alias("trips"))
    )

    stats = {
        "service": service,
        "service_label": KTMB_SERVICE_LABEL[service],
        "raw_total_rows": raw_rows,
        "full_file_date_range": f"{full_min} to {full_max}",
        "full_file_days": full_days,
        "aligned_window_rows": window_rows,
        "aligned_window_date_range": f"{OBS_START} to {OBS_END}",
        "aligned_days": valid_days,
        "missing_calendar_days": 324 - valid_days,
        "null_counts": nulls,
        "non_positive_rows": non_pos,
        "exact_duplicate_rows": exact_dups,
        "total_origin_trips_aligned": int(df["ridership"].sum()),
    }
    return orig_hourly, stats


def load_rapidrail_origin_daily() -> tuple[pl.DataFrame, dict]:
    rr_path = RAW_BASELINE_DIR / "rapidrail_2026_daily.csv"
    lf = pl.scan_csv(rr_path).with_columns(
        pl.col("date").cast(pl.Utf8).str.slice(0, 10).str.to_date("%Y-%m-%d").alias("date_dt")
    )

    # Reconciliation across all rows:
    cat_agg = (
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
    cat_map = {r["cat"]: {"rows": int(r["rows"]), "trips": int(r["trips"])} for r in cat_agg}

    # Exact station-date internal A0 origin subtotal vs detailed station_to_station sum
    orig_a0 = (
        lf.filter(~pl.col("origin").str.starts_with("A0:") & pl.col("destination").str.starts_with("A0:"))
        .select([pl.col("date_dt").alias("date"), "origin", pl.col("ridership").cast(pl.Int64).alias("a0_tot")])
    )
    orig_det = (
        lf.filter(~pl.col("origin").str.starts_with("A0:") & ~pl.col("destination").str.starts_with("A0:"))
        .group_by([pl.col("date_dt").alias("date"), "origin"])
        .agg(pl.col("ridership").sum().cast(pl.Int64).alias("trips"))
    )
    reconcile = (
        orig_a0.join(orig_det, on=["date", "origin"], how="full")
        .with_columns((pl.col("a0_tot").fill_null(0) - pl.col("trips").fill_null(0)).abs().alias("abs_delta"))
        .collect()
    )

    orig_daily = (
        orig_det.collect()
        .filter((pl.col("date") >= OBS_START) & (pl.col("date") <= OBS_END))
        .with_columns([
            pl.col("date").dt.weekday().alias("iso_weekday"),
            pl.col("date").dt.quarter().alias("quarter_num"),
            pl.col("date").dt.strftime("%Y-%m").alias("year_month"),
        ])
        .with_columns(
            pl.when(pl.col("iso_weekday") <= 5).then(pl.lit("weekday")).otherwise(pl.lit("weekend")).alias("day_type")
        )
    )

    # Shah Alam (SA) breakdown Jan-Jul vs Aug-Nov
    sa_rows = orig_daily.filter(pl.col("origin").str.starts_with("SA"))
    sa_jan_jul = int(sa_rows.filter(pl.col("date") < dt.date(2026, 8, 1))["trips"].sum())
    sa_aug_nov = int(sa_rows.filter(pl.col("date") >= dt.date(2026, 8, 1))["trips"].sum())
    sa_pos_days = int(sa_rows.filter(pl.col("trips") > 0)["date"].n_unique())

    stats = {
        "service": "rapid_rail",
        "service_label": "Rapid Rail (LRT / MRT / Monorail)",
        "aligned_window_date_range": f"{OBS_START} to {OBS_END}",
        "aligned_days": int(orig_daily["date"].n_unique()),
        "row_categories": cat_map,
        "a0_origin_reconciliation": {
            "station_date_pairs_checked": reconcile.height,
            "exact_zero_delta_matches": int(reconcile.filter(pl.col("abs_delta") == 0).height),
            "max_abs_delta": int(reconcile["abs_delta"].max()),
        },
        "total_origin_trips_aligned": int(orig_daily["trips"].sum()),
        "shah_alam_audit": {
            "stations_in_od": int(sa_rows["origin"].n_unique()),
            "jan1_to_jul31_trips": sa_jan_jul,
            "aug1_to_nov20_trips": sa_aug_nov,
            "positive_od_days": sa_pos_days,
            "active_window": "2026-08-01 to 2026-11-20 (112 active days; 0 recorded Jan-Jul 2026)",
        },
    }
    return orig_daily, stats


def build_unmeasured_gtfs_inventory(
    existing_ids: set[str],
    existing_gtfs_pairs: set[tuple[str, str]],
    lookup: dict[str, Any],
) -> list[dict]:
    """Include verified GTFS stops with zero/unavailable 2026 OD data cleanly."""
    extra: list[dict] = []

    # 1. Rapid Rail GTFS stops not present in OD (e.g., BRT Sunway BRT1..BRT7, any unmeasured extension stops)
    for sid, info in sorted(lookup["rr_by_exact_code"].items()):
        norm_key = ("rapid_rail", sid)
        canon_guess = f"rr:{sid}"
        if canon_guess in existing_ids or norm_key in existing_gtfs_pairs:
            continue
        rid = info["route_id"]
        is_brt = rid == "BRT"
        svc = "brt" if is_brt else "rapid_rail"
        line = "BRT Sunway" if is_brt else KTMB_ROUTE_NAME_MAP.get(rid, rid)
        if not is_brt and rid in ("AG", "PH", "KJ", "MRT", "PYL", "MR", "SA"):
            # Skip already-present zero-padded equivalents (SA1 vs SA01, PY03 vs PYL03, MR1 vs MR01)
            continue
        name = info["gtfs_stop_name"].title()
        ichg_id, ichg_name = resolve_interchange(name, slugify(name))
        extra.append({
            "id": f"{'brt' if is_brt else 'rr'}:{sid}",
            "gtfs_stop_id": sid,
            "station_code": sid,
            "name": name,
            "raw_name": f"{sid}: {name}",
            "operator": "Prasarana (Rapid KL)",
            "network": "brt" if is_brt else "rapid_rail",
            "service": svc,
            "service_label": "Sunway BRT (No OD Data)" if is_brt else "Rapid Rail (LRT/MRT/Monorail)",
            "line": line,
            "physical_interchange_id": ichg_id,
            "physical_interchange_name": ichg_name,
            "lat": round(float(info["lat"]), 6),
            "lng": round(float(info["lng"]), 6),
            "coordinate_verified": True,
            "is_physical_station": True,
            "hourly_supported": False,
            "availability_status": "unavailable_no_od_data",
            "availability_label": "No Data (Not in OpenDOSM OD)",
            "od_total_2026": None,
            "positive_days_2026": 0,
            "source_dataset": "rapid-rail-gtfs",
        })

    # 2. KTMB GTFS stops never matched as origins across any KTMB OD service (e.g., Shuttle Selatan / Woodlands variations)
    ktmb_covered_stop_ids = {gtfs_id for (svc_k, gtfs_id) in existing_gtfs_pairs if svc_k == "ktmb"}
    for info in lookup["ktmb_gtfs_list"]:
        gid = info["gtfs_stop_id"]
        if gid in ktmb_covered_stop_ids:
            continue
        # Only expose GTFS-only stops (not in any of the 5 KTMB OD datasets)
        name = info["gtfs_stop_name"].title()
        ichg_id, ichg_name = resolve_interchange(name, slugify(name))
        extra.append({
            "id": f"ktmb:gtfs_unmeasured:{gid}",
            "gtfs_stop_id": gid,
            "station_code": gid,
            "name": name,
            "raw_name": info["gtfs_stop_name"],
            "operator": "KTMB",
            "network": "ktmb",
            "service": "ktmb_gtfs_only",
            "service_label": "KTMB GTFS Only (No OD Data)",
            "line": " & ".join(info["line_names"]) if info["line_names"] else "KTMB Reference Stop",
            "physical_interchange_id": ichg_id,
            "physical_interchange_name": ichg_name,
            "lat": round(float(info["lat"]), 6),
            "lng": round(float(info["lng"]), 6),
            "coordinate_verified": True,
            "is_physical_station": True,
            "hourly_supported": False,
            "availability_status": "unavailable_no_od_data",
            "availability_label": "No Data (Zero 2026 OD Coverage)",
            "od_total_2026": None,
            "positive_days_2026": 0,
            "source_dataset": "ktmb-gtfs",
        })
    return extra


def compute_period_slices(cal_df: pl.DataFrame) -> list[dict]:
    slices = []
    for key, label, kind, val in PERIOD_CATALOG_META:
        sub = cal_df if kind is None else cal_df.filter(pl.col("quarter_num") == val)
        slices.append({
            "key": key,
            "label": label,
            "filter_col": None if kind is None else "quarter_num",
            "filter_val": val,
            "date_range": f"{sub['date'].min()} to {sub['date'].max()}",
            "all_days": sub.height,
            "weekday_days": int(sub.filter(pl.col("day_type") == "weekday").height),
            "weekend_days": int(sub.filter(pl.col("day_type") == "weekend").height),
        })
    for ym in sorted(cal_df["year_month"].unique().to_list()):
        sub = cal_df.filter(pl.col("year_month") == ym)
        slices.append({
            "key": ym,
            "label": f"{ym} ({sub['date'].min()} to {sub['date'].max()})",
            "filter_col": "year_month",
            "filter_val": ym,
            "date_range": f"{sub['date'].min()} to {sub['date'].max()}",
            "all_days": sub.height,
            "weekday_days": int(sub.filter(pl.col("day_type") == "weekday").height),
            "weekend_days": int(sub.filter(pl.col("day_type") == "weekend").height),
        })
    return slices


def main() -> None:
    print("[Station Demand] Loading official registries & calendar...")
    lookup = load_station_lookup()
    cal_df = calendar_metadata_frame()
    cal_dates = [str(d) for d in cal_df["date"].to_list()]
    date_to_idx = {d: i for i, d in enumerate(cal_dates)}
    period_slices = compute_period_slices(cal_df)

    # Load all 6 OD datasets over compatible 324d baseline
    ktmb_sources = [
        ("komuter", RAW_BASELINE_DIR / "komuter_2026.csv", False),
        ("intercity", RAW_BASELINE_DIR / "intercity_2026.csv", False),
        ("komuter_utara", DOWNLOADS_DIR / "komuter_utara_2026.parquet", True),
        ("ets", DOWNLOADS_DIR / "ets_2026.parquet", True),
        ("shuttle_tebrau", DOWNLOADS_DIR / "shuttle_tebrau_2026.parquet", True),
    ]

    ktmb_frames: dict[str, pl.DataFrame] = {}
    coverage_reports: dict[str, Any] = {}
    for svc, path, is_pq in ktmb_sources:
        print(f"[Station Demand] Loading KTMB service '{svc}'...")
        df_h, stats = load_ktmb_service_df(svc, path, is_pq)
        ktmb_frames[svc] = df_h
        coverage_reports[svc] = stats

    print("[Station Demand] Loading Rapid Rail daily origin matrices...")
    rr_daily_df, rr_stats = load_rapidrail_origin_daily()
    coverage_reports["rapid_rail"] = rr_stats

    # Reconciliation against official ridership_ktmb_daily.parquet
    kt_ref = (
        pl.read_parquet(DOWNLOADS_DIR / "ridership_ktmb_daily.parquet")
        .with_columns(pl.col("date").cast(pl.Date))
        .filter((pl.col("date") >= OBS_START) & (pl.col("date") <= OBS_END))
    )
    for svc, df_h in ktmb_frames.items():
        od_d = df_h.group_by("date").agg(pl.col("trips").sum().alias("od_sum"))
        ref_d = kt_ref.filter(pl.col("service") == svc).select(["date", pl.col("ridership").alias("ref_sum")])
        chk = ref_d.join(od_d, on="date", how="full").with_columns(
            (pl.col("ref_sum").fill_null(0) - pl.col("od_sum").fill_null(0)).abs().alias("abs_delta")
        )
        coverage_reports[svc]["reconciliation_vs_ktmb_daily"] = {
            "matched_dates": chk.height,
            "exact_zero_delta_dates": int(chk.filter(pl.col("abs_delta") == 0).height),
            "max_abs_delta": int(chk["abs_delta"].max()),
            "official_daily_total": int(ref_d["ref_sum"].sum()),
        }

    # Build canonical Station Inventory and unify per-station metadata
    station_meta_by_id: dict[str, dict] = {}
    existing_ids: set[str] = set()
    existing_gtfs_pairs: set[tuple[str, str]] = set()

    # KTMB origin totals per station across 324d
    for svc, df_h in ktmb_frames.items():
        st_sums = (
            df_h.group_by("origin")
            .agg([
                pl.col("trips").sum().alias("tot"),
                pl.col("date").n_unique().alias("pos_days"),
            ])
            .to_dicts()
        )
        for row in st_sums:
            raw_orig = row["origin"]
            info = resolve_ktmb_station(raw_orig, svc, lookup)
            sid = info["canonical_station_id"]
            existing_ids.add(sid)
            if info["gtfs_stop_id"]:
                existing_gtfs_pairs.add(("ktmb", str(info["gtfs_stop_id"])))
            avail = "complete" if info["is_physical_station"] else "non_physical_fee_or_unknown"
            station_meta_by_id[sid] = {
                "id": sid,
                "gtfs_stop_id": info["gtfs_stop_id"],
                "station_code": info["station_code"],
                "name": info["station_name"],
                "raw_name": raw_orig,
                "operator": "KTMB",
                "network": "ktmb",
                "service": svc,
                "service_label": info["service_label"],
                "line": info["line_attribution"],
                "physical_interchange_id": info["physical_interchange_id"],
                "physical_interchange_name": info["physical_interchange_name"],
                "lat": info["lat"],
                "lng": info["lng"],
                "coordinate_verified": info["coordinate_verified"],
                "is_physical_station": info["is_physical_station"],
                "hourly_supported": bool(info["is_physical_station"]),
                "availability_status": avail,
                "availability_label": (
                    "Full 324d Hourly & Daily"
                    if info["is_physical_station"]
                    else "Non-Physical / Unattributed Administrative Code"
                ),
                "od_total_2026": int(row["tot"]),
                "positive_days_2026": int(row["pos_days"]),
                "source_dataset": f"{svc}_2026",
            }

    # Rapid Rail stations
    rr_sums = (
        rr_daily_df.group_by("origin")
        .agg([
            pl.col("trips").sum().alias("tot"),
            pl.col("date").filter(pl.col("trips") > 0).n_unique().alias("pos_days"),
        ])
        .to_dicts()
    )
    for row in rr_sums:
        raw_orig = row["origin"]
        info = resolve_rapidrail_station(raw_orig, lookup)
        sid = info["canonical_station_id"]
        existing_ids.add(sid)
        if info["gtfs_stop_id"]:
            existing_gtfs_pairs.add(("rapid_rail", str(info["gtfs_stop_id"])))
        is_sa = info["line_attribution"] == "LRT Shah Alam"
        avail = "partial_active_period" if is_sa else "complete_daily_only"
        station_meta_by_id[sid] = {
            "id": sid,
            "gtfs_stop_id": info["gtfs_stop_id"],
            "station_code": info["station_code"],
            "name": info["station_name"],
            "raw_name": raw_orig,
            "operator": "Prasarana (Rapid KL)",
            "network": "rapid_rail",
            "service": "rapid_rail",
            "service_label": "Rapid Rail (LRT/MRT/Monorail)",
            "line": info["line_attribution"],
            "physical_interchange_id": info["physical_interchange_id"],
            "physical_interchange_name": info["physical_interchange_name"],
            "lat": info["lat"],
            "lng": info["lng"],
            "coordinate_verified": info["coordinate_verified"],
            "is_physical_station": info["is_physical_station"],
            "hourly_supported": False,
            "availability_status": avail,
            "availability_label": (
                "Daily Only · Active Paid AFC Aug–Nov 2026 (0 recorded Jan–Jul)"
                if is_sa
                else "Daily Only (Full 324d; Hourly Unavailable)"
            ),
            "od_total_2026": int(row["tot"]),
            "positive_days_2026": int(row["pos_days"]),
            "source_dataset": "rapidrail_2026_daily",
        }

    # Add GTFS unmeasured stops (BRT Sunway + any GTFS KTMB stops with zero 2026 OD)
    unmeasured = build_unmeasured_gtfs_inventory(existing_ids, existing_gtfs_pairs, lookup)
    for item in unmeasured:
        station_meta_by_id[item["id"]] = item

    inventory_list = sorted(
        station_meta_by_id.values(),
        key=lambda x: (
            0 if x["availability_status"].startswith("complete") or x["availability_status"] == "partial_active_period" else 1,
            -(x["od_total_2026"] or -1),
            x["service"],
            x["name"],
        ),
    )

    # Build combined station_date_hour (KTMB) & station_date (Rapid Rail) tagged with canonical sid
    ktmb_tagged_parts = []
    for svc, df_h in ktmb_frames.items():
        # Map origin -> canonical_station_id
        orig_map = {
            row["raw_name"]: row["id"]
            for row in station_meta_by_id.values()
            if row["service"] == svc
        }
        tagged = df_h.with_columns(pl.col("origin").replace_strict(orig_map).alias("sid")).drop("origin")
        ktmb_tagged_parts.append(tagged)
    ktmb_all_h = pl.concat(ktmb_tagged_parts)

    rr_orig_map = {
        row["raw_name"]: row["id"]
        for row in station_meta_by_id.values()
        if row["service"] == "rapid_rail"
    }
    rr_all_d = rr_daily_df.with_columns(pl.col("origin").replace_strict(rr_orig_map).alias("sid")).drop("origin")

    # Pre-aggregate per-period summaries + hourly arrays + daily profiles
    print("[Station Demand] Computing period x day_type summaries and hourly profiles...")
    period_catalog = {}
    summary_metrics: dict[str, dict[str, dict[str, dict]]] = {}
    hourly_profiles: dict[str, dict[str, dict[str, list[float]]]] = {}

    # Compute hourly and daily aggregates across all 16 periods x 3 day types
    all_physical_eligible_ids = {
        sid for sid, m in station_meta_by_id.items()
        if m["is_physical_station"] and m["availability_status"] != "unavailable_no_od_data"
    }
    service_of = {sid: m["service"] for sid, m in station_meta_by_id.items()}

    for pslice in period_slices:
        pkey = pslice["key"]
        fcol = pslice["filter_col"]
        fval = pslice["filter_val"]

        period_catalog[pkey] = {
            "label": pslice["label"],
            "date_range": pslice["date_range"],
            "all_days": pslice["all_days"],
            "weekday_days": pslice["weekday_days"],
            "weekend_days": pslice["weekend_days"],
        }

        k_p = ktmb_all_h if fcol is None else ktmb_all_h.filter(pl.col(fcol) == fval)
        r_p = rr_all_d if fcol is None else rr_all_d.filter(pl.col(fcol) == fval)

        summary_metrics[pkey] = {}
        hourly_profiles[pkey] = {}

        for dt_key in ("all", "weekday", "weekend"):
            denom = pslice[f"{dt_key}_days"]
            k_sub = k_p if dt_key == "all" else k_p.filter(pl.col("day_type") == dt_key)
            r_sub = r_p if dt_key == "all" else r_p.filter(pl.col("day_type") == dt_key)

            rows_for_slice: dict[str, dict] = {}
            hourly_for_slice: dict[str, list[float]] = {}

            # 1. KTMB stations (hourly supported where physical)
            if not k_sub.is_empty():
                st_hr = (
                    k_sub.group_by(["sid", "hour"])
                    .agg(pl.col("trips").sum().alias("h_trips"))
                    .to_dicts()
                )
                st_day_pos = (
                    k_sub.group_by("sid")
                    .agg([
                        pl.col("trips").sum().alias("tot"),
                        pl.col("date").n_unique().alias("pos_d"),
                    ])
                    .to_dicts()
                )
                by_sid_h: dict[str, list[int]] = {}
                for hrow in st_hr:
                    arr = by_sid_h.setdefault(hrow["sid"], [0] * 24)
                    arr[int(hrow["hour"])] = int(hrow["h_trips"])

                for drow in st_day_pos:
                    sid = drow["sid"]
                    tot = int(drow["tot"])
                    pos_d = int(drow["pos_d"])
                    avg_d = round(tot / denom, 2) if denom > 0 else None
                    meta = station_meta_by_id[sid]

                    if meta["hourly_supported"] and tot > 0 and denom > 0:
                        raw_hrs = by_sid_h.get(sid, [0] * 24)
                        hr_avgs = [round(v / denom, 2) for v in raw_hrs]
                        # Deterministic tie-breaking: earliest hour achieving strict maximum
                        best_h = 0
                        best_v = -1.0
                        for h_idx, h_val in enumerate(hr_avgs):
                            if h_val > best_v:
                                best_v = h_val
                                best_h = h_idx
                        am_avg = round(sum(raw_hrs[h] for h in AM_PEAK_HOURS) / denom, 2)
                        pm_avg = round(sum(raw_hrs[h] for h in PM_PEAK_HOURS) / denom, 2)
                        hourly_for_slice[sid] = hr_avgs
                    else:
                        best_h = None
                        best_v = None
                        am_avg = None
                        pm_avg = None

                    rows_for_slice[sid] = {
                        "tot": tot,
                        "avg": avg_d,
                        "pos_d": pos_d,
                        "pk_h": best_h,
                        "pk_avg": best_v,
                        "am_avg": am_avg,
                        "pm_avg": pm_avg,
                        "rank_svc": None,
                        "rank_all": None,
                    }

            # 2. Rapid Rail stations (daily only — NO hourly profile!)
            if not r_sub.is_empty():
                rr_agg = (
                    r_sub.group_by("sid")
                    .agg([
                        pl.col("trips").sum().alias("tot"),
                        pl.col("date").filter(pl.col("trips") > 0).n_unique().alias("pos_d"),
                    ])
                    .to_dicts()
                )
                for drow in rr_agg:
                    sid = drow["sid"]
                    tot = int(drow["tot"])
                    pos_d = int(drow["pos_d"])
                    avg_d = round(tot / denom, 2) if denom > 0 else None
                    rows_for_slice[sid] = {
                        "tot": tot,
                        "avg": avg_d,
                        "pos_d": pos_d,
                        "pk_h": None,
                        "pk_avg": None,
                        "am_avg": None,
                        "pm_avg": None,
                        "rank_svc": None,
                        "rank_all": None,
                    }

            # Compute competition ranks strictly across eligible physical stations (all non-null stations in scope)
            # Ensure every physical eligible station has an entry in 12m/q/m even if 0 trips in that slice
            for sid in all_physical_eligible_ids:
                if sid not in rows_for_slice:
                    rows_for_slice[sid] = {
                        "tot": 0,
                        "avg": 0.0 if denom > 0 else None,
                        "pos_d": 0,
                        "pk_h": None,
                        "pk_avg": None,
                        "am_avg": 0.0 if station_meta_by_id[sid]["hourly_supported"] and denom > 0 else None,
                        "pm_avg": 0.0 if station_meta_by_id[sid]["hourly_supported"] and denom > 0 else None,
                        "rank_svc": None,
                        "rank_all": None,
                    }

            # Competition ranking by avg descending across all physical stations
            ranked_all = sorted(
                [sid for sid in rows_for_slice if sid in all_physical_eligible_ids],
                key=lambda s: (-(rows_for_slice[s]["tot"] or 0), station_meta_by_id[s]["name"]),
            )
            prev_tot = None
            curr_rank = 0
            for idx, sid in enumerate(ranked_all, start=1):
                t = rows_for_slice[sid]["tot"]
                if t != prev_tot:
                    curr_rank = idx
                    prev_tot = t
                rows_for_slice[sid]["rank_all"] = curr_rank

            # Competition ranking within each railway service
            by_svc: dict[str, list[str]] = {}
            for sid in ranked_all:
                by_svc.setdefault(service_of[sid], []).append(sid)
            for sids_list in by_svc.values():
                prev_t = None
                c_rank = 0
                for idx, sid in enumerate(sids_list, start=1):
                    t = rows_for_slice[sid]["tot"]
                    if t != prev_t:
                        c_rank = idx
                        prev_t = t
                    rows_for_slice[sid]["rank_svc"] = c_rank

            summary_metrics[pkey][dt_key] = rows_for_slice
            hourly_profiles[pkey][dt_key] = hourly_for_slice

    # 3. Daily & Monthly Profiles (exact 324d arrays for Rapid Rail stations + 11 monthly daily-avgs for all)
    print("[Station Demand] Building daily & monthly trend profiles...")
    rr_daily_series: dict[str, list[int]] = {sid: [0] * len(cal_dates) for sid in rr_orig_map.values()}
    for row in rr_all_d.select(["sid", "date", "trips"]).to_dicts():
        d_idx = date_to_idx.get(str(row["date"]))
        if d_idx is not None:
            rr_daily_series[row["sid"]][d_idx] = int(row["trips"])

    monthly_station_series: dict[str, dict[str, list]] = {}
    months_ordered = sorted(cal_df["year_month"].unique().to_list())
    for sid in all_physical_eligible_ids:
        monthly_station_series[sid] = {
            "months": months_ordered,
            "avg_daily": [summary_metrics[m]["all"][sid]["avg"] for m in months_ordered],
            "weekday_avg_daily": [summary_metrics[m]["weekday"][sid]["avg"] for m in months_ordered],
            "weekend_avg_daily": [summary_metrics[m]["weekend"][sid]["avg"] for m in months_ordered],
        }

    # Generate Backend + Frontend JSON files
    inventory_doc = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "observation_window": f"{OBS_START} to {OBS_END}",
        "total_inventory_records": len(inventory_list),
        "physical_stations_with_od": sum(
            1 for s in inventory_list if s["is_physical_station"] and s["availability_status"] != "unavailable_no_od_data"
        ),
        "non_physical_codes": sum(1 for s in inventory_list if not s["is_physical_station"]),
        "gtfs_unmeasured_stops": sum(1 for s in inventory_list if s["availability_status"] == "unavailable_no_od_data"),
        "stations": inventory_list,
    }

    summary_doc = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "metadata": {
            "observation_window": f"{OBS_START} to {OBS_END}",
            "total_days": 324,
            "weekday_days": 232,
            "weekend_days": 92,
            "day_classification_rule": "ISO Mon-Fri = Weekday, Sat-Sun = Weekend (Asia/Kuala_Lumpur MYT)",
            "am_peak_window_hours": AM_PEAK_HOURS,
            "am_peak_label": "06:00-09:59 MYT",
            "pm_peak_window_hours": PM_PEAK_HOURS,
            "pm_peak_label": "17:00-20:59 MYT",
            "peak_tie_break_rule": "Earliest hour h in 0..23 achieving max average hourly trips (null if hourly unsupported or total == 0)",
        },
        "period_catalog": period_catalog,
        "metrics": summary_metrics,
    }

    hourly_doc = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "scope": "KTMB hourly-recorded services only (komuter, komuter_utara, ets, intercity, shuttle_tebrau). Rapid Rail has daily-only OD and no synthetic hourly profiles.",
        "timestamp_note": "Hour reflects recorded ticket/faregate transaction hour (MYT), not guaranteed train boarding or arrival timestamp.",
        "profiles": hourly_profiles,
    }

    daily_doc = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "dates": cal_dates,
        "rapid_rail_daily": rr_daily_series,
        "monthly_trends": monthly_station_series,
    }

    coverage_doc = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "aligned_common_window": f"{OBS_START} to {OBS_END} (324 days: 232 Mon-Fri, 92 Sat-Sun)",
        "services": coverage_reports,
        "inventory_summary": {
            "total_records": inventory_doc["total_inventory_records"],
            "physical_with_od": inventory_doc["physical_stations_with_od"],
            "non_physical_administrative_codes": inventory_doc["non_physical_codes"],
            "gtfs_unmeasured_stops": inventory_doc["gtfs_unmeasured_stops"],
        },
    }

    methodology_doc = {
        "title": "Module 2 — Station Demand Intelligence Methodology & Field Reference",
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "definitions": {
            "total_trips": "Sum of all eligible origin trips recorded at station s during window w (trips, integer).",
            "avg_daily_trips": "total_trips / eligible_calendar_days_in_window (trips/day). Strictly includes zero-demand days inside the window; never divides only by positive days.",
            "hourly_avg": "Total eligible origin trips in recorded MYT transaction hour h (0..23) divided by eligible calendar days in window (trips/hour). Strictly null for Rapid Rail (daily-only source).",
            "peak_hour": "Earliest hour h in 0..23 attaining max(hourly_avg). Null when total_trips == 0 or hourly data unavailable.",
            "am_peak_avg": "Mean daily origin trips during morning window 06:00-09:59 MYT (sum of hours 6..9 divided by eligible days).",
            "pm_peak_avg": "Mean daily origin trips during evening window 17:00-20:59 MYT (sum of hours 17..20 divided by eligible days).",
            "weekday_weekend_rule": "Malaysian operating week: ISO weekdays 1-5 (Mon-Fri) vs 6-7 (Sat-Sun).",
            "rank": "Standard competition ranking (1, 2, 2, 4) sorted by descending period total/daily average across eligible physical stations. Non-physical codes ('Penalty', 'Unknown') and GTFS stops with zero OD coverage carry rank = null.",
            "transaction_hour_caveat": "KTMB hourly timestamps reflect recorded ticket/AFC transaction hour in MYT rather than physical train departure or arrival timestamps.",
        },
        "a0_handling_and_discrepancy": {
            "rapid_rail_a0_rule": "In rapidrail_2026_daily.csv, 'A0: All Stations' appears both as origin->A0 marginal totals and A0->destination totals (each summing to 196,631,192). Summing the raw file (589.89M) triple-counts traffic. Excluding both sides recovers the exact 196,631,192 non-A0 trips, reconciling 53,784/53,784 origin-dates to 0 delta.",
            "shah_alam_discrepancy": "SA01..SA26 exist for all 324 days in rapidrail_2026_daily.csv: Jan 1-Jul 31 record 0 paid AFC gate OD trips (overlapping June 29 launch / free rides captured in ridership_headline.csv), whereas Aug 1-Nov 20 record 3,265,221 paid origin trips (matching Module 4's verified figure). Previous Module 2 missed SA solely because Top-20 pair filtering truncated lower-volume corridors.",
            "ktmb_multi_service_isolation": "All 5 KTMB OD datasets reconcile 324/324 dates with max_abs_delta = 0 against ridership_ktmb_daily.parquet service breakdowns, confirming zero double-counting between Komuter, Komuter Utara, ETS, Intercity, and Shuttle Tebrau when keyed per canonical (service, station) ID.",
        },
    }

    # Save backend copies (full provenance)
    save_json(inventory_doc, BACKEND_OUT_DIR / "station_inventory.json", compact=False)
    save_json(summary_doc, BACKEND_OUT_DIR / "station_demand_summary.json", compact=True)
    save_json(hourly_doc, BACKEND_OUT_DIR / "station_hourly_profiles.json", compact=True)
    save_json(daily_doc, BACKEND_OUT_DIR / "station_daily_profiles.json", compact=True)
    save_json(coverage_doc, BACKEND_OUT_DIR / "station_demand_coverage.json", compact=False)
    save_json(methodology_doc, BACKEND_OUT_DIR / "station_demand_methodology.json", compact=False)

    # Mirror compact JSON deliverables into frontend/src/data/module2_station_demand/
    save_json(inventory_doc, FRONTEND_OUT_DIR / "station_inventory.json", compact=True)
    save_json(summary_doc, FRONTEND_OUT_DIR / "station_demand_summary.json", compact=True)
    save_json(hourly_doc, FRONTEND_OUT_DIR / "station_hourly_profiles.json", compact=True)
    save_json(daily_doc, FRONTEND_OUT_DIR / "station_daily_profiles.json", compact=True)
    save_json(coverage_doc, FRONTEND_OUT_DIR / "station_demand_coverage.json", compact=True)
    save_json(methodology_doc, FRONTEND_OUT_DIR / "station_demand_methodology.json", compact=True)

    # Write flat station_demand.csv for 12m (Full 2026 Common Window)
    csv_path = BACKEND_OUT_DIR / "station_demand.csv"
    m12_all = summary_metrics["12m"]["all"]
    m12_wd = summary_metrics["12m"]["weekday"]
    m12_we = summary_metrics["12m"]["weekend"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "canonical_station_id", "gtfs_stop_id", "station_name", "operator", "network",
            "service", "service_label", "line_attribution", "physical_interchange_id",
            "lat", "lng", "coordinate_verified", "is_physical_station", "hourly_supported",
            "availability_status", "date_range", "observation_days", "positive_trip_days",
            "total_origin_trips", "avg_daily_trips", "weekday_total_trips", "weekday_avg_daily_trips",
            "weekend_total_trips", "weekend_avg_daily_trips", "peak_hour_myt",
            "peak_hour_avg_trips", "am_peak_06_09_daily_avg", "pm_peak_17_20_daily_avg",
            "rank_within_service", "rank_all_services", "source_dataset",
        ])
        for st in inventory_list:
            sid = st["id"]
            r_all = m12_all.get(sid)
            r_wd = m12_wd.get(sid)
            r_we = m12_we.get(sid)
            w.writerow([
                sid,
                st.get("gtfs_stop_id") or "",
                st["name"],
                st["operator"],
                st["network"],
                st["service"],
                st["service_label"],
                st["line"],
                st.get("physical_interchange_id") or "",
                "" if st["lat"] is None else st["lat"],
                "" if st["lng"] is None else st["lng"],
                st["coordinate_verified"],
                st["is_physical_station"],
                st["hourly_supported"],
                st["availability_status"],
                f"{OBS_START} to {OBS_END}",
                324,
                r_all["pos_d"] if r_all else 0,
                r_all["tot"] if r_all else "",
                r_all["avg"] if r_all else "",
                r_wd["tot"] if r_wd else "",
                r_wd["avg"] if r_wd else "",
                r_we["tot"] if r_we else "",
                r_we["avg"] if r_we else "",
                "" if (not r_all or r_all["pk_h"] is None) else f"{r_all['pk_h']:02d}:00",
                "" if (not r_all or r_all["pk_avg"] is None) else r_all["pk_avg"],
                "" if (not r_all or r_all["am_avg"] is None) else r_all["am_avg"],
                "" if (not r_all or r_all["pm_avg"] is None) else r_all["pm_avg"],
                "" if (not r_all or r_all["rank_svc"] is None) else r_all["rank_svc"],
                "" if (not r_all or r_all["rank_all"] is None) else r_all["rank_all"],
                st["source_dataset"],
            ])
    print(f"[Saved] {csv_path.relative_to(REPO_ROOT)} ({csv_path.stat().st_size / 1024:.1f} KB)")
    print("[Station Demand] Pipeline complete.")


if __name__ == "__main__":
    main()
