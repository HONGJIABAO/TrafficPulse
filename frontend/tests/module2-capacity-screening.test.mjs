import test from 'node:test';
import assert from 'node:assert/strict';
import summaryData from '../src/data/module2_capacity_screening/capacity_screening_summary.json' with { type: 'json' };
import hourlyData from '../src/data/module2_capacity_screening/capacity_hourly_profiles.json' with { type: 'json' };
import coverageData from '../src/data/module2_capacity_screening/capacity_coverage.json' with { type: 'json' };
import {
  buildDisplayRows,
  classifyStatus,
  computeKpiSummary,
  evaluateSegmentMetrics,
  generateDynamicDirectives,
  getSliceMetrics,
  serializeRowsToCsv,
  sortDisplayRows,
} from '../src/modules/module2_od_peak_hours/capacity_screening/capacityScreeningUtils.ts';

const defaultFilters = {
  network: 'all',
  dayProfile: 'weekday',
  period: 'aug18_nov26_all',
  capacityMode: 'official_2023_nominal',
  statMode: 'max_date',
  searchQuery: '',
  statusFilter: 'all',
  includeUnavailable: false,
};

test('Summary, Hourly Profiles & Coverage bundles have expected structure across all 15 slices', () => {
  assert.equal(summaryData.stations.length, 80);
  assert.equal(summaryData.segments.length, 156);
  assert.ok(summaryData.unavailable_stations.length > 200);
  assert.equal(coverageData.feasibility_matrix.length, 6);
  assert.equal(summaryData.metadata.gtfs_window_start, '2026-08-18');
  assert.equal(summaryData.metadata.gtfs_window_end, '2026-11-26');

  // Verify 2026-11-09 holiday exclusion day counts: 69 verified working weekdays, 100 KV matched days, 101 Utara days
  assert.equal(summaryData.metadata.slice_day_counts_by_net.ktm_komuter_kv['aug18_nov26_all|all'], 100);
  assert.equal(summaryData.metadata.slice_day_counts_by_net.ktm_komuter_kv['aug18_nov26_all|weekday'], 69);
  assert.equal(summaryData.metadata.slice_day_counts_by_net.ktm_komuter_utara['aug18_nov26_all|all'], 101);
  assert.equal(summaryData.metadata.slice_day_counts_by_net.ktm_komuter_utara['aug18_nov26_all|weekday'], 69);

  // Verify ALL 156 segments x 5 periods x 3 dayProfiles = 2,340 hourly profiles exist with valid schedules
  assert.ok(Array.isArray(hourlyData.sched_catalog) && hourlyData.sched_catalog.length > 0);
  const periods = ['aug18_nov26_all', '2026-08', '2026-09', '2026-10', '2026-11'];
  const dayProfiles = ['all', 'weekday', 'weekend'];

  for (const seg of summaryData.segments) {
    for (const period of periods) {
      for (const dp of dayProfiles) {
        const key = `${seg.segment_id}|${period}|${dp}`;
        const p = hourlyData.profiles[key];
        assert.ok(p, `Missing profile ${key}`);
        assert.equal(p.mean_d.length, 24);
        assert.equal(p.cap_nom_mean.length, 24);
        assert.equal(p.p90_d.length, 24);
        assert.equal(p.max_d.length, 24);
        if (p.max_sched_idx !== null) {
          assert.ok(hourlyData.sched_catalog[p.max_sched_idx], `Invalid max_sched_idx on ${key}`);
        }
        if (p.p90_sched_idx !== null) {
          assert.ok(hourlyData.sched_catalog[p.p90_sched_idx], `Invalid p90_sched_idx on ${key}`);
        }
      }
    }
  }
});

