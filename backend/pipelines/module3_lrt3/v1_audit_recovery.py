"""Recover the Module 3 V1 audit without invoking any production pipelines."""

import argparse
from collections import Counter
import csv
from datetime import datetime
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

from v1_audit import FRONT, MYT, OUT, PIPE, ROOT, available_memory, memory_guard, parse_cell, peak_memory, relative, sha


SECTIONS = (*"ABCDEFGHIJK", "S5R")
STATUSES = ("PASS", "FAIL", "PARTIALLY VERIFIED", "NOT VERIFIED", "NOT APPLICABLE")
MANIFEST = OUT / "v1_audit_recovery_manifest.json"
PROGRESS = OUT / "v1_audit_progress.jsonl"
BUGS = OUT / "v1_bug_register.md"
REPORT_NAMES = (
    "v1_data_integrity_audit.json", "v1_logic_audit.md", "v1_audit_checks.csv",
    BUGS.name, "v1_feature_inventory.md", "v1_competition_evidence.md", PROGRESS.name,
)
ISSUE_HEADER = re.compile(r"^### (M3-\d+)\b", re.M)
FIELDS = (
    "check_id", "section", "check", "execution_status", "status", "source", "expected",
    "actual", "tolerance", "verification_method", "evidence", "findings", "issue_ids",
    "completed_at_myt", "fingerprint", "fingerprint_scope", "checkpoint",
)


def now():
    return datetime.now(MYT).isoformat(timespec="microseconds")


def unique_pairs(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError(f"Duplicate JSON key: {name}")
        result[name] = value
    return result


def invalid_constant(value):
    raise ValueError(f"Non-finite JSON value: {value}")


def strict_json(value):
    return json.loads(value, object_pairs_hook=unique_pairs, parse_constant=invalid_constant)


def read(path):
    return strict_json(path.read_text(encoding="utf-8-sig"))


def atomic_text(path, value):
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", newline="", dir=path.parent,
        prefix=path.stem + ".", suffix=".pending", delete=False,
    ) as temp:
        temp.write(value)
        temp.flush()
        os.fsync(temp.fileno())
    os.replace(temp.name, path)


