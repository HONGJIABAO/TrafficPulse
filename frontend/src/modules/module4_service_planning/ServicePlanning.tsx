import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { TelemetryIcon, type TelemetryIconName, type TelemetryVariant } from '@/modules/shared/TelemetryIcon';
import { dateText } from './analytics';
import { useAsset } from './dataClient';
import { DashboardErrorBoundary, Loading } from './ui';
import s from './dashboard.module.css';

interface PlanningTabDef {
  code: string;
  title: string;
  icon: TelemetryIconName;
  variant: TelemetryVariant;
  iconBg: string;
  iconBorder: string;
  Component: React.LazyExoticComponent<React.ComponentType>;
}

const tabs: readonly PlanningTabDef[] = [
  {
    code: 'SP01',
    title: 'Service Readiness & Capacity',
    icon: 'transit-rail',
    variant: 'cobalt',
    iconBg: '#EAF2FF',
    iconBorder: 'rgba(37, 99, 235, 0.22)',
    Component: lazy(() => import('./tabs/ServiceReadiness')),
  },
  {
    code: 'SP02',
    title: 'Demand Scenario Planning',
    icon: 'sliders-horizontal',
    variant: 'teal',
    iconBg: '#E4F6F3',
    iconBorder: 'rgba(13, 148, 136, 0.22)',
    Component: lazy(() => import('./tabs/DemandForecast')),
  },
  {
    code: 'SP03',
    title: 'Temporal Service Planning',
    icon: 'clock',
    variant: 'amber',
    iconBg: '#FFF1E5',
    iconBorder: 'rgba(234, 88, 12, 0.22)',
    Component: lazy(() => import('./tabs/DemandDrivers')),
  },
  {
    code: 'SP04',
    title: 'Equity & Accessibility',
    icon: 'accessibility',
    variant: 'purple',
    iconBg: '#F0EBFF',
    iconBorder: 'rgba(124, 58, 237, 0.22)',
    Component: lazy(() => import('./tabs/EquityAccessibility')),
  },
];
const Methodology = lazy(() => import('./Methodology'));

