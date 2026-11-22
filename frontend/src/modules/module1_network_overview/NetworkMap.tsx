import { useEffect, useState, useMemo, useRef } from 'react';
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
import stationMonthlyData from '@/data/station_monthly_ridership.json';
import type { MapOverlay } from './NetworkOverview';

// ── 1. CONFIG: OFFICIAL RAIL LINE COLOURS ────────────────────────────────────
// Editable line colours across all Malaysian rail services
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

// ── Geographic Bounding Boxes ────────────────────────────────────────────────
const KLANG_VALLEY_BOUNDS: [[number, number], [number, number]] = [
  [2.92, 101.38],
  [3.28, 101.78],
];

const PENINSULAR_BOUNDS: [[number, number], [number, number]] = [
  [1.35, 100.10],
  [6.78, 103.85],
];

const MALAYSIA_MAX_BOUNDS: [[number, number], [number, number]] = [
  [0.8, 98.8],
  [7.5, 105.0],
];

const GLOBAL_MAX_STATION_RIDERSHIP = stationMonthlyData.global_max_ridership || 1615488;

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

// Check if a corridor corresponds to a selected rail line filter
function isCorridorMatch(corridorName: string, selectedFilter: string): boolean {
  if (selectedFilter === 'All Lines') return true;
  const c = corridorName.toLowerCase();
  const q = selectedFilter.toLowerCase();
  if (q.includes('kelana jaya') && c.includes('kelana jaya')) return true;
  if (q.includes('ampang') && (c.includes('ampang') || c.includes('sri petaling'))) return true;
  if (q.includes('kajang') && c.includes('kajang')) return true;
  if (q.includes('putrajaya') && c.includes('putrajaya')) return true;
  if (q.includes('monorail') && c.includes('monorail')) return true;
  if (q.includes('shah alam') && c.includes('shah alam')) return true;
  if (q.includes('komuter') && c.includes('komuter')) return true;
  if (q.includes('intercity') && (c.includes('east coast') || c.includes('trunk'))) return true;
  return c.includes(q) || q.includes(c);
}

// ── All 12 Peninsular Malaysia & Klang Valley Rail Corridors ─────────────────
const RAIL_CORRIDORS: RailCorridor[] = [
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

// Helper to look up station ridership & yoy for a given month
function getStationData(
  station: (typeof stationsData.stations)[0],
  ym: string
): { ridership: number | null; yoy: number | null } {
  const monthRecord = stationMonthlyData.ridership_by_month[ym];
  if (!monthRecord) return { ridership: null, yoy: null };

  let key = '';
  if (station.source === 'rapidrail') key = 'code_' + station.code;
  else if (station.source === 'komuter') key = 'kom_' + station.name;
  else key = 'ic_' + station.name;

  const ridership = monthRecord[key] ?? null;
  const yoy = stationMonthlyData.yoy_by_month[ym]?.[key] ?? null;
  return { ridership, yoy };
}

// ── Square-root Radius Sizing (min 3px, max 14px) ────────────────────────────
function getStationRadius(ridership: number | null): number {
  if (!ridership || ridership <= 0) return 3.0; // small neutral node
  const ratio = Math.sqrt(ridership) / Math.sqrt(GLOBAL_MAX_STATION_RIDERSHIP);
  return Math.min(14, Math.max(3.5, 3.0 + ratio * 11.0));
}

// ── Soft Blue/Teal Sequential Gradient ───────────────────────────────────────
function getStationFillColor(ridership: number | null): string {
  if (!ridership || ridership <= 0) return '#CBD5E1'; // Neutral light grey
  const ratio = Math.sqrt(ridership) / Math.sqrt(GLOBAL_MAX_STATION_RIDERSHIP);
  if (ratio < 0.12) return '#D5EAF8'; // pale ice blue
  if (ratio < 0.25) return '#A5D5F2'; // soft sky blue
  if (ratio < 0.40) return '#62BAE8'; // cerulean
  if (ratio < 0.60) return '#2397D6'; // deep cyan blue
  if (ratio < 0.80) return '#0E73B9'; // dark blue
  return '#084882';                   // deep navy blue
}

// ── Map View Controller (Auto-focus & Bounds Sync) ───────────────────────────
function MapViewController({
  selectedLine,
  selectedStation,
  viewScope,
}: {
  selectedLine: string;
  selectedStation: string;
  viewScope: 'klang_valley' | 'peninsular';
}) {
  const map = useMap();
  const hasMountedRef = useRef(false);

  useEffect(() => {
    map.invalidateSize();

    // 1. Station has highest priority: fly to exact station coordinates (Zoom 15)
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

    // 2. Line selected: fly to line bounding box
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
            padding: [45, 45],
            maxZoom,
            duration: 1.2,
          }
        );
      }
      return;
    }

    // 3. Normal / Reset view: follow viewScope toggle ("Klang Valley" or "Peninsular")
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      // On load: fit bounds to Klang Valley (default) so rail network fills frame
      map.fitBounds(KLANG_VALLEY_BOUNDS, { padding: [30, 30] });
    } else {
      if (viewScope === 'klang_valley') {
        map.flyToBounds(KLANG_VALLEY_BOUNDS, { padding: [30, 30], duration: 1.1 });
      } else {
        map.flyToBounds(PENINSULAR_BOUNDS, { padding: [30, 30], duration: 1.2 });
      }
    }
  }, [selectedLine, selectedStation, viewScope, map]);

  return null;
}

