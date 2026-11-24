import test from 'node:test';
import assert from 'node:assert/strict';
import spec from '@maplibre/maplibre-gl-style-spec';
import { createNetworkStyle } from '../src/modules/module1_network_overview/networkMapStyle.ts';
import { getStationSnapshot, getStationData, isInMalaysia, MAP_STATIONS, OFFICIAL_ROUTES, stationPosition } from '../src/modules/module1_network_overview/networkMapData.ts';

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
});
