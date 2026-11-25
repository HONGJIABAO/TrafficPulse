"""Produce forecast views, coherent network totals and demand-pattern statistics."""

import numpy as np
import pandas as pd

from forecast_evaluation import (
    DAY, FULL, HOLDOUT, MATCHED, VALIDATION, fold_rows, predict_at, target_and_unit,
)
from forecast_inputs import HEADLINE, NAMES, NETWORK, OD, SERVICES, SHAH, stamp
from forecast_models import MODELS, NAIVE


BOTTOM_UP = "bottom_up_selected_components"
NETWORK_UNIT = "sum_of_headline_service_trips"


def selected_predictions(fit, phase):
    prediction = fit["predictions"]
    return prediction.loc[
        prediction["phase"].eq(phase) & prediction["training_policy"].eq(fit["policy"])
        & prediction["model_id"].eq(fit["model"])
    ]


def make_forecast(series, fit, holidays, config):
    series_id = fit["series_id"]
    target, unit = target_and_unit(series_id)
    cutoff = series.index[-1]
    values, future, train, parameters = predict_at(
        series, fit["model"], cutoff, config["forecast_days"], fit["policy"], fit["mature"], holidays, config,
    )
    frame = pd.DataFrame({
        "date": future, "series_id": series_id, "target_id": target, "unit": unit,
        "service_name": NAMES[series_id], "data_cutoff": cutoff,
        "forecast_trips": values, "lead_day": np.arange(1, len(future) + 1),
        "model_id": fit["model"], "training_policy": fit["policy"],
        "verified_holiday": future.isin(holidays.dates),
        "holiday_calendar_known": future.year.isin(holidays.years),
    })
    return frame, train | parameters


