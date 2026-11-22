import ReactECharts from 'echarts-for-react';
import { LINE_COLORS } from '@/modules/shared/types';

interface MonthlyTrend {
  year_month: string;
  year: number;
  month: number;
  total: number;
  lines: Record<string, number>;
}

interface Props {
  monthly_trend: MonthlyTrend[];
  selectedLine: string;
  playbackIdx: number;
}

export function RidershipTrendChart({ monthly_trend, selectedLine, playbackIdx }: Props) {
  const visible = monthly_trend.slice(0, playbackIdx + 1);
  const labels = visible.map(m => m.year_month);
  const values = visible.map(m =>
    selectedLine === 'All Lines' ? m.total : (m.lines[selectedLine] ?? 0)
  );

  const color = selectedLine === 'All Lines'
    ? '#0066FF'
    : (LINE_COLORS[selectedLine] ?? '#0066FF');

  const option = {
    grid: { top: 8, right: 4, bottom: 24, left: 36 },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: {
        fontSize: 9, color: '#94A3B8',
        formatter: (v: string) => {
          const [y, m] = v.split('-');
          const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
          return months[(+m) - 1];
        },
        interval: Math.floor(labels.length / 6),
      },
      axisLine: { lineStyle: { color: '#E2E8F0' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        fontSize: 9, color: '#94A3B8',
        formatter: (v: number) => v >= 1e6 ? `${(v/1e6).toFixed(0)}M` : `${(v/1e3).toFixed(0)}K`,
      },
      splitLine: { lineStyle: { color: '#F1F4F9' } },
    },
    series: [{
      type: 'line',
      data: values,
      smooth: 0.4,
      symbol: 'none',
      lineStyle: { color, width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: color + '33' }, { offset: 1, color: color + '00' }],
      }},
    }],
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#fff',
      borderColor: '#E2E8F0',
      textStyle: { fontSize: 11, color: '#0F1E36' },
      formatter: (params: { name: string; value: number }[]) => {
        const v = params[0]?.value ?? 0;
        return `${params[0]?.name}<br/><b>${(v/1e6).toFixed(2)}M</b> trips`;
      },
    },
  };

  return (
    <div style={{ marginTop: 10 }}>
      <ReactECharts option={option} style={{ height: 110 }} />
    </div>
  );
}
