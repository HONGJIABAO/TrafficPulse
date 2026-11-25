import type { Map, GeoJSONSource, LayerSpecification } from 'maplibre-gl';
import type { FeatureCollection, LineString, Position } from 'geojson';

export const effectLayers: LayerSpecification[] = [
  { id:'rail-hover-glow',type:'line',source:'routes',filter:['==',['get','id'],''],layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':8,'line-blur':3,'line-opacity':.4} },
  { id:'rail-energy',type:'line',source:'energy',layout:{'line-cap':'round','line-join':'round'},paint:{'line-color':['get','color'],'line-width':3,'line-blur':.7,'line-opacity':['get','alpha']} },
  { id:'rail-hit-area',type:'line',source:'routes',layout:{'line-cap':'round','line-join':'round'},paint:{'line-width':14,'line-opacity':0} },
  { id:'station-glow',type:'circle',source:'stations',filter:['all',['get','inScope'],['in',['get','category'],['literal',['lower','moderate','high','top']]]],paint:{'circle-radius':10,'circle-color':['get','color'],'circle-blur':.8,'circle-opacity':['match',['get','category'],'top',.25,'high',.2,'moderate',.13,.08]} },
  { id:'station-pulse',type:'circle',source:'stations',filter:['all',['get','inScope'],['==',['get','category'],'top']],paint:{'circle-radius':5,'circle-opacity':0,'circle-stroke-color':'#E83346','circle-stroke-width':1.2,'circle-stroke-opacity':0} },
  { id:'station-heartbeat',type:'circle',source:'stations',filter:['all',['get','inScope'],['==',['get','category'],'top']],paint:{'circle-radius':7,'circle-blur':.7,'circle-color':'#E83346','circle-opacity':0} },
  { id:'station-hover',type:'circle',source:'stations',filter:['==',['get','id'],''],paint:{'circle-radius':8,'circle-opacity':.12,'circle-color':['get','color'],'circle-stroke-color':['get','color'],'circle-stroke-width':1} },
];

export function animationValues(ms:number) {
  const phase=(ms%3600)/3600;
  const breathe=(1-Math.cos(phase*2*Math.PI))/2;
  const heartbeat=Math.exp(-(((phase-.13)/.045)**2))+.7*Math.exp(-(((phase-.28)/.055)**2));
  return { breathe, heartbeat, radius:4+phase*18, ringOpacity:(1-phase)*.34 };
}
const lighten=(hex:string) => {const c=hex.replace('#',''); return '#'+[0,2,4].map(i=>Math.round(parseInt(c.slice(i,i+2),16)*.4+255*.6).toString(16).padStart(2,'0')).join('');};
export function startRailEffects(map:Map) {
  let active: {coordinates:Position[]; distances:number[]; length:number; color:string}[]=[];
  let raf=0, last=0, lastInspect=0, visibleDemand=false, visibleRail=false;
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  const inspect=()=>{ if(!map.getLayer('station-dots'))return;
    visibleDemand=map.queryRenderedFeatures({layers:['station-dots']}).some(f=>f.properties?.inScope&&['top','high'].includes(f.properties?.category));
    visibleRail=active.length>0 && map.queryRenderedFeatures({layers:['rail-hover-glow']}).length>0;
  };
  const setRoutes=(routes:FeatureCollection<LineString>)=>{
    active=routes.features.map(f=>{
      const coordinates=f.geometry.coordinates,distances=[0];
      for(let i=1;i<coordinates.length;i++) {const a=coordinates[i-1],b=coordinates[i];distances.push(distances[i-1]+Math.hypot((b[0]-a[0])*Math.cos(a[1]*Math.PI/180),b[1]-a[1]));}
      return {coordinates,distances,length:distances.at(-1)??0,color:lighten(String(f.properties?.color??'#259CAF'))};
    });
    const ids=routes.features.map(f=>f.properties?.id);
    map.setFilter('rail-hover-glow',['in',['get','id'],['literal',ids]]);
    if(!active.length) (map.getSource('energy') as GeoJSONSource).setData({type:'FeatureCollection',features:[]});
    inspect();
  };
  const step=(ms:number)=>{
    raf=requestAnimationFrame(step);
    if(ms-last<45||document.hidden||motion.matches||map.isMoving())return;
    last=ms;
    if(ms-lastInspect>800){inspect();lastInspect=ms;}
    if(visibleDemand) {
      const a=animationValues(ms);
      map.setPaintProperty('station-glow','circle-opacity',['match',['get','category'],'top',.18+a.breathe*.18,'high',.13+a.breathe*.13,'moderate',.13,.08]);
      map.setPaintProperty('station-pulse','circle-radius',a.radius);
      map.setPaintProperty('station-pulse','circle-stroke-opacity',a.ringOpacity);
      map.setPaintProperty('station-heartbeat','circle-opacity',a.heartbeat*.2);
    }
    if(visibleRail) {
      const features:FeatureCollection<LineString>['features']=[];
      for(const route of active) {
        const duration=4500+Math.min(2500,route.length*800),head=(ms%duration)/duration;
        const at=(t:number):Position=>{const d=t*route.length;let i=1;while(i<route.distances.length-1&&route.distances[i]<d)i++;const a=route.coordinates[i-1],b=route.coordinates[i];const span=route.distances[i]-route.distances[i-1];const f=span?(d-route.distances[i-1])/span:0;return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];};
        for(let j=0;j<10;j++) {const end=head-j*.006,start=Math.max(0,end-.006);if(end<=0)continue;
          const from=start*route.length,to=end*route.length;
          const interior=route.coordinates.filter((_,i)=>route.distances[i]>from&&route.distances[i]<to);
          features.push({type:'Feature',properties:{color:route.color,alpha:(1-j/10)*.8},geometry:{type:'LineString',coordinates:[at(start),...interior,at(end)]}});
        }
      }
      (map.getSource('energy') as GeoJSONSource).setData({type:'FeatureCollection',features});
    }
  };
  const reduced=()=>{map.setPaintProperty('station-pulse','circle-stroke-opacity',0);map.setPaintProperty('station-heartbeat','circle-opacity',0);(map.getSource('energy') as GeoJSONSource).setData({type:'FeatureCollection',features:[]});};
  map.on('idle',inspect);map.on('moveend',inspect);motion.addEventListener('change',reduced);raf=requestAnimationFrame(step);
  return { setRoutes, refresh:inspect, destroy:()=>{cancelAnimationFrame(raf);map.off('idle',inspect);map.off('moveend',inspect);motion.removeEventListener('change',reduced);} };
}
