"""Build supplemental Step 4B district activity from the local Rapid Rail OD snapshot."""

import argparse
import hashlib
import json
import os
import subprocess
import time
from contextlib import contextmanager
from datetime import date

# Reuse the module's single-thread configuration and lightweight Windows memory guard.
from run_equity import (
    MODULE, OUTPUT, RAW, ROOT, check_memory, csv_asset, flushed_create, json_bytes, load, now, peak_memory, read_csv, sha, stamp,
)

import pyarrow as pa
import pyarrow.parquet as pq

from network_od import scan
from network_equity import crosswalk, district_activity, equity_comparison, reconcile
from network_reporting import build_reports


OD = RAW / "rapidrail_2026_daily.csv"
START = date(2026, 8, 1)
END = date(2026, 11, 20)
CHECKPOINTS = OUTPUT / "network_activity_checkpoints"
PROGRESS = OUTPUT / "network_activity_progress.jsonl"
BASELINE = CHECKPOINTS / "preservation_baseline.json"
OWNED = ("backend/pipelines/module3_lrt3/", "backend/data/processed/module3_lrt3/")
DISTRICT_INPUTS = ("station_district_mapping.csv", "district_boundaries.geojson", "district_socioeconomic_summary.csv",
                   "district_rail_coverage.csv", "district_demand_activity.csv", "equity_priority_screening.csv",
                   "lrt3_station_daily.parquet", "data_quality_report.json")
MODULE_INPUTS = ("run_equity.py", "network_od.py", "network_equity.py", "network_reporting.py", "run_network_equity.py")


