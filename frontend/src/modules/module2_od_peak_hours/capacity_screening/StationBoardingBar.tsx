import React from 'react';
import type { CapacityMode, EvaluatedMetricSnapshot } from './capacityScreeningTypes';
import { formatCompactNumber, formatHourLabel } from './capacityScreeningUtils';

interface StationBoardingBarProps {
  stationName: string;
  directionLabel: string;
  boardingMode: 'full_station_boarding' | 'fallback_downstream_segment' | 'unavailable';
  capacityMode: CapacityMode;
  evalData: EvaluatedMetricSnapshot;
  gtfsInterpolated: boolean;
  unavailableReason?: string;
  observedPaxWindow?: number;
  observedPaxFull2026?: number;
}

export const StationBoardingBar: React.FC<StationBoardingBarProps> = ({
  stationName,
  directionLabel,
  boardingMode,
  capacityMode,
  evalData,
  gtfsInterpolated,
  unavailableReason,
  observedPaxWindow,
  observedPaxFull2026,
}) => {
  if (boardingMode === 'unavailable') {
    return (
      <div
        style={{
          background: '#F1F5F9',
          border: '1px solid #CBD5E1',
          borderRadius: 10,
          padding: 14,
          color: '#334155',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Screening Unavailable
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#E2E8F0',
              color: '#475569',
            }}
          >
            Unverified / Unsupported
          </span>
        </div>
        <p style={{ margin: '0 0 8px', fontSize: 13, lineHeight: 1.45, color: '#334155' }}>
          {unavailableReason || 'Capacity and hourly boarding data are not supported for this station or service.'}
        </p>
        {(observedPaxWindow !== undefined || observedPaxFull2026 !== undefined) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: '#475569', borderTop: '1px solid #CBD5E1', paddingTop: 8 }}>
            <span>
              GTFS overlap window (Aug 18–Nov 26, 101d): <strong>{formatCompactNumber(observedPaxWindow)}</strong>
            </span>
            <span>
              Panel 2 full archive (Jan 1–Nov 26, 330d; vs Panel 1 Nov 20, 324d): <strong>{formatCompactNumber(observedPaxFull2026)}</strong>
            </span>
          </div>
        )}
      </div>
    );
  }

  const sOut = evalData.scheduledCapacity ?? 0;
  const dOut = evalData.demandValue ?? 0;
  const tLoad = evalData.boardingThroughT;
  const bDemand = evalData.boardingDemandB ?? 0;
  const capLabel = capacityMode === 'official_2023_nominal' ? 'Nominal Rate Card' : '80% Comfort Benchmark';

  if (boardingMode === 'fallback_downstream_segment') {
    const segDeficit = sOut > 0 ? Math.max(0, dOut - sOut) : null;
    return (
      <div
        style={{
          background: '#F8FAFC',
          border: '1px solid #CBD5E1',
          borderRadius: 10,
          padding: 14,
          color: '#0F1E36',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#1E293B' }}>
            Junction Fallback: Outbound Segment Screening
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 999,
              background: '#E0E7FF',
              color: '#3730A3',
            }}
          >
            Multi-Branch Interchange
          </span>
        </div>
        <p style={{ margin: '0 0 10px', fontSize: 12, lineHeight: 1.45, color: '#475569' }}>
          <strong>{stationName}</strong> merges/splits multiple branches; inbound-to-outbound through load (T) cannot be allocated without branch-level gate transfer logs. Screening falls back to outbound segment load (<strong>{directionLabel}</strong>).
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, fontSize: 12 }}>
          <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '8px 10px', border: '1px solid #E2E8F0' }}>
            <div style={{ color: '#64748B', fontSize: 11 }}>Local Boardings (B)</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0066FF' }}>{formatCompactNumber(bDemand, 0)} pax</div>
          </div>
          <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '8px 10px', border: '1px solid #E2E8F0' }}>
            <div style={{ color: '#64748B', fontSize: 11 }}>Outbound Flow (D_out)</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0F1E36' }}>{formatCompactNumber(dOut, 0)} pax</div>
          </div>
          <div style={{ background: '#FFFFFF', borderRadius: 8, padding: '8px 10px', border: '1px solid #E2E8F0' }}>
            <div style={{ color: '#64748B', fontSize: 11 }}>Segment Gap ({capLabel})</div>
            <div style={{ fontWeight: 700, fontSize: 14, color: segDeficit && segDeficit > 0 ? '#DC2626' : '#0D9488' }}>
              {segDeficit === null ? 'No Service' : segDeficit > 0 ? `-${formatCompactNumber(segDeficit, 0)} pax` : 'Within Cap'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full station boarding breakdown: T + B vs S_out
  const safeT = tLoad ?? 0;
  const avail = evalData.boardingAvailable ?? 0;
  const bGap = evalData.boardingGap ?? 0;
  const scaleMax = Math.max(sOut, safeT + bDemand, 1);

  const tPct = Math.min(100, (safeT / scaleMax) * 100);
  const bAccom = Math.max(0, bDemand - bGap);
  const bAccomPct = Math.min(100 - tPct, (bAccom / scaleMax) * 100);
  const bGapPct = Math.min(100 - tPct - bAccomPct, (bGap / scaleMax) * 100);
  const capMarkerPct = Math.min(100, (sOut / scaleMax) * 100);

  return (
    <div
      style={{
        background: '#F8FAFC',
        border: '1px solid #E2E8F0',
        borderRadius: 10,
        padding: 14,
        color: '#0F1E36',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#0F1E36' }}>
            Station Boarding Capacity Breakdown ({formatHourLabel(evalData.peakHour)}
            {evalData.peakDate ? ` on ${evalData.peakDate}` : ''})
          </span>
          <div style={{ fontSize: 11, color: '#64748B' }}>
            Outbound {directionLabel} | Conservation: D_in - A + B = D_out
          </div>
        </div>
        {evalData.upstreamAlreadyFull && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: '3px 8px',
              borderRadius: 999,
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#DC2626',
            }}
          >
            Upstream Already Full (T &gt; S)
          </span>
        )}
      </div>

      {/* Stacked visual bar */}
      <div style={{ position: 'relative', height: 22, background: '#E2E8F0', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
        <div
          title={`Through onboard load T = ${formatCompactNumber(safeT, 0)} pax`}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${tPct}%`,
            background: '#475569',
          }}
        />
        <div
          title={`Accommodated station boardings = ${formatCompactNumber(bAccom, 0)} pax`}
          style={{
            position: 'absolute',
            left: `${tPct}%`,
            top: 0,
            bottom: 0,
            width: `${bAccomPct}%`,
            background: '#0066FF',
          }}
        />
        {bGap > 0 && (
          <div
            title={`Boarding capacity deficit = ${formatCompactNumber(bGap, 0)} pax`}
            style={{
              position: 'absolute',
              left: `${tPct + bAccomPct}%`,
              top: 0,
              bottom: 0,
              width: `${bGapPct}%`,
              background: '#DC2626',
            }}
          />
        )}
        {sOut > 0 && (
          <div
            title={`Scheduled outbound capacity S = ${formatCompactNumber(sOut, 0)} pax`}
            style={{
              position: 'absolute',
              left: `calc(${capMarkerPct}% - 1px)`,
              top: 0,
              bottom: 0,
              width: 2,
              background: '#0F1E36',
            }}
          />
        )}
      </div>

      {/* Legend & numbers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6, fontSize: 11 }}>
        <div>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#475569', marginRight: 4 }} />
          <span style={{ color: '#64748B' }}>Through (T):</span>{' '}
          <strong>{formatCompactNumber(safeT, 0)}</strong>
        </div>
        <div>
          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#0066FF', marginRight: 4 }} />
          <span style={{ color: '#64748B' }}>Boarding (B):</span>{' '}
          <strong>{formatCompactNumber(bDemand, 0)}</strong>
        </div>
        <div>
          <span style={{ color: '#64748B' }}>Avail Room:</span>{' '}
          <strong style={{ color: avail <= 0 ? '#B45309' : '#0D9488' }}>{formatCompactNumber(avail, 0)}</strong>
        </div>
        <div>
          <span style={{ color: '#64748B' }}>Boarding Gap:</span>{' '}
          <strong style={{ color: bGap > 0 ? '#DC2626' : '#0F1E36' }}>
            {bGap > 0 ? `${formatCompactNumber(bGap, 0)} pax` : '0 pax'}
          </strong>
        </div>
      </div>

      {gtfsInterpolated && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: '#92400E',
            background: '#FFFBEB',
            border: '1px solid #FDE68A',
            borderRadius: 6,
            padding: '4px 8px',
          }}
        >
          Note: Southbound GTFS feed omits stop_times rows at Kuala Kubu Bharu &amp; Rasa; passing times are proportionally reconstructed along the verified Tanjong Malim–Batang Kali corridor.
        </div>
      )}
    </div>
  );
};
