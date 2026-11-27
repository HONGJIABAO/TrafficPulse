import test from 'node:test';
import assert from 'node:assert/strict';
import networkOverview from '../src/data/network_overview.json' with { type: 'json' };
import stationRegistry from '../src/data/verified_station_registry.json' with { type: 'json' };
import stationRidership from '../src/data/station_monthly_ridership.json' with { type: 'json' };
import {
  computeYtdSummary,
  normalizeSelectedLine,
  resolveHeadlineSeries,
} from '../src/modules/module1_network_overview/lineMapping.ts';
import { getNationalRoutes } from '../src/modules/module1_network_overview/nationalRailNetwork.ts';
import {
  MAP_STATIONS,
  getSelectedStationSummary,
  getStationSnapshot,
  stationMatchesLine,
} from '../src/modules/module1_network_overview/networkMapData.ts';

test('Module 1 KPIs match reconciled OpenDOSM headline totals and full-year comparisons', () => {
  const { kpis, monthly_trend, line_performance } = networkOverview;

  const summedMonths = monthly_trend.reduce((acc, m) => acc + m.total, 0);
  assert.equal(kpis.total_rail_trips, summedMonths);
  assert.equal(kpis.headline_start, '2019-01-01');
  assert.equal(kpis.headline_end, '2026-08-31');

  const y2024 = monthly_trend.filter((m) => m.year === 2024).reduce((acc, m) => acc + m.total, 0);
  const y2025 = monthly_trend.filter((m) => m.year === 2025).reduce((acc, m) => acc + m.total, 0);
  const expectedYoy = Math.round(((y2025 - y2024) / y2024) * 10000) / 100;
  assert.equal(kpis.data_period, '2025');
  assert.equal(kpis.comparison_year, 2024);
  assert.equal(kpis.yoy_growth_pct, expectedYoy);

  const ytd25 = monthly_trend.filter((m) => m.year === 2025 && m.month <= 8).reduce((acc, m) => acc + m.total, 0);
  const ytd26 = monthly_trend.filter((m) => m.year === 2026 && m.month <= 8).reduce((acc, m) => acc + m.total, 0);
  const expectedYtd = Math.round(((ytd26 - ytd25) / ytd25) * 10000) / 100;
  assert.equal(kpis.ytd_yoy_growth_pct, expectedYtd);

  const topLine = line_performance[0];
  assert.equal(kpis.busiest_line, topLine.line);
  assert.equal(kpis.busiest_line_total, topLine.total_ridership);
  assert.equal(kpis.busiest_line_share_pct, topLine.share_pct);

  const shahAlam = line_performance.find((l) => l.column === 'rail_lrt_shah_alam');
  assert.ok(shahAlam);
  assert.equal(shahAlam.yoy_growth_pct, null);
  assert.equal(shahAlam.observation_start, '2026-06-29');
});

test('Module 1 Peak Hour KPI & 24h weekday MiniBarChart profile derive from KTM Komuter MYT data', () => {
  const { kpis, peak_analysis, sources } = networkOverview;

  assert.equal(peak_analysis.missing_calendar_days, 0);
  assert.equal(peak_analysis.daily_reconciliation.max_abs_delta, 0);
  assert.equal(
    peak_analysis.daily_reconciliation.exact_matches,
    peak_analysis.daily_reconciliation.matched_dates
  );
  assert.equal(
    peak_analysis.weekday_mon_fri.observed_days + peak_analysis.weekend_sat_sun.observed_days,
    peak_analysis.observed_days
  );

  const profile = peak_analysis.weekday_mon_fri.hourly_profile;
  assert.equal(profile.length, 24);
  for (let h = 0; h < 24; h++) {
    assert.equal(profile[h].hour, h);
    assert.ok(profile[h].avg_trips >= 0);
  }

  let bestAmStart = -1;
  let bestAmSum = -1;
  for (let h = 5; h <= 10; h++) {
    const s = profile[h].avg_trips + profile[h + 1].avg_trips;
    if (s > bestAmSum) { bestAmSum = s; bestAmStart = h; }
  }
  let bestPmStart = -1;
  let bestPmSum = -1;
  for (let h = 15; h <= 21; h++) {
    const s = profile[h].avg_trips + profile[h + 1].avg_trips;
    if (s > bestPmSum) { bestPmSum = s; bestPmStart = h; }
  }

  assert.equal(peak_analysis.weekday_mon_fri.am_peak_2h.start_hour, bestAmStart);
  assert.equal(peak_analysis.weekday_mon_fri.pm_peak_2h.start_hour, bestPmStart);
  assert.equal(kpis.peak_hour_window, peak_analysis.weekday_mon_fri.am_peak_2h.window_display);
  assert.equal(kpis.peak_hour_pm_24h, peak_analysis.weekday_mon_fri.pm_peak_2h.window_24h);
  assert.match(kpis.peak_hour_sub, /KTM Komuter/);
  assert.ok(sources.length >= 5);
});

