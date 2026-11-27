import React from 'react';

export type TelemetryIconName =
  | 'clock-radar'
  | 'od-route'
  | 'asymmetry-wave'
  | 'offpeak-drop'
  | 'telemetry-sliders'
  | 'thermal-matrix'
  | 'ranked-corridors'
  | 'insight-node'
  | 'haul-vector'
  | 'dual-waveform'
  | 'corridor-focus'
  | 'decision-directives'
  | 'spark'
  | 'transit-rail'
  | 'urban-cluster'
  | 'suburban-station'
  | 'globe-network'
  | 'trend-down'
  | 'trend-up'
  | 'chart-bar'
  | 'lightning'
  | 'sunrise'
  | 'sun'
  | 'sunset'
  | 'fuel'
  | 'car'
  | 'briefcase'
  | 'ai-chip'
  | 'gear'
  | 'pin-marker'
  | 'map-grid'
  | 'forecast-mesh'
  | 'sliders-horizontal'
  | 'clock'
  | 'accessibility'
  | 'calendar-clock'
  | 'users'
  | 'timer'
  | 'shield-check'
  | 'activity';

export type TelemetryVariant = 'cobalt' | 'amber' | 'teal' | 'indigo' | 'purple' | 'cyan' | 'green';

interface TelemetryTheme {
  stroke: string;
  bg: string;
  border: string;
}

const THEMES: Record<TelemetryVariant, TelemetryTheme> = {
  cobalt: {
    stroke: '#2563EB',
    bg: 'rgba(37, 99, 235, 0.08)',
    border: 'rgba(37, 99, 235, 0.2)',
  },
  amber: {
    stroke: '#EA580C',
    bg: 'rgba(234, 88, 12, 0.08)',
    border: 'rgba(234, 88, 12, 0.2)',
  },
  teal: {
    stroke: '#0D9488',
    bg: 'rgba(13, 148, 136, 0.08)',
    border: 'rgba(13, 148, 136, 0.2)',
  },
  indigo: {
    stroke: '#4F46E5',
    bg: 'rgba(79, 70, 229, 0.08)',
    border: 'rgba(79, 70, 229, 0.2)',
  },
  purple: {
    stroke: '#7C3AED',
    bg: '#F0EBFF',
    border: 'rgba(124, 58, 237, 0.24)',
  },
  cyan: {
    stroke: '#0891B2',
    bg: '#E8F7FC',
    border: 'rgba(40, 191, 239, 0.32)',
  },
  green: {
    stroke: '#059669',
    bg: '#E6FAF3',
    border: 'rgba(16, 185, 129, 0.28)',
  },
};

interface TelemetryIconProps {
  name: TelemetryIconName;
  variant?: TelemetryVariant;
  size?: number;
  badge?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

function renderSvgPath(name: TelemetryIconName): React.ReactNode {
  switch (name) {
    case 'clock-radar':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
          <path d="M12 3a9 9 0 0 1 9 9" strokeDasharray="2.5 2.5" />
          <circle cx="12" cy="12" r="1.75" fill="currentColor" fillOpacity="0.3" />
        </>
      );

    case 'od-route':
      return (
        <>
          <circle cx="5" cy="18" r="2.5" />
          <circle cx="19" cy="6" r="2.5" />
          <path d="M7.5 17c3.5-1.5 6.5-5 9-8.5" />
          <path d="M14 6h5v5" />
        </>
      );

    case 'asymmetry-wave':
      return (
        <>
          <path d="M4 17h3v-5H4v5z" />
          <path d="M10.5 17h3V5h-3v12z" />
          <path d="M17 17h3v-2.5h-3v2.5z" />
          <path d="M5.5 9.5l6.5-3.5 6.5 3.5" />
        </>
      );

    case 'offpeak-drop':
      return (
        <>
          <path d="M3 7h5v5h6v5h7" />
          <circle cx="14" cy="12" r="2" fill="currentColor" fillOpacity="0.25" />
          <path d="M18 14.5l3 2.5-3 2.5" />
        </>
      );

    case 'telemetry-sliders':
      return (
        <>
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <circle cx="4" cy="12" r="2" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <circle cx="12" cy="10" r="2" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <circle cx="20" cy="14" r="2" />
        </>
      );

    case 'thermal-matrix':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" fillOpacity="0.4" />
        </>
      );