/** Long, slim, three-car modern metro train (silver-white body, deep blue panoramic windows with cyan reflections, no visible doors). */
function MetroTrainSvg() {
  const uid = useId().replaceAll(':', '');
  const bodyGrad = `metro-body-${uid}`;
  const glassGrad = `metro-glass-${uid}`;
  const stripeGrad = `metro-stripe-${uid}`;
  return (
    <svg className={s.metroTrainSvg} viewBox="0 0 156 24" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={bodyGrad} x1="0" y1="3.5" x2="0" y2="18.5" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="52%" stopColor="#F2F7FD" />
          <stop offset="100%" stopColor="#D3E2F2" />
        </linearGradient>
        <linearGradient id={glassGrad} x1="0" y1="6.4" x2="0" y2="12" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#082450" />
          <stop offset="55%" stopColor="#124286" />
          <stop offset="100%" stopColor="#1B5CB3" />
        </linearGradient>
        <linearGradient id={stripeGrad} x1="0" y1="14" x2="156" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#087AF5" />
          <stop offset="50%" stopColor="#0054C7" />
          <stop offset="100%" stopColor="#087AF5" />
        </linearGradient>
      </defs>

      {/* Soft contact shadow on the track */}
      <ellipse cx="78" cy="22.1" rx="71" ry="1.15" fill="#0F1E36" fillOpacity="0.15" />

      {/* Minimal undercarriage bogie bars & small understated wheels */}
      <rect x="14" y="18.1" width="35" height="1.5" rx="0.75" fill="#5D7896" />
      <rect x="57.5" y="18.1" width="41" height="1.5" rx="0.75" fill="#5D7896" />
      <rect x="107" y="18.1" width="35" height="1.5" rx="0.75" fill="#5D7896" />
      {[17.5, 23, 42.5, 48, 61.5, 67, 89, 94.5, 108, 113.5, 133, 138.5].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="20.4" r="1.45" fill="#354B66" />
          <circle cx={cx} cy="20.4" r="0.55" fill="#B6CBE0" />
        </g>
      ))}

      {/* Minimal inter-carriage gangway bellows connectors */}
      <rect x="51.2" y="6.0" width="3.8" height="11.8" rx="0.8" fill="#9BB3CC" stroke="#7894B2" strokeWidth="0.6" />
      <line x1="53.1" y1="6.4" x2="53.1" y2="17.4" stroke="#6885A6" strokeWidth="0.65" />
      <rect x="101" y="6.0" width="3.8" height="11.8" rx="0.8" fill="#9BB3CC" stroke="#7894B2" strokeWidth="0.6" />
      <line x1="102.9" y1="6.4" x2="102.9" y2="17.4" stroke="#6885A6" strokeWidth="0.65" />

      {/* Low-profile architectural roof fairings */}
      <rect x="20" y="3.2" width="22" height="1.25" rx="0.6" fill="#C9DCF0" />
      <rect x="65" y="3.2" width="26" height="1.25" rx="0.6" fill="#C9DCF0" />
      <rect x="114" y="3.2" width="22" height="1.25" rx="0.6" fill="#C9DCF0" />

      {/* Car 1 — Left streamlined head carriage */}
      <path
        d="M2.2 16.5 C2.2 13.8, 5.2 8.2, 11.8 5.2 C13.5 4.4, 15.2 4.3, 17.5 4.3 H50.8 C51.4 4.3, 51.8 4.7, 51.8 5.3 V17.4 C51.8 18.0, 51.4 18.4, 50.8 18.4 H4.5 C2.9 18.4, 2.2 17.6, 2.2 16.5 Z"
        fill={`url(#${bodyGrad})`}
        stroke="#86A8CC"
        strokeWidth="0.9"
      />

      {/* Car 2 — Middle elongated carriage */}
      <rect
        x="54.4"
        y="4.3"
        width="47.2"
        height="14.1"
        rx="1.2"
        fill={`url(#${bodyGrad})`}
        stroke="#86A8CC"
        strokeWidth="0.9"
      />

      {/* Car 3 — Right streamlined head carriage */}
      <path
        d="M153.8 16.5 C153.8 13.8, 150.8 8.2, 144.2 5.2 C142.5 4.4, 140.8 4.3, 138.5 4.3 H105.2 C104.6 4.3, 104.2 4.7, 104.2 5.3 V17.4 C104.2 18.0, 104.6 18.4, 105.2 18.4 H151.5 C153.1 18.4, 153.8 17.6, 153.8 16.5 Z"
        fill={`url(#${bodyGrad})`}
        stroke="#86A8CC"
        strokeWidth="0.9"
      />

      {/* Stronger blue horizontal body stripe */}
      <path d="M3.0 13.9 H51.4 V15.6 H2.6 C2.7 14.9, 2.8 14.4, 3.0 13.9 Z" fill={`url(#${stripeGrad})`} />
      <rect x="54.8" y="13.9" width="46.4" height="1.7" fill={`url(#${stripeGrad})`} />
      <path d="M104.6 13.9 H153.0 C153.2 14.4, 153.3 14.9, 153.4 15.6 H104.6 Z" fill={`url(#${stripeGrad})`} />

      {/* Continuous deep-blue panoramic windows (no visible doors or window divisions) */}
      <path
        d="M5.6 11.4 C6.9 9.0, 9.5 7.0, 12.8 6.5 H48.4 C49.2 6.5, 49.7 7.0, 49.7 7.8 V10.7 C49.7 11.4, 49.2 11.9, 48.4 11.9 H6.2 C5.6 11.9, 5.3 11.7, 5.6 11.4 Z"
        fill={`url(#${glassGrad})`}
      />
      <rect x="56.7" y="6.5" width="42.6" height="5.4" rx="1.6" fill={`url(#${glassGrad})`} />
      <path
        d="M150.4 11.4 C149.1 9.0, 146.5 7.0, 143.2 6.5 H107.6 C106.8 6.5, 106.3 7.0, 106.3 7.8 V10.7 C106.3 11.4, 106.8 11.9, 107.6 11.9 H149.8 C150.4 11.9, 150.7 11.7, 150.4 11.4 Z"
        fill={`url(#${glassGrad})`}
      />

      {/* Subtle cyan reflections inside the deep-blue windows */}
      <line x1="12.2" y1="7.5" x2="47.8" y2="7.5" stroke="#7DD3FC" strokeWidth="0.7" strokeLinecap="round" strokeOpacity="0.6" />
      <path d="M18 11.2 L23.5 7.1 M34 11.2 L39.5 7.1" stroke="#38BDF8" strokeWidth="0.8" strokeLinecap="round" strokeOpacity="0.35" />
      <line x1="58.2" y1="7.5" x2="97.8" y2="7.5" stroke="#7DD3FC" strokeWidth="0.7" strokeLinecap="round" strokeOpacity="0.6" />
      <path d="M67 11.2 L72.5 7.1 M83 11.2 L88.5 7.1" stroke="#38BDF8" strokeWidth="0.8" strokeLinecap="round" strokeOpacity="0.35" />
      <line x1="108.2" y1="7.5" x2="143.8" y2="7.5" stroke="#7DD3FC" strokeWidth="0.7" strokeLinecap="round" strokeOpacity="0.6" />
      <path d="M116 11.2 L121.5 7.1 M132 11.2 L137.5 7.1" stroke="#38BDF8" strokeWidth="0.8" strokeLinecap="round" strokeOpacity="0.35" />

      {/* Minimal front & rear streamlined cyan-white headlights */}
      <rect x="3.1" y="13.0" width="2.6" height="1.15" rx="0.55" fill="#BAE6FD" />
      <rect x="150.3" y="13.0" width="2.6" height="1.15" rx="0.55" fill="#BAE6FD" />
    </svg>
  );
}

