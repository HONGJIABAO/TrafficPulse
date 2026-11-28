// Module 3: Demand Drivers & Forecasting Type Definitions

export interface DriverCorrelation {
  feature: string;
  label?: string;
  correlation: number | null;
  n_obs?: number;
  missing_values_dropped?: number;
  period_start?: string | null;
  period_end?: string | null;
  units?: string;
  definition?: string;
}

export interface CorrelationPeriod {
  label: string;
  n_obs: number;
  correlations: DriverCorrelation[];
}

export interface FeatureImportance {
  feature: string;
  label?: string;
  importance: number;
}

export interface FeatureImportanceScope {
  model: string;
  training_period: string;
  n_obs: number;
  metric: string;
}

export interface ForecastPoint {
  step?: number;
  date: string;
  predicted: number | null;
  lower_ci: number | null;
  upper_ci: number | null;
  indicative_half_width?: number | null;
}

export type ForecastHorizonKey = '3_months' | '6_months' | '12_months';

export interface AccuracyMetrics {
  mae: number | null;
  rmse: number | null;
  mape_pct: number | null;
  wape_pct?: number | null;
  bias?: number | null;
}

export interface ForecastHorizon {
  horizon: ForecastHorizonKey;
  horizon_months: number;
  start_date: string;
  end_date: string;
  mape_pct: number | null;
  rmse: number | null;
  mae?: number | null;
  wape_pct?: number | null;
  bias?: number | null;
  n_cv_folds?: number;
  model: string;
  uncertainty_label?: string;
  is_calibrated_95_ci?: boolean;
  evaluation_scope?: string;
  predicted_monthly_avg?: number | null;
  predicted_total_trips?: number | null;
  change_vs_last_observed_pct?: number | null;
  change_vs_yoy_comparable_pct?: number | null;
  yoy_comparable_period?: string;
  evaluation_window_mean?: AccuracyMetrics;
  evaluation_window_monthly_pooled?: AccuracyMetrics;
  forecasts: ForecastPoint[];
}

export interface MonthlyDriverData {
  month_start: string;
  ron95_avg: number | null;
  diesel_avg: number | null;
  registrations: number | null;
  u_rate: number | null;
  lf_employed: number | null;
  rail_total: number;
}

export interface HorizonSummary {
  horizon: ForecastHorizonKey;
  horizon_months: number;
  start_date: string;
  end_date: string;
  predicted_monthly_avg: number | null;
  predicted_total_trips: number | null;
  change_vs_last_observed_pct: number | null;
  baseline_last_observed_month: string;
  change_vs_yoy_comparable_pct: number | null;
  yoy_comparable_period: string;
  holdout_endpoint_mape_pct: number | null;
  holdout_endpoint_rmse: number | null;
  holdout_window_mean_mape_pct: number | null;
  holdout_window_mean_rmse: number | null;
  holdout_n_origins: number;
}

export interface KpiSummary {
  projected_growth_pct: number | null;
  projected_yoy_pct?: number | null;
  fuel_mom_pct: number | null;
  reg_yoy_pct: number | null;
  latest_lf_employed_m: number | null;
  latest_lf_employed_m_exact?: number | null;
  u_rate_pearson_r: number | null;
  diesel_pearson_r: number | null;
  registrations_pearson_r: number | null;
  last_observed_rail_total: number | null;
  last_observed_month: string | null;
  last_ron95_avg: number | null;
  last_diesel_avg?: number | null;
  last_registrations: number | null;
  last_u_rate: number | null;
  fuel_price_basis?: string;
  horizon_summaries?: Partial<Record<ForecastHorizonKey, HorizonSummary>>;
}

export interface SelectedForecastModel {
  name: string;
  specification: string;
  final_fit_convergence_warnings: number;
  final_fit_fallback_used: boolean;
  role_separation_note: string;
}

export interface EvaluationHorizon {
  n_origins: number;
  origin_start: string;
  origin_end: string;
  target_start: string;
  target_end: string;
  models: Record<string, {
    endpoint: AccuracyMetrics;
    window_mean: AccuracyMetrics;
    window_monthly_pooled: AccuracyMetrics;
    fallback_count?: number;
  }>;
}

export interface DataFreshness {
  ridership_latest_month: string;
  fuelprice_latest_raw_date: string;
  registrations_latest_raw_date: string;
  labour_latest_raw_date: string;
  post_cutoff_drivers_excluded_from_forecast: boolean;
  conservative_backtest_pub_lags_months?: Record<string, number>;
}

export interface PredictionRangeMethodology {
  label: string;
  is_calibrated_95_ci: boolean;
  method: string;
  coverage_audit_note: string;
  mean_expanding_holdout_coverage_pct: number | null;
}

export type TimeRangeFilter = '12m' | '24m' | 'all';
export type DriverFocusFilter = 'all' | 'fuel' | 'registrations' | 'labour';

export interface ForecastDemandSchema {
  generated_at: string;
  forecast_origin_month: string;
  information_cutoff: string;
  historical_observation_count: number;
  data_freshness: DataFreshness;
  driver_correlations: DriverCorrelation[];
  correlations_by_period: Record<TimeRangeFilter, CorrelationPeriod> & Record<string, CorrelationPeriod>;
  feature_importance: FeatureImportance[];
  feature_importance_scope: FeatureImportanceScope;
  selected_forecast_model: SelectedForecastModel;
  model_evaluation: { holdout_eval: Record<string, EvaluationHorizon> };
  prediction_range_methodology: PredictionRangeMethodology;
  forecasts: ForecastHorizon[];
  horizon_summaries: Partial<Record<ForecastHorizonKey, HorizonSummary>>;
  monthly_driver_trend: MonthlyDriverData[];
  kpi_summary?: KpiSummary;
}
