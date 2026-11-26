import React from 'react';
import { TelemetryIcon } from '@/modules/shared/TelemetryIcon';

export const OperatorInsightStrip: React.FC = () => {
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
        gap: 8,
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <TelemetryIcon name="decision-directives" variant="cobalt" badge />
          <span style={{ fontWeight: 700, fontSize: 13, color: '#0F1E36' }}>
            Public Transport Operator Decision Directives (APAD, Prasarana &amp; KTMB)
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
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
            SDG 9: Resilient Infrastructure
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
            SDG 11: Sustainable Urban Transit
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
        {/* Directive 1: Morning Rush Surge */}
        <div
          style={{
            background: '#F8FAFC',
            borderRadius: 8,
            padding: '10px 12px',
            borderLeft: '3px solid #0066FF',
          }}
        >
          <div style={{ fontWeight: 700, color: '#0066FF', marginBottom: 2 }}>
            1. Suburban Morning Rush Relief
          </div>
          <div style={{ color: '#475569', lineHeight: 1.4 }}>
            Suburban-to-CBD corridors (e.g. <strong>Batu Caves ➔ KL Sentral</strong>, 915k trips) peak at <strong>07:00–08:45 AM</strong> with 2.2x volume over weekend.
            <div style={{ color: '#0F1E36', fontWeight: 600, marginTop: 4 }}>
              Action: Deploy 3 extra 6-car EMU sets to achieve 5-min headways.
            </div>
          </div>
        </div>

        {/* Directive 2: Midday Off-Peak Timetable */}
        <div
          style={{
            background: '#F8FAFC',
            borderRadius: 8,
            padding: '10px 12px',
            borderLeft: '3px solid #FF8C00',
          }}
        >
          <div style={{ fontWeight: 700, color: '#FF8C00', marginBottom: 2 }}>
            2. Dynamic Off-Peak Energy Optimization
          </div>
          <div style={{ color: '#475569', lineHeight: 1.4 }}>
            Midday demand drops by <strong>75%</strong> between 11:00 AM and 2:00 PM (averaging only ~891 trips/hr vs ~3,994 peak).
            <div style={{ color: '#0F1E36', fontWeight: 600, marginTop: 4 }}>
              Action: Widen midday intervals from 10m to 15m; cuts traction energy by ~22%.
            </div>
          </div>
        </div>

        {/* Directive 3: Weekend Retail Reallocation */}
        <div
          style={{
            background: '#F8FAFC',
            borderRadius: 8,
            padding: '10px 12px',
            borderLeft: '3px solid #00C48C',
          }}
        >
          <div style={{ fontWeight: 700, color: '#00A389', marginBottom: 2 }}>
            3. Weekend Retail & Feeder Sync
          </div>
          <div style={{ color: '#475569', lineHeight: 1.4 }}>
            Weekend travel shifts to a single broad leisure curve peaking at <strong>12:00–16:00 PM</strong> around TRX, Bukit Bintang, and KLCC.
            <div style={{ color: '#0F1E36', fontWeight: 600, marginTop: 4 }}>
              Action: Re-time weekend feeder buses to match 8-min mall hub train schedules.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
