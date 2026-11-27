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
  p90_peak_lr_nom: number;
  p90_peak_def_nom: number;
  p90_peak_ext_nom: number;
  p90_peak_lr_80: number;
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
  max_peak_lr_80: number;
  max_peak_def_80: number;
  max_peak_ext_80: number;
  days_deficit_nom: number;
  days_deficit_80: number;
  st_mean_t: number | null;
  st_mean_b: number;
  st_mean_avail_nom: number | null;
  st_mean_gap_nom: number | null;
  st_max_t: number | null;
  st_max_b: number;
  st_max_avail_nom: number | null;
  st_max_gap_nom: number | null;
  st_upstream_full_max: boolean;
  tight_peak_max_d: number;
  tx_peak_max_d: number;
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
  base_mean: number[];
  base_p90: number[];
  base_max: number[];
  tight_mean: number[];
  tx_mean: number[];
  cap_nom_mean: number[];
  trains_mean: number[];
  b_mean: number[];
  t_mean: (number | null)[] | null;
  peak_mean_hr: number;
  peak_max_hr: number;
}

export interface CapacityHourlyProfilesSchema {
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

export interface CapacityCoverageSchema {
  feasibility_matrix: CoverageFeasibilityRow[];
  date_window_disclosure: {
    active_comparison_window: string;
    excluded_pre_gtfs_window: string;
    gtfs_calendar_exceptions_honored: { date: string; reason: string }[];
    additional_forensic_disclosures: string[];
  };
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
