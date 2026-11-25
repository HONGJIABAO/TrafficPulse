"""Matched-origin transfer, stability and feature experiments."""

from dataclasses import replace

import numpy as np
import pandas as pd

from forecast_evaluation import (
    DAY, FULL, HOLDOUT, MATCHED, POST, VALIDATION, error_metrics, fold_rows, predict_at,
    target_and_unit, training_slice,
)
from forecast_inputs import NETWORK, OD, SERVICES, SHAH
from forecast_models import ETS, MODELS, NAIVE, calendar_design, causal_fill, ridge_forecast
from forecast_results import NETWORK_UNIT
from run_validation import require


SHORT = (SHAH, OD)
DONORS = tuple(key for key in SERVICES if key != SHAH)


def identity(key):
    target, unit = target_and_unit(key)
    return {"series_id": key, "target_id": target, "unit": NETWORK_UNIT if key == NETWORK else unit}


def recent_mean(history, dates, days):
    recent = history.iloc[-days:]
    profile = recent.groupby(recent.index.dayofweek).mean()
    matched = profile.reindex(dates.dayofweek)
    require(matched.notna().all(), "Recent baseline lacks one or more weekdays")
    return float(matched.mean())


def origin_dates(metadata, key):
    return pd.to_datetime(metadata["models"][key]["plan"]["origins"])


def require_matched(predictions, label, expected_arms):
    signatures = []
    for _, part in predictions.groupby(label, sort=False):
        keys = part.set_index(["origin", "date"]).sort_index()
        lead = (keys.index.get_level_values("date") - keys.index.get_level_values("origin")).days
        require(keys.index.is_unique and (lead > 0).all() and np.array_equal(lead, keys["lead_day"]),
                "Invalid evaluation keys or lead days")
        if "train_end" in keys:
            require((keys["train_end"].to_numpy() <= keys.index.get_level_values("origin").to_numpy()).all(),
                    "Evaluation includes future training dates")
        require(np.isfinite(keys["forecast_trips"]).all() and keys["forecast_trips"].ge(0).all(),
                "Invalid comparison forecast")
        signatures.append(keys["actual_trips"])
    require(len(signatures) == expected_arms, f"Missing comparison arm for {label}")
    for actual in signatures[1:]:
        pd.testing.assert_series_equal(signatures[0], actual, check_dtype=False)


def score(frame, groups, horizons):
    rows = []
    for keys, part in frame.groupby(groups, sort=False):
        max_lead = part.groupby("origin")["lead_day"].transform("max")
        for horizon in horizons:
            scored = part.loc[max_lead.ge(horizon) & part["lead_day"].le(horizon)]
            if scored.empty:
                continue
            rows.append(dict(zip(groups, keys)) | {
                "horizon_days": horizon, "folds": scored["origin"].nunique(),
                "first_origin": scored["origin"].min(), "last_origin": scored["origin"].max(),
                "last_scored_date": scored["date"].max(),
            } | error_metrics(scored["actual_trips"], scored["forecast_trips"]))
    return pd.DataFrame(rows)


def profile_before(series, origin, days):
    training = series.loc[origin - (days - 1) * DAY:origin].dropna()
    grouped = training.groupby(training.index.dayofweek)
    require(grouped.size().reindex(range(7), fill_value=0).ge(4).all(), "Insufficient weekday observations")
    profile = grouped.mean().reindex(range(7))
    level = float(profile.mean())
    require(level > 0 and training.index[-1] <= origin, "Invalid profile training data")
    return profile / level, level, training.index[-1]


def transfer_at(target, donors, origin, dates, settings):
    target_profile, _, last_target = profile_before(target, origin, settings["profile_lookback_days"])
    _, target_level, level_end = profile_before(target, origin, settings["recent_baseline_days"])
    donor_profiles = [profile_before(series, origin, settings["profile_lookback_days"]) for series in donors]
    donor_profile = pd.concat([item[0] for item in donor_profiles], axis=1).mean(axis=1)
    max_donor = max(item[2] for item in donor_profiles)
    require(max_donor <= origin and max(last_target, level_end) <= origin, "Future transfer training data")
    predictions = {}
    for weight in [0.0, *settings["transfer_weights"]]:
        name = "target_profile" if weight == 0 else f"transfer_{round(100 * weight)}"
        shape = (1 - weight) * target_profile + weight * donor_profile
        predictions[name] = (weight, target_level * shape.reindex(dates.dayofweek).to_numpy())
    return predictions, target_level, last_target, max_donor


