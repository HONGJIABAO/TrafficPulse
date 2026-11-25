import { useState } from 'react';
import type { EChartsOption } from 'echarts';
import { dateRange, dateText, dayTypes, holidayLabels, num, peakWindow, pct, periodLabel, scenarios, signed, supplyLabel, targetShort } from '../analytics';
import { Chart, Lines, axisLine } from '../charts';
import type { DayType, Direction, Period, Scenario, ServiceData } from '../contracts';
import { useAsset } from '../dataClient';
import { Details, Empty, EvidenceBadge, Headline, Kpi, Note, Panel, Segmented, Select, TabHeading, Table } from '../ui';
import s from '../dashboard.module.css';

const lrt3Route = 'SA';
const proxyNames: Record<string, string> = { network: 'KTM Network-wide', port_klang_west: 'KTM Port Klang West' };
const resolutions = [{ value: 'hourly', label: 'Hourly' }, { value: 'peak_period', label: 'AM and PM peaks' }] as const;
type Resolution = typeof resolutions[number]['value'];
const clock = (value: string | null) => value?.slice(0, 5) ?? 'Unavailable';
const frequency = (value: number | null | undefined) => num(value, value != null && !Number.isInteger(value) ? 2 : 0);
const dayLabel = (value: DayType) => dayTypes.find((day) => day.value === value)?.label ?? value;

type ScheduleSelection = { day: DayType; direction: Direction };
type RouteSelection = ScheduleSelection & { routeId: string };
const defaultSchedule: ScheduleSelection = { day: 'weekday', direction: 'both' };

function directions(data: ServiceData, route: string, day: DayType) {
  return data.periods.filter((row) => row.route_id === route && row.day_type === day && row.period === 'all_day')
    .sort((a, b) => b.direction_id.localeCompare(a.direction_id)).map((row) => ({
      value: row.direction_id, label: row.direction_id === 'both' ? 'Both directions' : row.direction_label,
    }));
}

function ServicePeriods({ rows }: { rows: Period[] }) {
  return <Table label="Scheduled service by operating period" columns={['Period', 'Reference hours', 'Terminal departures', 'Departures per hour', 'Effective headway']}
    rows={rows.map((row) => ({ key: row.period, cells: [periodLabel[row.period], `${clock(row.period_start)}–${clock(row.period_end_exclusive)}`,
      frequency(row.reference_departures), num(row.departures_per_hour, 2),
      row.direction_id === 'both' ? 'Select one direction' : row.effective_headway_minutes == null ? 'Unavailable' : `${num(row.effective_headway_minutes, 1)} min`,
    ] }))} />;
}

