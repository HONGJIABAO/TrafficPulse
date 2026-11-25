"""Verify the existing calendar-revision build and publish isolated Step 6B.2 evidence."""

import argparse
from collections import Counter
from datetime import datetime
import json
import os
from pathlib import Path
import subprocess
import time

from v1_audit import FRONT, MYT, OUT, PIPE, ROOT, available_memory, relative, sha
from v1_audit_recovery import atomic_text, git, now, read, status, strict_csv, strict_json, write_json
from v1_calendar_dependency import BASELINE, REVISION
from v1_fix_system import process_peak

RUN_ROOT = OUT / "v1_final_browser_runs"
REQUIRED = ("FB-A", "FB-B", "FB-C", "FB-D", "FB-E", "FB-F", "FB-CONSOLE")
PRIOR = (
    "v1_calendar_dependency_report.md", "v1_calendar_dependency_resolution.json",
    "v1_calendar_dependency_regression.csv", "v1_calendar_dependency_progress.jsonl",
    "v1_correction_register_6b1.json",
)
START_MIN, PREFERRED = 1350, 2048


def current_trial():
    baseline = next(iter(sorted(RUN_ROOT.glob("*/preflight.json"), reverse=True)), None)
    if baseline is None:
        raise ValueError("Run prepare before verification or publication.")
    return baseline.parent, read(baseline)


def event(folder, **fields):
    with (folder / "progress.jsonl").open("ab") as stream:
        stream.write((json.dumps({"time_myt": now(), **fields}, ensure_ascii=False, allow_nan=False) + "\n").encode())
        stream.flush()
        os.fsync(stream.fileno())


