import type { FeatureCollection, LineString, Point } from 'geojson';

// Label anchors are placed inside each state for legibility, not at its centroid.
export const STATE_LABELS: FeatureCollection<Point> = {
  type: 'FeatureCollection', features: [
    ['Perlis', 100.22, 6.56], ['Kedah', 100.75, 6.02], ['Pulau Pinang', 100.40, 5.38],
    ['Perak', 101.13, 4.85], ['Kelantan', 102.10, 5.55], ['Terengganu', 103.05, 4.99],
    ['Pahang', 102.48, 3.81], ['Selangor', 101.48, 3.45], ['Negeri Sembilan', 102.26, 2.82],
    ['Melaka', 102.36, 2.30], ['Johor', 103.45, 2.05], ['Sarawak', 113.2, 2.85], ['Sabah', 117.05, 5.65],
    ['Kuala Lumpur', 101.69, 3.15], ['Putrajaya', 101.69, 2.93], ['Labuan', 115.22, 5.32],
  ].map(([name, lng, lat], index) => ({ type: 'Feature', properties: { name, territory: index >= 13 },
    geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] } })),
};

export type LandmarkKind = 'twins' | 'fort' | 'needle' | 'pagoda' | 'mosque' | 'palace' | 'clock' | 'cylinder' | 'assembly' | 'chimney';
export interface NationalLandmark {
  id: string; name: string; state: string; position: [number, number]; kind: LandmarkKind;
  side: 'left' | 'right'; priority: number;
}

// Architectural illustrations at approximate landmark locations. Deliberately
// not to scale: national-scale icons should remain recognisable when zoomed out.
export const NATIONAL_LANDMARKS: NationalLandmark[] = [
  { id: 'al-hussain', name: 'Al Hussain Mosque', state: 'Perlis', position: [100.1297, 6.3994], kind: 'mosque', side: 'left', priority: 8 },
  { id: 'alor-setar', name: 'Alor Setar Tower', state: 'Kedah', position: [100.3676, 6.1248], kind: 'needle', side: 'right', priority: 5 },
  { id: 'kek-lok-si', name: 'Kek Lok Si', state: 'Pulau Pinang', position: [100.2737, 5.3998], kind: 'pagoda', side: 'left', priority: 4 },
  { id: 'ubudiah', name: 'Ubudiah Mosque', state: 'Perak', position: [100.9487, 4.7644], kind: 'mosque', side: 'left', priority: 7 },
  { id: 'istana-jahar', name: 'Istana Jahar', state: 'Kelantan', position: [102.2382, 6.1328], kind: 'palace', side: 'right', priority: 8 },
  { id: 'crystal-mosque', name: 'Crystal Mosque', state: 'Terengganu', position: [103.1172, 5.3222], kind: 'mosque', side: 'right', priority: 6 },
  { id: 'sultan-ahmad-shah', name: 'Sultan Ahmad Shah Mosque', state: 'Pahang', position: [103.3264, 3.8074], kind: 'mosque', side: 'right', priority: 8 },
  { id: 'blue-mosque', name: 'Sultan Salahuddin Mosque', state: 'Selangor', position: [101.5207, 3.0784], kind: 'mosque', side: 'left', priority: 7 },
  { id: 'petronas', name: 'Petronas Twin Towers', state: 'Kuala Lumpur', position: [101.7119, 3.1578], kind: 'twins', side: 'right', priority: 1 },
  { id: 'putra', name: 'Putra Mosque', state: 'Putrajaya', position: [101.6884, 2.9361], kind: 'mosque', side: 'left', priority: 8 },
  { id: 'seri-menanti', name: 'Istana Seri Menanti', state: 'Negeri Sembilan', position: [102.1424, 2.6968], kind: 'palace', side: 'right', priority: 6 },
  { id: 'a-famosa', name: 'A Famosa', state: 'Melaka', position: [102.2501, 2.1918], kind: 'fort', side: 'left', priority: 2 },
  { id: 'sultan-ibrahim', name: 'Sultan Ibrahim Building', state: 'Johor', position: [103.7579, 1.4568], kind: 'clock', side: 'right', priority: 7 },
  { id: 'sarawak-dun', name: 'Sarawak State Assembly', state: 'Sarawak', position: [110.3502, 1.5611], kind: 'assembly', side: 'left', priority: 3 },
  { id: 'tun-mustapha', name: 'Tun Mustapha Tower', state: 'Sabah', position: [116.1097, 6.0186], kind: 'cylinder', side: 'right', priority: 3 },
  { id: 'labuan-chimney', name: 'Labuan Chimney', state: 'Labuan', position: [115.2494, 5.3876], kind: 'chimney', side: 'left', priority: 8 },
];

