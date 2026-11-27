// Module 2 — Station Demand Intelligence Utilities
// Strictly separates hourly-supported KTMB station telemetry from daily-only Rapid Rail
// and unmeasured GTFS stops (e.g., BRT Sunway). Never fabricates missing hours or assigns 00:00 placeholders.

import type {
  AvailabilityStatus,
  StationDailyProfilesPayload,
  StationDemandCoveragePayload,
  StationDemandFilterState,
  StationDemandSummaryPayload,
  StationHourlyProfilesPayload,
  StationInventoryPayload,
  StationInventoryRecord,
  ResolvedStationRow,
  SortDirection,
  SortField,
} from './stationDemandTypes';

export const DEFAULT_STATION_DEMAND_FILTERS: StationDemandFilterState = {
  network: 'all',
  service: 'all',
  line: 'all',
  period: '12m',
  dayType: 'all',
  hourWindow: 'all',
  selectedHour: 8,
  metricFocus: 'daily_avg',
  searchQuery: '',
  includeUnmeasuredStops: false,
  includeNonPhysicalCodes: false,
};

export function formatHourClock24(hour: number | null | undefined): string {
  if (hour === null || hour === undefined || !Number.isFinite(hour)) return 'N/A';
  const h = Math.max(0, Math.min(23, Math.trunc(hour)));
  return `${String(h).padStart(2, '0')}:00`;
}

export function formatHourWindow24(hour: number | null | undefined): string {
  if (hour === null || hour === undefined || !Number.isFinite(hour)) return 'Hourly Unavailable';
  const h = Math.max(0, Math.min(23, Math.trunc(hour)));
  return `${String(h).padStart(2, '0')}:00–${String(h).padStart(2, '0')}:59`;
}

export function getServiceOptionsForNetwork(
  network: StationDemandFilterState['network']
): Array<{ value: StationDemandFilterState['service']; label: string }> {
  const allServices: Array<{
    value: StationDemandFilterState['service'];
    label: string;
    networks: Array<StationDemandFilterState['network']>;
  }> = [
    { value: 'all', label: 'All Services in Scope', networks: ['all', 'ktmb', 'rapid_rail', 'brt'] },
    { value: 'rapid_rail', label: 'Rapid Rail (LRT / MRT / Monorail)', networks: ['all', 'rapid_rail'] },
    { value: 'komuter', label: 'KTM Komuter (Klang Valley)', networks: ['all', 'ktmb'] },
    { value: 'komuter_utara', label: 'KTM Komuter Utara', networks: ['all', 'ktmb'] },
    { value: 'ets', label: 'KTM ETS (Electric Train Service)', networks: ['all', 'ktmb'] },
    { value: 'intercity', label: 'KTM Intercity', networks: ['all', 'ktmb'] },
    { value: 'shuttle_tebrau', label: 'Shuttle Tebrau', networks: ['all', 'ktmb'] },
    { value: 'brt', label: 'BRT Sunway (GTFS Only — No OD)', networks: ['all', 'brt'] },
    { value: 'ktmb_gtfs_only', label: 'KTMB GTFS Only (No OD)', networks: ['all', 'ktmb'] },
  ];
  return allServices
    .filter((item) => item.networks.includes(network))
    .map(({ value, label }) => ({ value, label }));
}

export function getAvailableLines(
  stations: StationInventoryRecord[],
  network: StationDemandFilterState['network'],
  service: StationDemandFilterState['service']
): string[] {
  const lineSet = new Set<string>();
  for (const st of stations) {
    if (network !== 'all' && st.network !== network) continue;
    if (service !== 'all' && st.service !== service) continue;
    if (st.line) lineSet.add(st.line);
  }
  return Array.from(lineSet).sort((a, b) => a.localeCompare(b));
}

export function computeObservationDays(
  summary: StationDemandSummaryPayload,
  period: string,
  dayType: StationDemandFilterState['dayType']
): number {
  const cat = summary.period_catalog?.[period] || summary.period_catalog?.['12m'];
  if (!cat) return 324;
  if (dayType === 'weekday') return cat.weekday_days;
  if (dayType === 'weekend') return cat.weekend_days;
  return cat.all_days;
}

