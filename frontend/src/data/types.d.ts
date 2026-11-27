/* Module-level type overrides for JSON data imports */
declare module '@/data/network_overview.json' {
  interface PeakHourBucket {
    hour: number;
    avg_trips: number;
    total_trips: number;
  }
  interface PeakWindowSummary {
    window_24h: string;
    window_display: string;
    start_hour: number;
    end_hour: number;
    avg_daily_trips: number;
    share_of_daily_pct: number;
  }
  interface PeakCohortSummary {
    observed_days: number;
    avg_daily_trips: number;
    single_peak_hour: {
      window_24h: string;
      hour: number;
      avg_daily_trips: number;
    };
    am_peak_2h: PeakWindowSummary;
    pm_peak_2h: PeakWindowSummary;
    hourly_profile: PeakHourBucket[];
  }
  const value: {
    generated_at: string;
    kpis: {
      total_rail_trips: number;
      data_period: string;
      yoy_growth_pct: number;
      comparison_year: number;
      headline_start: string;
      headline_end: string;
      headline_period: string;
      ytd_yoy_growth_pct: number | null;
      ytd_comparison_label: string | null;
      busiest_line: string;
      busiest_line_total: number;
      busiest_line_share_pct: number;
      peak_hour_window: string;
      peak_hour_am_24h: string;
      peak_hour_pm_24h: string;
      peak_hour_sub: string;
      peak_hour_note: string;
    };
    peak_analysis: {
      service_scope: string;
      timezone: string;
      observation_start: string;
      observation_end: string;
      observed_days: number;
      calendar_span_days: number;
      missing_calendar_days: number;
      total_hourly_od_rows: number;
      total_hourly_trips: number;
      daily_reconciliation: {
        matched_dates: number;
        exact_matches: number;
        max_abs_delta: number | null;
      };
      methodology: string;
      all_days: PeakCohortSummary;
      weekday_mon_fri: PeakCohortSummary;
      weekend_sat_sun: PeakCohortSummary;
    };
    coverage: {
      headline_ridership: { start: string; end: string; days: number };
      ktmb_daily: { start: string; end: string; services: number };
      komuter_hourly: { start: string; end: string; observed_days: number };
    };
    sources: Array<{
      dataset: string;
      publisher: string;
      url?: string;
      period?: string;
      granularity: string;
      license: string;
    }>;
    monthly_trend: Array<{
      year_month: string;
      year: number;
      month: number;
      days?: number;
      total: number;
      lines: Record<string, number>;
      line_days?: Record<string, number>;
    }>;
    legacy_comparison?: {
      lines_included: string[];
      full_2019_total: number;
      full_2019_days: number;
      full_2019_daily_avg: number;
      ytd_2019_label: string;
      ytd_2019_total: number;
      ytd_2019_days: number;
      ytd_2019_daily_avg: number;
      ytd_latest_label: string;
      ytd_latest_total: number;
      ytd_latest_days: number;
      ytd_latest_daily_avg: number;
      vs_full_2019_daily_pct: number | null;
      vs_same_period_2019_daily_pct: number | null;
      per_line: Array<{
        line: string;
        column: string;
        full_2019_daily_avg: number;
        ytd_2019_daily_avg: number;
        ytd_latest_daily_avg: number;
        vs_full_2019_pct: number | null;
        vs_same_period_2019_pct: number | null;
      }>;
    };
    line_performance: Array<{
      line: string;
      column: string;
      total_ridership: number;
      share_pct: number;
      yoy_growth_pct: number | null;
      observation_start: string | null;
      observation_end: string | null;
      observed_days: number;
      active_period: string;
    }>;
    ktmb_services: Array<{
      service: string;
      total_ridership: number;
      share_pct: number;
      observation_start: string;
      observation_end: string;
      observed_days: number;
      yoy_growth_pct: number | null;
    }>;
    ktmb_monthly_trend: Array<{
      year_month: string;
      year: number;
      month: number;
      service: string;
      ridership: number;
    }>;
  };
  export default value;
}

declare module '@/data/stations.json' {
  const value: {
    generated_at: string;
    total_stations: number;
    stations: Array<{
      code: string;
      name: string;
      line: string;
      source: string;
      lat: number;
      lng: number;
    }>;
    lines: string[];
  };
  export default value;
}

declare module '@/data/od_summary.json' { const value: Record<string, unknown>; export default value; }
declare module '@/data/forecast_demand.json' { const value: Record<string, unknown>; export default value; }
declare module '@/data/simulator_baseline.json' { const value: Record<string, unknown>; export default value; }

declare module '@/data/station_monthly_ridership.json' {
  const value: {
    global_max_ridership: number;
    observed_days_by_month?: Record<string, Record<string, number>>;
    ridership_by_month: Record<string, Record<string, number>>;
    yoy_by_month: Record<string, Record<string, number>>;
    within_2026_by_month?: Record<string, Record<string, number>>;
  };
  export default value;
}

