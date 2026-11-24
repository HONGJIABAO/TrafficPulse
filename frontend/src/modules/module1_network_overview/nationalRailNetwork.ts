import type { FeatureCollection, LineString } from 'geojson';
import rapid from '../../data/rapid_rail_geometry.json' with { type: 'json' };
import ktmb from '../../data/ktmb_rail_geometry.json' with { type: 'json' };
import { CONTEXT_ROUTES } from './nationalAtlas.ts';
import { isCorridorMatch } from './railCorridors.ts';

const ktmbOffsets: Record<string, number> = { ktmb_KC05_KB18: -2, ktmb_KA15_KD19: 2,
  ktmb_100_47300: -2, ktmb_100_9000: 2, ktmb_ETS: 0, ktmb_SH: -2, ktmb_ERT: 2 };

export function getNationalRoutes(selectedLine: string): FeatureCollection<LineString> {
  return { type: 'FeatureCollection', features: [
    ...(rapid.features as FeatureCollection<LineString>['features']),
    ...(ktmb.features as FeatureCollection<LineString>['features']), ...CONTEXT_ROUTES.features,
  ].map(feature => ({ ...feature, properties: { ...feature.properties,
    laneOffset: feature.properties?.laneOffset ?? ktmbOffsets[feature.properties?.id] ?? 0,
    inScope: isCorridorMatch(feature.properties?.name ?? '', selectedLine),
  } })) };
}

// At national scale, use one shared east-coast corridor instead of joining
// every shuttle stop. Several published shuttle coordinates produce sharp
// backtracking; this overview uses the express service's reference corridor.
// Detailed views retain the unmodified official stop sequences.
export function getAtlasRoutes(selectedLine: string): FeatureCollection<LineString> {
  const routes = getNationalRoutes(selectedLine);
  const eastCoast = routes.features.find(f => f.properties?.id === 'ktmb_ERT');
  return { ...routes, features: routes.features.map(feature => {
    if (feature.properties?.id !== 'ktmb_SH' || !eastCoast) return feature;
    return { ...feature, properties: { ...feature.properties, displayGeometry: 'Shared east-coast reference corridor' },
      geometry: { type: 'LineString', coordinates: eastCoast.geometry.coordinates.filter(p => p[1] >= 4.18).toReversed() } };
  }) };
}
