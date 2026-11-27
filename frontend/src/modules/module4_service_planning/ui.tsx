import { Component, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, Key } from 'react';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';
import type { Evidence, Source } from './contracts';
import { retryAssets } from './dataClient';
import s from './dashboard.module.css';

export type AccentTone = 'blue' | 'cyan' | 'teal' | 'purple' | 'orange';

const ACCENT_MAP: Record<AccentTone, {
  variant: TelemetryVariant;
  fg: string;
  bg: string;
  border: string;
  rgb: string;
  track: string;
  nodeOutline: string;
  light: string;
}> = {
  blue: {
    variant: 'cobalt',
    fg: '#2563EB',
    bg: '#EAF2FF',
    border: 'rgba(37, 99, 235, 0.22)',
    rgb: '50, 121, 232',
    track: '#8AB6FF',
    nodeOutline: '#639AFF',
    light: '#3279E8',
  },
  cyan: {
    variant: 'cyan',
    fg: '#0891B2',
    bg: '#E8F7FC',
    border: 'rgba(40, 191, 239, 0.30)',
    rgb: '40, 191, 239',
    track: '#69C9E5',
    nodeOutline: '#29B6DF',
    light: '#009BC9',
  },
  teal: {
    variant: 'teal',
    fg: '#0D9488',
    bg: '#E4F6F3',
    border: 'rgba(13, 148, 136, 0.24)',
    rgb: '13, 148, 136',
    track: '#7BD3C7',
    nodeOutline: '#14B8A6',
    light: '#0D9488',
  },
  purple: {
    variant: 'purple',
    fg: '#7C3AED',
    bg: '#F0EBFF',
    border: 'rgba(124, 58, 237, 0.24)',
    rgb: '139, 124, 248',
    track: '#BDB2FF',
    nodeOutline: '#8B7CF8',
    light: '#7C3AED',
  },
  orange: {
    variant: 'amber',
    fg: '#EA580C',
    bg: '#FFF1E5',
    border: 'rgba(234, 88, 12, 0.24)',
    rgb: '238, 121, 56',
    track: '#FFB58C',
    nodeOutline: '#FF9860',
    light: '#FF7838',
  },
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'positive' | 'warning' | 'blue' }) {
  return <span className={`${s.badge} ${s[tone]}`}>{children}</span>;
}

const evidenceStyle: Record<Evidence, string> = {
  Observed: s.observed,
  'Model Forecast': s.forecast,
  'Scheduled Reference': s.scheduled,
  'Proxy Estimate': s.proxy,
  'Planning Assumption': s.assumption,
  Unavailable: s.unavailable,
};

export function EvidenceBadge({ kind }: { kind: Evidence }) {
  return <span className={`${s.badge} ${s.evidence} ${evidenceStyle[kind]}`}>{kind}</span>;
}

function SectionBadge({ icon, marker, accent = 'blue' }: {
  icon?: TelemetryIconName; marker?: string; accent?: AccentTone;
}) {
  const palette = ACCENT_MAP[accent];
  if (!icon && !marker) return null;
  return (
    <span className={s.sectionHeaderMarks} aria-hidden="true">
      {icon && (
        <TelemetryIcon
          name={icon}
          variant={palette.variant}
          size={15}
          badge
          className={s.sectionIconBadge}
          style={{ width: 26, height: 26, background: palette.bg, borderColor: palette.border, color: palette.fg }}
        />
      )}
      {marker && (
        <span
          className={s.sectionMarker}
          style={{ background: palette.bg, borderColor: palette.border, color: palette.fg }}
        >
          {marker}
        </span>
      )}
    </span>
  );
}

export function Panel({ title, subtitle, badge, controls, children, primary, marker, icon, accent = 'blue', heading: Heading = 'h3' }: {
  title: string; subtitle?: ReactNode; badge?: ReactNode; controls?: ReactNode; children: ReactNode;
  primary?: boolean; marker?: string; icon?: TelemetryIconName; accent?: AccentTone; heading?: 'h3' | 'h4' | 'h5';
}) {
  return <section className={primary ? `${s.card} ${s.primaryCard}` : s.card}>
    <header className={s.cardHeader}>
      <div className={s.cardTitle}>
        <Heading><SectionBadge icon={icon} marker={marker} accent={accent} /><span>{title}</span></Heading>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {badge}
      {controls && <div className={`${s.controls} ${s.headerControls}`}>{controls}</div>}
    </header>
    {children}
  </section>;
}

