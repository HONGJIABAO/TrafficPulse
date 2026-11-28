import { useState } from 'react';
import { dateRange, dateText, dayOptions, findDateWindow, getWindow, isFutureDate, modelLabel, num, pct, precedingDate, scenarios, signed, sum, targetColor, targetShort, titleCase } from '../analytics';
import { Lines } from '../charts';
import type { Horizon, HistoryData, NetworkData, Scenario } from '../contracts';
import { researchDataUrl, useAsset } from '../dataClient';
import { DateInput, EvidenceBadge, Headline, Kpi, Panel, Segmented, TabHeading } from '../ui';
import s from '../dashboard.module.css';
import PlanningWatchlist from './FutureOutlook';

function ForecastExplorer({ network, history }: { network: NetworkData; history: HistoryData }) {
  const id = network.odId;
  const target = network.targets[id];
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [scenario, setScenario] = useState<Scenario>('base');
  const initialStart = precedingDate(target.last_observed, 90);
  const [from, setFrom] = useState(initialStart < target.first_observed ? target.first_observed : initialStart);
  const [to, setTo] = useState(target.last_observed);
  const scenarioPoints = network.scenarios.slice(0, horizon);
  const firstDate = scenarioPoints[0]?.[0] ?? null;
  const lastDate = scenarioPoints.at(-1)?.[0] ?? null;
  const forecast = new Map(scenarioPoints.map(([date, , low, base, high]) => [date, { low, base, high }[scenario]]));
  const observed = new Map(history.series[id].filter(([date]) => date <= to).map(([date, value]) => [date, value]));
  const historicalDates = findDateWindow(from, to);
  const dates = findDateWindow(from, lastDate ?? '');
  const total = sum([...forecast.values()]);
  const label = `${titleCase(scenario)} planning scenario`;
  const forecastEvidence = scenario === 'base' ? 'Model Forecast' : 'Planning Assumption';

  return <Panel primary icon="trend-up" accent="blue" title="LRT3 station-origin planning scenarios"
    badge={<div className={s.badges}><EvidenceBadge kind="Observed" /><EvidenceBadge kind={forecastEvidence} /></div>}
    subtitle={`Selected model ${modelLabel(target.model_id)} · cutoff ${dateText(target.data_cutoff)} · reference date ${dateText(network.asOf)}`}>
    <div className={s.controls}>
      <Segmented label="LRT3 planning scenario" value={scenario} options={scenarios} onChange={setScenario} />
      <Segmented label="Forecast horizon" value={horizon} options={dayOptions} onChange={setHorizon} />
      <DateInput label="History start" value={from} min={target.first_observed} max={to} onChange={setFrom} />
      <DateInput label="History end" value={to} min={from} max={target.last_observed} onChange={setTo} />
    </div>
    <div className={s.stack}>
      <p><strong>{horizon}-day {titleCase(scenario)} scenario.</strong>{' '}
        {scenario === 'base'
          ? `${signed(getWindow(network, id, horizon, 'full')?.change_pct ?? null, 2, '%')} versus the weekday-matched baseline.`
          : `${signed(total - sum(scenarioPoints.map((row) => row[3])))} station-origin trips versus Base over the same dates.`}
      </p>
      <p className={s.muted}>Base repeats a weekly profile. A growth trend has yet to be demonstrated. Low and High are planning offsets of {signed(network.scenarioAssumptions.low_offset_at_day_90 * 100, 0, '%')} and {signed(network.scenarioAssumptions.high_offset_at_day_90 * 100, 0, '%')} at day 90, phased linearly from the cutoff. Calibrated prediction intervals are unavailable.</p>
    </div>
    <div className={s.forecastLayout}>
      <Lines label={`${targetShort[id]} historical and forecast trips`} dates={dates}
        traces={[
          { name: 'Observed', values: dates.map((date) => observed.get(date) ?? null), color: '#00C48C' },
          { name: 'Elapsed/reference-date forecast', values: dates.map((date) => !isFutureDate(date, network.asOf) ? forecast.get(date) ?? null : null), color: '#94A3B8', dashed: true },
          { name: label, values: dates.map((date) => isFutureDate(date, network.asOf) ? forecast.get(date) ?? null : null), color: targetColor[id], area: true },
        ]}
        markers={[{ date: target.data_cutoff, name: 'Data cutoff' }, { date: network.asOf, name: 'Analysis date' }]} height={268} />
      <Headline>
        <Kpi lead icon="chart-bar" accent="blue" countUp label="Cumulative forecast trips" value={num(total)} badge={<EvidenceBadge kind={forecastEvidence} />}
          note={`LRT3 station-origin trips · ${dateRange(firstDate, lastDate)}`} />
        <Kpi icon="activity" accent="cyan" countUp label="Average forecast trips per day" value={num(forecast.size ? total / forecast.size : null)} note={label} />
        <Kpi icon="calendar-clock" accent="purple" countUp label="Historical selection" value={num(historicalDates.filter((date) => observed.get(date) != null).length)} note="Days with observed demand" />
      </Headline>
    </div>
  </Panel>;
}

function ForecastReliability() {
  const { uncertainty } = useAsset('research');
  const { outcomes } = useAsset('methodology');
  const [lower, upper] = uncertainty.nominal_residual_quantiles;

  return <Panel icon="shield-check" accent="teal" title="Forecast reliability">
    <ul className={s.textList}>
      <li><strong>Six-service headline forecast.</strong> On the already inspected {outcomes.networkHoldoutDays}-day terminal holdout, the ensemble scored {pct(outcomes.selectedNetworkWape)} weighted absolute percentage error (WAPE). Seasonal Naive scored {pct(outcomes.baselineNetworkWape)} and had the lower error. This retrospective comparison does not establish 90-day accuracy.</li>
      <li><strong>Cold-start donor transfer.</strong> Donor profiles did not consistently improve on Seasonal Naive. Across the tested horizons, mean WAPE for the primary 50% transfer was higher on both targets. {outcomes.coldStart.map((row) => `${targetShort[row.seriesId]} had ${pct(row.primaryDonorWape)} versus ${pct(row.baselineWape)} for Seasonal Naive.`).join(' ')}</li>
      <li><strong>Shah Alam headline forecast.</strong> The full 90-lead change of {signed(outcomes.shahAlamPublishedChangePct, 2, '%')} against its recent weekday-matched baseline is sensitive to the fitted trend and training window.</li>
      <li><strong>LRT3 station-origin uncertainty.</strong> The nominal {pct((upper - lower) * 100, 0)} residual band contained {num(uncertainty.holdout_inside)} of {num(uncertainty.holdout_points)} terminal observations. {uncertainty.limitations} Low, Base and High support planning. Low and High use assumed offsets, and this audit provides no calibrated prediction interval.</li>
    </ul>
    <p><a href={researchDataUrl} download="research.json">Download detailed forecast research (JSON)</a></p>
  </Panel>;
}

export default function DemandForecast() {
  const network = useAsset('network');
  const history = useAsset('history');

  return <div className={s.tabBody}>
    <TabHeading title="Demand Scenario Planning" detail="Explore LRT3 station-origin scenarios and monitor published Rapid Rail headline demand." />
    <ForecastExplorer history={history} network={network} />
    <PlanningWatchlist data={network} />
    <ForecastReliability />
  </div>;
}
