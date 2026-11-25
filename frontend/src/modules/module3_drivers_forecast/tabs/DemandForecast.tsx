import { useState } from 'react';
import { dateRange, dateText, dayOptions, evaluationOptions, findDateWindow, getWindow, isFutureDate, modelLabel, num, pct, policyLabels, precedingDate, scenarios, signed, sum, targetColor, targetOptions, targetShort, titleCase, unitLabel } from '../analytics';
import { Lines } from '../charts';
import type { EvaluationHorizon, Horizon, HistoryData, Metric, NetworkData, ResearchData, Scenario, TargetId } from '../contracts';
import { useAsset } from '../dataClient';
import { Badge, DateInput, Details, Empty, EvidenceBadge, Kpi, Note, Panel, Segmented, Select, TabHeading, Table } from '../ui';
import s from '../dashboard.module.css';

const phaseLabels: Record<string, string> = {
  rolling_validation: 'Rolling-origin validation', terminal_holdout: 'Terminal holdout', intervention_matched: 'Intervention-matched validation',
  network_component_validation: 'Network component validation', network_component_holdout: 'Network component holdout',
  network_component_holdout_selected: 'Selected component holdout', forecast_sensitivity: '90-day forecast sensitivity',
  recent_window_matched: 'Matched recent-window evaluation', network_common_origins: 'Shared rolling origins',
  retrospective_terminal: 'Retrospective terminal holdout',
};
const coldLabels: Record<string, string> = {
  seasonal_naive: 'Seasonal Naive', step2_selected: 'Published selected model', target_profile: 'Target weekday profile',
  transfer_25: '25% donor profile', transfer_50: '50% donor profile', transfer_75: '75% donor profile',
};

function ForecastExplorer({ network, history, id }: { network: NetworkData; history: HistoryData; id: TargetId }) {
  const target = network.targets[id];
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [scenario, setScenario] = useState<Scenario>('base');
  const initialStart = precedingDate(target.last_observed, 90);
  const [from, setFrom] = useState(initialStart < target.first_observed ? target.first_observed : initialStart);
  const [to, setTo] = useState(target.last_observed);
  const isOd = id === network.odId;
  const points = network.daily[id].slice(0, horizon);
  const forecast = isOd
    ? new Map(network.scenarios.slice(0, horizon).map(([date, , low, base, high]) => [date, { low, base, high }[scenario]]))
    : new Map(points.map(([date, value]) => [date, value]));
  const observed = new Map(history.series[id].filter(([date]) => date <= to).map(([date, value]) => [date, value]));
  const historicalDates = findDateWindow(from, to);
  const dates = findDateWindow(from, points.at(-1)?.[0] ?? '');
  const total = sum([...forecast.values()]);
  const label = isOd ? `${titleCase(scenario)} planning scenario` : 'Published model forecast';
  const odFullChange = getWindow(network, network.odId, 90, 'full')?.change_pct ?? null;

  return <>
    <Panel title="Historical observations and forecast" badge={<EvidenceBadge kind="Model Forecast" />}
      subtitle={`${unitLabel(target.unit)} · selected model ${modelLabel(target.model_id)} · cutoff ${dateText(target.data_cutoff)}`}>
      <div className={s.controls}>
        <DateInput label="History start" value={from} min={target.first_observed} max={to} onChange={setFrom} />
        <DateInput label="History end" value={to} min={from} max={target.last_observed} onChange={setTo} />
        <Segmented label="Forecast horizon" value={horizon} options={dayOptions} onChange={setHorizon} />
        {isOd && <Segmented label="LRT3 planning scenario" value={scenario} options={scenarios} onChange={setScenario} />}
      </div>
      <Lines label={`${targetShort[id]} historical and forecast trips`} dates={dates}
        traces={[
          { name: 'Observed', values: dates.map((date) => observed.get(date) ?? null), color: '#237a64' },
          { name: 'Elapsed/reference-date forecast', values: dates.map((date) => !isFutureDate(date, network.asOf) ? forecast.get(date) ?? null : null), color: '#777f92', dashed: true },
          { name: label, values: dates.map((date) => isFutureDate(date, network.asOf) ? forecast.get(date) ?? null : null), color: targetColor[id], area: true },
        ]}
        markers={[{ date: target.data_cutoff, name: 'Data cutoff' }, { date: network.asOf, name: 'Analysis date' }]} />
    </Panel>
    <div className={s.kpiGrid}>
      <Kpi label="Cumulative forecast trips" value={num(total)} note={dateRange(points[0]?.[0] ?? null, points.at(-1)?.[0] ?? null)} />
      <Kpi label="Average forecast trips per day" value={num(forecast.size ? total / forecast.size : null)} note={label} />
      <Kpi label="Historical selection" value={num(historicalDates.filter((date) => observed.get(date) != null).length)} note="Days with observed demand" />
    </div>
    {isOd && <Note title="LRT3 station-origin interpretation">
      <p>The published Base 90-day outlook is {signed(odFullChange, 2, '%')} versus the weekday-matched baseline. It reflects a repeated weekly profile. A growth trend has yet to be demonstrated.</p>
      <p>Low and High are planning assumptions of {signed(network.scenarioAssumptions.low_offset_at_day_90 * 100, 0, '%')} and {signed(network.scenarioAssumptions.high_offset_at_day_90 * 100, 0, '%')} at day 90, phased linearly from the cutoff. Statistical confidence intervals are unavailable.</p>
    </Note>}
  </>;
}

