import { useEffect, useRef } from 'react';
import type { EChartsOption } from 'echarts';
import { init, use as register, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, ScatterChart, HeatmapChart } from 'echarts/charts';
import { AriaComponent, CalendarComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { compact, num } from './analytics';
import type { Value } from './contracts';
import s from './dashboard.module.css';

register([BarChart, LineChart, ScatterChart, HeatmapChart, AriaComponent, CalendarComponent, GridComponent, LegendComponent,
  MarkLineComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export const chartColors = ['#0066FF', '#0D9488', '#FF884D', '#8B7CF8', '#28BFEF', '#EF4444'];
export const axisColor = '#72849C';
export const axisLine = '#DCE6F2';
export const gridLine = '#E7EFF8';

const tooltipTheme = {
  backgroundColor: 'rgba(255, 255, 255, 0.97)',
  borderColor: 'rgba(0, 102, 255, 0.18)',
  borderWidth: 1,
  padding: [8, 12],
  textStyle: { color: '#192B45', fontSize: 12, fontFamily: 'Inter, Segoe UI, sans-serif' },
  extraCssText: 'box-shadow: 0 6px 20px rgba(15, 30, 54, 0.1); border-radius: 8px;',
};

function areaGradient(hex: string) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: `${hex}34` },
      { offset: 1, color: `${hex}03` },
    ],
  };
}

export function Chart({ option, label, height = 290, onSelect }: {
  option: EChartsOption; label: string; height?: number; onSelect?: (name: string) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const chart = useRef<EChartsType | null>(null);
  const select = useRef(onSelect);
  useEffect(() => { select.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!surface.current) return;
    const instance = init(surface.current, undefined, { renderer: 'canvas' });
    chart.current = instance;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (surface.current?.clientWidth) instance.resize(); });
    });
    observer.observe(surface.current);
    instance.on('click', (event) => select.current?.(event.name));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); instance.dispose(); chart.current = null; };
  }, []);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const tooltip = option.tooltip && !Array.isArray(option.tooltip)
      ? { ...tooltipTheme, ...option.tooltip }
      : option.tooltip;
    chart.current?.setOption({
      textStyle: { fontFamily: 'Inter, Segoe UI, sans-serif', fontSize: 12, color: axisColor },
      color: chartColors,
      animation: !reducedMotion,
      animationDuration: 420,
      animationDurationUpdate: 360,
      animationEasing: 'cubicOut',
      ...option,
      tooltip,
    }, { notMerge: true });
  }, [option]);
  return <div aria-label={label} role="img" className={s.chart} ref={surface} style={{ height }} />;
}

type BarItem = { name: string; value: Value; color?: string };

export function Bars({ data, label, horizontal = false, height, decimals = 0, suffix = '' }: {
  data: BarItem[]; label: string; horizontal?: boolean; height?: number; decimals?: number; suffix?: string;
}) {
  const category = {
    type: 'category' as const,
    data: data.map((r) => r.name),
    axisLine: { lineStyle: { color: axisLine } },
    axisTick: { show: false },
    axisLabel: {
      interval: horizontal ? 0 : 'auto' as const,
      color: axisColor,
      hideOverlap: !horizontal,
      fontSize: 11,
      overflow: 'truncate' as const,
      width: horizontal ? 122 : 80,
    },
  };
  const values = {
    type: 'value' as const,
    splitLine: { lineStyle: { color: gridLine, type: 'dashed' as const } },
    axisLabel: { color: axisColor, fontSize: 11, formatter: (value: number) => `${compact(value)}${suffix}` },
  };
  const option: EChartsOption = {
    grid: { left: horizontal ? 128 : 54, right: horizontal ? 50 : 18, top: 14, bottom: 36 },
    tooltip: {
      ...tooltipTheme,
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 102, 255, 0.05)' } },
      confine: true,
      valueFormatter: (value) => typeof value === 'number' ? `${num(value, decimals)}${suffix}` : 'Unavailable',
    },
    xAxis: horizontal ? values : category,
    yAxis: horizontal ? { ...category, inverse: true } : values,
    series: [{
      name: label,
      type: 'bar',
      barMaxWidth: horizontal ? 20 : 42,
      emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(0, 102, 255, 0.22)' } },
      label: {
        show: horizontal,
        position: 'right',
        color: '#192B45',
        fontSize: 11,
        formatter: ({ value }) => typeof value === 'number' ? `${compact(value)}${suffix}` : '',
      },
      data: data.map((r) => ({
        value: r.value,
        itemStyle: {
          color: r.color ?? chartColors[0],
          borderRadius: horizontal ? [0, 5, 5, 0] : [5, 5, 0, 0],
        },
      })),
    }],
  };
  return <Chart option={option} label={label} height={height} />;
}

type Trace = { name: string; values: Value[]; color?: string; dashed?: boolean; area?: boolean };
type Marker = { date: string; name: string; color?: string };

export function Lines({ dates, traces, label, markers = [], height = 320, dateLabels = true, decimals = 0 }: {
  dates: string[]; traces: Trace[]; label: string; markers?: Marker[]; height?: number; dateLabels?: boolean; decimals?: number;
}) {
  const activeMarkers = markers.filter((marker) => dates.includes(marker.date));
  const option: EChartsOption = {
    grid: { left: 61, right: 24, top: 32, bottom: traces.length > 1 ? 68 : 38 },
    tooltip: {
      ...tooltipTheme,
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(0, 102, 255, 0.25)', type: 'dashed' } },
      confine: true,
      valueFormatter: (value) => typeof value === 'number' ? num(value, decimals) : 'Unavailable',
    },
    legend: {
      show: traces.length > 1,
      bottom: 0,
      type: 'scroll',
      icon: 'roundRect',
      itemWidth: 12,
      textStyle: { color: axisColor, fontSize: 11 },
    },
    xAxis: {
      type: 'category',
      data: dates,
      boundaryGap: false,
      axisLine: { lineStyle: { color: axisLine } },
      axisTick: { show: false },
      axisLabel: {
        color: axisColor,
        fontSize: 11,
        hideOverlap: true,
        formatter: (val: string) => dateLabels && val.length === 10 ? `${val.slice(8, 10)}/${val.slice(5, 7)}` : val,
      },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: gridLine, type: 'dashed' } },
      axisLabel: { color: axisColor, fontSize: 11, formatter: (val: number) => compact(val) },
    },
    series: traces.map((trace, index) => {
      const seriesColor = trace.color ?? chartColors[index % chartColors.length];
      return {
        type: 'line',
        name: trace.name,
        data: trace.values,
        symbol: 'circle',
        symbolSize: 6,
        showSymbol: false,
        connectNulls: false,
        emphasis: { focus: 'series', scale: true },
        itemStyle: { color: seriesColor },
        lineStyle: { width: 2.5, type: trace.dashed ? 'dashed' : 'solid' },
        areaStyle: trace.area ? { color: areaGradient(seriesColor) } : undefined,
        markLine: index === 0 && activeMarkers.length ? {
          silent: true,
          symbol: ['none', 'none'],
          label: { show: true, position: 'insideEndTop', fontSize: 10, color: '#475569' },
          data: activeMarkers.map((marker) => ({
            xAxis: marker.date,
            label: { formatter: marker.name },
            lineStyle: { color: marker.color ?? '#8BA3C2', type: 'dashed' as const },
          })),
        } : undefined,
      };
    }),
  };
  return <Chart option={option} label={label} height={height} />;
}
