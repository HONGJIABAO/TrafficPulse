"""Validate the released calendar revision and publish its disposition."""

from collections import Counter, defaultdict
import csv
from datetime import date, timedelta
import io
import json
from math import isclose, sqrt
from statistics import mean

from v1_audit import FRONT, OUT, PIPE, ROOT, asset, peak_memory, relative, sha
from v1_audit_forecast import history
from v1_audit_recovery import atomic_text, git, now, read, status, write_json
from v1_calendar_dependency import BASELINE, MODEL_OUTPUTS, PREDICTIONS, REVISION, guard, load_journal, note
from v1_fix_regression import data_integrity, holiday_regression


NET = "rapid_rail_published_sum"
OD = "lrt3_station_origin_od"
RIDGE = "calendar_lag_ridge"
FIELDS = ("series_id", "phase", "model_id", "training_policy")
DAY = timedelta(days=1)


def prior(name):
    path = relative(FRONT / "data" / f"{name}.json")
    return read(ROOT / read(BASELINE)["production_originals"][path]["backup"])


def close(actual, expected):
    assert isclose(actual, expected, rel_tol=1e-11, abs_tol=1e-7), (actual, expected)


def metric_check():
    corrected = read(OUT / PREDICTIONS)
    output = read(OUT / MODEL_OUTPUTS)
    original = prior("research")["metrics"]
    groups = defaultdict(list)
    for row in corrected["step2"]:
        groups[tuple(row[key] for key in FIELDS)].append(row)
    active = asset("research")["metrics"]
    count = 0
    for old, current in zip(original, active, strict=True):
        group = groups.get(tuple(old[key] for key in FIELDS))
        if group is None:
            assert old == current
            continue
        horizon = current["horizon_days"]
        predictions = [row for row in group if row["lead_day"] <= horizon]
        pairs = [row for row in predictions if row["actual_trips"] is not None]
        values = [abs(row["actual_trips"] - row["forecast_trips"]) for row in pairs]
        denominator = sum(abs(row["actual_trips"]) for row in pairs)
        mape = [value / abs(row["actual_trips"]) for row, value in zip(pairs, values)
                if row["actual_trips"] != 0]
        assert current["scored_predictions"] == len(pairs) == old["scored_predictions"]
        assert current["unique_target_dates"] == len({row["date"] for row in pairs}) == old["unique_target_dates"]
        assert current["folds"] == len({row["origin"] for row in predictions}) == old["folds"]
        close(current["mae"], mean(values))
        close(current["rmse"], sqrt(mean(value * value for value in values)))
        close(current["wape_pct"], 100 * sum(values) / denominator)
        close(current["mape_pct"], 100 * mean(mape))
        if current["seasonal_naive_wape_pct"] is not None:
            close(current["wape_improvement_pp_vs_seasonal_naive"], current["seasonal_naive_wape_pct"] - current["wape_pct"])
        count += 1
    assert count == 76 and len(active) == 226 and len(corrected["step2"]) == 3178
    terminal = output["terminal_14_day"]
    assert round(terminal["bottom_up_selected_components"], 2) == 3.57
    assert round(terminal["bottom_up_seasonal_naive_7"], 2) == 2.54
    assert all(row["retained_family"] == row["original_rule_winner_on_replay"] for row in output["fixed_model_selection"].values())
    return {"rescored_metric_rows": count, "unchanged_rows": len(active) - count, "corrected_14_day": terminal,
            "retained_original_model_winners": 7}


def weekday_baselines(observed):
    result = defaultdict(list)
    cutoff = max(observed)
    for when, value in observed.items():
        if when >= cutoff - timedelta(days=27) and value is not None:
            result[when.weekday()].append(value)
    assert set(result) == set(range(7))
    return {day: mean(values) for day, values in result.items()}


