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
import { KpiCard } from './KpiCard';
import { TimelinePlaybar } from './TimelinePlaybar';

export type MapOverlay = 'map' | 'station' | 'od' | 'heatmap' | 'forecast';

interface NetworkOverviewProps {
  onNavigateTab?: (tab: TabId) => void;
}

export function NetworkOverview({ onNavigateTab }: NetworkOverviewProps) {
  const { kpis, monthly_trend, line_performance, ktmb_services } = networkData;

  // ── Filters ──────────────────────────────────────────────────────────────
  const [selectedLine, setSelectedLine] = useState<string>('All Lines');
  const [selectedStation, setSelectedStation] = useState<string>('All Stations');
  const [pendingLine, setPendingLine] = useState<string>('All Lines');
  const [pendingStation, setPendingStation] = useState<string>('All Stations');
  const [activeOverlay, setActiveOverlay] = useState<MapOverlay>('map');

  // Timeline playback
  const [playbackIdx, setPlaybackIdx] = useState<number>(monthly_trend.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);

  // Unique lines from stations
  const lines = useMemo(() => ['All Lines', ...new Set([...MAP_STATIONS.map(station => station.line), ...getNationalRoutes('All Lines').features.map(f => String(f.properties?.name))])], []);

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

  // ── Filtered KPI derived from monthly_trend up to playback month ─────────
  const visibleMonths = useMemo(
    () => monthly_trend.slice(0, playbackIdx + 1),
    [playbackIdx, monthly_trend]
  );
  const filteredTotal = useMemo(() => {
    if (selectedLine === 'All Lines') {
      return visibleMonths.reduce((s, m) => s + (m.total || 0), 0);
    }
    return visibleMonths.reduce((s, m) => s + (m.lines[selectedLine] || 0), 0);
  }, [visibleMonths, selectedLine]);

  const displayKpi = {
    ...kpis,
    total_rail_trips: selectedLine === 'All Lines' ? filteredTotal : filteredTotal,
  };
  const hasLineData = selectedLine === 'All Lines' || visibleMonths.some(m => Object.hasOwn(m.lines, selectedLine));
  const selectedLinePerf = useMemo(
    () => (selectedLine === 'All Lines' ? undefined : line_performance.find((l) => l.line === selectedLine)),
    [line_performance, selectedLine]
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
  const tripsSub = !hasLineData
    ? 'No ridership supplied for this line'
    : activeYoy !== null
      ? `${kpis.comparison_year}–${kpis.data_period} YoY · ${periodRangeLabel}`
      : selectedLinePerf && selectedLinePerf.yoy_growth_pct === null && includesFullComparisonYear
        ? `${periodRangeLabel} · no 2024–25 base`
        : periodRangeLabel;
  const tripsTooltip = !hasLineData
    ? 'Reference/supplementary corridor with no headline ridership series.'
    : selectedLine === 'All Lines'
      ? `${displayKpi.total_rail_trips.toLocaleString()} cumulative headline trips (${periodRangeLabel}). Full-year ${kpis.data_period} vs ${kpis.comparison_year}: +${kpis.yoy_growth_pct}%.${kpis.ytd_comparison_label && kpis.ytd_yoy_growth_pct !== null ? ` Equivalent ${kpis.ytd_comparison_label}: +${kpis.ytd_yoy_growth_pct}%.` : ''}`
      : `${selectedLine}: ${displayKpi.total_rail_trips.toLocaleString()} cumulative trips through ${visibleEndMonth}.${selectedLinePerf ? ` Active headline range: ${selectedLinePerf.active_period}.` : ''}`;

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

  const handleStationClick = (stationName: string, lineName?: string) => {
    if (lineName) {
      setPendingLine(lineName);
      setSelectedLine(lineName);
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
          value={hasLineData ? formatMillions(displayKpi.total_rail_trips) : 'No data'}
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
          monthly_trend={monthly_trend}
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

          {/* Ridership Trend Card */}
          <div
            className="network-overview-card network-ridership-card"
            style={cardStyle}
            title={`OpenDOSM headline ridership (${periodRangeLabel})${kpis.ytd_comparison_label && kpis.ytd_yoy_growth_pct !== null && selectedLine === 'All Lines' ? ` · Equivalent ${kpis.ytd_comparison_label}: +${kpis.ytd_yoy_growth_pct}%` : ''}`}
          >
            <SectionTitle icon="trend-down" label="Ridership Trend" variant="teal" />
            <div style={{ fontWeight: 800, fontSize: 22, color: '#0F1E36' }}>
              {hasLineData ? formatMillions(displayKpi.total_rail_trips) : 'No data'}
            </div>
            {yoyBadge && (
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: activeYoy !== null && activeYoy < 0 ? '#FEE2E2' : '#E0FFF6',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: activeYoy !== null && activeYoy < 0 ? '#EF4444' : '#00C48C',
                  marginTop: 4,
                }}
              >
                {yoyBadge}
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
