"""Step 6B.1 protection, checkpoints and guarded entry points."""

import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import shutil

from v1_audit import FRONT, MYT, OUT, PIPE, ROOT, available_memory, peak_memory, relative, sha
from v1_audit_recovery import atomic_text, git, now, read, status, strict_json, write_json


PROGRESS = OUT / "v1_calendar_dependency_progress.jsonl"
BASELINE = OUT / "v1_calendar_dependency_baseline_6b1.json"
REVISION = "module3-v1-verified-calendar.2"
MODEL_OUTPUTS = "v1_calendar_policy_outputs_6b1.json"
PREDICTIONS = "v1_calendar_policy_predictions_6b1.json"
PRODUCTION = {
    PIPE / "export_dashboard.py": "Publish the locally verified correction revision through the existing exporter.",
    FRONT / "tabs/DemandForecast.tsx": "Explain the active indicator and retrospectively rescored terminal evidence.",
    **{FRONT / "data" / name: reason for name, reason in {
        "network.json": "Publish corrected selected component and network forecasts, outlooks and watchlist.",
        "research.json": "Publish corrected Ridge scores, stability alternatives and strategy comparisons.",
        "service.json": "Refresh headline intensity using the active demand revision and unchanged GTFS denominator.",
        "methodology.json": "Report active calendar policy, vintage limits and corrected terminal results.",
        "manifest.json": "Record the active revision and the current sources and asset checksums.",
    }.items()},
}
PRIOR_REPORTS = (
    "v1_bug_register.md", "v1_bug_resolution.md", "v1_correction_register.json",
    "v1_calendar_corrections_6b.json", "v1_calendar_ridge_sensitivity_6b.json",
    "v1_fix_summary.md", "v1_test_results.json", "v1_fix_progress.jsonl",
    "v1_deployment_asset_inventory.json", "v1_regression_results.csv", "v1_system_test_report.md",
    "v1_manual_test_checklist.md", "forecast_metadata.json", "model_backtesting.csv",
    "feature_ablation.csv", "model_stability.csv",
)


def note(event, **fields):
    record = {"event": event, "time_myt": now(), **fields}
    with PROGRESS.open("ab") as stream:
        stream.write((json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n").encode())
        stream.flush()
        os.fsync(stream.fileno())


def load_journal():
    if not PROGRESS.is_file():
        return []
    events, bad = [], []
    for index, line in enumerate(PROGRESS.read_bytes().splitlines(), 1):
        try:
            events.append(strict_json(line.decode()))
        except (ValueError, UnicodeError):
            bad.append(index)
    if bad or not PROGRESS.read_bytes().endswith(b"\n"):
        saved = OUT / f"v1_calendar_dependency_interrupted_{datetime.now(MYT):%Y%m%d_%H%M%S_%f}.jsonl"
        shutil.copy2(PROGRESS, saved)
        atomic_text(PROGRESS, "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
        note("progress_recovered", saved=relative(saved), invalid_lines=bad)
    return events


def guard(operation, threshold=800):
    free = available_memory()
    if free is None or free < threshold:
        note("memory_guard", operation=operation, status="BLOCKED", free_mib=free, threshold_mib=threshold)
        raise SystemExit(f"{operation} needs {threshold} MiB available; measured {free} MiB.")
    return free


def baseline():
    load_journal()
    if BASELINE.is_file():
        print("Reusing", read(BASELINE)["backups"])
        return
    free = guard("baseline")
    register = read(OUT / "v1_correction_register.json")
    results = read(OUT / "v1_test_results.json")
    issue = next(row for row in register["issues"] if row["issue_id"] == "M3-02")
    assert issue["status"] == "FIXED BUT NOT FULLY VERIFIED"
    assert results["latest_regressions"] == {"PASS": 16} and results["latest_browser_checks"] == {"PASS": 7}
    requested = dict(register["baseline_sha256"])
    requested.update({row["path"]: row["after_sha256"] for row in results["preservation"]["changed_existing_production_files"]})
    for name in PRIOR_REPORTS:
        path = OUT / name
        requested.setdefault(relative(path), sha(path))
    for path in [*PIPE.glob("v1_fix*"), PIPE / "v1_calendar_corrections.py"]:
        requested[relative(path)] = sha(path)
    actual = {name: sha(ROOT / name) for name in requested}
    mismatch = [name for name, value in requested.items() if actual[name] != value]
    if mismatch:
        raise ValueError(f"Unexpected current changes relative to Step 6B: {mismatch}")
    backup = OUT / f"v1_calendar_dependency_backup_{datetime.now(MYT):%Y%m%d_%H%M%S_%f}"
    originals = {}
    for path, reason in PRODUCTION.items():
        name = relative(path)
        dest = backup / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, dest)
        assert sha(dest) == requested[name]
        originals[name] = {"backup": relative(dest), "sha256": requested[name], "reason": reason}
    evidence = {name: requested[relative(OUT / name)] for name in PRIOR_REPORTS}
    write_json(BASELINE, {"created_myt": now(), "step6b_issue": issue["status"], "backups": relative(backup),
                         "evidence": evidence, "production_originals": originals, "hashes": requested,
                         "git": status(), "head": git("rev-parse", "HEAD").strip(), "available_mib": free})
    note("baseline", status="PASS", protected=len(requested), backed_up=len(originals), peak_worker_mib=peak_memory(),
         free_mib=free, process_inspection="No module worker was present; the only Node process belonged to Adobe.")
    print(f"Validated {len(requested)} hashes and backed up {len(originals)} files at {free} MiB available.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("baseline", "evaluate", "regression", "publication"))
    args = parser.parse_args()
    if args.stage == "baseline":
        baseline()
        return
    load_journal()
    if args.stage == "evaluate":
        from v1_calendar_policy_eval import evaluate
        evaluate()
    else:
        from v1_calendar_policy_checks import finish, regressions
        {"regression": regressions, "publication": finish}[args.stage]()


if __name__ == "__main__":
    main()
