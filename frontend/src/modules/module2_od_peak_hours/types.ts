// Module 2: OD Flow & Peak Hours — TypeScript Definitions
// TransitPulse Malaysia — Rail Mobility Analytics

export interface OdRawPair {
  origin: string;
  destination: string;
  total_ridership: number;
  avg_daily?: number;
}

export interface ResolvedOdFlow {
  id: string;
  rank: number;
  origin: string;
  originClean: string;
  destination: string;
  destinationClean: string;
  mode: 'komuter' | 'rapid_rail' | 'intercity';
  modeLabel: string;
  volume: number;
  avgDaily: number;
  sharePct: number;
  observationDays: number;
  originCoords: [number, number] | null;
  destCoords: [number, number] | null;
  isVerifiedCoords: boolean;
  corridorType: string;
  distanceKm: number | null;
  haulCategory: 'short' | 'medium' | 'long' | 'unknown';
}

export interface HeatmapPoint {
  weekday: number; // 1 = Mon .. 5 = Fri (Weekday), 6 = Sat .. 7 = Sun (Weekend)
  hour: number;    // 0 .. 23
  ridership: number;
}

export interface HourlyPoint {
  hour: number;
  avg_ridership: number;
}

export interface WeekdayVsWeekendData {
  weekday_days?: number;
  weekend_days?: number;
  weekday: HourlyPoint[];
  weekend: HourlyPoint[];
}

export interface DistanceStats {
  total_trips: number;
  mapped_trips: number;
  mapped_coverage_pct: number;
  total_pairs: number;
  mapped_pairs: number;
  weighted_distance_sum: number;
  weighted_avg_km: number | null;
  short_trips: number;
  medium_trips: number;
  long_trips: number;
  short_pct: number;
  medium_pct: number;
  long_pct: number;
}

export interface ModePeriodSummary {
  total_trips: number;
  weekday_trips: number;
  weekend_trips: number;
  source_reported_total_trips?: number;
  source_reported_weekday_trips?: number;
  source_reported_weekend_trips?: number;
  excluded_admin_trips?: number;
  excluded_admin_pairs?: number;
  unique_od_all: number;
  unique_od_weekday: number;
  unique_od_weekend: number;
  top_od: {
    all: OdRawPair[];
    weekday: OdRawPair[];
    weekend: OdRawPair[];
  };
  distance_stats?: {
    all: DistanceStats;
    weekday: DistanceStats;
    weekend: DistanceStats;
  };
  heatmap?: {
    all: HeatmapPoint[];
    weekday: HeatmapPoint[];
    weekend: HeatmapPoint[];
  };
  weekday_vs_weekend?: WeekdayVsWeekendData;
}

export interface PeriodDataset {
  label: string;
  date_range: string;
  total_days: number;
  weekday_days: number;
  weekend_days: number;
  komuter: ModePeriodSummary;
  intercity: ModePeriodSummary;
  rapid_rail?: ModePeriodSummary;
}

export interface MonthlyTotalRecord {
  year_month: string;
  days: number;
  weekday_days: number;
  weekend_days: number;
  date_range: string;
  komuter_trips: number;
  komuter_source_trips?: number;
  komuter_excluded_admin_trips?: number;
  intercity_trips: number;
  intercity_source_trips?: number;
  intercity_excluded_admin_trips?: number;
  rapid_rail_trips?: number;
}

export interface DatasetQualityReport {
  dataset: string;
  raw_rows: number;
  valid_rows: number;
  nulls: Record<string, number>;
  non_positive_ridership: number;
  exact_duplicates: number;
  invalid_dates: number;
  date_range: string;
  expected_days: number;
  actual_days: number;
  missing_days: number;
  admin_reconciliation?: {
    source_reported_trips: number;
    physical_od_trips: number;
    excluded_admin_trips: number;
    excluded_admin_rows: number;
    excluded_admin_pairs: number;
    origin_penalty_trips: number;
    dest_penalty_trips: number;
    origin_unknown_trips: number;
    dest_unknown_trips: number;
    dual_admin_trips: number;
    dual_admin_rows: number;
    physical_self_loop_trips: number;
    physical_self_loop_pairs: number;
  };
}

export interface OdSummarySchema {
  generated_at: string;
  metadata?: {
    observation_window: string;
    total_days: number;
    weekday_days: number;
    weekend_days: number;
    day_classification_rule: string;
    corridor_definition: string;
    included_od_services?: string[];
    excluded_od_services_note?: string;
    admin_exclusion_policy?: string;
    distance_methodology?: string;
    data_quality: {
      komuter_2026: DatasetQualityReport;
      intercity_2026: DatasetQualityReport;
      rapid_rail_2026: {
        note?: string;
        top_pairs_count?: number;
        top_pairs_visual_limit?: number;
        non_a0_total_trips?: number;
        total_non_a0_pairs_all?: number;
        positive_non_a0_pairs?: number;
        zero_ridership_pairs?: number;
        shah_alam_discrepancy?: {
          note: string;
          jan_jul_od_trips: number;
          aug_nov_od_trips: number;
        };
      };
    };
  };
  periods?: Record<string, PeriodDataset>;
  monthly_totals?: MonthlyTotalRecord[];
  monthly_periods?: Record<string, PeriodDataset>;
  weekday_hour_heatmap: {
    komuter: HeatmapPoint[];
    intercity: HeatmapPoint[];
    note?: string;
  };
  top_od_pairs: {
    komuter: OdRawPair[];
    rapid_rail: OdRawPair[];
    intercity: OdRawPair[];
  };
  weekday_vs_weekend: {
    komuter: WeekdayVsWeekendData;
    intercity: WeekdayVsWeekendData;
  };
}

export type OdModeFilter = 'all' | 'rapid_rail' | 'komuter' | 'intercity';
export type DayTypeFilter = 'all' | 'weekday' | 'weekend';
export type TimeRangeFilter = '12m' | 'q4' | 'q3' | 'q2' | 'q1';
export type PeakTimeFilter = 'all' | 'am_peak' | 'midday' | 'pm_peak';
export type HaulFilter = 'all' | 'short' | 'medium' | 'long';
