import React, { useEffect, useMemo, useState } from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import type {
  BottleneckStatus,
  CapacityCoverageSchema,
  CapacityHourlyProfilesSchema,
  CapacityMethodologySchema,
  CapacityMode,
  CapacityScreeningSummarySchema,
  DayProfileFilter,
  DisplayTableRow,
  ExplorerViewMode,
  NetworkFilter,
  PeriodScope,
  ScreenedSegmentRecord,
  ScreenedStationRecord,
  ScreeningFilters,
  SortDirection,
  StatMode,
  StatusFilter,
  UnavailableStationRecord,
} from './capacityScreeningTypes';
import {
  buildDisplayRows,
  computeKpiSummary,
  evaluateSegmentMetrics,
  formatCompactNumber,
  formatHourLabel,
  generateDynamicDirectives,
  getNetworkShortLabel,
  getSliceMetrics,
  serializeRowsToCsv,
  sortDisplayRows,
} from './capacityScreeningUtils';
import { HourlyDemandCapacityChart } from './HourlyDemandCapacityChart';
import { StationBoardingBar } from './StationBoardingBar';

interface LoadedCapacityDatasets {
  summary: CapacityScreeningSummarySchema;
  hourly: CapacityHourlyProfilesSchema;
  coverage: CapacityCoverageSchema;
  methodology: CapacityMethodologySchema;
}

const DEFAULT_FILTERS: ScreeningFilters = {
  network: 'all',
  dayProfile: 'weekday',
  period: 'aug18_nov26_all',
  capacityMode: 'official_2023_nominal',
  statMode: 'max_date',
  searchQuery: '',
  statusFilter: 'all',
  includeUnavailable: false,
};

const PERIOD_LABELS: Record<PeriodScope, string> = {
  aug18_nov26_all: 'Aug 18–Nov 26, 2026',
  '2026-11': 'Nov 1–26, 2026',
  '2026-10': 'Oct 1–31, 2026',
  '2026-09': 'Sep 1–30, 2026',
  '2026-08': 'Aug 18–31, 2026',
};

const PAGE_SIZE = 12;

type SortField = 'loadRatio' | 'deficit' | 'demand' | 'extraTrains' | 'name';

function StatusBadge({ status }: { status: BottleneckStatus }) {
  if (status === 'deficit') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          color: '#DC2626',
        }}
      >
        Deficit (&gt;100%)
      </span>
    );
  }
  if (status === 'watch') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          background: '#FFFBEB',
          border: '1px solid #FDE68A',
          color: '#B45309',
        }}
      >
        Watch (80–100%)
      </span>
    );
  }
  if (status === 'within_capacity') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          background: '#F0FDFA',
          border: '1px solid #99F6E4',
          color: '#0D9488',
        }}
      >
        Within Capacity
      </span>
    );
  }
  if (status === 'no_service') {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          padding: '3px 9px',
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 600,
          background: '#F1F5F9',
          border: '1px solid #CBD5E1',
          color: '#475569',
        }}
      >
        No Service
      </span>
    );
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: '#F1F5F9',
        border: '1px solid #CBD5E1',
        color: '#64748B',
      }}
    >
      Unavailable
    </span>
  );
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.12)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.06)',
};

