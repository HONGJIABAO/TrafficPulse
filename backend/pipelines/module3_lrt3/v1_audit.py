"""Independent read-only Module 3 V1 audit. Run from any directory with the existing module Python."""
import argparse
import csv
import ctypes
import hashlib
from importlib import import_module
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from math import isclose
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PIPE = ROOT / "backend/pipelines/module3_lrt3"
OUT = ROOT / "backend/data/processed/module3_lrt3"
FRONT = ROOT / "frontend/src/modules/module3_drivers_forecast"
RAW = ROOT / "backend/data/raw"
AUDIT_PREFIX = "v1_"
MYT = timezone(timedelta(hours=8))


def read_json(path):
    with path.open(encoding="utf-8-sig") as handle:
        return json.load(handle)


def relative(path):
    return path.relative_to(ROOT).as_posix()


def sha(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def peak_memory():
    class Counters(ctypes.Structure):
        _fields_ = [("size", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in (
                "peak_working", "working", "peak_paged", "paged",
                "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile",
            )
        ]
    kernel = ctypes.windll.kernel32
    kernel.GetCurrentProcess.restype = ctypes.c_void_p
    values = Counters()
    values.size = ctypes.sizeof(values)
    if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(kernel.GetCurrentProcess()), ctypes.byref(values), values.size):
        return round(values.peak_working / 1048576, 1)
    return None


def available_memory():
    class Memory(ctypes.Structure):
        _fields_ = [("size", ctypes.c_ulong), ("load", ctypes.c_ulong)] + [
            (name, ctypes.c_ulonglong) for name in ("total", "free", "page", "free_page", "virtual", "free_virtual", "extended")
        ]
    values = Memory()
    values.size = ctypes.sizeof(values)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(values)):
        return round(values.free / 1048576, 1)
    return None


def memory_guard():
    free = available_memory()
    if free is not None and free < 640:
        raise MemoryError(f"Audit paused at {free} MiB available RAM")
    return free


def checkpoint(section, **fields):
    event = {"section": section, "time_myt": datetime.now(MYT).isoformat(),
             "available_mib": available_memory(), "peak_worker_mib": peak_memory(), **fields}
    with (OUT / "v1_audit_progress.jsonl").open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())


def git(*args):
    return subprocess.check_output(["git", "--no-optional-locks", *args], cwd=ROOT).decode("utf-8")


def audit_file(path):
    parts = path.split("/")
    return any(path.startswith(relative(parent) + "/") for parent in (PIPE, FRONT, OUT)) and parts[-1].startswith(AUDIT_PREFIX)


def git_status():
    return sorted(line for line in git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0")
                  if line and not audit_file(line[3:]))


def capture_baseline():
    memory_guard()
    baseline = OUT / "v1_audit_protection.json"
    if baseline.exists():
        result = read_json(baseline)
        checkpoint("baseline_resumed", protected_files=len(result["files"]), git_status_entries=len(result["git_status"]))
        print(f"Using previously captured baseline for {len(result['files'])} protected files.")
        return
    paths = {ROOT / row for row in git("ls-files", "-z", "--cached", "--others", "--exclude-standard").split("\0")
             if row and not audit_file(row)}
    for parent in (PIPE, OUT, FRONT, RAW):
        for folder, dirs, files in os.walk(parent):
            dirs[:] = [name for name in dirs if name not in {".venv", "__pycache__"} and not name.startswith("browser-profile-")]
            paths.update(Path(folder) / name for name in files if not audit_file(relative(Path(folder) / name)))
    files = {relative(path): sha(path) for path in sorted(paths) if path.is_file()}
    result = {"captured_at_myt": datetime.now(MYT).isoformat(), "git_status": git_status(), "files": files,
              "scope": "Tracked and unignored worktree files, audited module trees, existing build/log/backup artifacts, and local raw inputs.",
              "excluded": ["Installed Python virtual environment and bytecode cache", "Ephemeral earlier Chrome profiles", "New Step 6A files"]}
    with baseline.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    checkpoint("baseline", protected_files=len(files), git_status_entries=len(result["git_status"]))
    print(f"Baseline captured for {len(files)} protected files.")


def verify_baseline():
    prior = read_json(OUT / "v1_audit_protection.json")
    changed = [name for name, digest in prior["files"].items() if not (ROOT / name).is_file() or sha(ROOT / name) != digest]
    git_same = git_status() == prior["git_status"]
    checkpoint("preservation", protected_files=len(prior["files"]), changed_files=changed, git_status_excluding_audit_unchanged=git_same)
    print(f"Protected files {len(prior['files'])}; changed {len(changed)}; existing Git status unchanged: {git_same}")
    if changed or not git_same:
        raise SystemExit(1)


