import type { Ablation, DateKey, DayType, EvaluationHorizon, ForecastScope, HolidayCalendar, HolidayStatus, Horizon, NetworkData, Scenario, ServiceData, SupplyStatus, TargetId, Value } from './contracts';

const integer = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 0 });
const short = new Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 });
const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const num = (value: number | null | undefined, digits = 0) => value == null ? 'Unavailable' : digits === 0 ? integer.format(value) :
  new Intl.NumberFormat('en-MY', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
export const compact = (value: Value) => value == null ? '—' : short.format(value);
export const pct = (value: Value, digits = 2) => value == null ? 'Unavailable' : `${num(value, digits)}%`;
export const signed = (value: Value, digits = 0, suffix = '') => value == null ? 'Unavailable' : `${value > 0 ? '+' : ''}${num(value, digits)}${suffix}`;
export const dateText = (value: DateKey | null | undefined) => value ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : 'Unavailable';
export const dateRange = (start: DateKey | null, end: DateKey | null) => start && end ? `${dateText(start)} to ${dateText(end)}` : 'Unavailable';
export const titleCase = (value: string) => value.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase());
export const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
export const mean = (values: number[]) => values.length ? sum(values) / values.length : null;

export const targetColor: Record<TargetId, string> = {
  rail_lrt_ampang: '#b64132', rail_lrt_kj: '#2165d7', rail_mrt_kajang: '#158261', rail_mrt_pjy: '#6854bb',
  rail_monorail: '#a85c00', rail_lrt_shah_alam: '#007e92', rapid_rail_published_sum: '#2959c7', lrt3_station_origin_od: '#007e92',
};
export const targetShort: Record<TargetId, string> = {
  rail_lrt_ampang: 'Ampang / Sri Petaling', rail_lrt_kj: 'Kelana Jaya', rail_mrt_kajang: 'MRT Kajang', rail_mrt_pjy: 'MRT Putrajaya',
  rail_monorail: 'KL Monorail', rail_lrt_shah_alam: 'Shah Alam headline', rapid_rail_published_sum: 'Rapid Rail service sum', lrt3_station_origin_od: 'LRT3 station-origin OD',
};
export function unitLabel(unit: string) {
  if (unit === 'station_origin_trips') return 'LRT3 station-origin trips';
  if (unit === 'sum_of_headline_service_trips') return 'Sum of published service trips';
  return 'Published headline service trips';
}
const models: Record<string, string> = {
  seasonal_naive_7: 'Seasonal Naive', holt_winters_additive_damped: 'Holt–Winters', calendar_lag_ridge: 'Ridge Regression',
  target_weekday_profile: 'Target-only weekday profile', bottom_up_selected_components: 'Selected bottom-up ensemble',
  bottom_up_seasonal_naive_7: 'Coherent Seasonal Naive', bottom_up_holt_winters_additive_damped: 'Bottom-up Holt–Winters', bottom_up_calendar_lag_ridge: 'Bottom-up Ridge',
};
export const modelLabel = (model: string) => models[model] ?? titleCase(model);
export const policyLabels: Record<string, string> = {
  full_eligible_history: 'Full eligible history', from_paid_service: 'Post-intervention window', recent_window: 'Recent 56 days',
  holt_without_drift: 'Zero drift', recent_weekday_level: 'Recent weekday profile', by_component: 'Selected by component',
  bottom_up_same_candidate: 'Bottom-up', direct_common_history: 'Direct aggregate', bottom_up: 'Bottom-up',
};
export const forecastScopes = [{ value: 'future', label: 'After reference date' }, { value: 'full', label: 'Full cutoff window' }] as const;
export const horizons = [30, 60, 90] as const;
export const evaluationHorizons = [7, 14, 28] as const;
export const dayTypes = [{ value: 'weekday', label: 'Weekday' }, { value: 'saturday', label: 'Saturday' }, { value: 'sunday', label: 'Sunday' }] as const;
export const scenarios = [{ value: 'low', label: 'Low' }, { value: 'base', label: 'Base' }, { value: 'high', label: 'High' }] as const;
export const targetOptions = (data: NetworkData) =>
  [data.networkId, ...data.components, data.odId].map((value) => ({ value, label: targetShort[value] }));