def network_check():
    active, previous = asset("network"), prior("network")
    components = active["components"]
    assert len(components) == 6 and active["asOf"] == "2026-11-24"
    daily = active["daily"]
    for index, (when, trips, lead) in enumerate(daily[NET]):
        assert all(daily[key][index][0] == when and daily[key][index][2] == lead for key in components)
        close(trips, sum(daily[key][index][1] for key in components))
    assert daily[OD] == previous["daily"][OD] and active["scenarios"] == previous["scenarios"]
    prior_keys = {(row["series_id"], row["horizon"], row["scope"]): row for row in previous["outlook"]}
    profiles = {key: weekday_baselines(value) for key, value in history().items()}
    for key, points in daily.items():
        cutoff = date.fromisoformat(active["targets"][key]["data_cutoff"])
        assert [(date.fromisoformat(day), lead) for day, _, lead in points] == [(cutoff + lead * DAY, lead) for lead in range(1, 91)]
        assert all(value >= 0 for _, value, _ in points)
    windows = active["outlook"]
    assert len(windows) == len(prior_keys) == 48
    for row in windows:
        key, horizon, scope = (row[name] for name in ("series_id", "horizon", "scope"))
        part = [item for item in daily[key][:horizon] if scope == "full" or item[0] > active["asOf"]]
        assert (row["start"], row["end"], row["days"]) == (part[0][0], part[-1][0], len(part))
        total = sum(item[1] for item in part)
        average = total / len(part)
        recent = mean(profiles[key][date.fromisoformat(item[0]).weekday()] for item in part)
        for label, value in (("total", total), ("average", average), ("baseline", recent), ("delta", average - recent),
                             ("change_pct", 100 * (average / recent - 1))):
            close(row[label], value)
        prior_keys.pop((key, horizon, scope))
    assert not prior_keys
    future = next(row for row in windows if (row["series_id"], row["horizon"], row["scope"]) == (NET, 90, "future"))
    return {"windows": len(windows), "daily_coherence": 90, "future_90": future, "unchanged_OD": True}


def watchlist_check():
    network, research = asset("network"), asset("research")
    revision = read(OUT / MODEL_OUTPUTS)
    assert network["watchlist"] == revision["network"]["watchlist"]
    rules = network["watchRules"]
    for row in network["watchlist"]:
        key = row["series_id"]
        scope = "full" if row["view"] == "full_90_day" else "future"
        window = next(item for item in network["outlook"] if (item["series_id"], item["horizon"], item["scope"]) == (key, 90, scope))
        assert (row["forecast_start"], row["forecast_end"], row["forecast_days"]) == (window["start"], window["end"], window["days"])
        close(row["forecast_total_trips"], window["total"])
        close(row["forecast_mean_daily_trips"], window["average"])
        close(row["change_pct"], window["change_pct"])
        close(row["signed_change_trips_per_day"], window["delta"])
        metric = next(item for item in research["metrics"] if (item["series_id"], item["phase"], item["model_id"], item["horizon_days"])
                      == (key, "rolling_validation", row["selected_model"], 28))
        means = [mean(value for day, value in points if row["forecast_start"] <= day <= row["forecast_end"])
                 for name, points in research["alternatives"].items() if name.startswith(f"{key}|full_eligible_history|")]
        assert len(means) == 3
        spread = 100 * (max(means) - min(means)) / window["baseline"]
        loss = metric["wape_pct"] - metric["seasonal_naive_wape_pct"]
        close(row["rolling_28d_wape_pct"], metric["wape_pct"])
        close(row["rolling_28d_deficit_vs_naive_pp"], loss)
        close(row["candidate_mean_spread_pct_of_recent"], spread)
        flags = [reason for reason, value, threshold in (
            ("rolling_28d_wape", metric["wape_pct"], rules["rolling_28d_wape_pct"]),
            ("rolling_28d_naive_deficit", loss, rules["rolling_28d_naive_deficit_pp"]),
            ("candidate_forecast_spread", spread, rules["candidate_mean_spread_pct"]),
        ) if value >= threshold]
        assert row["uncertainty_reasons"] == ("|".join(flags) or "none") and row["watch_uncertainty"] == bool(flags)
        threshold = rules["material_change_pct"]
        assert row["material_change"] == ("increase" if window["change_pct"] >= threshold
                                          else "decrease" if window["change_pct"] <= -threshold else "within_threshold")
    return {"verified_watch_rows": len(network["watchlist"]), "fixed_assessment": "Full 90 leads and strict future slice"}


