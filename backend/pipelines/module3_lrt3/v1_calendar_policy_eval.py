"""Replay only calendar-dependent Ridge work and version its released dependencies."""

from collections import Counter
from functools import lru_cache
from math import isclose
from statistics import mean

import numpy as np
import pandas as pd

from export_dashboard import Inputs, clean
from forecast_evaluation import FULL, HOLDOUT, MATCHED, POST, VALIDATION, error_metrics, predict_at
from forecast_inputs import HolidayCalendar, NETWORK, OD, SERVICES, SHAH
from forecast_models import MODELS, NAIVE, RIDGE
from innovation_experiments import SHORT, covered_holidays, summarize_future
from innovation_reporting import watchlist
from service_readiness import network_intensity
from v1_audit import FRONT, OUT, PIPE, ROOT, peak_memory, relative, sha
from v1_audit_forecast import history
from v1_audit_recovery import read, write_json
from v1_calendar_corrections import ORDINARY, VERIFIED, archived_calendar, holiday_status
from v1_calendar_dependency import BASELINE, MODEL_OUTPUTS, PREDICTIONS, REVISION, guard, note


AGG_RIDGE = f"bottom_up_{RIDGE}"
SELECTED = "bottom_up_selected_components"
STEP2_KEYS = ("series_id", "phase", "model_id", "training_policy")
STABILITY_KEYS = ("series_id", "phase", "model_id", "variant")
FIT_FIELDS = ("train_start", "train_end", "train_calendar_days", "train_observed_days", "train_filled_days")
POLICY = {
    "feature": "Archived verified-holiday indicator",
    "flag_one": "A date has a verified record in at least one extracted jurisdiction.",
    "flag_zero": "No verified-holiday adjustment. Known non-holiday, tentative and unknown dates remain distinct in provenance.",
    "compatibility": "The same feature definition applies to training and prediction. No coverage regressor was added to base Ridge.",
    "vintage": "Historical holiday publication and revision vintages are unavailable. A retrospectively verified date may have been unknown at a historical origin.",
    "selection": "Original model families and training policies are fixed. Rolling replays and the already inspected terminal holdout do not select or tune a replacement family.",
}


def archived_asset(name):
    path = relative(FRONT / "data" / f"{name}.json")
    return read(ROOT / read(BASELINE)["production_originals"][path]["backup"])


def require_close(actual, expected, label, absolute=1e-6):
    if actual is None or expected is None:
        if actual is not expected:
            raise ValueError(f"{label}: {actual!r} differs from {expected!r}")
        return
    if not isclose(float(actual), float(expected), rel_tol=1e-11, abs_tol=absolute):
        raise ValueError(f"{label}: {actual!r} differs from {expected!r}")


def compare_values(saved, computed, label, fields=None):
    for name in computed if fields is None else fields:
        actual, expected = clean(computed[name]), saved[name]
        if isinstance(actual, (int, float)) and not isinstance(actual, bool) or actual is None:
            require_close(actual, expected, f"{label} {name}")
        elif actual != expected:
            raise ValueError(f"{label} {name}: {actual!r} differs from {expected!r}")


def score(frame, horizon):
    part = frame.loc[frame["lead_day"].le(horizon)]
    observations = part.loc[np.isfinite(part["actual_trips"])]
    return clean(error_metrics(part["actual_trips"], part["forecast_trips"]) | {
        "folds": int(part["origin"].nunique()),
        "unique_target_dates": int(observations["date"].nunique()),
    })


