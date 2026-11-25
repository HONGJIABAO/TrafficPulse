"""Recheck Step 6B analytical corrections with archived local inputs."""

from collections import Counter, defaultdict
from datetime import date, timedelta
from math import isfinite, isclose
from statistics import mean
import traceback

from v1_audit import Audit, FRONT, OUT, PIPE, ROOT, asset, iso, parquet, peak_memory, relative, sha
from v1_audit_data import OD_COLUMNS, equity, gtfs
from v1_audit_forecast import forecast_logic, forecasts, history, research
from v1_audit_recovery import read, strict_csv, write_json
from v1_calendar_corrections import archived_calendar, corrected_supply, holiday_status
from v1_fix import REGISTER, guard, note, repair_progress


def test(test_id, issues, description, expected, method, fn, tolerance="Exact"):
    fields = dict(test_id=test_id, issues=issues, description=description, expected=expected, method=method, tolerance=tolerance)
    try:
        actual = fn()
        note("regression", status="PASS", actual=actual, peak_worker_mib=peak_memory(), **fields)
        print(f"{test_id} PASS {actual}", flush=True)
        return True
    except Exception:
        actual = traceback.format_exc()
        note("regression", status="FAIL", actual=actual, peak_worker_mib=peak_memory(), **fields)
        print(f"{test_id} FAIL {actual}", flush=True)
        return False


def data_integrity():
    rows = parquet(OUT / "network_station_origin_daily.parquet", list(OD_COLUMNS))
    keys, physical, origins = set(), set(), set()
    total = 0
    lrt = {}
    for row in rows:
        day = iso(row["date"])
        origin = row["canonical_origin_code"]
        key = (day, origin)
        value = row["station_origin_trips"]
        assert key not in keys and row["a0_destination_rows"] == 1 and not row["has_duplicate_od_key"]
        assert row["individual_destination_rows"] == row["empirical_destination_roster_size"]
        assert value == row["a0_destination_trips"] == row["individual_destination_trips"] and value >= 0
        keys.add(key)
        origins.add(origin)
        physical.add(row["physical_station_id"])
        total += value
        if row["lrt3_station_code"]:
            lrt[day, row["lrt3_station_code"]] = value
    days = {day for day, _ in keys}
    station_days = {(iso(row["date"]), row["station_code"]): row["station_origin_trips"]
                    for row in parquet(OUT / "lrt3_station_daily.parquet") if iso(row["date"]) in days}
    result = [len(days), len(keys), len(origins), len(physical), len({code for _, code in lrt}), sum(lrt.values()), total]
    assert result == [112, 18592, 166, 157, 20, 3265221, 71714309] and lrt == station_days
    ui = asset("equity")
    assert (ui["putrajayaOrigins"], ui["putrajayaDestinations"]) == (34, 2)
    zero = next(row for row in ui["districts"] if row["district_id"] == "1002")
    assert zero["observed_rapid_rail_station_origin_trips"] == 0
    assert zero["average_daily_rapid_rail_station_origin_trips_per_physical_station"] is None
    return {"totals": result, "matched_LRT3_station_days": len(lrt), "putrajaya_roster": [34, 2], "zero_vs_null": [0, None]}


