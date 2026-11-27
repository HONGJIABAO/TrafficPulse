import React from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import type { KpiSummary } from './types';

interface Props {
  kpi: KpiSummary | null;
  latestFuelPrice?: number | null;
  latestRegistrations?: number | null;
  latestUnemploymentRate?: number | null;
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
};

function fmt(val: number | null | undefined, decimals = 1, suffix = '') {
  if (val == null) return '—';
  return `${val.toFixed(decimals)}${suffix}`;
}

function fmtM(val: number | null | undefined) {
  if (val == null) return '—';
  return `${(val / 1_000_000).toFixed(1)}M`;
}

function fmtK(val: number | null | undefined) {
  if (val == null) return '—';
  return `${(val / 1000).toFixed(1)}k`;
}

function growthBadge(pct: number | null | undefined) {
  if (pct == null) return null;
  const color = pct >= 0 ? '#00C48C' : '#EF4444';
  const bg = pct >= 0 ? '#E0FFF6' : '#FEE2E2';
  const arrow = pct >= 0 ? '▲' : '▼';
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, borderRadius: 4, padding: '1px 6px' }}>
      {arrow} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}% Proj.
    </span>
  );
}

export const ForecastKpiStrip: React.FC<Props> = ({
  kpi,
  latestFuelPrice,
  latestRegistrations,
  latestUnemploymentRate,
}) => {
  // Resolve values: prefer kpi_summary (from pipeline), fallback to passed props
  const growthPct = kpi?.projected_growth_pct ?? null;
  const fuelMoM = kpi?.fuel_mom_pct ?? null;
  const regYoY = kpi?.reg_yoy_pct ?? null;
  const uRateCorr = kpi?.u_rate_pearson_r ?? null;
  const lfMillions = kpi?.latest_lf_employed_m ?? null;

  const fuelPrice = kpi?.last_ron95_avg ?? latestFuelPrice ?? null;
  const regCount = kpi?.last_registrations ?? latestRegistrations ?? null;
  const uRate = kpi?.last_u_rate ?? latestUnemploymentRate ?? null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        flexShrink: 0,
      }}
    >
      {/* KPI 1: Passenger Forecast Growth */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TelemetryIcon name="trend-up" variant="cobalt" badge />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Passenger Forecast</span>
          </div>
          {growthBadge(growthPct)}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          {growthPct != null ? `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}% Growth` : '—'}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          6-Month Projection vs last observed
        </div>
      </div>

      {/* KPI 2: Fuel Price Index */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TelemetryIcon name="fuel" variant="amber" badge />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Fuel Price Index</span>
          </div>
          {fuelMoM != null ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: fuelMoM >= 0 ? '#FF8C00' : '#00A389',
                background: fuelMoM >= 0 ? '#FFF3E0' : '#E0FFF6',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {fuelMoM >= 0 ? '▲' : '▼'} {fuelMoM >= 0 ? '+' : ''}{fuelMoM.toFixed(1)}% MoM
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          {fuelPrice != null ? `RM ${fuelPrice.toFixed(2)} / L` : '—'}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          RON95 latest avg &bull; Subsidy Rationalization
        </div>
      </div>

      {/* KPI 3: Vehicle Registrations */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TelemetryIcon name="car" variant="teal" badge />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Vehicle Registrations</span>
          </div>
          {regYoY != null ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#0066FF',
                background: '#E8F0FF',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {regYoY >= 0 ? '▲' : '▼'} {regYoY >= 0 ? '+' : ''}{regYoY.toFixed(1)}% YoY
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          {fmtK(regCount)} / mo
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          All vehicle types — latest monthly count
        </div>
      </div>

      {/* KPI 4: Labour & Economy */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TelemetryIcon name="briefcase" variant="indigo" badge />
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Labour &amp; Economy</span>
          </div>
          {uRateCorr != null ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#7B61FF',
                background: '#F0EDFF',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              r = {uRateCorr.toFixed(2)} (u_rate)
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          {uRate != null ? `${uRate.toFixed(1)}% Jobless Rate` : '—'}
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Employed force: <strong>{lfMillions != null ? `${lfMillions}M workers` : '—'}</strong> driving peak
        </div>
      </div>
    </div>
  );
};
