"""Run the local Module 3 data validation. No network access is required."""

import hashlib
import json
import math
import platform
import sys
from importlib.metadata import version
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import pandas as pd
from PIL import Image

from eda import HEADLINE_DOC, KOMUTER_DOC, RAPIDRAIL_DOC, TARGET, describe_daily, plot_daily
from gtfs import inspect_gtfs
from komuter import build_komuter_profiles
from ridership import OD_METHOD, compare_sources, read_headline, read_rapidrail
from summary import write_summary


BACKEND = Path(__file__).resolve().parents[2]
RAW = BACKEND / "data" / "raw"
OUTPUT = BACKEND / "data" / "processed" / "module3_lrt3"
CSV = "lrt3_source_comparison.csv"
CHART = "lrt3_daily_eda.png"
SUMMARY = "eda_summary.md"
QUALITY = "data_quality_report.json"


def json_value(value):
    if value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_value(item) for item in value]
    if isinstance(value, pd.Timestamp):
        return value.date().isoformat()
    if isinstance(value, np.generic):
        return json_value(value.item())
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def fingerprint(path):
    with path.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    return {"bytes": path.stat().st_size, "sha256": digest}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def verify_output(stage, frames, comparison):
    keys = {
        "lrt3_daily.parquet": ["date"],
        "lrt3_station_daily.parquet": ["date", "station_code"],
        "lrt3_headline_daily.parquet": ["date"],
        "komuter_hourly_profiles.parquet": ["scope", "year", "day_type", "hour"],
    }
    actual = {}
    checks = {}
    for name, expected in frames.items():
        frame = pd.read_parquet(stage / name)
        pd.testing.assert_frame_equal(frame, expected)
        require(not frame.duplicated(keys[name]).any(), f"Duplicate output key in {name}")
        actual[name] = frame
        checks[name] = {"rows": len(frame), "unique_key": keys[name], "parquet_round_trip": True}

    daily = actual["lrt3_daily.parquet"].set_index("date")
    station = actual["lrt3_station_daily.parquet"]
    headline = actual["lrt3_headline_daily.parquet"]
    for method in [OD_METHOD, "od_individual_ridership", TARGET]:
        grouped = station.groupby("date")[method]
        complete = grouped.count().eq(daily["expected_stations"])
        pd.testing.assert_series_equal(grouped.sum(min_count=1).where(complete), daily[method])
    pd.testing.assert_series_equal(daily[TARGET], daily[OD_METHOD], check_names=False)

    for frame, count, status in [
        (daily, TARGET, "station_origin_status"),
        (station, TARGET, "station_origin_status"),
        (headline, "headline_trips", "headline_status"),
    ]:
        require(frame[count].eq(0).fillna(False).eq(frame[status].eq("observed_zero")).all(),
                f"Zero status and value disagree for {count}")
        require(frame[count].isna().eq(~frame[status].isin(["observed_zero", "observed_positive"])).all(),
                f"Null status and value disagree for {count}")
    require(headline["headline_row_present"].eq(headline["headline_status"].ne("missing")).all(),
            "Missing headline rows lost their distinction from null observations")

    p = actual["komuter_hourly_profiles.parquet"]
    require(p["hour"].between(0, 23).all(), "Unexpected Komuter hour")
    groups = p.groupby(["scope", "year", "day_type"])
    totals = groups["hourly_share"].sum().to_numpy(dtype=float)
    require(groups.size().eq(24).all() and np.allclose(totals, 1, rtol=0, atol=1e-12),
            "Komuter profile hours or share sums failed validation")
    pooled = p.loc[p["year"].ne("combined")].groupby(["scope", "day_type", "hour"])["hourly_trips"].sum()
    combined = p.loc[p["year"].eq("combined")].set_index(["scope", "day_type", "hour"])["hourly_trips"]
    pd.testing.assert_series_equal(pooled, combined.sort_index())
    checks["komuter_hourly_profiles.parquet"].update({
        "profiles": len(totals), "hours_per_profile": 24,
        "largest_absolute_share_sum_error": float(np.abs(totals - 1).max()),
        "pooled_counts_reconcile": True,
    })

    csv_types = comparison.drop(columns="date").dtypes.to_dict()
    csv = pd.read_csv(
        stage / CSV, parse_dates=["date"], dtype=csv_types, keep_default_na=False, na_values=[""],
    )
    csv["date"] = csv["date"].astype(comparison["date"].dtype)
    pd.testing.assert_frame_equal(csv, comparison, rtol=1e-12)
    require(csv["date"].is_unique, "Duplicate dates in source comparison")
    checks[CSV] = {"rows": len(csv), "unique_key": ["date"], "csv_round_trip": True}
    with Image.open(stage / CHART) as image:
        require(image.format == "PNG" and min(image.size) > 0, "Invalid EDA image")
        checks[CHART] = {"width": image.width, "height": image.height, "decoded_png": True}
        image.load()
    require((stage / SUMMARY).read_text(encoding="utf-8").startswith("# LRT3 data validation"),
            "Invalid EDA summary")
    checks[SUMMARY] = {"utf8_markdown": True}
    checks[QUALITY] = {"strict_json_round_trip": True}
    return {"passed": True, "station_rollups_reconcile": True, "zero_null_missing_preserved": True,
            "artifacts": checks}


