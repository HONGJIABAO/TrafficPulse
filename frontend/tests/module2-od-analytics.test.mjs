import test from 'node:test';
import assert from 'node:assert/strict';
import odSummary from '../src/data/od_summary.json' with { type: 'json' };
import stationsData from '../src/data/stations.json' with { type: 'json' };
import {
  classifyDay,
  classifyIsoWeekday,
  computePeakHours,
  generateDynamicInsights,
  selectActiveDataset,
} from '../src/modules/module2_od_peak_hours/odAnalyticsUtils.ts';

test('Test A — Malaysian operating week day classification (Mon–Fri Weekday, Sat–Sun Weekend)', () => {
  // Exact full week check including Friday
  assert.equal(classifyDay('2026-11-23'), 'Weekday'); // Monday
  assert.equal(classifyDay('2026-11-24'), 'Weekday'); // Tuesday
  assert.equal(classifyDay('2026-11-25'), 'Weekday'); // Wednesday
  assert.equal(classifyDay('2026-11-26'), 'Weekday'); // Thursday
  assert.equal(classifyDay('2026-11-27'), 'Weekday'); // Friday -> MUST be Weekday
  assert.equal(classifyDay('2026-11-28'), 'Weekend'); // Saturday
  assert.equal(classifyDay('2026-11-29'), 'Weekend'); // Sunday

  // UTC boundary safety on Jan 1–3, 2026
  assert.equal(classifyDay('2026-01-01'), 'Weekday'); // Thu
  assert.equal(classifyDay('2026-01-02'), 'Weekday'); // Fri
  assert.equal(classifyDay('2026-01-03'), 'Weekend'); // Sat

  // Invalid / missing dates safely return null
  assert.equal(classifyDay(''), null);
  assert.equal(classifyDay('not-a-date'), null);
  assert.equal(classifyDay('2026-02-30'), null);

  // ISO weekday mapping (1=Mon .. 7=Sun)
  for (const iso of [1, 2, 3, 4, 5]) {
    assert.equal(classifyIsoWeekday(iso), 'Weekday');
  }
  for (const iso of [6, 7]) {
    assert.equal(classifyIsoWeekday(iso), 'Weekend');
  }
});

test('Test B — Day Profile filter partitions Weekdays (232d) and Weekends (92d) accurately', () => {
  const allDs = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  const wdDs = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'weekday',
    timelineMonthKey: null,
  });
  const weDs = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'weekend',
    timelineMonthKey: null,
  });

  assert.equal(allDs.activeDaysDenominator, 324);
  assert.equal(wdDs.activeDaysDenominator, 232);
  assert.equal(weDs.activeDaysDenominator, 92);
  assert.equal(wdDs.activeDaysDenominator + weDs.activeDaysDenominator, allDs.activeDaysDenominator);
  assert.equal(wdDs.networkTotalTrips + weDs.networkTotalTrips, allDs.networkTotalTrips);
  // M2-06: Physical OD volume excludes 18,847 deduplicated Penalty/Unknown admin trips from 7,405,913 source total
  assert.equal(allDs.networkTotalTrips, 7387066);
  assert.equal(allDs.sourceReportedTotalTrips, 7405913);
  assert.equal(allDs.excludedAdminTrips, 18847);
  assert.equal(allDs.excludedAdminPairs, 185);
  assert.equal(allDs.uniqueOdCorridorsCount, 3259);
  assert.equal(wdDs.excludedAdminTrips + weDs.excludedAdminTrips, 18847);

  // Weekday heatmap strictly Mon-Fri (ISO 1..5), including Friday (5)
  const wdWeekdays = new Set(wdDs.heatmapPoints.map((p) => p.weekday));
  assert.deepEqual([...wdWeekdays].sort(), [1, 2, 3, 4, 5]);

  // Weekend heatmap strictly Sat-Sun (ISO 6..7)
  const weWeekdays = new Set(weDs.heatmapPoints.map((p) => p.weekday));
  assert.deepEqual([...weWeekdays].sort(), [6, 7]);
});