function RouteExplorer({ data, selection, onChange }: {
  data: ServiceData; selection: RouteSelection; onChange: (selection: RouteSelection) => void;
}) {
  const { routeId, day, direction } = selection;
  const route = data.routes.find((row) => row.route_id === routeId);
  const hours = data.hourly.filter((row) => row.route_id === routeId && row.day_type === day && row.direction_id === direction)
    .sort((a, b) => a.service_hour - b.service_hour);
  const periods = data.periods.filter((row) => row.route_id === routeId && row.day_type === day && row.direction_id === direction);
  const allDay = periods.find((row) => row.period === 'all_day');
  const otherDays = data.periods.filter((row) => row.route_id === routeId && row.direction_id === direction &&
    row.period === 'all_day' && row.day_type !== day);

  return <Panel primary marker="A" title="GTFS scheduled service explorer" badge={<EvidenceBadge kind="Scheduled Reference" />}
    subtitle={`${route?.route_name ?? 'Route unavailable'} · ${dayLabel(day)} · ${allDay?.direction_label ?? 'Direction unavailable'} · terminal departures`}>
    <div className={s.controls}>
      <Select label="GTFS route" value={routeId} options={data.routes.map((row) => ({ value: row.route_id, label: row.is_rail ? row.route_name : 'Sunway BRT' }))}
        onChange={(value) => onChange({ ...selection, routeId: value, direction: 'both' })} />
      <Segmented label="Scheduled day type" value={day} options={dayTypes} onChange={(value) => onChange({ ...selection, day: value })} />
      <Select label="Scheduled direction" value={direction} options={directions(data, routeId, day)}
        onChange={(value) => onChange({ ...selection, direction: value })} />
    </div>
    <Headline>
      <Kpi lead label="Frequency-implied terminal departures" value={frequency(allDay?.reference_departures)} note="Per reference day" />
      <Kpi label="Terminal service span" value={allDay?.reference_service_start ? `${clock(allDay.reference_service_start)}–${clock(allDay.reference_service_end)}` : 'Unavailable'}
        note={allDay?.terminal_service_span_hours == null ? 'Reference span unavailable' : `${num(allDay.terminal_service_span_hours, 2)} hours`} />
      <Kpi label="Full-day effective headway" value={direction === 'both' || allDay?.effective_headway_minutes == null ? 'Unavailable' : `${num(allDay.effective_headway_minutes, 1)} min`}
        note={direction === 'both' ? 'Select one direction' : '60 minutes ÷ departures per hour'} />
    </Headline>
    {otherDays.length > 0 && <p className={s.muted}><strong>Terminal departures on other reference days</strong>{' '}
      {otherDays.map((row) => `${dayLabel(row.day_type)} ${frequency(row.reference_departures)}`).join(' · ')}
    </p>}
    {hours.length ? <Lines dates={hours.map((row) => `${String(row.service_hour).padStart(2, '0')}:00`)} label="Hourly frequency-implied terminal departures"
      traces={[{ name: 'Terminal departures', values: hours.map((row) => row.reference_departures), color: '#285bca', area: true }]} height={185} dateLabels={false} decimals={2} />
      : <Empty>No hourly reference departures are available for this selection.</Empty>}
    <Details title="Scheduled service by operating period" summary="Reference hours, terminal departures and direction-specific headways.">
      <ServicePeriods rows={periods} />
      <p className={s.muted}>Hourly counts represent frequency-implied departures from route termini. Fractional values come from prorating frequency intervals.</p>
    </Details>
    {route && !route.is_rail && <p className={s.muted}>{route.mapping_notes} This schedule is separate from Rapid Rail intensity and equity indicators.</p>}
    <p className={s.muted}>Reference timetable dated {dateText(data.referenceDate)}. The archived GTFS calendar covers {dateRange(data.calendarStart, data.calendarEnd)}.
      Later supply uses a held-reference timetable assumption.
      Verified or tentative holidays without a validated timetable and dates with unknown calendar coverage retain unavailable dated supply.
    </p>
  </Panel>;
}

function Supply({ data, selection, onChange }: {
  data: ServiceData; selection: ScheduleSelection; onChange: (selection: ScheduleSelection) => void;
}) {
  const { day, direction } = selection;
  const rows = data.nominal.filter((row) => row.day_type === day && row.direction_id === direction);
  const allDay = rows.find((row) => row.period === 'all_day');
  return <Panel marker="B" title="LRT3 nominal capacity" badge={<EvidenceBadge kind="Scheduled Reference" />}
    subtitle={`${data.routes.find((row) => row.route_id === lrt3Route)?.route_name ?? 'Shah Alam Line'} · ${dayLabel(day)} · ${allDay?.direction_label ?? 'Direction unavailable'} · nominal passenger places`}>
    <div className={s.controls}>
      <Segmented label="Nominal supply day type" value={day} options={dayTypes} onChange={(value) => onChange({ ...selection, day: value })} />
      <Select label="Nominal supply direction" value={direction} options={directions(data, lrt3Route, day)}
        onChange={(value) => onChange({ ...selection, direction: value })} />
    </div>
    <Kpi lead label="Nominal places per reference day" value={num(allDay?.nominal_places)}
      note={`${frequency(allDay?.departures)} reference terminal departures × ${num(data.capacity.passenger_places)} design places per three-car train (including ${num(data.capacity.source_reported_seats)} seats)`} />
    <Table label="Direction-specific LRT3 nominal supply" columns={['Period', 'Reference terminal departures', 'Nominal places']}
      rows={rows.map((row) => ({ key: row.period, cells: [periodLabel[row.period], frequency(row.departures), num(row.nominal_places)] }))} />
    <p className={s.muted}>{data.capacity.limitations} <a href={data.capacity.source_url} target="_blank" rel="noreferrer">Documented LRV capacity</a>.</p>
  </Panel>;
}

