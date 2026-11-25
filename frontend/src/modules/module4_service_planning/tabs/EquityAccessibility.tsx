import { useState } from 'react';
import { dateRange, num, pct, sum, titleCase } from '../analytics';
import { Bars } from '../charts';
import type { District, DistrictCoverage, EquityData, Geography, Screen } from '../contracts';
import { equityDataUrl, useAsset } from '../dataClient';
import DistrictMap from '../DistrictMap';
import { cohortCaption, equityMetrics, metricScale, priorityClass, priorityClasses } from '../equityMetrics';
import { AnalysisGroup, Badge, Details, EvidenceBadge, Headline, Kpi, Note, Panel, Segmented, Select, TabHeading, Table } from '../ui';
import s from '../dashboard.module.css';

type Cohort = 'common' | 'latest';
const rules = [{ value: 'median_either', label: 'Median · either socioeconomic condition' },
  { value: 'median_both', label: 'Median · both socioeconomic conditions' },
  { value: 'outer_quartiles', label: 'Outer quartiles' }] as const;
type Rule = typeof rules[number]['value'];
const scenarioId = (cohort: Cohort, rule: Rule) => `${cohort === 'common' ? 'all_districts' : 'latest_survey_cohort'}_${rule}`;
const currency = (value: number | null, digits = 0) => value == null ? 'Unavailable' : `RM ${num(value, digits)}`;
const densityThreshold = new Intl.NumberFormat('en-MY', { maximumFractionDigits: 8 });

