export type TargetId = 'rail_lrt_ampang' | 'rail_lrt_kj' | 'rail_mrt_kajang' | 'rail_mrt_pjy' | 'rail_monorail' | 'rail_lrt_shah_alam' | 'rapid_rail_published_sum' | 'lrt3_station_origin_od';
export type Horizon = 30 | 60 | 90;
export type EvaluationHorizon = 7 | 14 | 28;
export type ForecastScope = 'full' | 'future';
export type Scenario = 'low' | 'base' | 'high';
export type DayType = 'weekday' | 'saturday' | 'sunday';
export type Direction = '0' | '1' | 'both';
export type WindowPeriod = 'all_day' | 'am_peak' | 'pm_peak' | 'off_peak';
export type DateKey = string;
export type Value = number | null;
export type Evidence = 'Observed' | 'Model Forecast' | 'Scheduled Reference' | 'Proxy Estimate' | 'Planning Assumption' | 'Unavailable';
export type Target = {
  series_id: TargetId; service_name: string; unit: string; data_cutoff: DateKey;
  model_id: string; training_policy: string; first_observed: DateKey; last_observed: DateKey;
};
export type HistoryPoint = [date: DateKey, value: Value, status: string];
export type ForecastPoint = [date: DateKey, value: number, lead: number];
export type ScenarioPoint = [date: DateKey, lead: number, low: number, base: number, high: number];
export type OutlookRow = {
  series_id: TargetId; horizon: Horizon; scope: ForecastScope; days: number; start: DateKey | null; end: DateKey | null;
  total: Value; average: Value; baseline: Value; delta: Value; change_pct: Value;
};
export type WatchRow = {
  series_id: TargetId; service_name: string; view: 'full_90_day' | 'future_only_after_as_of';
  forecast_start: DateKey; forecast_end: DateKey; forecast_days: number; forecast_mean_daily_trips: number;
  signed_change_trips_per_day: number; change_pct: number; material_change: 'increase' | 'decrease' | 'within_threshold';
  watch_uncertainty: boolean; uncertainty_reasons: string; rolling_28d_wape_pct: number;
  rolling_28d_deficit_vs_naive_pp: number; candidate_mean_spread_pct_of_recent: number;
  weekday_matched_recent_mean: number; selected_model: string;
};
export type NetworkData = {
  schemaVersion: 1; asOf: DateKey; networkId: TargetId; odId: TargetId; components: TargetId[];
  targets: Record<TargetId, Target>; daily: Record<TargetId, ForecastPoint[]>; outlook: OutlookRow[];
  watchlist: WatchRow[];
  watchRules: { material_change_pct: number; rolling_28d_wape_pct: number; rolling_28d_naive_deficit_pp: number; candidate_mean_spread_pct: number };
  scenarios: ScenarioPoint[];
  scenarioAssumptions: { low_offset_at_day_90: number; high_offset_at_day_90: number; formula: string; unit: string; interpretation: string };
};
export type HistoryData = { schemaVersion: 1; series: Record<TargetId, HistoryPoint[]> };
type Evaluation = { series_id: TargetId; horizon_days: number; folds: number | null; wape_pct: Value; mae: Value; rmse: Value; mape_pct: Value; scored_predictions: Value };
export type Metric = Evaluation & { model_id: string; phase: string; training_policy: string; validation_start: DateKey; validation_end: DateKey; unique_target_dates?: number };
export type ColdRow = Evaluation & { arm: string; source_model_id: string; donor_weight: number; origin?: DateKey; wape_gain_pp_vs_seasonal_naive: Value };
export type Stability = Evaluation & {
  model_id: string; variant: string; phase: string; train_start: DateKey | null; train_end: DateKey | null;
  forecast_mean_trips: Value; forecast_total_trips: Value; change_vs_recent_pct: Value; holt_level_gap_per_day: Value;
  holt_mean_damped_trend_per_day: Value; holt_seasonal_mix_per_day: Value;
};
export type Ablation = Evaluation & { variant: 'A' | 'B' | 'C'; wape_gain_pp_vs_previous: Value; train_rows_with_known_holiday_status_pct: Value };
export type Band = { lead_start: number; lead_end: number; selection_residuals: number; distinct_residual_dates: number; holdout_points: number; inside: number;
  coverage_pct: Value; lower_error_quantile_trips: Value; upper_error_quantile_trips: Value };
