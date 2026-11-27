import { useState } from 'react';
import type { EChartsOption } from 'echarts';
import { ablationOverview, calendarStatus, dateRange, dateText, evaluationOptions, findDateWindow, holidayLabels, num, pct, signed, targetOptions, targetShort, unitLabel } from '../analytics';
import { Bars, Chart } from '../charts';
import type { EvaluationHorizon, HistoryPoint, HolidayCalendar, PatternRow } from '../contracts';
import { useAsset } from '../dataClient';
import { Details, Empty, EvidenceBadge, Note, Panel, Segmented, Select, TabHeading, Table } from '../ui';
import s from '../dashboard.module.css';

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const featureLabels = { A: 'Weekly features and lags', B: 'Plus trend and annual seasonality', C: 'Plus holiday and coverage features' };

type CalendarProps = { year: string; rows: HistoryPoint[]; label: string; holidays: HolidayCalendar };

function Calendar({ year, rows, label, holidays }: CalendarProps) {
  const observed = rows.flatMap(([date, value]) => value == null ? [] : [[date, value] as [string, number]]);
  const max = Math.max(1, ...observed.map(([, value]) => value));
  const option: EChartsOption = {
    tooltip: { confine: true, formatter: (params) => {
      const row = Array.isArray(params) ? params[0] : params;
      const [date, value] = row.value as [string, number];
      return `${dateText(date)} · ${num(value)} observed trips<br/>${holidayLabels[calendarStatus(holidays, date)]}`;
    } },
    visualMap: { min: 0, max, dimension: 1, orient: 'horizontal', left: 'center', bottom: 5,
      calculable: false, inRange: { color: ['#E8F0FF', '#60A5FA', '#0066FF'] }, text: ['More trips', 'Zero observed'] },
    calendar: { range: year, left: 32, right: 14, top: 32, bottom: 48, cellSize: ['auto', 16],
      dayLabel: { firstDay: 1, nameMap: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] },
      monthLabel: { nameMap: months }, yearLabel: { show: false },
      itemStyle: { color: '#F1F4F9', borderWidth: 1, borderColor: '#fff' },
      splitLine: { show: true, lineStyle: { color: '#CBD5E1', width: 1 } } },
    series: [{ type: 'heatmap', coordinateSystem: 'calendar', data: observed }],
  };
  return <div className={s.chartScroll} tabIndex={0} role="region" aria-label="Calendar heatmap scroll area"><div style={{ minWidth: 700 }}>
    <Chart label={label} option={option} height={205} />
  </div></div>;
}

function DailyCalendarTable({ year, rows, label, holidays }: CalendarProps) {
  const observations = new Map(rows.map(([date, value]) => [date, value]));
  const dates = findDateWindow(`${year}-01-01`, `${year}-12-31`);
  return <Table label={`${label} daily calendar data, ${year}`} columns={['Date', 'Observed trips', 'Holiday status']}
    rows={dates.map((date) => {
      const value = observations.get(date);
      return { key: date, cells: [dateText(date), value == null ? 'No published observation' : num(value),
        holidayLabels[calendarStatus(holidays, date)]] };
    })} />;
}

function PatternTable({ label, rows }: { label: string; rows: PatternRow[] }) {
  return <Table label={label} columns={['Group', 'Observation period', 'Observed days', 'Average trips per day']}
    rows={rows.map((row) => ({ key: row.group, cells: [row.group, dateRange(row.period_start, row.period_end), num(row.observed_days), num(row.mean_daily_trips)] }))} />;
}

