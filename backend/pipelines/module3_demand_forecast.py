"""
module3_demand_forecast.py
TransitPulse Malaysia — MDIT: Global Challenge 2026
Module 3: Demand Drivers & Forecasting
Output: frontend/src/data/forecast_demand.json

Merges monthly rail ridership with external drivers (fuel price, vehicle
registrations, labour force) and trains a LightGBM + Holt-Winters ensemble
for 3-, 6-, 12-month demand forecasts with 95% CI.

FIXES applied (v2):
  1. Holt-Winters disp=False TypeError removed
  2. LightGBM multivariate direct-step forecasting (no recursive collapse)
  3. Walk-forward cross-validation backtesting before final retraining
  4. CI uses z=1.960 (95%), not 1.645 (90%)
  5. Hardcoded KPI values replaced — JSON carries all computed stats
  6. Feature importance & Pearson correlation kept as SEPARATE arrays (not mixed)
  7. External driver features (fuel/registrations/labour) fed into LightGBM forecast
  8. Generated-at timestamp updated dynamically
"""

import sys, warnings, datetime
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

Z_95 = 1.960  # z-score for 95% two-sided confidence interval


# ── Data loaders ──────────────────────────────────────────────────────────────

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


# ── Analysis helpers ──────────────────────────────────────────────────────────

def compute_correlations(df: pl.DataFrame, target: str, features: list) -> list:
    """Pearson (bivariate linear) correlation of target vs each feature."""
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


def build_feature_matrix(
    series: np.ndarray,
    ext_features: np.ndarray | None,
    n_lags: int = 12,
):
    """
    Build lag + external-feature matrix for direct multi-step modelling.
    ext_features shape: (T, k) or None for univariate.
    Returns X (n_samples, n_lags + k), y (n_samples,), and lag count.
    """
    n = len(series)
    X, y = [], []
    for i in range(n_lags, n):
        lags = series[i - n_lags: i][::-1]  # lag1 .. lagN (most recent first)
        if ext_features is not None:
            row = np.concatenate([lags, ext_features[i]])
        else:
            row = lags
        X.append(row)
        y.append(series[i])
    return np.array(X), np.array(y)


def walk_forward_cv(series: np.ndarray, ext_features: np.ndarray | None, n_lags: int, min_train: int = 24):
    """
    Expanding-window walk-forward cross-validation.
    One-step-ahead MAPE/RMSE averaged over all folds.
    Returns (avg_mape_pct, avg_rmse, n_folds).
    """
    import lightgbm as lgb
    from sklearn.metrics import mean_absolute_percentage_error, mean_squared_error

    X_all, y_all = build_feature_matrix(series, ext_features, n_lags)
    n = len(X_all)
    if n < min_train + 3:
        return None, None, 0

    mapes, rmses = [], []
    for cutoff in range(min_train, n - 1):
        X_tr, y_tr = X_all[:cutoff], y_all[:cutoff]
        X_te, y_te = X_all[cutoff: cutoff + 1], y_all[cutoff: cutoff + 1]
        m = lgb.LGBMRegressor(n_estimators=200, learning_rate=0.05, num_leaves=15,
                               random_state=42, verbosity=-1)
        m.fit(X_tr, y_tr)
        pred = m.predict(X_te)
        mapes.append(mean_absolute_percentage_error(y_te, pred) * 100)
        rmses.append(float(np.sqrt(mean_squared_error(y_te, pred))))

    return round(float(np.mean(mapes)), 2), round(float(np.mean(rmses)), 0), len(mapes)


def train_lgbm_direct_forecast(
    series: np.ndarray,
    ext_features: np.ndarray | None,
    horizon: int,
    n_lags: int = 12,
):
    """
    Fix 2 & 7: Multivariate direct multi-step LightGBM forecasting.
    Trains a separate model per step h in [1..horizon] on all available data.
    ext_features: last row is used for all forecast steps (forward-fill).

    Returns:
        forecasts: list of predicted values (length = horizon)
        residual_std: std of training residuals (for CI)
        feature_importances: list of floats
    """
    import lightgbm as lgb

    X_all, y_all = build_feature_matrix(series, ext_features, n_lags)
    # For each step h, we train model to predict series[t+h] from series[t-lags..t]
    # We approximate by shifting y: model_{h} maps X[i] -> y[i+h-1]
    # (direct strategy: separate model per horizon step)
    all_preds_at_last = []
    all_importances = []
    all_train_resid = []

    for h in range(1, horizon + 1):
        # Align: X[i] -> series[n_lags + i + h - 1]  (predict h steps ahead)
        X_h, y_h = [], []
        n_full = len(series)
        for i in range(n_lags, n_full - h):
            lags = series[i - n_lags: i][::-1]
            if ext_features is not None:
                row = np.concatenate([lags, ext_features[i]])
            else:
                row = lags
            X_h.append(row)
            y_h.append(series[i + h - 1])

        if len(X_h) < 10:
            # Fallback: use full dataset model
            X_h = X_all
            y_h = y_all

        X_h, y_h = np.array(X_h), np.array(y_h)
        m = lgb.LGBMRegressor(n_estimators=300, learning_rate=0.05, num_leaves=15,
                               random_state=42, verbosity=-1)
        m.fit(X_h, y_h)

        # Predict for the forecast point: use latest lags from series
        last_lags = series[-n_lags:][::-1]
        if ext_features is not None:
            last_ext = ext_features[-1]  # forward-fill last known external values
            pred_row = np.concatenate([last_lags, last_ext]).reshape(1, -1)
        else:
            pred_row = last_lags.reshape(1, -1)

        pred_val = float(m.predict(pred_row)[0])
        all_preds_at_last.append(pred_val)
        all_importances.append(m.feature_importances_.tolist())

        train_resid_std = float(np.std(y_h - m.predict(X_h)))
        all_train_resid.append(train_resid_std)

    # Average residual std across all horizon models
    residual_std = float(np.mean(all_train_resid))
    # Average feature importances across horizon models (same feature set)
    avg_importances = list(np.mean(all_importances, axis=0))

    return all_preds_at_last, residual_std, avg_importances


