// Module 2 — Station Demand Intelligence Types

export type StationNetworkFilter = 'all' | 'ktmb' | 'rapid_rail' | 'brt';

export type StationServiceKey =
  | 'komuter'
  | 'komuter_utara'
  | 'ets'
  | 'intercity'
  | 'shuttle_tebrau'
  | 'rapid_rail'
  | 'brt'
  | 'ktmb_gtfs_only';

export type AvailabilityStatus =
  | 'complete'
  | 'complete_daily_only'
  | 'partial_active_period'
  | 'non_physical_fee_or_unknown'
  | 'unavailable_no_od_data';

export type DemandDayType = 'all' | 'weekday' | 'weekend';
export type DemandHourWindow = 'all' | 'am_peak' | 'pm_peak' | 'selected_hour';
export type DemandMetricFocus = 'daily_avg' | 'peak_hour';
export type SortField =
  | 'rank'
  | 'name'
  | 'service'
  | 'peakHour'
  | 'peakAvg'
  | 'avgDaily'
  | 'totalTrips';
export type SortDirection = 'asc' | 'desc';

export interface StationInventoryRecord {
  id: string;
  gtfs_stop_id: string | null;
  station_code: string | null;
  name: string;
  raw_name: string;
  operator: string;
  network: 'ktmb' | 'rapid_rail' | 'brt';
  service: StationServiceKey;
  service_label: string;
  line: string;
  physical_interchange_id: string | null;
  physical_interchange_name: string | null;
  lat: number | null;
  lng: number | null;
  coordinate_verified: boolean;
  is_physical_station: boolean;
  hourly_supported: boolean;
  availability_status: AvailabilityStatus;
  availability_label: string;
  od_total_2026: number | null;
  positive_days_2026: number;
  source_dataset: string;
}

export interface StationInventoryPayload {
  generated_at: string;
  observation_window: string;
  total_inventory_records: number;
  physical_stations_with_od: number;
  non_physical_codes: number;
  gtfs_unmeasured_stops: number;
  stations: StationInventoryRecord[];
}

export interface PeriodCatalogEntry {
  label: string;
  date_range: string;
  all_days: number;
  weekday_days: number;
  weekend_days: number;
}

export interface StationMetricEntry {
  tot: number;
  avg: number;
  pos_d: number;
  pk_h: number | null;
  pk_avg: number | null;
  am_avg: number | null;
  pm_avg: number | null;
  rank_svc: number | null;
  rank_all: number | null;
}

export interface StationDemandSummaryPayload {
  generated_at: string;
  metadata: {
    observation_window: string;
    total_days: number;
    weekday_days: number;
    weekend_days: number;
    day_classification_rule: string;
    am_peak_window_hours: number[];
    am_peak_label: string;
    pm_peak_window_hours: number[];
    pm_peak_label: string;
    peak_tie_break_rule: string;
  };
  period_catalog: Record<string, PeriodCatalogEntry>;
  metrics: Record<string, Record<DemandDayType, Record<string, StationMetricEntry>>>;
}

export interface StationHourlyProfilesPayload {
  generated_at: string;
  scope: string;
  timestamp_note: string;
  profiles: Record<string, Record<DemandDayType, Record<string, number[]>>>;
}

export interface MonthlyStationTrend {
  months: string[];
  avg_daily: (number | null)[];
  weekday_avg_daily: (number | null)[];
  weekend_avg_daily: (number | null)[];
}

export interface StationDailyProfilesPayload {
  generated_at: string;
  dates: string[];
  rapid_rail_daily: Record<string, number[]>;
  monthly_trends: Record<string, MonthlyStationTrend>;
}

export interface KtmbServiceCoverageAudit {
  service: string;
  service_label: string;
  raw_total_rows: number;
  full_file_date_range: string;
  full_file_days: number;
  aligned_window_rows: number;
  aligned_window_date_range: string;
  aligned_days: number;
  missing_calendar_days: number;
  total_origin_trips_aligned: number;
  reconciliation_vs_ktmb_daily: {
    matched_dates: number;
    exact_zero_delta_dates: number;
    max_abs_delta: number;
    official_daily_total: number;
  };
}

export interface RapidRailCoverageAudit {
  service: string;
  service_label: string;
  aligned_window_date_range: string;
  aligned_days: number;
  row_categories: {
    station_to_station: { rows: number; trips: number };
    station_to_a0: { rows: number; trips: number };
    a0_to_station: { rows: number; trips: number };
  };
  a0_origin_reconciliation: {
    station_date_pairs_checked: number;
    exact_zero_delta_matches: number;
    max_abs_delta: number;
  };
  total_origin_trips_aligned: number;
  shah_alam_audit: {
    stations_in_od: number;
    jan1_to_jul31_trips: number;
    aug1_to_nov20_trips: number;
    positive_od_days: number;
    active_window: string;
  };
}

export interface StationDemandCoveragePayload {
  generated_at: string;
  aligned_common_window: string;
  services: {
    komuter: KtmbServiceCoverageAudit;
    intercity: KtmbServiceCoverageAudit;
    komuter_utara: KtmbServiceCoverageAudit;
    ets: KtmbServiceCoverageAudit;
    shuttle_tebrau: KtmbServiceCoverageAudit;
    rapid_rail: RapidRailCoverageAudit;
  };
  inventory_summary: {
    total_records: number;
    physical_with_od: number;
    non_physical_administrative_codes: number;
    gtfs_unmeasured_stops: number;
  };
}

export interface StationDemandFilterState {
  network: StationNetworkFilter;
  service: 'all' | StationServiceKey;
  line: string; // 'all' or exact line name
  period: string; // '12m' | 'q1'..'q4' | '2026-01'..'2026-11'
  dayType: DemandDayType;
  hourWindow: DemandHourWindow;
  selectedHour: number; // 0..23 when hourWindow === 'selected_hour'
  metricFocus: DemandMetricFocus;
  searchQuery: string;
  includeUnmeasuredStops: boolean;
  includeNonPhysicalCodes: boolean;
}

export interface ResolvedStationRow {
  station: StationInventoryRecord;
  rank: number | null;
  totalTrips: number | null;
  avgDailyTrips: number | null;
  positiveDays: number;
  observationDays: number;
  peakHour: number | null;
  peakHourAvg: number | null;
  amWindowAvg: number | null;
  pmWindowAvg: number | null;
  activeWindowValue: number | null;
  activeWindowLabel: string;
  hourlyProfile24: number[] | null;
}
