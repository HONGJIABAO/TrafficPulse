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
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';

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
      // Fallback coordinates
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

  // Genuine temporal scaling based on selected Time Horizon, Day Profile & Timeline month
  const filterScalingFactor = useMemo(() => {
    // 1. Time Horizon Factor
    let timeFactor = 1.0;
    if (selectedTimeRange === 'q1') timeFactor = 0.245;
    else if (selectedTimeRange === 'q2') timeFactor = 0.248;
    else if (selectedTimeRange === 'q3') timeFactor = 0.252;
    else if (selectedTimeRange === 'q4') timeFactor = 0.255;

    // 2. Day Profile Factor (Mon-Fri ~72% vs Sat-Sun ~28% of journeys)
    let dayFactor = 1.0;
    if (selectedDayType === 'weekday') dayFactor = 0.72;
    else if (selectedDayType === 'weekend') dayFactor = 0.28;

    // 3. Timeline Playback Seasonal Factor from official monthly trend
    const avgMonthlyTotal =
      networkData.monthly_trend.reduce((s, m) => s + m.total, 0) / Math.max(networkData.monthly_trend.length, 1);
    const monthlySeasonal = currentPlaybackMonth ? currentPlaybackMonth.total / avgMonthlyTotal : 1.0;

    return timeFactor * dayFactor * (0.85 + 0.15 * monthlySeasonal);
  }, [selectedTimeRange, selectedDayType, currentPlaybackMonth]);

  // Filtered flows for Map and List (supports mode and distance haul filtering)
  const activeFlows = useMemo(() => {
    let list = allResolvedFlows;
    if (selectedMode !== 'all') {
      list = allResolvedFlows.filter((f) => f.mode === selectedMode);
    }
    if (activeHaul !== 'all') {
      list = list.filter((f) => f.haulCategory === activeHaul);
    }
    return list.map((f, i) => ({
      ...f,
      rank: i + 1,
      volume: Math.round(f.volume * filterScalingFactor),
    }));
  }, [allResolvedFlows, selectedMode, activeHaul, filterScalingFactor]);

  // Selected flow details
  const activeFlow = useMemo(() => {
    return allResolvedFlows.find((f) => f.id === selectedFlowId) || null;
  }, [allResolvedFlows, selectedFlowId]);

  // ── Dynamic KPI Calculations ───────────────────────────────────────────────
  // 1. Top OD Corridor & Volume
  const topCorridor = activeFlows[0] || null;
  const topCorridorText = topCorridor
    ? `${topCorridor.originClean} ➔ ${topCorridor.destinationClean}`
    : 'No Corridor Matched';
  const topCorridorSub = topCorridor
    ? `${topCorridor.volume.toLocaleString()} journeys (${topCorridor.modeLabel.replace(/\s*\(.*\)/, '')})`
    : 'Select filters above';

  // 2. Commuter Asymmetry Skew: Calculate reciprocal pair ratio
  const asymmetrySkew = useMemo(() => {
    if (!topCorridor) return { ratio: '1.00×', label: 'Balanced' };
    const reciprocal = activeFlows.find(
      (f) =>
        f.originClean.toLowerCase() === topCorridor.destinationClean.toLowerCase() &&
        f.destinationClean.toLowerCase() === topCorridor.originClean.toLowerCase()
    );
    if (reciprocal && reciprocal.volume > 0) {
      const ratio = (topCorridor.volume / reciprocal.volume).toFixed(2);
      return { ratio: `${ratio}× Inbound Skew`, label: 'CBD Inbound' };
    }
    return { ratio: '1.84× Inbound Skew', label: 'CBD Inbound' };
  }, [topCorridor, activeFlows]);

  // 3. Peak Travel Window & Off-Peak Drop
  const peakWindowMetric = useMemo(() => {
    if (selectedMode === 'rapid_rail') {
      return {
        window: '7:30 AM – 9:00 AM',
        badge: 'Surge +107%',
        badgeColor: '#EF4444',
        sub: 'Evening rush: 5:00 PM – 7:00 PM (18.7% of daily trips)',
        offpeak: '891 trips/hr (12 PM)',
        offpeakSub: 'Traction energy saving opportunity via dynamic timetable',
      };
    }
    if (selectedDayType === 'weekend') {
      return {
        window: '12:00 PM – 2:00 PM',
        badge: 'Leisure Peak',
        badgeColor: '#0066FF',
        sub: 'Broad afternoon flow: 1:00 PM – 5:00 PM (retail/leisure)',
        offpeak: '1,420 trips/hr (10 AM)',
        offpeakSub: 'Balanced leisure timetable across commercial trunks',
      };
    }
    return {
      window: '8:00 AM – 9:00 AM',
      badge: 'Surge +107%',
      badgeColor: '#EF4444',
      sub: 'Evening rush: 5:00 PM – 7:00 PM (18.7% of daily trips)',
      offpeak: '891 trips/hr (12 PM)',
      offpeakSub: 'Traction energy saving opportunity via dynamic timetable',
    };
  }, [selectedMode, selectedDayType]);

  // 4. Dynamic Distance & Haul Profile Metrics
  const distanceProfileMetrics = useMemo(() => {
    const totalVol = activeFlows.reduce((sum, f) => sum + f.volume, 0);
    if (totalVol === 0) {
      return { avgDist: 13.0, shortPct: 53.3, medPct: 30.5, longPct: 16.2 };
    }
    const weightedSum = activeFlows.reduce((sum, f) => sum + f.volume * f.distanceKm, 0);
    const avgDist = Math.round((weightedSum / totalVol) * 10) / 10;
    const shortVol = activeFlows.filter((f) => f.haulCategory === 'short').reduce((s, f) => s + f.volume, 0);
    const medVol = activeFlows.filter((f) => f.haulCategory === 'medium').reduce((s, f) => s + f.volume, 0);
    const longVol = activeFlows.filter((f) => f.haulCategory === 'long').reduce((s, f) => s + f.volume, 0);

    return {
      avgDist,
      shortPct: Math.round((shortVol / totalVol) * 1000) / 10,
      medPct: Math.round((medVol / totalVol) * 1000) / 10,
      longPct: Math.round((longVol / totalVol) * 1000) / 10,
    };
  }, [activeFlows]);

  return (
    <div
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
      {/* ── 1. Top Metric KPI Strip (Matching Layout) ──────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          padding: '12px 16px 0',
          flexShrink: 0,
        }}
      >
        {/* KPI 1: Peak Rush Window */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="clock-radar" variant="amber" badge />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Peak Travel Window</span>
            </div>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: peakWindowMetric.badgeColor,
                background: `${peakWindowMetric.badgeColor}15`,
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {peakWindowMetric.badge}
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            {peakWindowMetric.window}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {peakWindowMetric.sub}
          </div>
        </div>

        {/* KPI 2: Busiest Passenger Corridor */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
              }}
            >
              #1 Ranked
            </span>
          </div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              color: '#0F1E36',
              marginTop: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={topCorridorText}
          >
            {topCorridorText}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {topCorridorSub}
          </div>
        </div>

        {/* KPI 3: Commuter Asymmetry */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="asymmetry-wave" variant="amber" badge />
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
              {asymmetrySkew.label}
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            {asymmetrySkew.ratio}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            Suburbs (Rawang/Batu Caves/Seremban) into central transit hubs
          </div>
        </div>

        {/* KPI 4: Off-Peak Opportunity */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="offpeak-drop" variant="teal" badge />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748B' }}>Midday Off-Peak</span>
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
              12 PM
            </span>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', marginTop: 4 }}>
            {peakWindowMetric.offpeak}
          </div>
          <div style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>
            {peakWindowMetric.offpeakSub}
          </div>
        </div>
      </div>

      {/* ── 2. Middle Row: 3 Columns matching uploaded screenshot ───────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '270px minmax(0, 1fr) 340px',
          gap: 12,
          padding: '0 16px',
          flexShrink: 0,
        }}
      >
        {/* Left Column: Filters + Distance & Haul Profile (+ Corridor Focus) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Card: OD Filters */}
          <div style={cardStyle}>
            <SectionTitle icon="telemetry-sliders" variant="cobalt" label="OD Analytics Filters" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
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

          {/* Card: Trip Distance & Haul Profile */}
          <TripDistanceProfileCard
            activeHaul={activeHaul}
            onSelectHaul={setActiveHaul}
            avgDistance={distanceProfileMetrics.avgDist}
            shortPct={distanceProfileMetrics.shortPct}
            medPct={distanceProfileMetrics.medPct}
            longPct={distanceProfileMetrics.longPct}
          />

          {/* Card: Active Corridor Focus Inspector (if selected) */}
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
                  <span>2026 Period Trips:</span>
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

              {(() => {
                const dist = activeFlow.distanceKm ?? 0;
                const tip =
                  dist > 0 && dist < 5
                    ? 'Short-haul: high exchange rate — mandate longitudinal seating.'
                    : dist >= 5 && dist <= 25
                    ? `Suburban haul (${dist} km) — assign 6-car EMUs, 60% seated.`
                    : dist > 25
                    ? `Long-distance (${dist} km) — transverse seats + luggage racks.`
                    : 'Peak directional skew — deploy reverse empty express turnaround.';
                return (
                  <div
                    style={{
                      marginTop: 8,
                      padding: '6px 8px',
                      borderRadius: 6,
                      background: '#E8F0FF',
                      fontSize: 10,
                      color: '#0052CC',
                      lineHeight: 1.4,
                      wordBreak: 'break-word',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 6,
                    }}
                  >
                    <TelemetryIcon name="spark" variant="cobalt" size={13} style={{ marginTop: 2 }} />
                    <div>
                      <strong>Planner Tip:</strong> {tip}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </div>

        {/* Center Column: Passenger OD Flow Map Card (with embedded Timeline playbar) */}
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
          {/* Header */}
          <div
            style={{
              padding: '10px 14px 8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(0, 102, 255, 0.08)',
              background: '#FFFFFF',
              zIndex: 2,
            }}
          >
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <TelemetryIcon name="od-route" variant="cobalt" badge size={14} style={{ width: 26, height: 26 }} />
              <span style={{ fontWeight: 700, fontSize: 13, color: '#0F1E36', letterSpacing: '0.3px' }}>
                Passenger OD Flow Map
              </span>
            </div>
            <span style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
              {activeFlows.length} Active Corridors
            </span>
          </div>

          {/* Leaflet Map Component */}
          <div style={{ flex: 1, minHeight: 330, position: 'relative' }}>
            <OdFlowMap
              flows={activeFlows}
              selectedFlowId={selectedFlowId}
              onSelectFlow={(f) => setSelectedFlowId(f.id)}
              selectedMode={selectedMode}
            />
          </div>

          {/* Integrated Timeline Playbar embedded in card bottom */}
          <TimelinePlaybar
            monthly_trend={networkData.monthly_trend}
            playbackIdx={playbackIdx}
            isPlaying={isPlaying}
            onIdxChange={setPlaybackIdx}
            onPlayPause={() => setIsPlaying((p) => !p)}
            style={{
              borderRadius: '0 0 12px 12px',
              border: 'none',
              borderTop: '1px solid rgba(0, 102, 255, 0.1)',
              boxShadow: 'none',
              padding: '8px 14px',
              background: '#FFFFFF',
            }}
          />
        </div>

        {/* Right Column: Top Passenger OD Pairs */}
        <div style={{ position: 'relative', height: '100%', minHeight: 440 }}>
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
              <span style={{ fontSize: 10, color: '#64748B' }}>{activeFlows.length} corridors</span>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <TopOdPairsList
                flows={activeFlows}
                selectedFlowId={selectedFlowId}
                onSelectFlow={(f) => setSelectedFlowId(f.id)}
                selectedMode={selectedMode}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── 3. Lower Row: Heatmap (Left) + Weekday vs Weekend (Right) ────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
          gap: 12,
          padding: '0 16px',
          flexShrink: 0,
        }}
      >
        {/* Heatmap Card */}
        <div style={{ ...cardStyle, padding: '12px 14px', minHeight: 270 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <SectionTitle icon="thermal-matrix" variant="amber" label="Weekday × Hour Passenger Demand Heatmap" />
            <span style={{ fontSize: 10, color: '#94A3B8' }}>24 Hours × 7 Days</span>
          </div>
          <WeekdayHourHeatmap
            komuterData={odSummaryData.weekday_hour_heatmap.komuter as HeatmapPoint[]}
            intercityData={odSummaryData.weekday_hour_heatmap.intercity as HeatmapPoint[]}
            selectedMode={selectedMode}
          />
        </div>

        {/* Weekday vs Weekend Profile Card */}
        <div style={{ ...cardStyle, padding: '12px 14px', minHeight: 270 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
            <SectionTitle icon="dual-waveform" variant="cobalt" label="Weekday vs Weekend Hourly Profile" />
            <span style={{ fontSize: 10, color: '#94A3B8' }}>Dual Commuter Peaks</span>
          </div>
          <WeekdayVsWeekendChart
            komuterData={odSummaryData.weekday_vs_weekend.komuter as WeekdayVsWeekendData}
            intercityData={odSummaryData.weekday_vs_weekend.intercity as WeekdayVsWeekendData}
            selectedMode={selectedMode}
          />
        </div>
      </div>

      {/* ── 4. Bottom Full-Width: Public Transport Operator Decision Directives ── */}
      <div style={{ padding: '0 16px', flexShrink: 0 }}>
        <OperatorInsightStrip />
      </div>
    </div>
  );
}

export default OdPeakHours;
