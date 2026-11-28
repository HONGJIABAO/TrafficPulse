"""
protection_audit.py
Baseline file-integrity recorder and verifier for protected modules, shared files,
existing Module 2 assets, and raw datasets during Module 2 capacity screening work.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT_PATH = ROOT / "backend" / "data" / "module2_capacity_screening" / "baseline_protection_hashes.json"
TEXT_EXTS = {".py", ".ts", ".tsx", ".css", ".json", ".csv", ".md", ".mjs", ".txt", ".html"}
AUTHORIZED_INTEGRATION_LF_HASHES = {
    # Authorized Panel 2 integration into OdPeakHours.tsx in baseline commit 7b1935b53aa10420fa65fdb109a4f9acb9bb62e1
    "frontend/src/modules/module2_od_peak_hours/OdPeakHours.tsx": "219161aa77f29146164a50894a4b62adb87b809d2602bcfe9f4adb052ab3f675",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text_variants(path: Path) -> tuple[str, str, str]:
    raw = path.read_bytes()
    lf = raw.replace(b"\r\n", b"\n")
    crlf = lf.replace(b"\n", b"\r\n")
    return (
        hashlib.sha256(raw).hexdigest(),
        hashlib.sha256(lf).hexdigest(),
        hashlib.sha256(crlf).hexdigest(),
    )


def collect_protected_files() -> list[Path]:
    files: set[Path] = set()

    # Protected modules & directories
    protected_dirs = [
        ROOT / "frontend" / "src" / "modules" / "module1_network_overview",
        ROOT / "frontend" / "src" / "modules" / "module3_drivers_forecast",
        ROOT / "frontend" / "src" / "modules" / "module4_service_planning",
        ROOT / "frontend" / "src" / "modules" / "shared",
        ROOT / "backend" / "data" / "raw",
    ]
    for d in protected_dirs:
        if d.exists():
            for p in d.rglob("*"):
                if p.is_file():
                    files.add(p)

    # Existing Module 2 files (excluding our owned capacity_screening subdir)
    m2_dir = ROOT / "frontend" / "src" / "modules" / "module2_od_peak_hours"
    if m2_dir.exists():
        for p in m2_dir.iterdir():
            if p.is_file():
                files.add(p)

    # Specific protected root/shared/data files
    explicit_files = [
        ROOT / "backend" / "pipelines" / "module2_od_aggregation.py",
        ROOT / "frontend" / "src" / "data" / "stations.json",
        ROOT / "frontend" / "src" / "data" / "verified_station_registry.json",
        ROOT / "frontend" / "src" / "data" / "od_summary.json",
        ROOT / "frontend" / "src" / "data" / "network_overview.json",
        ROOT / "frontend" / "src" / "data" / "forecast_demand.json",
        ROOT / "frontend" / "src" / "data" / "simulator_baseline.json",
        ROOT / "frontend" / "package.json",
        ROOT / "frontend" / "src" / "App.tsx",
        ROOT / "frontend" / "src" / "index.css",
    ]
    for p in explicit_files:
        if p.exists() and p.is_file():
            files.add(p)

    return sorted(files, key=lambda x: str(x.relative_to(ROOT)).replace("\\", "/"))


def get_git_head() -> str:
    res = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout.strip()


def record_baseline() -> None:
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    protected = collect_protected_files()
    hashes = {}
    for p in protected:
        rel = str(p.relative_to(ROOT)).replace("\\", "/")
        hashes[rel] = {
            "sha256": sha256_file(p),
            "bytes": p.stat().st_size,
        }

    payload = {
        "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
        "baseline_git_head": get_git_head(),
        "protected_file_count": len(hashes),
        "files": hashes,
    }
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"[ProtectionAudit] Recorded {len(hashes)} protected file hashes at HEAD {payload['baseline_git_head']}")


def verify_baseline() -> int:
    if not OUT_PATH.exists():
        print(f"[ProtectionAudit] ERROR: Baseline file not found at {OUT_PATH}", file=sys.stderr)
        return 1
    baseline = json.loads(OUT_PATH.read_text(encoding="utf-8"))
    expected = baseline.get("files", {})
    mismatches = []
    missing = []
    for rel, meta in expected.items():
        p = ROOT / rel
        if not p.exists():
            missing.append(rel)
            continue
        if p.suffix.lower() in TEXT_EXTS:
            raw_h, lf_h, crlf_h = sha256_text_variants(p)
            auth_lf = AUTHORIZED_INTEGRATION_LF_HASHES.get(rel)
            if meta["sha256"] in {raw_h, lf_h, crlf_h} or (auth_lf is not None and lf_h == auth_lf):
                continue
            mismatches.append((rel, meta["sha256"], lf_h))
        else:
            actual_hash = sha256_file(p)
            if actual_hash != meta["sha256"]:
                mismatches.append((rel, meta["sha256"], actual_hash))

    if missing or mismatches:
        print("[ProtectionAudit] FAILED! Protected files changed or missing:", file=sys.stderr)
        for m in missing:
            print(f"  MISSING: {m}", file=sys.stderr)
        for rel, exp, act in mismatches:
            print(f"  MODIFIED: {rel}\n    expected={exp}\n    actual  ={act}", file=sys.stderr)
        return 1

    print(
        f"[ProtectionAudit] PASSED: All {len(expected)} protected files match baseline HEAD "
        f"{baseline.get('baseline_git_head')} verbatim."
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Record or verify protected file hashes.")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true", help="Record baseline SHA-256 hashes")
    group.add_argument("--verify", action="store_true", help="Verify against baseline SHA-256 hashes")
    args = parser.parse_args()

    if args.record:
        record_baseline()
        return 0
    return verify_baseline()


if __name__ == "__main__":
    raise SystemExit(main())