def holtwinters_forecast(series: np.ndarray, horizon: int):
    """
    Fix 1: Holt-Winters exponential smoothing — disp=False removed (unsupported in statsmodels 0.14+).
    """
    from statsmodels.tsa.holtwinters import ExponentialSmoothing
    model = ExponentialSmoothing(series, seasonal="add", seasonal_periods=12, trend="add").fit()
    forecast = model.forecast(horizon)
    residuals = model.resid
    return forecast, float(np.std(residuals))


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("[Module 3] Loading monthly ridership ...")
    rh = load_monthly_ridership()

    print("[Module 3] Loading external drivers ...")
    fp = load_fuel_monthly()
    reg = load_registrations_monthly()
    fl = load_labour_monthly()

    # Join all on date
    merged = rh.join(fp, on="date", how="left")
    merged = merged.join(reg, on="date", how="left")
    merged = merged.join(fl, on="date", how="left")
    merged = merged.sort("date")

    print("[Module 3] Computing Pearson correlations ...")
    feature_cols = ["ron95_avg", "diesel_avg", "registrations", "lf_employed", "u_rate"]
    feature_cols = [c for c in feature_cols if c in merged.columns]
    # Fix 6: Pearson correlations stored separately — clearly labelled bivariate linear
    corr = compute_correlations(merged, "rail_total", feature_cols)

    # Fix 6: Feature importance via LightGBM on the full driver set — stored separately
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
            {"feature": f, "importance": round(float(imp), 1)}
            for f, imp in sorted(zip(feature_cols, lgb_feat.feature_importances_), key=lambda x: -x[1])
        ]
    else:
        feature_importance = []

    # ── Forecasting ────────────────────────────────────────────────────────────
    print("[Module 3] Training forecast models ...")

    # Only use rows with full feature coverage for the multivariate model
    fc_rows = merged.drop_nulls(subset=["rail_total"] + feature_cols).sort("date")
    series_all = fc_rows["rail_total"].to_numpy()
    # Fix 7: external driver features fed into LightGBM forecast
    ext_arr = fc_rows.select(feature_cols).to_numpy()

    # Fallback: also load full ridership series for Holt-Winters (which is univariate)
    hw_series = merged.filter(pl.col("rail_total").is_not_null())["rail_total"].to_numpy()

    n = len(series_all)
    last_date = fc_rows["date"].max()

    forecasts_out = []
    cv_mape, cv_rmse, n_folds = None, None, 0

    if n >= 24:
        # Fix 3: Walk-forward cross-validation backtesting BEFORE final retraining
        print("[Module 3] Running walk-forward cross-validation ...")
        cv_mape, cv_rmse, n_folds = walk_forward_cv(series_all, ext_arr, n_lags=12, min_train=24)
        print(f"[Module 3] CV MAPE={cv_mape}%, RMSE={cv_rmse:,} over {n_folds} folds")

        for horizon, label in [(3, "3_months"), (6, "6_months"), (12, "12_months")]:
            print(f"[Module 3] Forecasting {label} ...")

            # Fix 2 & 7: Direct multivariate LightGBM — retrained on ALL eligible data
            lgbm_preds, lgbm_std, feat_imp_list = train_lgbm_direct_forecast(
                series_all, ext_arr, horizon, n_lags=12
            )

            # Fix 1: Holt-Winters without disp=False
            try:
                hw_preds_arr, hw_std = holtwinters_forecast(hw_series, horizon)
                hw_list = hw_preds_arr.tolist()
            except Exception as e:
                print(f"[Module 3] HW failed ({e}), using LGBM only")
                hw_list = lgbm_preds.copy()
                hw_std = lgbm_std

            # Ensemble (average of LightGBM + HW)
            ensemble = [(a + b) / 2 for a, b in zip(lgbm_preds, hw_list)]
            combined_std = (lgbm_std + hw_std) / 2

            # Build monthly forecast date labels
            forecast_months = []
            d = last_date
            for _ in range(horizon):
                month = d.month % 12 + 1
                year = d.year + (1 if d.month == 12 else 0)
                d = datetime.date(year, month, 1)
                forecast_months.append(str(d))

            forecasts_out.append({
                "horizon": label,
                # Fix 3: use CV metrics (not single holdout)
                "mape_pct": cv_mape,
                "rmse": cv_rmse,
                "n_cv_folds": n_folds,
                "ci_level": 0.95,  # Fix 4: documented CI level
                "model": "LightGBM + Holt-Winters Ensemble",
                "forecasts": [
                    {
                        "date": fm,
                        "predicted": round(ens, 0),
                        # Fix 4: z=1.960 for 95% CI (was 1.645 / 90%)
                        "lower_ci": round(ens - Z_95 * combined_std, 0),
                        "upper_ci": round(ens + Z_95 * combined_std, 0),
                    }
                    for fm, ens in zip(forecast_months, ensemble)
                ],
            })

    # Monthly driver trend for chart
    driver_trend = merged.select(
        ["month_start"] + [c for c in ["ron95_avg", "diesel_avg", "registrations", "u_rate", "lf_employed", "rail_total"]
                           if c in merged.columns]
    ).drop_nulls(subset=["rail_total"]).to_dicts()
    for row in driver_trend:
        for k, v in row.items():
            if isinstance(v, float) and v != v:  # NaN → None
                row[k] = None

    # ── Compute summary stats for frontend KPIs (Fix 5: replace hardcoded values) ──
    # Last historical observation
    last_hist_row = driver_trend[-1] if driver_trend else {}
    last_rail = last_hist_row.get("rail_total")

    # Projected growth: compare last 6-month forecast mean vs last historical
    proj_growth_pct = None
    if forecasts_out and last_rail:
        fc6 = next((f for f in forecasts_out if f["horizon"] == "6_months"), None)
        if fc6 and fc6["forecasts"]:
            fc_mean = float(np.mean([pt["predicted"] for pt in fc6["forecasts"]]))
            proj_growth_pct = round((fc_mean - last_rail) / last_rail * 100, 1)

    # MoM fuel price change
    fuel_mom_pct = None
    ron95_values = [(r["month_start"], r["ron95_avg"]) for r in driver_trend if r.get("ron95_avg") is not None]
    if len(ron95_values) >= 2:
        prev_ron95 = ron95_values[-2][1]
        curr_ron95 = ron95_values[-1][1]
        if prev_ron95 and prev_ron95 != 0:
            fuel_mom_pct = round((curr_ron95 - prev_ron95) / prev_ron95 * 100, 1)

    # YoY registrations change
    reg_yoy_pct = None
    reg_values = [(r["month_start"], r["registrations"]) for r in driver_trend if r.get("registrations") is not None]
    if len(reg_values) >= 13:
        prev_reg = reg_values[-13][1]
        curr_reg = reg_values[-1][1]
        if prev_reg and prev_reg != 0:
            reg_yoy_pct = round((curr_reg - prev_reg) / prev_reg * 100, 1)

    # Latest labour force (millions)
    latest_lf_employed_m = None
    if last_hist_row.get("lf_employed"):
        latest_lf_employed_m = round(last_hist_row["lf_employed"] / 1e3, 1)

    # Unemployment correlation with ridership (Pearson r)
    urate_corr = next((c["correlation"] for c in corr if c["feature"] == "u_rate"), None)
    diesel_corr = next((c["correlation"] for c in corr if c["feature"] == "diesel_avg"), None)
    reg_corr = next((c["correlation"] for c in corr if c["feature"] == "registrations"), None)

    output = {
        "generated_at": datetime.date.today().isoformat(),
        "air_pollution_data_cutoff": "2024-12-31",
        # Fix 6: clearly separated arrays
        "driver_correlations": corr,          # Pearson r — bivariate linear
        "feature_importance": feature_importance,  # LGBM split counts — ML importance
        "forecasts": forecasts_out,
        "monthly_driver_trend": driver_trend,
        # Fix 5: computed KPI summary (replaces hardcoded frontend defaults)
        "kpi_summary": {
            "projected_growth_pct": proj_growth_pct,
            "fuel_mom_pct": fuel_mom_pct,
            "reg_yoy_pct": reg_yoy_pct,
            "latest_lf_employed_m": latest_lf_employed_m,
            "u_rate_pearson_r": urate_corr,
            "diesel_pearson_r": diesel_corr,
            "registrations_pearson_r": reg_corr,
            "last_observed_rail_total": int(last_rail) if last_rail else None,
            "last_observed_month": last_hist_row.get("month_start"),
            "last_ron95_avg": last_hist_row.get("ron95_avg"),
            "last_registrations": int(last_hist_row["registrations"]) if last_hist_row.get("registrations") else None,
            "last_u_rate": last_hist_row.get("u_rate"),
        },
    }

    save_frontend_json(output, "forecast_demand.json")
    print("[Module 3] Done — forecast_demand.json written.")


if __name__ == "__main__":
    main()
