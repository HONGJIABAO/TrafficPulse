"""Rolling-origin model comparison, intervention sensitivity and a terminal holdout."""

import numpy as np
import pandas as pd

from forecast_inputs import HEADLINE, OD, OPENING, PAID_START, SHAH, stamp
from forecast_models import MODELS, NAIVE, predict


DAY = pd.Timedelta(days=1)
FULL = "full_eligible_history"
POST = "from_paid_service"
VALIDATION = "rolling_validation"
MATCHED = "intervention_matched"
HOLDOUT = "terminal_holdout"


def target_and_unit(series_id):
    if series_id == OD:
        return OD, "station_origin_trips"
    return HEADLINE, "headline_service_trips"


def training_slice(series, origin, policy, mature, config):
    train = series.loc[:origin]
    if policy == POST:
        train = train.loc[PAID_START:]
    if mature:
        train = train.iloc[-config["mature_lookback_days"]:]
    if train.first_valid_index() is None:
        return train.iloc[:0]
    return train.loc[train.first_valid_index():]


def predict_at(series, model, origin, days, policy, mature, holidays, config):
    train = training_slice(series, origin, policy, mature, config)
    future = pd.date_range(origin + DAY, periods=days, name="date")
    values, parameters = predict(model, train, future, holidays, config)
    return values, future, {
        "train_start": train.index[0], "train_end": train.index[-1],
        "train_calendar_days": len(train), "train_observed_days": int(train.notna().sum()),
        "train_filled_days": int(train.isna().sum()),
    }, parameters


def make_plan(series, mature, config):
    prefix = "mature" if mature else "short"
    minimum = config[f"{prefix}_min_fold_training_days"]
    stride = config[f"{prefix}_fold_step_days"]
    max_folds = config[f"{prefix}_max_folds"]
    cutoff = series.index[-1]
    desired_horizons = config["validation_horizons"]
    for largest in reversed(desired_horizons):
        for reserved in (config[f"{prefix}_holdout_days"], 0):
            selection_end = cutoff - reserved * DAY
            latest = selection_end - largest * DAY
            earliest = series.index[0] + (minimum - 1) * DAY
            origins = [date for date in pd.date_range(latest, periods=max_folds, freq=f"-{stride}D")
                       if date >= earliest and len(series.loc[:date].dropna()) >= minimum]
            if len(origins) >= 2:
                return {
                    "origins": sorted(origins), "horizons": [h for h in desired_horizons if h <= largest],
                    "holdout_days": reserved, "holdout_origin": selection_end if reserved else None,
                    "minimum_training_observations": minimum, "fold_spacing_days": stride,
                }
    return None


def fold_rows(series_id, series, models, origins, days, phase, policy, mature, holidays, config):
    frames = []
    target, unit = target_and_unit(series_id)
    for origin in origins:
        for model in models:
            values, dates, training, _ = predict_at(
                series, model, origin, days, policy, mature, holidays, config,
            )
            frames.append(pd.DataFrame({
                "series_id": series_id, "target_id": target, "unit": unit, "phase": phase,
                "model_id": model, "training_policy": policy, "origin": origin,
                "date": dates, "lead_day": np.arange(1, days + 1),
                "actual_trips": series.reindex(dates).to_numpy(dtype=float),
                "forecast_trips": values, **training,
            }))
    return pd.concat(frames, ignore_index=True)


def error_metrics(actual, predicted):
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    finite = np.isfinite(actual)
    actual = actual[finite]
    predicted = predicted[finite]
    error = np.abs(predicted - actual)
    nonzero = actual != 0
    denominator = np.abs(actual).sum()
    return {
        "scored_predictions": int(finite.sum()), "missing_actual_count": int((~finite).sum()),
        "mape_excluded_zero_count": int((~nonzero).sum()),
        "mae": float(error.mean()) if len(error) else np.nan,
        "rmse": float(np.sqrt(np.square(error).mean())) if len(error) else np.nan,
        "mape_pct": float(100 * (error[nonzero] / np.abs(actual[nonzero])).mean()) if nonzero.any() else np.nan,
        "wape_pct": float(100 * error.sum() / denominator) if denominator else np.nan,
    }


