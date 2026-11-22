"""
module3_demand_forecast.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 3: Demand Drivers & Forecasting
Output: frontend/src/data/forecast_demand.json

Merges monthly rail ridership with external drivers (fuel price, vehicle
registrations, labour force, air pollution) and trains a LightGBM +
Holt-Winters ensemble for 3-, 6-, 12-month demand forecasts with CI.
"""

import sys, warnings
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
warnings.filterwarnings("ignore")

import numpy as np
import polars as pl
from config import RAW_DATA_DIR, save_frontend_json

RAIL_COLS = [
    "rail_lrt_ampang", "rail_mrt_kajang", "rail_lrt_kj", "rail_monorail",
    "rail_mrt_pjy", "rail_lrt_shah_alam", "rail_ets", "rail_intercity",
    "rail_komuter_utara", "rail_tebrau", "rail_komuter",
]


def load_monthly_ridership() -> pl.DataFrame:
    """Aggregate daily ridership_headline.csv to monthly rail totals."""
    rh = pl.read_csv(RAW_DATA_DIR / "ridership_headline.csv")
    rh = rh.with_columns([
        pl.col(c).cast(pl.Float64, strict=False) for c in RAIL_COLS
    ])
    rh = rh.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    rh = rh.with_columns(
        pl.sum_horizontal([pl.col(c) for c in RAIL_COLS]).alias("rail_total")
    )
    rh = rh.filter(pl.col("rail_total").is_not_null())
    rh = rh.with_columns([
        pl.col("date").dt.year().alias("year"),
        pl.col("date").dt.month().alias("month"),
        (pl.col("date").dt.year().cast(pl.String) + "-" +
         pl.col("date").dt.month().cast(pl.String).str.zfill(2) + "-01").alias("month_start"),
    ])
    monthly = (
        rh.group_by(["month_start", "year", "month"])
        .agg([pl.col("rail_total").sum().alias("rail_total")]
             + [pl.col(c).sum().alias(c) for c in RAIL_COLS])
        .sort(["year", "month"])
    )
    monthly = monthly.with_columns(
        pl.col("month_start").str.to_date("%Y-%m-%d").alias("date")
    )
    return monthly


def load_fuel_monthly() -> pl.DataFrame:
    """Fuel prices: level series only, resampled to monthly average."""
    fp = pl.read_csv(RAW_DATA_DIR / "fuelprice.csv")
    fp = fp.filter(pl.col("series_type") == "level")
    fp = fp.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    fp = fp.with_columns([
        pl.col("date").dt.year().alias("year"),
        pl.col("date").dt.month().alias("month"),
        (pl.col("date").dt.year().cast(pl.String) + "-" +
         pl.col("date").dt.month().cast(pl.String).str.zfill(2) + "-01").alias("month_start"),
    ])
    monthly_fp = (
        fp.group_by("month_start")
        .agg([
            pl.col("ron95").mean().alias("ron95_avg"),
            pl.col("diesel").mean().alias("diesel_avg"),
        ])
        .sort("month_start")
    )
    monthly_fp = monthly_fp.with_columns(
        pl.col("month_start").str.to_date("%Y-%m-%d").alias("date")
    )
    return monthly_fp


def load_registrations_monthly() -> pl.DataFrame:
    """Vehicle registrations: all_types / all_fuels only."""
    reg = pl.read_csv(RAW_DATA_DIR / "registrations_type_fuel.csv")
    reg = reg.filter(
        (pl.col("type") == "all_types") & (pl.col("fuel") == "all_fuels")
    )
    reg = reg.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    reg = reg.select(["date", "registrations"])
    return reg


def load_labour_monthly() -> pl.DataFrame:
    """Labour force: use lf_employed, u_rate."""
    fl = pl.read_csv(RAW_DATA_DIR / "force labour_monthly.csv")
    fl = fl.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    return fl.select(["date", "lf_employed", "u_rate"])


def load_air_pollution_monthly() -> pl.DataFrame:
    """Air pollution: pivot pollutants wide. Note: data ends Dec 2024."""
    ap = pl.read_csv(RAW_DATA_DIR / "air_pollution.csv")
    ap = ap.with_columns(pl.col("date").str.to_date("%Y-%m-%d"))
    wide = ap.pivot(index="date", on="pollutant", values="concentration", aggregate_function="mean")
    return wide


def compute_correlations(df: pl.DataFrame, target: str, features: list) -> list:
    """Pearson correlation of target vs each feature."""
    results = []
    for f in features:
        sub = df.select([target, f]).drop_nulls()
        if sub.shape[0] < 5:
            continue
        x = sub[target].to_numpy()
        y = sub[f].to_numpy()
        corr = float(np.corrcoef(x, y)[0, 1])
        results.append({"feature": f, "correlation": round(corr, 4)})
    results.sort(key=lambda r: abs(r["correlation"]), reverse=True)
    return results


def train_lgbm_and_forecast(series: np.ndarray, horizon: int, n_lags: int = 12):
    """LightGBM lag-feature regression for time-series forecasting."""
    import lightgbm as lgb
    from sklearn.metrics import mean_absolute_percentage_error, mean_squared_error

    n = len(series)
    X, y = [], []
    for i in range(n_lags, n):
        X.append(series[i - n_lags: i][::-1])  # lag1..lagN
        y.append(series[i])
    X, y = np.array(X), np.array(y)

    # Train/test split (last 12 months = test)
    split = max(n_lags + 1, len(X) - 12)
    X_tr, X_te = X[:split], X[split:]
    y_tr, y_te = y[:split], y[split:]

    model = lgb.LGBMRegressor(n_estimators=300, learning_rate=0.05, num_leaves=15, random_state=42, verbosity=-1)
    model.fit(X_tr, y_tr)

    preds_test = model.predict(X_te)
    mape = round(mean_absolute_percentage_error(y_te, preds_test) * 100, 2) if len(y_te) > 0 else None
    rmse = round(float(np.sqrt(mean_squared_error(y_te, preds_test))), 0) if len(y_te) > 0 else None

    # Forecast horizon steps ahead using recursive strategy
    history = list(series[-n_lags:])
    forecasts = []
    residual_std = float(np.std(y_tr - model.predict(X_tr)))
    for _ in range(horizon):
        x_pred = np.array(history[-n_lags:][::-1]).reshape(1, -1)
        pred = float(model.predict(x_pred)[0])
        forecasts.append(pred)
        history.append(pred)

    return forecasts, mape, rmse, residual_std, model.feature_importances_.tolist()


