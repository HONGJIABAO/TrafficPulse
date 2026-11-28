import { Suspense, useId, useRef, useState } from 'react';
import { ablationOverview, dateRange, dateText, evaluationHorizons, num, pct, signed, targetShort, titleCase } from './analytics';
import type { Evidence } from './contracts';
import { historyDataUrl, manifestUrl, methodologyDataUrl, networkDataUrl, patternsDataUrl, researchDataUrl, useAsset } from './dataClient';
import { DataLink, Details, EvidenceBadge, Loading } from './ui';
import s from './dashboard.module.css';

const evidence: { kind: Evidence; detail: string }[] = [
  { kind: 'Observed', detail: 'Published or directly measured records in the validated source window.' },
  { kind: 'Model Forecast', detail: 'Model projection from its published data cutoff. Elapsed projections retain this status.' },
  { kind: 'Scheduled Reference', detail: 'Terminal supply implied by the archived GTFS reference schedule.' },
  { kind: 'Proxy Estimate', detail: 'An estimate using external observed patterns, such as KTM hourly shares applied to daily LRT3 scenarios.' },
  { kind: 'Planning Assumption', detail: 'A scenario offset or a timetable held after its calendar validity.' },
  { kind: 'Unavailable', detail: 'Missing, out of scope or undefined for this denominator. Observed zero is reported separately.' },
];

const workflow = [
  ['Data sources', 'Ridership, GTFS, holiday and district records.'],
  ['Cleaning and reconciliation', 'Check OD subtotals, station joins and reporting coverage.'],
  ['Forecasting and screening', 'Model demand, analyse service and screen district equity.'],
  ['Service planning insights', 'Assess demand scenarios, reference supply and districts for follow-up.'],
];

function Overview() {
  const { snapshot } = useAsset('methodology');
  const { analysisReferenceDate } = useAsset('manifest');
  const { observation, physicalStations, districts } = useAsset('equity');
  const statistics = [
    { value: snapshot.sourceRows, label: 'Published Rapid Rail OD records', detail: 'Raw source rows before reconciliation' },
    { value: observation.days, label: 'Common observation days', detail: dateRange(observation.start, observation.end) },
    { value: physicalStations, label: 'Mapped physical Rapid Rail stations', detail: 'Deduplicated facilities in the district study' },
    { value: districts.length, label: 'Administrative comparison units', detail: 'Whole districts and federal territories used for equity screening' },
  ];

  return <>
    <section className={s.methodologySection}>
      <h3>Research at a glance</h3>
      <dl className={s.methodologyStats}>
        {statistics.map(({ value, label, detail }) => <div key={label} className={s.methodologyStat}>
          <dt>{label}</dt><dd>{num(value)}</dd><dd className={s.muted}>{detail}</dd>
        </div>)}
      </dl>
      <p className={s.muted}>The OD source includes aggregate and named-destination records. Journey-level deduplication is unavailable.</p>
    </section>
    <section className={s.methodologySection}>
      <h3>Research workflow</h3>
      <ol className={s.methodologyWorkflow}>
        {workflow.map(([label, detail]) => <li key={label}><strong>{label}</strong><span>{detail}</span></li>)}
      </ol>
    </section>
    <section className={s.methodologySection}>
      <h3>Evidence classifications</h3>
      <dl className={s.methodologyEvidence}>
        {evidence.map(({ kind, detail }) => <div key={kind} className={s.methodologyCard}>
          <dt><EvidenceBadge kind={kind} /></dt><dd className={s.muted}>{detail}</dd>
        </div>)}
      </dl>
    </section>
    <Details title="Observation windows">
      <ul className={s.textList}>
        <li>Published headline demand · {dateRange(snapshot.headlineStart, snapshot.headlineCutoff)}</li>
        <li>LRT3 station-origin demand · {dateRange(snapshot.odStart, snapshot.odCutoff)}</li>
        <li>District activity · {dateRange(observation.start, observation.end)}</li>
        <li>Equity survey years · {snapshot.surveyYears.join(' and ')}</li>
        <li>Fixed analysis reference date · {dateText(analysisReferenceDate)}</li>
      </ul>
      <p className={s.muted}>The headline and LRT3 station-origin windows end at their respective forecast cutoffs.</p>
    </Details>
  </>;
}

