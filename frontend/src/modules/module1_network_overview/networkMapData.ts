import type { FeatureCollection, LineString, Point, MultiPolygon } from 'geojson';
import stationData from '../../data/stations.json' with { type: 'json' };
import monthlyData from '../../data/station_monthly_ridership.json' with { type: 'json' };
import geometry from '../../data/rapid_rail_geometry.json' with { type: 'json' };
import boundary from '../../data/malaysia_country.json' with { type: 'json' };
import registry from '../../data/verified_station_registry.json' with { type: 'json' };
import { getNationalRoutes } from './nationalRailNetwork.ts';
import { CONTEXT_STATIONS } from './nationalAtlas.ts';

export type RailStation = (typeof stationData.stations)[number] & { routeIds?: string[] };
const registryLinks = registry.links as Record<string, string[]>;
export const STATION_AUDIT = { added: registry.additions.length, unmatched: registry.unmatchedExisting, unresolved: registry.unresolved };
export const DEMAND_COLORS = { lower: '#259CAF', moderate: '#E4B72D', high: '#F58232', top: '#E83346', zero: '#ffffff', missing: '#9CA8B7' };
export type DemandCategory = keyof typeof DEMAND_COLORS;
export const MALAYSIA_GEOMETRY = boundary.features[0].geometry as MultiPolygon;
export const MALAYSIA_BOUNDS: [[number, number], [number, number]] = [[99.45, 0.8], [119.55, 7.5]];
// Constrain the camera center, not the whole viewport: portrait screens need
// blank space above/below Malaysia to fit both regions without clipping.
export const MALAYSIA_MAX_BOUNDS: [[number, number], [number, number]] = [[98.7, 0.2], [120.2, 8.2]];
export const OFFICIAL_ROUTES = geometry as unknown as FeatureCollection<LineString>;
export const GEOMETRY_DATE = geometry.retrieved_at.slice(0, 10);
const officialCoordinates = geometry.station_coordinates as Record<string, number[]>;
const ridership = monthlyData.ridership_by_month as Record<string, Record<string, number>>;
const yearlyChange = monthlyData.yoy_by_month as Record<string, Record<string, number>>;
const within2026Change = (monthlyData.within_2026_by_month ?? {}) as Record<string, Record<string, number>>;
const observedDaysBySource = (monthlyData.observed_days_by_month ?? {}) as Record<string, Record<string, number>>;

export function stationKey(station: RailStation) {
  return station.source === 'rapidrail' ? `code_${station.code}`
    : `${station.source === 'komuter' ? 'kom' : 'ic'}_${station.name}`;
}

export function stationId(station: RailStation) {
  return `${station.source}:${station.code}:${station.line}:${station.name}`;
}

export function stationPosition(station: RailStation): [number, number] {
  const position = station.source === 'rapidrail' ? officialCoordinates[station.code] : undefined;
  return position ? [position[0], position[1]] : [station.lng, station.lat];
}

function inRing(point: number[], ring: number[][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, y] = ring[i], [px, py] = ring[j];
    if ((y > point[1]) !== (py > point[1]) && point[0] < (px - x) * (point[1] - y) / (py - y) + x) inside = !inside;
  }
  return inside;
}

export function isInMalaysia(point: number[]) {
  return MALAYSIA_GEOMETRY.coordinates.some(polygon =>
    inRing(point, polygon[0]) && !polygon.slice(1).some(hole => inRing(point, hole)));
}

// Exclude foreign stops (e.g. Woodlands) and unmapped positions, including on hover.
export const MAP_STATIONS: RailStation[] = [...stationData.stations, ...CONTEXT_STATIONS, ...registry.additions].map(s => ({ ...s, routeIds: ('routeIds' in s ? s.routeIds as string[] : undefined) ?? registryLinks[s.source+':'+s.code] ?? [] })).filter(s => {
  if (/^(unknown|penalty)$/i.test(s.name)) return false;
  const point = stationPosition(s);
  return point.every(Number.isFinite) && isInMalaysia(point);
});

export function getStationObservedDays(station: RailStation, month: string): number | null {
  if (station.source === 'reference') return null;
  const days = observedDaysBySource[station.source]?.[month];
  return typeof days === 'number' && days > 0 ? days : null;
}

export function getStationData(station: RailStation, month: string) {
  if (station.source === 'reference') return { ridership: null, yoy: null };
  const key = stationKey(station);
  return { ridership: ridership[month]?.[key] ?? null, yoy: yearlyChange[month]?.[key] ?? null };
}

const routeIdsByName = new Map(getNationalRoutes('All Lines').features.map(f => [f.properties?.name, String(f.properties?.id)]));
const RAPID_SINGLE_LINES = new Set([
  'LRT Kelana Jaya',
  'MRT Kajang',
  'MRT Putrajaya',
  'KL Monorail',
  'LRT Shah Alam',
  'LRT Ampang–Sri Petaling',
]);

