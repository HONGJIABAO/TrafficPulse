import type {
  BottleneckStatus,
  CapacityMode,
  CapacityScreeningSummarySchema,
  DayProfileFilter,
  DisplayTableRow,
  DynamicDirectiveItem,
  DynamicKpiSummary,
  EvaluatedMetricSnapshot,
  NetworkCode,
  PeriodScope,
  ScreenedSegmentRecord,
  ScreeningFilters,
  SegmentSliceMetrics,
  SortDirection,
  StatMode,
} from './capacityScreeningTypes';

export function formatHourLabel(hour: number | null): string {
  if (hour === null || Number.isNaN(hour)) return 'N/A';
  const hh = ((hour % 24) + 24) % 24;
  return `${String(hh).padStart(2, '0')}:00–${String((hh + 1) % 24).padStart(2, '0')}:00`;
}

export function formatCompactNumber(val: number | null | undefined, digits = 0): string {
  if (val === null || val === undefined || Number.isNaN(val)) return 'Unavailable';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function getNetworkShortLabel(code: string): string {
  if (code === 'ktm_komuter_kv') return 'Komuter KV';
  if (code === 'ktm_komuter_utara') return 'Komuter Utara';
  if (code === 'ktm_komuter_kv_unmapped') return 'Komuter KV (Unverified)';
  if (code === 'ktm_ets') return 'KTM ETS';
  if (code === 'ktm_intercity') return 'KTM Intercity';
  if (code === 'ktm_shuttle_tebrau') return 'Shuttle Tebrau';
  if (code === 'rapid_rail') return 'Rapid Rail';
  return code;
}

export function classifyStatus(
  loadRatioPct: number | null,
  scheduledCapacity: number | null
): BottleneckStatus {
  if (loadRatioPct === null || scheduledCapacity === null) return 'unavailable';
  if (scheduledCapacity <= 0) return 'no_service';
  if (loadRatioPct > 100.0) return 'deficit';
  if (loadRatioPct >= 80.0) return 'watch';
  return 'within_capacity';
}

export function getSliceMetrics(
  segment: ScreenedSegmentRecord,
  period: PeriodScope,
  dayProfile: DayProfileFilter
): SegmentSliceMetrics | null {
  const key = `${period}|${dayProfile}`;
  return segment.metrics[key] ?? null;
}

export function evaluateSegmentMetrics(
  segment: ScreenedSegmentRecord,
  slice: SegmentSliceMetrics | null,
  statMode: StatMode,
  capacityMode: CapacityMode
): EvaluatedMetricSnapshot {
  if (!slice) {
    return {
      loadRatioPct: null,
      capacityDeficit: null,
      extraTrainsNeeded: null,
      demandValue: null,
      scheduledCapacity: null,
      peakHour: null,
      peakDate: null,
      daysDeficit: 0,
      dailyAvgFlow: null,
      dailyAvgBoardings: null,
      boardingThroughT: null,
      boardingDemandB: null,
      boardingAvailable: null,
      boardingGap: null,
      upstreamAlreadyFull: false,
      status: 'unavailable',
    };
  }

  const isNominal = capacityMode === 'official_2023_nominal';
  const ratioFactor = isNominal ? 1 : segment.train_capacity_80 / segment.train_capacity_nom;

  let loadRatioPct: number | null;
  let capacityDeficit: number | null;
  let extraTrainsNeeded: number | null;
  let demandValue: number | null;
  let scheduledCapacity: number | null;
  let peakHour: number | null;
  let peakDate: string | null = null;

  if (statMode === 'mean') {
    loadRatioPct = isNominal ? slice.mean_peak_lr_nom : slice.mean_peak_lr_80;
    capacityDeficit = isNominal ? slice.mean_peak_def_nom : slice.mean_peak_def_80;
    extraTrainsNeeded = isNominal ? slice.mean_peak_ext_nom : slice.mean_peak_ext_80;
    demandValue = slice.mean_peak_d;
    scheduledCapacity = Math.round(slice.mean_peak_s_nom * ratioFactor);
    peakHour = slice.mean_peak_hr;
  } else if (statMode === 'p90') {
    loadRatioPct = isNominal ? slice.p90_peak_lr_nom : slice.p90_peak_lr_80;
    capacityDeficit = isNominal ? slice.p90_peak_def_nom : slice.p90_peak_def_80;
    extraTrainsNeeded = isNominal ? slice.p90_peak_ext_nom : slice.p90_peak_ext_80;
    scheduledCapacity = Math.round(slice.max_peak_s_nom * ratioFactor);
    // Reconstruct implied P90 passenger equivalent when single-date denominator matches
    demandValue =
      loadRatioPct !== null && scheduledCapacity > 0
        ? Math.round(((loadRatioPct / 100) * scheduledCapacity) * 10) / 10
        : null;
    peakHour = slice.max_peak_hr;
  } else {
    loadRatioPct = isNominal ? slice.max_peak_lr_nom : slice.max_peak_lr_80;
    capacityDeficit = isNominal ? slice.max_peak_def_nom : slice.max_peak_def_80;
    extraTrainsNeeded = isNominal ? slice.max_peak_ext_nom : slice.max_peak_ext_80;
    demandValue = slice.max_peak_d;
    scheduledCapacity = Math.round(slice.max_peak_s_nom * ratioFactor);
    peakHour = slice.max_peak_hr;
    peakDate = slice.max_peak_date;
  }

  // Station boarding metrics scaled accurately to nominal or 80% mode
  const isFallback = segment.boarding_screening_mode === 'fallback_downstream_segment';
  const rawT = statMode === 'mean' ? slice.st_mean_t : slice.st_max_t;
  const rawB = statMode === 'mean' ? slice.st_mean_b : slice.st_max_b;
  const baseCapS = statMode === 'mean' ? slice.mean_peak_s_nom : slice.max_peak_s_nom;
  const scaledCapS = baseCapS * ratioFactor;

  let boardingThroughT: number | null = isFallback ? null : rawT;
  let boardingAvailable: number | null = null;
  let boardingGap: number | null = null;
  let upstreamAlreadyFull = false;

  if (!isFallback && boardingThroughT !== null && baseCapS > 0) {
    upstreamAlreadyFull = boardingThroughT > scaledCapS + 1e-6;
    boardingAvailable = Math.round(Math.max(0, scaledCapS - boardingThroughT) * 10) / 10;
    boardingGap = Math.round(Math.max(0, rawB - boardingAvailable) * 10) / 10;
  }

  return {
    loadRatioPct,
    capacityDeficit,
    extraTrainsNeeded,
    demandValue,
    scheduledCapacity,
    peakHour,
    peakDate,
    daysDeficit: isNominal ? slice.days_deficit_nom : slice.days_deficit_80,
    dailyAvgFlow: slice.daily_avg_flow,
    dailyAvgBoardings: slice.daily_avg_boardings,
    boardingThroughT,
    boardingDemandB: rawB,
    boardingAvailable,
    boardingGap,
    upstreamAlreadyFull,
    status: classifyStatus(loadRatioPct, scheduledCapacity),
  };
}

export function buildDisplayRows(
  summary: CapacityScreeningSummarySchema,
  filters: ScreeningFilters,
  viewMode: 'station' | 'segment'
): DisplayTableRow[] {
  const query = filters.searchQuery.trim().toLowerCase();
  const segById = new Map<string, ScreenedSegmentRecord>(
    summary.segments.map((s) => [s.segment_id, s])
  );

  const outRows: DisplayTableRow[] = [];

  if (viewMode === 'segment') {
    for (const seg of summary.segments) {
      if (filters.network !== 'all' && seg.network_code !== filters.network) continue;
      const slice = getSliceMetrics(seg, filters.period, filters.dayProfile);
      const evalData = evaluateSegmentMetrics(seg, slice, filters.statMode, filters.capacityMode);
      if (filters.statusFilter !== 'all' && evalData.status !== filters.statusFilter) continue;

      if (query) {
        const hay = `${seg.from_station_name} ${seg.to_station_name} ${seg.segment_id} ${seg.routes_serving.join(' ')}`.toLowerCase();
        if (!hay.includes(query)) continue;
      }

      outRows.push({
        rowKey: seg.segment_id,
        kind: 'screened_segment',
        stationKey: `${seg.network_code}:${seg.from_stop_id}`,
        segmentId: seg.segment_id,
        primaryName: `${seg.from_station_name} -> ${seg.to_station_name}`,
        secondaryName: seg.from_station_name,
        directionLabel: `Toward ${seg.to_station_name}`,
        networkCode: seg.network_code,
        networkLabel: getNetworkShortLabel(seg.network_code),
        routesLabel: seg.routes_serving.join(' / '),
        boardingMode: seg.boarding_screening_mode,
        gtfsInterpolated: seg.gtfs_interpolated_missing_stop,
        evalData,
      });
    }
  } else {
    // Station View: pick the highest-load outbound direction for each screened station
    for (const st of summary.stations) {
      if (filters.network !== 'all' && st.network_code !== filters.network) continue;

      let bestSeg: ScreenedSegmentRecord | null = null;
      let bestEval: EvaluatedMetricSnapshot | null = null;

      for (const ref of st.outbound_segments) {
        const seg = segById.get(ref.segment_id);
        if (!seg) continue;
        const slice = getSliceMetrics(seg, filters.period, filters.dayProfile);
        const ev = evaluateSegmentMetrics(seg, slice, filters.statMode, filters.capacityMode);
        if (
          !bestEval ||
          (ev.loadRatioPct ?? -1) > (bestEval.loadRatioPct ?? -1) ||
          ((ev.loadRatioPct ?? -1) === (bestEval.loadRatioPct ?? -1) &&
            (ev.demandValue ?? 0) > (bestEval.demandValue ?? 0))
        ) {
          bestSeg = seg;
          bestEval = ev;
        }
      }

      if (!bestSeg || !bestEval) continue;
      if (filters.statusFilter !== 'all' && bestEval.status !== filters.statusFilter) continue;

      if (query) {
        const dirText = st.outbound_segments.map((d) => d.to_station_name).join(' ');
        const hay = `${st.station_name} ${st.stop_id} ${dirText} ${st.routes_serving.join(' ')}`.toLowerCase();
        if (!hay.includes(query)) continue;
      }

      outRows.push({
        rowKey: st.station_key,
        kind: 'screened_station',
        stationKey: st.station_key,
        segmentId: bestSeg.segment_id,
        primaryName: st.station_name,
        secondaryName: `Peak outbound: -> ${bestSeg.to_station_name}`,
        directionLabel: `-> ${bestSeg.to_station_name}`,
        networkCode: st.network_code,
        networkLabel: getNetworkShortLabel(st.network_code),
        routesLabel: st.routes_serving.join(' / '),
        boardingMode: st.boarding_screening_mode,
        gtfsInterpolated: bestSeg.gtfs_interpolated_missing_stop,
        evalData: bestEval,
      });
    }
  }

  // Append Unavailable Stations when included OR explicitly searching or filtering by 'unavailable'
  const shouldIncludeUnavailable =
    filters.includeUnavailable || filters.statusFilter === 'unavailable' || query.length >= 2;

  if (shouldIncludeUnavailable && (filters.statusFilter === 'all' || filters.statusFilter === 'unavailable')) {
    for (const u of summary.unavailable_stations) {
      if (filters.network !== 'all') {
        // Show KV unmapped Segambut Utara under ktm_komuter_kv filter too so users find it!
        if (!(filters.network === 'ktm_komuter_kv' && u.network_code === 'ktm_komuter_kv_unmapped')) {
          continue;
        }
      }
      if (query) {
        const hay = `${u.station_name} ${u.network_label} ${u.unavailable_code}`.toLowerCase();
        if (!hay.includes(query)) continue;
      }
      outRows.push({
        rowKey: u.station_key,
        kind: 'unavailable_station',
        stationKey: u.station_key,
        primaryName: u.station_name,
        secondaryName: u.network_label,
        directionLabel: 'Screening Unavailable',
        networkCode: u.network_code,
        networkLabel: getNetworkShortLabel(u.network_code),
        routesLabel: 'N/A',
        boardingMode: 'unavailable',
        gtfsInterpolated: false,
        evalData: {
          loadRatioPct: null,
          capacityDeficit: null,
          extraTrainsNeeded: null,
          demandValue: null,
          scheduledCapacity: null,
          peakHour: null,
          peakDate: null,
          daysDeficit: 0,
          dailyAvgFlow: null,
          dailyAvgBoardings: null,
          boardingThroughT: null,
          boardingDemandB: null,
          boardingAvailable: null,
          boardingGap: null,
          upstreamAlreadyFull: false,
          status: 'unavailable',
        },
        unavailableReason: u.unavailable_reason,
        observedPaxWindow: u.observed_pax_gtfs_window,
        observedPaxFull2026: u.observed_pax_full_2026,
      });
    }
  }

  return outRows;
}

export function sortDisplayRows(
  rows: DisplayTableRow[],
  sortField: 'loadRatio' | 'deficit' | 'demand' | 'extraTrains' | 'name',
  sortDir: SortDirection
): DisplayTableRow[] {
  const dirMult = sortDir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Always keep unavailable entries cleanly at the bottom unless sorting strictly by name
    if (sortField !== 'name') {
      const aUn = a.evalData.status === 'unavailable';
      const bUn = b.evalData.status === 'unavailable';
      if (aUn !== bUn) return aUn ? 1 : -1;
    }

    if (sortField === 'name') {
      return a.primaryName.localeCompare(b.primaryName) * dirMult;
    }

    const pick = (r: DisplayTableRow): number => {
      if (sortField === 'loadRatio') return r.evalData.loadRatioPct ?? -1;
      if (sortField === 'deficit') return r.evalData.capacityDeficit ?? -1;
      if (sortField === 'demand') return r.evalData.demandValue ?? -1;
      return r.evalData.extraTrainsNeeded ?? -1;
    };

    const diff = pick(a) - pick(b);
    if (diff !== 0) return diff * dirMult;
    return a.primaryName.localeCompare(b.primaryName);
  });
}

