# Module 3 — Demand Drivers & Forecasting Methodology

**Pipeline:** [`backend/pipelines/module3_demand_forecast.py`](file:///c:/Users/User/Downloads/TrafficPulse/backend/pipelines/module3_demand_forecast.py)  
**Output:** [`frontend/src/data/forecast_demand.json`](file:///c:/Users/User/Downloads/TrafficPulse/frontend/src/data/forecast_demand.json)  
**Tests:** [`backend/pipelines/test_module3_demand_forecast.py`](file:///c:/Users/User/Downloads/TrafficPulse/backend/pipelines/test_module3_demand_forecast.py)

---

## 1. Historical Series & Source Scope

- **Monthly Rail Ridership (`2019-01-01` – `2026-08-01`, `92` months):** Aggregated from `2,800` daily observations across 11 official `ridership_headline.csv` railway series (`rail_lrt_ampang`, `rail_mrt_kajang`, `rail_lrt_kj`, `rail_monorail`, `rail_mrt_pjy`, `rail_lrt_shah_alam`, `rail_ets`, `rail_intercity`, `rail_komuter_utara`, `rail_tebrau`, `rail_komuter`). Bus columns (`bus_rkl`, `bus_rkn`, `bus_rpn`) are excluded. Monthly totals reconcile with Module 1 (`network_overview.json`) with zero deltas.
- **Labour Force (`force labour_monthly.csv`):** Uses `lf_employed` (raw unit: **thousands of persons**, converted via `value / 1,000` → `16,874.4k = 16.8744M`, KPI `16.9M`) and `u_rate` (`%`).
- **Fuel Prices (`fuelprice.csv`):** Filters `series_type == 'level'` and takes monthly means of `ron95` (`RM 3.745/L` in `2026-08`) and `diesel` (`RM 4.6075/L` in `2026-08`). These represent **unsubsidised retail market pump prices**, distinct from targeted subsidised tiers (`ron95_budi95`, `ron95_skps`, `diesel_skds`, `diesel_budi`).
- **Vehicle Registrations (`registrations_type_fuel.csv`):** Filters `type == 'all_types' & fuel == 'all_fuels'` (monthly total vehicle additions).
- **Removed Stale Assets:** `air_pollution.csv` (ending Dec 2024) is excluded and the stale `air_pollution_data_cutoff` key has been removed.

---

## 2. Information Cutoff & Anti-Leakage Protocol

- **Forecast Origin Month:** `2026-08-01` (`information_cutoff = "2026-08-31"`).
- Although raw external tables contain post-August records (`fuelprice.csv` through `2026-11-19`, `registrations_type_fuel.csv` through `2026-10-01`, `force labour_monthly.csv` through `2026-09-01`), **all observations after `2026-08-01` are strictly excluded** before correlation, driver importance, backtesting, and forecasting so no future information leaks into an August 2026 forecast.
- Within historical rolling-origin LightGBM backtesting, features at origin `o` strictly obey conservative publication lags (`ridership` lag `0`, weekly `fuelprice` lag `0`, monthly `registrations` & `labour` lag `1`).

---

## 3. Chronological Model Selection vs Independent Evaluation

To prevent any forward-looking target overlap between model selection and out-of-sample evaluation, rolling post-2023 origins (`min_train = 48` months starting `2023-01-01`) use a **horizon-aware purged split** anchored at `2024-07-01`:
- **Purged Model-Selection Split:** Origins `>= 2023-01-01` whose full forecast target `origin + H <= 2024-07-01` (`n = 18, 16, 13, 7` origins for `H = 1, 3, 6, 12`), guaranteeing every selection target is already observed before holdout evaluation begins.
- **Independent Holdout Evaluation Split:** Origins `2024-07-01` .. `2026-07-01` (`n = 25, 23, 20, 14` origins for `H = 1, 3, 6, 12`), whose targets span `2024-08-01` .. `2026-08-01` (zero calendar-month target overlap with purged selection).
- **All Post-2023 Window:** Origins `2023-01-01` .. `2026-07-01` (`n = 43, 41, 38, 32` origins for `H = 1, 3, 6, 12`) reported transparently alongside Holdout.

### Model Roles
- **Selected Forecasting Model:** **Additive Holt-Winters (`ExponentialSmoothing`, `trend='add'`, `seasonal='add'`, `seasonal_periods=12`, `damped_trend=False`, `initialization_method='estimated'`)**, scaled to millions during MLE fitting (`0` convergence warnings across all 43 rolling origins and final fit). It ranks #1 across `H = 3` (`8.92%`), `H = 6` (`13.20%`), and `H = 12` (`25.29%`) in the purged selection window and achieves `3.19%` MAPE at `H = 12` in independent holdout, producing **one coherent 12-month forecast trajectory (`2026-09`..`2027-08`)** from which 3M, 6M, and 12M windows are sliced consistently.
- **Role Separation of LightGBM:** Direct LightGBM degrades at 12-month horizons due to COVID regime shifts in tree splits and tree extrapolation limits; hence **`LGBMRegressor` is retained exclusively for full-period driver feature importance** rather than time-series forecasting.

*(Note: Purging `origin + H <= 2024-07-01` reduces the purged `H = 12` selection window to `n = 7` origins (`2023-01`..`2023-07`); both Holdout and full All-Post-2023 breakdowns are reported transparently alongside purged selection.)*

---

## 4. Indicative Prediction Range (Uncertainty)

- **Methodology:** Out-of-sample rolling errors `e_{o,h} = y_{o+h} - yhat_{o,h}` are collected per step `h = 1..12` across post-2023 origins (`n = 43` at `h=1` down to `n = 32` at `h=12`), yielding step-specific half-widths `±1.960 × OOS_RMSE_h`.
- **Empirical Audit:** At each holdout origin `o` (`2024-07`..`2026-07`), expanding calibration uses only already-realized residuals (`op + h <= o`; tightening to strictly `< o` produces identical step-level results), achieving `92.0%–100.0%` (`mean 98.6%`) empirical coverage across `h = 1..12`. The purged fixed pre-holdout baseline (`op + h <= 2024-07-01`, `n = 18..7`) likewise achieves `95.8%–100.0%` coverage. Conservative over-coverage (>95%) reflects larger post-COVID recovery residuals during 2023 (`2.6M–6.7M` RMSE for `h=3..12`) relative to stabilized 2024–2026 demand (`~1.1M–2.0M`).
- **Honest Labelling:** Because calibration sample sizes (`32–43` origins) and the June 2026 launch of LRT Shah Alam limit formal frequentist calibration guarantees, intervals are explicitly classified as an **`Indicative Prediction Range`** (`is_calibrated_95_ci: false`), preserving `lower_ci` / `upper_ci` fields cleanly for chart rendering.

---

## 5. Correlation vs Causation & Period Sensitivity

Pearson correlations are exported separately across 5 windows (`all`, `24m`, `12m`, `post_covid`, and `post_covid_diff`). Full-period correlations (`u_rate r = -0.9251`, `lf_employed r = +0.8033`) reflect shared post-COVID recovery trends rather than short-run causality (`12m u_rate r = +0.1422`; first-differenced post-2022 `u_rate r = +0.1106`).
