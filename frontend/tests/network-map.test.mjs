import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import spec from '@maplibre/maplibre-gl-style-spec';
import { createNetworkStyle } from '../src/modules/module1_network_overview/networkMapStyle.ts';
import { getStationSnapshot, getStationData, isInMalaysia, MAP_STATIONS, OFFICIAL_ROUTES, stationPosition } from '../src/modules/module1_network_overview/networkMapData.ts';
import { getNationalRoutes } from '../src/modules/module1_network_overview/nationalRailNetwork.ts';
import { NATIONAL_LANDMARKS, STATE_LABELS, CONTEXT_STATIONS } from '../src/modules/module1_network_overview/nationalAtlas.ts';
import states from '../src/data/malaysia_states.json' with { type: 'json' };
import { createLandmarkModels } from '../src/modules/module1_network_overview/landmarkModels.ts';
import { atlasData, atlasPoint, geographicPoint } from '../src/modules/module1_network_overview/atlasLayout.ts';
import { classifyDemand, DEMAND_COLORS, stationMatchesLine } from '../src/modules/module1_network_overview/networkMapData.ts';
import { regionSummary, displayStations, inKlangValley } from '../src/modules/module1_network_overview/railSemantics.ts';
import { scaledModels, arrangeAtlas, DEFAULT_LANDMARK_IDS, inLandmarkState } from '../src/modules/module1_network_overview/atlasPresentation.ts';
import { getAtlasRoutes } from '../src/modules/module1_network_overview/nationalRailNetwork.ts';

test('all six demand classes use positive percentiles, consistent ties, and fixed marker size', () => {
  const thresholds={p50:50,p75:75,p90:90};
  assert.deepEqual([null,0,20,50,75,90,100].map(v=>classifyDemand(v,thresholds)),['missing','zero','lower','moderate','high','top','top']);
  const snapshot=getStationSnapshot('2026-08','All Lines','All Stations');
  assert.equal(new Set(snapshot.data.features.map(f=>f.properties.radius)).size,1);
  for(const f of snapshot.data.features) assert.equal(f.properties.color,DEMAND_COLORS[classifyDemand(f.properties.value,snapshot.thresholds)]);
});

test('Klang Valley inherits the highest category and does not call partial zero coverage zero', () => {
  const data=(categories)=>({type:'FeatureCollection',features:categories.map(category=>({type:'Feature',geometry:{type:'Point',coordinates:[101.7,3.1]},properties:{category,inScope:true,value:category==='missing'?null:category==='zero'?0:100}}))});
  for(const category of ['lower','moderate','high','top']) assert.equal(regionSummary(data(['missing','zero',category])).category,category);
  assert.equal(regionSummary(data(['zero','missing'])).category,'missing');
  assert.equal(regionSummary(data(['zero','zero'])).category,'zero');
  assert.equal(regionSummary(data(['missing','missing'])).category,'missing');
  const actual=getStationSnapshot('2026-08','All Lines','All Stations').data;
  assert.equal(regionSummary(actual).category,'top');
  const display=displayStations(actual,true);
  assert.equal(display.features.filter(f=>f.properties.regional).length,1);
  assert.equal(display.features.filter(f=>inKlangValley(f.geometry.coordinates)&&!f.properties.regional).length,0);
  assert.deepEqual(displayStations(actual,false),actual);
  assert.equal(regionSummary(getStationSnapshot('2019-01','All Lines','All Stations').data).category,'missing');
});

test('atlas scales every model dimension exactly 0.8 while detailed geometry/materials remain original', () => {
  for(const zoom of [4,6,7]) {
    const base=createLandmarkModels(zoom), scaled=scaledModels(zoom,true);
    base.features.forEach((feature,i)=>{
      const actual=scaled.features[i], anchor=NATIONAL_LANDMARKS.find(l=>l.id===feature.properties.id).position;
      assert.equal(actual.properties.height,feature.properties.height*.8);
      assert.equal(actual.properties.base,feature.properties.base*.8);
      feature.geometry.coordinates[0].forEach((p,j)=>{
        const expected=atlasPoint([anchor[0]+(p[0]-anchor[0])*.8,anchor[1]+(p[1]-anchor[1])*.8]);
        assert.deepEqual(actual.geometry.coordinates[0][j],expected);
      });
    });
  }
  assert.deepEqual(scaledModels(15.6,false),createLandmarkModels(15.6));
});

test('atlas preserves every source route; exact route filters include verified stations', () => {
  assert.deepEqual(getAtlasRoutes('All Lines'),getNationalRoutes('All Lines'));
  for(const route of getNationalRoutes('All Lines').features) {
    const name=route.properties.name;
    assert.ok(MAP_STATIONS.some(s=>stationMatchesLine(s,name)),`No stations for ${name}`);
    assert.equal(getNationalRoutes(name).features.filter(f=>f.properties.inScope).length,1,name);
  }
});

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


test('detailed models retain the pre-refinement geometry and materials at regional and city zooms',()=>{
  const hash=createHash('sha256').update(JSON.stringify([9,11,15.6].map(z=>createLandmarkModels(z)))).digest('hex');
  assert.equal(hash,'ee0bac164ce8d2c1de3581229e70c9d7c08eb7c2ef86d2f1efc6e692e8579953');
});

test('national composition keeps the thirteen selected miniatures at 0.8 without collision shrinking',()=>{
  const map={getZoom:()=>6,getPitch:()=>30,
    getContainer:()=>({clientWidth:1400,clientHeight:600,getBoundingClientRect:()=>({x:0,y:0}),parentElement:null}),
    project:p=>({x:(p[0]-99)*95+80,y:(7.3-p[1])*60+30}),
    unproject:p=>({lng:(p[0]-80)/95+99,lat:7.3-(p[1]-30)/60})};
  const routes=atlasData(getNationalRoutes('All Lines'));
  const stations=atlasData(displayStations(getStationSnapshot('2026-08','All Lines','All Stations').data,true));
  const before=JSON.stringify([routes,stations]);
  const result=arrangeAtlas(map,routes,stations);
  const visible=result.models.features.filter(f=>f.properties.visible);
  assert.deepEqual(new Set(visible.map(f=>f.properties.id)),DEFAULT_LANDMARK_IDS);
  for(const f of visible){
    assert.ok(f.properties.height>f.properties.base, `${f.properties.id} must have outward-facing extrusion surfaces`);
    assert.equal(f.properties.modelScale,.8);
    assert.equal(f.properties.collisionScale,1);
    const landmark=NATIONAL_LANDMARKS.find(l=>l.id===f.properties.id);
    assert.deepEqual([f.properties.anchorLng,f.properties.anchorLat],landmark.position);
    if(landmark.id==='penang-bridge')continue;
    const placement=geographicPoint([f.properties.placementLng,f.properties.placementLat]);
    assert.ok(inLandmarkState(placement,landmark.state)||(landmark.id==='petronas'&&inLandmarkState(placement,'Selangor')),landmark.id);
  }
  assert.equal(result.stateNames.features.filter(f=>!f.properties.territory).length,13);
  assert.equal(JSON.stringify([routes,stations]),before);
});