def bottom_up_results(series, fits, forecasts, holidays, config):
    if not all(service in fits for service in SERVICES):
        return None, None, None, {"available": False, "reason": "A published service has no eligible forecast."}
    ids = list(SERVICES)
    if len({series[key].index[-1] for key in ids}) != 1:
        return None, None, None, {"available": False, "reason": "Component forecast cutoffs differ."}
    joined = pd.concat([series[key].rename(key) for key in ids], axis=1)
    start = max(series[key].index[0] for key in ids)
    network = joined.sum(axis=1, min_count=len(ids)).loc[start:]
    final = forecasts[ids[0]].copy()
    matrix = pd.concat([forecasts[key].set_index("date")["forecast_trips"].rename(key) for key in ids], axis=1)
    final["forecast_trips"] = matrix.sum(axis=1, min_count=len(ids)).reindex(final["date"]).to_numpy()
    final = final.assign(series_id=NETWORK, target_id=HEADLINE, unit=NETWORK_UNIT,
                         service_name=NAMES[NETWORK], model_id=BOTTOM_UP, training_policy="by_component")
    start_dates = fits[SHAH]["plan"]["origins"]
    max_horizon = max(fits[SHAH]["plan"]["horizons"])
    predictions = []
    for service in ids:
        predictions.append(fold_rows(
            service, series[service], MODELS, start_dates, max_horizon, "network_component_validation",
            FULL, fits[service]["mature"], holidays, config,
        ))
    parts = pd.concat(predictions, ignore_index=True)

    def aggregate_components(frame, model_id, phase):
        keys = ["origin", "date", "lead_day"]
        grouped = frame.groupby(keys, as_index=False).agg(
            actual_trips=("actual_trips", lambda x: x.sum(min_count=len(ids))),
            forecast_trips=("forecast_trips", "sum"),
            train_start=("train_start", "min"), train_end=("train_end", "max"),
            train_calendar_days=("train_calendar_days", "min"),
            train_observed_days=("train_observed_days", "min"),
            train_filled_days=("train_filled_days", "sum"),
            component_count=("series_id", "nunique"), rows=("series_id", "size"),
        )
        if not (grouped["component_count"].eq(len(ids)) & grouped["rows"].eq(len(ids))).all():
            raise ValueError("Incomplete network backtest component set")
        return grouped.drop(columns=["rows", "component_count"]).assign(
            series_id=NETWORK, target_id=HEADLINE, unit=NETWORK_UNIT, phase=phase, model_id=model_id,
            training_policy=FULL if model_id.startswith("bottom_up_") and model_id != BOTTOM_UP else "by_component",
        )

    totals = [aggregate_components(parts.loc[parts["model_id"].eq(model)], f"bottom_up_{model}", VALIDATION)
              for model in MODELS]
    holdout_origin = fits[SHAH]["plan"]["holdout_origin"]
    if holdout_origin is not None and all(
        fit["predictions"].loc[fit["predictions"]["phase"].ne(HOLDOUT), "date"].max() <= holdout_origin
        for fit in (fits[key] for key in ids)
    ):
        holdout_days = fits[SHAH]["plan"]["holdout_days"]
        base, selected = [], []
        for series_id in ids:
            fit = fits[series_id]
            base.append(fold_rows(series_id, series[series_id], [NAIVE], [holdout_origin],
                                  holdout_days, "network_component_holdout", FULL,
                                  fit["mature"], holidays, config))
            selected.append(fold_rows(series_id, series[series_id], [fit["model"]], [holdout_origin],
                                      holdout_days, "network_component_holdout_selected", fit["policy"],
                                      fit["mature"], holidays, config))
        base_parts = pd.concat(base, ignore_index=True)
        selected_parts = pd.concat(selected, ignore_index=True)
        parts = pd.concat([parts, base_parts, selected_parts], ignore_index=True)
        totals.extend([
            aggregate_components(base_parts, f"bottom_up_{NAIVE}", HOLDOUT),
            aggregate_components(selected_parts, BOTTOM_UP, HOLDOUT),
        ])
    backtests = pd.concat([parts, *totals], ignore_index=True)
    return final, network, backtests, {
        "available": True, "components": ids, "data_cutoff": stamp(network.index[-1]),
        "history_start": stamp(network.index[0]), "unit": NETWORK_UNIT,
        "definition": "Bottom-up sum of the six distinct published Rapid Rail service series. "
        "The common history requires all components, with no implicit pre-service zeros. "
        "This is a service-count total. Journey-level transfer deduplication is unavailable.",
        "rolling_evaluation": "Common Shah Alam headline origins. Each candidate is applied to all "
        "components for comparison. The mixed selected ensemble is scored on the common terminal "
        "holdout after model choices are frozen.",
    }


def conventional_history_row(network):
    observed = network.notna()
    return pd.DataFrame({
        "date": network.index, "series_id": NETWORK, "target_id": HEADLINE,
        "service_name": NAMES[NETWORK], "unit": NETWORK_UNIT, "actual_trips": network.astype("Int64").array,
        "source_status": np.select([network.eq(0), observed],
                                   ["observed_zero", "observed_positive"], default="incomplete_components"),
        "source_row_present": observed.to_numpy(), "in_model_calendar": True,
    })


