import type { FeatureCollection, Feature, Polygon } from 'geojson';
import { NATIONAL_LANDMARKS } from './nationalAtlas.ts';

// Original architectural massing models, anchored to each landmark's coordinates.
// At country scale the models are exaggerated for legibility; at city scale they
// settle into compact white architectural blocks. These are not surveyed models.
export function createLandmarkModels(zoom: number): FeatureCollection<Polygon> {
  const features: Feature<Polygon>[] = [];
  for (const landmark of NATIONAL_LANDMARKS) {
    const [lng, lat] = landmark.position;
    const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
    const tall = ['twins', 'needle', 'cylinder', 'chimney'].includes(landmark.kind);
    const width = Math.max(tall ? 55 : 85, metersPerPixel * (tall ? 9 : 12));
    const height = Math.max(landmark.kind === 'twins' ? 200 : tall ? 100 : 32, metersPerPixel * (tall ? 25 : 12));
    const point = (x: number, y: number) => [lng + x * width / (111320 * Math.cos(lat * Math.PI / 180)), lat + y * width / 111320];
    const polygon = (ring: number[][], base: number, top: number, color = '#ffffff') => {
      const coordinates = ring.map(([x, y]) => point(x, y));
      coordinates.push(coordinates[0]);
      features.push({ type: 'Feature', properties: { id: landmark.id, name: landmark.name, state: landmark.state,
        base: base * height, height: top * height, color }, geometry: { type: 'Polygon', coordinates: [coordinates] } });
    };
    const box = (x: number, y: number, w: number, d: number, base: number, top: number, color?: string) =>
      polygon([[x-w/2,y-d/2],[x+w/2,y-d/2],[x+w/2,y+d/2],[x-w/2,y+d/2]],base,top,color);
    const cylinder = (x: number, y: number, radius: number, base: number, top: number, sides = 12, color?: string) =>
      polygon(Array.from({ length: sides }, (_, i) => [x + Math.cos(i * 2 * Math.PI / sides) * radius,
        y + Math.sin(i * 2 * Math.PI / sides) * radius]),base,top,color);
    const roof = (x: number, y: number, size: number, base: number, peak: number) => {
      for (let i=0;i<5;i++) box(x,y,size*(1-i*.17),size*.7*(1-i*.17),base+(peak-base)*i/5,base+(peak-base)*(i+1)/5,'#f3f6f7');
    };
    // A low podium makes every model read as architecture planted on the map.
    box(0,0,1,.65,0,.035,'#f6f8f9');
    switch (landmark.kind) {
      case 'twins':
        for (const x of [-.27,.27]) {
          cylinder(x,0,.19,.03,.55,8);
          cylinder(x,0,.16,.55,.70,8);
          cylinder(x,0,.13,.70,.82,8);
          cylinder(x,0,.09,.82,.91,8);
          cylinder(x,0,.025,.91,1,8,'#dfe7eb');
        }
        box(0,0,.54,.09,.43,.46,'#e2e9ed');
        break;
      case 'fort':
        box(-.36,0,.28,.42,.03,.52); box(.36,0,.28,.42,.03,.52);
        box(0,0,.5,.28,.36,.53); box(0,0,.35,.3,.53,.68);
        for (const x of [-.44,-.27,.27,.44]) box(x,0,.10,.42,.52,.64);
        break;
      case 'needle':
        cylinder(0,0,.07,.03,.73,10); cylinder(0,0,.3,.72,.79,16);
        cylinder(0,0,.23,.79,.86,16,'#e8eef1'); cylinder(0,0,.04,.86,1,8);
        break;
      case 'cylinder':
        cylinder(0,0,.24,.03,.93,20); cylinder(0,0,.22,.93,1,20);
        for (let i=1;i<9;i++) cylinder(0,0,.245,i*.10,i*.10+.012,20,'#dce5e9');
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
        break;
      case 'assembly':
        cylinder(0,0,.42,.03,.42,9); roof(0,0,1,.42,.75); roof(0,0,.65,.75,.96); cylinder(0,0,.02,.96,1.12,6);
        break;
      case 'clock':
        box(0,0,.9,.38,.03,.35); box(0,0,.22,.27,.35,.85); roof(0,0,.36,.85,1);
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