test('M2-01 Regression: Kajang -> Kajang 2 max_date uses exact single-date schedule with zero false exceedance bars', () => {
  const kajang2 = summaryData.segments.find((s) => s.segment_id === 'ktm_komuter_kv:20400->20402');
  assert.ok(kajang2);
  const slice = getSliceMetrics(kajang2, 'aug18_nov26_all', 'all');
  const p = hourlyData.profiles['ktm_komuter_kv:20400->20402|aug18_nov26_all|all'];
  assert.ok(slice && p && p.max_sched_idx !== null);

  const [singleDayCapNom] = hourlyData.sched_catalog[p.max_sched_idx];
  const deficitHours = [];
  for (let h = 0; h < 24; h += 1) {
    if (singleDayCapNom[h] > 0 && p.max_d[h] > singleDayCapNom[h]) {
      deficitHours.push(h);
    }
  }
  // Exact single-date schedule shows deficit strictly on the actual peak hour(s) (no 07:00/11:00/14:00 blended-mean artifact)
  assert.deepEqual(deficitHours, [p.max_hr]);
  assert.equal(p.max_d[p.max_hr], slice.max_peak_d);
  assert.equal(singleDayCapNom[p.max_hr], slice.max_peak_s_nom);

  // Verify every monthly profile also preserves exact max_d vs single-day cap parity at peak hour
  for (const period of ['2026-08', '2026-09', '2026-10', '2026-11']) {
    const mp = hourlyData.profiles[`ktm_komuter_kv:20400->20402|${period}|weekday`];
    const ms = getSliceMetrics(kajang2, period, 'weekday');
    assert.ok(mp && ms && mp.max_sched_idx !== null);
    assert.equal(mp.max_d[mp.max_hr], ms.max_peak_d);
  }
});

test('M2-02 Regression: Coherent P90 metrics strictly conserve station mass and never leak st_max_* values', () => {
  for (const seg of summaryData.segments) {
    for (const period of ['aug18_nov26_all', '2026-10']) {
      for (const dp of ['weekday', 'all']) {
        const slice = getSliceMetrics(seg, period, dp);
        const evNom = evaluateSegmentMetrics(seg, slice, 'p90', 'official_2023_nominal');
        const ev80 = evaluateSegmentMetrics(seg, slice, 'p90', 'planning_sensitivity_80pct');
        assert.ok(slice);

        if (slice.p90_peak_s_nom > 0) {
          assert.equal(evNom.peakDate, slice.p90_peak_date);
          assert.equal(evNom.peakHour, slice.p90_peak_hr);
          assert.equal(evNom.demandValue, slice.p90_peak_d);
          assert.equal(evNom.scheduledCapacity, slice.p90_peak_s_nom);
          const expLrNom = Math.round((slice.p90_peak_d / slice.p90_peak_s_nom) * 1000) / 10;
          assert.ok(Math.abs((evNom.loadRatioPct ?? 0) - expLrNom) <= 0.11);
          assert.ok(ev80.loadRatioPct > evNom.loadRatioPct || slice.p90_peak_d === 0);

          if (seg.boarding_screening_mode === 'full_station_boarding' && evNom.boardingThroughT !== null) {
            // Confirm P90 T + B matches P90 demand D (not Max demand D!)
            const tbSum = (evNom.boardingThroughT ?? 0) + (evNom.boardingDemandB ?? 0);
            assert.ok(
              Math.abs(tbSum - (evNom.demandValue ?? 0)) <= 0.25,
              `P90 boarding T+B (${tbSum}) must match P90 D (${evNom.demandValue}) on ${seg.segment_id}`
            );
          }
        }
      }
    }
  }
});