const models = [
  ['Seven-day Seasonal Naive', 'Statistical baseline', 'Repeats demand from the same weekday in the previous week.'],
  ['Damped Holt–Winters', 'Statistical time series', 'Smooths demand level and weekly seasonality, with a trend that tapers over the forecast.'],
  ['Calendar-aware regularized Ridge Regression', 'Machine learning', 'Fits a regularized linear model using lagged demand, time and calendar features. The active calendar indicator flags verified holidays.'],
];

function Methods() {
  const { sections, snapshot } = useAsset('methodology');
  const { calendarStart, calendarEnd, capacity } = useAsset('service');
  const { scenarioAssumptions } = useAsset('network');
  const [short, medium, long] = evaluationHorizons;
  const methods = [
    { title: 'Demand forecasting', detail: <>The published network forecast sums six service projections. A separate LRT3 station-origin forecast supplies Base. Low and High are phased planning offsets reaching {signed(scenarioAssumptions.low_offset_at_day_90 * 100, 0, '%')} and {signed(scenarioAssumptions.high_offset_at_day_90 * 100, 0, '%')} at lead 90. Calibrated prediction intervals are unavailable.</> },
    { title: 'GTFS schedules and nominal capacity', detail: <>Archived GTFS provides reference terminal departures. For LRT3, departures are multiplied by {num(capacity.passenger_places)} design places per train. The reference calendar covers {dateRange(calendarStart, calendarEnd)}. Later ordinary dates use a held-reference assumption where holiday coverage permits.</> },
    { title: 'KTM-informed peak demand sensitivity', detail: <>Observed KTM Komuter hourly shares distribute the daily LRT3 scenarios. Matched dates show proxy station-origin trips alongside nominal terminal places, with separate units. Vehicle occupancy requires observed passenger and delivered service data.</> },
    { title: 'Matched holiday analysis', detail: <>Verified holidays are matched with known non-holidays on the same weekday within 28 days. The archive covers {snapshot.calendarYears.join(' and ')}. Tentative holidays and unknown dates are excluded from both samples.</> },
    { title: 'District equity screening', detail: <>Deduplicated GTFS facilities and OpenStreetMap boundaries provide district station density. The screen combines this with household income and poverty. Walking accessibility and unmet demand require separate evidence.</> },
  ];

  return <>
    <section className={s.methodologySection}>
      <h3>Forecasting models</h3>
      <div className={s.methodologyModels}>
        {models.map(([title, family, detail]) => <article className={s.methodologyCard} key={title}>
          <h4>{title}</h4><p className={s.methodologyLabel}>{family}</p><p>{detail}</p>
        </article>)}
      </div>
      <p className={s.muted}>Rolling-origin evaluation advances the forecast start through history. At each origin, the model uses earlier data and is scored against observations at {short}, {medium} and {long} leads. Forecast changes use a recent weekday-matched baseline.</p>
    </section>
    <section className={s.methodologySection}>
      <h3>Service planning methods</h3>
      <div className={s.methodologyGrid}>
        {methods.map(({ title, detail }) => <article className={s.methodologyCard} key={title}>
          <h4>{title}</h4><p>{detail}</p>
        </article>)}
      </div>
    </section>
    <Details title="Detailed assumptions and research methods">
      {sections.map(({ title, text }) => <section key={title} className={s.methodologySection}>
        <h4>{title}</h4>
        <ul className={s.textList}>{text.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>)}
    </Details>
  </>;
}

function ScoreList({ rows }: { rows: { label: string; value: number | null }[] }) {
  return <dl className={s.methodologyScores}>
    {rows.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{pct(value)}</dd></div>)}
  </dl>;
}