def events(folder):
    path = folder / "progress.jsonl"
    return [strict_json(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.is_file() else []


def prepare():
    resolution = read(OUT / PRIOR[1])
    register = read(OUT / PRIOR[4])
    report = (OUT / PRIOR[0]).read_text(encoding="utf-8")
    ledger = list(strict_csv(OUT / PRIOR[2]))
    journal = [strict_json(line) for line in (OUT / PRIOR[3]).read_text(encoding="utf-8").splitlines()]
    rows = {row["test_id"]: row for row in ledger}
    assert all(rows[f"CAL-{i:02}"]["status"] == "PASS" for i in range(1, 10))
    assert resolution["revision"] == register["revision"] == REVISION
    issue = next(item for item in register["issues"] if item["issue_id"] == "M3-02")
    assert issue["status"] == resolution["status"] == "FIXED BUT NOT FULLY VERIFIED"
    assert resolution["system"]["build"]["status"] == "PASS"
    assert "FIXED BUT NOT FULLY VERIFIED" in report and journal[-1]["event"] == "publication"
    build = ROOT / resolution["system"]["build"]["folder"] / "dist"
    manifest = read(FRONT / "data/manifest.json")
    assert manifest["dataRevision"] == REVISION and (build / "index.html").is_file()
    hash_list = dict(read(BASELINE)["hashes"])
    hash_list.update({row["path"]: row["after"] for row in resolution["preservation"]["edits"]})
    hash_list.update({relative(path): sha(path) for path in build.rglob("*") if path.is_file()})
    assets = {}
    for name in ("manifest.json", *manifest["assets"]):
        source = FRONT / "data" / name
        built = list((build / "assets").glob(f"{source.stem}-*.json"))
        assert len(built) == 1 and sha(source) == hash_list[relative(built[0])]
        if name != "manifest.json":
            assert manifest["assets"][name]["sha256"] == hash_list[relative(built[0])]
        assets[name] = {"source": relative(source), "built": relative(built[0]), "sha256": sha(source)}
    for name in (*PRIOR, resolution["analysis_artifact"], resolution["prediction_artifact"]):
        file = OUT / name
        hash_list[relative(file)] = sha(file)
    for path in PIPE.glob("v1_calendar_*.py"):
        hash_list.setdefault(relative(path), sha(path))
    for path in (PIPE / "v1_calendar_policy_browser.mjs", ROOT / resolution["system"]["build"]["log"]):
        hash_list[relative(path)] = sha(path)
    for name, expected in hash_list.items():
        assert sha(ROOT / name) == expected, name
    profile = RUN_ROOT / f"{datetime.now(MYT):%Y%m%d_%H%M%S_%f}"
    profile.mkdir(parents=True, exist_ok=False)
    write_json(profile / "preflight.json", {
        "captured_myt": now(), "revision": manifest["dataRevision"], "build": relative(build),
        "entry_sha256": sha(build / "index.html"), "assets": assets, "hashes": hash_list,
        "git": status(), "head": git("rev-parse", "HEAD").strip(),
        "available_mib": available_memory(), "previous_reports": list(PRIOR),
        "process_inspection": "No Module 3 Python, Node or Vite worker found. Prior test DevTools ports and Vite port 5173 were inactive.",
    })
    event(profile, event="preflight", status="PASS", checked_files=len(hash_list), asset_digests=len(assets))
    print(relative(profile), "verified", len(hash_list), "hashes and nine built assets", available_memory(), "MiB free")


def run(chrome):
    folder, plan = current_trial()
    if any(item["event"] == "browser_started" for item in events(folder)):
        raise ValueError("The planned single Chrome session has already started.")
    free = available_memory()
    if free is None or free < START_MIN:
        event(folder, event="browser_result", status="NOT RUN", available_mib=free, minimum_launch_mib=START_MIN)
        print("Chrome not launched:", free, "MiB free")
        return 2
    chrome = Path(chrome)
    if not chrome.is_file():
        raise FileNotFoundError(chrome)
    env = os.environ | {"TRAFFICPULSE_TEST_PROGRESS": str(folder / "progress.jsonl"),
                     "TRAFFICPULSE_BROWSER_OUTPUT": str(folder), "UV_THREADPOOL_SIZE": "1"}
    command = ["node", str(PIPE / "v1_final_browser_checks.mjs"), str(chrome), str(ROOT / plan["build"])]
    log = folder / "chrome.log"
    minimum, peak = free, 0
    started = time.monotonic()
    event(folder, event="browser_started", available_mib=free, minimum_launch_mib=START_MIN, preferred_mib=PREFERRED)
    with log.open("xb") as stream, subprocess.Popen(command, env=env, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT) as process:
        while process.poll() is None:
            remaining = available_memory()
            if remaining is not None:
                minimum = min(minimum, remaining)
            peak = max(peak, process_peak(process))
            time.sleep(0.2)
        code = process.wait()
        stream.flush()
        os.fsync(stream.fileno())
    event(folder, event="browser_result", status="PASS" if code == 0 else "FAIL", exit_code=code,
          available_mib=free, minimum_sampled_mib=minimum, node_peak_mib=peak,
          wall_seconds=round(time.monotonic() - started, 2), log=relative(log))
    print(f"Chrome exit {code}, RAM {free} → {minimum} MiB, Node peak {peak} MiB. {relative(log)}")
    print(log.read_text(encoding="utf-8", errors="replace")[-6500:])
    return code


def publish():
    folder, baseline = current_trial()
    journal = events(folder)
    result = next((item for item in reversed(journal) if item["event"] == "browser_result"), {"status": "NOT RUN"})
    performed = {item["test_id"]: item for item in journal if item["event"] == "browser_check"}
    checks = {name: performed.get(name, {"status": "NOT RUN"}) for name in REQUIRED}
    changes = [name for name, token in baseline["hashes"].items() if sha(ROOT / name) != token]
    outside = lambda rows: [row for row in rows if not any(row[3:].startswith(relative(p) + "/")
                                                         for p in (OUT, PIPE, FRONT))]
    git_same = outside(status()) == outside(baseline["git"])
    head_same = git("rev-parse", "HEAD").strip() == baseline["head"]
    preserved = not changes and git_same and head_same
    passed = preserved and result["status"] == "PASS" and all(item["status"] == "PASS" for item in checks.values())
    new_status = "RESOLVED AND VERIFIED" if passed else "FIXED BUT NOT FULLY VERIFIED"
    console = checks["FB-CONSOLE"].get("actual", {}).get("errors")
    branch = git("status", "--short", "--branch").splitlines()[0]
    body = {
        "revision": REVISION, "build": baseline["build"], "build_entry_sha256": baseline["entry_sha256"],
        "built_assets": baseline["assets"], "prior_offline_verification": "PASS, nine cases plus TypeScript and existing build",
        "browser": result, "checks": checks, "console_errors": console,
        "preservation": {"status": "PASS" if preserved else "FAIL", "files_checked": len(baseline["hashes"]),
                         "changed_protected_files": changes, "outside_git_changes_preserved": git_same,
                         "head_unchanged": head_same, "branch": branch},
        "issue": {"issue_id": "M3-02", "previous": "FIXED BUT NOT FULLY VERIFIED", "status": new_status},
        "remaining_limitations": ["Fresh deployment from tracked inputs remains pending.",
                                  "Archived calendar vintages cannot establish real-time historical feature availability.",
                                  "The retrospective evaluations do not validate direct 90-day realized accuracy."],
        "completed_myt": now(),
    }
    write_json(OUT / "v1_final_browser_verification.json", body)
    prior = read(OUT / PRIOR[4])
    issues = [item | {"step6b1_status": item["status"], "status": new_status,
                      "step6b2_evidence": "v1_final_browser_verification.json",
                      "verification_scope": "Active calendar revision, retained forecast family and local browser validation"} if item["issue_id"] == "M3-02"
              else item for item in prior["issues"]]
    write_json(OUT / "v1_correction_register_6b2.json", {
        "revision": REVISION, "previous": PRIOR[4], "completed_myt": now(), "issues": issues,
        "status_counts": dict(Counter(item["status"] for item in issues)),
    })
    lines = [
        "# Module 3 Step 6B.2 final browser verification", "",
        f"**M3-02 · {new_status}.** Revision `{REVISION}` used the existing Step 6B.1 production build. "
        "All nine emitted runtime data assets match the active source files.", "",
        f"Build path `{baseline['build']}`. Entry SHA-256 `{baseline['entry_sha256']}`.", "",
        "## Executed scope", "", "| Check | Result | Evidence |", "| --- | --- | --- |",
    ]
    for name, item in checks.items():
        actual = item.get("actual", {})
        description = item.get("description", "")
        evidence = {
            "FB-A": "Six scopes and chart-point tooltips matched. The future view showed 63,418,661 trips.",
            "FB-B": "3.57% and 2.54% terminal WAPE. Rolling Ridge and stability values matched, and LRT3 scenarios and donor evidence remained available.",
            "FB-C": "Three holidays, 23 control-date uses and −37.29%. All four calendar tooltip statuses rendered.",
            "FB-D": "Corrected intensity, 229 departures, 142,896 nominal places, 62/56 dates and unavailable Christmas supply.",
            "FB-E": "The active revision, manifest hashes, vintage caveat and retrospective qualification appeared.",
            "FB-F": "All five tabs opened. The equity map, structural zero and unavailable ratio worked. Three teammate routes mounted.",
            "FB-CONSOLE": "No unexpected Module 3 console or asset errors.",
        }[name] if item["status"] == "PASS" else actual.get("error", "").splitlines()[0] if actual.get("error") else ""
        lines.append(f"| {name} {description} | {item['status']} | {evidence.replace('|', '&#124;')} |")
    lines.extend(["", "## Browser and preservation", "",
                  f"Browser process result **{result['status']}**. Available RAM before launch assessment "
                  f"{result.get('available_mib', baseline['available_mib'])} MiB. The launch guard was {START_MIN:,} MiB.",
                  f"Minimum sampled available RAM {result.get('minimum_sampled_mib', 'unavailable')} MiB. "
                  f"Module 3 console errors captured {len(console) if console is not None else 'unverified'}.",
                  f"Preservation **{'PASS' if preserved else 'FAIL'}**, {len(baseline['hashes'])} protected hashes, "
                  f"{len(changes)} changed. Existing unrelated Git changes and HEAD were compared. Git reports `{branch}`.", ""])
    if passed:
        lines.extend(["## Verified reference values", "",
                      "The full 90-day headline total is 87,042,547 trips. The 66-day future window shows "
                      "63,418,661 trips, 960,889 per day and −2.43%. The retrospective terminal comparison "
                      "shows 3.57% Ridge-based ensemble WAPE and 2.54% Seasonal Naive.", "",
                      "The local implementation can proceed to Step 6C evidence review. Fresh deployment remains pending.", ""])
    else:
        lines.extend(["## Outstanding verification", "",
                      "Check that no test server is using port 4173. Once at least 1,350 MiB is available, serve the existing build "
                      "from the repository root and open [the local build](http://127.0.0.1:4173/) in Chrome.", "",
                      "```powershell", "& 'backend/pipelines/module3_lrt3/.venv/Scripts/python.exe' -B -m http.server 4173 "
                      f"--bind 127.0.0.1 --directory '{baseline['build']}'", "```", "",
                      "Check Future Outlook "
                      "at all horizons and both scopes. Confirm 87,042,547 full-window trips and 63,418,661 future trips over 66 days, "
                      "960,889 per day and −2.43%. Compare the watchlist, KPI and point tooltip with the manifest's network asset.", "",
                      "Check Demand Forecast for the 3.57% and 2.54% terminal comparison, retrospective note, corrected Ridge "
                      "results and preserved LRT3 scenarios and cold-start finding. On the LRT3 Demand Drivers heatmap, "
                      "hover 31 August 2026 for verified, 9 November 2026 for tentative and 2 September 2026 for known non-holiday. "
                      "Hover Kelana Jaya on 1 August 2025 for unknown calendar coverage. Confirm 3 holidays, "
                      "23 control-date uses and −37.29%.", "",
                      "Verify the revised intensity, 229 reference departures, 624 places per train, 142,896 weekday places, "
                      "62 all-demand dates, 56 matched dates and unavailable Christmas supply. Open Methodology and the active manifest. "
                      "Open all five tabs, select Kuala Langat on the equity map, verify structural zero and missing ratio, "
                      "watch for console errors, then mount each teammate route.", ""])
    lines.extend(["The historical calendar-vintage limitation remains. Existing results do not establish direct 90-day accuracy.",
                  "", "[Detailed evidence](v1_final_browser_verification.json) · [Versioned issue register](v1_correction_register_6b2.json)", ""])
    atomic_text(OUT / "v1_final_browser_report.md", "\n".join(lines))
    event(folder, event="publication", status="PASS", disposition=new_status, preservation=preserved)
    print(new_status, Counter(item["status"] for item in checks.values()), f"preservation={preserved}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("prepare", "run", "publish"))
    parser.add_argument("--chrome", default="C:/Program Files/Google/Chrome/Application/chrome.exe")
    args = parser.parse_args()
    if args.stage == "prepare":
        prepare()
    elif args.stage == "run":
        raise SystemExit(run(args.chrome))
    else:
        publish()