function ReleaseContext() {
  const { analysisReferenceDate, dataRevision } = useAsset('manifest');
  return <dl className={s.releaseContext}>
    <div><dt>Analysis reference date</dt><dd><time dateTime={analysisReferenceDate}>{dateText(analysisReferenceDate)}</time></dd></div>
    <div><dt>Active revision</dt><dd><code>{dataRevision}</code></dd></div>
  </dl>;
}

interface EnergyFlow {
  id: number;
  left: number;
  width: number;
  direction: 'left' | 'right';
  duration: number;
}

interface NavMetrics {
  activeLeft: number;
  top: number;
  width: number;
  height: number;
  centers: number[];
  ready: boolean;
}

export function ServicePlanning() {
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const [motionReady, setMotionReady] = useState(false);
  const [motionDuration, setMotionDuration] = useState(520);
  const [energyFlow, setEnergyFlow] = useState<EnergyFlow | null>(null);
  const [arrivalPulse, setArrivalPulse] = useState<{ index: number; key: number } | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);

  const baseId = useId();
  const tabListRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const drawer = useRef<HTMLDialogElement>(null);

  const flowIdRef = useRef(0);
  const pulseIdRef = useRef(0);
  const arrivalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulseClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const energyClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [metrics, setMetrics] = useState<NavMetrics>({
    activeLeft: 0,
    top: 4,
    width: 0,
    height: 46,
    centers: [],
    ready: false,
  });

  const measureLayout = useCallback(() => {
    const activeBtn = buttons.current[active];
    const trackEl = trackRef.current;
    if (!activeBtn || !trackEl) return;

    const trackRect = trackEl.getBoundingClientRect();
    const centers = buttons.current.map((btn) => {
      if (!btn) return 0;
      const rect = btn.getBoundingClientRect();
      return rect.left + rect.width / 2 - trackRect.left;
    });

    setMetrics({
      activeLeft: activeBtn.offsetLeft,
      top: activeBtn.offsetTop,
      width: activeBtn.offsetWidth,
      height: activeBtn.offsetHeight,
      centers,
      ready: true,
    });
  }, [active]);

  useLayoutEffect(() => {
    measureLayout();
  }, [measureLayout]);

  useEffect(() => {
    if (!metrics.ready || motionReady) return;
    const raf = requestAnimationFrame(() => setMotionReady(true));
    return () => cancelAnimationFrame(raf);
  }, [metrics.ready, motionReady]);

  useEffect(() => {
    const listEl = tabListRef.current;
    const observer = new ResizeObserver(() => measureLayout());
    if (listEl) observer.observe(listEl);
    window.addEventListener('resize', measureLayout);
    document.fonts?.ready.then(() => measureLayout());
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measureLayout);
    };
  }, [measureLayout]);

  useEffect(() => {
    return () => {
      if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
      if (pulseClearTimerRef.current) clearTimeout(pulseClearTimerRef.current);
      if (energyClearTimerRef.current) clearTimeout(energyClearTimerRef.current);
    };
  }, []);

  function selectTab(index: number, focus = false) {
    const tab = buttons.current[index];
    if (focus) tab?.focus({ preventScroll: true });
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

    if (index === active) return;

    if (arrivalTimerRef.current) clearTimeout(arrivalTimerRef.current);
    if (pulseClearTimerRef.current) clearTimeout(pulseClearTimerRef.current);
    if (energyClearTimerRef.current) clearTimeout(energyClearTimerRef.current);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const distance = Math.abs(index - active);
    const duration = reducedMotion ? 0 : distance === 1 ? 520 : distance === 2 ? 680 : 780;

    if (duration > 0 && metrics.centers.length > Math.max(active, index)) {
      const fromX = metrics.centers[active];
      const toX = metrics.centers[index];
      setEnergyFlow({
        id: ++flowIdRef.current,
        left: Math.min(fromX, toX),
        width: Math.max(2, Math.abs(toX - fromX)),
        direction: toX >= fromX ? 'right' : 'left',
        duration,
      });
      energyClearTimerRef.current = setTimeout(() => {
        setEnergyFlow(null);
      }, duration + 260);

      arrivalTimerRef.current = setTimeout(() => {
        setArrivalPulse({ index, key: ++pulseIdRef.current });
        pulseClearTimerRef.current = setTimeout(() => {
          setArrivalPulse(null);
        }, 650);
      }, Math.max(0, duration - 40));
    } else {
      setEnergyFlow(null);
      setArrivalPulse(null);
    }

    setMotionDuration(duration);
    setActive(index);
  }

  const ActiveTab = tabs[active].Component;
  const trainCenterX = metrics.centers[active] ?? 0;

  return (
    <div className={s.dashboard}>
      <div className={s.workspace}>
        <header className={s.masthead}>
          <div className={s.mastheadTitle}>
            <h1>Service Planning &amp; Accessibility</h1>
          </div>
          <button className={s.methodologyButton} type="button" aria-haspopup="dialog" aria-controls={`${baseId}-methodology`}
            onClick={() => { drawer.current?.showModal(); setMethodologyOpen(true); }}>
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              strokeLinejoin="round" aria-hidden="true"><path d="M4 3.5h9l3 3v10H4zM12.5 3.5V7H16M7 9.5h6M7 12.5h6" /></svg>
            Methodology &amp; Data Sources
          </button>
          <p className={s.mastheadSubtitle}>Rapid Rail schedules, demand outlook and district rail access.</p>
          <div className={s.mastheadContext}>
            <DashboardErrorBoundary>
              <Suspense fallback={<Loading label="Loading analysis reference…" />}><ReleaseContext /></Suspense>
            </DashboardErrorBoundary>
          </div>
        </header>

        {/* Compact Animated Railway Navigation */}
        <div className={s.railNavScroll}>
          <div className={s.railNavInner}>
            <nav
              ref={tabListRef}
              className={s.tabList}
              role="tablist"
              aria-label="Service Planning & Accessibility views"
              onKeyDown={(event) => {
                const next = {
                  ArrowLeft: (active + tabs.length - 1) % tabs.length,
                  ArrowRight: (active + 1) % tabs.length,
                  Home: 0,
                  End: tabs.length - 1,
                }[event.key];
                if (next == null) return;
                event.preventDefault();
                selectTab(next, true);
              }}
            >
              {/* Shared Sliding Soft Light-Blue Active Highlight */}
              <div
                className={`${s.activeTabSlide} ${motionReady ? s.hasTransition : ''}`}
                style={{
                  width: metrics.width,
                  height: metrics.height,
                  transform: `translate3d(${metrics.activeLeft}px, ${metrics.top}px, 0)`,
                  transitionDuration: `${motionDuration}ms`,
                  opacity: metrics.ready ? 1 : 0,
                }}
                aria-hidden="true"
              />

              {tabs.map(({ code, title, icon, variant, iconBg, iconBorder }, index) => {
                const isSelected = active === index;
                const isHovered = hovered === index && !isSelected;
                return (
                  <button
                    key={title}
                    ref={(node) => { buttons.current[index] = node; }}
                    type="button"
                    role="tab"
                    id={`${baseId}-tab-${index}`}
                    aria-controls={`${baseId}-panel-${index}`}
                    aria-selected={isSelected}
                    data-hovered={isHovered ? 'true' : undefined}
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => selectTab(index)}
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered((curr) => (curr === index ? null : curr))}
                  >
                    <TelemetryIcon
                      name={icon}
                      variant={variant}
                      badge
                      className={s.tabIconBadge}
                      style={{ background: iconBg, borderColor: iconBorder }}
                    />
                    <span className={s.tabTextCol}>
                      <span className={s.stationCode}>{code}</span>
                      <span className={s.stationName}>{title}</span>
                    </span>
                  </button>
                );
              })}
            </nav>

            {/* Integrated Compact Railway Track & Long Three-Car Metro Train */}
            <div className={s.railwayArea} aria-hidden="true">
              <div ref={trackRef} className={s.railwayTrack}>
                <div className={s.railwaySleepers} />
                <div className={s.railLineTop} />
                <div className={s.railLineBottom} />

                {/* Directional Rail Energy Flow Segment during train travel */}
                {energyFlow && (
                  <div
                    key={energyFlow.id}
                    className={`${s.railEnergySegment} ${energyFlow.direction === 'right' ? s.flowRight : s.flowLeft}`}
                    style={{
                      left: energyFlow.left,
                      width: energyFlow.width,
                      '--flow-duration': `${energyFlow.duration}ms`,
                    } as React.CSSProperties}
                  >
                    <div className={s.railEnergyPulse} />
                  </div>
                )}

                {/* Four Station Nodes aligned with the centre of each tab */}
                {tabs.map((tab, index) => {
                  const isSelected = active === index;
                  const isHovered = hovered === index && !isSelected;
                  const isPulsing = arrivalPulse?.index === index;
                  const centerX = metrics.centers[index];
                  return (
                    <div
                      key={tab.code}
                      className={s.stationNodeWrap}
                      style={{
                        left: centerX != null ? `${centerX}px` : `${index * 25 + 12.5}%`,
                      }}
                    >
                      {isPulsing && <span key={arrivalPulse.key} className={s.stationPulseRing} />}
                      <span
                        className={[
                          s.stationNode,
                          isSelected ? s.stationNodeActive : '',
                          isHovered ? s.stationNodeHovered : '',
                          isPulsing ? s.stationNodeArrived : '',
                        ].filter(Boolean).join(' ')}
                      />
                    </div>
                  );
                })}

                {/* Long Three-Car Metro Train aligned to active station node */}
                <div
                  className={`${s.metroTrainWrap} ${motionReady ? s.hasTransition : ''}`}
                  style={{
                    transform: `translate3d(${trainCenterX}px, 0, 0) translateX(-50%)`,
                    transitionDuration: `${motionDuration}ms`,
                    opacity: metrics.ready ? 1 : 0,
                  }}
                >
                  {/* Subtle cyan energy trail behind the moving train */}
                  {energyFlow && (
                    <span
                      key={energyFlow.id}
                      className={`${s.trainCyanTrail} ${energyFlow.direction === 'right' ? s.trailBehindLeft : s.trailBehindRight}`}
                      style={{ '--trail-duration': `${energyFlow.duration + 180}ms` } as React.CSSProperties}
                    />
                  )}
                  <MetroTrainSvg />
                </div>
              </div>
            </div>
          </div>
        </div>

        {tabs.map(({ title }, index) => <div key={title} role="tabpanel" id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`} hidden={active !== index} tabIndex={0}>
          {active === index && <DashboardErrorBoundary><Suspense fallback={<Loading />}><ActiveTab /></Suspense></DashboardErrorBoundary>}
        </div>)}
        <dialog ref={drawer} className={s.methodology} id={`${baseId}-methodology`} aria-labelledby={`${baseId}-methodology-title`}
          onClose={() => setMethodologyOpen(false)}>
          <header className={s.drawerHeader}>
            <h2 id={`${baseId}-methodology-title`}>Methodology &amp; Data Sources</h2>
            <button type="button" className={s.secondaryButton} onClick={() => drawer.current?.close()}>Close</button>
          </header>
          {methodologyOpen && <div className={s.drawerBody}>
            <DashboardErrorBoundary>
              <Suspense fallback={<Loading label="Loading methodology and sources…" />}><Methodology /></Suspense>
            </DashboardErrorBoundary>
          </div>}
        </dialog>
      </div>
    </div>
  );
}

export default ServicePlanning;
