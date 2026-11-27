import test from 'node:test';
import assert from 'node:assert/strict';
import inventory from '../src/data/module2_station_demand/station_inventory.json' with { type: 'json' };
import summary from '../src/data/module2_station_demand/station_demand_summary.json' with { type: 'json' };
import hourly from '../src/data/module2_station_demand/station_hourly_profiles.json' with { type: 'json' };
import daily from '../src/data/module2_station_demand/station_daily_profiles.json' with { type: 'json' };
import coverage from '../src/data/module2_station_demand/station_demand_coverage.json' with { type: 'json' };
import {
  DEFAULT_STATION_DEMAND_FILTERS,
  buildStationCsvContent,
  computeDailySeriesSummary,
  computeSpotlightMetrics,
  formatHourWindow24,
  generateStationDemandInsight,
  resolveStationRows,
  sortStationRows,
} from '../src/modules/module2_od_peak_hours/station_demand/stationDemandUtils.ts';

test('Test 1 — Official 6-Dataset & A0 Marginals Zero-Delta Reconciliation', () => {
  assert.match(coverage.aligned_common_window, /^2026-01-01 to 2026-11-20/);
  assert.equal(coverage.inventory_summary.total_records, 399);
  assert.equal(coverage.inventory_summary.physical_with_od, 388);
  assert.equal(coverage.inventory_summary.non_physical_administrative_codes, 2);
  assert.equal(coverage.inventory_summary.gtfs_unmeasured_stops, 9);

  // Rapid Rail non-A0 reconciliation across 53,784 origin-dates
  assert.equal(coverage.services.rapid_rail.a0_origin_reconciliation.station_date_pairs_checked, 53784);
  assert.equal(coverage.services.rapid_rail.a0_origin_reconciliation.exact_zero_delta_matches, 53784);
  assert.equal(coverage.services.rapid_rail.a0_origin_reconciliation.max_abs_delta, 0);
  assert.equal(coverage.services.rapid_rail.total_origin_trips_aligned, 196631192);

  // All 5 KTMB services exact 324d totals & 0-delta reconciliation against ridership_ktmb_daily
  const expectedKtmb = {
    komuter: 7405913,
    intercity: 968886,
    komuter_utara: 5672392,
    ets: 5699796,
    shuttle_tebrau: 2778383,
  };
  for (const [svc, expectedTotal] of Object.entries(expectedKtmb)) {
    const entry = coverage.services[svc];
    assert.ok(entry, `Missing coverage entry for ${svc}`);
    assert.equal(entry.total_origin_trips_aligned, expectedTotal);
    assert.equal(entry.aligned_days, 324);
    assert.equal(entry.reconciliation_vs_ktmb_daily.matched_dates, 324);
    assert.equal(entry.reconciliation_vs_ktmb_daily.exact_zero_delta_dates, 324);
    assert.equal(entry.reconciliation_vs_ktmb_daily.max_abs_delta, 0);
  }
});

test('Test 2 — Non-Physical Admin Codes (Penalty/Unknown/A0) & Coordinate Exclusions', () => {
  const names = new Set(inventory.stations.map((s) => s.raw_name.toLowerCase()));
  assert.equal(names.has('penalty'), false);
  assert.equal(names.has('a0'), false);

  const unknowns = inventory.stations.filter((s) => !s.is_physical_station);
  assert.equal(unknowns.length, 2);
  for (const unk of unknowns) {
    assert.equal(unk.lat, null);
    assert.equal(unk.lng, null);
    assert.equal(unk.coordinate_verified, false);
    assert.equal(unk.hourly_supported, false);
    assert.equal(unk.availability_status, 'non_physical_fee_or_unknown');
  }

  // Default resolver excludes non-physical codes
  const defaultRows = resolveStationRows(inventory, summary, hourly, DEFAULT_STATION_DEMAND_FILTERS);
  assert.equal(defaultRows.some((r) => !r.station.is_physical_station), false);

  // When toggled on, Unknown entries appear unranked with null peakHour (never 00:00 placeholder)
  const withAdmin = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    includeNonPhysicalCodes: true,
  });
  const adminRows = withAdmin.filter((r) => !r.station.is_physical_station);
  assert.equal(adminRows.length, 2);
  for (const r of adminRows) {
    assert.equal(r.rank, null);
    assert.equal(r.peakHour, null);
  }
});

test('Test 3 — Rapid Rail Strictly Daily-Only Hourly Integrity (Zero Fake Peaks)', () => {
  const rrRows = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    network: 'rapid_rail',
  });
  assert.equal(rrRows.length, 166);

  for (const row of rrRows) {
    assert.equal(row.station.hourly_supported, false);
    assert.equal(row.peakHour, null);
    assert.equal(row.peakHourAvg, null);
    assert.equal(row.amWindowAvg, null);
    assert.equal(row.pmWindowAvg, null);
    assert.equal(row.hourlyProfile24, null);
  }

  // Bukit Bintang (KG18) leads Rapid Rail at 8,046,216 trips
  const sorted = sortStationRows(rrRows, 'rank', 'asc');
  assert.equal(sorted[0].station.id, 'rr:KG18');
  assert.equal(sorted[0].totalTrips, 8046216);

  const spotlight = computeSpotlightMetrics(sorted, 324);
  assert.equal(spotlight.filteredTotalTrips, 196631192);
  assert.equal(spotlight.topDailyStation?.station.id, 'rr:KG18');
  assert.equal(spotlight.topHourlyPeakStation, null);
  assert.equal(spotlight.hourlySupportedCount, 0);
  assert.equal(spotlight.dailyOnlyCount, 166);
});

