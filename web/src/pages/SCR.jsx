// Faithful clone of /auth/scr — Sales Comparison Report.
// Filters → Daily comparison table + line chart, Performance Matrix,
// Donut (target vs achieved), Yearly comparison bar chart.
// SQL queried directly via the hardened /api/sql passthrough.

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { useSqlQuery } from '@/lib/api';
import { fmtCurrency, fmtCompact, fmtPercent, fmtCompactCurrency, fmtNumber } from '@/lib/format';
import {
  TrendingUp, TrendingDown, Target, Calendar, CalendarDays, Zap, Trophy, Activity,
  Award, AlertTriangle, BarChart3, ArrowUpRight, ArrowDownRight,
  Flame, CheckCircle2, XCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ComposedChart,
  Bar,
} from 'recharts';

const STORES = [
  { value: 'ARDEN', label: 'S1 · Arden' },
  { value: 'WAYNESVILLE', label: 'S2 · Waynesville' },
];

const CATEGORIES = [
  { value: 'Written', label: 'Written' },
  { value: 'Delivered', label: 'Delivered' },
];

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function daysIn(monthIdx, year) {
  return new Date(year, monthIdx + 1, 0).getDate();
}

// SQL — SCR daily comparison. Mirrors original scr.js but in MS SQL syntax.
function buildDailySql(category) {
  const isW = category === 'Written';
  const cy = isW ? 'CurrentYear_W' : 'CurrentYear_D';
  const ly = isW ? 'LastYear_W' : 'LastYear_D';
  const cat = isW ? 'SaleCategory_W' : 'SaleCategory_D';
  return `SELECT x.DayMonth, x.LastYear, x.ThisYear,
                 (ISNULL(x.ThisYear,0) - ISNULL(x.LastYear,0)) AS Difference,
                 SUM(ISNULL(x.ThisYear,0)) OVER (ORDER BY x.SortDay) AS TYR,
                 SUM(ISNULL(x.LastYear,0)) OVER (ORDER BY x.SortDay) AS LYR
          FROM (
            SELECT s.DayMonth,
                   s.${cy} AS ThisYear,
                   s.${ly} AS LastYear,
                   s.${cat} AS SaleCategory,
                   s.ProfitCenter,
                   CAST(LEFT(s.DayMonth, CHARINDEX('-', s.DayMonth) - 1) AS INT) AS SortDay
            FROM SalesAggrDayWiseReport s
          ) x
          WHERE x.ProfitCenter = ? AND x.DayMonth LIKE ? AND x.SaleCategory = ?
          ORDER BY x.SortDay`;
}

// SQL — Weekly sales for the selected month (groups days into 1-7 / 8-14 / 15-21 / 22-28 / 29+).
function buildWeeklySql(category) {
  const isW = category === 'Written';
  const cy = isW ? 'CurrentYear_W' : 'CurrentYear_D';
  const ly = isW ? 'LastYear_W' : 'LastYear_D';
  return `WITH d AS (
            SELECT
              CAST(LEFT(DayMonth, 2) AS INT) AS dayNum,
              ISNULL(${cy}, 0) AS ty,
              ISNULL(${ly}, 0) AS ly
            FROM SalesAggrDayWiseReport
            WHERE ProfitCenter = ? AND DayMonth LIKE ?
          )
          SELECT
            CASE
              WHEN dayNum BETWEEN 1 AND 7 THEN 'Week 1 (1-7)'
              WHEN dayNum BETWEEN 8 AND 14 THEN 'Week 2 (8-14)'
              WHEN dayNum BETWEEN 15 AND 21 THEN 'Week 3 (15-21)'
              WHEN dayNum BETWEEN 22 AND 28 THEN 'Week 4 (22-28)'
              ELSE 'Week 5 (29+)'
            END AS weekRange,
            SUM(ty) AS ThisYear,
            SUM(ly) AS LastYear,
            MIN(dayNum) AS sortKey
          FROM d
          GROUP BY
            CASE
              WHEN dayNum BETWEEN 1 AND 7 THEN 'Week 1 (1-7)'
              WHEN dayNum BETWEEN 8 AND 14 THEN 'Week 2 (8-14)'
              WHEN dayNum BETWEEN 15 AND 21 THEN 'Week 3 (15-21)'
              WHEN dayNum BETWEEN 22 AND 28 THEN 'Week 4 (22-28)'
              ELSE 'Week 5 (29+)'
            END
          ORDER BY sortKey`;
}

// SQL — Quarterly totals (Q1..Q4) for the selected store + category.
function buildQuarterlySql(category) {
  const isW = category === 'Written';
  const cy = isW ? 'CurrentYear_W' : 'CurrentYear_D';
  const ly = isW ? 'LastYear_W' : 'LastYear_D';
  const cat = isW ? 'SaleCategory_W' : 'SaleCategory_D';
  return `SELECT
            CASE
              WHEN MonthName IN ('January','February','March') THEN 'Q1 · Jan-Mar'
              WHEN MonthName IN ('April','May','June')         THEN 'Q2 · Apr-Jun'
              WHEN MonthName IN ('July','August','September')  THEN 'Q3 · Jul-Sep'
              ELSE 'Q4 · Oct-Dec'
            END AS Quarter,
            SUM(ISNULL(${cy}, 0)) AS ThisYear,
            SUM(ISNULL(${ly}, 0)) AS LastYear
          FROM SalesAggrMonthWiseReport
          WHERE ProfitCenter = ? AND ${cat} = ?
          GROUP BY
            CASE
              WHEN MonthName IN ('January','February','March') THEN 'Q1 · Jan-Mar'
              WHEN MonthName IN ('April','May','June')         THEN 'Q2 · Apr-Jun'
              WHEN MonthName IN ('July','August','September')  THEN 'Q3 · Jul-Sep'
              ELSE 'Q4 · Oct-Dec'
            END
          ORDER BY 1`;
}

// SQL — Yearly Written + Delivered side-by-side for one store.
const yearlyDualSql = `
  SELECT MonthName,
         ISNULL(CurrentYear_W, 0) AS w_thisYear,
         ISNULL(LastYear_W, 0)    AS w_lastYear,
         ISNULL(CurrentYear_D, 0) AS d_thisYear,
         ISNULL(LastYear_D, 0)    AS d_lastYear
  FROM SalesAggrMonthWiseReport
  WHERE ProfitCenter = ?
  ORDER BY CASE MonthName
    WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
    WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
    WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
    WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
  END
`;

// SQL — 4 years report. Honors the active category filter (Written or
// Delivered) so the four columns are pure per-category, not combined.
function buildFourYearSql(category) {
  const isW = category === 'Written';
  const cy = isW ? 'CurrentYear_W' : 'CurrentYear_D';
  const ly = isW ? 'LastYear_W'    : 'LastYear_D';
  const py = isW ? 'PreviousYear_W': 'PreviousYear_D';
  const pp = isW ? 'Previous_W'    : 'Previous_D';
  return `
    SELECT MonthName,
           ISNULL(${cy}, 0) AS thisYear,
           ISNULL(${ly}, 0) AS lastYear,
           ISNULL(${py}, 0) AS prevYear,
           ISNULL(${pp}, 0) AS earlier
    FROM SalesAggrMonthWiseReport
    WHERE ProfitCenter = ?
    ORDER BY CASE MonthName
      WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
      WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
      WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
      WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
    END
  `;
}