class CalendarReplay:
    def __init__(self, meta, config, innovation):
        self.meta, self.config, self.settings = meta, config, innovation["settings"]
        self.calendar = archived_calendar(meta["holidays"])
        records = meta["holidays"]["calendar"]
        years = frozenset(self.calendar["coveredYears"])
        all_dates = frozenset(pd.Timestamp(row["date"]) for row in records)
        verified = frozenset(pd.Timestamp(day) for day, state in self.calendar["dates"].items() if state["status"] == VERIFIED)
        self.calendars = (HolidayCalendar(all_dates, years, records, []), HolidayCalendar(verified, years, records, []))
        original_confirmed, original_tentative = covered_holidays(self.calendars[0])
        assert verified == original_confirmed and all_dates - verified == original_tentative
        self.history = {key: pd.Series(values, dtype=float).sort_index().rename_axis("date")
                        for key, values in history().items()}
        self.history = {key: values.set_axis(pd.DatetimeIndex(values.index, name="date")) for key, values in self.history.items()}
        self.original_predictions = pd.read_parquet(OUT / "backtest_predictions.parquet")
        self.corrected_predictions = self.original_predictions.copy()
        self.step2_groups, self.research_groups = {}, {}
        self.research_prediction_rows = []
        self.fit_count = Counter()

    @lru_cache(maxsize=None)
    def fit(self, key, origin, length, policy, lookback, corrected):
        model = self.meta["models"].get(key, {})
        mature = model.get("mature", False) or lookback is not None
        config = self.config if lookback is None else self.config | {"mature_lookback_days": lookback}
        self.fit_count["verified_only" if corrected else "legacy_reproduction"] += 1
        return predict_at(self.history[key], RIDGE, origin, length, policy, mature, self.calendars[corrected], config)

    def apply_step2(self):
        ridge = self.original_predictions.loc[self.original_predictions["model_id"].eq(RIDGE)]
        for (key, phase, model, policy, origin), part in ridge.groupby([*STEP2_KEYS, "origin"], sort=False):
            part = part.sort_values("lead_day")
            horizon = int(part["lead_day"].max())
            original, dates, training, _ = self.fit(key, origin, horizon, policy, None, False)
            corrected, _, _, _ = self.fit(key, origin, horizon, policy, None, True)
            assert dates.equals(pd.DatetimeIndex(part["date"]))
            assert all(part[field].eq(training[field]).all() for field in FIT_FIELDS)
            np.testing.assert_allclose(original, part["forecast_trips"], atol=1e-6, rtol=1e-11)
            self.corrected_predictions.loc[part.index, "forecast_trips"] = corrected
            self.step2_groups[key, phase, model, policy] = None
        for phase, model, policy, component_phase in (
            (VALIDATION, AGG_RIDGE, FULL, "network_component_validation"),
            (HOLDOUT, SELECTED, "by_component", "network_component_holdout_selected"),
        ):
            archive = self.original_predictions
            indices = archive.index[archive["series_id"].eq(NETWORK) & archive["phase"].eq(phase) & archive["model_id"].eq(model)]
            assert len(indices)
            values = []
            for frame in (archive, self.corrected_predictions):
                source = frame.loc[frame["phase"].eq(component_phase)]
                if phase == VALIDATION:
                    source = source.loc[source["model_id"].eq(RIDGE)]
                keys = ["origin", "date", "lead_day"]
                grouped = source.groupby(keys)
                assert grouped["series_id"].size().eq(6).all() and grouped["series_id"].nunique().eq(6).all()
                assert len(grouped) == len(indices)
                indexed = archive.loc[indices].set_index(keys)
                np.testing.assert_allclose(grouped["actual_trips"].sum(min_count=6).reindex(indexed.index),
                                           indexed["actual_trips"], equal_nan=True)
                values.append(grouped["forecast_trips"].sum().reindex(indexed.index))
            np.testing.assert_allclose(values[0], archive.loc[indices, "forecast_trips"], atol=1e-6, rtol=1e-11)
            self.corrected_predictions.loc[indices, "forecast_trips"] = values[1].to_numpy()
            self.step2_groups[NETWORK, phase, model, policy] = None
        keys = [*STEP2_KEYS, "origin", "date"]
        assert not self.corrected_predictions.duplicated(keys).any()
        pd.testing.assert_frame_equal(self.corrected_predictions.drop(columns="forecast_trips"),
                                      self.original_predictions.drop(columns="forecast_trips"))
        self.step2_groups = {
            key: tuple(frame.loc[frame[list(STEP2_KEYS)].eq(key).all(axis=1)] for frame in
                       (self.original_predictions, self.corrected_predictions))
            for key in self.step2_groups
        }
        note("step2_prediction_replay", status="PASS", affected_groups=len(self.step2_groups),
             preserved_keys=len(self.original_predictions), ridge_stored_rows=len(ridge),
             scope="Ridge folds and two bottom-up paths")

    def metrics(self, archived):
        output, changes = [], []
        for row in archived:
            key = tuple(row[field] for field in STEP2_KEYS)
            if key not in self.step2_groups:
                output.append(row)
                continue
            original, corrected = (score(frame, row["horizon_days"]) for frame in self.step2_groups[key])
            compare_values(row, original, str(key))
            assert all(corrected[name] == original[name] for name in
                       ("scored_predictions", "unique_target_dates", "folds", "missing_actual_count", "mape_excluded_zero_count"))
            naive = row["seasonal_naive_wape_pct"]
            improvement = None if naive is None or corrected["wape_pct"] is None else naive - corrected["wape_pct"]
            outcome = row | corrected | {
                "wape_improvement_pp_vs_seasonal_naive": improvement,
                "wape_improvement_pct_vs_seasonal_naive": None if improvement is None or not naive else 100 * improvement / naive,
            }
            output.append(outcome)
            changes.append({"series": key[0], "phase": key[1], "model": key[2], "training_policy": key[3],
                            "horizon": row["horizon_days"], "archived": original, "corrected": corrected})
        assert len(output) == 226 and len(changes) == 76
        return output, changes

    def revised_alternatives(self):
        frame = pd.read_parquet(OUT / "alternative_forecasts.parquet")
        revised = frame.copy()
        ridge = frame.loc[frame["model_id"].eq(RIDGE)]
        touched = {}
        for (key, variant), part in ridge.groupby(["series_id", "variant"], sort=False):
            if variant == "bottom_up_same_candidate":
                continue
            part = part.sort_values("date")
            policy = POST if variant == POST else FULL
            window = self.settings["short_training_window_days"] if variant == "recent_window" else None
            cutoff = part["data_cutoff"].iat[0]
            old, dates, training, _ = self.fit(key, cutoff, len(part), policy, window, False)
            new, _, _, _ = self.fit(key, cutoff, len(part), policy, window, True)
            np.testing.assert_allclose(old, part["forecast_trips"], atol=1e-6, rtol=1e-11)
            assert dates.equals(pd.DatetimeIndex(part["date"]))
            assert part["train_start"].eq(training["train_start"]).all() and part["train_end"].eq(training["train_end"]).all()
            revised.loc[part.index, "forecast_trips"] = new
            touched[key, variant, RIDGE] = part.index
        part = ridge.loc[ridge["variant"].eq("bottom_up_same_candidate")].sort_values("date")
        for candidate in (frame, revised):
            components = candidate.loc[candidate["series_id"].isin(SERVICES) & candidate["model_id"].eq(RIDGE) & candidate["variant"].eq(FULL)]
            totals = components.groupby("date")["forecast_trips"]
            assert totals.size().eq(6).all()
            values = totals.sum().reindex(part["date"]).to_numpy()
            if candidate is frame:
                np.testing.assert_allclose(values, part["forecast_trips"], atol=1e-6, rtol=1e-11)
            else:
                revised.loc[part.index, "forecast_trips"] = values
        touched[NETWORK, "bottom_up_same_candidate", RIDGE] = part.index
        assert len(touched) == 13
        return frame, revised, touched

    def supplemental_folds(self, key, origins, variant, lookback=None):
        paired = ([], [])
        for origin in origins:
            for corrected in (False, True):
                values, dates, training, _ = self.fit(key, origin, 28, FULL, lookback, corrected)
                paired[corrected].append(pd.DataFrame({
                    "date": dates, "origin": origin, "lead_day": range(1, len(dates) + 1),
                    "actual_trips": self.history[key].reindex(dates).to_numpy(),
                    "forecast_trips": values, **training,
                }))
        result = tuple(pd.concat(frames, ignore_index=True) for frames in paired)
        for _, row in result[1].iterrows():
            self.research_prediction_rows.append(clean({"series_id": key, "variant": variant, **row.to_dict()}))
        return result

    def stability(self, saved, before, after, touched):
        groups = self.step2_groups
        stage = {}
        for key in SHORT:
            stage[key, VALIDATION, RIDGE, "original_full"] = groups[key, VALIDATION, RIDGE, FULL]
            for policy in (FULL, POST):
                stage[key, MATCHED, RIDGE, policy] = groups[key, MATCHED, RIDGE, policy]
            days = self.settings["short_training_window_days"]
            origins = [origin for origin in pd.to_datetime(self.meta["models"][key]["plan"]["origins"])
                       if len(self.history[key].loc[:origin]) >= days]
            stage[key, "recent_window_matched", RIDGE, FULL] = tuple(
                frame.loc[frame["origin"].isin(origins)] for frame in groups[key, VALIDATION, RIDGE, FULL])
            stage[key, "recent_window_matched", RIDGE, "recent_window"] = self.supplemental_folds(key, origins, "recent_window", days)
        origins = pd.to_datetime(self.meta["models"][SHAH]["plan"]["origins"])
        stage[NETWORK, "network_common_origins", RIDGE, "direct_common_history"] = self.supplemental_folds(NETWORK, origins, "direct_common_history")
        stage[NETWORK, "network_common_origins", AGG_RIDGE, "bottom_up_same_candidate"] = groups[NETWORK, VALIDATION, AGG_RIDGE, FULL]
        stage[NETWORK, "retrospective_terminal", SELECTED, "bottom_up"] = groups[NETWORK, HOLDOUT, SELECTED, "by_component"]
        output, counts = [], Counter()
        for row in saved:
            key = tuple(row[name] for name in STABILITY_KEYS)
            alt = (key[0], key[3], key[2])
            if key[1] == "forecast_sensitivity" and alt in touched:
                index = touched[alt]
                original, corrected = (clean(summarize_future(frame.loc[index], self.history[key[0]], self.settings))
                                       for frame in (before, after))
                compare_values(row, original, str(key))
                output.append(row | corrected)
                counts["forecast_sensitivity"] += 1
            elif key in stage:
                original, corrected = (score(frame, row["horizon_days"]) for frame in stage[key])
                original.pop("unique_target_dates")
                compare_values(row, original, str(key))
                output.append(row | corrected)
                counts[key[1]] += 1
            else:
                output.append(row)
        assert len(output) == 161 and sum(counts.values()) == 51
        note("step2b_replay", status="PASS", updated_rows_by_phase=dict(counts),
             supplemental_predictions=len(self.research_prediction_rows),
             preserved=["cold-start profiles, selected Shah Alam and OD donor controls", "Step 2B verified-plus-coverage ablation", "OD residual audit"])
        return output, dict(counts)