def intensity_check():
    network, service = asset("network"), asset("service")
    old = prior("service")
    assert {key: value for key, value in service.items() if key not in ("intensity", "forecastRevision")} == {
        key: value for key, value in old.items() if key != "intensity"}
    periods = {(row["route_id"], row["day_type"]): row["reference_departures"] for row in service["periods"]
               if row["period"] == "all_day" and row["direction_id"] == "both"}
    dates = {row["date"]: row for row in service["calendar"]}
    profiles = {key: weekday_baselines(value) for key, value in history().items()}
    for row in service["intensity"]:
        key = row["series_id"]
        points = [point for point in network["daily"][key] if point[0] > network["asOf"]]
        supported = [(day, value) for day, value, _ in points if dates[day]["supply_status"] in
                     ("ordinary_day_GTFS_reference", "reference_held_beyond_GTFS_validity")]
        assert len(supported) == row["calendar_comparable_days"]
        close(mean(point[1] for point in points), row["forecast_average_daily_trips"])
        if row["route_ids"] == "AG|PH":
            assert row["forecast_published_trips_per_reference_departure"] is None
        else:
            denominator = sum(periods[row["route_ids"], dates[day]["day_type"]] for day, _ in supported)
            baseline = sum(profiles[key][date.fromisoformat(day).weekday()] for day, _ in supported)
            trips = sum(value for _, value in supported)
            for field, expected in (("reference_departures_total", denominator), ("paired_forecast_published_trips", trips),
                                    ("forecast_published_trips_per_reference_departure", trips / denominator),
                                    ("recent_published_trips_per_same_reference_departure", baseline / denominator),
                                    ("change_in_trips_per_departure_pct", 100 * (trips / baseline - 1))):
                close(row[field], expected)
    return {"headline_rows": len(service["intensity"]), "unchanged_supply_definition": True, "shared_trunk": None}


def research_check():
    revised, archived = asset("research"), prior("research")
    for key in ("ablation", "cold", "coldFolds", "uncertainty", "experimentContext"):
        assert revised[key] == archived[key]
    changed_alternatives = {key for key, points in revised["alternatives"].items() if points != archived["alternatives"][key]}
    assert changed_alternatives and all(key.endswith(f"|{RIDGE}") for key in changed_alternatives)
    active = read(OUT / MODEL_OUTPUTS)
    assert sum(active["stability_changes_by_phase"].values()) == 51
    assert revised["uncertainty"]["holdout_inside"] == 6 and revised["uncertainty"]["holdout_points"] == 14
    saved = read(OUT / "v1_calendar_ridge_sensitivity_6b.json")
    for scope, field in (("full", "network_90_day_delta"), ("future", "network_future_only_delta")):
        close(active["totals_comparison"][scope]["trip_delta"], saved[field])
    return {"changed_candidate_traces": len(changed_alternatives), "replayed_stability_rows": 51,
            "donor_ablation_empirical_band_identical": True, "fixed_sensitivity_matches": True}


def asset_check():
    manifest = asset("manifest")
    assert manifest["dataRevision"] == REVISION and len(manifest["assets"]) == 8
    for name, info in manifest["assets"].items():
        path = FRONT / "data" / name
        assert path.stat().st_size == info["bytes"] and sha(path) == info["sha256"]
        content = read(path)
        assert content["schemaVersion"] == 1
        if name in ("network.json", "service.json", "research.json", "methodology.json"):
            assert content["forecastRevision"] == REVISION
    for name, token in manifest["inputSha256"].items():
        assert sha(OUT / name) == token
    out, methodology = read(OUT / MODEL_OUTPUTS), asset("methodology")
    assert methodology["outcomes"]["selectedNetworkWape"] == out["terminal_14_day"]["bottom_up_selected_components"]
    text = " ".join(item for section in methodology["sections"] for item in section["text"])
    assert "Historical release and revision vintages are unavailable" in text and "already been inspected" in text
    return {"manifest_sources": len(manifest["inputSha256"]), "runtime_assets": 9, "revision": REVISION}


