import React, { useRef, useState } from 'react';
import './OdKpiCard.css';

export type OdKpiVariant = 'peak' | 'corridor' | 'trips' | 'split';

interface OdKpiCardProps {
  variant: OdKpiVariant;
  delayIndex: number;
  testId: string;
  label: string;
  badgeText: string;
  badgeColor: string;
  badgeBg: string;
  value: string;
  valueTitle?: string;
  compactValue?: boolean;
  subText: string;
}

function PeakClockIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m2-kpi-icon-svg" aria-hidden="true">
      <circle cx="16" cy="16" r="11.5" fill="#FFF4EB" stroke="#EE7938" strokeWidth="1.6" />
      <path d="M16 7.5v1.5M24.5 16H23M16 24.5V23M7.5 16H9" stroke="#EE7938" strokeWidth="1.3" strokeLinecap="round" strokeOpacity="0.55" />
      <path d="M16 10.5V16l4 2.5" stroke="#EE7938" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="16" r="1.8" fill="#EE7938" />
    </svg>
  );
}

function CorridorRouteIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m2-kpi-icon-svg" aria-hidden="true">
      <rect x="4.5" y="4.5" width="23" height="23" rx="6.5" fill="#E7F1FF" stroke="#8AB6FF" strokeWidth="1.4" />
      <circle cx="9.5" cy="22" r="2.6" fill="#FFFFFF" stroke="#3279E8" strokeWidth="1.7" />
      <circle cx="22.5" cy="10" r="2.6" fill="#3279E8" stroke="#3279E8" strokeWidth="1.5" />
      <path d="M11.8 20.5C15.5 18.8 18 14.8 20.5 11.8" stroke="#3279E8" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M18 9.8h4.5v4.5" stroke="#3279E8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TripsTicketStackIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m2-kpi-icon-svg" aria-hidden="true">
      <path
        d="M5.5 10.5C5.5 9.12 6.62 8 8 8h16c1.38 0 2.5 1.12 2.5 2.5v2.7a2.3 2.3 0 0 0 0 4.6v2.7c0 1.38-1.12 2.5-2.5 2.5H8c-1.38 0-2.5-1.12-2.5-2.5v-2.7a2.3 2.3 0 0 0 0-4.6v-2.7Z"
        fill="#EEF2FF"
        stroke="#4F46E5"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19.5 9v13" stroke="#4F46E5" strokeWidth="1.4" strokeLinecap="round" strokeDasharray="2 2.5" />
      <rect x="9" y="12" width="7" height="1.7" rx="0.85" fill="#4F46E5" />
      <rect x="9" y="15.3" width="5.5" height="1.5" rx="0.75" fill="#4F46E5" fillOpacity="0.65" />
      <rect x="9" y="18.3" width="7.2" height="1.5" rx="0.75" fill="#4F46E5" fillOpacity="0.65" />
    </svg>
  );
}

function WeekdayWeekendWaveIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" fill="none" className="m2-kpi-icon-svg" aria-hidden="true">
      <rect x="4.5" y="6" width="23" height="20" rx="5" fill="#E0FFF6" stroke="#0D9488" strokeWidth="1.6" />
      <path
        d="M8 20.5c2.2-6.5 4.2-6.5 6.2-1.5 1.6 4 3.4-5.5 5.4-5.5 2 0 3 4.2 4.4 7"
        stroke="#0D9488"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14.2" cy="19" r="1.3" fill="#0D9488" />
      <circle cx="19.6" cy="13.5" r="1.3" fill="#0D9488" />
    </svg>
  );
}

const THEMES: Record<
  OdKpiVariant,
  {
    accentRgb: string;
    trackColor: string;
    stationOutline: string;
    movingLight: string;
    Icon: React.FC;
  }
> = {
  peak: {
    accentRgb: '238, 121, 56',
    trackColor: '#FFB58C',
    stationOutline: '#FF9860',
    movingLight: '#FF7838',
    Icon: PeakClockIcon,
  },
  corridor: {
    accentRgb: '50, 121, 232',
    trackColor: '#8AB6FF',
    stationOutline: '#639AFF',
    movingLight: '#3279E8',
    Icon: CorridorRouteIcon,
  },
  trips: {
    accentRgb: '79, 70, 229',
    trackColor: '#A5B4FC',
    stationOutline: '#818CF8',
    movingLight: '#4F46E5',
    Icon: TripsTicketStackIcon,
  },
  split: {
    accentRgb: '13, 148, 136',
    trackColor: '#5EEAD4',
    stationOutline: '#2DD4BF',
    movingLight: '#0D9488',
    Icon: WeekdayWeekendWaveIcon,
  },
};

export const OdKpiCard: React.FC<OdKpiCardProps> = ({
  variant,
  delayIndex,
  testId,
  label,
  badgeText,
  badgeColor,
  badgeBg,
  value,
  valueTitle,
  compactValue,
  subText,
}) => {
  const theme = THEMES[variant];
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
    card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    if (!isHovered) setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
  };

  const railDelay = `${delayIndex * 150}ms`;
  const entranceDelay = `${delayIndex * 120}ms`;
  const IconComponent = theme.Icon;

  return (
    <div
      ref={cardRef}
      data-testid={testId}
      className={`m2-kpi-card m2-kpi-card-entrance ${isHovered ? 'is-hovered' : ''}`}
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
      <div className="m2-kpi-border-base" />
      <div className="m2-kpi-spotlight" />
      <div className="m2-kpi-border-glow" />

      <div className="m2-kpi-icon-container">
        <IconComponent />
      </div>

      <div className="m2-kpi-content">
        <div className="m2-kpi-top-row">
          <span className="m2-kpi-label">{label}</span>
          <span
            className="m2-kpi-badge"
            style={{ color: badgeColor, background: badgeBg }}
          >
            {badgeText}
          </span>
        </div>

        <div
          className={`m2-kpi-value ${compactValue ? 'is-compact-value' : ''}`}
          title={valueTitle}
        >
          {value}
        </div>

        <div className="m2-kpi-sub-text" title={subText}>
          {subText}
        </div>
      </div>

      <div className="m2-kpi-rail-track-wrap" aria-hidden="true">
        <div className="m2-kpi-rail-track-line" />
        <div className="m2-kpi-rail-station-node node-1" style={{ left: '0%', animationDelay: railDelay }} />
        <div className="m2-kpi-rail-station-node node-2" style={{ left: '33.33%', animationDelay: railDelay }} />
        <div className="m2-kpi-rail-station-node node-3" style={{ left: '66.66%', animationDelay: railDelay }} />
        <div className="m2-kpi-rail-station-node node-4" style={{ left: '100%', animationDelay: railDelay }} />
        <div className="m2-kpi-rail-train-light" style={{ animationDelay: railDelay }}>
          <div className="m2-kpi-rail-train-trail" />
          <div className="m2-kpi-rail-train-head" />
        </div>
      </div>
    </div>
  );
};
