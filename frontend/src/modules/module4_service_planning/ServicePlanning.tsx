import { lazy, Suspense, useId, useRef, useState } from 'react';
import { dateText } from './analytics';
import { useAsset } from './dataClient';
import { DashboardErrorBoundary, Loading } from './ui';
import s from './dashboard.module.css';

const tabs = [
  { code: 'SP01', title: 'Service Readiness & Capacity', Component: lazy(() => import('./tabs/ServiceReadiness')) },
  { code: 'SP02', title: 'Demand Scenario Planning', Component: lazy(() => import('./tabs/DemandForecast')) },
  { code: 'SP03', title: 'Temporal Service Planning', Component: lazy(() => import('./tabs/DemandDrivers')) },
  { code: 'SP04', title: 'Equity & Accessibility', Component: lazy(() => import('./tabs/EquityAccessibility')) },
] as const;
const Methodology = lazy(() => import('./Methodology'));

function TrainFront() {
  return <svg className={s.trainIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="5.5" y="3" width="13" height="15" rx="3" />
    <path d="M6 11h12M10 6h4M8.5 18l-2 3m9-3 2 3" />
    <circle cx="9" cy="14.5" r=".75" fill="currentColor" stroke="none" />
    <circle cx="15" cy="14.5" r=".75" fill="currentColor" stroke="none" />
  </svg>;
}

function ReleaseContext() {
  const { analysisReferenceDate, dataRevision } = useAsset('manifest');
  return <dl className={s.releaseContext}>
    <div><dt>Analysis reference date</dt><dd><time dateTime={analysisReferenceDate}>{dateText(analysisReferenceDate)}</time></dd></div>
    <div><dt>Active revision</dt><dd><code>{dataRevision}</code></dd></div>
  </dl>;
}

export function ServicePlanning() {
  const [active, setActive] = useState(0);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const drawer = useRef<HTMLDialogElement>(null);
  const ActiveTab = tabs[active].Component;

  function selectTab(index: number, focus = false) {
    setActive(index);
    const tab = buttons.current[index];
    if (focus) tab?.focus({ preventScroll: true });
    tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  return (
    <div className={s.dashboard}>
      <div className={s.workspace}>
        <header className={s.masthead}>
          <div className={s.mastheadTitle}>
            <span className={s.moduleLabel}>Module 04</span>
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
        <nav className={s.tabList} role="tablist" aria-label="Service Planning & Accessibility views"
          onKeyDown={(event) => {
            const next = { ArrowLeft: (active + tabs.length - 1) % tabs.length,
              ArrowRight: (active + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
            if (next == null) return;
            event.preventDefault();
            selectTab(next, true);
          }}>
          {tabs.map(({ code, title }, index) => <button key={title} ref={(node) => { buttons.current[index] = node; }}
            type="button" role="tab" id={`${baseId}-tab-${index}`} aria-controls={`${baseId}-panel-${index}`}
            aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => selectTab(index)}>
            <span className={s.stationSign} aria-hidden="true"><TrainFront /><span className={s.stationCode}>{code}</span></span>
            <span className={s.stationName}>{title}</span>
          </button>)}
        </nav>
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
