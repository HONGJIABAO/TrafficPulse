import React from 'react';
import type { HaulFilter } from './types';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';

interface Props {
  activeHaul: HaulFilter;
  onSelectHaul: (haul: HaulFilter) => void;
  avgDistance?: number;
  shortPct?: number;
  medPct?: number;
  longPct?: number;
}

const HAUL_OPTIONS: { id: HaulFilter; label: string; icon: TelemetryIconName; variant: TelemetryVariant; range: string }[] = [
  { id: 'all', label: 'All Distances', icon: 'globe-network', variant: 'cobalt', range: 'Avg 13.0 km' },
  { id: 'short', label: 'Intra-CBD', icon: 'urban-cluster', variant: 'cobalt', range: '< 5 km (53%)' },
  { id: 'medium', label: 'Suburban', icon: 'suburban-station', variant: 'teal', range: '5–25 km (31%)' },
  { id: 'long', label: 'Regional', icon: 'transit-rail', variant: 'amber', range: '> 25 km (16%)' },
];

export const TripDistanceProfileCard: React.FC<Props> = ({
  activeHaul,
  onSelectHaul,
  avgDistance = 13.0,
  shortPct = 53.3,
  medPct = 30.5,
  longPct = 16.2,
}) => {
  const dynamicAdvisory = React.useMemo(() => {
    switch (activeHaul) {
      case 'short':
        return {
          title: 'Intra-CBD Metro Haul (< 5 km)',
          color: '#0066FF',
          advisory:
            'Rapid passenger exchange (e.g. KLCC ↔ Ampang Park, TRX ↔ Bukit Bintang). Mandate longitudinal seating configuration to optimize peak circulation.',
        };
      case 'medium':
        return {
          title: 'Suburban Commuter Haul (5–25 km)',
          color: '#00C48C',
          advisory:
            'Suburban radial trunk corridors (e.g. Batu Caves ↔ KL Sentral). Maintain 6-car EMU sets balancing seated and standing capacity.',
        };
      case 'long':
        return {
          title: 'Regional Long-Distance (> 25 km)',
          color: '#FF8C00',
          advisory:
            'Extended passenger dwell times (e.g. Seremban ↔ KL Sentral: 61 km). Recommend transverse seating with luggage accommodation.',
        };
      case 'all':
      default:
        return {
          title: 'Network Distance Distribution',
          color: '#64748B',
          advisory:
            'Passenger-trip-weighted average straight-line distance across all verified station pairs.',
        };
    }
  }, [activeHaul]);

  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: 12,
        border: '1px solid rgba(0, 102, 255, 0.1)',
        boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        flexShrink: 0,
      }}
    >
      {/* Title */}
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
        <TelemetryIcon name="haul-vector" variant="cobalt" badge />
        <span style={{ fontWeight: 700, fontSize: 12, color: '#0F1E36', letterSpacing: '0.3px' }}>
          Trip Distance &amp; Haul Profile
        </span>
      </div>

      {/* Hero Metric: Average Trip Distance */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0F1E36', lineHeight: 1.1 }}>
          {avgDistance} km
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Average trip distance
        </div>
      </div>

      {/* 3-Part Color Distribution Bar */}
      <div
        style={{
          height: 8,
          width: '100%',
          background: '#E2E8F0',
          borderRadius: 4,
          overflow: 'hidden',
          display: 'flex',
          margin: '2px 0',
        }}
      >
        <div
          title={`Intra-CBD (<5 km): ${shortPct}%`}
          style={{
            width: `${shortPct}%`,
            background: '#0066FF',
            transition: 'width 0.3s ease',
          }}
        />
        <div
          title={`Suburban (5–25 km): ${medPct}%`}
          style={{
            width: `${medPct}%`,
            background: '#00C48C',
            transition: 'width 0.3s ease',
          }}
        />
        <div
          title={`Regional (>25 km): ${longPct}%`}
          style={{
            width: `${longPct}%`,
            background: '#FF8C00',
            transition: 'width 0.3s ease',
          }}
        />
      </div>

      {/* 3 Interactive Legend Items matching picture */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
        {/* Short trips */}
        <div
          onClick={() => onSelectHaul(activeHaul === 'short' ? 'all' : 'short')}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11,
            cursor: 'pointer',
            padding: '3px 6px',
            borderRadius: 5,
            background: activeHaul === 'short' ? 'rgba(0, 102, 255, 0.08)' : 'transparent',
            transition: 'background 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0066FF', flexShrink: 0 }} />
            <span style={{ color: activeHaul === 'short' ? '#0066FF' : '#334155', fontWeight: activeHaul === 'short' ? 700 : 500 }}>
              Short trips (&lt; 5km)
            </span>
          </div>
          <span style={{ color: '#0066FF', fontWeight: 700 }}>{shortPct}%</span>
        </div>

        {/* Medium trips */}
        <div
          onClick={() => onSelectHaul(activeHaul === 'medium' ? 'all' : 'medium')}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11,
            cursor: 'pointer',
            padding: '3px 6px',
            borderRadius: 5,
            background: activeHaul === 'medium' ? 'rgba(0, 196, 140, 0.08)' : 'transparent',
            transition: 'background 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00C48C', flexShrink: 0 }} />
            <span style={{ color: activeHaul === 'medium' ? '#00C48C' : '#334155', fontWeight: activeHaul === 'medium' ? 700 : 500 }}>
              Medium trips (5–25km)
            </span>
          </div>
          <span style={{ color: '#00C48C', fontWeight: 700 }}>{medPct}%</span>
        </div>

        {/* Long trips */}
        <div
          onClick={() => onSelectHaul(activeHaul === 'long' ? 'all' : 'long')}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: 11,
            cursor: 'pointer',
            padding: '3px 6px',
            borderRadius: 5,
            background: activeHaul === 'long' ? 'rgba(255, 140, 0, 0.08)' : 'transparent',
            transition: 'background 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#FF8C00', flexShrink: 0 }} />
            <span style={{ color: activeHaul === 'long' ? '#FF8C00' : '#334155', fontWeight: activeHaul === 'long' ? 700 : 500 }}>
              Long trips (&gt; 25km)
            </span>
          </div>
          <span style={{ color: '#FF8C00', fontWeight: 700 }}>{longPct}%</span>
        </div>
      </div>

      {/* Advisory & Methodology Disclosure */}
      <div
        style={{
          background: 'rgba(0, 102, 255, 0.04)',
          borderRadius: 6,
          padding: '6px 8px',
          borderLeft: `3px solid ${dynamicAdvisory.color}`,
          fontSize: 9.5,
          color: '#475569',
          lineHeight: 1.35,
          marginTop: 2,
        }}
      >
        <span style={{ fontWeight: 700, color: '#0F1E36' }}>{dynamicAdvisory.title}: </span>
        {dynamicAdvisory.advisory}
        <div style={{ fontSize: 8.5, color: '#94A3B8', marginTop: 3 }}>
          * Straight-line (Haversine) distance. 100% station pairs verified.
        </div>
      </div>
    </div>
  );
};
