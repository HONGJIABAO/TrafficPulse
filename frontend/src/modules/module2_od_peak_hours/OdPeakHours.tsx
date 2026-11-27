import React, { useState, useMemo } from 'react';
import rawOdSummaryData from '@/data/od_summary.json';
import stationsData from '@/data/stations.json';
import { formatMillions } from '@/modules/shared/types';
import type {
  OdSummarySchema,
  OdModeFilter,
  DayTypeFilter,
  TimeRangeFilter,
  HaulFilter,
} from './types';
import { WeekdayHourHeatmap } from './WeekdayHourHeatmap';
import { WeekdayVsWeekendChart } from './WeekdayVsWeekendChart';
import { TopOdPairsList } from './TopOdPairsList';
import { OdFlowMap } from './OdFlowMap';
import { OperatorInsightStrip } from './OperatorInsightStrip';
import { OdTimelineBar } from './OdTimelineBar';
import { TripDistanceProfileCard } from './TripDistanceProfileCard';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';
import { generateDynamicInsights, selectActiveDataset } from './odAnalyticsUtils';

const odSummaryData = rawOdSummaryData as unknown as OdSummarySchema;

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  position: 'relative',
  flexShrink: 0,
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
};

const applyBtnStyle: React.CSSProperties = {
  flex: 1,
  background: 'linear-gradient(135deg, #0066FF, #0052CC)',
  color: '#FFFFFF',
  border: 'none',
  borderRadius: 7,
  padding: '8px 12px',
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
      <span style={{ fontWeight: 700, fontSize: 12.5, color: '#0F1E36', letterSpacing: '0.3px' }}>
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
          fontWeight: 500,
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

export function OdPeakHours() {
  // Applied filter state (shared single source of truth across all visuals)
  const [selectedMode, setSelectedMode] = useState<OdModeFilter>('all');
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeFilter>('12m');
  const [selectedDayType, setSelectedDayType] = useState<DayTypeFilter>('all');
  const [timelineMonthKey, setTimelineMonthKey] = useState<string | null>(null);

  // Pending control state
  const [pendingMode, setPendingMode] = useState<OdModeFilter>('all');
  const [pendingTimeRange, setPendingTimeRange] = useState<TimeRangeFilter>('12m');
  const [pendingDayType, setPendingDayType] = useState<DayTypeFilter>('all');

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [activeHaul, setActiveHaul] = useState<HaulFilter>('all');

  const isRapidRailPending = pendingMode === 'rapid_rail';

  const handlePendingModeChange = (nextMode: OdModeFilter) => {
    setPendingMode(nextMode);
    if (nextMode === 'rapid_rail') {
      // Rapid Rail daily aggregate dataset only supports Full 2026 & All Days
      setPendingTimeRange('12m');
      setPendingDayType('all');
    }
  };

  const handleApply = () => {
    setSelectedMode(pendingMode);
    setSelectedTimeRange(pendingMode === 'rapid_rail' ? '12m' : pendingTimeRange);
    setSelectedDayType(pendingMode === 'rapid_rail' ? 'all' : pendingDayType);
    if (pendingMode === 'rapid_rail') {
      setTimelineMonthKey(null);
    }
    setSelectedFlowId(null);
  };

  const handleReset = () => {
    setPendingMode('all');
    setPendingTimeRange('12m');
    setPendingDayType('all');
    setSelectedMode('all');
    setSelectedTimeRange('12m');
    setSelectedDayType('all');
    setTimelineMonthKey(null);
    setSelectedFlowId(null);
    setActiveHaul('all');
  };

  // Single centralized filtering & aggregation pipeline
  const dataset = useMemo(() => {
    return selectActiveDataset(odSummaryData, stationsData.stations, {
      mode: selectedMode,
      timeRange: selectedTimeRange,
      dayType: selectedDayType,
      timelineMonthKey,
    });
  }, [selectedMode, selectedTimeRange, selectedDayType, timelineMonthKey]);

  // Apply optional haul tier filter cleanly on top of resolved flows
  const haulFilteredFlows = useMemo(() => {
    if (activeHaul === 'all') return dataset.resolvedFlows;
    return dataset.resolvedFlows.filter((f) => f.haulCategory === activeHaul);
  }, [dataset.resolvedFlows, activeHaul]);

  // Selected flow details (derived automatically so stale selections never display)
  const activeFlow = useMemo(() => {
    if (!selectedFlowId) return null;
    return haulFilteredFlows.find((f) => f.id === selectedFlowId) || null;
  }, [haulFilteredFlows, selectedFlowId]);

  // Distance & Haul Profile metrics derived strictly from verified coordinates in current dataset
  const distanceProfileMetrics = useMemo(() => {
    const flowsWithDist = dataset.resolvedFlows.filter((f) => f.distanceKm !== null && f.volume > 0);
    const totalVol = flowsWithDist.reduce((sum, f) => sum + f.volume, 0);
    if (totalVol <= 0 || flowsWithDist.length === 0) {
      return {
        avgDist: null,
        shortPct: 0,
        medPct: 0,
        longPct: 0,
        verifiedCount: 0,
        totalCount: dataset.resolvedFlows.length,
      };
    }

    const weightedSum = flowsWithDist.reduce((sum, f) => sum + f.volume * (f.distanceKm || 0), 0);
    const avgDist = Math.round((weightedSum / totalVol) * 10) / 10;
    const shortVol = flowsWithDist.filter((f) => f.haulCategory === 'short').reduce((s, f) => s + f.volume, 0);
    const medVol = flowsWithDist.filter((f) => f.haulCategory === 'medium').reduce((s, f) => s + f.volume, 0);
    const longVol = flowsWithDist.filter((f) => f.haulCategory === 'long').reduce((s, f) => s + f.volume, 0);

    return {
      avgDist,
      shortPct: Math.round((shortVol / totalVol) * 1000) / 10,
      medPct: Math.round((medVol / totalVol) * 1000) / 10,
      longPct: Math.round((longVol / totalVol) * 1000) / 10,
      verifiedCount: flowsWithDist.length,
      totalCount: dataset.resolvedFlows.length,
    };
  }, [dataset.resolvedFlows]);

  // Dynamic Analytical Insights & Evidence-Based SDG Alignment
  const dynamicInsights = useMemo(() => {
    return generateDynamicInsights(dataset, selectedMode, selectedDayType);
  }, [dataset, selectedMode, selectedDayType]);

  // Dynamic Top Corridor (from active haul + filter view)
  const topCorridor = haulFilteredFlows[0] || null;
  const peak = dataset.peakAnalysis;

  const wdWeRatioText = useMemo(() => {
    if (dataset.weekdayAvgDailyTrips === null || dataset.weekendAvgDailyTrips === null) return null;
    if (dataset.weekendAvgDailyTrips <= 0) return '—';
    return `${(dataset.weekdayAvgDailyTrips / dataset.weekendAvgDailyTrips).toFixed(2)}× WD/WE`;
  }, [dataset.weekdayAvgDailyTrips, dataset.weekendAvgDailyTrips]);

  return (
    <div
      className="od-module-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: '#F1F4F9',
        overflowY: 'auto',
        overflowX: 'hidden',
        gap: 12,
        paddingBottom: 24,
      }}
    >
      <style>{`
        .od-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          padding: 12px 16px 0;
          flex-shrink: 0;
        }
        .od-main-grid {
          display: grid;
          grid-template-columns: 270px minmax(0, 1fr) 340px;
          gap: 12px;
          padding: 0 16px;
          flex-shrink: 0;
        }
        .od-charts-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 12px;
          padding: 0 16px;
          flex-shrink: 0;
        }
        @media (max-width: 1180px) {
          .od-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .od-main-grid {
            grid-template-columns: 260px minmax(0, 1fr);
          }
          .od-right-col-wrap {
            grid-column: 1 / -1;
            min-height: 360px !important;
          }
          .od-charts-grid {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 780px) {
          .od-kpi-grid {
            grid-template-columns: 1fr;
          }
          .od-main-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* ── 1. Top Dynamic Metric KPI Strip (4 Cards) ────────────────────────── */}
      <div className="od-kpi-grid">
        {/* KPI 1: Peak-Hour Passenger Demand */}
        <div style={cardStyle} data-testid="kpi-peak-demand">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="clock-radar" variant="amber" badge />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Peak-Hour Demand</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: dataset.hourlySupported && peak.hasData ? '#EF4444' : '#64748B',
                background: dataset.hourlySupported && peak.hasData ? '#FEE2E2' : '#F1F5F9',
                borderRadius: 4,
                padding: '1px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              {dataset.hourlySupported && peak.busiestHour
                ? `+${peak.busiestHour.pctAboveDailyMean}% vs hr avg`
                : 'Daily OD Only'}
            </span>
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            {dataset.hourlySupported && peak.busiestHour
              ? peak.busiestHour.windowLabel
              : 'Hourly Unavailable'}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2, lineHeight: 1.35 }}>
            {dataset.hourlySupported && peak.busiestHour
              ? `${Math.round(peak.busiestHour.avgTrips).toLocaleString()} trips/hr · Eve: ${
                  peak.eveningPeak ? peak.eveningPeak.windowLabel : '—'
                }`
              : 'Rapid Rail open data contains daily totals without hourly timestamps'}
          </div>
        </div>

        {/* KPI 2: Top Directional OD Corridor */}
        <div style={cardStyle} data-testid="kpi-top-corridor">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="od-route" variant="cobalt" badge />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Top OD Corridor</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#0066FF',
                background: '#E8F0FF',
                borderRadius: 4,
                padding: '1px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              {topCorridor ? `#1 Directional OD` : 'No Match'}
            </span>
          </div>
          <div
            style={{
              fontSize: 17,
              fontWeight: 800,
              color: '#0F1E36',
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={topCorridor ? `${topCorridor.originClean} ➔ ${topCorridor.destinationClean}` : 'Unavailable'}
          >
            {topCorridor ? `${topCorridor.originClean} ➔ ${topCorridor.destinationClean}` : 'No OD Pair'}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {topCorridor
              ? `${topCorridor.volume.toLocaleString()} trips · ${Math.round(
                  topCorridor.avgDaily
                ).toLocaleString()}/day (${topCorridor.observationDays}d)`
              : 'Adjust filters to inspect corridor rankings'}
          </div>
        </div>

        {/* KPI 3: Total Trips & Directional Corridors */}
        <div style={cardStyle} data-testid="kpi-total-trips">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="ranked-corridors" variant="indigo" badge />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>
                {dataset.networkTotalIsExact ? 'Total Passenger Trips' : 'Observed OD Volume'}
              </span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#4F46E5',
                background: '#EEF2FF',
                borderRadius: 4,
                padding: '1px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              {dataset.uniqueOdCorridorsCount !== null
                ? `${dataset.uniqueOdCorridorsCount.toLocaleString()} Dir. Pairs`
                : '0 Pairs'}
            </span>
          </div>
          <div style={{ fontSize: 19, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            {dataset.networkTotalTrips !== null
              ? `${formatMillions(dataset.networkTotalTrips)} trips`
              : 'Unavailable'}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {dataset.networkAvgDailyTrips !== null
              ? `Avg ${Math.round(dataset.networkAvgDailyTrips).toLocaleString()}/day across ${
                  dataset.activeDaysDenominator
                } valid days${!dataset.networkTotalIsExact ? ' (RR Top-20)' : ''}`
              : 'No valid observations for current filter'}
          </div>
        </div>

        {/* KPI 4: Weekday vs Weekend Avg Daily & Midday Off-Peak */}
        <div style={cardStyle} data-testid="kpi-wd-we-comparison">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="offpeak-drop" variant="teal" badge />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Weekday vs Weekend</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: wdWeRatioText ? '#0D9488' : '#64748B',
                background: wdWeRatioText ? '#E0FFF6' : '#F1F5F9',
                borderRadius: 4,
                padding: '1px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              {wdWeRatioText || 'Daily Agg. Only'}
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            {dataset.weekdayAvgDailyTrips !== null && dataset.weekendAvgDailyTrips !== null
              ? `${Math.round(dataset.weekdayAvgDailyTrips).toLocaleString()} vs ${Math.round(
                  dataset.weekendAvgDailyTrips
                ).toLocaleString()}/d`
              : 'Split Unavailable'}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {dataset.hourlySupported && peak.middayLull
              ? `${selectedMode === 'all' && !dataset.rapidRailCoverageNote ? 'KTMB only · ' : ''}12 PM: ${Math.round(peak.middayLull.noonTrips).toLocaleString()}/hr (-${
                  peak.middayLull.dropVsBusiestPct
                }% vs peak)`
              : `Mon–Fri (${dataset.weekdayDays}d) vs Sat–Sun (${dataset.weekendDays}d) unavailable`}
          </div>
        </div>
      </div>

      {/* Transparent Coverage Disclosure Banner (whenever sub-period/day limitations apply) */}
      {(dataset.rapidRailCoverageNote || !dataset.hasData) && (
        <div style={{ padding: '0 16px', flexShrink: 0 }}>
          <div
            style={{
              background: !dataset.hasData ? '#FEF2F2' : '#EFF6FF',
              border: `1px solid ${!dataset.hasData ? '#FCA5A5' : 'rgba(37, 99, 235, 0.25)'}`,
              borderRadius: 8,
              padding: '7px 12px',
              fontSize: 11,
              color: !dataset.hasData ? '#991B1B' : '#1E40AF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span>
              <strong>Data Coverage Notice:</strong>{' '}
              {!dataset.hasData ? dataset.emptyReason : dataset.rapidRailCoverageNote}
            </span>
            {!dataset.hasData && (
              <button
                onClick={handleReset}
                style={{
                  background: '#0066FF',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 5,
                  padding: '3px 10px',
                  fontSize: 10.5,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Reset to Full 2026
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── 2. Middle Row: 3 Columns ─────────────────────────────────────────── */}
      <div className="od-main-grid">
        {/* Left Column: Filters + Trip Distance Profile (+ Corridor Focus) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Card: OD Filters */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <SectionTitle icon="telemetry-sliders" variant="cobalt" label="OD Analytics Filters" />
            </div>

            <div
              style={{
                fontSize: 10,
                color: '#0052CC',
                background: 'rgba(0, 102, 255, 0.06)',
                borderRadius: 5,
                padding: '4px 7px',
                marginBottom: 8,
                fontWeight: 600,
              }}
              data-testid="active-date-range"
            >
              Period: {dataset.dateRange} ({dataset.activeDaysDenominator} valid days)
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {/* Rail Mode */}
              <FilterRow label="Rail Network Mode">
                <select
                  aria-label="Rail Network Mode"
                  value={pendingMode}
                  onChange={(e) => handlePendingModeChange(e.target.value as OdModeFilter)}
                  style={selectStyle}
                >
                  <option value="all">All Rail Modes (2026 Common Window)</option>
                  <option value="rapid_rail">Rapid Rail (LRT &amp; MRT — Daily Only)</option>
                  <option value="komuter">KTM Komuter (Hourly &amp; Daily)</option>
                  <option value="intercity">KTM Intercity &amp; ETS (Hourly &amp; Daily)</option>
                </select>
              </FilterRow>

              {/* Time Range */}
              <FilterRow label="Time Horizon">
                <select
                  aria-label="Time Horizon"
                  value={pendingTimeRange}
                  disabled={isRapidRailPending}
                  onChange={(e) => setPendingTimeRange(e.target.value as TimeRangeFilter)}
                  style={{
                    ...selectStyle,
                    opacity: isRapidRailPending ? 0.55 : 1,
                    cursor: isRapidRailPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value="12m">Full 2026 Observed (Jan 1 – Nov 20 · 324d)</option>
                  <option value="q4">Q4 2026 Partial (Oct 1 – Nov 20 · 51d)</option>
                  <option value="q3">Q3 2026 (Jul 1 – Sep 30 · 92d)</option>
                  <option value="q2">Q2 2026 (Apr 1 – Jun 30 · 91d)</option>
                  <option value="q1">Q1 2026 (Jan 1 – Mar 31 · 90d)</option>
                </select>
              </FilterRow>

              {/* Day Type (Malaysian Mon-Fri Weekday / Sat-Sun Weekend) */}
              <FilterRow label="Day Profile Type">
                <select
                  aria-label="Day Profile Type"
                  value={pendingDayType}
                  disabled={isRapidRailPending}
                  onChange={(e) => setPendingDayType(e.target.value as DayTypeFilter)}
                  style={{
                    ...selectStyle,
                    opacity: isRapidRailPending ? 0.55 : 1,
                    cursor: isRapidRailPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <option value="all">All Days (Mon – Sun)</option>
                  <option value="weekday">Weekdays (Mon – Fri)</option>
                  <option value="weekend">Weekends (Sat – Sun)</option>
                </select>
              </FilterRow>
            </div>

            {isRapidRailPending && (
              <div style={{ fontSize: 9.5, color: '#EA580C', marginTop: 6, lineHeight: 1.35 }}>
                Rapid Rail local files provide Full 2026 All-Days Top-20 OD pairs only. Sub-period and weekday filters disabled.
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={handleApply} style={applyBtnStyle}>
                Apply
              </button>
              <button onClick={handleReset} style={resetBtnStyle} title="Reset Filters">
                ↺
              </button>
            </div>
          </div>

          {/* Card: Trip Distance & Haul Profile */}
          <TripDistanceProfileCard
            activeHaul={activeHaul}
            onSelectHaul={setActiveHaul}
            avgDistance={distanceProfileMetrics.avgDist}
            shortPct={distanceProfileMetrics.shortPct}
            medPct={distanceProfileMetrics.medPct}
            longPct={distanceProfileMetrics.longPct}
            verifiedCount={distanceProfileMetrics.verifiedCount}
            totalCount={distanceProfileMetrics.totalCount}
          />

          {/* Card: Active Corridor Focus Inspector */}
          {activeFlow && (
            <div
              style={{
                ...cardStyle,
                background: 'linear-gradient(135deg, #FFFFFF 0%, #F0F6FF 100%)',
                border: '1px solid rgba(0, 102, 255, 0.25)',
                boxShadow: '0 2px 12px rgba(0, 102, 255, 0.1)',
                padding: '12px 14px',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <SectionTitle icon="corridor-focus" variant="indigo" label="Corridor Focus" />
                <button
                  onClick={() => setSelectedFlowId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748B',
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: '2px 4px',
                  }}
                  title="Close Inspector"
                >
                  ✕
                </button>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', lineHeight: 1.3, marginTop: 2 }}>
                {activeFlow.originClean}
                <span style={{ color: '#0066FF', margin: '0 4px' }}>➔</span>
                {activeFlow.destinationClean}
              </div>

              <div style={{ marginTop: 8, fontSize: 11, color: '#475569', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Period Total ({activeFlow.observationDays}d):</span>
                  <strong style={{ color: '#0066FF' }}>{activeFlow.volume.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Daily Average:</span>
                  <strong style={{ color: '#0F1E36' }}>{activeFlow.avgDaily.toLocaleString()} / day</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Mode Share:</span>
                  <strong>{activeFlow.sharePct}%</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Straight-line Dist:</span>
                  <strong style={{ color: '#0066FF' }}>
                    {activeFlow.distanceKm !== null ? `${activeFlow.distanceKm} km` : 'Unverified'}
                  </strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Network:</span>
                  <span style={{ fontWeight: 600 }}>{activeFlow.modeLabel}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Classification:</span>
                  <span style={{ fontWeight: 600, color: '#00A389' }}>{activeFlow.corridorType}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Center Column: Passenger OD Flow Map Card + Genuine 2026 Timeline Bar */}
        <div
          style={{
            ...cardStyle,
            padding: 0,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            height: '100%',
            minHeight: 440,
          }}
        >
          <div
            style={{
              padding: '10px 14px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(0, 102, 255, 0.08)',
              background: '#FFFFFF',
              zIndex: 2,
              flexShrink: 0,
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="od-route" variant="cobalt" badge size={14} style={{ width: 26, height: 26 }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: '#0F1E36', letterSpacing: '0.3px' }}>
                Passenger OD Flow Map
              </span>
            </div>
            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
              {haulFilteredFlows.length} Directional Corridors · {dataset.periodLabel}
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 330, position: 'relative' }}>
            <OdFlowMap
              flows={haulFilteredFlows}
              selectedFlowId={selectedFlowId}
              onSelectFlow={(f) => setSelectedFlowId(f.id)}
              selectedMode={selectedMode}
              emptyReason={dataset.emptyReason}
            />
          </div>

          <OdTimelineBar
            months={odSummaryData.monthly_totals || []}
            selectedMonthKey={timelineMonthKey}
            onSelectMonthKey={setTimelineMonthKey}
            disabled={selectedMode === 'rapid_rail'}
            style={{
              borderRadius: '0 0 12px 12px',
              border: 'none',
              borderTop: '1px solid rgba(0, 102, 255, 0.1)',
              boxShadow: 'none',
              background: '#FFFFFF',
            }}
          />
        </div>

        {/* Right Column: Top Passenger OD Pairs */}
        <div className="od-right-col-wrap" style={{ position: 'relative', height: '100%', minHeight: 440 }}>
          <div
            style={{
              ...cardStyle,
              position: 'absolute',
              inset: 0,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, flexShrink: 0 }}>
              <SectionTitle icon="ranked-corridors" variant="indigo" label="Top Passenger OD Pairs" />
              <span style={{ fontSize: 10, color: '#64748B' }}>{haulFilteredFlows.length} pairs</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <TopOdPairsList
                flows={haulFilteredFlows}
                selectedFlowId={selectedFlowId}
                onSelectFlow={(f) => setSelectedFlowId(f.id)}
                emptyReason={dataset.emptyReason}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Lower Row: Heatmap (Left) + Weekday vs Weekend (Right) ────────── */}
      <div className="od-charts-grid">
        <div style={{ ...cardStyle, padding: '12px 14px', minHeight: 270 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <SectionTitle icon="thermal-matrix" variant="amber" label="Weekday × Hour Passenger Demand Heatmap" />
            <span style={{ fontSize: 10, color: '#64748B' }}>
              Mon–Fri Weekday · Sat–Sun Weekend
            </span>
          </div>
          <WeekdayHourHeatmap
            heatmapPoints={dataset.heatmapPoints}
            selectedMode={selectedMode}
            selectedDayType={selectedDayType}
            hourlySupported={dataset.hourlySupported}
            coverageNote={dataset.hourlyCoverageNote}
            emptyReason={dataset.emptyReason}
          />
        </div>

        <div style={{ ...cardStyle, padding: '12px 14px', minHeight: 270 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <SectionTitle icon="dual-waveform" variant="cobalt" label="Weekday vs Weekend Hourly Profile" />
            <span style={{ fontSize: 10, color: '#64748B' }}>
              Avg Daily Trips / Hour
            </span>
          </div>
          <WeekdayVsWeekendChart
            data={dataset.weekdayVsWeekend}
            selectedMode={selectedMode}
            selectedDayType={selectedDayType}
            hourlySupported={dataset.hourlySupported}
            coverageNote={dataset.hourlyCoverageNote}
            peakAnalysis={dataset.peakAnalysis}
            emptyReason={dataset.emptyReason}
          />
        </div>
      </div>

      {/* ── 4. Dynamic Analytical Insights & Service Planning Strip ─────────── */}
      <div style={{ padding: '0 16px', flexShrink: 0 }}>
        <OperatorInsightStrip insights={dynamicInsights} />
      </div>
    </div>
  );
}

export default OdPeakHours;
