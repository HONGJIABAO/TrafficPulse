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

export interface ModePeriodSummary {
  total_trips: number;
  weekday_trips: number;
  weekend_trips: number;
  unique_od_all: number;
  unique_od_weekday: number;
  unique_od_weekend: number;
  top_od: {
    all: OdRawPair[];
    weekday: OdRawPair[];
    weekend: OdRawPair[];
  };
  heatmap: {
    all: HeatmapPoint[];
    weekday: HeatmapPoint[];
    weekend: HeatmapPoint[];
  };
  weekday_vs_weekend: WeekdayVsWeekendData;
}

export interface PeriodDataset {
  label: string;
  date_range: string;
  total_days: number;
  weekday_days: number;
  weekend_days: number;
  komuter: ModePeriodSummary;
  intercity: ModePeriodSummary;
}

export interface MonthlyTotalRecord {
  year_month: string;
  days: number;
  weekday_days: number;
  weekend_days: number;
  date_range: string;
  komuter_trips: number;
  intercity_trips: number;
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
    data_quality: {
      komuter_2026: DatasetQualityReport;
      intercity_2026: DatasetQualityReport;
      rapid_rail_2026: {
        note: string;
        top_pairs_count: number;
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
