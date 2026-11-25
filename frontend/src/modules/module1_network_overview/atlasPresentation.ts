import type { Map as RailMap } from 'maplibre-gl';
import type { FeatureCollection, Polygon, Point, LineString, Position } from 'geojson';
import { createLandmarkModels, landmarkLabels } from './landmarkModels.ts';
import { NATIONAL_LANDMARKS, STATE_LABELS } from './nationalAtlas.ts';
import { atlasData, atlasPoint, geographicPoint } from './atlasLayout.ts';
import states from '../../data/malaysia_states.json' with { type: 'json' };

// Image reference selects these assets only. Detailed views still use all 38.
export const DEFAULT_LANDMARK_IDS = new Set(['maha-tower','penang-bridge','komtar','istana-jahar',
  'crystal-mosque','sultan-ahmad-shah','petronas','a-famosa','sultan-ibrahim',
  'sarawak-dun','fort-margherita','tun-mustapha','kinabalu']);
function inRing(p:Position, ring:number[][]) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function inLandmarkState(p:Position,state:string) {
  const geometry=states.features.find(f=>f.properties.state===state||f.properties.state===`W.P. ${state}`)?.geometry;
  return !!geometry?.coordinates.some(polygon=>inRing(p,polygon[0])&&!polygon.slice(1).some(hole=>inRing(p,hole)));
}

export const NATIONAL_MODEL_SCALE = .8;
export function overviewScale(zoom: number) { return zoom <= 7 ? NATIONAL_MODEL_SCALE : zoom >= 9 ? 1 : NATIONAL_MODEL_SCALE + (zoom-7)*.1; }
export function scaledModels(zoom: number, overview: boolean, refine=false): FeatureCollection<Polygon> {
  const models = createLandmarkModels(zoom,overview&&refine);
  if (!overview) return models; // Exact original geometry/materials in detailed mode.
  const scale = overviewScale(zoom);
  const anchors = new Map(NATIONAL_LANDMARKS.map(l => [l.id, l.position]));
  for (const feature of models.features) {
    const props = feature.properties!;
    const anchor = anchors.get(props.id)!;
    feature.geometry.coordinates = feature.geometry.coordinates.map(ring=>ring.map(p=>[anchor[0]+(p[0]-anchor[0])*scale,anchor[1]+(p[1]-anchor[1])*scale]));
    props.height *= scale; props.base *= scale;
    props.color = ['#515a60','#525a60','#454c52','#50575b'].includes(props.color) ? '#747E89'
      : ['#565e64','#626b72','#929ca7'].includes(props.color)?'#929CA7'
      : ['#656b70','#70787e','#c2c8cf'].includes(props.color)?'#C2C8CF'
      : ['#c9ccce','#d1d3d4','#e7e8e9','#c5c9cc','#c5c8cb','#f5f6f8'].includes(props.color) ? '#F5F6F8' : '#E5E7EB';
    props.anchorLng = anchor[0]; props.anchorLat = anchor[1]; props.modelScale = scale;
  }
  return atlasData(models);
}
type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect,b: Rect) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
const offsets = [[0,0],[-24,0],[24,0],[0,24],[0,-24],[-44,20],[44,20],[-44,-20],[44,-20],[0,46],[0,-46],[-64,0],[64,0]];
const groundOffsets = [[0,0], ...[2,4,6,8,10,12,16,20,24,30,36,42,48].flatMap(r=>Array.from({length:16},(_,i)=>[Math.cos(i*Math.PI/8)*r,Math.sin(i*Math.PI/8)*r]))];

