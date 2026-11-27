import { LINE_COLORS } from '@/modules/shared/types';
import { resolveHeadlineSeries } from './lineMapping';

interface LinePerf {
  line: string;
  column: string;
  total_ridership: number;
  share_pct: number;
  yoy_growth_pct: number | null;
  observation_start?: string | null;
  observation_end?: string | null;
  observed_days?: number;
  active_period?: string;
}

interface Props {
  line_performance: LinePerf[];
  selectedLine: string;
  onSelectLine?: (line: string) => void;
}

export function LinePerformanceCard({ line_performance, selectedLine, onSelectLine }: Props) {
  const items = line_performance;
  const maxShare = Math.max(...items.map(l => l.share_pct));
  const resolvedSelected = resolveHeadlineSeries(selectedLine).headlineLine;

  return (
    <div className="network-line-performance-list">
      {items.map(item => {
        const color = LINE_COLORS[item.line] ?? '#0066FF';
        const isActive =
          selectedLine === 'All Lines' ||
          selectedLine === item.line ||
          resolvedSelected === item.line;
        const yoy = item.yoy_growth_pct;
        const periodInfo = item.active_period ? ` · Active ${item.active_period}` : '';
        const yoyInfo = yoy !== null ? ` · 2025 vs 2024: ${yoy >= 0 ? '+' : ''}${yoy.toFixed(2)}%` : ' · No full 2024–25 YoY baseline';
        const rowTooltip = `${item.line}: ${item.total_ridership.toLocaleString()} headline trips (${item.share_pct.toFixed(2)}%)${periodInfo}${yoyInfo}`;

        return (
          <div
            key={item.column}
            role={onSelectLine ? 'button' : undefined}
            tabIndex={onSelectLine ? 0 : undefined}
            onClick={() => onSelectLine?.(selectedLine === item.line ? 'All Lines' : item.line)}
            onKeyDown={(e) => {
              if (onSelectLine && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                onSelectLine(selectedLine === item.line ? 'All Lines' : item.line);
              }
            }}
            title={rowTooltip}
            style={{ opacity: isActive ? 1 : 0.4, cursor: onSelectLine ? 'pointer' : undefined }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <span title={item.line} style={{ fontSize: 10, fontWeight: 500, color: '#0F1E36', minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.line}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                <span style={{ fontSize: 10, color: '#64748B' }}>{item.share_pct.toFixed(1)}%</span>
                {yoy !== null && (
                  <span style={{
                    fontSize: 9, fontWeight: 600,
                    color: yoy >= 0 ? '#00C48C' : '#EF4444',
                  }}>
                    {yoy >= 0 ? '▲' : '▼'}{Math.abs(yoy).toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
            {/* Progress bar */}
            <div style={{ height: 5, background: '#F1F4F9', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${(item.share_pct / maxShare) * 100}%`,
                background: color,
                borderRadius: 3,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