function ObservedPatterns({ rows, period, label, holidays, holidaySource }: {
  rows: PatternRow[]; period: HistoryPoint[]; label: string; holidays: HolidayCalendar; holidaySource: string;
}) {
  const years = [...new Set(period.map(([date]) => date.slice(0, 4)))].reverse();
  const [year, setYear] = useState(years[0]);
  const week = rows.filter((row) => row.pattern === 'day_of_week').sort((a, b) => weekdays.indexOf(a.group) - weekdays.indexOf(b.group));
  const dayType = rows.filter((row) => row.pattern === 'day_type');
  const monthly = rows.filter((row) => row.pattern === 'calendar_month' && row.group.startsWith(year)).sort((a, b) => a.group.localeCompare(b.group));
  const latestMonth = monthly.at(-1);
  const seasonal = rows.filter((row) => row.pattern === 'month_of_year_recent_730_days').sort((a, b) => a.group.localeCompare(b.group));
  const holiday = rows.filter((row) => row.pattern === 'holiday_vs_comparable_nonholiday');
  const recent = rows.filter((row) => row.pattern === 'recent_vs_prior_28d');
  const yearHistory = period.filter(([date]) => date.startsWith(year));
  const complete = (row: PatternRow) => row.expected_days != null && row.observed_days === row.expected_days;

  return <>
    <Panel primary marker="A" title="Weekday and weekend demand" badge={<EvidenceBadge kind="Observed" />}
      subtitle="Average trips in the validated recent observation window.">
      <div className={s.weekPatterns}>
        <div className={s.stack}>
          <h4>Day-of-week profile</h4>
          <Bars label="Average trips by day of week" data={week.map((row) => ({ name: row.group.slice(0, 3), value: row.mean_daily_trips }))} height={155} />
          <Details title="Day-of-week sample counts"><PatternTable label="Day-of-week observations" rows={week} /></Details>
        </div>
        <div className={s.stack}>
          <h4>Weekday and weekend averages</h4>
          <PatternTable label="Weekday and weekend observations" rows={dayType} />
        </div>
      </div>
    </Panel>
    <div className={s.calendarLayout}>
      <Panel marker="B" title="Monthly demand and observation coverage" badge={<EvidenceBadge kind="Observed" />}
        controls={<Select label="Observation year" value={year} options={years.map((value) => ({ value, label: value }))} onChange={setYear} />}>
        {latestMonth && <p className={s.muted}>
          <strong>{months[Number(latestMonth.group.slice(5)) - 1]} {year}</strong> · {num(latestMonth.mean_daily_trips)} trips per observed day
          {' · '}{num(latestMonth.observed_days)} of {num(latestMonth.expected_days)} calendar days observed
        </p>}
        {monthly.length ? <>
          <Bars label="Monthly average observed demand" data={monthly.map((row) => ({
            name: `${months[Number(row.group.slice(5)) - 1]}${complete(row) ? '' : ' (partial)'}`,
            value: row.mean_daily_trips, color: complete(row) ? '#0066FF' : '#FF5A00',
          }))} height={176} />
          <Details title="Monthly reporting figures">
            <Table label="Monthly demand and reporting coverage" columns={['Month', 'Observed days', 'Calendar days', 'Coverage', 'Observed trips', 'Average per observed day']}
              rows={monthly.map((row) => ({ key: row.group, cells: [row.group, num(row.observed_days), num(row.expected_days),
                complete(row) ? 'Complete' : 'Incomplete', num(row.observed_total_trips), num(row.mean_daily_trips)] }))} />
          </Details>
        </> : <Empty>No monthly observations were published for this year.</Empty>}
      </Panel>
      <Panel marker="C" title="Calendar heatmap" badge={<EvidenceBadge kind="Observed" />}
        subtitle={`${label} · daily observed trips in ${year}. Point to a cell or open the daily calendar data to inspect a date.`}>
        <Calendar year={year} rows={yearHistory} label={`${label} calendar heatmap, ${year}`} holidays={holidays} />
        <div className={s.legend}><span><i style={{ background: '#F1F4F9' }} /> No published observation or outside the target window</span><span><i style={{ background: '#E8F0FF' }} /> Observed zero</span></div>
        <Details title="Daily calendar data" summary="Trip counts and archived holiday status for the selected target and year.">
          <DailyCalendarTable year={year} rows={yearHistory} label={label} holidays={holidays} />
        </Details>
      </Panel>
    </div>
    <Panel marker="D" title="Verified holiday comparison" badge={<EvidenceBadge kind="Observed" />}
      subtitle="Dates verified in the archived calendar are matched to known non-holidays on the same weekday within 28 days.">
      <Table label="Observed holiday comparisons" columns={['Comparison dates', 'Matched holiday days', 'Control-date uses', 'Holiday mean', 'Non-holiday mean', 'Difference']}
        rows={holiday.map((row) => ({ key: row.group, cells: [dateRange(row.period_start, row.period_end), num(row.observed_days), num(row.matched_control_date_uses),
          num(row.mean_daily_trips), num(row.reference_mean_daily_trips), signed(row.difference_pct, 2, '%')] }))} />
      <p className={s.muted}>Tentative holidays and dates with unknown calendar status are excluded from both groups.
        Each holiday is compared with one average of its matched controls. Control dates can be reused across holidays. Small samples and incomplete calendar coverage limit this comparison.</p>
      <p className={s.muted}>Extracted holiday calendars for {holidays.regions.join(' and ')} cover {holidays.coveredYears.join(' and ')}.
        {' '}<a href={holidaySource} target="_blank" rel="noreferrer">Archived official calendar source</a></p>
    </Panel>
    <Details marker="E" title="Additional temporal patterns" summary="Month-of-year profiles and recent versus prior 28-day demand.">
      <PatternTable label="Month-of-year profiles" rows={seasonal.map((row) => ({ ...row, group: months[Number(row.group) - 1] }))} />
      <Table label="Recent and previous 28-day demand" columns={['Comparison', 'Recent dates', 'Recent days', 'Previous days', 'Recent mean', 'Previous mean', 'Change']}
        rows={recent.map((row) => ({ key: row.group, cells: [row.group, dateRange(row.period_start, row.period_end), num(row.observed_days),
          num(row.reference_observations), num(row.mean_daily_trips), num(row.reference_mean_daily_trips), signed(row.difference_pct, 2, '%')] }))} />
    </Details>
  </>;
}