def metrics_by_horizon(predictions, horizons):
    rows = []
    group_keys = ["series_id", "target_id", "unit", "phase", "training_policy", "model_id"]
    for keys, frame in predictions.groupby(group_keys, sort=False):
        for horizon in horizons:
            if frame["lead_day"].max() < horizon:
                continue
            part = frame.loc[frame["lead_day"].le(horizon)]
            rows.append(dict(zip(group_keys, keys)) | {
                "horizon_days": horizon,
                "folds": part["origin"].nunique(),
                "training_start_min": part["train_start"].min(),
                "training_end_max": part["train_end"].max(),
                "training_days_min": part["train_calendar_days"].min(),
                "training_days_max": part["train_calendar_days"].max(),
                "validation_start": part["date"].min(), "validation_end": part["date"].max(),
            } | error_metrics(part["actual_trips"], part["forecast_trips"]))
    metrics = pd.DataFrame(rows)
    if metrics.empty:
        return metrics
    baseline_key = ["series_id", "phase", "horizon_days"]
    baseline = metrics.loc[
        metrics["model_id"].isin([NAIVE, f"bottom_up_{NAIVE}"]) & metrics["training_policy"].eq(FULL),
        baseline_key + ["wape_pct"],
    ].rename(columns={"wape_pct": "seasonal_naive_wape_pct"})
    metrics = metrics.merge(baseline, on=baseline_key, how="left", validate="many_to_one")
    metrics["wape_improvement_pp_vs_seasonal_naive"] = metrics["seasonal_naive_wape_pct"] - metrics["wape_pct"]
    metrics["wape_improvement_pct_vs_seasonal_naive"] = (
        100 * metrics["wape_improvement_pp_vs_seasonal_naive"]
        / metrics["seasonal_naive_wape_pct"].replace(0, np.nan)
    )
    return metrics


def choose_model(metrics, policy):
    frame = metrics.loc[metrics["training_policy"].eq(policy)]
    scores = frame.groupby("model_id")["wape_pct"].mean().to_dict()
    if not scores or not all(np.isfinite(list(scores.values()))):
        raise ValueError("Model comparison has an undefined selection score")
    winner = min(MODELS, key=lambda model: (scores[model], MODELS.index(model)))
    return winner, scores


def fit_series(series_id, series, holidays, config):
    mature = len(series) >= config["mature_min_history_days"]
    plan = make_plan(series, mature, config)
    if plan is None:
        return None
    origins, horizons = plan["origins"], plan["horizons"]
    selection = fold_rows(series_id, series, MODELS, origins, max(horizons), VALIDATION, FULL,
                          mature, holidays, config)
    winner, scores = choose_model(metrics_by_horizon(selection, horizons), FULL)
    policy = FULL
    partitions = [selection]
    sensitivity = None
    if series_id in (SHAH, OD):
        common = [origin for origin in origins if
                  series.loc[PAID_START:origin].notna().sum() >= config["intervention_min_training_days"]]
        sensitivity = {
            "opening_boundary_has_no_effect_on_eligible_history": series.index[0] >= OPENING,
            "post_boundary": stamp(PAID_START), "baseline_training_days": len(series),
            "post_training_days": len(series.loc[PAID_START:]), "matched_origins": list(map(stamp, common)),
        }
        if common:
            matched_full = selection.loc[selection["origin"].isin(common)].assign(phase=MATCHED)
            matched_post = fold_rows(
                series_id, series, MODELS, common, max(horizons), MATCHED, POST, mature, holidays, config,
            )
            matched = pd.concat([matched_full, matched_post], ignore_index=True)
            partitions.append(matched)
            matched_metrics = metrics_by_horizon(matched, horizons)
            post_winner, post_scores = choose_model(matched_metrics, POST)
            matched_full_winner, full_scores = choose_model(matched_metrics, FULL)
            switch = (len(common) >= config["intervention_min_common_folds_for_selection"]
                      and post_scores[post_winner] < full_scores[matched_full_winner])
            sensitivity.update({
                "full_model_scores": full_scores, "post_model_scores": post_scores,
                "full_comparison_model": matched_full_winner, "post_comparison_model": post_winner,
                "post_minus_full_wape_score_pp": post_scores[post_winner] - full_scores[matched_full_winner],
                "matched_wape_score_change_by_model_pp": {
                    candidate: post_scores[candidate] - full_scores[candidate] for candidate in MODELS
                },
                "minimum_matched_folds_for_switch": config["intervention_min_common_folds_for_selection"],
                "post_selected": switch,
            })
            if switch:
                winner, policy = post_winner, POST
    if plan["holdout_days"]:
        partitions.append(fold_rows(series_id, series, [NAIVE], [plan["holdout_origin"]],
                                   plan["holdout_days"], HOLDOUT, FULL, mature, holidays, config))
        if (winner, policy) != (NAIVE, FULL):
            partitions.append(fold_rows(series_id, series, [winner], [plan["holdout_origin"]],
                                       plan["holdout_days"], HOLDOUT, policy, mature, holidays, config))
    # Change all observations after an origin and verify that multistep predictions are invariant.
    test_origin = origins[-1]
    mutated = series.copy()
    mutated.loc[mutated.index > test_origin] = mutated.loc[mutated.index > test_origin] * 2 + 999
    for model in MODELS:
        before = predict_at(series, model, test_origin, max(horizons), FULL, mature, holidays, config)[0]
        after = predict_at(mutated, model, test_origin, max(horizons), FULL, mature, holidays, config)[0]
        if not np.array_equal(before, after):
            raise ValueError(f"Future observation leakage in {series_id} / {model}")
    return {
        "series_id": series_id, "mature": mature, "model": winner, "policy": policy,
        "plan": plan, "predictions": pd.concat(partitions, ignore_index=True),
        "rolling_full_scores": scores, "intervention": sensitivity,
        "future_actual_mutation_test_passed": True,
    }