def main():
    print("Validating Rapid Rail OD and the local headline snapshot", flush=True)
    station, daily, od_quality = read_rapidrail(RAW / "rapidrail_2026_daily.csv")
    headline, headline_quality = read_headline(RAW / "ridership_headline.csv")
    daily_quality = describe_daily(daily)
    comparison, source_quality = compare_sources(daily, headline)
    print("Reconciling Komuter snapshots and calculating hourly profiles", flush=True)
    profiles, komuter_quality = build_komuter_profiles(RAW)
    gtfs = inspect_gtfs(RAW, od_quality["sa_stations"])
    inputs = [od_quality["file"], headline_quality["file"], gtfs["file"], *komuter_quality["sources"]]
    report = {
        "environment": {
            "python": platform.python_version(),
            "implementation": platform.python_implementation(),
            "platform": platform.platform(),
            "isolated_virtual_environment": sys.prefix != sys.base_prefix,
            "dependencies": {name: version(name) for name in ["numpy", "pandas", "pyarrow", "matplotlib", "pillow"]},
        },
        "inputs": {name: fingerprint(RAW / name) for name in inputs},
        "methodology_sources": {
            "rapidrail": RAPIDRAIL_DOC, "headline": HEADLINE_DOC, "komuter": KOMUTER_DOC,
            "corridor": komuter_quality["corridor_source"],
        },
        "definitions": {
            "station_origin_trips": "Daily trips with SA-coded origin and A0 destination, one record "
            "per origin and date. Daily totals require all expected SA station counts.",
            "itemized_check": "Sum of counts to named station destinations, excluding A0. "
            "Missing or invalid records and duplicate keys are flagged.",
            "headline": "The separately published rail_lrt_shah_alam count. "
            "Line attribution at interchanges follows the publisher's own methodology.",
            "status": {"observed_zero": "Present with a numeric zero", "observed_positive": "Present and positive",
                       "null": "Source row present with no count", "missing": "Expected row absent",
                       "invalid": "Source value is malformed or negative", "duplicate": "Multiple rows for the key",
                       "partial": "Daily station coverage is incomplete or contains unqualified values"},
            "limitations": [
                "OD trips are counted at a journey's origin. Boardings on a specific line, incoming "
                "transfers and in-vehicle passenger loads require other measurements.",
                "The first positive OD date is an observation boundary. The official opening date, "
                "the cause of the June–July OD zeros, and the exact headline allocation remain unresolved.",
                "The complete station-date checks establish internal OD consistency only. "
                "Independent verification of upstream coverage is unavailable.",
                "Komuter shares reflect transaction times and serve as a proxy for hourly sensitivity. "
                "The raw sources include partial calendar years and changes in station labels.",
                "GTFS describes scheduled service. Train capacities and observed operations are unavailable here.",
            ],
        },
        "rapidrail_od": od_quality, "headline": headline_quality, "source_comparison": source_quality,
        "lrt3_daily": daily_quality, "komuter": komuter_quality, "gtfs": gtfs,
    }
    print("Writing and reopening all eight validation artifacts", flush=True)
    frames = {
        "lrt3_daily.parquet": daily, "lrt3_station_daily.parquet": station,
        "lrt3_headline_daily.parquet": headline, "komuter_hourly_profiles.parquet": profiles,
    }
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="validation-", dir=OUTPUT) as temp:
        stage = Path(temp)
        for name, frame in frames.items():
            frame.to_parquet(stage / name, index=False)
        comparison.to_csv(stage / CSV, index=False, date_format="%Y-%m-%d")
        plot_daily(stage / CHART, daily, headline, daily_quality, stage / "matplotlib")
        write_summary(stage / SUMMARY, report, profiles)
        report["validation"] = verify_output(stage, frames, comparison)
        parsed = json_value(report)
        (stage / QUALITY).write_text(
            json.dumps(parsed, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8"
        )
        require(json.loads((stage / QUALITY).read_text(encoding="utf-8")) == parsed,
                "Quality report failed JSON round trip")
        for name in [*frames, CSV, CHART, SUMMARY, QUALITY]:
            (stage / name).replace(OUTPUT / name)
    print(f"Validated and saved eight artifacts under {OUTPUT}", flush=True)


if __name__ == "__main__":
    main()
