import React, { useState, useMemo } from 'react';
import rawOdSummaryData from '@/data/od_summary.json';
import stationsData from '@/data/stations.json';
import networkData from '@/data/network_overview.json';
import { formatMillions } from '@/modules/shared/types';
import type {
  ResolvedOdFlow,
  OdRawPair,
  OdModeFilter,
  DayTypeFilter,
  TimeRangeFilter,
  HaulFilter,
  HeatmapPoint,
  WeekdayVsWeekendData,
} from './types';
import { WeekdayHourHeatmap } from './WeekdayHourHeatmap';
import { WeekdayVsWeekendChart } from './WeekdayVsWeekendChart';
import { TopOdPairsList } from './TopOdPairsList';
import { OdFlowMap } from './OdFlowMap';
import { OperatorInsightStrip } from './OperatorInsightStrip';
import { TimelinePlaybar } from '@/modules/module1_network_overview/TimelinePlaybar';
import { TripDistanceProfileCard } from './TripDistanceProfileCard';

interface OdSummarySchema {
  generated_at: string;
  weekday_hour_heatmap: {
    komuter: HeatmapPoint[];
    intercity: HeatmapPoint[];
  };
  top_od_pairs: {
    komuter: OdRawPair[];
    rapid_rail: OdRawPair[];
    intercity: OdRawPair[];
  };
  weekday_vs_weekend: {
    komuter: WeekdayVsWeekendData;
    intercity: WeekdayVsWeekendData;
  };
}

const odSummaryData = rawOdSummaryData as unknown as OdSummarySchema;

// ── Clean name helper ─────────────────────────────────────────────────────────
function cleanStationName(raw: string): string {
  return raw.replace(/^[A-Z0-9]+:\s*/, '').trim();
}

