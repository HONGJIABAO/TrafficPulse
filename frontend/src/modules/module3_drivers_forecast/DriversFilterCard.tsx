import React from 'react';
import type {
  TimeRangeFilter,
  DriverFocusFilter,
  ForecastHorizonKey,
  FeatureImportance,
  FeatureImportanceScope,
  CorrelationPeriod,
  ForecastHorizon,
  SelectedForecastModel,
  AccuracyMetrics,
} from './types';
import { formatCorrelation, formatMonth } from './module3Analytics';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';

interface Props {
  pendingTimeRange: TimeRangeFilter;
  setPendingTimeRange: (val: TimeRangeFilter) => void;
  pendingDriverFocus: DriverFocusFilter;
  setPendingDriverFocus: (val: DriverFocusFilter) => void;
  pendingHorizon: ForecastHorizonKey;
  setPendingHorizon: (val: ForecastHorizonKey) => void;
  onApply: () => void;
  onReset: () => void;
  featureImportance: FeatureImportance[];
  featureImportanceScope: FeatureImportanceScope;
  correlationPeriod: CorrelationPeriod;
  activeForecast: ForecastHorizon | null;
  selectedModel: SelectedForecastModel;
  seasonalNaive: AccuracyMetrics | null;
  disclosure: {
    informationCutoff: string;
    forecastOriginMonth: string;
    lastObservedMonth: string | null;
  };
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid rgba(0, 102, 255, 0.2)',
  borderRadius: 7,
  padding: '6px 8px',
  fontSize: 12,
  color: '#0F1E36',
  background: '#F8FAFF',
  cursor: 'pointer',
  outline: 'none',
  fontWeight: 500,
};