def primary_forecasts(meta, alternatives, calendar):
    archived = pd.read_parquet(OUT / "network_service_forecast.parquet")
    revised = archived.copy()
    fixed = [key for key in SERVICES if meta["models"][key]["model"] == RIDGE]
    assert len(fixed) == 4
    ridge = alternatives.loc[alternatives["series_id"].isin(fixed) & alternatives["model_id"].eq(RIDGE) & alternatives["variant"].eq(FULL)]
    for key in fixed:
        group = revised.loc[revised["series_id"].eq(key)]
        updated = ridge.loc[ridge["series_id"].eq(key)].set_index("date")["forecast_trips"].reindex(group["date"])
        assert len(updated) == 90 and updated.notna().all() and meta["models"][key]["policy"] == FULL
        revised.loc[group.index, "forecast_trips"] = updated.to_numpy()
    components = revised.loc[revised["series_id"].isin(SERVICES)].groupby("date")["forecast_trips"]
    assert components.size().eq(6).all()
    net = revised.loc[revised["series_id"].eq(NETWORK)]
    revised.loc[net.index, "forecast_trips"] = components.sum().reindex(net["date"]).to_numpy()
    statuses = revised["date"].map(lambda value: holiday_status(calendar, value.date()))
    revised["calendar_status"] = statuses
    revised["verified_holiday"] = statuses.eq(VERIFIED)
    revised["holiday_calendar_known"] = statuses.isin([VERIFIED, ORDINARY])
    return archived, revised, fixed