// SQL — Monthly comparison for the whole year (drives Performance Matrix and yearly chart)
function buildMonthlySql(category) {
  const isW = category === 'Written';
  const cy = isW ? 'CurrentYear_W' : 'CurrentYear_D';
  const ly = isW ? 'LastYear_W' : 'LastYear_D';
  const py = isW ? 'PreviousYear_W' : 'PreviousYear_D';
  const pp = isW ? 'Previous_W' : 'Previous_D';
  const cat = isW ? 'SaleCategory_W' : 'SaleCategory_D';
  return `SELECT MonthName,
                 ${cy} AS ThisYear,
                 ${ly} AS LastYear,
                 ${py} AS PreviousYear,
                 ${pp} AS Previous
          FROM SalesAggrMonthWiseReport
          WHERE ProfitCenter = ? AND ${cat} = ?
          ORDER BY CASE MonthName
            WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
            WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
            WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
            WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
          END`;
}

// Pulls weekly + monthly sales from the raw SaleWRT table (last 2 years).
// Drives the Quick Reports row: best-week, avg weekly, avg monthly. The
// store prefix (1 / 2) maps to ARDEN / WAYNESVILLE so this query honors the
// same store filter as the rest of the page.
function buildWeeklySalesSql(storeKey) {
  const pftCtr = storeKey === 'ARDEN' ? 1 : 2;
  return `
    SELECT
      YEAR(wrt_cng_bdat)               AS year_num,
      DATEPART(WEEK, wrt_cng_bdat)     AS week_num,
      DATEPART(MONTH, wrt_cng_bdat)    AS month_num,
      MIN(CAST(wrt_cng_bdat AS DATE))  AS week_start,
      SUM(wrt_sls)                     AS revenue
    FROM SaleWRT
    WHERE wrt_cng_bdat >= DATEADD(YEAR, -2, CAST(GETDATE() AS DATE))
      AND wrt_pft_ctr = ${pftCtr}
    GROUP BY YEAR(wrt_cng_bdat), DATEPART(WEEK, wrt_cng_bdat), DATEPART(MONTH, wrt_cng_bdat)
    ORDER BY year_num, week_num
  `;
}

const SCR_CURRENT_YEAR = new Date().getFullYear();

// Weekday for a given day-of-month in a given month/year. Built from local
// Y/M/D parts (not a SQL date) so there's no UTC off-by-one to worry about.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function weekdayFor(dayNum, monthIdx, year) {
  const dow = new Date(year, monthIdx, dayNum).getDay();
  return { name: WEEKDAYS[dow], weekend: dow === 0 || dow === 6 };
}

// Weekday cell styling — weekends get an amber tint so they stand out.
const dayCellClass = (d) => cn(
  'px-3 py-2 text-center text-xs font-semibold',
  d.weekend ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'text-muted-fg',
);