// ── Haversine Distance Helper ────────────────────────────────────────────────
function haversineDistanceKm(p1: [number, number], p2: [number, number]): number {
  const R = 6371; // Earth radius in km
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLon = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1[0] * Math.PI) / 180) *
      Math.cos((p2[0] * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function getHaulCategory(dist: number): 'short' | 'medium' | 'long' {
  if (dist < 5) return 'short';
  if (dist <= 25) return 'medium';
  return 'long';
}

// ── Card Styles matching Network Overview ────────────────────────────────────
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

function SectionTitle({ icon, label }: { icon: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
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

export function OdPeakHours() {
  // ── Filters ────────────────────────────────────────────────────────────────
  const [selectedMode, setSelectedMode] = useState<OdModeFilter>('all');
  const [selectedTimeRange, setSelectedTimeRange] = useState<TimeRangeFilter>('12m');
  const [selectedDayType, setSelectedDayType] = useState<DayTypeFilter>('all');

  const [pendingMode, setPendingMode] = useState<OdModeFilter>('all');
  const [pendingTimeRange, setPendingTimeRange] = useState<TimeRangeFilter>('12m');
  const [pendingDayType, setPendingDayType] = useState<DayTypeFilter>('all');

  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [activeHaul, setActiveHaul] = useState<HaulFilter>('all');

  // ── Timeline Playback State (matching Module 1) ───────────────────────────
  const [playbackIdx, setPlaybackIdx] = useState<number>(networkData.monthly_trend.length - 1);
  const [isPlaying, setIsPlaying] = useState(false);

  const currentPlaybackMonth = networkData.monthly_trend[playbackIdx];
  const maxMonthTotal = useMemo(() => {
    return Math.max(...networkData.monthly_trend.map((m) => m.total), 1);
  }, []);
  const playbackFactor = currentPlaybackMonth ? currentPlaybackMonth.total / maxMonthTotal : 1;

  const handleApply = () => {
    setSelectedMode(pendingMode);
    setSelectedTimeRange(pendingTimeRange);
    setSelectedDayType(pendingDayType);
  };

  const handleReset = () => {
    setPendingMode('all');
    setPendingTimeRange('12m');
    setPendingDayType('all');
    setSelectedMode('all');
    setSelectedTimeRange('12m');
    setSelectedDayType('all');
    setSelectedFlowId(null);
    setActiveHaul('all');
  };

  // ── Resolve Stations & Flows ───────────────────────────────────────────────
  const allResolvedFlows = useMemo<ResolvedOdFlow[]>(() => {
    const stationMap = new Map<string, { lat: number; lng: number; name: string }>();
    stationsData.stations.forEach((st) => {
      if (st.lat && st.lng) {
        stationMap.set(st.name.toLowerCase().trim(), { lat: st.lat, lng: st.lng, name: st.name });
        stationMap.set(st.code.toLowerCase().trim(), { lat: st.lat, lng: st.lng, name: st.name });
      }
    });

    const resolveCoords = (raw: string): { coords: [number, number]; cleanName: string } => {
      const clean = cleanStationName(raw);
      const exact = stationMap.get(clean.toLowerCase()) || stationMap.get(raw.toLowerCase());
      if (exact) {
        return { coords: [exact.lat, exact.lng], cleanName: exact.name };
      }
      // Partial search fallback
      for (const [key, val] of stationMap.entries()) {
        if (key.includes(clean.toLowerCase()) || clean.toLowerCase().includes(key)) {
          return { coords: [val.lat, val.lng], cleanName: val.name };
        }
      }
      // Default to KL Sentral if truly unresolved
      return { coords: [3.1342, 101.6861], cleanName: clean };
    };

    const list: ResolvedOdFlow[] = [];

    // Rapid Rail pairs
    odSummaryData.top_od_pairs.rapid_rail?.forEach((pair, idx) => {
      const o = resolveCoords(pair.origin);
      const d = resolveCoords(pair.destination);
      const dist = haversineDistanceKm(o.coords, d.coords);
      list.push({
        id: `rr-${idx}`,
        rank: idx + 1,
        origin: pair.origin,
        originClean: o.cleanName,
        destination: pair.destination,
        destinationClean: d.cleanName,
        mode: 'rapid_rail',
        modeLabel: 'Rapid Rail (LRT/MRT)',
        volume: pair.total_ridership,
        originCoords: o.coords,
        destCoords: d.coords,
        corridorType: 'CBD Core Transit',
        distanceKm: dist,
        haulCategory: getHaulCategory(dist),
      });
    });

    // Komuter pairs
    odSummaryData.top_od_pairs.komuter?.forEach((pair, idx) => {
      const o = resolveCoords(pair.origin);
      const d = resolveCoords(pair.destination);
      const dist = haversineDistanceKm(o.coords, d.coords);
      list.push({
        id: `komuter-${idx}`,
        rank: idx + 1,
        origin: pair.origin,
        originClean: o.cleanName,
        destination: pair.destination,
        destinationClean: d.cleanName,
        mode: 'komuter',
        modeLabel: 'KTM Komuter',
        volume: pair.total_ridership,
        originCoords: o.coords,
        destCoords: d.coords,
        corridorType: 'Suburban Commuter Trunk',
        distanceKm: dist,
        haulCategory: getHaulCategory(dist),
      });
    });

    // Intercity pairs
    odSummaryData.top_od_pairs.intercity?.forEach((pair, idx) => {
      const o = resolveCoords(pair.origin);
      const d = resolveCoords(pair.destination);
      const dist = haversineDistanceKm(o.coords, d.coords);
      list.push({
        id: `intercity-${idx}`,
        rank: idx + 1,
        origin: pair.origin,
        originClean: o.cleanName,
        destination: pair.destination,
        destinationClean: d.cleanName,
        mode: 'intercity',
        modeLabel: 'KTM Intercity & ETS',
        volume: pair.total_ridership,
        originCoords: o.coords,
        destCoords: d.coords,
        corridorType: 'Interstate Long-Distance',
        distanceKm: dist,
        haulCategory: getHaulCategory(dist),
      });
    });

    // Sort by volume descending
    return list.sort((a, b) => b.volume - a.volume);
  }, []);

  // Filtered and timeline-scaled flows for Map and List (supports mode and distance haul filtering)
  const activeFlows = useMemo(() => {
    let list = allResolvedFlows;
    if (selectedMode !== 'all') {
      list = allResolvedFlows.filter((f) => f.mode === selectedMode);
    }
    if (activeHaul !== 'all') {
      list = list.filter((f) => f.haulCategory === activeHaul);
    }
    return list.map((f) => ({
      ...f,
      volume: Math.round(f.volume * (0.6 + 0.4 * playbackFactor)),
    }));
  }, [allResolvedFlows, selectedMode, activeHaul, playbackFactor]);

  // Selected flow details
  const activeFlow = useMemo(() => {
    return allResolvedFlows.find((f) => f.id === selectedFlowId) || null;
  }, [allResolvedFlows, selectedFlowId]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 58px)',
        background: '#F1F4F9',
        overflow: 'hidden',
      }}
    >
      {/* ── Top Metric KPI Strip (Matching Network Overview) ───────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          padding: '12px 16px 0',
        }}
      >
        {/* KPI 1: Peak Rush Window */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>⏰</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Peak Travel Window</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#EF4444',
                background: '#FEE2E2',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              Surge +107%
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            8:00 AM – 9:00 AM
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            Evening rush: <strong>5:00 PM – 7:00 PM</strong> (18.7% of daily trips)
          </div>
        </div>

        {/* KPI 2: Busiest Passenger Corridor */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>🚀</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Top OD Flow Corridor</span>
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
              #1 Ranked
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            KL Sentral ➔ Batu Caves
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            <strong>927,775</strong> annual passenger journeys (KTM Komuter)
          </div>
        </div>

        {/* KPI 3: Commuter Asymmetry */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>⚖️</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Morning Asymmetry</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#F59E0B',
                background: '#FEF3C7',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              CBD Inbound
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            1.84× Inbound Skew
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            Suburbs (Rawang/Batu Caves/Seremban) into central transit hubs
          </div>
        </div>

        {/* KPI 4: Off-Peak Opportunity */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 16 }}>⚡</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Midday Off-Peak Drop</span>
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
              -75% Fleet Slack
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            891 trips/hr (12 PM)
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            Traction energy saving opportunity via dynamic timetable
          </div>
        </div>
      </div>

      {/* ── Main Content Area ──────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          gap: 12,
          padding: '12px 16px',
          overflow: 'hidden',
          minHeight: 0,
        }}
      >
        {/* ── Left Sidebar (Filters + Inspector) ───────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            width: 240,
            flexShrink: 0,
            overflowY: 'auto',
            paddingBottom: 4,
          }}
        >
          {/* Card: OD Filters */}
          <div style={cardStyle}>
            <SectionTitle icon="🎛️" label="OD Analytics Filters" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* Rail Mode */}
              <FilterRow label="Rail Network Mode">
                <select
                  value={pendingMode}
                  onChange={(e) => setPendingMode(e.target.value as OdModeFilter)}
                  style={selectStyle}
                >
                  <option value="all">All Rail Modes (Combined)</option>
                  <option value="rapid_rail">Rapid Rail (LRT &amp; MRT)</option>
                  <option value="komuter">KTM Komuter</option>
                  <option value="intercity">KTM Intercity &amp; ETS</option>
                </select>
              </FilterRow>

              {/* Time Range */}
              <FilterRow label="Time Horizon">
                <select
                  value={pendingTimeRange}
                  onChange={(e) => setPendingTimeRange(e.target.value as TimeRangeFilter)}
                  style={selectStyle}
                >
                  <option value="12m">Full Year (2026 Processed)</option>
                  <option value="q4">Q4 (Oct – Dec Peak)</option>
                  <option value="q3">Q3 (Jul – Sep)</option>
                  <option value="q2">Q2 (Apr – Jun)</option>
                  <option value="q1">Q1 (Jan – Mar)</option>
                </select>
              </FilterRow>

              {/* Day Type */}
              <FilterRow label="Day Profile Type">
                <select
                  value={pendingDayType}
                  onChange={(e) => setPendingDayType(e.target.value as DayTypeFilter)}
                  style={selectStyle}
                >
                  <option value="all">All Days (Mon – Sun)</option>
                  <option value="weekday">Weekdays (Mon – Fri)</option>
                  <option value="weekend">Weekends &amp; Holidays (Sat – Sun)</option>
                </select>
              </FilterRow>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button onClick={handleApply} style={applyBtnStyle}>
                Apply
              </button>
              <button onClick={handleReset} style={resetBtnStyle} title="Reset Filters">
                ↺
              </button>
            </div>
          </div>

          {/* Card: Active Corridor Focus Inspector */}
          {activeFlow ? (
            <div
              style={{
                ...cardStyle,
                background: 'linear-gradient(135deg, #FFFFFF 0%, #F0F6FF 100%)',
                borderColor: '#0066FF',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <SectionTitle icon="📍" label="Corridor Focus" />
                <button
                  onClick={() => setSelectedFlowId(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#64748B',
                    cursor: 'pointer',
                    fontSize: 12,
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
                {activeFlow.originClean}
                <span style={{ color: '#0066FF', margin: '0 4px' }}>➔</span>
                {activeFlow.destinationClean}
              </div>

              <div style={{ marginTop: 8, fontSize: 11, color: '#475569', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Annual Trips:</span>
                  <strong style={{ color: '#0066FF' }}>{activeFlow.volume.toLocaleString()}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Distance:</span>
                  <strong style={{ color: '#0066FF' }}>{activeFlow.distanceKm} km</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Network:</span>
                  <span style={{ fontWeight: 600 }}>{activeFlow.modeLabel}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Haul Classification:</span>
                  <span style={{ fontWeight: 600, color: '#00A389' }}>{activeFlow.corridorType}</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 8,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: '#E8F0FF',
                  fontSize: 10,
                  color: '#0052CC',
                  lineHeight: 1.3,
                }}
              >
                💡 <strong>Planner Tip:</strong> {activeFlow.distanceKm < 5 ? 'High passenger exchange rate; require 100% longitudinal seating.' : 'High trip dwell time; assign 6-car trainsets with balanced seating.'}
              </div>
            </div>
          ) : (
            <div style={cardStyle}>
              <SectionTitle icon="💡" label="Interactive Tip" />
              <div style={{ fontSize: 11, color: '#64748B', lineHeight: 1.4 }}>
                Click on any corridor in the <strong>Top OD Pairs</strong> list or on any curved flow arc on the map to zoom in and inspect bottleneck statistics.
              </div>
            </div>
          )}

          {/* Trip Distance & Haul Profile */}
          <TripDistanceProfileCard activeHaul={activeHaul} onSelectHaul={setActiveHaul} />
        </div>

        {/* ── Main Visualizations 2x2 Grid + Bottom Insight Strip ─────────── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto',
            minWidth: 0,
            paddingRight: 2,
          }}
        >
          {/* Top Half: Heatmap (60%) + Top OD Pairs (40%) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '3fr 2fr',
              gap: 10,
              minHeight: 310,
            }}
          >
            {/* Center-Top: Weekday x Hour Demand Heatmap */}
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <SectionTitle icon="🔥" label="Weekday × Hour Passenger Demand Heatmap" />
                <span style={{ fontSize: 10, color: '#94A3B8' }}>24 Hours × 7 Days</span>
              </div>
              <WeekdayHourHeatmap
                komuterData={odSummaryData.weekday_hour_heatmap.komuter as HeatmapPoint[]}
                intercityData={odSummaryData.weekday_hour_heatmap.intercity as HeatmapPoint[]}
                selectedMode={selectedMode}
              />
            </div>

            {/* Right-Top: Top OD Pairs */}
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <SectionTitle icon="🏆" label="Top Passenger OD Pairs" />
                <span style={{ fontSize: 10, color: '#64748B' }}>{activeFlows.length} corridors</span>
              </div>
              <TopOdPairsList
                flows={activeFlows}
                selectedFlowId={selectedFlowId}
                onSelectFlow={(f) => setSelectedFlowId(f.id)}
                selectedMode={selectedMode}
              />
            </div>
          </div>

          {/* Bottom Half: Flow Map (60%) + Weekday vs Weekend Profile (40%) */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '3fr 2fr',
              gap: 10,
              minHeight: 290,
            }}
          >
            {/* Center-Bottom: OD Flow Map */}
            <div style={{ ...cardStyle, padding: 0, position: 'relative', overflow: 'hidden' }}>
              <OdFlowMap
                flows={activeFlows}
                selectedFlowId={selectedFlowId}
                onSelectFlow={(f) => setSelectedFlowId(f.id)}
                selectedMode={selectedMode}
              />
            </div>

            {/* Right-Bottom: Weekday vs Weekend Hourly Profile */}
            <div style={{ ...cardStyle, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <SectionTitle icon="📈" label="Weekday vs Weekend Hourly Profile" />
                <span style={{ fontSize: 10, color: '#94A3B8' }}>Dual Commuter Peaks</span>
              </div>
              <WeekdayVsWeekendChart
                komuterData={odSummaryData.weekday_vs_weekend.komuter as WeekdayVsWeekendData}
                intercityData={odSummaryData.weekday_vs_weekend.intercity as WeekdayVsWeekendData}
                selectedMode={selectedMode}
              />
            </div>
          </div>

          {/* Timeline Playback Bar (matching Module 1) */}
          <TimelinePlaybar
            monthly_trend={networkData.monthly_trend}
            playbackIdx={playbackIdx}
            isPlaying={isPlaying}
            onIdxChange={setPlaybackIdx}
            onPlayPause={() => setIsPlaying((p) => !p)}
          />

          {/* Operator Directives Strip (Bottom) */}
          <OperatorInsightStrip />
        </div>
      </div>
    </div>
  );
}

export default OdPeakHours;
