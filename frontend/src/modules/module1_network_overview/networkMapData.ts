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

export function getStationData(station: RailStation, month: string) {
  if (station.source === 'reference') return { ridership: null, yoy: null };
  const key = stationKey(station);
  return { ridership: ridership[month]?.[key] ?? null, yoy: yearlyChange[month]?.[key] ?? null };
}

const routeIdsByName = new Map(getNationalRoutes('All Lines').features.map(f => [f.properties?.name, String(f.properties?.id)]));
export function stationMatchesLine(station: RailStation, selectedLine: string) {
  if (selectedLine === 'All Lines' || station.line === selectedLine) return true;
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

export function getStationSnapshot(month: string, selectedLine: string, selectedStation: string) {
  const visible = MAP_STATIONS.filter(s => stationMatchesLine(s, selectedLine));
  // Nearest-rank percentiles of positive observations; ties receive the same category.
  const values = [...new Map(visible.map(s => [stationKey(s), getStationData(s, month).ridership])).values()]
    .filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  const percentile = (p: number) => values.length ? values[Math.max(0, Math.ceil(values.length*p)-1)] : null;
  const thresholds = { p50: percentile(.5), p75: percentile(.75), p90: percentile(.9) };
  const features = MAP_STATIONS.map(station => {
    const { ridership: value, yoy } = getStationData(station, month);
    const inScope = stationMatchesLine(station, selectedLine);
    const category = classifyDemand(value, thresholds);
    return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: stationPosition(station) },
      properties: { id: stationId(station), name: station.name, line: station.line, code: station.code,
        value, yoy, category, busy: inScope && category === 'top', inScope, selected: station.name === selectedStation && inScope,
        color: inScope ? DEMAND_COLORS[category] : '#cbd5e1', radius: 4, regional: false,
      } };
  });
  const ranked = visible.filter(s => getStationData(s, month).ridership !== null)
    .sort((a, b) => (getStationData(b, month).ridership ?? 0) - (getStationData(a, month).ridership ?? 0));
  return { data: { type: 'FeatureCollection', features } as FeatureCollection<Point>, threshold: thresholds.p90, thresholds,
    measured: visible.filter(s => getStationData(s, month).ridership !== null).length, total: visible.length, ranked };
}
