import React, { useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MonthlyDriverData, TimeRangeFilter, DriverFocusFilter } from './types';

interface Props {
  data: MonthlyDriverData[];
  timeRange: TimeRangeFilter;
  driverFocus: DriverFocusFilter;
  onSelectDriverFocus?: (focus: DriverFocusFilter) => void;
}

export const RidershipVsDriversChart: React.FC<Props> = ({
  data,
  timeRange,
  driverFocus,
  onSelectDriverFocus,
}) => {
  // If 'all' is passed from elsewhere, default to 'fuel' for a clean 1-to-1 comparison
  const activeFocus: 'fuel' | 'registrations' | 'labour' =
    driverFocus === 'registrations'
      ? 'registrations'
      : driverFocus === 'labour'
      ? 'labour'
      : 'fuel';

  const handlePillClick = (key: 'fuel' | 'registrations' | 'labour') => {
    if (onSelectDriverFocus) {
      onSelectDriverFocus(key);
    }
  };

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
    return filteredData.map((d) => d.ron95_avg != null ? Number(d.ron95_avg.toFixed(2)) : null);
  }, [filteredData]);

  const dieselValues = useMemo(() => {
    return filteredData.map((d) => d.diesel_avg != null ? Number(d.diesel_avg.toFixed(2)) : null);
  }, [filteredData]);

  const regValues = useMemo(() => {
    return filteredData.map((d) => d.registrations);
  }, [filteredData]);

  const uRateValues = useMemo(() => {
    return filteredData.map((d) => d.u_rate);
  }, [filteredData]);

  const option = useMemo(() => {
    // 1. Primary Left Y-Axis Series: Rail Ridership
    const series: any[] = [
      {
        name: 'Rail Ridership',
        type: 'line',
        yAxisIndex: 0,
        data: ridershipValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: filteredData.length > 36 ? 0 : 5,
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

    // 2. Exactly TWO Y-Axes: Left (Ridership) & Right (Selected Driver)
    const yAxis: any[] = [
      {
        type: 'value',
        position: 'left',
        min: (value: { min: number }) => Math.floor((value.min * 0.95) / 1_000_000) * 1_000_000,
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

    let correlationBadge = '';

    if (activeFocus === 'fuel') {
      correlationBadge = 'r = +0.67';
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
        name: 'RON95 Price',
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
        name: 'Diesel Price',
        type: 'line',
        yAxisIndex: 1,
        data: dieselValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2.5, color: '#EF4444' },
        itemStyle: { color: '#EF4444' },
      });
    } else if (activeFocus === 'registrations') {
      correlationBadge = 'r = +0.60';
      yAxis.push({
        type: 'value',
        position: 'right',
        min: (value: { min: number }) => Math.floor((value.min * 0.9) / 1000) * 1000,
        max: (value: { max: number }) => Math.ceil((value.max * 1.05) / 1000) * 1000,
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
        name: 'Vehicle Registrations',
        type: 'line',
        yAxisIndex: 1,
        data: regValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2.5, color: '#00C48C' },
        itemStyle: { color: '#00C48C' },
      });
    } else if (activeFocus === 'labour') {
      correlationBadge = 'r = -0.93';
      yAxis.push({
        type: 'value',
        position: 'right',
        min: 2.5,
        max: 4.2,
        axisLine: { lineStyle: { color: 'rgba(123, 97, 255, 0.4)' } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          color: '#7B61FF',
          fontSize: 10,
          margin: 6,
          formatter: (v: number) => `${v.toFixed(1)}%`,
        },
      });

      series.push({
        name: 'Unemployment Rate',
        type: 'line',
        yAxisIndex: 1,
        data: uRateValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { width: 2.5, color: '#7B61FF' },
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
          let html = `
            <div style="font-weight: 700; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 2px; display: flex; justify-content: space-between;">
              <span>${monthLabel}</span>
              <span style="color: #00E5A3; font-size: 10px;">${correlationBadge}</span>
            </div>
          `;
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
        left: 6,
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        itemGap: 14,
        textStyle: { color: '#475569', fontSize: 11.5, fontWeight: 600 },
      },
      grid: {
        top: 48,
        right: 54,
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
  }, [
    filteredData,
    xLabels,
    ridershipValues,
    ron95Values,
    dieselValues,
    regValues,
    uRateValues,
    activeFocus,
  ]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* ── Driver Switcher Pills Header (Mirrors the Right Chart's Horizon Pills) ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 4,
          zIndex: 10,
          display: 'flex',
          gap: 3,
          background: '#F1F4F9',
          padding: '2px',
          borderRadius: 7,
          border: '1px solid rgba(0, 102, 255, 0.1)',
          boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.04)',
        }}
      >
        <button
          onClick={() => handlePillClick('fuel')}
          style={{
            background: activeFocus === 'fuel' ? 'linear-gradient(135deg, #0066FF, #0052CC)' : 'transparent',
            color: activeFocus === 'fuel' ? '#FFFFFF' : '#475569',
            border: 'none',
            borderRadius: 5,
            padding: '3px 9px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: activeFocus === 'fuel' ? '0 2px 6px rgba(0, 102, 255, 0.25)' : 'none',
            transition: 'all 0.15s ease',
          }}
          title="Compare Ridership vs Fuel Price (RON95 & Diesel)"
        >
          ⛽ Fuel Price
        </button>
        <button
          onClick={() => handlePillClick('registrations')}
          style={{
            background: activeFocus === 'registrations' ? 'linear-gradient(135deg, #0066FF, #0052CC)' : 'transparent',
            color: activeFocus === 'registrations' ? '#FFFFFF' : '#475569',
            border: 'none',
            borderRadius: 5,
            padding: '3px 9px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: activeFocus === 'registrations' ? '0 2px 6px rgba(0, 102, 255, 0.25)' : 'none',
            transition: 'all 0.15s ease',
          }}
          title="Compare Ridership vs Vehicle Registrations"
        >
          🚗 Vehicle Reg.
        </button>
        <button
          onClick={() => handlePillClick('labour')}
          style={{
            background: activeFocus === 'labour' ? 'linear-gradient(135deg, #0066FF, #0052CC)' : 'transparent',
            color: activeFocus === 'labour' ? '#FFFFFF' : '#475569',
            border: 'none',
            borderRadius: 5,
            padding: '3px 9px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: activeFocus === 'labour' ? '0 2px 6px rgba(0, 102, 255, 0.25)' : 'none',
            transition: 'all 0.15s ease',
          }}
          title="Compare Ridership vs Jobless Rate"
        >
          💼 Jobless Rate
        </button>
      </div>

      <ReactECharts
        option={option}
        style={{ width: '100%', height: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge={true}
      />
    </div>
  );
};
