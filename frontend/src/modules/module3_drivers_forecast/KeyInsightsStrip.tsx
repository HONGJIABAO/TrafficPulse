import React from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import type { CorrelationPeriod, ForecastHorizon } from './types';
import { formatCorrelation, forecastDirection, forecastNarrative } from './module3Analytics';

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
  lastObservedMonth?: string | null;
  activeForecast: ForecastHorizon | null;
  correlationPeriod: CorrelationPeriod;
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
  lastObservedMonth,
  activeForecast,
  correlationPeriod,
}) => {
  const activeGrowth = activeForecast?.change_vs_last_observed_pct ?? projectedGrowthPct;
  const growthDirection = forecastDirection(activeGrowth);
  const growthColor = growthDirection === 'increase'
    ? '#00A389'
    : growthDirection === 'decrease'
      ? '#EF4444'
      : '#64748B';
  const growthSentence = forecastNarrative(activeForecast, lastObservedMonth);

  const lastRailLabel =
    lastRailTotal != null
      ? `${(lastRailTotal / 1_000_000).toFixed(1)}M monthly trips`
      : '—M monthly trips';

  const dieselCorrLabel =
    dieselCorrR != null
      ? `r = ${formatCorrelation(dieselCorrR)}`
      : 'r = N/A';

  const regYoYLabel =
    regYoYPct != null
      ? `${regYoYPct >= 0 ? '+' : ''}${regYoYPct.toFixed(1)}% YoY`
      : '—% YoY';

  const regCorrLabel =
    registrationsCorrR != null
      ? `r = ${formatCorrelation(registrationsCorrR)}`
      : 'r = N/A';

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
            <strong style={{ color: growthColor }}>{growthSentence}</strong>{' '}
            Latest observed volume: <strong style={{ color: '#0F1E36' }}>{lastRailLabel}</strong>.
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
            Diesel and ridership: <strong style={{ color: '#0066FF' }}>{dieselCorrLabel}</strong>{' '}
            for the selected window (n={correlationPeriod.n_obs}). Pearson association does not establish causation.
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
            Registrations are <strong style={{ color: '#FF8C00' }}>{regYoYLabel}</strong>; selected-window
            Pearson association is <strong style={{ color: '#00A389' }}>{regCorrLabel}</strong> (n={correlationPeriod.n_obs}), not a causal effect.
          </div>
        </div>
      </div>
    </div>
  );
};
