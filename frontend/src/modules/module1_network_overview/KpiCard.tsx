import { useState, useRef, useEffect } from 'react';
import './KpiCard.css';

interface MonthlyTrend {
  year_month: string;
  total: number;
  lines: Record<string, number>;
}

export type KpiCardType = 'trips' | 'busiest' | 'peak';

interface Props {
  icon?: string;
  iconColor?: string;
  label: string;
  value: string;
  badge?: string;
  badgeColor?: string;
  sub?: string;
  withBarChart?: boolean;
  monthly_trend?: MonthlyTrend[];
  type?: KpiCardType;
  cardType?: KpiCardType;
  delayIndex?: number;
}

/* ── Custom Duotone SVG Icons (28px Compact Visuals) ─────────────────────── */

/** Card 1: Digital rail ticket with perforated edges and minimalist ticket details */
function TicketIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="kpi-icon-ticket">
      {/* Ticket Body with Perforated Semi-circle notches */}
      <path
        d="M5.5 10C5.5 8.61929 6.61929 7.5 8 7.5H24C25.3807 7.5 26.5 8.61929 26.5 10V13C25.1193 13 24 14.1193 24 15.5C24 16.8807 25.1193 18 26.5 18V21C26.5 22.3807 25.3807 23.5 24 23.5H8C6.61929 23.5 5.5 22.3807 5.5 21V18C6.88071 18 8 16.8807 8 15.5C8 14.1193 6.88071 13 5.5 13V10Z"
        fill="#E7F1FF"
        stroke="#3279E8"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Perforation dashed line */}
      <path
        d="M19.5 8.5V22.5"
        stroke="#3279E8"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeDasharray="2 2.5"
      />
      {/* Minimalist ticket detail lines */}
      <rect x="9" y="11" width="6.5" height="1.8" rx="0.9" fill="#3279E8" />
      <rect x="9" y="14.8" width="5" height="1.5" rx="0.75" fill="#3279E8" fillOpacity="0.65" />
      <rect x="9" y="18" width="7" height="1.5" rx="0.75" fill="#3279E8" fillOpacity="0.65" />
      {/* Barcode stripes */}
      <rect x="22" y="11.5" width="1.6" height="8" rx="0.8" fill="#3279E8" />
    </svg>
  );
}

/** Card 2: Modern front-facing railway train with windows, headlights, and tracks */
function TrainIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="kpi-icon-train">
      {/* Train Cab Body */}
      <path
        d="M8.5 8C8.5 6.067 10.067 4.5 12 4.5H20C21.933 4.5 23.5 6.067 23.5 8V19.5C23.5 21.433 21.933 23 20 23H12C10.067 23 8.5 21.433 8.5 19.5V8Z"
        fill="#E1F3FB"
        stroke="#087FBA"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Panoramic Windshield */}
      <path
        d="M10.8 7.5C10.8 6.67157 11.4716 6 12.3 6H19.7C20.5284 6 21.2 6.67157 21.2 7.5V12C21.2 12.5523 20.7523 13 20.2 13H11.8C11.2477 13 10.8 12.5523 10.8 12V7.5Z"
        fill="#087FBA"
        fillOpacity="0.85"
      />
      {/* Center windshield reflection */}
      <path d="M12.5 7.5L14.5 11.5" stroke="#E1F3FB" strokeWidth="1" strokeLinecap="round" strokeOpacity="0.7" />
      {/* Streamline Center Line */}
      <line x1="16" y1="15" x2="16" y2="18" stroke="#087FBA" strokeWidth="1.5" strokeLinecap="round" />
      {/* Twin Headlights */}
      <circle cx="11.8" cy="18.5" r="1.5" fill="#38BDF8" className="train-headlight" />
      <circle cx="20.2" cy="18.5" r="1.5" fill="#38BDF8" className="train-headlight" />
      {/* Chassis base brackets */}
      <path d="M11 23L9.5 25M21 23L22.5 25" stroke="#087FBA" strokeWidth="1.5" strokeLinecap="round" />
      {/* Railway Tracks underneath */}
      <line x1="6.5" y1="26.5" x2="25.5" y2="26.5" stroke="#087FBA" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.45" />
      <line x1="10.5" y1="25.5" x2="8" y2="28" stroke="#087FBA" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="21.5" y1="25.5" x2="24" y2="28" stroke="#087FBA" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.5" />
    </svg>
  );
}

