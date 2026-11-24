import { useState, useMemo } from 'react';
import { Marker, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';

export interface LandmarkBuilding {
  id: string;
  name: string;
  nativeName: string;
  heightM: number;
  floors?: number;
  yearBuilt: number;
  coords: [number, number]; // [lat, lng]
  adjacentStation: string;
  line: string;
  category: 'Skyscraper' | 'Telecommunication' | 'Heritage' | 'Cultural';
  description: string;
  svgIcon: string;
  viewBox: string;
  iconWidth: number;
  iconHeight: number;
  anchor: [number, number]; // Ground contact point [x, y]
}

// ── Landmark Definitions with 2.5D Isometric Architectural SVGs ─────────────
// Architectural sketch aesthetic matching reference image:
// - Tall vertical extrusions
// - Isometric shading (silver/slate front, shaded side, crisp dark outlines)
// - Slender leader lines rising to floating title labels
export const LANDMARK_BUILDINGS: LandmarkBuilding[] = [
  // 1. Merdeka 118 (Tallest in Malaysia & SE Asia, 2nd tallest in world)
  {
    id: 'merdeka_118',
    name: 'Merdeka 118',
    nativeName: 'Menara Warisan Merdeka',
    heightM: 678.9,
    floors: 118,
    yearBuilt: 2023,
    coords: [3.1412, 101.7006],
    adjacentStation: 'Merdeka / Hang Tuah',
    line: 'MRT Kajang & LRT Ampang',
    category: 'Skyscraper',
    description: 'World’s 2nd tallest building. Multi-faceted diamond silhouette with soaring spire.',
    viewBox: '0 0 100 180',
    iconWidth: 100,
    iconHeight: 180,
    anchor: [50, 172],
    svgIcon: `
      <!-- Ground Shadow -->
      <ellipse cx="50" cy="172" rx="28" ry="6" fill="rgba(15,30,54,0.18)" />
      <!-- Base Podium -->
      <polygon points="32,172 50,175 68,172 50,165" fill="#CBD5E1" stroke="#334155" stroke-width="1.2" />
      <!-- Lower Body Facets -->
      <polygon points="32,172 50,175 50,110 36,114" fill="#F8FAFC" stroke="#334155" stroke-width="1.2" />
      <polygon points="50,175 68,172 64,114 50,110" fill="#94A3B8" stroke="#334155" stroke-width="1.2" />
      <!-- Mid-Section Diamond Facets -->
      <polygon points="36,114 50,110 50,60 40,66" fill="#FFFFFF" stroke="#334155" stroke-width="1.2" />
      <polygon points="50,110 64,114 60,66 50,60" fill="#64748B" stroke="#334155" stroke-width="1.2" />
      <polygon points="40,66 50,60 50,38 43,44" fill="#F1F5F9" stroke="#334155" stroke-width="1.2" />
      <polygon points="50,60 60,66 57,44 50,38" fill="#475569" stroke="#334155" stroke-width="1.2" />
      <!-- Facet Grid Lines -->
      <line x1="43" y1="140" x2="57" y2="140" stroke="#64748B" stroke-width="0.8" stroke-dasharray="2,2" />
      <line x1="40" y1="88" x2="60" y2="88" stroke="#64748B" stroke-width="0.8" stroke-dasharray="2,2" />
      <!-- Spire / Needle -->
      <polygon points="48.5,38 51.5,38 50.5,6 49.5,6" fill="#334155" />
      <circle cx="50" cy="6" r="2" fill="#00E5A3" />
      <!-- Vertical Leader Line to Badge -->
      <line x1="50" y1="4" x2="50" y2="-12" stroke="#0066FF" stroke-width="1.2" stroke-dasharray="2,2" />
    `,
  },

  // 2. Petronas Twin Towers (KLCC - Iconic Dual Towers & Skybridge)
  {
    id: 'klcc_twin_towers',
    name: 'Petronas Twin Towers (KLCC)',
    nativeName: 'Menara Berkembar Petronas',
    heightM: 451.9,
    floors: 88,
    yearBuilt: 1998,
    coords: [3.1579, 101.7116],
    adjacentStation: 'KLCC / Persiaran KLCC',
    line: 'LRT Kelana Jaya & MRT Putrajaya',
    category: 'Skyscraper',
    description: 'World’s tallest twin towers. Islamic 8-point geometric floorplate with skybridge on levels 41-42.',
    viewBox: '0 0 120 170',
    iconWidth: 120,
    iconHeight: 170,
    anchor: [60, 162],
    svgIcon: `
      <!-- Ground Shadow -->
      <ellipse cx="60" cy="162" rx="42" ry="7" fill="rgba(15,30,54,0.18)" />
      <!-- Tower 1 (Left) -->
      <polygon points="34,162 48,164 48,68 36,68" fill="#F8FAFC" stroke="#334155" stroke-width="1.2" />
      <polygon points="48,164 54,162 52,68 48,68" fill="#94A3B8" stroke="#334155" stroke-width="1.2" />
      <!-- Tower 1 Tiers -->
      <polygon points="36,68 48,69 48,46 39,46" fill="#FFFFFF" stroke="#334155" stroke-width="1" />
      <polygon points="39,46 48,47 48,30 42,30" fill="#F1F5F9" stroke="#334155" stroke-width="1" />
      <!-- Tower 1 Spire -->
      <polygon points="44,30 46,30 45.5,10 44.5,10" fill="#334155" />
      <circle cx="45" cy="10" r="1.5" fill="#0066FF" />

      <!-- Tower 2 (Right) -->
      <polygon points="66,162 72,164 72,68 68,68" fill="#F8FAFC" stroke="#334155" stroke-width="1.2" />
      <polygon points="72,164 86,162 74,68 72,68" fill="#94A3B8" stroke="#334155" stroke-width="1.2" />
      <!-- Tower 2 Tiers -->
      <polygon points="72,68 84,68 81,46 72,46" fill="#CBD5E1" stroke="#334155" stroke-width="1" />
      <polygon points="72,46 81,46 78,30 72,30" fill="#94A3B8" stroke="#334155" stroke-width="1" />
      <!-- Tower 2 Spire -->
      <polygon points="74,30 76,30 75.5,10 74.5,10" fill="#334155" />
      <circle cx="75" cy="10" r="1.5" fill="#0066FF" />

      <!-- Double-Deck Skybridge -->
      <rect x="48" y="92" width="24" height="6" fill="#E2E8F0" stroke="#334155" stroke-width="1.2" />
      <line x1="50" y1="104" x2="60" y2="98" stroke="#475569" stroke-width="1.2" />
      <line x1="70" y1="104" x2="60" y2="98" stroke="#475569" stroke-width="1.2" />

      <!-- Floor Lines Overlay -->
      <line x1="36" y1="140" x2="52" y2="140" stroke="#CBD5E1" stroke-width="0.8" />
      <line x1="68" y1="140" x2="84" y2="140" stroke="#CBD5E1" stroke-width="0.8" />
      <line x1="36" y1="115" x2="52" y2="115" stroke="#CBD5E1" stroke-width="0.8" />
      <line x1="68" y1="115" x2="84" y2="115" stroke="#CBD5E1" stroke-width="0.8" />

      <!-- Leader Line to Badge -->
      <line x1="60" y1="10" x2="60" y2="-12" stroke="#FF8C00" stroke-width="1.2" stroke-dasharray="2,2" />
    `,
  },

  // 3. The Exchange 106 (Tun Razak Exchange Financial Hub)
  {
    id: 'exchange_106',
    name: 'The Exchange 106 (TRX)',
    nativeName: 'Menara Exchange 106',
    heightM: 445.5,
    floors: 106,
    yearBuilt: 2019,
    coords: [3.1422, 101.7186],
    adjacentStation: 'Tun Razak Exchange (TRX)',
    line: 'MRT Kajang & MRT Putrajaya (Interchange)',
    category: 'Skyscraper',
    description: 'Financial hub centerpiece with an 11-story high illuminated glass crown.',
    viewBox: '0 0 100 165',
    iconWidth: 100,
    iconHeight: 165,
    anchor: [50, 158],
    svgIcon: `
      <!-- Ground Shadow -->
      <ellipse cx="50" cy="158" rx="26" ry="6" fill="rgba(15,30,54,0.18)" />
      <!-- Tower Body -->
      <polygon points="34,158 50,160 50,38 38,38" fill="#F8FAFC" stroke="#334155" stroke-width="1.2" />
      <polygon points="50,160 66,158 62,38 50,38" fill="#94A3B8" stroke="#334155" stroke-width="1.2" />
      <!-- Glowing Glass Crown -->
      <polygon points="38,38 50,39 50,14 42,16" fill="#E0F2FE" stroke="#0284C7" stroke-width="1.2" />
      <polygon points="50,39 62,38 58,16 50,14" fill="#38BDF8" stroke="#0284C7" stroke-width="1.2" />
      <!-- Crown Top Tip -->
      <circle cx="50" cy="14" r="2" fill="#0284C7" />
      <!-- Subtle Facade Grid -->
      <line x1="36" y1="120" x2="64" y2="120" stroke="#CBD5E1" stroke-width="0.8" />
      <line x1="37" y1="80" x2="63" y2="80" stroke="#CBD5E1" stroke-width="0.8" />
      <!-- Leader Line to Badge -->
      <line x1="50" y1="12" x2="50" y2="-12" stroke="#0284C7" stroke-width="1.2" stroke-dasharray="2,2" />
    `,
  },

  // 4. Kuala Lumpur Tower (Menara KL - Telecommunication Spire)
  {
    id: 'menara_kl',
    name: 'Kuala Lumpur Tower',
    nativeName: 'Menara Kuala Lumpur',
    heightM: 421.0,
    floors: 6,
    yearBuilt: 1996,
    coords: [3.1528, 101.7038],
    adjacentStation: 'Bukit Nanas / Dang Wangi',
    line: 'KL Monorail & LRT Kelana Jaya',
    category: 'Telecommunication',
    description: '7th tallest freestanding telecom tower in the world. 360° observation deck & revolving restaurant.',
    viewBox: '0 0 90 160',
    iconWidth: 90,
    iconHeight: 160,
    anchor: [45, 154],
    svgIcon: `
      <!-- Ground Shadow on Bukit Nanas hill -->
      <ellipse cx="45" cy="154" rx="24" ry="5" fill="rgba(15,30,54,0.18)" />
      <!-- Base Podium / Hillock -->
      <polygon points="32,154 45,156 58,154 45,148" fill="#CBD5E1" stroke="#334155" stroke-width="1" />
      <!-- Slender Shaft -->
      <polygon points="42,148 45,150 45,64 43,64" fill="#FFFFFF" stroke="#334155" stroke-width="1" />
      <polygon points="45,150 48,148 47,64 45,64" fill="#94A3B8" stroke="#334155" stroke-width="1" />
      <!-- Observation Head Pod -->
      <ellipse cx="45" cy="62" rx="15" ry="7" fill="#F8FAFC" stroke="#334155" stroke-width="1.2" />
      <ellipse cx="45" cy="56" rx="12" ry="5" fill="#E2E8F0" stroke="#334155" stroke-width="1.2" />
      <ellipse cx="45" cy="52" rx="7" ry="3" fill="#64748B" />
      <!-- Antenna Spire -->
      <line x1="45" y1="50" x2="45" y2="10" stroke="#334155" stroke-width="2" />
      <circle cx="45" cy="10" r="2" fill="#EF4444" />
      <!-- Leader Line to Badge -->
      <line x1="45" y1="8" x2="45" y2="-12" stroke="#84BD00" stroke-width="1.2" stroke-dasharray="2,2" />
    `,
  },

  // 5. Sultan Abdul Samad Building (Colonial Heritage Clock Tower at Dataran Merdeka)
  {
    id: 'sultan_abdul_samad',
    name: 'Sultan Abdul Samad Building',
    nativeName: 'Bangunan Sultan Abdul Samad',
    heightM: 41.5,
    floors: 2,
    yearBuilt: 1897,
    coords: [3.1486, 101.6944],
    adjacentStation: 'Masjid Jamek',
    line: 'LRT Kelana Jaya & LRT Ampang–Sri Petaling',
    category: 'Heritage',
    description: 'Iconic Moorish revival architecture with shiny copper domes and 41m central clock tower.',
    viewBox: '0 0 110 90',
    iconWidth: 110,
    iconHeight: 90,
    anchor: [55, 84],
    svgIcon: `
      <!-- Ground Shadow -->
      <ellipse cx="55" cy="84" rx="42" ry="5" fill="rgba(15,30,54,0.18)" />
      <!-- Long Colonnade Wing Left -->
      <rect x="18" y="60" width="30" height="24" fill="#F8FAFC" stroke="#334155" stroke-width="1" />
      <!-- Long Colonnade Wing Right -->
      <rect x="62" y="60" width="30" height="24" fill="#E2E8F0" stroke="#334155" stroke-width="1" />
      <!-- Arches -->
      <path d="M 22,76 Q 25,68 28,76 M 34,76 Q 37,68 40,76 M 70,76 Q 73,68 76,76 M 82,76 Q 85,68 88,76" stroke="#475569" stroke-width="1" fill="none" />
      <!-- Central Clock Tower Body -->
      <rect x="48" y="38" width="14" height="46" fill="#FFFFFF" stroke="#334155" stroke-width="1.2" />
      <!-- Clock Face -->
      <circle cx="55" cy="48" r="4" fill="#FEF08A" stroke="#334155" stroke-width="0.8" />
      <!-- Central Copper Dome -->
      <path d="M 48,38 Q 55,22 62,38 Z" fill="#D97706" stroke="#92400E" stroke-width="1" />
      <circle cx="55" cy="22" r="1.5" fill="#D97706" />
      <!-- Left & Right Small Domes -->
      <path d="M 16,60 Q 20,48 24,60 Z" fill="#D97706" stroke="#92400E" stroke-width="0.8" />
      <path d="M 86,60 Q 90,48 94,60 Z" fill="#D97706" stroke="#92400E" stroke-width="0.8" />
      <!-- Leader Line to Badge -->
      <line x1="55" y1="20" x2="55" y2="-10" stroke="#D97706" stroke-width="1.2" stroke-dasharray="2,2" />
    `,
  },

  // 6. Batu Caves (Lord Murugan Golden Statue & Limestone Caves)
  {
    id: 'batu_caves_shrine',
    name: 'Batu Caves (Lord Murugan)',
    nativeName: 'Kuil Sri Subramaniar Batu Caves',
    heightM: 42.7,
    floors: 1,
    yearBuilt: 2006,
    coords: [3.2372, 101.6819],
    adjacentStation: 'Batu Caves',
    line: 'KTM Komuter (Batu Caves Line)',
    category: 'Cultural',
    description: 'World’s tallest statue of Lord Murugan (42.7m) at the foot of ancient limestone cave temples.',
    viewBox: '0 0 100 100',
    iconWidth: 100,
    iconHeight: 100,
    anchor: [50, 94],
    svgIcon: `
      <!-- Limestone Cliff Backdrop -->
      <polygon points="15,94 28,40 45,30 65,42 85,32 90,94" fill="#94A3B8" stroke="#475569" stroke-width="1.2" />
      <!-- Colorful 272 Stairs -->
      <polygon points="32,94 44,52 50,52 42,94" fill="#EF4444" />
      <polygon points="42,94 50,52 56,52 50,94" fill="#3B82F6" />
      <!-- Golden Murugan Statue -->
      <!-- Pedestal -->
      <rect x="62" y="86" width="16" height="8" fill="#B45309" stroke="#78350F" stroke-width="0.8" />
      <!-- Robe / Body -->
      <polygon points="64,86 76,86 73,50 67,50" fill="#FBBF24" stroke="#D97706" stroke-width="1" />
      <!-- Torso & Spear (Vel) -->
      <line x1="77" y1="88" x2="77" y2="34" stroke="#F59E0B" stroke-width="2" />
      <polygon points="75,34 79,34 77,26" fill="#F59E0B" />
      <!-- Head & Crown -->
      <circle cx="70" cy="46" r="4" fill="#FDE047" stroke="#D97706" stroke-width="0.8" />
      <polygon points="68,43 72,43 70,37" fill="#F59E0B" />
      <!-- Leader Line to Badge -->
      <line x1="70" y1="26" x2="70" y2="-10" stroke="#F59E0B" stroke-width="1.2" stroke-dasharray="2,2" />
    `,
  },
];

interface Props {
  visible: boolean;
  onSelectLandmark?: (landmark: LandmarkBuilding) => void;
}

export function LandmarkBuildingsLayer({ visible, onSelectLandmark }: Props) {
  const map = useMap();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Generate Leaflet divIcons for each landmark
  const landmarkIcons = useMemo(() => {
    const icons: Record<string, L.DivIcon> = {};
    for (const lm of LANDMARK_BUILDINGS) {
      const isHovered = hoveredId === lm.id;

      const html = `
        <div style="
          position: relative;
          width: ${lm.iconWidth}px;
          height: ${lm.iconHeight}px;
          transform-origin: bottom center;
          transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
          transform: ${isHovered ? 'scale(1.15) translateY(-6px)' : 'scale(1)'};
          filter: drop-shadow(0 8px 16px rgba(15, 30, 54, ${isHovered ? '0.45' : '0.22'}));
          cursor: pointer;
        ">
          <!-- Architectural SVG Building -->
          <svg
            viewBox="${lm.viewBox}"
            width="100%"
            height="100%"
            style="overflow: visible;"
          >
            ${lm.svgIcon}
          </svg>

          <!-- Floating Architectural Badge (like reference image) -->
          <div style="
            position: absolute;
            top: -24px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(15, 30, 54, 0.94);
            backdrop-filter: blur(8px);
            border: 1px solid ${isHovered ? '#00E5A3' : 'rgba(0, 102, 255, 0.35)'};
            color: #FFFFFF;
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 10px;
            font-weight: 700;
            white-space: nowrap;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            pointer-events: none;
            display: flex;
            align-items: center;
            gap: 5px;
            transition: all 0.2s ease;
          ">
            <span style="color: #00E5A3;">📍</span>
            <span>${lm.name}</span>
            <span style="color: #94A3B8; font-size: 9px; font-weight: 500;">(${lm.heightM}m)</span>
          </div>
        </div>
      `;

      icons[lm.id] = L.divIcon({
        className: `landmark-3d-marker landmark-${lm.id}`,
        html,
        iconSize: [lm.iconWidth, lm.iconHeight],
        iconAnchor: lm.anchor,
      });
    }
    return icons;
  }, [hoveredId]);

  if (!visible) return null;

  return (
    <>
      {LANDMARK_BUILDINGS.map((landmark) => {
        const icon = landmarkIcons[landmark.id];
        if (!icon) return null;

        return (
          <Marker
            key={landmark.id}
            position={landmark.coords}
            icon={icon}
            zIndexOffset={1000}
            eventHandlers={{
              mouseover: () => setHoveredId(landmark.id),
              mouseout: () => setHoveredId(null),
              click: () => {
                map.flyTo(landmark.coords, 15, { duration: 1.2 });
                if (onSelectLandmark) onSelectLandmark(landmark);
              },
            }}
          >
            <Tooltip direction="bottom" offset={[0, 10]}>
              <div style={{ padding: '4px 6px', maxWidth: 220 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#0F1E36' }}>
                  {landmark.name}
                </div>
                <div style={{ fontSize: 10.5, color: '#0066FF', fontWeight: 600, marginTop: 1 }}>
                  {landmark.nativeName}
                </div>
                <div style={{ fontSize: 10, color: '#475569', marginTop: 4, lineHeight: 1.3 }}>
                  {landmark.description}
                </div>
                <div style={{
                  marginTop: 6,
                  paddingTop: 6,
                  borderTop: '1px solid #E2E8F0',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 9.5,
                  color: '#64748B',
                }}>
                  <span>Height: <strong style={{ color: '#0F1E36' }}>{landmark.heightM}m</strong></span>
                  <span>Station: <strong style={{ color: '#0066FF' }}>{landmark.adjacentStation}</strong></span>
                </div>
              </div>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

export default LandmarkBuildingsLayer;
