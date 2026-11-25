"""Step 6B baseline, correction plan, and durable progress records."""

import argparse
import csv
from datetime import datetime
import json
import os
import re
import shutil

from v1_audit import FRONT, MYT, OUT, PIPE, ROOT, available_memory, relative, sha
from v1_audit_recovery import MANIFEST, REPORT_NAMES, git, now, read, status, strict_csv, strict_json, write_json

PROGRESS = OUT / "v1_fix_progress.jsonl"
REGISTER = OUT / "v1_correction_register.json"
EXISTING_CHANGES = {
    PIPE / "export_dashboard.py": "Use a versioned calendar correction, prediction date counts and experiment context in the existing export.",
    FRONT / "analytics.ts": "Use an explicit supply allowlist and matched proxy cohorts, and share the future-date predicate.",
    FRONT / "contracts.ts": "Define the corrected calendar, provenance and research fields.",
    FRONT / "dataClient.ts": "Validate corrected asset contracts and reject invalid scenario data.",
    FRONT / "equityMetrics.ts": "Derive numeric legend ranges and period captions from data.",
    FRONT / "Methodology.tsx": "Show archived calendar provenance and the versioned presentation data.",
    FRONT / "tabs/FutureOutlook.tsx": "Scope fixed watchlist evidence and classify the reference date once.",
    FRONT / "tabs/DemandForecast.tsx": "Label scored pairs, expose distinct dates and explain experiment design and historical calendar limitations.",
    FRONT / "tabs/DemandDrivers.tsx": "Present confirmed holiday comparisons, calendar evidence and the five-service ablation.",
    FRONT / "tabs/ServiceReadiness.tsx": "Render matched proxy and nominal supply separately, with independent all-date demand.",
    FRONT / "tabs/EquityAccessibility.tsx": "Derive cohort, population and period captions.",
    **{FRONT / "data" / name: reason for name, reason in {
        "patterns.json": "Version confirmed holiday contrasts and archived calendar evidence.",
        "service.json": "Expose holiday provenance and allow only covered ordinary reference dates.",
        "methodology.json": "Derive jurisdiction attribution and document the preserved forecasting caveat.",
        "research.json": "Attach exact unique-date counts and archived experiment metadata.",
        "manifest.json": "Record the changed asset digests, source hashes and data revision.",
    }.items()},
}
ORDER = ("M3-02", "M3-08", "M3-09", "M3-01", "M3-05", "M3-06", "M3-07", "M3-03", "M3-04", "M3-11", "M3-10", "M3-12")
PLAN = {
    "M3-02": ("Base calendar collapses tentative and confirmed dates.", "export_dashboard.py; v1_calendar_corrections.py; DemandDrivers.tsx; DemandForecast.tsx", "patterns.json; service.json; methodology.json; versioned calendar evidence", "Publish confirmed-only matched comparisons, preserve explicit status across the export and report the frozen Ridge dependency."),
    "M3-08": ("Source attribution is a jurisdiction literal.", "export_dashboard.py; Methodology.tsx", "methodology.json", "Generate the label from extracted calendar rows."),
    "M3-09": ("All statuses except one holiday sentinel count as available.", "analytics.ts; contracts.ts; dataClient.ts; ServiceReadiness.tsx", "service.json", "Allowlist ordinary and held reference statuses, and handle unknown or future enum values as unavailable."),
    "M3-01": ("Proxy mean is computed before date eligibility while demand and places share an axis.", "analytics.ts; ServiceReadiness.tsx", "No daily demand or timetable change", "Pair dates in the comparison and expose all-date demand separately."),
    "M3-05": ("Pooled scored_predictions field is labeled as calendar days.", "export_dashboard.py; DemandForecast.tsx; DemandDrivers.tsx", "research.json", "Label scored pairs and derive unique dates and verified origins from prediction records."),
    "M3-06": ("Archived window and holdout metadata do not reach the comparison panels.", "export_dashboard.py; DemandForecast.tsx", "research.json", "Expose the boundary, matched folds, unchanged policy, unequal histories and retrospective holdout."),
    "M3-07": ("Default network choice looks only for a per-target experiment.", "DemandDrivers.tsx; analytics.ts", "No component scores change", "Add the unweighted service mean per selected horizon and explain the feature bundle."),
    "M3-03": ("Ranking carries a fixed assessment without its horizon.", "FutureOutlook.tsx", "No watchlist numbers change", "Label fixed 90-lead evidence wherever it appears."),
    "M3-04": ("Two inclusive predicates share the reference date.", "analytics.ts; FutureOutlook.tsx; DemandForecast.tsx", "No forecast points change", "Share the strict future predicate."),
    "M3-11": ("A shallow scenario guard permits a silent nullish fallback.", "dataClient.ts; DemandForecast.tsx", "No archived scenarios change", "Validate ordered complete keys, values and leads against published OD. Remove the fallback."),
    "M3-10": ("Rounded boundary text differs from discrete bin membership.", "equityMetrics.ts", "No district values change", "Use integer cutoffs and matching ranges for station counts."),
    "M3-12": ("Captions use hardcoded days, years and sample sizes.", "equityMetrics.ts; EquityAccessibility.tsx", "No district values or cohort rules change", "Derive observation, population and cohort captions from the selected asset."),
}


