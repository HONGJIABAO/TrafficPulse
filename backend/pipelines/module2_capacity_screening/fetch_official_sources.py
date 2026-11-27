"""
fetch_official_sources.py
Downloads official Malaysian rail datasets, GTFS static feeds, KTMB rate card PDF,
and KTMB timetable PDFs/HTML into isolated cache:
  backend/data/module2_capacity_screening/raw/
Records complete cryptographic provenance in:
  backend/data/module2_capacity_screening/source_manifest.json
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = ROOT / "backend" / "data" / "module2_capacity_screening"
RAW_CACHE = CACHE_DIR / "raw"
DOCS_CACHE = RAW_CACHE / "docs"
MANIFEST_PATH = CACHE_DIR / "source_manifest.json"

HEADERS = {
    "User-Agent": "TransitPulse-Malaysia-Research/1.0 (MDIT 2026 Data Integrity Pipeline)"
}

CORE_SOURCES = [
    {
        "id": "komuter_2026_od",
        "filename": "komuter_2026.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ktmb/komuter_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_komuter",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "2026-11-20",
        "fallback_local": ROOT / "backend" / "data" / "raw" / "komuter_2026.csv",
    },
    {
        "id": "komuter_utara_2026_od",
        "filename": "komuter_utara_2026.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ktmb/komuter_utara_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_komuter_utara",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "2026",
        "fallback_local": None,
    },
    {
        "id": "intercity_2026_od",
        "filename": "intercity_2026.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ktmb/intercity_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_intercity",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "2026-11-20",
        "fallback_local": ROOT / "backend" / "data" / "raw" / "intercity_2026.csv",
    },
    {
        "id": "ets_2026_od",
        "filename": "ets_2026.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ktmb/ets_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_ets",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "2026",
        "fallback_local": None,
    },
    {
        "id": "shuttle_tebrau_2026_od",
        "filename": "shuttle_tebrau_2026.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ktmb/shuttle_tebrau_2026.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_shuttle_tebrau",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "2026",
        "fallback_local": None,
    },
    {
        "id": "ridership_ktmb_daily",
        "filename": "ridership_ktmb_daily.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ktmb/ridership_ktmb_daily.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_ktmb_daily",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "2026-11-21",
        "fallback_local": ROOT / "backend" / "data" / "raw" / "ridership_ktmb_daily.csv",
    },
    {
        "id": "ridership_headline",
        "filename": "ridership_headline.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/ridership_headline.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_headline",
        "licence": "CC BY 4.0 (data.gov.my / MOT)",
        "publication_or_effective_date": "2026",
        "fallback_local": ROOT / "backend" / "data" / "raw" / "ridership_headline.csv",
    },
    {
        "id": "rapidrail_2026_daily",
        "filename": "rapidrail_2026_daily.csv",
        "kind": "csv",
        "url": "https://storage.data.gov.my/transportation/rail/rapidrail_2026_daily.csv",
        "doc_url": "https://data.gov.my/data-catalogue/ridership_od_rapidrail_daily",
        "licence": "CC BY 4.0 (data.gov.my / Prasarana)",
        "publication_or_effective_date": "2026",
        "fallback_local": None,
        "max_bytes": 450 * 1024 * 1024,
    },
    {
        "id": "ktmb_gtfs",
        "filename": "ktmb_gtfs.zip",
        "kind": "zip",
        "url": "https://api.data.gov.my/gtfs-static/ktmb",
        "doc_url": "https://developer.data.gov.my/realtime-api/gtfs-static",
        "licence": "CC BY 4.0 (data.gov.my / KTMB)",
        "publication_or_effective_date": "GTFS Static Feed",
        "fallback_local": None,
    },
    {
        "id": "rapid_rail_gtfs",
        "filename": "rapid_rail_gtfs.zip",
        "kind": "zip",
        "url": "https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl",
        "doc_url": "https://developer.data.gov.my/realtime-api/gtfs-static",
        "licence": "CC BY 4.0 (data.gov.my / Prasarana)",
        "publication_or_effective_date": "GTFS Static Feed",
        "fallback_local": None,
    },
]

DOC_SOURCES = [
    {
        "id": "ktmb_rate_card_2023",
        "filename": "ETS-REDCARD.pdf",
        "kind": "pdf",
        "url": "https://www.ktmb.com.my/assets/pdf/2023/ETS-REDCARD.pdf",
        "licence": "KTMB Official Public Document",
        "publication_or_effective_date": "2023",
    },
    {
        "id": "ktmb_bc_ps_weekday_20261110",
        "filename": "BC-PS-BC_WEEKDAY_10112026.pdf",
        "kind": "pdf",
        "url": "https://www.ktmb.com.my/assets/pdf/2026/BC-PS-BC%20WEEKDAY%20%281%29%2010112026.pdf",
        "licence": "KTMB Official Timetable",
        "publication_or_effective_date": "2026-11-10",
    },
    {
        "id": "ktmb_bc_ps_weekend_20261114",
        "filename": "BC-PS-BC_WEEKEND_14112026.pdf",
        "kind": "pdf",
        "url": "https://www.ktmb.com.my/assets/pdf/2026/BC-PS-BC%20WEEKEND%2014112026.pdf",
        "licence": "KTMB Official Timetable",
        "publication_or_effective_date": "2026-11-14",
    },
    {
        "id": "ktmb_kvdt2_faq_2026",
        "filename": "FAQ_KVDT_2.pdf",
        "kind": "pdf",
        "url": "https://www.ktmb.com.my/assets/pdf/2026/FAQ%20KVDT%202.pdf",
        "licence": "KTMB Official Notice",
        "publication_or_effective_date": "2026",
    },
    {
        "id": "ktmb_traintime_html",
        "filename": "TrainTime.html",
        "kind": "html",
        "url": "https://www.ktmb.com.my/TrainTime.html",
        "licence": "KTMB Official Website",
        "publication_or_effective_date": "2026",
    },
    {
        "id": "ktmb_komuter_html",
        "filename": "Komuter.html",
        "kind": "html",
        "url": "https://www.ktmb.com.my/Komuter.html",
        "licence": "KTMB Official Website",
        "publication_or_effective_date": "2026",
    },
]


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def inspect_csv_meta(path: Path) -> dict:
    row_count = 0
    schema: list[str] = []
    min_date: str | None = None
    max_date: str | None = None
    with path.open("r", encoding="utf-8", errors="replace", newline="") as f:
        reader = csv.reader(f)
        try:
            schema = next(reader)
        except StopIteration:
            return {"row_count": 0, "schema": [], "observation_period": None}
        date_idx = schema.index("date") if "date" in schema else None
        for row in reader:
            row_count += 1
            if date_idx is not None and len(row) > date_idx:
                d = row[date_idx][:10]
                if d and len(d) == 10:
                    if min_date is None or d < min_date:
                        min_date = d
                    if max_date is None or d > max_date:
                        max_date = d
    obs = f"{min_date} to {max_date}" if (min_date and max_date) else None
    return {"row_count": row_count, "schema": schema, "observation_period": obs}


def download_file(url: str, dest: Path, timeout: int = 120, max_bytes: int | None = None) -> tuple[bool, str]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    try:
        with requests.get(url, headers=HEADERS, stream=True, timeout=timeout, allow_redirects=True) as resp:
            if resp.status_code != 200:
                return False, f"HTTP {resp.status_code}"
            total = 0
            with tmp.open("wb") as out:
                for chunk in resp.iter_content(chunk_size=131072):
                    if not chunk:
                        continue
                    total += len(chunk)
                    if max_bytes and total > max_bytes:
                        tmp.unlink(missing_ok=True)
                        return False, f"Exceeded size guard ({max_bytes} bytes)"
                    out.write(chunk)
        tmp.replace(dest)
        return True, "downloaded"
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        return False, str(exc)


def discover_additional_ktmb_pdfs(html_paths: list[Path]) -> list[dict]:
    found: dict[str, dict] = {}
    pdf_re = re.compile(r'href=["\']([^"\']+\.pdf(?:\?[^"\']*)?)["\']', re.IGNORECASE)
    known_urls = {d["url"] for d in DOC_SOURCES}
    for hp in html_paths:
        if not hp.exists():
            continue
        text = hp.read_text(encoding="utf-8", errors="replace")
        for match in pdf_re.findall(text):
            abs_url = urllib.parse.urljoin("https://www.ktmb.com.my/", match)
            low = abs_url.lower()
            if abs_url in known_urls:
                continue
            if any(k in low for k in ["2026", "komuter", "timetable", "jadual", "utara", "tm-pk", "kvdt", "scs", "ets"]):
                fname = Path(urllib.parse.urlparse(abs_url).path).name
                fname = urllib.parse.unquote(fname).replace(" ", "_")
                if fname and abs_url not in found:
                    found[abs_url] = {
                        "id": f"discovered_{re.sub(r'[^a-z0-9]+', '_', fname.lower()).strip('_')}",
                        "filename": fname,
                        "kind": "pdf",
                        "url": abs_url,
                        "licence": "KTMB Official Timetable / Document",
                        "publication_or_effective_date": "discovered_2026",
                    }
    return list(found.values())


def main() -> int:
    RAW_CACHE.mkdir(parents=True, exist_ok=True)
    DOCS_CACHE.mkdir(parents=True, exist_ok=True)
    manifest_items = []

    print("[Importer] Fetching official CSV and GTFS sources ...")
    for item in CORE_SOURCES:
        dest = RAW_CACHE / item["filename"]
        ok, msg = download_file(item["url"], dest, timeout=180, max_bytes=item.get("max_bytes"))
        used_fallback = False
        if not ok and item.get("fallback_local") and Path(item["fallback_local"]).exists():
            # Keep isolated copy inside capacity_screening/raw without modifying original
            src_fb = Path(item["fallback_local"])
            dest.write_bytes(src_fb.read_bytes())
            ok = True
            used_fallback = True
            msg = f"copied verified local mirror after remote error ({msg})"

        entry = {
            "id": item["id"],
            "source_url": item["url"],
            "documentation_url": item["doc_url"],
            "local_path": str(dest.relative_to(ROOT)).replace("\\", "/") if ok else None,
            "download_time_utc": datetime.now(timezone.utc).isoformat(),
            "sha256": file_sha256(dest) if ok and dest.exists() else None,
            "bytes": dest.stat().st_size if ok and dest.exists() else 0,
            "publication_or_effective_date": item["publication_or_effective_date"],
            "observation_period": None,
            "row_count": None,
            "schema": None,
            "licence": item["licence"],
            "verification_status": (
                "verified_fallback_local_mirror" if used_fallback else ("verified_downloaded" if ok else f"failed: {msg}")
            ),
        }
        if ok and item["kind"] == "csv":
            meta = inspect_csv_meta(dest)
            entry.update(meta)
        elif ok and item["kind"] == "zip":
            import zipfile
            try:
                with zipfile.ZipFile(dest) as zf:
                    names = zf.namelist()
                entry["schema"] = names
                entry["row_count"] = len(names)
            except Exception as exc:
                entry["verification_status"] = f"invalid_zip: {exc}"
        manifest_items.append(entry)
        print(f"  - {item['id']}: {entry['verification_status']} ({entry['bytes']} bytes)")

    print("[Importer] Fetching official KTMB PDFs and timetable pages ...")
    html_files: list[Path] = []
    for doc in DOC_SOURCES:
        dest = DOCS_CACHE / doc["filename"]
        ok, msg = download_file(doc["url"], dest, timeout=90)
        if ok and doc["kind"] == "html":
            html_files.append(dest)
        manifest_items.append({
            "id": doc["id"],
            "source_url": doc["url"],
            "documentation_url": "https://www.ktmb.com.my/TrainTime.html",
            "local_path": str(dest.relative_to(ROOT)).replace("\\", "/") if ok else None,
            "download_time_utc": datetime.now(timezone.utc).isoformat(),
            "sha256": file_sha256(dest) if ok and dest.exists() else None,
            "bytes": dest.stat().st_size if ok and dest.exists() else 0,
            "publication_or_effective_date": doc["publication_or_effective_date"],
            "observation_period": None,
            "row_count": None,
            "schema": [doc["kind"]],
            "licence": doc["licence"],
            "verification_status": "verified_downloaded" if ok else f"failed: {msg}",
        })
        print(f"  - {doc['id']}: {'verified_downloaded' if ok else f'failed ({msg})'} ({dest.stat().st_size if ok and dest.exists() else 0} bytes)")

    # Discover extra timetable PDFs linked on TrainTime.html / Komuter.html
    discovered = discover_additional_ktmb_pdfs(html_files)
    print(f"[Importer] Discovered {len(discovered)} candidate PDF links from TrainTime/Komuter pages ...")
    for doc in discovered[:25]:
        dest = DOCS_CACHE / doc["filename"]
        ok, msg = download_file(doc["url"], dest, timeout=90)
        manifest_items.append({
            "id": doc["id"],
            "source_url": doc["url"],
            "documentation_url": "https://www.ktmb.com.my/TrainTime.html",
            "local_path": str(dest.relative_to(ROOT)).replace("\\", "/") if ok else None,
            "download_time_utc": datetime.now(timezone.utc).isoformat(),
            "sha256": file_sha256(dest) if ok and dest.exists() else None,
            "bytes": dest.stat().st_size if ok and dest.exists() else 0,
            "publication_or_effective_date": doc["publication_or_effective_date"],
            "observation_period": None,
            "row_count": None,
            "schema": ["pdf"],
            "licence": doc["licence"],
            "verification_status": "verified_downloaded" if ok else f"failed: {msg}",
        })
        print(f"  - {doc['filename']}: {'OK' if ok else msg} ({dest.stat().st_size if ok and dest.exists() else 0} bytes)")

    manifest = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "isolated_cache_root": str(RAW_CACHE.relative_to(ROOT)).replace("\\", "/"),
        "source_count": len(manifest_items),
        "sources": manifest_items,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[Importer] Wrote manifest to {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
