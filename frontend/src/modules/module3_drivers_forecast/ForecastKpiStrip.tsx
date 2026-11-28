import React, { useRef, useState } from 'react';
import type { KpiSummary } from './types';
import './ForecastKpiCard.css';

interface Props {
  kpi: KpiSummary | null;
  latestFuelPrice?: number | null;
  latestRegistrations?: number | null;
  latestUnemploymentRate?: number | null;
}

type ForecastKpiVariant = 'forecast' | 'fuel' | 'registrations' | 'labour';

function fmtK(val: number | null | undefined) {
  if (val == null) return '—';
  return `${(val / 1000).toFixed(1)}k`;
}

function ForecastTrendIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m3-kpi-icon-svg" aria-hidden="true">
      <rect x="4.5" y="5.5" width="23" height="21" rx="5.5" fill="#E7F1FF" stroke="#8AB6FF" strokeWidth="1.4" />
      <path
        d="M8.5 20.5l4.8-4.8 3.6 3 6.2-6.7"
        stroke="#3279E8"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19.5 11.5h4v4" stroke="#3279E8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="13.3" cy="15.7" r="1.4" fill="#3279E8" />
    </svg>
  );
}

function FuelPumpIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m3-kpi-icon-svg" aria-hidden="true">
      <path
        d="M7.5 8.5A2.5 2.5 0 0 1 10 6h9a2.5 2.5 0 0 1 2.5 2.5V26h-14V8.5Z"
        fill="#FFF4EB"
        stroke="#EE7938"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <rect x="10.5" y="9" width="8" height="5" rx="1.2" fill="#EE7938" fillOpacity="0.2" stroke="#EE7938" strokeWidth="1.3" />
      <path d="M21.5 11.5h2a2 2 0 0 1 2 2v7.5a1.5 1.5 0 0 1-3 0v-5h-1" stroke="#EE7938" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 26h18" stroke="#EE7938" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function VehicleRegIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m3-kpi-icon-svg" aria-hidden="true">
      <path
        d="M7.5 15.5 9.8 9.2A2.5 2.5 0 0 1 12.1 7.5h7.8a2.5 2.5 0 0 1 2.3 1.7l2.3 6.3V22a2 2 0 0 1-2 2h-1.2a1.5 1.5 0 0 1-1.5-1.5V21H12.2v1.5a1.5 1.5 0 0 1-1.5 1.5H9.5a2 2 0 0 1-2-2v-6.5Z"
        fill="#E0FFF6"
        stroke="#0D9488"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10.5 14.5h11" stroke="#0D9488" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11" cy="17.8" r="1.4" fill="#0D9488" />
      <circle cx="21" cy="17.8" r="1.4" fill="#0D9488" />
    </svg>
  );
}

function LabourBriefcaseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m3-kpi-icon-svg" aria-hidden="true">
      <rect x="5" y="10" width="22" height="15.5" rx="3.5" fill="#F0EDFF" stroke="#7B61FF" strokeWidth="1.6" />
      <path d="M11.5 10V8a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v2" stroke="#7B61FF" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M5.5 16.5h21" stroke="#7B61FF" strokeWidth="1.3" strokeOpacity="0.65" />
      <rect x="14" y="15" width="4" height="3" rx="1" fill="#7B61FF" />
    </svg>
  );
}

const THEMES: Record<
  ForecastKpiVariant,
  {
    accentRgb: string;
    trackColor: string;
    stationOutline: string;
    movingLight: string;
    Icon: React.FC;
  }
> = {
  forecast: {
    accentRgb: '50, 121, 232',
    trackColor: '#8AB6FF',
    stationOutline: '#639AFF',
    movingLight: '#3279E8',
    Icon: ForecastTrendIcon,
  },
  fuel: {
    accentRgb: '238, 121, 56',
    trackColor: '#FFB58C',
    stationOutline: '#FF9860',
    movingLight: '#FF7838',
    Icon: FuelPumpIcon,
  },
  registrations: {
    accentRgb: '13, 148, 136',
    trackColor: '#5EEAD4',
    stationOutline: '#2DD4BF',
    movingLight: '#0D9488',
    Icon: VehicleRegIcon,
  },
  labour: {
    accentRgb: '123, 97, 255',
    trackColor: '#B8A9FF',
    stationOutline: '#9B87FF',
    movingLight: '#7B61FF',
    Icon: LabourBriefcaseIcon,
  },
};