test('Ridership Trend dynamic YTD handles full years, scrubbed months, and missing baselines without zero-fill', () => {
  const mt = networkOverview.monthly_trend;
  const lastIdx = mt.length - 1; // 2026-08

  // All Lines at 2026-08 matches Jan-Aug 2026 vs Jan-Aug 2025
  const ytdAll = computeYtdSummary(mt, 'All Lines', lastIdx);
  assert.equal(ytdAll.hasHeadlineData, true);
  assert.equal(ytdAll.ytdTrips, 244973460);
  assert.equal(ytdAll.prevYtdTrips, 234566924);
  assert.equal(ytdAll.ytdGrowthPct, 4.44);
  assert.equal(ytdAll.comparisonPeriodLabel, 'Jan–Aug 2026 vs 2025');

  // Scrub to June 2025 -> Jan-Jun 2025 vs Jan-Jun 2024
  const jun25Idx = mt.findIndex((m) => m.year_month === '2025-06');
  const ytdJun25 = computeYtdSummary(mt, 'All Lines', jun25Idx);
  assert.equal(ytdJun25.comparisonPeriodLabel, 'Jan–Jun 2025 vs 2024');
  assert.ok(ytdJun25.ytdGrowthPct !== null && ytdJun25.ytdTrips > 0);

  // 2019 has no 2018 baseline -> returns null (N/A)
  const aug19Idx = mt.findIndex((m) => m.year_month === '2019-08');
  assert.equal(computeYtdSummary(mt, 'All Lines', aug19Idx).ytdGrowthPct, null);

  // LRT Shah Alam launched Jun 2026 -> 2025 baseline unavailable -> N/A
  const ytdSa = computeYtdSummary(mt, 'LRT Shah Alam', lastIdx);
  assert.equal(ytdSa.ytdTrips, 3283911);
  assert.equal(ytdSa.ytdGrowthPct, null);

  // MRT Putrajaya in 2023-06 (2022 lacked Jan-May & Jun 2022 had 15d vs 30d) -> N/A
  const jun23Idx = mt.findIndex((m) => m.year_month === '2023-06');
  assert.equal(computeYtdSummary(mt, 'MRT Putrajaya', jun23Idx).ytdGrowthPct, null);

  // KTM Shuttle Tebrau alias & LRT Ampang combined-branch resolution
  const tebrau = computeYtdSummary(mt, 'KTM Shuttle Tebrau', lastIdx);
  assert.equal(tebrau.hasHeadlineData, true);
  assert.equal(tebrau.headlineLine, 'KTM Tebrau Shuttle');
  assert.equal(tebrau.isCombinedBranch, false);

  const ampangBranch = computeYtdSummary(mt, 'LRT Ampang', lastIdx);
  assert.equal(ampangBranch.headlineLine, 'LRT Ampang–Sri Petaling');
  assert.equal(ampangBranch.isCombinedBranch, true);
});

