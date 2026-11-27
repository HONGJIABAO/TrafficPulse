import { useEffect, useMemo, useRef, useState } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { createAtlasController } from './atlasController';
import { getNationalRoutes } from './nationalRailNetwork';
import { NATIONAL_LANDMARKS } from './nationalAtlas';
import { DEMAND_COLORS, STATION_AUDIT, GEOMETRY_DATE, getSelectedStationSummary, getStationData, getStationSnapshot, MAP_STATIONS, stationId, stationMatchesLine } from './networkMapData';
import type { RailStation } from './networkMapData';
import type { MapOverlay } from './NetworkOverview';
import type { TabId } from '@/modules/shared/types';
import { normalizeSelectedLine } from './lineMapping';
import './NetworkMap.css';
setWorkerUrl(workerUrl);
interface MonthlyTrend { year_month:string; total:number; lines:Record<string,number> }
interface Props {
  selectedLine:string; selectedStation:string; activeOverlay:MapOverlay; playbackMonth:string;
  monthly_trend:MonthlyTrend[]; onResetFocus?:()=>void; onSelectStation?:(name:string,line?:string)=>void; onNavigateTab?:(tab:TabId)=>void;
}
const number=new Intl.NumberFormat('en-MY');
const lineName=(name:string)=>name.replace('KTM Komuter (','').replace(' Line)','');
export function NetworkMap(props:Props) {
  const {selectedLine,selectedStation,activeOverlay,playbackMonth,onResetFocus,onSelectStation,onNavigateTab}=props;
  const container=useRef<HTMLDivElement>(null), controller=useRef<ReturnType<typeof createAtlasController>|null>(null), latest=useRef(props);
  latest.current=props;
  const [ready,setReady]=useState(false),[rendererError,setRendererError]=useState(false),[tileError,setTileError]=useState(false),[tilesReady,setTilesReady]=useState(false);
  const [retry,setRetry]=useState(0),[zoom,setZoom]=useState(5),[tilted,setTilted]=useState(true),[compactLayout,setCompactLayout]=useState(true);
  const [legendOpen,setLegendOpen]=useState(false),[sourcesOpen,setSourcesOpen]=useState(false),[view,setView]=useState('Malaysia'),[expanded,setExpanded]=useState(false);
  const snapshot=useMemo(()=>getStationSnapshot(playbackMonth,selectedLine,selectedStation),[playbackMonth,selectedLine,selectedStation]);
  const routes=useMemo(()=>getNationalRoutes(selectedLine),[selectedLine]);
  const selected=MAP_STATIONS.find(s=>s.name===selectedStation&&stationMatchesLine(s,selectedLine));
  const selectedSummary=selected?getSelectedStationSummary(selected,playbackMonth,snapshot.ranked):null;
  const filtered=selectedLine!=='All Lines'||selectedStation!=='All Stations';
  const selectStation=(station:RailStation)=>onSelectStation?.(station.name,station.line);
  useEffect(()=>{
    if(!container.current)return;setReady(false);setRendererError(false);setTileError(false);setTilesReady(false);
    try { controller.current=createAtlasController(container.current,{month:playbackMonth,line:selectedLine,station:selectedStation,tilted,overlay:activeOverlay},{
      ready:()=>setReady(true),view:setView,layout:setCompactLayout,zoom:setZoom,tiles:setTilesReady,error:()=>setTileError(true),station:(name,line)=>latest.current.onSelectStation?.(name,line),
    }); } catch(error) {console.error(error);setRendererError(true);}
    return ()=>{controller.current?.destroy();controller.current=null;};
    // Controller owns the map lifecycle; changes go through update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[retry]);
  useEffect(()=>{controller.current?.update({month:playbackMonth,line:selectedLine,station:selectedStation,tilted,overlay:activeOverlay});},[ready,playbackMonth,selectedLine,selectedStation,tilted,activeOverlay]);
  useEffect(()=>{
    const frame=container.current?.closest<HTMLElement>('.network-map-frame');frame?.classList.toggle('is-expanded',expanded);
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape')setExpanded(false);};
    if(expanded)document.addEventListener('keydown',escape);
    return ()=>{frame?.classList.remove('is-expanded');document.removeEventListener('keydown',escape);};
  },[expanded]);
  useEffect(()=>{controller.current?.refresh();},[legendOpen,sourcesOpen,selected,compactLayout]);
  return <section className={`rail-map ${compactLayout ? 'rail-map-atlas' : ''} ${selected ? 'has-station' : ''}`} aria-label="Interactive Malaysia rail network">
    <div className="rail-map-canvas" ref={container} />
    <div className="rail-map-heading">
      <span className="rail-map-eyebrow">MALAYSIA RAIL ATLAS</span><h2>{view}</h2>
      {view !== 'Malaysia' && <span className="rail-map-subtitle">{tilted ? (zoom >= 13 ? 'Landmark architecture · white city blocks · rail network' : 'Grey landmarks · nationwide rail network') : 'State boundaries · rail routes · passenger demand'}</span>}
    </div>
    <div className="rail-map-toolbar" aria-label="Map dimension">
      <button disabled={!ready} aria-pressed={!tilted} onClick={() => setTilted(false)}>2D</button>
      <button disabled={!ready} aria-pressed={tilted} onClick={() => setTilted(true)}>2.5D</button>
      <button disabled={!ready} onClick={() => { controller.current?.reset(); }}>Reset view</button>
      <button aria-label={expanded ? 'Collapse map' : 'Expand map'} title={expanded ? 'Collapse map (Esc)' : 'Expand map'} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={expanded ? 'M7 2v5H2m11-5v5h5M7 18v-5H2m11 5v-5h5' : 'M2 7V2h5m6 0h5v5M2 13v5h5m6 0h5v-5'} /></svg>
      </button>
    </div>
    {filtered && <div className="rail-map-focus"><span>{selectedLine}{selectedStation !== 'All Stations' ? ` · ${selectedStation}` : ''}</span>
      <button onClick={() => { onResetFocus?.(); controller.current?.reset(); }}>Clear filter</button></div>}
    {selected && selectedSummary && <aside className="rail-station-card" aria-label="Selected station details" aria-live="polite">
      <span className="rail-map-eyebrow">SELECTED STATION · {selected.code}</span>
      <h3>{selected.name}</h3><p>{selected.line}</p>
      <strong className="rail-station-value">{selectedSummary.ridership === null ? 'No data available' : number.format(selectedSummary.ridership)}</strong>
      <p>Monthly boardings · {playbackMonth}</p>
      {selectedSummary.dailyAvg !== null && selectedSummary.observedDays !== null && (
        <p>Avg {number.format(Math.round(selectedSummary.dailyAvg))}/day ({selectedSummary.observedDays}d observed)</p>
      )}
      <p>{selectedSummary.rank !== null ? `Demand rank: ${selectedSummary.rank} of ${selectedSummary.rankedTotal} measured` : 'Demand rank: Unavailable (no observation)'}</p>
      <p>{selectedSummary.growthLabel}{selectedSummary.comparisonNote ? ` · ${selectedSummary.comparisonNote}` : ''}</p>
    </aside>}
    <div className="rail-map-legend">
      <button className="rail-legend-toggle" onClick={() => setLegendOpen(open => !open)} aria-expanded={legendOpen} aria-controls="rail-line-legend">
        <span className="rail-lines-icon" aria-hidden="true">≋</span> Rail lines <span aria-hidden="true">{legendOpen ? '−' : '+'}</span>
      </button>
      {legendOpen && <div id="rail-line-legend" className="rail-line-list">
        {routes.features.map(feature => <button type="button" onClick={() => onSelectStation?.('All Stations', normalizeSelectedLine(String(feature.properties?.name)))} key={feature.properties?.id} className={feature.properties?.inScope ? '' : 'rail-line-muted'}>
          <i style={{ background: feature.properties?.color }} /><span>{lineName(feature.properties?.name)}</span>
          {feature.properties?.geometrySource !== 'Official GTFS' && <span title="Approximate reference corridor">*</span>}
        </button>)}<p>* Reference corridor from supplied data. Rapid Rail uses official route shapes. Light trails are decorative, not live trains.</p>
      </div>}
    </div>
    <div className="rail-map-bottom">
      <div className="rail-demand-legend">
        <div className="rail-demand-title"><strong>Station boardings</strong><span>{playbackMonth}</span></div>
        <div className="rail-demand-scale">{Object.entries(DEMAND_COLORS).map(([category,color]) => <span key={category}><i className={category === 'zero' ? 'dot-zero' : ''} style={{background:color}} />{({lower:'Lower',moderate:'Moderate',high:'High',top:'Top 10%',zero:'Zero',missing:'No data'} as Record<string,string>)[category]}</span>)}</div>
        <details><summary>Demand thresholds & coverage</summary>
          {snapshot.threshold === null ? <p>No positive station boardings available for this selection.</p> : <p>Positive boardings, nearest-rank percentiles (ties included): Moderate ≥ {number.format(snapshot.thresholds.p50!)} (P50); High ≥ {number.format(snapshot.thresholds.p75!)} (P75); Top 10% ≥ {number.format(snapshot.threshold!)} (P90).</p>}
          <p>{snapshot.measured}/{snapshot.total} station records with data · {playbackMonth}.</p>
          <p>Klang Valley marker represents the highest observed station demand within the region.</p>
          <p>Route colours identify railway lines; marker colours indicate demand.</p>
        </details>
        <p style={{ marginTop: 6 }}>{snapshot.coverage.primaryText}</p>
        <p>{snapshot.coverage.secondaryText}</p>
        <p style={{ marginTop: 4 }}>Demand only — does not indicate crowding.</p>
      </div>

    </div>
    <div className="rail-source-bar">{compactLayout && <span>Compact atlas · East Malaysia repositioned, 70% scale</span>}<span>{routes.features.length} rail routes · {tilted ? `${NATIONAL_LANDMARKS.length} landmark models` : 'Malaysia 2D'}</span>
      <button type="button" onClick={() => setSourcesOpen(open => !open)} aria-expanded={sourcesOpen}>Data & map sources</button>
      {onNavigateTab && <button type="button" onClick={() => onNavigateTab('service_planning')} title="Open Module 4: Service Planning & Accessibility (switches tab only; active filters do not carry over)">Service Planning (M4) →</button>}</div>
    {sourcesOpen && <aside className="rail-source-panel" aria-label="Map data sources">
      <button className="rail-source-close" onClick={() => setSourcesOpen(false)} aria-label="Close data sources">×</button>
      <h3>About this map &amp; official sources</h3>
      <p><strong>Official Malaysian Data (OpenDOSM / data.gov.my, CC BY 4.0):</strong> Headline rail ridership covers <strong>Jan 2019–Aug 2026</strong> (2,800 days across 11 services via <code>ridership_headline</code>). KTMB daily services span <strong>Oct 2020–Nov 2026</strong> (Komuter from Sep 2023; Shuttle Tebrau from Jun 2022). KTM Komuter peak-hour windows are derived strictly from <strong>Sep 2023–Nov 2026</strong> hourly OD records (MYT; Rapid Rail OD lacks hourly timestamps). Country/state borders use <a href="https://github.com/dosm-malaysia/data-open/tree/main/datasets/geodata" target="_blank" rel="noreferrer">DOSM geodata</a>.</p>
      <p><strong>Rapid Rail &amp; Station Registry:</strong> Rapid Rail routes and station positions use <a href="https://developer.data.gov.my/realtime-api/gtfs-static" target="_blank" rel="noreferrer">data.gov.my Prasarana &amp; KTMB GTFS</a> (CC BY 4.0; geometry snapshot: {GEOMETRY_DATE}). KTMB routes follow the longest published stop sequence (schematic; feed has no track shapes). Monthly station boardings integrate KTM Komuter OD (Sep 2023–Nov 2026), Rapid Rail daily OD (Jan–Nov 2026; <code>ridership_od_rapidrail_daily</code>), and KTMB Intercity OD (Jan–Nov 2026).</p>
      <p><strong>Supplementary Map Assets (Non-Official):</strong> Base buildings and streets use <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> / OpenStreetMap tiles (ODbL). Airport rail, Sabah State Railway and Penang Hill Railway are approximate schematic corridors with no supplied ridership. Landmark models and route light trails are decorative visual aids. East Malaysia is repositioned at 70% scale in the national atlas (restored when zooming in).</p>
      <p><strong>Demand &amp; Coverage Rules (RO1 Scope):</strong> Nearest-rank P50/P75/P90 thresholds over positive station boardings in the selected line and month (ties included). Grey means missing/outside period; white hollow circles denote observed zero. Station audit: {STATION_AUDIT.added} added official GTFS stops; {STATION_AUDIT.unmatched.length} unmatched legacy records kept without invented demand. Timeline scrubs Jan 2019–Aug 2026 headline range with current route geometry. Historical demand alone does not establish crowding, fleet shortages, or capacity saturation ({onNavigateTab ? <button type="button" onClick={() => onNavigateTab('service_planning')} style={{ background: 'none', border: 0, padding: 0, color: '#0865cd', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>open Service Planning Module 4 for supply &amp; equity analysis</button> : 'see Service Planning Module 4 for supply & equity analysis'}).</p>
    </aside>}
    {!rendererError && (!ready || (!compactLayout && (!tilesReady || tileError))) && <div className="rail-map-status" role="status">
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