def regressions():
    guard("Independent analytical regression")
    cases = [
        ("CAL-01", "Corrected descriptive holidays and provenance", "Eight contrasts, LRT3 3 holidays, 23 control-date uses, −37.29%", holiday_regression),
        ("CAL-02", "Matched origins, metrics and original family comparison", "76 rescored rows, 150 unchanged and 3.57% vs 2.54% terminal", metric_check),
        ("CAL-03", "48 windows, cutoffs, coherence and independently matched baselines", "90 coherent headline dates and 48 consistent windows", network_check),
        ("CAL-04", "Revised watchlist thresholds, spread and scope", "12 rows aligned to corrected lead window and candidate data", watchlist_check),
        ("CAL-05", "Revised service intensity with preserved dated GTFS", "Six rows, unchanged denominator, unavailable AG/PH", intensity_check),
        ("CAL-06", "Preserved research and independent sensitivity references", "51 replays, retained ablation, donor and OD results", research_check),
        ("CAL-07", "All asset version markers, provenance and source checksums", "9 assets using one manifest revision", asset_check),
        ("CAL-08", "Protected published OD totals and zero handling", "112 days, 18,592 origin-days, 166 codes, 157 facilities and 20 stations", data_integrity),
    ]
    fails = 0
    for test_id, name, expected, test in cases:
        try:
            actual = test()
            result = "PASS"
        except Exception as error:
            import traceback
            actual = traceback.format_exc()
            result = "FAIL"
            fails += 1
        note("regression", test_id=test_id, name=name, expected=expected, actual=actual, status=result,
             method="Independent matching and recomputation against protected processed sources and the active assets",
             tolerance="Exact for keys, dates and counts; 1e-7 absolute and 1e-11 relative for calculated floats except where the original test specifies stricter tolerance",
             peak_worker_mib=peak_memory())
        print(f"{test_id} {result} {actual}", flush=True)
    if fails:
        raise SystemExit(1)


def protected_changes():
    baseline = read(BASELINE)
    original = baseline["production_originals"]
    changed = []
    for name, token in baseline["hashes"].items():
        actual = sha(ROOT / name)
        if actual == token:
            continue
        assert name in original, f"Unauthorized original file changed: {name}"
        item = original[name]
        changed.append({"path": name, "before": token, "after": actual, **item})
    for name, item in original.items():
        assert sha(ROOT / item["backup"]) == item["sha256"] == baseline["hashes"][name]
    outside = lambda rows: [row for row in rows if not any(row[3:].startswith(relative(folder) + "/")
                                                         for folder in (FRONT, OUT, PIPE))]
    assert outside(status()) == outside(baseline["git"])
    assert git("rev-parse", "HEAD").strip() == baseline["head"]
    return {"baseline_files": len(baseline["hashes"]), "edits": changed, "existing_outside_git_unchanged": True,
            "head_unchanged": True, "backups": baseline["backups"], "branch": git("status", "--short", "--branch").splitlines()[0]}


def exports_in_build(result):
    folder = ROOT / result["folder"] / "dist"
    assert (folder / "index.html").is_file()
    manifest = asset("manifest")
    assets = []
    for name in sorted({"manifest.json", *manifest["assets"]}):
        path = FRONT / "data" / name
        matches = list((folder / "assets").glob(f"{path.stem}-*.json"))
        assert len(matches) == 1 and sha(matches[0]) == sha(path)
        assets.append(relative(matches[0]))
    return assets