export function computeKpiSummary(
  summary: CapacityScreeningSummarySchema,
  filters: ScreeningFilters
): DynamicKpiSummary {
  const sliceKey = `${filters.period}|${filters.dayProfile}`;
  const activeDaysCount = summary.metadata.slice_day_counts[sliceKey] ?? 0;

  let peakLoadRatioPct: number | null = null;
  let peakSegmentLabel = 'No Active Segments';
  let peakContextLabel = 'Select an active Komuter corridor';
  let oversubscribedCount = 0;
  let watchCount = 0;
  let totalEvaluatedCount = 0;
  let totalSegmentDeficitDays = 0;
  let maxSingleSegmentExtraTrains = 0;
  let maxExtraTrainsSegmentLabel = 'None needed';

  for (const seg of summary.segments) {
    if (filters.network !== 'all' && seg.network_code !== filters.network) continue;
    const slice = getSliceMetrics(seg, filters.period, filters.dayProfile);
    const ev = evaluateSegmentMetrics(seg, slice, filters.statMode, filters.capacityMode);
    if (ev.status === 'unavailable') continue;

    totalEvaluatedCount += 1;
    if (ev.status === 'deficit') oversubscribedCount += 1;
    else if (ev.status === 'watch') watchCount += 1;
    totalSegmentDeficitDays += ev.daysDeficit;

    const segName = `${seg.from_station_name} -> ${seg.to_station_name}`;
    if (ev.loadRatioPct !== null && (peakLoadRatioPct === null || ev.loadRatioPct > peakLoadRatioPct)) {
      peakLoadRatioPct = ev.loadRatioPct;
      peakSegmentLabel = segName;
      const hrText = formatHourLabel(ev.peakHour);
      peakContextLabel = ev.peakDate
        ? `${getNetworkShortLabel(seg.network_code)} | ${hrText} on ${ev.peakDate}`
        : `${getNetworkShortLabel(seg.network_code)} | ${hrText}`;
    }

    if ((ev.extraTrainsNeeded ?? 0) > maxSingleSegmentExtraTrains) {
      maxSingleSegmentExtraTrains = ev.extraTrainsNeeded ?? 0;
      maxExtraTrainsSegmentLabel = `${segName} (${getNetworkShortLabel(seg.network_code)})`;
    }
  }

  return {
    peakLoadRatioPct,
    peakSegmentLabel,
    peakContextLabel,
    oversubscribedCount,
    watchCount,
    totalEvaluatedCount,
    totalSegmentDeficitDays,
    maxSingleSegmentExtraTrains,
    maxExtraTrainsSegmentLabel,
    activeDaysCount,
  };
}