test('Route aliases, combined-service selection, and unique station deduplication prevent duplicate counting', () => {
  assert.equal(normalizeSelectedLine('KTM Shuttle Tebrau'), 'KTM Tebrau Shuttle');
  assert.equal(resolveHeadlineSeries('LRT Ampang').combinedLabel, 'Combined LRT Ampang–Sri Petaling');
  assert.equal(resolveHeadlineSeries('KTM Komuter Utara (Ipoh)').headlineLine, 'KTM Komuter Utara');
  assert.equal(resolveHeadlineSeries('Sabah State Railway').headlineLine, null);

  // Combined LRT Ampang-Sri Petaling highlights both routes & 36 unique stations (no duplicate trunk or foreign interchange)
  const agspRoutes = getNationalRoutes('LRT Ampang–Sri Petaling').features.filter((f) => f.properties?.inScope);
  assert.equal(agspRoutes.length, 2);
  const agspSnap = getStationSnapshot('2026-08', 'LRT Ampang–Sri Petaling', 'All Stations');
  assert.equal(agspSnap.total, 36);
  const inScopeIds = agspSnap.data.features.filter((f) => f.properties?.inScope).map((f) => f.properties?.code);
  assert.equal(new Set(inScopeIds).size, 36);

  // Individual branch filters explore only their branch stops (18 AG, 29 PH)
  assert.equal(getNationalRoutes('LRT Ampang').features.filter((f) => f.properties?.inScope).length, 1);
  assert.equal(getStationSnapshot('2026-08', 'LRT Ampang', 'All Stations').total, 18);
  assert.equal(getStationSnapshot('2026-08', 'LRT Sri Petaling', 'All Stations').total, 29);

  // KTM Komuter Utara highlights both Ipoh & Padang Besar; KTM Tebrau Shuttle highlights Shuttle Tebrau
  assert.equal(getNationalRoutes('KTM Komuter Utara').features.filter((f) => f.properties?.inScope).length, 2);
  assert.equal(getNationalRoutes('KTM Tebrau Shuttle').features.filter((f) => f.properties?.inScope).length, 1);

  // Combined KTM Komuter deduplicates intercity copies and excludes ic_ duplicates
  const komSnap = getStationSnapshot('2026-08', 'KTM Komuter', 'All Stations');
  assert.ok(komSnap.data.features.filter((f) => f.properties?.inScope).every((f) => !String(f.properties?.id).startsWith('intercity:')));
});

test('Station coverage, ranking, daily-rate growth, MRT Kajang registry, and Pre-COVID legacy benchmark', () => {
  // Dynamic coverage by period
  const cov2021 = getStationSnapshot('2021-06', 'All Lines', 'All Stations').coverage;
  assert.equal(cov2021.measured, 0);
  assert.match(cov2021.secondaryText, /unavailable/i);

  const cov2024 = getStationSnapshot('2024-06', 'All Lines', 'All Stations').coverage;
  assert.ok(cov2024.measured > 0 && cov2024.measured < 100);
  assert.match(cov2024.secondaryText, /KTM Komuter (?:OD )?only/);

  const cov2026 = getStationSnapshot('2026-08', 'All Lines', 'All Stations').coverage;
  assert.equal(cov2026.measured, 300);
  assert.equal(cov2026.total, 351);
  assert.match(cov2026.secondaryText, /Rapid Rail, KTM Komuter & Intercity/);

  // Selected station ranking & non-YoY within-2026 vs Komuter daily YoY
  const augAll = getStationSnapshot('2026-08', 'All Lines', 'KLCC');
  const klcc = MAP_STATIONS.find((s) => s.code === 'KJ10');
  assert.ok(klcc);
  const klccSummary = getSelectedStationSummary(klcc, '2026-08', augAll.ranked);
  assert.equal(klccSummary.rank, 2);
  assert.equal(klccSummary.rankedTotal, 300);
  assert.match(klccSummary.growthLabel, /vs Jan 2026/);
  assert.doesNotMatch(klccSummary.growthLabel, /YoY/);

  // LRT Shah Alam zero baseline in Jan-Jul 2026 -> suppresses growth in 2026-08 instead of div-by-zero
  const saSnap = getStationSnapshot('2026-08', 'LRT Shah Alam', 'All Stations');
  const saStop = MAP_STATIONS.find((s) => s.code === 'SA01' && stationMatchesLine(s, 'LRT Shah Alam'));
  assert.ok(saStop);
  assert.equal(getSelectedStationSummary(saStop, '2026-08', saSnap.ranked).growthPct, null);

  // Komuter Sep 2024 YoY compares 30-day avg daily vs 21-day Sep 2023 daily avg
  assert.ok(stationRidership.observed_days_by_month?.komuter?.['2023-09'] === 21);
  assert.ok(stationRidership.observed_days_by_month?.komuter?.['2024-09'] === 30);

  // MRT Kajang GTFS registry: 0 rapidrail KG stations left in unmatchedExisting
  const unmatchedKg = stationRegistry.unmatchedExisting.filter((u) => u.startsWith('rapidrail:KG'));
  assert.equal(unmatchedKg.length, 0);

  // Pre-COVID 2019 legacy 4-line comparison matches ridership_headline.csv calculations
  const leg = networkOverview.legacy_comparison;
  assert.ok(leg);
  assert.equal(leg.full_2019_total, 236293739);
  assert.equal(leg.ytd_2019_total, 154187119);
  assert.equal(leg.ytd_latest_total, 185553224);
  assert.equal(leg.vs_full_2019_daily_pct, 17.95);
  assert.equal(leg.vs_same_period_2019_daily_pct, 20.34);
});
