import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { CapacityMode, DayProfileFilter, HourlyProfileEntry, NetworkCode, PeriodScope, StatMode } from './capacityScreeningTypes';

interface HourlyDemandCapacityChartProps {
  profileKey: string;
  profile: HourlyProfileEntry | null;
  schedCatalog?: [number[], number[]][];
  segmentLabel: string;
  networkCode: NetworkCode;
  capacityMode: CapacityMode;
  statMode: StatMode;
  dayProfile: DayProfileFilter;
  period: PeriodScope;
  periodLabel: string;
  trainCapNom: number;
  trainCap80: number;
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

const DAY_PROFILE_LABELS: Record<DayProfileFilter, string> = {
  weekday: 'Verified Weekday (excl. holidays)',
  weekend: 'Weekend & GTFS Holidays',
  all: 'All Verified Days',
};

export const HourlyDemandCapacityChart: React.FC<HourlyDemandCapacityChartProps> = ({
  profile,
  schedCatalog = [],
  segmentLabel,
  capacityMode,
  statMode,
  dayProfile,
  periodLabel,
  trainCapNom,
  trainCap80,
}) => {
  const [showTxBaseline, setShowTxBaseline] = useState<boolean>(true);
  const [showTightBuffer, setShowTightBuffer] = useState<boolean>(false);

  const resolvedCurves = useMemo(() => {
    if (!profile) return null;
    const factor = capacityMode === 'official_2023_nominal' ? 1 : trainCap80 / trainCapNom;
    const dayLabel = DAY_PROFILE_LABELS[dayProfile];

    let primaryDemand: number[];
    let rawCapNom: number[];
    let trainsArr: number[];
    let tightArr: number[];
    let txArr: number[];
    let primaryLabel: string;
    let profileScopeCaption: string;

    if (statMode === 'mean') {
      primaryDemand = profile.mean_d;
      rawCapNom = profile.cap_nom_mean;
      trainsArr = profile.trains_mean;
      tightArr = profile.mean_tight;
      txArr = profile.mean_tx;
      primaryLabel = 'Estimated Demand (Slice Mean, +5m Base)';
      profileScopeCaption = `Full 24h mean profile across ${periodLabel} (${dayLabel})`;
    } else if (statMode === 'p90') {
      const schedEntry =
        profile.p90_sched_idx !== null && schedCatalog[profile.p90_sched_idx]
          ? schedCatalog[profile.p90_sched_idx]
          : [Array(24).fill(0), Array(24).fill(0)];
      primaryDemand = profile.p90_d;
      rawCapNom = schedEntry[0];
      trainsArr = schedEntry[1];
      tightArr = profile.p90_tight;
      txArr = profile.p90_tx;
      primaryLabel = profile.p90_date
        ? `Representative P90 Date (${profile.p90_date})`
        : 'Representative P90 Date (+5m Base)';
      profileScopeCaption = profile.p90_date
        ? `Coherent 24h profile & matching schedule for representative P90 date ${profile.p90_date} (${periodLabel} · ${dayLabel})`
        : `No operating P90 service date in ${periodLabel} (${dayLabel})`;
    } else {
      const schedEntry =
        profile.max_sched_idx !== null && schedCatalog[profile.max_sched_idx]
          ? schedCatalog[profile.max_sched_idx]
          : [Array(24).fill(0), Array(24).fill(0)];
      primaryDemand = profile.max_d;
      rawCapNom = schedEntry[0];
      trainsArr = schedEntry[1];
      tightArr = profile.max_tight;
      txArr = profile.max_tx;
      primaryLabel = profile.max_date
        ? `Max Surge Date (${profile.max_date})`
        : 'Max Observed Date (+5m Base)';
      profileScopeCaption = profile.max_date
        ? `Coherent 24h profile & exact matching schedule on peak date ${profile.max_date} (${periodLabel} · ${dayLabel})`
        : `No operating peak date in ${periodLabel} (${dayLabel})`;
    }

    const capArr = rawCapNom.map((v) => Math.round(v * factor * 10) / 10);
    return {
      primaryDemand,
      capArr,
      trainsArr,
      tightArr,
      txArr,
      primaryLabel,
      profileScopeCaption,
    };
  }, [profile, schedCatalog, capacityMode, statMode, dayProfile, periodLabel, trainCapNom, trainCap80]);

  const chartOption = useMemo(() => {
    if (!resolvedCurves) return null;
    const { primaryDemand, capArr, trainsArr, tightArr, txArr, primaryLabel } = resolvedCurves;

    // Red deficit overlay bars/points ONLY where Demand > Scheduled Capacity (strictly S > 0)
    const deficitExceedance = primaryDemand.map((d, idx) => {
      const s = capArr[idx];
      return s > 0 && d > s ? Math.round((d - s) * 10) / 10 : 0;
    });

    const series: Record<string, unknown>[] = [
      {
        name: primaryLabel,
        type: 'line',
        smooth: 0.25,
        symbol: 'circle',
        symbolSize: (_val: number, params: { dataIndex: number }) => {
          const i = params.dataIndex;
          return capArr[i] > 0 && primaryDemand[i] > capArr[i] ? 7 : 4;
        },
        data: primaryDemand.map((v, i) => ({
          value: v,
          itemStyle: {
            color: capArr[i] > 0 && v > capArr[i] ? '#DC2626' : '#0066FF',
          },
        })),
        lineStyle: { width: 2.5, color: '#0066FF' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 102, 255, 0.16)' },
              { offset: 1, color: 'rgba(0, 102, 255, 0.01)' },
            ],
          },
        },
        z: 4,
      },
      {
        name:
          capacityMode === 'official_2023_nominal'
            ? 'Scheduled Capacity (2023 Rate Card)'
            : '80% Comfort Benchmark',
        type: 'line',
        step: 'middle',
        symbol: 'none',
        data: capArr,
        lineStyle: { width: 2, type: 'dashed', color: '#0F1E36' },
        itemStyle: { color: '#0F1E36' },
        z: 3,
      },
      {
        name: 'Calculated Excess Above Capacity (D - S)',
        type: 'bar',
        barWidth: 10,
        data: deficitExceedance,
        itemStyle: { color: 'rgba(220, 38, 38, 0.72)', borderRadius: [3, 3, 0, 0] },
        z: 2,
      },
    ];