const applyBtnStyle: React.CSSProperties = {
  flex: 1,
  background: 'linear-gradient(135deg, #0066FF, #0052CC)',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 7,
  padding: '7px 10px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0, 102, 255, 0.3)',
  height: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const resetBtnStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  background: '#F1F4F9',
  color: '#64748B',
  border: '1px solid rgba(0, 0, 0, 0.1)',
  borderRadius: 7,
  fontSize: 15,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
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
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      <TelemetryIcon name={icon} variant={variant} badge />
      <span style={{ fontWeight: 700, fontSize: 12, color: '#0F1E36', letterSpacing: '0.3px' }}>
        {label}
      </span>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: '#64748B',
          fontWeight: 600,
          marginBottom: 3,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

const FEATURE_NAME_MAP: Record<string, string> = {
  registrations: 'Vehicle Registrations',
  u_rate: 'Unemployment Rate',
  lf_employed: 'Employed Labour Force',
  diesel_avg: 'Diesel Fuel Price',
  ron95_avg: 'RON95 Fuel Price',
};

export const DriversFilterCard: React.FC<Props> = ({
  pendingTimeRange,
  setPendingTimeRange,
  pendingDriverFocus,
  setPendingDriverFocus,
  pendingHorizon,
  setPendingHorizon,
  onApply,
  onReset,
  featureImportance,
  featureImportanceScope,
  correlationPeriod,
  activeForecast,
  selectedModel,
  seasonalNaive,
  disclosure,
}) => {
  const maxImportance = Math.max(...featureImportance.map((f) => f.importance), 1);
  const driverCorrelations = correlationPeriod.correlations;
  const maxCorrAbs = Math.max(...driverCorrelations.map((c) => Math.abs(c.correlation ?? 0)), 1);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        width: 280,
        minWidth: 260,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
      }}
    >
      {/* ── 1. Filter Controls ────────────────────────────────────────────────── */}
      <div style={cardStyle}>
        <SectionTitle icon="telemetry-sliders" variant="cobalt" label="Analysis Filters" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          <FilterRow label="Historical Horizon">
            <select
              value={pendingTimeRange}
              onChange={(e) => setPendingTimeRange(e.target.value as TimeRangeFilter)}
              style={selectStyle}
            >
              <option value="12m">Last 12 Months (2025–2026)</option>
              <option value="24m">Last 24 Months (2024–2026)</option>
              <option value="all">Full Series (2019–2026)</option>
            </select>
          </FilterRow>

          <FilterRow label="Driver Feature Focus">
            <select
              value={pendingDriverFocus}
              onChange={(e) => setPendingDriverFocus(e.target.value as DriverFocusFilter)}
              style={selectStyle}
            >
              <option value="fuel">Fuel Prices (RON95 &amp; Diesel)</option>
              <option value="registrations">Private Vehicle Registrations</option>
              <option value="labour">Labour Force &amp; Unemployment</option>
            </select>
          </FilterRow>

          <FilterRow label="Forecast Projection Period">
            <select
              value={pendingHorizon}
              onChange={(e) => setPendingHorizon(e.target.value as ForecastHorizonKey)}
              style={selectStyle}
            >
              <option value="3_months">3 Months (Short-Term)</option>
              <option value="6_months">6 Months (Tactical)</option>
              <option value="12_months">12 Months (Annual Strategic)</option>
            </select>
          </FilterRow>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={onApply} style={applyBtnStyle}>
            Apply
          </button>
          <button onClick={onReset} style={resetBtnStyle} title="Reset filters">
            ↺
          </button>
        </div>
      </div>

      {/* ── 2a. ML Feature Importance (LGBM Split Count) ──────────────────────── */}
      {/* Fix 6: bar length = importance (LGBM split count), no correlation label */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionTitle icon="chart-bar" variant="teal" label="ML Feature Importance" />
          <span title={featureImportanceScope.metric} style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>LGBM Splits</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {featureImportance.slice(0, 5).map((item) => {
            const pct = Math.round((item.importance / maxImportance) * 100);
            const label = FEATURE_NAME_MAP[item.feature] || item.feature;
            return (
              <div key={item.feature} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#1E293B' }}>
                  <span
                    style={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 175,
                    }}
                    title={label}
                  >
                    {label}
                  </span>
                  <span style={{ fontWeight: 700, color: '#0066FF' }}>
                    {Math.round(item.importance)}
                  </span>
                </div>
                <div style={{ width: '100%', height: 5, background: '#F1F4F9', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #0066FF, #00B8D9)',
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div title={featureImportanceScope.model} style={{ fontSize: 9.5, color: '#94A3B8', marginTop: 6, lineHeight: 1.35 }}>
          Fixed scope: {formatMonth(featureImportanceScope.training_period.split(' to ')[0])}–{formatMonth(featureImportanceScope.training_period.split(' to ')[1])}, n={featureImportanceScope.n_obs}. Split counts are not causal effects or percentage contributions.
        </div>
      </div>

      {/* ── 2b. Pearson Correlations with Ridership ───────────────────────────── */}
      {/* Fix 6: separate section for bivariate correlation — direction shown via colour */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <SectionTitle icon="chart-bar" variant="indigo" label="Pearson Correlations" />
          <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>vs Ridership</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {driverCorrelations.slice(0, 5).map((item) => {
            const pct = item.correlation == null ? 0 : Math.round((Math.abs(item.correlation) / maxCorrAbs) * 100);
            const label = FEATURE_NAME_MAP[item.feature] || item.feature;
            const isPositive = (item.correlation ?? 0) > 0;
            return (
              <div key={item.feature} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#1E293B' }}>
                  <span
                    style={{
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 175,
                    }}
                    title={label}
                  >
                    {label}
                  </span>
                  <span style={{ fontWeight: 700, color: isPositive ? '#00A389' : '#EF4444' }}>
                    {formatCorrelation(item.correlation)}
                  </span>
                </div>
                <div style={{ width: '100%', height: 5, background: '#F1F4F9', borderRadius: 3, overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: isPositive
                        ? 'linear-gradient(90deg, #0066FF, #00E5A3)'
                        : 'linear-gradient(90deg, #7B61FF, #EF4444)',
                      borderRadius: 3,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
        <div title={correlationPeriod.label} style={{ fontSize: 10, color: '#94A3B8', marginTop: 6, fontStyle: 'italic', lineHeight: 1.35 }}>
          {correlationPeriod.label} · n={correlationPeriod.n_obs}. Pearson r measures association, not causation. Full-history results include COVID disruption and recovery. Labour chart displays unemployment; employment remains ranked here.
        </div>
      </div>

      {/* ── 3. Model Performance & Diagnostics ─────────────────────────────────── */}
      <div style={cardStyle}>
        <SectionTitle icon="ai-chip" variant="indigo" label="Model Diagnostics" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, color: '#334155' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Forecast Model:</span>
            <strong title={selectedModel.specification} style={{ color: '#0F1E36', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedModel.name}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>{activeForecast?.horizon_months ?? '—'}M Holdout MAPE:</span>
            <span style={{ color: '#00A389', fontWeight: 700 }}>
              {activeForecast?.mape_pct != null ? `${activeForecast.mape_pct.toFixed(2)}%` : 'N/A'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Endpoint RMSE:</span>
            <strong style={{ color: '#0066FF' }}>
              {activeForecast?.rmse != null ? `${(activeForecast.rmse / 1_000_000).toFixed(2)}M trips` : 'N/A'}
            </strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Evaluation Origins:</span>
            <span style={{ color: '#64748B', fontWeight: 600 }}>
              {activeForecast?.n_cv_folds ? `${activeForecast.n_cv_folds} rolling` : 'N/A'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Prediction Period:</span>
            <span style={{ color: '#64748B', fontWeight: 600 }}>{activeForecast ? `${formatMonth(activeForecast.start_date)}–${formatMonth(activeForecast.end_date)}` : 'N/A'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Seasonal Naive MAPE:</span>
            <span style={{ color: '#64748B', fontWeight: 600 }}>{seasonalNaive?.mape_pct != null ? `${seasonalNaive.mape_pct.toFixed(2)}%` : 'N/A'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Uncertainty:</span>
            <span style={{ color: '#64748B', fontWeight: 600 }}>{activeForecast?.uncertainty_label ?? 'N/A'}</span>
          </div>
          <div title={activeForecast?.evaluation_scope} style={{ fontSize: 9.5, color: '#64748B', lineHeight: 1.35, borderTop: '1px dashed rgba(0, 102, 255, 0.15)', paddingTop: 5 }}>
            Endpoint evaluation: {activeForecast?.evaluation_scope ?? 'N/A'}; target horizon {activeForecast?.horizon_months ?? 'N/A'} months. LightGBM is used separately for driver split importance only.
          </div>
          <div style={{ fontSize: 9.5, color: '#64748B', lineHeight: 1.35 }}>
            Observed through {formatMonth(disclosure.lastObservedMonth)} · information cutoff {disclosure.informationCutoff}. No nowcast layer; targets after {formatMonth(disclosure.forecastOriginMonth)} are model projections from that cutoff.
          </div>
        </div>
      </div>

      {/* ── 4. Macro Economic Context ─────────────────────────────────────────── */}
      <div style={{ ...cardStyle, flex: 1, minHeight: 105 }}>
        <SectionTitle icon="globe-network" variant="amber" label="Macro Environment" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11, color: '#334155' }}>
          <div>
            <div style={{ fontWeight: 700, color: '#0F1E36', display: 'flex', justifyContent: 'space-between' }}>
              <span>Fuel Market Context</span>
              <span style={{ color: '#FF8C00', fontSize: 10, fontWeight: 700, background: '#FFF3E0', padding: '1px 5px', borderRadius: 4 }}>
                Unsubsidised Prices
              </span>
            </div>
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 2, lineHeight: 1.35 }}>
              RON95 and Peninsular diesel use unsubsidised retail market prices (RM/L), excluding targeted BUDI95 and SKDS subsidised tiers. Associations are not causal effects.
            </div>
          </div>
          <div style={{ borderTop: '1px dashed rgba(0, 102, 255, 0.15)', paddingTop: 5 }}>
            <div style={{ fontWeight: 700, color: '#0F1E36', display: 'flex', justifyContent: 'space-between' }}>
              <span>Labour Market Demand</span>
              <span style={{ color: '#00A389', fontSize: 10, fontWeight: 700, background: '#E0FFF6', padding: '1px 5px', borderRadius: 4 }}>
                High Employment
              </span>
            </div>
            <div style={{ color: '#475569', fontSize: 10.5, marginTop: 2, lineHeight: 1.35 }}>
              Employment is measured as DOSM employed persons; unemployment is the selected labour chart series. Neither Pearson r nor LightGBM split counts establish causation.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
