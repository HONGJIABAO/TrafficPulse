import React from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  borderRadius: 12,
  border: '1px solid rgba(0, 102, 255, 0.1)',
  boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
  padding: '12px 14px',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
};

export const KeyInsightsStrip: React.FC = () => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12,
        height: 94,
        flexShrink: 0,
      }}
    >
      {/* Insight 1: Ridership Trajectory */}
      <div style={cardStyle}>
        <div style={{ flexShrink: 0 }}>
          <TelemetryIcon
            name="trend-up"
            variant="cobalt"
            badge
            size={22}
            style={{ width: 44, height: 44, borderRadius: 10 }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 2 }}>
            Ridership Growth Trajectory
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: '#475569',
              lineHeight: 1.4,
            }}
          >
            Projected to grow by <strong style={{ color: '#00A389' }}>+8.7%</strong> over next 6 months, expanding toward <strong style={{ color: '#0F1E36' }}>34M+ monthly trips</strong> across all rail lines.
          </div>
        </div>
      </div>

      {/* Insight 2: Fuel Price Elasticity */}
      <div style={cardStyle}>
        <div style={{ flexShrink: 0 }}>
          <TelemetryIcon
            name="fuel"
            variant="amber"
            badge
            size={22}
            style={{ width: 44, height: 44, borderRadius: 10 }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 2 }}>
            Fuel Price Elasticity
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: '#475569',
              lineHeight: 1.4,
            }}
          >
            Strong correlation (<strong style={{ color: '#0066FF' }}>r = +0.67</strong> with diesel) confirms pump price increases accelerate modal shift from private vehicles.
          </div>
        </div>
      </div>

      {/* Insight 3: Road Congestion Capture */}
      <div style={cardStyle}>
        <div style={{ flexShrink: 0 }}>
          <TelemetryIcon
            name="car"
            variant="teal"
            badge
            size={22}
            style={{ width: 44, height: 44, borderRadius: 10 }}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0F1E36', marginBottom: 2 }}>
            Congestion &amp; Vehicle Surge
          </div>
          <div
            style={{
              fontSize: 11.5,
              color: '#475569',
              lineHeight: 1.4,
            }}
          >
            New vehicle adds (<strong style={{ color: '#FF8C00' }}>+5.4% YoY</strong>) worsen highway gridlock, driving higher passenger capture along key commuter trunks.
          </div>
        </div>
      </div>
    </div>
  );
};
