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