export function stationMatchesLine(station: RailStation, selectedLine: string): boolean {
  if (selectedLine === 'All Lines') return true;
  if (RAPID_SINGLE_LINES.has(selectedLine)) {
    return station.source === 'rapidrail' && station.line === selectedLine;
  }
  if (selectedLine === 'LRT Ampang') {
    return station.source === 'rapidrail' && station.line === 'LRT Ampang–Sri Petaling' && !!station.routeIds?.includes('shp_AG_0');
  }
  if (selectedLine === 'LRT Sri Petaling') {
    return station.source === 'rapidrail' && station.line === 'LRT Ampang–Sri Petaling' && !!station.routeIds?.includes('shp_PH_0');
  }
  if (selectedLine === 'KTM Tebrau Shuttle' || selectedLine === 'KTM Shuttle Tebrau') {
    return station.source !== 'rapidrail' && station.source !== 'komuter' && !!station.routeIds?.includes('ktmb_ST');
  }
  if (selectedLine === 'KTM Komuter') {
    return station.source === 'komuter' || (station.source === 'reference' && ['ktmb_KC05_KB18', 'ktmb_KA15_KD19'].some(id => !!station.routeIds?.includes(id)));
  }
  if (selectedLine === 'KTM Komuter (Seremban Line)' || selectedLine === 'KTM Komuter (Port Klang Line)') {
    const rid = routeIdsByName.get(selectedLine);
    return (station.source === 'komuter' || station.source === 'reference') && (station.line === selectedLine || (!!rid && !!station.routeIds?.includes(rid)));
  }
  if (selectedLine === 'KTM Komuter Utara') {
    return station.source !== 'rapidrail' && station.source !== 'komuter' && ['ktmb_100_9000', 'ktmb_100_47300'].some(id => !!station.routeIds?.includes(id));
  }
  if (selectedLine === 'KTM Komuter Utara (Ipoh)' || selectedLine === 'KTM Komuter Utara (Padang Besar)') {
    const rid = routeIdsByName.get(selectedLine);
    return station.source !== 'rapidrail' && station.source !== 'komuter' && (station.line === selectedLine || (!!rid && !!station.routeIds?.includes(rid)));
  }
  if (selectedLine === 'KTM ETS') {
    return station.source !== 'rapidrail' && station.source !== 'komuter' && (station.line === 'KTM ETS' || !!station.routeIds?.includes('ktmb_ETS'));
  }
  if (selectedLine === 'KTM Intercity') {
    return station.source !== 'rapidrail' && (station.line === 'KTM Intercity' || ['ktmb_SH', 'ktmb_ERT', 'ktmb_SS'].some(id => !!station.routeIds?.includes(id)));
  }
  if (['KTM Intercity Shuttle', 'KTM Ekspres Rakyat Timuran', 'KTM Komuter Shuttle Selatan'].includes(selectedLine)) {
    const rid = routeIdsByName.get(selectedLine);
    return station.source !== 'rapidrail' && (station.line === selectedLine || (!!rid && !!station.routeIds?.includes(rid)));
  }
  if (station.line === selectedLine) return true;
  const routeId = routeIdsByName.get(selectedLine);
  return !!routeId && !!station.routeIds?.includes(routeId);
}

export function classifyDemand(value: number | null, thresholds: { p50: number | null; p75: number | null; p90: number | null }): DemandCategory {
  if (value === null) return 'missing';
  if (value === 0) return 'zero';
  if (thresholds.p90 !== null && value >= thresholds.p90) return 'top';
  if (thresholds.p75 !== null && value >= thresholds.p75) return 'high';
  if (thresholds.p50 !== null && value >= thresholds.p50) return 'moderate';
  return 'lower';
}

