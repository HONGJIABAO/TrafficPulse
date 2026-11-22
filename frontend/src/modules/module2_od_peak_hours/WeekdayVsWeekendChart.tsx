import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { WeekdayVsWeekendData, OdModeFilter } from './types';

interface Props {
  komuterData: WeekdayVsWeekendData;
  intercityData: WeekdayVsWeekendData;
  selectedMode: OdModeFilter;
}

const HOURS = [
  '12AM', '1AM', '2AM', '3AM', '4AM', '5AM',
  '6AM', '7AM', '8AM', '9AM', '10AM', '11AM',
  '12PM', '1PM', '2PM', '3PM', '4PM', '5PM',
  '6PM', '7PM', '8PM', '9PM', '10PM', '11PM',
];

export const WeekdayVsWeekendChart: React.FC<Props> = ({
  komuterData,
  intercityData,
  selectedMode,
}) => {
  const activeSource = useMemo(() => {
    if (selectedMode === 'intercity') {
      return intercityData;
    }
    return komuterData;
  }, [komuterData, intercityData, selectedMode]);

  const weekdayValues = useMemo(() => {
    return activeSource.weekday.map((p) => Math.round(p.avg_ridership));
  }, [activeSource]);

  const weekendValues = useMemo(() => {
    return activeSource.weekend.map((p) => Math.round(p.avg_ridership));
  }, [activeSource]);

  // Calculate morning peak delta (8 AM)
  const morningDelta = useMemo(() => {
    const wd8 = weekdayValues[8] || 1;
    const we8 = weekendValues[8] || 1;
    return (((wd8 - we8) / we8) * 100).toFixed(0);
  }, [weekdayValues, weekendValues]);

  const option = useMemo(() => {
    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 30, 54, 0.95)',
        borderColor: '#0066FF',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: (params: any[]) => {
          if (!params || !params.length) return '';
          const hourLabel = params[0].axisValue;
          const wd = params.find((p) => p.seriesName === 'Weekday')?.value || 0;
          const we = params.find((p) => p.seriesName === 'Weekend')?.value || 0;
          const delta = wd - we;
          const pct = we > 0 ? ((delta / we) * 100).toFixed(0) : '0';

          return `
            <div style="font-weight: 700; margin-bottom: 5px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 3px;">
              Hourly Comparison • ${hourLabel}
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
              <span style="color: #60A5FA;">● Weekday Avg:</span>
              <strong style="color: #FFFFFF;">${wd.toLocaleString()} trips/hr</strong>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
              <span style="color: #FFA726;">● Weekend Avg:</span>
              <strong style="color: #FFFFFF;">${we.toLocaleString()} trips/hr</strong>
            </div>
            <div style="margin-top: 5px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.15); font-size: 11px;">
              <span style="color: ${delta >= 0 ? '#00E5A3' : '#FFD166'};">
                ${delta >= 0 ? `▲ +${pct}% higher on weekdays` : `▼ ${pct}% lower on weekdays`}
              </span>
            </div>
          `;
        },
      },
      legend: {
        top: 0,
        right: 8,
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: '#64748B', fontSize: 11, fontWeight: 500 },
        data: ['Weekday', 'Weekend'],
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
          formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`),
        },
      },
      series: [
        {
          name: 'Weekday',
          type: 'line',
          smooth: 0.35,
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
          markArea: {
            silent: true,
            itemStyle: {
              color: 'rgba(0, 102, 255, 0.04)',
            },
            data: [
              [{ xAxis: '7AM' }, { xAxis: '9AM' }],
              [{ xAxis: '5PM' }, { xAxis: '7PM' }],
            ],
          },
        },
        {
          name: 'Weekend',
          type: 'line',
          smooth: 0.35,
          showSymbol: false,
          data: weekendValues,
          lineStyle: { width: 2.2, color: '#FF5A00', type: 'dashed' },
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
        },
      ],
    };
  }, [weekdayValues, weekendValues]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
          paddingRight: 4,
        }}
      >
        <span style={{ fontSize: 11, color: '#64748B' }}>
          Peak Rush Surge: <strong style={{ color: '#0066FF' }}>+{morningDelta}%</strong> weekday morning spike
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 160 }}>
        <ReactECharts
          option={option}
          style={{ width: '100%', height: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
};
