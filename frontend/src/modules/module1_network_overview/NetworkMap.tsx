import { useEffect, useMemo, useRef, useState } from 'react';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { createAtlasController } from './atlasController';
import { getNationalRoutes } from './nationalRailNetwork';
import { NATIONAL_LANDMARKS } from './nationalAtlas';
import { DEMAND_COLORS, STATION_AUDIT, GEOMETRY_DATE, getStationData, getStationSnapshot, MAP_STATIONS, stationId, stationMatchesLine } from './networkMapData';
import type { RailStation } from './networkMapData';
import type { MapOverlay } from './NetworkOverview';
import './NetworkMap.css';
setWorkerUrl(workerUrl);
interface MonthlyTrend { year_month:string; total:number; lines:Record<string,number> }
interface Props {
  selectedLine:string; selectedStation:string; activeOverlay:MapOverlay; playbackMonth:string;
  monthly_trend:MonthlyTrend[]; onResetFocus?:()=>void; onSelectStation?:(name:string,line?:string)=>void;
}
const number=new Intl.NumberFormat('en-MY');
const lineName=(name:string)=>name.replace('KTM Komuter (','').replace(' Line)','');
export function NetworkMap(props:Props) {
  const {selectedLine,selectedStation,activeOverlay,playbackMonth,onResetFocus,onSelectStation}=props;
  const container=useRef<HTMLDivElement>(null), controller=useRef<ReturnType<typeof createAtlasController>|null>(null), latest=useRef(props);
  latest.current=props;
  const [ready,setReady]=useState(false),[rendererError,setRendererError]=useState(false),[tileError,setTileError]=useState(false),[tilesReady,setTilesReady]=useState(false);
  const [retry,setRetry]=useState(0),[zoom,setZoom]=useState(5),[tilted,setTilted]=useState(true),[compactLayout,setCompactLayout]=useState(true);
  const [legendOpen,setLegendOpen]=useState(false),[sourcesOpen,setSourcesOpen]=useState(false),[view,setView]=useState('Malaysia'),[expanded,setExpanded]=useState(false);
  const snapshot=useMemo(()=>getStationSnapshot(playbackMonth,selectedLine,selectedStation),[playbackMonth,selectedLine,selectedStation]);
  const routes=useMemo(()=>getNationalRoutes(selectedLine),[selectedLine]);
  const selected=MAP_STATIONS.find(s=>s.name===selectedStation&&stationMatchesLine(s,selectedLine));
  const selectedValues=selected?getStationData(selected,playbackMonth):null;
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
      <span className="rail-map-subtitle">{tilted ? (zoom >= 13 ? 'Landmark architecture · white city blocks · rail network' : 'Grey landmarks · nationwide rail network') : 'State boundaries · rail routes · passenger demand'}</span>
    </div>
    <div className="rail-map-toolbar" aria-label="Map dimension">
      <button disabled={!ready} aria-pressed={!tilted} onClick={() => setTilted(false)}>2D</button>
      <button disabled={!ready} aria-pressed={tilted} onClick={() => setTilted(true)}>2.5D</button>
      <button disabled={!ready} onClick={() => { controller.current?.reset(); }}>Reset view</button>
      <button aria-label={expanded ? 'Collapse map' : 'Expand map'} title={expanded ? 'Collapse map (Esc)' : 'Expand map'} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
        <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d={expanded ? 'M7 2v5H2m11-5v5h5M7 18v-5H2m11 5v-5h5' : 'M2 7V2h5m6 0h5v5M2 13v5h5m6 0h5v-5'} /></svg>
      </button>
    </div>
    {tilted && <div className="rail-map-explore"><select aria-label="Explore landmark" value="" disabled={!ready} onChange={event => controller.current?.exploreLandmark(event.target.value)}>
        <option value="" disabled>Landmarks</option>
        {NATIONAL_LANDMARKS.map(l => <option key={l.id} value={l.id}>{l.state} · {l.name}</option>)}
      </select></div>}
    {filtered && <div className="rail-map-focus"><span>{selectedLine}{selectedStation !== 'All Stations' ? ` · ${selectedStation}` : ''}</span>
      <button onClick={() => { onResetFocus?.(); controller.current?.reset(); }}>Clear filter</button></div>}
    {selected && selectedValues && <aside className="rail-station-card" aria-label="Selected station details" aria-live="polite">
      <span className="rail-map-eyebrow">SELECTED STATION · {selected.code}</span>
      <h3>{selected.name}</h3><p>{selected.line}</p>
      <strong className="rail-station-value">{selectedValues.ridership === null ? 'No data available' : number.format(selectedValues.ridership)}</strong>
      <p>Monthly boardings · {playbackMonth}</p>
      {selectedValues.yoy !== null && <p>{selectedValues.yoy > 0 ? '+' : ''}{selectedValues.yoy}% year on year</p>}
    </aside>}
    <div className="rail-map-legend">
      <button className="rail-legend-toggle" onClick={() => setLegendOpen(open => !open)} aria-expanded={legendOpen} aria-controls="rail-line-legend">
        <span className="rail-lines-icon" aria-hidden="true">≋</span> Rail lines <span aria-hidden="true">{legendOpen ? '−' : '+'}</span>
      </button>
      {legendOpen && <div id="rail-line-legend" className="rail-line-list">
        {routes.features.map(feature => <button type="button" onClick={() => onSelectStation?.('All Stations',String(feature.properties?.name))} key={feature.properties?.id} className={feature.properties?.inScope ? '' : 'rail-line-muted'}>
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
        <p>Demand only — does not indicate crowding.</p>
      </div>

    </div>
    <div className="rail-source-bar">{compactLayout && <span>Compact atlas · East Malaysia repositioned, 70% scale</span>}<span>{routes.features.length} rail routes · {tilted ? `${NATIONAL_LANDMARKS.length} landmark models` : 'Malaysia 2D'}</span>
      <button onClick={() => setSourcesOpen(open => !open)} aria-expanded={sourcesOpen}>Data & map sources</button></div>
    {sourcesOpen && <aside className="rail-source-panel" aria-label="Map data sources">
      <button className="rail-source-close" onClick={() => setSourcesOpen(false)} aria-label="Close data sources">×</button>
      <h3>About this map</h3>
      <p>Buildings and streets: <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">OpenFreeMap</a> / OpenStreetMap vector tiles. Ordinary buildings are simplified white blocks. Nationwide landmark models use 0.8× scale with collision-aware placement and light-grey materials. Detailed landmark models retain their original scale and materials. The compact national atlas moves East Malaysia closer at 70% scale; zooming into a destination restores geographic coordinates. Landmark massing models stand at their map coordinates and are exaggerated at national scale; they are not surveyed architectural models. Select a model to zoom to its location.</p>
      <p>Rapid Rail routes and station coordinates: <a href="https://developer.data.gov.my/realtime-api/gtfs-static" target="_blank" rel="noreferrer">data.gov.my GTFS</a>, CC BY 4.0. Snapshot: {GEOMETRY_DATE}. KTMB routes follow the longest published stop sequence in its GTFS feed; that feed has no track shapes. These lines are schematic.</p>
      <p>Airport rail, Sabah State Railway and Penang Hill Railway are approximate reference corridors. Their grey stations have no passenger data in this project. State boundaries: <a href="https://github.com/dosm-malaysia/data-open/tree/main/datasets/geodata" target="_blank" rel="noreferrer">DOSM geodata</a>.</p>
      <p>Boardings: the project's monthly origin-trip aggregates. Grey means missing; zero is shown separately. Demand uses P50, P75 and P90 nearest-rank thresholds over positive station boardings in the selected line and month, including ties. Camera zoom does not change these thresholds.</p>
      <p>Station audit: {STATION_AUDIT.added} additional official GTFS stop records; {STATION_AUDIT.unmatched.length} legacy records without an exact GTFS ID/name match remain in their existing source networks. No coordinates or demand values are invented.</p>
      <p>The timeline changes demand, not historical route availability. Current route geometry is shown at every date. No railway is inferred for a state without a supplied route.</p>
      <p>Country and state outlines: DOSM geodata, simplified for display. This is not a cadastral map.</p>
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
