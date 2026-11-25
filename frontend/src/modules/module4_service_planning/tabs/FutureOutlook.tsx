import { useState } from 'react';
import { dateRange, dateText, dayOptions, forecastScopes, getWindow, isFutureDate, modelLabel, num, pct, signed, targetColor, targetShort } from '../analytics';
import { Bars, Lines } from '../charts';
import type { ForecastScope, Horizon, WatchRow } from '../contracts';
import { useAsset } from '../dataClient';
import { AnalysisGroup, Badge, Details, EvidenceBadge, Headline, Kpi, Note, Panel, Segmented, TabHeading, Table } from '../ui';
import s from '../dashboard.module.css';

const reasons: Record<string, string> = {
  rolling_28d_wape: '28-day rolling error',
  rolling_28d_naive_deficit: 'underperformed Seasonal Naive',
  candidate_forecast_spread: 'model forecast spread',
};

function watchLabel(row: WatchRow) {
  if (row.material_change === 'within_threshold') return 'Within change threshold';
  return row.material_change === 'increase' ? 'Material increase' : 'Material decrease';
}

export default function FutureOutlook() {
  const data = useAsset('network');
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [scope, setScope] = useState<ForecastScope>('future');
  const network = getWindow(data, data.networkId, horizon, scope);
  const target = data.targets[data.networkId];
  const fullPoints = data.daily[data.networkId].slice(0, horizon);
  const chartPoints = fullPoints.filter(([date]) => scope === 'full' || isFutureDate(date, data.asOf));
  const serviceRows = data.components.flatMap((id) => {
    const row = getWindow(data, id, horizon, scope);
    return row ? [row] : [];
  }).sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity));
  const watch = data.watchlist.filter((row) => row.view === (scope === 'full' ? 'full_90_day' : 'future_only_after_as_of'));
  const shah = watch.find((row) => row.series_id === 'rail_lrt_shah_alam');
  const elapsed = fullPoints.filter(([date]) => !isFutureDate(date, data.asOf)).length;
  const watchRules = data.watchRules;
  const change = network?.change_pct ?? null;

  return <div className={s.tabBody}>
    <TabHeading title="Planning Outlook" detail={<>Forecasts for Rapid Rail headline service planning at the fixed reference date of {dateText(data.asOf)}.</>} />
    <Headline>
      <Kpi lead label="Forecast service-sum trips" value={num(network?.total)} badge={<EvidenceBadge kind="Model Forecast" />}
        note={<>{scope === 'full' ? 'Full cutoff window' : 'After reference date'} · {dateRange(network?.start ?? null, network?.end ?? null)}</>} />
      <Kpi label="Forecast average trips per day" value={num(network?.average)} note={`${num(network?.days)} forecast days`} />
      <Kpi label="Change vs weekday-matched baseline" value={signed(change, 2, '%')} tone={change == null ? undefined : change < 0 ? 'down' : 'up'}
        note={`${signed(network?.delta ?? null)} trips per day vs ${num(network?.baseline)}`} />
      <Kpi label="Modelled headline services" value={num(data.components.length)} note={`Data cutoff ${dateText(target.data_cutoff)}`} />
    </Headline>
    <Panel primary title="Published service-sum outlook" subtitle="Daily forecast trips across the six headline services." controls={<>
        <Segmented label="Forecast horizon from cutoff" value={horizon} options={dayOptions} onChange={setHorizon} />
        <Segmented label="Forecast view" value={scope} options={forecastScopes} onChange={setScope} />
      </>}>
      <Lines dates={chartPoints.map(([date]) => date)} label="Daily forecast for the published Rapid Rail service sum"
        traces={scope === 'full' ? [
          { name: 'Elapsed/reference-date projections', values: chartPoints.map(([date, value]) => !isFutureDate(date, data.asOf) ? value : null), dashed: true, color: '#777f92' },
          { name: 'Future projections', values: chartPoints.map(([date, value]) => isFutureDate(date, data.asOf) ? value : null), color: targetColor[data.networkId], area: true },
        ] : [{ name: 'Future projections', values: chartPoints.map(([, value]) => value), color: targetColor[data.networkId], area: true }]}
        markers={[{ date: data.asOf, name: 'Analysis date' }]} height={282} />
      <p className={s.muted}>
        {scope === 'full' ? `${elapsed} projections fall on or before the reference date and remain forecast values.` : `The first ${elapsed} cutoff-window days are elapsed or fall on the reference date and are excluded from this view.`}
      </p>
    </Panel>
    <AnalysisGroup title="Service comparison">
      <Panel heading="h4" title="Six headline services" subtitle="Forecast change against each service’s recent weekday-matched baseline.">
        <Bars data={serviceRows.map((row) => ({ name: targetShort[row.series_id], value: row.change_pct, color: targetColor[row.series_id] }))}
          label="Change in forecast daily demand" horizontal suffix="%" decimals={2} height={228} />
        {shah?.watch_uncertainty && <Note title="Shah Alam forecast stability" tone="warn">
          The Shah Alam headline result is sensitive to fitted trend and training window. Its 28-day rolling WAPE was {pct(shah.rolling_28d_wape_pct)},
          {num(shah.rolling_28d_deficit_vs_naive_pp, 2)} percentage points above Seasonal Naive. In the 90-day watchlist window ({dateRange(shah.forecast_start, shah.forecast_end)}),
          candidate forecasts span {pct(shah.candidate_mean_spread_pct_of_recent)} of the recent level.
        </Note>}
        <Table label="Headline forecast comparisons" columns={['Service', 'Forecast per day', 'Baseline per day', 'Change per day', 'Change', '90-day watchlist signal']}
          rows={serviceRows.map((row) => ({
            key: row.series_id,
            cells: [targetShort[row.series_id], num(row.average), num(row.baseline), signed(row.delta), signed(row.change_pct, 2, '%'),
              watch.find((item) => item.series_id === row.series_id)?.watch_uncertainty ? <Badge tone="warning">Elevated uncertainty</Badge> : 'See 90-day watchlist'],
          }))} />
      </Panel>
    </AnalysisGroup>
    <AnalysisGroup title="Monitoring and follow-up">
      <Panel heading="h4" title="Predictive demand watchlist" badge={<EvidenceBadge kind="Model Forecast" />}
        subtitle={`Published 90-day assessment · ${watch[0] ? dateRange(watch[0].forecast_start, watch[0].forecast_end) : 'Unavailable'}`}>
        <p className={s.muted}>Every horizon selection uses the saved 90-day watchlist. This view covers {scope === 'full' ? 'the full cutoff window' : 'dates after the reference date'}.</p>
        <Table label="Predictive demand watchlist" columns={['Service', 'Forecast per day', 'Change per day', 'Change', 'Materiality', 'Selected model', 'Uncertainty signals']}
          rows={watch.map((row) => ({ key: row.series_id, cells: [
            targetShort[row.series_id], num(row.forecast_mean_daily_trips), signed(row.signed_change_trips_per_day), signed(row.change_pct, 2, '%'),
            watchLabel(row), modelLabel(row.selected_model),
            row.watch_uncertainty ? row.uncertainty_reasons.split('|').map((key) => reasons[key] ?? key).join(', ') : 'No threshold crossed',
          ] }))} />
      </Panel>
      <Details title="Monitoring recommendations" summary="Use forecast error and measured demand to prioritise follow-up.">
        <ul className={s.textList}>
          <li>Compare new reported demand with the weekday-matched baseline and the Seasonal Naive forecast before acting on a material change.</li>
          <li>Review Shah Alam headline demand after new observations arrive. Track LRT3 station-origin demand separately because it measures a different target.</li>
          <li>Check dated service delivery and passenger counts with the operator before drawing conclusions about readiness.</li>
          <li>The saved watchlist flags absolute changes of {pct(watchRules.material_change_pct, 0)} or more. Uncertainty thresholds are {pct(watchRules.rolling_28d_wape_pct, 0)} rolling WAPE,
            a {num(watchRules.rolling_28d_naive_deficit_pp)} percentage-point gap to Seasonal Naive, or {pct(watchRules.candidate_mean_spread_pct, 0)} candidate spread.</li>
        </ul>
        <p>Evaluation covers near-term horizons through 28 days where enough data was available. Forecasts extending to 90 days support planning.</p>
      </Details>
    </AnalysisGroup>
  </div>;
}
