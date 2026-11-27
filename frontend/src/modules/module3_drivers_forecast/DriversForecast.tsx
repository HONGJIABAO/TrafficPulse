import React, { useState, useMemo } from 'react';
import rawForecastData from '@/data/forecast_demand.json';
import type {
  ForecastDemandSchema,
  TimeRangeFilter,
  DriverFocusFilter,
  ForecastHorizonKey,
} from './types';
import { ForecastKpiStrip } from './ForecastKpiStrip';
import { DriversFilterCard } from './DriversFilterCard';
import { RidershipVsDriversChart } from './RidershipVsDriversChart';
import { PassengerForecastChart } from './PassengerForecastChart';
import { KeyInsightsStrip } from './KeyInsightsStrip';

const forecastData = rawForecastData as unknown as ForecastDemandSchema;

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  overflow: 'hidden',
};

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontWeight: 700, fontSize: 13.5, color: '#0F1E36', letterSpacing: '0.2px' }}>
        {label}
      </span>
    </div>
  );
}

export function DriversForecast() {
  // ── Filter States ──────────────────────────────────────────────────────────
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeFilter>('12m');
  const [selectedDriverFocus, setSelectedDriverFocus] = useState<DriverFocusFilter>('fuel');
  const [selectedHorizon, setSelectedHorizon] = useState<ForecastHorizonKey>('6_months');

  const [pendingTimeRange, setPendingTimeRange] = useState<TimeRangeFilter>('12m');
  const [pendingDriverFocus, setPendingDriverFocus] = useState<DriverFocusFilter>('fuel');
  const [pendingHorizon, setPendingHorizon] = useState<ForecastHorizonKey>('6_months');

  // Compute latest metrics for KPI cards
  const latestHistorical = useMemo(() => {
    const list = forecastData.monthly_driver_trend;
    return list[list.length - 1] || null;
  }, []);

  const handleApply = () => {
    setSelectedTimeRange(pendingTimeRange);
    setSelectedDriverFocus(pendingDriverFocus);
    setSelectedHorizon(pendingHorizon);
  };

  const handleReset = () => {
    setPendingTimeRange('12m');
    setPendingDriverFocus('fuel');
    setPendingHorizon('6_months');
    setSelectedTimeRange('12m');
    setSelectedDriverFocus('fuel');
    setSelectedHorizon('6_months');
  };

  return (
    <div
      className="drivers-forecast-module"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 58px)',
        background: '#F1F4F9',
        padding: '12px 16px',
        gap: 10,
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* ── 1. Top Metric KPI Strip (Module 1 Sizing & Style) ─────────────── */}
      <ForecastKpiStrip
        projectedGrowthPct={8.7}
        latestFuelPrice={latestHistorical?.ron95_avg ? Number(latestHistorical.ron95_avg.toFixed(2)) : 3.75}
        latestRegistrations={latestHistorical?.registrations || 151050}
        latestUnemploymentRate={latestHistorical?.u_rate || 2.9}
      />

      {/* ── 2. Main Content Row: Left Full Sidebar + Right Graph Space ─────── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          gap: 12,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* Full-Height Left Sidebar */}
        <DriversFilterCard
          pendingTimeRange={pendingTimeRange}
          setPendingTimeRange={setPendingTimeRange}
          pendingDriverFocus={pendingDriverFocus}
          setPendingDriverFocus={setPendingDriverFocus}
          pendingHorizon={pendingHorizon}
          setPendingHorizon={setPendingHorizon}
          onApply={handleApply}
          onReset={handleReset}
          featureImportance={forecastData.feature_importance || []}
          driverCorrelations={forecastData.driver_correlations || []}
        />

        {/* Right Graph Space (Charts + Nested 3 Key Insights) */}
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            height: '100%',
          }}
        >
          {/* Top: 2 Compact Charts Side-by-Side */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 10,
            }}
          >
            {/* Chart 1: Ridership vs Key Drivers */}
            <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <SectionTitle icon="📉" label="Ridership vs Key Drivers" />
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: '#0066FF',
                    background: '#E8F0FF',
                    padding: '2px 8px',
                    borderRadius: 5,
                  }}
                >
                  Dual-Axis Correlation
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <RidershipVsDriversChart
                  data={forecastData.monthly_driver_trend}
                  timeRange={selectedTimeRange}
                  driverFocus={selectedDriverFocus}
                  onSelectDriverFocus={(focus) => {
                    setSelectedDriverFocus(focus);
                    setPendingDriverFocus(focus);
                  }}
                />
              </div>
            </div>

            {/* Chart 2: Passenger Demand Forecast & Confidence Band */}
            <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <SectionTitle icon="🔮" label="Passenger Demand Forecast" />
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: '#00A389',
                    background: '#E0FFF6',
                    padding: '2px 8px',
                    borderRadius: 5,
                  }}
                >
                  LightGBM + HW (95% CI)
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <PassengerForecastChart
                  historicalData={forecastData.monthly_driver_trend}
                  forecasts={forecastData.forecasts}
                  activeHorizon={selectedHorizon}
                  onSelectHorizon={setSelectedHorizon}
                />
              </div>
            </div>
          </div>

          {/* Bottom of Graph Space: 3 Key Insights Strip */}
          <KeyInsightsStrip />
        </div>
      </div>
    </div>
  );
}

export default DriversForecast;