function PeakSensitivity({ data }: { data: ServiceData }) {
  const [scenario, setScenario] = useState<Scenario>('base');
  const [scope, setScope] = useState(data.profileDimensions.scopes[0]);
  const [year, setYear] = useState('combined');
  const [day, setDay] = useState<DayType>('weekday');
  const [date, setDate] = useState('all');
  const [resolution, setResolution] = useState<Resolution>('peak_period');
  const years = data.profileDimensions.periods.filter((period) => data.profiles[`${scope}|${period}|${day}`]);
  const options = data.calendar.filter((row) => row.day_type === day);
  const { rows, days, supplied, held } = peakWindow(data, { scope, year, day, scenario, date, resolution });
  const title = (row: typeof rows[number]) => resolution === 'hourly' ? clock(row.start) : periodLabel[row.window];
  const chartOption = (field: 'matchedDemand' | 'nominal', name: string, color: string): EChartsOption => ({
    grid: { left: 64, right: 18, top: 22, bottom: 66 },
    tooltip: { trigger: 'axis', confine: true, valueFormatter: (value) => typeof value === 'number' ? num(value) : 'Unavailable' },
    xAxis: { type: 'category', data: rows.map(title), axisLabel: { hideOverlap: true } },
    yAxis: { type: 'value', splitLine: { lineStyle: { color: axisLine } } },
    series: [{ type: 'bar', name, data: rows.map((row) => row[field]), barMaxWidth: 40, itemStyle: { color } }],
  });

  return <Panel marker="D" title="Interactive peak demand sensitivity" subtitle="KTM hourly shape applied to each selected LRT3 daily planning scenario.">
    <div className={s.badges}><EvidenceBadge kind="Proxy Estimate" /><EvidenceBadge kind="Planning Assumption" /><EvidenceBadge kind="Scheduled Reference" /></div>
    <div className={s.controls}>
      <Segmented label="Peak demand scenario" value={scenario} options={scenarios} onChange={setScenario} />
      <Select label="KTM proxy profile" value={scope} options={data.profileDimensions.scopes.map((value) => ({ value, label: proxyNames[value] ?? value }))}
        onChange={(value) => { setScope(value); if (!data.profiles[`${value}|${year}|${day}`]) setYear('combined'); }} />
      <Select label="Proxy profile year" value={year} options={years.map((value) => ({ value, label: value === 'combined' ? 'All observed years pooled' : value }))} onChange={setYear} />
      <Segmented label="Peak sensitivity day type" value={day} options={dayTypes} onChange={(value) => {
        setDay(value); setDate('all'); if (!data.profiles[`${scope}|${year}|${value}`]) setYear('combined');
      }} />
      <Segmented label="Peak sensitivity view" value={resolution} options={resolutions} onChange={setResolution} />
      <Select label="Peak forecast date" value={date} options={[{ value: 'all', label: `All ${dayLabel(day).toLowerCase()} forecast dates` },
        ...options.map((row) => ({ value: row.date, label: `${dateText(row.date)} · ${supplyLabel(row.supply_status)}` }))]} onChange={setDate} />
    </div>
    {date !== 'all' && days[0] && <p className={s.muted}>
      {holidayLabels[days[0].calendar_status] ?? 'Holiday calendar unknown'} · {supplyLabel(days[0].supply_status)}
    </p>}
    <p className={s.muted}><strong>{scenarios.find((item) => item.value === scenario)?.label} scenario · {dayLabel(day)}</strong>{' '}
      · {num(days.length)} all-demand dates · {num(supplied)} matched supply-eligible dates · {num(held)} held-reference dates within the matched set
    </p>
    {!supplied && <p className={s.muted}><strong>Dated supply unavailable.</strong>
      {rows.some((row) => row.allDemand != null) && ' The table shows all-date proxy demand.'}</p>}
    <p className={s.muted}>Demand estimates station-origin trips using a KTM profile. Supply counts nominal passenger places at terminal departures.
      Assessing occupancy or crowding requires observed service and passenger counts by direction and segment.</p>
    {resolution === 'hourly' && rows.length > 0 && supplied > 0 && <div className={s.grid2}>
      <Panel heading="h4" title="Proxy station-origin demand" subtitle="Average trips per matched forecast date" badge={<EvidenceBadge kind="Proxy Estimate" />}>
        <Chart label="Matched-date LRT3 proxy station-origin trips by time window" option={chartOption('matchedDemand', 'Proxy station-origin trips', '#007e92')} height={260} />
      </Panel>
      <Panel heading="h4" title="Nominal terminal supply" subtitle="Passenger places per matched reference date" badge={<EvidenceBadge kind="Scheduled Reference" />}>
        <Chart label="Matched-date nominal terminal places by time window" option={chartOption('nominal', 'Nominal terminal places', '#687bb2')} height={260} />
      </Panel>
    </div>}
    <Table label="Peak sensitivity by time window" columns={['Window', 'Hours', 'Proxy profile share', 'All-date proxy origin trips / day', 'Matched-date proxy origin trips / day', 'Matched-date nominal terminal places / day']}
      rows={rows.map((row) => ({ key: row.window, cells: [title(row), `${clock(row.start)}–${clock(row.end)}`, pct(row.share * 100), num(row.allDemand), num(row.matchedDemand),
        row.nominal == null ? <EvidenceBadge kind="Unavailable" /> : num(row.nominal)] }))} />
  </Panel>;
}

