import { num, pct } from './analytics';
import type { District, DistrictCoverage, Screen } from './contracts';

type NumericMetric = {
  value: string; label: string; read: (district: District, coverage: DistrictCoverage, screen: Screen) => number | null;
  format: (value: number | null) => string; discrete?: boolean;
};
const income = (value: number | null) => value == null ? 'Unavailable' : `RM ${num(value)}`;
export const equityMetrics = (observationDays: number): NumericMetric[] => [
  { value: 'trips', label: 'Average daily origins', read: (d) => d.average_daily_rapid_rail_station_origin_trips, format: num },
  { value: 'network_share', label: 'Share of published network origins', read: (d) => d.share_of_published_network_station_origin_trips_pct, format: pct },
  { value: 'origins_per_resident', label: `Origins per 1,000 residents (${num(observationDays)}-day period)`, read: (d) => d.rapid_rail_station_origin_trips_per_1k_residents_period, format: (v) => num(v, 1) },
  { value: 'origins_per_station', label: 'Daily origins per physical station', read: (d) => d.average_daily_rapid_rail_station_origin_trips_per_physical_station, format: (v) => num(v, 1) },
  { value: 'population', label: 'District population', read: (d) => d.total_population_residents, format: num, discrete: true },
  { value: 'stations', label: 'Mapped physical stations', read: (d) => d.rapid_rail_physical_stations, format: num, discrete: true },
  { value: 'station_density', label: 'Stations per 100,000 residents', read: (d) => d.rapid_rail_stations_per_100k_residents, format: (v) => num(v, 2) },
  { value: 'lrt3_stations', label: 'LRT3 stations', read: (_, c) => c.lrt3_stations, format: num, discrete: true },
  { value: 'lrt3_share', label: 'LRT3 share of published district origins', read: (d) => d.lrt3_share_of_observed_district_station_origin_trips_pct, format: pct },
  { value: 'income', label: 'Median monthly household income', read: (_, __, r) => r.median_monthly_household_income_myr, format: income },
  { value: 'poverty', label: 'Absolute household poverty', read: (_, __, r) => r.absolute_poverty_households_pct, format: pct },
];

export const priorityClasses = {
  priority: { label: 'Priority for follow-up', color: '#a74230' },
  coverage: { label: 'Low station density only', color: '#e9a44f' },
  vulnerability: { label: 'Socioeconomic flag only', color: '#8f82d0' },
  neither: { label: 'Outside screening thresholds', color: '#b9d9d1' },
  unavailable: { label: 'Unavailable', color: '#aeb8c9' },
};

export function priorityClass(screen: Screen) {
  if (screen.priority_for_further_investigation == null) return priorityClasses.unavailable;
  if (screen.priority_for_further_investigation) return priorityClasses.priority;
  if (screen.coverage_at_or_below_cutoff) return priorityClasses.coverage;
  if (screen.relative_vulnerability_flag) return priorityClasses.vulnerability;
  return priorityClasses.neither;
}

export function metricScale(metric: NumericMetric, values: (number | null)[]) {
  const max = Math.max(0, ...values.map((value) => value ?? 0));
  const low = metric.discrete ? Math.floor(max / 3) : max / 3;
  const high = metric.discrete ? Math.floor(2 * max / 3) : 2 * max / 3;
  const zero = { label: `Zero (${metric.format(0)})`, color: '#d9edf3' };
  const unavailable = priorityClasses.unavailable;
  const bins = [
    { label: metric.discrete ? `1–${metric.format(low)}` : `Above zero to ${metric.format(low)}`, color: '#a2c8ed' },
    { label: metric.discrete ? `${metric.format(low + 1)}–${metric.format(high)}` : `Above ${metric.format(low)} to ${metric.format(high)}`, color: '#538fce' },
    { label: metric.discrete ? `${metric.format(high + 1)} and above` : `Above ${metric.format(high)}`, color: '#214b98' },
  ];
  return {
    legend: [zero, ...bins.filter((_, index) => [low > 0, high > low, max > high][index]), unavailable],
    classify: (value: number | null) => value == null ? unavailable : value === 0 ? zero : bins[value <= low ? 0 : value <= high ? 1 : 2],
  };
}

export function cohortCaption(screen: Screen | undefined, fallback: string) {
  return screen ? `${screen.socioeconomic_reference_year} · ${num(screen.comparison_cohort_size)} districts` : fallback;
}
