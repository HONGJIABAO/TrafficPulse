import React, { useEffect, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { formatMillions } from '@/modules/shared/types';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import type {
  DemandDayType,
  DemandHourWindow,
  DemandMetricFocus,
  SortDirection,
  SortField,
  StationDailyProfilesPayload,
  StationDemandCoveragePayload,
  StationDemandFilterState,
  StationDemandSummaryPayload,
  StationHourlyProfilesPayload,
  StationInventoryPayload,
  StationNetworkFilter,
  StationServiceKey,
} from './stationDemandTypes';
import {
  DEFAULT_STATION_DEMAND_FILTERS,
  buildStationCsvContent,
  computeDailySeriesSummary,
  computeObservationDays,
  computeSpotlightMetrics,
  formatHourClock24,
  formatHourWindow24,
  generateStationDemandInsight,
  getAvailabilityBadgeTone,
  getAvailableLines,
  getServiceOptionsForNetwork,
  resolveStationRows,
  sortStationRows,
} from './stationDemandUtils';

const PAGE_SIZE = 10;

const cardShellStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.12)',
  boxShadow: '0 2px 14px rgba(0, 102, 255, 0.07)',
  padding: '16px 18px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
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

const HOUR_LABELS_24 = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

interface LoadedDatasets {
  inventory: StationInventoryPayload;
  summary: StationDemandSummaryPayload;
  hourly: StationHourlyProfilesPayload;
  daily: StationDailyProfilesPayload;
  coverage: StationDemandCoveragePayload;
}