    case 'ranked-corridors':
      return (
        <>
          <path d="M4 6h16M4 12h11M4 18h7" />
          <path d="M17 9.5l3 2.5-3 2.5" />
          <circle cx="19" cy="6" r="1.5" fill="currentColor" />
        </>
      );

    case 'insight-node':
      return (
        <>
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3" />
          <path d="M9 9a4.5 4.5 0 1 1 6 0c-.8.8-1.5 1.5-1.5 2.5v1h-3v-1c0-1-.7-1.7-1.5-2.5z" />
          <path d="M10 17h4" />
        </>
      );

    case 'haul-vector':
      return (
        <>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <path d="M7 6v5M11 6v3M15 6v5M19 6v3" />
          <path d="M6 14h12" strokeDasharray="2 2" />
        </>
      );

    case 'dual-waveform':
      return (
        <>
          <path d="M3 16c2-4 4-8 6-8s4 10 6 10 4-6 6-6" />
          <path d="M3 19c3-2 5-4 7-4s4 5 7 5 4-2 4-2" strokeDasharray="3 3" opacity="0.65" />
        </>
      );

    case 'corridor-focus':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.2" />
          <line x1="12" y1="2" x2="12" y2="5" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="2" y1="12" x2="5" y2="12" />
          <line x1="19" y1="12" x2="22" y2="12" />
        </>
      );

    case 'decision-directives':
      return (
        <>
          <path d="M12 2l8 4v6c0 5.25-3.5 10-8 11-4.5-1-8-5.75-8-11V6l8-4z" />
          <path d="M9 12l2 2 4-4" />
        </>
      );

    case 'spark':
      return (
        <path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z" fill="currentColor" fillOpacity="0.25" />
      );

    case 'transit-rail':
      return (
        <>
          <rect x="5" y="3" width="14" height="15" rx="3" />
          <line x1="5" y1="11" x2="19" y2="11" />
          <circle cx="8.5" cy="15" r="1.5" fill="currentColor" />
          <circle cx="15.5" cy="15" r="1.5" fill="currentColor" />
          <path d="M7 21l2-3M17 21l-2-3" />
        </>
      );

    case 'urban-cluster':
      return (
        <>
          <rect x="4" y="8" width="6" height="13" rx="1" />
          <rect x="14" y="3" width="6" height="18" rx="1" />
          <line x1="7" y1="12" x2="7" y2="12.01" strokeWidth="2.5" />
          <line x1="17" y1="7" x2="17" y2="7.01" strokeWidth="2.5" />
          <line x1="17" y1="11" x2="17" y2="11.01" strokeWidth="2.5" />
          <line x1="17" y1="15" x2="17" y2="15.01" strokeWidth="2.5" />
        </>
      );

    case 'suburban-station':
      return (
        <>
          <path d="M3 11l9-7 9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M9 20v-6h6v6" />
        </>
      );

    case 'globe-network':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <ellipse cx="12" cy="12" rx="4" ry="9" />
          <line x1="3" y1="12" x2="21" y2="12" />
        </>
      );

    case 'trend-down':
      return (
        <>
          <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
          <polyline points="16 17 22 17 22 11" />
        </>
      );

    case 'chart-bar':
      return (
        <>
          <line x1="18" y1="20" x2="18" y2="10" />
          <line x1="12" y1="20" x2="12" y2="4" />
          <line x1="6" y1="20" x2="6" y2="14" />
          <line x1="3" y1="20" x2="21" y2="20" />
        </>
      );

    case 'trend-up':
      return (
        <>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </>
      );

    case 'lightning':
      return (
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      );

    case 'sunrise':
      return (
        <>
          <path d="M12 2v4M4.93 10.93l2.83-2.83M19.07 10.93l-2.83-2.83M2 18h20M7 18a5 5 0 0 1 10 0" />
        </>
      );

    case 'sun':
      return (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32l1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32l1.41-1.41" />
        </>
      );

    case 'sunset':
      return (
        <>
          <path d="M12 10v4M4.93 10.93l2.83-2.83M19.07 10.93l-2.83-2.83M2 18h20M7 18a5 5 0 0 1 10 0M10 12l2 2 2-2" />
        </>
      );

    case 'fuel':
      return (
        <>
          <path d="M3 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M13 10h4a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0 2-2V9l-3-3" />
          <line x1="3" y1="21" x2="13" y2="21" />
          <rect x="6" y="6" width="4" height="4" rx="1" />
        </>
      );

    case 'car':
      return (
        <>
          <path d="M5 16h14M4 10l2-5h12l2 5M3 10h18v6H3z" />
          <circle cx="7.5" cy="16" r="2" />
          <circle cx="16.5" cy="16" r="2" />
        </>
      );

    case 'briefcase':
      return (
        <>
          <rect x="2" y="7" width="20" height="14" rx="2" />
          <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
          <line x1="2" y1="12" x2="22" y2="12" />
        </>
      );

    case 'ai-chip':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
        </>
      );

    case 'gear':
      return (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </>
      );

    case 'pin-marker':
      return (
        <>
          <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
          <circle cx="12" cy="9" r="2.5" />
        </>
      );

    case 'map-grid':
      return (
        <>
          <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
          <line x1="8" y1="2" x2="8" y2="18" />
          <line x1="16" y1="6" x2="16" y2="22" />
        </>
      );

    case 'forecast-mesh':
      return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 4v16M4 12h16" />
          <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.25" />
        </>
      );

    case 'sliders-horizontal':
      return (
        <>
          <line x1="21" y1="4" x2="14" y2="4" />
          <line x1="10" y1="4" x2="3" y2="4" />
          <line x1="21" y1="12" x2="12" y2="12" />
          <line x1="8" y1="12" x2="3" y2="12" />
          <line x1="21" y1="20" x2="16" y2="20" />
          <line x1="12" y1="20" x2="3" y2="20" />
          <line x1="14" y1="2" x2="14" y2="6" />
          <line x1="8" y1="10" x2="8" y2="14" />
          <line x1="16" y1="18" x2="16" y2="22" />
        </>
      );

    case 'clock':
      return (
        <>
          <circle cx="12" cy="12" r="9" />
          <polyline points="12 7 12 12 15.5 14" />
        </>
      );

    case 'accessibility':
      return (
        <>
          <circle cx="16" cy="4" r="1.2" />
          <path d="m18 19 1-7-6 1" />
          <path d="m5 8 3-3 5.5 3-2.36 3.5" />
          <path d="M4.24 14.5a5 5 0 0 0 6.88 6" />
          <path d="M13.76 17.5a5 5 0 0 0-6.88-6" />
        </>
      );

    case 'calendar-clock':
      return (
        <>
          <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5" />
          <path d="M16 2v4M8 2v4M3 10h5" />
          <circle cx="16" cy="16" r="6" />
          <path d="M16 13.5v2.5l1.5 1" />
        </>
      );

    case 'users':
      return (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </>
      );

    case 'timer':
      return (
        <>
          <line x1="10" y1="2" x2="14" y2="2" />
          <line x1="12" y1="14" x2="15" y2="11" />
          <circle cx="12" cy="14" r="8" />
        </>
      );

    case 'shield-check':
      return (
        <>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </>
      );

    case 'activity':
      return <path d="M22 12h-4l-3 9L9 3l-3 9H2" />;

    default:
      return <circle cx="12" cy="12" r="8" />;
  }
}

export const TelemetryIcon: React.FC<TelemetryIconProps> = ({
  name,
  variant = 'cobalt',
  size = 17,
  badge = false,
  className,
  style,
}) => {
  const theme = THEMES[variant];

  const svgElement = (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      stroke="currentColor"
      aria-hidden="true"
      style={{
        display: 'block',
        flexShrink: 0,
      }}
    >
      {renderSvgPath(name)}
    </svg>
  );

  if (!badge) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.stroke,
          flexShrink: 0,
          ...style,
        }}
      >
        {svgElement}
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        width: 28,
        height: 28,
        borderRadius: 7,
        background: theme.bg,
        border: `1px solid ${theme.border}`,
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.6)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: theme.stroke,
        flexShrink: 0,
        ...style,
      }}
    >
      {svgElement}
    </span>
  );
};

export default TelemetryIcon;
