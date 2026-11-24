import type { FeatureCollection, LineString, Point, MultiPolygon } from 'geojson';
import stationData from '../../data/stations.json' with { type: 'json' };
import monthlyData from '../../data/station_monthly_ridership.json' with { type: 'json' };
import geometry from '../../data/rapid_rail_geometry.json' with { type: 'json' };
import boundary from '../../data/malaysia_country.json' with { type: 'json' };
import { CONTEXT_STATIONS } from './nationalAtlas.ts';

export type RailStation = (typeof stationData.stations)[number];
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
export const MAP_STATIONS = [...stationData.stations, ...CONTEXT_STATIONS].filter(s => {
  if (/^(unknown|penalty)$/i.test(s.name)) return false;
  const point = stationPosition(s);
  return point.every(Number.isFinite) && isInMalaysia(point);
});

export function getStationData(station: RailStation, month: string) {
  if (station.source === 'reference') return { ridership: null, yoy: null };
  const key = stationKey(station);
  return { ridership: ridership[month]?.[key] ?? null, yoy: yearlyChange[month]?.[key] ?? null };
}

export function getStationSnapshot(month: string, selectedLine: string, selectedStation: string) {
  const visible = MAP_STATIONS.filter(s => selectedLine === 'All Lines' || s.line === selectedLine);
  // Count each source key once when computing the percentile; missing data is not zero.
  const values = [...new Map(visible.map(s => [stationKey(s), getStationData(s, month).ridership])).values()]
    .filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  const threshold = values.length ? values[Math.max(0, Math.ceil(values.length * 0.9) - 1)] : null;
  const maximum = values.at(-1) ?? 1;
  const features = MAP_STATIONS.map(station => {
    const { ridership: value, yoy } = getStationData(station, month);
    const inScope = selectedLine === 'All Lines' || station.line === selectedLine;
    const busy = inScope && value !== null && value > 0 && threshold !== null && value >= threshold;
    return { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: stationPosition(station) },
      properties: { id: stationId(station), name: station.name, line: station.line, code: station.code,
        value, yoy, busy, inScope, selected: station.name === selectedStation && inScope,
        color: !inScope ? '#cbd5e1' : value === null ? '#a1acbc' : busy ? '#e23845' : value === 0 ? '#ffffff' : '#288ca4',
        radius: !inScope ? 2 : value === null || value === 0 ? 3 : 3 + Math.sqrt(value / maximum) * 3,
      } };
  });
  const ranked = visible.filter(s => getStationData(s, month).ridership !== null)
    .sort((a, b) => (getStationData(b, month).ridership ?? 0) - (getStationData(a, month).ridership ?? 0));
  return { data: { type: 'FeatureCollection', features } as FeatureCollection<Point>, threshold,
    measured: visible.filter(s => getStationData(s, month).ridership !== null).length,
    total: visible.length, ranked };
}
