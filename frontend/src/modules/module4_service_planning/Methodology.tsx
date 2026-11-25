import { dateRange, dateText, num, pct, signed, targetShort, titleCase } from './analytics';
import type { Evidence } from './contracts';
import { manifestUrl, useAsset } from './dataClient';
import { AnalysisGroup, DataLink, Details, EvidenceBadge, Note, Table } from './ui';
import s from './dashboard.module.css';

const evidence: { kind: Evidence; detail: string }[] = [
  { kind: 'Observed', detail: 'Published or directly measured records in the validated source window.' },
  { kind: 'Model Forecast', detail: 'Model projection from its published data cutoff. Elapsed projections retain this status.' },
  { kind: 'Scheduled Reference', detail: 'Terminal supply implied by the archived GTFS reference schedule.' },
  { kind: 'Proxy Estimate', detail: 'An estimate using external observed patterns, such as KTM hourly shares applied to daily LRT3 scenarios.' },
  { kind: 'Planning Assumption', detail: 'A scenario offset or a timetable held after its calendar validity.' },
  { kind: 'Unavailable', detail: 'Missing, out of scope or undefined for this denominator. Observed zero is reported separately.' },
];

export default function Methodology() {
  const { sources, sections, snapshot, outcomes, interventions } = useAsset('methodology');
  const manifest = useAsset('manifest');
  const service = useAsset('service');
  return <>
    <div className={s.drawerContext}>
      <dl className={s.releaseContext}>
        <div><dt>Analysis reference date</dt><dd><time dateTime={manifest.analysisReferenceDate}>{dateText(manifest.analysisReferenceDate)}</time></dd></div>
        <div><dt>Active revision</dt><dd><code>{manifest.dataRevision}</code></dd></div>
      </dl>
      <a href={manifestUrl} download="manifest.json">Download data manifest</a>
    </div>
    <AnalysisGroup title="Sources and provenance">
      <Details title="Official sources" summary="Publisher links, licensing and attribution">
        <div className={s.grid2}>{sources.map((source) => <DataLink key={source.url} source={source} />)}</div>
      </Details>
      <Details title="Validated static assets" summary="Files, validation counts and SHA-256 checksums">
        <p>Data revision {manifest.dataRevision}. The export checked {num(Object.keys(manifest.inputSha256).length)} processed source artifacts,
          {' '}{num(manifest.validation.peakRowsReconciled)} peak sensitivity rows and {num(manifest.validation.protectedBackendFileCount)} protected checksums.</p>
        <Table label="Static data export manifest" columns={['Asset', 'Bytes', 'SHA-256']}
          rows={Object.entries(manifest.assets).map(([key, value]) => ({ key, cells: [key, num(value.bytes), <code>{value.sha256}</code>] }))} />
      </Details>
      <Details title="Operator milestones and source notes">
        <Table label="Documented Shah Alam service milestones" columns={['Milestone', 'Date', 'Evidence']}
          rows={interventions.map((row) => ({ key: row.event, cells: [
            titleCase(row.event), dateText(row.date), <DataLink source={{ label: 'Source record', url: row.source, detail: row.verification }} />,
          ] }))} />
      </Details>
    </AnalysisGroup>
    <AnalysisGroup title="Evidence and limits">
      <Table label="Evidence classifications" columns={['Classification', 'Meaning']}
        rows={evidence.map(({ kind, detail }) => ({ key: kind, cells: [<EvidenceBadge kind={kind} />, detail] }))} />
      <Note title="Observation windows and A0 reconciliation">
        <p>Published headline series span {dateRange(snapshot.headlineStart, snapshot.headlineCutoff)}. The LRT3 station-origin window spans {dateRange(snapshot.odStart, snapshot.odCutoff)}.
          Each window’s end date is its forecast data cutoff. The fixed analysis reference date is {dateText(manifest.analysisReferenceDate)}.</p>
        <p>In the inspected Rapid Rail OD source, {num(snapshot.stationDateMatches)} of {num(snapshot.stationDates)} LRT3 origin-date A0 subtotals agreed with named destinations.
          The source contained {num(snapshot.sourceRows)} published rows. Step 4B reconciled {num(snapshot.networkOriginDays)} published origin-day records in the common district window.</p>
        <p>Survey comparison years are {snapshot.surveyYears.join(' and ')}. The archived holiday classifications cover {snapshot.calendarYears.join(' and ')}.
          GTFS validity is {dateRange(service.calendarStart, service.calendarEnd)}. Later dated estimates assume the available ordinary reference timetable holds where holiday coverage permits.</p>
      </Note>
      <Note title="Model evidence and limits">
        <p>The published network ensemble had {pct(outcomes.selectedNetworkWape)} WAPE versus {pct(outcomes.baselineNetworkWape)} for Seasonal Naive on the {outcomes.networkHoldoutDays}-day terminal holdout.
          The Shah Alam headline forecast’s full-history outlook of {signed(outcomes.shahAlamPublishedChangePct, 2, '%')} is sensitive to fitted trend and training windows.</p>
        {outcomes.coldStart.map((row) => <p key={row.seriesId}>{targetShort[row.seriesId]} mean WAPE across tested horizons was {pct(row.baselineWape)} for Seasonal Naive
          and {pct(row.primaryDonorWape)} for the primary 50% donor transfer experiment.</p>)}
      </Note>
    </AnalysisGroup>
    <AnalysisGroup title="Analytical methods">
    {sections.map((section) => <Details key={section.title} title={section.title}>
      <ul className={s.textList}>{section.text.map((item) => <li key={item}>{item}</li>)}</ul>
    </Details>)}
    </AnalysisGroup>
  </>;
}
