import { useState, useMemo } from 'react';
import networkData from '@/data/network_overview.json';
import type { TabId } from '@/modules/shared/types';
import { LINE_COLORS, formatMillions, formatServiceLabel } from '@/modules/shared/types';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';
import { RidershipTrendChart } from './RidershipTrendChart';
import { LinePerformanceCard } from './LinePerformanceCard';
import { KtmbDonutChart } from './KtmbDonutChart';
import { NetworkMap } from './NetworkMap';
import { getNationalRoutes } from './nationalRailNetwork';
import { MAP_STATIONS, stationMatchesLine } from './networkMapData';
import { HEADLINE_SERVICE_NAMES, computeYtdSummary, normalizeSelectedLine, resolveHeadlineSeries } from './lineMapping';
import { KpiCard } from './KpiCard';
import { TimelinePlaybar } from './TimelinePlaybar';

export type MapOverlay = 'map' | 'station' | 'od' | 'heatmap' | 'forecast';

interface NetworkOverviewProps {
  onNavigateTab?: (tab: TabId) => void;
}

export function NetworkOverview({ onNavigateTab }: NetworkOverviewProps) {
  const { kpis, monthly_trend, line_performance, ktmb_services, peak_analysis } = networkData;

  // ── Filters ──────────────────────────────────────────────────────────────
  const [selectedLine, setSelectedLine] = useState<string>('All Lines');
  const [selectedStation, setSelectedStation] = useState<string>('All Stations');
  const [pendingLine, setPendingLine] = useState<string>('All Lines');
  const [pendingStation, setPendingStation] = useState<string>('All Stations');
  const activeOverlay: MapOverlay = 'map';

  // Timeline playback
  const [playbackIdx, setPlaybackIdx] = useState<number>(monthly_trend.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);

  // Unified list: canonical 11 headline lines + geographical branches + reference corridors
  const lines = useMemo(
    () => [
      'All Lines',
      ...new Set([
        ...HEADLINE_SERVICE_NAMES,
        ...MAP_STATIONS.map(station => normalizeSelectedLine(station.line)),
        ...getNationalRoutes('All Lines').features.map(f => normalizeSelectedLine(String(f.properties?.name))),
      ]),
    ],
    [],
  );

  // Filtered and deduplicated station list based on pendingLine
  const filteredStations = useMemo(() => {
    const base = MAP_STATIONS;
    const list =
      pendingLine === 'All Lines'
        ? base.map((s) => s.name)
        : base.filter((s) => stationMatchesLine(s, pendingLine)).map((s) => s.name);
    const unique = Array.from(new Set(list)).sort((a, b) => a.localeCompare(b));
    return ['All Stations', ...unique];
  }, [pendingLine]);

  // ── Filtered KPI & YTD derived from monthly_trend up to playback month ───
  const visibleMonths = useMemo(
    () => monthly_trend.slice(0, playbackIdx + 1),
    [playbackIdx, monthly_trend]
  );
  const resolvedHeadline = useMemo(() => resolveHeadlineSeries(selectedLine), [selectedLine]);
  const headlineKey = resolvedHeadline.headlineLine;

  const filteredTotal = useMemo(() => {
    if (selectedLine === 'All Lines') {
      return visibleMonths.reduce((s, m) => s + (m.total || 0), 0);
    }
    if (!headlineKey) return 0;
    return visibleMonths.reduce((s, m) => s + (m.lines[headlineKey] || 0), 0);
  }, [visibleMonths, selectedLine, headlineKey]);

  const hasLineData =
    selectedLine === 'All Lines' ||
    (!!headlineKey &&
      visibleMonths.some(m =>
        m.line_days ? (m.line_days[headlineKey] ?? 0) > 0 : Object.hasOwn(m.lines, headlineKey),
      ));
  const selectedLinePerf = useMemo(
    () => (!headlineKey ? undefined : line_performance.find((l) => l.line === headlineKey)),
    [line_performance, headlineKey]
  );
  const visibleEndMonth = visibleMonths[visibleMonths.length - 1]?.year_month ?? kpis.headline_end.slice(0, 7);
  const includesFullComparisonYear = visibleEndMonth >= `${kpis.data_period}-12`;
  const activeYoy = !hasLineData || !includesFullComparisonYear
    ? null
    : selectedLine === 'All Lines'
      ? kpis.yoy_growth_pct
      : (selectedLinePerf?.yoy_growth_pct ?? null);
  const yoyBadge = activeYoy !== null ? `${activeYoy >= 0 ? '▲' : '▼'} ${Math.abs(activeYoy)}% YoY` : undefined;
  const yoyBadgeColor = activeYoy !== null && activeYoy < 0 ? '#EF4444' : undefined;
  const periodRangeLabel = selectedLine === 'All Lines'
    ? (playbackIdx === monthly_trend.length - 1 ? kpis.headline_period : `${kpis.headline_start.slice(0, 7)}–${visibleEndMonth}`)
    : (selectedLinePerf?.active_period ?? kpis.headline_period);

  const tripsSubBase = !hasLineData
    ? 'No ridership supplied for this line'
    : activeYoy !== null
      ? `${kpis.comparison_year}–${kpis.data_period} YoY · ${periodRangeLabel}`
      : selectedLinePerf && selectedLinePerf.yoy_growth_pct === null && includesFullComparisonYear
        ? `${periodRangeLabel} · no 2024–25 base`
        : periodRangeLabel;
  const tripsSub =
    hasLineData && resolvedHeadline.isCombinedBranch && resolvedHeadline.combinedLabel
      ? `${resolvedHeadline.combinedLabel} · ${activeYoy !== null ? `${kpis.comparison_year}–${kpis.data_period} YoY` : periodRangeLabel}`
      : tripsSubBase;

  const tripsTooltip = !hasLineData
    ? 'Reference/supplementary corridor with no headline ridership series.'
    : selectedLine === 'All Lines'
      ? `${filteredTotal.toLocaleString()} cumulative headline trips (${periodRangeLabel}). Full-year ${kpis.data_period} vs ${kpis.comparison_year}: +${kpis.yoy_growth_pct}%.${kpis.ytd_comparison_label && kpis.ytd_yoy_growth_pct !== null ? ` Equivalent ${kpis.ytd_comparison_label}: +${kpis.ytd_yoy_growth_pct}%.` : ''}`
      : resolvedHeadline.isCombinedBranch
        ? `${selectedLine} branch filter: separate branch headline totals are unavailable in official headline series. Displaying official ${resolvedHeadline.combinedLabel} total (${filteredTotal.toLocaleString()} cumulative trips through ${visibleEndMonth}; ${selectedLinePerf?.active_period ?? periodRangeLabel}).`
        : `${selectedLine}: ${filteredTotal.toLocaleString()} cumulative trips through ${visibleEndMonth}.${selectedLinePerf ? ` Active headline range: ${selectedLinePerf.active_period}.` : ''}`;

  const ytdSummary = useMemo(
    () => computeYtdSummary(monthly_trend, selectedLine, playbackIdx),
    [monthly_trend, selectedLine, playbackIdx],
  );
  const ytdBadgeText = ytdSummary.ytdGrowthPct !== null
    ? `${ytdSummary.ytdGrowthPct >= 0 ? '▲' : '▼'} ${Math.abs(ytdSummary.ytdGrowthPct)}% YTD`
    : 'YTD N/A';

  const handleApply = () => {
    setSelectedLine(pendingLine);
    setSelectedStation(pendingStation);
  };

  const handleReset = () => {
    setPendingLine('All Lines');
    setPendingStation('All Stations');
    setSelectedLine('All Lines');
    setSelectedStation('All Stations');
  };

  const handleSelectLine = (line: string) => {
    const normalized = normalizeSelectedLine(line);
    setPendingLine(normalized);
    setSelectedLine(normalized);
    setPendingStation('All Stations');
    setSelectedStation('All Stations');
  };

  const handleStationClick = (stationName: string, lineName?: string) => {
    if (lineName) {
      const normalized = normalizeSelectedLine(lineName);
      setPendingLine(normalized);
      setSelectedLine(normalized);
    }
    setPendingStation(stationName);
    setSelectedStation(stationName);
  };

  return (
    <div className="network-overview"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 58px)',
        background: '#F1F4F9',
        overflow: 'hidden',
      }}
    >
      {/* ── KPI Strip ──────────────────────────────────────────────────────── */}
      <div className="network-overview-kpis"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          padding: '12px 16px 0',
        }}
      >
        <KpiCard
          type="trips"
          delayIndex={0}
          label="Total trips"
          value={hasLineData ? formatMillions(filteredTotal) : 'No data'}
          badge={yoyBadge}
          badgeColor={yoyBadgeColor}
          sub={tripsSub}
          tooltip={tripsTooltip}
        />
        <KpiCard
          type="busiest"
          delayIndex={1}
          label="Busiest line"
          value={kpis.busiest_line}
          sub={`${kpis.busiest_line_share_pct}% share · ${kpis.headline_period}`}
          tooltip={`${kpis.busiest_line}: ${kpis.busiest_line_total.toLocaleString()} cumulative headline trips (${kpis.busiest_line_share_pct}% of ${kpis.total_rail_trips.toLocaleString()} total across 11 rail series, ${kpis.headline_period}). Later-opening lines span fewer years.`}
        />
        <KpiCard
          type="peak"
          delayIndex={2}
          label="Peak hour"
          value={kpis.peak_hour_window}
          sub={kpis.peak_hour_sub}
          tooltip={kpis.peak_hour_note}
          withBarChart
          hourly_profile={peak_analysis.weekday_mon_fri.hourly_profile}
          peakWindows={{
            amStart: peak_analysis.weekday_mon_fri.am_peak_2h.start_hour,
            amEnd: peak_analysis.weekday_mon_fri.am_peak_2h.end_hour,
            pmStart: peak_analysis.weekday_mon_fri.pm_peak_2h.start_hour,
            pmEnd: peak_analysis.weekday_mon_fri.pm_peak_2h.end_hour,
          }}
        />
      </div>

      {/* ── Main Content Row ───────────────────────────────────────────────── */}
      <div className="network-overview-main">
        {/* ── Left Sidebar ───────────────────────────────────────────────── */}
        <aside className="network-overview-sidebar network-overview-left-sidebar" aria-label="Network controls and ridership trend">
          {/* Network Filters Card */}
          <div className="network-overview-card network-filter-card" style={cardStyle}>
            <SectionTitle icon="telemetry-sliders" label="Network Filters" variant="cobalt" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <FilterRow label="Rail Line">
                <select
                  aria-label="Rail line"
                  value={pendingLine}
                  onChange={(e) => {
                    setPendingLine(e.target.value);
                    setPendingStation('All Stations');
                  }}
                  style={selectStyle}
                >
                  {lines.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </FilterRow>
              <FilterRow label="Station">
                <select
                  aria-label="Station"
                  value={pendingStation}
                  onChange={(e) => setPendingStation(e.target.value)}
                  style={selectStyle}
                >
                  {filteredStations.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </FilterRow>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={handleApply} style={applyBtnStyle}>
                Apply
              </button>
              <button onClick={handleReset} style={resetBtnStyle} title="Reset">
                ↺
              </button>
            </div>
          </div>

          {/* Ridership Trend Card — Year-to-Date summary (replaces cumulative duplication) */}
          <div
            className="network-overview-card network-ridership-card"
            style={cardStyle}
            title={
              !ytdSummary.hasHeadlineData
                ? 'Reference/supplementary corridor with no headline ridership series.'
                : `${ytdSummary.isCombinedBranch && ytdSummary.combinedLabel ? `${ytdSummary.combinedLabel} · ` : ''}Year-to-Date (${ytdSummary.periodLabel}): ${(ytdSummary.ytdTrips ?? 0).toLocaleString()} trips.${ytdSummary.prevYtdTrips !== null && ytdSummary.ytdGrowthPct !== null ? ` Equivalent prior year: ${ytdSummary.prevYtdTrips.toLocaleString()} (${ytdSummary.ytdGrowthPct >= 0 ? '+' : ''}${ytdSummary.ytdGrowthPct}%).` : ' Prior-year equivalent YTD baseline unavailable.'}`
            }
          >
            <SectionTitle icon="trend-down" label="Ridership Trend" variant="teal" />
            <div style={{ fontWeight: 800, fontSize: 22, color: '#0F1E36' }}>
              {ytdSummary.hasHeadlineData && ytdSummary.ytdTrips !== null ? formatMillions(ytdSummary.ytdTrips) : 'No data'}
            </div>
            {ytdSummary.hasHeadlineData && (
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    background:
                      ytdSummary.ytdGrowthPct === null
                        ? '#F1F5F9'
                        : ytdSummary.ytdGrowthPct < 0
                          ? '#FEE2E2'
                          : '#E0FFF6',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    color:
                      ytdSummary.ytdGrowthPct === null
                        ? '#64748B'
                        : ytdSummary.ytdGrowthPct < 0
                          ? '#EF4444'
                          : '#00C48C',
                  }}
                >
                  {ytdBadgeText}
                </div>
                <span style={{ fontSize: 10.5, color: '#64748B', fontWeight: 500 }}>
                  {ytdSummary.isCombinedBranch && ytdSummary.combinedLabel
                    ? `${ytdSummary.combinedLabel} · ${ytdSummary.comparisonPeriodLabel}`
                    : ytdSummary.comparisonPeriodLabel}
                </span>
              </div>
            )}
            <RidershipTrendChart
              monthly_trend={monthly_trend}
              selectedLine={selectedLine}
              playbackIdx={playbackIdx}
            />
          </div>

        </aside>

        {/* ── Map Area ───────────────────────────────────────────────────── */}
        <div className="network-overview-map-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="network-map-frame" style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            {/* Map Card */}
            <div
              style={{
                ...cardStyle,
                height: '100%',
                padding: 0,
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <NetworkMap
                selectedLine={selectedLine}
                selectedStation={selectedStation}
                activeOverlay={activeOverlay}
                playbackMonth={monthly_trend[playbackIdx]?.year_month ?? ''}
                monthly_trend={monthly_trend}
                onResetFocus={handleReset}
                onSelectStation={handleStationClick}
                onNavigateTab={onNavigateTab}
              />
            </div>
          </div>

          {/* Timeline Playback Bar */}
          <TimelinePlaybar
            monthly_trend={monthly_trend}
            playbackIdx={playbackIdx}
            isPlaying={isPlaying}
            onIdxChange={setPlaybackIdx}
            onPlayPause={() => setIsPlaying((p) => !p)}
          />
        </div>

        {/* ── Right Sidebar ──────────────────────────────────────────────── */}
        <aside className="network-overview-sidebar network-overview-right-sidebar" aria-label="Rail service performance">
          <div className="network-overview-card network-line-performance-card" style={cardStyle}>
            <SectionTitle
              icon="chart-bar"
              label="Line Performance"
              variant="cobalt"
              tooltip={`Cumulative shares (${kpis.headline_period}) and complete-year YoY (${kpis.comparison_year} vs ${kpis.data_period}). Newer lines without full 2024–25 operations omit YoY.`}
            />
            <LinePerformanceCard
              line_performance={line_performance}
              selectedLine={selectedLine}
              onSelectLine={handleSelectLine}
            />
          </div>

          <div className="network-overview-card network-ktmb-card" style={cardStyle}>
            <SectionTitle
              icon="transit-rail"
              label="KTMB Services"
              variant="indigo"
              tooltip={`Observed KTMB daily ridership (${networkData.coverage.ktmb_daily.start} to ${networkData.coverage.ktmb_daily.end}; Shuttle Tebrau from Jun 2022, Komuter from Sep 2023).`}
            />
            <div className="network-ktmb-content">
              <KtmbDonutChart ktmb_services={ktmb_services} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function SectionTitle({ icon, label, variant = 'cobalt', tooltip }: { icon: TelemetryIconName; label: string; variant?: TelemetryVariant; tooltip?: string }) {
  return (
    <div title={tooltip} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
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

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '14px',
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
  color: '#fff',
  border: 'none',
  borderRadius: 7,
  padding: '7px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  boxShadow: '0 2px 8px rgba(0, 102, 255, 0.3)',
};
const resetBtnStyle: React.CSSProperties = {
  width: 32,
  background: '#F1F4F9',
  color: '#64748B',
  border: '1px solid rgba(0, 0, 0, 0.1)',
  borderRadius: 7,
  fontSize: 15,
  cursor: 'pointer',
};

export default NetworkOverview;
export { LINE_COLORS, formatMillions, formatServiceLabel };
