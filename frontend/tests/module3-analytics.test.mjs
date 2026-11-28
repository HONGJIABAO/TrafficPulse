import test from 'node:test';
import assert from 'node:assert/strict';
import forecastData from '../src/data/forecast_demand.json' with { type: 'json' };
import {
  correlationPeriod,
  correlationValue,
  evaluationForHorizon,
  focusCorrelations,
  forecastDateDisclosure,
  forecastDirection,
  forecastForHorizon,
  forecastNarrative,
  formatCorrelation,
  formatEmploymentMillions,
  historicalWindow,
  validPredictionRange,
} from '../src/modules/module3_drivers_forecast/module3Analytics.ts';

test('Module 3 historical filters use exact latest 12, latest 24, and full windows', () => {
  const trend = forecastData.monthly_driver_trend;
  const full = historicalWindow(trend, 'all');
  const months24 = historicalWindow(trend, '24m');
  const months12 = historicalWindow(trend, '12m');
  assert.equal(full.length, 92);
  assert.equal(months24.length, 24);
  assert.equal(months12.length, 12);
  assert.equal(months24[0].month_start, '2024-09-01');
  assert.equal(months12[0].month_start, '2025-09-01');
  assert.equal(months12.at(-1).month_start, '2026-08-01');
  assert.equal(trend.length, 92, 'filtering must not mutate source history');
});

test('Module 3 Pearson correlations and rankings change with the selected observation period', () => {
  const full = correlationPeriod(forecastData, 'all');
  const months24 = correlationPeriod(forecastData, '24m');
  const months12 = correlationPeriod(forecastData, '12m');
  assert.equal(full.n_obs, 92);
  assert.equal(months24.n_obs, 24);
  assert.equal(months12.n_obs, 12);
  assert.equal(correlationValue(full, 'u_rate'), -0.9251);
  assert.equal(correlationValue(months12, 'u_rate'), 0.1422);
  assert.equal(correlationValue(months12, 'registrations'), 0.8554);
  assert.equal(months12.correlations[0].feature, 'registrations');
  assert.deepEqual(focusCorrelations(months12, 'labour').map((item) => item.feature), ['u_rate', 'lf_employed']);
  assert.equal(formatCorrelation(correlationValue(months12, 'missing_feature')), 'N/A');
});

test('Module 3 forecast horizons share one coherent master trajectory and bind horizon-specific KPIs', () => {
  const f3 = forecastForHorizon(forecastData.forecasts, '3_months');
  const f6 = forecastForHorizon(forecastData.forecasts, '6_months');
  const f12 = forecastForHorizon(forecastData.forecasts, '12_months');
  assert.ok(f3 && f6 && f12);
  assert.equal(f3.forecasts.length, 3);
  assert.equal(f6.forecasts.length, 6);
  assert.equal(f12.forecasts.length, 12);
  assert.deepEqual(f3.forecasts, f12.forecasts.slice(0, 3));
  assert.deepEqual(f6.forecasts, f12.forecasts.slice(0, 6));
  assert.equal(f3.predicted_monthly_avg, 32502174);
  assert.equal(f6.predicted_monthly_avg, 32570855);
  assert.equal(f12.predicted_monthly_avg, 32650753);
  assert.equal(f3.change_vs_last_observed_pct, -0.2);
  assert.equal(f6.change_vs_last_observed_pct, 0.0);
  assert.equal(f12.change_vs_last_observed_pct, 0.3);
});