def guard(operation, minimum=750):
    free = available_memory()
    if free is None or free < minimum:
        note("resource_guard", operation=operation, status="BLOCKED", free_mib=free, minimum_mib=minimum)
        raise SystemExit(f"{operation} needs {minimum} MiB available before launch; measured {free} MiB")
    return free


def note(event, **fields):
    data = (json.dumps({"event": event, "time_myt": now(), **fields}, allow_nan=False, ensure_ascii=False) + "\n").encode()
    with PROGRESS.open("ab") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def journal():
    events, invalid = [], []
    if not PROGRESS.is_file():
        return events, invalid
    for number, line in enumerate(PROGRESS.read_bytes().splitlines(), 1):
        try:
            events.append(strict_json(line.decode("utf-8")))
        except (ValueError, UnicodeError):
            invalid.append(number)
    return events, invalid


def repair_progress():
    events, invalid = journal()
    if not PROGRESS.exists() or (not invalid and PROGRESS.read_bytes().endswith(b"\n")):
        return
    from v1_audit_recovery import atomic_text
    saved = PROGRESS.with_name(f"v1_fix_progress_interrupted_{datetime.now(MYT):%Y%m%d_%H%M%S_%f}.jsonl")
    shutil.copy2(PROGRESS, saved)
    atomic_text(PROGRESS, "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
    note("journal_recovered", archived=relative(saved), invalid_lines=invalid)


def issue_data():
    text = (OUT / "v1_bug_register.md").read_text(encoding="utf-8-sig")
    result = {}
    severity = None
    current = None
    for line in text.splitlines():
        if line.startswith("## "):
            severity = line[3:].upper()
        match = re.match(r"^### (M3-\d+) · (.+)$", line)
        if match:
            current = result[match[1]] = {"title": match[2], "severity": severity, "original_issue": {}}
        if current and line.startswith("| ") and " | " in line[2:]:
            field, value = line.strip("| ").split(" | ", 1)
            if field != "Field":
                current["original_issue"][field] = value
    if set(result) != set(ORDER):
        raise ValueError("Correction plan does not cover the original issue IDs")
    return result


def baseline():
    repair_progress()
    if REGISTER.exists():
        print("Resuming", read(REGISTER)["backup_directory"])
        return
    free = guard("Step 6B baseline")
    audit = read(MANIFEST)
    paths = dict(audit["protected_hashes_at_recovery"])
    evidence = {}
    for name in (*REPORT_NAMES, MANIFEST.name):
        path = OUT / name
        value = sha(path)
        evidence[relative(path)] = value
        if name in audit["final_preservation"]["audit_output_sha256"] and value != audit["final_preservation"]["audit_output_sha256"][name]:
            raise ValueError(f"Step 6AR evidence changed: {name}")
        paths[relative(path)] = value
    for folder in (PIPE, OUT):
        for path in folder.glob("v1_audit*"):
            if path.is_file():
                paths.setdefault(relative(path), sha(path))
    recovered = read(OUT / "v1_data_integrity_audit.json")
    check_rows = list(strict_csv(OUT / "v1_audit_checks.csv"))
    journal_rows = [strict_json(line) for line in (OUT / "v1_audit_progress.jsonl").read_text(encoding="utf-8").splitlines()]
    for name in ("v1_logic_audit.md", "v1_feature_inventory.md", "v1_competition_evidence.md"):
        if not (OUT / name).read_text(encoding="utf-8").strip():
            raise ValueError(f"Missing audit narrative: {name}")
    matches = {key: sha(ROOT / key) for key in paths}
    mismatch = [key for key, expected in paths.items() if matches[key] != expected]
    if mismatch:
        raise ValueError(f"Step 6AR protection mismatch: {mismatch}")
    git_rows = status()
    backup = OUT / f"v1_fix_backup_{datetime.now(MYT):%Y%m%d_%H%M%S_%f}"
    originals = {}
    for path, reason in EXISTING_CHANGES.items():
        original = backup / relative(path)
        original.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, original)
        digest = sha(original)
        if paths[relative(path)] != digest:
            raise ValueError(f"Destination backup mismatch: {relative(path)}")
        originals[relative(path)] = {"path": relative(original), "sha256": digest, "reason": reason}
    old_issues = issue_data()
    issues = []
    for order, issue_id in enumerate(ORDER, 1):
        cause, files, outputs, fix = PLAN[issue_id]
        issue = old_issues[issue_id]
        related = [row for row in check_rows if issue_id in row["issue_ids"].split("|") or issue_id in row["issue_ids"]]
        issues.append({"issue_id": issue_id, "dependency_order": order, **issue,
                       "root_cause": cause, "planned_production_files": files, "affected_analytical_outputs": outputs,
                       "required_fix": fix, "regression": issue["original_issue"]["Regression"],
                       "original_check_ids": [row["check_id"] for row in related],
                       "before": [row["actual"] or row["evidence"] for row in related],
                       "status": "NOT RESOLVED"})
    write_json(REGISTER, {
        "started_at_myt": now(), "backup_directory": relative(backup), "preserved_originals": originals,
        "audit_evidence_sha256": evidence, "baseline_sha256": paths, "git_status_at_start": git_rows,
        "git_head_at_start": git("rev-parse", "HEAD").strip(), "baseline_check_counts": recovered["check_status_counts"],
        "audit_journal_records_read": len(journal_rows), "issues": issues,
    })
    note("baseline", status="PASS", protected_files=len(paths), backed_up=len(originals), free_mib=free,
         process_inspection="Get-Process found no Python, Node build or Vite worker; only Adobe Creative Cloud's Node.")
    note("before_fixture", status="PASS", issues=["M3-09"], detail="Pre-edit actual frontend helper reproduced 18,720 and 17,784 nominal places for unknown calendar.")
    print(f"Protected {len(paths)} baseline files and backed up {len(originals)} planned edits. Available RAM {free} MiB.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("baseline", "note", "guard"))
    parser.add_argument("name", nargs="?")
    parser.add_argument("detail", nargs="?")
    args = parser.parse_args()
    if args.stage == "baseline":
        baseline()
    elif args.stage == "note":
        repair_progress()
        note(args.name, **json.loads(args.detail or "{}"))
    else:
        print(f"{guard(args.name, int(args.detail or 750))} MiB available")


if __name__ == "__main__":
    main()
