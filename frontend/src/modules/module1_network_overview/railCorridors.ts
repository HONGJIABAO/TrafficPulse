import stationsData from '../../data/stations.json' with { type: 'json' };

// ── 1. CONFIG: OFFICIAL RAIL LINE COLOURS ────────────────────────────────────
export const LINE_COLORS: Record<string, string> = {
  // Rapid Rail (Klang Valley)
  'LRT Kelana Jaya': '#FF8C00',               // RapidKL Ruby / Dark Orange (Line 5)
  'LRT Ampang': '#FF5A00',                    // Orange (Line 3)
  'LRT Sri Petaling': '#800080',              // Maroon / Plum (Line 4)
  'MRT Kajang': '#008542',                    // Emerald Green (Line 9)
  'MRT Putrajaya': '#FFC400',                 // Gold / Cadmium Yellow (Line 12)
  'KL Monorail': '#84BD00',                   // Lime Green (Line 8)
  'LRT Shah Alam': '#0099DA',                 // Sky Blue (Line 11)
  // KTMB (Malayan Railways)
  'KTM Komuter (Batu Caves Line)': '#003882', // Royal Blue
  'KTM Komuter (Port Klang Line)': '#002654', // Deep Navy
  'KTM East Coast Line': '#0288D1',           // Jungle Railway Cyan Blue
  'KTM Butterworth Branch': '#00A86B',        // Jade Green
  // ETS (Electric Train Service)
  'ETS North-South Trunk': '#F5A623',         // Electric Amber / Gold
};

// ── Complete Rail Corridors ──────────────────────────────────────────────────
interface RailCorridor {
  id: string;
  name: string;
  category: 'Rapid Rail' | 'KTMB' | 'ETS';
  coords: [number, number][];
}

// Helper to extract sequential points from stations.json by line & code prefix
function getSequentialPoints(lineName: string, codePrefix: string): [number, number][] {
  const matched = stationsData.stations.filter(
    (s) => s.line === lineName && s.code.startsWith(codePrefix) && s.lat && s.lng
  );
  matched.sort((a, b) => {
    const numA = parseInt(a.code.replace(/\D/g, '') || '0', 10);
    const numB = parseInt(b.code.replace(/\D/g, '') || '0', 10);
    return numA - numB;
  });
  return matched.map((s) => [s.lat, s.lng] as [number, number]);
}

// Check if a corridor corresponds to a selected rail line filter (exact route names match 1 feature;
// combined official headline names match all member geographical routes).
export function isCorridorMatch(corridorName: string, selectedFilter: string): boolean {
  if (selectedFilter === 'All Lines') return true;
  const c = corridorName.toLowerCase();
  const q = selectedFilter.toLowerCase();
  if (c === q) return true;

  // Individual branch selections must highlight only their exact branch route
  if ([
    'lrt ampang',
    'lrt sri petaling',
    'ktm shuttle tebrau',
    'ktm komuter utara (ipoh)',
    'ktm komuter utara (padang besar)',
    'ktm komuter (seremban line)',
    'ktm komuter (port klang line)',
    'ktm komuter shuttle selatan',
    'ktm ekspres rakyat timuran',
    'ktm intercity shuttle',
    'ktm ets',
  ].includes(q)) {
    return false;
  }

  // Canonical headline combined & aliased service mappings
  if (q === 'lrt ampang–sri petaling' || q === 'lrt ampang-sri petaling') {
    return c === 'lrt ampang' || c === 'lrt sri petaling';
  }
  if (q === 'ktm tebrau shuttle') {
    return c === 'ktm shuttle tebrau';
  }
  if (q === 'ktm komuter utara') {
    return c.startsWith('ktm komuter utara');
  }
  if (q === 'ktm komuter') {
    return c === 'ktm komuter (seremban line)' || c === 'ktm komuter (port klang line)' || c === 'ktm komuter (batu caves line)';
  }
  if (q === 'ktm intercity') {
    return ['ktm intercity shuttle', 'ktm ekspres rakyat timuran', 'ktm komuter shuttle selatan'].includes(c);
  }
  return false;
}

