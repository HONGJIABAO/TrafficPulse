"""Resume, publish and verify the Module 3 Step 4 district equity analysis."""

import argparse
import csv
import ctypes
import hashlib
import io
import json
import os
import subprocess
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

# Make normal direct invocation conservative as well as the documented command.
for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "ARROW_NUM_THREADS"):
    os.environ[variable] = "1"

import pyarrow as pa

from equity_analysis import INDICATORS, compute_activity, compute_coverage, compute_screen, compute_socioeconomic
from equity_geography import map_stations
from equity_reporting import build_reporting


MODULE = Path(__file__).resolve().parent
ROOT = MODULE.parents[2]
RAW = ROOT / "backend/data/raw"
OUTPUT = ROOT / "backend/data/processed/module3_lrt3"
CHECKPOINTS = OUTPUT / "equity_checkpoints"
PROGRESS = OUTPUT / "equity_progress.jsonl"
MYT = timezone(timedelta(hours=8))
MIB = 1024 ** 2
MIN_FREE_MIB = 768
SOURCE_MODULES = ("run_equity.py", "equity_geography.py", "equity_analysis.py", "equity_reporting.py")
pa.set_cpu_count(1)
pa.set_io_thread_count(1)


class MemoryStatus(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [(name, ctypes.c_ulonglong) for name in (
        "total_phys", "available_phys", "total_page", "available_page", "total_virtual", "available_virtual", "extended_available_virtual",
    )]


class ProcessMemory(ctypes.Structure):
    _fields_ = [("length", ctypes.c_ulong), ("fault_count", ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in (
        "peak_working_set", "working_set", "peak_paged_pool", "paged_pool", "peak_nonpaged_pool", "nonpaged_pool",
        "pagefile_usage", "peak_pagefile_usage",
    )]


def available_memory():
    if os.name == "nt":
        memory = MemoryStatus(length=ctypes.sizeof(MemoryStatus))
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)):
            return memory.available_phys / MIB
    return None


def peak_memory():
    if os.name == "nt":
        kernel = ctypes.windll.kernel32
        kernel.GetCurrentProcess.restype = ctypes.c_void_p
        counters = ProcessMemory(length=ctypes.sizeof(ProcessMemory))
        if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(kernel.GetCurrentProcess()), ctypes.byref(counters), counters.length):
            return round(counters.peak_working_set / MIB, 1)
    return None


def check_memory():
    free = available_memory()
    if free is not None and free < MIN_FREE_MIB:
        raise MemoryError(f"Available physical RAM is {free:.0f} MiB, below the {MIN_FREE_MIB} MiB safeguard")
    return round(free, 1) if free is not None else None


def now():
    return datetime.now(MYT)


def stamp():
    return now().strftime("%Y%m%d_%H%M%S_%f")