def holiday_regression():
    metadata = read(OUT / "forecast_metadata.json")["holidays"]
    derived = archived_calendar(metadata)
    payload = read(OUT / "v1_calendar_corrections_6b.json")
    assert payload["calendar"] == derived == asset("patterns")["holidayCalendar"]
    assert len({d for d, item in derived["dates"].items() if item["status"] == "tentative_holiday"}) == 10
    assert derived["regions"] == sorted({row["region"] for row in metadata["calendar"]}) == ["Kuala Lumpur", "Selangor"]
    records = [
        {"date": "2026-11-08", "region": "Kuala Lumpur", "source_marks_date_tentative": False, "kind": "pdf_scheduled"},
        {"date": "2026-11-08", "region": "Selangor", "source_marks_date_tentative": True, "kind": "pdf_scheduled"},
        {"date": "2026-11-09", "region": "Selangor", "source_marks_date_tentative": True,
         "kind": "sunday_substitution", "observed_for_date": "2026-11-08"},
    ]
    fixture = archived_calendar({"calendar": records, "covered_years": [2026, 2027]})
    dates = tuple(date.fromisoformat(value) for value in ("2026-11-08", "2026-11-09", "2026-11-10", "2027-01-01"))
    assert [holiday_status(fixture, day) for day in dates] == [
        "verified_holiday", "tentative_holiday", "known_non_holiday", "unknown_calendar"]
    assert fixture["dates"]["2026-11-08"]["evidence"] == records[:2]
    assert [corrected_supply(fixture, day, "ordinary_day_GTFS_reference", True) for day in dates] == [
        "unavailable_no_holiday_timetable", "unavailable_tentative_holiday_timetable",
        "ordinary_day_GTFS_reference", "unavailable_unknown_holiday_calendar"]
    confirmed = {day for day, item in derived["dates"].items() if item["status"] == "verified_holiday"}
    listed = derived["dates"].keys()
    old = {row["series_id"]: row for row in strict_csv(OUT / "demand_patterns.csv")
           if row["pattern"] == "holiday_vs_comparable_nonholiday"}
    corrected = {row["series_id"]: row for row in asset("patterns")["patterns"]
                 if row["pattern"] == "holiday_vs_comparable_nonholiday"}
    result = {}
    for key, values in history().items():
        first = max(values) - timedelta(days=364)
        usable = {when: value for when, value in values.items()
                  if when >= first and when.year in derived["coveredYears"] and value is not None}
        for source, picked in ((old, listed), (corrected, confirmed)):
            targets = [(when, value) for when, value in usable.items() if when.isoformat() in picked]
            rows = []
            for when, value in targets:
                siblings = [count for day, count in usable.items()
                            if day.weekday() == when.weekday() and day.isoformat() not in listed and abs((day - when).days) <= 28]
                if siblings:
                    rows.append((when, value, mean(siblings), len(siblings)))
            percent = 100 * (mean(row[1] for row in rows) / mean(row[2] for row in rows) - 1)
            row = source[key]
            assert (int(row["observed_days"]), int(row["reference_observations"])) == (len(rows), len(rows))
            assert isclose(float(row["difference_pct"]), percent, abs_tol=1e-8)
            if source is corrected:
                assert row["matched_control_date_uses"] == sum(item[3] for item in rows)
            result.setdefault(key, []).append([len(rows), percent, sum(row[3] for row in rows)])
    od = result["lrt3_station_origin_od"]
    assert [(n, round(p, 2)) for n, p, _ in od] == [(5, -30.15), (3, -37.29)]
    kelana = result["rail_lrt_kj"]
    assert [(n, round(p, 2)) for n, p, _ in kelana] == [(18, -39.72), (14, -41.55)]
    return {"tested_targets": len(result), "lrt3": od, "kelana_jaya": kelana, "archived_conflict_fixture": "Both regions preserved"}


def metric_regression():
    groups = defaultdict(list)
    fields = ("series_id", "model_id", "phase", "training_policy")
    for row in parquet(OUT / "backtest_predictions.parquet", [*fields, "lead_day", "origin", "date", "actual_trips", "forecast_trips"]):
        groups[tuple(row[key] for key in fields)].append(row)
    source = asset("research")["metrics"]
    archive = list(strict_csv(OUT / "model_backtesting.csv"))
    outcomes = defaultdict(set)
    for row, raw in zip(source, archive, strict=True):
        for key in fields:
            assert row[key] == raw[key]
        for key in ("wape_pct", "mae", "rmse", "mape_pct"):
            assert row[key] is None if raw[key] in ("", "NA", "nan") else isclose(row[key], float(raw[key]), abs_tol=1e-8)
        stage = [p for p in groups[tuple(row[key] for key in fields)] if p["lead_day"] <= row["horizon_days"]]
        valid = [p for p in stage if p["actual_trips"] is not None and isfinite(p["actual_trips"])]
        assert len({p["origin"] for p in stage}) == row["folds"]
        assert len(valid) == row["scored_predictions"]
        assert len({p["date"] for p in valid}) == row["unique_target_dates"]
        denominator = sum(abs(p["actual_trips"]) for p in valid)
        if denominator:
            assert isclose(100 * sum(abs(p["forecast_trips"] - p["actual_trips"]) for p in valid) / denominator,
                           row["wape_pct"], abs_tol=1e-8)
        if row["phase"] == "rolling_validation" and row["horizon_days"] == 28:
            outcomes[row["series_id"]].add((row["scored_predictions"], row["unique_target_dates"]))
    expected = {"rail_lrt_shah_alam": {(168, 63)}, "lrt3_station_origin_od": {(140, 56)},
                "rapid_rail_published_sum": {(168, 63)}}
    assert all(outcomes[key] == value for key, value in expected.items())
    dates = [(1, "d1"), (1, "d2"), (2, "d2"), (2, "d3")]
    assert len(dates) == 4 and len({day for _, day in dates}) == 3
    terminal = {row["model_id"]: round(row["wape_pct"], 2) for row in source if row["phase"] == "terminal_holdout"
                and row["horizon_days"] == 14 and row["series_id"] == "rapid_rail_published_sum"}
    assert terminal == {"bottom_up_selected_components": 3.73, "bottom_up_seasonal_naive_7": 2.54}
    return {"rows": len(source), "overlap": {key: list(value)[0] for key, value in expected.items()}, "network_14_day": terminal}