export const dayOptions = horizons.map((value) => ({ value, label: `${value} days` }));
export const evaluationOptions = evaluationHorizons.map((value) => ({ value, label: `${value} days` }));
export const periodLabel: Record<string, string> = { all_day: 'All day', am_peak: 'AM peak', pm_peak: 'PM peak', off_peak: 'Off-peak' };
const supplyLabels: Record<SupplyStatus, string> = {
  ordinary_day_GTFS_reference: 'Scheduled reference',
  reference_held_beyond_GTFS_validity: 'Held-reference assumption',
  unavailable_no_holiday_timetable: 'Holiday timetable unavailable',
  unavailable_tentative_holiday_timetable: 'Tentative holiday, timetable unavailable',
  unavailable_unknown_holiday_calendar: 'Holiday calendar unknown, timetable unavailable',
};
export const supplyLabel = (status: SupplyStatus) => Object.hasOwn(supplyLabels, status) ? supplyLabels[status] : 'Reference schedule unavailable';
export const hasReferenceSupply = (status: SupplyStatus) =>
  status === 'ordinary_day_GTFS_reference' || status === 'reference_held_beyond_GTFS_validity';
export const holidayLabels: Record<HolidayStatus, string> = {
  verified_holiday: 'Verified in the archive', tentative_holiday: 'Tentative holiday',
  known_non_holiday: 'Known non-holiday in the archive', unknown_calendar: 'Holiday calendar unknown',
};
export const calendarStatus = (data: HolidayCalendar, date: DateKey): HolidayStatus =>
  data.dates[date]?.status ?? (data.coveredYears.includes(Number(date.slice(0, 4))) ? 'known_non_holiday' : 'unknown_calendar');
export const isFutureDate = (date: DateKey, asOf: DateKey) => date > asOf;

export function getWindow(data: NetworkData, target: TargetId, horizon: Horizon, scope: ForecastScope) {
  return data.outlook.find((r) => r.series_id === target && r.horizon === horizon && r.scope === scope);
}
export function findDateWindow(start: DateKey, end: DateKey) {
  if (!start || !end || start > end) return [];
  const first = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return [];
  return Array.from({ length: Math.floor((last - first) / 86_400_000) + 1 }, (_, i) => new Date(first + i * 86_400_000).toISOString().slice(0, 10));
}
export function precedingDate(end: DateKey, days: number) {
  return new Date(Date.parse(`${end}T00:00:00Z`) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
}
export function midpointLabels(date: string) {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}
export function peakWindow(data: ServiceData, selection: { scope: string; year: string; day: DayType; scenario: Scenario; date: string; resolution: 'hourly' | 'peak_period' }) {
  const days = data.calendar.filter((row) => row.day_type === selection.day && (selection.date === 'all' || row.date === selection.date));
  const supplied = days.filter((row) => hasReferenceSupply(row.supply_status));
  const allDemand = mean(days.map((row) => row.scenarios[selection.scenario]));
  const matchedDemand = mean(supplied.map((row) => row.scenarios[selection.scenario]));
  const profile = data.profiles[`${selection.scope}|${selection.year}|${selection.day}`] ?? [];
  const rows = profile.filter((r) => r.resolution === selection.resolution).sort((a, b) => a.start.localeCompare(b.start)).map((row) => {
    const reference = data.supply[selection.day][row.window];
    return { ...row, allDemand: allDemand == null ? null : allDemand * row.share,
      matchedDemand: matchedDemand == null ? null : matchedDemand * row.share,
      nominal: supplied.length && reference != null ? reference * data.capacity.passenger_places : null };
  });
  return { rows, days, supplied: supplied.length, held: supplied.filter((r) => r.supply_status === 'reference_held_beyond_GTFS_validity').length };
}

export function ablationOverview(rows: Ablation[], services: TargetId[], horizon: EvaluationHorizon) {
  const variants = ['A', 'B', 'C'] as const;
  const selected = rows.filter((row) => row.horizon_days === horizon);
  const complete = services.flatMap((target) => {
    const trio = variants.map((variant) => selected.filter((row) => row.series_id === target && row.variant === variant));
    return trio.every((matches) => matches.length === 1 && matches[0].wape_pct != null) ? [{ target, trio }] : [];
  });
  return {
    targets: complete.map(({ target }) => target),
    rows: variants.map((variant, index) => ({ variant, wape: mean(complete.map(({ trio }) => trio[index][0].wape_pct as number)) })),
  };
}