    if (showTxBaseline) {
      series.push({
        name: statMode === 'mean' ? 'Transaction-Hour Baseline (Mean)' : 'Transaction-Hour Cohort (Same Date)',
        type: 'line',
        smooth: 0.2,
        symbol: 'none',
        data: txArr,
        lineStyle: { width: 1.5, type: 'dotted', color: '#64748B' },
        itemStyle: { color: '#64748B' },
        z: 2,
      });
    }

    if (showTightBuffer) {
      series.push({
        name: statMode === 'mean' ? 'Schedule Sensitivity (0m Buffer Mean)' : '0m Buffer Sensitivity (Same Date)',
        type: 'line',
        smooth: 0.2,
        symbol: 'none',
        data: tightArr,
        lineStyle: { width: 1.5, type: 'dashed', color: '#0D9488' },
        itemStyle: { color: '#0D9488' },
        z: 2,
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(255,255,255,0.97)',
        borderColor: 'rgba(0, 102, 255, 0.2)',
        textStyle: { color: '#0F1E36', fontSize: 12 },
        formatter: (params: Array<{ dataIndex: number }>) => {
          const i = params[0]?.dataIndex ?? 0;
          const d = primaryDemand[i];
          const s = capArr[i];
          const nTr = trainsArr[i];
          const lr = s > 0 ? `${((d / s) * 100).toFixed(1)}%` : 'No Scheduled Service';
          const def =
            s <= 0
              ? 'Unscheduled hour (0 trains)'
              : d > s
                ? `${(d - s).toFixed(1)} pax deficit`
                : 'Within capacity';
          return [
            `<div style="font-weight:700;margin-bottom:4px;color:#0F1E36">${HOUR_LABELS[i]} — ${segmentLabel}</div>`,
            `<div>Primary Demand: <strong style="color:#0066FF">${d.toLocaleString()} pax</strong></div>`,
            `<div>Scheduled Capacity: <strong>${s.toLocaleString()} pax</strong> (${nTr} trains/hr)</div>`,
            `<div>Load Ratio: <strong style="color:${s > 0 && d > s ? '#DC2626' : '#0F1E36'}">${lr}</strong> (${def})</div>`,
            showTxBaseline ? `<div style="color:#64748B">Tx-Hour Baseline: ${txArr[i].toLocaleString()} pax</div>` : '',
            showTightBuffer ? `<div style="color:#0D9488">0m Buffer Sensitivity: ${tightArr[i].toLocaleString()} pax</div>` : '',
          ].join('');
        },
      },
      legend: {
        top: 0,
        textStyle: { color: '#475569', fontSize: 11 },
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: { left: 52, right: 20, top: 44, bottom: 28 },
      xAxis: {
        type: 'category',
        data: HOUR_LABELS,
        axisLabel: { color: '#64748B', fontSize: 10, interval: 2 },
        axisLine: { lineStyle: { color: '#CBD5E1' } },
      },
      yAxis: {
        type: 'value',
        name: 'Pax / hr',
        nameTextStyle: { color: '#64748B', fontSize: 10 },
        axisLabel: { color: '#64748B', fontSize: 10 },
        splitLine: { lineStyle: { color: '#F1F5F9' } },
      },
      series,
    };
  }, [resolvedCurves, capacityMode, statMode, showTxBaseline, showTightBuffer, segmentLabel]);

  if (!profile || !resolvedCurves || !chartOption) {
    return (
      <div
        style={{
          height: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          borderRadius: 10,
          border: '1px dashed #CBD5E1',
          color: '#64748B',
          fontSize: 13,
          padding: 20,
          textAlign: 'center',
        }}
      >
        Hourly demand vs. capacity curve is unavailable for this selection. Choose a screened Komuter Klang Valley or Komuter Utara segment.
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#64748B' }}>
          {resolvedCurves.profileScopeCaption}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#334155' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showTxBaseline}
              onChange={(e) => setShowTxBaseline(e.target.checked)}
            />
            Show Tx-Hour Baseline
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showTightBuffer}
              onChange={(e) => setShowTightBuffer(e.target.checked)}
            />
            Show 0m Buffer Sensitivity
          </label>
        </div>
      </div>
      <ReactECharts option={chartOption} style={{ height: 290, width: '100%' }} notMerge />
    </div>
  );
};