function ForecastKpiCard({
  variant,
  delayIndex,
  label,
  badge,
  value,
  sub,
}: {
  variant: ForecastKpiVariant;
  delayIndex: number;
  label: string;
  badge: React.ReactNode;
  value: string;
  sub: React.ReactNode;
}) {
  const theme = THEMES[variant];
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    if (!isHovered) setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
  };

  const railDelay = `${delayIndex * 150}ms`;
  const entranceDelay = `${delayIndex * 120}ms`;
  const IconComponent = theme.Icon;

  return (
    <div
      ref={cardRef}
      className={`m3-kpi-card m3-kpi-card-entrance ${isHovered ? 'is-hovered' : ''}`}
      style={{
        '--accent-rgb': theme.accentRgb,
        '--rail-track-color': theme.trackColor,
        '--rail-station-outline': theme.stationOutline,
        '--rail-moving-light': theme.movingLight,
        animationDelay: entranceDelay,
      } as React.CSSProperties}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <div className="m3-kpi-border-base" />
      <div className="m3-kpi-spotlight" />
      <div className="m3-kpi-border-glow" />

      <div className="m3-kpi-icon-container">
        <IconComponent />
      </div>

      <div className="m3-kpi-content">
        <div className="m3-kpi-top-row">
          <span className="m3-kpi-label">{label}</span>
          {badge}
        </div>
        <div className="m3-kpi-value">{value}</div>
        <div className="m3-kpi-sub-text">{sub}</div>
      </div>

      <div className="m3-kpi-rail-track-wrap" aria-hidden="true">
        <div className="m3-kpi-rail-track-line" />
        <div className="m3-kpi-rail-station-node node-1" style={{ left: '0%', animationDelay: railDelay }} />
        <div className="m3-kpi-rail-station-node node-2" style={{ left: '33.33%', animationDelay: railDelay }} />
        <div className="m3-kpi-rail-station-node node-3" style={{ left: '66.66%', animationDelay: railDelay }} />
        <div className="m3-kpi-rail-station-node node-4" style={{ left: '100%', animationDelay: railDelay }} />
        <div className="m3-kpi-rail-train-light" style={{ animationDelay: railDelay }}>
          <div className="m3-kpi-rail-train-trail" />
          <div className="m3-kpi-rail-train-head" />
        </div>
      </div>
    </div>
  );
}

function growthBadge(pct: number | null | undefined) {
  if (pct == null) return null;
  const color = pct >= 0 ? '#00C48C' : '#EF4444';
  const bg = pct >= 0 ? '#E0FFF6' : '#FEE2E2';
  const arrow = pct >= 0 ? '▲' : '▼';
  return (
    <span className="m3-kpi-badge" style={{ color, background: bg }}>
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
        gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
        gap: 10,
        flexShrink: 0,
      }}
    >
      {/* KPI 1: Passenger Forecast Growth */}
      <ForecastKpiCard
        variant="forecast"
        delayIndex={0}
        label="Passenger Forecast"
        badge={growthBadge(growthPct)}
        value={growthPct != null ? `${growthPct >= 0 ? '+' : ''}${growthPct.toFixed(1)}% Growth` : '—'}
        sub="6-Month Projection vs last observed"
      />

      {/* KPI 2: Fuel Price Index */}
      <ForecastKpiCard
        variant="fuel"
        delayIndex={1}
        label="Fuel Price Index"
        badge={
          fuelMoM != null ? (
            <span
              className="m3-kpi-badge"
              style={{
                color: fuelMoM >= 0 ? '#FF8C00' : '#00A389',
                background: fuelMoM >= 0 ? '#FFF3E0' : '#E0FFF6',
              }}
            >
              {fuelMoM >= 0 ? '▲' : '▼'} {fuelMoM >= 0 ? '+' : ''}{fuelMoM.toFixed(1)}% MoM
            </span>
          ) : null
        }
        value={fuelPrice != null ? `RM ${fuelPrice.toFixed(2)} / L` : '—'}
        sub="RON95 latest avg • Subsidy Rationalization"
      />

      {/* KPI 3: Vehicle Registrations */}
      <ForecastKpiCard
        variant="registrations"
        delayIndex={2}
        label="Vehicle Registrations"
        badge={
          regYoY != null ? (
            <span
              className="m3-kpi-badge"
              style={{
                color: '#0066FF',
                background: '#E8F0FF',
              }}
            >
              {regYoY >= 0 ? '▲' : '▼'} {regYoY >= 0 ? '+' : ''}{regYoY.toFixed(1)}% YoY
            </span>
          ) : null
        }
        value={`${fmtK(regCount)} / mo`}
        sub="All vehicle types — latest monthly count"
      />

      {/* KPI 4: Labour & Economy */}
      <ForecastKpiCard
        variant="labour"
        delayIndex={3}
        label="Labour & Economy"
        badge={
          uRateCorr != null ? (
            <span
              className="m3-kpi-badge"
              style={{
                color: '#7B61FF',
                background: '#F0EDFF',
              }}
            >
              r = {uRateCorr.toFixed(2)} (u_rate)
            </span>
          ) : null
        }
        value={uRate != null ? `${uRate.toFixed(1)}% Jobless Rate` : '—'}
        sub={
          <>
            Employed force: <strong>{lfMillions != null ? `${lfMillions}M workers` : '—'}</strong> driving peak
          </>
        }
      />
    </div>
  );
};