export default function DemandDrivers() {
  const network = useAsset('network');
  const history = useAsset('history');
  const patterns = useAsset('patterns');
  const research = useAsset('research');
  const [target, setTarget] = useState(network.networkId);
  const [evaluation, setEvaluation] = useState<EvaluationHorizon>(28);
  const tests = research.ablation.filter((row) => row.series_id === target && row.horizon_days === evaluation);
  const overview = ablationOverview(research.ablation, network.components, evaluation);
  const calendar = patterns.holidayCalendar;

  return <div className={s.tabBody}>
    <TabHeading title="Temporal Service Planning" detail={`Observed demand by day and month and verified holiday comparisons · ${unitLabel(network.targets[target].unit)}`}>
      <Select label="Demand pattern target" value={target} options={targetOptions(network)} onChange={setTarget} />
    </TabHeading>
    <ObservedPatterns key={target} label={targetShort[target]} period={history.series[target]}
      rows={patterns.patterns.filter((row) => row.series_id === target)} holidays={calendar} holidaySource={patterns.holidaySource} />
    <Details title="Forecast feature ablation" summary="Matched rolling-origin Ridge comparisons for weekly, seasonal and calendar feature sets.">
      <div className={s.controls}><Segmented label="Ablation evaluation horizon" value={evaluation} options={evaluationOptions} onChange={setEvaluation} /></div>
      {overview.targets.length > 0 && <>
        <Table label="Mature-service ablation overview" columns={['Configuration', `Mean WAPE through ${evaluation} days`]}
          rows={overview.rows.map((row) => ({ key: row.variant, cells: [featureLabels[row.variant], pct(row.wape)] }))} />
        <p className={s.muted}>Unweighted mean of {overview.targets.length} complete service evaluations ({overview.targets.map((id) => targetShort[id]).join(', ')}).</p>
      </>}
      {tests.length ? <Table label="Feature ablation results" columns={['Configuration', 'Origins / folds', 'Scored pairs', 'WAPE', 'MAE', 'RMSE', 'MAPE', 'WAPE gain vs previous', 'Known holiday status in training']}
        rows={tests.map((row) => ({ key: row.variant, cells: [featureLabels[row.variant], num(row.folds), num(row.scored_predictions), pct(row.wape_pct),
          num(row.mae), num(row.rmse), pct(row.mape_pct), row.variant === 'A' ? 'Reference configuration' : signed(row.wape_gain_pp_vs_previous, 2, ' pp'),
          pct(row.train_rows_with_known_holiday_status_pct)] }))} /> : <Empty>A matched feature experiment is unavailable for this target. Select a service target to inspect the available tests.</Empty>}
      <Note title="Research interpretation" tone="quiet">The timing patterns describe published trips. Ablation measures the predictive contribution of feature sets under the saved evaluation design.
        Configuration C adds a holiday flag and a coverage indicator together. Tentative-only dates and dates outside the archive have unknown status in this experiment.
        Causal effects of holidays, coverage or external economic conditions were unmeasured.</Note>
    </Details>
  </div>;
}
