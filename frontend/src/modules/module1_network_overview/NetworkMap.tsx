import { useEffect, useState, useMemo } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import stationsData from '@/data/stations.json';
import type { MapOverlay } from './NetworkOverview';

interface MonthlyTrend {
  year_month: string;
  total: number;
  lines: Record<string, number>;
}

interface Props {
  selectedLine: string;
  selectedStation: string;
  activeOverlay: MapOverlay;
  playbackMonth: string;
  monthly_trend: MonthlyTrend[];
  onResetFocus?: () => void;
  onSelectStation?: (name: string, line?: string) => void;
}

// ── Complete Rail Corridors ──────────────────────────────────────────────────
interface RailCorridor {
  id: string;
  name: string;
  category: 'KTMB' | 'Rapid Rail' | 'ETS';
  accentColor: string;
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

// ── Line Accent Colors ──────────────────────────────────────────────────────
const LINE_ACCENT_COLORS: Record<string, string> = {
  'KL Monorail': '#FFB300',
  'LRT Kelana Jaya': '#FF8C00',
  'LRT Ampang–Sri Petaling': '#FF5A00',
  'LRT Shah Alam': '#00BCD4',
  'MRT Kajang': '#00C48C',
  'MRT Putrajaya': '#7B61FF',
  'KTM Komuter': '#0066FF',
  'KTM Intercity': '#0066FF',
};

// Check if a corridor corresponds to a selected rail line
function isCorridorMatch(corridorId: string, line: string): boolean {
  if (line === 'All Lines') return true;
  switch (line) {
    case 'KL Monorail':
      return corridorId === 'kl_monorail';
    case 'LRT Kelana Jaya':
      return corridorId === 'lrt_kelana_jaya';
    case 'LRT Ampang–Sri Petaling':
      return corridorId === 'lrt_ampang' || corridorId === 'lrt_sri_petaling';
    case 'LRT Shah Alam':
      return corridorId === 'lrt_shah_alam';
    case 'MRT Kajang':
      return corridorId === 'mrt_kajang';
    case 'MRT Putrajaya':
      return corridorId === 'mrt_putrajaya';
    case 'KTM Komuter':
      return (
        corridorId === 'ktm_batu_caves' ||
        corridorId === 'ktm_port_klang' ||
        corridorId === 'ets_north_south' ||
        corridorId === 'ktm_butterworth_branch'
      );
    case 'KTM Intercity':
      return corridorId === 'ktm_east_coast' || corridorId === 'ets_north_south';
    default:
      return corridorId.toLowerCase().includes(line.toLowerCase());
  }
}

// ── All 12 Peninsular Malaysia & Klang Valley Rail Corridors ─────────────────
const RAIL_CORRIDORS: RailCorridor[] = [
  // 1. ETS / KTM North-South Main Line (Padang Besar down to JB Sentral)
  {
    id: 'ets_north_south',
    name: 'ETS / KTM North-South Trunk',
    category: 'ETS',
    accentColor: '#00E5A3',
    coords: [
      [6.6628, 100.3208], // Padang Besar
      [6.4328, 100.2764], // Arau
      [6.1133, 100.3686], // Alor Setar
      [5.6436, 100.4908], // Sungai Petani
      [5.4833, 100.495],  // Tasek Gelugor
      [5.3639, 100.4608], // Bukit Mertajam
      [5.2833, 100.4833], // Simpang Ampat
      [5.1667, 100.4833], // Nibong Tebal
      [5.125, 100.4889],  // Parit Buntar
      [5.0111, 100.5333], // Bagan Serai
      [4.8889, 100.7222], // Kamunting
      [4.8519, 100.7308], // Taiping
      [4.775, 100.8444],  // Padang Rengas
      [4.7739, 100.9328], // Kuala Kangsar
      [4.8167, 101.0667], // Sungai Siput
      [4.5978, 101.0736], // Ipoh
      [4.4758, 101.0428], // Batu Gajah
      [4.3014, 101.1547], // Kampar
      [4.175, 101.1897],  // Tapah Road
      [3.9972, 101.3117], // Sungkai
      [3.8333, 101.4],    // Slim River
      [3.7431, 101.4489], // Behrang
      [3.6811, 101.5208], // Tanjong Malim
      [3.5658, 101.6583], // Kuala Kubu Bharu
      [3.4983, 101.6328], // Rasa
      [3.4667, 101.6389], // Batang Kali
      [3.3633, 101.6047], // Serendah
      [3.3211, 101.5756], // Rawang
      [3.2575, 101.5547], // Kuang
      [3.2064, 101.5806], // Sungai Buloh
      [3.2106, 101.6339], // Kepong Sentral
      [3.2047, 101.6389], // Kepong
      [3.1869, 101.6644], // Segambut
      [3.1656, 101.6914], // Putra
      [3.155, 101.6933],  // Bank Negara
      [3.1397, 101.6936], // Kuala Lumpur
      [3.1342, 101.6861], // KL Sentral
      [3.1189, 101.6789], // Midvalley
      [3.1136, 101.6806], // Seputeh
      [3.1044, 101.7061], // Salak Selatan
      [3.0767, 101.7114], // Bandar Tasik Selatan
      [3.0239, 101.7169], // Serdang
      [2.9828, 101.7906], // Kajang
      [2.964, 101.7915],  // Kajang 2
      [2.9328, 101.7828], // UKM
      [2.9028, 101.7872], // Bangi
      [2.8367, 101.8197], // Batang Benar
      [2.8028, 101.7997], // Nilai
      [2.7519, 101.825],  // Labu
      [2.7306, 101.8744], // Tiroi
      [2.7194, 101.94],   // Seremban
      [2.6867, 101.9792], // Senawang
      [2.6567, 102.0044], // Sungai Gadut
      [2.59, 102.0917],   // Rembau
      [2.4647, 102.2289], // Pulau Sebang (Tampin)
      [2.4667, 102.4167], // Batang Melaka
      [2.5833, 102.6167], // Gemas
      [2.51, 102.818],    // Segamat
      [2.385, 103.02],    // Labis
      [2.2967, 103.1283], // Bekok
      [2.19, 103.195],    // Paloh
      [2.0267, 103.3183], // Kluang
      [1.8833, 103.4],    // Rengam
      [1.8167, 103.4833], // Layang-Layang
      [1.6583, 103.6],    // Kulai
      [1.6, 103.645],     // Senai
      [1.535, 103.715],   // Kempas Baru
      [1.4625, 103.7639], // JB Sentral
    ],
  },
  // 2. KTM Butterworth Branch
  {
    id: 'ktm_butterworth_branch',
    name: 'KTM Butterworth Branch',
    category: 'ETS',
    accentColor: '#00E5A3',
    coords: [
      [5.3639, 100.4608], // Bukit Mertajam
      [5.3942, 100.3661], // Butterworth
    ],
  },
  // 3. KTM East Coast Jungle Railway (Tumpat ➔ Gemas)
  {
    id: 'ktm_east_coast',
    name: 'KTM East Coast Line (Jungle Railway)',
    category: 'KTMB',
    accentColor: '#0066FF',
    coords: [
      [6.1979, 102.1672], // Tumpat
      [6.175, 102.19],    // Kampung Kok Pasir
      [6.1189, 102.2039], // Wakaf Bharu
      [6.068, 102.162],   // Bunut Susu
      [6.0425, 102.1408], // Pasir Mas
      [5.975, 102.138],   // To Uban
      [5.92, 102.145],    // Sungai Keladi
      [5.885, 102.152],   // Bukit Panau
      [5.8083, 102.1472], // Tanah Merah
      [5.75, 102.15],     // Kampung Berkam
      [5.6889, 102.15],   // Temangan
      [5.62, 102.18],     // Sungai Nal
      [5.5317, 102.2008], // Krai
      [5.47, 102.22],     // Pahi
      [5.385, 102.238],   // Manek Urai
      [5.335, 102.245],   // Kampung Baru Bukit Abu
      [5.312, 102.248],   // Bukit Abu
      [5.285, 102.24],    // Kuala Gris
      [5.38, 102.012],    // Dabong
      [5.32, 102.01],     // Kemubu
      [5.26, 102.0],      // Sri Bintang
      [5.16, 102.05],     // Bertam
      [5.145, 102.04],    // Bertam Baru
      [5.04, 102.05],     // Limau Kasturi
      [4.98, 102.02],     // Sungai Sirian
      [4.96, 102.01],     // Kampung Sirian
      [4.8778, 101.9639], // Gua Musang
      [4.78, 101.97],     // Mentara Baru
      [4.6978, 102.005],  // Merapoh
      [4.62, 102.05],     // Teluk Gunung
      [4.56, 102.09],     // Sungai Tasin
      [4.45, 102.08],     // Chegar Perah
      [4.38, 102.05],     // Aur Gading
      [4.32, 102.02],     // Bukit Betong
      [4.23, 101.98],     // Padang Tungku
      [4.1847, 102.0478], // Kuala Lipis
      [4.1, 102.16],      // Kerambit
      [4.01, 102.27],     // Mela
      [3.9356, 102.3556], // Jerantut
      [3.78, 102.38],     // Jenderak
      [3.7083, 102.3667], // Kuala Krau
      [3.4833, 102.35],   // Mentakab
      [3.33, 102.43],     // Mengkarak
      [3.25, 102.42],     // Triang
      [3.13, 102.37],     // Kemayan
      [2.8078, 102.4069], // Bahau
      [2.5833, 102.6167], // Gemas
    ],
  },
  // 4. KTM Komuter Batu Caves Line
  {
    id: 'ktm_batu_caves',
    name: 'KTM Komuter (Batu Caves Line)',
    category: 'KTMB',
    accentColor: '#0066FF',
    coords: [
      [3.2372, 101.6819], // Batu Caves
      [3.215, 101.6719],  // Taman Wahyu
      [3.2033, 101.6783], // Kampung Batu
      [3.195, 101.6814],  // Batu Kentonmen
      [3.1794, 101.6908], // Sentul
      [3.1656, 101.6914], // Putra
    ],
  },
  // 5. KTM Komuter Port Klang Line
  {
    id: 'ktm_port_klang',
    name: 'KTM Komuter (Port Klang Line)',
    category: 'KTMB',
    accentColor: '#0066FF',
    coords: [
      [3.1342, 101.6861], // KL Sentral
      [3.1189, 101.6739], // Abdullah Hukum
      [3.1128, 101.6719], // Angkasapuri
      [3.0989, 101.6681], // Pantai Dalam
      [3.0872, 101.6606], // Petaling
      [3.0847, 101.6508], // Jalan Templer
      [3.0844, 101.6322], // Kampung Dato Harun
      [3.0839, 101.6169], // Seri Setia
      [3.0828, 101.6067], // Setia Jaya
      [3.08, 101.5878],   // Subang Jaya
      [3.0767, 101.5544], // Batu Tiga
      [3.0672, 101.5275], // Shah Alam
      [3.0539, 101.4917], // Padang Jawa
      [3.0456, 101.47],   // Bukit Badak
      [3.0431, 101.4503], // Klang
      [3.04, 101.4339],   // Telok Pulai
      [3.0322, 101.4239], // Telok Gadong
      [3.0189, 101.4089], // Kampung Raja Uda
      [3.0039, 101.3989], // Jalan Kastam
      [2.9989, 101.3917], // Pelabuhan Klang Selatan
    ],
  },
  // 6. LRT Kelana Jaya Line (KJ01 - KJ37)
  {
    id: 'lrt_kelana_jaya',
    name: 'LRT Kelana Jaya Line',
    category: 'Rapid Rail',
    accentColor: '#FF8C00',
    coords: getSequentialPoints('LRT Kelana Jaya', 'KJ'),
  },
  // 7. LRT Ampang Line (AG01 - AG18)
  {
    id: 'lrt_ampang',
    name: 'LRT Ampang Line',
    category: 'Rapid Rail',
    accentColor: '#FF5A00',
    coords: getSequentialPoints('LRT Ampang–Sri Petaling', 'AG'),
  },
  // 8. LRT Sri Petaling Line (SP01 - SP31)
  {
    id: 'lrt_sri_petaling',
    name: 'LRT Sri Petaling Line',
    category: 'Rapid Rail',
    accentColor: '#FF5A00',
    coords: getSequentialPoints('LRT Ampang–Sri Petaling', 'SP'),
  },
  // 9. MRT Kajang Line (KG04 - KG35)
  {
    id: 'mrt_kajang',
    name: 'MRT Kajang Line',
    category: 'Rapid Rail',
    accentColor: '#00C48C',
    coords: getSequentialPoints('MRT Kajang', 'KG'),
  },
  // 10. MRT Putrajaya Line (PYL01 - PYL41)
  {
    id: 'mrt_putrajaya',
    name: 'MRT Putrajaya Line',
    category: 'Rapid Rail',
    accentColor: '#7B61FF',
    coords: getSequentialPoints('MRT Putrajaya', 'PYL'),
  },
  // 11. KL Monorail Line (MR01 - MR11)
  {
    id: 'kl_monorail',
    name: 'KL Monorail',
    category: 'Rapid Rail',
    accentColor: '#FFB300',
    coords: getSequentialPoints('KL Monorail', 'MR'),
  },
  // 12. LRT Shah Alam Line (SA01 - SA26)
  {
    id: 'lrt_shah_alam',
    name: 'LRT Shah Alam Line',
    category: 'Rapid Rail',
    accentColor: '#00BCD4',
    coords: getSequentialPoints('LRT Shah Alam', 'SA'),
  },
];

// Major hub stations that receive an accent color pip
const MAJOR_HUBS = new Set([
  'KL Sentral',
  'Masjid Jamek',
  'Pasar Seni',
  'Tun Razak Exchange',
  'Titiwangsa',
  'Hang Tuah',
  'Chan Sow Lin',
  'Bandar Tasik Selatan',
  'Bandar Tasek Selatan',
  'Putrajaya Sentral',
  'Butterworth',
  'Gemas',
  'JB Sentral',
  'Ipoh',
  'Alor Setar',
  'Padang Besar',
  'Tumpat',
  'Gua Musang',
]);

// ── Component: Auto-focus & Zoom Map to Station or Line on Apply ─────────────
function MapAutoFocuser({
  selectedLine,
  selectedStation,
}: {
  selectedLine: string;
  selectedStation: string;
}) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();