export default function SCR() {
  const today = new Date();
  const [store, setStore] = useState('ARDEN');
  const [category, setCategory] = useState('Written');
  const [monthIdx, setMonthIdx] = useState(today.getMonth());
  const [align, setAlign] = useState('date'); // 'date' = same calendar date, 'weekday' = same day of week
  const monthName = MONTHS[monthIdx];

  const dailyQry = useMemo(() => buildDailySql(category), [category]);
  const monthlyQry = useMemo(() => buildMonthlySql(category), [category]);
  const weeklyQry = useMemo(() => buildWeeklySql(category), [category]);
  const quarterlyQry = useMemo(() => buildQuarterlySql(category), [category]);

  const daily = useSqlQuery(dailyQry, [store, `%${monthName}`, category]);
  const monthly = useSqlQuery(monthlyQry, [store, category]);
  const weekly = useSqlQuery(weeklyQry, [store, `%${monthName}`]);
  const quarterly = useSqlQuery(quarterlyQry, [store, category]);
  const yearly = useSqlQuery(yearlyDualSql, [store]);
  const fourYearQry = useMemo(() => buildFourYearSql(category), [category]);
  const fourYear = useSqlQuery(fourYearQry, [store]);

  const dailyRows = daily.data?.rows ?? [];

  // Daily comparison rows — supports two pairing modes:
  //   'date'    — this year's day D vs last year's SAME calendar date (D).
  //   'weekday' — this year's day D vs last year's SAME weekday. Because the
  //               calendar shifts ~1 day/year, we offset last year's series by
  //               a constant amount for the month so Sat lines up with Sat.
  // Running totals are recomputed from whichever pairing is active.
  const dailyDisplay = useMemo(() => {
    const lyByDay = new Map();
    dailyRows.forEach((r) => {
      lyByDay.set(parseInt(String(r.DayMonth).split('-')[0], 10), Number(r.LastYear) || 0);
    });
    // Weekday offset from day 1 of the month (this year vs last year).
    const wdTY1 = new Date(SCR_CURRENT_YEAR, monthIdx, 1).getDay();
    const wdLY1 = new Date(SCR_CURRENT_YEAR - 1, monthIdx, 1).getDay();
    const raw = (wdTY1 - wdLY1 + 7) % 7;      // 0..6
    const offset = raw > 3 ? raw - 7 : raw;   // nearest signed shift (−3..+3)

    let lyRun = 0, tyRun = 0;
    return dailyRows.map((r) => {
      const dayNum = parseInt(String(r.DayMonth).split('-')[0], 10);
      const ty = Number(r.ThisYear) || 0;
      let ly, alignedDay = null, lyExists = true;
      if (align === 'weekday') {
        alignedDay = dayNum + offset;
        if (lyByDay.has(alignedDay)) ly = lyByDay.get(alignedDay);
        else { ly = null; lyExists = false; }   // aligned day falls outside this month
      } else {
        ly = Number(r.LastYear) || 0;
      }
      tyRun += ty;
      if (ly != null) lyRun += ly;
      const diff = ly == null ? null : ty - ly;
      const dTY = weekdayFor(dayNum, monthIdx, SCR_CURRENT_YEAR);
      // In weekday mode the LY weekday equals the TY weekday (that's the point).
      const dLY = align === 'weekday' ? dTY : weekdayFor(dayNum, monthIdx, SCR_CURRENT_YEAR - 1);
      return { DayMonth: r.DayMonth, ty, ly, diff, lyRun, tyRun, dTY, dLY, alignedDay, lyExists };
    });
  }, [dailyRows, align, monthIdx]);

  const monthlyRows = monthly.data?.rows ?? [];
  const weeklyRows = weekly.data?.rows ?? [];
  const quarterlyRows = quarterly.data?.rows ?? [];
  const yearlyRows = yearly.data?.rows ?? [];
  const fourYearRows = fourYear.data?.rows ?? [];

  // Weekly sales query (last 2 years from SaleWRT) — drives Quick Reports.
  const weeklySalesQry = useMemo(() => buildWeeklySalesSql(store), [store]);
  const weeklySales    = useSqlQuery(weeklySalesQry, []);
  const quickStats = useMemo(() => {
    const rows = weeklySales.data?.rows ?? [];
    if (!rows.length) {
      return { bestWeekThisYear: null, bestWeekLastYear: null,
        avgWeekly: 0, avgMonthly: 0, weeksThisYear: 0, monthsThisYear: 0 };
    }
    const fmtWeekStart = (raw) => {
      if (!raw) return '';
      const d = new Date(raw);
      if (isNaN(d)) return String(raw);
      // Render in UTC — SQL dates arrive as UTC midnight, so local rendering
      // would shift the day back (Aug 1 → "Jul 31") for viewers west of UTC.
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };
    let bestThis = { revenue: 0, week: null, start: null };
    let bestLast = { revenue: 0, week: null, start: null };
    let totalThis = 0;
    const weeksThis = new Set();
    const monthRevenueThis = new Map();
    for (const r of rows) {
      const yr  = Number(r.year_num)  || 0;
      const wk  = Number(r.week_num)  || 0;
      const mn  = Number(r.month_num) || 0;
      const rev = Number(r.revenue)   || 0;
      if (yr === SCR_CURRENT_YEAR) {
        if (rev > bestThis.revenue) bestThis = { revenue: rev, week: wk, start: fmtWeekStart(r.week_start) };
        totalThis += rev;
        weeksThis.add(wk);
        monthRevenueThis.set(mn, (monthRevenueThis.get(mn) || 0) + rev);
      } else if (yr === SCR_CURRENT_YEAR - 1) {
        if (rev > bestLast.revenue) bestLast = { revenue: rev, week: wk, start: fmtWeekStart(r.week_start) };
      }
    }
    const weeksCount  = weeksThis.size;
    const monthsCount = monthRevenueThis.size;
    return {
      bestWeekThisYear: bestThis.revenue > 0 ? bestThis : null,
      bestWeekLastYear: bestLast.revenue > 0 ? bestLast : null,
      avgWeekly:  weeksCount  ? totalThis / weeksCount  : 0,
      avgMonthly: monthsCount ? totalThis / monthsCount : 0,
      weeksThisYear:  weeksCount,
      monthsThisYear: monthsCount,
    };
  }, [weeklySales.data]);

  // Performance Matrix — derived from monthly rows + today's date
  const matrix = useMemo(() => {
    const cur = monthlyRows.find((r) => r.MonthName === monthName);
    if (!cur) return null;
    const isCurrent = monthIdx === today.getMonth();
    const dayOfMonth = today.getDate();
    const days = daysIn(monthIdx, today.getFullYear());
    const ty = Number(cur.ThisYear) || 0;
    const ly = Number(cur.LastYear) || 0;
    const target = ly * 1.10;
    // We sum only fully-completed days (everything before today). Today's row
    // may or may not exist in the aggregator yet — and if it does it's a
    // partial-day total, which would inflate the average and trending.
    const daysElapsed = isCurrent ? Math.max(1, dayOfMonth - 1) : days;
    const daysRemaining = isCurrent ? Math.max(0, days - daysElapsed) : 0;

    // MTD = sum of dailyRows.ThisYear and .LastYear through end of yesterday.
    let mtdTy = 0, mtdLy = 0;
    dailyRows.forEach((r) => {
      const day = parseInt(String(r.DayMonth).split('-')[0], 10);
      if (!isCurrent || day < dayOfMonth) {
        mtdTy += Number(r.ThisYear) || 0;
        mtdLy += Number(r.LastYear) || 0;
      }
    });

    const trending = isCurrent && daysElapsed > 0 ? (mtdTy / daysElapsed) * days : ty;

    // Fair YoY comparison — for an in-progress month, compare MTD-vs-MTD
    // (same number of days). For a completed past month, compare full-vs-full.
    const fairTyValue = isCurrent ? mtdTy : ty;
    const fairLyValue = isCurrent ? mtdLy : ly;
    const fairYoyPct  = fairLyValue > 0
      ? ((fairTyValue - fairLyValue) / fairLyValue) * 100
      : null;

    return {
      mtdTy,
      mtdLy,
      monthTotalTy: ty,
      monthTotalLy: ly,
      avgTy: days ? ty / days : 0,
      avgLy: days ? ly / days : 0,
      avgTillDateTy: daysElapsed ? mtdTy / daysElapsed : 0,
      avgTillDateLy: daysElapsed ? mtdLy / daysElapsed : 0,
      target,
      avgReqd: daysRemaining ? (target - mtdTy) / daysRemaining : null,
      trending,
      isCurrent,
      daysElapsed,
      days,
      fairTyValue,
      fairLyValue,
      fairYoyPct,
    };
  }, [monthlyRows, dailyRows, monthName, monthIdx, today]);

  // ─── Deep analysis ───────────────────────────────────────────────────────
  // Win rate, best/worst day, daily growth %, best month YTD, biggest YoY gain
  // / loss month — all derived from the existing query results, no extra
  // round-trips.
  const insights = useMemo(() => {
    const out = {
      bestDay: null,
      worstDay: null,
      winRate: null,
      daysBeatLY: 0,
      daysMissedLY: 0,
      bestMonthYTD: null,
      worstMonthYTD: null,
      biggestGainMonth: null,
      biggestLossMonth: null,
      ytdTotalTy: 0,
      ytdTotalLy: 0,
      ytdGrowthPct: null,
    };

    // Daily-level analysis (selected month only) — best/worst day + win rate.
    // For an in-progress month, today's row may carry partial-day totals that
    // would skew "Slowest Day" downward and "Win Rate" against us. Skip today.
    const isCurrentMonth = monthIdx === today.getMonth();
    const todayDayNum    = today.getDate();
    let bestDayVal = -Infinity, worstDayVal = Infinity;
    let beat = 0, missed = 0;
    for (const r of dailyRows) {
      const dayNum = parseInt(String(r.DayMonth).split('-')[0], 10);
      if (isCurrentMonth && dayNum >= todayDayNum) continue;
      const ty = Number(r.ThisYear) || 0;
      const ly = Number(r.LastYear) || 0;
      if (ty > 0) {
        if (ty > bestDayVal)  { bestDayVal = ty;  out.bestDay  = { day: r.DayMonth, value: ty }; }
        if (ty < worstDayVal) { worstDayVal = ty; out.worstDay = { day: r.DayMonth, value: ty }; }
      }
      if (ty > 0 && ly > 0) {
        if (ty > ly) beat++; else if (ty < ly) missed++;
      }
    }
    out.daysBeatLY  = beat;
    out.daysMissedLY = missed;
    out.winRate = (beat + missed) > 0 ? (beat / (beat + missed)) * 100 : null;

    // Monthly-level analysis — only consider COMPLETED months so we never
    // compare a partial in-progress month (e.g. 5 days of May) against a full
    // month from last year. The current month and any future months are
    // excluded from best/worst, biggest gain/drop, and YTD totals.
    const monthOrder = MONTHS;
    const currentMonthIdx = today.getMonth(); // 0..11
    let bestMtRev = -Infinity, worstMtRev = Infinity;
    let bestGain = -Infinity, worstLoss = Infinity;
    let completedMonthCount = 0;
    for (const r of monthlyRows) {
      const idx = monthOrder.indexOf(r.MonthName);
      const isCompleted = idx >= 0 && idx < currentMonthIdx;
      if (!isCompleted) continue;
      completedMonthCount++;

      const ty = Number(r.ThisYear) || 0;
      const ly = Number(r.LastYear) || 0;
      out.ytdTotalTy += ty;
      out.ytdTotalLy += ly;
      if (ty > 0) {
        if (ty > bestMtRev)   { bestMtRev = ty;   out.bestMonthYTD  = { month: r.MonthName, value: ty }; }
        if (ty < worstMtRev)  { worstMtRev = ty;  out.worstMonthYTD = { month: r.MonthName, value: ty }; }
      }
      if (ty > 0 && ly > 0) {
        const pct = ((ty - ly) / ly) * 100;
        if (pct > bestGain)   { bestGain = pct;  out.biggestGainMonth = { month: r.MonthName, pct, ty, ly }; }
        if (pct < worstLoss)  { worstLoss = pct; out.biggestLossMonth = { month: r.MonthName, pct, ty, ly }; }
      }
    }
    out.completedMonthCount = completedMonthCount;
    out.ytdGrowthPct = out.ytdTotalLy > 0
      ? ((out.ytdTotalTy - out.ytdTotalLy) / out.ytdTotalLy) * 100
      : null;

    return out;
  }, [dailyRows, monthlyRows, monthIdx, today]);

  return (
    <>
      <Topbar title="Sales Comparison Report" subtitle={`${store} · ${category} · ${monthName}`} />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <FilterBar
          store={store}
          setStore={setStore}
          category={category}
          setCategory={setCategory}
          monthIdx={monthIdx}
          setMonthIdx={setMonthIdx}
          today={today}
        />

        {/* ── hero banner ── */}
        <ScrHeroBanner matrix={matrix} insights={insights}
          monthName={monthName} category={category}
          storeLabel={STORES.find(s => s.value === store)?.label} />

        {/* ── hero stats row ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <HeroStat
            label={matrix?.isCurrent ? `MTD · Day ${matrix.daysElapsed}` : 'Month-to-Date'}
            value={fmtCompactCurrency(matrix?.mtdTy ?? 0)}
            fullValue={fmtCurrency(matrix?.mtdTy ?? 0)}
            icon={Calendar}
            accent="primary"
            subtitle={matrix?.mtdLy
              ? `${matrix.mtdTy >= matrix.mtdLy ? '▲' : '▼'} vs LY ${fmtCompactCurrency(matrix.mtdLy)}`
              : null}
            sparkline={dailyRows.map(r => ({ value: Number(r.ThisYear) || 0 }))}
            loading={daily.isLoading}
          />
          <HeroStat
            label="Trending Forecast"
            value={fmtCompactCurrency(matrix?.trending ?? 0)}
            fullValue={fmtCurrency(matrix?.trending ?? 0)}
            icon={TrendingUp}
            accent={matrix && matrix.trending >= matrix.target ? 'emerald' : 'amber'}
            urgent={matrix && matrix.trending < matrix.target && matrix.target > 0}
            subtitle={matrix?.target
              ? `${matrix.trending >= matrix.target ? '▲' : '▼'} target ${fmtCompactCurrency(matrix.target)}`
              : null}
            loading={monthly.isLoading}
          />
          <HeroStat
            label="Target (LY × 1.10)"
            value={fmtCompactCurrency(matrix?.target ?? 0)}
            fullValue={fmtCurrency(matrix?.target ?? 0)}
            icon={Target}
            accent="violet"
            subtitle="Monthly stretch goal"
            loading={monthly.isLoading}
          />
          <HeroStat
            label={matrix?.isCurrent ? 'vs Same Period LY' : 'vs Last Year'}
            value={matrix?.fairYoyPct != null
              ? `${matrix.fairYoyPct >= 0 ? '+' : ''}${matrix.fairYoyPct.toFixed(1)}%`
              : '—'}
            icon={matrix && matrix.fairYoyPct >= 0 ? ArrowUpRight : ArrowDownRight}
            accent={matrix?.fairYoyPct == null ? 'sky'
              : matrix.fairYoyPct >= 5  ? 'emerald'
              : matrix.fairYoyPct >= -5 ? 'amber'
              : 'rose'}
            subtitle={matrix?.fairLyValue
              ? matrix.isCurrent
                ? `${fmtCompactCurrency(matrix.fairLyValue)} through day ${matrix.daysElapsed} of last ${monthName}`
                : `${fmtCompactCurrency(matrix.fairLyValue)} last ${monthName}`
              : null}
            loading={monthly.isLoading}
          />
          <HeroStat
            label={matrix?.isCurrent && matrix.avgReqd != null ? 'Avg Reqd / Day' : 'Avg Sales / Day'}
            value={fmtCompactCurrency(matrix?.isCurrent && matrix.avgReqd != null ? matrix.avgReqd : (matrix?.avgTy ?? 0))}
            fullValue={fmtCurrency(matrix?.isCurrent && matrix.avgReqd != null ? matrix.avgReqd : (matrix?.avgTy ?? 0))}
            icon={Activity}
            accent={matrix?.isCurrent && matrix.avgReqd != null ? 'amber' : 'sky'}
            urgent={matrix?.isCurrent && matrix.avgReqd != null && matrix.avgReqd > matrix.avgTillDateTy * 1.5}
            subtitle={matrix?.isCurrent && matrix.avgReqd != null
              ? `Current avg ${fmtCompactCurrency(matrix.avgTillDateTy)} / day`
              : 'Average per day'}
            loading={monthly.isLoading}
          />
        </div>

        {/* ── quick reports (weekly / monthly highlights from raw sales) ── */}
        <QuickReports stats={quickStats} loading={weeklySales.isLoading} storeKey={store} />

        {/* ── deep analysis row ── */}
        <DeepAnalysis insights={insights} matrix={matrix} monthName={monthName} category={category} />

        <div className="grid gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Cumulative {category} sales · {monthName}</CardTitle>
              <CardDescription>
                Running totals — this year vs last year.
                {matrix?.isCurrent && <span className="text-muted-fg/70"> · This-Year line stops at day {matrix.daysElapsed} (last completed day).</span>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  {/*
                    For the current month, the running-total query returns
                    rows for every day of the month — and for days after
                    today the TYR value plateaus (no new sales), drawing a
                    misleading flat line. We mask future-day TYR values to
                    null and use connectNulls={false} so the line stops at
                    today instead.
                  */}
                  <LineChart data={dailyRows.map((r) => {
                    const dayNum = parseInt(String(r.DayMonth).split('-')[0], 10);
                    const isFuture = matrix?.isCurrent && dayNum > matrix.daysElapsed;
                    return {
                      ...r,
                      day: String(r.DayMonth).split('-')[0],
                      TYR: isFuture ? null : Number(r.TYR),
                    };
                  })}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="day" stroke="hsl(var(--muted-fg))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(v) => fmtCompact(v)} />
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                      formatter={(v) => v == null ? '—' : fmtCurrency(v)}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="LYR" name="Last Year" stroke="hsl(var(--muted-fg))" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="TYR" name="This Year" stroke="hsl(var(--primary))" strokeWidth={2.5}
                      dot={false} connectNulls={false}
                      activeDot={{ r: 5, fill: 'hsl(var(--primary))', strokeWidth: 0 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <DonutCard matrix={matrix} loading={monthly.isLoading || daily.isLoading} />
        </div>

        <PerformanceMatrix matrix={matrix} loading={monthly.isLoading || daily.isLoading} monthName={monthName} />

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Daily comparison · {monthName}</CardTitle>
              <CardDescription>
                {align === 'weekday'
                  ? 'By weekday — this year vs last year matched on the same day of week (Sat vs Sat).'
                  : 'By calendar date — this year vs last year on the same date.'}
              </CardDescription>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="mr-1 text-[11px] uppercase tracking-wider text-muted-fg">Compare</span>
              <Button size="sm" variant={align === 'date' ? 'primary' : 'outline'} onClick={() => setAlign('date')}>By Date</Button>
              <Button size="sm" variant={align === 'weekday' ? 'primary' : 'outline'} onClick={() => setAlign('weekday')}>By Weekday</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
                <tr>
                  <th className="px-4 py-2.5 text-left">Day</th>
                  <th className="px-3 py-2.5 text-center">Day · LY</th>
                  <th className="px-4 py-2.5 text-right">Last Year</th>
                  <th className="px-3 py-2.5 text-center">Day · TY</th>
                  <th className="px-4 py-2.5 text-right">This Year</th>
                  <th className="px-4 py-2.5 text-right">Δ</th>
                  <th className="px-4 py-2.5 text-right">LY Running</th>
                  <th className="px-4 py-2.5 text-right">TY Running</th>
                </tr>
              </thead>
              <tbody>
                {daily.isLoading ? (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-fg">Loading…</td></tr>
                ) : dailyDisplay.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-muted-fg">No records for {monthName}.</td></tr>
                ) : dailyDisplay.map((r) => (
                  <tr key={r.DayMonth} className="border-t border-border">
                    <td className="px-4 py-2 font-medium">{r.DayMonth}</td>
                    <td className={dayCellClass(r.dLY)}
                        title={align === 'weekday' && r.lyExists ? `Last year: ${MONTHS[monthIdx].slice(0, 3)} ${r.alignedDay}` : undefined}>
                      {align === 'weekday'
                        ? (r.lyExists ? `${r.dLY.name} ${r.alignedDay}` : '—')
                        : r.dLY.name}
                    </td>
                    <td className="px-4 py-2 text-right num text-muted-fg">{r.ly == null ? '—' : fmtCurrency(r.ly)}</td>
                    <td className={dayCellClass(r.dTY)}>{r.dTY.name}</td>
                    <td className="px-4 py-2 text-right num">{fmtCurrency(r.ty)}</td>
                    <td className={`px-4 py-2 text-right num ${r.diff > 0 ? 'text-success' : r.diff < 0 ? 'text-danger' : ''}`}>
                      {r.diff ? fmtCurrency(r.diff) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right num text-muted-fg">{fmtCurrency(r.lyRun)}</td>
                    <td className="px-4 py-2 text-right num">{fmtCurrency(r.tyRun)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Yearly comparison · {category}</CardTitle>
            <CardDescription>Month-by-month, this year vs last year. Line shows previous year for context.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="MonthName" stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(m) => m.slice(0, 3)} />
                  <YAxis stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                    formatter={(v) => fmtCurrency(v)}
                  />
                  <Legend />
                  <Bar dataKey="LastYear" fill="hsl(var(--muted-fg) / 0.5)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="ThisYear" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                  <Line type="monotone" dataKey="PreviousYear" stroke="hsl(var(--warning))" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* ---- Weekly + Quarterly ---- */}
        <SectionHeading title="Weekly / Quarterly Report" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Sales · {monthName}</CardTitle>
              <CardDescription>Last year vs this year, grouped by week of month.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <ComparisonTable
                rows={weeklyRows}
                loading={weekly.isLoading}
                labelKey="weekRange"
                labelHeader="Week"
                emptyText={`No data for ${monthName}.`}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quarterly Total</CardTitle>
              <CardDescription>This year vs last year by quarter.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <ComparisonTable
                rows={quarterlyRows}
                loading={quarterly.isLoading}
                labelKey="Quarter"
                labelHeader="Quarter"
                showTotal
              />
            </CardContent>
          </Card>
        </div>

        {/* ---- Sales Summary (month-wise grid) ---- */}
        <SectionHeading title="Sales Summary" />
        <Card>
          <CardHeader>
            <CardTitle>Month-wise Sales Summary · {category}</CardTitle>
            <CardDescription>All months — last year, this year, Δ, Δ%.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <SummaryTable rows={monthlyRows} loading={monthly.isLoading} />
          </CardContent>
        </Card>

        {/* ---- Yearly Report (Written + Delivered) ---- */}
        <SectionHeading title="Yearly Report" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Written</CardTitle>
              <CardDescription>Last year vs this year by month.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <YearlyDualTable rows={yearlyRows} loading={yearly.isLoading} mode="written" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivered</CardTitle>
              <CardDescription>Last year vs this year by month.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <YearlyDualTable rows={yearlyRows} loading={yearly.isLoading} mode="delivered" />
            </CardContent>
          </Card>
        </div>

        {/* ---- 4 Years Report ---- */}
        <SectionHeading title="4 Years Report" />
        <Card>
          <CardHeader>
            <CardTitle>{category} · 4 years by month</CardTitle>
            <CardDescription>Earlier · Previous Year · Last Year · This Year — {category} sales only.</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <FourYearTable rows={fourYearRows} loading={fourYear.isLoading} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function SectionHeading({ title }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="h-px flex-1 bg-border" />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-fg">{title}</h2>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function ComparisonTable({ rows, loading, labelKey, labelHeader, emptyText, showTotal }) {
  const totals = useMemo(() => {
    let ty = 0, ly = 0;
    rows.forEach((r) => { ty += Number(r.ThisYear) || 0; ly += Number(r.LastYear) || 0; });
    return { ty, ly };
  }, [rows]);
  const renderRow = (r) => {
    const ty = Number(r.ThisYear) || 0;
    const ly = Number(r.LastYear) || 0;
    const diff = ty - ly;
    const pct = ly ? (diff / ly) * 100 : null;
    return (
      <tr key={r[labelKey]} className="border-t border-border">
        <td className="px-4 py-2.5 font-medium">{r[labelKey]}</td>
        <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(ly)}</td>
        <td className="px-4 py-2.5 text-right num">{fmtCurrency(ty)}</td>
        <td className={`px-4 py-2.5 text-right num ${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : ''}`}>
          {diff ? fmtCurrency(diff) : '—'}
        </td>
        <td className={`px-4 py-2.5 text-right num ${pct == null ? '' : pct > 0 ? 'text-success' : 'text-danger'}`}>
          {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
        </td>
      </tr>
    );
  };
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">{labelHeader}</th>
          <th className="px-4 py-2.5 text-right">Last Year</th>
          <th className="px-4 py-2.5 text-right">This Year</th>
          <th className="px-4 py-2.5 text-right">Δ</th>
          <th className="px-4 py-2.5 text-right">Δ %</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={5} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.length === 0 ? (
          <tr><td colSpan={5} className="py-8 text-center text-muted-fg">{emptyText || 'No records.'}</td></tr>
        ) : rows.map(renderRow)}
        {showTotal && rows.length > 0 && !loading && (
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">Total</td>
            <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(totals.ly)}</td>
            <td className="px-4 py-2.5 text-right num">{fmtCurrency(totals.ty)}</td>
            <td className={`px-4 py-2.5 text-right num ${totals.ty - totals.ly > 0 ? 'text-success' : totals.ty - totals.ly < 0 ? 'text-danger' : ''}`}>
              {totals.ty - totals.ly ? fmtCurrency(totals.ty - totals.ly) : '—'}
            </td>
            <td className={`px-4 py-2.5 text-right num ${totals.ly && (totals.ty - totals.ly) / totals.ly > 0 ? 'text-success' : totals.ly && (totals.ty - totals.ly) / totals.ly < 0 ? 'text-danger' : ''}`}>
              {totals.ly ? `${(totals.ty - totals.ly) / totals.ly * 100 >= 0 ? '+' : ''}${((totals.ty - totals.ly) / totals.ly * 100).toFixed(1)}%` : '—'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function SummaryTable({ rows, loading }) {
  const totals = useMemo(() => {
    let ty = 0, ly = 0;
    rows.forEach((r) => { ty += Number(r.ThisYear) || 0; ly += Number(r.LastYear) || 0; });
    return { ty, ly };
  }, [rows]);
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">Month</th>
          <th className="px-4 py-2.5 text-right">Last Year</th>
          <th className="px-4 py-2.5 text-right">This Year</th>
          <th className="px-4 py-2.5 text-right">Δ</th>
          <th className="px-4 py-2.5 text-right">Δ %</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={5} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.map((r) => {
          const ty = Number(r.ThisYear) || 0;
          const ly = Number(r.LastYear) || 0;
          const diff = ty - ly;
          const pct = ly ? (diff / ly) * 100 : null;
          return (
            <tr key={r.MonthName} className="border-t border-border">
              <td className="px-4 py-2.5 font-medium">{r.MonthName}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{ly ? fmtCurrency(ly) : '—'}</td>
              <td className="px-4 py-2.5 text-right num">{ty ? fmtCurrency(ty) : '—'}</td>
              <td className={`px-4 py-2.5 text-right num ${diff > 0 ? 'text-success' : diff < 0 ? 'text-danger' : ''}`}>
                {diff ? fmtCurrency(diff) : '—'}
              </td>
              <td className={`px-4 py-2.5 text-right num ${pct == null ? '' : pct > 0 ? 'text-success' : 'text-danger'}`}>
                {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
              </td>
            </tr>
          );
        })}
        {!loading && rows.length > 0 && (
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">Year Total</td>
            <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(totals.ly)}</td>
            <td className="px-4 py-2.5 text-right num">{fmtCurrency(totals.ty)}</td>
            <td className={`px-4 py-2.5 text-right num ${totals.ty - totals.ly > 0 ? 'text-success' : totals.ty - totals.ly < 0 ? 'text-danger' : ''}`}>
              {fmtCurrency(totals.ty - totals.ly)}
            </td>
            <td className={`px-4 py-2.5 text-right num ${totals.ly && (totals.ty - totals.ly) / totals.ly > 0 ? 'text-success' : 'text-danger'}`}>
              {totals.ly ? `${(totals.ty - totals.ly) / totals.ly * 100 >= 0 ? '+' : ''}${((totals.ty - totals.ly) / totals.ly * 100).toFixed(1)}%` : '—'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function YearlyDualTable({ rows, loading, mode }) {
  const tyKey = mode === 'written' ? 'w_thisYear' : 'd_thisYear';
  const lyKey = mode === 'written' ? 'w_lastYear' : 'd_lastYear';
  const totals = useMemo(() => {
    let ty = 0, ly = 0;
    rows.forEach((r) => { ty += Number(r[tyKey]) || 0; ly += Number(r[lyKey]) || 0; });
    return { ty, ly };
  }, [rows, tyKey, lyKey]);
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">Month</th>
          <th className="px-4 py-2.5 text-right">Last Year</th>
          <th className="px-4 py-2.5 text-right">This Year</th>
          <th className="px-4 py-2.5 text-right">Δ %</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={4} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.map((r) => {
          const ty = Number(r[tyKey]) || 0;
          const ly = Number(r[lyKey]) || 0;
          const pct = ly ? ((ty - ly) / ly) * 100 : null;
          return (
            <tr key={r.MonthName} className="border-t border-border">
              <td className="px-4 py-2.5 font-medium">{r.MonthName.slice(0, 3)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{ly ? fmtCurrency(ly) : '—'}</td>
              <td className="px-4 py-2.5 text-right num">{ty ? fmtCurrency(ty) : '—'}</td>
              <td className={`px-4 py-2.5 text-right num ${pct == null ? '' : pct > 0 ? 'text-success' : 'text-danger'}`}>
                {pct == null ? '—' : `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`}
              </td>
            </tr>
          );
        })}
        {!loading && rows.length > 0 && (
          <tr className="border-t-2 border-border bg-muted/30 font-semibold">
            <td className="px-4 py-2.5">Total</td>
            <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(totals.ly)}</td>
            <td className="px-4 py-2.5 text-right num">{fmtCurrency(totals.ty)}</td>
            <td className={`px-4 py-2.5 text-right num ${totals.ly && totals.ty - totals.ly > 0 ? 'text-success' : 'text-danger'}`}>
              {totals.ly ? `${(totals.ty - totals.ly) / totals.ly * 100 >= 0 ? '+' : ''}${((totals.ty - totals.ly) / totals.ly * 100).toFixed(1)}%` : '—'}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function FourYearTable({ rows, loading }) {
  const today = new Date();
  const yr = today.getFullYear();
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">Month</th>
          <th className="px-4 py-2.5 text-right">{yr - 3}</th>
          <th className="px-4 py-2.5 text-right">{yr - 2}</th>
          <th className="px-4 py-2.5 text-right">{yr - 1}</th>
          <th className="px-4 py-2.5 text-right">{yr}</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={5} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.map((r) => (
          <tr key={r.MonthName} className="border-t border-border">
            <td className="px-4 py-2.5 font-medium">{r.MonthName.slice(0, 3)}</td>
            <td className="px-4 py-2.5 text-right num text-muted-fg">{Number(r.earlier) ? fmtCurrency(Number(r.earlier)) : '—'}</td>
            <td className="px-4 py-2.5 text-right num text-muted-fg">{Number(r.prevYear) ? fmtCurrency(Number(r.prevYear)) : '—'}</td>
            <td className="px-4 py-2.5 text-right num text-muted-fg">{Number(r.lastYear) ? fmtCurrency(Number(r.lastYear)) : '—'}</td>
            <td className="px-4 py-2.5 text-right num font-semibold">{Number(r.thisYear) ? fmtCurrency(Number(r.thisYear)) : '—'}</td>
          </tr>
        ))}
        {!loading && rows.length > 0 && (() => {
          const t = rows.reduce((acc, r) => ({
            earlier: acc.earlier + (Number(r.earlier) || 0),
            prevYear: acc.prevYear + (Number(r.prevYear) || 0),
            lastYear: acc.lastYear + (Number(r.lastYear) || 0),
            thisYear: acc.thisYear + (Number(r.thisYear) || 0),
          }), { earlier: 0, prevYear: 0, lastYear: 0, thisYear: 0 });
          return (
            <tr className="border-t-2 border-border bg-muted/30 font-semibold">
              <td className="px-4 py-2.5">Total</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(t.earlier)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(t.prevYear)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtCurrency(t.lastYear)}</td>
              <td className="px-4 py-2.5 text-right num">{fmtCurrency(t.thisYear)}</td>
            </tr>
          );
        })()}
      </tbody>
    </table>
  );
}

function FilterBar({ store, setStore, category, setCategory, monthIdx, setMonthIdx, today }) {
  const curMonth = today.getMonth();
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs uppercase tracking-wider text-muted-fg">Store</span>
          {STORES.map((s) => (
            <Button key={s.value} size="sm" variant={store === s.value ? 'primary' : 'outline'} onClick={() => setStore(s.value)}>
              {s.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-xs uppercase tracking-wider text-muted-fg">Category</span>
          {CATEGORIES.map((c) => (
            <Button key={c.value} size="sm" variant={category === c.value ? 'primary' : 'outline'} onClick={() => setCategory(c.value)}>
              {c.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1 ml-auto">
          {MONTHS.map((m, i) => {
            const future = i > curMonth;
            return (
              <Button
                key={m}
                size="sm"
                variant={monthIdx === i ? 'primary' : 'outline'}
                onClick={() => setMonthIdx(i)}
                disabled={future}
                className={future ? 'opacity-40' : ''}
              >
                {m.slice(0, 3)}
              </Button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function DonutCard({ matrix, loading }) {
  if (loading || !matrix) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Target progress</CardTitle>
        </CardHeader>
        <CardContent className="flex h-72 items-center justify-center text-sm text-muted-fg">
          {loading ? 'Loading…' : 'No data'}
        </CardContent>
      </Card>
    );
  }
  const achieved = matrix.mtdTy;
  const target = matrix.target;
  const pct = target ? Math.min(100, (achieved / target) * 100) : 0;
  const data = [
    { name: 'Achieved', value: Math.min(achieved, target) },
    { name: 'Remaining', value: Math.max(0, target - achieved) },
  ];
  const colors = ['hsl(var(--primary))', 'hsl(var(--muted))'];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Target · {fmtCurrency(target)}</CardTitle>
        <CardDescription>Last year + 10%</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative h-56">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius="65%" outerRadius="90%" startAngle={90} endAngle={-270}>
                {data.map((_, i) => <Cell key={i} fill={colors[i]} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
            <div>
              <div className="num text-3xl font-semibold">{fmtPercent(pct, 0)}</div>
              <div className="text-xs text-muted-fg">{fmtCurrency(achieved)} of {fmtCurrency(target)}</div>
            </div>
          </div>
        </div>
        {matrix.isCurrent && (
          <div className="mt-3 text-center text-xs text-muted-fg">
            Day {matrix.daysElapsed} of {matrix.days}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PerformanceMatrix({ matrix, loading, monthName }) {
  if (!matrix) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Matrix</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-fg">{loading ? 'Loading…' : 'No data for this month.'}</CardContent>
      </Card>
    );
  }

  const rows = [
    { label: `MTD${matrix.isCurrent ? ` · till day ${matrix.daysElapsed}` : ''}`, ly: matrix.mtdLy, ty: matrix.mtdTy },
    { label: 'Month total', ly: matrix.monthTotalLy, ty: matrix.monthTotalTy, bold: true },
    { label: 'Avg sales / day', ly: matrix.avgLy, ty: matrix.avgTy },
    { label: 'Avg sales till date', ly: matrix.avgTillDateLy, ty: matrix.avgTillDateTy },
    { label: 'Target for the month', ly: null, ty: matrix.target, hint: 'LY × 1.10' },
    { label: 'Avg reqd. / day', ly: null, ty: matrix.avgReqd, hint: matrix.avgReqd == null ? 'N/A' : null },
    { label: 'Trending', ly: null, ty: matrix.trending, bold: true },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Matrix · {monthName}</CardTitle>
      </CardHeader>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
            <tr>
              <th className="px-4 py-2.5 text-left">Particulars</th>
              <th className="px-4 py-2.5 text-right">Last Year</th>
              <th className="px-4 py-2.5 text-right">This Year</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-t border-border">
                <td className={`px-4 py-2.5 ${r.bold ? 'font-semibold' : ''}`}>
                  {r.label}
                  {r.hint && <span className="ml-2 text-[11px] text-muted-fg">({r.hint})</span>}
                </td>
                <td className="px-4 py-2.5 text-right num text-muted-fg">{r.ly == null ? '—' : fmtCurrency(r.ly)}</td>
                <td className={`px-4 py-2.5 text-right num ${r.bold ? 'font-semibold' : ''}`}>
                  {r.ty == null ? '—' : fmtCurrency(r.ty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Eye-catching hero banner ────────────────────────────────────────────────

function ScrHeroBanner({ matrix, insights, monthName, category, storeLabel }) {
  if (!matrix) {
    return (
      <HeroBanner icon={BarChart3} accent="primary">
        <div className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">
          Sales Comparison · {storeLabel} · {category}
        </div>
        <div className="mt-1 text-2xl font-bold text-muted-fg">Loading…</div>
      </HeroBanner>
    );
  }

  const onTrack       = matrix.trending >= matrix.target && matrix.target > 0;
  // Use the fair YoY comparison (MTD vs same-period LY for in-progress months,
  // full vs full for completed months). The previous code compared partial-MTD
  // against the full prior-year month, which always showed a misleading drop.
  const yoyPct        = matrix.fairYoyPct;
  const aboveLastYear = yoyPct != null && yoyPct >= 0;
  const accent        = onTrack ? 'emerald' : aboveLastYear ? 'amber' : 'rose';

  return (
    <HeroBanner icon={Trophy} decorIcon={BarChart3} accent={accent}>
      <div className="text-[11px] font-bold uppercase tracking-widest"
        style={{
          color: accent === 'emerald' ? 'rgb(5 150 105)'
               : accent === 'amber'   ? 'rgb(217 119 6)'
               : 'rgb(225 29 72)',
        }}>
        {storeLabel} · {category} · {monthName}
      </div>
      <div className="mt-1 flex items-baseline gap-3 flex-wrap">
        <span className={cn(
          'text-5xl font-extrabold tabular-nums tracking-tight bg-clip-text text-transparent bg-gradient-to-br',
          accent === 'emerald' ? 'from-emerald-600 to-teal-500'
          : accent === 'amber' ? 'from-amber-600 to-orange-500'
          : 'from-rose-600 to-orange-500',
        )}>
          {fmtCompactCurrency(matrix.mtdTy)}
        </span>
        {yoyPct != null && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md',
            yoyPct >= 0
              ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white'
              : 'bg-gradient-to-br from-rose-500 to-orange-500 text-white',
          )}
            title={matrix.isCurrent
              ? `MTD ${fmtCurrency(matrix.fairTyValue)} vs same period last year ${fmtCurrency(matrix.fairLyValue)}`
              : `${fmtCurrency(matrix.fairTyValue)} vs ${fmtCurrency(matrix.fairLyValue)} last year`}>
            {yoyPct >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
            {yoyPct > 0 ? '+' : ''}{yoyPct.toFixed(1)}% {matrix.isCurrent ? 'vs same period LY' : 'vs LY'}
          </span>
        )}
        {matrix.target > 0 && (
          <span className={cn(
            'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md',
            onTrack
              ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white'
              : 'bg-gradient-to-br from-amber-500 to-orange-500 text-white',
          )}>
            <Target size={14} />
            {fmtPercent((matrix.mtdTy / matrix.target) * 100, 0)} of target
          </span>
        )}
      </div>
      <div className="mt-2 text-xs text-muted-fg">
        Trending <strong className="text-fg">{fmtCompactCurrency(matrix.trending)}</strong>
        {' · '}target <strong className="text-fg">{fmtCompactCurrency(matrix.target)}</strong>
        {matrix.isCurrent && <> · day <strong className="text-fg">{matrix.daysElapsed}</strong> of {matrix.days}</>}
      </div>
    </HeroBanner>
  );
}

// ─── Deep Analysis section ──────────────────────────────────────────────────

function DeepAnalysis({ insights, matrix, monthName, category }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md ring-2 ring-violet-500/20">
          <Zap size={18} />
        </div>
        <div>
          <h3 className="text-base font-bold tracking-tight">Deep Analysis · {monthName}</h3>
          <p className="text-xs text-muted-fg">Best &amp; slowest days for the selected month · YTD comparison uses completed months only (in-progress {monthName} excluded)</p>
        </div>
      </div>

      {/* Row 1 — day-level highs/lows + overall YTD growth */}
      {/* Row 2 — month-level YTD highlights (best, biggest gain, biggest drop) */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Best day */}
        <InsightTile
          icon={Trophy}
          accent="emerald"
          label={`Best Day · ${monthName}`}
          value={insights.bestDay ? fmtCompactCurrency(insights.bestDay.value) : '—'}
          fullValue={insights.bestDay ? fmtCurrency(insights.bestDay.value) : null}
          subtitle={insights.bestDay ? `On ${insights.bestDay.day}` : 'No data yet'}
        />
        {/* Slowest day */}
        <InsightTile
          icon={AlertTriangle}
          accent="amber"
          label={`Slowest Day · ${monthName}`}
          value={insights.worstDay ? fmtCompactCurrency(insights.worstDay.value) : '—'}
          fullValue={insights.worstDay ? fmtCurrency(insights.worstDay.value) : null}
          subtitle={insights.worstDay ? `On ${insights.worstDay.day}` : 'No data yet'}
        />

        {insights.completedMonthCount === 0 ? (
          <div className="md:col-span-3 rounded-xl border border-border bg-card p-4 text-center text-xs text-muted-fg">
            Year-over-year insights will appear once at least one month has completed.
          </div>
        ) : (
          <>
            {/* YTD vs LY — completes row 1 */}
            <InsightTile
              icon={BarChart3}
              accent={insights.ytdGrowthPct == null ? 'sky'
                : insights.ytdGrowthPct >= 5 ? 'emerald'
                : insights.ytdGrowthPct >= -5 ? 'amber'
                : 'rose'}
              label="YTD vs Last Year"
              value={insights.ytdGrowthPct != null
                ? `${insights.ytdGrowthPct > 0 ? '+' : ''}${insights.ytdGrowthPct.toFixed(1)}%`
                : '—'}
              subtitle={insights.ytdTotalLy > 0
                ? `${fmtCompactCurrency(insights.ytdTotalTy)} vs ${fmtCompactCurrency(insights.ytdTotalLy)} · through ${insights.completedMonthCount} completed mo${insights.completedMonthCount !== 1 ? 's' : ''}`
                : 'No comparison data'}
            />

            {/* Row 2 begins — month-level YTD highlights */}
            <InsightTile
              icon={Award}
              accent="primary"
              label="Best Month YTD"
              value={insights.bestMonthYTD ? insights.bestMonthYTD.month.slice(0, 3) : '—'}
              subtitle={insights.bestMonthYTD
                ? `${fmtCurrency(insights.bestMonthYTD.value)} · ${insights.completedMonthCount} completed mo${insights.completedMonthCount !== 1 ? 's' : ''}`
                : 'No completed month yet'}
            />
            <InsightTile
              icon={Flame}
              accent="emerald"
              label="Biggest Gain Month"
              value={insights.biggestGainMonth && insights.biggestGainMonth.pct > 0
                ? `+${insights.biggestGainMonth.pct.toFixed(0)}%`
                : '—'}
              subtitle={insights.biggestGainMonth && insights.biggestGainMonth.pct > 0
                ? `${insights.biggestGainMonth.month.slice(0, 3)} · ${fmtCompactCurrency(insights.biggestGainMonth.ty)} vs ${fmtCompactCurrency(insights.biggestGainMonth.ly)}`
                : 'No gaining completed month'}
            />
            <InsightTile
              icon={TrendingDown}
              accent="rose"
              label="Biggest Drop Month"
              value={insights.biggestLossMonth && insights.biggestLossMonth.pct < 0
                ? `${insights.biggestLossMonth.pct.toFixed(0)}%`
                : '—'}
              subtitle={insights.biggestLossMonth && insights.biggestLossMonth.pct < 0
                ? `${insights.biggestLossMonth.month.slice(0, 3)} · ${fmtCompactCurrency(insights.biggestLossMonth.ty)} vs ${fmtCompactCurrency(insights.biggestLossMonth.ly)}`
                : 'No declining completed month'}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ─── Quick Reports (weekly / monthly highlights row) ────────────────────────

function QuickReports({ stats, loading, storeKey }) {
  const storeLabel = storeKey === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)';
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md ring-2 ring-emerald-500/20">
          <Activity size={18} />
        </div>
        <div>
          <h3 className="text-base font-bold tracking-tight">Quick Reports</h3>
          <p className="text-xs text-muted-fg">Weekly &amp; monthly highlights for {storeLabel} · sourced from raw sales records</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <HeroStat
          label="Avg Weekly Sales"
          value={fmtCompactCurrency(stats.avgWeekly)}
          fullValue={fmtCurrency(stats.avgWeekly)}
          icon={Calendar}
          accent="primary"
          subtitle={stats.weeksThisYear
            ? `Across ${stats.weeksThisYear} week${stats.weeksThisYear !== 1 ? 's' : ''} of ${SCR_CURRENT_YEAR}`
            : 'No data yet'}
          loading={loading}
        />
        <HeroStat
          label="Avg Monthly Sales"
          value={fmtCompactCurrency(stats.avgMonthly)}
          fullValue={fmtCurrency(stats.avgMonthly)}
          icon={CalendarDays}
          accent="violet"
          subtitle={stats.monthsThisYear
            ? `Across ${stats.monthsThisYear} month${stats.monthsThisYear !== 1 ? 's' : ''} of ${SCR_CURRENT_YEAR}`
            : 'No data yet'}
          loading={loading}
        />
        <HeroStat
          label={`Best Week · ${SCR_CURRENT_YEAR}`}
          value={stats.bestWeekThisYear
            ? fmtCompactCurrency(stats.bestWeekThisYear.revenue)
            : '—'}
          fullValue={stats.bestWeekThisYear
            ? fmtCurrency(stats.bestWeekThisYear.revenue)
            : null}
          icon={Trophy}
          accent="emerald"
          subtitle={stats.bestWeekThisYear
            ? `Week ${stats.bestWeekThisYear.week} · starting ${stats.bestWeekThisYear.start}`
            : 'No completed weeks yet'}
          loading={loading}
        />
        <HeroStat
          label={`Best Week · ${SCR_CURRENT_YEAR - 1}`}
          value={stats.bestWeekLastYear
            ? fmtCompactCurrency(stats.bestWeekLastYear.revenue)
            : '—'}
          fullValue={stats.bestWeekLastYear
            ? fmtCurrency(stats.bestWeekLastYear.revenue)
            : null}
          icon={Trophy}
          accent="amber"
          subtitle={stats.bestWeekLastYear
            ? `Week ${stats.bestWeekLastYear.week} · starting ${stats.bestWeekLastYear.start}`
            : 'No data'}
          loading={loading}
        />
      </div>
      {stats.bestWeekThisYear && stats.bestWeekLastYear && (
        <div className="mt-3 px-1 text-[11px] text-muted-fg">
          {(() => {
            const tY = stats.bestWeekThisYear.revenue;
            const lY = stats.bestWeekLastYear.revenue;
            const diff = ((tY - lY) / lY) * 100;
            const positive = diff >= 0;
            return (
              <span>
                Best week of {SCR_CURRENT_YEAR} is{' '}
                <strong className={positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                  {positive ? '+' : ''}{diff.toFixed(1)}%
                </strong>{' '}
                {positive ? 'higher' : 'lower'} than best week of {SCR_CURRENT_YEAR - 1}
                {' '}({fmtCompactCurrency(tY)} vs {fmtCompactCurrency(lY)})
              </span>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Compact insight tile — narrower than HeroStat, used in a 4-up insights row.
function InsightTile({ icon: Icon, accent, label, value, fullValue, subtitle }) {
  const map = {
    rose:    { surface: 'bg-rose-50/60 dark:bg-rose-950/20',       border: 'border-rose-500/30',    iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600',       iconRing: 'ring-rose-500/20',    text: 'text-rose-600 dark:text-rose-300' },
    amber:   { surface: 'bg-amber-50/60 dark:bg-amber-950/20',     border: 'border-amber-500/30',   iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',    iconRing: 'ring-amber-500/20',   text: 'text-amber-600 dark:text-amber-300' },
    sky:     { surface: 'bg-sky-50/60 dark:bg-sky-950/20',         border: 'border-sky-500/30',     iconBg: 'bg-gradient-to-br from-sky-500 to-cyan-500',        iconRing: 'ring-sky-500/20',     text: 'text-sky-600 dark:text-sky-300' },
    violet:  { surface: 'bg-violet-50/60 dark:bg-violet-950/20',   border: 'border-violet-500/30',  iconBg: 'bg-gradient-to-br from-violet-500 to-purple-500',   iconRing: 'ring-violet-500/20',  text: 'text-violet-600 dark:text-violet-300' },
    emerald: { surface: 'bg-emerald-50/60 dark:bg-emerald-950/20', border: 'border-emerald-500/30', iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500',    iconRing: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-300' },
    primary: { surface: 'bg-blue-50/60 dark:bg-blue-950/20',       border: 'border-blue-500/30',    iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-500',     iconRing: 'ring-blue-500/20',    text: 'text-blue-600 dark:text-blue-300' },
  };
  const p = map[accent] || map.sky;
  return (
    <div className={cn('rounded-xl border bg-card p-3 flex items-start gap-3', p.border, p.surface)}>
      <div className={cn(
        'grid h-10 w-10 place-items-center rounded-lg shrink-0 text-white shadow-md ring-2',
        p.iconBg, p.iconRing,
      )}>
        <Icon size={18} strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg truncate">{label}</div>
        <div className={cn('mt-0.5 text-xl font-extrabold tabular-nums tracking-tight leading-none truncate', p.text)}
          title={fullValue || undefined}>
          {value}
        </div>
        {subtitle && <div className="text-[10px] text-muted-fg mt-1 line-clamp-1">{subtitle}</div>}
      </div>
    </div>
  );
}
