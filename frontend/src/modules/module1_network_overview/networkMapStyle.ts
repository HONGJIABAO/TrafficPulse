import type { StyleSpecification, ExpressionSpecification } from 'maplibre-gl';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { MALAYSIA_GEOMETRY } from './networkMapData.ts';
import states from '../../data/malaysia_states.json' with { type: 'json' };
import { STATE_LABELS } from './nationalAtlas.ts';
import { createLandmarkModels } from './landmarkModels.ts';

// An opaque polygon with Malaysia cut out, including the country's interior holes.
// It is above every base layer and below our Malaysian rail/station layers.
const outsideMask: FeatureCollection<Polygon> = {
  type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: {
    type: 'Polygon', coordinates: [
      [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]],
      ...MALAYSIA_GEOMETRY.coordinates.map(polygon => polygon[0]),
    ],
  } }, ...MALAYSIA_GEOMETRY.coordinates.flatMap(polygon => polygon.slice(1).map(ring => ({
    type: 'Feature' as const, properties: {}, geometry: { type: 'Polygon' as const, coordinates: [ring] },
  })))],
};
const within: ExpressionSpecification = ['within', MALAYSIA_GEOMETRY];
const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
const font = ['Noto Sans Regular'];

export function createNetworkStyle(): StyleSpecification {
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">OpenMapTiles</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' },
      malaysia: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: MALAYSIA_GEOMETRY } },
      outside: { type: 'geojson', data: outsideMask },
      routes: { type: 'geojson', data: empty },
      stations: { type: 'geojson', data: empty },
      states: { type: 'geojson', data: states as FeatureCollection<MultiPolygon> },
      'state-names': { type: 'geojson', data: STATE_LABELS },
      landmarks: { type: 'geojson', data: createLandmarkModels(5) },
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.4, position: [1.5, 210, 35] },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#eaf0f3' } },
      { id: 'malaysia-land', type: 'fill', source: 'malaysia', paint: { 'fill-color': '#f8faf9' } },
      { id: 'state-land', type: 'fill', source: 'states', paint: { 'fill-color': ['case',
        ['==', ['%', ['get', 'code_state'], 2], 0], '#f5f8f7', '#edf3f2'], 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.8, 11, 0] } },
      { id: 'state-borders', type: 'line', source: 'states', maxzoom: 12,
        paint: { 'line-color': '#b8c9ce', 'line-width': 0.85, 'line-dasharray': [3, 2] } },
      { id: 'parks', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', minzoom: 9,
        filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#e2ede5', 'fill-opacity': 0.65 } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', minzoom: 8,
        paint: { 'fill-color': '#c7e1e8' } },
      { id: 'waterways', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', minzoom: 12,
        paint: { 'line-color': '#b6d7e1', 'line-width': 2 } },
      { id: 'roads-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 10,
        filter: ['!=', ['get', 'class'], 'rail'], paint: { 'line-color': '#dfe4e6',
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 16, 6, 19, 15] } },
      { id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', minzoom: 12,
        filter: ['!=', ['get', 'class'], 'rail'], paint: { 'line-color': '#ffffff',
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 4, 19, 12] } },
      { id: 'building-footprints', type: 'fill', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        paint: { 'fill-color': '#f9fbfc', 'fill-outline-color': '#d8e0e5' } },
      { id: 'buildings-3d', type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 13,
        // `within` supports points and lines, not building polygons. The opaque country mask clips buildings.
        paint: { 'fill-extrusion-color': '#ffffff', 'fill-extrusion-opacity': 0.96,
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5,
            ['min', 24, ['max', 7, ['*', 0.18, ['to-number', ['coalesce', ['get', 'render_height'], ['get', 'height']], 9]]]]],
          'fill-extrusion-base': 0 } },
      { id: 'city-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place', minzoom: 7,
        filter: ['all', within, ['match', ['get', 'class'], ['city', 'town', 'suburb'], true, false]],
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name']], 'text-font': font, 'text-size': 12 },
        paint: { 'text-color': '#647782', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
      { id: 'outside-malaysia', type: 'fill', source: 'outside', paint: { 'fill-color': '#eaf0f3', 'fill-opacity': 1 } },
      { id: 'malaysia-outline', type: 'line', source: 'malaysia', paint: { 'line-color': '#acbfc7', 'line-width': 1.2 } },
      { id: 'landmark-models', type: 'fill-extrusion', source: 'landmarks',
        paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'base'], 'fill-extrusion-opacity': 1 } },
      { id: 'rail-shadow', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#54768b', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 13, 10], 'line-blur': 2,
          'line-opacity': ['case', ['get', 'inScope'], 0.17, 0.04] } },
      { id: 'rail-casing', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 4.8, 12, 7, 16, 9],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 5, ['*', 0.65, ['get', 'laneOffset']], 12, ['get', 'laneOffset']],
          'line-opacity': ['case', ['get', 'inScope'], 0.97, 0.25] } },
      { id: 'rail-lines', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 2.6, 12, 4, 16, 5.5],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 5, ['*', 0.65, ['get', 'laneOffset']], 12, ['get', 'laneOffset']],
          'line-opacity': ['case', ['get', 'inScope'], 0.95, 0.2] } },
      { id: 'rail-detail', type: 'line', source: 'routes', minzoom: 9,
        paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2, 16, 4],
          'line-offset': ['interpolate', ['linear'], ['zoom'], 5, ['*', 0.65, ['get', 'laneOffset']], 12, ['get', 'laneOffset']],
          'line-dasharray': [0.35, 4], 'line-opacity': ['case', ['get', 'inScope'], 0.55, 0.08] } },
      // Mask after routes as well, so cross-border reference corridors are never shown abroad.
      { id: 'rail-country-mask', type: 'fill', source: 'outside', paint: { 'fill-color': '#eaf0f3' } },
      { id: 'state-labels', type: 'symbol', source: 'state-names', maxzoom: 11,
        filter: ['==', ['get', 'territory'], false],
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 7, 12],
          'text-letter-spacing': 0.03, 'text-transform': 'uppercase', 'text-max-width': 7, 'text-allow-overlap': true },
        paint: { 'text-color': '#4e707d', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
      { id: 'territory-labels', type: 'symbol', source: 'state-names', minzoom: 7, maxzoom: 12,
        filter: ['==', ['get', 'territory'], true], layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 12 },
        paint: { 'text-color': '#4e707d', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
      { id: 'station-heat', type: 'heatmap', source: 'stations', layout: { visibility: 'none' },
        filter: ['all', ['get', 'inScope'], ['>', ['get', 'value'], 0]], paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'value'], 0, 0, 1600000, 1],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 8, 13, 28, 17, 45], 'heatmap-opacity': 0.6,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,255,255,0)', 0.2, '#ffe1c2', 0.6, '#f89b64', 1, '#d72943'],
        } },
      { id: 'station-selection', type: 'circle', source: 'stations', filter: ['==', ['get', 'selected'], true],
        paint: { 'circle-radius': 12, 'circle-color': '#1168df', 'circle-opacity': 0.13, 'circle-stroke-color': '#1168df', 'circle-stroke-width': 2 } },
      { id: 'station-dots', type: 'circle', source: 'stations', layout: { 'circle-sort-key': ['coalesce', ['get', 'value'], 0] },
        paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, ['*', ['case', ['get', 'busy'], 0.75, 0.45], ['get', 'radius']], 10, ['get', 'radius']], 'circle-color': ['get', 'color'],
          'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 10, 1.4], 'circle-stroke-color': ['case', ['==', ['get', 'value'], 0], '#64748b', '#ffffff'],
          'circle-opacity': ['case', ['get', 'inScope'], 1, 0.25], 'circle-stroke-opacity': ['case', ['get', 'inScope'], 1, 0.25] } },
      { id: 'station-labels', type: 'symbol', source: 'stations', minzoom: 12.5,
        filter: ['==', ['get', 'inScope'], true], layout: { 'text-field': ['get', 'name'], 'text-font': font,
          'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true,
          'symbol-sort-key': ['-', 0, ['coalesce', ['get', 'value'], 0]] },
        paint: { 'text-color': '#293c4c', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } },
      // Invisible generous hit area preserves small visual dots without tiny click targets.
      { id: 'station-hit-area', type: 'circle', source: 'stations', filter: ['get', 'inScope'],
        paint: { 'circle-radius': 12, 'circle-opacity': 0 } },
    ],
  };
}
