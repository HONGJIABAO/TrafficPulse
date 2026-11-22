// Shared TypeScript types across all 4 modules
// Placeholder definitions - to be populated during module development

export interface Station {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  line?: string;
}

export type ModuleTab =
  | 'network_overview'
  | 'od_peak_hours'
  | 'drivers_forecast'
  | 'whatif_simulator';