export function resolveStationRows(
  inventory: StationInventoryPayload,
  summary: StationDemandSummaryPayload,
  hourlyProfiles: StationHourlyProfilesPayload | null,
  filters: StationDemandFilterState
): ResolvedStationRow[] {
  const periodMetrics = summary.metrics?.[filters.period]?.[filters.dayType] || {};
  const periodHourly = hourlyProfiles?.profiles?.[filters.period]?.[filters.dayType] || {};
  const observationDays = computeObservationDays(summary, filters.period, filters.dayType);
  const query = filters.searchQuery.trim().toLowerCase();

  const matchingStations = inventory.stations.filter((st) => {
    if (!st.is_physical_station && !filters.includeNonPhysicalCodes) {
      return false;
    }
    if (st.availability_status === 'unavailable_no_od_data' && !filters.includeUnmeasuredStops) {
      return false;
    }
    if (filters.network !== 'all' && st.network !== filters.network) {
      return false;
    }
    if (filters.service !== 'all' && st.service !== filters.service) {
      return false;
    }
    if (filters.line !== 'all' && st.line !== filters.line) {
      return false;
    }
    if (query) {
      const hay = [
        st.name,
        st.raw_name,
        st.station_code || '',
        st.gtfs_stop_id || '',
        st.line,
        st.service_label,
        st.physical_interchange_name || '',
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const rows: ResolvedStationRow[] = matchingStations.map((st) => {
    const isUnmeasured = st.availability_status === 'unavailable_no_od_data';
    const metric = !isUnmeasured ? periodMetrics[st.id] : undefined;

    if (isUnmeasured) {
      return {
        station: st,
        rank: null,
        totalTrips: null,
        avgDailyTrips: null,
        positiveDays: 0,
        observationDays,
        peakHour: null,
        peakHourAvg: null,
        amWindowAvg: null,
        pmWindowAvg: null,
        activeWindowValue: null,
        activeWindowLabel: 'No Open OD Data',
        hourlyProfile24: null,
      };
    }

    const totalTrips = metric ? metric.tot : 0;
    const avgDailyTrips = metric ? metric.avg : 0;
    const positiveDays = metric ? metric.pos_d : 0;

    // Strictly enforce hourly_supported: Rapid Rail and non-physical entries NEVER receive synthetic hourly values.
    const hourlyAllowed = Boolean(st.hourly_supported && st.is_physical_station);
    const rawProfile = hourlyAllowed ? periodHourly[st.id] : undefined;
    const hourlyProfile24 =
      hourlyAllowed && Array.isArray(rawProfile) && rawProfile.length === 24
        ? rawProfile
        : hourlyAllowed && totalTrips === 0
        ? Array.from({ length: 24 }, () => 0)
        : null;

    const peakHour = hourlyAllowed && metric ? metric.pk_h : null;
    const peakHourAvg = hourlyAllowed && metric ? metric.pk_avg : null;
    const amWindowAvg = hourlyAllowed && metric ? metric.am_avg : null;
    const pmWindowAvg = hourlyAllowed && metric ? metric.pm_avg : null;

    let activeWindowValue: number | null = avgDailyTrips;
    let activeWindowLabel = 'Avg Daily Trips';

    if (filters.hourWindow === 'am_peak') {
      activeWindowValue = amWindowAvg;
      activeWindowLabel = 'AM Peak Window (06:00–09:59)';
    } else if (filters.hourWindow === 'pm_peak') {
      activeWindowValue = pmWindowAvg;
      activeWindowLabel = 'PM Peak Window (17:00–20:59)';
    } else if (filters.hourWindow === 'selected_hour') {
      const h = Math.max(0, Math.min(23, Math.trunc(filters.selectedHour)));
      activeWindowValue = hourlyProfile24 ? hourlyProfile24[h] : null;
      activeWindowLabel = `Hour ${formatHourWindow24(h)} Avg/Day`;
    } else if (filters.metricFocus === 'peak_hour') {
      activeWindowValue = peakHourAvg;
      activeWindowLabel = 'Peak Hour Avg (trips/hr)';
    }

    return {
      station: st,
      rank: null,
      totalTrips,
      avgDailyTrips,
      positiveDays,
      observationDays,
      peakHour,
      peakHourAvg,
      amWindowAvg,
      pmWindowAvg,
      activeWindowValue,
      activeWindowLabel,
      hourlyProfile24,
    };
  });

  // Compute deterministic physical rank within the active filtered scope
  const rankEligible = rows
    .filter(
      (r) =>
        r.station.is_physical_station &&
        r.station.availability_status !== 'unavailable_no_od_data' &&
        r.activeWindowValue !== null
    )
    .sort((a, b) => {
      const va = a.activeWindowValue ?? -1;
      const vb = b.activeWindowValue ?? -1;
      if (vb !== va) return vb - va;
      const ta = a.totalTrips ?? -1;
      const tb = b.totalTrips ?? -1;
      if (tb !== ta) return tb - ta;
      return a.station.id.localeCompare(b.station.id);
    });

  rankEligible.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return rows;
}

export function sortStationRows(
  rows: ResolvedStationRow[],
  sortField: SortField,
  sortDirection: SortDirection
): ResolvedStationRow[] {
  const dir = sortDirection === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const va = getSortValue(a, sortField);
    const vb = getSortValue(b, sortField);

    // Nulls always sink to the bottom regardless of sort direction
    if (va === null && vb === null) {
      return a.station.name.localeCompare(b.station.name);
    }
    if (va === null) return 1;
    if (vb === null) return -1;

    if (typeof va === 'number' && typeof vb === 'number') {
      if (va !== vb) return (va - vb) * dir;
    } else {
      const cmp = String(va).localeCompare(String(vb));
      if (cmp !== 0) return cmp * dir;
    }

    const ra = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rb = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.station.name.localeCompare(b.station.name);
  });
}

function getSortValue(row: ResolvedStationRow, field: SortField): number | string | null {
  switch (field) {
    case 'rank':
      return row.rank;
    case 'name':
      return row.station.name.toLowerCase();
    case 'service':
      return row.station.service_label.toLowerCase();
    case 'peakHour':
      return row.peakHour;
    case 'peakAvg':
      return row.peakHourAvg;
    case 'avgDaily':
      return row.avgDailyTrips;
    case 'totalTrips':
      return row.totalTrips;
  }
}

export interface StationSpotlightMetrics {
  topDailyStation: ResolvedStationRow | null;
  topHourlyPeakStation: ResolvedStationRow | null;
  filteredTotalTrips: number;
  filteredAvgDailyTrips: number;
  physicalMeasuredCount: number;
  hourlySupportedCount: number;
  dailyOnlyCount: number;
  unmeasuredCount: number;
  observationDays: number;
}

export function computeSpotlightMetrics(
  rows: ResolvedStationRow[],
  observationDays: number
): StationSpotlightMetrics {
  const physicalMeasured = rows.filter(
    (r) => r.station.is_physical_station && r.station.availability_status !== 'unavailable_no_od_data'
  );
  const hourlySupported = physicalMeasured.filter(
    (r) => r.station.hourly_supported && r.peakHourAvg !== null
  );
  const dailyOnlyCount = physicalMeasured.filter((r) => !r.station.hourly_supported).length;
  const unmeasuredCount = rows.filter(
    (r) => r.station.availability_status === 'unavailable_no_od_data'
  ).length;

  const topDailyStation =
    [...physicalMeasured].sort(
      (a, b) => (b.avgDailyTrips ?? -1) - (a.avgDailyTrips ?? -1) || (b.totalTrips ?? -1) - (a.totalTrips ?? -1)
    )[0] || null;

  const topHourlyPeakStation =
    [...hourlySupported].sort(
      (a, b) => (b.peakHourAvg ?? -1) - (a.peakHourAvg ?? -1) || (b.totalTrips ?? -1) - (a.totalTrips ?? -1)
    )[0] || null;

  const filteredTotalTrips = physicalMeasured.reduce((acc, r) => acc + (r.totalTrips ?? 0), 0);
  const filteredAvgDailyTrips =
    observationDays > 0 ? Math.round((filteredTotalTrips / observationDays) * 10) / 10 : 0;

  return {
    topDailyStation,
    topHourlyPeakStation,
    filteredTotalTrips,
    filteredAvgDailyTrips,
    physicalMeasuredCount: physicalMeasured.length,
    hourlySupportedCount: hourlySupported.length,
    dailyOnlyCount,
    unmeasuredCount,
    observationDays,
  };
}

export function getAvailabilityBadgeTone(status: AvailabilityStatus): {
  bg: string;
  color: string;
  border: string;
} {
  switch (status) {
    case 'complete':
      return { bg: '#ECFDF5', color: '#047857', border: '#A7F3D0' };
    case 'complete_daily_only':
      return { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' };
    case 'partial_active_period':
      return { bg: '#FFF7ED', color: '#C2410C', border: '#FED7AA' };
    case 'non_physical_fee_or_unknown':
      return { bg: '#FEF3C7', color: '#92400E', border: '#FDE68A' };
    case 'unavailable_no_od_data':
      return { bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' };
  }
}

export function computeDailySeriesSummary(
  row: ResolvedStationRow,
  dailyProfiles: StationDailyProfilesPayload | null,
  period: string,
  dayType: StationDemandFilterState['dayType']
): {
  labels: string[];
  values: (number | null)[];
  mode: 'daily' | 'monthly';
  weekdayAvg: number | null;
  weekendAvg: number | null;
} | null {
  if (!dailyProfiles) return null;

  if (row.station.network === 'rapid_rail' && dailyProfiles.rapid_rail_daily?.[row.station.id]) {
    const rawValues = dailyProfiles.rapid_rail_daily[row.station.id];
    const allDates = dailyProfiles.dates;
    const filteredLabels: string[] = [];
    const filteredValues: number[] = [];
    let wdSum = 0;
    let wdCount = 0;
    let weSum = 0;
    let weCount = 0;

    for (let i = 0; i < allDates.length && i < rawValues.length; i += 1) {
      const dateStr = allDates[i];
      if (period === 'q1' && (dateStr < '2026-01-01' || dateStr > '2026-03-31')) continue;
      if (period === 'q2' && (dateStr < '2026-04-01' || dateStr > '2026-06-30')) continue;
      if (period === 'q3' && (dateStr < '2026-07-01' || dateStr > '2026-09-30')) continue;
      if (period === 'q4' && (dateStr < '2026-10-01' || dateStr > '2026-11-20')) continue;
      if (period.startsWith('2026-') && !dateStr.startsWith(period)) continue;

      const d = new Date(`${dateStr}T00:00:00Z`);
      const dow = d.getUTCDay();
      const isWeekend = dow === 0 || dow === 6;
      wdSum += isWeekend ? 0 : rawValues[i];
      wdCount += isWeekend ? 0 : 1;
      weSum += isWeekend ? rawValues[i] : 0;
      weCount += isWeekend ? 1 : 0;

      if (dayType === 'weekday' && isWeekend) continue;
      if (dayType === 'weekend' && !isWeekend) continue;

      filteredLabels.push(dateStr);
      filteredValues.push(rawValues[i]);
    }

    return {
      labels: filteredLabels,
      values: filteredValues,
      mode: 'daily',
      weekdayAvg: wdCount > 0 ? Math.round((wdSum / wdCount) * 10) / 10 : null,
      weekendAvg: weCount > 0 ? Math.round((weSum / weCount) * 10) / 10 : null,
    };
  }

  const trend = dailyProfiles.monthly_trends?.[row.station.id];
  if (!trend) return null;

  const seriesValues =
    dayType === 'weekday'
      ? trend.weekday_avg_daily
      : dayType === 'weekend'
      ? trend.weekend_avg_daily
      : trend.avg_daily;

  const wdValid = trend.weekday_avg_daily.filter((v): v is number => v !== null);
  const weValid = trend.weekend_avg_daily.filter((v): v is number => v !== null);
  return {
    labels: trend.months,
    values: seriesValues,
    mode: 'monthly',
    weekdayAvg:
      wdValid.length > 0 ? Math.round((wdValid.reduce((a, b) => a + b, 0) / wdValid.length) * 10) / 10 : null,
    weekendAvg:
      weValid.length > 0 ? Math.round((weValid.reduce((a, b) => a + b, 0) / weValid.length) * 10) / 10 : null,
  };
}

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildStationCsvContent(rows: ResolvedStationRow[], scopeLabel: string): string {
  const headers = [
    'Rank',
    'Station ID',
    'Station Name',
    'Raw Name',
    'GTFS Stop ID',
    'Operator',
    'Network',
    'Service',
    'Line',
    'Availability Status',
    'Hourly Supported',
    'Peak Hour (MYT)',
    'Peak Hour Avg (trips/hr)',
    'AM Peak 06-09 Avg (trips/d)',
    'PM Peak 17-20 Avg (trips/d)',
    'Avg Daily Trips',
    'Period Total Trips',
    'Positive Days',
    'Observation Days',
    'Lat',
    'Lng',
    'Active Filter Scope',
  ];

  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) {
    const st = r.station;
    lines.push(
      [
        r.rank ?? '—',
        st.id,
        st.name,
        st.raw_name,
        st.gtfs_stop_id ?? '',
        st.operator,
        st.network,
        st.service_label,
        st.line,
        st.availability_label,
        st.hourly_supported ? 'Yes' : 'No',
        r.peakHour !== null ? formatHourWindow24(r.peakHour) : 'Hourly Unavailable',
        r.peakHourAvg ?? 'Hourly Unavailable',
        r.amWindowAvg ?? 'Hourly Unavailable',
        r.pmWindowAvg ?? 'Hourly Unavailable',
        r.avgDailyTrips ?? 'No Data',
        r.totalTrips ?? 'No Data',
        r.positiveDays,
        r.observationDays,
        st.lat ?? '',
        st.lng ?? '',
        scopeLabel,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

export function generateStationDemandInsight(
  spotlight: StationSpotlightMetrics,
  filters: StationDemandFilterState,
  coverage: StationDemandCoveragePayload | null
): {
  headline: string;
  detail: string;
  shahAlamDisclosure: string | null;
} {
  const topDaily = spotlight.topDailyStation;
  const topHourly = spotlight.topHourlyPeakStation;

  let headline = 'No verified physical stations match the active filter combination.';
  let detail = 'Clear search text or broaden network/service filters to inspect verified 2026 station demand.';

  if (topDaily && topHourly) {
    headline = `${topDaily.station.name} (${topDaily.station.service_label}) leads filtered daily demand at ${Math.round(
      topDaily.avgDailyTrips || 0
    ).toLocaleString()} origin trips/day; highest hourly concentration in KTMB logs occurs at ${topHourly.station.name} (${topHourly.station.service_label}) during ${formatHourWindow24(
      topHourly.peakHour
    )} (${Math.round(topHourly.peakHourAvg || 0).toLocaleString()} trips/hr).`;

    detail = `Filtered scope covers ${spotlight.physicalMeasuredCount} measured physical stations totalling ${spotlight.filteredTotalTrips.toLocaleString()} trips across ${spotlight.observationDays} observation days (${spotlight.hourlySupportedCount} stations with sub-hourly KTMB timestamps; ${spotlight.dailyOnlyCount} daily-only Rapid Rail stations). These figures reflect observed passenger origin demand without inferring rolling-stock capacity or overcrowding.`;
  } else if (topDaily) {
    headline = `${topDaily.station.name} (${topDaily.station.line}) leads Rapid Rail filtered demand at ${Math.round(
      topDaily.avgDailyTrips || 0
    ).toLocaleString()} origin trips/day (${(topDaily.totalTrips || 0).toLocaleString()} total trips across ${
      spotlight.observationDays
    } days).`;

    detail = `All ${spotlight.dailyOnlyCount} Rapid Rail stations in view originate from full-matrix daily AFC OD aggregates (0-delta reconciled against station-to-A0 marginals; hourly timestamps are unavailable in Prasarana open data). Sub-hourly station peaks require KTMB services or future operator AFC hourly releases.`;
  }

  const hasShahAlamScope =
    (filters.network === 'all' || filters.network === 'rapid_rail') &&
    (filters.service === 'all' || filters.service === 'rapid_rail') &&
    (filters.line === 'all' || filters.line.includes('Shah Alam'));

  const saAudit = coverage?.services?.rapid_rail?.shah_alam_audit;
  const shahAlamDisclosure =
    hasShahAlamScope && saAudit?.aug1_to_nov20_trips
      ? `Shah Alam Line (SA) Disclosure: All ${saAudit.stations_in_od} active SA stations appear across all 324 days, recording ${saAudit.jan1_to_jul31_trips.toLocaleString()} paid gate OD trips from Jan 1–Jul 31 (overlapping June 29 free launch in headline series) and ${saAudit.aug1_to_nov20_trips.toLocaleString()} paid origin trips from Aug 1–Nov 20 (${saAudit.positive_od_days} active days; period daily averages use the full calendar denominator).`
      : null;

  return { headline, detail, shahAlamDisclosure };
}
