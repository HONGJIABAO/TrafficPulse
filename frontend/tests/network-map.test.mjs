import test from 'node:test';
import assert from 'node:assert/strict';
import spec from '@maplibre/maplibre-gl-style-spec';
import { createNetworkStyle } from '../src/modules/module1_network_overview/networkMapStyle.ts';
import { getStationSnapshot, getStationData, isInMalaysia, MAP_STATIONS, OFFICIAL_ROUTES, stationPosition } from '../src/modules/module1_network_overview/networkMapData.ts';
import { getNationalRoutes } from '../src/modules/module1_network_overview/nationalRailNetwork.ts';
import { NATIONAL_LANDMARKS, STATE_LABELS, CONTEXT_STATIONS } from '../src/modules/module1_network_overview/nationalAtlas.ts';
import states from '../src/data/malaysia_states.json' with { type: 'json' };
import { createLandmarkModels } from '../src/modules/module1_network_overview/landmarkModels.ts';
import { atlasData, atlasPoint, geographicPoint } from '../src/modules/module1_network_overview/atlasLayout.ts';

test('compact atlas is reversible and keeps route/station coordinates aligned without mutating data', () => {
  for (const station of MAP_STATIONS) {
    const original = stationPosition(station);
    const restored = geographicPoint(atlasPoint(original));
    assert.ok(restored.every((n,i) => Math.abs(n-original[i]) < 1e-9));
  }
  const source = getStationSnapshot('2026-08', 'All Lines', 'All Stations').data;
  const before = structuredClone(source);
  const display = atlasData(source);
  assert.deepEqual(source, before);
  source.features.forEach((f,i) => {
    assert.deepEqual(display.features[i].properties, f.properties);
    assert.deepEqual(display.features[i].geometry.coordinates, atlasPoint(f.geometry.coordinates));
  });
  assert.deepEqual(spec.validateStyleMin(createNetworkStyle(true)), []);
  assert.ok(atlasPoint([116.1,6])[0] - 101.7 < 8);
});

test('Malaysia geography includes both regions and excludes neighbouring countries', () => {
  for (const position of [[101.7, 3.15], [116.1, 5.98], [110.34, 1.55]]) assert.equal(isInMalaysia(position), true);
  for (const position of [[103.8, 1.3], [100.5, 13.75], [114.94, 4.89]]) assert.equal(isInMalaysia(position), false);
  assert.equal(MAP_STATIONS.some(s => /^(Unknown|Penalty|Hat Yai)$/i.test(s.name)), false);
});

test('official routes include all seven rail lines and retain track geometry', () => {
  assert.equal(OFFICIAL_ROUTES.features.length, 7);
  assert.ok(OFFICIAL_ROUTES.features.every(f => f.geometry.coordinates.length > 20));
  assert.ok(OFFICIAL_ROUTES.features.every(f => !f.properties.name.includes('BRT')));
  // GTFS fixes the old shared approximate position of the two Bukit Bintang stations.
  const stops = MAP_STATIONS.filter(s => s.name === 'Bukit Bintang');
  assert.notDeepEqual(stationPosition(stops[0]), stationPosition(stops[1]));
});

test('a month without station observations never invents a hot spot', () => {
  const snapshot = getStationSnapshot('2019-01', 'All Lines', 'All Stations');
  assert.equal(snapshot.threshold, null);
  assert.equal(snapshot.measured, 0);
  assert.ok(snapshot.data.features.every(f => f.properties.value === null && !f.properties.busy));
});

test('zero remains distinct from missing and does not contribute to hot spots', () => {
  const snapshot = getStationSnapshot('2026-03', 'LRT Shah Alam', 'All Stations');
  const zeros = snapshot.data.features.filter(f => f.properties.inScope && f.properties.value === 0);
  assert.ok(zeros.length > 0);
  assert.ok(zeros.every(f => !f.properties.busy && f.properties.color === '#ffffff'));
  const missing = getStationSnapshot('2019-01', 'LRT Shah Alam', 'All Stations');
  assert.notEqual(zeros[0].properties.color, missing.data.features.find(f => f.properties.inScope).properties.color);
});

