import React from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';
import type { DynamicInsightItem } from './odAnalyticsUtils';

interface Props {
  insights: DynamicInsightItem[];
}

const STYLE_BY_ID: Record<
  DynamicInsightItem['id'],
  { color: string; border: string; icon: 'transit-rail' | 'lightning' | 'dual-waveform'; variant: 'cobalt' | 'amber' | 'teal' }
> = {
  morning_rush: {
    color: '#0066FF',
    border: 'rgba(0, 102, 255, 0.12)',
    icon: 'transit-rail',
    variant: 'cobalt',
  },
  midday_lull: {
    color: '#EA580C',
    border: 'rgba(234, 88, 12, 0.16)',
    icon: 'lightning',
    variant: 'amber',
  },
  weekday_weekend: {
    color: '#0D9488',
    border: 'rgba(13, 148, 136, 0.16)',
    icon: 'dual-waveform',
    variant: 'teal',
  },
};

export const OperatorInsightStrip: React.FC<Props> = ({ insights }) => {
  return (
    <div
      style={{
        background: '#FFFFFF',
        borderRadius: 12,
        border: '1px solid rgba(0, 102, 255, 0.1)',
        boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <TelemetryIcon name="decision-directives" variant="cobalt" badge />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#0F1E36' }}>
            Analytical Insights &amp; Service Planning Considerations (APAD, Prasarana &amp; KTMB)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span
            style={{
              background: 'rgba(0, 102, 255, 0.1)',
              color: '#0066FF',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            SDG 9: Infrastructure &amp; Corridor Load
          </span>
          <span
            style={{
              background: 'rgba(0, 229, 163, 0.15)',
              color: '#00A389',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            SDG 11: Sustainable Urban Connectivity
          </span>
          <span
            style={{
              background: 'rgba(79, 70, 229, 0.1)',
              color: '#4F46E5',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            SDG 8: Workday Commute Mobility
          </span>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          fontSize: 12,
        }}
      >
        {insights.map((item) => {
          const cfg = STYLE_BY_ID[item.id];
          return (
            <div
              key={item.id}
              style={{
                background: '#FFFFFF',
                borderRadius: 9,
                padding: '10px 12px',
                border: `1px solid ${cfg.border}`,
                borderLeft: `3.5px solid ${cfg.color}`,
                boxShadow: '0 2px 8px rgba(0, 102, 255, 0.04)',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <TelemetryIcon name={cfg.icon} variant={cfg.variant} badge size={13} style={{ width: 22, height: 22 }} />
                  <div>
                    <div style={{ fontWeight: 700, color: cfg.color, fontSize: 12 }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: cfg.color,
                    background: `${cfg.color}12`,
                    borderRadius: 4,
                    padding: '1px 6px',
                  }}
                >
                  {item.sdgTag}
                </span>
              </div>
              <div style={{ color: '#475569', lineHeight: 1.42, fontSize: 11 }}>
                {item.observation}
              </div>
              <div style={{ color: '#0F1E36', fontWeight: 600, fontSize: 11, marginTop: 'auto', paddingTop: 2 }}>
                Planning focus: {item.action}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
