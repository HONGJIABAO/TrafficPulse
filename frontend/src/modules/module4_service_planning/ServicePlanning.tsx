import { lazy, Suspense, useId, useRef, useState } from 'react';
import { dateText } from './analytics';
import { useAsset } from './dataClient';
import { DashboardErrorBoundary, Loading } from './ui';
import s from './dashboard.module.css';

const tabs = [
  { code: 'SP01', title: 'Service Readiness & Capacity', Component: lazy(() => import('./tabs/ServiceReadiness')) },
  { code: 'SP02', title: 'Planning Outlook', Component: lazy(() => import('./tabs/FutureOutlook')) },
  { code: 'SP03', title: 'Demand Scenarios & Reliability', Component: lazy(() => import('./tabs/DemandForecast')) },
  { code: 'SP04', title: 'Temporal Service Planning', Component: lazy(() => import('./tabs/DemandDrivers')) },
  { code: 'SP05', title: 'Equity & Accessibility', Component: lazy(() => import('./tabs/EquityAccessibility')) },
] as const;
const Methodology = lazy(() => import('./Methodology'));

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

  return (
    <div className={s.dashboard}>
      <div className={s.workspace}>
        <div className={s.controlBar}>
          <div className={s.identity}>
            <span className={s.brandMark} aria-hidden="true" />
            <span>TransitPulse Malaysia</span>
            <span className={s.moduleLabel}>Module 4</span>
          </div>
          <button className={s.methodologyButton} type="button" aria-haspopup="dialog" aria-controls={`${baseId}-methodology`}
            onClick={() => { drawer.current?.showModal(); setMethodologyOpen(true); }}>
            Methodology &amp; Data Sources
          </button>
        </div>
        <header className={s.hero}>
          <div>
            <h1>Service Planning &amp; Accessibility</h1>
            <p>Rapid Rail service readiness, forecast-informed planning and district rail access.</p>
          </div>
          <DashboardErrorBoundary>
            <Suspense fallback={<Loading label="Loading analysis reference…" />}><ReleaseContext /></Suspense>
          </DashboardErrorBoundary>
        </header>
        <nav className={s.tabList} role="tablist" aria-label="Service Planning & Accessibility views"
          onKeyDown={(event) => {
            const next = { ArrowLeft: (active + tabs.length - 1) % tabs.length,
              ArrowRight: (active + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
            if (next == null) return;
            event.preventDefault();
            setActive(next);
            buttons.current[next]?.focus();
          }}>
          {tabs.map(({ code, title }, index) => <button key={title} ref={(node) => { buttons.current[index] = node; }}
            type="button" role="tab" id={`${baseId}-tab-${index}`} aria-controls={`${baseId}-panel-${index}`}
            aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)}>
            <span className={s.stationCode} aria-hidden="true">{code}</span>
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