def validate_artifacts():
    manifest = asset("manifest")
    for name, item in manifest["assets"].items():
        path = FRONT / "data" / name
        assert path.stat().st_size == item["bytes"] and sha(path) == item["sha256"]
        assert read(path)["schemaVersion"] == 1
    for name, digest in manifest["inputSha256"].items():
        assert sha(OUT / name) == digest
    baseline = read(REGISTER)
    original = {name.rsplit("/", 1)[-1]: ROOT / item["path"]
                for name, item in baseline["preserved_originals"].items() if "/data/" in name}
    saved = read(original["patterns.json"])
    corrected = asset("patterns")
    unaffected = lambda payload: [row for row in payload["patterns"] if row["pattern"] != "holiday_vs_comparable_nonholiday"]
    assert unaffected(saved) == unaffected(corrected)
    old_service = read(original["service.json"])
    svc = asset("service")
    assert [row["supply_status"] for row in svc["calendar"]] == [row["supply_status"] for row in old_service["calendar"]]
    assert {k: v for k, v in svc.items() if k != "calendar"} == {k: v for k, v in old_service.items() if k != "calendar"}
    assert manifest["dataRevision"] == "module3-v1-step6b.1"
    return {"assets": len(manifest["assets"]) + 1, "verified_sources": len(manifest["inputSha256"]),
            "unchanged_other_pattern_rows": len(unaffected(saved)), "unchanged_dated_supply_rows": len(svc["calendar"])}


def counterfactual():
    """Measure the exact fixed-cutoff Ridge dependence with no selection or evaluation."""
    import numpy as np
    import pandas as pd

    from forecast_evaluation import predict_at
    from forecast_inputs import HolidayCalendar

    config_path = PIPE / "forecast_settings.json"
    meta_path = OUT / "forecast_metadata.json"
    config, meta = read(config_path), read(meta_path)
    data = meta["holidays"]
    raw = frozenset(pd.Timestamp(row["date"]) for row in data["calendar"])
    confirmed = frozenset(pd.Timestamp(row["date"]) for row in data["calendar"] if not row["source_marks_date_tentative"])
    years = frozenset(data["covered_years"])
    saved, observed = forecasts(), history()
    outcomes = {}
    deltas = defaultdict(float)
    for key, item in meta["models"].items():
        if item["model"] != "calendar_lag_ridge":
            continue
        dates = sorted(observed[key])
        series = pd.Series([observed[key][d] for d in dates], index=pd.DatetimeIndex(dates, name="date"), dtype=float)
        origin = series.index[-1]
        args = series, item["model"], origin, 90, item["policy"], item["mature"]
        archive, future, training, original_fit = predict_at(*args, HolidayCalendar(raw, years, [], []), config)
        sensitivity, _, _, revised_fit = predict_at(*args, HolidayCalendar(confirmed, years, [], []), config)
        reference = [saved[key][day.date()]["forecast_trips"] for day in future]
        assert np.allclose(archive, reference, atol=1e-6, rtol=1e-11)
        difference = sensitivity - archive
        for day, value in zip(future, difference, strict=True):
            deltas[day.date()] += float(value)
        outcomes[key] = {
            "archived_feature_positive_training_rows": original_fit["training_rows_with_verified_holidays"],
            "confirmed_only_feature_positive_training_rows": revised_fit["training_rows_with_verified_holidays"],
            "tentative_future_dates": [day.date().isoformat() for day in future if day in raw - confirmed],
            "training_start": iso(training["train_start"]), "cutoff": iso(origin),
            "archived_90_day_trips": float(archive.sum()), "sensitivity_90_day_trips": float(sensitivity.sum()),
            "changed_days_above_1e_6": int((np.abs(difference) > 1e-6).sum()), "maximum_absolute_daily_change": float(np.abs(difference).max()),
        }
    assert len(outcomes) == 4 and all(row["changed_days_above_1e_6"] > 0 for row in outcomes.values())
    original_network = sum(row["forecast_trips"] for row in saved["rapid_rail_published_sum"].values())
    payload = {
        "revision": "module3-v1-step6b.1", "purpose": "Fixed published Ridge policy, penalty and cutoff calendar sensitivity only; original forecasts and terminal metrics remain authoritative historical outputs.",
        "feature_rule": "Only verified dates set the existing binary adjustment. Tentative and unknown dates receive no verified-flag adjustment. This fixed sensitivity adds no coverage regressor and supplies no independent validation.",
        "inputs": {relative(path): sha(path) for path in (config_path, meta_path, OUT / "network_service_history.parquet",
                   OUT / "network_service_forecast.parquet", PIPE / "forecast_evaluation.py", PIPE / "forecast_models.py")},
        "series": outcomes, "unchanged_components": ["rail_monorail", "rail_lrt_shah_alam"], "unchanged_od": "lrt3_station_origin_od",
        "network_archived_90_day": original_network, "network_sensitivity_90_day": original_network + sum(deltas.values()),
        "network_90_day_delta": sum(deltas.values()), "network_future_only_delta": sum(value for day, value in deltas.items() if day > date(2026, 11, 24)),
    }
    write_json(OUT / "v1_calendar_ridge_sensitivity_6b.json", payload)
    return {"four_fixed_ridge_refits": list(outcomes), "network_90_day_delta": payload["network_90_day_delta"],
            "network_future_only_delta": payload["network_future_only_delta"], "published_changed": False}