function MetricTable({ rows, selected, label }: { rows: Metric[]; selected?: NetworkData['targets'][TargetId]; label: string }) {
  return <Table label={label} columns={['Model', 'Training window', 'Horizon (days)', 'Origins / folds', 'Scored pairs', 'Unique target dates', 'WAPE', 'MAE', 'RMSE', 'MAPE', 'Validation period']}
    rows={rows.map((row, i) => ({
      key: i, selected: row.model_id === selected?.model_id && row.training_policy === selected?.training_policy,
      cells: [modelLabel(row.model_id), policyLabels[row.training_policy] ?? titleCase(row.training_policy), row.horizon_days, num(row.folds),
        num(row.scored_predictions), num(row.unique_target_dates), pct(row.wape_pct), num(row.mae), num(row.rmse), pct(row.mape_pct), dateRange(row.validation_start, row.validation_end)],
    }))} />;
}

function ModelComparison({ data, network, id }: { data: ResearchData; network: NetworkData; id: TargetId }) {
  const [horizon, setHorizon] = useState<EvaluationHorizon>(28);
  const rows = data.metrics.filter((row) => row.series_id === id);
  const target = network.targets[id];
  const additional = rows.filter((row) => !['rolling_validation', 'terminal_holdout'].includes(row.phase));
  const terminal = rows.filter((row) => row.phase === 'terminal_holdout');
  const ensemble = terminal.find((row) => row.horizon_days === 14 && row.model_id === 'bottom_up_selected_components');
  const naive = terminal.find((row) => row.horizon_days === 14 && row.model_id === 'bottom_up_seasonal_naive_7');
  return <Panel title="Backtesting and model selection" subtitle={`Retained model · ${modelLabel(target.model_id)} · ${policyLabels[target.training_policy] ?? titleCase(target.training_policy)}`}>
    <div className={s.controls}><Segmented label="Evaluation horizon" value={horizon} options={evaluationOptions} onChange={setHorizon} /></div>
    <MetricTable rows={rows.filter((row) => row.phase === 'rolling_validation' && row.horizon_days === horizon)} selected={target} label="Rolling-origin model comparison" />
    <p className={s.muted}>WAPE is weighted absolute percentage error. MAE and RMSE are expressed in trips. MAPE excludes zero observations. Direct accuracy evidence extends through the available evaluation horizons.</p>
    <p className={s.muted}>A scored pair is one forecast from a given origin and its matching observation. Rolling folds can overlap and reuse target dates. Terminal holdout rows show their own evaluation period and horizon.</p>
    <Details title="Terminal holdout results">
      <MetricTable rows={terminal} selected={target} label="Terminal holdout results" />
      {ensemble && naive && <p>The active network ensemble scored {pct(ensemble.wape_pct)} WAPE versus {pct(naive.wape_pct)}
        {' '}for Seasonal Naive on the 14-day terminal window. This is a retrospective replay of an already inspected period.</p>}
    </Details>
    {additional.length > 0 && <Details title="Additional validation and component results">
      {[...new Set(additional.map((row) => row.phase))].map((phase) => <div className={s.stack} key={phase}>
        <h4>{phaseLabels[phase] ?? titleCase(phase)}</h4>
        <MetricTable rows={additional.filter((row) => row.phase === phase)} label={phaseLabels[phase] ?? phase} />
      </div>)}
    </Details>}
  </Panel>;
}