export type ResearchData = {
  schemaVersion: 1; metrics: Metric[]; cold: ColdRow[]; coldFolds: ColdRow[]; stability: Stability[];
  alternatives: Record<string, [DateKey, number][]>; ablation: Ablation[];
  uncertainty: { bands: Band[]; holdout_coverage_pct: Value; holdout_points: number; holdout_inside: number; nominal_residual_quantiles: number[];
    limitations: string; dashboard_recommendation: string };
  experimentContext: { paidServiceBoundary: DateKey; matchedInterventionFolds: number; minimumInterventionFolds: number;
    postInterventionSelected: boolean; commonNetworkHistoryDays: number; matchedNetworkOrigins: number; reusedNetworkHoldout: boolean };
};
export type PatternRow = {
  series_id: TargetId; pattern: string; group: string; period_start: DateKey | null; period_end: DateKey | null;
  observed_days: number; expected_days: Value; mean_daily_trips: Value; reference_mean_daily_trips: Value;
  reference_observations: number; difference_pct: Value; observed_total_trips?: number; matched_control_date_uses?: number;
};
export type HolidayStatus = 'verified_holiday' | 'tentative_holiday' | 'known_non_holiday' | 'unknown_calendar';
export type HolidayCalendar = {
  regions: string[]; coveredYears: number[];
  dates: Record<DateKey, { status: 'verified_holiday' | 'tentative_holiday';
    evidence: { region: string; holiday: string; kind: string; source_file: string; source_marks_date_tentative: boolean; observed_for_date?: DateKey }[] }>;
};
export type PatternsData = { schemaVersion: 1; patterns: PatternRow[]; holidayCalendar: HolidayCalendar; holidaySource: string };

export type Route = { route_id: string; route_name: string; mode: string; is_rail: boolean; intensity_status: string; mapping_notes: string };
export type Hour = { route_id: string; day_type: DayType; direction_id: Direction; direction_label: string; service_hour: number; reference_departures: Value };
export type Period = {
  route_id: string; day_type: DayType; direction_id: Direction; direction_label: string; period: WindowPeriod;
  period_start: string; period_end_exclusive: string; reference_service_start: string | null; reference_service_end: string | null;
  terminal_service_span_hours: Value; reference_departures: Value; departures_per_hour: Value; effective_headway_minutes: Value;
};
export type Intensity = {
  series_id: TargetId; service_name: string; route_ids: string; future_start: DateKey; future_end: DateKey;
  calendar_comparable_days: number; intensity_covered_days: number; intensity_dates_held_beyond_validity: number;
  intensity_status: string; intensity_reason: string; forecast_average_daily_trips: Value;
  forecast_published_trips_per_reference_departure: Value; recent_published_trips_per_same_reference_departure: Value;
  change_in_trips_per_departure_pct: Value;
};
export type SupplyStatus = 'ordinary_day_GTFS_reference' | 'reference_held_beyond_GTFS_validity' | 'unavailable_no_holiday_timetable' |
  'unavailable_tentative_holiday_timetable' | 'unavailable_unknown_holiday_calendar';
export type ServiceDate = { date: DateKey; day_type: DayType; supply_status: SupplyStatus; calendar_status: HolidayStatus;
  within_declared_calendar: boolean; scenarios: Record<Scenario, number> };
export type ProxyWindow = { window: string; start: string; end: string; share: number; resolution: 'hourly' | 'peak_period' };
export type ServiceData = {
  schemaVersion: 1; routes: Route[]; hourly: Hour[]; periods: Period[]; intensity: Intensity[];
  capacity: { passenger_places: number; source_reported_seats: number; source_url: string; source_description: string; limitations: string; verification_status: string };
  nominal: { day_type: DayType; direction_id: Direction; direction_label: string; period: WindowPeriod; departures: number; nominal_places: number }[];
  calendar: ServiceDate[]; profiles: Record<string, ProxyWindow[]>; supply: Record<DayType, Record<string, number>>;
  referenceDate: DateKey; calendarStart: DateKey; calendarEnd: DateKey; holidayDatesWithoutSupply: DateKey[]; validatedPeakRows: number;
  profileDimensions: { scopes: string[]; periods: string[] };
  windows: Record<Exclude<WindowPeriod, 'all_day'>, [number, number]>; definitions: Record<string, string>;
};

