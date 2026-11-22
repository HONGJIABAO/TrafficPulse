import ReactECharts from 'echarts-for-react';
import { LINE_COLORS, formatServiceLabel } from '@/modules/shared/types';

interface KtmbService {
  service: string;
  total_ridership: number;
  share_pct: number;
}

interface Props {
  ktmb_services: KtmbService[];
}

export function KtmbDonutChart({ ktmb_services }: Props) {
  const seriesData = ktmb_services.map(s => ({
    name: formatServiceLabel(s.service),
    value: s.total_ridership,
    itemStyle: { color: LINE_COLORS[s.service] ?? '#94A3B8' },
  }));

  const option = {
    tooltip: {
      trigger: 'item',
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/><b>${(p.value / 1e6).toFixed(1)}M</b> (${p.percent}%)`,
      backgroundColor: '#fff',
      borderColor: '#E2E8F0',
      textStyle: { fontSize: 11, color: '#0F1E36' },
    },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'center',
      textStyle: { fontSize: 10, color: '#0F1E36' },
      formatter: (name: string) => {
        const item = ktmb_services.find(s => formatServiceLabel(s.service) === name);
        return `${name}  ${item?.share_pct.toFixed(1)}%`;
      },
    },
    series: [{
      type: 'pie',
      radius: ['45%', '72%'],
      center: ['30%', '50%'],
      data: seriesData,
      label: { show: false },
      labelLine: { show: false },
      emphasis: { scale: true, scaleSize: 4 },
    }],
  };

  return <ReactECharts option={option} style={{ height: 130 }} />;
}