def finish():
    free = guard("Streamed hash verification and report publication", 700)
    replay = read(OUT / MODEL_OUTPUTS)
    events = load_journal()
    tests = [item for item in events if item["event"] in ("regression", "system", "browser_check")]
    latest = {item["test_id"]: item for item in tests}
    assert all(latest[f"CAL-{i:02}"]["status"] == "PASS" for i in range(1, 10))
    system = {key: latest.get(key, {"status": "NOT RUN"}) for key in ("typescript-app", "typescript-node", "build", "browser")}
    built = exports_in_build(system["build"]) if system["build"]["status"] == "PASS" else []
    browser_scoped = all(latest.get(f"CH-{i:02}", {}).get("status") == "PASS" for i in range(1, 6))
    passed = (all(item["status"] == "PASS" for item in system.values()) and browser_scoped
              and system["browser"].get("folder") == system["build"].get("folder"))
    disposition = "RESOLVED AND VERIFIED" if passed else "FIXED BUT NOT FULLY VERIFIED"
    preservation = protected_changes()
    register = read(OUT / "v1_correction_register.json")
    versions = []
    for issue in register["issues"]:
        if issue["issue_id"] == "M3-02":
            issue = issue | {"previous_status": issue["status"], "status": disposition,
                             "forecast_revision": REVISION, "disposition": "A", "verified_check_ids": sorted(latest),
                             "latest_resolution": "Activate the fixed verified-only revision with matching rolling and retrospective terminal evidence. Historical vintages remain scientifically unverified."}
        versions.append(issue)
    issue_counts = dict(Counter(row["status"] for row in versions))
    write_json(OUT / "v1_correction_register_6b1.json", {"revision": REVISION, "previous": "v1_correction_register.json",
               "completed_myt": now(), "issues": versions, "status_counts": issue_counts})
    write_json(OUT / "v1_calendar_dependency_resolution.json", {
        "revision": REVISION, "option": "A", "issue_id": "M3-02", "status": disposition,
        "completed_myt": now(), "policy": replay["policy"], "analysis_artifact": MODEL_OUTPUTS, "prediction_artifact": PREDICTIONS,
        "forecast_totals": replay["totals_comparison"], "terminal_14_day": replay["terminal_14_day"],
        "regressions": {name: item["status"] for name, item in latest.items()},
        "system": system, "built_assets": built, "fresh_deployment": "PENDING",
        "preservation": preservation, "resource": {"peak_python_mib": max((item.get("peak_worker_mib") or 0 for item in events), default=0)},
    })
    csv_stream = io.StringIO(newline="")
    fields = ("test_id", "event", "status", "name", "expected", "actual", "method", "tolerance", "log", "time_myt")
    writer = csv.DictWriter(csv_stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for item in tests:
        writer.writerow({field: json.dumps(item[field], ensure_ascii=False) if isinstance(item.get(field), (dict, list)) else item.get(field, "")
                         for field in fields})
    atomic_text(OUT / "v1_calendar_dependency_regression.csv", csv_stream.getvalue())
    report = OUT / "v1_calendar_dependency_report.md"
    heading = "## Local system and final disposition"
    main = report.read_text(encoding="utf-8").split(heading, 1)[0].rstrip()
    lines = [heading, "", f"**M3-02 · {disposition}.** The analytical replay and all nine offline regressions passed.",
             "", "| Check | Execution result |", "| --- | --- |"]
    for key, item in system.items():
        details = item.get("actual", "")
        floor = item.get("minimum_sampled_available_mib")
        if floor is not None:
            details += f". Minimum sampled available RAM {floor:.1f} MiB"
        lines.append(f"| {key} | {item['status']}. {details.rstrip('.')} |")
    lines.extend(["", f"The local build contains {len(built)} verified runtime data assets. The final check verified "
                  f"{preservation['baseline_files']} baseline files and explained {len(preservation['edits'])} authorized existing-file edits.",
                  "Original research, previous issue and system evidence, outside Git changes and HEAD were preserved. "
                  "The branch is `main`, nine commits behind its locally recorded upstream.", "",
                  "The corrected revision is ready for the evidence review with fresh deployment still pending." if passed else
                  "The evidence review can use the corrected analytical results. Complete the outstanding local system check before freezing the working-tree release.",
                  ""])
    if not passed:
        lines.extend(["The pending Chrome run covers the revised outlook and watchlist across all six horizon/scope selections, "
                      "the corrected terminal and network comparisons, the verified descriptive holidays, the revised headline intensity, "
                      "and the methodology and manifest. The preserved Step 6B Chrome runs cover the earlier revision.", ""])
    atomic_text(report, main + "\n\n" + "\n".join(lines))
    note("publication", status="PASS", issue_status=disposition, proven_system_tests=passed, checked_files=preservation["baseline_files"],
         production_edits=len(preservation["edits"]), fresh_deployment="PENDING", available_mib_before=free,
         peak_worker_mib=peak_memory())
    print(f"{disposition}; {len(preservation['edits'])} protected production edits explained, {len(built)} matching built assets.")