test('Test C — Time Horizon filter updates exact quarterly totals, days, and handles empty/unsupported dates', () => {
  const quarters = ['q1', 'q2', 'q3', 'q4'];
  let qTripsSum = 0;
  let qAdminSum = 0;
  let qDaysSum = 0;

  for (const q of quarters) {
    const ds = selectActiveDataset(odSummary, stationsData.stations, {
      mode: 'komuter',
      timeRange: q,
      dayType: 'all',
      timelineMonthKey: null,
    });
    assert.equal(ds.hasData, true);
    assert.equal(ds.networkTotalIsExact, true);
    qTripsSum += ds.networkTotalTrips;
    qAdminSum += ds.excludedAdminTrips;
    qDaysSum += ds.activeDaysDenominator;
  }

  assert.equal(qTripsSum, 7387066);
  assert.equal(qAdminSum, 18847);
  assert.equal(qTripsSum + qAdminSum, 7405913);
  assert.equal(qDaysSum, 324);

  // Monthly slice updates to August 2026 (31 days)
  const augDs = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: '2026-08',
  });
  assert.equal(augDs.hasData, true);
  assert.equal(augDs.activeDaysDenominator, 31);
  assert.ok(augDs.networkTotalTrips > 0 && augDs.networkTotalTrips < 1000000);

  // Missing / future month returns explicit empty no-data state
  const emptyDs = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: '2026-12',
  });
  assert.equal(emptyDs.hasData, false);
  assert.ok(emptyDs.emptyReason && emptyDs.emptyReason.includes('No verified railway observations'));

  // Rapid Rail Q1 2026 now slices the complete full-matrix Rapid Rail dataset (daily OD only, no hourly)
  const rrQ1 = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'rapid_rail',
    timeRange: 'q1',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(rrQ1.hasData, true);
  assert.equal(rrQ1.networkTotalIsExact, true);
  assert.equal(rrQ1.activeDaysDenominator, 90);
  assert.equal(rrQ1.hourlySupported, false);
  assert.ok(rrQ1.networkTotalTrips && rrQ1.networkTotalTrips > 45_000_000);

  // If a fixture omits sub-period rapid_rail data, it must still report unsupported cleanly without fabricating
  const clonedNoSubRr = structuredClone(odSummary);
  delete clonedNoSubRr.periods.q1.rapid_rail;
  const rrSubUnsupported = selectActiveDataset(clonedNoSubRr, stationsData.stations, {
    mode: 'rapid_rail',
    timeRange: 'q1',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(rrSubUnsupported.hasData, false);
  assert.equal(rrSubUnsupported.isRapidRailSubfilterUnsupported, true);
  assert.equal(rrSubUnsupported.hourlySupported, false);
});

test('Test D & E — Dynamic KPIs & Peak Hour Identification match KTM Komuter 2026 telemetry (Eve 6–8 PM)', () => {
  const komWd = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'weekday',
    timelineMonthKey: null,
  });
  const komWe = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'weekend',
    timelineMonthKey: null,
  });

  // Weekday peak = 8 AM (3,755.1/hr physical OD excl. non-physical Penalty/Unknown admin rows)
  assert.equal(komWd.peakAnalysis.busiestHour?.hour, 8);
  assert.equal(komWd.peakAnalysis.busiestHour?.windowLabel, '8:00 AM – 9:00 AM');
  assert.equal(komWd.peakAnalysis.busiestHour?.avgTrips, 3755.1);

  // Evening peak dynamically identified as 6:00 PM – 8:00 PM (Hours 18 & 19: 3048.3 and 3025.8)
  assert.equal(komWd.peakAnalysis.eveningPeak?.peakHour, 18);
  assert.equal(komWd.peakAnalysis.eveningPeak?.windowLabel, '6:00 PM – 8:00 PM');

  // Weekend peak = 11 AM (1,566.9/hr physical OD), NOT contaminated by Friday 8 AM
  assert.equal(komWe.peakAnalysis.busiestHour?.hour, 11);
  assert.equal(komWe.peakAnalysis.busiestHour?.windowLabel, '11:00 AM – 12:00 PM');
  assert.equal(komWe.peakAnalysis.busiestHour?.avgTrips, 1566.9);

  // Top Intercity corridor dynamically computed
  const ic = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'intercity',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(ic.resolvedFlows[0].originClean, 'Wakaf Bharu');
  assert.equal(ic.resolvedFlows[0].destinationClean, 'Dabong');
  assert.equal(ic.uniqueOdCorridorsCount, 1819);

  // Dynamic insights generated cleanly with computed numbers
  const insights = generateDynamicInsights(komWd, 'komuter', 'weekday');
  assert.equal(insights.length, 3);
  assert.match(insights[0].observation, /6:00 PM – 8:00 PM/);

  // Empty hourly array safely returns hasData=false without NaN/Infinity
  const emptyPeak = computePeakHours([]);
  assert.equal(emptyPeak.hasData, false);
  assert.equal(emptyPeak.busiestHour, null);
});

test('Test F — Comparable 2026 Corridor Ranking & Zero Silent KL Sentral Fallback', () => {
  const all2026 = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'all',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });

  // Across equal 324-day 2026 observation window, Rapid Rail KLCC -> Ampang Park leads (~2,358.2/day)
  assert.equal(all2026.resolvedFlows[0].originClean, 'KLCC');
  assert.equal(all2026.resolvedFlows[0].destinationClean, 'Ampang Park');
  assert.equal(all2026.resolvedFlows[0].observationDays, 324);
  assert.equal(all2026.unresolvedStations.length, 0);

  // Inject an unknown station pair and verify it is NOT assigned KL Sentral coordinates
  const cloned = structuredClone(odSummary);
  cloned.periods['12m'].komuter.top_od.all.unshift({
    origin: 'NonExistent Station X',
    destination: 'KL Sentral',
    total_ridership: 500000,
  });
  const testRes = selectActiveDataset(cloned, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  const unmapped = testRes.resolvedFlows.find((f) => f.originClean === 'NonExistent Station X');
  assert.ok(unmapped);
  assert.equal(unmapped.isVerifiedCoords, false);
  assert.equal(unmapped.originCoords, null);
  assert.equal(unmapped.distanceKm, null);
  assert.ok(testRes.unresolvedStations.includes('NonExistent Station X'));
});

