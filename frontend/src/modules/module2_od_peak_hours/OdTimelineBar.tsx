import React, { useEffect, useRef, useState } from 'react';
import type { MonthlyTotalRecord } from './types';

interface Props {
  months: MonthlyTotalRecord[];
  selectedMonthKey: string | null; // null = Full Selected Time Horizon
  onSelectMonthKey: (ym: string | null) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SPEED_OPTIONS = [0.5, 1, 2];

function formatMonthShort(ym: string): string {
  const [y, m] = ym.split('-');
  const idx = Number(m) - 1;
  return `${MONTH_NAMES[idx] || m} ${y}`;
}

export const OdTimelineBar: React.FC<Props> = ({
  months,
  selectedMonthKey,
  onSelectMonthKey,
  disabled = false,
  style,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Slider position: 0..(months.length - 1) = specific month, months.length = All Period
  const totalStops = months.length + 1;
  const currentPos = selectedMonthKey
    ? Math.max(0, months.findIndex((m) => m.year_month === selectedMonthKey))
    : months.length;

  const effectivePlaying = isPlaying && !disabled;
  const posRef = useRef(currentPos);

  useEffect(() => {
    posRef.current = currentPos;
  }, [currentPos]);

  useEffect(() => {
    if (!effectivePlaying) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = setInterval(() => {
      const next = posRef.current >= months.length ? 0 : posRef.current + 1;
      if (next >= months.length) {
        onSelectMonthKey(null);
        setIsPlaying(false);
      } else {
        onSelectMonthKey(months[next].year_month);
      }
    }, 1000 / speed);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [effectivePlaying, speed, months, onSelectMonthKey]);

  const activeMonthObj = selectedMonthKey ? months.find((m) => m.year_month === selectedMonthKey) : null;
  const displayLabel = activeMonthObj
    ? `${formatMonthShort(activeMonthObj.year_month)} (${activeMonthObj.days}d)`
    : 'All 2026 (Jan–Nov)';

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        border: '1px solid rgba(0, 102, 255, 0.1)',
        boxShadow: '0 2px 12px rgba(0, 102, 255, 0.07)',
        padding: '8px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        opacity: disabled ? 0.55 : 1,
        ...style,
      }}
    >
      {/* Play/Pause */}
      <button
        onClick={() => {
          if (disabled) return;
          if (!isPlaying && currentPos === months.length && months.length > 0) {
            onSelectMonthKey(months[0].year_month);
          }
          setIsPlaying((p) => !p);
        }}
        disabled={disabled}
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: disabled ? '#94A3B8' : 'linear-gradient(135deg, #0066FF, #0052CC)',
          border: 'none',
          color: '#fff',
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: disabled ? 'none' : '0 2px 8px rgba(0, 102, 255, 0.3)',
          flexShrink: 0,
        }}
        title={effectivePlaying ? 'Pause monthly playback' : 'Play 2026 monthly progression'}
      >
        {effectivePlaying ? '⏸' : '▶'}
      </button>

      {/* Speed selector */}
      <select
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        disabled={disabled}
        style={{
          border: '1px solid rgba(0, 102, 255, 0.2)',
          borderRadius: 6,
          padding: '3px 6px',
          fontSize: 11,
          color: '#0F1E36',
          background: '#F8FAFF',
          cursor: disabled ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          outline: 'none',
        }}
        title="Playback speed"
      >
        {SPEED_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>

      {/* Active Period Label */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#0066FF',
          minWidth: 108,
          flexShrink: 0,
          letterSpacing: '0.2px',
          whiteSpace: 'nowrap',
        }}
      >
        {displayLabel}
      </div>

      {/* Scrubber across actual 2026 observed months + All 2026 */}
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="range"
          min={0}
          max={totalStops - 1}
          value={currentPos}
          disabled={disabled}
          onChange={(e) => {
            setIsPlaying(false);
            const idx = Number(e.target.value);
            if (idx >= months.length) {
              onSelectMonthKey(null);
            } else {
              onSelectMonthKey(months[idx].year_month);
            }
          }}
          style={{
            width: '100%',
            accentColor: '#0066FF',
            height: 4,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
          aria-label="2026 Monthly Timeline Scrubber"
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 2,
            fontSize: 8.5,
            color: '#94A3B8',
            fontWeight: 600,
          }}
        >
          <span>Jan 26</span>
          <span>Mar 26</span>
          <span>Jun 26</span>
          <span>Sep 26</span>
          <span>Nov 26 (to 20th)</span>
          <span style={{ color: !selectedMonthKey ? '#0066FF' : '#94A3B8', fontWeight: 700 }}>Full</span>
        </div>
      </div>

      {selectedMonthKey && (
        <button
          onClick={() => {
            setIsPlaying(false);
            onSelectMonthKey(null);
          }}
          style={{
            background: '#E8F0FF',
            color: '#0066FF',
            border: 'none',
            borderRadius: 5,
            padding: '3px 7px',
            fontSize: 10,
            fontWeight: 700,
            cursor: 'pointer',
            flexShrink: 0,
          }}
          title="Return to Time Horizon view"
        >
          Reset
        </button>
      )}
    </div>
  );
};