def sha(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def json_bytes(value):
    return (json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def flushed_create(path, content):
    with path.open("xb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def validate_bytes(path, content):
    if path.read_bytes() != content:
        raise ValueError(f"Staged file failed byte-for-byte read-back: {path}")


def log(event, **fields):
    with PROGRESS.open("a+b") as handle:
        length = handle.seek(0, os.SEEK_END)
        if length:
            handle.seek(-1, os.SEEK_END)
            if handle.read(1) != b"\n":
                handle.write(b"\n")
        record = {"event": event, "time_myt": now().isoformat(), **fields}
        handle.write((json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"))
        handle.flush()
        os.fsync(handle.fileno())


@contextmanager
def single_writer():
    CHECKPOINTS.mkdir(exist_ok=True)
    with (CHECKPOINTS / "run.lock").open("a+b") as handle:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as ex:
                raise RuntimeError("Another Step 4 writer holds the checkpoint lock") from ex
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


def cell(value):
    if value is None:
        return "NA"
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def csv_asset(rows, key):
    columns = list(rows[0])
    keys = [tuple(row[name] for name in key) for row in rows]
    if len(set(keys)) != len(rows) or any(None in parts for parts in keys):
        raise ValueError(f"Duplicate or unavailable output key {key}")
    if any(list(row) != columns for row in rows):
        raise ValueError(f"Uneven output schema for {key}")
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    encoded_rows = [[cell(row[column]) for column in columns] for row in rows]
    writer.writerow(columns)
    writer.writerows(encoded_rows)
    text = stream.getvalue()
    if list(csv.reader(io.StringIO(text, newline=""), strict=True)) != [columns, *encoded_rows]:
        raise ValueError(f"CSV round-trip failed for {key}")
    types = {}
    for name in columns:
        value_types = {type(row[name]).__name__ for row in rows if row[name] is not None}
        types[name] = ("number" if value_types <= {"float", "int"} else next(iter(value_types))) if value_types else "unavailable"
    return text.encode("utf-8"), {"rows": len(rows), "columns": columns, "column_types": types, "key": list(key)}


def json_asset(value, schema=None):
    data = json_bytes(value)
    if not isinstance(json.loads(data), dict):
        raise ValueError("Expected JSON object")
    return data, schema or {}


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle, strict=True))


def find_checkpoint(stage, fingerprint):
    for folder in sorted(CHECKPOINTS.glob(f"{stage}_*"), reverse=True):
        manifest = folder / "stage.json"
        if not manifest.is_file():
            continue
        try:
            record = load(manifest)
            if record["fingerprint"] != fingerprint:
                continue
            if all(sha(folder / name) == item["sha256"] for name, item in record["files"].items()):
                return folder, record
        except (ValueError, OSError, KeyError, TypeError):
            # Keep partial and unreadable checkpoints for later inspection.
            continue
    return None


def known_published_hash(name):
    if not PROGRESS.exists():
        return None
    known = None
    with PROGRESS.open(encoding="utf-8") as handle:
        for line in handle:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("event") in ("published", "publication_pending") and name in event.get("outputs", {}):
                known = event["outputs"][name]
    return known


def publish(folder, files):
    outputs = {}
    for name, detail in files.items():
        if name == "stage_data.json":
            continue
        destination = OUTPUT / name
        expected = detail["sha256"]
        outputs[name] = expected
        if destination.exists() and sha(destination) == expected:
            continue
        replacing = destination.exists()
        if replacing:
            previous = known_published_hash(name)
            observed = sha(destination)
            if previous is None or previous != expected:
                raise FileExistsError(f"Existing output has no matching validated checkpoint for safe replacement: {destination}")
            backup = OUTPUT / "equity_recovery_backups" / stamp()
            backup.mkdir(parents=True)
            preserved = backup / name
            flushed_create(preserved, destination.read_bytes())
            if sha(preserved) != observed:
                raise ValueError(f"Backup check failed for {destination}")
            log("corrupted_output_backed_up", file=name, sha256=observed, backup=preserved.relative_to(ROOT).as_posix())
        staged = folder / f"{name}.{stamp()}.publishing"
        content = (folder / name).read_bytes()
        flushed_create(staged, content)
        validate_bytes(staged, content)
        log("publication_pending", outputs={name: expected})
        if replacing:
            if sha(destination) != observed:
                raise ValueError(f"Output changed while preparing recovery: {destination}")
            os.replace(staged, destination)
        else:
            os.link(staged, destination)
            # The staged hard link remains available for crash recovery audit.
        if sha(destination) != expected:
            raise ValueError(f"Published output failed checksum validation: {destination}")
    log("published", outputs=outputs)


def run_stage(stage, compute, fingerprint, verify_only):
    free = check_memory()
    start = time.perf_counter()
    recovered = None if verify_only else find_checkpoint(stage, fingerprint)
    if recovered:
        folder, record = recovered
        state = load(folder / "stage_data.json")
        files = record["files"]
        status = "reused"
    else:
        state, assets = compute()
        if verify_only:
            for name, (content, _) in assets.items():
                validate_bytes(OUTPUT / name, content)
            print(f"{stage}: recomputed and matched published outputs ({time.perf_counter() - start:.2f}s)", flush=True)
            return state, {name: info for name, (_, info) in assets.items()}
        folder = CHECKPOINTS / f"{stage}_{stamp()}"
        folder.mkdir()
        files = {}
        for name, (content, info) in {**assets, "stage_data.json": json_asset(state)}.items():
            path = folder / name
            flushed_create(path, content)
            validate_bytes(path, content)
            files[name] = {"sha256": sha(path), "bytes": path.stat().st_size, "schema": info}
        manifest = {"stage": stage, "fingerprint": fingerprint, "files": files, "stage_status": "validated"}
        pending = folder / "stage.json.pending"
        flushed_create(pending, json_bytes(manifest))
        os.replace(pending, folder / "stage.json")
        status = "completed"
    log("stage_checkpoint", stage=stage, status=status, checkpoint=folder.relative_to(ROOT).as_posix(),
        seconds=round(time.perf_counter() - start, 3), available_memory_mib=free,
        peak_process_working_set_mib=peak_memory(), fingerprint=fingerprint)
    publish(folder, files)
    print(f"{stage}: {status} and validated ({time.perf_counter() - start:.2f}s, peak {peak_memory()} MiB)", flush=True)
    return state, {name: item["schema"] for name, item in files.items() if name != "stage_data.json"}


def preservation_check(recovery):
    for item in recovery["inventory"]:
        path = ROOT / item["path"]
        stat = path.stat()
        if stat.st_size != item["bytes"] or stat.st_mtime_ns != item["mtime_ns"]:
            raise ValueError(f"Recovered or protected file size/timestamp changed: {path}")
        if "/.venv/" not in item["path"] and sha(path) != item["sha256"]:
            raise ValueError(f"Recovered or protected file checksum changed: {path}")
    status = subprocess.check_output(["git", "--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"], cwd=ROOT, text=True).splitlines()
    owned = ("backend/pipelines/module3_lrt3/", "backend/data/processed/module3_lrt3/")
    outside = [line for line in status if not line[3:].startswith(owned)]
    before = [line for line in recovery["git_status_before"] if not line[3:].startswith(owned)]
    if outside != before:
        raise ValueError("Git status outside the authorized Module 3 directories differs from the recovery baseline")
    return len(recovery["prior_outputs"])


def pipeline(verify_only):
    recovery_files = sorted(OUTPUT.glob("equity_recovery_*.json"))
    if not recovery_files:
        raise FileNotFoundError("The Step 4 recovery inventory must exist before execution")
    recovery = load(recovery_files[0])
    capacity = load(OUTPUT / "capacity_metadata.json")
    schedule_date = capacity["GTFS"]["pattern_reference_date"]
    od_reference = capacity["LRT3_OD_observed"]
    boundary_manifest = MODULE / "equity_inputs/boundary_sources.json"
    provenance, = load(boundary_manifest)
    boundary = boundary_manifest.parent / provenance["file"]
    gtfs = ROOT / capacity["GTFS"]["archive"]["path"]
    inputs = [*(RAW / (dataset + ".parquet") for dataset in INDICATORS), boundary_manifest, boundary, gtfs,
              *(MODULE / name for name in SOURCE_MODULES),
              *(OUTPUT / name for name in ("capacity_metadata.json", "gtfs_service_mapping.csv", "lrt3_station_daily.parquet", "lrt3_daily.parquet"))]
    input_info = {path.relative_to(ROOT).as_posix(): sha(path) for path in inputs}
    if sha(boundary) != provenance["sha256"] or boundary.stat().st_size != provenance["bytes"]:
        raise ValueError("The recovered district boundaries fail their recorded fingerprint")
    if sha(gtfs) != capacity["GTFS"]["archive"]["sha256"]:
        raise ValueError("Unexpected GTFS snapshot")
    fingerprint = hashlib.sha256(json_bytes(input_info)).hexdigest()
    schemas = {}

    def stage(name, compute):
        state, output_schemas = run_stage(name, compute, fingerprint, verify_only)
        schemas.update(output_schemas)
        return state

    def socioeconomic():
        rows, audit = compute_socioeconomic(RAW, int(schedule_date[:4]), check_memory)
        return {"rows": rows, "audit": audit}, {"district_socioeconomic_summary.csv": csv_asset(rows, ("district_id",))}

    def geography():
        rows, polygons, audit = map_stations(gtfs, read_csv(OUTPUT / "gtfs_service_mapping.csv"),
                                            load(boundary), provenance, check_memory)
        return {"rows": rows, "audit": audit}, {
            "station_district_mapping.csv": csv_asset(rows, ("gtfs_stop_id",)),
            "district_boundaries.geojson": json_asset(polygons, {"features": len(polygons["features"]), "key": "properties.district_id", "crs": "EPSG:4326"}),
        }

    def rail_coverage():
        rows, audit = compute_coverage(socio["rows"], mapping["rows"], schedule_date)
        return {"rows": rows, "audit": audit}, {"district_rail_coverage.csv": csv_asset(rows, ("district_id",))}

    def demand_activity():
        rows, audit = compute_activity(socio["rows"], mapping["rows"], OUTPUT, od_reference)
        return {"rows": rows, "audit": audit}, {"district_demand_activity.csv": csv_asset(rows, ("district_id",))}

    def screening():
        audit = socio["audit"]
        primary, sensitivity = compute_screen(socio["rows"], coverage["rows"], activity["rows"],
                                              audit["all_scope_common_survey_year"], audit["latest_survey_year"])
        return {"primary": primary, "sensitivity": sensitivity}, {
            "equity_priority_screening.csv": csv_asset(primary, ("district_id",)),
            "equity_threshold_sensitivity.csv": csv_asset(sensitivity, ("scenario_id", "district_id")),
        }

    def reports():
        metadata, summary = build_reporting(socio, mapping, coverage, activity, screen, provenance, input_info, schemas)
        return {"validation": metadata["validation"]}, {
            "equity_metadata.json": json_asset(metadata),
            "equity_summary.md": (summary.encode("utf-8"), {}),
        }

    socio = stage("01_socioeconomic", socioeconomic)
    mapping = stage("02_geography", geography)
    coverage = stage("03_coverage", rail_coverage)
    activity = stage("04_demand", demand_activity)
    screen = stage("05_screening", screening)
    stage("06_reporting", reports)
    preserved = preservation_check(recovery)
    print(f"Verified {preserved} protected prior outputs and the recovered boundary work. Outside Git status matches the baseline.", flush=True)
    if not verify_only:
        log("complete", prior_outputs_preserved=preserved, fingerprint=fingerprint,
            peak_process_working_set_mib=peak_memory(), available_memory_mib=available_memory())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Independently recompute Step 4 and compare outputs without writing files")
    args = parser.parse_args()
    if args.verify:
        pipeline(verify_only=True)
    else:
        with single_writer():
            try:
                pipeline(verify_only=False)
            except Exception as ex:
                log("stopped", error=f"{type(ex).__name__}: {ex}", peak_process_working_set_mib=peak_memory())
                raise


if __name__ == "__main__":
    main()
