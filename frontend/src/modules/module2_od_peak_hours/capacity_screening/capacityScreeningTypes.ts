export type NetworkCode = 'ktm_komuter_kv' | 'ktm_komuter_utara';
export type NetworkFilter = 'all' | NetworkCode;
export type DayProfileFilter = 'all' | 'weekday' | 'weekend';
export type PeriodScope = 'aug18_nov26_all' | '2026-08' | '2026-09' | '2026-10' | '2026-11';
export type CapacityMode = 'official_2023_nominal' | 'planning_sensitivity_80pct';
export type StatMode = 'mean' | 'p90' | 'max_date';
export type TemporalMethod = 'schedule_traversal_base' | 'schedule_traversal_tight_0m' | 'transaction_hour_cohort';
export type ExplorerViewMode = 'station' | 'segment';
export type BottleneckStatus = 'deficit' | 'watch' | 'within_capacity' | 'no_service' | 'unavailable';
export type StatusFilter = 'all' | BottleneckStatus;
export type SortDirection = 'asc' | 'desc';

export interface ScreeningFilters {
  network: NetworkFilter;
  dayProfile: DayProfileFilter;
  period: PeriodScope;
  capacityMode: CapacityMode;
  statMode: StatMode;
  searchQuery: string;
  statusFilter: StatusFilter;
  includeUnavailable: boolean;
}

export interface SegmentSliceMetrics {
  day_count?: number;
  daily_avg_flow: number;
  daily_avg_boardings: number;
  mean_peak_hr: number;
  mean_peak_d: number;
  mean_peak_s_nom: number;
  mean_peak_lr_nom: number | null;
  mean_peak_def_nom: number;
  mean_peak_ext_nom: number;
  mean_peak_lr_80: number | null;
  mean_peak_def_80: number;
  mean_peak_ext_80: number;
  p90_peak_hr: number;
  p90_peak_date: string;
  p90_peak_d: number;
  p90_peak_s_nom: number;
  p90_peak_trains: number;
  p90_peak_lr_nom: number | null;
  p90_peak_def_nom: number;
  p90_peak_ext_nom: number;
  p90_peak_lr_80: number | null;
  p90_peak_def_80: number;
  p90_peak_ext_80: number;
  max_peak_hr: number;
  max_peak_date: string;
  max_peak_d: number;
  max_peak_s_nom: number;
  max_peak_trains: number;
  max_peak_lr_nom: number | null;
  max_peak_def_nom: number;
  max_peak_ext_nom: number;
  max_peak_lr_80: number | null;
  max_peak_def_80: number;
  max_peak_ext_80: number;
  days_deficit_nom: number;
  days_deficit_80: number;
  is_kits_anomaly_peak_date?: boolean;
  st_mean_t: number | null;
  st_mean_b: number;
  st_mean_avail_nom: number | null;
  st_mean_gap_nom: number | null;
  st_p90_t: number | null;
  st_p90_b: number;
  st_p90_avail_nom: number | null;
  st_p90_gap_nom: number | null;
  st_upstream_full_p90: boolean;
  st_max_t: number | null;
  st_max_b: number;
  st_max_avail_nom: number | null;
  st_max_gap_nom: number | null;
  st_upstream_full_max: boolean;
  tight_peak_max_d: number;
  tx_peak_max_d: number;
}

export interface SegmentSensitivitySummary {
  max_lr_range: [number, number];
  p90_lr_range: [number, number];
  mean_lr_range: [number, number];
  extra_trains_range: [number, number];
  excl_kits_max_lr: number | null;
  robust_p90_gt_100: boolean;
  robust_mean_gt_100: boolean;
}

export interface ScreenedSegmentRecord {
  segment_id: string;
  network_code: NetworkCode;
  from_stop_id: string;
  to_stop_id: string;
  from_station_name: string;
  to_station_name: string;
  routes_serving: string[];
  is_shared_trunk: boolean;
  boarding_screening_mode: 'full_station_boarding' | 'fallback_downstream_segment';
  gtfs_interpolated_missing_stop: boolean;
  train_capacity_nom: number;
  train_capacity_80: number;
  sensitivity?: SegmentSensitivitySummary | null;
  metrics: Record<string, SegmentSliceMetrics>;
}

export interface StationOutboundRef {
  segment_id: string;
  to_stop_id: string;
  to_station_name: string;
  gtfs_interpolated_missing_stop: boolean;
}

export interface ScreenedStationRecord {
  station_key: string;
  station_name: string;
  stop_id: string;
  network_code: NetworkCode;
  network_label: string;
  routes_serving: string[];
  is_junction: boolean;
  boarding_screening_mode: 'full_station_boarding' | 'fallback_downstream_segment';
  status: 'screened';
  lat: number;
  lon: number;
  outbound_segments: StationOutboundRef[];
}

export interface UnavailableStationRecord {
  station_key: string;
  station_name: string;
  network_code: string;
  network_label: string;
  status: 'unavailable';
  unavailable_code: string;
  unavailable_reason: string;
  observed_pax_gtfs_window: number;
  observed_pax_full_2026: number;
}