export function AnalysisGroup({ title, marker, icon, accent = 'blue', children }: {
  title: string; marker?: string; icon?: TelemetryIconName; accent?: AccentTone; children: ReactNode;
}) {
  const id = useId();
  return <section className={s.analysisGroup} aria-labelledby={id}>
    <h3 id={id} className={s.groupHeading}><SectionBadge icon={icon} marker={marker} accent={accent} /><span>{title}</span></h3>
    {children}
  </section>;
}

export function TabHeading({ title, detail, children }: { title: string; detail: ReactNode; children?: ReactNode }) {
  return <header className={s.tabHeading}><div><h2>{title}</h2><p>{detail}</p></div>{children}</header>;
}

export function Headline({ children }: { children: ReactNode }) {
  return <div className={s.headline}>{children}</div>;
}

/* ── KPI Count-Up Animation Helper ────────────────────────────────────────── */

function parseNumericDisplay(raw: string) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^([+-]?)\s*([\d,]+(?:\.\d+)?)(\s*(?:%|pp|min|hours|days|[KMB])?)$/i);
  if (!match) return null;
  const target = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(target)) return null;
  const decimals = match[2].includes('.') ? match[2].split('.')[1].length : 0;
  return { sign: match[1], target, decimals, suffix: match[3] || '' };
}

function AnimatedNumeric({ value }: { value: string }) {
  const [animText, setAnimText] = useState<string | null>(null);
  const prevTargetRef = useRef<number | null>(null);

  useEffect(() => {
    const parsed = parseNumericDisplay(value);
    if (!parsed) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const startVal = prevTargetRef.current !== null ? prevTargetRef.current : 0;
    prevTargetRef.current = parsed.target;

    if (reduced || startVal === parsed.target) return;

    const formatter = new Intl.NumberFormat('en-MY', {
      minimumFractionDigits: parsed.decimals,
      maximumFractionDigits: parsed.decimals,
    });
    const duration = 950;
    const startTime = performance.now();
    let frameId = 0;

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (parsed.target - startVal) * easeOut;
      const prefix = parsed.sign === '+' && current > 0 ? '+' : parsed.sign === '-' && current > 0 ? '-' : '';
      setAnimText(`${prefix}${formatter.format(current)}${parsed.suffix}`);

      if (progress < 1) {
        frameId = requestAnimationFrame(step);
      } else {
        setAnimText(null);
      }
    };

    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return <>{parseNumericDisplay(value) && animText !== null ? animText : value}</>;
}

function KpiRailTrack({ delayMs = 0 }: { delayMs?: number }) {
  const delay = `${delayMs}ms`;
  return (
    <div className={s.kpiRailTrackWrap} aria-hidden="true">
      <div className={s.kpiRailTrackLine} />
      <div className={`${s.kpiRailStationNode} ${s.kpiNode1}`} style={{ left: '0%', animationDelay: delay }} />
      <div className={`${s.kpiRailStationNode} ${s.kpiNode2}`} style={{ left: '33.33%', animationDelay: delay }} />
      <div className={`${s.kpiRailStationNode} ${s.kpiNode3}`} style={{ left: '66.66%', animationDelay: delay }} />
      <div className={`${s.kpiRailStationNode} ${s.kpiNode4}`} style={{ left: '100%', animationDelay: delay }} />
      <div className={s.kpiRailLight} style={{ animationDelay: delay }}>
        <div className={s.kpiRailTrail} />
        <div className={s.kpiRailHead} />
      </div>
    </div>
  );
}

export function Kpi({
  label,
  value,
  note,
  lead,
  badge,
  icon,
  accent,
  railFlow = false,
  railDelayMs = 0,
  countUp = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  lead?: boolean;
  badge?: ReactNode;
  icon?: TelemetryIconName;
  accent?: AccentTone;
  railFlow?: boolean;
  railDelayMs?: number;
  countUp?: boolean;
}) {
  const resolvedAccent: AccentTone = accent ?? 'blue';
  const palette = ACCENT_MAP[resolvedAccent];
  const cardRef = useRef<HTMLElement>(null);

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const el = cardRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    el.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
  };

  return (
    <article
      ref={cardRef}
      className={[
        s.kpi,
        s.kpiInteractive,
        lead ? s.leadKpi : '',
        railFlow ? s.kpiHasRail : '',
      ].filter(Boolean).join(' ')}
      style={{
        '--accent-rgb': palette.rgb,
        '--kpi-fg': palette.fg,
        '--rail-track-color': palette.track,
        '--rail-station-outline': palette.nodeOutline,
        '--rail-moving-light': palette.light,
      } as CSSProperties}
      onPointerMove={handlePointerMove}
    >
      <div className={s.kpiSpotlight} aria-hidden="true" />
      <div className={s.kpiBorderGlow} aria-hidden="true" />

      <div className={s.kpiBody}>
        <header>
          {icon && (
            <TelemetryIcon
              name={icon}
              variant={palette.variant}
              size={15}
              badge
              className={s.kpiIconBadge}
              style={{ width: 26, height: 26, background: palette.bg, borderColor: palette.border, color: palette.fg }}
            />
          )}
          <p>{label}</p>
          {badge}
        </header>
        <strong style={lead ? { color: palette.fg } : undefined}>
          {countUp && typeof value === 'string' ? <AnimatedNumeric value={value} /> : value}
        </strong>
        {note && <small>{note}</small>}
      </div>

      {railFlow && <KpiRailTrack delayMs={railDelayMs} />}
    </article>
  );
}