export function generateDynamicDirectives(
  summary: CapacityScreeningSummarySchema,
  filters: ScreeningFilters,
  kpis: DynamicKpiSummary
): DynamicDirectiveItem[] {
  const topByNet = (net: NetworkCode): { label: string; ratio: number | null; ext: number; hr: number | null; days: number } | null => {
    let best: { label: string; ratio: number; ext: number; hr: number | null; days: number } | null = null;
    for (const seg of summary.segments) {
      if (seg.network_code !== net) continue;
      const ev = evaluateSegmentMetrics(
        seg,
        getSliceMetrics(seg, filters.period, filters.dayProfile),
        filters.statMode,
        filters.capacityMode
      );
      if (ev.loadRatioPct !== null && (!best || ev.loadRatioPct > best.ratio)) {
        best = {
          label: `${seg.from_station_name} -> ${seg.to_station_name}`,
          ratio: ev.loadRatioPct,
          ext: ev.extraTrainsNeeded ?? 0,
          hr: ev.peakHour,
          days: ev.daysDeficit,
        };
      }
    }
    return best;
  };

  const kvTop = topByNet('ktm_komuter_kv');
  const utaraTop = topByNet('ktm_komuter_utara');
  const modeLabel = filters.capacityMode === 'official_2023_nominal' ? 'Nominal Rate Card' : '80% Comfort Sensitivity';

  const directives: DynamicDirectiveItem[] = [];

  if (utaraTop && (filters.network === 'all' || filters.network === 'ktm_komuter_utara')) {
    directives.push({
      id: 'utara_peak_pressure',
      badge: utaraTop.ratio && utaraTop.ratio > 100 ? 'Capacity Deficit' : 'Watch',
      tone: utaraTop.ratio && utaraTop.ratio > 100 ? 'crimson' : 'amber',
      title: 'Komuter Utara 3-Car EMU Bottleneck Relief',
      metricHighlight: `${utaraTop.label} (${utaraTop.ratio?.toFixed(1)}% | +${utaraTop.ext} trains)`,
      description: `Single 3-car EMU departures (400-pax reference) on the Northern spine trigger ${utaraTop.days} deficit day(s) in the selected window under ${modeLabel}, peaking at ${formatHourLabel(utaraTop.hr)}.`,
      actionHint: 'Evaluate 6-car double-set coupling or targeted weekend/festive relief departures north of Bukit Mertajam.',
    });
  }

  if (kvTop && (filters.network === 'all' || filters.network === 'ktm_komuter_kv')) {
    directives.push({
      id: 'kvdt2_seremban_corridor',
      badge: kvTop.ratio && kvTop.ratio > 100 ? 'KVDT2 Bottleneck' : kvTop.ratio && kvTop.ratio >= 80 ? 'Near Threshold' : 'Within Limit',
      tone: kvTop.ratio && kvTop.ratio > 100 ? 'crimson' : kvTop.ratio && kvTop.ratio >= 80 ? 'amber' : 'cobalt',
      title: 'KVDT2 Southern Seremban Corridor Compression',
      metricHighlight: `${kvTop.label} (${kvTop.ratio?.toFixed(1)}%)`,
      description: `KVDT2 track closures confine through-Seremban weekday departures to 5 peak trips each way, concentrating demand along Kajang–Bangi segments (${formatHourLabel(kvTop.hr)}).`,
      actionHint: 'Monitor Seremban–Kajang load evolution alongside off-peak Salak Selatan shuttle feeder transfers until KVDT2 completes.',
    });
  }

  directives.push({
    id: 'data_coverage_integrity',
    badge: 'Coverage Scope',
    tone: 'slate',
    title: 'Multi-Network Verification & Honest Boundaries',
    metricHighlight: `${kpis.totalEvaluatedCount} screened segments | ${summary.unavailable_stations.length} unavailable nodes`,
    description: `Capacity deficits cover 2026-08-18..2026-11-26 GTFS overlap only. Rapid Rail (daily-only), ETS/Intercity (seated-only mix), Shuttle Tebrau, and Segambut Utara (absent from GTFS) remain unfabricated.`,
    actionHint: 'Inspect the Coverage & Feasibility Matrix before comparing service performance across ETS or Rapid Rail lines.',
  });

  return directives;
}