def downstream(replay, original, revised, alternatives_before, alternatives_after, metrics, archived_network, fixed):
    as_of = replay.meta["evaluation_as_of_date"]
    groups, legacy = ({key: part.sort_values("date").reset_index(drop=True) for key, part in frame.groupby("series_id")}
                      for frame in (revised, original))
    changed_targets = {*fixed, NETWORK}
    daily = dict(archived_network["daily"])
    for key in changed_targets:
        daily[key] = [[day.date().isoformat(), float(value), int(lead)] for day, value, lead in
                      groups[key][["date", "forecast_trips", "lead_day"]].itertuples(index=False, name=None)]
    outlook = []
    for row in archived_network["outlook"]:
        key = row["series_id"]
        part = daily[key][:row["horizon"]]
        if row["scope"] == "future":
            part = [point for point in part if point[0] > as_of]
        assert len(part) == row["days"] and part[0][0] == row["start"] and part[-1][0] == row["end"]
        values = [value for _, value, _ in part]
        total, average, baseline = sum(values), mean(values), row["baseline"]
        outlook.append(row | {"total": total, "average": average, "delta": average - baseline,
                              "change_pct": 100 * (average / baseline - 1)} if key in changed_targets else row)
    base_metrics = archived_asset("research")["metrics"]
    old_watch = clean(watchlist(replay.history, legacy, alternatives_before, pd.DataFrame(base_metrics), replay.meta, replay.settings).to_dict("records"))
    for row, expected in zip(old_watch, archived_network["watchlist"], strict=True):
        compare_values(expected, row, "archived watchlist")
    watched = clean(watchlist(replay.history, groups, alternatives_after, pd.DataFrame(metrics), replay.meta, replay.settings).to_dict("records"))

    capacity_config = read(OUT / "capacity_config.json")
    capacity = read(OUT / "capacity_metadata.json")
    summary = pd.DataFrame(list(Inputs().csv("scheduled_service_summary.csv")))
    hist = pd.read_parquet(OUT / "network_service_history.parquet")
    old_intensity, old_dates = network_intensity(original, hist, summary, capacity_config, capacity["GTFS"])
    intensity, eligible_dates = network_intensity(revised, hist, summary, capacity_config, capacity["GTFS"])
    pd.testing.assert_frame_equal(old_dates.reset_index(drop=True), eligible_dates.reset_index(drop=True))
    archived_service = archived_asset("service")["intensity"]
    for row in clean(old_intensity.to_dict("records")):
        prior = next(item for item in archived_service if item["series_id"] == row["series_id"])
        compare_values(prior, row, "archived headline intensity")
    for column in ["reference_departures_total", "paired_recent_matched_trips", "intensity_covered_days"]:
        pd.testing.assert_series_equal(old_intensity.set_index("series_id")[column].sort_index(),
                                       intensity.set_index("series_id")[column].sort_index())
    by_series = {row["series_id"]: row for row in clean(intensity.to_dict("records"))}
    rows = [by_series[row["series_id"]] | {"demand_evidence": "Step_6B1_verified_calendar_forecast_and_observed_recent_baseline"}
            if row["series_id"] in fixed else row for row in archived_service]
    return daily, outlook, watched, rows