export function Note({ title, children, tone = 'info' }: { title: string; children: ReactNode; tone?: 'info' | 'warn' | 'quiet' }) {
  const iconName: TelemetryIconName = tone === 'warn' ? 'shield-check' : 'activity';
  return (
    <aside className={`${s.note} ${s[tone]}`}>
      <span className={s.noteIcon} aria-hidden="true">
        {tone === 'warn' ? (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="9.5" />
            <line x1="12" y1="8" x2="12" y2="12.5" />
            <circle cx="12" cy="16" r="0.8" fill="currentColor" stroke="none" />
          </svg>
        ) : (
          <TelemetryIcon
            name={iconName}
            size={15}
            style={{ color: 'currentColor' }}
          />
        )}
      </span>
      <div className={s.noteContent}>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </aside>
  );
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
  const groupRef = useRef<HTMLDivElement>(null);
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pill, setPill] = useState({ left: 0, top: 0, width: 0, height: 0, ready: false });
  const [canSlide, setCanSlide] = useState(false);

  const activeIdx = Math.max(0, options.findIndex((item) => item.value === value));

  const measure = useCallback(() => {
    const btn = btnRefs.current[activeIdx];
    if (!btn) return;
    const left = btn.offsetLeft;
    const top = btn.offsetTop;
    const width = btn.offsetWidth;
    const height = btn.offsetHeight;
    setPill((prev) => (
      prev.ready && prev.left === left && prev.top === top && prev.width === width && prev.height === height
        ? prev
        : { left, top, width, height, ready: true }
    ));
  }, [activeIdx]);

  useLayoutEffect(() => {
    measure();
  }, [measure, options.length]);

  useEffect(() => {
    if (!pill.ready || canSlide) return;
    const raf = requestAnimationFrame(() => setCanSlide(true));
    return () => cancelAnimationFrame(raf);
  }, [pill.ready, canSlide]);

  useEffect(() => {
    const el = groupRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className={s.field}>
      <span>{label}</span>
      <div ref={groupRef} className={s.segments} role="group" aria-label={label}>
        {pill.ready && (
          <span
            className={`${s.segmentPill} ${canSlide ? s.segmentPillAnimated : ''}`}
            style={{
              width: pill.width,
              height: pill.height,
              transform: `translate3d(${pill.left}px, ${pill.top}px, 0)`,
            }}
            aria-hidden="true"
          />
        )}
        {options.map((item, i) => (
          <button
            key={item.value}
            ref={(el) => { btnRefs.current[i] = el; }}
            type="button"
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function DateInput({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (date: string) => void }) {
  return <label className={s.field}><span>{label}</span><input type="date" value={value} min={min} max={max}
    onChange={(event) => { const date = event.target.value; if (date && date >= min && date <= max) onChange(date); }} /></label>;
}

const NUMERIC_TEXT_RE = /^[+\-−]?(?:RM\s*)?[\d,]+(?:\.\d+)?(?:\s*(?:%|pp|min|hours|days))?$|^\d+\s*\/\s*\d+$/;
const SIGNED_DELTA_RE = /^([+\-−])([\d,]+(?:\.\d+)?)\s*(%|pp)$/;

function isNumericCellValue(cell: ReactNode): boolean {
  if (typeof cell === 'number') return true;
  if (typeof cell !== 'string') return false;
  const trimmed = cell.trim();
  if (trimmed === 'Unavailable' || trimmed === '—') return false;
  return NUMERIC_TEXT_RE.test(trimmed);
}

function isUnavailableCell(cell: ReactNode): boolean {
  return typeof cell === 'string' && cell.trim() === 'Unavailable';
}

function renderCellContent(cell: ReactNode, isDeltaCol: boolean): ReactNode {
  if (typeof cell !== 'string') return cell;
  const trimmed = cell.trim();
  if (isDeltaCol && trimmed === 'Unavailable') {
    return <span className={s.deltaNeutral}>Unavailable</span>;
  }
  const deltaMatch = trimmed.match(SIGNED_DELTA_RE);
  if (deltaMatch) {
    const sign = deltaMatch[1];
    const magnitude = Number(deltaMatch[2].replace(/,/g, ''));
    if (magnitude === 0) return <span className={s.deltaNeutral}>{cell}</span>;
    return (
      <span className={sign === '+' ? s.deltaPos : s.deltaNeg}>
        {cell}
      </span>
    );
  }
  return cell;
}

export function Table({ label, columns, rows }: { label: string; columns: string[]; rows: { key: Key; cells: ReactNode[]; selected?: boolean }[] }) {
  if (!rows.length) return <Empty />;

  const colCount = columns.length;
  const isDeltaCol = columns.map((col, ci) =>
    /change|difference|gain/i.test(col) ||
    rows.some((r) => typeof r.cells[ci] === 'string' && SIGNED_DELTA_RE.test((r.cells[ci] as string).trim())),
  );

  const isNumericCol = Array.from({ length: colCount }, (_, ci) => {
    if (ci === 0) return false;
    let numericSeen = false;
    for (const r of rows) {
      const cell = r.cells[ci];
      if (cell == null || isUnavailableCell(cell)) continue;
      if (typeof cell === 'object') {
        // Badges like <EvidenceBadge kind="Unavailable" />
        continue;
      }
      if (isNumericCellValue(cell)) {
        numericSeen = true;
      } else {
        return false;
      }
    }
    return numericSeen || isDeltaCol[ci];
  });

  return <div className={s.tableScroll} tabIndex={0} role="region" aria-label={`${label} table scroll area`}><table aria-label={label} className={s.table}><thead><tr>
    {columns.map((column, i) => <th key={i} scope="col" className={isNumericCol[i] ? s.numCell : undefined}>{column}</th>)}
  </tr></thead><tbody>{rows.map((row) => <tr key={row.key} className={row.selected ? s.selectedRow : undefined}>
    {row.cells.map((cell, i) => i === 0
      ? <th key={i} scope="row">{cell}</th>
      : <td key={i} className={isNumericCol[i] ? s.numCell : undefined}>{renderCellContent(cell, isDeltaCol[i])}</td>)}
  </tr>)}</tbody></table></div>;
}

export function DataLink({ source }: { source: Source }) {
  return <div className={s.source}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>{source.detail && <small>{source.detail}</small>}</div>;
}

export function Details({ title, summary, marker, icon, accent = 'blue', children }: {
  title: string; summary?: string; marker?: string; icon?: TelemetryIconName; accent?: AccentTone; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return <details className={s.details} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <SectionBadge icon={icon} marker={marker} accent={accent} />
      <div><strong>{title}</strong>{summary && <span>{summary}</span>}</div>
    </summary>
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
