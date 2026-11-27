import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { CapacityMode, DayProfileFilter, HourlyProfileEntry, NetworkCode, StatMode } from './capacityScreeningTypes';

interface HourlyDemandCapacityChartProps {
  profileKey: string;
  profile: HourlyProfileEntry | null;
  segmentLabel: string;
  networkCode: NetworkCode;
  capacityMode: CapacityMode;
  statMode: StatMode;
  dayProfile: DayProfileFilter;
  trainCapNom: number;
  trainCap80: number;
}

const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

export const HourlyDemandCapacityChart: React.FC<HourlyDemandCapacityChartProps> = ({
  profile,
  segmentLabel,
  capacityMode,
  statMode,
  dayProfile,
  trainCapNom,
  trainCap80,
}) => {
  const [showTxBaseline, setShowTxBaseline] = useState<boolean>(true);
  const [showTightBuffer, setShowTightBuffer] = useState<boolean>(false);

  const chartOption = useMemo(() => {
    if (!profile) return null;

    const factor = capacityMode === 'official_2023_nominal' ? 1 : trainCap80 / trainCapNom;
    const capArr = profile.cap_nom_mean.map((v) => Math.round(v * factor * 10) / 10);

    const primaryDemand =
      statMode === 'mean'
        ? profile.base_mean
        : statMode === 'p90'
          ? profile.base_p90
          : profile.base_max;

    const primaryLabel =
      statMode === 'mean'
        ? 'Estimated Demand (Mean Day, +5m Base)'
        : statMode === 'p90'
          ? 'Estimated Demand (P90 High Day, +5m Base)'
          : 'Estimated Demand (Max Observed Day, +5m Base)';

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
        name: 'Transaction-Hour Baseline (Mean)',
        type: 'line',
        smooth: 0.2,
        symbol: 'none',
        data: profile.tx_mean,
        lineStyle: { width: 1.5, type: 'dotted', color: '#64748B' },
        itemStyle: { color: '#64748B' },
        z: 2,
      });
    }

    if (showTightBuffer) {
      series.push({
        name: 'Schedule Sensitivity (0m Buffer Mean)',
        type: 'line',
        smooth: 0.2,
        symbol: 'none',
        data: profile.tight_mean,
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
          const nTr = profile.trains_mean[i];
          const lr = s > 0 ? `${((d / s) * 100).toFixed(1)}%` : 'No Service';
          const def = s > 0 && d > s ? `${(d - s).toFixed(1)} pax deficit` : 'Within capacity';
          return [
            `<div style="font-weight:700;margin-bottom:4px;color:#0F1E36">${HOUR_LABELS[i]} — ${segmentLabel}</div>`,
            `<div>Primary Demand: <strong style="color:#0066FF">${d.toLocaleString()} pax</strong></div>`,
            `<div>Scheduled Capacity: <strong>${s.toLocaleString()} pax</strong> (${nTr} trains/hr)</div>`,
            `<div>Load Ratio: <strong style="color:${s > 0 && d > s ? '#DC2626' : '#0F1E36'}">${lr}</strong> (${def})</div>`,
            showTxBaseline ? `<div style="color:#64748B">Tx-Hour Mean: ${profile.tx_mean[i].toLocaleString()} pax</div>` : '',
            showTightBuffer ? `<div style="color:#0D9488">0m Buffer Mean: ${profile.tight_mean[i].toLocaleString()} pax</div>` : '',
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
  }, [profile, capacityMode, statMode, trainCapNom, trainCap80, showTxBaseline, showTightBuffer, segmentLabel]);

  if (!profile || !chartOption) {
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
          Full 24h profile across Aug 18–Nov 26 ({dayProfile} day profile)
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
