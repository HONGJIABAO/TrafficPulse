/* Module-level type overrides for JSON data imports */
declare module '@/data/network_overview.json' {
  const value: {
    generated_at: string;
    kpis: {
      total_rail_trips: number;
      data_period: string;
      yoy_growth_pct: number;
      comparison_year: number;
      busiest_line: string;
      busiest_line_total: number;
      busiest_line_share_pct: number;
      peak_hour_window: string;
      peak_hour_note: string;
    };
    monthly_trend: Array<{
      year_month: string;
      year: number;
      month: number;
      total: number;
      lines: Record<string, number>;
    }>;
    line_performance: Array<{
      line: string;
      column: string;
      total_ridership: number;
      share_pct: number;
      yoy_growth_pct: number | null;
    }>;
    ktmb_services: Array<{
      service: string;
      total_ridership: number;
      share_pct: number;
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