function Validation() {
  const { snapshot, outcomes } = useAsset('methodology');
  const { uncertainty, ablation } = useAsset('research');
  const { components } = useAsset('network');
  const horizon = 28;
  const { targets, rows } = ablationOverview(ablation, components, horizon);
  const ablationLabels = { A: 'Weekly and lag features', B: 'Plus trend and annual seasonality', C: 'Plus holiday and coverage features' };
  const [lower, upper] = uncertainty.nominal_residual_quantiles;

  return <>
    <section className={s.methodologyCard}>
      <h3>Published OD reconciliation</h3>
      <dl className={s.methodologyScores}>
        <div><dt>LRT3 origin-date A0 subtotals matching named destinations</dt><dd>{num(snapshot.stationDateMatches)} of {num(snapshot.stationDates)}</dd></div>
        <div><dt>Reconciled district-study origin-day records</dt><dd>{num(snapshot.networkOriginDays)}</dd></div>
      </dl>
      <p className={s.muted}>These checks establish agreement within the published records. Complete journey capture remains unverified.</p>
    </section>
    <section className={s.methodologyCard}>
      <h3>Six-service network forecast</h3>
      <p>Weighted absolute percentage error (WAPE) on the retrospective {outcomes.networkHoldoutDays}-day terminal holdout.</p>
      <ScoreList rows={[
        { label: 'Seasonal Naive', value: outcomes.baselineNetworkWape },
        { label: 'Selected ensemble', value: outcomes.selectedNetworkWape },
      ]} />
      <p><strong>Seasonal Naive had the lower WAPE.</strong> The period had already been inspected. Independent 90-day forecast accuracy remains unmeasured.</p>
    </section>
    <section className={s.methodologyCard}>
      <h3>Forecast feature-set evaluation</h3>
      {targets.length > 0 ? <>
        <p>Mean rolling-origin WAPE at {horizon} leads across {num(targets.length)} mature services.</p>
        <ScoreList rows={rows.map(({ variant, wape }) => ({ label: ablationLabels[variant], value: wape }))} />
      </> : <p>No complete mature-service evaluation is available for this horizon.</p>}
      <p className={s.muted}>The final bundle adds the holiday flag and archive coverage indicator together. Tentative-only or uncovered dates have unknown status. These scores measure predictive performance under the saved design. Causal effects remain unmeasured.</p>
    </section>
    <Details title="Uncertainty, donor transfer and forecast stability">
      <section className={s.methodologySection}>
        <h4>LRT3 empirical residual band</h4>
        <p>The nominal {pct((upper - lower) * 100, 0)} residual band contained {num(uncertainty.holdout_inside)} of {num(uncertainty.holdout_points)} terminal observations ({pct(uncertainty.holdout_coverage_pct)}). {uncertainty.limitations}</p>
      </section>
      <section className={s.methodologySection}>
        <h4>Cold-start donor transfer</h4>
        <p>The primary 50% donor transfer raised mean WAPE across the tested horizons for both targets.</p>
        <ul className={s.textList}>{outcomes.coldStart.map((row) => <li key={row.seriesId}>
          {targetShort[row.seriesId]} · {pct(row.primaryDonorWape)} with transfer versus {pct(row.baselineWape)} for Seasonal Naive
        </li>)}</ul>
      </section>
      <section className={s.methodologySection}>
        <h4>Shah Alam headline forecast</h4>
        <p>The full 90-lead change of {signed(outcomes.shahAlamPublishedChangePct, 2, '%')} versus the recent weekday-matched baseline is sensitive to the fitted trend and training window.</p>
      </section>
    </Details>
  </>;
}

const sourceCategories = [
  'Transport demand',
  'Scheduled service and train specifications',
  'Socioeconomic indicators',
  'Calendar and geography',
  'Operator milestones and policy',
] as const;

const sourceCategory: Record<string, typeof sourceCategories[number]> = {
  'Published daily service counts': 'Transport demand',
  'Rapid Rail station-origin OD': 'Transport demand',
  'KTM Komuter OD data': 'Transport demand',
  'GTFS frequency specification': 'Scheduled service and train specifications',
  'Shah Alam LRV formation and design capacity': 'Scheduled service and train specifications',
  'Prasarana Rapid Rail KL GTFS': 'Scheduled service and train specifications',
  'Department of Statistics Malaysia, district household income': 'Socioeconomic indicators',
  'Department of Statistics Malaysia, district absolute poverty': 'Socioeconomic indicators',
  'Department of Statistics Malaysia, district population': 'Socioeconomic indicators',
  'Official public holiday calendars': 'Calendar and geography',
  'Historical PLANMalaysia research boundaries': 'Calendar and geography',
  'PLANMalaysia comparison scope': 'Calendar and geography',
  'OpenStreetMap contributors': 'Calendar and geography',
};

const downloads = [
  { file: 'research.json', href: researchDataUrl, label: 'Forecast research', detail: 'Model evaluations, donor and feature trials, alternative forecasts, stability and residual-band audit.' },
  { file: 'network.json', href: networkDataUrl, label: 'Forecast records', detail: 'Daily forecasts, forecast windows, planning scenarios and watchlist results.' },
  { file: 'history.json', href: historyDataUrl, label: 'Observed history', detail: 'Daily observations for all published demand targets.' },
  { file: 'patterns.json', href: patternsDataUrl, label: 'Temporal evidence', detail: 'Monthly coverage, seasonal and recent patterns, and archived holiday records.' },
  { file: 'methodology.json', href: methodologyDataUrl, label: 'Detailed methods and sources', detail: 'Research assumptions, validation results, source notes and operator milestones.' },
];