def add_cold_deltas(metrics, keys):
    for arm in ("seasonal_naive", "step2_selected", "target_profile"):
        baseline = metrics.loc[metrics["arm"].eq(arm), keys + ["wape_pct"]].rename(
            columns={"wape_pct": f"{arm}_wape_pct"},
        )
        metrics = metrics.merge(baseline, on=keys, validate="many_to_one")
        metrics[f"wape_gain_pp_vs_{arm}"] = metrics[f"{arm}_wape_pct"] - metrics["wape_pct"]
    return metrics


def cold_start(series, saved, metadata, settings):
    groups = ["series_id", "target_id", "unit", "arm", "source_model_id", "donor_weight"]
    results, fold_results = [], []
    donors = [series[donor] for donor in DONORS]
    for key in SHORT:
        fit = metadata["models"][key]
        require(fit["policy"] == FULL, "Cold-start comparison expects saved full-history Step 2 selection")
        origins = origin_dates(metadata, key)
        horizons = fit["plan"]["horizons"]
        cached = saved.loc[saved["series_id"].eq(key) & saved["phase"].eq(VALIDATION)]
        arms = [
            cached.loc[cached["model_id"].eq(model)].assign(
                arm=arm, source_model_id=model, donor_weight=0.0, last_donor_observation=pd.NaT,
                target_level=np.nan,
            )
            for arm, model in [("seasonal_naive", NAIVE), ("step2_selected", fit["model"])]
        ]
        for origin in origins:
            dates = pd.date_range(origin + DAY, periods=max(horizons))
            forecast, level, target_end, donor_end = transfer_at(series[key], donors, origin, dates, settings)
            # Mutate every target and donor observed value after this origin.
            mutated = [s.where(s.index <= origin, s * 3 + 1e7) for s in [series[key], *donors]]
            check = transfer_at(mutated[0], mutated[1:], origin, dates, settings)[0]
            for arm, (weight, values) in forecast.items():
                np.testing.assert_array_equal(values, check[arm][1])
                arms.append(pd.DataFrame(identity(key) | {
                    "arm": arm, "source_model_id": "normalized_weekday_profile", "donor_weight": weight,
                    "origin": origin, "date": dates, "lead_day": np.arange(1, len(dates) + 1),
                    "actual_trips": series[key].reindex(dates).to_numpy(),
                    "forecast_trips": values, "train_end": target_end,
                    "last_donor_observation": donor_end if weight else pd.NaT, "target_level": level,
                }))
        comparison = pd.concat(arms, ignore_index=True)
        require_matched(comparison, "arm", len(settings["transfer_weights"]) + 3)
        donor_dates = comparison["last_donor_observation"]
        require(set(comparison["origin"]) == set(origins)
                and comparison["train_end"].le(comparison["origin"]).all()
                and (donor_dates.isna() | donor_dates.le(comparison["origin"])).all(),
                "Cold-start chronology failed")
        aggregate = score(comparison, groups, horizons)
        folds = score(comparison, groups + ["origin"], horizons)
        provenance = comparison.groupby(["arm", "origin"], as_index=False).agg(
            last_target_observation=("train_end", "max"),
            last_donor_observation=("last_donor_observation", "max"),
            target_level=("target_level", "first"),
        )
        results.append(add_cold_deltas(aggregate, ["series_id", "horizon_days"]))
        fold_results.append(add_cold_deltas(folds.merge(
            provenance, on=["arm", "origin"], validate="many_to_one",
        ), ["series_id", "origin", "horizon_days"]))
    return pd.concat(results, ignore_index=True), pd.concat(fold_results, ignore_index=True)


def holt_components(predictions, damping, period):
    # Identical weekdays one week apart isolate the damped trend.
    factor = np.cumsum(damping ** np.arange(1, len(predictions) + 1))
    slope = (predictions[period] - predictions[0]) / (factor[period] - factor[0])
    drift = slope * factor
    first_week = predictions[:period] - drift[:period]
    anchor = float(first_week.mean())
    seasonal = np.resize(first_week - anchor, len(predictions))
    np.testing.assert_allclose(predictions, anchor + drift + seasonal, rtol=1e-10, atol=1e-7)
    return anchor, drift, seasonal