export default function ServiceReadiness() {
  const data = useAsset('service');
  const [schedule, setSchedule] = useState<RouteSelection>({ ...defaultSchedule, routeId: lrt3Route });
  const [capacity, setCapacity] = useState(defaultSchedule);
  const sameReference = schedule.routeId === lrt3Route && schedule.day === capacity.day && schedule.direction === capacity.direction;
  return <div className={s.tabBody}>
    <TabHeading title="Service Readiness & Capacity" detail="Compare scheduled terminal frequency, nominal LRT3 capacity and KTM-informed demand sensitivity." />
    <p className={s.selectionContext} role="status">
      {sameReference
        ? 'Both panels use the same Shah Alam Line timetable, day type and direction. Each panel has its own filters.'
        : 'The panels show different selections. Match the Shah Alam Line, day type and direction to compare the timetable with its nominal capacity.'}
    </p>
    <div className={s.pairedPanels}>
      <RouteExplorer data={data} selection={schedule} onChange={setSchedule} />
      <Supply data={data} selection={capacity} onChange={setCapacity} />
    </div>
    <Panel marker="C" title="Network service intensity" badge={<EvidenceBadge kind="Model Forecast" />}
      subtitle="Published headline trips per reference terminal departure, pairing the same ordinary dates and denominator with the recent baseline.">
      <Table label="Network service intensity" columns={['Headline service', 'GTFS routes', 'Forecast trips / departure', 'Baseline trips / departure', 'Change', 'Comparable dates', 'Held dates', 'Coverage']}
        rows={data.intensity.map((row) => ({ key: row.series_id, cells: [targetShort[row.series_id], row.route_ids.split('|').join(' / '),
          num(row.forecast_published_trips_per_reference_departure, 1), num(row.recent_published_trips_per_same_reference_departure, 1), signed(row.change_in_trips_per_departure_pct, 2, '%'),
          `${row.intensity_covered_days} / ${row.calendar_comparable_days}`, num(row.intensity_dates_held_beyond_validity),
          row.forecast_published_trips_per_reference_departure == null ? <EvidenceBadge kind="Unavailable" /> : 'Available',
        ] }))} />
      {data.intensity.filter((row) => row.intensity_status === 'unavailable_shared_trunk').map((row) =>
        <Note key={row.series_id} title="Combined Ampang / Sri Petaling intensity unavailable" tone="warn">{row.intensity_reason}</Note>)}
    </Panel>
    <PeakSensitivity data={data} />
    <Details marker="E" title="Service evidence and operator monitoring" summary="Schedule assumptions, source definitions and operator follow-up.">
      <ul className={s.textList}>
        <li>Compare scheduled terminal departures with delivered trips and headway logs by direction, especially on holidays and after the GTFS calendar expires.</li>
        <li>Verify actual formations and passenger counts by time, direction and segment before assessing occupancy.</li>
        <li>Replace the KTM proxy with measured LRT3 hourly entries as operator data becomes available.</li>
      </ul>
      <p>Forecast dates with unavailable holiday or uncovered-calendar supply include {data.holidayDatesWithoutSupply.map(dateText).join(', ')}.</p>
      {Object.entries(data.definitions).map(([key, text]) => <p key={key}>{text}</p>)}
    </Details>
  </div>;
}