function TechnicalDetails() {
  const manifest = useAsset('manifest');
  return <>
    <p>Analytical revision <code>{manifest.dataRevision}</code> · reference date {dateText(manifest.analysisReferenceDate)}</p>
    <p className={s.muted}>The manifest records byte counts and SHA-256 fingerprints for {num(Object.keys(manifest.assets).length)} exported data files, input fingerprints and validation results.</p>
    <a href={manifestUrl} download="manifest.json">Download data manifest (JSON)</a>
  </>;
}

function Sources() {
  const { sources, interventions } = useAsset('methodology');
  const policyCategory = 'Operator milestones and policy';
  return <>
    <section className={s.methodologySection}>
      <h3>Official sources</h3>
      <div className={s.methodologyGrid}>
        {sourceCategories.map((category) => <section className={s.methodologyCard} key={category}>
          <h4>{category}</h4>
          {sources.filter((source) => (sourceCategory[source.label] ?? policyCategory) === category)
            .map((source) => <DataLink key={source.url} source={source} />)}
          {category === 'Calendar and geography' && <p className={s.muted}>Current district display boundaries are © OpenStreetMap contributors (ODbL 1.0). The archived Step 4 and 4B studies used PLANMalaysia boundaries.</p>}
          {category === policyCategory && <Details title="Shah Alam operator milestones">
            <ul className={s.methodologyDownloads}>
              {interventions.map((row) => <li key={row.event}>
                <strong>{titleCase(row.event)} · <time dateTime={row.date}>{dateText(row.date)}</time></strong>
                <DataLink source={{ label: 'Source record', url: row.source, detail: row.verification }} />
              </li>)}
            </ul>
          </Details>}
        </section>)}
      </div>
    </section>
    <section className={s.methodologySection}>
      <h3>Research evidence and downloads</h3>
      <ul className={s.methodologyDownloads}>
        {downloads.map(({ file, href, label, detail }) => <li key={file} className={s.methodologyCard}>
          <a href={href} download={file}>{label} (JSON)</a><span className={s.muted}>{detail}</span>
        </li>)}
      </ul>
    </section>
    <Details title="Technical details and manifest" summary="Analytical revision, validation record and file fingerprints.">
      <TechnicalDetails />
    </Details>
  </>;
}

const tabs = [
  { label: 'Overview', Component: Overview },
  { label: 'Methods', Component: Methods },
  { label: 'Validation', Component: Validation },
  { label: 'Sources', Component: Sources },
] as const;

export default function Methodology() {
  const [active, setActive] = useState(0);
  const id = useId();
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const content = useRef<HTMLDivElement>(null);

  function selectTab(index: number) {
    if (index === active) return;
    setActive(index);
    if (content.current) content.current.scrollTop = 0;
  }

  return <>
    <div className={s.methodologyTabs} role="tablist" aria-label="Methodology sections">
      {tabs.map(({ label }, index) => <button key={label} type="button" role="tab" id={`${id}-tab-${index}`}
        aria-controls={`${id}-panel-${index}`} aria-selected={index === active} tabIndex={index === active ? 0 : -1}
        ref={(button) => { buttons.current[index] = button; }}
        onClick={() => selectTab(index)}
        onKeyDown={(event) => {
          const next = {
            ArrowLeft: (index + tabs.length - 1) % tabs.length,
            ArrowRight: (index + 1) % tabs.length,
            Home: 0,
            End: tabs.length - 1,
          }[event.key];
          if (next == null) return;
          event.preventDefault();
          selectTab(next);
          buttons.current[next]?.focus();
        }}>{label}</button>)}
    </div>
    <div className={s.methodologyContent} ref={content}>
      {tabs.map(({ label, Component }, index) => <section key={label} className={s.methodologyPanel}
        role="tabpanel" id={`${id}-panel-${index}`} aria-labelledby={`${id}-tab-${index}`} tabIndex={0} hidden={index !== active}>
        {index === active && <Suspense fallback={<Loading />}><Component /></Suspense>}
      </section>)}
    </div>
  </>;
}
