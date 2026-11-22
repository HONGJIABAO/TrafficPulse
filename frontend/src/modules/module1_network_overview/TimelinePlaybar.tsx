import { useEffect, useRef } from 'react';

interface MonthlyTrend {
  year_month: string;
  year: number;
  month: number;
  total: number;
  lines: Record<string, number>;
}

interface Props {
  monthly_trend: MonthlyTrend[];
  playbackIdx: number;
  isPlaying: boolean;
  onIdxChange: (idx: number) => void;
  onPlayPause: () => void;
}

const MONTHS_LABEL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const SPEED_OPTIONS = [0.5, 1, 2];

export function TimelinePlaybar({ monthly_trend, playbackIdx, isPlaying, onIdxChange, onPlayPause }: Props) {
  const speedRef = useRef(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const playbackIdxRef = useRef(playbackIdx);
  playbackIdxRef.current = playbackIdx;

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(() => {
        const next = playbackIdxRef.current + 1;
        if (next < monthly_trend.length) {
          onIdxChange(next);
        } else {
          onPlayPause();
        }
      }, 800 / speedRef.current);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, monthly_trend.length, onIdxChange, onPlayPause]);

  // Key year markers for the timeline
  const years = [...new Set(monthly_trend.map(m => m.year))];

  const currentMonth = monthly_trend[playbackIdx];
  const monthLabel = currentMonth
    ? `${MONTHS_LABEL[currentMonth.year_month.split('-')[1] ? +currentMonth.year_month.split('-')[1] - 1 : 0]} ${currentMonth.year_month.split('-')[0]}`
    : '';

  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid rgba(0,102,255,0.1)',
      boxShadow: '0 2px 12px rgba(0,102,255,0.07)',
      padding: '10px 16px',
      display: 'flex', alignItems: 'center', gap: 14,
      flexShrink: 0,
    }}>
      {/* Play/Pause */}
      <button
        onClick={onPlayPause}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: 'linear-gradient(135deg, #0066FF, #0052CC)',
          border: 'none', color: '#fff', cursor: 'pointer',
          fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 2px 8px rgba(0,102,255,0.35)',
          flexShrink: 0,
        }}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>

      {/* Speed selector */}
      <select
        defaultValue={1}
        onChange={e => { speedRef.current = parseFloat(e.target.value); }}
        style={{
          border: '1px solid rgba(0,102,255,0.2)',
          borderRadius: 6, padding: '4px 8px',
          fontSize: 11, color: '#0F1E36', background: '#F8FAFF',
          cursor: 'pointer', flexShrink: 0,
        }}
      >
        {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}x</option>)}
      </select>

      {/* Current month label */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#0066FF',
        minWidth: 60, flexShrink: 0,
      }}>
        {monthLabel}
      </div>

      {/* Scrubber */}
      <div style={{ flex: 1, position: 'relative' }}>
        <input
          type="range"
          min={0}
          max={monthly_trend.length - 1}
          value={playbackIdx}
          onChange={e => onIdxChange(+e.target.value)}
          style={{
            width: '100%', accentColor: '#0066FF',
            height: 4, cursor: 'pointer',
          }}
        />
        {/* Year labels below */}
        <div style={{
          position: 'relative', display: 'flex',
          justifyContent: 'space-between', marginTop: 3,
        }}>
          {years.map((year, i) => {
            const idx = monthly_trend.findIndex(m => m.year === year);
            const leftPct = (idx / (monthly_trend.length - 1)) * 100;
            return (
              <span
                key={year}
                style={{
                  position: 'absolute',
                  left: `${leftPct}%`,
                  transform: 'translateX(-50%)',
                  fontSize: 9, color: '#94A3B8',
                  fontWeight: 500,
                }}
              >
                {year}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
