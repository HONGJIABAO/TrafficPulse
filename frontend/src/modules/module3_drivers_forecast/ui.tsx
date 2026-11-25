import { Component, Suspense, useState } from 'react';
import type { ReactNode, Key } from 'react';
import type { Evidence, Source } from './contracts';
import { retryAssets } from './dataClient';
import s from './dashboard.module.css';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'positive' | 'warning' | 'blue' }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}

export function EvidenceBadge({ kind }: { kind: Evidence }) {
  const tone = kind === 'Observed' ? 'positive' : kind === 'Model Forecast' || kind === 'Scheduled Reference' ? 'blue' :
    kind === 'Unavailable' ? 'neutral' : 'warning';
  return <Badge tone={tone}>{kind}</Badge>;
}

export function Panel({ title, subtitle, badge, children, className }: {
  title: string; subtitle?: ReactNode; badge?: ReactNode; children: ReactNode; className?: string;
}) {
  return <section className={`${s.card} ${className ?? ''}`}>
    <header className={s.cardHeader}><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{badge}</header>
    {children}
  </section>;
}

export function TabHeading({ title, detail, children }: { title: string; detail: ReactNode; children?: ReactNode }) {
  return <header className={s.tabHeading}><div><h2>{title}</h2><p>{detail}</p></div>{children}</header>;
}

export function Kpi({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'up' | 'down' }) {
  return <article className={s.kpi}><p>{label}</p><strong className={tone ? s[tone] : ''}>{value}</strong>{note && <small>{note}</small>}</article>;
}

export function Note({ title, children, tone = 'info' }: { title: string; children: ReactNode; tone?: 'info' | 'warn' | 'quiet' }) {
  return <aside className={`${s.note} ${s[tone]}`}><strong>{title}</strong><div>{children}</div></aside>;
}

export function Empty({ children = 'Unavailable for this selection.' }: { children?: ReactNode }) {
  return <div className={s.empty} role="status">{children}</div>;
}

export function Loading({ label = 'Loading validated data…' }: { label?: string }) {
  return <div className={s.loading} role="status"><span aria-hidden="true" />{label}</div>;
}

export function Select<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void;
}) {
  return <label className={s.field}><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value as T)}>
    {options.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
  </select></label>;
}

export function Segmented<T extends string | number>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (next: T) => void;
}) {
  return <div className={s.field}><span>{label}</span><div className={s.segments} role="group" aria-label={label}>
    {options.map((item) => <button key={item.value} type="button" aria-pressed={value === item.value} onClick={() => onChange(item.value)}>{item.label}</button>)}
  </div></div>;
}

export function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (date: string) => void }) {
  return <label className={s.field}><span>{label}</span><input type="date" value={value} min={min} max={max}
    onChange={(event) => { const date = event.target.value; if (date && date >= min && date <= max) onChange(date); }} /></label>;
}

export function Table({ label, columns, rows }: { label: string; columns: string[]; rows: { key: Key; cells: ReactNode[]; selected?: boolean }[] }) {
  if (!rows.length) return <Empty />;
  return <div className={s.tableScroll}><table aria-label={label} className={s.table}><thead><tr>
    {columns.map((column, i) => <th key={i} scope="col">{column}</th>)}
  </tr></thead><tbody>{rows.map((row) => <tr key={row.key} className={row.selected ? s.selectedRow : undefined}>
    {row.cells.map((cell, i) => i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>)}
  </tr>)}</tbody></table></div>;
}

export function DataLink({ source }: { source: Source }) {
  return <div className={s.source}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>{source.detail && <small>{source.detail}</small>}</div>;
}

export function Details({ title, summary, children }: { title: string; summary?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <details className={s.details} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><div><strong>{title}</strong>{summary && <span>{summary}</span>}</div></summary>
    {open && <div className={s.detailsBody}><Suspense fallback={<Loading />}>{children}</Suspense></div>}
  </details>;
}

export class DashboardErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) { return { error: error.message }; }
  render() {
    return this.state.error ? <Note title="Dashboard data could not be opened" tone="warn">
      <p>{this.state.error}</p><button className={s.secondaryButton} type="button" onClick={() => { retryAssets(); this.setState({ error: null }); }}>Retry loading</button>
    </Note> : this.props.children;
  }
}