// ── Track Zoom Level ────────────────────────────────────────────────────────
function ZoomTracker({ onZoomChange }: { onZoomChange: (z: number) => void }) {
  const map = useMapEvents({
    zoomend: () => onZoomChange(map.getZoom()),
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
  const [currentZoom, setCurrentZoom] = useState<number>(11);
  const [viewScope, setViewScope] = useState<'klang_valley' | 'peninsular'>('klang_valley');
  const [legendOpen, setLegendOpen] = useState<boolean>(true);

  const monthData = monthly_trend.find((m) => m.year_month === playbackMonth);

  // Maximum network ridership across all months (for line fading during low-ridership periods like 2020 COVID)
  const maxNetworkTotal = useMemo(() => {
    return Math.max(...monthly_trend.map((m) => m.total), 33000000);
  }, [monthly_trend]);

  const currentTotal = monthData?.total || 0;
  const networkRatio = maxNetworkTotal > 0 ? currentTotal / maxNetworkTotal : 1;
  // Dynamic line opacity: drops to ~0.35 during 2020 COVID MCO (faded network), brightens to ~0.90 at peak
  const dynamicLineOpacity = Math.min(0.92, Math.max(0.32, 0.32 + 0.58 * networkRatio));

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

  // ── Z-INDEX DRAWING ORDER: Draw smaller stations on top of bigger ones ─────
  // In Leaflet SVG DOM, later elements render on top of earlier ones.
  // Sorting DESCENDING by ridership ensures big circles are drawn first (at bottom),
  // and small/neutral circles are drawn last (on top)!
  const sortedStations = useMemo(() => {
    return [...stationsData.stations].sort((a, b) => {
      const { ridership: rA } = getStationData(a, playbackMonth);
      const { ridership: rB } = getStationData(b, playbackMonth);
      return (rB || 0) - (rA || 0);
    });
  }, [playbackMonth]);

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
      {/* Smooth CSS transition for circle radius and fill on timeline playback */}
      <style>{`
        .leaflet-interactive {
          transition: r 300ms ease, fill 300ms ease, opacity 300ms ease, stroke-width 300ms ease;
        }
      `}</style>

      <MapContainer
        bounds={KLANG_VALLEY_BOUNDS}
        minZoom={6}
        maxZoom={18}
        maxBounds={MALAYSIA_MAX_BOUNDS}
        maxBoundsViscosity={1.0}
        style={{ width: '100%', height: '100%', borderRadius: 12 }}
        zoomControl={true}
      >
        {/* Clean Light Basemap (Esri World Light Gray Canvas) */}
        <TileLayer
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="&copy; Esri, DeLorme, NAVTEQ"
          maxZoom={16}
        />

        {/* View Bounds & Zoom Controllers */}
        <ZoomTracker onZoomChange={setCurrentZoom} />
        <MapViewController
          selectedLine={selectedLine}
          selectedStation={selectedStation}
          viewScope={viewScope}
        />

        {/* ── 1. RAIL NETWORK POLYLINES: Dual-Stroke Casing (White Underlayer + Official Line Color) ── */}
        {/* Layer A: White Underlayer Casing (3.5px) */}
        {RAIL_CORRIDORS.map((corridor) => {
          const isMatch = isCorridorMatch(corridor.name, selectedLine);
          const isLineActive = selectedLine !== 'All Lines';

          return (
            <Polyline
              key={`casing-${corridor.id}`}
              positions={corridor.coords}
              pathOptions={{
                color: '#FFFFFF',
                weight: isLineActive ? (isMatch ? 5.5 : 2.0) : 3.5,
                opacity: isLineActive ? (isMatch ? 1.0 : 0.2) : 0.9,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          );
        })}

        {/* Layer B: Official Coloured Stroke (2px, fades when network ridership is low) */}
        {RAIL_CORRIDORS.map((corridor) => {
          const isMatch = isCorridorMatch(corridor.name, selectedLine);
          const isLineActive = selectedLine !== 'All Lines';
          const officialColor = LINE_COLORS[corridor.name] || '#0066FF';

          const strokeColor = isLineActive
            ? isMatch
              ? officialColor
              : '#94A3B8'
            : officialColor;

          const strokeWidth = isLineActive ? (isMatch ? 4.0 : 1.5) : 2.0;
          const strokeOpacity = isLineActive
            ? isMatch
              ? 1.0
              : 0.18
            : dynamicLineOpacity;

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
                    Service: <strong>{corridor.category}</strong>
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
            const { ridership } = getStationData(station, playbackMonth);
            const heatRadius = ridership && ridership > 200000 ? 24 : 14;

            return (
              <CircleMarker
                key={`heat-${station.code}-${station.name}`}
                center={[station.lat, station.lng]}
                radius={heatRadius}
                pathOptions={{
                  fillColor: '#FF5A00',
                  color: '#FF2E00',
                  weight: 0,
                  fillOpacity: ridership && ridership > 0 ? 0.38 : 0.15,
                }}
              />
            );
          })}

        {/* ── 3. STATIONS SIZED AND COLOURED BY RIDERSHIP ── */}
        {sortedStations.map((station) => {
          if (!station.lat || !station.lng) return null;

          const isSelected =
            selectedStationObj &&
            selectedStationObj.name === station.name &&
            selectedStationObj.line === station.line;

          // If this station is explicitly selected, render it separately with beacon
          if (isSelected) return null;

          const isLineActive = selectedLine !== 'All Lines';
          const isLineMatch = !isLineActive || isCorridorMatch(station.line, selectedLine);

          // Ridership & YoY for the currently selected playback month
          const { ridership, yoy } = getStationData(station, playbackMonth);
          const hasData = ridership !== null && ridership > 0;

          // Square-root scale (min 3px, max 14px)
          const baseRadius = getStationRadius(ridership);
          const radius = isLineActive ? (isLineMatch ? baseRadius : 2.5) : baseRadius;

          // Sequential soft blue/teal gradient
          const fillColor = isLineActive
            ? isLineMatch
              ? getStationFillColor(ridership)
              : '#E2E8F0'
            : getStationFillColor(ridership);

          const strokeColor = hasData ? '#FFFFFF' : '#94A3B8';
          const strokeWidth = hasData ? 1.0 : 0.8;
          const fillOpacity = isLineActive ? (isLineMatch ? 0.95 : 0.2) : 0.92;
          const strokeOpacity = isLineActive ? (isLineMatch ? 1.0 : 0.2) : 0.95;

          return (
            <CircleMarker
              key={`node-${station.code}-${station.name}-${station.line}`}
              center={[station.lat, station.lng]}
              radius={radius}
              pathOptions={{
                fillColor,
                color: strokeColor,
                weight: strokeWidth,
                fillOpacity,
                opacity: strokeOpacity,
              }}
              eventHandlers={{
                click: () => {
                  if (onSelectStation) {
                    onSelectStation(station.name, station.line);
                  }
                },
              }}
            >
              {/* Permanent Station Labels in Station View or when zoomed in */}
              {(activeOverlay === 'station' || (currentZoom >= 13 && hasData)) && (
                <Tooltip permanent direction="top" offset={[0, -radius]}>
                  <span style={{ fontSize: 9.5, fontWeight: 600, color: '#0F1E36' }}>
                    {station.name}
                  </span>
                </Tooltip>
              )}

              {/* Standard Interactive Hover Tooltip */}
              {activeOverlay !== 'station' && !(currentZoom >= 13 && hasData) && (
                <Tooltip>
                  <div style={{ padding: '3px 6px', minWidth: 135 }}>
                    <div style={{ fontWeight: 700, fontSize: 12, color: '#0F1E36' }}>
                      {station.name}
                    </div>
                    <div style={{ fontSize: 10, color: '#0066FF', fontWeight: 600, marginTop: 1 }}>
                      {station.line} ({station.code})
                    </div>
                    {hasData ? (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#0F1E36' }}>
                          {ridership.toLocaleString()}{' '}
                          <span style={{ fontSize: 9.5, fontWeight: 400, color: '#64748B' }}>
                            trips ({playbackMonth})
                          </span>
                        </div>
                        {yoy !== null && (
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              color: yoy >= 0 ? '#00C48C' : '#FF5A00',
                              marginTop: 2,
                            }}
                          >
                            {yoy >= 0 ? '▲ +' : '▼ '}
                            {yoy}% vs last year
                          </div>
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: 10,
                          color: '#94A3B8',
                          fontStyle: 'italic',
                          marginTop: 3,
                        }}
                      >
                        No ridership data
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
              radius={24}
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
              radius={14}
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
                  {(() => {
                    const { ridership, yoy } = getStationData(selectedStationObj, playbackMonth);
                    return ridership && ridership > 0 ? (
                      <div style={{ marginTop: 3 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: '#00C48C' }}>
                          {ridership.toLocaleString()} trips
                        </div>
                        {yoy !== null && (
                          <div style={{ fontSize: 9.5, color: yoy >= 0 ? '#00C48C' : '#FF5A00' }}>
                            {yoy >= 0 ? '▲ +' : '▼ '}
                            {yoy}% YoY
                          </div>
                        )}
                      </div>
                    ) : (
                      <div style={{ fontSize: 9.5, color: '#94A3B8', marginTop: 2 }}>
                        No ridership data
                      </div>
                    );
                  })()}
                </div>
              </Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>

      {/* ── Soft Ice-Blue / Cyber Frost Tint Overlay ── */}
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

      {/* ── Top-Left: "Klang Valley" | "Peninsular Malaysia" Toggle Control ── */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 54,
          zIndex: 1000,
          display: 'flex',
          background: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0, 102, 255, 0.2)',
          borderRadius: 8,
          padding: 2,
          boxShadow: '0 2px 10px rgba(15, 30, 54, 0.1)',
        }}
      >
        <button
          onClick={() => setViewScope('klang_valley')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            background: viewScope === 'klang_valley' ? '#0066FF' : 'transparent',
            color: viewScope === 'klang_valley' ? '#FFFFFF' : '#475569',
            boxShadow:
              viewScope === 'klang_valley' ? '0 1px 4px rgba(0, 102, 255, 0.3)' : 'none',
            transition: 'all 0.2s',
          }}
          title="Zoom to Rapid Rail & Klang Valley Network"
        >
          Klang Valley
        </button>
        <button
          onClick={() => setViewScope('peninsular')}
          style={{
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600,
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            background: viewScope === 'peninsular' ? '#0066FF' : 'transparent',
            color: viewScope === 'peninsular' ? '#FFFFFF' : '#475569',
            boxShadow:
              viewScope === 'peninsular' ? '0 1px 4px rgba(0, 102, 255, 0.3)' : 'none',
            transition: 'all 0.2s',
          }}
          title="Zoom to Entire Peninsular Malaysia Network"
        >
          Peninsular Malaysia
        </button>
      </div>

      {/* ── Floating Focus Banner (When a line or station filter is applied) ── */}
      {isFilterActive && (
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 54,
            zIndex: 1000,
            background: 'rgba(15, 30, 54, 0.94)',
            backdropFilter: 'blur(10px)',
            color: '#FFFFFF',
            borderRadius: 8,
            padding: '5px 12px',
            fontSize: 11.5,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            boxShadow: '0 4px 16px rgba(0, 102, 255, 0.28)',
            border: '1px solid rgba(0, 102, 255, 0.45)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 13 }}>🎯</span>
            <span>
              Focused:{' '}
              <strong style={{ color: '#00E5A3' }}>
                {selectedStation !== 'All Stations' ? selectedStation : selectedLine}
              </strong>
            </span>
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
                fontSize: 10.5,
                cursor: 'pointer',
                fontWeight: 600,
              }}
              title="Reset View"
            >
              Reset ✕
            </button>
          )}
        </div>
      )}

      {/* ── Top-Right: Comprehensive Line Legend Grouped by Service ── */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 76,
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0, 102, 255, 0.15)',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 10.5,
          boxShadow: '0 2px 12px rgba(15, 30, 54, 0.1)',
          maxWidth: 290,
        }}
      >
        <div
          onClick={() => setLegendOpen((v) => !v)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
            fontWeight: 700,
            color: '#0F1E36',
            marginBottom: legendOpen ? 6 : 0,
          }}
        >
          <span style={{ fontSize: 11, letterSpacing: '0.2px' }}>Rail Lines & Services</span>
          <span style={{ fontSize: 10, color: '#0066FF' }}>{legendOpen ? '▴' : '▾'}</span>
        </div>

        {legendOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {/* Rapid Rail */}
            <div>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  marginBottom: 3,
                }}
              >
                Rapid Rail (Klang Valley)
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '3px 8px',
                }}
              >
                {[
                  'LRT Kelana Jaya',
                  'LRT Ampang',
                  'LRT Sri Petaling',
                  'MRT Kajang',
                  'MRT Putrajaya',
                  'KL Monorail',
                  'LRT Shah Alam',
                ].map((name) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div
                      style={{
                        width: 10,
                        height: 3,
                        borderRadius: 2,
                        background: LINE_COLORS[name],
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 9.5,
                        color: '#0F1E36',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {name}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* KTMB & ETS */}
            <div style={{ borderTop: '1px solid #E2E8F0', paddingTop: 4 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: '#64748B',
                  textTransform: 'uppercase',
                  marginBottom: 3,
                }}
              >
                KTMB & ETS Services
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '3px 8px',
                }}
              >
                {[
                  'KTM Komuter (Batu Caves Line)',
                  'KTM Komuter (Port Klang Line)',
                  'KTM East Coast Line',
                  'ETS North-South Trunk',
                ].map((name) => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div
                      style={{
                        width: 10,
                        height: 3,
                        borderRadius: 2,
                        background: LINE_COLORS[name] || '#0066FF',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 9.5,
                        color: '#0F1E36',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {name.replace('KTM Komuter (', '').replace(' Line)', '').replace('Line', '')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom-Left: Monthly Station Ridership Scale Legend ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 14,
          left: 14,
          zIndex: 1000,
          background: 'rgba(255, 255, 255, 0.94)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(0, 102, 255, 0.15)',
          borderRadius: 8,
          padding: '6px 12px',
          boxShadow: '0 2px 10px rgba(15, 30, 54, 0.08)',
          fontSize: 10.5,
          color: '#0F1E36',
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, color: '#334155', fontSize: 10.5 }}>
          Monthly Ridership ({playbackMonth})
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9.5, color: '#64748B' }}>Low</span>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#D5EAF8',
              border: '1px solid #FFF',
              boxShadow: '0 0 2px rgba(0,0,0,0.1)',
            }}
            title="< 10k trips"
          />
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: '#62BAE8',
              border: '1px solid #FFF',
              boxShadow: '0 0 2px rgba(0,0,0,0.1)',
            }}
            title="50k – 150k trips"
          />
          <div
            style={{
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: '#084882',
              border: '1px solid #FFF',
              boxShadow: '0 0 2px rgba(0,0,0,0.1)',
            }}
            title="> 800k trips"
          />
          <span style={{ fontSize: 9.5, color: '#64748B' }}>High</span>
          <div style={{ width: 1, height: 11, background: '#CBD5E1', margin: '0 3px' }} />
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: '#CBD5E1',
              border: '1px solid #94A3B8',
            }}
            title="No ridership data"
          />
          <span style={{ fontSize: 9.5, color: '#94A3B8' }}>No data</span>
        </div>
      </div>

      {/* ── Mode Pill Notification ── */}
      {activeOverlay !== 'map' && (
        <div
          style={{
            position: 'absolute',
            bottom: 14,
            right: 76,
            zIndex: 1000,
            background: 'rgba(15, 30, 54, 0.88)',
            backdropFilter: 'blur(8px)',
            color: '#FFFFFF',
            borderRadius: 20,
            padding: '5px 12px',
            fontSize: 10.5,
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
