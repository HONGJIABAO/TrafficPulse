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
              background: 'rgba(0, 102, 255, 0.08)',
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
              background: 'rgba(0, 196, 140, 0.1)',
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
        {/* Directive 1: Morning Rush Relief */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 9,
            padding: '10px 12px',
            border: '1px solid rgba(0, 102, 255, 0.1)',
            borderLeft: '3.5px solid #0066FF',
            boxShadow: '0 2px 8px rgba(0, 102, 255, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <TelemetryIcon name="transit-rail" variant="cobalt" badge size={13} style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 700, color: '#0066FF', fontSize: 12 }}>
                Morning Rush Relief
              </div>
              <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                Peak-hour service frequency
              </div>
            </div>
          </div>
          <div style={{ color: '#475569', lineHeight: 1.4, fontSize: 11, marginTop: 2 }}>
            Suburban-to-CBD corridors (e.g. <strong>Batu Caves ➔ KL Sentral</strong>) exhibit sharp 07:00–08:45 AM commuter concentration (2.2× off-peak volume).
            <div style={{ color: '#0F1E36', fontWeight: 600, marginTop: 4 }}>
              Action: Assess additional train services and express turnarounds on high-density radial lines.
            </div>
          </div>
        </div>

        {/* Directive 2: Midday Off-Peak Timetable */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 9,
            padding: '10px 12px',
            border: '1px solid rgba(234, 88, 12, 0.15)',
            borderLeft: '3.5px solid #EA580C',
            boxShadow: '0 2px 8px rgba(234, 88, 12, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <TelemetryIcon name="lightning" variant="amber" badge size={13} style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 700, color: '#EA580C', fontSize: 12 }}>
                Off-Peak Energy Optimisation
              </div>
              <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                Midday service intervals
              </div>
            </div>
          </div>
          <div style={{ color: '#475569', lineHeight: 1.4, fontSize: 11, marginTop: 2 }}>
            Observed midday ridership (11:00 AM–2:00 PM) declines by ~75% relative to morning peak (~891 trips/hr).
            <div style={{ color: '#0F1E36', fontWeight: 600, marginTop: 4 }}>
              Action: Evaluate timetable adjustments during off-peak lulls to optimize traction energy.
            </div>
          </div>
        </div>

        {/* Directive 3: Weekend Retail Reallocation */}
        <div
          style={{
            background: '#FFFFFF',
            borderRadius: 9,
            padding: '10px 12px',
            border: '1px solid rgba(13, 148, 136, 0.15)',
            borderLeft: '3.5px solid #0D9488',
            boxShadow: '0 2px 8px rgba(13, 148, 136, 0.04)',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <TelemetryIcon name="transit-rail" variant="teal" badge size={13} style={{ width: 22, height: 22 }} />
            <div>
              <div style={{ fontWeight: 700, color: '#0D9488', fontSize: 12 }}>
                Weekend Retail &amp; Feeder Sync
              </div>
              <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>
                Feeder connectivity
              </div>
            </div>
          </div>
          <div style={{ color: '#475569', lineHeight: 1.4, fontSize: 11, marginTop: 2 }}>
            Weekend travel transitions to broader 12:00–18:00 leisure flows concentrated around commercial transit interchanges.
            <div style={{ color: '#0F1E36', fontWeight: 600, marginTop: 4 }}>
              Action: Coordinate rail and bus schedules around commercial hubs during afternoon leisure peaks.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