def forecast_views(series_id, past, future, fit, metrics, config):
    recent_days = config["recent_baseline_days"]
    recent = past.iloc[-recent_days:]
    prior = past.iloc[-2 * recent_days:-recent_days]
    weekday_mean = recent.groupby(recent.index.dayofweek).mean()
    model, policy = future.loc[future.index[0], ["model_id", "training_policy"]]
    validation_phase = MATCHED if policy == "from_paid_service" else VALIDATION
    if series_id == NETWORK:
        validation_phase = HOLDOUT
    selected_metrics = metrics.loc[
        metrics["series_id"].eq(series_id) & metrics["model_id"].eq(model)
        & metrics["phase"].eq(validation_phase) & metrics["training_policy"].eq(policy)
    ]
    rows = []
    for days in config["dashboard_windows"]:
        period = future.iloc[:days]
        expected = period["date"].dt.dayofweek.map(weekday_mean)
        comparison = float(expected.mean()) if expected.notna().all() else np.nan
        average = float(period["forecast_trips"].mean())
        scalars = {
            "series_id": series_id, "target_id": period["target_id"].iat[0], "unit": period["unit"].iat[0],
            "service_name": NAMES[series_id], "view_days": days, "data_cutoff": past.index[-1],
            "first_observed_date": past.first_valid_index(),
            "forecast_start": period["date"].min(), "forecast_end": period["date"].max(),
            "model_id": model, "training_policy": policy,
            "recent_start": recent.index.min(), "recent_end": recent.index.max(),
            "recent_observed_days": int(recent.notna().sum()), "recent_observed_daily_mean": recent.mean(),
            "weekday_matched_recent_daily_mean": comparison,
            "forecast_daily_mean": average, "forecast_total_trips": period["forecast_trips"].sum(),
            "change_vs_weekday_matched_recent_pct": 100 * (average / comparison - 1) if comparison > 0 else np.nan,
            "previous_28d_daily_mean": prior.mean() if prior.notna().sum() == recent_days else np.nan,
            "recent_vs_previous_28d_pct": 100 * (recent.mean() / prior.mean() - 1)
            if recent.notna().sum() == prior.notna().sum() == recent_days and prior.mean() > 0 else np.nan,
            "reported_metric_phase": validation_phase,
            "selection_score_mean_wape_pct": selected_metrics["wape_pct"].mean() if fit is not None else np.nan,
        }
        for horizon in config["validation_horizons"]:
            metric = selected_metrics.loc[selected_metrics["horizon_days"].eq(horizon)]
            for field in ["wape_pct", "mae", "rmse", "mape_pct", "folds"]:
                scalars[f"{field}_{horizon}d"] = metric[field].iat[0] if len(metric) else np.nan
        rows.append(scalars)
    return rows


def build_scenarios(forecast, fit, config):
    scenarios = forecast[["date", "data_cutoff", "lead_day", "series_id", "unit", "model_id",
                          "forecast_trips"]].rename(columns={"forecast_trips": "base_trips"}).copy()
    assumptions = config["scenarios"]
    low, high = assumptions["low_day_90_offset_from_base"], assumptions["high_day_90_offset_from_base"]
    if not -1 <= low <= 0 <= high:
        raise ValueError("Planning offsets must satisfy -1 <= Low <= 0 <= High")
    progress = scenarios["lead_day"] / config["forecast_days"]
    scenarios["low_multiplier"] = 1 + low * progress
    scenarios["high_multiplier"] = 1 + high * progress
    scenarios["low_trips"] = scenarios["base_trips"] * scenarios["low_multiplier"]
    scenarios["high_trips"] = scenarios["base_trips"] * scenarios["high_multiplier"]
    output = forecast.copy()
    output["empirical_lower_trips"] = np.nan
    output["empirical_upper_trips"] = np.nan
    output["empirical_residual_count"] = pd.Series(pd.NA, index=output.index, dtype="Int64")
    phase = MATCHED if fit["policy"] != FULL else VALIDATION
    residuals = selected_predictions(fit, phase).dropna(subset=["actual_trips"])
    holdout = selected_predictions(fit, HOLDOUT).dropna(subset=["actual_trips"])
    bands = []
    uncertainty = config["uncertainty"]
    for lo, hi in uncertainty["lead_bands"]:
        subset = residuals.loc[residuals["lead_day"].between(lo, hi)]
        error = subset["actual_trips"] - subset["forecast_trips"]
        band = {"lead_start": lo, "lead_end": hi, "count": len(error),
                "origins": subset["origin"].nunique(), "unique_actual_dates": subset["date"].nunique()}
        if len(error) >= uncertainty["minimum_residuals_per_band"]:
            lower, upper = map(float, error.quantile(uncertainty["quantiles"]).tolist())
            leads = output["lead_day"].between(lo, hi)
            output.loc[leads, "empirical_lower_trips"] = (output.loc[leads, "forecast_trips"] + lower).clip(lower=0)
            output.loc[leads, "empirical_upper_trips"] = (output.loc[leads, "forecast_trips"] + upper).clip(lower=0)
            output.loc[leads, "empirical_residual_count"] = len(error)
            test = holdout.loc[holdout["lead_day"].between(lo, hi)]
            test_error = test["actual_trips"] - test["forecast_trips"]
            band.update({"residual_lower_quantile": lower, "residual_upper_quantile": upper,
                         "holdout_points": len(test), "holdout_inside": int(test_error.between(lower, upper).sum())})
        bands.append(band)
    return output, scenarios, {
        "planning_scenarios": {
            "unit": "station_origin_trips", "low_offset_at_day_90": low, "high_offset_at_day_90": high,
            "formula": "Base times (1 + offset times lead_day / 90). Base is the selected model.",
            "interpretation": "Planning sensitivity, configurable in forecast_settings.json.",
        },
        "empirical_residual_bands": {
            "method": "Quantiles of signed rolling-origin errors added to the final point forecasts.",
            "quantiles": uncertainty["quantiles"], "bands": bands,
            "limitation": "Selection residuals overlap in calendar dates and have few origins. "
            "Nominal quantile ranks are descriptive. No calibration claim or extrapolation past observed leads.",
        },
    }