function DistrictDetail({ district: d, coverage, screen, selectedMetric }: {
  district: District; coverage: DistrictCoverage; screen: Screen; selectedMetric: { label: string; value: string; classification: string };
}) {
  const facts = [
    [`Population (${d.population_reference_year})`, num(d.total_population_residents)],
    [`Median monthly income (${screen.socioeconomic_reference_year})`, currency(screen.median_monthly_household_income_myr)],
    [`Absolute poverty (${screen.socioeconomic_reference_year})`, pct(screen.absolute_poverty_households_pct)],
    ['Physical stations', num(d.rapid_rail_physical_stations)],
    ['Stations per 100,000 residents', num(d.rapid_rail_stations_per_100k_residents, 2)],
    ['LRT3 stations', num(coverage.lrt3_stations)],
    ['Published network origins', num(d.observed_rapid_rail_station_origin_trips)],
    ['Average daily origins', num(d.average_daily_rapid_rail_station_origin_trips, 1)],
    ['Share of published network origins', pct(d.share_of_published_network_station_origin_trips_pct)],
    ['Origins per 1,000 residents (observation period)', num(d.rapid_rail_station_origin_trips_per_1k_residents_period, 1)],
    ['Daily origins per physical station', num(d.average_daily_rapid_rail_station_origin_trips_per_physical_station, 1)],
    ['Published LRT3 origins', num(d.observed_lrt3_station_origin_trips_step4)],
    ['LRT3 share of published district origins', pct(d.lrt3_share_of_observed_district_station_origin_trips_pct)],
  ];
  return <Panel heading="h4" title={d.district} subtitle={d.state} badge={<Badge tone={screen.priority_for_further_investigation ? 'warning' : 'neutral'}>{priorityClass(screen).label}</Badge>}>
    <p><strong>{selectedMetric.label}</strong> · {selectedMetric.value} · {selectedMetric.classification}</p>
    <dl className={s.facts}>{facts.map(([label, value]) => <div key={label} style={{ display: 'contents' }}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {d.rapid_rail_physical_stations === 0 && <Note title="Structural zero" tone="quiet">This district has zero mapped Rapid Rail physical stations and zero published origins within the study scope. Per-station ratios are unavailable.</Note>}
    {screen.screen_status === 'unavailable_socioeconomic_year' && <Note title="Survey-year comparison unavailable" tone="quiet">
      This unit is outside the {screen.socioeconomic_reference_year} socioeconomic cohort of {screen.comparison_cohort_size} districts.
      It remains visible on the map and in observed activity totals.
    </Note>}
  </Panel>;
}

function DistrictExplorer({ data, geography }: { data: EquityData; geography: Geography }) {
  const [cohort, setCohort] = useState<Cohort>('common');
  const [rule, setRule] = useState<Rule>('median_either');
  const [metricKey, setMetricKey] = useState('trips');
  const [selected, setSelected] = useState(data.districts.find((row) => data.coverage[row.district_id].lrt3_stations && row.district === 'Petaling')?.district_id ?? data.districts[0].district_id);
  const sample = (id: string) => data.screens.find((row) => row.scenario_id === id && row.screen_status === 'available');
  const cohorts = (['common', 'latest'] as const).map((value) => ({ value,
    label: cohortCaption(sample(scenarioId(value, rule)), value === 'common' ? 'Common survey cohort' : 'Latest survey cohort') }));
  const scenarioLabel = (id: string) => {
    const screen = sample(id);
    const label = rules.find((r) => id.endsWith(r.value))?.label ?? titleCase(id);
    return screen ? `${screen.socioeconomic_reference_year} · ${label}` : label;
  };
  const activeScenario = scenarioId(cohort, rule);
  const screens = Object.fromEntries(data.screens.filter((row) => row.scenario_id === activeScenario).map((row) => [row.district_id, row]));
  const activeScreen = Object.values(screens).find((row) => row.screen_status === 'available');
  const active = data.districts.find((row) => row.district_id === selected) ?? data.districts[0];
  const metrics = equityMetrics(data.observation.days);
  const metric = metrics.find((item) => item.value === metricKey);
  const read = (district: District) => metric?.read(district, data.coverage[district.district_id], screens[district.district_id]) ?? null;
  const scale = metric ? metricScale(metric, data.districts.map(read)) : null;
  const values = Object.fromEntries(data.districts.map((d) => {
    const value = read(d);
    const classification = scale ? scale.classify(value) : priorityClass(screens[d.district_id]);
    return [d.district_id, { label: metric?.label ?? 'Priority screening', value: metric ? metric.format(value) : classification.label,
      classification: classification.label, color: classification.color }];
  }));
  const thresholds = [...new Set(data.screens.map((row) => row.scenario_id))];
  const markers = scale?.legend ?? Object.values(priorityClasses);

  return <>
    <div className={s.mapLayout}>
      <Panel primary marker="B" title="District map and selected district" badge={<EvidenceBadge kind="Observed" />}
        subtitle="Eight administrative comparison units. Choose a district on the map or from the list.">
        <div className={s.controls}>
          <Segmented label="Socioeconomic cohort" value={cohort} options={cohorts} onChange={setCohort} />
          <Select label="Equity screening rule" value={rule} options={rules} onChange={setRule} />
          <Select label="District map metric" value={metricKey}
            options={[...metrics.map(({ value, label }) => ({ value, label })), { value: 'priority', label: 'Equity screening classification' }]} onChange={setMetricKey} />
          <Select label="Selected district" value={selected} options={data.districts.map((row) => ({ value: row.district_id, label: row.district }))} onChange={setSelected} />
        </div>
        <DistrictMap geography={geography} selected={selected} values={values} onSelect={setSelected} />
        <div className={s.legend} aria-label="District map legend">
          <strong>{metric?.label ?? 'Equity screening classification'}</strong>
          {markers.map((entry) => <span key={entry.label}><i style={{ background: entry.color }} />{entry.label}</span>)}
        </div>
        <p className={s.muted}>Published district indicators use OpenStreetMap boundaries and Rapid Rail GTFS stop points.
          The historical study used PLANMalaysia boundaries.{' '}
          <a href={equityDataUrl} download="equity.json">Download equity data and source notices</a>.
        </p>
      </Panel>
      <DistrictDetail district={active} coverage={data.coverage[active.district_id]} screen={screens[active.district_id]} selectedMetric={values[active.district_id]} />
    </div>
    <AnalysisGroup marker="C" title="Equity priority screening">
      <Panel heading="h4" title="Equity priority matrix" subtitle="Validated Step 4 rules compare relative household vulnerability with station density. Step 4B activity provides descriptive context.">
        {activeScreen && <Note title={activeScenario === data.primaryScenario ? 'Original Step 4 screening thresholds' : 'Selected sensitivity thresholds'}>
          Income at or below {currency(activeScreen.income_cutoff_myr, 2)} {activeScreen.vulnerability_rule === 'either' ? 'or' : 'and'} absolute poverty at or above {pct(activeScreen.poverty_cutoff_pct)}.
          Priority also requires at most {activeScreen.coverage_cutoff_stations_per_100k == null ? 'Unavailable' : densityThreshold.format(activeScreen.coverage_cutoff_stations_per_100k)} physical stations per 100,000 residents. Cohort size {num(activeScreen.comparison_cohort_size)}.
        </Note>}
        <Table label="District equity priority matrix" columns={['District', 'Median monthly income', 'Absolute poverty', 'Stations per 100,000', 'Low station density', 'Socioeconomic flag', 'Priority class']}
          rows={data.districts.map((d) => {
            const r = screens[d.district_id];
            const flag = (value: boolean | null) => value == null ? 'Unavailable' : value ? 'Yes' : 'No';
            return { key: d.district_id, selected: selected === d.district_id, cells: [
              <button type="button" className={s.inlineLink} onClick={() => setSelected(d.district_id)}>{d.district}</button>,
              currency(r.median_monthly_household_income_myr), pct(r.absolute_poverty_households_pct), num(r.stations_per_100k_residents, 2),
              flag(r.coverage_at_or_below_cutoff), flag(r.relative_vulnerability_flag), priorityClass(r).label,
            ] };
          })} />
      </Panel>
      <Details title="Threshold sensitivity across all six scenarios">
        <Table label="Equity threshold sensitivity" columns={['District', ...thresholds.map(scenarioLabel)]}
          rows={data.districts.map((d) => ({ key: d.district_id, selected: selected === d.district_id, cells: [
            d.district, ...thresholds.map((id) => {
              const r = data.screens.find((row) => row.scenario_id === id && row.district_id === d.district_id);
              return r ? priorityClass(r).label : 'Unavailable';
            }),
          ] }))} />
      </Details>
    </AnalysisGroup>
  </>;
}

function Activity({ data }: { data: EquityData }) {
  const districts = [...data.districts].sort((a, b) => (b.observed_rapid_rail_station_origin_trips ?? 0) - (a.observed_rapid_rail_station_origin_trips ?? 0));
  const corridor = districts.filter((d) => ['Petaling', 'Klang'].includes(d.district));
  const stations = [...data.stationContributions].sort((a, b) => b.station_origin_trips - a.station_origin_trips);
  const [stationFilter, setStationFilter] = useState('all');
  const shown = stations.filter((row) => stationFilter === 'all' || row.district_id === stationFilter);
  const stationDistrict = (id: string) => data.districts.find((d) => d.district_id === id)?.district ?? id;

  return <>
    <Panel marker="D" title="Published network district activity" badge={<EvidenceBadge kind="Observed" />}
      subtitle={`${dateRange(data.observation.start, data.observation.end)} · ${num(data.observation.days)} observed days.`}>
      <Bars label="Average daily published station origins by district" horizontal height={270}
        data={districts.map((row) => ({ name: row.district, value: row.average_daily_rapid_rail_station_origin_trips }))} />
      <Table label="District published activity and coverage" columns={['District', 'Population', 'Physical stations', 'LRT3 stations', 'Station origins', 'Daily origins', 'Network share', 'Origins per 1,000 residents', 'Daily origins per station', 'LRT3 share']}
        rows={districts.map((row) => ({ key: row.district_id, cells: [row.district, num(row.total_population_residents),
          num(row.rapid_rail_physical_stations), num(data.coverage[row.district_id].lrt3_stations), num(row.observed_rapid_rail_station_origin_trips),
          num(row.average_daily_rapid_rail_station_origin_trips, 1), pct(row.share_of_published_network_station_origin_trips_pct),
          num(row.rapid_rail_station_origin_trips_per_1k_residents_period, 1), num(row.average_daily_rapid_rail_station_origin_trips_per_physical_station, 1),
          pct(row.lrt3_share_of_observed_district_station_origin_trips_pct)] }))} />
    </Panel>
    <Panel marker="E" title="Klang and Petaling corridor comparison" badge={<EvidenceBadge kind="Observed" />}>
      <Table label="LRT3 district comparison" columns={['District', 'LRT3 stations', 'LRT3 station origins', 'Share of LRT3 origins', 'LRT3 share of district origins', 'Network station density']}
        rows={corridor.map((row) => ({ key: row.district_id, cells: [row.district, num(data.coverage[row.district_id].lrt3_stations), num(row.observed_lrt3_station_origin_trips_step4),
          pct(row.observed_lrt3_station_origin_trips_step4 == null ? null : row.observed_lrt3_station_origin_trips_step4 / data.lrt3Trips * 100),
          pct(row.lrt3_share_of_observed_district_station_origin_trips_pct), num(row.rapid_rail_stations_per_100k_residents, 2)] }))} />
    </Panel>
    <Panel marker="F" title="LRT3 station-origin concentration" badge={<EvidenceBadge kind="Observed" />}
      subtitle={`${num(shown.length)} stations account for ${pct(sum(shown.map((row) => row.station_origin_trips)) / data.lrt3Trips * 100)} of published LRT3 station origins in this selection.`}>
      <div className={s.controls}><Select label="Station concentration district" value={stationFilter} options={[
        { value: 'all', label: 'All LRT3 stations' }, ...corridor.map((row) => ({ value: row.district_id, label: row.district })),
      ]} onChange={setStationFilter} /></div>
      <Bars label="Published station-origin trips by LRT3 station" horizontal height={Math.max(230, shown.length * 22 + 60)}
        data={shown.map((row) => ({ name: row.station_name, value: row.station_origin_trips, color: '#007e92' }))} />
      <Details title="All stations in this selection">
        <Table label="LRT3 station-origin counts" columns={['Station', 'Code', 'District', 'Published station origins', 'Share of LRT3 origins']}
          rows={shown.map((row) => ({ key: row.station_code, cells: [row.station_name, row.station_code, stationDistrict(row.district_id), num(row.station_origin_trips), pct(row.line_share_pct)] }))} />
      </Details>
    </Panel>
  </>;
}

export default function EquityAccessibility() {
  const data = useAsset('equity');
  const geography = useAsset('geography');
  const codes = sum(data.districts.map((d) => d.mapped_published_origin_codes));
  return <div className={s.tabBody}>
    <TabHeading title="Equity & Accessibility" detail="Compare published rail origins, station coverage and socioeconomic screening by district." />
    <AnalysisGroup marker="A" title="Published demand and station coverage">
      <Headline>
        <Kpi lead label="Published network station origins" value={num(data.activityTotal)} badge={<EvidenceBadge kind="Observed" />}
          note={<>{dateRange(data.observation.start, data.observation.end)} · {num(data.observation.days)} observed days · {num(codes)} origin codes</>} />
        <Kpi label="Mapped physical stations" value={num(data.physicalStations)} note={`${num(data.districts.length)} administrative units · population ${data.populationYear}`} />
        <Kpi label="Published LRT3 station origins" value={num(data.lrt3Trips)} note={`${num(data.lrt3Stations)} corridor stations`} />
      </Headline>
    </AnalysisGroup>
    <Note title="Published OD coverage" tone="warn">
      <p>The source reconciles {num(data.activityTotal)} published station-origin trips across {num(codes)} origin codes, {num(data.physicalStations)} physical stations and {num(data.observation.days)} observation days.
        Putrajaya Line coverage includes {num(data.putrajayaOrigins)} published origin codes and {num(data.putrajayaDestinations)} destination codes.</p>
      <p>Source-internal reconciliation leaves underlying journey capture unverified. Resident travel behaviour, congestion, walking accessibility and unmet demand require separate evidence.</p>
    </Note>
    <DistrictExplorer data={data} geography={geography} />
    <Activity data={data} />
    <Note title={data.policy.name}>
      The policy sets a {pct(data.policy.target_percent, 0)} public transport modal share target for {data.policy.geographical_scope} by {data.policy.target_year}.
      District rail-origin counts cannot establish achieved modal share. <a href={data.policy.official_faq} target="_blank" rel="noreferrer">Official RMK13 policy context</a>.
    </Note>
    <Details title="Geographical scope, station mapping and limitations">
      <p>{data.scope}</p><p>{data.physicalDeduplication}</p>
      <ul className={s.textList}>{data.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
    </Details>
  </div>;
}