test('Test G — Rapid Rail Hourly Integrity Check', () => {
  const rr = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'rapid_rail',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(rr.hasData, true);
  assert.equal(rr.hourlySupported, false);
  assert.equal(rr.peakAnalysis.hasData, false);
  assert.equal(rr.heatmapPoints.length, 0);
});

test('Test H — Full-Matrix Rapid Rail Totals, Distance Profile & Shah Alam Disclosure', () => {
  const rr = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'rapid_rail',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(rr.networkTotalIsExact, true);
  assert.equal(rr.networkTotalTrips, 196631192);
  assert.equal(rr.uniqueOdCorridorsCount, 17048);
  assert.equal(rr.weekdayTotalTrips, 154688726);
  assert.equal(rr.weekendTotalTrips, 41942466);
  assert.ok(rr.fullDistanceStats);
  assert.equal(rr.fullDistanceStats.isPopulationLevel, true);
  assert.equal(rr.fullDistanceStats.totalPairs, 17048);
  assert.equal(rr.fullDistanceStats.avgDist, 7.3);
  assert.ok(rr.shahAlamNote && rr.shahAlamNote.includes('3,265,221'));

  const kom = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'komuter',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.ok(kom.fullDistanceStats);
  assert.equal(kom.fullDistanceStats.avgDist, 24.3);
  assert.equal(kom.fullDistanceStats.mappedCoveragePct, 100);
});

test('Test I — M2-04 Intercity & Upper OD Scope Labels, M2-06 Admin Reconciliation & Zero-Volume Pair Disclosure', () => {
  // M2-04: Upper OD Intercity must NEVER claim ETS; All-mode insights disclose exact 3 included OD services
  const ic = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'intercity',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(ic.resolvedFlows[0].modeLabel, 'KTM Intercity');
  assert.doesNotMatch(ic.hourlyCoverageNote, /Intercity\s*&\s*ETS/i);
  assert.match(ic.hourlyCoverageNote, /Excl\. ETS & Shuttle Tebrau/);
  const icInsights = generateDynamicInsights(ic, 'intercity', 'all');
  assert.match(icInsights[2].observation, /^KTM Intercity\b/);
  assert.doesNotMatch(icInsights[2].observation, /Intercity & ETS/i);

  const allDs = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'all',
    timeRange: '12m',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(allDs.networkTotalTrips, 204987144);
  assert.equal(allDs.sourceReportedTotalTrips, 205005991);
  assert.equal(allDs.excludedAdminTrips, 18847);
  assert.equal(allDs.zeroRidershipPairsDisclosed, 7);
  const allInsights = generateDynamicInsights(allDs, 'all', 'all');
  assert.match(allInsights[2].observation, /All Included OD Services \(Rapid Rail, KTM Komuter KV & Intercity\)/);
  assert.match(allInsights[2].observation, /18,847/);

  // M2-06: Exact source-to-physical reconciliation without double-counting dual-admin (Unknown->Unknown = 35)
  const rec = odSummary.metadata.data_quality.komuter_2026.admin_reconciliation;
  assert.equal(rec.source_reported_trips, 7405913);
  assert.equal(rec.physical_od_trips, 7387066);
  assert.equal(rec.excluded_admin_trips, 18847);
  assert.equal(rec.origin_penalty_trips, 0);
  assert.equal(rec.dest_penalty_trips, 4450);
  assert.equal(rec.origin_unknown_trips, 10584);
  assert.equal(rec.dest_unknown_trips, 3848);
  assert.equal(rec.dual_admin_trips, 35);
  assert.equal(
    rec.origin_penalty_trips + rec.dest_penalty_trips + rec.origin_unknown_trips + rec.dest_unknown_trips - rec.dual_admin_trips,
    rec.excluded_admin_trips
  );

  // Ensure no Penalty or Unknown code leaks into any period top_od lists
  for (const periodObj of Object.values(odSummary.periods)) {
    for (const pairList of [periodObj.komuter.top_od.all, periodObj.intercity.top_od.all]) {
      for (const p of pairList) {
        assert.notEqual(p.origin.toLowerCase(), 'penalty');
        assert.notEqual(p.origin.toLowerCase(), 'unknown');
        assert.notEqual(p.destination.toLowerCase(), 'penalty');
        assert.notEqual(p.destination.toLowerCase(), 'unknown');
      }
    }
  }

  // Rapid Rail pair count distinction: 17,048 positive out of 17,055 matrix pairs (7 zero-volume pairs)
  const rrDq = odSummary.metadata.data_quality.rapid_rail_2026;
  assert.equal(rrDq.total_non_a0_pairs_all, 17055);
  assert.equal(rrDq.positive_non_a0_pairs, 17048);
  assert.equal(rrDq.zero_ridership_pairs, 7);
});
