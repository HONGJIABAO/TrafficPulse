"""
Official Dataset Downloader & Provenance Validator for Module 2 Station Demand Intelligence.
Saves downloaded official open datasets into backend/data/module2_station_demand/downloads/
and writes provenance metadata to backend/data/module2_station_demand/source_manifest.json.
Never modifies or overwrites backend/data/raw/ snapshots used by other modules.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import zipfile
from pathlib import Path

import polars as pl
import requests

REPO_ROOT = Path(__file__).resolve().parents[3]
RAW_BASELINE_DIR = REPO_ROOT / "backend" / "data" / "raw"
DATA_OUT_DIR = REPO_ROOT / "backend" / "data" / "module2_station_demand"
DOWNLOADS_DIR = DATA_OUT_DIR / "downloads"
DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)

SOURCES = [
    {
        "id": "komuter_2026_local",
        "title": "KTM Komuter — Hourly OD (Baseline Local Snapshot)",
        "mode": "komuter",
        "source_url": "https://storage.data.gov.my/transportation/ktmb/komuter_2026.csv",
        "parquet_url": "https://storage.data.gov.my/transportation/ktmb/komuter_2026.parquet",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_komuter",
        "local_path": RAW_BASELINE_DIR / "komuter_2026.csv",
        "use_local_baseline": True,
        "granularity": "Hourly (MYT) origin-destination pairs",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
    },
    {
        "id": "intercity_2026_local",
        "title": "KTM Intercity — Hourly OD (Baseline Local Snapshot)",
        "mode": "intercity",
        "source_url": "https://storage.data.gov.my/transportation/ktmb/intercity_2026.csv",
        "parquet_url": "https://storage.data.gov.my/transportation/ktmb/intercity_2026.parquet",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_intercity",
        "local_path": RAW_BASELINE_DIR / "intercity_2026.csv",
        "use_local_baseline": True,
        "granularity": "Hourly (MYT) origin-destination pairs",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
    },
    {
        "id": "rapidrail_2026_local",
        "title": "Rapid Rail — Daily OD (Baseline Local Snapshot)",
        "mode": "rapid_rail",
        "source_url": "https://storage.data.gov.my/transportation/rail/rapidrail_2026_daily.csv",
        "parquet_url": "https://storage.data.gov.my/transportation/rail/rapidrail_2026_daily.parquet",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily",
        "local_path": RAW_BASELINE_DIR / "rapidrail_2026_daily.csv",
        "use_local_baseline": True,
        "granularity": "Daily origin-destination pairs (plus A0 subtotals)",
        "licence": "CC BY 4.0 (data.gov.my / Prasarana)",
    },
    {
        "id": "komuter_utara_2026",
        "title": "KTM Komuter Utara — Hourly OD",
        "mode": "komuter_utara",
        "source_url": "https://storage.data.gov.my/transportation/ktmb/komuter_utara_2026.parquet",
        "alt_csv_url": "https://storage.data.gov.my/transportation/ktmb/komuter_utara_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_komuter_utara",
        "local_path": DOWNLOADS_DIR / "komuter_utara_2026.parquet",
        "use_local_baseline": False,
        "granularity": "Hourly (MYT) origin-destination pairs",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
    },
    {
        "id": "ets_2026",
        "title": "KTM ETS — Hourly OD",
        "mode": "ets",
        "source_url": "https://storage.data.gov.my/transportation/ktmb/ets_2026.parquet",
        "alt_csv_url": "https://storage.data.gov.my/transportation/ktmb/ets_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_ets",
        "local_path": DOWNLOADS_DIR / "ets_2026.parquet",
        "use_local_baseline": False,
        "granularity": "Hourly (MYT) origin-destination pairs",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
    },
    {
        "id": "shuttle_tebrau_2026",
        "title": "Shuttle Tebrau — Hourly OD",
        "mode": "shuttle_tebrau",
        "source_url": "https://storage.data.gov.my/transportation/ktmb/shuttle_tebrau_2026.parquet",
        "alt_csv_url": "https://storage.data.gov.my/transportation/ktmb/shuttle_tebrau_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_shuttle_tebrau",
        "local_path": DOWNLOADS_DIR / "shuttle_tebrau_2026.parquet",
        "use_local_baseline": False,
        "granularity": "Hourly (MYT) origin-destination pairs",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
    },
    {
        "id": "ridership_ktmb_daily_ref",
        "title": "Daily KTMB Ridership — Official Validation Reference (Fresh Parquet)",
        "mode": "reference",
        "source_url": "https://storage.data.gov.my/transportation/ktmb/ridership_ktmb_daily.parquet",
        "alt_csv_url": "https://storage.data.gov.my/transportation/ktmb/ridership_ktmb_daily.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_ktmb_daily",
        "local_path": DOWNLOADS_DIR / "ridership_ktmb_daily.parquet",
        "use_local_baseline": False,
        "granularity": "Daily ridership totals by KTMB service",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
    },
    {
        "id": "ridership_headline_ref",
        "title": "National Headline Ridership — Official Validation Reference (Fresh Parquet)",
        "mode": "reference",
        "source_url": "https://storage.data.gov.my/transportation/ridership_headline.parquet",
        "alt_csv_url": "https://storage.data.gov.my/transportation/ridership_headline.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_headline",
        "local_path": DOWNLOADS_DIR / "ridership_headline.parquet",
        "use_local_baseline": False,
        "granularity": "Daily ridership totals by national rail line",
        "licence": "CC BY 4.0 (data.gov.my / Prasarana / KTMB)",
    },
    {
        "id": "ktmb_gtfs",
        "title": "KTMB Static GTFS Station & Route Feed",
        "mode": "gtfs",
        "source_url": "https://api.data.gov.my/gtfs-static/ktmb",
        "doc_url": "https://developer.data.gov.my/realtime-api/gtfs-static",
        "local_path": DOWNLOADS_DIR / "ktmb_gtfs.zip",
        "use_local_baseline": False,
        "granularity": "Static GTFS stops, routes, trips, stop_times",
        "licence": "CC BY 4.0 (data.gov.my Developer API)",
    },
    {
        "id": "rapidrail_gtfs",
        "title": "Rapid Rail KL Static GTFS Station & Route Feed",
        "mode": "gtfs",
        "source_url": "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",
        "doc_url": "https://developer.data.gov.my/realtime-api/gtfs-static",
        "local_path": DOWNLOADS_DIR / "rapidrail_gtfs.zip",
        "use_local_baseline": False,
        "granularity": "Static GTFS stops, routes, frequencies, shapes, stop_times",
        "licence": "CC BY 4.0 (data.gov.my Developer API)",
    },
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def download_file(url: str, dest: Path) -> str:
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    with open(tmp, "wb") as f:
        for chunk in resp.iter_content(chunk_size=1024 * 256):
            if chunk:
                f.write(chunk)
    tmp.replace(dest)
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat()


def inspect_dataset(src: dict, downloaded_at: str | None) -> dict:
    p: Path = src["local_path"]
    size_bytes = p.stat().st_size
    digest = sha256_file(p)
    entry = {
        "id": src["id"],
        "title": src["title"],
        "mode": src["mode"],
        "source_url": src["source_url"],
        "doc_url": src["doc_url"],
        "local_path": str(p.relative_to(REPO_ROOT)).replace("\\", "/"),
        "origin_type": "existing_raw_baseline" if src["use_local_baseline"] else "downloaded_official_source",
        "download_timestamp": downloaded_at,
        "sha256": digest,
        "file_size_bytes": size_bytes,
        "granularity": src["granularity"],
        "licence": src["licence"],
    }

    if p.suffix == ".zip":
        with zipfile.ZipFile(p) as z:
            files = [n for n in z.namelist() if not n.startswith("__MACOSX")]
        entry.update({
            "row_count": None,
            "columns": files,
            "min_date": None,
            "max_date": None,
            "validation_status": "valid_gtfs_archive" if "stops.txt" in files and "routes.txt" in files else "invalid_gtfs",
        })
        return entry

    if p.suffix == ".parquet":
        df = pl.read_parquet(p)
        cols = df.columns
        rows = df.height
        min_d = str(df["date"].min())[:10] if "date" in cols else None
        max_d = str(df["date"].max())[:10] if "date" in cols else None
    else:
        lf = pl.scan_csv(p)
        cols = list(lf.collect_schema().names())
        stats = lf.select([
            pl.len().alias("n"),
            pl.col("date").min().alias("dmin"),
            pl.col("date").max().alias("dmax"),
        ]).collect().row(0, named=True)
        rows = int(stats["n"])
        min_d = str(stats["dmin"])[:10] if stats["dmin"] is not None else None
        max_d = str(stats["dmax"])[:10] if stats["dmax"] is not None else None

    entry.update({
        "row_count": rows,
        "columns": cols,
        "min_date": min_d,
        "max_date": max_d,
        "validation_status": "validated" if rows > 0 and min_d and max_d else "empty_or_invalid",
    })
    return entry


def main() -> None:
    manifest_entries = []
    for src in SOURCES:
        p: Path = src["local_path"]
        downloaded_at = None
        if not src["use_local_baseline"]:
            print(f"[Download] {src['id']} <- {src['source_url']}")
            downloaded_at = download_file(src["source_url"], p)
        else:
            print(f"[Baseline] {src['id']} <- {p}")
            mtime = dt.datetime.fromtimestamp(p.stat().st_mtime, dt.timezone(dt.timedelta(hours=8)))
            downloaded_at = f"existing_local_snapshot_mtime:{mtime.isoformat()}"

        info = inspect_dataset(src, downloaded_at)
        print(
            f"  -> {info['validation_status']} | rows={info['row_count']} | "
            f"dates={info['min_date']}..{info['max_date']} | size={info['file_size_bytes']:,}B"
        )
        manifest_entries.append(info)

    manifest = {
        "generated_at": dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(),
        "baseline_comparison_window": {"start": "2026-01-01", "end": "2026-11-20", "days": 324},
        "sources": manifest_entries,
    }
    out_path = DATA_OUT_DIR / "source_manifest.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(f"[Manifest] Saved {out_path}")


if __name__ == "__main__":
    main()
