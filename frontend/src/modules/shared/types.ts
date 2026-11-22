// Shared types for TransitPulse Malaysia

export interface Station {
  code: string;
  name: string;
  line: string;
  source: string;
  latitude?: number;
  longitude?: number;
}

export type TabId = 'network_overview' | 'od_peak_hours' | 'drivers_forecast' | 'whatif_simulator';

export interface NavTab {
  id: TabId;
  label: string;
  icon: string;
}

export const NAV_TABS: NavTab[] = [
  { id: 'network_overview',  label: 'Network Overview',              icon: '🗺️' },
  { id: 'od_peak_hours',     label: 'OD Flow & Peak Hours',          icon: '📊' },
  { id: 'drivers_forecast',  label: 'Demand Drivers & Forecasting',  icon: '📈' },
  { id: 'whatif_simulator',  label: 'What-If Simulator',             icon: '⚙️' },
];

// Design tokens
export const COLORS = {
  blue:   '#0066FF',
  orange: '#FF5A00',
  green:  '#00E5A3',
  red:    '#EF4444',
  text:   '#0F1E36',
  muted:  '#64748B',
  bg:     '#F1F4F9',
} as const;

// Rail line color palette for charts/map
export const LINE_COLORS: Record<string, string> = {
  'LRT Kelana Jaya':          '#0066FF',
  'MRT Kajang':               '#00C48C',
  'LRT Ampang–Sri Petaling':  '#E53935',
  'MRT Putrajaya':            '#7B61FF',
  'KL Monorail':              '#FF8C00',
  'LRT Shah Alam':            '#00BCD4',
  'KTM Komuter':              '#FF5A00',
  'KTM Komuter Utara':        '#8B4513',
  'KTM ETS':                  '#4CAF50',
  'KTM Tebrau Shuttle':       '#9E9E9E',
  'KTM Intercity':            '#795548',
  // KTMB services
  'komuter':                  '#FF5A00',
  'komuter_utara':            '#8B4513',
  'ets':                      '#4CAF50',
  'shuttle_tebrau':           '#9E9E9E',
  'intercity':                '#795548',
};

export function formatMillions(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function formatServiceLabel(service: string): string {
  const map: Record<string, string> = {
    komuter:        'KTM Komuter',
    komuter_utara:  'KTM Komuter Utara',
    ets:            'KTM ETS',
    shuttle_tebrau: 'Tebrau Shuttle',
    intercity:      'KTM Intercity',
  };
  return map[service] ?? service;
}
