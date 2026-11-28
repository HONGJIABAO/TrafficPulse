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
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';
import {
  correlationPeriod,
  correlationValue,
  evaluationForHorizon,
  forecastForHorizon,
} from './module3Analytics';

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

function SectionTitle({
  icon,
  label,
  variant = 'cobalt',
}: {
  icon: TelemetryIconName;
  label: string;
  variant?: TelemetryVariant;
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <TelemetryIcon name={icon} variant={variant} badge />
      <span style={{ fontWeight: 700, fontSize: 13, color: '#0F1E36', letterSpacing: '0.2px' }}>
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

  const kpi = forecastData.kpi_summary ?? null;

  // Fallback: derive from monthly_driver_trend if kpi_summary absent (old JSON)
  const latestHistorical = useMemo(() => {
    const list = forecastData.monthly_driver_trend;
    return list[list.length - 1] || null;
  }, []);

  const activeCorrelationPeriod = useMemo(
    () => correlationPeriod(forecastData, selectedTimeRange),
    [selectedTimeRange],
  );
  const activeForecast = useMemo(
    () => forecastForHorizon(forecastData.forecasts, selectedHorizon),
    [selectedHorizon],
  );
  const activeEvaluation = useMemo(
    () => evaluationForHorizon(forecastData, selectedHorizon),
    [selectedHorizon],
  );
  const seasonalNaive = activeEvaluation?.models?.['Seasonal Naive']?.endpoint ?? null;

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
      {/* ── 1. Top Metric KPI Strip — all values from JSON (Fix 5) ───────────── */}
      <ForecastKpiStrip
        kpi={kpi}
        activeForecast={activeForecast}
        unemploymentCorrelation={correlationValue(activeCorrelationPeriod, 'u_rate')}
        latestFuelPrice={latestHistorical?.ron95_avg ?? null}
        latestRegistrations={latestHistorical?.registrations ?? null}
        latestUnemploymentRate={latestHistorical?.u_rate ?? null}
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
          setPendingHorizon={(horizon) => {
            setPendingHorizon(horizon);
            setSelectedHorizon(horizon);
          }}
          onApply={handleApply}
          onReset={handleReset}
          featureImportance={forecastData.feature_importance || []}
          featureImportanceScope={forecastData.feature_importance_scope}
          correlationPeriod={activeCorrelationPeriod}
          activeForecast={activeForecast}
          selectedModel={forecastData.selected_forecast_model}
          seasonalNaive={seasonalNaive}
          disclosure={{
            informationCutoff: forecastData.information_cutoff,
            forecastOriginMonth: forecastData.forecast_origin_month,
            lastObservedMonth: kpi?.last_observed_month ?? forecastData.data_freshness.ridership_latest_month,
          }}
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
                <SectionTitle icon="chart-bar" variant="cobalt" label="Ridership vs Key Drivers" />
                <span
                  title={activeCorrelationPeriod.label}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: '#0066FF',
                    background: '#E8F0FF',
                    padding: '2px 8px',
                    borderRadius: 5,
                  }}
                >
                  Pearson · n={activeCorrelationPeriod.n_obs}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <RidershipVsDriversChart
                  data={forecastData.monthly_driver_trend}
                  timeRange={selectedTimeRange}
                  driverFocus={selectedDriverFocus}
                  correlationPeriod={activeCorrelationPeriod}
                  onSelectDriverFocus={(focus) => {
                    setPendingDriverFocus(focus);
                    setSelectedDriverFocus(focus);
                  }}
                />
              </div>
            </div>

            {/* Chart 2: Passenger Demand Forecast */}
            <div style={{ ...cardStyle, height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <SectionTitle icon="forecast-mesh" variant="indigo" label="Passenger Demand Forecast" />
                <span
                  title={forecastData.prediction_range_methodology.method}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: '#00A389',
                    background: '#E0FFF6',
                    padding: '2px 8px',
                    borderRadius: 5,
                  }}
                >
                  {activeForecast?.uncertainty_label ?? 'Prediction Range'}
                </span>
              </div>
              <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
                <PassengerForecastChart
                  historicalData={forecastData.monthly_driver_trend}
                  forecasts={forecastData.forecasts}
                  activeHorizon={selectedHorizon}
                  onSelectHorizon={(horizon) => {
                    setPendingHorizon(horizon);
                    setSelectedHorizon(horizon);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Bottom: 3 Key Insights — data from JSON (Fix 5 & 8) */}
          <KeyInsightsStrip
            projectedGrowthPct={kpi?.projected_growth_pct ?? null}
            activeForecast={activeForecast}
            correlationPeriod={activeCorrelationPeriod}
            dieselCorrR={correlationValue(activeCorrelationPeriod, 'diesel_avg')}
            registrationsCorrR={correlationValue(activeCorrelationPeriod, 'registrations')}
            regYoYPct={kpi?.reg_yoy_pct ?? null}
            lastRailTotal={kpi?.last_observed_rail_total ?? latestHistorical?.rail_total ?? null}
            lastObservedMonth={kpi?.last_observed_month ?? null}
          />
        </div>
      </div>
    </div>
  );
}

export default DriversForecast;
