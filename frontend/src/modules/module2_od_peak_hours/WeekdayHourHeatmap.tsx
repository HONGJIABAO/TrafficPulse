import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { HeatmapPoint, OdModeFilter } from './types';
import { formatMillions } from '@/modules/shared/types';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';

interface Props {
  komuterData: HeatmapPoint[];
  intercityData: HeatmapPoint[];
  selectedMode: OdModeFilter;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = [
  '12AM', '1AM', '2AM', '3AM', '4AM', '5AM',
  '6AM', '7AM', '8AM', '9AM', '10AM', '11AM',
  '12PM', '1PM', '2PM', '3PM', '4PM', '5PM',
  '6PM', '7PM', '8PM', '9PM', '10PM', '11PM',
];

export const WeekdayHourHeatmap: React.FC<Props> = ({
  komuterData,
  intercityData,
  selectedMode,
}) => {
  // Clear unavailable state when Rapid Rail is selected (audit integrity compliance)
  if (selectedMode === 'rapid_rail') {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 210,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#F8FAFC',
          borderRadius: 8,
          border: '1px dashed rgba(0, 102, 255, 0.2)',
          padding: '24px 20px',
          textAlign: 'center',
          gap: 8,
        }}
      >
        <TelemetryIcon name="clock-radar" variant="cobalt" badge size={16} />
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36' }}>
          Hourly Demand Matrix Unavailable for Rapid Rail
        </div>
        <div style={{ fontSize: 11, color: '#64748B', maxWidth: 400, lineHeight: 1.45 }}>
          Prasarana / Rapid Rail open data provides daily Origin-Destination aggregate matrices only. High-resolution 24-hour telemetry records are captured for KTM Komuter &amp; KTM Intercity.
        </div>
        <div style={{ fontSize: 10, color: '#0066FF', fontWeight: 600, background: 'rgba(0, 102, 255, 0.08)', padding: '3px 9px', borderRadius: 5 }}>
          Select "All Rail Modes" or "KTM Komuter" to inspect 24-hour demand heatmaps.
        </div>
      </div>
    );
  }

  // Combine or select data depending on filter
  const dataset = useMemo(() => {
    if (selectedMode === 'intercity') {
      return intercityData;
    }
    if (selectedMode === 'komuter') {
      return komuterData;
    }
    // 'all' network mode (combines Komuter + Intercity hourly datasets):
    const map = new Map<string, number>();
    komuterData.forEach((p) => {
      const k = `${p.weekday}-${p.hour}`;
      map.set(k, (map.get(k) || 0) + p.ridership);
    });
    intercityData.forEach((p) => {
      const k = `${p.weekday}-${p.hour}`;
      map.set(k, (map.get(k) || 0) + p.ridership);
    });

    const res: HeatmapPoint[] = [];
    map.forEach((val, key) => {
      const [w, h] = key.split('-').map(Number);
      res.push({ weekday: w, hour: h, ridership: val });
    });
    return res;
  }, [komuterData, intercityData, selectedMode]);

  const maxVal = useMemo(() => {
    return Math.max(...dataset.map((d) => d.ridership), 1);
  }, [dataset]);

  // Convert to ECharts heatmap format: [hourIdx, dayIdx, value]
  const chartData = useMemo(() => {
    return dataset.map((d) => {
      const dayIdx = Math.max(0, Math.min(6, d.weekday - 1));
      return [d.hour, dayIdx, d.ridership];
    });
  }, [dataset]);

  // Extract peak surge hours (top rush hours) for the live pulse ripple animation
  const peakPulsePoints = useMemo(() => {
    return dataset
      .filter((d) => d.ridership >= maxVal * 0.65)
      .map((d) => {
        const dayIdx = Math.max(0, Math.min(6, d.weekday - 1));
        return [d.hour, dayIdx, d.ridership];
      });
  }, [dataset, maxVal]);

  const option = useMemo(() => {
    return {
      animation: true,
      animationDuration: 1400,
      animationEasing: 'cubicOut',
      tooltip: {
        position: 'top',
        backgroundColor: 'rgba(15, 30, 54, 0.95)',
        borderColor: '#0066FF',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#FFFFFF', fontSize: 12 },
        formatter: (params: any) => {
          const [hourIdx, dayIdx, val] = params.value;
          const dayName = DAYS[dayIdx];
          const hourLabel = `${hourIdx.toString().padStart(2, '0')}:00 – ${(hourIdx + 1)
            .toString()
            .padStart(2, '0')}:00`;
          const pctOfMax = ((val / maxVal) * 100).toFixed(0);

          let statusColor = '#0D9488';
          let statusLabel = 'Light Off-Peak';
          let advisory = 'Normal headway intervals sufficient.';
          if (val > maxVal * 0.7) {
            statusColor = '#EF4444';
            statusLabel = 'Severe Peak Surge (Overcrowding Risk)';
            advisory = 'Mandate 4–6 min maximum headway + 6-car EMU sets.';
          } else if (val > maxVal * 0.4) {
            statusColor = '#EA580C';
            statusLabel = 'High Commuter Demand';
            advisory = 'Standard peak frequency required.';
          } else if (val > maxVal * 0.2) {
            statusColor = '#EAB308';
            statusLabel = 'Moderate Shoulder Flow';
            advisory = 'Maintain steady intermediate service.';
          }

          const statusBadge = `<span style="display:inline-flex;align-items:center;gap:6px;"><span style="width:7px;height:7px;border-radius:50%;background:${statusColor};box-shadow:0 0 6px ${statusColor};"></span><span>${statusLabel}</span></span>`;

          return `
            <div style="font-weight: 700; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 3px;">
              ${dayName} • ${hourLabel}
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
              <span style="color: #94A3B8;">Estimated Trips:</span>
              <strong style="color: #00E5A3;">${val.toLocaleString()} (${formatMillions(val)})</strong>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 16px; margin: 3px 0;">
              <span style="color: #94A3B8;">Peak Intensity:</span>
              <span style="color: #FFC400; font-weight: 600;">${pctOfMax}% of weekly peak</span>
            </div>
            <div style="margin-top: 6px; padding-top: 4px; border-top: 1px dashed rgba(255,255,255,0.15); font-size: 11px;">
              <div>${statusBadge}</div>
              <div style="color: #CBD5E1; font-style: italic; margin-top: 2px;">${advisory}</div>
            </div>
          `;
        },
      },
      grid: {
        top: 10,
        right: 12,
        bottom: 24,
        left: 36,
      },
      xAxis: {
        type: 'category',
        data: HOURS,
        splitArea: { show: true, areaStyle: { color: ['rgba(255,255,255,0.5)', 'rgba(241,244,249,0.3)'] } },
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#64748B',
          fontSize: 9.5,
          interval: 2,
        },
      },
      yAxis: {
        type: 'category',
        data: DAYS,
        splitArea: { show: true },
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#0F1E36',
          fontWeight: 600,
          fontSize: 10.5,
        },
      },
      // Keep visualMap active for color mapping, but hide in-canvas component to prevent overlap with X-axis labels
      visualMap: {
        show: false,
        min: 0,
        max: maxVal,
        inRange: {
          color: [
            '#F1F4F9',
            '#DBEAFE',
            '#93C5FD',
            '#3B82F6',
            '#0066FF',
            '#F59E0B',
            '#FF5A00',
          ],
        },
      },
      series: [
        {
          name: 'Hourly Passenger Trips',
          type: 'heatmap',
          data: chartData,
          label: { show: false },
          itemStyle: {
            borderColor: '#FFFFFF',
            borderWidth: 1.5,
            borderRadius: 3,
          },
          emphasis: {
            itemStyle: {
              shadowBlur: 14,
              shadowColor: 'rgba(255, 90, 0, 0.65)',
              borderColor: '#0066FF',
              borderWidth: 2,
            },
          },
        },
        // Continuous Pulse Ripple Effect on Peak Rush Hours
        {
          name: 'Peak Rush Pulse',
          type: 'effectScatter',
          coordinateSystem: 'cartesian2d',
          data: peakPulsePoints,
          symbolSize: 6,
          showEffectOn: 'render',
          rippleEffect: {
            brushType: 'stroke',
            scale: 3.5,
            period: 2.2,
            color: '#FF5A00',
          },
          itemStyle: {
            color: '#FF5A00',
            shadowBlur: 10,
            shadowColor: 'rgba(255, 90, 0, 0.8)',
          },
          silent: true,
          zlevel: 5,
        },
      ],
    };
  }, [chartData, peakPulsePoints, maxVal]);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @keyframes pulseDot {
          0%, 100% {
            transform: scale(0.9);
            box-shadow: 0 0 0 0 rgba(255, 90, 0, 0.7);
          }
          50% {
            transform: scale(1.2);
            box-shadow: 0 0 0 5px rgba(255, 90, 0, 0);
          }
        }
        .pulse-indicator-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #FF5A00;
          display: inline-block;
          animation: pulseDot 2s infinite ease-in-out;
        }
      `}</style>

      {/* Legend rendered as crisp HTML above or below without canvas collision */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 4,
          paddingRight: 4,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="pulse-indicator-dot" />
          <span style={{ fontSize: 9.5, fontWeight: 700, color: '#FF5A00', letterSpacing: '0.4px' }}>
            PEAK SURGE PULSE
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748B' }}>
          <span>Low Demand</span>
          <div
            style={{
              width: 72,
              height: 6,
              borderRadius: 3,
              background: 'linear-gradient(to right, #DBEAFE, #3B82F6, #0066FF, #F59E0B, #FF5A00)',
            }}
          />
          <span style={{ color: '#FF5A00', fontWeight: 600 }}>High Surge</span>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 180 }}>
        <ReactECharts
          option={option}
          style={{ width: '100%', height: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </div>
  );
};