function getUniqueEligibleStations(visible: RailStation[], selectedLine: string): RailStation[] {
  if (selectedLine === 'All Lines') {
    const seen = new Set<string>();
    return visible.filter(s => {
      const k = s.source === 'reference' ? stationId(s) : stationKey(s);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  // Prevent duplicate counting of shared physical stations across branches/inter-source KTMB stops
  const byKey = new Map<string, RailStation>();
  const sourceRank = (src: string) => (src === 'intercity' ? 3 : src === 'komuter' ? 2 : src === 'rapidrail' ? 4 : 1);
  for (const s of visible) {
    const dedupId = s.source === 'rapidrail'
      ? s.code
      : `name:${s.name.toLowerCase().trim()}`;
    const existing = byKey.get(dedupId);
    if (!existing || sourceRank(s.source) > sourceRank(existing.source)) {
      byKey.set(dedupId, s);
    }
  }
  return [...byKey.values()];
}

export interface CoverageSummary {
  measured: number;
  zeroCount: number;
  total: number;
  primaryText: string;
  secondaryText: string;
}

export function getStationSnapshot(month: string, selectedLine: string, selectedStation: string) {
  const rawVisible = MAP_STATIONS.filter(s => stationMatchesLine(s, selectedLine));
  const visible = getUniqueEligibleStations(rawVisible, selectedLine);
  const eligibleIds = new Set(visible.map(s => stationId(s)));

  // Nearest-rank percentiles over positive observations across unique eligible stations
  const values = [...new Map(visible.map(s => [stationKey(s), getStationData(s, month).ridership])).values()]
    .filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  const percentile = (p: number) => values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : null;
  const thresholds = { p50: percentile(0.5), p75: percentile(0.75), p90: percentile(0.9) };

  const features = MAP_STATIONS.map(station => {
    const { ridership: value, yoy } = getStationData(station, month);
    const inScope = eligibleIds.has(stationId(station));
    const category = classifyDemand(value, thresholds);
    return {
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: stationPosition(station) },
      properties: {
        id: stationId(station),
        name: station.name,
        line: station.line,
        code: station.code,
        value,
        yoy,
        category,
        busy: inScope && category === 'top',
        inScope,
        selected: station.name === selectedStation && inScope,
        color: inScope ? DEMAND_COLORS[category] : '#cbd5e1',
        radius: 4,
        regional: false,
      },
    };
  });

  const measuredStations = visible.filter(s => getStationData(s, month).ridership !== null);
  const zeroCount = measuredStations.filter(s => getStationData(s, month).ridership === 0).length;
  const ranked = [...measuredStations].sort(
    (a, b) => (getStationData(b, month).ridership ?? 0) - (getStationData(a, month).ridership ?? 0),
  );

  // Dynamic coverage description derived from active scope & measured sources
  const measuredSources = new Set(measuredStations.map(s => s.source));
  const primaryText = `Data coverage · ${measuredStations.length}/${visible.length} stations`;
  let secondaryText: string;
  if (month < '2023-09') {
    secondaryText = 'Station-level ridership unavailable (begins Sep 2023)';
  } else if (month < '2026-01') {
    secondaryText = measuredStations.length > 0
      ? 'KTM Komuter OD only · Rapid Rail begins Jan 2026'
      : 'Rapid Rail station data begins Jan 2026';
  } else if (measuredStations.length === 0) {
    secondaryText = 'No station-level ridership supplied for this corridor';
  } else {
    const srcLabels: string[] = [];
    if (measuredSources.has('rapidrail')) srcLabels.push('Rapid Rail');
    if (measuredSources.has('komuter')) srcLabels.push('KTM Komuter');
    if (measuredSources.has('intercity')) srcLabels.push('Intercity');
    const srcText = srcLabels.length === 3
      ? 'Rapid Rail, KTM Komuter & Intercity'
      : srcLabels.join(' & ');
    secondaryText = zeroCount > 0 ? `${srcText} · ${zeroCount} observed zero` : srcText;
  }

  const coverage: CoverageSummary = {
    measured: measuredStations.length,
    zeroCount,
    total: visible.length,
    primaryText,
    secondaryText,
  };

  return {
    data: { type: 'FeatureCollection', features } as FeatureCollection<Point>,
    threshold: thresholds.p90,
    thresholds,
    measured: measuredStations.length,
    total: visible.length,
    ranked,
    coverage,
  };
}

export interface SelectedStationSummary {
  ridership: number | null;
  observedDays: number | null;
  dailyAvg: number | null;
  rank: number | null;
  rankedTotal: number;
  growthPct: number | null;
  growthLabel: string;
  comparisonNote: string;
}

export function getSelectedStationSummary(
  station: RailStation,
  month: string,
  ranked: RailStation[],
): SelectedStationSummary {
  const data = getStationData(station, month);
  if (data.ridership === null) {
    return {
      ridership: null,
      observedDays: null,
      dailyAvg: null,
      rank: null,
      rankedTotal: ranked.length,
      growthPct: null,
      growthLabel: 'Unavailable',
      comparisonNote: 'No boarding observation in this month',
    };
  }

  const key = stationKey(station);
  const observedDays = getStationObservedDays(station, month);
  const dailyAvg = observedDays ? data.ridership / observedDays : null;
  const within2026 = station.source === 'reference' ? null : (within2026Change[month]?.[key] ?? null);

  // Competition rank (1, 2, 2, 4) across unique measured stations in scope
  const targetVal = data.ridership;
  const rank = 1 + ranked.filter(s => (getStationData(s, month).ridership ?? -1) > targetVal).length;

  let growthPct: number | null = null;
  let growthLabel = 'Baseline N/A';
  let comparisonNote = 'No valid non-zero baseline';

  if (data.yoy !== null) {
    growthPct = data.yoy;
    const prevY = Number(month.slice(0, 4)) - 1;
    const prevYm = `${prevY}-${month.slice(5, 7)}`;
    growthLabel = `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}% YoY`;
    comparisonNote = `Daily avg vs ${prevYm}`;
  } else if (within2026 !== null && month > '2026-01') {
    growthPct = within2026;
    growthLabel = `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}% vs Jan 2026`;
    comparisonNote = 'Within-2026 daily avg (non-YoY)';
  } else if (month === '2026-01' && station.source !== 'komuter') {
    growthLabel = 'First OD month';
    comparisonNote = 'Rapid Rail / Intercity OD starts Jan 2026';
  }

  return {
    ridership: data.ridership,
    observedDays,
    dailyAvg,
    rank,
    rankedTotal: ranked.length,
    growthPct,
    growthLabel,
    comparisonNote,
  };
}
