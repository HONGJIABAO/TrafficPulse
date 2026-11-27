export interface MonthlyTrendEntry {
  year_month: string;
  year: number;
  month: number;
  days?: number;
  total: number;
  lines: Record<string, number>;
  line_days?: Record<string, number>;
}

export interface HeadlineResolution {
  /** Exact key in monthly_trend[].lines & line_performance[].line, or null when All Lines / unmeasured */
  headlineLine: string | null;
  /** True when user selected an individual geographical branch of a combined official headline series */
  isCombinedBranch: boolean;
  /** Explanatory label when showing combined parent data for a branch selection */
  combinedLabel?: string;
}

export interface YtdSummary {
  hasHeadlineData: boolean;
  headlineLine: string | null;
  isCombinedBranch: boolean;
  combinedLabel?: string;
  ytdTrips: number | null;
  prevYtdTrips: number | null;
  ytdGrowthPct: number | null;
  periodLabel: string;
  comparisonPeriodLabel: string;
}

export const HEADLINE_SERVICE_NAMES = [
  'LRT Kelana Jaya',
  'MRT Kajang',
  'LRT Ampang–Sri Petaling',
  'MRT Putrajaya',
  'KL Monorail',
  'LRT Shah Alam',
  'KTM Komuter',
  'KTM Komuter Utara',
  'KTM ETS',
  'KTM Tebrau Shuttle',
  'KTM Intercity',
] as const;

const HEADLINE_SET = new Set<string>(HEADLINE_SERVICE_NAMES);

const EXACT_ROUTE_ALIASES: Record<string, string> = {
  'KTM Shuttle Tebrau': 'KTM Tebrau Shuttle',
};

const BRANCH_TO_COMBINED_HEADLINE: Record<string, string> = {
  'LRT Ampang': 'LRT Ampang–Sri Petaling',
  'LRT Sri Petaling': 'LRT Ampang–Sri Petaling',
  'KTM Komuter Utara (Ipoh)': 'KTM Komuter Utara',
  'KTM Komuter Utara (Padang Besar)': 'KTM Komuter Utara',
  'KTM Komuter (Seremban Line)': 'KTM Komuter',
  'KTM Komuter (Port Klang Line)': 'KTM Komuter',
  'KTM Komuter (Batu Caves Line)': 'KTM Komuter',
  'KTM Intercity Shuttle': 'KTM Intercity',
  'KTM Ekspres Rakyat Timuran': 'KTM Intercity',
  'KTM Komuter Shuttle Selatan': 'KTM Intercity',
};

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Normalize map-clicked route names where a 1-to-1 official headline name differs only in word order. */
export function normalizeSelectedLine(lineName: string): string {
  return EXACT_ROUTE_ALIASES[lineName] ?? lineName;
}

/** Resolve any geographical route / dropdown selection to its official headline service without splitting combined totals. */
export function resolveHeadlineSeries(selectedLine: string): HeadlineResolution {
  if (selectedLine === 'All Lines') {
    return { headlineLine: null, isCombinedBranch: false };
  }
  const canonical = normalizeSelectedLine(selectedLine);
  if (HEADLINE_SET.has(canonical)) {
    return { headlineLine: canonical, isCombinedBranch: false };
  }
  const combinedParent = BRANCH_TO_COMBINED_HEADLINE[selectedLine];
  if (combinedParent) {
    return {
      headlineLine: combinedParent,
      isCombinedBranch: true,
      combinedLabel: `Combined ${combinedParent}`,
    };
  }
  return { headlineLine: null, isCombinedBranch: false };
}

/** Return true if a month entry has non-missing observed days for the resolved headline scope. */
function hasMonthObservation(entry: MonthlyTrendEntry, headlineLine: string | null): boolean {
  if (!headlineLine) {
    return (entry.days ?? (entry.total > 0 ? 1 : 0)) > 0;
  }
  if (entry.line_days) {
    return (entry.line_days[headlineLine] ?? 0) > 0;
  }
  return (entry.lines[headlineLine] ?? 0) > 0;
}

function getMonthTrips(entry: MonthlyTrendEntry, headlineLine: string | null): number {
  return headlineLine ? (entry.lines[headlineLine] ?? 0) : (entry.total || 0);
}

/**
 * Compute dynamic equivalent-period Year-to-Date trips & growth without treating missing history as zero.
 * Comparable baseline requires observed months 1..M in both current year and previous year with aligned coverage.
 */