export const StationDemandIntelligence: React.FC = () => {
  const [data, setData] = useState<LoadedDatasets | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [filters, setFilters] = useState<StationDemandFilterState>(DEFAULT_STATION_DEMAND_FILTERS);
  const [sortField, setSortField] = useState<SortField>('rank');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [page, setPage] = useState<number>(1);
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null);
  const [showCoverageDrawer, setShowCoverageDrawer] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import('@/data/module2_station_demand/station_inventory.json'),
      import('@/data/module2_station_demand/station_demand_summary.json'),
      import('@/data/module2_station_demand/station_hourly_profiles.json'),
      import('@/data/module2_station_demand/station_daily_profiles.json'),
      import('@/data/module2_station_demand/station_demand_coverage.json'),
    ])
      .then(([inv, sum, hr, dly, cov]) => {
        if (cancelled) return;
        setData({
          inventory: (inv.default || inv) as unknown as StationInventoryPayload,
          summary: (sum.default || sum) as unknown as StationDemandSummaryPayload,
          hourly: (hr.default || hr) as unknown as StationHourlyProfilesPayload,
          daily: (dly.default || dly) as unknown as StationDailyProfilesPayload,
          coverage: (cov.default || cov) as unknown as StationDemandCoveragePayload,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : 'Unable to load station demand datasets.');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const serviceOptions = useMemo(
    () => getServiceOptionsForNetwork(filters.network),
    [filters.network]
  );

  const lineOptions = useMemo(() => {
    if (!data) return [];
    return getAvailableLines(data.inventory.stations, filters.network, filters.service);
  }, [data, filters.network, filters.service]);

  const periodOptions = useMemo(() => {
    if (!data) return [];
    const catalog = data.summary.period_catalog || {};
    const orderedKeys = [
      '12m',
      'q1',
      'q2',
      'q3',
      'q4',
      ...Object.keys(catalog)
        .filter((k) => k.startsWith('2026-'))
        .sort(),
    ];
    return orderedKeys
      .filter((k) => Boolean(catalog[k]))
      .map((k) => ({ key: k, label: catalog[k].label }));
  }, [data]);

  const resolvedRows = useMemo(() => {
    if (!data) return [];
    return resolveStationRows(data.inventory, data.summary, data.hourly, filters);
  }, [data, filters]);

  const sortedRows = useMemo(
    () => sortStationRows(resolvedRows, sortField, sortDirection),
    [resolvedRows, sortField, sortDirection]
  );

  const observationDays = useMemo(() => {
    if (!data) return 324;
    return computeObservationDays(data.summary, filters.period, filters.dayType);
  }, [data, filters.period, filters.dayType]);

  const spotlight = useMemo(
    () => computeSpotlightMetrics(resolvedRows, observationDays),
    [resolvedRows, observationDays]
  );

  const insight = useMemo(
    () => generateStationDemandInsight(spotlight, filters, data?.coverage || null),
    [spotlight, filters, data?.coverage]
  );

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  const pageRows = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return sortedRows.slice(start, start + PAGE_SIZE);
  }, [sortedRows, safePage]);

  const maxBarValue = useMemo(() => {
    const vals = resolvedRows
      .map((r) => r.activeWindowValue)
      .filter((v): v is number => v !== null && v > 0);
    return vals.length > 0 ? Math.max(...vals) : 1;
  }, [resolvedRows]);

  const activeStationRow = useMemo(() => {
    if (sortedRows.length === 0) return null;
    if (selectedStationId) {
      const found = sortedRows.find((r) => r.station.id === selectedStationId);
      if (found) return found;
    }
    return sortedRows[0];
  }, [sortedRows, selectedStationId]);

  const dailySeriesInfo = useMemo(() => {
    if (!activeStationRow || !data) return null;
    return computeDailySeriesSummary(activeStationRow, data.daily, filters.period, filters.dayType);
  }, [activeStationRow, data, filters.period, filters.dayType]);

  // ECharts option for KTMB 24h Hourly Station Demand Profile
  const hourlyBarOption = useMemo(() => {
    if (!activeStationRow || !activeStationRow.hourlyProfile24) return null;
    const profile = activeStationRow.hourlyProfile24;
    const pkHour = activeStationRow.peakHour;
    const activeHour = filters.hourWindow === 'selected_hour' ? filters.selectedHour : null;

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 30, 54, 0.94)',
        borderColor: 'rgba(0, 102, 255, 0.4)',
        textStyle: { color: '#FFFFFF', fontSize: 11 },
        formatter: (params: Array<{ dataIndex: number; value: number }>) => {
          const item = params[0];
          if (!item) return '';
          const h = item.dataIndex;
          const isPk = pkHour === h;
          return `<strong>${formatHourWindow24(h)} MYT</strong>${
            isPk ? ' <span style="color:#60A5FA;">(Station Peak)</span>' : ''
          }<br/>Origin Trips/Hr: <strong>${Number(item.value).toLocaleString()}</strong>`;
        },
      },
      grid: { left: 42, right: 12, top: 20, bottom: 26 },
      xAxis: {
        type: 'category',
        data: HOUR_LABELS_24,
        axisLabel: {
          color: '#64748B',
          fontSize: 9.5,
          interval: 3,
        },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLabel: {
          color: '#64748B',
          fontSize: 9.5,
          formatter: (val: number) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`),
        },
      },
      series: [
        {
          name: 'Origin Trips/Hr',
          type: 'bar',
          barWidth: '64%',
          data: profile.map((v, h) => {
            const isPeak = pkHour === h;
            const isSelectedHour = activeHour === h;
            const inAm = filters.hourWindow === 'am_peak' && h >= 6 && h <= 9;
            const inPm = filters.hourWindow === 'pm_peak' && h >= 17 && h <= 20;
            let color = '#93C5FD';
            if (isSelectedHour) color = '#EA580C';
            else if (isPeak) color = '#0066FF';
            else if (inAm || inPm) color = '#3B82F6';
            return {
              value: Math.round(v * 10) / 10,
              itemStyle: {
                color,
                borderRadius: [3, 3, 0, 0],
              },
            };
          }),
        },
      ],
    };
  }, [activeStationRow, filters.hourWindow, filters.selectedHour]);

  // ECharts option for Rapid Rail Daily Series OR KTMB Monthly Series
  const dailyTrendOption = useMemo(() => {
    if (!dailySeriesInfo || dailySeriesInfo.labels.length === 0) return null;
    const isDaily = dailySeriesInfo.mode === 'daily';
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 30, 54, 0.94)',
        borderColor: 'rgba(0, 102, 255, 0.4)',
        textStyle: { color: '#FFFFFF', fontSize: 11 },
      },
      grid: { left: 46, right: 12, top: 16, bottom: 26 },
      xAxis: {
        type: 'category',
        data: dailySeriesInfo.labels,
        axisLabel: {
          color: '#64748B',
          fontSize: 9.5,
          interval: isDaily ? Math.max(1, Math.floor(dailySeriesInfo.labels.length / 5)) : 1,
          formatter: (val: string) => (isDaily ? val.slice(5) : val.replace('2026-', 'M')),
        },
        axisLine: { lineStyle: { color: '#E2E8F0' } },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#F1F5F9' } },
        axisLabel: {
          color: '#64748B',
          fontSize: 9.5,
          formatter: (val: number) => (val >= 1000 ? `${(val / 1000).toFixed(1)}k` : `${val}`),
        },
      },
      series: [
        {
          name: isDaily ? 'Daily Origin Trips' : 'Avg Daily Trips',
          type: 'line',
          smooth: false,
          symbol: isDaily ? 'none' : 'circle',
          symbolSize: 5,
          lineStyle: { color: '#0066FF', width: 2 },
          itemStyle: { color: '#0066FF' },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(0, 102, 255, 0.24)' },
                { offset: 1, color: 'rgba(0, 102, 255, 0.02)' },
              ],
            },
          },
          data: dailySeriesInfo.values,
        },
      ],
    };
  }, [dailySeriesInfo]);

  const handleSort = (field: SortField) => {
    setPage(1);
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'rank' || field === 'name' || field === 'service' ? 'asc' : 'desc');
    }
  };

  const updateFilters = (patch: Partial<StationDemandFilterState>) => {
    setPage(1);
    setFilters((prev) => {
      const next = { ...prev, ...patch };
      // If user picks BRT or KTMB GTFS Only explicitly, show unmeasured stops automatically
      if (
        patch.network === 'brt' ||
        patch.service === 'brt' ||
        patch.service === 'ktmb_gtfs_only'
      ) {
        next.includeUnmeasuredStops = true;
      }
      // Validate service belongs to network
      if (patch.network !== undefined) {
        const validServices = getServiceOptionsForNetwork(next.network).map((o) => o.value);
        if (!validServices.includes(next.service)) {
          next.service = 'all';
        }
        next.line = 'all';
      }
      if (patch.service !== undefined && data) {
        const availLines = getAvailableLines(data.inventory.stations, next.network, next.service);
        if (next.line !== 'all' && !availLines.includes(next.line)) {
          next.line = 'all';
        }
      }
      return next;
    });
  };

  const handleExportCsv = () => {
    if (!data) return;
    const periodLabel = data.summary.period_catalog?.[filters.period]?.label || filters.period;
    const scopeLabel = `${filters.network} / ${filters.service} / ${filters.line} / ${periodLabel} / ${filters.dayType} / ${filters.hourWindow}`;
    const csvText = buildStationCsvContent(sortedRows, scopeLabel);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transitpulse_station_demand_${filters.period}_${filters.network}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loadError) {
    return (
      <div style={{ ...cardShellStyle, borderColor: '#FCA5A5', background: '#FEF2F2' }}>
        <strong style={{ color: '#991B1B', fontSize: 13 }}>
          Failed to load Station Demand Intelligence datasets
        </strong>
        <span style={{ color: '#7F1D1D', fontSize: 12 }}>{loadError}</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={cardShellStyle} data-testid="station-demand-loading">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TelemetryIcon name="ranked-corridors" variant="cobalt" badge />
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0F1E36' }}>
              Loading Station-Level Passenger Demand Intelligence…
            </div>
            <div style={{ fontSize: 11.5, color: '#64748B' }}>
              Hydrating verified station inventory across Rapid Rail and 5 KTMB services (2026-01-01 to 2026-11-20)
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activePeriodMeta = data.summary.period_catalog?.[filters.period];
  const isDailyFocusOrRapidOnly = filters.network === 'rapid_rail' || filters.service === 'rapid_rail';

  return (
    <div style={cardShellStyle} data-testid="station-demand-intelligence">
      {/* 1. Header & Data Coverage Drawer Toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <TelemetryIcon name="ranked-corridors" variant="cobalt" badge />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0F1E36' }}>
                Station-Level Passenger Demand Intelligence
              </h3>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: '#0052CC',
                  background: '#E8F0FF',
                  borderRadius: 5,
                  padding: '2px 7px',
                }}
              >
                6 Official OD Datasets · {data.inventory.physical_stations_with_od} Measured Physical Stations
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: '#64748B', marginTop: 2 }}>
              Aligned 2026 baseline ({data.coverage.aligned_common_window}) ·
              Origin-station ridership with strict KTMB hourly vs Rapid Rail daily distinction
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setShowCoverageDrawer((v) => !v)}
            data-testid="toggle-coverage-drawer"
            style={{
              background: showCoverageDrawer ? '#0F1E36' : '#F8FAFF',
              color: showCoverageDrawer ? '#FFFFFF' : '#0F1E36',
              border: '1px solid rgba(0, 102, 255, 0.25)',
              borderRadius: 7,
              padding: '6px 11px',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {showCoverageDrawer ? 'Hide Data Coverage & Audit' : 'Data Coverage & Exclusions'}
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            data-testid="export-station-csv"
            style={{
              background: '#0066FF',
              color: '#FFFFFF',
              border: 'none',
              borderRadius: 7,
              padding: '6px 12px',
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0, 102, 255, 0.25)',
            }}
          >
            Export CSV ({sortedRows.length})
          </button>
        </div>
      </div>

      {/* Collapsible Official Coverage & Reconciliation Audit Panel */}
      {showCoverageDrawer && (
        <div
          data-testid="coverage-audit-drawer"
          style={{
            background: '#F8FAFF',
            border: '1px solid rgba(0, 102, 255, 0.18)',
            borderRadius: 10,
            padding: '12px 14px',
            fontSize: 11.5,
            color: '#334155',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ color: '#0F1E36' }}>
              Official Dataset Reconciliation &amp; Exclusions ({data.coverage.aligned_common_window})
            </strong>
            <span style={{ color: '#047857', fontWeight: 700 }}>
              Rapid Rail A0 Check:{' '}
              {data.coverage.services.rapid_rail.a0_origin_reconciliation.exact_zero_delta_matches.toLocaleString()} /{' '}
              {data.coverage.services.rapid_rail.a0_origin_reconciliation.station_date_pairs_checked.toLocaleString()}{' '}
              station-dates exact (Δ ={' '}
              {data.coverage.services.rapid_rail.a0_origin_reconciliation.max_abs_delta})
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))',
              gap: 8,
            }}
          >
            {Object.entries(data.coverage.services).map(([svcKey, svc]) => {
              const isRapidRail = svcKey === 'rapid_rail';
              const delta = isRapidRail
                ? data.coverage.services.rapid_rail.a0_origin_reconciliation.max_abs_delta
                : 'reconciliation_vs_ktmb_daily' in svc
                ? svc.reconciliation_vs_ktmb_daily.max_abs_delta
                : 0;
              return (
                <div
                  key={svcKey}
                  style={{
                    background: '#FFFFFF',
                    border: '1px solid #E2E8F0',
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#0F1E36', fontSize: 11 }}>{svc.service_label}</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0066FF', marginTop: 2 }}>
                    {svc.total_origin_trips_aligned.toLocaleString()} trips
                  </div>
                  <div style={{ fontSize: 10, color: '#64748B', marginTop: 2 }}>
                    {isRapidRail
                      ? `Daily OD Only · A0 Δ=${delta}`
                      : `Hourly + Daily · KTMB Δ=${delta} (${svc.aligned_days}d)`}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.45 }}>
            <strong>Exclusions &amp; Unmeasured GTFS Stops:</strong>{' '}
            Penalty &amp; A0 marginals excluded from physical rankings/coordinates;{' '}
            {data.inventory.stations
              .filter((s) => !s.is_physical_station)
              .map((s) => `${s.service_label} Unknown (${(s.od_total_2026 || 0).toLocaleString()})`)
              .join(', ')}{' '}
            marked Non-Physical Administrative Codes ·{' '}
            <strong>
              GTFS Stops Without Open OD Data ({data.coverage.inventory_summary.gtfs_unmeasured_stops}):
            </strong>{' '}
            {data.inventory.stations
              .filter((s) => s.availability_status === 'unavailable_no_od_data')
              .map((g) => `${g.name} (${g.service_label})`)
              .join(', ')}
            . Extended KTMB Nov 21–26 rows trimmed to match the aligned Nov 20 baseline.
          </div>
        </div>
      )}

      {/* 2. Navy Analytical Spotlight */}
      <div
        data-testid="station-spotlight-banner"
        style={{
          background: 'linear-gradient(135deg, #0F1E36 0%, #172E54 100%)',
          borderRadius: 10,
          padding: '13px 16px',
          color: '#FFFFFF',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 14,
          boxShadow: '0 4px 14px rgba(15, 30, 54, 0.16)',
        }}
      >
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#93C5FD', letterSpacing: '0.5px' }}>
            Top Daily Origin Station
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
            {spotlight.topDailyStation ? spotlight.topDailyStation.station.name : 'No Measured Station'}
          </div>
          <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>
            {spotlight.topDailyStation
              ? `${Math.round(spotlight.topDailyStation.avgDailyTrips || 0).toLocaleString()} trips/day · ${
                  spotlight.topDailyStation.station.line
                }`
              : 'No numeric OD records in active filter'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#93C5FD', letterSpacing: '0.5px' }}>
            Top Hourly Peak Station (KTMB Only)
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
            {spotlight.topHourlyPeakStation
              ? `${spotlight.topHourlyPeakStation.station.name} (${formatHourWindow24(
                  spotlight.topHourlyPeakStation.peakHour
                )})`
              : 'Hourly Unavailable'}
          </div>
          <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>
            {spotlight.topHourlyPeakStation
              ? `${Math.round(spotlight.topHourlyPeakStation.peakHourAvg || 0).toLocaleString()} trips/hr · ${
                  spotlight.topHourlyPeakStation.station.service_label
                }`
              : 'Rapid Rail & unmeasured stops have no hourly timestamps'}
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#93C5FD', letterSpacing: '0.5px' }}>
            Filtered Scope Total Volume
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
            {formatMillions(spotlight.filteredTotalTrips)} trips
          </div>
          <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>
            Avg {Math.round(spotlight.filteredAvgDailyTrips).toLocaleString()}/day across {spotlight.observationDays}d
          </div>
        </div>

        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#93C5FD', letterSpacing: '0.5px' }}>
            Physical Station Telemetry Scope
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, marginTop: 3 }}>
            {spotlight.physicalMeasuredCount} Stations in View
          </div>
          <div style={{ fontSize: 11, color: '#CBD5E1', marginTop: 2 }}>
            {spotlight.hourlySupportedCount} KTMB Hourly · {spotlight.dailyOnlyCount} Daily-Only · {spotlight.unmeasuredCount}{' '}
            Unmeasured
          </div>
        </div>
      </div>

      {/* 3. Independent Multi-Dimensional Filters */}
      <div
        data-testid="station-filters-bar"
        style={{
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: 10,
          padding: '10px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))',
            gap: 9,
          }}
        >
          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
              Rail Network
            </label>
            <select
              aria-label="Station Rail Network"
              value={filters.network}
              onChange={(e) => updateFilters({ network: e.target.value as StationNetworkFilter })}
              style={selectStyle}
            >
              <option value="all">All Networks (KTMB + Rapid Rail)</option>
              <option value="rapid_rail">Rapid Rail (Daily OD Only)</option>
              <option value="ktmb">KTMB Services (Hourly + Daily)</option>
              <option value="brt">BRT Sunway (No OD Data)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
              Service Dataset
            </label>
            <select
              aria-label="Station Service Dataset"
              value={filters.service}
              onChange={(e) =>
                updateFilters({ service: e.target.value as 'all' | StationServiceKey })
              }
              style={selectStyle}
            >
              {serviceOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
              Line / Corridor
            </label>
            <select
              aria-label="Station Line"
              value={filters.line}
              onChange={(e) => updateFilters({ line: e.target.value })}
              style={selectStyle}
            >
              <option value="all">All Lines ({lineOptions.length})</option>
              {lineOptions.map((lineName) => (
                <option key={lineName} value={lineName}>
                  {lineName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
              Observation Period
            </label>
            <select
              aria-label="Station Time Period"
              value={filters.period}
              onChange={(e) => updateFilters({ period: e.target.value })}
              style={selectStyle}
            >
              {periodOptions.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
              Day Profile
            </label>
            <select
              aria-label="Station Day Profile"
              value={filters.dayType}
              onChange={(e) => updateFilters({ dayType: e.target.value as DemandDayType })}
              style={selectStyle}
            >
              <option value="all">All Days ({activePeriodMeta?.all_days ?? 324}d)</option>
              <option value="weekday">Weekdays Mon–Fri ({activePeriodMeta?.weekday_days ?? 232}d)</option>
              <option value="weekend">Weekends Sat–Sun ({activePeriodMeta?.weekend_days ?? 92}d)</option>
            </select>
          </div>

          <div>
            <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
              Hour Window (KTMB Only)
            </label>
            <select
              aria-label="Station Hour Window"
              disabled={isDailyFocusOrRapidOnly}
              value={isDailyFocusOrRapidOnly ? 'all' : filters.hourWindow}
              onChange={(e) => updateFilters({ hourWindow: e.target.value as DemandHourWindow })}
              style={{
                ...selectStyle,
                opacity: isDailyFocusOrRapidOnly ? 0.55 : 1,
                cursor: isDailyFocusOrRapidOnly ? 'not-allowed' : 'pointer',
              }}
            >
              <option value="all">All Hours (Daily Total)</option>
              <option value="am_peak">Morning Peak (06:00–09:59 MYT)</option>
              <option value="pm_peak">Evening Peak (17:00–20:59 MYT)</option>
              <option value="selected_hour">Selected Single Hour (00–23)</option>
            </select>
          </div>

          {filters.hourWindow === 'selected_hour' && !isDailyFocusOrRapidOnly && (
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 3 }}>
                Specific Hour (MYT)
              </label>
              <select
                aria-label="Specific Hour Selector"
                value={filters.selectedHour}
                onChange={(e) => updateFilters({ selectedHour: Number(e.target.value) })}
                style={selectStyle}
              >
                {HOUR_LABELS_24.map((lbl, h) => (
                  <option key={h} value={h}>
                    {lbl} – {String(h).padStart(2, '0')}:59 MYT
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Search + Metric Toggle + Audit Checkboxes */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: '1 1 320px' }}>
            <input
              type="search"
              aria-label="Search stations"
              placeholder="Search station name, code (KJ10, SA07, 19100), or line..."
              value={filters.searchQuery}
              onChange={(e) => updateFilters({ searchQuery: e.target.value })}
              style={{
                ...selectStyle,
                maxWidth: 320,
                background: '#FFFFFF',
                cursor: 'text',
              }}
            />

            <div
              style={{
                display: 'inline-flex',
                background: '#E2E8F0',
                borderRadius: 7,
                padding: 2,
              }}
            >
              {(['daily_avg', 'peak_hour'] as DemandMetricFocus[]).map((focus) => {
                const active = filters.metricFocus === focus;
                const disabled = focus === 'peak_hour' && isDailyFocusOrRapidOnly;
                return (
                  <button
                    key={focus}
                    type="button"
                    disabled={disabled}
                    onClick={() => updateFilters({ metricFocus: focus, hourWindow: 'all' })}
                    style={{
                      border: 'none',
                      borderRadius: 5,
                      padding: '4px 10px',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      background: active ? '#0066FF' : 'transparent',
                      color: active ? '#FFFFFF' : disabled ? '#94A3B8' : '#334155',
                    }}
                  >
                    {focus === 'daily_avg' ? 'Rank by Avg Daily' : 'Rank by Peak Hour'}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#475569' }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filters.includeUnmeasuredStops}
                onChange={(e) => updateFilters({ includeUnmeasuredStops: e.target.checked })}
              />
              Show Unmeasured GTFS ({data.inventory.gtfs_unmeasured_stops})
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={filters.includeNonPhysicalCodes}
                onChange={(e) => updateFilters({ includeNonPhysicalCodes: e.target.checked })}
              />
              Show Unknown Admin Codes ({data.inventory.non_physical_codes})
            </label>
            <button
              type="button"
              onClick={() => {
                setFilters(DEFAULT_STATION_DEMAND_FILTERS);
                setSortField('rank');
                setSortDirection('asc');
                setPage(1);
                setSelectedStationId(null);
              }}
              style={{
                background: '#FFFFFF',
                border: '1px solid #CBD5E1',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 700,
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              Reset Station Filters
            </button>
          </div>
        </div>
      </div>

      {/* 4. Split View: Station Ranking Table (Left) + Station Deep-Dive Chart (Right) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
          gap: 14,
          alignItems: 'start',
        }}
      >
        {/* Left Panel: Paginated, Sortable Station Ranking Table */}
        <div
          style={{
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            background: '#FFFFFF',
            overflow: 'hidden',
            gridColumn: 'span 1',
          }}
        >
          <div
            style={{
              padding: '9px 12px',
              background: '#F8FAFF',
              borderBottom: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: '#0F1E36' }}>
              All-Station Demand Ranking ({sortedRows.length} records · click a row for detail profile)
            </span>
            <span style={{ fontSize: 10.5, color: '#64748B' }}>
              Page {safePage} of {totalPages} · {activePeriodMeta?.label}
            </span>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table
              data-testid="station-ranking-table"
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}
            >
              <thead>
                <tr style={{ background: '#F8FAFC', borderBottom: '1px solid #E2E8F0', color: '#475569' }}>
                  {(
                    [
                      ['rank', '#'],
                      ['name', 'Station / Service / Line'],
                      ['peakHour', 'Peak Hour (MYT)'],
                      ['avgDaily', 'Daily / Metric'],
                      ['totalTrips', 'Period Total'],
                    ] as Array<[SortField, string]>
                  ).map(([field, label]) => (
                    <th
                      key={field}
                      onClick={() => handleSort(field)}
                      style={{
                        textAlign: field === 'rank' || field === 'name' ? 'left' : 'right',
                        padding: '8px 10px',
                        fontWeight: 700,
                        fontSize: 10.5,
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                      {sortField === field ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748B' }}>
                      No stations match the active filters. Try clearing search or widening network scope.
                    </td>
                  </tr>
                ) : (
                  pageRows.map((row) => {
                    const st = row.station;
                    const isSelected = activeStationRow?.station.id === st.id;
                    const badgeTone = getAvailabilityBadgeTone(st.availability_status);
                    const val = row.activeWindowValue;
                    const barPct =
                      val !== null && maxBarValue > 0 ? Math.min(100, Math.round((val / maxBarValue) * 100)) : 0;

                    return (
                      <tr
                        key={st.id}
                        data-testid={`station-row-${st.id}`}
                        onClick={() => setSelectedStationId(st.id)}
                        style={{
                          cursor: 'pointer',
                          background: isSelected ? '#EFF6FF' : '#FFFFFF',
                          borderBottom: '1px solid #F1F5F9',
                          boxShadow: isSelected ? 'inset 3px 0 0 #0066FF' : undefined,
                        }}
                      >
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#0F1E36', whiteSpace: 'nowrap' }}>
                          {row.rank !== null ? `#${row.rank}` : '—'}
                        </td>
                        <td style={{ padding: '8px 10px', minWidth: 185 }}>
                          <div style={{ fontWeight: 700, color: '#0F1E36', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span>{st.name}</span>
                            {st.station_code && (
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  color: '#475569',
                                  background: '#F1F5F9',
                                  borderRadius: 4,
                                  padding: '1px 5px',
                                }}
                              >
                                {st.station_code}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 10, color: '#64748B', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                            <span>{st.service_label} · {st.line}</span>
                            <span
                              style={{
                                fontSize: 9,
                                fontWeight: 700,
                                background: badgeTone.bg,
                                color: badgeTone.color,
                                border: `1px solid ${badgeTone.border}`,
                                borderRadius: 4,
                                padding: '0 4px',
                              }}
                            >
                              {st.hourly_supported
                                ? 'Hourly'
                                : st.availability_status === 'unavailable_no_od_data'
                                ? 'No OD Data'
                                : st.is_physical_station
                                ? 'Daily Only'
                                : 'Admin Code'}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {st.hourly_supported && row.peakHour !== null ? (
                            <div>
                              <div style={{ fontWeight: 700, color: '#0052CC' }}>
                                {formatHourClock24(row.peakHour)} MYT
                              </div>
                              <div style={{ fontSize: 10, color: '#64748B' }}>
                                {Math.round(row.peakHourAvg || 0).toLocaleString()}/hr
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: 10, fontWeight: 600, color: '#64748B' }}>
                              {st.availability_status === 'unavailable_no_od_data'
                                ? 'No Data'
                                : 'Hourly Unavailable'}
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', minWidth: 110 }}>
                          {val !== null ? (
                            <div>
                              <div style={{ fontWeight: 800, color: '#0F1E36' }}>
                                {val.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                              </div>
                              <div
                                style={{
                                  height: 4,
                                  width: '100%',
                                  background: '#E2E8F0',
                                  borderRadius: 99,
                                  marginTop: 4,
                                  overflow: 'hidden',
                                }}
                              >
                                <div
                                  style={{
                                    height: '100%',
                                    width: `${barPct}%`,
                                    background: '#0066FF',
                                    borderRadius: 99,
                                  }}
                                />
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: 10.5, color: '#64748B' }}>Hourly Unavailable</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                          {row.totalTrips !== null ? row.totalTrips.toLocaleString() : 'No Data'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div
            style={{
              padding: '8px 12px',
              background: '#F8FAFC',
              borderTop: '1px solid #E2E8F0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              color: '#475569',
            }}
          >
            <span>
              Showing {sortedRows.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1}–
              {Math.min(safePage * PAGE_SIZE, sortedRows.length)} of {sortedRows.length}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                type="button"
                data-testid="station-page-prev"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                style={{
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  borderRadius: 5,
                  padding: '3px 9px',
                  cursor: safePage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: safePage <= 1 ? 0.5 : 1,
                }}
              >
                Prev
              </button>
              <button
                type="button"
                data-testid="station-page-next"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                style={{
                  border: '1px solid #CBD5E1',
                  background: '#FFFFFF',
                  borderRadius: 5,
                  padding: '3px 9px',
                  cursor: safePage >= totalPages ? 'not-allowed' : 'pointer',
                  opacity: safePage >= totalPages ? 0.5 : 1,
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel: Selected Station Telemetry Profile */}
        <div
          data-testid="station-detail-panel"
          style={{
            border: '1px solid #E2E8F0',
            borderRadius: 10,
            background: '#FFFFFF',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {!activeStationRow ? (
            <div style={{ padding: 24, textAlign: 'center', color: '#64748B', fontSize: 12 }}>
              Select a station from the table to inspect its hourly or daily demand profile.
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#0066FF', textTransform: 'uppercase' }}>
                    {activeStationRow.station.service_label} · {activeStationRow.station.line}
                  </div>
                  <h4 style={{ margin: '2px 0 0', fontSize: 15, fontWeight: 800, color: '#0F1E36' }}>
                    {activeStationRow.station.name}
                    {activeStationRow.station.station_code ? ` (${activeStationRow.station.station_code})` : ''}
                  </h4>
                  <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 2 }}>
                    {activeStationRow.station.physical_interchange_name
                      ? `Interchange Hub: ${activeStationRow.station.physical_interchange_name}`
                      : activeStationRow.station.operator}{' '}
                    ·{' '}
                    {activeStationRow.station.coordinate_verified && activeStationRow.station.lat !== null
                      ? `${activeStationRow.station.lat.toFixed(4)}, ${activeStationRow.station.lng?.toFixed(4)}`
                      : 'Coordinates Excluded / Non-Physical'}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '3px 7px',
                    borderRadius: 5,
                    background: getAvailabilityBadgeTone(activeStationRow.station.availability_status).bg,
                    color: getAvailabilityBadgeTone(activeStationRow.station.availability_status).color,
                    border: `1px solid ${getAvailabilityBadgeTone(activeStationRow.station.availability_status).border}`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeStationRow.station.availability_label}
                </span>
              </div>

              {/* Detail Mini KPIs */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                <div style={{ background: '#F8FAFF', borderRadius: 8, padding: '7px 9px' }}>
                  <div style={{ fontSize: 9.5, color: '#64748B', fontWeight: 600 }}>Avg Daily Trips</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0F1E36', marginTop: 2 }}>
                    {activeStationRow.avgDailyTrips !== null
                      ? Math.round(activeStationRow.avgDailyTrips).toLocaleString()
                      : 'No Data'}
                  </div>
                  <div style={{ fontSize: 9.5, color: '#64748B' }}>
                    {activeStationRow.positiveDays}/{activeStationRow.observationDays} active d
                  </div>
                </div>

                <div style={{ background: '#F8FAFF', borderRadius: 8, padding: '7px 9px' }}>
                  <div style={{ fontSize: 9.5, color: '#64748B', fontWeight: 600 }}>Peak Hour (MYT)</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0066FF', marginTop: 2 }}>
                    {activeStationRow.station.hourly_supported && activeStationRow.peakHour !== null
                      ? formatHourClock24(activeStationRow.peakHour)
                      : 'Unavailable'}
                  </div>
                  <div style={{ fontSize: 9.5, color: '#64748B' }}>
                    {activeStationRow.peakHourAvg !== null
                      ? `${Math.round(activeStationRow.peakHourAvg).toLocaleString()} trips/hr`
                      : 'Daily OD Only'}
                  </div>
                </div>

                <div style={{ background: '#F8FAFF', borderRadius: 8, padding: '7px 9px' }}>
                  <div style={{ fontSize: 9.5, color: '#64748B', fontWeight: 600 }}>Period Total</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#0F1E36', marginTop: 2 }}>
                    {activeStationRow.totalTrips !== null
                      ? activeStationRow.totalTrips.toLocaleString()
                      : 'No Data'}
                  </div>
                  <div style={{ fontSize: 9.5, color: '#64748B' }}>
                    {activePeriodMeta?.date_range || '2026-01-01..2026-11-20'}
                  </div>
                </div>
              </div>

              {/* Conditional Chart: KTMB 24h Hourly Bar vs Rapid Rail Daily Series vs No-OD */}
              {activeStationRow.station.availability_status === 'unavailable_no_od_data' ? (
                <div
                  style={{
                    background: '#F8FAFC',
                    border: '1px dashed #CBD5E1',
                    borderRadius: 8,
                    padding: '22px 14px',
                    textAlign: 'center',
                    fontSize: 11.5,
                    color: '#475569',
                  }}
                >
                  <strong>No Open Ridership OD Data Available</strong>
                  <div style={{ marginTop: 4 }}>
                    This verified GTFS stop appears in schedule feeds only; no public Rapid Rail or KTMB OD logs record passenger volume here.
                  </div>
                </div>
              ) : activeStationRow.station.hourly_supported && hourlyBarOption ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0F1E36' }}>
                      24-Hour Origin Demand Profile (MYT)
                    </span>
                    <span style={{ fontSize: 10, color: '#64748B' }}>
                      AM 06–09: {Math.round(activeStationRow.amWindowAvg || 0).toLocaleString()} · PM 17–20:{' '}
                      {Math.round(activeStationRow.pmWindowAvg || 0).toLocaleString()}
                    </span>
                  </div>
                  <ReactECharts option={hourlyBarOption} style={{ height: 215, width: '100%' }} />
                  <div style={{ fontSize: 9.5, color: '#64748B', marginTop: 2 }}>
                    {data.hourly.timestamp_note}
                  </div>
                </div>
              ) : (
                <div>
                  <div
                    data-testid="rapid-rail-hourly-disclosure"
                    style={{
                      background: '#EFF6FF',
                      border: '1px solid #BFDBFE',
                      borderRadius: 8,
                      padding: '8px 10px',
                      fontSize: 11,
                      color: '#1E40AF',
                      marginBottom: 8,
                    }}
                  >
                    <strong>Hourly Demand Profile Unavailable:</strong> Prasarana Rapid Rail publishes daily AFC OD totals without hourly timestamps. Showing verified daily demand trajectory across the active window instead.
                  </div>
                  {dailyTrendOption && (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0F1E36' }}>
                          Daily Origin Demand Trajectory
                        </span>
                        {dailySeriesInfo && (
                          <span style={{ fontSize: 10, color: '#475569' }}>
                            WD {Math.round(dailySeriesInfo.weekdayAvg || 0).toLocaleString()}/d · WE{' '}
                            {Math.round(dailySeriesInfo.weekendAvg || 0).toLocaleString()}/d
                          </span>
                        )}
                      </div>
                      <ReactECharts option={dailyTrendOption} style={{ height: 195, width: '100%' }} />
                    </>
                  )}
                </div>
              )}

              {/* For KTMB Hourly stations, also show Monthly WD vs WE summary line */}
              {activeStationRow.station.hourly_supported && dailyTrendOption && (
                <div style={{ borderTop: '1px solid #F1F5F9', paddingTop: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
                      Monthly Daily-Average Progression (Jan–Nov 2026)
                    </span>
                    {dailySeriesInfo && (
                      <span style={{ fontSize: 10, color: '#64748B' }}>
                        WD Avg {Math.round(dailySeriesInfo.weekdayAvg || 0).toLocaleString()} · WE Avg{' '}
                        {Math.round(dailySeriesInfo.weekendAvg || 0).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <ReactECharts option={dailyTrendOption} style={{ height: 135, width: '100%' }} />
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 5. Evidence-Based Station Demand Insight & Shah Alam Disclosure */}
      <div
        data-testid="station-insight-footer"
        style={{
          background: '#F8FAFF',
          border: '1px solid rgba(0, 102, 255, 0.14)',
          borderRadius: 9,
          padding: '10px 13px',
          fontSize: 11.5,
          color: '#1E293B',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <div style={{ fontWeight: 700, color: '#0F1E36' }}>{insight.headline}</div>
        <div style={{ color: '#475569', fontSize: 11, lineHeight: 1.45 }}>{insight.detail}</div>
        {insight.shahAlamDisclosure && (
          <div style={{ color: '#9A3412', background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 6, padding: '5px 8px', fontSize: 10.5 }}>
            {insight.shahAlamDisclosure}
          </div>
        )}
      </div>
    </div>
  );
};

export default StationDemandIntelligence;
