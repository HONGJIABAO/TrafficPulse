import { useEffect, useMemo, useRef, useState } from 'react';
import { LngLat, Map, NavigationControl, Popup, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import type { GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import type { FeatureCollection, LineString } from 'geojson';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { RAIL_CORRIDORS, LINE_COLORS, isCorridorMatch } from './railCorridors';
import { createNetworkStyle } from './networkMapStyle';
import { GEOMETRY_DATE, getStationData, getStationSnapshot, MALAYSIA_BOUNDS, MALAYSIA_MAX_BOUNDS,
  MAP_STATIONS, OFFICIAL_ROUTES, stationId, stationPosition } from './networkMapData';
import type { RailStation } from './networkMapData';
import type { MapOverlay } from './NetworkOverview';
import './NetworkMap.css';

setWorkerUrl(workerUrl);

interface MonthlyTrend { year_month: string; total: number; lines: Record<string, number> }
interface Props {
  selectedLine: string; selectedStation: string; activeOverlay: MapOverlay; playbackMonth: string;
  monthly_trend: MonthlyTrend[]; onResetFocus?: () => void; onSelectStation?: (name: string, line?: string) => void;
}
const number = new Intl.NumberFormat('en-MY');
const compact = new Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 });
const animationDuration = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
const lineName = (name: string) => name.replace('KTM Komuter (', '').replace(' Line)', '').replace('ETS North-South Trunk', 'ETS North–South');

function fitMalaysia(map: Map) {
  const small = map.getContainer().clientWidth < 650;
  map.fitBounds(MALAYSIA_BOUNDS, { padding: { top: small ? 150 : 100, right: 82, bottom: 110, left: 45 },
    pitch: 0, bearing: 0, duration: animationDuration() });
}

