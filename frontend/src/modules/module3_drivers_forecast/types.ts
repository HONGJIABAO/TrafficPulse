// Module 3: Demand Drivers & Forecasting Type Definitions
// TransitPulse Malaysia — MDIT: Global Challenge 2026

export interface DriverCorrelation {
  feature: string;
  correlation: number;
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

export interface ForecastPoint {
  date: string;
  predicted: number;
  lower_ci: number;
  upper_ci: number;
}

export type ForecastHorizonKey = '3_months' | '6_months' | '12_months';

export interface ForecastHorizon {
  horizon: ForecastHorizonKey;
  mape_pct: number | null;
  rmse: number | null;
  n_cv_folds?: number;
  ci_level?: number;
  model: string;
  forecasts: ForecastPoint[];
}

export interface MonthlyDriverData {
  month_start: string;
  ron95_avg: number | null;
  diesel_avg: number | null;
  registrations: number | null;
  u_rate: number | null;
  lf_employed?: number | null;
  rail_total: number;
}

export interface KpiSummary {
  projected_growth_pct: number | null;
  fuel_mom_pct: number | null;
  reg_yoy_pct: number | null;
  latest_lf_employed_m: number | null;
  u_rate_pearson_r: number | null;
  diesel_pearson_r: number | null;
  registrations_pearson_r: number | null;
  last_observed_rail_total: number | null;
  last_observed_month: string | null;
  last_ron95_avg: number | null;
  last_registrations: number | null;
  last_u_rate: number | null;
}

export interface ForecastDemandSchema {
  generated_at: string;
  air_pollution_data_cutoff?: string;
  driver_correlations: DriverCorrelation[];
  feature_importance: FeatureImportance[];
  forecasts: ForecastHorizon[];
  monthly_driver_trend: MonthlyDriverData[];
  kpi_summary?: KpiSummary;
}

export type TimeRangeFilter = '12m' | '24m' | 'all';
export type DriverFocusFilter = 'all' | 'fuel' | 'registrations' | 'labour';