def parse_cell(value):
    if value in (None, "", "NA", "NaN", "nan", "null"):
        return None
    if value.casefold() in ("true", "false"):
        return value.casefold() == "true"
    try:
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return value


def csv_rows(path, literals=()):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle, strict=True):
            yield {key: value if key in literals else parse_cell(value) for key, value in row.items()}


def parquet(path, columns=None):
    import pyarrow as pa
    import pyarrow.parquet as pq

    pa.set_cpu_count(1)
    pa.set_io_thread_count(1)
    for batch in pq.ParquetFile(path).iter_batches(columns=columns, batch_size=4096, use_threads=False):
        yield from batch.to_pylist()


def identical(left, right, abs_tol=1e-8):
    if type(left) is bool or type(right) is bool:
        return left is right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return isclose(left, right, rel_tol=1e-11, abs_tol=abs_tol)
    return left == right


def iso(value):
    return value.date().isoformat() if isinstance(value, datetime) else value.isoformat() if value else None


def asset(name):
    return read_json(FRONT / "data" / f"{name}.json")


def json_write(path, data):
    pending = path.with_suffix(path.suffix + ".pending")
    with pending.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, allow_nan=False, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())
    pending.replace(path)


class Audit:
    def __init__(self, section):
        self.section = section
        self.checks = []
        self.details = {}

    def add(self, name, status, evidence, *, source="", expected="", actual="", tolerance="", issues=""):
        self.checks.append({
            "check_id": f"{self.section}-{len(self.checks) + 1:02}", "section": self.section,
            "check": name, "status": status, "expected": expected, "actual": actual,
            "tolerance": tolerance, "evidence": evidence, "source": source, "issue_ids": issues,
        })

    def check(self, name, ok, evidence, **fields):
        self.add(name, "PASS" if ok else "FAIL", evidence, **fields)

    def save(self):
        path = OUT / f"v1_audit_section_{self.section}.json"
        json_write(path, {"checks": self.checks, "details": self.details})
        flag = {}
        for row in self.checks:
            flag[row["status"]] = flag.get(row["status"], 0) + 1
        checkpoint(self.section, checks=flag, result=relative(path))
        print(self.section, flag, flush=True)


def run_section(section):
    stages = {"S5R": ("integration", "step5r"), "A": ("data", "data_integrity"), "B": ("forecast", "methodology"),
              "C": ("forecast", "metrics"), "D": ("forecast", "forecast_logic"), "E": ("forecast", "research"),
              "F": ("forecast", "drivers"), "G": ("data", "gtfs"), "H": ("data", "peak_proxy"),
              "I": ("data", "equity"), "J": ("integration", "integration"), "K": ("integration", "competition")}
    for name, (module, function) in stages.items():
        if section not in (name, "all"):
            continue
        if (OUT / f"v1_audit_section_{name}.json").is_file():
            print(f"Reusing checkpoint for {name}", flush=True)
            continue
        audit = Audit(name)
        try:
            memory_guard()
            getattr(import_module(f"v1_audit_{module}"), function)(audit)
        except Exception as error:
            checkpoint(name, interrupted=True, error=f"{type(error).__name__}: {error}")
            raise
        audit.save()


def assemble():
    paths = [OUT / f"v1_audit_section_{name}.json" for name in ["S5R", *"ABCDEFGHIJK"]]
    parts = {path.stem.removeprefix("v1_audit_section_"): read_json(path) for path in paths}
    checks = [row for part in parts.values() for row in part["checks"]]
    path = OUT / "v1_audit_checks.csv"
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(checks[0]))
        writer.writeheader()
        writer.writerows(checks)
    json_write(OUT / "v1_data_integrity_audit.json", {
        "scope": "Module 3 Functional V1 independent offline audit, using local archived sources",
        "audit_date_myt": datetime.now(MYT).date().isoformat(),
        "initial_protection": relative(OUT / "v1_audit_protection.json"),
        "check_status_counts": {status: sum(row["status"] == status for row in checks)
                                for status in ("PASS", "FAIL", "PARTIALLY VERIFIED", "NOT VERIFIED", "NOT APPLICABLE")},
        "sections": parts,
    })
    checkpoint("audit_outputs_assembled", checks=len(checks))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("baseline", "preservation", "assemble", "all", "S5R", *"ABCDEFGHIJK"))
    args = parser.parse_args()
    utility = {"baseline": capture_baseline, "preservation": verify_baseline, "assemble": assemble}.get(args.stage)
    if utility:
        utility()
    else:
        run_section(args.stage)
