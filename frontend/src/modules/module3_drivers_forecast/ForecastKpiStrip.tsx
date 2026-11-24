import React from 'react';

interface Props {
  projectedGrowthPct?: number;
  latestFuelPrice?: number;
  latestRegistrations?: number;
  latestUnemploymentRate?: number;
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

export const ForecastKpiStrip: React.FC<Props> = ({
  projectedGrowthPct = 8.7,
  latestFuelPrice = 3.75,
  latestRegistrations = 151050,
  latestUnemploymentRate = 2.9,
}) => {
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>📈</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Passenger Forecast</span>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#00C48C',
              background: '#E0FFF6',
              borderRadius: 4,
              padding: '1px 6px',
            }}
          >
            ▲ +{projectedGrowthPct}% Proj.
          </span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          +{projectedGrowthPct}% Growth
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Next 3–6 Months: <strong>34.5M+ trips</strong> vs baseline
        </div>
      </div>

      {/* KPI 2: Fuel Price Index */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>⛽</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Fuel Price Index</span>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: '#FF8C00',
              background: '#FFF3E0',
              borderRadius: 4,
              padding: '1px 6px',
            }}
          >
            ▲ +1.2% MoM
          </span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          RM {latestFuelPrice.toFixed(2)} / L
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          RON95 &amp; Diesel: <strong>Subsidy Rationalization</strong>
        </div>
      </div>

      {/* KPI 3: Vehicle Registrations */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>🚗</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Vehicle Registrations</span>
          </div>
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
            ▲ +5.4% YoY
          </span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          {(latestRegistrations / 1000).toFixed(1)}k / mo
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Private motor adds: <strong>2.1M vehicles/yr</strong>
        </div>
      </div>

      {/* KPI 4: Macro & Labour Driver */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>💼</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Labour &amp; Economy</span>
          </div>
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
            r = -0.93 Corr
          </span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
          {latestUnemploymentRate.toFixed(1)}% Jobless Rate
        </div>
        <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
          Employed force: <strong>16.4M workers</strong> driving peak
        </div>
      </div>
    </div>
  );
};
