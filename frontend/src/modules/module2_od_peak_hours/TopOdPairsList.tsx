import React, { useState, useMemo } from 'react';
import type { ResolvedOdFlow } from './types';
import { formatMillions } from '@/modules/shared/types';

interface Props {
  flows: ResolvedOdFlow[];
  selectedFlowId?: string | null;
  onSelectFlow: (flow: ResolvedOdFlow) => void;
  emptyReason?: string | null;
}

export const TopOdPairsList: React.FC<Props> = ({
  flows,
  selectedFlowId,
  onSelectFlow,
  emptyReason,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const filteredFlows = useMemo(() => {
    if (!searchQuery.trim()) return flows;
    const q = searchQuery.toLowerCase().trim();
    return flows.filter(
      (f) =>
        f.originClean.toLowerCase().includes(q) ||
        f.destinationClean.toLowerCase().includes(q) ||
        f.origin.toLowerCase().includes(q) ||
        f.destination.toLowerCase().includes(q)
    );
  }, [flows, searchQuery]);

  const displayList = useMemo(() => {
    return showAll ? filteredFlows : filteredFlows.slice(0, 5);
  }, [filteredFlows, showAll]);

  // Normalize bar width against highest comparable daily average in current view
  const maxDaily = useMemo(() => {
    return Math.max(...filteredFlows.map((f) => f.avgDaily), 1);
  }, [filteredFlows]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        gap: 8,
      }}
    >
      {/* Search Bar & View Toggle (pinned at top) */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input
            type="text"
            placeholder="Search stations (e.g., KL Sentral, KLCC)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              background: '#F8FAFF',
              border: '1px solid rgba(0, 102, 255, 0.2)',
              borderRadius: 7,
              padding: '6px 10px',
              fontSize: 11,
              color: '#0F1E36',
              outline: 'none',
              fontWeight: 500,
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: 8,
                top: 6,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#94A3B8',
                fontSize: 12,
              }}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {filteredFlows.length > 5 && (
          <button
            onClick={() => setShowAll(!showAll)}
            style={{
              background: 'none',
              border: 'none',
              color: '#0066FF',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              padding: '4px 6px',
            }}
          >
            {showAll ? 'Show Top 5 ▲' : `View More (${filteredFlows.length}) ➔`}
          </button>
        )}
      </div>

      {/* Ranking basis caption */}
      {filteredFlows.length > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9.5,
            color: '#64748B',
            paddingBottom: 2,
            borderBottom: '1px solid rgba(0, 102, 255, 0.06)',
            flexShrink: 0,
          }}
        >
          <span>Ranked by avg daily directional trips</span>
          <span>Total · Daily avg</span>
        </div>
      )}

      {/* List Container: internal vertical scroll */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          paddingRight: 4,
          minHeight: 0,
        }}
      >
        {displayList.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748B', fontSize: 11.5, lineHeight: 1.45 }}>
            {emptyReason || 'No OD corridor matched the active filter criteria.'}
          </div>
        ) : (
          displayList.map((flow, index) => {
            const isSelected = selectedFlowId === flow.id;
            const pct = Math.min(100, Math.max(10, Math.round((flow.avgDaily / maxDaily) * 100)));

            const modeColor =
              flow.mode === 'rapid_rail'
                ? '#0066FF'
                : flow.mode === 'komuter'
                  ? '#EA580C'
                  : '#0D9488';

            return (
              <div
                key={flow.id}
                onClick={() => onSelectFlow(flow)}
                style={{
                  flexShrink: 0,
                  minHeight: 48,
                  padding: '7px 10px',
                  borderRadius: 8,
                  background: isSelected
                    ? 'linear-gradient(135deg, #F0F6FF 0%, #E8F0FF 100%)'
                    : '#FFFFFF',
                  border: isSelected
                    ? '1.5px solid #0066FF'
                    : '1px solid rgba(0, 102, 255, 0.08)',
                  boxShadow: isSelected
                    ? '0 2px 8px rgba(0, 102, 255, 0.15)'
                    : '0 1px 3px rgba(0, 0, 0, 0.02)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = '#F8FAFF';
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = '#FFFFFF';
                }}
              >
                {/* Rank */}
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background:
                      index === 0
                        ? '#0066FF'
                        : index === 1
                          ? '#0052CC'
                          : index === 2
                            ? '#3B82F6'
                            : 'rgba(0, 102, 255, 0.08)',
                    color: index < 3 ? '#FFFFFF' : '#64748B',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {flow.rank}
                </div>

                {/* Origin -> Destination & Bar */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#0F1E36',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={`${flow.originClean} ➔ ${flow.destinationClean}`}
                  >
                    <span>{flow.originClean}</span>
                    <span style={{ color: '#0066FF', margin: '0 5px' }}>➔</span>
                    <span>{flow.destinationClean}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                      style={{
                        flex: 1,
                        height: 3.5,
                        background: 'rgba(0, 102, 255, 0.08)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: modeColor,
                          borderRadius: 2,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 9,
                        color: modeColor,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {flow.modeLabel.replace(/\s*\(.*\)/, '')}
                      {!flow.isVerifiedCoords ? ' · Unmapped' : ''}
                    </span>
                  </div>
                </div>

                {/* Right: Period Total + Normalised Daily Average */}
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontWeight: 800, fontSize: 13, color: '#0F1E36', lineHeight: 1.1 }}>
                    {formatMillions(flow.volume)}
                  </div>
                  <div
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: '#64748B',
                      marginTop: 2,
                    }}
                  >
                    {Math.round(flow.avgDaily).toLocaleString()}/d · {flow.sharePct}%
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