def log(event, **fields):
    with PROGRESS.open("a+b") as handle:
        if handle.seek(0, os.SEEK_END):
            handle.seek(-1, os.SEEK_END)
            if handle.read(1) != b"\n":
                handle.write(b"\n")
        data = json.dumps({"event": event, "time_myt": now().isoformat(), **fields}, ensure_ascii=False, allow_nan=False)
        handle.write((data + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())


@contextmanager
def writer_lock():
    CHECKPOINTS.mkdir(exist_ok=True)
    with (CHECKPOINTS / "run.lock").open("a+b") as handle:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def git_outside():
    output = subprocess.check_output(["git", "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd=ROOT)
    entries = iter(filter(None, output.decode("utf-8").split("\0")))
    outside = {}
    for entry in entries:
        status, path = entry[:2], entry[3:]
        other_path = next(entries) if "R" in status or "C" in status else None
        for name in filter(None, (path, other_path)):
            if not name.startswith(OWNED):
                file = ROOT / name
                outside[name] = {"status": status, "sha256": sha(file) if file.is_file() else None}
    return outside


def capture_baseline():
    if BASELINE.is_file():
        return load(BASELINE)
    check_memory()
    previous = load(sorted(OUTPUT.glob("equity_recovery_*.json"))[0])
    sources = {ROOT / item["path"] for item in previous["inventory"] if "/.venv/" not in item["path"]}
    sources.update(MODULE / name for name in ("EQUITY.md", "equity_geography.py", "equity_analysis.py", "equity_reporting.py", "run_equity.py"))
    sources.update(p for p in OUTPUT.rglob("*") if p.is_file() and not p.name.startswith("network_activity_")
                   and not p.is_relative_to(CHECKPOINTS))
    checksums = {p.relative_to(ROOT).as_posix(): sha(p) for p in sorted(sources)}
    for item in previous["inventory"]:
        if item["path"] in checksums and checksums[item["path"]] != item["sha256"]:
            raise ValueError(f"Step 4 recovery checksum differs for {item['path']}")
    verified_equity = {}
    for line in (OUTPUT / "equity_progress.jsonl").read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        if event["event"] == "published":
            verified_equity.update(event["outputs"])
    if len(verified_equity) != 9 or any(checksums[(OUTPUT / name).relative_to(ROOT).as_posix()] != digest
                                         for name, digest in verified_equity.items()):
        raise ValueError("Published Step 4 outputs differ from their recorded hashes")
    baseline = {"captured_at_myt": now().isoformat(), "file_hashes": checksums,
                "prior_processed_outputs": len(previous["prior_outputs"]),
                "validated_step4_outputs": sorted(verified_equity), "outside_git_status_and_hashes": git_outside()}
    atomic_file(BASELINE, json_bytes(baseline))
    return baseline


def atomic_file(path, content):
    partial = path.with_name(f"{path.name}.{stamp()}.pending")
    flushed_create(partial, content)
    if partial.read_bytes() != content:
        raise ValueError(f"Staged data failed validation: {path}")
    os.rename(partial, path)


def write_parquet(path, rows):
    table = pa.Table.from_pylist(rows)
    with path.open("xb") as handle:
        pq.write_table(table, handle)
        handle.flush()
        os.fsync(handle.fileno())
    if not pq.read_table(path, use_threads=False).equals(table):
        raise ValueError(f"Parquet row or type round-trip failed: {path}")


def validated_checkpoint(prefix, fingerprint):
    for folder in sorted(CHECKPOINTS.glob(f"{prefix}_*"), reverse=True):
        try:
            manifest = load(folder / "checkpoint.json")
            if manifest["fingerprint"] == fingerprint and all(sha(folder / name) == digest for name, digest in manifest["files"].items()):
                return folder, manifest
        except (OSError, ValueError, KeyError, TypeError):
            continue
    return None


def raw_fingerprint():
    step1 = load(OUTPUT / "data_quality_report.json")
    if OD.stat().st_size != step1["inputs"][OD.name]["bytes"] or sha(OD) != step1["inputs"][OD.name]["sha256"]:
        raise ValueError("The raw OD snapshot differs from the validated Step 1 input")
    raw_digest = step1["inputs"][OD.name]["sha256"]
    return hashlib.sha256(json_bytes([raw_digest, sha(MODULE / "network_od.py"), START.isoformat(), END.isoformat()])).hexdigest(), step1


def scan_stage(fingerprint, step1):
    if found := validated_checkpoint("01_od_scan", fingerprint):
        log("checkpoint_reused", stage="od_scan", folder=found[0].name)
        return found[0]
    start = time.perf_counter()
    initial_free = check_memory()
    print("Streaming the fingerprinted OD CSV through one 512 KiB batch reader", flush=True)

    def progress(rows):
        print(f"Scanned {rows:,} source rows", flush=True)
        log("scan_progress", source_rows=rows, available_memory_mib=check_memory(), peak_process_working_set_mib=peak_memory())

    rows, audit = scan(OD, START, END, check_memory, progress)
    expected = step1["rapidrail_od"]
    if (audit["snapshot_rows"], audit["snapshot_first_date"], audit["snapshot_last_date"], audit["snapshot_date_count"]) != (
        expected["rows"], expected["date_min"], expected["date_max"], expected["date_count"],
    ):
        raise ValueError("Raw row count or calendar differ from the validated Step 1 snapshot")
    if audit["window_days"] != 112:
        raise ValueError("Step 4B requires exactly 112 service dates")
    folder = CHECKPOINTS / f"01_od_scan_{stamp()}"
    folder.mkdir()
    write_parquet(folder / "origin_audit.parquet", rows)
    atomic_file(folder / "scan_audit.json", json_bytes(audit))
    files = {name: sha(folder / name) for name in ("origin_audit.parquet", "scan_audit.json")}
    atomic_file(folder / "checkpoint.json", json_bytes({"fingerprint": fingerprint, "files": files}))
    log("checkpoint_validated", stage="od_scan", folder=folder.name, files=files,
        seconds=round(time.perf_counter() - start, 3), start_available_memory_mib=initial_free,
        peak_process_working_set_mib=peak_memory())
    print(f"OD scan checkpoint validated with {len(rows):,} origin-date audit rows", flush=True)
    return folder


def origin_stage(scan_folder):
    audit = load(scan_folder / "scan_audit.json")
    source = pq.read_table(scan_folder / "origin_audit.parquet", use_threads=False).to_pylist()
    mapped = crosswalk(read_csv(OUTPUT / "station_district_mapping.csv"), audit)
    station_rows, origin_audit = reconcile(source, mapped, START, END, OUTPUT)
    totals = origin_audit["reconciliation_status_counts"]
    if totals.get("a0_matches_complete_published_detail") == len(station_rows):
        station_total = sum(r["station_origin_trips"] for r in station_rows)
        if station_total != audit["outgoing_a0_row_trip_sum"] or station_total != audit["individual_destination_trip_sum"]:
            raise ValueError("Published origin totals fail aggregate and individual source checks")
    crosswalk_bytes, crosswalk_schema = csv_asset(mapped, ("crosswalk_id",))
    arrow_schema = pa.Table.from_pylist(station_rows).schema
    state = {"origin_audit": origin_audit, "schemas": {
        "network_station_origin_daily.parquet": {"rows": len(station_rows), "key": ["date", "canonical_origin_code"],
                                                 "columns": {field.name: str(field.type) for field in arrow_schema}},
        "network_station_origin_crosswalk.csv": crosswalk_schema,
    }}
    return station_rows, mapped, state, crosswalk_bytes


def district_stage(station_rows, mapped, audit, origin_state, inputs, baseline):
    rail = read_csv(OUTPUT / "district_rail_coverage.csv")
    socioeconomic = read_csv(OUTPUT / "district_socioeconomic_summary.csv")
    screening = read_csv(OUTPUT / "equity_priority_screening.csv")
    step4_activity = read_csv(OUTPUT / "district_demand_activity.csv")
    demand, rollup = district_activity(station_rows, mapped, rail, step4_activity, START, END)
    equity = equity_comparison(demand, socioeconomic, rail, screening)
    district_ids = {r["district_id"] for r in demand}
    feature_ids = {f["properties"]["district_id"] for f in load(OUTPUT / "district_boundaries.geojson")["features"]}
    if district_ids != feature_ids or len(district_ids) != 8:
        raise ValueError("Dashboard district keys differ from the eight Step 4 boundaries")
    demand_bytes, demand_schema = csv_asset(demand, ("district_id",))
    equity_bytes, equity_schema = csv_asset(equity, ("district_id",))
    schemas = {**origin_state["schemas"], "network_district_demand_activity.csv": demand_schema,
               "network_district_equity_comparison.csv": equity_schema}
    metadata, summary = build_reports(audit, origin_state["origin_audit"], rollup, equity, inputs, schemas, baseline)
    return {"network_district_demand_activity.csv": demand_bytes, "network_district_equity_comparison.csv": equity_bytes,
            "network_district_activity_metadata.json": json_bytes(metadata), "network_district_activity_summary.md": summary.encode("utf-8")}


def validate_baseline(baseline):
    for path, expected in baseline["file_hashes"].items():
        if sha(ROOT / path) != expected:
            raise ValueError(f"Original Module 3 checksum changed: {path}")
    if git_outside() != baseline["outside_git_status_and_hashes"]:
        raise ValueError("A Git status entry or a pre-existing changed file outside Module 3 differs from the baseline")


def finalize_checkpoint(folder, fingerprint, publish_names, start, free):
    hashes = {p.name: sha(p) for p in folder.iterdir() if p.is_file()}
    record = {"fingerprint": fingerprint, "files": hashes, "publish_names": list(publish_names)}
    atomic_file(folder / "checkpoint.json", json_bytes(record))
    log("checkpoint_validated", stage=folder.name.split("_", 2)[1], folder=folder.name,
        seconds=round(time.perf_counter() - start, 3), start_available_memory_mib=free,
        peak_process_working_set_mib=peak_memory(), files=hashes)
    return folder, record


def publication(checkpoints):
    destinations = {}
    for folder, manifest in checkpoints:
        for name in manifest["publish_names"]:
            destinations[OUTPUT / name] = (folder / name, manifest["files"][name])
    for dest, (_, expected) in destinations.items():
        if dest.exists() and sha(dest) != expected:
            raise FileExistsError(f"Preserved different existing output {dest}")
    for dest, (source, expected) in destinations.items():
        if not dest.exists():
            atomic_file(dest, source.read_bytes())
        if sha(dest) != expected:
            raise ValueError(f"Published checksum differs from validated checkpoint for {dest}")
    return {path.name: expected for path, (_, expected) in destinations.items()}


def run_analysis(scan_folder, baseline, step1, verify_only):
    check_memory()
    input_hashes = {path.relative_to(ROOT).as_posix(): sha(path) for path in (
        *(OUTPUT / name for name in DISTRICT_INPUTS), *(MODULE / name for name in MODULE_INPUTS),
    )}
    input_hashes[OD.relative_to(ROOT).as_posix()] = step1["inputs"][OD.name]["sha256"]
    input_hashes["streamed_od_checkpoint"] = load(scan_folder / "checkpoint.json")["files"]
    fingerprint = hashlib.sha256(json_bytes(input_hashes)).hexdigest()
    audit = load(scan_folder / "scan_audit.json")
    if verify_only:
        station_rows, mapped, state, csv_content = origin_stage(scan_folder)
        if not pq.read_table(OUTPUT / "network_station_origin_daily.parquet", use_threads=False).equals(pa.Table.from_pylist(station_rows)):
            raise ValueError("Recomputed station origin data differ from published Parquet")
        assets = {"network_station_origin_crosswalk.csv": csv_content,
                  **district_stage(station_rows, mapped, audit, state, input_hashes, baseline)}
        for name, content in assets.items():
            if (OUTPUT / name).read_bytes() != content:
                raise ValueError(f"Recomputed output differs from published {name}")
        validate_baseline(baseline)
        print("All six supplemental outputs reproduced from the verified scan checkpoint. Previous checksums and outside Git baseline matched.", flush=True)
        return

    origin = validated_checkpoint("02_origins", fingerprint)
    district = validated_checkpoint("03_districts", fingerprint)
    station_name = "network_station_origin_daily.parquet"
    crosswalk_name = "network_station_origin_crosswalk.csv"
    if not origin:
        start, free = time.perf_counter(), check_memory()
        station_rows, mapped, state, csv_content = origin_stage(scan_folder)
        folder = CHECKPOINTS / f"02_origins_{stamp()}"
        folder.mkdir()
        write_parquet(folder / station_name, station_rows)
        atomic_file(folder / crosswalk_name, csv_content)
        atomic_file(folder / "origin_state.json", json_bytes({**state, "mapping_rows": mapped}))
        origin = finalize_checkpoint(folder, fingerprint, (station_name, crosswalk_name), start, free)
        print(f"Validated {len(station_rows):,} station-origin days and {len(mapped)} crosswalk rows", flush=True)
    else:
        log("checkpoint_reused", stage="origins", folder=origin[0].name)
    if not district:
        start, free = time.perf_counter(), check_memory()
        folder = CHECKPOINTS / f"03_districts_{stamp()}"
        folder.mkdir()
        state = load(origin[0] / "origin_state.json")
        station_rows = pq.read_table(origin[0] / station_name, use_threads=False).to_pylist()
        assets = district_stage(station_rows, state["mapping_rows"], audit, state, input_hashes, baseline)
        for name, content in assets.items():
            atomic_file(folder / name, content)
        district = finalize_checkpoint(folder, fingerprint, assets, start, free)
        print("Validated district activity, inherited equity flags and dashboard reports", flush=True)
    else:
        log("checkpoint_reused", stage="districts", folder=district[0].name)
    validate_baseline(baseline)
    outputs = publication((origin, district))
    validate_baseline(baseline)
    log("complete", files=outputs, protected_baseline_file_count=len(baseline["file_hashes"]), outside_git_and_existing_file_hashes_match=True,
        peak_process_working_set_mib=peak_memory(), available_memory_mib=check_memory())
    print(f"Published {len(outputs)} supplemental files. Verified {len(baseline['file_hashes'])} protected file checksums and outside Git status. Peak working set {peak_memory()} MiB.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scan-only", action="store_true", help="Validate and checkpoint the bounded raw scan")
    parser.add_argument("--verify", action="store_true", help="Recompute from the scan checkpoint and match published files without writing")
    args = parser.parse_args()
    if args.verify:
        fingerprint, step1 = raw_fingerprint()
        found = validated_checkpoint("01_od_scan", fingerprint)
        if not found:
            raise FileNotFoundError("A validated Step 4B OD scan checkpoint is required for verification")
        run_analysis(found[0], load(BASELINE), step1, verify_only=True)
        return
    with writer_lock():
        try:
            baseline = capture_baseline()
            fingerprint, step1 = raw_fingerprint()
            folder = scan_stage(fingerprint, step1)
            if not args.scan_only:
                run_analysis(folder, baseline, step1, verify_only=False)
        except Exception as error:
            log("stopped", error=f"{type(error).__name__}: {error}", peak_process_working_set_mib=peak_memory())
            raise


if __name__ == "__main__":
    main()
