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
  assert.equal(allDs.networkTotalTrips, 7405913);

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
    qDaysSum += ds.activeDaysDenominator;
  }

  assert.equal(qTripsSum, 7405913);
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

  // Rapid Rail sub-period returns unsupported notice without fabricating values
  const rrSub = selectActiveDataset(odSummary, stationsData.stations, {
    mode: 'rapid_rail',
    timeRange: 'q1',
    dayType: 'all',
    timelineMonthKey: null,
  });
  assert.equal(rrSub.hasData, false);
  assert.equal(rrSub.isRapidRailSubfilterUnsupported, true);
  assert.equal(rrSub.hourlySupported, false);
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

  // Weekday peak = 8 AM (3,757.2/hr)
  assert.equal(komWd.peakAnalysis.busiestHour?.hour, 8);
  assert.equal(komWd.peakAnalysis.busiestHour?.windowLabel, '8:00 AM – 9:00 AM');
  assert.equal(komWd.peakAnalysis.busiestHour?.avgTrips, 3757.2);

  // Evening peak dynamically identified as 6:00 PM – 8:00 PM (Hours 18 & 19: 3051.0 and 3028.0)
  assert.equal(komWd.peakAnalysis.eveningPeak?.peakHour, 18);
  assert.equal(komWd.peakAnalysis.eveningPeak?.windowLabel, '6:00 PM – 8:00 PM');

  // Weekend peak = 11 AM (1,579.0/hr), NOT contaminated by Friday 8 AM
  assert.equal(komWe.peakAnalysis.busiestHour?.hour, 11);
  assert.equal(komWe.peakAnalysis.busiestHour?.windowLabel, '11:00 AM – 12:00 PM');

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
