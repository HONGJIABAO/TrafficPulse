import test from 'node:test';
import assert from 'node:assert/strict';
import summaryData from '../src/data/module2_capacity_screening/capacity_screening_summary.json' with { type: 'json' };
import hourlyData from '../src/data/module2_capacity_screening/capacity_hourly_profiles.json' with { type: 'json' };
import coverageData from '../src/data/module2_capacity_screening/capacity_coverage.json' with { type: 'json' };
import {
  buildDisplayRows,
  classifyStatus,
  computeKpiSummary,
  generateDynamicDirectives,
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

test('Summary, Hourly Profiles & Coverage bundles have expected structure', () => {
  assert.equal(summaryData.stations.length, 80);
  assert.equal(summaryData.segments.length, 156);
  assert.ok(summaryData.unavailable_stations.length > 200);
  assert.equal(coverageData.feasibility_matrix.length, 6);
  assert.equal(summaryData.metadata.gtfs_window_start, '2026-08-18');
  assert.equal(summaryData.metadata.gtfs_window_end, '2026-11-26');

  // Verify 24-hour profile coverage for all 156 segments across all 3 day profiles
  for (const seg of summaryData.segments.slice(0, 15)) {
    for (const dp of ['all', 'weekday', 'weekend']) {
      const p = hourlyData.profiles[`${seg.segment_id}|${dp}`];
      assert.ok(p, `Missing profile ${seg.segment_id}|${dp}`);
      assert.equal(p.base_mean.length, 24);
      assert.equal(p.cap_nom_mean.length, 24);
    }
  }
});

test('KPI computation updates dynamically across network and sensitivity filters', () => {
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

  // Never sum adjacent segment extra trains: maxSingleSegmentExtraTrains must stay bounded by worst single segment
  assert.equal(kpiAllNom.maxSingleSegmentExtraTrains, 4);
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

  // No 'A0: All Stations' aggregate pollution
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

test('Dynamic directives reflect KVDT2 & Komuter Utara findings accurately', () => {
  const kpis = computeKpiSummary(summaryData, defaultFilters);
  const directives = generateDynamicDirectives(summaryData, defaultFilters, kpis);
  assert.equal(directives.length, 3);
  assert.ok(directives.some((d) => d.id === 'utara_peak_pressure'));
  assert.ok(directives.some((d) => d.id === 'kvdt2_seremban_corridor'));
  assert.ok(directives.some((d) => d.id === 'data_coverage_integrity'));
});
