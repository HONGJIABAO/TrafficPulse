import React from 'react';
import type { HaulFilter } from './types';

interface Props {
  activeHaul: HaulFilter;
  onSelectHaul: (haul: HaulFilter) => void;
  avgDistance?: number;
  shortPct?: number;
  medPct?: number;
  longPct?: number;
}

const HAUL_OPTIONS: { id: HaulFilter; label: string; icon: string; range: string }[] = [
  { id: 'all', label: 'All Distances', icon: '🌐', range: 'Avg 13.0 km' },
  { id: 'short', label: 'Intra-CBD', icon: '🏙️', range: '< 5 km (53%)' },
  { id: 'medium', label: 'Suburban', icon: '🏡', range: '5–25 km (31%)' },
  { id: 'long', label: 'Regional', icon: '🚄', range: '> 25 km (16%)' },
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
            'Rapid passenger turnover (e.g. KLCC ↔ Ampang Park, TRX ↔ Bukit Bintang). Mandate 100% longitudinal seating to maximize standing capacity.',
        };
      case 'medium':
        return {
          title: 'Suburban Commuter Haul (5–25 km)',
          color: '#00C48C',
          advisory:
            'Peak suburban corridors (e.g. Batu Caves ↔ KL Sentral, 12.4 km). Balance 6-car EMU trainsets with 60% seated / 40% standing space.',
        };
      case 'long':
        return {
          title: 'Regional Long-Distance (> 25 km)',
          color: '#FF8C00',
          advisory:
            'Extended dwell times (e.g. Seremban ↔ KL Sentral: 61 km, Dabong ↔ Wakaf Bharu: 104 km). Require transverse seating with luggage racks.',
        };
      case 'all':
      default:
        return {
          title: 'Network Distance Distribution',
          color: '#64748B',
          advisory:
            'Click a distance tier above to filter the flow map and inspect rolling stock configuration needs.',
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
      {/* Title & Key Metric */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13 }}>📏</span>
          <span style={{ fontWeight: 600, fontSize: 11.5, color: '#0F1E36', letterSpacing: '0.3px' }}>
            Trip Distance &amp; Haul Profile
          </span>
        </div>
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: '#0066FF',
            background: 'rgba(0, 102, 255, 0.08)',
            borderRadius: 4,
            padding: '2px 5px',
          }}
        >
          Avg {avgDistance} km
        </div>
      </div>

      {/* 3-Part Color Distribution Bar */}
      <div
        style={{
          background: '#F8FAFC',
          borderRadius: 6,
          padding: '6px 8px',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748B' }}>
          <span style={{ color: '#0066FF', fontWeight: 600 }}>&lt;5km: {shortPct}%</span>
          <span style={{ color: '#00C48C', fontWeight: 600 }}>5–25km: {medPct}%</span>
          <span style={{ color: '#FF8C00', fontWeight: 600 }}>&gt;25km: {longPct}%</span>
        </div>

        {/* Multi-segment Bar */}
        <div
          style={{
            height: 6,
            width: '100%',
            background: '#E2E8F0',
            borderRadius: 3,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <div
            title="Intra-CBD (<5 km)"
            style={{
              width: `${shortPct}%`,
              background: '#0066FF',
            }}
          />
          <div
            title="Suburban (5-25 km)"
            style={{
              width: `${medPct}%`,
              background: '#00C48C',
            }}
          />
          <div
            title="Regional (>25 km)"
            style={{
              width: `${longPct}%`,
              background: '#FF8C00',
            }}
          />
        </div>
      </div>

      {/* Interactive Haul Filter Pills */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 5,
        }}
      >
        {HAUL_OPTIONS.map((opt) => {
          const isActive = activeHaul === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelectHaul(opt.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '5px 7px',
                borderRadius: 7,
                border: isActive
                  ? '1.5px solid #0066FF'
                  : '1px solid rgba(148, 163, 184, 0.25)',
                background: isActive ? '#E8F0FF' : '#F8FAFC',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#F1F4F9';
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = '#F8FAFC';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10 }}>{opt.icon}</span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? '#0066FF' : '#0F1E36',
                  }}
                >
                  {opt.label}
                </span>
              </div>
              <span style={{ fontSize: 8.5, color: '#64748B', marginTop: 1, paddingLeft: 14 }}>
                {opt.range}
              </span>
            </button>
          );
        })}
      </div>

      {/* Rolling Stock & Fleet Sizing Advisory */}
      <div
        style={{
          fontSize: 9.5,
          color: '#475569',
          lineHeight: 1.35,
          background: 'rgba(0, 102, 255, 0.04)',
          borderRadius: 6,
          padding: '5px 8px',
          borderLeft: `3px solid ${dynamicAdvisory.color}`,
        }}
      >
        <span style={{ fontWeight: 700, color: '#0F1E36' }}>Rolling Stock Directive: </span>
        {dynamicAdvisory.advisory}
      </div>
    </div>
  );
};