/** Card 3: Passenger demand pulse waveform inside a thin circular outline */
function PulseIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
      {/* Circular outline with subtle secondary fill */}
      <circle cx="16" cy="16" r="12" fill="#FFF4EB" stroke="#F6CFB7" strokeWidth="1.6" />
      {/* Cardinal tick marks at 12, 3, 6, 9 */}
      <line x1="16" y1="5.5" x2="16" y2="7.5" stroke="#EE7938" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="26.5" y1="16" x2="24.5" y2="16" stroke="#EE7938" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="16" y1="26.5" x2="16" y2="24.5" stroke="#EE7938" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.5" />
      <line x1="5.5" y1="16" x2="7.5" y2="16" stroke="#EE7938" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.5" />
      {/* Passenger demand pulse waveform across center */}
      <path
        d="M7 16H11.5L13.5 11.5L16.5 21L18.5 13.5L20.5 17.5L22 16H25"
        stroke="#EE7938"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pulse-waveform-path"
      />
      {/* Peak dot on waveform peak */}
      <circle cx="16.5" cy="21" r="1.2" fill="#EE7938" />
    </svg>
  );
}

/* ── Themes Configuration ────────────────────────────────────────────────── */

const CARD_THEMES = {
  trips: {
    accentRgb: '50, 121, 232',
    trackColor: '#8AB6FF',
    stationOutline: '#639AFF',
    movingLight: '#3279E8',
    railDelay: '0ms',
    entranceDelay: '0ms',
    Icon: TicketIcon,
    animateNumber: true,
  },
  busiest: {
    accentRgb: '8, 127, 186',
    trackColor: '#69C9E5',
    stationOutline: '#29B6DF',
    movingLight: '#009BC9',
    railDelay: '150ms',
    entranceDelay: '120ms',
    Icon: TrainIcon,
    animateNumber: false,
  },
  peak: {
    accentRgb: '238, 121, 56',
    trackColor: '#FFB58C',
    stationOutline: '#FF9860',
    movingLight: '#FF7838',
    railDelay: '300ms',
    entranceDelay: '240ms',
    Icon: PulseIcon,
    animateNumber: false,
  },
};

function getCardType(explicitType?: KpiCardType, label?: string): KpiCardType {
  if (explicitType) return explicitType;
  const l = (label || '').toLowerCase();
  if (l.includes('trip')) return 'trips';
  if (l.includes('line')) return 'busiest';
  return 'peak';
}

function toSentenceCase(label: string): string {
  if (!label) return '';
  const lower = label.toLowerCase();
  if (lower.includes('total')) return 'Total trips';
  if (lower.includes('busiest')) return 'Busiest line';
  if (lower.includes('peak')) return 'Peak hour';
  return label.charAt(0).toUpperCase() + label.slice(1).toLowerCase();
}

/* ── Peak Hour Formatting Helper (7 – 9 AM) ──────────────────────────────── */

function formatPeakHour(val: string) {
  // Matches "7AM – 9AM", "7AM - 9AM", "7 – 9 AM", "7 - 9 AM"
  const m = val.match(/^(\d+(?::\d+)?)\s*(?:AM|PM)?\s*[-–—]\s*(\d+(?::\d+)?)\s*(AM|PM)$/i) ||
            val.match(/^(\d+(?::\d+)?)\s*(AM|PM)\s*[-–—]\s*(\d+(?::\d+)?)\s*(AM|PM)$/i);
  if (m) {
    const start = m[1];
    const end = m[2];
    const meridiem = (m[3] || 'AM').toUpperCase();
    return (
      <span className="kpi-peak-val">
        <span className="kpi-peak-digits">{start} – {end}</span>
        <span className="kpi-peak-meridiem">{meridiem}</span>
      </span>
    );
  }
  return val;
}

/* ── Count-up Animation Component ────────────────────────────────────────── */