function csvEscape(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function serializeRowsToCsv(
  rows: DisplayTableRow[],
  filters: ScreeningFilters,
  viewMode: 'station' | 'segment'
): string {
  const headers = [
    'View Mode',
    'Name',
    'Direction / Service',
    'Network',
    'Routes',
    'Status',
    'Peak Load Ratio (%)',
    'Demand (pax/hr)',
    'Scheduled Capacity (pax/hr)',
    'Capacity Deficit (pax)',
    'Extra Trains Needed (per segment)',
    'Peak Clock Hour',
    'Peak Observed Date',
    'Deficit Days Count',
    'Through Load T (pax)',
    'Station Boarding B (pax)',
    'Available Boarding Capacity (pax)',
    'Boarding Capacity Gap (pax)',
    'Boarding Screening Mode',
    'Capacity Mode',
    'Stat Aggregator',
    'Period Scope',
    'Day Profile',
    'GTFS Interpolated Southbound KKB/Rasa',
    'Unavailable Reason',
  ];

  const lines = [headers.map(csvEscape).join(',')];

  for (const r of rows) {
    const e = r.evalData;
    const isUnavail = e.status === 'unavailable';
    const rowVals = [
      viewMode,
      r.primaryName,
      r.directionLabel,
      r.networkLabel,
      r.routesLabel,
      e.status,
      isUnavail ? '' : e.loadRatioPct,
      isUnavail ? '' : e.demandValue,
      isUnavail ? '' : e.scheduledCapacity,
      isUnavail ? '' : e.capacityDeficit,
      isUnavail ? '' : e.extraTrainsNeeded,
      isUnavail ? '' : formatHourLabel(e.peakHour),
      e.peakDate ?? '',
      isUnavail ? '' : e.daysDeficit,
      e.boardingThroughT,
      e.boardingDemandB,
      e.boardingAvailable,
      e.boardingGap,
      r.boardingMode,
      filters.capacityMode,
      filters.statMode,
      filters.period,
      filters.dayProfile,
      r.gtfsInterpolated ? 'true' : 'false',
      r.unavailableReason ?? '',
    ];
    lines.push(rowVals.map(csvEscape).join(','));
  }

  return lines.join('\n');
}
