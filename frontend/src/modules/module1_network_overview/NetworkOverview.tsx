import { useState, useMemo } from 'react';
import networkData from '@/data/network_overview.json';
import type { TabId } from '@/modules/shared/types';
import { LINE_COLORS, formatMillions, formatServiceLabel } from '@/modules/shared/types';
import { RidershipTrendChart } from './RidershipTrendChart';
import { LinePerformanceCard } from './LinePerformanceCard';
import { KtmbDonutChart } from './KtmbDonutChart';
import { NetworkMap } from './NetworkMap';
import { MAP_STATIONS } from './networkMapData';
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
  const lines = useMemo(() => ['All Lines', ...new Set(MAP_STATIONS.map(station => station.line))], []);

  // Filtered and deduplicated station list based on pendingLine
  const filteredStations = useMemo(() => {
    const base = MAP_STATIONS;
    const list =
      pendingLine === 'All Lines'
        ? base.map((s) => s.name)
        : base.filter((s) => s.line === pendingLine).map((s) => s.name);
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
    total_rail_trips: selectedLine === 'All Lines' ? kpis.total_rail_trips : filteredTotal,
  };
  const hasLineData = selectedLine === 'All Lines' || visibleMonths.some(m => Object.hasOwn(m.lines, selectedLine));

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
          badge={hasLineData ? `▲ ${kpis.yoy_growth_pct}% YoY` : undefined}
          sub={hasLineData ? `vs ${kpis.comparison_year}` : 'No ridership supplied for this line'}
        />
        <KpiCard
          type="busiest"
          delayIndex={1}
          label="Busiest line"
          value={kpis.busiest_line}
          sub={`${kpis.busiest_line_share_pct}% of total ridership`}
        />
        <KpiCard
          type="peak"
          delayIndex={2}
          label="Peak hour"
          value="7 – 9 AM"
          sub="17:00–19:00 evening peak"
          withBarChart
          monthly_trend={monthly_trend}
        />
      </div>

      {/* ── Main Content Row ───────────────────────────────────────────────── */}
      <div className="network-overview-main"
        style={{
          display: 'flex',
          flex: 1,
          gap: 12,
          padding: '12px 16px',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* ── Left Sidebar ───────────────────────────────────────────────── */}
        <div className="network-overview-sidebar"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            width: 232,
            flexShrink: 0,
            overflowY: 'auto',
            paddingBottom: 4,
          }}
        >
          {/* Network Filters Card */}
          <div style={cardStyle}>
            <SectionTitle icon="⚙️" label="Network Filters" />
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
          <div style={cardStyle}>
            <SectionTitle icon="📉" label="Ridership Trend" />
            <div style={{ fontWeight: 800, fontSize: 22, color: '#0F1E36' }}>
              {formatMillions(kpis.total_rail_trips)}
            </div>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: '#E0FFF6',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                fontWeight: 600,
                color: '#00C48C',
                marginTop: 4,
              }}
            >
              ▲ {kpis.yoy_growth_pct}% YoY
            </div>
            <RidershipTrendChart
              monthly_trend={monthly_trend}
              selectedLine={selectedLine}
              playbackIdx={playbackIdx}
            />
          </div>

          {/* Line Performance */}
          <div style={cardStyle}>
            <SectionTitle icon="📊" label="Line Performance" />
            <LinePerformanceCard
              line_performance={line_performance}
              selectedLine={selectedLine}
            />
          </div>

          {/* KTMB Services Donut */}
          <div style={cardStyle}>
            <SectionTitle icon="🚉" label="KTMB Services" />
            <KtmbDonutChart ktmb_services={ktmb_services} />
          </div>
        </div>

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
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: 12, color: '#0F1E36', letterSpacing: '0.3px' }}>
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