def prediction_frame(key, variant, model, dates, values, train, cutoff):
    return pd.DataFrame(identity(key) | {
        "variant": variant, "model_id": model, "date": dates, "data_cutoff": cutoff,
        "train_start": train["train_start"], "train_end": train["train_end"],
        "lead_day": np.arange(1, len(dates) + 1), "forecast_trips": values,
    })


def summarize_future(part, observed, settings):
    recent = recent_mean(observed, pd.DatetimeIndex(part["date"]), settings["recent_baseline_days"])
    mean = float(part["forecast_trips"].mean())
    return {column: part[column].iat[0] for column in (
        "series_id", "target_id", "unit", "variant", "model_id", "data_cutoff", "train_start", "train_end",
    )} | {
        "phase": "forecast_sensitivity", "horizon_days": len(part),
        "forecast_start": part["date"].iat[0], "forecast_end": part["date"].iat[-1],
        "weekday_matched_recent_mean": recent, "forecast_mean_trips": mean,
        "forecast_total_trips": float(part["forecast_trips"].sum()),
        "change_vs_recent_pct": 100 * (mean / recent - 1),
        "last_minus_first_week_trips_per_day": float(
            part["forecast_trips"].iloc[-7:].mean() - part["forecast_trips"].iloc[:7].mean()
        ),
    }


