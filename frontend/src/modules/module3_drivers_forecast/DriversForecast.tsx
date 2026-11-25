import { lazy, Suspense, useId, useRef, useState } from 'react';
import { DashboardErrorBoundary, Details, Loading } from './ui';
import s from './dashboard.module.css';

const tabs = [
  { title: 'Future Outlook', Component: lazy(() => import('./tabs/FutureOutlook')) },
  { title: 'Demand Forecast', Component: lazy(() => import('./tabs/DemandForecast')) },
  { title: 'Demand Drivers', Component: lazy(() => import('./tabs/DemandDrivers')) },
  { title: 'Service Readiness', Component: lazy(() => import('./tabs/ServiceReadiness')) },
  { title: 'Equity & Accessibility', Component: lazy(() => import('./tabs/EquityAccessibility')) },
] as const;
const Methodology = lazy(() => import('./Methodology'));

export function DriversForecast() {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const ActiveTab = tabs[active].Component;

  return (
    <div className={s.dashboard}>
      <div className={s.workspace}>
        <header className={s.hero}>
          <h1>Demand Drivers &amp; Forecasting</h1>
          <a href={`#${baseId}-methodology`}>Methodology &amp; Data Sources</a>
        </header>
        <nav className={s.tabList} role="tablist" aria-label="Demand Drivers & Forecasting views"
          onKeyDown={(event) => {
            const next = { ArrowLeft: (active + tabs.length - 1) % tabs.length,
              ArrowRight: (active + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
            if (next == null) return;
            event.preventDefault();
            setActive(next);
            buttons.current[next]?.focus();
          }}>
          {tabs.map(({ title }, index) => <button key={title} ref={(node) => { buttons.current[index] = node; }}
            type="button" role="tab" id={`${baseId}-tab-${index}`} aria-controls={`${baseId}-panel-${index}`}
            aria-selected={active === index} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)}>{title}</button>)}
        </nav>
        {tabs.map(({ title }, index) => <div key={title} role="tabpanel" id={`${baseId}-panel-${index}`}
          aria-labelledby={`${baseId}-tab-${index}`} hidden={active !== index}>
          {active === index && <DashboardErrorBoundary><Suspense fallback={<Loading />}><ActiveTab /></Suspense></DashboardErrorBoundary>}
        </div>)}
        <section className={s.methodology} id={`${baseId}-methodology`} aria-label="Methodology and data sources">
          <Details title="Methodology & Data Sources">
            <DashboardErrorBoundary><Methodology /></DashboardErrorBoundary>
          </Details>
        </section>
      </div>
    </div>
  );
}

export default DriversForecast;
