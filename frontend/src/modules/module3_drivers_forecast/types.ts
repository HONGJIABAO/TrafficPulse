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
  mape_pct: number;
  rmse: number;
  model: string;
  forecasts: ForecastPoint[];
}

export interface MonthlyDriverData {
  month_start: string;
  ron95_avg: number;
  diesel_avg: number;
  registrations: number;
  u_rate: number;
  rail_total: number;
}

export interface ForecastDemandSchema {
  generated_at: string;
  air_pollution_data_cutoff?: string;
  driver_correlations: DriverCorrelation[];
  feature_importance: FeatureImportance[];
  forecasts: ForecastHorizon[];
  monthly_driver_trend: MonthlyDriverData[];
}

export type TimeRangeFilter = '12m' | '24m' | 'all';
export type DriverFocusFilter = 'all' | 'fuel' | 'registrations' | 'labour';