def recovered_checks(section, runner, ids):
    audit = Audit(section)
    runner(audit)
    rows = {row["check_id"]: row for row in audit.checks}
    selected = {key: rows[key]["actual"] or rows[key]["evidence"] for key in ids}
    assert all(rows[key]["status"] == "PASS" for key in ids), {key: rows[key] for key in ids}
    return selected


def main():
    repair_progress()
    guard("Sequential archived regression")
    cases = [
        ("BE-01", [], "Published OD keys and totals", "112/18592/166/157/20 and both totals; 34/2; zero vs null",
         "Read only processed OD keys and counts, verify A0 reconciliation and join Step 1.", data_integrity),
        ("BE-02", ["M3-02", "M3-08", "M3-09"], "Confirmed and tentative holiday provenance and corrected contrasts",
         "All eight archived and corrected estimates; contrast LRT3 five to three and Kelana Jaya 18 to 14.",
         "Independently match raw archived classification and recent observed dates by weekday; test regional conflict, substitution and unknown.",
         holiday_regression, "1e-8 percentage points; exact counts"),
        ("BE-03", ["M3-05"], "Scored pairs, date counts and preserved metrics", "226 exact row matches, 168/63 and 140/56; selected 3.73 vs naive 2.54",
         "Group prediction rows by model, phase, policy and horizon. Check raw metric values and independently recompute WAPE.", metric_regression, "1e-8 absolute"),
        ("BE-04", ["M3-03", "M3-04"], "All archived forecast scopes and coherence", "Six components, dates, baseline, totals and changes across 48 windows and 12 watch rows",
         "Re-execute D-01 through D-04 on the protected parquet and current export.",
         lambda: recovered_checks("D", forecast_logic, ("D-01", "D-02", "D-03", "D-04")), "1e-8 absolute and 1e-11 relative"),
        ("BE-05", ["M3-06", "M3-07", "M3-11"], "Cold-start, stability, scenarios and empirical coverage",
         "198 donor folds, 36 pooled rows, four Shah Alam references, OD +2.97%, all scenario rows and 6/14",
         "Re-execute E-01, E-02, E-04 and E-05 from archived observations, alternatives and predictions.",
         lambda: recovered_checks("E", research, ("E-01", "E-02", "E-04", "E-05")), "1e-8 absolute and 1e-11 relative"),
        ("BE-06", ["M3-01", "M3-09"], "GTFS directions, readiness, expiry and withheld shared trunk",
         "288 periods, 1,728 hours, 624 places, six headline intensity rows, 35/43/8 status counts",
         "Re-execute G-01 through G-04 with rational interval overlap and archived GTFS joins.",
         lambda: recovered_checks("G", gtfs, ("G-01", "G-02", "G-03", "G-04")), "1e-8 absolute and 1e-11 relative"),
        ("BE-07", ["M3-10", "M3-12"], "Geography, administrative cohorts and unchanged screening",
         "180 station records, eight districts, 2026 population, six screens, both corridor contributions",
         "Re-execute I-01 through I-04 with point-in-polygon, DOSM denominators and independent thresholds.",
         lambda: recovered_checks("I", equity, ("I-01", "I-02", "I-03", "I-04")), "Saved precision; 1e-8 for cutoffs"),
        ("BE-08", ["M3-02", "M3-05", "M3-08", "M3-09"], "Versioned static export and invariant assets",
         "Nine assets, all digests, all original nonholiday rows and supply totals retained.",
         "Strictly parse static JSON, validate its manifest and compare targeted changes with backed-up originals.", validate_artifacts),
        ("BE-09", ["M3-02"], "Fixed-policy Ridge calendar sensitivity and protected original",
         "Reproduce four published series, isolate four verified-only sensitivities and do no model reselection.",
         "Call the existing fixed-cutoff Ridge predictor with the two archived feature date sets.", counterfactual, "1e-6 absolute and 1e-11 relative"),
    ]
    results = [test(*case) for case in cases]
    raise SystemExit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
