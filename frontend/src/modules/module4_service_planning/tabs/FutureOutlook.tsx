import { useState } from 'react';
import { dateRange, dateText, dayOptions, forecastScopes, getWindow, isFutureDate, modelLabel, num, pct, signed, targetShort } from '../analytics';
import type { ForecastScope, Horizon, NetworkData, WatchRow } from '../contracts';
import { Badge, Details, EvidenceBadge, Headline, Kpi, Panel, Segmented, Table } from '../ui';
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

export default function PlanningWatchlist({ data }: { data: NetworkData }) {
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [scope, setScope] = useState<ForecastScope>('future');
  const network = getWindow(data, data.networkId, horizon, scope);
  const target = data.targets[data.networkId];
  const serviceRows = data.components.flatMap((id) => {
    const row = getWindow(data, id, horizon, scope);
    return row ? [row] : [];
  }).sort((a, b) => (b.change_pct ?? -Infinity) - (a.change_pct ?? -Infinity));
  const watch = data.watchlist.filter((row) => row.view === (scope === 'full' ? 'full_90_day' : 'future_only_after_as_of'));
  const flagged = watch.filter((row) => row.material_change !== 'within_threshold' || row.watch_uncertainty);
  const shah = watch.find((row) => row.series_id === 'rail_lrt_shah_alam');
  const elapsed = data.daily[data.networkId].slice(0, horizon).filter(([date]) => !isFutureDate(date, data.asOf)).length;
  const watchRules = data.watchRules;
  const change = network?.change_pct ?? null;

  return <Panel icon="activity" accent="purple" title="Predictive demand watchlist" badge={<EvidenceBadge kind="Model Forecast" />}
      subtitle={`Published 90-day assessment · ${watch[0] ? dateRange(watch[0].forecast_start, watch[0].forecast_end) : 'Unavailable'}`}
      controls={<Segmented label="Forecast view" value={scope} options={forecastScopes} onChange={setScope} />}>
      <p><strong>Monitoring signals.</strong>{' '}
        {flagged.length ? flagged.map((row) => {
          const signals = [
            row.material_change !== 'within_threshold' && `${watchLabel(row).toLowerCase()} (${signed(row.change_pct, 2, '%')} versus baseline)`,
            row.watch_uncertainty && 'elevated forecast uncertainty',
          ].filter(Boolean);
          return `${targetShort[row.series_id]} · ${signals.join(' and ')}`;
        }).join('. ') + '.' : watch.length ? 'No services cross the saved monitoring thresholds in this window.' : 'Monitoring evidence is unavailable for this window.'}
      </p>
      {shah?.watch_uncertainty && <p className={s.muted}><strong>Shah Alam forecast stability.</strong>{' '}
        The Shah Alam headline result is sensitive to fitted trend and training window. Its 28-day rolling WAPE was {pct(shah.rolling_28d_wape_pct)},
        {num(shah.rolling_28d_deficit_vs_naive_pp, 2)} percentage points above Seasonal Naive. In the 90-day watchlist window ({dateRange(shah.forecast_start, shah.forecast_end)}),
        candidate forecasts span {pct(shah.candidate_mean_spread_pct_of_recent)} of the recent level.
      </p>}
      <p className={s.muted}>Confirm changes with new reported demand and delivered service before making operational decisions. The assessment stays fixed at 90 leads as the supporting forecast horizon changes.</p>
      <Details title="Watchlist figures and flag reasons" summary="Daily forecasts, changes, selected models and uncertainty signals by service.">
        <Table label="Predictive demand watchlist" columns={['Service', 'Forecast per day', 'Change per day', 'Change', 'Materiality', 'Selected model', 'Uncertainty signals']}
          rows={watch.map((row) => ({ key: row.series_id, cells: [
            targetShort[row.series_id], num(row.forecast_mean_daily_trips), signed(row.signed_change_trips_per_day), signed(row.change_pct, 2, '%'),
            watchLabel(row), modelLabel(row.selected_model),
            row.watch_uncertainty ? row.uncertainty_reasons.split('|').map((key) => reasons[key] ?? key).join(', ') : 'No threshold crossed',
          ] }))} />
      </Details>
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
      <Details title="Headline forecast comparisons" summary="Service-sum totals and six-service changes against weekday-matched baselines.">
        <div className={s.controls}>
          <Segmented label="Forecast horizon from cutoff" value={horizon} options={dayOptions} onChange={setHorizon} />
        </div>
        <Headline>
          <Kpi lead icon="trend-up" accent="blue" countUp label="Forecast service-sum trips" value={num(network?.total)} badge={<EvidenceBadge kind="Model Forecast" />}
            note={<>{scope === 'full' ? 'Full cutoff window' : 'After reference date'} · {dateRange(network?.start ?? null, network?.end ?? null)}</>} />
          <Kpi icon="activity" accent="cyan" countUp label="Forecast average trips per day" value={num(network?.average)} note={`${num(network?.days)} forecast days`} />
          <Kpi icon="sliders-horizontal" accent="orange" countUp label="Change vs weekday-matched baseline" value={signed(change, 2, '%')}
            note={`${signed(network?.delta ?? null)} trips per day vs ${num(network?.baseline)}`} />
          <Kpi icon="transit-rail" accent="purple" countUp label="Modelled headline services" value={num(data.components.length)} note={`Data cutoff ${dateText(target.data_cutoff)}`} />
        </Headline>
        <p className={s.muted}>
          Reference date {dateText(data.asOf)}. {scope === 'full'
            ? `${elapsed} days on or before that date retain their forecast status.`
            : `This scope starts after that date and excludes ${elapsed} cutoff-window days.`}
          {' '}The active Ridge models apply the verified holiday adjustment. Tentative and unknown dates keep their evidence status.
        </p>
        <Panel heading="h4" icon="shield-check" accent="teal" title="Six headline services" subtitle="Forecast change against each service’s recent weekday-matched baseline.">
          <Table label="Headline forecast comparisons" columns={['Service', 'Forecast per day', 'Baseline per day', 'Change per day', 'Change', '90-day watchlist signal']}
            rows={serviceRows.map((row) => ({
              key: row.series_id,
              cells: [targetShort[row.series_id], num(row.average), num(row.baseline), signed(row.delta), signed(row.change_pct, 2, '%'),
                watch.find((item) => item.series_id === row.series_id)?.watch_uncertainty ? <Badge tone="warning">Elevated uncertainty</Badge> : 'See 90-day watchlist'],
            }))} />
        </Panel>
      </Details>
    </Panel>;
}
