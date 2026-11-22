interface MonthlyTrend {
  year_month: string;
  total: number;
  lines: Record<string, number>;
}

interface Props {
  icon: string;
  iconColor: string;
  label: string;
  value: string;
  badge?: string;
  badgeColor?: string;
  sub?: string;
  withBarChart?: boolean;
  monthly_trend?: MonthlyTrend[];
}

export function KpiCard({
  icon, iconColor, label, value, badge, badgeColor, sub,
  withBarChart, monthly_trend,
}: Props) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 12,
      border: '1px solid rgba(0,102,255,0.1)',
      boxShadow: '0 2px 12px rgba(0,102,255,0.07)',
      padding: '14px 18px',
      display: 'flex',
      alignItems: 'center',
      gap: 14,
    }}>
      {/* Icon */}
      <div style={{
        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
        background: iconColor + '15',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 22,
      }}>
        {icon}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: '#64748B', fontWeight: 500, letterSpacing: '0.4px', textTransform: 'uppercase' }}>
          {label}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#0F1E36', lineHeight: 1.2, marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          {badge && (
            <span style={{
              background: (badgeColor ?? '#00E5A3') + '22',
              color: badgeColor ?? '#00E5A3',
              fontSize: 11, fontWeight: 600,
              padding: '1px 7px', borderRadius: 4,
            }}>{badge}</span>
          )}
          {sub && <span style={{ fontSize: 11, color: '#94A3B8' }}>{sub}</span>}
        </div>
      </div>

      {/* Peak hour mini bar chart */}
      {withBarChart && monthly_trend && (
        <MiniBarChart monthly_trend={monthly_trend} />
      )}
    </div>
  );
}

function MiniBarChart({ monthly_trend }: { monthly_trend: MonthlyTrend[] }) {
  const recent = monthly_trend.slice(-12);
  const max = Math.max(...recent.map(m => m.total));

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 2,
      height: 36, width: 72, flexShrink: 0,
    }}>
      {recent.map((m, i) => (
        <div key={i} style={{
          flex: 1,
          height: `${Math.max(8, (m.total / max) * 100)}%`,
          background: '#FF5A00',
          borderRadius: 2,
          opacity: i === recent.length - 1 ? 1 : 0.4 + (i / recent.length) * 0.5,
        }} />
      ))}
    </div>
  );
}