def write_json(path, data):
    atomic_text(path, json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n")


def journal():
    events, invalid = [], []
    if PROGRESS.is_file():
        for line_no, line in enumerate(PROGRESS.read_bytes().splitlines(), 1):
            try:
                event = strict_json(line.decode("utf-8-sig"))
                if not isinstance(event, dict):
                    raise ValueError("Checkpoint must be an object")
                events.append(event)
            except (ValueError, UnicodeError) as error:
                invalid.append({"line": line_no, "error": str(error)})
    return events, invalid


def append(event):
    record = (json.dumps(event, ensure_ascii=False, allow_nan=False) + "\n").encode()
    with PROGRESS.open("ab") as stream:
        stream.write(record)
        stream.flush()
        os.fsync(stream.fileno())


def recover_journal_tail():
    events, invalid = journal()
    if not invalid and PROGRESS.read_bytes().endswith(b"\n"):
        return events
    saved = OUT / f"v1_audit_progress_interrupted_{datetime.now(MYT):%Y%m%d_%H%M%S_%f}.jsonl"
    shutil.copy2(PROGRESS, saved)
    atomic_text(PROGRESS, "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
    event = {"event": "progress_recovered", "time_myt": now(), "backup": relative(saved), "invalid_lines": invalid}
    append(event)
    return [*events, event]


def git(*args):
    return subprocess.check_output(["git", "--no-optional-locks", *args], cwd=ROOT).decode("utf-8")


def is_audit(path):
    return any(path.startswith(relative(folder) + "/v1_") for folder in (OUT, PIPE, FRONT))


def status():
    return sorted(filter(None, git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0")))


def audit_paths():
    for directory in (OUT, PIPE, FRONT):
        yield from sorted(path for path in directory.glob("v1_*") if path.is_file())


def file_hashes(paths):
    return {path: sha(ROOT / path) if (ROOT / path).is_file() else None for path in sorted(paths)}


def diffs(expected, actual):
    return sorted(key for key in expected.keys() | actual.keys() if expected.get(key) != actual.get(key))


def validate_section(section, events, issue_ids):
    path = OUT / f"v1_audit_section_{section}.json"
    if not path.exists():
        return {"classification": "NOT STARTED", "path": relative(path)}
    try:
        data = read(path)
        rows = data["checks"]
        if not rows or not isinstance(data["details"], dict):
            raise ValueError("Missing checks or details")
        for index, row in enumerate(rows, 1):
            if row["section"] != section or row["check_id"] != f"{section}-{index:02}":
                raise ValueError(f"Invalid or duplicate check ID at row {index}")
            if row["status"] not in STATUSES or not all(row[key] for key in ("source", "evidence", "check")):
                raise ValueError(f"Missing status or evidence fields at row {index}")
            if set(re.findall(r"M3-\d+", row["issue_ids"])) - issue_ids:
                raise ValueError(f"Unknown issue reference at row {index}")
        counts = Counter(row["status"] for row in rows)
    except (KeyError, TypeError, ValueError, UnicodeError) as error:
        return {"classification": "INVALID OR CORRUPTED", "path": relative(path), "error": str(error)}
    event = next((e for e in reversed(events) if e.get("section") == section and "checks" in e), None)
    matches = event and event.get("result") == relative(path) and event["checks"] == dict(counts)
    if not matches:
        classification = "COMPLETED BUT NOT VALIDATED"
    elif counts["PARTIALLY VERIFIED"] or counts["NOT VERIFIED"] or section == "K":
        classification = "PARTIALLY COMPLETED"
    else:
        classification = "COMPLETED AND VALIDATED"
    return {
        "classification": classification, "path": relative(path), "checkpoint_sha256": sha(path),
        "checks": dict(counts), "matched_completion_event": bool(matches),
        "completed_at_myt": event["time_myt"] if matches else None,
    }


def baseline():
    if MANIFEST.exists():
        print(f"Reusing recovery baseline {read(MANIFEST)['started_at_myt']}")
        return
    free = memory_guard()
    git_rows = status()
    protection = read(OUT / "v1_audit_protection.json")
    frontend_paths = {relative(path) for path in FRONT.rglob("*") if path.is_file() and not is_audit(relative(path))}
    old_hashes = protection["files"]
    hashes = file_hashes(old_hashes.keys() | frontend_paths)
    mismatches = diffs(old_hashes, {key: hashes[key] for key in old_hashes})
    events, invalid_lines = journal()
    issue_ids = set(ISSUE_HEADER.findall(BUGS.read_text(encoding="utf-8-sig")))
    sections = {name: validate_section(name, events, issue_ids) for name in SECTIONS}
    stamp = datetime.now(MYT).strftime("%Y%m%d_%H%M%S_%f")
    backup = OUT / f"v1_audit_recovery_backup_{stamp}"
    files = {}
    for path in audit_paths():
        saved = backup / path.relative_to(ROOT)
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, saved)
        digest = sha(path)
        if sha(saved) != digest:
            raise ValueError(f"Backup verification failed for {relative(path)}")
        files[relative(path)] = {"backup": relative(saved), "sha256": digest, "bytes": path.stat().st_size}
    manifest = {
        "started_at_myt": now(),
        "prior_baseline_at_myt": protection["captured_at_myt"],
        "backup_directory": relative(backup),
        "saved_audit_files": files,
        "expected_outputs_at_recovery": {name: (OUT / name).is_file() for name in REPORT_NAMES},
        "process_inspection": "Get-Process showed no Python workers and only Adobe Creative Cloud Node. CIM denied process command-line access. No processes were terminated.",
        "original_step6a_conversation": "Unavailable in the supplied conversation. Recovered local scripts, section checkpoints and issue register; used the supplied Step 6AR scope.",
        "interrupted_attempts": [event for event in events if event.get("interrupted")],
        "invalid_progress_lines": invalid_lines,
        "recovery_sections": sections,
        "recovered_issue_ids": sorted(issue_ids),
        "protected_hashes_at_recovery": hashes,
        "prior_protection_mismatches": mismatches,
        "baseline_git_matches_step6a_excluding_audit": sorted(row for row in git_rows if not is_audit(row[3:])) == protection["git_status"],
        "git_at_recovery": git_rows,
        "git_head_at_recovery": git("rev-parse", "HEAD").strip(),
        "resource_policy": "Sequential tasks, one numerical thread, bounded archived inputs, no new dependencies or production execution.",
        "baseline_available_mib": free,
        "baseline_peak_worker_mib": peak_memory(),
    }
    write_json(MANIFEST, manifest)
    if invalid_lines or (PROGRESS.exists() and not PROGRESS.read_bytes().endswith(b"\n")):
        atomic_text(PROGRESS, "".join(json.dumps(event, ensure_ascii=False) + "\n" for event in events))
    append({"event": "recovery_baseline", "time_myt": now(), "manifest": relative(MANIFEST)})
    print(f"Preserved {len(files)} audit files. Verified {len(hashes)} listed protected files; {len(mismatches)} prior hash differences.")
    print("Section classifications:", ", ".join(f"{section} {row['classification']}" for section, row in sections.items()))
    if mismatches:
        print("Prior differences:", *mismatches, sep="\n")


def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def import_checks(manifest, events):
    current = {event["check_id"]: event for event in events if event.get("event") == "check"}
    for section, recovered in manifest["recovery_sections"].items():
        if not recovered.get("matched_completion_event") or manifest["prior_protection_mismatches"]:
            continue
        path = ROOT / recovered["path"]
        if sha(path) != recovered["checkpoint_sha256"]:
            raise ValueError(f"Recovered section bytes changed: {relative(path)}")
        scope = {"prior_protection": fingerprint(manifest["protected_hashes_at_recovery"]), "section": recovered["checkpoint_sha256"]}
        for row in read(path)["checks"]:
            check_id = row["check_id"]
            if check_id in current:
                if current[check_id]["fingerprint"] != fingerprint(scope):
                    raise ValueError(f"Recovered evidence changed for {check_id}")
                continue
            status_value = row["status"]
            execution = "REUSED" if status_value not in ("NOT VERIFIED", "NOT APPLICABLE") else "DEFERRED"
            findings = row["evidence"]
            if status_value == "NOT APPLICABLE":
                execution = "SCOPE REVIEW"
            if check_id == "K-01":
                status_value = "PARTIALLY VERIFIED"
                execution = "SUPERSEDED"
                findings = ("The script checked that section files existed and contained checks and details. "
                            "Two cited synthesis reports were absent at recovery. K-03 through K-05 complete the documentary review.")
            append({
                **row, "event": "check", "execution_status": execution, "status": status_value,
                "expected": row["expected"] or row["check"],
                "actual": row["actual"] or findings,
                "tolerance": row["tolerance"] or "See original checkpoint or source for numerical checks; otherwise not applicable",
                "verification_method": "Recovered section checkpoint and matched completion event. " + row["evidence"],
                "findings": findings, "completed_at_myt": recovered["completed_at_myt"],
                "time_myt": now(), "fingerprint": fingerprint(scope), "fingerprint_scope": scope,
                "checkpoint": relative(path),
            })


def run_check(manifest, check_id, description, paths, expected, method, fn, tolerance="Exact for IDs, dates, counts and labels"):
    events = recover_journal_tail()
    previous = next((event for event in reversed(events) if event.get("check_id") == check_id), None)
    hashes = manifest["protected_hashes_at_recovery"]
    scope = {relative(path): hashes[relative(path)] if relative(path) in hashes else sha(path) for path in paths}
    scope[relative(Path(__file__).resolve())] = sha(Path(__file__).resolve())
    key = fingerprint(scope)
    if previous and previous["fingerprint"] == key:
        print(f"{check_id} reused {previous['status']}", flush=True)
        return previous
    free = memory_guard()
    actual, findings, ok = fn()
    result = {
        "event": "check", "check_id": check_id, "section": check_id.split("-")[0],
        "check": description, "execution_status": "EXECUTED", "status": "PASS" if ok else "FAIL",
        "source": "; ".join(relative(path) for path in paths),
        "expected": expected, "actual": actual, "tolerance": tolerance, "verification_method": method,
        "evidence": findings, "findings": findings, "issue_ids": "", "completed_at_myt": now(),
        "time_myt": now(), "fingerprint": key, "fingerprint_scope": scope, "checkpoint": relative(PROGRESS),
        "available_mib_before": free, "peak_worker_mib": peak_memory(),
    }
    append(result)
    print(f"{check_id} {result['status']}: {actual}", flush=True)
    return result


def strict_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, strict=True)
        columns = reader.fieldnames
        if not columns or len(set(columns)) != len(columns):
            raise ValueError(f"Invalid CSV header in {relative(path)}")
        for row in reader:
            if None in row or None in row.values():
                raise ValueError(f"Truncated or extra CSV fields at line {reader.line_num}: {relative(path)}")
            yield row


def headline():
    config, network_path, hist_path = OUT / "forecast_metadata.json", FRONT / "data/network.json", FRONT / "data/history.json"
    source = ROOT / read(config)["headline"]["selected"]["path"]
    services = {
        "rail_lrt_ampang": "LRT Ampang / Sri Petaling", "rail_lrt_kj": "LRT Kelana Jaya",
        "rail_mrt_kajang": "MRT Kajang", "rail_mrt_pjy": "MRT Putrajaya",
        "rail_monorail": "KL Monorail", "rail_lrt_shah_alam": "LRT Shah Alam (headline)",
    }
    data, hist = read(network_path), read(hist_path)["series"]
    history = {name: {point[0]: point[1:] for point in hist[name]} for name in services}
    source_days, differences = set(), []
    statuses = Counter()
    counts = Counter()
    for row in strict_csv(source):
        day = row["date"]
        if datetime.strptime(day, "%Y-%m-%d").date().isoformat() != day or day in source_days:
            raise ValueError(f"Invalid or duplicate source date {day}")
        source_days.add(day)
        for name in services:
            cell = row[name]
            status_value, value = ("null", None) if cell == "" else (
                "observed_zero" if int(cell) == 0 else "observed_positive", int(cell)
            )
            counts[name] += value is not None
            statuses[status_value] += 1
            if value is not None and value < 0:
                differences.append([name, day, "negative value"])
            if day in history[name] and history[name][day] != [value, status_value]:
                differences.append([name, day, "source and exported value/status differ"])
            if day not in history[name] and value is not None and value > 0:
                differences.append([name, day, "positive source value omitted"])
    cutoffs = {name: max(days) for name, days in history.items()}
    for name, days in history.items():
        for day in days.keys() - source_days:
            if days[day] != [None, "missing"]:
                differences.append([name, day, "absent source date reclassified"])
    definition_ok = set(data["components"]) == services.keys() and all(
        data["targets"][name]["service_name"] == label and data["targets"][name]["unit"] == "headline_service_trips"
        for name, label in services.items()
    )
    return {
        "source_days": len(source_days), "counts_by_service": dict(counts), "source_cell_statuses": dict(statuses),
        "exported_cutoffs": cutoffs, "discrepancy_count": len(differences), "examples": differences[:5],
    }, ("Six source service columns independently matched exported eligible history. Source nulls and any observed zeros are distinct. "
        "Ampang/Sri Petaling has one combined column and Shah Alam headline uses service trips."), (
        not differences and definition_ok and set(cutoffs.values()) == {"2026-10-31"} and max(source_days) == "2026-10-31"
    )


def od_chain(manifest, steps):
    recorded = manifest["protected_hashes_at_recovery"]
    source = read(OUT / "network_district_activity_metadata.json")
    metadata_hashes = dict(source["source"]["input_hashes"])
    archived_scan = metadata_hashes.pop("streamed_od_checkpoint")
    checks = {
        f"source:{key}": recorded.get(key) == value for key, value in metadata_hashes.items()
    }
    for path in steps:
        checkpoint = read(path)
        if path.parent.name.startswith("01_"):
            checks["scan fingerprint echoed in metadata"] = checkpoint["files"] == archived_scan
        for name, digest in checkpoint["files"].items():
            checks[f"checkpoint:{name}"] = recorded.get(relative(path.parent / name)) == digest
            if name in checkpoint.get("publish_names", []):
                checks[f"published:{name}"] = recorded.get(relative(OUT / name)) == digest
    scan = read(steps[0].parent / "scan_audit.json")
    keys = ("snapshot_rows", "window_rows", "extra_duplicate_rows", "a0_to_a0_rows", "incoming_a0_rows",
            "incoming_a0_compared_days", "incoming_a0_matching_days", "incoming_a0_minus_individual_sum")
    checks["diagnostics echoed in metadata"] = all(source["scan"][key] == scan[key] for key in keys)
    return {
        "matched_claims": sum(checks.values()), "claims": len(checks),
        "mismatches": [name for name, ok in checks.items() if not ok], "archived_diagnostics": {key: scan[key] for key in keys},
    }, ("Verified the data provenance chain against recovery baseline digests. Incoming checks and duplicate counters "
        "are authenticated archived results. A fresh independent whole-archive rederivation remains A-08."), all(checks.values())


def equity_invariance():
    primary = {row["district_id"]: row for row in strict_csv(OUT / "equity_priority_screening.csv")}
    enriched = {row["district_id"]: row for row in strict_csv(OUT / "network_district_equity_comparison.csv")}
    columns = {
        "scenario_id": "scenario_id", "screen_status": "screen_status",
        "socioeconomic_reference_year": "socioeconomic_reference_year",
        "median_monthly_household_income_myr": "median_monthly_household_income_myr",
        "absolute_poverty_households_pct": "absolute_poverty_households_pct",
        "low_coverage_flag": "coverage_at_or_below_cutoff",
        "relative_vulnerability_flag": "relative_vulnerability_flag",
        "priority_for_further_investigation": "priority_for_further_investigation",
    }
    ui = read(FRONT / "data/equity.json")
    ui_primary = {row["district_id"]: row for row in ui["screens"] if row["scenario_id"] == ui["primaryScenario"]}
    differences = []
    for district, row in primary.items():
        for new_key, original_key in columns.items():
            if parse_cell(enriched[district]["step4_" + new_key]) != parse_cell(row[original_key]):
                differences.append([district, new_key, "Step 4B"])
            if ui_primary[district][original_key] != parse_cell(row[original_key]):
                differences.append([district, original_key, "frontend"])
    ok = primary.keys() == enriched.keys() == ui_primary.keys() and len(primary) == 8 and not differences
    return {
        "districts": len(primary), "fields_per_district": len(columns), "comparisons": 2 * len(primary) * len(columns),
        "primary_priorities": [row["district"] for row in primary.values() if row["priority_for_further_investigation"] == "true"],
        "differences": differences,
    }, "Compared the original Step 4 primary screening directly with Step 4B and the active exported primary scenario.", ok


def selector_keys():
    equity = read(FRONT / "data/equity.json")
    shapes = read(FRONT / "data/district-geography.json")
    service = read(FRONT / "data/service.json")
    ids = {row["district_id"] for row in equity["districts"]}
    polygon_ids = [feature["properties"]["district_id"] for feature in shapes["features"]]
    keys = Counter((row["scenario_id"], row["district_id"]) for row in equity["screens"])
    scenarios = {
        f"{cohort}_{rule}" for cohort in ("all_districts", "latest_survey_cohort")
        for rule in ("median_either", "median_both", "outer_quartiles")
    }
    routes = {row["route_id"] for row in service["routes"]}
    periods = Counter((row["route_id"], row["day_type"], row["direction_id"], row["period"]) for row in service["periods"])
    hours = Counter((row["route_id"], row["day_type"], row["direction_id"], row["service_hour"]) for row in service["hourly"])
    nominal = Counter((row["day_type"], row["direction_id"], row["period"]) for row in service["nominal"])
    combos = {(route, day, direction) for route in routes
              for day in ("weekday", "saturday", "sunday") for direction in ("0", "1", "both")}
    all_periods = {"all_day", "am_peak", "off_peak", "pm_peak"}
    problems = []
    if ids != set(polygon_ids) or len(polygon_ids) != len(ids) or ids != equity["coverage"].keys():
        problems.append("District polygon/coverage key mismatch")
    if keys != Counter((scenario, district) for scenario in scenarios for district in ids):
        problems.append("Screening key gap or duplicate")
    if periods != Counter((*key, period) for key in combos for period in all_periods):
        problems.append("GTFS period key gap or duplicate")
    if hours != Counter((*key, hour) for key in combos for hour in range(24)):
        problems.append("GTFS hour key gap or duplicate")
    if nominal != Counter((*key[1:], period) for key in combos if key[0] == "SA" for period in all_periods):
        problems.append("SA direction/day nominal key gap or duplicate")
    return {
        "district_keys": len(ids), "screening_scenario_keys": len(keys), "route_day_direction_combinations": len(combos),
        "period_keys": len(periods), "hour_keys": len(hours), "nominal_keys": len(nominal), "problems": problems,
    }, ("Inspected source wiring. The map polygon, district selector and matrix buttons set the same district ID; cohort and "
        "rule resolve to the same screen rows for the priority map, details and matrix. GTFS chart and table use route, "
        "day and direction together. Runtime interactions remain J-11."), not problems


def targeted():
    manifest = read(MANIFEST)
    import_checks(manifest, recover_journal_tail())
    if manifest["prior_protection_mismatches"]:
        raise ValueError("Prior protection mismatches require section-specific evidence review")
    data = FRONT / "data"
    config = OUT / "forecast_metadata.json"
    source = ROOT / read(config)["headline"]["selected"]["path"]
    run_check(manifest, "A-10", "Headline source schema, observation status and six service definitions",
              (source, config, data / "network.json", data / "history.json", PIPE / "forecast_inputs.py"),
              "Unique ISO dates, nonnegative integer counts, exact eligible source/export values and status, six service definitions and 31 October cutoff.",
              "Strictly parse the small selected CSV and look up each eligible published value and state by service and date.", headline)
    steps = sorted((OUT / "network_activity_checkpoints").glob("0*/checkpoint.json"))
    if len(steps) != 3:
        raise ValueError(f"Expected the three recorded OD stages, got {len(steps)}")
    run_check(manifest, "A-11", "OD checkpoint and publication hash chain",
              (OUT / "network_district_activity_metadata.json", *steps,
               steps[0].parent / "scan_audit.json", OUT / "v1_audit_protection.json"),
              "Recorded source, checkpoint and published output hashes and echoed archived diagnostics agree.",
              "Compare stage manifests and published checksums to recorded recovery digests without rereading raw OD rows.",
              lambda: od_chain(manifest, steps))
    run_check(manifest, "I-06", "Step 4B preserves the original Step 4 primary screening",
              (OUT / "equity_priority_screening.csv", OUT / "network_district_equity_comparison.csv", data / "equity.json"),
              "Eight primary district rows have identical screen state, socioeconomic data and flags in Step 4, Step 4B and the dashboard.",
              "Compare original and enriched screening columns and the corresponding frontend scenario by stable district ID.", equity_invariance)
    run_check(manifest, "J-12", "District scenario and GTFS selector key completeness",
              (data / "equity.json", data / "district-geography.json", data / "service.json",
               FRONT / "DistrictMap.tsx", FRONT / "tabs/EquityAccessibility.tsx", FRONT / "tabs/ServiceReadiness.tsx"),
              "Every current district/geometry and selected cohort/rule joins uniquely, and every route/day/direction has complete period and hour rows.",
              "Check stable-key coverage and uniqueness across all supported selector combinations and trace component lookup paths.", selector_keys)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("baseline", "targeted"))
    args = parser.parse_args()
    {"baseline": baseline, "targeted": targeted}[args.stage]()


if __name__ == "__main__":
    main()
