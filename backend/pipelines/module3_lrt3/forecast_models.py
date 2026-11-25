"""Small daily forecasting models that accept only observations available at the origin."""

from itertools import product

import numpy as np
import pandas as pd


NAIVE = "seasonal_naive_7"
ETS = "holt_winters_additive_damped"
RIDGE = "calendar_lag_ridge"
MODELS = (NAIVE, ETS, RIDGE)
MODEL_NAMES = {NAIVE: "Seasonal Naive (7 days)", ETS: "Damped additive Holt–Winters",
               RIDGE: "Calendar and lag ridge regression"}


def causal_fill(train):
    values = train.to_numpy(dtype=float, copy=True)
    filled = 0
    for i in np.flatnonzero(~np.isfinite(values)):
        same_weekday = values[i - 7] if i >= 7 else np.nan
        previous = values[i - 1] if i > 0 else np.nan
        fallback = same_weekday if np.isfinite(same_weekday) else previous
        if not np.isfinite(fallback):
            raise ValueError("Training begins with a missing demand value")
        values[i] = fallback
        filled += 1
    return values, filled


def holt_winters(values, horizon, period):
    # Fit the additive weekly, damped trend model by training-only one-step SSE.
    grid = np.array(list(product(
        (0.15, 0.35, 0.6, 0.85), (0.0, 0.05, 0.2), (0.08, 0.30, 0.60), (0.85, 0.95, 0.99),
    )))
    alpha, beta, gamma, phi = grid.T
    initial = values[:3 * period].reshape(3, period)
    week_levels = initial.mean(axis=1)
    seasonal = np.tile((initial - week_levels[:, None]).mean(axis=0), (len(grid), 1))
    level = np.full(len(grid), week_levels[0])
    slope = np.full(len(grid), np.median(np.diff(week_levels)) / period)
    score = np.zeros(len(grid))
    for i, actual in enumerate(values):
        phase = i % period
        prior_level = level + phi * slope
        previous_seasonal = seasonal[:, phase].copy()
        error = actual - prior_level - previous_seasonal
        if i >= 3 * period:
            score += error * error
        level = prior_level + alpha * error
        slope = phi * slope + beta * (level - prior_level)
        seasonal[:, phase] = previous_seasonal + gamma * error
    best = int(np.argmin(score))
    lead = np.arange(1, horizon + 1)
    drift = np.cumsum(phi[best] ** lead) * slope[best]
    prediction = level[best] + drift + seasonal[best, (len(values) + lead - 1) % period]
    return prediction, dict(zip(("alpha", "beta", "gamma", "damp"), grid[best].tolist()))


def calendar_design(dates, origin, holiday_dates, include_annual, include_holiday, damping_days):
    elapsed = (dates - origin).days.to_numpy(dtype=float)
    future = elapsed > 0
    elapsed[future] = damping_days * (-np.expm1(-elapsed[future] / damping_days))
    weekday = dates.dayofweek.to_numpy()
    features = {f"weekday_{i}": (weekday == i).astype(float) for i in range(6)}
    features["weekend"] = (weekday >= 5).astype(float)
    features["trend_days"] = elapsed
    if include_annual:
        angle = 2 * np.pi * ((dates - pd.Timestamp("2000-01-01")).days.to_numpy() / 365.2425)
        features["year_sine"] = np.sin(angle)
        features["year_cosine"] = np.cos(angle)
    if include_holiday:
        # Older years have no verified calendar. Those dates receive no holiday
        # adjustment and are not described as confirmed non-holidays.
        features["verified_holiday"] = dates.isin(holiday_dates).astype(float)
    return np.column_stack(list(features.values())), list(features)


def ridge_forecast(values, dates, future, holidays, config):
    lags = config["ridge_lags_days"]
    start = max(lags)
    annual = len(dates) >= config["ridge_annual_min_training_days"]
    covered_holidays = dates[start:].isin(holidays.dates).sum()
    use_holiday = covered_holidays >= 3
    calendar, names = calendar_design(
        dates.append(future), dates[-1], holidays.dates, annual, use_holiday,
        config["ridge_future_trend_damping_days"],
    )
    n = len(values)
    training = np.column_stack([calendar[start:n], *[values[start - lag:n - lag] for lag in lags]])
    mean = training.mean(axis=0)
    scale = training.std(axis=0)
    scale[scale < 1e-12] = 1.0
    standard = (training - mean) / scale
    response = values[start:]
    intercept = response.mean()
    penalty = config["ridge_penalty"]
    coefs = np.linalg.solve(
        standard.T @ standard + penalty * np.eye(standard.shape[1]),
        standard.T @ (response - intercept),
    )
    sequence = np.empty(n + len(future))
    sequence[:n] = values
    for i in range(n, len(sequence)):
        feature = np.append(calendar[i], [sequence[i - lag] for lag in lags])
        sequence[i] = max(0.0, intercept + ((feature - mean) / scale) @ coefs)
    return sequence[n:], {
        "ridge_penalty": penalty, "features": names + [f"lag_{lag}_days" for lag in lags],
        "training_rows_with_verified_holidays": int(covered_holidays),
        "future_trend_damping_days": config["ridge_future_trend_damping_days"],
    }


def predict(model, train, future, holidays, config):
    period = config["seasonal_period"]
    if len(train) < max(4 * period, max(config["ridge_lags_days"]) + 2):
        raise ValueError("Too few daily training observations")
    expected_train = pd.date_range(train.index[0], train.index[-1])
    expected_future = pd.date_range(train.index[-1] + pd.Timedelta(days=1), periods=len(future))
    if not train.index.equals(expected_train) or not future.equals(expected_future):
        raise ValueError("Training and future dates must be contiguous and adjacent")
    values, filled = causal_fill(train)
    if model == NAIVE:
        result, parameters = np.resize(values[-period:], len(future)), {"period_days": period}
    elif model == ETS:
        result, parameters = holt_winters(values, len(future), period)
    elif model == RIDGE:
        result, parameters = ridge_forecast(values, train.index, future, holidays, config)
    else:
        raise ValueError(f"Unknown forecast model {model}")
    result = np.maximum(0, result)
    if not np.isfinite(result).all():
        raise ValueError(f"Non-finite predictions for {model}")
    return result, parameters | {"training_missing_values_filled_causally": filled}