    // 1. Station takes top priority: zoom right into the station
    if (selectedStation !== 'All Stations') {
      const target =
        stationsData.stations.find(
          (s) =>
            s.name === selectedStation &&
            (selectedLine === 'All Lines' || s.line === selectedLine)
        ) || stationsData.stations.find((s) => s.name === selectedStation);

      if (target && target.lat && target.lng) {
        map.flyTo([target.lat, target.lng], 15, {
          duration: 1.2,
          easeLinearity: 0.25,
        });
      }
      return;
    }

    // 2. Rail Line selected: fly to bounding box of all stations on this line
    if (selectedLine !== 'All Lines') {
      const lineStations = stationsData.stations.filter(
        (s) => s.line === selectedLine && s.lat && s.lng
      );
      if (lineStations.length > 0) {
        const lats = lineStations.map((s) => s.lat);
        const lngs = lineStations.map((s) => s.lng);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);

        const maxZoom = selectedLine === 'KL Monorail' ? 14.5 : 13;
        map.flyToBounds(
          [
            [minLat, minLng],
            [maxLat, maxLng],
          ],
          {
            padding: [50, 50],
            maxZoom,
            duration: 1.2,
          }
        );
      }
      return;
    }

    // 3. Reset to full Peninsular Malaysia view
    map.flyTo([4.15, 102.15], 7, {
      duration: 1.0,
    });
  }, [selectedLine, selectedStation, map]);

  return null;
}