export function computeYtdSummary(
  monthlyTrend: MonthlyTrendEntry[],
  selectedLine: string,
  playbackIdx: number,
): YtdSummary {
  const res = resolveHeadlineSeries(selectedLine);
  if (selectedLine !== 'All Lines' && !res.headlineLine) {
    return {
      hasHeadlineData: false,
      headlineLine: null,
      isCombinedBranch: false,
      ytdTrips: null,
      prevYtdTrips: null,
      ytdGrowthPct: null,
      periodLabel: 'Unavailable',
      comparisonPeriodLabel: 'No ridership supplied for this line',
    };
  }

  const endEntry = monthlyTrend[playbackIdx] ?? monthlyTrend[monthlyTrend.length - 1];
  if (!endEntry) {
    return {
      hasHeadlineData: false,
      headlineLine: res.headlineLine,
      isCombinedBranch: res.isCombinedBranch,
      combinedLabel: res.combinedLabel,
      ytdTrips: null,
      prevYtdTrips: null,
      ytdGrowthPct: null,
      periodLabel: 'Unavailable',
      comparisonPeriodLabel: 'No observations available',
    };
  }

  const endYear = endEntry.year;
  const endMonth = endEntry.month;
  const currMonths = monthlyTrend.filter((m) => m.year === endYear && m.month <= endMonth);
  const prevMonths = monthlyTrend.filter((m) => m.year === endYear - 1 && m.month <= endMonth);

  const activeCurr = currMonths.filter((m) => hasMonthObservation(m, res.headlineLine));
  if (activeCurr.length === 0) {
    return {
      hasHeadlineData: true,
      headlineLine: res.headlineLine,
      isCombinedBranch: res.isCombinedBranch,
      combinedLabel: res.combinedLabel,
      ytdTrips: null,
      prevYtdTrips: null,
      ytdGrowthPct: null,
      periodLabel: `${MONTH_SHORT[0]}–${MONTH_SHORT[endMonth - 1]} ${endYear}`,
      comparisonPeriodLabel: 'No observations in selected year',
    };
  }

  const ytdTrips = activeCurr.reduce((acc, m) => acc + getMonthTrips(m, res.headlineLine), 0);
  const firstActiveMonth = activeCurr[0].month;
  const lastActiveMonth = activeCurr[activeCurr.length - 1].month;
  const activeSpanLabel =
    firstActiveMonth === lastActiveMonth
      ? `${MONTH_SHORT[lastActiveMonth - 1]} ${endYear}`
      : `${MONTH_SHORT[firstActiveMonth - 1]}–${MONTH_SHORT[lastActiveMonth - 1]} ${endYear}`;

  const ytdScopeLabel =
    firstActiveMonth === 1
      ? (endMonth === 1 ? `Jan ${endYear}` : `Jan–${MONTH_SHORT[endMonth - 1]} ${endYear}`)
      : activeSpanLabel;

  // Equivalent baseline requires every month 1..endMonth present in both years with positive observed days
  // and equivalent first-month full coverage (prevents comparing partial launch month e.g. 15d vs 30d).
  const currByMonth = new Map(currMonths.map((m) => [m.month, m]));
  const prevByMonth = new Map(prevMonths.map((m) => [m.month, m]));
  let comparable = currMonths.length === endMonth && prevMonths.length === endMonth;
  if (comparable) {
    for (let m = 1; m <= endMonth; m++) {
      const c = currByMonth.get(m);
      const p = prevByMonth.get(m);
      if (!c || !p || !hasMonthObservation(c, res.headlineLine) || !hasMonthObservation(p, res.headlineLine)) {
        comparable = false;
        break;
      }
      if (res.headlineLine && c.line_days && p.line_days) {
        const cDays = c.line_days[res.headlineLine] ?? 0;
        const pDays = p.line_days[res.headlineLine] ?? 0;
        // Guard against partial-launch opening months (e.g. Jun 2022 15d vs Jun 2023 30d)
        if (Math.abs(cDays - pDays) > 2) {
          comparable = false;
          break;
        }
      }
    }
  }

  if (!comparable) {
    return {
      hasHeadlineData: true,
      headlineLine: res.headlineLine,
      isCombinedBranch: res.isCombinedBranch,
      combinedLabel: res.combinedLabel,
      ytdTrips,
      prevYtdTrips: null,
      ytdGrowthPct: null,
      periodLabel: ytdScopeLabel,
      comparisonPeriodLabel: `${ytdScopeLabel} · Prior-year YTD N/A`,
    };
  }

  const prevYtdTrips = prevMonths.reduce((acc, m) => acc + getMonthTrips(m, res.headlineLine), 0);
  if (prevYtdTrips <= 0) {
    return {
      hasHeadlineData: true,
      headlineLine: res.headlineLine,
      isCombinedBranch: res.isCombinedBranch,
      combinedLabel: res.combinedLabel,
      ytdTrips,
      prevYtdTrips: null,
      ytdGrowthPct: null,
      periodLabel: ytdScopeLabel,
      comparisonPeriodLabel: `${ytdScopeLabel} · Prior-year YTD N/A`,
    };
  }

  const rawPct = ((ytdTrips - prevYtdTrips) / prevYtdTrips) * 100;
  const ytdGrowthPct = Math.round(rawPct * 100) / 100;
  const eqLabel =
    endMonth === 1
      ? `Jan ${endYear} vs ${endYear - 1}`
      : `Jan–${MONTH_SHORT[endMonth - 1]} ${endYear} vs ${endYear - 1}`;

  return {
    hasHeadlineData: true,
    headlineLine: res.headlineLine,
    isCombinedBranch: res.isCombinedBranch,
    combinedLabel: res.combinedLabel,
    ytdTrips,
    prevYtdTrips,
    ytdGrowthPct,
    periodLabel: ytdScopeLabel,
    comparisonPeriodLabel: eqLabel,
  };
}
