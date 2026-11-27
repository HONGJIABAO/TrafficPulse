import test from 'node:test';
import assert from 'node:assert/strict';
import networkOverview from '../src/data/network_overview.json' with { type: 'json' };

test('Module 1 KPIs match reconciled OpenDOSM headline totals and full-year comparisons', () => {
  const { kpis, monthly_trend, line_performance } = networkOverview;

  const summedMonths = monthly_trend.reduce((acc, m) => acc + m.total, 0);
  assert.equal(kpis.total_rail_trips, summedMonths);
  assert.equal(kpis.headline_start, '2019-01-01');
  assert.equal(kpis.headline_end, '2026-08-31');

  // Complete calendar-year comparison (2025 vs 2024)
  const y2024 = monthly_trend.filter((m) => m.year === 2024).reduce((acc, m) => acc + m.total, 0);
  const y2025 = monthly_trend.filter((m) => m.year === 2025).reduce((acc, m) => acc + m.total, 0);
  const expectedYoy = Math.round(((y2025 - y2024) / y2024) * 10000) / 100;
  assert.equal(kpis.data_period, '2025');
  assert.equal(kpis.comparison_year, 2024);
  assert.equal(kpis.yoy_growth_pct, expectedYoy);

  // Equivalent YTD comparison (Jan-Aug 2026 vs Jan-Aug 2025)
  const ytd25 = monthly_trend.filter((m) => m.year === 2025 && m.month <= 8).reduce((acc, m) => acc + m.total, 0);
  const ytd26 = monthly_trend.filter((m) => m.year === 2026 && m.month <= 8).reduce((acc, m) => acc + m.total, 0);
  const expectedYtd = Math.round(((ytd26 - ytd25) / ytd25) * 10000) / 100;
  assert.equal(kpis.ytd_yoy_growth_pct, expectedYtd);

  // Busiest line share reconciliation
  const topLine = line_performance[0];
  assert.equal(kpis.busiest_line, topLine.line);
  assert.equal(kpis.busiest_line_total, topLine.total_ridership);
  assert.equal(kpis.busiest_line_share_pct, topLine.share_pct);

  // Partial launch year (LRT Shah Alam launched Jun 2026) omits invalid full-year YoY
  const shahAlam = line_performance.find((l) => l.column === 'rail_lrt_shah_alam');
  assert.ok(shahAlam);
  assert.equal(shahAlam.yoy_growth_pct, null);
  assert.equal(shahAlam.observation_start, '2026-06-29');
});

test('Module 1 Peak Hour KPI is derived dynamically from reconciled KTM Komuter hourly MYT data', () => {
  const { kpis, peak_analysis, sources } = networkOverview;

  assert.equal(peak_analysis.missing_calendar_days, 0);
  assert.equal(peak_analysis.daily_reconciliation.max_abs_delta, 0);
  assert.equal(
    peak_analysis.daily_reconciliation.exact_matches,
    peak_analysis.daily_reconciliation.matched_dates
  );

  // Weekday (ISO 1..5) + Weekend (ISO 6..7) observed days sum cleanly
  assert.equal(
    peak_analysis.weekday_mon_fri.observed_days + peak_analysis.weekend_sat_sun.observed_days,
    peak_analysis.observed_days
  );

  // Reverify AM & PM 2h peak windows directly from weekday hourly profile
  const profile = peak_analysis.weekday_mon_fri.hourly_profile;
  assert.equal(profile.length, 24);
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