const erl: [number, number][] = [[101.6861, 3.1342], [101.6787, 3.113], [101.7102, 3.0765], [101.721, 3.017],
  [101.6965, 2.977], [101.6703, 2.9316], [101.689, 2.86], [101.7258, 2.8258], [101.738, 2.792], [101.7052, 2.7554], [101.685, 2.744]];
const sabah: [number, number][] = [[116.0606, 5.9473], [116.050, 5.906], [116.045, 5.882], [116.047, 5.827],
  [116.036, 5.780], [116.006, 5.741], [115.943, 5.663], [115.899, 5.607], [115.897, 5.552],
  [115.832, 5.523], [115.817, 5.468], [115.780, 5.395], [115.747, 5.347], [115.758, 5.285],
  [115.789, 5.215], [115.852, 5.178], [115.897, 5.142], [115.938, 5.124]];

// Reference corridors fill geographical gaps without inventing passenger values.
export const CONTEXT_ROUTES: FeatureCollection<LineString> = { type: 'FeatureCollection', features: [
  { name: 'ERL KLIA Ekspres', color: '#8052ad', id: 'erl-express', category: 'ERL', coords: erl, offset: -2,
    url: 'https://www.kliaekspres.com/products-fares/klia-ekspres/' },
  { name: 'ERL KLIA Transit', color: '#079c9e', id: 'erl-transit', category: 'ERL', coords: erl, offset: 2,
    url: 'https://www.kliaekspres.com/products-fares/klia-transit' },
  { name: 'Sabah State Railway', color: '#bc713d', id: 'sabah-rail', category: 'Sabah', coords: sabah, offset: 0,
    url: 'https://railway.sabah.gov.my/untuk-penumpang/laluan-stesen/' },
  { name: 'Penang Hill Railway', color: '#8b9745', id: 'penang-hill', category: 'Funicular',
    coords: [[100.277, 5.4088], [100.269, 5.4145], [100.269, 5.4245]], offset: 0, url: 'https://www.penanghill.gov.my/' },
].map(route => ({ type: 'Feature', properties: { id: route.id, name: route.name, color: route.color,
  category: route.category, laneOffset: route.offset, geometrySource: 'Approximate reference corridor', sourceUrl: route.url },
  geometry: { type: 'LineString', coordinates: route.coords } })) };

export const CONTEXT_STATIONS = [
  ['KL Sentral', 'ERL KLIA Ekspres', 101.6861, 3.1342], ['KLIA Terminal 1', 'ERL KLIA Ekspres', 101.7052, 2.7554], ['KLIA Terminal 2', 'ERL KLIA Ekspres', 101.685, 2.744],
  ['KL Sentral', 'ERL KLIA Transit', 101.6861, 3.1342], ['Bandar Tasik Selatan', 'ERL KLIA Transit', 101.7102, 3.0765],
  ['Putrajaya Sentral', 'ERL KLIA Transit', 101.6703, 2.9316], ['Salak Tinggi', 'ERL KLIA Transit', 101.7258, 2.8258],
  ['KLIA Terminal 1', 'ERL KLIA Transit', 101.7052, 2.7554], ['KLIA Terminal 2', 'ERL KLIA Transit', 101.685, 2.744],
  ['Tanjung Aru', 'Sabah State Railway', 116.0606, 5.9473], ['Putatan', 'Sabah State Railway', 116.050, 5.906],
  ['Kinarut', 'Sabah State Railway', 116.045, 5.827], ['Papar', 'Sabah State Railway', 115.943, 5.663],
  ['Beaufort', 'Sabah State Railway', 115.747, 5.347], ['Tenom', 'Sabah State Railway', 115.938, 5.124],
  ['Penang Hill Lower Station', 'Penang Hill Railway', 100.277, 5.4088], ['Penang Hill Upper Station', 'Penang Hill Railway', 100.269, 5.4245],
].map(([name, line, lng, lat], index) => ({ name: String(name), line: String(line), lng: Number(lng), lat: Number(lat), code: `REF${index}`, source: 'reference' }));
