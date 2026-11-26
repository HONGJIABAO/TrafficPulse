import React from 'react';
import type { PeakTimeFilter } from './types';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';

interface Props {
  activePeak: PeakTimeFilter;
  onSelectPeak: (peak: PeakTimeFilter) => void;
}

const PEAK_OPTIONS: { id: PeakTimeFilter; label: string; icon: TelemetryIconName; variant: TelemetryVariant; sub: string }[] = [
  { id: 'all', label: 'All Hours', icon: 'clock-radar', variant: 'cobalt', sub: 'Full Day' },
  { id: 'am_peak', label: 'AM Peak', icon: 'sunrise', variant: 'amber', sub: '07:00–09:00' },
  { id: 'midday', label: 'Midday', icon: 'sun', variant: 'teal', sub: '11:00–14:00' },
  { id: 'pm_peak', label: 'PM Peak', icon: 'sunset', variant: 'amber', sub: '17:00–19:30' },
];

export const PeakQuickFilterCard: React.FC<Props> = ({ activePeak, onSelectPeak }) => {
  // Compute skew and metrics based on selected peak period
  const skewData = React.useMemo(() => {
    switch (activePeak) {
      case 'am_peak':
        return {
          inboundPct: 73,
          outboundPct: 27,
          ratioText: '2.7× Inbound Skew',
          ratioColor: '#0066FF',
          badgeText: 'CBD Morning Rush',
          advisory:
            'Suburban entry crush (Rawang, Batu Caves, Kajang). Dispatch reverse-direction empty express sets to speed up turnaround.',
        };
      case 'midday':
        return {
          inboundPct: 51,
          outboundPct: 49,
          ratioText: '1.0× Balanced',
          ratioColor: '#00C48C',
          badgeText: 'Off-Peak Lull',
          advisory:
            'Demand drops 75% vs 8AM rush. Widen headway intervals to 15 mins to conserve traction energy by ~22%.',
        };
      case 'pm_peak':
        return {
          inboundPct: 29,
          outboundPct: 71,
          ratioText: '2.4× Outbound Skew',
          ratioColor: '#FF5A00',
          badgeText: 'Homeward Surge',
          advisory:
            'Severe platform gate congestion at KL Sentral & Pasar Seni. Pre-stage 6-car EMUs at station sidings prior to 17:15.',
        };
      case 'all':
      default:
        return {
          inboundPct: 58,
          outboundPct: 42,
          ratioText: '1.4× Daily Skew',
          ratioColor: '#64748B',
          badgeText: 'Overall Network Flow',
          advisory:
            'Select an operational window above to investigate time-of-day directional imbalances and turnaround needs.',
        };
    }
  }, [activePeak]);

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
        gap: 10,
      }}
    >
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <TelemetryIcon name="lightning" variant="amber" badge />
          <span style={{ fontWeight: 700, fontSize: 12, color: '#0F1E36', letterSpacing: '0.3px' }}>
            Peak Period &amp; Directional Skew
          </span>
        </div>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: skewData.ratioColor,
            background: `${skewData.ratioColor}15`,
            borderRadius: 4,
            padding: '2px 6px',
            letterSpacing: '0.3px',
          }}
        >
          {skewData.badgeText}
        </span>
      </div>

      {/* Preset Pill Buttons */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 6,
        }}
      >
        {PEAK_OPTIONS.map((opt) => {
          const isActive = activePeak === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelectPeak(opt.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                padding: '6px 8px',
                borderRadius: 8,
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <TelemetryIcon name={opt.icon} variant={isActive ? 'cobalt' : opt.variant} size={13} />
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: isActive ? 700 : 600,
                    color: isActive ? '#0066FF' : '#0F1E36',
                  }}
                >
                  {opt.label}
                </span>
              </div>
              <span style={{ fontSize: 9, color: '#64748B', marginTop: 1, paddingLeft: 15 }}>
                {opt.sub}
              </span>
            </button>
          );
        })}
      </div>

      {/* Directional Flow Skew Meter */}
      <div
        style={{
          background: '#F8FAFC',
          borderRadius: 8,
          padding: '8px 10px',
          border: '1px solid rgba(148, 163, 184, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 10 }}>
          <span style={{ color: '#0066FF', fontWeight: 700 }}>
            Inbound CBD: {skewData.inboundPct}%
          </span>
          <span style={{ fontWeight: 800, color: skewData.ratioColor }}>
            {skewData.ratioText}
          </span>
          <span style={{ color: '#FF5A00', fontWeight: 700 }}>
            Outbound: {skewData.outboundPct}%
          </span>
        </div>

        {/* Segmented bar */}
        <div
          style={{
            height: 7,
            width: '100%',
            background: '#E2E8F0',
            borderRadius: 4,
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <div
            style={{
              width: `${skewData.inboundPct}%`,
              background: 'linear-gradient(90deg, #0066FF 0%, #0052CC 100%)',
              transition: 'width 0.4s ease',
            }}
          />
          <div
            style={{
              width: `${skewData.outboundPct}%`,
              background: 'linear-gradient(90deg, #FF8C00 0%, #FF5A00 100%)',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      {/* Operational Dispatch Advisory */}
      <div
        style={{
          fontSize: 10.5,
          color: '#475569',
          lineHeight: 1.35,
          background: 'rgba(0, 102, 255, 0.04)',
          borderRadius: 6,
          padding: '6px 8px',
          borderLeft: `3px solid ${skewData.ratioColor}`,
        }}
      >
        <span style={{ fontWeight: 700, color: '#0F1E36' }}>Operator Action: </span>
        {skewData.advisory}
      </div>
    </div>
  );
};
