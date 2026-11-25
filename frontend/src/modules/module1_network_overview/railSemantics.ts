import type { FeatureCollection, Point, Position } from 'geojson';
import { DEMAND_COLORS } from './networkMapData.ts';
import type { DemandCategory } from './networkMapData.ts';

// Operational exploration catchment, not an administrative boundary. Includes
// outer Klang Valley commuter terminals, airport rail and all Rapid Rail stops.
export const KLANG_CATCHMENT = [[101.25, 2.45], [102.25, 3.75]] as const;
export const KLANG_ANCHOR: [number, number] = [101.6861, 3.1342];
export const REGION_ENTER_ZOOM = 9;
export const REGION_EXIT_ZOOM = 8;
export function inKlangValley(p: Position) {
  return p[0] >= KLANG_CATCHMENT[0][0] && p[0] <= KLANG_CATCHMENT[1][0] && p[1] >= KLANG_CATCHMENT[0][1] && p[1] <= KLANG_CATCHMENT[1][1];
}
export function regionSummary(data: FeatureCollection<Point>) {
  const members = data.features.filter(f => f.properties?.inScope && inKlangValley(f.geometry.coordinates));
  const measured = members.filter(f => f.properties?.value !== null).length;
  const categories = members.map(f => f.properties?.category as DemandCategory);
  const category: DemandCategory = (['top','high','moderate','lower'] as const).find(c => categories.includes(c))
    ?? (members.length && measured === members.length && categories.every(c => c === 'zero') ? 'zero' : 'missing');
  return { category, color: DEMAND_COLORS[category], measured, total: members.length, incomplete: measured < members.length };
}
export function displayStations(data: FeatureCollection<Point>, clustered: boolean): FeatureCollection<Point> {
  if (!clustered) return data;
  const summary = regionSummary(data);
  const features = data.features.filter(f => !inKlangValley(f.geometry.coordinates));
  if (summary.total) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: KLANG_ANCHOR }, properties: {
    id: 'klang-valley', name: 'Klang Valley', line: 'Regional exploration', code: '', value: null,
    category: summary.category, color: summary.color, busy: summary.category === 'top', inScope: true,
    selected: false, radius: 4, regional: true, measured: summary.measured, total: summary.total,
  } });
  return { type: 'FeatureCollection', features };
}

export function boundsOf(points: Position[]): [[number,number],[number,number]] {
  return [[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],
    [Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]];
}

// Camera extent only: do not reuse the wider statistical catchment. Include
// every Rapid Rail endpoint, then the urban portions of commuter/airport rail.
export function klangCameraPoints(routes:FeatureCollection<import('geojson').LineString>, stations:Position[]) {
  const rapid=routes.features.filter(f=>String(f.properties?.id).startsWith('shp_'));
  const points=rapid.flatMap(f=>f.geometry.coordinates);
  const urban=(p:Position)=>p[0]>=101.30&&p[0]<=101.90&&p[1]>=2.90&&p[1]<=3.30;
  for(const route of routes.features)points.push(...route.geometry.coordinates.filter(urban));
  points.push(...stations.filter(urban));
  return points;
}