test('KPI computation updates cleanly with bounded Utara model, sensitivity disclosures, and Nov 9 holiday exclusion', () => {
  const kpiAllNom = computeKpiSummary(summaryData, defaultFilters);
  const kpiAll80 = computeKpiSummary(summaryData, {
    ...defaultFilters,
    capacityMode: 'planning_sensitivity_80pct',
  });
  const kpiKvOnly = computeKpiSummary(summaryData, {
    ...defaultFilters,
    network: 'ktm_komuter_kv',
  });

  assert.ok(kpiAllNom.peakLoadRatioPct > 100);
  assert.ok(kpiAll80.peakLoadRatioPct > kpiAllNom.peakLoadRatioPct);
  assert.ok(kpiAll80.oversubscribedCount >= kpiAllNom.oversubscribedCount);
  assert.equal(kpiKvOnly.totalEvaluatedCount, 112);
  assert.ok(kpiKvOnly.peakSegmentLabel.includes('Kajang'));
  assert.equal(kpiKvOnly.activeDaysCount, 69);

  // Under symmetric 50/50 bounded Utara model, max single-segment peak extra trains is 2 (never inflated +4 artifact)
  assert.equal(kpiAllNom.maxSingleSegmentExtraTrains, 2);

  // Verify Utara temporal sensitivity & Nov 9 holiday sensitivity are populated cleanly
  assert.equal(coverageData.utara_temporal_sensitivity.network_scenarios.length, 6);
  assert.ok(coverageData.nov09_holiday_sensitivity.ktm_komuter_kv);
  const utaraSegs = summaryData.segments.filter((s) => s.network_code === 'ktm_komuter_utara');
  assert.equal(utaraSegs.length, 44);
  assert.ok(utaraSegs.every((s) => s.sensitivity && Array.isArray(s.sensitivity.max_lr_range)));
});

test('Search resolves Unavailable stations without false zero or red status', () => {
  const segambutRows = buildDisplayRows(
    summaryData,
    { ...defaultFilters, searchQuery: 'Segambut Utara' },
    'station'
  );
  assert.equal(segambutRows.length, 1);
  assert.equal(segambutRows[0].evalData.status, 'unavailable');
  assert.equal(segambutRows[0].evalData.loadRatioPct, null);
  assert.equal(segambutRows[0].evalData.capacityDeficit, null);

  const klccRows = buildDisplayRows(
    summaryData,
    { ...defaultFilters, searchQuery: 'KLCC' },
    'station'
  );
  assert.ok(klccRows.length >= 1);
  assert.ok(klccRows.every((r) => r.evalData.status === 'unavailable'));

  const a0Rows = buildDisplayRows(
    summaryData,
    { ...defaultFilters, searchQuery: 'A0:', includeUnavailable: true },
    'station'
  );
  assert.equal(a0Rows.length, 0);
});

test('Status classifier & null-safe CSV serializer preserve nulls and escape quotes', () => {
  assert.equal(classifyStatus(null, 1000), 'unavailable');
  assert.equal(classifyStatus(50, 0), 'no_service');
  assert.equal(classifyStatus(104.6, 1118), 'deficit');
  assert.equal(classifyStatus(85.0, 1118), 'watch');
  assert.equal(classifyStatus(40.0, 1118), 'within_capacity');

  const rows = sortDisplayRows(
    buildDisplayRows(
      summaryData,
      { ...defaultFilters, searchQuery: 'Segambut Utara' },
      'station'
    ),
    'loadRatio',
    'desc'
  );
  const csvOut = serializeRowsToCsv(rows, defaultFilters, 'station');
  const lines = csvOut.split('\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('Segambut Utara'));
  assert.ok(lines[1].includes(',unavailable,,,,'));
  assert.ok(!lines[1].includes('null'));
});

test('Dynamic directives reflect KVDT2 reference scope & Komuter Utara temporal uncertainty honestly', () => {
  const kpis = computeKpiSummary(summaryData, defaultFilters);
  const directives = generateDynamicDirectives(summaryData, defaultFilters, kpis);
  assert.equal(directives.length, 3);
  const utaraDir = directives.find((d) => d.id === 'utara_peak_pressure');
  const kvDir = directives.find((d) => d.id === 'kvdt2_seremban_corridor');
  assert.ok(utaraDir && utaraDir.description.includes('Scenario band'));
  assert.ok(kvDir && kvDir.badge.includes('Ref. Timetable'));
  assert.ok(directives.some((d) => d.id === 'data_coverage_integrity'));
});