def evaluate():
    free = guard("Targeted Ridge replay")
    provenance = (
        OUT / "forecast_metadata.json", OUT / "backtest_predictions.parquet", OUT / "model_backtesting.csv",
        OUT / "network_service_forecast.parquet", OUT / "network_service_history.parquet", OUT / "lrt3_daily.parquet",
        OUT / "model_stability.csv", OUT / "alternative_forecasts.parquet", OUT / "feature_ablation.csv",
        OUT / "innovation_metadata.json", OUT / "demand_watchlist.csv", OUT / "network_service_intensity.csv",
        OUT / "scheduled_service_summary.csv", OUT / "capacity_config.json", OUT / "capacity_metadata.json",
        OUT / "v1_calendar_ridge_sensitivity_6b.json", PIPE / "forecast_models.py", PIPE / "forecast_evaluation.py",
        PIPE / "forecast_settings.json", PIPE / "innovation_experiments.py", PIPE / "innovation_reporting.py",
        PIPE / "service_readiness.py", PIPE / "v1_calendar_corrections.py", PIPE / "v1_calendar_policy_eval.py",
    )
    digests = {relative(path): sha(path) for path in provenance}
    existing = OUT / MODEL_OUTPUTS
    if existing.is_file() and read(existing)["inputs"] == digests and sha(OUT / PREDICTIONS) == read(existing)["prediction_sha256"]:
        print(f"Reusing completed Ridge replay from {existing.name}")
        return
    meta = read(OUT / "forecast_metadata.json")
    config = read(PIPE / "forecast_settings.json")
    innovation = read(OUT / "innovation_metadata.json")
    replay = CalendarReplay(meta, config, innovation)
    replay.apply_step2()
    archived_research = archived_asset("research")
    metrics, evaluation_changes = replay.metrics(archived_research["metrics"])
    before, after, touched = replay.revised_alternatives()
    stability, stability_counts = replay.stability(archived_research["stability"], before, after, touched)
    original, revised, fixed = primary_forecasts(meta, after, replay.calendar)
    archived_network = archived_asset("network")
    daily, outlook, watch, intensity = downstream(replay, original, revised, before, after, metrics, archived_network, fixed)
    alternatives = dict(archived_research["alternatives"])
    for (key, variant, model), indices in touched.items():
        part = after.loc[indices].sort_values("date")
        alternatives[f"{key}|{variant}|{model}"] = [[day.date().isoformat(), float(value)] for day, value in
                                                  part[["date", "forecast_trips"]].itertuples(index=False, name=None)]
    totals = {}
    sensitivity = read(OUT / "v1_calendar_ridge_sensitivity_6b.json")
    for scope, saved_key in (("full", "network_90_day_delta"), ("future", "network_future_only_delta")):
        new = next(row for row in outlook if (row["series_id"], row["horizon"], row["scope"]) == (NETWORK, 90, scope))
        old = next(row for row in archived_network["outlook"] if (row["series_id"], row["horizon"], row["scope"]) == (NETWORK, 90, scope))
        delta = new["total"] - old["total"]
        require_close(delta, sensitivity[saved_key], scope)
        totals[scope] = {"archived": old, "corrected": new, "trip_delta": delta}
    terminal = {row["model_id"]: row["wape_pct"] for row in metrics if (row["series_id"], row["phase"], row["horizon_days"]) == (NETWORK, HOLDOUT, 14)}
    selected_by_target = {}
    for key, info in meta["models"].items():
        avg = {model: mean(row["wape_pct"] for row in metrics if
                          (row["series_id"], row["phase"], row["training_policy"], row["model_id"]) == (key, VALIDATION, FULL, model))
               for model in MODELS}
        selected_by_target[key] = {"retained_family": info["model"], "retained_policy": info["policy"],
                                  "rolling_mean_WAPE": avg, "original_rule_winner_on_replay": min(MODELS, key=avg.get)}
    groups = [pair[1] for pair in replay.step2_groups.values()]
    keys = [*STEP2_KEYS, "origin", "date", "lead_day", "actual_trips", "forecast_trips", *FIT_FIELDS]
    affected = pd.concat(groups)[keys]
    prediction_output = OUT / PREDICTIONS
    write_json(prediction_output, clean({"revision": REVISION, "step2": affected.to_dict("records"),
                                       "step2b_supplemental": replay.research_prediction_rows}))
    write_json(existing, {
        "revision": REVISION, "policy": POLICY, "disposition": "A", "inputs": digests,
        "prediction_sha256": sha(prediction_output), "selected_ridge_services": fixed,
        "fit_counts": dict(replay.fit_count), "affected_prediction_rows": len(affected),
        "step2b_supplemental_prediction_rows": len(replay.research_prediction_rows),
        "evaluation_changes": evaluation_changes, "stability_changes_by_phase": stability_counts,
        "terminal_14_day": terminal, "fixed_model_selection": selected_by_target, "totals_comparison": totals,
        "network": {"daily": daily, "outlook": outlook, "watchlist": watch},
        "research": {"metrics": metrics, "stability": stability, "alternatives": alternatives},
        "intensity": intensity,
    })
    note("revision_computed", status="PASS", revision=REVISION, available_mib=free, peak_worker_mib=peak_memory(),
         fixed_fits=dict(replay.fit_count), affected_prediction_rows=len(affected), metrics=len(evaluation_changes),
         stability=stability_counts, terminal_14_day=terminal, future_only_delta=totals["future"]["trip_delta"],
         artifact=MODEL_OUTPUTS)
    print(f"Corrected {len(affected)} Step 2 predictions and {len(evaluation_changes)} metrics; terminal 14d {terminal}")
    print(f"Verified deltas full {totals['full']['trip_delta']:.2f}, future {totals['future']['trip_delta']:.2f}; fits {dict(replay.fit_count)}")