test('line filtering and month changes recompute station values and red markers', () => {
  const august = getStationSnapshot('2026-08', 'LRT Kelana Jaya', 'KLCC');
  const march = getStationSnapshot('2026-03', 'LRT Kelana Jaya', 'KLCC');
  assert.ok(august.data.features.filter(f => f.properties.busy).every(f => f.properties.line === 'LRT Kelana Jaya'));
  const selected = august.data.features.filter(f => f.properties.selected);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].properties.code, 'KJ10');
  assert.notEqual(selected[0].properties.value, march.data.features.find(f => f.properties.selected).properties.value);
  assert.equal(selected[0].properties.value, getStationData(MAP_STATIONS.find(s => s.code === 'KJ10'), '2026-08').ridership);
});

test('the map style is valid and masks foreign geography above buildings and rails', () => {
  const style = createNetworkStyle();
  assert.deepEqual(spec.validateStyleMin(style), []);
  const ids = style.layers.map(l => l.id);
  assert.ok(ids.indexOf('outside-malaysia') > ids.indexOf('buildings-3d'));
  assert.ok(ids.indexOf('rail-country-mask') > ids.indexOf('rail-lines'));
  // MapLibre within does not support Polygon features; do not hide all buildings.
  assert.equal(style.layers.find(l => l.id === 'buildings-3d').filter, undefined);
  assert.ok(ids.indexOf('state-labels') > ids.indexOf('rail-country-mask'), 'coastal state labels must not be clipped by the country mask');
});

test('national atlas includes every state and territory, with recognizable landmark destinations', () => {
  assert.equal(states.features.length, 16);
  assert.equal(new Set(STATE_LABELS.features.map(f => f.properties.name)).size, 16);
  assert.deepEqual(new Set(NATIONAL_LANDMARKS.map(l => l.state)), new Set(STATE_LABELS.features.map(f => f.properties.name)));
  assert.equal(NATIONAL_LANDMARKS.find(l => l.name === 'A Famosa').state, 'Melaka');
  assert.equal(NATIONAL_LANDMARKS.find(l => l.name === 'Petronas Twin Towers').state, 'Kuala Lumpur');
});

test('national routes preserve source precision and filter supplementary services', () => {
  const routes = getNationalRoutes('All Lines').features;
  assert.equal(routes.length, 20);
  assert.equal(new Set(routes.map(r => r.properties.id)).size, routes.length);
  assert.equal(routes.filter(r => r.properties.geometrySource === 'Official GTFS').length, 7);
  assert.equal(routes.filter(r => r.properties.geometrySource === 'GTFS stop-to-stop reference').length, 9);
  for (const line of ['Sabah State Railway', 'ERL KLIA Transit', 'Penang Hill Railway']) {
    const selected = getNationalRoutes(line).features.filter(r => r.properties.inScope);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].properties.name, line);
  }
});

test('reference stations including the Sabah coastal stops stay mapped without invented demand', () => {
  for (const station of CONTEXT_STATIONS) {
    assert.ok(MAP_STATIONS.some(s => s.code === station.code && s.source === 'reference'), station.name);
    assert.deepEqual(getStationData(station, '2026-08'), { ridership: null, yoy: null });
  }
  const sabah = getStationSnapshot('2026-08', 'Sabah State Railway', 'All Stations');
  assert.equal(sabah.measured, 0);
  assert.equal(sabah.threshold, null);
  assert.ok(sabah.data.features.filter(f => f.properties.inScope).every(f => f.properties.value === null && !f.properties.busy));
});

test('landmarks use ground-anchored 3D geometry at national and city scales', () => {
  for (const zoom of [4, 6, 10, 15.6, 18]) {
    const models = createLandmarkModels(zoom).features;
    assert.equal(new Set(models.map(f => f.properties.id)).size, NATIONAL_LANDMARKS.length);
    for (const landmark of NATIONAL_LANDMARKS) {
      const parts = models.filter(f => f.properties.id === landmark.id);
      assert.ok(parts.some(f => f.properties.base === 0), `${landmark.name} must touch the map`);
      for (const part of parts) {
        assert.ok(Number.isFinite(part.properties.height) && part.properties.height > part.properties.base);
        const ring = part.geometry.coordinates[0];
        assert.deepEqual(ring[0], ring.at(-1));
        assert.ok(ring.flat().every(Number.isFinite));
      }
      const podium = parts[0].geometry.coordinates[0].slice(0,-1);
      for (const axis of [0,1]) assert.ok(Math.abs(podium.reduce((sum,p)=>sum+p[axis],0)/podium.length-landmark.position[axis]) < 1e-8);
    }
  }
});
