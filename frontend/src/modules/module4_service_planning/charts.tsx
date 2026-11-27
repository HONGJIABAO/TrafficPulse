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

export const chartColors = ['#0066FF', '#00C48C', '#FF5A00', '#7B61FF', '#087FBA', '#E53935'];
export const axisColor = '#64748B';
export const axisLine = '#E2E8F0';

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
  useEffect(() => { chart.current?.setOption({ textStyle: { fontFamily: 'Inter, Segoe UI, sans-serif', fontSize: 12, color: axisColor },
    color: chartColors, animation: false, ...option }, { notMerge: true }); }, [option]);
  return <div aria-label={label} role="img" className={s.chart} ref={surface} style={{ height }} />;
}

type BarItem = { name: string; value: Value; color?: string };

export function Bars({ data, label, horizontal = false, height, decimals = 0, suffix = '' }: {
  data: BarItem[]; label: string; horizontal?: boolean; height?: number; decimals?: number; suffix?: string;
}) {
  const category = { type: 'category' as const, data: data.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false },
    axisLabel: { interval: horizontal ? 0 : 'auto' as const, color: axisColor, hideOverlap: !horizontal, fontSize: 11, overflow: 'truncate' as const, width: horizontal ? 122 : 80 } };
  const values = { type: 'value' as const, splitLine: { lineStyle: { color: axisLine } }, axisLabel: { color: axisColor, formatter: (value: number) => `${compact(value)}${suffix}` } };
  const option: EChartsOption = {
    grid: { left: horizontal ? 128 : 54, right: horizontal ? 50 : 18, top: 14, bottom: 36 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (value) => typeof value === 'number' ? `${num(value, decimals)}${suffix}` : 'Unavailable' },
    xAxis: horizontal ? values : category,
    yAxis: horizontal ? { ...category, inverse: true } : values,
    series: [{ name: label, type: 'bar', barMaxWidth: horizontal ? 20 : 42,
      label: { show: horizontal, position: 'right', color: '#0F1E36', fontSize: 11, formatter: ({ value }) => typeof value === 'number' ? `${compact(value)}${suffix}` : '' },
      data: data.map((r) => ({ value: r.value, itemStyle: { color: r.color ?? chartColors[0], borderRadius: horizontal ? [0, 4, 4, 0] : [5, 5, 0, 0] } })) }],
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
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (value) => typeof value === 'number' ? num(value, decimals) : 'Unavailable' },
    legend: { show: traces.length > 1, bottom: 0, type: 'scroll', icon: 'roundRect', itemWidth: 12, textStyle: { color: axisColor } },
    xAxis: { type: 'category', data: dates, boundaryGap: false, axisLine: { lineStyle: { color: axisLine } },
      axisLabel: { hideOverlap: true, formatter: (val: string) => dateLabels && val.length === 10 ? `${val.slice(8, 10)}/${val.slice(5, 7)}` : val } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: axisLine } }, axisLabel: { formatter: (val: number) => compact(val) } },
    series: traces.map((trace, index) => ({ type: 'line', name: trace.name, data: trace.values, showSymbol: false, connectNulls: false,
      itemStyle: { color: trace.color ?? chartColors[index % chartColors.length] }, lineStyle: { width: 2.6, type: trace.dashed ? 'dashed' : 'solid' },
      areaStyle: trace.area ? { opacity: .09 } : undefined,
      markLine: index === 0 && activeMarkers.length ? { silent: true, symbol: ['none', 'none'], label: { show: true, position: 'insideEndTop', fontSize: 10 },
        data: activeMarkers.map((marker) => ({ xAxis: marker.date, label: { formatter: marker.name }, lineStyle: { color: marker.color ?? '#64748B' } })) } : undefined,
    })),
  };
  return <Chart option={option} label={label} height={height} />;
}