def stability(series, saved, original, metadata, holidays, config, settings):
    horizon = config["forecast_days"]
    future_parts, summary_rows = [], []
    groups = ["series_id", "target_id", "unit", "phase", "variant", "model_id"]

    def future(key, variant, model, policy=FULL, lookback=None):
        observed = series[key]
        cutoff = observed.index[-1]
        model_config = config if lookback is None else config | {"mature_lookback_days": lookback}
        mature = lookback is not None or metadata["models"].get(key, {}).get("mature", False)
        values, dates, train, params = predict_at(
            observed, model, cutoff, horizon, policy, mature, holidays, model_config,
        )
        part = prediction_frame(key, variant, model, dates, values, train, cutoff)
        future_parts.append(part)
        row = summarize_future(part, observed, settings)
        if model == ETS and key in SHORT:
            anchor, drift, seasonal = holt_components(values, params["damp"], config["seasonal_period"])
            row.update({
                "holt_level_plus_average_season": anchor,
                "holt_level_gap_per_day": anchor - row["weekday_matched_recent_mean"],
                "holt_mean_damped_trend_per_day": float(drift.mean()),
                "holt_seasonal_mix_per_day": float(seasonal.mean()),
            })
            if variant == FULL:
                no_drift = part.assign(variant="holt_without_drift", forecast_trips=np.maximum(0, anchor + seasonal))
                future_parts.append(no_drift)
                summary_rows.append(summarize_future(no_drift, observed, settings))
        summary_rows.append(row)
        return part

    full = {}
    for key in (*SERVICES, OD):
        for model in MODELS:
            part = future(key, FULL, model)
            full[key, model] = part
            fit = metadata["models"][key]
            if model == fit["model"] and fit["policy"] == FULL:
                np.testing.assert_array_equal(part["forecast_trips"], original[key]["forecast_trips"])
            if key in SHORT:
                future(key, POST, model, policy=POST)
                future(key, "recent_window", model, lookback=settings["short_training_window_days"])
        if key in SHORT:
            observed = series[key]
            cutoff = observed.index[-1]
            dates = pd.date_range(cutoff + DAY, periods=horizon)
            days = settings["recent_baseline_days"]
            shape, level, _ = profile_before(observed, cutoff, days)
            profile = prediction_frame(
                key, "recent_weekday_level", "target_weekday_profile", dates,
                level * shape.reindex(dates.dayofweek).to_numpy(),
                {"train_start": observed.iloc[-days:].index[0], "train_end": cutoff}, cutoff,
            )
            future_parts.append(profile)
            summary_rows.append(summarize_future(profile, observed, settings))

    for phase, variant in [(VALIDATION, "original_full"), (MATCHED, "intervention_matched"),
                           (HOLDOUT, "retrospective_terminal")]:
        data = saved.loc[saved["series_id"].isin(SHORT) & saved["phase"].eq(phase)].copy()
        data["variant"] = variant if phase != MATCHED else data["training_policy"]
        if phase == MATCHED:
            for _, part in data.groupby("series_id"):
                require_matched(part.assign(arm=part["model_id"] + "/" + part["variant"]), "arm", 6)
        summary_rows.extend(score(data, groups, config["validation_horizons"]).to_dict("records"))

    for key in SHORT:
        observed = series[key]
        days = settings["short_training_window_days"]
        origins = [origin for origin in origin_dates(metadata, key) if observed.loc[:origin].size >= days]
        if not origins:
            continue
        full_rows = saved.loc[saved["series_id"].eq(key) & saved["phase"].eq(VALIDATION)
                              & saved["origin"].isin(origins)].assign(variant=FULL)
        latest_rows = fold_rows(
            key, observed, MODELS, origins, max(config["validation_horizons"]), VALIDATION,
            FULL, True, holidays, config | {"mature_lookback_days": days},
        ).assign(variant="recent_window")
        matched = pd.concat([full_rows, latest_rows], ignore_index=True)
        require_matched(matched.assign(arm=matched["model_id"] + "/" + matched["variant"]), "arm", 6)
        summary_rows.extend(score(
            matched.assign(phase="recent_window_matched"), groups, config["validation_horizons"],
        ).to_dict("records"))

    network = series[NETWORK]
    origins = origin_dates(metadata, SHAH)
    horizons = config["validation_horizons"]
    require(network.notna().all() and network.loc[:origins[0]].size >= config["short_min_fold_training_days"],
            "Insufficient aligned history for the direct network comparison")
    bottom = saved.loc[saved["series_id"].eq(NETWORK) & saved["phase"].eq(VALIDATION)].assign(
        variant="bottom_up_same_candidate",
    )
    direct = fold_rows(
        NETWORK, network, MODELS, origins, max(horizons), VALIDATION, FULL, False, holidays, config,
    ).assign(variant="direct_common_history", unit=NETWORK_UNIT)
    compare = pd.concat([bottom, direct])
    require_matched(compare.assign(arm=compare["model_id"] + "/" + compare["variant"]), "arm", 6)
    summary_rows.extend(score(compare.assign(phase="network_common_origins"), groups, horizons).to_dict("records"))
    terminal = saved.loc[saved["series_id"].eq(NETWORK) & saved["phase"].eq(HOLDOUT)].assign(
        variant="bottom_up", phase="retrospective_terminal",
    )
    summary_rows.extend(score(terminal, groups, horizons).to_dict("records"))
    for model in MODELS:
        future(NETWORK, "direct_common_history", model)
        reference = full[next(iter(SERVICES)), model]
        matrix = pd.concat([full[key, model].set_index("date")["forecast_trips"] for key in SERVICES], axis=1)
        require(matrix.notna().all().all() and matrix.index.equals(pd.DatetimeIndex(reference["date"])),
                "Bottom-up alternative forecast dates differ")
        part = prediction_frame(
            NETWORK, "bottom_up_same_candidate", model, matrix.index, matrix.sum(axis=1).to_numpy(),
            {"train_start": min(full[key, model]["train_start"].iat[0] for key in SERVICES),
             "train_end": reference["train_end"].iat[0]}, reference["data_cutoff"].iat[0],
        )
        future_parts.append(part)
        summary_rows.append(summarize_future(part, network, settings))
    return pd.DataFrame(summary_rows), pd.concat(future_parts, ignore_index=True)


def covered_holidays(calendar):
    tentative = {pd.Timestamp(row["date"]) for row in calendar.records if row["source_marks_date_tentative"]}
    confirmed = {pd.Timestamp(row["date"]) for row in calendar.records if not row["source_marks_date_tentative"]}
    return confirmed, tentative - confirmed