export type Screen = {
  scenario_id: string; district_id: string; district: string; screen_status: string; comparison_cohort_size: number; socioeconomic_reference_year: number;
  median_monthly_household_income_myr: Value; absolute_poverty_households_pct: Value; stations_per_100k_residents: Value;
  income_cutoff_myr: Value; poverty_cutoff_pct: Value; coverage_cutoff_stations_per_100k: Value; vulnerability_rule: 'either' | 'both';
  income_lower_quantile: number; poverty_upper_quantile: number; coverage_lower_quantile: number;
  income_at_or_below_cutoff: boolean | null; poverty_at_or_above_cutoff: boolean | null; coverage_at_or_below_cutoff: boolean | null;
  relative_vulnerability_flag: boolean | null; priority_for_further_investigation: boolean | null;
};
export type District = {
  district_id: string; district: string; state: string; district_activity_status: string;
  mapped_published_origin_codes: number;
  rapid_rail_physical_stations: Value; observed_rapid_rail_station_origin_trips: Value;
  average_daily_rapid_rail_station_origin_trips: Value; share_of_published_network_station_origin_trips_pct: Value;
  rapid_rail_station_origin_trips_per_1k_residents_period: Value;
  rapid_rail_station_origin_trips_per_physical_station_period: Value;
  average_daily_rapid_rail_station_origin_trips_per_physical_station: Value;
  observed_lrt3_station_origin_trips_step4: Value; lrt3_share_of_observed_district_station_origin_trips_pct: Value;
  total_population_residents: number; population_reference_year: number; rapid_rail_stations_per_100k_residents: Value;
};
export type DistrictCoverage = { rapid_rail_services: Value; mapped_gtfs_route_ids: string | null; lrt3_stations: Value; coverage_status: string };
export type Socioeconomic = { geographical_unit: string; latest_survey_reference_year: number; common_socioeconomic_reference_year: number; population_reference_year: number };
export type StationContribution = { station_code: string; station_name: string; district_id: string; physical_station_id: string; station_origin_trips: number; line_share_pct: number; longitude: number; latitude: number };
export type EquityData = {
  schemaVersion: 1; districts: District[]; coverage: Record<string, DistrictCoverage>; socioeconomic: Record<string, Socioeconomic>; screens: Screen[];
  primaryScenario: string; stationContributions: StationContribution[]; physicalStations: number; lrt3Stations: number; lrt3Trips: number; activityTotal: number;
  observation: { start: DateKey; end: DateKey; days: number }; putrajayaOrigins: number; putrajayaDestinations: number;
  policy: { name: string; target_percent: number; target_year: number; geographical_scope: string; official_faq: string };
  limitations: string[]; physicalDeduplication: string; scope: string; populationYear: number;
};
export type Geography = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { district_id: string; district: string; state: string }> & { schemaVersion: 1 };
export type Source = { label: string; url: string; detail?: string; regions?: string[] };
export type MethodologyData = {
  schemaVersion: 1; sources: Source[]; sections: { title: string; text: string[] }[];
  snapshot: { headlineStart: DateKey; headlineCutoff: DateKey; odStart: DateKey; odCutoff: DateKey; sourceRows: number; stationDates: number; stationDateMatches: number;
    networkOriginDays: number; surveyYears: number[]; calendarYears: number[] };
  outcomes: { selectedNetworkWape: number; baselineNetworkWape: number; networkHoldoutDays: number; shahAlamPublishedChangePct: number;
    coldStart: { seriesId: TargetId; baselineWape: number; primaryDonorWape: number }[] };
  interventions: { event: string; date: DateKey; verification: string; source: string }[];
};
export type Manifest = {
  schemaVersion: 1; dataRevision: string; analysisReferenceDate: DateKey; assets: Record<string, { bytes: number; sha256: string }>;
  inputSha256: Record<string, string>; schemas: Record<string, Record<string, { kind: string; items: number | null; rowFields: string[] | null }>>;
  validation: { protectedBackendFileCount: number; peakRowsReconciled: number };
};

export type AssetMap = {
  manifest: Manifest; network: NetworkData; history: HistoryData; research: ResearchData; patterns: PatternsData;
  service: ServiceData; equity: EquityData; geography: Geography; methodology: MethodologyData;
};
