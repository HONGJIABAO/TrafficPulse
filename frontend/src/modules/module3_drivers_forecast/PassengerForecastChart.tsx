import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { MonthlyDriverData, ForecastHorizon, ForecastHorizonKey } from './types';

interface Props {
  historicalData: MonthlyDriverData[];
  forecasts: ForecastHorizon[];
  activeHorizon: ForecastHorizonKey;
  onSelectHorizon: (h: ForecastHorizonKey) => void;
}

export const PassengerForecastChart: React.FC<Props> = ({
  historicalData,
  forecasts,
  activeHorizon,
  onSelectHorizon,
}) => {
  // Use last 12 historical months for clean continuity
  const recentHistory = useMemo(() => historicalData.slice(-12), [historicalData]);
  const activeForecastObj = useMemo(
    () => forecasts.find((f) => f.horizon === activeHorizon) || forecasts[0],
    [forecasts, activeHorizon]
  );

  const chartData = useMemo(() => {
    const histDates = recentHistory.map((d) => d.month_start.slice(0, 7));
    const histValues = recentHistory.map((d) => Math.round(d.rail_total));
    const lastHistVal = histValues[histValues.length - 1];

    const fcDates = activeForecastObj.forecasts.map((f) => f.date.slice(0, 7));
    const allDates = [...histDates, ...fcDates];

    // Historical series: values for history, null for forecast
    const histSeries = [...histValues, ...fcDates.map(() => null)];

    // Forecast series: null for history except connecting last point
    const fcSeries = [
      ...histDates.slice(0, -1).map(() => null),
      lastHistVal,
      ...activeForecastObj.forecasts.map((f) => Math.round(f.predicted)),
    ];

    // Confidence Band Lower: null for history, connecting last point
    const lowerCiSeries = [
      ...histDates.slice(0, -1).map(() => null),
      lastHistVal,
      ...activeForecastObj.forecasts.map((f) => Math.round(f.lower_ci)),
    ];

    // Confidence Band Diff (Upper - Lower): 0 for history, upper - lower for forecast
    const ciDiffSeries = [
      ...histDates.slice(0, -1).map(() => null),
      0,
      ...activeForecastObj.forecasts.map((f) => Math.round(f.upper_ci - f.lower_ci)),
    ];

    return {
      allDates,
      histSeries,
      fcSeries,
      lowerCiSeries,
      ciDiffSeries,
      splitIndex: histDates.length - 1,
      splitDate: histDates[histDates.length - 1],
    };
  }, [recentHistory, activeForecastObj]);

  const option = useMemo(() => {
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
          const dateLabel = params[0].axisValue;
          const idx = chartData.allDates.indexOf(dateLabel);
          const isHistorical = idx < chartData.splitIndex;
          const isSplit = idx === chartData.splitIndex;

          let html = `<div style="font-weight: 700; margin-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 2px;">
            ${dateLabel} • ${isHistorical ? 'Historical Observed' : isSplit ? 'Forecast Transition' : 'Model Projected'}
          </div>`;

          const histParam = params.find((p) => p.seriesName === 'Actual Ridership' && p.value !== null);
          const fcParam = params.find((p) => p.seriesName === 'Ensemble Forecast' && p.value !== null);
          const lowerParam = params.find((p) => p.seriesName === 'Lower CI' && p.value !== null);
          const diffParam = params.find((p) => p.seriesName === 'Confidence Interval' && p.value !== null);

          if (histParam && isHistorical) {
            html += `
              <div style="display: flex; justify-content: space-between; gap: 14px; margin: 2px 0;">
                <span style="color: #0066FF;">● Actual Trips:</span>
                <strong style="color: #FFFFFF;">${(histParam.value / 1_000_000).toFixed(2)}M (${Number(histParam.value).toLocaleString()})</strong>
              </div>
            `;
          }

          if (fcParam && !isHistorical) {
            const predVal = fcParam.value;
            const lower = lowerParam?.value || predVal * 0.9;
            const upper = lower + (diffParam?.value || predVal * 0.2);

            html += `
              <div style="display: flex; justify-content: space-between; gap: 14px; margin: 2px 0;">
                <span style="color: #00E5A3;">● Predicted:</span>
                <strong style="color: #00E5A3;">${(predVal / 1_000_000).toFixed(2)}M trips</strong>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 14px; margin: 2px 0;">
                <span style="color: #94A3B8;">95% CI Range:</span>
                <span style="color: #FFC400; font-size: 10px;">${(lower / 1_000_000).toFixed(2)}M – ${(upper / 1_000_000).toFixed(2)}M</span>
              </div>
            `;
          }

          return html;
        },
      },
      legend: {
        top: 2,
        left: 6,
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        itemGap: 12,
        textStyle: { color: '#475569', fontSize: 11.5, fontWeight: 600 },
        data: ['Actual Ridership', 'Ensemble Forecast', 'Confidence Interval'],
      },
      grid: {
        top: 48,
        right: 24,
        bottom: 34,
        left: 54,
      },
      xAxis: {
        type: 'category',
        data: chartData.allDates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.3)' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#64748B',
          fontSize: 10,
          margin: 10,
          interval: 1,
        },
      },
      yAxis: {
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
      series: [
        // 1. Lower CI line (invisible anchor for stack)
        {
          name: 'Lower CI',
          type: 'line',
          stack: 'ci-band',
          data: chartData.lowerCiSeries,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: { opacity: 0 },
        },
        // 2. CI Difference (creates shaded band between lower and upper)
        {
          name: 'Confidence Interval',
          type: 'line',
          stack: 'ci-band',
          data: chartData.ciDiffSeries,
          symbol: 'none',
          lineStyle: { opacity: 0 },
          areaStyle: {
            color: 'rgba(0, 204, 140, 0.16)',
          },
        },
        // 3. Historical Actual line
        {
          name: 'Actual Ridership',
          type: 'line',
          data: chartData.histSeries,
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
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
                { offset: 0, color: 'rgba(0, 102, 255, 0.15)' },
                { offset: 1, color: 'rgba(0, 102, 255, 0.01)' },
              ],
            },
          },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: '#EF4444', type: 'dashed', width: 1.5 },
            label: {
              formatter: 'Forecast Horizon Starts',
              position: 'insideStartTop',
              fontSize: 10.5,
              color: '#EF4444',
              fontWeight: 700,
            },
            data: [{ xAxis: chartData.splitDate }],
          },
        },
        // 4. Forecast Projected line
        {
          name: 'Ensemble Forecast',
          type: 'line',
          data: chartData.fcSeries,
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { width: 2.5, color: '#00C48C', type: 'dashed' },
          itemStyle: { color: '#00C48C' },
        },
      ],
    };
  }, [chartData]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* ── Horizon Pills Header ─────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 4,
          zIndex: 10,
          display: 'flex',
          gap: 4,
          background: '#F1F4F9',
          padding: '2px',
          borderRadius: 7,
          border: '1px solid rgba(0, 102, 255, 0.1)',
          boxShadow: 'inset 0 1px 2px rgba(0, 0, 0, 0.04)',
        }}
      >
        {(['3_months', '6_months', '12_months'] as ForecastHorizonKey[]).map((h) => {
          const label = h === '3_months' ? '3M' : h === '6_months' ? '6M' : '12M';
          const isActive = activeHorizon === h;
          return (
            <button
              key={h}
              onClick={() => onSelectHorizon(h)}
              style={{
                background: isActive ? 'linear-gradient(135deg, #0066FF, #0052CC)' : 'transparent',
                color: isActive ? '#FFFFFF' : '#475569',
                border: 'none',
                borderRadius: 5,
                padding: '3px 9px',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: isActive ? '0 2px 6px rgba(0, 102, 255, 0.25)' : 'none',
                transition: 'all 0.15s ease',
              }}
            >
              {label}
            </button>
          );
        })}
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