export function CapacityServiceBottlenecks() {
  const [data, setData] = useState<LoadedCapacityDatasets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filters, setFilters] = useState<ScreeningFilters>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>('segment');
  const [sortField, setSortField] = useState<SortField>('loadRatio');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [page, setPage] = useState<number>(1);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null);
  const [selectedSegmentIdOverride, setSelectedSegmentIdOverride] = useState<string | null>(null);
  const [showCoverageModal, setShowCoverageModal] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('@/data/module2_capacity_screening/capacity_screening_summary.json'),
      import('@/data/module2_capacity_screening/capacity_hourly_profiles.json'),
      import('@/data/module2_capacity_screening/capacity_coverage.json'),
      import('@/data/module2_capacity_screening/capacity_methodology.json'),
    ])
      .then(([sum, hr, cov, meth]) => {
        if (cancelled) return;
        const summary = (sum.default || sum) as unknown as CapacityScreeningSummarySchema;
        setData({
          summary,
          hourly: (hr.default || hr) as unknown as CapacityHourlyProfilesSchema,
          coverage: (cov.default || cov) as unknown as CapacityCoverageSchema,
          methodology: (meth.default || meth) as unknown as CapacityMethodologySchema,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to load capacity screening datasets.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const segmentById = useMemo(
    () => new Map<string, ScreenedSegmentRecord>((data?.summary.segments ?? []).map((s) => [s.segment_id, s])),
    [data]
  );
  const stationByKey = useMemo(
    () => new Map<string, ScreenedStationRecord>((data?.summary.stations ?? []).map((s) => [s.station_key, s])),
    [data]
  );
  const unavailableByKey = useMemo(
    () => new Map<string, UnavailableStationRecord>((data?.summary.unavailable_stations ?? []).map((u) => [u.station_key, u])),
    [data]
  );

  const kpis = useMemo(() => {
    if (!data) {
      return {
        peakLoadRatioPct: null,
        peakSegmentLabel: 'Loading...',
        peakContextLabel: 'Loading...',
        oversubscribedCount: 0,
        watchCount: 0,
        totalEvaluatedCount: 0,
        totalSegmentDeficitDays: 0,
        maxSingleSegmentExtraTrains: 0,
        maxExtraTrainsSegmentLabel: 'Loading...',
        activeDaysCount: 0,
      };
    }
    return computeKpiSummary(data.summary, filters);
  }, [data, filters]);

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const raw = buildDisplayRows(data.summary, filters, viewMode);
    return sortDisplayRows(raw, sortField, sortDir);
  }, [data, filters, viewMode, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedRows = useMemo(
    () => sortedRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedRows, safePage]
  );

  // Determine actively focused spotlight item cleanly
  const activeSelection = useMemo(() => {
    if (!data) return { kind: 'empty' as const };
    const firstValid = sortedRows[0] ?? null;
    const chosenRow: DisplayTableRow | null =
      (selectedRowKey && sortedRows.find((r) => r.rowKey === selectedRowKey)) || firstValid;

    if (!chosenRow) {
      return { kind: 'empty' as const };
    }
    if (chosenRow.kind === 'unavailable_station') {
      const unavail = unavailableByKey.get(chosenRow.rowKey) ?? null;
      return {
        kind: 'unavailable' as const,
        row: chosenRow,
        unavailable: unavail,
      };
    }

    const stRecord = chosenRow.stationKey ? stationByKey.get(chosenRow.stationKey) ?? null : null;
    let activeSegId = chosenRow.segmentId ?? stRecord?.outbound_segments[0]?.segment_id ?? null;
    if (
      selectedSegmentIdOverride &&
      stRecord &&
      stRecord.outbound_segments.some((o) => o.segment_id === selectedSegmentIdOverride)
    ) {
      activeSegId = selectedSegmentIdOverride;
    }

    const segRecord = activeSegId ? segmentById.get(activeSegId) ?? null : null;
    if (!segRecord) return { kind: 'empty' as const };

    const slice = getSliceMetrics(segRecord, filters.period, filters.dayProfile);
    const evalData = evaluateSegmentMetrics(segRecord, slice, filters.statMode, filters.capacityMode);
    const profileKey = `${segRecord.segment_id}|${filters.period}|${filters.dayProfile}`;
    const hourlyProfile =
      data.hourly.profiles[profileKey] ??
      data.hourly.profiles[`${segRecord.segment_id}|${filters.dayProfile}`] ??
      null;

    return {
      kind: 'screened' as const,
      row: chosenRow,
      station: stRecord,
      segment: segRecord,
      slice,
      evalData,
      profileKey,
      hourlyProfile,
    };
  }, [data, sortedRows, selectedRowKey, selectedSegmentIdOverride, filters, stationByKey, segmentById, unavailableByKey]);

  const directives = useMemo(
    () => (data ? generateDynamicDirectives(data.summary, filters, kpis) : []),
    [data, filters, kpis]
  );

  const updateFilter = <K extends keyof ScreeningFilters>(key: K, value: ScreeningFilters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
    setPage(1);
  };

  const handleSelectRow = (row: DisplayTableRow) => {
    setSelectedRowKey(row.rowKey);
    setSelectedSegmentIdOverride(row.segmentId ?? null);
  };

  const handleExportCsv = () => {
    const csvContent = serializeRowsToCsv(sortedRows, filters, viewMode);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transitpulse_capacity_screening_${viewMode}_${filters.period}_${filters.dayProfile}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loadError) {
    return (
      <div style={{ ...cardStyle, padding: 18, fontSize: 12, color: '#DC2626' }}>
        Failed to load Capacity &amp; Service Bottlenecks datasets: {loadError}
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ ...cardStyle, padding: 18, fontSize: 12, color: '#64748B' }}>
        Loading Directional Capacity &amp; Service Bottlenecks telemetry…
      </div>
    );
  }

  const summaryData = data.summary;
  const hourlyData = data.hourly;
  const coverageData = data.coverage;
  const methodologyData = data.methodology;
  const byNetCounts = summaryData.metadata.slice_day_counts_by_net;
  const allPeriodKey = `${filters.period}|all`;
  const activeAllDaysCount =
    filters.network === 'ktm_komuter_utara'
      ? (byNetCounts?.ktm_komuter_utara?.[allPeriodKey] ?? summaryData.metadata.slice_day_counts[allPeriodKey] ?? 0)
      : (byNetCounts?.ktm_komuter_kv?.[allPeriodKey] ?? summaryData.metadata.slice_day_counts[allPeriodKey] ?? 0);

  const auditKvPct = (
    coverageData.path_assignment_audit?.ktm_komuter_kv as
      | { gtfs_overlap_window?: { assigned_share_pct?: number } }
      | undefined
  )?.gtfs_overlap_window?.assigned_share_pct;

  const auditUtaraPct = (
    coverageData.path_assignment_audit?.ktm_komuter_utara as
      | { gtfs_overlap_window?: { assigned_share_pct?: number } }
      | undefined
  )?.gtfs_overlap_window?.assigned_share_pct;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, color: '#0F1E36' }}>
      {/* Header Banner */}
      <div
        style={{
          ...cardStyle,
          padding: '16px 20px',
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <TelemetryIcon name="transit-rail" variant="cobalt" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F1E36' }}>
                Directional Capacity &amp; Service Bottlenecks Explorer
              </h2>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#E8F0FF',
                  color: '#0066FF',
                  border: '1px solid rgba(0, 102, 255, 0.2)',
                }}
              >
                Scenario Screening | GTFS Overlap: {summaryData.metadata.gtfs_window_start} to {summaryData.metadata.gtfs_window_end}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748B' }}>
              {summaryData.metadata.scenario_disclaimer}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowCoverageModal(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid rgba(0, 102, 255, 0.25)',
            background: '#F8FAFF',
            color: '#0F1E36',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <TelemetryIcon name="shield-check" variant="indigo" size={14} />
          Coverage, Provenance &amp; Methodology
        </button>
      </div>

      {/* Filter Toolbar */}
      <div
        style={{
          ...cardStyle,
          padding: '14px 16px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Eligible Service Network
          </label>
          <select
            value={filters.network}
            onChange={(e) => updateFilter('network', e.target.value as NetworkFilter)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#FFFFFF', color: '#0F1E36' }}
          >
            <option value="all">All Eligible Komuter Networks (2)</option>
            <option value="ktm_komuter_kv">KTM Komuter Klang Valley</option>
            <option value="ktm_komuter_utara">KTM Komuter Utara</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Day Profile (Mon–Fri / Weekend)
          </label>
          <select
            value={filters.dayProfile}
            onChange={(e) => updateFilter('dayProfile', e.target.value as DayProfileFilter)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#FFFFFF', color: '#0F1E36' }}
          >
            <option value="weekday">Weekday Schedule (Mon–Fri, excl. holidays)</option>
            <option value="weekend">Weekend &amp; GTFS Holiday Schedule</option>
            <option value="all">
              All Verified Days ({filters.network === 'all' && byNetCounts ? `${byNetCounts.ktm_komuter_kv?.[allPeriodKey] ?? activeAllDaysCount}d KV / ${byNetCounts.ktm_komuter_utara?.[allPeriodKey] ?? activeAllDaysCount}d Utara` : `${activeAllDaysCount}d`})
            </option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            GTFS-Aligned Observation Period
          </label>
          <select
            value={filters.period}
            onChange={(e) => updateFilter('period', e.target.value as PeriodScope)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#FFFFFF', color: '#0F1E36' }}
          >
            <option value="aug18_nov26_all">Full GTFS Window (Aug 18–Nov 26, 2026)</option>
            <option value="2026-11">Nov 2026 (Nov 1–26)</option>
            <option value="2026-10">Oct 2026 (Oct 1–31)</option>
            <option value="2026-09">Sep 2026 (Sep 1–30)</option>
            <option value="2026-08">Aug 2026 Partial (Aug 18–31)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Train Capacity Benchmark
          </label>
          <select
            value={filters.capacityMode}
            onChange={(e) => updateFilter('capacityMode', e.target.value as CapacityMode)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#FFFFFF', color: '#0F1E36' }}
          >
            <option value="official_2023_nominal">2023 Nominal Rate Card (1,118 KV / 400 Utara)</option>
            <option value="planning_sensitivity_80pct">80% Comfort Sensitivity (894 KV / 320 Utara)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 4 }}>
            Peak Aggregator Statistic
          </label>
          <select
            value={filters.statMode}
            onChange={(e) => updateFilter('statMode', e.target.value as StatMode)}
            style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#FFFFFF', color: '#0F1E36' }}
          >
            <option value="max_date">Max Observed Surge Date</option>
            <option value="p90">P90 Representative High-Demand Day</option>
            <option value="mean">Mean Operational Day</option>
          </select>
        </div>
      </div>

      {/* Dynamic 4-KPI Strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Peak Segment Load Ratio</span>
            <TelemetryIcon name="activity" variant={kpis.peakLoadRatioPct && kpis.peakLoadRatioPct > 100 ? 'amber' : 'cobalt'} />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: kpis.peakLoadRatioPct && kpis.peakLoadRatioPct > 100 ? '#DC2626' : '#0F1E36' }}>
            {kpis.peakLoadRatioPct === null ? 'N/A' : `${kpis.peakLoadRatioPct.toFixed(1)}%`}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>{kpis.peakContextLabel}</div>
        </div>

        <div style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Top Bottleneck Section</span>
            <TelemetryIcon name="od-route" variant="indigo" />
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0F1E36', lineHeight: 1.3 }}>
            {kpis.peakSegmentLabel}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 6 }}>
            Watch tier (80–100%): <strong>{kpis.watchCount}</strong> segments
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Oversubscribed Segments (&gt;100%)</span>
            <TelemetryIcon name="ranked-corridors" variant="amber" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: kpis.oversubscribedCount > 0 ? '#DC2626' : '#0D9488' }}>
            {kpis.oversubscribedCount} <span style={{ fontSize: 13, fontWeight: 600, color: '#64748B' }}>/ {kpis.totalEvaluatedCount}</span>
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
            {formatCompactNumber(kpis.totalSegmentDeficitDays)} segment-days over benchmark ({kpis.activeDaysCount}d slice)
          </div>
        </div>

        <div style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#64748B', fontWeight: 600 }}>Peak Additional Trains / Hr</span>
            <TelemetryIcon name="clock-radar" variant="teal" />
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#0F1E36' }}>
            {kpis.maxSingleSegmentExtraTrains > 0 ? `+${kpis.maxSingleSegmentExtraTrains}` : '0'}
          </div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
            Single-segment max: {kpis.maxExtraTrainsSegmentLabel}
          </div>
        </div>
      </div>

      {/* Spotlight + 24h Demand vs Capacity Panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {/* Left Navy Spotlight */}
        <div
          style={{
            background: '#0F1E36',
            color: '#F8FAFC',
            borderRadius: 12,
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            boxShadow: '0 4px 16px rgba(15, 30, 54, 0.16)',
          }}
        >
          {activeSelection.kind === 'unavailable' ? (
            <>
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Selected Station — Screening Unavailable
                </div>
                <h3 style={{ margin: '4px 0', fontSize: 20, fontWeight: 700, color: '#FFFFFF' }}>
                  {activeSelection.row.primaryName}
                </h3>
                <div style={{ fontSize: 12, color: '#CBD5E1' }}>{activeSelection.row.networkLabel}</div>
              </div>
              <StationBoardingBar
                stationName={activeSelection.row.primaryName}
                directionLabel={activeSelection.row.directionLabel}
                boardingMode="unavailable"
                capacityMode={filters.capacityMode}
                evalData={activeSelection.row.evalData}
                gtfsInterpolated={false}
                unavailableReason={activeSelection.row.unavailableReason}
                observedPaxWindow={activeSelection.row.observedPaxWindow}
                observedPaxFull2026={activeSelection.row.observedPaxFull2026}
              />
            </>
          ) : activeSelection.kind === 'screened' ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#93C5FD', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {getNetworkShortLabel(activeSelection.segment.network_code)} Spotlight
                  </div>
                  <h3 style={{ margin: '4px 0 2px', fontSize: 19, fontWeight: 700, color: '#FFFFFF' }}>
                    {activeSelection.segment.from_station_name} &rarr; {activeSelection.segment.to_station_name}
                  </h3>
                  <div style={{ fontSize: 12, color: '#CBD5E1' }}>
                    Routes: {activeSelection.segment.routes_serving.join(', ')} | Trainset Cap: {filters.capacityMode === 'official_2023_nominal' ? activeSelection.segment.train_capacity_nom : activeSelection.segment.train_capacity_80} pax
                  </div>
                </div>
                <StatusBadge status={activeSelection.evalData.status} />
              </div>

              {/* Outbound direction switcher when station has >= 2 directions */}
              {activeSelection.station && activeSelection.station.outbound_segments.length > 1 && (
                <div>
                  <div style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>
                    Switch outbound direction from {activeSelection.station.station_name}:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {activeSelection.station.outbound_segments.map((dirRef) => {
                      const active = dirRef.segment_id === activeSelection.segment.segment_id;
                      return (
                        <button
                          key={dirRef.segment_id}
                          type="button"
                          onClick={() => setSelectedSegmentIdOverride(dirRef.segment_id)}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: 6,
                            border: active ? '1px solid #3B82F6' : '1px solid rgba(148, 163, 184, 0.35)',
                            background: active ? '#1D4ED8' : 'rgba(255, 255, 255, 0.08)',
                            color: '#FFFFFF',
                            cursor: 'pointer',
                          }}
                        >
                          &rarr; {dirRef.to_station_name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Metrics Strip inside Spotlight */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>Peak Load Ratio</div>
                  <div
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: activeSelection.evalData.status === 'deficit' ? '#FCA5A5' : '#FFFFFF',
                    }}
                  >
                    {activeSelection.evalData.loadRatioPct === null
                      ? 'N/A'
                      : `${activeSelection.evalData.loadRatioPct.toFixed(1)}%`}
                  </div>
                  <div style={{ fontSize: 10, color: '#CBD5E1' }}>
                    {formatHourLabel(activeSelection.evalData.peakHour)}
                    {activeSelection.evalData.peakDate ? ` (${activeSelection.evalData.peakDate})` : ''}
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>Demand / Capacity</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#FFFFFF', marginTop: 2 }}>
                    {formatCompactNumber(activeSelection.evalData.demandValue, 0)} / {formatCompactNumber(activeSelection.evalData.scheduledCapacity, 0)}
                  </div>
                  <div style={{ fontSize: 10, color: '#CBD5E1' }}>
                    Avg daily flow: {formatCompactNumber(activeSelection.evalData.dailyAvgFlow, 0)}
                  </div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, color: '#94A3B8' }}>Segment Deficit</div>
                  <div
                    style={{
                      fontSize: 17,
                      fontWeight: 800,
                      color: (activeSelection.evalData.capacityDeficit ?? 0) > 0 ? '#FCA5A5' : '#5EEAD4',
                    }}
                  >
                    {(activeSelection.evalData.capacityDeficit ?? 0) > 0
                      ? `+${formatCompactNumber(activeSelection.evalData.capacityDeficit, 0)} pax`
                      : '0 pax'}
                  </div>
                  <div style={{ fontSize: 10, color: '#CBD5E1' }}>
                    Extra trains/hr: +{activeSelection.evalData.extraTrainsNeeded ?? 0}
                  </div>
                </div>
              </div>

              <StationBoardingBar
                stationName={activeSelection.segment.from_station_name}
                directionLabel={`-> ${activeSelection.segment.to_station_name}`}
                boardingMode={activeSelection.segment.boarding_screening_mode}
                capacityMode={filters.capacityMode}
                evalData={activeSelection.evalData}
                gtfsInterpolated={activeSelection.segment.gtfs_interpolated_missing_stop}
              />

              {activeSelection.segment.network_code === 'ktm_komuter_utara' && activeSelection.segment.sensitivity && (
                <div
                  style={{
                    background: 'rgba(245, 158, 11, 0.14)',
                    border: '1px solid rgba(251, 191, 36, 0.45)',
                    borderRadius: 8,
                    padding: '8px 10px',
                    fontSize: 11,
                    lineHeight: 1.45,
                    color: '#FEF3C7',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#FCD34D', marginBottom: 2 }}>
                    KITS Temporal Sensitivity Band ({activeSelection.segment.sensitivity.robust_p90_gt_100 ? 'Robust >100% P90 Overload' : 'Model-Sensitive Peak'})
                  </div>
                  <div>
                    Peak load spans <strong>{activeSelection.segment.sensitivity.max_lr_range[0].toFixed(1)}%–{activeSelection.segment.sensitivity.max_lr_range[1].toFixed(1)}%</strong> across forward/arrival/mixed models (P90 band: <strong>{activeSelection.segment.sensitivity.p90_lr_range[0].toFixed(1)}%–{activeSelection.segment.sensitivity.p90_lr_range[1].toFixed(1)}%</strong>; +{activeSelection.segment.sensitivity.extra_trains_range[0]}–{activeSelection.segment.sensitivity.extra_trains_range[1]} trains/hr).
                    {activeSelection.slice?.is_kits_anomaly_peak_date && activeSelection.segment.sensitivity.excl_kits_max_lr !== null
                      ? ` Peak date ${activeSelection.evalData.peakDate} coincides with KITS batch spike; ex-anomaly 50/50 peak = ${activeSelection.segment.sensitivity.excl_kits_max_lr.toFixed(1)}%.`
                      : ''}
                  </div>
                </div>
              )}

              {activeSelection.segment.network_code === 'ktm_komuter_kv' && (
                <div
                  style={{
                    background: 'rgba(59, 130, 246, 0.14)',
                    border: '1px solid rgba(96, 165, 250, 0.35)',
                    borderRadius: 8,
                    padding: '7px 10px',
                    fontSize: 11,
                    color: '#DBEAFE',
                    lineHeight: 1.4,
                  }}
                >
                  <strong>Reference-Timetable Screening:</strong> Evaluated against Nov 2026 published KTMB GTFS schedule (2026-11-09 Deepavali replacement holiday excluded from matched comparisons).
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#CBD5E1' }}>
              No rows match your current filter selection. Clear search or status filters to inspect stations.
            </div>
          )}
        </div>

        {/* Right ECharts 24h Card */}
        <div style={{ ...cardStyle, padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TelemetryIcon name="dual-waveform" variant="cobalt" />
              <div>
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F1E36' }}>
                  24-Hour Directional Demand vs. Scheduled Capacity
                </h3>
                <div style={{ fontSize: 11, color: '#64748B' }}>
                  {activeSelection.kind === 'screened'
                    ? `${activeSelection.segment.from_station_name} -> ${activeSelection.segment.to_station_name} | Red bars highlight calculated D > S excess`
                    : 'Select a screened Komuter station or segment to view its 24-hour capacity envelope'}
                </div>
              </div>
            </div>
          </div>

          {activeSelection.kind === 'screened' ? (
            <HourlyDemandCapacityChart
              profileKey={activeSelection.profileKey}
              profile={activeSelection.hourlyProfile}
              schedCatalog={hourlyData.sched_catalog}
              segmentLabel={`${activeSelection.segment.from_station_name} -> ${activeSelection.segment.to_station_name}`}
              networkCode={activeSelection.segment.network_code}
              capacityMode={filters.capacityMode}
              statMode={filters.statMode}
              dayProfile={filters.dayProfile}
              period={filters.period}
              periodLabel={PERIOD_LABELS[filters.period]}
              trainCapNom={activeSelection.segment.train_capacity_nom}
              trainCap80={activeSelection.segment.train_capacity_80}
            />
          ) : (
            <HourlyDemandCapacityChart
              profileKey="none"
              profile={null}
              schedCatalog={hourlyData.sched_catalog}
              segmentLabel="Unavailable"
              networkCode="ktm_komuter_kv"
              capacityMode={filters.capacityMode}
              statMode={filters.statMode}
              dayProfile={filters.dayProfile}
              period={filters.period}
              periodLabel={PERIOD_LABELS[filters.period]}
              trainCapNom={1118}
              trainCap80={894}
            />
          )}
        </div>
      </div>

      {/* Main Searchable, Sortable, Paginated Screening Table */}
      <div style={{ ...cardStyle, padding: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TelemetryIcon name="thermal-matrix" variant="cobalt" />
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F1E36' }}>
                {viewMode === 'segment' ? 'Directed Railway Segment Screening' : 'Station-Level Boarding & Outbound Screening'}
              </h3>
              <div style={{ fontSize: 11, color: '#64748B' }}>
                Showing {sortedRows.length} rows | Click any row to inspect hourly profile &amp; station breakdown
              </div>
            </div>
          </div>

          {/* Mode Toggle + Search + Status + CSV */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'inline-flex', background: '#F1F5F9', borderRadius: 8, padding: 3 }}>
              {(['segment', 'station'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setViewMode(m);
                    setPage(1);
                    setSelectedRowKey(null);
                  }}
                  style={{
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: viewMode === m ? '#0066FF' : 'transparent',
                    color: viewMode === m ? '#FFFFFF' : '#475569',
                  }}
                >
                  {m === 'segment' ? 'Segment View (156)' : 'Station View'}
                </button>
              ))}
            </div>

            <input
              type="search"
              placeholder="Search station (e.g. Kajang, Gurun, KLCC, Segambut Utara)..."
              value={filters.searchQuery}
              onChange={(e) => updateFilter('searchQuery', e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                fontSize: 12,
                minWidth: 250,
                color: '#0F1E36',
              }}
            />

            <select
              value={filters.statusFilter}
              onChange={(e) => updateFilter('statusFilter', e.target.value as StatusFilter)}
              style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #CBD5E1', fontSize: 12, background: '#FFFFFF', color: '#0F1E36' }}
            >
              <option value="all">All Statuses</option>
              <option value="deficit">Deficit Only (&gt;100%)</option>
              <option value="watch">Watch Tier (80–100%)</option>
              <option value="within_capacity">Within Capacity (&lt;80%)</option>
              <option value="unavailable">Unavailable Services / Stations</option>
            </select>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#334155', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filters.includeUnavailable}
                onChange={(e) => updateFilter('includeUnavailable', e.target.checked)}
              />
              Show Unavailable
            </label>

            <button
              type="button"
              onClick={handleExportCsv}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #CBD5E1',
                background: '#FFFFFF',
                color: '#0F1E36',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Export CSV
            </button>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #E2E8F0', color: '#475569', textAlign: 'left' }}>
                <th style={{ padding: '8px 10px', cursor: 'pointer' }} onClick={() => handleSortClick('name')}>
                  {viewMode === 'segment' ? 'Directed Segment' : 'Station / Outbound Direction'} {sortField === 'name' ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                </th>
                <th style={{ padding: '8px 10px' }}>Network</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSortClick('loadRatio')}>
                  Load Ratio {sortField === 'loadRatio' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSortClick('demand')}>
                  Peak Demand {sortField === 'demand' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Sched Cap (S)</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSortClick('deficit')}>
                  Deficit (D-S) {sortField === 'deficit' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                </th>
                <th style={{ padding: '8px 10px', textAlign: 'right', cursor: 'pointer' }} onClick={() => handleSortClick('extraTrains')}>
                  Extra Trains {sortField === 'extraTrains' ? (sortDir === 'desc' ? '▼' : '▲') : ''}
                </th>
                <th style={{ padding: '8px 10px' }}>Peak Hour</th>
              </tr>
            </thead>
            <tbody>
              {pagedRows.map((row) => {
                const isSelected = activeSelection.kind !== 'empty' && activeSelection.row.rowKey === row.rowKey;
                const isUnavail = row.evalData.status === 'unavailable';
                return (
                  <tr
                    key={row.rowKey}
                    onClick={() => handleSelectRow(row)}
                    style={{
                      borderBottom: '1px solid #F1F5F9',
                      cursor: 'pointer',
                      background: isSelected ? '#EFF6FF' : isUnavail ? '#F8FAFC' : '#FFFFFF',
                    }}
                  >
                    <td style={{ padding: '9px 10px' }}>
                      <div style={{ fontWeight: 700, color: '#0F1E36' }}>{row.primaryName}</div>
                      <div style={{ fontSize: 11, color: '#64748B' }}>
                        {viewMode === 'segment' ? `Routes: ${row.routesLabel}` : row.directionLabel}
                        {row.gtfsInterpolated ? ' · GTFS Southbound Reconstructed' : ''}
                      </div>
                    </td>
                    <td style={{ padding: '9px 10px', color: '#334155', fontWeight: 500 }}>{row.networkLabel}</td>
                    <td style={{ padding: '9px 10px' }}>
                      <StatusBadge status={row.evalData.status} />
                    </td>
                    <td
                      style={{
                        padding: '9px 10px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: row.evalData.status === 'deficit' ? '#DC2626' : isUnavail ? '#64748B' : '#0F1E36',
                      }}
                    >
                      {row.evalData.loadRatioPct === null ? 'Unavailable' : `${row.evalData.loadRatioPct.toFixed(1)}%`}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#0F1E36' }}>
                      {isUnavail
                        ? `${formatCompactNumber(row.observedPaxWindow)} (win)`
                        : formatCompactNumber(row.evalData.demandValue, 0)}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', color: '#475569' }}>
                      {isUnavail ? 'N/A' : formatCompactNumber(row.evalData.scheduledCapacity, 0)}
                    </td>
                    <td
                      style={{
                        padding: '9px 10px',
                        textAlign: 'right',
                        fontWeight: 700,
                        color: (row.evalData.capacityDeficit ?? 0) > 0 ? '#DC2626' : '#64748B',
                      }}
                    >
                      {isUnavail
                        ? 'Unavailable'
                        : (row.evalData.capacityDeficit ?? 0) > 0
                          ? formatCompactNumber(row.evalData.capacityDeficit, 0)
                          : '0'}
                    </td>
                    <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#0F1E36' }}>
                      {isUnavail
                        ? 'N/A'
                        : (row.evalData.extraTrainsNeeded ?? 0) > 0
                          ? `+${row.evalData.extraTrainsNeeded}`
                          : '0'}
                    </td>
                    <td style={{ padding: '9px 10px', color: '#475569', fontSize: 11 }}>
                      {isUnavail ? row.unavailableReason?.slice(0, 44) + '...' : formatHourLabel(row.evalData.peakHour)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, fontSize: 12, color: '#64748B' }}>
          <span>
            Page {safePage} of {totalPages} ({sortedRows.length} total)
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                background: safePage <= 1 ? '#F1F5F9' : '#FFFFFF',
                cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              Prev
            </button>
            <button
              type="button"
              disabled={safePage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid #CBD5E1',
                background: safePage >= totalPages ? '#F1F5F9' : '#FFFFFF',
                cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Operator Decision Directives */}
      <div style={{ ...cardStyle, padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <TelemetryIcon name="decision-directives" variant="teal" />
          <div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0F1E36' }}>
              Service Planning Directives (Scenario Screening Insights)
            </h3>
            <div style={{ fontSize: 11, color: '#64748B' }}>
              Generated dynamically from active filters and empirical GTFS / rate-card comparisons
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
          {directives.map((d) => {
            const accent =
              d.tone === 'crimson'
                ? '#DC2626'
                : d.tone === 'amber'
                  ? '#D97706'
                  : d.tone === 'cobalt'
                    ? '#0066FF'
                    : '#475569';
            return (
              <div
                key={d.id}
                style={{
                  background: '#F8FAFF',
                  border: '1px solid #E2E8F0',
                  borderLeft: `4px solid ${accent}`,
                  borderRadius: 8,
                  padding: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: accent }}>{d.badge}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 4 }}>{d.title}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1E293B', marginBottom: 6 }}>{d.metricHighlight}</div>
                <p style={{ margin: '0 0 6px', fontSize: 12, color: '#475569', lineHeight: 1.45 }}>{d.description}</p>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#0F1E36' }}>{d.actionHint}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Coverage, Provenance & Methodology Modal */}
      {showCoverageModal && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2000,
            background: 'rgba(15, 30, 54, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 14,
              maxWidth: 980,
              width: '100%',
              maxHeight: '88vh',
              overflowY: 'auto',
              padding: 22,
              boxShadow: '0 20px 50px rgba(15, 30, 54, 0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#0F1E36' }}>
                  Feasibility &amp; Coverage Matrix, Data Provenance &amp; Methodology
                </h3>
                <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                  Active comparison: {coverageData.date_window_disclosure.active_comparison_window} | Excluded: {coverageData.date_window_disclosure.excluded_pre_gtfs_window}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCoverageModal(false)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #CBD5E1',
                  background: '#F8FAFC',
                  color: '#0F1E36',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>

            {/* 7-Column Feasibility Matrix */}
            <h4 style={{ margin: '12px 0 8px', fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
              Service Feasibility &amp; Screening Coverage Matrix
            </h4>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #CBD5E1', textAlign: 'left' }}>
                    <th style={{ padding: 7 }}>Service</th>
                    <th style={{ padding: 7 }}>OD Granularity</th>
                    <th style={{ padding: 7 }}>Timetable Coverage</th>
                    <th style={{ padding: 7 }}>Capacity Reference</th>
                    <th style={{ padding: 7 }}>Hourly Segment Screening</th>
                    <th style={{ padding: 7 }}>Station Boarding Screening</th>
                    <th style={{ padding: 7 }}>Status &amp; Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageData.feasibility_matrix.map((row) => (
                    <tr key={row.service_name} style={{ borderBottom: '1px solid #E2E8F0', verticalAlign: 'top' }}>
                      <td style={{ padding: 7, fontWeight: 700, color: '#0F1E36' }}>{row.service_name}</td>
                      <td style={{ padding: 7 }}>{row.od_granularity}</td>
                      <td style={{ padding: 7 }}>{row.timetable_coverage}</td>
                      <td style={{ padding: 7 }}>{row.capacity_reference}</td>
                      <td style={{ padding: 7 }}>{row.hourly_segment_screening}</td>
                      <td style={{ padding: 7 }}>{row.station_boarding_screening}</td>
                      <td style={{ padding: 7, color: '#334155' }}>{row.status_and_reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Audit Highlights & Forensic Disclosures */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 12, border: '1px solid #E2E8F0', fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: '#0F1E36' }}>OD Path &amp; Schedule Reconciliation</div>
                <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5, color: '#334155' }}>
                  <li>Komuter KV GTFS-window OD assigned: <strong>{auditKvPct ?? 'N/A'}%</strong> (daily diff vs headline CSV = 0)</li>
                  <li>Komuter Utara GTFS-window OD assigned: <strong>{auditUtaraPct ?? 'N/A'}%</strong> (daily diff = 0)</li>
                  <li>Station flow conservation error: <strong>&lt; 1e-6</strong> (`D_in - A + B == D_out`)</li>
                  <li>Calendar holiday overrides honored: Aug 25, Aug 31, Sep 16 switched to weekend schedule</li>
                  <li>Unverified Nov 9 Deepavali holiday excluded from matched weekday &amp; KV checks (isolated in sensitivity audit)</li>
                  {coverageData.observation_window_comparison && (
                    <li>
                      Panel alignment: Panel 1 ends Nov 20 (324d) vs Panel 2 full archive ending Nov 26 (330d); GTFS screening spans Aug 18–Nov 26
                    </li>
                  )}
                </ul>
              </div>

              <div style={{ background: '#F8FAFC', borderRadius: 8, padding: 12, border: '1px solid #E2E8F0', fontSize: 12 }}>
                <div style={{ fontWeight: 700, marginBottom: 6, color: '#0F1E36' }}>Methodological &amp; Forensic Disclosures</div>
                <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5, color: '#334155' }}>
                  {coverageData.date_window_disclosure.additional_forensic_disclosures.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {coverageData.utara_temporal_sensitivity && (
              <>
                <h4 style={{ margin: '12px 0 6px', fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
                  Komuter Utara KITS Temporal-Assignment &amp; Anomaly Sensitivity Matrix
                </h4>
                <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead>
                      <tr style={{ background: '#FFFBEB', borderBottom: '2px solid #FDE68A', textAlign: 'left' }}>
                        <th style={{ padding: 6 }}>Timing Scenario</th>
                        <th style={{ padding: 6 }}>Matched %</th>
                        <th style={{ padding: 6 }}>Top Segment</th>
                        <th style={{ padding: 6 }}>Max Peak LR</th>
                        <th style={{ padding: 6 }}>Date / Hr</th>
                        <th style={{ padding: 6 }}>Segs &gt;100% (Max / P90 / Mean)</th>
                        <th style={{ padding: 6 }}>Max Extra Trains</th>
                      </tr>
                    </thead>
                    <tbody>
                      {coverageData.utara_temporal_sensitivity.network_scenarios.map((sc) => (
                        <tr key={sc.id} style={{ borderBottom: '1px solid #E2E8F0', background: sc.id === 'mixed_50_50_120m' ? '#F0F9FF' : undefined }}>
                          <td style={{ padding: 6, fontWeight: sc.id === 'mixed_50_50_120m' ? 700 : 500 }}>{sc.label}</td>
                          <td style={{ padding: 6 }}>{sc.matched_pct.toFixed(2)}%</td>
                          <td style={{ padding: 6 }}>{sc.top_segment_label}</td>
                          <td style={{ padding: 6, fontWeight: 700, color: '#B45309' }}>{sc.max_lr_pct.toFixed(1)}%</td>
                          <td style={{ padding: 6 }}>{sc.max_date} {String(sc.max_hr).padStart(2, '0')}:00</td>
                          <td style={{ padding: 6 }}>{sc.segments_gt_100_max} / {sc.segments_gt_100_p90} / {sc.segments_gt_100_mean}</td>
                          <td style={{ padding: 6 }}>+{sc.max_extra_trains}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Formulas */}
            <h4 style={{ margin: '10px 0 6px', fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
              Core Analytical Formulas &amp; Temporal Variants
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 8, fontSize: 11, color: '#334155' }}>
              {methodologyData.temporal_methods.map((tm) => (
                <div key={tm.id} style={{ background: '#F8FAFF', borderRadius: 8, padding: 10, border: '1px solid #E2E8F0' }}>
                  <div style={{ fontWeight: 700, color: '#0066FF', marginBottom: 3 }}>{tm.label}</div>
                  <div>{tm.description}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CapacityServiceBottlenecks;