function ColdStart({ research, network }: { research: ResearchData; network: NetworkData }) {
  const [series, setSeries] = useState<TargetId>(network.odId);
  const [horizon, setHorizon] = useState<EvaluationHorizon>(28);
  const cases = [...new Set(research.cold.map((row) => row.series_id))].map((value) => ({ value, label: targetShort[value] }));
  const coldRows = research.cold.filter((row) => row.series_id === series && row.horizon_days === horizon);
  const folds = research.coldFolds.filter((row) => row.series_id === series && row.horizon_days === horizon);

  return <>
    <Note title="Cold-start transfer finding" tone="warn">Transferring established-rail donor profiles did not produce a consistent improvement over Seasonal Naive for these short histories. The published forecasting method was retained.</Note>
    <div className={s.controls}>
      <Select label="Cold-start target" value={series} options={cases} onChange={setSeries} />
      <Segmented label="Cold-start evaluation horizon" value={horizon} options={evaluationOptions} onChange={setHorizon} />
    </div>
    <Table label="Cold-start donor profile experiments" columns={['Experiment', 'Source model', 'Donor weight', 'Folds', 'WAPE', 'MAE', 'RMSE', 'MAPE', 'WAPE gain vs Naive']}
      rows={coldRows.map((row) => ({ key: row.arm, cells: [coldLabels[row.arm], modelLabel(row.source_model_id), pct(row.donor_weight * 100, 0), num(row.folds),
        pct(row.wape_pct), num(row.mae), num(row.rmse), pct(row.mape_pct), signed(row.wape_gain_pp_vs_seasonal_naive, 2, ' pp')] }))} />
    <Details title="Individual rolling origins">
      <Table label="Cold-start fold results" columns={['Forecast origin', 'Experiment', 'Scored pairs', 'WAPE', 'MAE', 'RMSE', 'MAPE']}
        rows={folds.map((row) => ({ key: `${row.origin}-${row.arm}`, cells: [dateText(row.origin), coldLabels[row.arm], num(row.scored_predictions),
          pct(row.wape_pct), num(row.mae), num(row.rmse), pct(row.mape_pct)] }))} />
    </Details>
  </>;
}

function StabilityExplorer({ research, network, id }: { research: ResearchData; network: NetworkData; id: TargetId }) {
  const rows = research.stability.filter((row) => row.series_id === id);
  const alternatives = Object.entries(research.alternatives).filter(([key]) => key.startsWith(`${id}|`));
  const [phase, setPhase] = useState(rows.some((row) => row.phase === 'forecast_sensitivity') ? 'forecast_sensitivity' : rows[0]?.phase ?? '');
  const [alternative, setAlternative] = useState(alternatives[0]?.[0] ?? '');
  const published = network.daily[id];
  const window = findDateWindow(published[0][0], published.at(-1)?.[0] ?? '');
  const altLabel = (key: string) => {
    const [, variant, model] = key.split('|');
    return `${policyLabels[variant] ?? titleCase(variant)} · ${modelLabel(model)}`;
  };
  const selected = new Map(research.alternatives[alternative] ?? []);
  const actual = new Map(published.map(([date, value]) => [date, value]));
  const phases = [...new Set(rows.map((row) => row.phase))].map((value) => ({ value, label: phaseLabels[value] ?? titleCase(value) }));

  return <>
    {id === 'rail_lrt_shah_alam' && <Note title="Shah Alam headline sensitivity" tone="warn">
      The published full-history 90-day outlook is {signed(getWindow(network, id, 90, 'full')?.change_pct ?? null, 2, '%')}. The fitted trend and choice of training window materially affect the projected decline.
      The {dateText(research.experimentContext.paidServiceBoundary)} paid-service boundary is a modelling sensitivity.
      The headline comparison had {research.experimentContext.matchedInterventionFolds} matched rolling origins
      against a minimum of {research.experimentContext.minimumInterventionFolds}. {research.experimentContext.postInterventionSelected
        ? 'The archived evaluation selected the post-boundary policy.' : 'The archived evaluation retained the full-history policy.'}
    </Note>}
    {alternatives.length > 0 && <>
      <Select label="Alternative forecast" value={alternative} options={alternatives.map(([value]) => ({ value, label: altLabel(value) }))} onChange={setAlternative} />
      <Lines label="Published and alternative daily forecasts" dates={window} traces={[
        { name: 'Published forecast', values: window.map((date) => actual.get(date) ?? null), color: targetColor[id] },
        { name: 'Alternative forecast', values: window.map((date) => selected.get(date) ?? null), color: '#b45325', dashed: true },
      ]} height={245} />
    </>}
    {phases.length > 0 ? <>
      <Select label="Stability experiment" value={phase} options={phases} onChange={setPhase} />
      <Table label="Forecast stability results" columns={['Approach', 'Model', 'Window / lead', 'Folds', 'Mean forecast', 'Total forecast', 'Change vs recent', 'WAPE', 'MAE', 'RMSE', 'MAPE', 'Holt level gap / day', 'Damped trend / day', 'Seasonal mix / day']}
        rows={rows.filter((row) => row.phase === phase).map((row, index) => ({ key: index, cells: [
          policyLabels[row.variant] ?? titleCase(row.variant), modelLabel(row.model_id),
          row.train_start && row.train_end ? dateRange(row.train_start, row.train_end) : `${row.horizon_days} days`,
          num(row.folds), num(row.forecast_mean_trips), num(row.forecast_total_trips), signed(row.change_vs_recent_pct, 2, '%'),
          pct(row.wape_pct), num(row.mae), num(row.rmse), pct(row.mape_pct), num(row.holt_level_gap_per_day, 1),
          num(row.holt_mean_damped_trend_per_day, 1), num(row.holt_seasonal_mix_per_day, 1),
        ] }))} />
    </> : <Empty>Stability experiments are unavailable for this target.</Empty>}
  </>;
}

