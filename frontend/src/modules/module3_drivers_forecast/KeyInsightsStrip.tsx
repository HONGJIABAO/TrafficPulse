import React from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';

interface Props {
  /** Projected growth % (from forecast vs last historical, computed by pipeline) */
  projectedGrowthPct?: number | null;
  /** Pearson r between diesel price & ridership (from pipeline) */
  dieselCorrR?: number | null;
  /** Pearson r between vehicle registrations & ridership (from pipeline) */
  registrationsCorrR?: number | null;
  /** YoY registration change % (computed by pipeline) */
  regYoYPct?: number | null;
  /** Last observed monthly ridership total */
  lastRailTotal?: number | null;
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
};

export const KeyInsightsStrip: React.FC<Props> = ({
  projectedGrowthPct,
  dieselCorrR,
  registrationsCorrR,
  regYoYPct,
  lastRailTotal,
}) => {
  const growthLabel =
    projectedGrowthPct != null
      ? `${projectedGrowthPct >= 0 ? '+' : ''}${projectedGrowthPct.toFixed(1)}%`
      : '+—%';

  const lastRailLabel =
    lastRailTotal != null
      ? `${(lastRailTotal / 1_000_000).toFixed(1)}M monthly trips`
      : '—M monthly trips';

  const dieselCorrLabel =
    dieselCorrR != null
      ? `r = ${dieselCorrR > 0 ? '+' : ''}${dieselCorrR.toFixed(2)}`
      : 'r = —';

  const regYoYLabel =
    regYoYPct != null
      ? `${regYoYPct >= 0 ? '+' : ''}${regYoYPct.toFixed(1)}% YoY`
      : '—% YoY';

  const regCorrLabel =
    registrationsCorrR != null
      ? `r = ${registrationsCorrR > 0 ? '+' : ''}${registrationsCorrR.toFixed(2)}`
      : 'r = —';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        height: 94,
        flexShrink: 0,
      }}
    >
      {/* Insight 1: Ridership Trajectory */}
      <div style={cardStyle}>
        <div style={{ flexShrink: 0 }}>
          <TelemetryIcon
            name="trend-up"
            variant="cobalt"
            badge
            size={22}
            style={{ width: 44, height: 44, borderRadius: 10 }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 2 }}>
            Ridership Growth Trajectory
          </div>
          <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.4 }}>
            Projected to grow by{' '}
            <strong style={{ color: '#00A389' }}>{growthLabel}</strong> over next 6 months,
            with the latest monthly baseline at{' '}
            <strong style={{ color: '#0F1E36' }}>{lastRailLabel}</strong>.
          </div>
        </div>
      </div>

      {/* Insight 2: Fuel Price Association */}
      <div style={cardStyle}>
        <div style={{ flexShrink: 0 }}>
          <TelemetryIcon
            name="fuel"
            variant="amber"
            badge
            size={22}
            style={{ width: 44, height: 44, borderRadius: 10 }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 2 }}>
            Fuel Price Association
          </div>
          <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.4 }}>
            Diesel price is associated with higher rail ridership (
            <strong style={{ color: '#0066FF' }}>{dieselCorrLabel} with ridership</strong>) —
            consistent with modal shift when fuel costs rise.
          </div>
        </div>
      </div>

      {/* Insight 3: Vehicle Growth Correlation */}
      <div style={cardStyle}>
        <div style={{ flexShrink: 0 }}>
          <TelemetryIcon
            name="car"
            variant="teal"
            badge
            size={22}
            style={{ width: 44, height: 44, borderRadius: 10 }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 2 }}>
            Vehicle Growth &amp; Rail Uptake
          </div>
          <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.4 }}>
            New vehicle registrations ({' '}
            <strong style={{ color: '#FF8C00' }}>{regYoYLabel}</strong>) correlate with
            increased rail trips ({regCorrLabel}) — road congestion likely contributes to rail uptake.
          </div>
        </div>
      </div>
    </div>
  );
};
