"""Run the Step 6B.1 build and Chrome checks without changing Step 6B logs."""

import argparse
from datetime import datetime
import os
from pathlib import Path
import subprocess
import time

from v1_audit import MYT, OUT, PIPE, ROOT, available_memory, relative
from v1_calendar_dependency import PROGRESS, guard, load_journal, note
from v1_fix_system import operation, process_peak

RUNS = OUT / "v1_calendar_dependency_system_runs"


def run(stage, folder, chrome):
    if stage == "browser":
        if not chrome or not (folder / "dist/index.html").is_file():
            raise ValueError("Browser check requires a completed local build and existing Chrome")
        command = ["node", str(PIPE / "v1_calendar_policy_browser.mjs"), str(chrome), str(folder / "dist")]
        threshold = 1350
    else:
        command, threshold = operation(stage, folder, None)
    try:
        free = guard(stage, threshold)
    except SystemExit as error:
        note("system", test_id=stage, status="NOT RUN", actual=str(error), folder=relative(folder))
        raise
    floor, peak, paused = free, 0, False
    folder.mkdir(parents=True, exist_ok=True)
    log = folder / f"{stage}_{datetime.now(MYT):%H%M%S_%f}.log"
    env = os.environ | {"RAYON_NUM_THREADS": "1", "UV_THREADPOOL_SIZE": "1", "TRAFFICPULSE_TEST_PROGRESS": str(PROGRESS)}
    note("system_started", test_id=stage, folder=relative(folder), free_mib=free, threshold_mib=threshold)
    with log.open("xb") as stream, subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT) as process:
        while process.poll() is None:
            available = available_memory()
            if available is not None:
                floor = min(floor, available)
            peak = max(peak, process_peak(process))
            if floor < 650 and stage != "browser":
                process.terminate()
                paused = True
                break
            time.sleep(0.15)
        code = process.wait(timeout=20)
        stream.flush()
        os.fsync(stream.fileno())
    result = "BLOCKED" if paused else "PASS" if code == 0 else "FAIL"
    note("system", test_id=stage, status=result, expected="Exit 0 with all scoped checks executed",
         actual=f"Exit {code}", method="Existing offline build or local headless Chrome harness",
         command=command, folder=relative(folder), log=relative(log), available_mib_before=free,
         minimum_sampled_available_mib=floor, peak_node_mib=peak)
    print(stage, result, f"available memory floor {floor} MiB, Node peak {peak} MiB, {relative(log)}")
    if code:
        print(log.read_text(encoding="utf-8", errors="replace")[-4000:])
    return code


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("local", "build", "browser"))
    parser.add_argument("--folder")
    parser.add_argument("--chrome")
    args = parser.parse_args()
    load_journal()
    folder = Path(args.folder).resolve() if args.folder else RUNS / f"{datetime.now(MYT):%Y%m%d_%H%M%S_%f}"
    if not folder.is_relative_to(RUNS):
        raise ValueError("Use the dedicated versioned run directory")
    stages = ("typescript-app", "typescript-node", "build") if args.stage == "local" else (args.stage,)
    for stage in stages:
        code = run(stage, folder, args.chrome)
        if code:
            raise SystemExit(code)
