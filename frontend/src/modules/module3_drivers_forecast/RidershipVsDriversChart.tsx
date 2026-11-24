import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MonthlyDriverData, TimeRangeFilter, DriverFocusFilter } from './types';

interface Props {
  data: MonthlyDriverData[];
  timeRange: TimeRangeFilter;
  driverFocus: DriverFocusFilter;
}

export const RidershipVsDriversChart: React.FC<Props> = ({
  data,
  timeRange,
  driverFocus,
}) => {
  const filteredData = useMemo(() => {
    if (timeRange === '12m') {
      return data.slice(-12);
    }
    if (timeRange === '24m') {
      return data.slice(-24);
    }
    return data;
  }, [data, timeRange]);

  const xLabels = useMemo(() => {
    return filteredData.map((d) => d.month_start.slice(0, 7));
  }, [filteredData]);

  const ridershipValues = useMemo(() => {
    return filteredData.map((d) => Math.round(d.rail_total));
  }, [filteredData]);

  const ron95Values = useMemo(() => {
    return filteredData.map((d) => Number(d.ron95_avg.toFixed(2)));
  }, [filteredData]);

  const dieselValues = useMemo(() => {
    return filteredData.map((d) => Number(d.diesel_avg.toFixed(2)));
  }, [filteredData]);

  const regValues = useMemo(() => {
    return filteredData.map((d) => d.registrations);
  }, [filteredData]);

  const option = useMemo(() => {
    const showFuel = driverFocus === 'all' || driverFocus === 'fuel';
    const showReg = driverFocus === 'all' || driverFocus === 'registrations';
    const showLabour = driverFocus === 'labour';

    // Series definitions
    const series: any[] = [
      {
        name: 'Rail Ridership',
        type: 'line',
        yAxisIndex: 0,
        data: ridershipValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: filteredData.length > 36 ? 0 : 4,
        lineStyle: { width: 3, color: '#0066FF' },
        itemStyle: { color: '#0066FF' },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 102, 255, 0.22)' },
              { offset: 1, color: 'rgba(0, 102, 255, 0.01)' },
            ],
          },
        },
      },
    ];

    // Configure Y-Axes
    const yAxis: any[] = [
      // Axis 0: Left Y-Axis for Rail Ridership
      {
        type: 'value',
        position: 'left',
        min: (value: { min: number }) => Math.floor(value.min * 0.95 / 1_000_000) * 1_000_000,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(241, 244, 249, 0.9)', type: 'dashed' } },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          margin: 8,
          formatter: (v: number) => `${(v / 1_000_000).toFixed(0)}M`,
        },
      },
    ];

    if (showFuel) {
      // Axis 1: Dedicated Fuel Price scale (RM 1.5 - RM 6.0)
      yAxis.push({
        type: 'value',
        position: 'right',
        min: 1.5,
        max: 6.0,
        axisLine: { lineStyle: { color: 'rgba(255, 140, 0, 0.4)' } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: '#FF8C00',
          fontSize: 10,
          margin: 6,
          formatter: (v: number) => `RM ${v.toFixed(1)}`,
        },
      });

      series.push({
        name: 'RON95 (RM/L)',
        type: 'line',
        yAxisIndex: 1,
        data: ron95Values,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2, color: '#FF8C00', type: 'dashed' },
        itemStyle: { color: '#FF8C00' },
      });

      series.push({
        name: 'Diesel (RM/L)',
        type: 'line',
        yAxisIndex: 1,
        data: dieselValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2.5, color: '#EF4444' },
        itemStyle: { color: '#EF4444' },
      });
    }

    if (showReg) {
      // In 'all' view with fuel active, give vehicle registrations its own 3rd axis
      const regAxisIndex = showFuel ? 2 : 1;

      yAxis.push({
        type: 'value',
        position: 'right',
        offset: showFuel ? 56 : 0,
        min: (value: { min: number }) => Math.floor(value.min * 0.9 / 1000) * 1000,
        max: (value: { max: number }) => Math.ceil(value.max * 1.05 / 1000) * 1000,
        axisLine: { lineStyle: { color: 'rgba(0, 196, 140, 0.4)' } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: '#00C48C',
          fontSize: 10,
          margin: 6,
          formatter: (v: number) => `${(v / 1000).toFixed(0)}k`,
        },
      });

      series.push({
        name: 'Vehicle Reg.',
        type: 'line',
        yAxisIndex: regAxisIndex,
        data: regValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2, color: '#00C48C' },
        itemStyle: { color: '#00C48C' },
      });
    }

    if (showLabour) {
      yAxis.push({
        type: 'value',
        position: 'right',
        min: 2.0,
        max: 4.5,
        axisLine: { lineStyle: { color: 'rgba(123, 97, 255, 0.4)' } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: '#7B61FF',
          fontSize: 10,
          formatter: (v: number) => `${v.toFixed(1)}%`,
        },
      });

      series.push({
        name: 'Unemployment (%)',
        type: 'line',
        yAxisIndex: 1,
        data: filteredData.map((d) => d.u_rate),
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2, color: '#7B61FF' },
        itemStyle: { color: '#7B61FF' },
      });
    }

    return {
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(15, 30, 54, 0.95)',
        borderColor: '#0066FF',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 11 },
        formatter: (params: any[]) => {
          if (!params || !params.length) return '';
          const monthLabel = params[0].axisValue;
          let html = `<div style="font-weight: 700; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 2px;">${monthLabel}</div>`;
          params.forEach((p) => {
            let valStr = p.value;
            if (p.seriesName === 'Rail Ridership') {
              valStr = `${(p.value / 1_000_000).toFixed(2)}M trips`;
            } else if (p.seriesName.includes('RON95') || p.seriesName.includes('Diesel')) {
              valStr = `RM ${Number(p.value).toFixed(2)} / L`;
            } else if (p.seriesName.includes('Vehicle')) {
              valStr = `${Number(p.value).toLocaleString()} vehicles`;
            } else if (p.seriesName.includes('Unemployment')) {
              valStr = `${Number(p.value).toFixed(1)}%`;
            }
            html += `
              <div style="display: flex; justify-content: space-between; gap: 14px; margin: 2px 0;">
                <span style="color: ${p.color};">● ${p.seriesName}:</span>
                <strong style="color: #FFFFFF;">${valStr}</strong>
              </div>
            `;
          });
          return html;
        },
      },
      legend: {
        top: 2,
        left: 'center',
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        itemGap: 14,
        textStyle: { color: '#64748B', fontSize: 11, fontWeight: 500 },
      },
      grid: {
        top: 48,
        right: showFuel && showReg ? 90 : 54,
        bottom: 34,
        left: 54,
      },
      xAxis: {
        type: 'category',
        data: xLabels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          margin: 10,
          interval: filteredData.length > 24 ? 5 : filteredData.length > 12 ? 2 : 0,
        },
      },
      yAxis,
      series,
    };
  }, [filteredData, xLabels, ridershipValues, ron95Values, dieselValues, regValues, driverFocus]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
      />
    </div>
  );
};