test('Test 4 — BRT Sunway & GTFS Unmeasured Stops Never Receive 00:00 or Fake 0 Ridership', () => {
  const brtRows = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    network: 'brt',
    includeUnmeasuredStops: true,
  });
  assert.equal(brtRows.length, 7);
  for (const row of brtRows) {
    assert.equal(row.station.availability_status, 'unavailable_no_od_data');
    assert.equal(row.totalTrips, null);
    assert.equal(row.avgDailyTrips, null);
    assert.equal(row.peakHour, null);
    assert.equal(row.peakHourAvg, null);
    assert.equal(row.rank, null);
  }

  // Also check Kota Baharu & Mengkibol unmeasured KTMB GTFS stops
  const allUnmeasured = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    includeUnmeasuredStops: true,
  }).filter((r) => r.station.availability_status === 'unavailable_no_od_data');
  assert.equal(allUnmeasured.length, 9);
});

test('Test 5 — Shah Alam (SA) Line Paid Launch Ramp & Calendar Denominator Verification', () => {
  const saFull = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    network: 'rapid_rail',
    line: 'LRT Shah Alam',
  });
  assert.equal(saFull.length, 20);
  const saFullSum = saFull.reduce((acc, r) => acc + (r.totalTrips || 0), 0);
  assert.equal(saFullSum, 3265221);
  for (const r of saFull) {
    assert.equal(r.positiveDays, 112);
    assert.equal(r.station.availability_status, 'partial_active_period');
    // Full 2026 avg denominator uses full 324 days cleanly (rounded to 2 decimal places)
    assert.equal(r.avgDailyTrips, Math.round(((r.totalTrips || 0) / 324) * 100) / 100);
  }

  // Q1 & Q2 (Jan-Jun) record exactly 0 paid origin OD trips for Shah Alam
  for (const q of ['q1', 'q2']) {
    const saQ = resolveStationRows(inventory, summary, hourly, {
      ...DEFAULT_STATION_DEMAND_FILTERS,
      network: 'rapid_rail',
      line: 'LRT Shah Alam',
      period: q,
    });
    assert.equal(saQ.reduce((acc, r) => acc + (r.totalTrips || 0), 0), 0);
  }

  // August 2026 daily trajectory slices cleanly to 31 active days
  const augDaily = computeDailySeriesSummary(saFull[0], daily, '2026-08', 'all');
  assert.ok(augDaily);
  assert.equal(augDaily.labels.length, 31);
});

test('Test 6 — KTMB Hourly Windows, Sorting Null-Sinking, CSV Export & Insight Integrity', () => {
  // Single hour window (18:00-18:59 PM peak) on KTM Komuter
  const komPm = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    network: 'ktmb',
    service: 'komuter',
    dayType: 'weekday',
    hourWindow: 'selected_hour',
    selectedHour: 18,
  });
  const sortedPm = sortStationRows(komPm, 'rank', 'asc');
  assert.equal(sortedPm[0].station.name, 'KL Sentral');
  assert.equal(sortedPm[0].peakHour, 19);
  assert.equal(formatHourWindow24(19), '19:00–19:59');

  // Verify null-sinking when sorting mixed KTMB + Rapid Rail + BRT by peakAvg ascending or descending
  const mixed = resolveStationRows(inventory, summary, hourly, {
    ...DEFAULT_STATION_DEMAND_FILTERS,
    includeUnmeasuredStops: true,
  });
  const sortedAsc = sortStationRows(mixed, 'peakAvg', 'asc');
  const sortedDesc = sortStationRows(mixed, 'peakAvg', 'desc');
  assert.equal(sortedAsc[sortedAsc.length - 1].peakHourAvg, null);
  assert.equal(sortedDesc[sortedDesc.length - 1].peakHourAvg, null);
  assert.notEqual(sortedAsc[0].peakHourAvg, null);
  assert.notEqual(sortedDesc[0].peakHourAvg, null);

  // CSV contains genuine rows and marks Rapid Rail as Hourly Unavailable / BRT as No Data
  const csv = buildStationCsvContent(sortedDesc.slice(0, 5), 'Test Scope');
  assert.match(csv, /^Rank,Station ID,Station Name,/);

  const brtSample = mixed.find((r) => r.station.network === 'brt');
  const rrSample = mixed.find((r) => r.station.network === 'rapid_rail');
  const mixedCsv = buildStationCsvContent([rrSample, brtSample], 'Mixed Test');
  assert.match(mixedCsv, /Hourly Unavailable/);
  assert.match(mixedCsv, /No Data/);

  // Insight generator avoids capacity/overcrowding fabrication
  const spotlight = computeSpotlightMetrics(mixed, 324);
  const insight = generateStationDemandInsight(spotlight, DEFAULT_STATION_DEMAND_FILTERS, coverage);
  assert.match(insight.headline, /Bukit Bintang/);
  assert.match(insight.detail, /without inferring rolling-stock capacity/i);
  assert.ok(insight.shahAlamDisclosure && insight.shahAlamDisclosure.includes('3,265,221'));
});