export function NetworkMap(props: Props) {
  const { selectedLine, selectedStation, activeOverlay, playbackMonth, monthly_trend, onResetFocus, onSelectStation } = props;
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const popupRef = useRef<Popup | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [ready, setReady] = useState(false);
  const [rendererError, setRendererError] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [tilesReady, setTilesReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(5);
  const [tilted, setTilted] = useState(true);
  const [legendOpen, setLegendOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [view, setView] = useState('Malaysia');
  const snapshot = useMemo(() => getStationSnapshot(playbackMonth, selectedLine, selectedStation),
    [playbackMonth, selectedLine, selectedStation]);
  const selected = MAP_STATIONS.find(s => s.name === selectedStation && (selectedLine === 'All Lines' || s.line === selectedLine));
  const currentMonth = monthly_trend.find(m => m.year_month === playbackMonth);
  const busiestLine = Object.entries(currentMonth?.lines ?? {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1])[0];
  const routes = useMemo(() => {
    const officialNames = new Set(OFFICIAL_ROUTES.features.map(f => f.properties?.name));
    const features = [
      ...RAIL_CORRIDORS.filter(c => !officialNames.has(c.name)).map(c => ({
        type: 'Feature' as const, properties: { id: c.id, name: c.name, category: c.category,
          color: LINE_COLORS[c.name], geometrySource: 'Approximate reference corridor' },
        geometry: { type: 'LineString' as const, coordinates: c.coords.map(([lat, lng]) => [lng, lat]) },
      })), ...OFFICIAL_ROUTES.features,
    ].map(feature => ({ ...feature, properties: { ...feature.properties,
      inScope: isCorridorMatch(feature.properties?.name, selectedLine) } }));
    return { type: 'FeatureCollection', features } as FeatureCollection<LineString>;
  }, [selectedLine]);

  useEffect(() => {
    if (!container.current) return;
    setReady(false); setRendererError(false); setTileError(false); setTilesReady(false);
    let map: Map;
    try {
      map = new Map({ container: container.current, style: createNetworkStyle(), center: [109.5, 4], zoom: 4.6,
        minZoom: 1.5, maxZoom: 18.5, maxPitch: 65,
        transformConstrain: (center, nextZoom) => ({ center: new LngLat(
          Math.max(MALAYSIA_MAX_BOUNDS[0][0], Math.min(MALAYSIA_MAX_BOUNDS[1][0], center.lng)),
          Math.max(MALAYSIA_MAX_BOUNDS[0][1], Math.min(MALAYSIA_MAX_BOUNDS[1][1], center.lat))),
          zoom: Math.max(1.5, Math.min(18.5, nextZoom)) }),
        renderWorldCopies: false, attributionControl: { compact: true }, canvasContextAttributes: { antialias: true } });
    } catch {
      setRendererError(true);
      return;
    }
    mapRef.current = map;
    const popup = new Popup({ closeButton: false, closeOnClick: false, offset: 14, maxWidth: '250px', className: 'rail-popup' });
    popupRef.current = popup;
    map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new ScaleControl({ maxWidth: 90 }), 'bottom-left');
    map.on('style.load', () => { fitMalaysia(map); setReady(true); });
    map.on('zoomend', () => setZoom(map.getZoom()));
    map.on('sourcedata', event => {
      if (event.sourceId === 'openmaptiles' && event.isSourceLoaded) setTilesReady(true);
    });
    map.on('error', event => {
      if ('sourceId' in event && event.sourceId === 'openmaptiles') setTileError(true);
      console.warn('TransitPulse map:', event.error.message);
    });
    const hit = (event: MapLayerMouseEvent) => {
      // Hit areas overlap at national scale; choose the closest station.
      const nearest = [...(event.features ?? [])].sort((a, b) => {
        const distance = (f: typeof a) => {
          if (f.geometry.type !== 'Point') return Infinity;
          const p = map.project(f.geometry.coordinates as [number, number]);
          return (p.x - event.point.x) ** 2 + (p.y - event.point.y) ** 2;
        };
        return distance(a) - distance(b);
      })[0];
      return MAP_STATIONS.find(s => stationId(s) === nearest?.properties?.id);
    };
    map.on('click', 'station-hit-area', event => {
      const station = hit(event);
      if (station) { popup.remove(); latest.current.onSelectStation?.(station.name, station.line); }
    });
    map.on('mousemove', 'station-hit-area', event => {
      const station = hit(event);
      if (!station) return;
      map.getCanvas().style.cursor = 'pointer';
      const { ridership } = getStationData(station, latest.current.playbackMonth);
      const content = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = station.name;
      const detail = document.createElement('p'); detail.textContent = `${station.line} · ${station.code}`;
      const value = document.createElement('p'); value.textContent = ridership === null ? 'No station data for this month'
        : `${number.format(ridership)} boardings · ${latest.current.playbackMonth}`;
      content.append(title, detail, value);
      popup.setLngLat(stationPosition(station)).setDOMContent(content).addTo(map);
    });
    map.on('mouseleave', 'station-hit-area', () => { map.getCanvas().style.cursor = ''; popup.remove(); });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    return () => { observer.disconnect(); popup.remove(); map.remove(); mapRef.current = null; popupRef.current = null; };
  }, [retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource('stations') as GeoJSONSource).setData(snapshot.data);
    (map.getSource('routes') as GeoJSONSource).setData(routes);
    popupRef.current?.remove();
  }, [ready, snapshot, routes]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty('station-heat', 'visibility', activeOverlay === 'heatmap' ? 'visible' : 'none');
    map.setLayerZoomRange('station-labels', activeOverlay === 'station' ? 7 : 12.5, 24);
  }, [ready, activeOverlay]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty('buildings-3d', 'visibility', tilted ? 'visible' : 'none');
  }, [ready, tilted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    if (selected) {
      setView(selected.name);
      map.flyTo({ center: stationPosition(selected), zoom: 15.7, pitch: tilted ? 55 : 0, bearing: -18,
        padding: { top: 85, bottom: 80, left: map.getContainer().clientWidth > 800 ? 250 : 30, right: 85 }, duration: animationDuration() });
    } else if (selectedLine !== 'All Lines') {
      const points = MAP_STATIONS.filter(s => s.line === selectedLine).map(stationPosition);
      if (points.length) {
        setView(selectedLine);
        map.fitBounds([[Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))],
          [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))]],
        { padding: { top: 100, bottom: 110, left: 40, right: 90 }, maxZoom: 14, pitch: 0, bearing: 0, duration: animationDuration() });
      }
    } else { setView('Malaysia'); fitMalaysia(map); }
    // Camera follows filter changes only; the building toggle preserves its center.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedLine, selectedStation]);

  function changeView(target: 'Malaysia' | 'Klang Valley' | 'Kuala Lumpur') {
    const map = mapRef.current;
    if (!map || !ready) return;
    setView(target);
    if (target === 'Malaysia') fitMalaysia(map);
    else if (target === 'Klang Valley') map.fitBounds([[101.38, 2.9], [101.84, 3.36]],
      { padding: { top: 90, bottom: 100, left: 35, right: 85 }, pitch: 0, bearing: 0, duration: animationDuration() });
    else {
      setTilted(true);
      map.flyTo({ center: [101.708, 3.151], zoom: 15.3, pitch: 55, bearing: -22,
        padding: { top: 50, bottom: 75, left: 15, right: 85 }, duration: animationDuration() });
    }
  }

  const selectStation = (station: RailStation) => onSelectStation?.(station.name, station.line);
  const selectedValues = selected ? getStationData(selected, playbackMonth) : null;
  const filtered = selectedLine !== 'All Lines' || selectedStation !== 'All Stations';

  return <section className="rail-map" aria-label="Interactive Malaysia rail network">
    <div className="rail-map-canvas" ref={container} />
    <div className="rail-map-heading">
      <span className="rail-map-eyebrow">MALAYSIA RAIL ATLAS</span><h2>{view}</h2>
      <span className="rail-map-subtitle">{zoom >= 13 && tilted ? '2.5D buildings · station-level detail' : 'Explore the network, then zoom into the city'}</span>
    </div>
    <div className="rail-map-toolbar" aria-label="Map views">
      {(['Malaysia', 'Klang Valley', 'Kuala Lumpur'] as const).map(target => <button key={target} disabled={!ready}
        onClick={() => changeView(target)} aria-pressed={view === target}>{target}{target === 'Kuala Lumpur' ? ' 2.5D' : ''}</button>)}
      <button disabled={!ready} aria-pressed={tilted} onClick={() => {
        setTilted(value => !value);
        const map = mapRef.current;
        map?.easeTo({ pitch: !tilted && map.getZoom() >= 12 ? 55 : 0, duration: animationDuration() });
      }}>Buildings {tilted ? 'on' : 'off'}</button>
    </div>
    {filtered && <div className="rail-map-focus"><span>{selectedLine}{selectedStation !== 'All Stations' ? ` · ${selectedStation}` : ''}</span>
      <button onClick={() => { onResetFocus?.(); if (mapRef.current) fitMalaysia(mapRef.current); }}>Clear filter</button></div>}
    {selected && selectedValues && <aside className="rail-station-card" aria-label="Selected station details" aria-live="polite">
      <span className="rail-map-eyebrow">SELECTED STATION · {selected.code}</span>
      <h3>{selected.name}</h3><p>{selected.line}</p>
      <strong className="rail-station-value">{selectedValues.ridership === null ? 'No data' : number.format(selectedValues.ridership)}</strong>
      <p>Monthly boardings · {playbackMonth}</p>
      {selectedValues.yoy !== null && <p>{selectedValues.yoy > 0 ? '+' : ''}{selectedValues.yoy}% year on year</p>}
    </aside>}
    <div className="rail-map-legend">
      <button className="rail-legend-toggle" onClick={() => setLegendOpen(open => !open)} aria-expanded={legendOpen} aria-controls="rail-line-legend">
        <span className="rail-lines-icon" aria-hidden="true">≋</span> Rail lines <span aria-hidden="true">{legendOpen ? '−' : '+'}</span>
      </button>
      {legendOpen && <div id="rail-line-legend" className="rail-line-list">
        {routes.features.map(feature => <div key={feature.properties?.id} className={feature.properties?.inScope ? '' : 'rail-line-muted'}>
          <i style={{ background: feature.properties?.color }} /><span>{lineName(feature.properties?.name)}</span>
          {feature.properties?.geometrySource !== 'Official GTFS' && <span title="Approximate reference corridor">*</span>}
        </div>)}<p>* Approximate corridor. Rapid Rail uses official GTFS geometry.</p>
      </div>}
    </div>
    <div className="rail-map-bottom">
      <div className="rail-demand-legend">
        <div className="rail-demand-title"><strong>Station boardings</strong><span>{playbackMonth}</span></div>
        <div className="rail-demand-scale"><span><i className="dot-normal" />Lower</span><span><i className="dot-busy" />Top 10%</span>
          <span><i className="dot-zero" />Zero</span><span><i className="dot-missing" />No data</span></div>
        <p>{snapshot.threshold === null ? (snapshot.measured ? 'No positive boardings recorded in this selection.' : 'No station boardings available for this month.') : `Red ≥ ${number.format(snapshot.threshold)} boardings in this selection.`}</p>
        <p>Demand only · does not indicate crowding</p>
      </div>
      <div className="rail-map-insight">
        <span className="rail-map-eyebrow">BUSIEST LINE · {playbackMonth}</span>
        <strong>{busiestLine?.[0] ?? 'No data for this month'}</strong>
        <span>{busiestLine ? `${compact.format(busiestLine[1])} network-wide trips` : 'Choose another month'}</span>
        <details><summary>{snapshot.measured}/{snapshot.total} mapped stations with data</summary>
          <div className="rail-ranking"><strong>Highest boardings in selection</strong>
            {snapshot.ranked.slice(0, 5).map(s => <button key={stationId(s)} onClick={() => selectStation(s)}>
              <span>{s.name}<small>{s.line}</small></span><b>{compact.format(getStationData(s, playbackMonth).ridership ?? 0)}</b></button>)}
            {!snapshot.ranked.length && <p>No station data for this selection.</p>}
          </div>
        </details>
      </div>
    </div>
    <div className="rail-source-bar"><span>Rail dataset: Peninsular Malaysia</span>
      <button onClick={() => setSourcesOpen(open => !open)} aria-expanded={sourcesOpen}>Data & map sources</button></div>
    {sourcesOpen && <aside className="rail-source-panel" aria-label="Map data sources">
      <button className="rail-source-close" onClick={() => setSourcesOpen(false)} aria-label="Close data sources">×</button>
      <h3>About this map</h3>
      <p>Buildings and streets: <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> / OpenStreetMap vector tiles. Coverage varies; building heights may be estimated.</p>
      <p>Rapid Rail routes and station coordinates: <a href="https://developer.data.gov.my/realtime-api/gtfs-static" target="_blank" rel="noreferrer">data.gov.my GTFS</a>, CC BY 4.0. Snapshot: {GEOMETRY_DATE}. Other corridors are approximate.</p>
      <p>Boardings: the project's monthly origin-trip aggregates. Grey means missing; zero is shown separately. Red marks the top 10% of positive recorded station values in the selected line and month, including ties.</p>
      <p>The timeline changes demand, not historical route availability. Current route geometry is shown at every date. Sabah and Sarawak are included geographically; this dataset has no rail coverage there.</p>
      <p>Country outline: existing project boundary, simplified for display. This is not a cadastral map.</p>
    </aside>}
    {!rendererError && (!ready || !tilesReady || tileError) && <div className="rail-map-status" role="status">
      {tileError ? <>Building tiles unavailable; local rail and ridership remain available. <button onClick={() => setRetry(n => n + 1)}>Retry map</button></>
        : ready ? 'Loading building and street tiles…' : 'Loading Malaysia rail map…'}
    </div>}
    {rendererError && <div className="rail-map-fallback" role="status">
      <h3>The 2.5D map needs WebGL</h3><p>The map renderer could not start. Station data is still available below and in the filters.</p>
      <button onClick={() => setRetry(n => n + 1)}>Retry map</button>
      {snapshot.ranked.slice(0, 5).map(s => <button key={stationId(s)} onClick={() => selectStation(s)}>{s.name} · {number.format(getStationData(s, playbackMonth).ridership ?? 0)} boardings</button>)}
    </div>}
  </section>;
}

export { LINE_COLORS } from './railCorridors';
export default NetworkMap;