// Recomputed only after camera/layout changes. Conservative screen footprints
// include projected base, extrusion height, shadow and label. The protected
// network uses the actual vertices, never a redrawn/simplified railway.
export function arrangeAtlas(map: RailMap, routes: FeatureCollection<LineString>, stations: FeatureCollection<Point>) {
  const occupied: Rect[] = [], stateRects:Rect[]=[];
  const container = map.getContainer();
  const origin = container.getBoundingClientRect();
  container.parentElement?.querySelectorAll('.rail-map-heading,.rail-map-toolbar,.rail-map-explore,.rail-map-legend,.rail-demand-legend,.rail-map-focus,.rail-station-card,.rail-source-bar').forEach(el=>{
    const r=el.getBoundingClientRect(); if(r.width&&r.height) occupied.push({x:r.x-origin.x-5,y:r.y-origin.y-5,w:r.width+10,h:r.height+10});
  });
  const point = (p: Position) => map.project(p as [number,number]);
  const fits = (r: Rect) => r.x>=6 && r.y>=6 && r.x+r.w<=container.clientWidth-6 && r.y+r.h<=container.clientHeight-24 && !occupied.some(o=>overlap(o,r));
  for(const f of stations.features.filter(f=>f.properties?.regional)) { const p=point(f.geometry.coordinates); occupied.push({x:p.x-12,y:p.y-20,w:125,h:40}); }
  const stateNames = atlasData(STATE_LABELS);
  for (const feature of stateNames.features) {
    if(feature.properties?.territory && map.getZoom()<7)continue;
    const p=point(feature.geometry.coordinates), name=String(feature.properties?.name);
    const words=name.split(' '),wrap=name.length>11&&words.length>1;
    const w=(wrap?Math.max(...words.map(w=>w.length)):name.length)*6.2+4, h=wrap?28:16;
    const labelOffsets:Record<string,number[][]>={'Pulau Pinang':[[32,0],[42,8]],'Negeri Sembilan':[[40,0],[40,-8]],'Melaka':[[-24,10],[-24,0]],'Kelantan':[[25,4],[20,-10]]};
    const candidates = [...(labelOffsets[name]??[]),...offsets,[-82,0],[82,0],[0,65],[0,-65]];
    const chosen=candidates.find(([x,y])=>fits({x:p.x+x-w/2,y:p.y+y-h/2,w,h}));
    if(chosen) { const [x,y]=chosen; const ll=map.unproject([p.x+x,p.y+y]); feature.geometry.coordinates=[ll.lng,ll.lat]; occupied.push({x:p.x+x-w/2,y:p.y+y-h/2,w,h});stateRects.push(occupied[occupied.length-1]); }
    else {occupied.push({x:p.x-w/2,y:p.y-h/2,w,h});stateRects.push(occupied[occupied.length-1]);}
  }
  for (const f of stations.features) {
    const p=point(f.geometry.coordinates);
    occupied.push(f.properties?.regional ? {x:p.x-12,y:p.y-20,w:125,h:40} : {x:p.x-6,y:p.y-6,w:12,h:12});
  }
  // Grid spatial index for the actual projected rail segments.
  type Segment = {a:{x:number;y:number};b:{x:number;y:number}};
  const grid = new Map<string, Segment[]>();
  const crosses=(s:Segment,r:Rect)=>{
    let lo=0,hi=1;const dx=s.b.x-s.a.x,dy=s.b.y-s.a.y;
    for(const [p,q] of [[-dx,s.a.x-r.x],[dx,r.x+r.w-s.a.x],[-dy,s.a.y-r.y],[dy,r.y+r.h-s.a.y]]) {
      if(p===0){if(q<0)return false;} else {const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return false;}
    }return true;
  };
  const keys = (r: Rect) => { const result:string[]=[]; for(let x=Math.floor(r.x/48);x<=Math.floor((r.x+r.w)/48);x++) for(let y=Math.floor(r.y/48);y<=Math.floor((r.y+r.h)/48);y++) result.push(`${x}:${y}`); return result; };
  for(const route of routes.features) {
    const points=route.geometry.coordinates.map(point);
    for(let i=1;i<points.length;i++) { const a=points[i-1],b=points[i]; const r={x:Math.min(a.x,b.x)-5,y:Math.min(a.y,b.y)-5,w:Math.abs(a.x-b.x)+10,h:Math.abs(a.y-b.y)+10};
      if(r.x+r.w<0||r.y+r.h<0||r.x>container.clientWidth||r.y>container.clientHeight) continue;
      for(const key of keys(r)) { const bucket=grid.get(key)??[]; bucket.push({a,b});grid.set(key,bucket); }
    }
  }
  const models=scaledModels(map.getZoom(),true,true), labels:FeatureCollection<Point>={type:'FeatureCollection',features:[]};
  models.features=models.features.filter(f=>DEFAULT_LANDMARK_IDS.has(f.properties!.id));
  const shadows:FeatureCollection<Polygon>={type:'FeatureCollection',features:[]};
  for(const landmark of [...NATIONAL_LANDMARKS].filter(l=>DEFAULT_LANDMARK_IDS.has(l.id)).sort((a,b)=>a.priority-b.priority)) {
    const parts=models.features.filter(f=>f.properties?.id===landmark.id);
    const vertices=parts.flatMap(f=>f.geometry.coordinates[0].map(point));
    const minX=Math.min(...vertices.map(p=>p.x)),maxX=Math.max(...vertices.map(p=>p.x));
    const minY=Math.min(...vertices.map(p=>p.y)),maxY=Math.max(...vertices.map(p=>p.y));
    const metersPerPixel=78271.51696*Math.cos(landmark.position[1]*Math.PI/180)/2**map.getZoom();
    const rise=Math.max(...parts.map(f=>Number(f.properties?.height)))/metersPerPixel*Math.sin(map.getPitch()*Math.PI/180);
    const base={x:minX-2,y:minY-rise-2,w:maxX-minX+4,h:maxY-minY+rise+4};
    const original=atlasPoint(landmark.position), anchor=point(original);
    // A screen-space displacement is legal only while its base stays on the
    // corresponding state's land. Never move the analytical geographic anchor.
    const land=(p:Position)=>inLandmarkState(p,landmark.state)||(landmark.id==='petronas'&&inLandmarkState(p,'Selangor'));
    const grounded=(x:number,y:number)=>{
      if(landmark.id==='penang-bridge')return Math.hypot(x,y)<=30;
      const center=map.unproject([anchor.x+x,anchor.y+y]);
      // Miniatures can overhang a narrow coast, but their ground contact stays
      // on land. Requiring every exaggerated podium corner to fit an island
      // was the reason KOMTAR/Maha Tower disappeared or became unreadable.
      return land(geographicPoint([center.lng,center.lat]));
    };
    const area=(a:Rect,b:Rect)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
    const candidates=groundOffsets.filter(([x,y])=>grounded(x,y)).map(([x,y])=>{
      const r={...base,x:base.x+x,y:base.y+y};
      const hard=occupied.filter(o=>!stateRects.includes(o));
      const networkHits=new Set(keys(r).flatMap(k=>grid.get(k)??[]).filter(segment=>crosses(segment,{x:r.x-2,y:r.y-2,w:r.w+4,h:r.h+4}))).size;
      const labelPenalty=stateRects.reduce((sum,o)=>{const fraction=area(o,r)/(o.w*o.h);return sum+fraction*35+(fraction>.85?10000:0);},0);
      return {offset:[x,y],rect:r,score:Math.hypot(x,y)*.7+labelPenalty+networkHits*1000+hard.reduce((sum,o)=>sum+area(o,r)*20,0)};
    }).filter(c=>c.rect.x>=0&&c.rect.y>=0&&c.rect.x+c.rect.w<=container.clientWidth&&c.rect.y+c.rect.h<=container.clientHeight-22);
    candidates.sort((a,b)=>a.score-b.score);
    const chosen=candidates[0];
    // Only cull when genuinely off-screen, never for a minor label collision.
    if(!chosen){parts.forEach(f=>{f.properties!.visible=false;});continue;}
    const [dx,dy]=chosen.offset, collisionScale=1;
    occupied.push(chosen.rect);
    const shifted=map.unproject([anchor.x+dx,anchor.y+dy]);
    const old=atlasPoint(landmark.position), delta=[shifted.lng-old[0],shifted.lat-old[1]];
    for(const part of parts) {
      part.properties!.visible=true;part.properties!.collisionScale=collisionScale;
      part.properties!.placementLng=shifted.lng;part.properties!.placementLat=shifted.lat;
      part.properties!.height*=collisionScale;part.properties!.base*=collisionScale;
      part.geometry.coordinates=part.geometry.coordinates.map(r=>r.map(p=>[original[0]+(p[0]-original[0])*collisionScale+delta[0],original[1]+(p[1]-original[1])*collisionScale+delta[1]]));
    }
    const podium=structuredClone(parts[0]); shadows.features.push(podium);
    const labelRect={x:anchor.x+dx-45,y:maxY+dy+4,w:90,h:25};
    if(landmark.priority<=3&&fits(labelRect)) { occupied.push(labelRect); const ll=map.unproject([anchor.x+dx,maxY+dy+4]); labels.features.push({type:'Feature',properties:{name:landmark.name,priority:landmark.priority},geometry:{type:'Point',coordinates:[ll.lng,ll.lat]}}); }
  }
  return { models, labels, stateNames, shadows };
}
export const detailedPresentation = (zoom:number) => ({ models:createLandmarkModels(zoom), labels:landmarkLabels(zoom) });
