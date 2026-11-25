import { Map, Marker, Popup, NavigationControl, ScaleControl } from 'maplibre-gl';
import type { GeoJSONSource, MapMouseEvent, MapGeoJSONFeature } from 'maplibre-gl';
import type { GeoJSON, FeatureCollection, Point } from 'geojson';
import { createNetworkStyle } from './networkMapStyle.ts';
import { getNationalRoutes } from './nationalRailNetwork.ts';
import { MAP_STATIONS, getStationSnapshot, getStationData, stationId, stationPosition, stationMatchesLine } from './networkMapData.ts';
import { NATIONAL_LANDMARKS } from './nationalAtlas.ts';
import { atlasData, atlasPoint, geographicPoint, ATLAS_BOUNDS } from './atlasLayout.ts';
import { arrangeAtlas, detailedPresentation, scaledModels } from './atlasPresentation.ts';
import { displayStations, klangCameraPoints, regionSummary, KLANG_ANCHOR, REGION_ENTER_ZOOM, REGION_EXIT_ZOOM, boundsOf } from './railSemantics.ts';
import { startRailEffects } from './railEffects.ts';

export interface AtlasSettings { month:string; line:string; station:string; tilted:boolean; overlay:string }
interface Callbacks { ready:()=>void; view:(name:string)=>void; layout:(compact:boolean)=>void; zoom:(zoom:number)=>void; tiles:(ok:boolean)=>void; error:()=>void; station:(name:string,line:string)=>void }
const empty:FeatureCollection={type:'FeatureCollection',features:[]};
const duration=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:1000;
const format=new Intl.NumberFormat('en-MY');