test('Module 3 diagnostics bind selected Holt-Winters holdout metrics and Seasonal Naive benchmarks', () => {
  assert.equal(forecastData.selected_forecast_model.name, 'Holt-Winters Additive (Undamped)');
  for (const [horizon, mape, rmse, origins, baselineMape] of [
    ['3_months', 4.31, 1520897, 23, 7.71],
    ['6_months', 5.4, 1988753, 20, 6.54],
    ['12_months', 3.19, 1142057, 14, 5.16],
  ]) {
    const forecast = forecastForHorizon(forecastData.forecasts, horizon);
    const evaluation = evaluationForHorizon(forecastData, horizon);
    assert.ok(forecast && evaluation);
    assert.equal(forecast.mape_pct, mape);
    assert.equal(forecast.rmse, rmse);
    assert.equal(forecast.n_cv_folds, origins);
    assert.equal(evaluation.n_origins, origins);
    assert.equal(evaluation.models['Holt-Winters Additive (Undamped)'].endpoint.mape_pct, mape);
    assert.equal(evaluation.models['Seasonal Naive'].endpoint.mape_pct, baselineMape);
  }
});

test('Module 3 forecast wording handles decrease, increase, stable, missing, and comparison basis', () => {
  const f3 = forecastForHorizon(forecastData.forecasts, '3_months');
  const f6 = forecastForHorizon(forecastData.forecasts, '6_months');
  const f12 = forecastForHorizon(forecastData.forecasts, '12_months');
  assert.match(forecastNarrative(f3, '2026-08-01'), /decrease by 0\.2%/);
  assert.match(forecastNarrative(f6, '2026-08-01'), /remain broadly stable/);
  assert.match(forecastNarrative(f12, '2026-08-01'), /increase by 0\.3%/);
  assert.match(forecastNarrative(f12, '2026-08-01'), /latest observed month \(Aug 2026\)/);
  assert.equal(forecastDirection(null), 'unavailable');
  assert.match(forecastNarrative(null, '2026-08-01'), /unavailable/i);
});

test('Module 3 employment and fuel presentation uses verified units and market definitions', () => {
  assert.equal(forecastData.kpi_summary.latest_lf_employed_m_exact, 16.8744);
  assert.equal(formatEmploymentMillions(forecastData.kpi_summary.latest_lf_employed_m_exact), '16.87M');
  assert.equal(forecastData.kpi_summary.last_ron95_avg, 3.745);
  assert.equal(forecastData.kpi_summary.last_diesel_avg, 4.6075);
  assert.match(forecastData.kpi_summary.fuel_price_basis, /Unsubsidised retail market prices/);
  assert.match(forecastData.methodology.driver_definitions.ron95_avg.definition, /distinct from targeted BUDI95/);
  assert.match(forecastData.methodology.driver_definitions.diesel_avg.definition, /excludes targeted SKDS\/BUDI tiers/);
});

test('Module 3 prediction ranges bind validated bounds and never claim calibrated 95% CI', () => {
  assert.equal(forecastData.prediction_range_methodology.label, 'Indicative Prediction Range');
  assert.equal(forecastData.prediction_range_methodology.is_calibrated_95_ci, false);
  for (const horizon of forecastData.forecasts) {
    assert.equal(horizon.uncertainty_label, 'Indicative Prediction Range');
    assert.equal(horizon.is_calibrated_95_ci, false);
    assert.ok(horizon.forecasts.every(validPredictionRange));
  }
  assert.equal(validPredictionRange({ date: 'x', predicted: 0, lower_ci: 0, upper_ci: 0 }), true);
  assert.equal(validPredictionRange({ date: 'x', predicted: null, lower_ci: null, upper_ci: null }), false);
});

test('Module 3 forecast date disclosure reports observed month, cutoff, target period, driver scope, and no-nowcast status', () => {
  const f12 = forecastForHorizon(forecastData.forecasts, '12_months');
  const disclosure = forecastDateDisclosure(forecastData, f12);
  assert.equal(disclosure.lastObserved, 'Aug 2026');
  assert.equal(disclosure.informationCutoff, '2026-08-31');
  assert.equal(disclosure.targetPeriod, 'Sep 2026–Aug 2027');
  assert.match(disclosure.socioeconomicScope, /Inputs capped at Aug 2026/);
  assert.match(disclosure.socioeconomicScope, /one-month publication lag/);
  assert.match(disclosure.nowcastScope, /No nowcast layer/);
});
