// Module 2: OD Flow & Peak Hours — TypeScript Definitions
// TransitPulse Malaysia — MDIT Datathon 2026

export interface OdRawPair {
  origin: string;
  destination: string;
  total_ridership: number;
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
  originCoords: [number, number];
  destCoords: [number, number];
  corridorType: string;
  asymmetryRatio?: number;
}

export interface HeatmapPoint {
  weekday: number; // 1 = Mon .. 7 = Sun
  hour: number;    // 0 .. 23
  ridership: number;
}

export interface HourlyPoint {
  hour: number;
  avg_ridership: number;
}

export interface WeekdayVsWeekendData {
  weekday: HourlyPoint[];
  weekend: HourlyPoint[];
}

export type OdModeFilter = 'all' | 'rapid_rail' | 'komuter' | 'intercity';
export type DayTypeFilter = 'all' | 'weekday' | 'weekend';
export type TimeRangeFilter = '12m' | 'q4' | 'q3' | 'q2' | 'q1';