function UncertaintyAudit({ data }: { data: ResearchData['uncertainty'] }) {
  return <>
    <p>For the LRT3 origin model, the nominal {pct((data.nominal_residual_quantiles[1] - data.nominal_residual_quantiles[0]) * 100, 0)} residual band covered
      {' '}{num(data.holdout_inside)} of {num(data.holdout_points)} terminal observations ({pct(data.holdout_coverage_pct)}).</p>
    <Table label="Empirical residual-band audit" columns={['Lead days', 'Residuals', 'Distinct dates', 'Lower residual', 'Upper residual', 'Holdout points', 'Inside band', 'Coverage']}
      rows={data.bands.map((row) => ({ key: row.lead_start, cells: [`${row.lead_start}–${row.lead_end}`, num(row.selection_residuals),
        num(row.distinct_residual_dates), num(row.lower_error_quantile_trips), num(row.upper_error_quantile_trips), num(row.holdout_points), num(row.inside), pct(row.coverage_pct)] }))} />
    <p>{data.limitations}</p>
  </>;
}

export default function DemandForecast() {
  const network = useAsset('network');
  const history = useAsset('history');
  const research = useAsset('research');
  const [id, setId] = useState(network.networkId);
  const shah = research.stability.find((row) => row.series_id === id && row.phase === 'forecast_sensitivity' &&
    row.variant === 'full_eligible_history' && row.model_id === 'holt_winters_additive_damped');
  return <div className={s.tabBody}>
    <TabHeading title="Demand Forecast" detail="Explore observed series, published forecasts and the evidence behind model selection." />
    <div className={s.controls}>
      <Select label="Forecast target" value={id} options={targetOptions(network)} onChange={setId} />
      <Badge>{unitLabel(network.targets[id].unit)}</Badge>
    </div>
    {id === 'rail_lrt_shah_alam' && <Note title="Shah Alam forecast stability" tone="warn">
      The full 90-day headline outlook is {signed(shah?.change_vs_recent_pct ?? null, 2, '%')} versus the weekday-matched baseline. The fitted trend and training window materially affect the decline.
    </Note>}
    <ForecastExplorer key={id} id={id} history={history} network={network} />
    {(id === network.networkId || network.targets[id].model_id === 'calendar_lag_ridge') && <Note title="Verified holiday calendar">
      Active Ridge forecasts and affected comparisons use the verified-holiday adjustment with the original model families and training windows.
      Tentative and unknown dates keep their evidence status. Historical calendar release vintages are unavailable.
    </Note>}
    <ModelComparison data={research} network={network} id={id} />
    <Details title="Cold-start donor experiments"><ColdStart research={research} network={network} /></Details>
    <Details title="Forecast stability and alternatives" summary="Published forecasts and alternative training-window results.">
      <StabilityExplorer key={id} id={id} network={network} research={research} />
    </Details>
    <Details title="Direct versus bottom-up network comparison">
      <p>The experiment shares {research.experimentContext.matchedNetworkOrigins} rolling origins. The direct model uses the
        aligned network history of {research.experimentContext.commonNetworkHistoryDays} days. Established bottom-up components can use longer training histories.
        The published network projection uses the selected component forecasts.</p>
      {research.experimentContext.reusedNetworkHoldout && <p>The strategy comparison reuses the already inspected terminal holdout as retrospective evidence under the active calendar policy.</p>}
      <StabilityExplorer id={network.networkId} network={network} research={research} />
    </Details>
    <Details title="Empirical uncertainty audit"><UncertaintyAudit data={research.uncertainty} /></Details>
  </div>;
}