// ── All 12 Peninsular Malaysia & Klang Valley Rail Corridors ─────────────────
export const RAIL_CORRIDORS: RailCorridor[] = [
  // ETS
  {
    id: 'ets_north_south',
    name: 'ETS North-South Trunk',
    category: 'ETS',
    coords: [
      [6.6628, 100.3208], [6.4328, 100.2764], [6.1133, 100.3686], [5.6436, 100.4908],
      [5.4833, 100.4950], [5.3639, 100.4608], [5.2833, 100.4833], [5.1667, 100.4833],
      [5.1250, 100.4889], [5.0111, 100.5333], [4.8889, 100.7222], [4.8519, 100.7308],
      [4.7750, 100.8444], [4.7739, 100.9328], [4.8167, 101.0667], [4.5978, 101.0736],
      [4.4758, 101.0428], [4.3014, 101.1547], [4.1750, 101.1897], [3.9972, 101.3117],
      [3.8333, 101.4000], [3.7431, 101.4489], [3.6811, 101.5208], [3.5658, 101.6583],
      [3.4983, 101.6328], [3.4667, 101.6389], [3.3633, 101.6047], [3.3211, 101.5756],
      [3.2575, 101.5547], [3.2064, 101.5806], [3.2106, 101.6339], [3.2047, 101.6389],
      [3.1869, 101.6644], [3.1656, 101.6914], [3.1550, 101.6933], [3.1397, 101.6936],
      [3.1342, 101.6861], [3.1189, 101.6789], [3.1136, 101.6806], [3.1044, 101.7061],
      [3.0767, 101.7114], [3.0239, 101.7169], [2.9828, 101.7906], [2.9640, 101.7915],
      [2.9328, 101.7828], [2.9028, 101.7872], [2.8367, 101.8197], [2.8028, 101.7997],
      [2.7519, 101.8250], [2.7306, 101.8744], [2.7194, 101.9400], [2.6867, 101.9792],
      [2.6567, 102.0044], [2.5900, 102.0917], [2.4647, 102.2289], [2.4667, 102.4167],
      [2.5833, 102.6167], [2.5100, 102.8180], [2.3850, 103.0200], [2.2967, 103.1283],
      [2.1900, 103.1950], [2.0267, 103.3183], [1.8833, 103.4000], [1.8167, 103.4833],
      [1.6583, 103.6000], [1.6000, 103.6450], [1.5350, 103.7150], [1.4625, 103.7639],
    ],
  },
  // KTMB Lines
  {
    id: 'ktm_butterworth_branch',
    name: 'KTM Butterworth Branch',
    category: 'KTMB',
    coords: [[5.3639, 100.4608], [5.3942, 100.3661]],
  },
  {
    id: 'ktm_east_coast',
    name: 'KTM East Coast Line',
    category: 'KTMB',
    coords: [
      [6.1979, 102.1672], [6.1750, 102.1900], [6.1189, 102.2039], [6.0680, 102.1620],
      [6.0425, 102.1408], [5.9750, 102.1380], [5.9200, 102.1450], [5.8850, 102.1520],
      [5.8083, 102.1472], [5.7500, 102.1500], [5.6889, 102.1500], [5.6200, 102.1800],
      [5.5317, 102.2008], [5.4700, 102.2200], [5.3850, 102.2380], [5.3350, 102.2450],
      [5.3120, 102.2480], [5.2850, 102.2400], [5.3800, 102.0120], [5.3200, 102.0100],
      [5.2600, 102.0000], [5.1600, 102.0500], [5.1450, 102.0400], [5.0400, 102.0500],
      [4.9800, 102.0200], [4.9600, 102.0100], [4.8778, 101.9639], [4.7800, 101.9700],
      [4.6978, 102.0050], [4.6200, 102.0500], [4.5600, 102.0900], [4.4500, 102.0800],
      [4.3800, 102.0500], [4.3200, 102.0200], [4.2300, 101.9800], [4.1847, 102.0478],
      [4.1000, 102.1600], [4.0100, 102.2700], [3.9356, 102.3556], [3.7800, 102.3800],
      [3.7083, 102.3667], [3.4833, 102.3500], [3.3300, 102.4300], [3.2500, 102.4200],
      [3.1300, 102.3700], [2.8078, 102.4069], [2.5833, 102.6167],
    ],
  },
  {
    id: 'ktm_batu_caves',
    name: 'KTM Komuter (Batu Caves Line)',
    category: 'KTMB',
    coords: [
      [3.2372, 101.6819], [3.2150, 101.6719], [3.2033, 101.6783],
      [3.1950, 101.6814], [3.1794, 101.6908], [3.1656, 101.6914],
    ],
  },
  {
    id: 'ktm_port_klang',
    name: 'KTM Komuter (Port Klang Line)',
    category: 'KTMB',
    coords: [
      [3.1342, 101.6861], [3.1189, 101.6739], [3.1128, 101.6719], [3.0989, 101.6681],
      [3.0872, 101.6606], [3.0847, 101.6508], [3.0844, 101.6322], [3.0839, 101.6169],
      [3.0828, 101.6067], [3.0800, 101.5878], [3.0767, 101.5544], [3.0672, 101.5275],
      [3.0539, 101.4917], [3.0456, 101.4700], [3.0431, 101.4503], [3.0400, 101.4339],
      [3.0322, 101.4239], [3.0189, 101.4089], [3.0039, 101.3989], [2.9989, 101.3917],
    ],
  },
  // Rapid Rail Lines
  {
    id: 'lrt_kelana_jaya',
    name: 'LRT Kelana Jaya',
    category: 'Rapid Rail',
    coords: getSequentialPoints('LRT Kelana Jaya', 'KJ'),
  },
  {
    id: 'lrt_ampang',
    name: 'LRT Ampang',
    category: 'Rapid Rail',
    coords: getSequentialPoints('LRT Ampang–Sri Petaling', 'AG'),
  },
  {
    id: 'lrt_sri_petaling',
    name: 'LRT Sri Petaling',
    category: 'Rapid Rail',
    coords: getSequentialPoints('LRT Ampang–Sri Petaling', 'SP'),
  },
  {
    id: 'mrt_kajang',
    name: 'MRT Kajang',
    category: 'Rapid Rail',
    coords: getSequentialPoints('MRT Kajang', 'KG'),
  },
  {
    id: 'mrt_putrajaya',
    name: 'MRT Putrajaya',
    category: 'Rapid Rail',
    coords: getSequentialPoints('MRT Putrajaya', 'PYL'),
  },
  {
    id: 'kl_monorail',
    name: 'KL Monorail',
    category: 'Rapid Rail',
    coords: getSequentialPoints('KL Monorail', 'MR'),
  },
  {
    id: 'lrt_shah_alam',
    name: 'LRT Shah Alam',
    category: 'Rapid Rail',
    coords: getSequentialPoints('LRT Shah Alam', 'SA'),
  },
];