export function createAtlasController(container:HTMLDivElement, initial:AtlasSettings, callbacks:Callbacks) {
  const map=new Map({container,style:createNetworkStyle(true),center:[105,4],zoom:5,minZoom:2,maxZoom:18.5,maxPitch:65,renderWorldCopies:false,
    attributionControl:{compact:true},canvasContextAttributes:{antialias:true}});
  let settings=initial,ready=false,compact=true,clustered=true,autoFit=true,transition=false,disposed=false;
  let snapshot=getStationSnapshot(settings.month,settings.line,settings.station);
  let routes=getNationalRoutes(settings.line),display:FeatureCollection<Point>=empty as FeatureCollection<Point>;
  let effects:ReturnType<typeof startRailEffects>|undefined, hoveredRoute='',frame=0;
  let regionalView=false;
  let labelTimer:ReturnType<typeof setTimeout>|undefined;
  const popup=new Popup({closeButton:false,closeOnClick:false,offset:12,maxWidth:'280px',className:'rail-popup'});
  const label=document.createElement('button');label.className='klang-label';label.textContent='Klang Valley';label.setAttribute('aria-label','Explore Klang Valley railway network');
  const marker=new Marker({element:label,anchor:'left',offset:[12,0]});
  const setData=(id:string,data:GeoJSON)=>(map.getSource(id) as GeoJSONSource|undefined)?.setData(data);
  map.addControl(new NavigationControl({visualizePitch:true}),'bottom-right');map.addControl(new ScaleControl({maxWidth:90}),'bottom-left');
  const showPopup=(position:[number,number],title:string,lines:string[])=>{
    const content=document.createElement('div'),strong=document.createElement('strong');strong.textContent=title;content.append(strong);
    for(const line of lines) {const p=document.createElement('p');p.textContent=line;content.append(p);} popup.setLngLat(position).setDOMContent(content).addTo(map);
  };
  const regionTooltip=()=>{const r=regionSummary(snapshot.data);showPopup((compact?atlasPoint(KLANG_ANCHOR):KLANG_ANCHOR) as [number,number],'Klang Valley',[
    'Colour = highest observed station demand, not total regional ridership.',`${r.measured}/${r.total} stations with data · ${settings.month}`,
    r.incomplete?'Incomplete coverage; missing values are not zero.':'Complete coverage in this selection.','Click to explore the complete rail catchment.']);};
  label.addEventListener('mouseenter',regionTooltip);label.addEventListener('mouseleave',()=>popup.remove());label.addEventListener('click',event=>{event.stopPropagation();exploreRegion();});

  function updateEffects() {
    if(!effects)return;
    effects.setRoutes(atlasData({type:'FeatureCollection',features:routes.features.filter(f=>f.properties?.id===hoveredRoute || (settings.line!=='All Lines'&&f.properties?.inScope))},compact));
  }
  function syncStations() {
    display=atlasData(displayStations(snapshot.data,clustered),compact);
    if(compact) {
      const kept:{x:number;y:number}[]=[];
      display.features=[...display.features].sort((a,b)=>Number(b.properties?.regional)-Number(a.properties?.regional)||Number(b.properties?.value??0)-Number(a.properties?.value??0)).filter(f=>{
        const p=map.project(f.geometry.coordinates as [number,number]);
        if(!f.properties?.regional&&kept.some(k=>Math.hypot(k.x-p.x,k.y-p.y)<9))return false;
        kept.push(p);return true;
      });
    }
    setData('stations',display);
    if(clustered&&regionSummary(snapshot.data).total) {
      clearTimeout(labelTimer);label.classList.remove('is-leaving');
      marker.setLngLat((compact?atlasPoint(KLANG_ANCHOR):KLANG_ANCHOR) as [number,number]).addTo(map);
      label.title=`Highest observed demand · ${regionSummary(snapshot.data).measured}/${regionSummary(snapshot.data).total} stations with data`;
    } else if(label.isConnected&&!label.classList.contains('is-leaving')) {
      label.classList.add('is-leaving');
      labelTimer=setTimeout(()=>marker.remove(),duration()?220:0);
    }
    effects?.refresh();
  }
  function presentation() {
    if(!ready||disposed)return;
    if(compact) {
      const result=arrangeAtlas(map,atlasData(routes),display);
      setData('landmarks',result.models);setData('landmark-labels',result.labels);setData('state-names',result.stateNames);setData('landmark-shadows',result.shadows);
    } else { const result=detailedPresentation(map.getZoom());setData('landmarks',result.models);setData('landmark-labels',result.labels);setData('landmark-shadows',empty); }
  }
  const schedulePresentation=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(presentation);};
  function dimensions() {
    for(const id of ['landmark-models','landmark-shadow','landmark-names'])map.setLayoutProperty(id,'visibility',settings.tilted?'visible':'none');
    for(const layer of createNetworkStyle().layers) if('source' in layer&&layer.source==='openmaptiles') {
      const building=['buildings-3d','building-footprints'].includes(layer.id);
      map.setLayoutProperty(layer.id,'visibility',compact||(building&&!settings.tilted)?'none':'visible');
    }
    map.setMaxPitch(settings.tilted?65:0);
  }
  function layout(value:boolean) {
    compact=value;clustered=value;callbacks.layout(value);
    const style=createNetworkStyle(value);
    for(const id of ['malaysia','outside','states','state-names']){const source=style.sources[id];if(source.type==='geojson')setData(id,source.data as GeoJSON);}
    setData('routes',atlasData(routes,compact));setData('landmarks',compact?empty:scaledModels(map.getZoom(),false));
    syncStations();dimensions();updateEffects();
  }
  function move(action:()=>void) {
    transition=true;map.stop();popup.remove();
    map.once('moveend',()=>{transition=false;callbacks.zoom(map.getZoom());schedulePresentation();});action();
    if(!duration()){transition=false;schedulePresentation();}
  }
  function reset(animate=true) {
    if(!ready)return;regionalView=false;autoFit=true;hoveredRoute='';transition=true;map.stop();layout(true);callbacks.view('Malaysia');
    const w=container.clientWidth,h=container.clientHeight;if(w<160||h<160)return;
    // Fit from a neutral camera: inherited pitch/padding previously cropped East Malaysia after reset.
    map.jumpTo({padding:{top:0,bottom:0,left:0,right:0},pitch:0,bearing:0});
    const padding=w<650?{top:175,right:24,bottom:180,left:24}:{top:34,right:35,bottom:44,left:210};
    const camera=map.cameraForBounds(ATLAS_BOUNDS,{padding});
    if(camera)move(()=>map.easeTo({...camera,zoom:(camera.zoom??5)+(w>=900&&w/h>1.9?.2:0),padding:{top:0,bottom:0,left:0,right:0},pitch:settings.tilted?30:0,duration:animate?duration():0}));
    transition=false;schedulePresentation();
  }
  function focusBounds(points:number[][],name:string,maxZoom=14) {
    if(!points.length)return;autoFit=false;transition=true;map.stop();layout(false);callbacks.view(name);
    move(()=>map.fitBounds(boundsOf(points),{padding:container.clientWidth<650?{top:210,bottom:190,left:35,right:35}:{top:65,bottom:70,left:310,right:55},absolutePadding:true,maxZoom,pitch:settings.tilted?35:0,bearing:0,duration:duration(),linear:true}));
  }
  function exploreRegion() {
    const points=klangCameraPoints(getNationalRoutes('All Lines'),MAP_STATIONS.map(stationPosition));
    regionalView=true;autoFit=false;transition=true;map.stop();layout(false);callbacks.view('Klang Valley');
    const padding=container.clientWidth<650?{top:170,bottom:130,left:25,right:30}:{top:32,bottom:38,left:305,right:48};
    move(()=>map.fitBounds(boundsOf(points),{padding,absolutePadding:true,maxZoom:11.8,pitch:settings.tilted?35:0,bearing:0,
      duration:duration(),linear:true,easing:t=>t*t*(3-2*t)}));
    configureLabels();
  }
  function configureLabels() {
    // Collision-managed labels for major destinations; other names remain on hover.
    map.setLayerZoomRange('station-labels',regionalView?9.5:settings.overlay==='station'?10:12.5,24);
    if(!regionalView){map.setFilter('station-labels',['==',['get','inScope'],true]);return;}
    map.setFilter('station-labels',['all',['==',['get','inScope'],true],['any',['>=',['zoom'],12.5],
      ['in',['get','name'],['literal',['KL Sentral','Pasar Seni','Masjid Jamek','Gombak','Sungai Buloh','Kwasa Damansara','Bandar Utama','Subang Jaya','Shah Alam','Klang','Kajang','Putrajaya Sentral','Tun Razak Exchange']]]]]);
  }
  function exploreLandmark(id:string) {
    const landmark=NATIONAL_LANDMARKS.find(l=>l.id===id);if(!landmark||!ready)return;
    regionalView=false;configureLabels();autoFit=false;transition=true;map.stop();layout(false);callbacks.view(`${landmark.name} · ${landmark.state}`);
    move(()=>map.flyTo({center:landmark.position,zoom:15.6,pitch:settings.tilted?50:0,bearing:-16,padding:{top:70,bottom:65,left:40,right:35},duration:duration()}));
  }
  function filterCamera() {
    regionalView=false;configureLabels();
    const selected=MAP_STATIONS.find(s=>s.name===settings.station&&stationMatchesLine(s,settings.line));
    if(selected) {
      autoFit=false;transition=true;map.stop();layout(false);callbacks.view(selected.name);
      move(()=>map.flyTo({center:stationPosition(selected),zoom:15.7,pitch:settings.tilted?55:0,bearing:-18,padding:{top:85,bottom:80,left:container.clientWidth>800?250:30,right:35},duration:duration()}));
    } else if(settings.line!=='All Lines') {
      const points=routes.features.filter(f=>f.properties?.inScope).flatMap(f=>f.geometry.coordinates);
      points.push(...MAP_STATIONS.filter(s=>stationMatchesLine(s,settings.line)).map(stationPosition));focusBounds(points,settings.line);
    } else reset();
  }
  function update(next:AtlasSettings) {
    const previous=settings;settings=next;if(!ready)return;
    snapshot=getStationSnapshot(next.month,next.line,next.station);routes=getNationalRoutes(next.line);
    setData('routes',atlasData(routes,compact));syncStations();updateEffects();
    map.setLayoutProperty('station-heat','visibility',next.overlay==='heatmap'?'visible':'none');
    configureLabels();
    if(previous.line!==next.line||previous.station!==next.station)filterCamera();
    else if(previous.tilted!==next.tilted){dimensions();if(autoFit)reset();else move(()=>map.easeTo({pitch:next.tilted?(map.getZoom()>=10?50:30):0,duration:duration()}));}
    popup.remove();schedulePresentation();
  }
  const nearestStation=(event:MapMouseEvent)=>map.queryRenderedFeatures(event.point,{layers:['station-hit-area']}).sort((a,b)=>{
    const distance=(f:MapGeoJSONFeature)=>{if(f.geometry.type!=='Point')return Infinity;const p=map.project(f.geometry.coordinates as [number,number]);return (p.x-event.point.x)**2+(p.y-event.point.y)**2;};return distance(a)-distance(b);
  })[0];
  function target(event:MapMouseEvent) {
    const station=nearestStation(event);if(station)return {kind:'station',feature:station};
    const rail=map.queryRenderedFeatures(event.point,{layers:['rail-hit-area']}).sort((a,b)=>Number(b.properties?.inScope)-Number(a.properties?.inScope))[0];if(rail)return {kind:'route',feature:rail};
    const model=map.queryRenderedFeatures(event.point,{layers:['landmark-models']})[0];if(model)return {kind:'landmark',feature:model};
  }
  map.on('click',event=>{
    if(!ready || (event.originalEvent.target instanceof Element && event.originalEvent.target.closest('.klang-label')))return;const hit=target(event);if(!hit)return;const p=hit.feature.properties;
    if(hit.kind==='station') {if(p.regional)exploreRegion();else{const s=MAP_STATIONS.find(s=>stationId(s)===p.id);if(s)callbacks.station(s.name,stationMatchesLine(s,settings.line)&&settings.line!=='All Lines'?settings.line:s.line);}}
    else if(hit.kind==='route')callbacks.station('All Stations',String(p.name));
    else exploreLandmark(String(p.id));
  });
  map.on('mousemove',event=>{
    if(!ready)return;const hit=target(event);map.getCanvas().style.cursor=hit?'pointer':'';
    const nextRoute=hit?.kind==='route'?String(hit.feature.properties.id):'';
    if(nextRoute!==hoveredRoute){hoveredRoute=nextRoute;updateEffects();}
    map.setFilter('station-hover',['==',['get','id'],hit?.kind==='station'?hit.feature.properties.id:'']);
    if(!hit){popup.remove();return;}
    const p=hit.feature.properties;
    if(hit.kind==='station') {
      if(p.regional){regionTooltip();return;}const s=MAP_STATIONS.find(s=>stationId(s)===p.id);if(!s)return;
      const value=getStationData(s,settings.month).ridership;
      showPopup((compact?atlasPoint(stationPosition(s)):stationPosition(s)) as [number,number],s.name,[s.line, value===null?'No data available':`${format.format(value)} boardings · ${settings.month}`]);
    } else if(hit.kind==='route')showPopup([event.lngLat.lng,event.lngLat.lat],String(p.name),[String(p.geometrySource),'Click to select railway · Light trail is decorative, not live trains.']);
    else {const l=NATIONAL_LANDMARKS.find(l=>l.id===p.id);if(l)showPopup([event.lngLat.lng,event.lngLat.lat],l.name,[l.state,'Click to explore the geographic location.']);}
  });
  const leave=()=>{popup.remove();hoveredRoute='';if(ready){updateEffects();map.setFilter('station-hover',['==',['get','id'],'']);}};map.getCanvas().addEventListener('mouseleave',leave);
  map.on('movestart',event=>{if(event.originalEvent){autoFit=false;transition=false;}popup.remove();});
  map.on('moveend',()=>{
    if(!ready||transition)return;callbacks.zoom(map.getZoom());
    if(compact&&map.getZoom()>=REGION_ENTER_ZOOM&&!autoFit){const c=map.getCenter();transition=true;layout(false);map.jumpTo({center:geographicPoint([c.lng,c.lat])});transition=false;}
    else if(!compact&&map.getZoom()<REGION_EXIT_ZOOM&&!autoFit){const c=map.getCenter();transition=true;layout(true);map.jumpTo({center:atlasPoint([c.lng,c.lat]) as [number,number]});callbacks.view('Malaysia');transition=false;}
    syncStations();schedulePresentation();
  });
  map.on('style.load',()=>{ready=true;effects=startRailEffects(map);reset(false);update(settings);if(settings.line!=='All Lines'||settings.station!=='All Stations')filterCamera();callbacks.ready();});
  map.on('sourcedata',e=>{if(e.sourceId==='openmaptiles'&&e.isSourceLoaded)callbacks.tiles(true);});
  map.on('error',e=>{if('sourceId' in e&&e.sourceId==='openmaptiles')callbacks.error();console.warn('TransitPulse map:',e.error.message);});
  const observer=new ResizeObserver(()=>{if(!container.clientWidth||!container.clientHeight)return;map.resize();if(ready){if(autoFit)reset(false);else schedulePresentation();}});observer.observe(container);
  return { update, reset, exploreLandmark, exploreRegion, refresh:schedulePresentation, destroy:()=>{disposed=true;clearTimeout(labelTimer);cancelAnimationFrame(frame);observer.disconnect();effects?.destroy();marker.remove();popup.remove();map.getCanvas().removeEventListener('mouseleave',leave);map.remove();} };
}