def holtwinters_forecast(series: np.ndarray, horizon: int):
    """Holt-Winters exponential smoothing (additive seasonality, period=12)."""
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    model = ExponentialSmoothing(series, seasonal="add", seasonal_periods=12, trend="add").fit(disp=False)
    forecast = model.forecast(horizon)
    residuals = model.resid
    return forecast, float(np.std(residuals))


def main():
    print("[Module 3] Loading monthly ridership ...")
    rh = load_monthly_ridership()

    print("[Module 3] Loading external drivers ...")
    fp = load_fuel_monthly()
    reg = load_registrations_monthly()
    fl = load_labour_monthly()
    ap = load_air_pollution_monthly()

    # Join all on date
    merged = rh.join(fp, on="date", how="left")
    merged = merged.join(reg, on="date", how="left")
    merged = merged.join(fl, on="date", how="left")
    merged = merged.join(ap, on="date", how="left")
    merged = merged.sort("date")

    print("[Module 3] Computing correlations ...")
    feature_cols = ["ron95_avg", "diesel_avg", "registrations", "lf_employed", "u_rate"]
    # Only use features present in merged
    feature_cols = [c for c in feature_cols if c in merged.columns]
    corr = compute_correlations(merged, "rail_total", feature_cols)

    # Feature importance via LightGBM on the full driver set
    full_rows = merged.drop_nulls(subset=["rail_total"] + feature_cols)
    if full_rows.shape[0] >= 20:
        import lightgbm as lgb
        from sklearn.preprocessing import StandardScaler
        X_feat = full_rows.select(feature_cols).to_numpy()
        y_feat = full_rows["rail_total"].to_numpy()
        sc = StandardScaler()
        X_feat_sc = sc.fit_transform(X_feat)
        lgb_feat = lgb.LGBMRegressor(n_estimators=100, verbosity=-1, random_state=42)
        lgb_feat.fit(X_feat_sc, y_feat)
        feature_importance = [
            {"feature": f, "importance": round(float(imp), 4)}
            for f, imp in sorted(zip(feature_cols, lgb_feat.feature_importances_), key=lambda x: -x[1])
        ]
    else:
        feature_importance = []

    # ── Forecasting ──────────────────────────────────────────────────────────
    print("[Module 3] Training forecast models ...")
    series_all = merged.filter(pl.col("rail_total").is_not_null())["rail_total"].to_numpy()
    n = len(series_all)

    forecasts_out = []
    if n >= 24:
        for horizon, label in [(3, "3_months"), (6, "6_months"), (12, "12_months")]:
            lgbm_preds, mape, rmse, lgbm_std, _ = train_lgbm_and_forecast(series_all, horizon)

            # Holt-Winters
            try:
                hw_preds, hw_std = holtwinters_forecast(series_all, horizon)
                hw_list = hw_preds.tolist()
            except Exception:
                hw_list = lgbm_preds.copy()
                hw_std = lgbm_std

            # Ensemble (average of LightGBM + HW)
            ensemble = [(a + b) / 2 for a, b in zip(lgbm_preds, hw_list)]
            combined_std = (lgbm_std + hw_std) / 2

            # Build monthly forecast labels starting from latest data month + 1
            last_date = merged.filter(pl.col("rail_total").is_not_null())["date"].max()
            import datetime
            forecast_months = []
            d = last_date
            for _ in range(horizon):
                month = d.month % 12 + 1
                year = d.year + (1 if d.month == 12 else 0)
                d = datetime.date(year, month, 1)
                forecast_months.append(str(d))

            forecasts_out.append({
                "horizon": label,
                "mape_pct": mape,
                "rmse": rmse,
                "model": "LightGBM + Holt-Winters Ensemble",
                "forecasts": [
                    {
                        "date": fm,
                        "predicted": round(ens, 0),
                        "lower_ci": round(ens - 1.645 * combined_std, 0),
                        "upper_ci": round(ens + 1.645 * combined_std, 0),
                    }
                    for fm, ens in zip(forecast_months, ensemble)
                ],
            })

    # Monthly driver trend for chart
    driver_trend = merged.select(
        ["month_start"] + [c for c in ["ron95_avg", "diesel_avg", "registrations", "u_rate", "rail_total"] if c in merged.columns]
    ).drop_nulls(subset=["rail_total"]).to_dicts()
    for row in driver_trend:
        for k, v in row.items():
            if isinstance(v, float) and not (v == v):  # NaN check
                row[k] = None

    output = {
        "generated_at": "2026-11-22",
        "air_pollution_data_cutoff": "2024-12-31",
        "driver_correlations": corr,
        "feature_importance": feature_importance,
        "forecasts": forecasts_out,
        "monthly_driver_trend": driver_trend,
    }

    save_frontend_json(output, "forecast_demand.json")
    print("[Module 3] Done — forecast_demand.json written.")


if __name__ == "__main__":
    main()
