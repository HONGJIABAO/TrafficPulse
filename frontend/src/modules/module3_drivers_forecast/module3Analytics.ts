import type {
  CorrelationPeriod,
  DriverCorrelation,
  DriverFocusFilter,
  EvaluationHorizon,
  ForecastDemandSchema,
  ForecastHorizon,
  ForecastHorizonKey,
  MonthlyDriverData,
  TimeRangeFilter,
} from './types.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatMonth(date: string | null | undefined): string {
  if (!date) return 'N/A';
  const match = /^(\d{4})-(\d{2})/.exec(date);
  if (!match) return 'N/A';
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${match[1]}` : 'N/A';
}

export function historicalWindow(data: MonthlyDriverData[], range: TimeRangeFilter): MonthlyDriverData[] {
  if (range === '12m') return data.slice(-12);
  if (range === '24m') return data.slice(-24);
  return data;
}

export function correlationPeriod(
  data: Pick<ForecastDemandSchema, 'correlations_by_period' | 'driver_correlations' | 'historical_observation_count'>,
  range: TimeRangeFilter,
): CorrelationPeriod {
  return data.correlations_by_period?.[range] ?? {
    label: range === 'all' ? 'Full available history' : `Latest ${range.replace('m', '')} months`,
    n_obs: range === 'all' ? data.historical_observation_count : Number(range.replace('m', '')),
    correlations: data.driver_correlations ?? [],
  };
}

export function correlationValue(period: CorrelationPeriod, feature: string): number | null {
  const value = period.correlations.find((item) => item.feature === feature)?.correlation;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function formatCorrelation(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

export function focusCorrelations(period: CorrelationPeriod, focus: DriverFocusFilter): DriverCorrelation[] {
  const features = focus === 'fuel'
    ? ['ron95_avg', 'diesel_avg']
    : focus === 'registrations'
      ? ['registrations']
      : ['u_rate', 'lf_employed'];
  return features.map((feature) => period.correlations.find((item) => item.feature === feature) ?? {
    feature,
    correlation: null,
    n_obs: period.n_obs,
  });
}

export function forecastForHorizon(forecasts: ForecastHorizon[], horizon: ForecastHorizonKey): ForecastHorizon | null {
  return forecasts.find((item) => item.horizon === horizon) ?? null;
}

export function evaluationForHorizon(data: ForecastDemandSchema, horizon: ForecastHorizonKey): EvaluationHorizon | null {
  return data.model_evaluation?.holdout_eval?.[horizon] ?? null;
}

export type ForecastDirection = 'increase' | 'decrease' | 'stable' | 'unavailable';

export function forecastDirection(change: number | null | undefined): ForecastDirection {
  if (change == null || !Number.isFinite(change)) return 'unavailable';
  if (Math.abs(change) < 0.1) return 'stable';
  return change > 0 ? 'increase' : 'decrease';
}

export function forecastNarrative(forecast: ForecastHorizon | null, lastObservedMonth: string | null | undefined): string {
  if (!forecast) return 'Forecast comparison unavailable.';
  const direction = forecastDirection(forecast.change_vs_last_observed_pct);
  const period = `${formatMonth(forecast.start_date)}–${formatMonth(forecast.end_date)}`;
  const basis = formatMonth(lastObservedMonth);
  if (direction === 'unavailable') return `${forecast.horizon_months}-month comparison versus ${basis}: N/A.`;
  if (direction === 'stable') return `Projected to remain broadly stable across ${period} versus the latest observed month (${basis}).`;
  return `Projected to ${direction} by ${Math.abs(forecast.change_vs_last_observed_pct!).toFixed(1)}% across ${period} versus the latest observed month (${basis}).`;
}

export function formatEmploymentMillions(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'N/A';
  return `${value.toFixed(2)}M`;
}

export function forecastDateDisclosure(data: ForecastDemandSchema, forecast: ForecastHorizon | null) {
  return {
    lastObserved: formatMonth(data.kpi_summary?.last_observed_month ?? data.data_freshness?.ridership_latest_month),
    informationCutoff: data.information_cutoff || 'N/A',
    targetPeriod: forecast ? `${formatMonth(forecast.start_date)}–${formatMonth(forecast.end_date)}` : 'N/A',
    socioeconomicScope: `Inputs capped at ${formatMonth(data.forecast_origin_month)}; labour and registrations use a one-month publication lag in backtests.`,
    nowcastScope: `No nowcast layer; target months are model projections from the ${formatMonth(data.forecast_origin_month)} information set.`,
  };
}

export function validPredictionRange(point: ForecastHorizon['forecasts'][number]): boolean {
  return point.predicted != null
    && point.lower_ci != null
    && point.upper_ci != null
    && Number.isFinite(point.predicted)
    && Number.isFinite(point.lower_ci)
    && Number.isFinite(point.upper_ci)
    && point.lower_ci >= 0
    && point.lower_ci <= point.predicted
    && point.predicted <= point.upper_ci;
}