def ridge_ablation_at(train, future, calendar, config, variant):
    values, _ = causal_fill(train)
    if variant == "B":
        # The existing Step 2 ridge with the holiday feature disabled.
        return ridge_forecast(values, train.index, future, replace(calendar, dates=frozenset()), config)[0]
    dates = train.index.append(future)
    n = len(train)
    lags = config["ridge_lags_days"]
    start = max(lags)
    annual = variant != "A" and n >= config["ridge_annual_min_training_days"]
    design, names = calendar_design(
        dates, train.index[-1], frozenset(), annual, False, config["ridge_future_trend_damping_days"],
    )
    if variant == "A":
        design = design[:, np.array(names) != "trend_days"]
    elif variant == "C":
        holidays, tentative = covered_holidays(calendar)
        covered = dates.year.isin(calendar.years) & ~dates.isin(tentative)
        flags = dates.isin(holidays) & covered
        if flags[start:n].sum() >= 3:
            design = np.column_stack([design, covered.astype(float), flags.astype(float)])
    training = np.column_stack([design[start:n], *[values[start - lag:n - lag] for lag in lags]])
    mean, scale = training.mean(axis=0), training.std(axis=0)
    scale[scale < 1e-12] = 1.0
    standardized = (training - mean) / scale
    intercept = values[start:].mean()
    coefs = np.linalg.solve(
        standardized.T @ standardized + config["ridge_penalty"] * np.eye(standardized.shape[1]),
        standardized.T @ (values[start:] - intercept),
    )
    path = np.empty(n + len(future))
    path[:n] = values
    for i in range(n, len(path)):
        row = np.append(design[i], [path[i - lag] for lag in lags])
        path[i] = max(0.0, intercept + ((row - mean) / scale) @ coefs)
    return path[n:]


def ablation(series, metadata, calendar, config):
    horizons = config["validation_horizons"]
    confirmed, tentative = covered_holidays(calendar)
    results = []
    for key in DONORS:
        observed = series[key]
        origins = origin_dates(metadata, key)
        parts, coverage = [], []
        for origin in origins:
            train = training_slice(observed, origin, FULL, True, config)
            future = pd.date_range(origin + DAY, periods=max(horizons))
            mutated = observed.where(observed.index <= origin, observed * 3 + 1e7)
            alternate_train = training_slice(mutated, origin, FULL, True, config)
            require(train.index[-1] == origin and future[0] > train.index[-1], "Ablation lookahead")
            design_dates = train.index[max(config["ridge_lags_days"]):]
            known = design_dates.year.isin(calendar.years) & ~design_dates.isin(tentative)
            coverage.append((len(design_dates), int(known.sum()), int(design_dates.isin(confirmed).sum()),
                             len(train) >= config["ridge_annual_min_training_days"]))
            for variant in ("A", "B", "C"):
                values = ridge_ablation_at(train, future, calendar, config, variant)
                np.testing.assert_array_equal(values, ridge_ablation_at(alternate_train, future, calendar, config, variant))
                parts.append(pd.DataFrame(identity(key) | {
                    "variant": variant, "origin": origin, "date": future,
                    "lead_day": np.arange(1, len(future) + 1),
                    "actual_trips": observed.reindex(future).to_numpy(), "forecast_trips": values,
                }))
        compare = pd.concat(parts, ignore_index=True)
        require_matched(compare, "variant", 3)
        rows = score(compare, ["series_id", "target_id", "unit", "variant"], horizons)
        base = rows.pivot(index="horizon_days", columns="variant", values="wape_pct")
        previous = rows["variant"].map({"A": "A", "B": "A", "C": "B"})
        rows["wape_gain_pp_vs_previous"] = [
            base.loc[horizon, variant] - wape for horizon, variant, wape in zip(
                rows["horizon_days"], previous, rows["wape_pct"],
            )
        ]
        design_rows, known_rows, holiday_rows, annual = np.array(coverage).T
        rows["annual_feature_folds"] = np.where(rows["variant"].eq("A"), 0, annual.sum())
        rows["train_rows_with_known_holiday_status_pct"] = 100 * known_rows.sum() / design_rows.sum()
        rows["holiday_feature_folds"] = np.where(rows["variant"].eq("C"), (holiday_rows >= 3).sum(), 0)
        rows["training_confirmed_holiday_rows_min"] = holiday_rows.min()
        rows["training_confirmed_holiday_rows_max"] = holiday_rows.max()
        results.append(rows)
    return pd.concat(results, ignore_index=True)