// ── Component: Track zoom level for zoom-dependent node radius ───────────────
function ZoomHandler({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => {
      onZoomChange(map.getZoom());
    },
  });
  useEffect(() => {
    onZoomChange(map.getZoom());
  }, [map, onZoomChange]);
  return null;
}

export function NetworkMap({
  selectedLine,
  selectedStation,
  activeOverlay,
  playbackMonth,
  monthly_trend,
  onResetFocus,
  onSelectStation,
}: Props) {
  const [currentZoom, setCurrentZoom] = useState<number>(7);
  const monthData = monthly_trend.find((m) => m.year_month === playbackMonth);

  // Dynamic node radius based on zoom level:
  // zoomed out (zoom <= 7): 2.5px -> prevents Klang Valley from turning into a blob
  // medium zoom (8-10): 3.2px
  // close-in (>= 11): 5px
  const nodeRadius = useMemo(() => {
    if (currentZoom <= 7) return 2.5;
    if (currentZoom <= 9) return 3.2;
    if (currentZoom <= 11) return 4.2;
    return 5.5;
  }, [currentZoom]);

  // Lookup the selected station object if any
  const selectedStationObj = useMemo(() => {
    if (selectedStation === 'All Stations') return null;
    return (
      stationsData.stations.find(
        (s) =>
          s.name === selectedStation &&
          (selectedLine === 'All Lines' || s.line === selectedLine)
      ) || stationsData.stations.find((s) => s.name === selectedStation) || null
    );
  }, [selectedStation, selectedLine]);

  const isFilterActive = selectedLine !== 'All Lines' || selectedStation !== 'All Stations';

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#DDE9F6',
      }}
    >
      <MapContainer
        center={[4.15, 102.15]}
        zoom={7}
        minZoom={5}
        maxZoom={18}
        style={{ width: '100%', height: '100%', borderRadius: 12 }}
        zoomControl={true}
      >
        {/* Clean Light Basemap (Esri World Light Gray Canvas) */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="&copy; Esri, DeLorme, NAVTEQ"
          maxZoom={16}
        />

        {/* Dynamic Zoom Tracker & Auto Focuser */}
        <ZoomHandler onZoomChange={setCurrentZoom} />
        <MapAutoFocuser selectedLine={selectedLine} selectedStation={selectedStation} />

        {/* ── 1. RAIL NETWORK POLYLINES: Dual-Stroke Casing (Dark Navy + White Halo) ── */}
        {/* Layer A: White Underlayer Casing */}
        {RAIL_CORRIDORS.map((corridor) => {
          const isMatch = isCorridorMatch(corridor.id, selectedLine);
          const isLineActive = selectedLine !== 'All Lines';

          return (
            <Polyline
              key={`casing-${corridor.id}`}
              positions={corridor.coords}
              pathOptions={{
                color: '#FFFFFF',
                weight: isLineActive ? (isMatch ? 6.5 : 2) : 4.5,
                opacity: isLineActive ? (isMatch ? 1 : 0.2) : 0.9,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          );
        })}

        {/* Layer B: Main Colored / Navy Stroke */}
        {RAIL_CORRIDORS.map((corridor) => {
          const isMatch = isCorridorMatch(corridor.id, selectedLine);
          const isLineActive = selectedLine !== 'All Lines';

          const strokeColor = isLineActive
            ? isMatch
              ? (LINE_ACCENT_COLORS[selectedLine] || corridor.accentColor)
              : '#94A3B8'
            : '#0F2038';

          const strokeWidth = isLineActive ? (isMatch ? 4.5 : 1.5) : 2;
          const strokeOpacity = isLineActive ? (isMatch ? 1.0 : 0.2) : 0.88;

          return (
            <Polyline
              key={`line-${corridor.id}`}
              positions={corridor.coords}
              pathOptions={{
                color: strokeColor,
                weight: strokeWidth,
                opacity: strokeOpacity,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            >
              <Tooltip sticky>
                <div style={{ padding: '2px 4px', fontSize: 11 }}>
                  <div style={{ fontWeight: 700, color: '#0F1E36' }}>{corridor.name}</div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>
                    Category: <strong>{corridor.category}</strong>
                  </div>
                </div>
              </Tooltip>
            </Polyline>
          );
        })}

        {/* ── 2. HEATMAP OVERLAY LAYER (When Heatmap button is active) ── */}
        {activeOverlay === 'heatmap' &&
          stationsData.stations.map((station) => {
            if (!station.lat || !station.lng) return null;
            const isMajor = MAJOR_HUBS.has(station.name);
            const heatRadius = isMajor ? (currentZoom >= 10 ? 28 : 18) : (currentZoom >= 10 ? 16 : 9);

            return (
              <CircleMarker
                key={`heat-${station.code}-${station.name}`}
                center={[station.lat, station.lng]}
                radius={heatRadius}
                pathOptions={{
                  fillColor: '#FF5A00',
                  color: '#FF2E00',
                  weight: 0,
                  fillOpacity: isMajor ? 0.38 : 0.22,
                }}
              />
            );
          })}

        {/* ── 3. STATION NODES: White fill, dark navy rim, radius 2.5–5.5px ── */}
        {stationsData.stations.map((station) => {
          if (!station.lat || !station.lng) return null;

          const isSelected =
            selectedStationObj &&
            selectedStationObj.name === station.name &&
            selectedStationObj.line === station.line;

          // If this is the explicitly selected station, render it separately with the beacon
          if (isSelected) return null;

          const isLineActive = selectedLine !== 'All Lines';
          const isLineMatch = !isLineActive || station.line === selectedLine;
          const isMajor = MAJOR_HUBS.has(station.name);

          const category =
            station.line.includes('ETS')
              ? 'ETS'
              : station.source === 'komuter' || station.source === 'intercity' || station.line.includes('KTM')
              ? 'KTMB'
              : 'Rapid Rail';

          const accentColor =
            LINE_ACCENT_COLORS[station.line] ||
            (category === 'KTMB' ? '#0066FF' : category === 'ETS' ? '#00E5A3' : '#FF8C00');

          const radius = isLineActive
            ? isLineMatch
              ? (currentZoom >= 11 ? 5.5 : 4)
              : 2
            : isMajor
            ? nodeRadius + 1.2
            : nodeRadius;

          const strokeColor = isLineActive
            ? isLineMatch
              ? accentColor
              : '#CBD5E1'
            : isMajor
            ? accentColor
            : '#0F2038';

          const strokeWidth = isLineActive ? (isLineMatch ? 2.5 : 1) : isMajor ? 2 : 1.5;
          const opacity = isLineActive ? (isLineMatch ? 1 : 0.15) : 0.95;

          return (
            <CircleMarker
              key={`node-${station.code}-${station.name}-${station.line}`}
              center={[station.lat, station.lng]}
              radius={radius}
              pathOptions={{
                fillColor: '#FFFFFF',
                color: strokeColor,
                weight: strokeWidth,
                fillOpacity: opacity,
                opacity: opacity,
              }}
              eventHandlers={{
                click: () => {
                  if (onSelectStation) {
                    onSelectStation(station.name, station.line);
                  }
                },
              }}
            >
              {/* Permanent Station Labels in Station View or Line focus */}
              {(activeOverlay === 'station' || (isLineActive && isLineMatch && currentZoom >= 11)) && (
                <Tooltip permanent direction="top" offset={[0, -radius]}>
                  <span style={{ fontSize: 9.5, fontWeight: 600, color: '#0F1E36' }}>
                    {station.name}
                  </span>
                </Tooltip>
              )}

              {/* Standard Hover Tooltip */}
              {activeOverlay !== 'station' && !(isLineActive && isLineMatch && currentZoom >= 11) && (
                <Tooltip>
                  <div style={{ padding: '3px 5px', minWidth: 120 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#0F1E36' }}>
                      {station.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#0066FF', fontWeight: 600, marginTop: 1 }}>
                      {station.line} ({station.code})
                    </div>
                    <div style={{ fontSize: 9.5, color: '#64748B', marginTop: 2 }}>
                      Service: <strong>{category}</strong>
                    </div>
                    {monthData && (
                      <div style={{ fontSize: 9.5, color: '#00C48C', marginTop: 3 }}>
                        Monthly Trips: {(monthData.total / 1e6).toFixed(1)}M
                      </div>
                    )}
                  </div>
                </Tooltip>
              )}
            </CircleMarker>
          );
        })}

        {/* ── 4. SELECTED STATION BEACON & PERMANENT POPUP (When station is filtered) ── */}
        {selectedStationObj && selectedStationObj.lat && selectedStationObj.lng && (
          <>
            {/* Outer glowing pulsing ring 1 */}
            <CircleMarker
              center={[selectedStationObj.lat, selectedStationObj.lng]}
              radius={26}
              pathOptions={{
                fillColor: '#0066FF',
                color: '#0066FF',
                weight: 1.5,
                fillOpacity: 0.18,
                opacity: 0.5,
              }}
            />
            {/* Outer glowing pulsing ring 2 */}
            <CircleMarker
              center={[selectedStationObj.lat, selectedStationObj.lng]}
              radius={15}
              pathOptions={{
                fillColor: '#0066FF',
                color: '#0066FF',
                weight: 2,
                fillOpacity: 0.4,
                opacity: 0.85,
              }}
            />
            {/* Inner prominent node */}
            <CircleMarker
              center={[selectedStationObj.lat, selectedStationObj.lng]}
              radius={8}
              pathOptions={{
                fillColor: '#0066FF',
                color: '#FFFFFF',
                weight: 3,
                fillOpacity: 1,
                opacity: 1,
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -14]}>
                <div style={{ padding: '4px 8px', textAlign: 'center', minWidth: 130 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#0F1E36' }}>
                    📍 {selectedStationObj.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#0066FF', fontWeight: 700, marginTop: 2 }}>
                    {selectedStationObj.line}
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B' }}>
                    Code: <strong>{selectedStationObj.code}</strong>
                  </div>
                  {monthData && (
                    <div style={{ fontSize: 9.5, color: '#00C48C', marginTop: 3 }}>
                      Network: {(monthData.total / 1e6).toFixed(1)}M trips
                    </div>
                  )}
                </div>
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>

      {/* ── Soft Ice-Blue / Cyber Frost Tint Overlay (Recreates Image 1's land aesthetic) ── */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(215, 230, 248, 0.38)',
          mixBlendMode: 'multiply',
          pointerEvents: 'none',
          zIndex: 400,
          borderRadius: 12,
        }}
      />

      {/* ── Floating Focus Banner (When a line or station is selected) ── */}
      {isFilterActive && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 54,
            zIndex: 1000,
            background: 'rgba(15, 30, 54, 0.94)',
            backdropFilter: 'blur(10px)',
            color: '#FFFFFF',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 16px rgba(0, 102, 255, 0.28)',
            border: '1px solid rgba(0, 102, 255, 0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>🎯</span>
            <span>
              Focused:{' '}
              <strong style={{ color: '#00E5A3' }}>
                {selectedStation !== 'All Stations' ? selectedStation : selectedLine}
              </strong>
            </span>
            {selectedStation !== 'All Stations' && (
              <span style={{ fontSize: 11, color: '#94A3B8' }}>({selectedLine})</span>
            )}
          </div>
          {onResetFocus && (
            <button
              onClick={onResetFocus}
              style={{
                background: 'rgba(255, 255, 255, 0.18)',
                border: 'none',
                color: '#FFF',
                borderRadius: 5,
                padding: '2px 8px',
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title="Reset View to All Lines"
            >
              Reset ✕
            </button>
          )}
        </div>
      )}

      {/* ── Top-Right Map Legend Badges (KTMB, Rapid Rail, ETS) ── */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 76,
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0, 102, 255, 0.12)',
          borderRadius: 10,
          padding: '8px 14px',
          fontSize: 11,
          zIndex: 1000,
          boxShadow: '0 2px 10px rgba(15, 30, 54, 0.08)',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#0066FF',
              boxShadow: '0 0 6px rgba(0, 102, 255, 0.5)',
            }}
          />
          <span style={{ fontWeight: 600, color: '#0F1E36', fontSize: 11 }}>KTMB</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#FF8C00',
              boxShadow: '0 0 6px rgba(255, 140, 0, 0.5)',
            }}
          />
          <span style={{ fontWeight: 600, color: '#0F1E36', fontSize: 11 }}>Rapid Rail</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#00E5A3',
              boxShadow: '0 0 6px rgba(0, 229, 163, 0.5)',
            }}
          />
          <span style={{ fontWeight: 600, color: '#0F1E36', fontSize: 11 }}>ETS</span>
        </div>
      </div>

      {/* ── Mode Pill Notification ── */}
      {activeOverlay !== 'map' && (
        <div
          style={{
            position: 'absolute',
            bottom: 16,
            left: 16,
            zIndex: 1000,
            background: 'rgba(15, 30, 54, 0.88)',
            backdropFilter: 'blur(8px)',
            color: '#FFFFFF',
            borderRadius: 20,
            padding: '6px 14px',
            fontSize: 11,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.25)',
          }}
        >
          <span>
            Active View: <strong>{activeOverlay === 'station' ? 'STATION LABELS' : activeOverlay.toUpperCase()}</strong>
          </span>
          <span style={{ color: '#00E5A3' }}>● Live</span>
        </div>
      )}
    </div>
  );
}

export default NetworkMap;