function AnimatedKpiValue({ value }: { value: string }) {
  const [displayed, setDisplayed] = useState(value);
  const prevNumRef = useRef<number | null>(null);

  useEffect(() => {
    // Matches patterns like "1.8B", "248.7M", "350K", "1,200", "98.5%"
    const match = value.match(/^([\d.,]+)\s*([A-Za-z%]*)$/);
    if (!match) {
      setDisplayed(value);
      return;
    }

    const rawNum = parseFloat(match[1].replace(/,/g, ''));
    if (isNaN(rawNum)) {
      setDisplayed(value);
      return;
    }

    const suffix = match[2] || '';
    const decimals = match[1].includes('.') ? (match[1].split('.')[1]?.length || 0) : 0;
    const startVal = prevNumRef.current !== null ? prevNumRef.current : 0;
    prevNumRef.current = rawNum;

    if (startVal === rawNum) {
      setDisplayed(value);
      return;
    }

    const duration = 1400; // 1200-1600ms
    const start = performance.now();
    let frameId: number;

    const animate = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      // Smooth ease-out cubic
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = startVal + (rawNum - startVal) * ease;
      setDisplayed(`${current.toFixed(decimals)}${suffix}`);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      } else {
        setDisplayed(value);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return <>{displayed}</>;
}

/* ── Enhanced Rail Track Animation with Interactive Station Nodes ────────── */

function RailTrackFlow({ delay }: { delay: string }) {
  return (
    <div className="kpi-rail-track-wrap" aria-hidden="true">
      {/* Enhanced Rail track guide */}
      <div className="kpi-rail-track-line" />
      {/* 4 evenly spaced station nodes (endpoints at 0% and 100%) */}
      <div className="kpi-rail-station-node node-1" style={{ left: '0%', animationDelay: delay }} />
      <div className="kpi-rail-station-node node-2" style={{ left: '33.33%', animationDelay: delay }} />
      <div className="kpi-rail-station-node node-3" style={{ left: '66.66%', animationDelay: delay }} />
      <div className="kpi-rail-station-node node-4" style={{ left: '100%', animationDelay: delay }} />
      {/* Prominent moving train light with 54px gradient trail */}
      <div className="kpi-rail-train-light" style={{ animationDelay: delay }}>
        <div className="kpi-rail-train-trail" />
        <div className="kpi-rail-train-head" />
      </div>
    </div>
  );
}

/* ── Main KpiCard Component ──────────────────────────────────────────────── */

export function KpiCard({
  type,
  cardType,
  label,
  value,
  badge,
  badgeColor,
  sub,
  withBarChart,
  monthly_trend,
  delayIndex,
}: Props) {
  const resolvedType = getCardType(cardType || type, label);
  const theme = CARD_THEMES[resolvedType];
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    card.style.setProperty('--mouse-x', `${x}px`);
    card.style.setProperty('--mouse-y', `${y}px`);
    if (!isHovered) setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
  };

  const IconComponent = theme.Icon;
  const isNumericValue = resolvedType === 'trips';
  const isPeakHour = resolvedType === 'peak';
  const entranceDelay = delayIndex !== undefined ? `${delayIndex * 120}ms` : theme.entranceDelay;
  const formattedLabel = toSentenceCase(label);

  return (
    <div
      ref={cardRef}
      className={`kpi-card kpi-card-entrance ${isHovered ? 'is-hovered' : ''}`}
      style={{
        '--accent-rgb': theme.accentRgb,
        '--rail-track-color': theme.trackColor,
        '--rail-station-outline': theme.stationOutline,
        '--rail-moving-light': theme.movingLight,
        animationDelay: entranceDelay,
      } as React.CSSProperties}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* Base subtle card border */}
      <div className="kpi-border-base" />

      {/* Mouse Spotlight Layer */}
      <div className="kpi-spotlight" />

      {/* Interactive Cursor-following Border Glow */}
      <div className="kpi-border-glow" />

      {/* Standalone Duotone SVG Icon (directly on white background, 28px) */}
      <div className="kpi-icon-container">
        <IconComponent />
      </div>

      {/* Content */}
      <div className="kpi-content">
        <div className="kpi-label">
          {formattedLabel}
        </div>
        <div className={`kpi-value ${resolvedType === 'busiest' ? 'is-text-value' : ''}`}>
          {isNumericValue ? (
            <AnimatedKpiValue value={value} />
          ) : isPeakHour ? (
            formatPeakHour(value)
          ) : (
            value
          )}
        </div>
        <div className="kpi-sub-row">
          {badge && (
            <span
              className="kpi-badge"
              style={badgeColor ? { color: badgeColor, background: `${badgeColor}18` } : undefined}
            >
              {badge}
            </span>
          )}
          {sub && <span className="kpi-sub-text">{sub}</span>}
        </div>
      </div>

      {/* Peak hour mini bar chart */}
      {withBarChart && monthly_trend && (
        <MiniBarChart monthly_trend={monthly_trend} />
      )}

      {/* Enhanced Signature Rail Track Light Flow Animation */}
      <RailTrackFlow delay={theme.railDelay} />
    </div>
  );
}

function MiniBarChart({ monthly_trend }: { monthly_trend: MonthlyTrend[] }) {
  const recent = monthly_trend.slice(-12);
  const max = Math.max(...recent.map(m => m.total));

  return (
    <div className="kpi-minichart-container">
      {recent.map((m, i) => (
        <div
          key={i}
          className="kpi-minichart-bar"
          style={{
            height: `${Math.max(8, (m.total / max) * 100)}%`,
            opacity: i === recent.length - 1 ? 1 : 0.35 + (i / recent.length) * 0.55,
          }}
        />
      ))}
    </div>
  );
}

export default KpiCard;
