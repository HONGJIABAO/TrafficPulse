"""Run one guarded Step 6B compiler, build or browser operation at a time."""

import argparse
import ctypes
from datetime import datetime
import os
from pathlib import Path
import subprocess
import time

from v1_audit import MYT, OUT, PIPE, ROOT, available_memory, relative
from v1_fix import guard, note, repair_progress

FRONTEND_ROOT = ROOT / "frontend"
RUNS = OUT / "v1_fix_system_runs"


def process_peak(process):
    class Counters(ctypes.Structure):
        _fields_ = [("size", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ("peak_working", "working", "peak_paged", "paged",
                                                "peak_nonpaged", "nonpaged", "pagefile", "peak_pagefile")
        ]

    counters = Counters()
    counters.size = ctypes.sizeof(counters)
    if ctypes.windll.psapi.GetProcessMemoryInfo(ctypes.c_void_p(int(process._handle)), ctypes.byref(counters), counters.size):
        return round(counters.peak_working / 1048576, 1)
    return 0


def operation(stage, build_folder, chrome):
    if stage.startswith("typescript-"):
        name = stage.split("-", 1)[1]
        return (["node", str(FRONTEND_ROOT / "node_modules/typescript/bin/tsc"), "-p",
                 str(FRONTEND_ROOT / f"tsconfig.{name}.json"), "--noEmit", "--incremental", "false", "--pretty", "false"], 1000)
    if stage == "build":
        return (["node", str(FRONTEND_ROOT / "node_modules/vite/bin/vite.js"), "build",
                 str(FRONTEND_ROOT), "--config", str(FRONTEND_ROOT / "vite.config.ts"), "--configLoader", "runner",
                 "--outDir", str(build_folder / "dist")], 1200)
    return (["node", str(PIPE / "v1_fix_browser.mjs"), str(chrome), str(build_folder / "dist")], 1350)


def system_test(stage, build_folder, chrome):
    repair_progress()
    if not build_folder:
        build_folder = RUNS / f"{datetime.now(MYT):%Y%m%d_%H%M%S_%f}"
    else:
        build_folder = Path(build_folder).resolve()
    if not build_folder.is_relative_to(RUNS):
        raise ValueError("The build and browser artifacts must use the Step 6B system output directory")
    if stage == "browser" and (not chrome or not (build_folder / "dist/index.html").is_file()):
        raise ValueError("Browser testing requires a completed local build and the existing Chrome executable")
    cmd, minimum = operation(stage, build_folder, chrome)
    try:
        free = guard(stage, minimum)
    except SystemExit as error:
        note("system", test_id=stage, status="NOT RUN", reason=str(error), minimum_mib=minimum)
        raise
    build_folder.mkdir(parents=True, exist_ok=True)
    log = build_folder / f"{stage}_{datetime.now(MYT):%H%M%S_%f}.log"
    environment = os.environ | {"RAYON_NUM_THREADS": "1", "UV_THREADPOOL_SIZE": "1"}
    environment["TRAFFICPULSE_TEST_PROGRESS"] = str(OUT / "v1_fix_progress.jsonl")
    started = time.monotonic()
    lowest, peak, blocked = free, 0, False
    note("system_started", test_id=stage, free_mib=free, minimum_mib=minimum, output=relative(build_folder))
    with log.open("xb") as result:
        with subprocess.Popen(cmd, cwd=ROOT, stdout=result, stderr=subprocess.STDOUT, env=environment) as process:
            while process.poll() is None:
                remaining = available_memory()
                if remaining is not None:
                    lowest = min(lowest, remaining)
                peak = max(peak, process_peak(process))
                if lowest < 600 and stage != "browser":
                    blocked = True
                    process.terminate()
                    break
                time.sleep(0.15)
            exit_code = process.wait(timeout=20)
        result.flush()
        os.fsync(result.fileno())
    disposition = "BLOCKED" if blocked else "PASS" if exit_code == 0 else "FAIL"
    note("system", test_id=stage, status=disposition, command=cmd, exit_code=exit_code,
         log=relative(log), output=relative(build_folder), start_free_mib=free, lowest_free_mib=lowest,
         node_peak_worker_mib=peak, seconds=round(time.monotonic() - started, 2))
    print(f"{stage} {disposition}, log {relative(log)}, minimum observed RAM {lowest} MiB, Node peak {peak} MiB")
    if exit_code:
        print(log.read_text(encoding="utf-8", errors="replace")[-6000:])
    return exit_code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("typescript-app", "typescript-node", "build", "browser"))
    parser.add_argument("--folder")
    parser.add_argument("--chrome")
    args = parser.parse_args()
    raise SystemExit(system_test(args.stage, args.folder, args.chrome))