export interface CapacityScreeningSummarySchema {
  metadata: {
    gtfs_window_start: string;
    gtfs_window_end: string;
    excluded_pre_gtfs_window: string;
    slice_day_counts: Record<string, number>;
    slice_day_counts_by_net?: Record<string, Record<string, number>>;
    capacity_config: Record<NetworkCode, {
      official_2023_nominal: number;
      planning_sensitivity_80pct: number;
      label: string;
    }>;
    default_filters: {
      network: NetworkFilter;
      day_profile: DayProfileFilter;
      period: PeriodScope;
      capacity_mode: CapacityMode;
      stat_mode: StatMode;
      temporal_method: TemporalMethod;
    };
    scenario_disclaimer: string;
  };
  segments: ScreenedSegmentRecord[];
  stations: ScreenedStationRecord[];
  unavailable_stations: UnavailableStationRecord[];
}

export interface HourlyProfileEntry {
  mean_d: number[];
  mean_tight: number[];
  mean_tx: number[];
  cap_nom_mean: number[];
  trains_mean: number[];
  b_mean: number[];
  t_mean: (number | null)[] | null;
  peak_mean_hr: number;
  p90_date: string;
  p90_hr: number;
  p90_sched_idx: number | null;
  p90_d: number[];
  p90_tight: number[];
  p90_tx: number[];
  max_date: string;
  max_hr: number;
  max_sched_idx: number | null;
  max_d: number[];
  max_tight: number[];
  max_tx: number[];
}

export interface CapacityHourlyProfilesSchema {
  sched_catalog?: [number[], number[]][];
  profiles: Record<string, HourlyProfileEntry>;
}

export interface EvaluatedMetricSnapshot {
  loadRatioPct: number | null;
  capacityDeficit: number | null;
  extraTrainsNeeded: number | null;
  demandValue: number | null;
  scheduledCapacity: number | null;
  peakHour: number | null;
  peakDate: string | null;
  daysDeficit: number;
  dailyAvgFlow: number | null;
  dailyAvgBoardings: number | null;
  boardingThroughT: number | null;
  boardingDemandB: number | null;
  boardingAvailable: number | null;
  boardingGap: number | null;
  upstreamAlreadyFull: boolean;
  status: BottleneckStatus;
}

export interface DisplayTableRow {
  rowKey: string;
  kind: 'screened_segment' | 'screened_station' | 'unavailable_station';
  stationKey?: string;
  segmentId?: string;
  primaryName: string;
  secondaryName: string;
  directionLabel: string;
  networkCode: string;
  networkLabel: string;
  routesLabel: string;
  boardingMode: 'full_station_boarding' | 'fallback_downstream_segment' | 'unavailable';
  gtfsInterpolated: boolean;
  evalData: EvaluatedMetricSnapshot;
  unavailableReason?: string;
  observedPaxWindow?: number;
  observedPaxFull2026?: number;
}

export interface DynamicKpiSummary {
  peakLoadRatioPct: number | null;
  peakSegmentLabel: string;
  peakContextLabel: string;
  oversubscribedCount: number;
  watchCount: number;
  totalEvaluatedCount: number;
  totalSegmentDeficitDays: number;
  maxSingleSegmentExtraTrains: number;
  maxExtraTrainsSegmentLabel: string;
  activeDaysCount: number;
}

export interface DynamicDirectiveItem {
  id: string;
  badge: string;
  tone: 'crimson' | 'amber' | 'cobalt' | 'slate';
  title: string;
  metricHighlight: string;
  description: string;
  actionHint: string;
}

export interface CoverageFeasibilityRow {
  service_name: string;
  od_granularity: string;
  timetable_coverage: string;
  capacity_reference: string;
  hourly_segment_screening: string;
  station_boarding_screening: string;
  status_and_reason: string;
}

export interface UtaraScenarioSummary {
  id: string;
  label: string;
  assigned_pax: number;
  matched_pax: number;
  matched_pct: number;
  unmatched_pax: number;
  top_segment_id: string;
  top_segment_label: string;
  max_lr_pct: number;
  max_date: string;
  max_hr: number;
  max_deficit: number;
  max_extra_trains: number;
  segments_gt_100_max: number;
  segments_gt_100_p90: number;
  segments_gt_100_mean: number;
}

export interface CapacityCoverageSchema {
  feasibility_matrix: CoverageFeasibilityRow[];
  date_window_disclosure: {
    active_comparison_window: string;
    excluded_pre_gtfs_window: string;
    gtfs_calendar_exceptions_honored: { date: string; reason: string }[];
    unverified_holiday_exceptions?: { date: string; name: string; treatment: string; notes: string }[];
    additional_forensic_disclosures: string[];
  };
  utara_temporal_sensitivity?: {
    gtfs_window: string;
    days_evaluated: number;
    kits_batch_anomaly_hours: { date: string; hour: number; note: string }[];
    network_scenarios: UtaraScenarioSummary[];
    corridor_scenarios: Record<string, { label: string; scenarios: Record<string, Record<string, unknown>> }>;
    per_segment: Record<string, SegmentSensitivitySummary>;
  };
  nov09_holiday_sensitivity?: Record<string, unknown>;
  observation_window_comparison?: Record<string, string>;
  path_assignment_audit: Record<string, unknown>;
  temporal_demand_audit: Record<string, unknown>;
  scheduled_capacity_audit: Record<string, unknown>;
  gap_and_boarding_audit: Record<string, unknown>;
  other_networks_summary: Record<string, unknown>;
}

export interface CapacityMethodologySchema {
  temporal_methods: { id: string; label: string; description: string }[];
  capacity_modes: { id: string; label: string; description: string }[];
  formulas: Record<string, string>;
  stat_aggregations: Record<string, string>;
}
