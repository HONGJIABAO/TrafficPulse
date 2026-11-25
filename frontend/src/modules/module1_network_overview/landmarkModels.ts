import type { FeatureCollection, Feature, Polygon, Point } from 'geojson';
import { NATIONAL_LANDMARKS } from './nationalAtlas.ts';

// Original architectural massing models, anchored to each landmark's coordinates.
// At country scale the models are exaggerated for legibility; at city scale they
// settle into compact grey architectural models. These are not surveyed models.
export function createLandmarkModels(zoom: number, nationwideRefinement = false): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  const ordered = [...NATIONAL_LANDMARKS].sort((a,b)=>a.priority-b.priority);
  const shown: typeof ordered = [];
  for (const landmark of ordered) {
    const crowded = shown.some(other => Math.hypot(other.position[0]-landmark.position[0], other.position[1]-landmark.position[1]) < (zoom < 9 ? .22 : zoom < 12 ? .025 : 0));
    if (!crowded) shown.push(landmark);
    const [lng, lat] = landmark.position;
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
    const tall = ['twins', 'needle', 'cylinder', 'chimney', 'spire', 'skyscraper', 'leaning'].includes(landmark.kind);
    const width = Math.max(tall ? 55 : 85, metersPerPixel * (zoom < 10 ? (tall ? 12 : 18) : (tall ? 9 : 12)));
    const height = Math.max(landmark.kind === 'twins' ? 200 : tall ? 100 : 32, metersPerPixel * (zoom < 10 ? (tall ? 28 : 16) : (tall ? 25 : 12)));
    const point = (x: number, y: number) => [lng + x * width / (111320 * Math.cos(lat * Math.PI / 180)), lat + y * width / 111320];
    const polygon = (ring: number[][], base: number, top: number, color = '#9b9fa2') => {
      const coordinates = ring.map(([x, y]) => point(x, y));
      coordinates.push(coordinates[0]);
      features.push({ type: 'Feature', properties: { id: landmark.id, name: landmark.name, state: landmark.state,
        base: base * height, height: top * height, color, visible: !crowded }, geometry: { type: 'Polygon', coordinates: [coordinates] } });
    };
    const box = (x: number, y: number, w: number, d: number, base: number, top: number, color?: string) =>
      polygon([[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2]],base,top,color);
    const cylinder = (x: number, y: number, radius: number, base: number, top: number, sides = 12, color?: string) =>
      polygon(Array.from({ length: sides }, (_, i) => [x + Math.cos(i * 2 * Math.PI / sides) * radius,
        y + Math.sin(i * 2 * Math.PI / sides) * radius]),base,top,color);
    const roof = (x: number, y: number, size: number, base: number, peak: number) => {
      for (let i=0;i<5;i++) box(x,y,size*(1-i*.17),size*.7*(1-i*.17),base+(peak-base)*i/5,base+(peak-base)*(i+1)/5,'#656b70');
    };
    // A low podium makes every model read as architecture planted on the map.
    box(0,0,nationwideRefinement===true&&tall?.56:1,nationwideRefinement===true&&tall?.50:.65,0,.035,'#c9ccce');
    // The nationwide Maha Tower silhouette has an observation deck and spire.
    // This optional branch never changes detailed-view assets or their sizing.
    const kind=nationwideRefinement===true&&landmark.id==='maha-tower'?'needle':landmark.kind;
    switch (kind) {
      case 'bridge':
        box(0,0,2,.17,.18,.23,'#c2c8cf');
        for (const x of [-.45,.45]) for (const y of [-.09,.09]) {
          box(x,y,.035,.035,.03,1,'#929ca7');
          for (const direction of [-1,1]) for (const length of [.18,.32,.48]) for(let i=0;i<18;i++) {
            const t=i/18; box(x+direction*length*t,y,.025,.012,.23+(.7*(1-t)),.25+(.7*(1-t)),'#c2c8cf');
          }
        }
        break;
      case 'mountain':
        for (const [x,y,size,peak] of [[0,0,1,1.4],[-.45,.1,.7,.9],[.4,.12,.6,1.05]]) {
          if(nationwideRefinement===true) {
            // Three consistent light-facing facets instead of horizontal stripes.
            for(let i=0;i<48;i++) {
              const t=i/48,r=size*(1-t), corners=[[x-r*.65,y-r*.45],[x+r*.62,y-r*.3],[x+r*.16,y+r*.6]];
              for(let face=0;face<3;face++) polygon([[x,y],corners[face],corners[(face+1)%3]],t*peak,(t+1/48)*peak,['#f5f6f8','#c2c8cf','#929ca7'][face]);
            }
            continue;
          }
          for(let i=0;i<24;i++) {
            const t=i/24, r=size*(1-t);
            polygon([[x-r*.65,y-r*.45],[x+r*.62,y-r*.3],[x+r*.16,y+r*.6]],t*peak,(t+1/24)*peak,i>18?'#f5f6f8':i%3?'#c2c8cf':'#929ca7');
          }
        }
        break;
      case 'twins':
        for (const x of [-.27,.27]) {
          cylinder(x,0,.19,.03,.55,8);
          cylinder(x,0,.16,.55,.70,8);
          cylinder(x,0,.13,.70,.82,8);
          cylinder(x,0,.09,.82,.91,8);
          cylinder(x,0,.025,.91,1,8,'#70777c');
        }
        box(0,0,.54,.09,.43,.46,'#626b72');
        for (const x of [-.27,.27]) for(let i=1;i<18;i++) {
          const h=i*.045; const r=h<.55?.195:h<.70?.165:.135;
          cylinder(x,0,r,h,h+.009,16,'#d1d3d4');
        }
        break;
      case 'spire':
        polygon([[-.28,-.21],[.26,-.21],[.33,.12],[-.14,.27]],.03,.65,'#7c858c');
        polygon([[-.28,-.21],[.26,-.21],[.12,.17],[-.14,.27]],.65,.78,'#aeb3b7');
        polygon([[-.19,-.14],[.12,-.14],[.12,.17]],.78,.88,'#737c84');
        box(.1,0,.025,.025,.86,1.25,'#5b6369');
        for(let i=1;i<15;i++) box(0,-.215,.45,.012,i*.045,i*.045+.007,'#c5c9cc');
        break;
      case 'skyscraper':
        box(0,0,.42,.42,.03,.87,'#8b949b');
        for(let i=1;i<20;i++) box(0,0,.43,.43,i*.043,i*.043+.006,'#c5c8cb');
        box(0,0,.46,.46,.87,.98,'#c4c6c8'); box(0,0,.36,.36,.98,1.04,'#9ea4a9');
        break;
      case 'leaning':
        for(let i=0;i<3;i++) { cylinder(i*.025,0,.25-i*.025,i*.28,(i+1)*.28,8); roof(i*.025,0,.72-i*.07,(i+1)*.28,(i+1)*.28+.1); }
        break;
      case 'church':
        box(0,0,.75,.36,.03,.48); roof(0,0,.9,.48,.8);
        box(-.3,0,.22,.28,.03,.85); roof(-.3,0,.3,.85,1.08);
        box(-.3,0,.025,.025,1.07,1.22,'#50575b'); box(-.3,0,.12,.025,1.14,1.16,'#50575b');
        break;
      case 'colonial':
        box(0,0,1,.38,.03,.42); roof(0,0,1.08,.42,.62);
        for(const x of [-.4,-.25,-.1,.1,.25,.4]) { box(x,-.195,.07,.025,.12,.30,'#515a60'); box(x,-.195,.07,.025,.34,.41,'#515a60'); }
        box(0,0,.25,.42,.42,.66); roof(0,0,.34,.66,.83);
        break;
      case 'fort':
        box(-.36,0,.28,.42,.03,.52); box(.36,0,.28,.42,.03,.52);
        box(0,0,.5,.28,.36,.53); box(0,0,.35,.3,.53,.68);
        for (const x of [-.44,-.27,.27,.44]) box(x,0,.10,.42,.52,.64);
        break;
      case 'needle':
        cylinder(0,0,.07,.03,.73,10); cylinder(0,0,.3,.72,.79,16);
        cylinder(0,0,.23,.79,.86,16,'#70787e'); cylinder(0,0,.04,.86,1,8);
        break;
      case 'cylinder':
        cylinder(0,0,.24,.03,.93,20); cylinder(0,0,.22,.93,1,20);
        for (let i=1;i<9;i++) cylinder(0,0,.245,i*.10,i*.10+.012,20,'#565e64');
        break;
      case 'chimney':
        box(0,0,.37,.37,.03,.16); cylinder(0,0,.12,.16,.93,4); cylinder(0,0,.17,.93,1,4);
        break;
      case 'pagoda':
        for (let i=0;i<5;i++) { const size=.75-i*.1; box(0,0,size*.65,size*.65,i*.17,(i+1)*.17); roof(0,0,size,(i+1)*.17,(i+1)*.17+.08); }
        cylinder(0,0,.025,.93,1,6);
        break;
      case 'palace':
        box(0,0,.8,.48,.03,.46); roof(0,0,1,.46,.78);
        box(0,.12,.32,.24,.7,.84); roof(0,.12,.48,.84,1);
        if(nationwideRefinement===true) for(const x of [-.32,-.16,0,.16,.32]) {
          box(x,-.25,.06,.015,.13,.32,'#515a60');box(x,-.27,.025,.04,.03,.46,'#d1d3d4');
        }
        break;
      case 'assembly':
        if(nationwideRefinement===true) {
          cylinder(0,0,.42,.03,.36,9);
          for(let i=0;i<16;i++) {const t=i/16;cylinder(0,0,.64*(1-t)**2+.05,.36+t*.65,.36+(t+1/16)*.65,9,i<3?'#656b70':'#c9ccce');}
          cylinder(0,0,.018,1.01,1.22,8,'#626b72');
          for(let i=0;i<9;i++){const a=i*Math.PI*2/9;box(Math.cos(a)*.39,Math.sin(a)*.39,.035,.035,.03,.36,'#515a60');}
          break;
        }
        cylinder(0,0,.42,.03,.42,9); roof(0,0,1,.42,.75); roof(0,0,.65,.75,.96); cylinder(0,0,.02,.96,1.12,6);
        break;
      case 'clock':
        box(0,0,.9,.38,.03,.35); box(0,0,.22,.27,.35,.85); roof(0,0,.36,.85,1);
        box(0,-.14,.12,.015,.65,.77,'#e7e8e9');
        box(0,-.151,.018,.01,.68,.75,'#454c52');
        for(const x of [-.36,-.23,.23,.36]) box(x,-.195,.08,.018,.12,.27,'#525a60');
        break;
      case 'mosque':
        box(0,0,.7,.48,.03,.38);
        for (let i=0;i<6;i++) cylinder(0,0,.25*Math.sqrt(1-(i/6)**2),.38+i*.045,.38+(i+1)*.045,16);
        for (const x of [-.4,.4]) { cylinder(x,.14,.05,.03,.84,8); cylinder(x,.14,.075,.65,.70,8); cylinder(x,.14,.025,.84,1,8); }
        break;
    }
  }
  return { type: 'FeatureCollection', features };
}

export function landmarkLabels(zoom: number): FeatureCollection<Point> {
  const visible = new Set(createLandmarkModels(zoom).features.filter(f => f.properties?.visible).map(f => f.properties?.id));
  return { type: 'FeatureCollection', features: NATIONAL_LANDMARKS.filter(l => visible.has(l.id) && (l.priority <= 3 || zoom >= 10)).map(l => ({
    type: 'Feature', properties: { name: l.name, priority: l.priority }, geometry: { type: 'Point', coordinates: l.position },
  })) };
}