def demand_patterns(series_dict, holidays, config):
    rows = []
    for series_id, values in series_dict.items():
        target, unit = target_and_unit(series_id)
        if series_id == NETWORK:
            unit = NETWORK_UNIT
        cutoff = values.index[-1]
        recent_year = values.loc[cutoff - 364 * DAY:].dropna()
        attrs = dict(series_id=series_id, service_name=NAMES[series_id], target_id=target, unit=unit)

        def add(pattern, key, data, reference=None, expected_days=None):
            mean = data.mean()
            ref = reference.mean() if reference is not None else np.nan
            rows.append(attrs | {
                "pattern": pattern, "group": key, "period_start": data.index.min(),
                "period_end": data.index.max(), "observed_days": int(data.notna().sum()),
                "expected_days": expected_days, "mean_daily_trips": mean,
                "reference_mean_daily_trips": ref,
                "reference_observations": len(reference) if reference is not None else 0,
                "difference_pct": 100 * (mean / ref - 1) if ref > 0 else np.nan,
            })

        for day, part in recent_year.groupby(recent_year.index.day_name()):
            add("day_of_week", day, part)
        weekdays = recent_year.loc[recent_year.index.dayofweek < 5]
        weekends = recent_year.loc[recent_year.index.dayofweek >= 5]
        add("day_type", "Weekday", weekdays)
        add("day_type", "Weekend vs weekday", weekends, weekdays)
        for month, part in values.groupby(values.index.to_period("M")):
            add("calendar_month", str(month), part, expected_days=month.days_in_month)
        if len(values) >= config["mature_min_history_days"]:
            two_year = values.iloc[-config["mature_lookback_days"]:].dropna()
            for month, part in two_year.groupby(two_year.index.month):
                add("month_of_year_recent_730_days", f"{month:02d}", part)
        size = config["recent_baseline_days"]
        if len(values) >= 2 * size:
            add("recent_vs_prior_28d", "Equal-length, weekday-aligned windows",
                values.iloc[-size:], values.iloc[-2 * size:-size])

        known = recent_year.loc[recent_year.index.year.isin(holidays.years)]
        dated_holidays = known.loc[known.index.isin(holidays.dates)]
        ordinary = known.loc[~known.index.isin(holidays.dates)]
        comparators = {}
        for date in dated_holidays.index:
            mask = ((ordinary.index.dayofweek == date.dayofweek)
                    & (np.abs((ordinary.index - date).days) <= 28))
            matches = ordinary.loc[mask]
            if not matches.empty:
                comparators[date] = matches.mean()
        if comparators:
            paired = pd.Series(comparators, dtype=float)
            add("holiday_vs_comparable_nonholiday", "Same weekday within 28 days, known calendar years",
                dated_holidays.reindex(paired.index), paired)
    return pd.DataFrame(rows)
