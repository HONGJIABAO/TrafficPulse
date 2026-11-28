import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { DayTypeFilter, OdModeFilter, WeekdayVsWeekendData } from './types';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import { formatShortHour12, type PeakAnalysisResult } from './odAnalyticsUtils';

interface Props {
  data: WeekdayVsWeekendData;
  selectedMode: OdModeFilter;
  selectedDayType: DayTypeFilter;
  hourlySupported: boolean;
  coverageNote: string;
  peakAnalysis: PeakAnalysisResult;
  emptyReason?: string | null;
}

const HOURS = [
  '12AM', '1AM', '2AM', '3AM', '4AM', '5AM',
  '6AM', '7AM', '8AM', '9AM', '10AM', '11AM',
  '12PM', '1PM', '2PM', '3PM', '4PM', '5PM',
  '6PM', '7PM', '8PM', '9PM', '10PM', '11PM',
];

export const WeekdayVsWeekendChart: React.FC<Props> = ({
  data,
  selectedMode,
  selectedDayType,
  hourlySupported,
  coverageNote,
  peakAnalysis,
  emptyReason,
}) => {
  const weekdayValues = useMemo(() => {
    return (data.weekday || []).map((p) => Math.round(p.avg_ridership * 10) / 10);
  }, [data.weekday]);

  const weekendValues = useMemo(() => {
    return (data.weekend || []).map((p) => Math.round(p.avg_ridership * 10) / 10);
  }, [data.weekend]);

  const hasChartData = useMemo(() => {
    return weekdayValues.some((v) => v > 0) || weekendValues.some((v) => v > 0);
  }, [weekdayValues, weekendValues]);

  // Dynamic peak delta headline based on actual morning peak hour or busiest hour
  const comparisonSummary = useMemo(() => {
    const compareHour = peakAnalysis.morningPeak?.peakHour ?? peakAnalysis.busiestHour?.hour ?? 8;
    const wdVal = weekdayValues[compareHour] || 0;
    const weVal = weekendValues[compareHour] || 0;
    const hourStr = formatShortHour12(compareHour);
    if (weVal <= 0 && wdVal <= 0) {
      return 'Hourly comparison across Mon–Fri vs Sat–Sun';
    }
    if (weVal <= 0) {
      return `${hourStr} Weekday Avg: ${Math.round(wdVal).toLocaleString()}/hr`;
    }
    const diffPct = Math.round(((wdVal - weVal) / weVal) * 100);
    const sign = diffPct >= 0 ? `+${diffPct}%` : `${diffPct}%`;
    return `${hourStr} WD vs WE: ${sign} (${Math.round(wdVal).toLocaleString()} vs ${Math.round(weVal).toLocaleString()}/hr)`;
  }, [weekdayValues, weekendValues, peakAnalysis]);

  const option = useMemo(() => {
    const wdLabel = data.weekday_days
      ? `Weekday (Mon–Fri, ${data.weekday_days}d)`
      : 'Weekday (Mon–Fri)';
    const weLabel = data.weekend_days
      ? `Weekend (Sat–Sun, ${data.weekend_days}d)`
      : 'Weekend (Sat–Sun)';

    // Dynamic shaded peak bands calculated directly from active peakAnalysis
    const peakBands: any[] = [];
    if (peakAnalysis.morningPeak) {
      const s = peakAnalysis.morningPeak.startHour;
      const e = (peakAnalysis.morningPeak.endHourInclusive + 1) % 24;
      peakBands.push([{ xAxis: HOURS[s] }, { xAxis: HOURS[e] }]);
    }
    if (peakAnalysis.eveningPeak) {
      const s = peakAnalysis.eveningPeak.startHour;
      const e = (peakAnalysis.eveningPeak.endHourInclusive + 1) % 24;
      peakBands.push([{ xAxis: HOURS[s] }, { xAxis: HOURS[e] }]);
    }

    const showWeekday = selectedDayType === 'all' || selectedDayType === 'weekday';
    const showWeekend = selectedDayType === 'all' || selectedDayType === 'weekend';

    const series: any[] = [];
    if (showWeekday) {
      series.push({
        name: wdLabel,
        type: 'line',
        smooth: 0.3,
        showSymbol: false,
        data: weekdayValues,
        lineStyle: { width: 2.5, color: '#0066FF' },
        itemStyle: { color: '#0066FF' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 102, 255, 0.25)' },
              { offset: 1, color: 'rgba(0, 102, 255, 0.01)' },
            ],
          },
        },
        markArea:
          peakBands.length > 0
            ? {
                silent: true,
                itemStyle: { color: 'rgba(0, 102, 255, 0.05)' },
                data: peakBands,
              }
            : undefined,
      });
    }

    if (showWeekend) {
      series.push({
        name: weLabel,
        type: 'line',
        smooth: 0.3,
        showSymbol: false,
        data: weekendValues,
        lineStyle: { width: 2.2, color: '#FF5A00', type: showWeekday ? 'dashed' : 'solid' },
        itemStyle: { color: '#FF5A00' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(255, 90, 0, 0.18)' },
              { offset: 1, color: 'rgba(255, 90, 0, 0.01)' },
            ],
          },
        },
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 30, 54, 0.96)',
        borderColor: '#0066FF',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: (params: any[]) => {
          if (!params || !params.length) return '';
          const hourLabel = params[0].axisValue;
          const wdEntry = params.find((p) => String(p.seriesName).startsWith('Weekday'));
          const weEntry = params.find((p) => String(p.seriesName).startsWith('Weekend'));
          const wd = wdEntry ? Number(wdEntry.value) : null;
          const we = weEntry ? Number(weEntry.value) : null;

          let diffRow = '';
          if (wd !== null && we !== null && we > 0) {
            const delta = wd - we;
            const pct = Math.round((delta / we) * 100);
            diffRow = `
              <div style="margin-top: 5px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.15); font-size: 11px;">
                <span style="color: ${delta >= 0 ? '#00E5A3' : '#FFD166'};">
                  ${delta >= 0 ? `▲ +${pct}% vs Weekend average` : `▼ ${pct}% vs Weekend average`}
                </span>
              </div>
            `;
          }

          return `
            <div style="font-weight: 700; margin-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 3px;">
              Average Daily Demand • ${hourLabel}
            </div>
            ${
              wd !== null
                ? `<div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
                    <span style="color: #60A5FA;">● Weekday (Mon–Fri):</span>
                    <strong style="color: #FFFFFF;">${wd.toLocaleString()} trips/hr</strong>
                  </div>`
                : ''
            }
            ${
              we !== null
                ? `<div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
                    <span style="color: #FFA726;">● Weekend (Sat–Sun):</span>
                    <strong style="color: #FFFFFF;">${we.toLocaleString()} trips/hr</strong>
                  </div>`
                : ''
            }
            ${diffRow}
          `;
        },
      },
      legend: {
        top: 0,
        right: 8,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#64748B', fontSize: 10.5, fontWeight: 500 },
        data: series.map((s) => s.name),
      },
      grid: {
        top: 30,
        right: 12,
        bottom: 22,
        left: 44,
      },
      xAxis: {
        type: 'category',
        data: HOURS,
        boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          interval: 3,
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(241, 244, 249, 0.9)', type: 'dashed' } },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`),
        },
      },
      series,
    };
  }, [weekdayValues, weekendValues, data.weekday_days, data.weekend_days, peakAnalysis, selectedDayType]);

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
        <TelemetryIcon name="dual-waveform" variant="cobalt" badge size={16} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
          Hourly Profile Unavailable for Rapid Rail
        </div>
        <div style={{ fontSize: 11, color: '#64748B', maxWidth: 400, lineHeight: 1.45 }}>
          {emptyReason ||
            'Rapid Rail datasets provide daily totals without hourly timestamps. Select KTM Komuter (KV), KTM Intercity, or All Included OD Services to inspect average hourly demand.'}
        </div>
      </div>
    );
  }

  if (!hasChartData) {
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
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0F1E36' }}>No Hourly Profile Data</div>
        <div style={{ fontSize: 11, color: '#64748B' }}>
          {emptyReason || 'No hourly records available for this selection.'}
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
        <span style={{ fontSize: 10.5, color: '#64748B' }}>
          <strong style={{ color: '#0066FF' }}>{comparisonSummary}</strong>
        </span>
        <span style={{ fontSize: 9.5, color: '#94A3B8' }}>{coverageNote}</span>
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
