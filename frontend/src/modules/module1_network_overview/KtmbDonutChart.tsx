import { useState, useMemo, useRef } from 'react';
import ReactECharts from 'echarts-for-react';
import { formatServiceLabel } from '@/modules/shared/types';

interface KtmbService {
  service: string;
  total_ridership: number;
  share_pct: number;
}

interface Props {
  ktmb_services: KtmbService[];
}

// ── Distinct Soft-Cyber KTMB Colors ──────────────────────────────────────────
// Differentiates Komuter Utara (Cerulean Blue) from Intercity (Earth Brown)
const KTMB_COLORS: Record<string, string> = {
  komuter: '#FF5A00',        // Vibrant Orange
  komuter_utara: '#0288D1',  // Soft Cerulean Blue (distinguished from brown)
  ets: '#10B981',            // Emerald Green
  shuttle_tebrau: '#94A3B8', // Cool Slate Grey
  intercity: '#795548',      // Warm Earth Brown
};

export function KtmbDonutChart({ ktmb_services }: Props) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartRef = useRef<any>(null);

  // 1. Sort services from highest to lowest percentage
  const sortedServices = useMemo(() => {
    return [...ktmb_services]
      .sort((a, b) => b.share_pct - a.share_pct)
      .map((s) => ({
        ...s,
        displayName: formatServiceLabel(s.service),
        color: KTMB_COLORS[s.service] ?? '#94A3B8',
      }));
  }, [ktmb_services]);

  const totalRidership = useMemo(() => {
    return ktmb_services.reduce((sum, s) => sum + s.total_ridership, 0);
  }, [ktmb_services]);

  // Active item details for center badge display
  const activeItem = useMemo(() => {
    if (!hoveredName) return null;
    return sortedServices.find((s) => s.displayName === hoveredName) || null;
  }, [hoveredName, sortedServices]);

  // 2. Donut Chart Series Data
  const seriesData = useMemo(() => {
    return sortedServices.map((s) => ({
      name: s.displayName,
      value: s.total_ridership,
      itemStyle: {
        color: s.color,
        borderRadius: 3,
        borderColor: '#FFFFFF',
        borderWidth: 2,
      },
    }));
  }, [sortedServices]);

  // 3. ECharts Configuration
  const option = useMemo(() => {
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: { name: string; value: number; percent: number }) =>
          `<div style="font-weight:700;color:#0F1E36;margin-bottom:2px">${p.name}</div>
           <div style="font-size:11px;color:#64748B">${(p.value / 1e6).toFixed(1)}M trips (${p.percent}%)</div>`,
        backgroundColor: 'rgba(255, 255, 255, 0.96)',
        borderColor: 'rgba(0, 102, 255, 0.2)',
        borderWidth: 1,
        padding: [6, 10],
        textStyle: { fontSize: 11, color: '#0F1E36' },
      },
      series: [
        {
          type: 'pie',
          radius: [38, 56], // ~18px thickness donut ring
          center: ['50%', '50%'],
          avoidLabelOverlap: false,
          label: { show: false },
          labelLine: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 4,
            itemStyle: {
              shadowBlur: 8,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.15)',
            },
          },
          data: seriesData,
        },
      ],
    };
  }, [seriesData]);

  // 4. Bi-directional hover handlers between HTML Legend and ECharts
  const handleLegendHover = (name: string | null) => {
    setHoveredName(name);
    const chart = chartRef.current?.getEchartsInstance();
    if (!chart) return;

    if (name) {
      chart.dispatchAction({
        type: 'highlight',
        seriesIndex: 0,
        name,
      });
      chart.dispatchAction({
        type: 'showTip',
        seriesIndex: 0,
        name,
      });
    } else {
      chart.dispatchAction({
        type: 'downplay',
        seriesIndex: 0,
      });
      chart.dispatchAction({
        type: 'hideTip',
      });
    }
  };

  const chartEvents = useMemo(() => {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mouseover: (params: any) => {
        if (params.name) {
          setHoveredName(params.name);
        }
      },
      mouseout: () => {
        setHoveredName(null);
      },
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
      {/* ── Top: Centered Donut Chart with Center Text ── */}
      <div style={{ position: 'relative', width: '100%', height: 126 }}>
        <ReactECharts
          ref={chartRef}
          option={option}
          onEvents={chartEvents}
          style={{ height: 126, width: '100%' }}
        />

        {/* Center Donut Label */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            width: 72,
          }}
        >
          {activeItem ? (
            <>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: activeItem.color,
                  lineHeight: 1.1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {activeItem.share_pct.toFixed(1)}%
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: '#64748B',
                  marginTop: 2,
                  maxWidth: 68,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={activeItem.displayName}
              >
                {activeItem.displayName.replace('KTM ', '')}
              </div>
            </>
          ) : (
            <>
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 700,
                  color: '#0F1E36',
                  lineHeight: 1.1,
                }}
              >
                5 Services
              </div>
              <div
                style={{
                  fontSize: 9,
                  fontWeight: 500,
                  color: '#64748B',
                  marginTop: 2,
                }}
              >
                {(totalRidership / 1e6).toFixed(0)}M Total
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Bottom: Clean Vertical Legend List ── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          marginTop: 6,
          borderTop: '1px solid rgba(0, 102, 255, 0.08)',
          paddingTop: 6,
        }}
      >
        {sortedServices.map((service) => {
          const isHovered = hoveredName === service.displayName;

          return (
            <div
              key={service.service}
              onMouseEnter={() => handleLegendHover(service.displayName)}
              onMouseLeave={() => handleLegendHover(null)}
              title={`${service.displayName}: ${service.share_pct.toFixed(1)}% (${(service.total_ridership / 1e6).toFixed(1)}M trips)`}
              style={{
                display: 'flex',
                alignItems: 'center',
                height: 24,
                padding: '0 6px',
                borderRadius: 5,
                cursor: 'pointer',
                background: isHovered ? '#F0F7FF' : 'transparent',
                transition: 'background 0.15s ease',
              }}
            >
              {/* Colored Dot */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: service.color,
                  marginRight: 8,
                  flexShrink: 0,
                  boxShadow: isHovered ? `0 0 6px ${service.color}` : 'none',
                  transition: 'box-shadow 0.15s ease',
                }}
              />

              {/* Service Name (Left Aligned, ellipsis on overflow) */}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 12,
                  color: isHovered ? '#0066FF' : '#334155',
                  fontWeight: isHovered ? 600 : 500,
                  transition: 'color 0.15s ease',
                }}
              >
                {service.displayName}
              </span>

              {/* Percentage (Right Aligned, Tabular Digits) */}
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: isHovered ? '#0066FF' : '#0F1E36',
                  fontVariantNumeric: 'tabular-nums',
                  textAlign: 'right',
                  minWidth: 42,
                  marginLeft: 8,
                  flexShrink: 0,
                  letterSpacing: '0.2px',
                }}
              >
                {service.share_pct.toFixed(1)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default KtmbDonutChart;
