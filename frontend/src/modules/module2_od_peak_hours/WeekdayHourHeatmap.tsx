import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { DayTypeFilter, HeatmapPoint, OdModeFilter } from './types';
import { formatMillions } from '@/modules/shared/types';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import { classifyIsoWeekday, formatSingleHourWindow } from './odAnalyticsUtils';

interface Props {
  heatmapPoints: HeatmapPoint[];
  selectedMode: OdModeFilter;
  selectedDayType: DayTypeFilter;
  hourlySupported: boolean;
  coverageNote: string;
  emptyReason?: string | null;
}

const ALL_DAYS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

const HOURS = [
  '12AM', '1AM', '2AM', '3AM', '4AM', '5AM',
  '6AM', '7AM', '8AM', '9AM', '10AM', '11AM',
  '12PM', '1PM', '2PM', '3PM', '4PM', '5PM',
  '6PM', '7PM', '8PM', '9PM', '10PM', '11PM',
];

export const WeekdayHourHeatmap: React.FC<Props> = ({
  heatmapPoints,
  selectedMode,
  selectedDayType,
  hourlySupported,
  coverageNote,
  emptyReason,
}) => {
  // Visible Y-axis days depend strictly on Day Profile filter (Mon-Fri Weekday vs Sat-Sun Weekend)
  const visibleDays = useMemo(() => {
    if (selectedDayType === 'weekday') {
      return ALL_DAYS.filter((d) => classifyIsoWeekday(d.iso) === 'Weekday');
    }
    if (selectedDayType === 'weekend') {
      return ALL_DAYS.filter((d) => classifyIsoWeekday(d.iso) === 'Weekend');
    }
    return ALL_DAYS;
  }, [selectedDayType]);

  const maxVal = useMemo(() => {
    return Math.max(...heatmapPoints.map((d) => d.ridership), 1);
  }, [heatmapPoints]);

  const chartData = useMemo(() => {
    const dayIndexByIso = new Map<number, number>();
    visibleDays.forEach((d, idx) => dayIndexByIso.set(d.iso, idx));

    return heatmapPoints
      .filter((d) => dayIndexByIso.has(d.weekday))
      .map((d) => [d.hour, dayIndexByIso.get(d.weekday)!, d.ridership]);
  }, [heatmapPoints, visibleDays]);

  const peakPulsePoints = useMemo(() => {
    const dayIndexByIso = new Map<number, number>();
    visibleDays.forEach((d, idx) => dayIndexByIso.set(d.iso, idx));

    return heatmapPoints
      .filter((d) => dayIndexByIso.has(d.weekday) && d.ridership >= maxVal * 0.65)
      .map((d) => [d.hour, dayIndexByIso.get(d.weekday)!, d.ridership]);
  }, [heatmapPoints, visibleDays, maxVal]);

  const option = useMemo(() => {
    return {
      tooltip: {
        position: 'top',
        backgroundColor: 'rgba(15, 30, 54, 0.96)',
        borderColor: '#0066FF',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: (params: any) => {
          const [hourIdx, dayIdx, val] = params.value;
          const dayObj = visibleDays[dayIdx] || ALL_DAYS[0];
          const classification = classifyIsoWeekday(dayObj.iso);
          const hourLabel = formatSingleHourWindow(hourIdx);
          const pctOfMax = maxVal > 0 ? ((val / maxVal) * 100).toFixed(0) : '0';

          let statusColor = '#0D9488';
          let statusLabel = 'Light Off-Peak';
          if (val > maxVal * 0.7) {
            statusColor = '#EF4444';
            statusLabel = 'Peak Concentration (>=70% of max cell)';
          } else if (val > maxVal * 0.4) {
            statusColor = '#EA580C';
            statusLabel = 'High Commuter / Operational Demand';
          } else if (val > maxVal * 0.2) {
            statusColor = '#EAB308';
            statusLabel = 'Moderate Shoulder Demand';
          }

          return `
            <div style="font-weight: 700; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 3px;">
              ${dayObj.label} (${classification}) • ${hourLabel}
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
              <span style="color: #94A3B8;">Observed Period Trips:</span>
              <strong style="color: #00E5A3;">${Number(val).toLocaleString()} (${formatMillions(val)})</strong>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
              <span style="color: #94A3B8;">Relative Intensity:</span>
              <span style="color: #FFC400; font-weight: 600;">${pctOfMax}% of matrix peak</span>
            </div>
            <div style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.15); font-size: 11px;">
              <span style="display:inline-flex;align-items:center;gap:6px;">
                <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};"></span>
                <span>${statusLabel}</span>
              </span>
            </div>
          `;
        },
      },
      grid: {
        top: 10,
        right: 12,
        bottom: 24,
        left: 38,
      },
      xAxis: {
        type: 'category',
        data: HOURS,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          interval: 2,
        },
      },
      yAxis: {
        type: 'category',
        data: visibleDays.map((d) => d.label),
        inverse: true,
        splitArea: { show: false },
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#0F1E36',
          fontSize: 11,
          fontWeight: 600,
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max: maxVal,
        inRange: {
          color: ['#F1F5F9', '#DBEAFE', '#93C5FD', '#3B82F6', '#0066FF', '#F59E0B', '#FF5A00'],
        },
      },
      series: [
        {
          name: 'Hourly Demand',
          type: 'heatmap',
          data: chartData,
          animation: true,
          animationDuration: 450,
          itemStyle: {
            borderColor: '#FFFFFF',
            borderWidth: 2,
            borderRadius: 4,
          },
          emphasis: {
            itemStyle: {
              borderColor: '#0066FF',
              borderWidth: 2,
            },
          },
        },
        {
          name: 'Peak Core Highlight',
          type: 'scatter',
          data: peakPulsePoints,
          symbol: 'circle',
          symbolSize: (val: any) => {
            const r = val?.[2] || 0;
            return r > maxVal * 0.85 ? 8 : 5;
          },
          itemStyle: {
            color: '#FFFFFF',
            borderColor: '#EA580C',
            borderWidth: 1.5,
          },
          silent: true,
          z: 5,
        },
      ],
    };
  }, [chartData, peakPulsePoints, maxVal, visibleDays]);

  if (!hourlySupported || selectedMode === 'rapid_rail') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 205,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          borderRadius: 8,
          border: '1px dashed rgba(0, 102, 255, 0.2)',
          padding: '20px',
          textAlign: 'center',
          gap: 8,
        }}
      >
        <TelemetryIcon name="clock-radar" variant="cobalt" badge size={16} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
          Hourly Demand Matrix Unavailable for Rapid Rail
        </div>
        <div style={{ fontSize: 11, color: '#64748B', maxWidth: 420, lineHeight: 1.45 }}>
          {emptyReason ||
            'Prasarana / Rapid Rail publishes daily Origin-Destination aggregate records only. Hourly demand telemetry is captured for KTM Komuter and KTM Intercity.'}
        </div>
      </div>
    );
  }

  if (heatmapPoints.length === 0) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 205,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          borderRadius: 8,
          border: '1px dashed rgba(148, 163, 184, 0.4)',
          padding: '20px',
          textAlign: 'center',
          gap: 6,
        }}
      >
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0F1E36' }}>No Hourly Observations in Filter</div>
        <div style={{ fontSize: 11, color: '#64748B', maxWidth: 380 }}>
          {emptyReason || 'No hourly records exist for this Time Horizon and Day Profile selection.'}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
          paddingRight: 4,
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ fontSize: 10, color: '#64748B' }}>{coverageNote}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B' }}>
          <span>Low</span>
          <div
            style={{
              width: 68,
              height: 6,
              borderRadius: 3,
              background: 'linear-gradient(to right, #DBEAFE, #3B82F6, #0066FF, #F59E0B, #FF5A00)',
            }}
          />
          <span style={{ color: '#FF5A00', fontWeight: 600 }}>Peak Surge</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 185 }}>
        <ReactECharts
          option={option}
          notMerge={true}
          style={{ width: '100%', height: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
};
