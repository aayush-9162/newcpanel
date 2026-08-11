// Faithful clone of /auth/dashboard — focused single-store, single-month
// performance view with target tracking. Different from CPanel (which is the
// multi-store overview) and SCR (which is the deep comparison report).
//
// Layout follows the original Bootstrap dashboard:
//   [S1/S2 toggle] [W/D toggle] [Month bar]
//   ── Comparative Sales (LY vs TY by day, running total)   ── Line chart
//   ── Monthly Targets table + Donut (target progress)
//   ── Weekly summary + Quarterly summary
//   ── Month Wise summary chart

import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtPercent, fmtCompact, fmtCompactCurrency, trimStr } from '@/lib/format';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import {
  Target, TrendingUp, TrendingDown, Calendar, DollarSign, Activity, Trophy,
  Building2, Receipt, Wrench, Flame, Users, PackageX, Truck,
  ArrowUpRight, ArrowDownRight, AlertTriangle, ShoppingCart, User, Tag, Heart,
  Sparkles, ChevronRight, Sofa, BedDouble, Utensils, Lamp, Package, MapPin, Boxes, Award,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { MetricDrilldown } from '@/components/MetricDrilldown';
import { ROOM_RULES, ITEM_TYPE_RULES, roomCase, itemTypeCase } from '@/lib/salesRules';
import { vendorDomain } from '@/data/vendorLogos';
import DashboardDaily from '@/pages/DashboardDaily';

// Months — matches the original radio strip
const MONTHS = [
  { num: 1,  short: 'Jan', name: 'January' }, { num: 2,  short: 'Feb', name: 'February' },
  { num: 3,  short: 'Mar', name: 'March' },   { num: 4,  short: 'Apr', name: 'April' },
  { num: 5,  short: 'May', name: 'May' },     { num: 6,  short: 'Jun', name: 'June' },
  { num: 7,  short: 'Jul', name: 'July' },    { num: 8,  short: 'Aug', name: 'August' },
  { num: 9,  short: 'Sep', name: 'September'},{ num: 10, short: 'Oct', name: 'October' },
  { num: 11, short: 'Nov', name: 'November'}, { num: 12, short: 'Dec', name: 'December' },
];

const QUARTERS = [
  { id: 1, label: 'Q1', months: ['January', 'February', 'March'] },
  { id: 2, label: 'Q2', months: ['April', 'May', 'June'] },
  { id: 3, label: 'Q3', months: ['July', 'August', 'September'] },
  { id: 4, label: 'Q4', months: ['October', 'November', 'December'] },
];

function daysInMonth(month, year) {
  return new Date(year, month, 0).getDate();
}

// Parse a 'YYYY-MM-DD' calendar date as LOCAL midnight. A MS SQL DATE comes
// back as UTC midnight, and `new Date(utcMidnight)` renders as the previous
// evening in any timezone west of UTC — which silently shifts the day (and
// even the month, e.g. Aug 1 → Jul 31). Appending 'T00:00:00' (no Z) keeps it
// on the intended calendar day.
function localDate(s) {
  return new Date(String(s).slice(0, 10) + 'T00:00:00');
}

export default function Dashboard() {
  const navigate = useNavigate();
  const deepDiveRef = useRef(null);
  const go = (path) => () => navigate(path);
  const focusStore = (s) => () => {
    setStore(s);
    requestAnimationFrame(() => deepDiveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const [store, setStore] = useState('ARDEN');                 // ARDEN | WAYNESVILLE
  const [category, setCategory] = useState('Written');         // Written | Delivered
  const [period, setPeriod] = useState('daily');               // daily (yesterday) | monthly
  // The monthly view's queries are heavy; only run them when Monthly is active
  // (in Daily mode the whole monthly section is hidden, so they'd be wasted).
  const monthlyOn = { enabled: period === 'monthly' };
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  // Detail-panel state — non-null value opens the MetricDrilldown modal.
  const [drilldown, setDrilldown] = useState(null);
  const openDetail = (config) => () => setDrilldown(config);

  const cyCol = category === 'Written' ? 'CurrentYear_W' : 'CurrentYear_D';
  const lyCol = category === 'Written' ? 'LastYear_W'    : 'LastYear_D';

  const monthName = MONTHS.find((m) => m.num === month)?.name || 'January';
  const today = new Date();
  const isCurrentMonth = month === today.getMonth() + 1;

  // ── 1) Comparative daily sales (LY vs TY) for selected store/category/month
  const dailySql = `
    SELECT DayMonth, ISNULL(${lyCol}, 0) AS lastYear, ISNULL(${cyCol}, 0) AS thisYear
    FROM SalesAggrDayWiseReport
    WHERE ProfitCenter = '${store}' AND DayMonth LIKE '%${monthName}'
    ORDER BY TRY_CONVERT(DATE,
      LEFT(DayMonth, 2) + ' ' + LEFT(SUBSTRING(DayMonth, 4, 99), 3) + ' ' + CAST(YEAR(GETDATE()) AS VARCHAR), 106)
  `;
  const dailyQ = useSqlQuery(dailySql, [], monthlyOn);
  const daily = dailyQ.data?.rows ?? [];

  // ── 2) Month totals (LY / TY) — drives the target donut
  const monthTotSql = `
    SELECT
      SUM(ISNULL(${cyCol}, 0)) AS thisYearTotal,
      SUM(ISNULL(${lyCol}, 0)) AS lastYearTotal
    FROM SalesAggrDayWiseReport
    WHERE ProfitCenter = '${store}' AND DayMonth LIKE '%${monthName}'
  `;
  const monthTotQ = useSqlQuery(monthTotSql, [], monthlyOn);
  const totals = monthTotQ.data?.rows[0] ?? { thisYearTotal: 0, lastYearTotal: 0 };

  // ── 3) Year-wise monthly summary (for the bottom chart)
  const monthlySql = `
    SELECT MonthName,
           SUM(ISNULL(${cyCol}, 0)) AS thisYear,
           SUM(ISNULL(${lyCol}, 0)) AS lastYear
    FROM SalesAggrMonthWiseReport
    WHERE ProfitCenter = '${store}'
    GROUP BY MonthName
    ORDER BY CASE MonthName
      WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
      WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
      WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
      WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
    END
  `;
  const monthlyQ = useSqlQuery(monthlySql, [], monthlyOn);
  const monthly = monthlyQ.data?.rows ?? [];

  // ── derive: comparative daily with running totals
  const dailyChart = useMemo(() => {
    let lyRun = 0, tyRun = 0;
    return daily.map((r) => {
      lyRun += Number(r.lastYear) || 0;
      tyRun += Number(r.thisYear) || 0;
      return {
        day: String(r.DayMonth || '').slice(0, 2),
        ly: Number(r.lastYear) || 0,
        ty: Number(r.thisYear) || 0,
        lyRun, tyRun,
      };
    });
  }, [daily]);

  // Yesterday's sales for the selected store + W/D. The warehouse pre-creates
  // rows for every day of the month, so the literal "last row" can be a
  // future date with zero sales. Walk backwards until we find a day that
  // actually has sales — that's the most recent real day.
  const { yestRev, yestDayLabel } = useMemo(() => {
    for (let i = dailyChart.length - 1; i >= 0; i--) {
      const ty = Number(dailyChart[i]?.ty) || 0;
      if (ty > 0) {
        return { yestRev: ty, yestDayLabel: `${monthName.slice(0, 3)} ${dailyChart[i]?.day}` };
      }
    }
    return { yestRev: 0, yestDayLabel: null };
  }, [dailyChart, monthName]);

  // ── derive: target metrics
  const days = daysInMonth(month, today.getFullYear());
  const todayDay = today.getDate();
  const elapsedDays = isCurrentMonth ? Math.max(1, todayDay - 1) : days;
  const daysLeft = isCurrentMonth ? Math.max(0, days - elapsedDays) : 0;

  const lastYearMonthTotal = Number(totals.lastYearTotal) || 0;
  const thisYearMonthTotal = Number(totals.thisYearTotal) || 0;
  const target = lastYearMonthTotal * 1.10;
  const progressPct = target > 0 ? Math.min(150, (thisYearMonthTotal / target) * 100) : 0;
  const remaining = Math.max(0, target - thisYearMonthTotal);
  const avgRequiredPerDay = daysLeft > 0 ? remaining / daysLeft : 0;
  const trending = isCurrentMonth && elapsedDays > 0
    ? (thisYearMonthTotal / elapsedDays) * days
    : thisYearMonthTotal;

  // MTD / averages
  const tyMtd = thisYearMonthTotal;
  const lyMtd = isCurrentMonth
    ? dailyChart.slice(0, todayDay - 1).reduce((s, r) => s + r.ly, 0)
    : lastYearMonthTotal;

  const lyAvgPerDay = lastYearMonthTotal / days;
  const tyAvgPerDay = elapsedDays > 0 ? thisYearMonthTotal / elapsedDays : 0;

  // Donut data (Achieved / Remaining or Achieved / Over)
  const donutData = useMemo(() => {
    if (target <= 0) return [];
    if (thisYearMonthTotal >= target) {
      return [
        { name: 'Achieved', value: target },
        { name: 'Over',     value: thisYearMonthTotal - target },
      ];
    }
    return [
      { name: 'Achieved',  value: thisYearMonthTotal },
      { name: 'Remaining', value: Math.max(0, target - thisYearMonthTotal) },
    ];
  }, [target, thisYearMonthTotal]);

  const donutColors = thisYearMonthTotal >= target
    ? ['hsl(var(--success))', '#fbbf24']
    : ['hsl(var(--primary))', 'rgba(148,163,184,0.25)'];

  // ── Weekly summary (1-7, 8-14, 15-21, 22-end)
  const weekly = useMemo(() => {
    const buckets = [
      { label: 'Week 1', range: [1, 7],  ly: 0, ty: 0 },
      { label: 'Week 2', range: [8, 14], ly: 0, ty: 0 },
      { label: 'Week 3', range: [15, 21],ly: 0, ty: 0 },
      { label: 'Week 4', range: [22, 31],ly: 0, ty: 0 },
    ];
    for (const r of dailyChart) {
      const day = Number(r.day) || 0;
      const b = buckets.find((b) => day >= b.range[0] && day <= b.range[1]);
      if (!b) continue;
      b.ly += r.ly;
      b.ty += r.ty;
    }
    return buckets;
  }, [dailyChart]);

  // ── Quarterly summary (from monthly data)
  const quarterly = useMemo(() => {
    return QUARTERS.map((q) => {
      const rows = monthly.filter((m) => q.months.includes(m.MonthName));
      const ty = rows.reduce((s, r) => s + (Number(r.thisYear) || 0), 0);
      const ly = rows.reduce((s, r) => s + (Number(r.lastYear) || 0), 0);
      return { label: q.label, ly, ty };
    });
  }, [monthly]);

  // ══════════════════════════════════════════════════════════════════════════
  // COMPANY-WIDE OWNER OVERVIEW — independent of the store/category/month
  // filter above. Always shows the whole company (both stores), current month,
  // using Written (booked) sales as the headline metric. Comparisons are made
  // fair: current-month uses MTD vs last-year-same-period (completed days
  // only), and YTD uses completed months + current-month MTD.
  // ══════════════════════════════════════════════════════════════════════════
  const curMonthNum  = today.getMonth() + 1;
  const curMonthName = MONTHS.find((m) => m.num === curMonthNum)?.name || 'January';
  const curDay       = today.getDate();
  const curYear      = today.getFullYear();

  // 1) Current-month day-wise, per store, both stores — for a fair company MTD.
  const companyDaySql = `
    SELECT ProfitCenter, DayMonth,
           SUM(ISNULL(CurrentYear_W, 0)) AS ty,
           SUM(ISNULL(LastYear_W, 0))    AS ly
    FROM SalesAggrDayWiseReport
    WHERE DayMonth LIKE ?
    GROUP BY ProfitCenter, DayMonth
  `;
  const companyDayQ = useSqlQuery(companyDaySql, [`%${curMonthName}`], monthlyOn);
  const companyDayRows = companyDayQ.data?.rows ?? [];

  // 2) Month-wise per store — drives YTD totals, store scoreboard, monthly chart.
  const companyMonthSql = `
    SELECT ProfitCenter, MonthName,
           SUM(ISNULL(CurrentYear_W, 0)) AS thisYear,
           SUM(ISNULL(LastYear_W, 0))    AS lastYear
    FROM SalesAggrMonthWiseReport
    GROUP BY ProfitCenter, MonthName
  `;
  const companyMonthQ = useSqlQuery(companyMonthSql, [], monthlyOn);
  const companyMonthRows = companyMonthQ.data?.rows ?? [];

  // 3) Receivables + open-order backlog + open damages (MS SQL warehouse).
  const opsMsSql = `
    SELECT
      (SELECT COUNT(*)                     FROM SalesOpenDaily WHERE ISNULL(ReceivableAmt, 0) > 0) AS recvCount,
      (SELECT SUM(ISNULL(ReceivableAmt,0)) FROM SalesOpenDaily WHERE ISNULL(ReceivableAmt, 0) > 0) AS recvTotal,
      (SELECT SUM(CASE WHEN ISNULL(Age,0) > 60 THEN ISNULL(ReceivableAmt,0) ELSE 0 END)
                                           FROM SalesOpenDaily WHERE ISNULL(ReceivableAmt, 0) > 0) AS recvAged,
      (SELECT COUNT(*)                     FROM SalesOpenDaily WHERE sale_open_close = 'OPEN') AS openOrders,
      (SELECT SUM(ISNULL(SaleTotalAmt,0))  FROM SalesOpenDaily WHERE sale_open_close = 'OPEN') AS backlogValue,
      (SELECT COUNT(*)                     FROM DamagedItemsFormCapture
                                           WHERE Status IS NULL OR LTRIM(RTRIM(Status)) = '') AS damagesOpen
  `;
  const opsMsQ = useSqlQuery(opsMsSql, [], monthlyOn);
  const opsMs = opsMsQ.data?.rows?.[0] ?? {};

  // 4) Service load + hot-button issues (MySQL app DB).
  const opsMySql = `
    SELECT
      (SELECT COUNT(*) FROM salesopendaily   WHERE service = 1 AND sale_open_close = 'OPEN') AS openService,
      (SELECT COUNT(*) FROM svc_need_attention WHERE is_resolved = 0)    AS svcAttention,
      (SELECT COUNT(*) FROM hotbutton_issues   WHERE is_resolved = false) AS hotOpen
  `;
  const opsMyQ = useMysqlQuery(opsMySql, [], monthlyOn);
  const opsMy = opsMyQ.data?.rows?.[0] ?? {};

  // 5) Sales pipeline — active leads (MySQL app DB).
  const leadsSql = `
    SELECT
      SUM(CASE WHEN LOWER(TRIM(status)) NOT LIKE 'closed%' THEN 1 ELSE 0 END) AS activeLeads,
      SUM(CASE WHEN UPPER(TRIM(concern_type)) = 'HOT'
                AND LOWER(TRIM(status)) NOT LIKE 'closed%' THEN 1 ELSE 0 END)  AS hotLeads
    FROM leads
  `;
  const leadsQ = useMysqlQuery(leadsSql, [], monthlyOn);
  const leadsRow = leadsQ.data?.rows?.[0] ?? {};

  // ── derive: company MTD (completed days only) + per-store MTD + sparkline
  const companyMtd = useMemo(() => {
    const perStore = {};
    let mtdTy = 0, mtdLy = 0;
    const byDay = new Map();
    for (const r of companyDayRows) {
      const dayNum = parseInt(String(r.DayMonth).split('-')[0], 10);
      if (!(dayNum < curDay)) continue;            // only fully-completed days
      const ty = Number(r.ty) || 0, ly = Number(r.ly) || 0;
      const st = r.ProfitCenter;
      (perStore[st] ||= { ty: 0, ly: 0 });
      perStore[st].ty += ty; perStore[st].ly += ly;
      mtdTy += ty; mtdLy += ly;
      byDay.set(dayNum, (byDay.get(dayNum) || 0) + ty);
    }
    const spark = [...byDay.keys()].sort((a, b) => a - b).map((k) => ({ value: byDay.get(k) }));
    return { mtdTy, mtdLy, perStore, spark };
  }, [companyDayRows, curDay]);

  // ── derive: company YTD (completed months) + monthly chart + current-mo LY
  const companyAgg = useMemo(() => {
    const byMonth = new Map();
    for (const r of companyMonthRows) {
      const m = byMonth.get(r.MonthName) || { ty: 0, ly: 0 };
      m.ty += Number(r.thisYear) || 0;
      m.ly += Number(r.lastYear) || 0;
      byMonth.set(r.MonthName, m);
    }
    let completedTy = 0, completedLy = 0;
    for (const mo of MONTHS) {
      if (mo.num < curMonthNum) {
        const m = byMonth.get(mo.name);
        if (m) { completedTy += m.ty; completedLy += m.ly; }
      }
    }
    const chart = MONTHS.map((mo) => {
      const m = byMonth.get(mo.name) || { ty: 0, ly: 0 };
      return { month: mo.short, thisYear: m.ty, lastYear: m.ly };
    });
    const curM = byMonth.get(curMonthName) || { ty: 0, ly: 0 };
    return { completedTy, completedLy, chart, curMonthLyFull: curM.ly };
  }, [companyMonthRows, curMonthNum, curMonthName]);

  // ── derive: company headline numbers (fair comparisons)
  const compMtdTy   = companyMtd.mtdTy;
  const compMtdLy   = companyMtd.mtdLy;
  const compMonthYoY = compMtdLy > 0 ? ((compMtdTy - compMtdLy) / compMtdLy) * 100 : null;

  const compYtdTy   = companyAgg.completedTy + compMtdTy;        // completed mo + current MTD
  const compYtdLy   = companyAgg.completedLy + compMtdLy;        // completed mo + LY same period
  const compYtdYoY  = compYtdLy > 0 ? ((compYtdTy - compYtdLy) / compYtdLy) * 100 : null;

  const compDays     = daysInMonth(curMonthNum, curYear);
  const compElapsed  = Math.max(1, curDay - 1);
  const compTarget   = companyAgg.curMonthLyFull * 1.10;
  const compTrending = compElapsed > 0 ? (compMtdTy / compElapsed) * compDays : compMtdTy;

  // ── derive: store scoreboard (Arden vs Waynesville) — fair YTD + MTD
  const storeBoard = useMemo(() => {
    const defs = [
      { key: 'ARDEN',       label: 'Arden',       tag: 'S1' },
      { key: 'WAYNESVILLE', label: 'Waynesville', tag: 'S2' },
    ];
    return defs.map((s) => {
      let ytdTy = 0, ytdLy = 0;
      for (const r of companyMonthRows) {
        if (r.ProfitCenter !== s.key) continue;
        const idx = MONTHS.find((m) => m.name === r.MonthName)?.num ?? 99;
        if (idx < curMonthNum) { ytdTy += Number(r.thisYear) || 0; ytdLy += Number(r.lastYear) || 0; }
      }
      const mtd = companyMtd.perStore[s.key] || { ty: 0, ly: 0 };
      const fullYtdTy = ytdTy + mtd.ty;
      const fullYtdLy = ytdLy + mtd.ly;
      const yoy = fullYtdLy > 0 ? ((fullYtdTy - fullYtdLy) / fullYtdLy) * 100 : null;
      return { ...s, mtdTy: mtd.ty, mtdLy: mtd.ly, ytdTy: fullYtdTy, ytdLy: fullYtdLy, yoy };
    });
  }, [companyMonthRows, companyMtd, curMonthNum]);

  const companyLoading = companyDayQ.isLoading || companyMonthQ.isLoading;

  // Store → sale-ticket prefix used by SalesItemDetail queries.
  // An item's store is the first digit of its SaleNo ('1' = Arden, '2' =
  // Waynesville) — the same key SalespersonDaily uses. We deliberately do NOT
  // filter on the BLDG column: BLDG is the item's physical building and is 999
  // (central warehouse) for ~80% of rows, so filtering on it drops most of a
  // store's actual sales (e.g. SIGN at Arden showed 41 instead of 276).
  const STORE_TO_BLDG = { ARDEN: 1, WAYNESVILLE: 2 };
  const selectedBldg  = STORE_TO_BLDG[store];

  // ── Recency: per-day revenue across the last 31 days, FILTERED BY SELECTED STORE.
  // We fetch 31 days so the 7-day-vs-prior-7d comparison still works around
  // month boundaries; everything else (best/lowest day, this-month totals,
  // avg order, new customers) filters to the current calendar month.
  // Uses the same Written-sales source so numbers reconcile with SCR.
  const recencySql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalespersonDaily),
         a AS (
           SELECT
             TRY_CONVERT(DATE,
               LEFT(DayMonth, 2) + ' ' + LEFT(SUBSTRING(DayMonth, 4, 99), 3) + ' ' + CAST(YEAR(m.d) AS VARCHAR),
               106
             ) AS dt,
             ISNULL(CurrentYear_W, 0) AS rev,
             m.d AS maxDate
           FROM SalesAggrDayWiseReport
           CROSS JOIN m
           WHERE ProfitCenter = '${store}'
         )
    SELECT CONVERT(char(10), a.dt, 23) AS day, SUM(a.rev) AS revenue
    FROM a
    WHERE a.dt IS NOT NULL
      AND a.dt BETWEEN DATEADD(day, -30, a.maxDate) AND a.maxDate
    GROUP BY a.dt
    ORDER BY a.dt
  `;
  const recencyQ = useSqlQuery(recencySql, [], monthlyOn);
  const recencyRows = recencyQ.data?.rows ?? [];

  // Order counts + this-month revenue — all from SalespersonDaily, the
  // canonical per-sale table. A sale's store is its SalesNo prefix ('1' = S1,
  // '2' = S2), so we filter on LEFT(SalesNo, 1). Using SaleDate (the actual
  // sale date) — NOT a modification date — so the counts are stable.
  //
  // thisMonthRev is summed from the SAME source as thisMonthOrders, so the
  // Avg Order Value tile (revenue ÷ orders) is internally consistent.
  //
  // "new customers" is a TRUE first-time-buyer count: MIN(SaleDate) is taken
  // across ALL of a customer's sales (any store), so someone who bought at S2
  // last year isn't flagged as new when they first visit S1 this month.
  const spdStore = `LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${selectedBldg}'`;
  const orderCountSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalespersonDaily),
         fc AS (
           SELECT sd.CustomerId, MIN(sd.SaleDate) AS firstSale
           FROM SalespersonDaily sd
           WHERE sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> ''
           GROUP BY sd.CustomerId
         )
    SELECT
      (SELECT COUNT(DISTINCT sd.SalesNo) FROM SalespersonDaily sd CROSS JOIN m m2
        WHERE ${spdStore} AND sd.SaleDate = m2.d)                                     AS yestOrders,
      (SELECT COUNT(DISTINCT sd.SalesNo) FROM SalespersonDaily sd CROSS JOIN m m2
        WHERE ${spdStore} AND sd.SaleDate >= DATEADD(day, -6, m2.d)
          AND sd.SaleDate <= m2.d)                                                    AS last7Orders,
      (SELECT COUNT(DISTINCT sd.SalesNo) FROM SalespersonDaily sd CROSS JOIN m m2
        WHERE ${spdStore} AND YEAR(sd.SaleDate) = YEAR(m2.d)
          AND MONTH(sd.SaleDate) = MONTH(m2.d))                                       AS thisMonthOrders,
      (SELECT SUM(ISNULL(sd.SaleSplitAmt, 0)) FROM SalespersonDaily sd CROSS JOIN m m2
        WHERE ${spdStore} AND YEAR(sd.SaleDate) = YEAR(m2.d)
          AND MONTH(sd.SaleDate) = MONTH(m2.d))                                       AS thisMonthRev,
      (SELECT COUNT(DISTINCT sd.CustomerId)
        FROM SalespersonDaily sd
        INNER JOIN fc ON fc.CustomerId = sd.CustomerId
        CROSS JOIN m m3
        WHERE ${spdStore}
          AND YEAR(fc.firstSale) = YEAR(m3.d) AND MONTH(fc.firstSale) = MONTH(m3.d)
          AND YEAR(sd.SaleDate)  = YEAR(m3.d) AND MONTH(sd.SaleDate)  = MONTH(m3.d))  AS newCustomers,
      (SELECT COUNT(DISTINCT sd.CustomerId) FROM SalespersonDaily sd CROSS JOIN m m4
        WHERE ${spdStore} AND YEAR(sd.SaleDate) = YEAR(m4.d) AND MONTH(sd.SaleDate) = MONTH(m4.d)
          AND sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> '')          AS thisMonthCustomers
  `;
  const orderCountQ = useSqlQuery(orderCountSql, [], monthlyOn);
  const orderCount = orderCountQ.data?.rows?.[0] ?? {};

  // ── Item Sold Analysis — categorize items sold THIS MONTH (selected store)
  //    into showroom categories by matching furniture-type keywords in the
  //    item's Description2 text. Rules are checked in priority order (first
  //    match wins) so, e.g., a "dining side chair" lands in Dining before the
  //    generic "chair" rule sends it to Living Room.
  const itemCatSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
         mb AS (SELECT DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS mStart,
                       DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(d), MONTH(d), 1)) AS mEnd FROM m),
         base AS (
           SELECT UPPER(ISNULL(Description2,'')) AS d2
           FROM SalesItemDetail CROSS JOIN mb
           WHERE SaleDate >= mb.mStart AND SaleDate < mb.mEnd
             AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
         ),
         cat AS (SELECT ${roomCase} AS room FROM base)
    SELECT room, COUNT(*) AS units FROM cat GROUP BY room
  `;
  const itemCatQ = useSqlQuery(itemCatSql, [], monthlyOn);
  const itemCatByRoom = useMemo(() => {
    const map = {};
    for (const r of (itemCatQ.data?.rows ?? [])) map[r.room] = Number(r.units) || 0;
    return map;
  }, [itemCatQ.data]);

  // ── Top 5 best-selling items this month (qty + vendor + revenue). Revenue is
  //    each line's equal share of its sale's SaleWRT revenue, summed per item.
  const topItemsSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
         mb AS (SELECT DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS mStart,
                       DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(d), MONTH(d), 1)) AS mEnd FROM m),
         det AS (
           SELECT CAST(SaleNo AS VARCHAR(20)) AS SaleNo,
                  LTRIM(RTRIM(ItemID))   AS ItemID,
                  LTRIM(RTRIM(VendorID)) AS vendor,
                  LTRIM(RTRIM(ISNULL(Description2,''))) AS descr
           FROM SalesItemDetail CROSS JOIN mb
           WHERE SaleDate >= mb.mStart AND SaleDate < mb.mEnd
             AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
             AND ItemID IS NOT NULL AND LTRIM(RTRIM(ItemID)) <> ''
         ),
         saleTot AS (SELECT SaleNo, COUNT(*) AS totItems FROM det GROUP BY SaleNo),
         saleRev AS (
           SELECT CAST(S.wrt_so_no AS VARCHAR(20)) AS SaleNo, SUM(S.wrt_sls) AS amt
           FROM SaleWRT S CROSS JOIN mb
           WHERE S.wrt_pft_ctr = ${selectedBldg}
             AND S.wrt_cng_bdat >= mb.mStart AND S.wrt_cng_bdat < mb.mEnd
           GROUP BY CAST(S.wrt_so_no AS VARCHAR(20))
         ),
         lines AS (
           SELECT d.ItemID, d.vendor, d.descr,
                  ISNULL(sr.amt, 0) * 1.0 / NULLIF(st.totItems, 0) AS lineRev
           FROM det d JOIN saleTot st ON st.SaleNo = d.SaleNo
           LEFT JOIN saleRev sr ON sr.SaleNo = d.SaleNo
         )
    SELECT TOP 5 ItemID,
           MAX(descr)  AS descr,
           MAX(vendor) AS vendor,
           COUNT(*)    AS qty,
           SUM(lineRev) AS revenue
    FROM lines GROUP BY ItemID ORDER BY qty DESC
  `;
  const topItemsQ = useSqlQuery(topItemsSql, [], monthlyOn);
  const topItems = topItemsQ.data?.rows ?? [];
  // Same items, ranked by revenue instead of quantity.
  const topItemsRevSql = topItemsSql.replace('ORDER BY qty DESC', 'ORDER BY revenue DESC');
  const topItemsRevQ = useSqlQuery(topItemsRevSql, [], monthlyOn);
  const topItemsRev = topItemsRevQ.data?.rows ?? [];

  // ── Salesperson codes → names (MySQL employees.rv_code → name).
  const empQ = useMysqlQuery('SELECT rv_code, name FROM employees', [], monthlyOn);
  const empMap = useMemo(() => {
    const map = {};
    for (const r of (empQ.data?.rows ?? [])) {
      const c = String(r.rv_code || '').trim().toUpperCase();
      if (c) map[c] = String(r.name || '').trim();
    }
    return map;
  }, [empQ.data]);
  const resolveSp = (raw) => String(raw || '').split('/')
    .map((p) => { const c = p.trim(); const f = empMap[c.toUpperCase()]; return f ? (f.trim().split(/\s+/)[0] || f) : c; })
    .filter(Boolean).join(' / ') || String(raw || '—');
  const resolveSpFull = (raw) => String(raw || '').split('/')
    .map((p) => { const c = p.trim(); return empMap[c.toUpperCase()] || c; })
    .filter(Boolean).join(' / ') || String(raw || '—');

  // ── Top 3 salespeople this month (by revenue) + a See-all list.
  const monthSpSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalespersonDaily),
         mb AS (SELECT DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS mStart,
                       DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(d), MONTH(d), 1)) AS mEnd FROM m)
    SELECT TOP 3 LTRIM(RTRIM(sd.SalesPerson)) AS salesperson,
           COUNT(DISTINCT sd.SalesNo)         AS orders,
           SUM(ISNULL(sd.SaleSplitAmt, 0))    AS revenue
    FROM SalespersonDaily sd CROSS JOIN mb
    WHERE sd.SaleDate >= mb.mStart AND sd.SaleDate < mb.mEnd AND ${spdStore}
      AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    GROUP BY LTRIM(RTRIM(sd.SalesPerson))
    ORDER BY revenue DESC
  `;
  const monthSpQ = useSqlQuery(monthSpSql, [], monthlyOn);
  const monthSp = monthSpQ.data?.rows ?? [];
  const allMonthSpSql = monthSpSql.replace('TOP 3 ', '');

  // ── Vendor Wise Analysis — top 5 vendors by units sold this month (selected
  //    store). Clicking a vendor drills into their item-type breakdown.
  // Top 5 vendors ranked BY REVENUE (this month). SalesItemDetail has no
  // per-line price, so each sale's revenue (SaleWRT) is split across its vendors
  // in proportion to item count; vendors are then ranked by that revenue.
  const vendorAnalysisSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
         mb AS (SELECT DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS mStart,
                       DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(d), MONTH(d), 1)) AS mEnd FROM m),
         det AS (
           SELECT CAST(SaleNo AS VARCHAR(20)) AS SaleNo,
                  LTRIM(RTRIM(VendorID))       AS vendor,
                  LTRIM(RTRIM(ItemID))         AS ItemID
           FROM SalesItemDetail CROSS JOIN mb
           WHERE SaleDate >= mb.mStart AND SaleDate < mb.mEnd
             AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
             AND VendorID IS NOT NULL AND LTRIM(RTRIM(VendorID)) NOT IN ('CFC', 'USLD', 'NONE', '')
         ),
         vitems AS (SELECT SaleNo, vendor, COUNT(*) AS items FROM det GROUP BY SaleNo, vendor),
         saleTot AS (SELECT SaleNo, SUM(items) AS totItems FROM vitems GROUP BY SaleNo),
         saleRev AS (
           SELECT CAST(S.wrt_so_no AS VARCHAR(20)) AS SaleNo, SUM(S.wrt_sls) AS amt
           FROM SaleWRT S CROSS JOIN mb
           WHERE S.wrt_pft_ctr = ${selectedBldg}
             AND S.wrt_cng_bdat >= mb.mStart AND S.wrt_cng_bdat < mb.mEnd
           GROUP BY CAST(S.wrt_so_no AS VARCHAR(20))
         ),
         vrev AS (
           SELECT vi.vendor, SUM(ISNULL(sr.amt, 0) * vi.items * 1.0 / NULLIF(st.totItems, 0)) AS revenue
           FROM vitems vi JOIN saleTot st ON st.SaleNo = vi.SaleNo
           LEFT JOIN saleRev sr ON sr.SaleNo = vi.SaleNo
           GROUP BY vi.vendor
         ),
         vagg AS (SELECT vendor, COUNT(*) AS units, COUNT(DISTINCT ItemID) AS skus FROM det GROUP BY vendor)
    SELECT TOP 5 vagg.vendor AS vendor, vagg.units AS units, vagg.skus AS skus, ISNULL(vrev.revenue, 0) AS revenue
    FROM vagg LEFT JOIN vrev ON vrev.vendor = vagg.vendor
    ORDER BY revenue DESC
  `;
  const vendorAnalysisQ = useSqlQuery(vendorAnalysisSql, [], monthlyOn);
  const topVendors = vendorAnalysisQ.data?.rows ?? [];
  const topVendorsRevTotal = topVendors.reduce((s, v) => s + (Number(v.revenue) || 0), 0);
  // Same query without the TOP 5 cap — powers the "See all vendors" popup.
  const allVendorsSql = vendorAnalysisSql.replace('SELECT TOP 5 vagg.vendor', 'SELECT vagg.vendor');

  // ── Area-wise sales for the selected month + store (SaleWRT + SaleRV),
  //    grouped by delivery zip and rolled up to the area (city).
  const mAreaCityExpr = `LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(SR.DeliveryCity)),''), NULLIF(LTRIM(RTRIM(SR.BillingCity)),''), 'Unknown')))`;
  const mAreaZipExpr  = `LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(SR.DeliveryZip)),''),  NULLIF(LTRIM(RTRIM(SR.BillingZip)),''),  'Unknown')))`;
  const monthAreaSql = `
    SELECT ${mAreaCityExpr} AS City,
           ${mAreaZipExpr}  AS Zip,
           SUM(S.wrt_sls)              AS Revenue,
           COUNT(DISTINCT S.wrt_so_no) AS Orders
    FROM SaleWRT S
    LEFT JOIN SaleRV SR ON S.wrt_so_no = SR.sales_no
    WHERE S.wrt_pft_ctr = ${selectedBldg}
      AND S.wrt_cng_bdat >= DATEFROMPARTS(${curYear}, ${month}, 1)
      AND S.wrt_cng_bdat <  DATEADD(MONTH, 1, DATEFROMPARTS(${curYear}, ${month}, 1))
    GROUP BY ${mAreaCityExpr}, ${mAreaZipExpr}
    HAVING SUM(S.wrt_sls) <> 0
    ORDER BY Revenue DESC
  `;
  const monthAreaQ = useSqlQuery(monthAreaSql, [], monthlyOn);
  const monthAreas = useMemo(() => {
    const rows = monthAreaQ.data?.rows ?? [];
    const map = new Map();
    let total = 0;
    for (const r of rows) {
      const name = String(r.City || 'Unknown').trim() || 'Unknown';
      const zip  = String(r.Zip || '').trim() || '—';
      const rev  = Number(r.Revenue) || 0;
      const ord  = Number(r.Orders) || 0;
      total += rev;
      if (!map.has(name)) map.set(name, { name, revenue: 0, orders: 0, zips: [] });
      const a = map.get(name);
      a.revenue += rev; a.orders += ord;
      a.zips.push({ zip, revenue: rev, orders: ord });
    }
    const areas = [...map.values()]
      .map((a) => ({ ...a, zipCount: a.zips.length, zips: a.zips.sort((x, y) => y.revenue - x.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    return { areas, total };
  }, [monthAreaQ.data]);

  // Drill-down config listing one area's zip codes for the selected month.
  const monthAreaZipConfig = (a) => ({
    title: `${a.name} · Zip Codes · ${monthName}`,
    icon: MapPin,
    accent: 'primary',
    headline: fmtCurrency(a.revenue),
    subtitle: `${fmtNumber(a.zipCount)} zip code${a.zipCount === 1 ? '' : 's'} · ${fmtNumber(a.orders)} order${a.orders === 1 ? '' : 's'}`,
    loadRows: () => a.zips.map((z) => ({ zip: z.zip, orders: z.orders, revenue: z.revenue })),
    detailsColumns: [
      { key: 'zip', label: 'Zip Code', render: (r) => <span className="font-mono font-semibold">{r.zip}</span> },
      { key: 'orders', label: 'Orders', align: 'right', render: (r) => fmtNumber(r.orders) },
      { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(r.revenue)}</span> },
    ],
    detailsEmpty: 'No zip codes',
  });

  // ── derive: recency KPIs (yesterday / 7d) + this-month rollups.
  // Best/lowest day are calculated within the current calendar month so they
  // can't be skewed by an outlier day from the prior month.
  const recency = useMemo(() => {
    if (!recencyRows.length) return null;
    // row.day is a 'YYYY-MM-DD' calendar-date string. Compare by string / local
    // date so nothing shifts across the UTC boundary (see localDate()).
    const sorted = [...recencyRows].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    const latest    = String(sorted[sorted.length - 1].day).slice(0, 10);
    const latestMs  = localDate(latest).getTime();
    const latestYM  = latest.slice(0, 7);                    // 'YYYY-MM'
    const dayMs = 86_400_000;
    let yestRev = 0, last7Rev = 0, prev7Rev = 0, thisMonthRev = 0;
    let bestDay = null, lowestDay = null;
    for (const row of sorted) {
      const dayStr  = String(row.day).slice(0, 10);
      const daysAgo = Math.round((latestMs - localDate(dayStr).getTime()) / dayMs);
      const rev = Number(row.revenue) || 0;
      if (daysAgo === 0) yestRev += rev;
      if (daysAgo <= 6  && daysAgo >= 0) last7Rev += rev;
      if (daysAgo >= 7  && daysAgo <= 13) prev7Rev += rev;
      // Within the same calendar month as the latest data row.
      if (dayStr.slice(0, 7) === latestYM) {
        thisMonthRev += rev;
        if (!bestDay   || rev > bestDay.rev)   bestDay   = { date: dayStr, rev };
        if (!lowestDay || rev < lowestDay.rev) lowestDay = { date: dayStr, rev };
      }
    }
    const last7vsPrev = prev7Rev > 0 ? ((last7Rev - prev7Rev) / prev7Rev) * 100 : null;
    const sparkline   = sorted.slice(-14).map((r) => ({ value: Number(r.revenue) || 0 }));
    return { latestDate: latest, yestRev, last7Rev, thisMonthRev, prev7Rev, bestDay, lowestDay, last7vsPrev, sparkline };
  }, [recencyRows]);

  const yestOrders       = Number(orderCount.yestOrders)       || 0;
  const last7Orders      = Number(orderCount.last7Orders)      || 0;
  const thisMonthOrders  = Number(orderCount.thisMonthOrders)  || 0;
  const newCustomers     = Number(orderCount.newCustomers)     || 0;
  // Customer mix: total distinct customers this month, split into first-time
  // (newCustomers) and returning (bought before this month). Both derive from
  // the same universe so returning = total − new can never go negative.
  const totalCustomers     = Number(orderCount.thisMonthCustomers) || 0;
  const returningCustomers = Math.max(0, totalCustomers - newCustomers);
  // Avg order value uses SalespersonDaily revenue ÷ SalespersonDaily orders —
  // both from the same query, so they can't disagree.
  const spdMonthRev      = Number(orderCount.thisMonthRev)     || 0;
  const avgOrder         = thisMonthOrders > 0 ? spdMonthRev / thisMonthOrders : null;
  const latestDateLabel = recency?.latestDate
    ? localDate(recency.latestDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Yesterday';

  return (
    <>
      <Topbar title="Dashboard" subtitle={`${store === 'ARDEN' ? 'S1 · Arden' : 'S2 · Waynesville'} · ${category} · ${monthName}`} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* ═══════════════ TOP FILTER (drives all per-store metrics below) ═══════════════ */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <FilterPill active={store === 'ARDEN'}       onClick={() => setStore('ARDEN')}      title="Arden">S1</FilterPill>
              <FilterPill active={store === 'WAYNESVILLE'} onClick={() => setStore('WAYNESVILLE')}title="Waynesville">S2</FilterPill>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <FilterPill active={category === 'Written'}   onClick={() => setCategory('Written')}  title="Written sales">W</FilterPill>
              <FilterPill active={category === 'Delivered'} onClick={() => setCategory('Delivered')}title="Delivered sales">D</FilterPill>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <FilterPill active={period === 'daily'}   onClick={() => setPeriod('daily')}   title="Yesterday view">Daily</FilterPill>
              <FilterPill active={period === 'monthly'} onClick={() => setPeriod('monthly')} title="This-month view">Monthly</FilterPill>
            </div>
            {period === 'monthly' && (
              <div className="ml-auto flex flex-wrap gap-1">
                {MONTHS.map((m) => (
                  <FilterPill key={m.num} active={month === m.num} onClick={() => setMonth(m.num)} title={m.name} small>
                    {m.short}
                  </FilterPill>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {period === 'daily' ? (
          <DashboardDaily store={store} selectedBldg={selectedBldg} />
        ) : (
        <>
        {/* ═══════════════ YESTERDAY (headline) ═══════════════ */}
        <HeroBanner
          icon={Calendar}
          decorIcon={Calendar}
          accent={yestRev >= (lastYearMonthTotal / days) ? 'emerald' : 'amber'}
        >
          <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
            {store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'} · {category} · Most recent day on file
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span
              title={fmtCurrency(yestRev, true)}
              className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-emerald-600 to-teal-500 bg-clip-text text-transparent"
            >
              {fmtCurrency(yestRev)}
            </span>
            <span className="text-sm font-medium text-muted-fg">{yestDayLabel ? `on ${yestDayLabel}` : 'no data yet'}</span>
          </div>
        </HeroBanner>

        {/* ═══════════════ CURRENT-MONTH headline tiles (per selected filters) ═══════════════ */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label={`Sales · ${monthName} ${today.getFullYear()}`}
            value={fmtCompactCurrency(thisYearMonthTotal)}
            fullValue={fmtCurrency(thisYearMonthTotal)}
            icon={DollarSign}
            accent="primary"
            subtitle={(() => {
              if (lastYearMonthTotal <= 0) return 'Selected store';
              const diff = thisYearMonthTotal - lastYearMonthTotal;
              const pct  = (diff / lastYearMonthTotal) * 100;
              const up   = diff >= 0;
              return `${up ? '▲' : '▼'} ${up ? '+' : '−'}${fmtCompactCurrency(Math.abs(diff))} (${up ? '+' : ''}${pct.toFixed(1)}%) vs LY ${fmtCompactCurrency(lastYearMonthTotal)}`;
            })()}
            loading={monthTotQ.isLoading}
          />
          <HeroStat
            label="Target"
            value={fmtCompactCurrency(target)}
            fullValue={fmtCurrency(target)}
            icon={Target}
            accent="violet"
            subtitle="Stretch goal"
            loading={monthTotQ.isLoading}
          />
          <HeroStat
            label="Trending (Forecast)"
            value={fmtCompactCurrency(trending)}
            fullValue={fmtCurrency(trending)}
            icon={TrendingUp}
            accent={trending >= target ? 'emerald' : 'amber'}
            urgent={trending < target && target > 0}
            subtitle={target > 0 ? `${trending >= target ? '▲' : '▼'} vs target ${fmtCompactCurrency(Math.abs(trending - target))}` : null}
            loading={monthTotQ.isLoading}
          />
          <HeroStat
            label={daysLeft > 0 ? `Avg Req/Day (${daysLeft} left)` : 'Avg Sales/Day'}
            value={fmtCompactCurrency(daysLeft > 0 ? avgRequiredPerDay : tyAvgPerDay)}
            fullValue={fmtCurrency(daysLeft > 0 ? avgRequiredPerDay : tyAvgPerDay)}
            icon={Activity}
            accent={daysLeft > 0 ? 'amber' : 'sky'}
            urgent={daysLeft > 0 && avgRequiredPerDay > tyAvgPerDay * 1.5}
            subtitle={daysLeft > 0 ? `Current avg ${fmtCompactCurrency(tyAvgPerDay)} / day` : 'Average per day this month'}
            loading={monthTotQ.isLoading}
          />
        </div>

        {/* ─── Area Wise Sales (selected month, top 5) ─── */}
        <SectionHeading
          icon={MapPin}
          title={`Area Wise Sales · ${monthName} · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`}
          hint={monthAreas.total > 0
            ? `${fmtNumber(monthAreas.areas.length)} areas · ${fmtCurrency(monthAreas.total)}`
            : 'Top 5 areas by revenue'}
          action={monthAreas.areas.length > 0 ? (
            <button
              type="button"
              onClick={openDetail({
                title: `All Areas · ${monthName} · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                icon: MapPin,
                accent: 'primary',
                headline: fmtCurrency(monthAreas.total),
                subtitle: `${fmtNumber(monthAreas.areas.length)} areas · click an area to see its zip codes`,
                loadRows: () => monthAreas.areas.map((a) => ({ name: a.name, zips: a.zipCount, orders: a.orders, revenue: a.revenue, _area: a })),
                detailsColumns: [
                  { key: 'name', label: 'Area' },
                  { key: 'zips', label: 'Zip Codes', align: 'right', render: (r) => fmtNumber(r.zips) },
                  { key: 'orders', label: 'Orders', align: 'right', render: (r) => fmtNumber(r.orders) },
                  { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(r.revenue)}</span> },
                ],
                onRowClick: (row) => monthAreaZipConfig(row._area),
                detailsEmpty: 'No sales this month',
              })}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
            >
              See all areas <ChevronRight size={13} />
            </button>
          ) : null}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {monthAreaQ.isLoading ? (
            <div className="col-span-2 lg:col-span-5 py-6 text-center text-xs text-muted-fg">Loading…</div>
          ) : monthAreas.areas.length === 0 ? (
            <div className="col-span-2 lg:col-span-5 py-6 text-center text-xs text-muted-fg">No sales for {monthName}.</div>
          ) : monthAreas.areas.slice(0, 5).map((a, i) => {
            const share = monthAreas.total ? ((a.revenue / monthAreas.total) * 100).toFixed(1) : '0';
            return (
              <HeroStat
                key={a.name}
                label={a.name}
                value={fmtCompactCurrency(a.revenue)}
                fullValue={fmtCurrency(a.revenue)}
                icon={MapPin}
                accent={['primary', 'emerald', 'amber', 'violet', 'sky'][i % 5]}
                subtitle={`${fmtNumber(a.zipCount)} zip${a.zipCount === 1 ? '' : 's'} · ${fmtNumber(a.orders)} ord · ${share}%`}
                loading={monthAreaQ.isLoading}
                onClick={openDetail(monthAreaZipConfig(a))}
              />
            );
          })}
        </div>
        {/* ─── Company Snapshot ─── */}
        <SectionHeading icon={Sparkles} title="Company Snapshot" hint="Click any tile to see the details" />
        {/* YTD vs Last Year — full-width horizontal comparison card */}
        <button
          type="button"
          onClick={openDetail({
            title: 'YTD vs Last Year · Monthly Breakdown',
            icon: compYtdYoY != null && compYtdYoY >= 0 ? TrendingUp : TrendingDown,
            accent: compYtdYoY == null ? 'sky' : compYtdYoY >= 5 ? 'emerald' : compYtdYoY >= -5 ? 'amber' : 'rose',
            headline: compYtdLy > 0 ? `${fmtCompactCurrency(compYtdTy)} vs ${fmtCompactCurrency(compYtdLy)}` : '—',
            fullHeadline: compYtdLy > 0 ? `${fmtCurrency(compYtdTy)} vs ${fmtCurrency(compYtdLy)}` : null,
            subtitle: compYtdYoY != null ? `${compYtdYoY >= 0 ? '+' : ''}${compYtdYoY.toFixed(1)}% vs last year — company-wide, month by month` : 'Year to date',
            detailsDb: 'sql',
            detailsSql: `
              SELECT MonthName,
                     SUM(ISNULL(CurrentYear_W, 0)) AS thisYear,
                     SUM(ISNULL(LastYear_W, 0))    AS lastYear
              FROM SalesAggrMonthWiseReport
              GROUP BY MonthName
              ORDER BY CASE MonthName
                WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
                WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
                WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
                WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
              END
            `,
            detailsColumns: [
              { key: 'MonthName',  label: 'Month' },
              { key: 'thisYear',   label: 'This Year', align: 'right', render: (r) => fmtCurrency(Number(r.thisYear) || 0) },
              { key: 'lastYear',   label: 'Last Year', align: 'right', render: (r) => <span className="text-muted-fg">{fmtCurrency(Number(r.lastYear) || 0)}</span> },
              { key: 'diff',       label: 'Δ', align: 'right', render: (r) => {
                const d = (Number(r.thisYear) || 0) - (Number(r.lastYear) || 0);
                return <span className={cn('font-semibold', d >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
                  {d >= 0 ? '+' : ''}{fmtCurrency(d)}
                </span>;
              }},
              { key: 'yoy',        label: 'YoY %', align: 'right', render: (r) => {
                const ty = Number(r.thisYear) || 0, ly = Number(r.lastYear) || 0;
                if (ly <= 0) return <span className="text-muted-fg">—</span>;
                const pct = ((ty - ly) / ly) * 100;
                return <span className={cn('font-semibold', pct >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300')}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </span>;
              }},
            ],
            fullReportPath: '/scr',
            fullReportLabel: 'Open Sales Comparison Report',
          })}
          className={cn(
            'group relative w-full overflow-hidden rounded-2xl border bg-card text-left transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg cursor-pointer',
            compYtdYoY == null ? 'border-sky-500/40' : compYtdYoY >= 0 ? 'border-emerald-500/40' : 'border-rose-500/40',
          )}
        >
          <div className={cn('absolute inset-0 bg-gradient-to-r opacity-80',
            compYtdYoY == null ? 'from-sky-500/15 to-transparent'
              : compYtdYoY >= 0 ? 'from-emerald-500/15 to-transparent'
              : 'from-rose-500/15 to-transparent')} />
          <div className="relative flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
            {/* Left: icon + label */}
            <div className="flex items-center gap-3">
              <div className={cn('grid h-12 w-12 place-items-center rounded-xl text-white shadow-lg ring-2 shrink-0 bg-gradient-to-br',
                compYtdYoY == null ? 'from-sky-500 to-cyan-500 ring-sky-500/30'
                  : compYtdYoY >= 0 ? 'from-emerald-500 to-teal-500 ring-emerald-500/30'
                  : 'from-rose-500 to-red-500 ring-rose-500/30')}>
                {compYtdYoY != null && compYtdYoY >= 0 ? <TrendingUp size={22} /> : <TrendingDown size={22} />}
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">YTD vs Last Year</div>
                <div className="text-[11px] text-muted-fg">Company-wide · both stores</div>
              </div>
            </div>

            {/* Middle: this year vs last year, side by side */}
            <div className="flex items-center gap-6">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-fg">This Year</div>
                <div className="text-2xl font-extrabold tabular-nums tracking-tight text-fg">{compYtdLy > 0 ? fmtCurrency(compYtdTy) : '—'}</div>
              </div>
              <div className="text-xl font-light text-muted-fg">vs</div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Last Year</div>
                <div className="text-2xl font-extrabold tabular-nums tracking-tight text-muted-fg">{compYtdLy > 0 ? fmtCurrency(compYtdLy) : '—'}</div>
              </div>
            </div>

            {/* Right: YoY badge */}
            {compYtdYoY != null && (
              <div className={cn('ml-auto inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-lg font-bold tabular-nums text-white shadow-md bg-gradient-to-br',
                compYtdYoY >= 5 ? 'from-emerald-500 to-teal-500'
                  : compYtdYoY >= -5 ? 'from-amber-500 to-orange-500'
                  : 'from-rose-500 to-red-500')}>
                {compYtdYoY >= 0 ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}
                {compYtdYoY >= 0 ? '+' : ''}{compYtdYoY.toFixed(1)}%
              </div>
            )}
          </div>
        </button>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Outstanding Receivables"
            value={fmtCompactCurrency(Number(opsMs.recvTotal) || 0)}
            fullValue={fmtCurrency(Number(opsMs.recvTotal) || 0)}
            icon={Receipt}
            accent="violet"
            subtitle={`${fmtNumber(Number(opsMs.recvCount) || 0)} open · ${fmtCompactCurrency(Number(opsMs.recvAged) || 0)} aged 60d+`}
            loading={opsMsQ.isLoading}
            onClick={openDetail({
              title: 'Outstanding Receivables',
              icon: Receipt,
              accent: 'violet',
              headline: fmtCurrency(Number(opsMs.recvTotal) || 0),
              subtitle: `${fmtNumber(Number(opsMs.recvCount) || 0)} open sales with an unpaid balance`,
              detailsDb: 'sql',
              detailsSql: `
                SELECT SalesNo, SaleDate, CustomerName, Age,
                       ISNULL(ReceivableAmt, 0) AS ReceivableAmt,
                       Salesperson
                FROM SalesOpenDaily
                WHERE ISNULL(ReceivableAmt, 0) > 0
                ORDER BY Age DESC
              `,
              detailsColumns: [
                { key: 'SaleDate',       label: 'Sale Date', render: (r) => r.SaleDate ? new Date(r.SaleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—' },
                { key: 'SalesNo',        label: 'Sale #' },
                { key: 'CustomerName',   label: 'Customer' },
                { key: 'Age',            label: 'Age (days)', align: 'right', render: (r) => {
                  const age = Number(r.Age) || 0;
                  return <span className={cn('font-semibold tabular-nums', age > 60 ? 'text-rose-600 dark:text-rose-300' : age > 30 ? 'text-amber-600 dark:text-amber-300' : 'text-fg')}>{age}d</span>;
                }},
                { key: 'ReceivableAmt',  label: 'Receivable', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.ReceivableAmt) || 0)}</span> },
                { key: 'Salesperson',    label: 'Salesperson' },
              ],
              fullReportPath: '/pendingReceivables',
              fullReportLabel: 'Open Pending Receivables',
            })}
          />
          <HeroStat
            label="Open Service Orders"
            value={fmtNumber(Number(opsMy.openService) || 0)}
            icon={Wrench}
            accent="sky"
            urgent={(Number(opsMy.svcAttention) || 0) > 0}
            subtitle={(Number(opsMy.svcAttention) || 0) > 0 ? `${fmtNumber(opsMy.svcAttention)} need attention` : 'Service backlog'}
            loading={opsMyQ.isLoading}
            onClick={openDetail({
              title: 'Open Service Orders',
              icon: Wrench,
              accent: 'sky',
              headline: fmtNumber(Number(opsMy.openService) || 0),
              subtitle: 'Service tickets currently open across both stores',
              detailsDb: 'mysql',
              detailsSql: `
                SELECT s.salesno, s.customername, s.readystatus, s.deliverydate,
                       s.age, s.salesperson,
                       DATE_FORMAT(s.saledate, '%Y-%m-%d') AS sale_date
                FROM salesopendaily s
                WHERE s.service = 1 AND s.sale_open_close = 'OPEN'
                ORDER BY s.saledate
              `,
              detailsColumns: [
                { key: 'sale_date',    label: 'Sale Date' },
                { key: 'salesno',      label: 'Sale #' },
                { key: 'customername', label: 'Customer' },
                { key: 'readystatus',  label: 'Ready' },
                { key: 'deliverydate', label: 'Delivery' },
                { key: 'age',          label: 'Age (days)', align: 'right', render: (r) => {
                  const age = Number(r.age) || 0;
                  return <span className={cn('font-semibold tabular-nums', age > 60 ? 'text-rose-600 dark:text-rose-300' : age > 30 ? 'text-amber-600 dark:text-amber-300' : 'text-fg')}>{age}d</span>;
                }},
                { key: 'salesperson',  label: 'Salesperson' },
              ],
              fullReportPath: '/service-order',
              fullReportLabel: 'Open Service Order Report',
            })}
          />
          <HeroStat
            label="Hot Button Issues"
            value={fmtNumber(Number(opsMy.hotOpen) || 0)}
            icon={Flame}
            accent={(Number(opsMy.hotOpen) || 0) > 0 ? 'rose' : 'emerald'}
            urgent={(Number(opsMy.hotOpen) || 0) > 0}
            subtitle={(Number(opsMy.hotOpen) || 0) > 0 ? 'Unresolved customer escalations' : 'All clear'}
            loading={opsMyQ.isLoading}
            onClick={openDetail({
              title: 'Hot Button Issues',
              icon: Flame,
              accent: (Number(opsMy.hotOpen) || 0) > 0 ? 'rose' : 'emerald',
              headline: fmtNumber(Number(opsMy.hotOpen) || 0),
              subtitle: (Number(opsMy.hotOpen) || 0) > 0 ? 'Unresolved customer escalations — needs action' : 'All clear right now',
              detailsDb: 'mysql',
              detailsSql: `
                SELECT h.sale_number, h.customer_name, h.store, h.concern_type,
                       COALESCE(e.name, h.sales_person) AS sales_person,
                       DATE_FORMAT(h.sale_date,  '%Y-%m-%d') AS sale_date,
                       DATE_FORMAT(h.created_at, '%Y-%m-%d') AS created_on,
                       h.description
                FROM hotbutton_issues h
                LEFT JOIN employees e ON e.rv_code = h.sales_person
                WHERE h.is_resolved = false
                ORDER BY h.id DESC
              `,
              detailsColumns: [
                { key: 'created_on',    label: 'Opened' },
                { key: 'store',         label: 'Store' },
                { key: 'sale_number',   label: 'Sale #' },
                { key: 'customer_name', label: 'Customer' },
                { key: 'concern_type',  label: 'Type' },
                { key: 'sales_person',  label: 'Salesperson' },
              ],
              fullReportPath: '/hot-button-issues',
              fullReportLabel: 'Open Hot Button Issues',
            })}
          />
          <HeroStat
            label="Active Leads"
            value={fmtNumber(Number(leadsRow.activeLeads) || 0)}
            icon={Users}
            accent="amber"
            subtitle={`${fmtNumber(Number(leadsRow.hotLeads) || 0)} hot · open pipeline`}
            loading={leadsQ.isLoading}
            onClick={openDetail({
              title: 'Active Leads',
              icon: Users,
              accent: 'amber',
              headline: fmtNumber(Number(leadsRow.activeLeads) || 0),
              subtitle: `${fmtNumber(Number(leadsRow.hotLeads) || 0)} classified as hot · open pipeline`,
              detailsDb: 'mysql',
              detailsSql: `
                SELECT l.customer_name, l.contact_number, l.concern_type,
                       l.status, DATE_FORMAT(l.created_at, '%Y-%m-%d') AS created_on,
                       s.location AS store, l.looking_for, l.remarks
                FROM leads l
                LEFT JOIN store s ON s.id = l.location
                WHERE LOWER(TRIM(l.status)) NOT LIKE 'closed%'
                ORDER BY l.created_at DESC
              `,
              detailsColumns: [
                { key: 'created_on',     label: 'Created' },
                { key: 'customer_name',  label: 'Customer' },
                { key: 'contact_number', label: 'Contact' },
                { key: 'concern_type',   label: 'Type', render: (r) => r.concern_type ? <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    String(r.concern_type).toUpperCase() === 'HOT'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
                      : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200')}>{r.concern_type}</span> : '—' },
                { key: 'status',         label: 'Status' },
                { key: 'store',          label: 'Store' },
              ],
              fullReportPath: '/leads',
              fullReportLabel: 'Open Prospective Buyer report',
            })}
          />
        </div>

        {/* ─── This Month (activity for the SELECTED store only) ─── */}
        <SectionHeading
          icon={Activity}
          title={`This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`}
          hint={recency ? `Latest sale on file · ${latestDateLabel}` : 'Loading…'}
        />

        {/* Performance snapshot (highs / lows / orders / new customers) — this month */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Best Day · This Month"
            value={recency?.bestDay ? fmtCompactCurrency(recency.bestDay.rev) : '—'}
            fullValue={recency?.bestDay ? fmtCurrency(recency.bestDay.rev) : null}
            icon={Trophy}
            accent="emerald"
            subtitle={recency?.bestDay
              ? localDate(recency.bestDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'No data yet'}
            loading={recencyQ.isLoading}
            onClick={openDetail({
              title: `Best Day · This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
              icon: Trophy,
              accent: 'emerald',
              headline: recency?.bestDay ? fmtCurrency(recency.bestDay.rev) : '—',
              subtitle: recency?.bestDay
                ? `Every ticket rung up on ${localDate(recency.bestDay.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
                : 'No data yet',
              detailsDb: recency?.bestDay ? 'sql' : undefined,
              detailsSql: recency?.bestDay ? `
                SELECT sd.SalesNo,
                       MAX(sd.CustomerName) AS CustomerName,
                       MAX(sd.SalesPerson)  AS SalesPerson,
                       SUM(ISNULL(sd.SaleSplitAmt, 0)) AS amount
                FROM SalespersonDaily sd
                WHERE sd.SaleDate = '${recency.bestDay.date}'
                  AND ${spdStore}
                GROUP BY sd.SalesNo
                ORDER BY amount DESC
              ` : undefined,
              detailsColumns: [
                { key: 'SalesNo',      label: 'Sale #' },
                { key: 'CustomerName', label: 'Customer' },
                { key: 'SalesPerson',  label: 'Salesperson' },
                { key: 'amount',       label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.amount) || 0)}</span> },
              ],
              fullReportPath: '/scr',
              fullReportLabel: 'Open Sales Comparison Report',
            })}
          />
          <HeroStat
            label="Lowest Day · This Month"
            value={recency?.lowestDay ? fmtCompactCurrency(recency.lowestDay.rev) : '—'}
            fullValue={recency?.lowestDay ? fmtCurrency(recency.lowestDay.rev) : null}
            icon={TrendingDown}
            accent="amber"
            subtitle={recency?.lowestDay
              ? localDate(recency.lowestDay.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'No data yet'}
            loading={recencyQ.isLoading}
            onClick={openDetail({
              title: `Lowest Day · This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
              icon: TrendingDown,
              accent: 'amber',
              headline: recency?.lowestDay ? fmtCurrency(recency.lowestDay.rev) : '—',
              subtitle: recency?.lowestDay
                ? `Every ticket rung up on ${localDate(recency.lowestDay.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
                : 'No data yet',
              detailsDb: recency?.lowestDay ? 'sql' : undefined,
              detailsSql: recency?.lowestDay ? `
                SELECT sd.SalesNo,
                       MAX(sd.CustomerName) AS CustomerName,
                       MAX(sd.SalesPerson)  AS SalesPerson,
                       SUM(ISNULL(sd.SaleSplitAmt, 0)) AS amount
                FROM SalespersonDaily sd
                WHERE sd.SaleDate = '${recency.lowestDay.date}'
                  AND ${spdStore}
                GROUP BY sd.SalesNo
                ORDER BY amount DESC
              ` : undefined,
              detailsColumns: [
                { key: 'SalesNo',      label: 'Sale #' },
                { key: 'CustomerName', label: 'Customer' },
                { key: 'SalesPerson',  label: 'Salesperson' },
                { key: 'amount',       label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.amount) || 0)}</span> },
              ],
              fullReportPath: '/scr',
              fullReportLabel: 'Open Sales Comparison Report',
            })}
          />
          <HeroStat
            label="Orders · This Month"
            value={fmtNumber(thisMonthOrders)}
            icon={ShoppingCart}
            accent="sky"
            subtitle={last7Orders ? `${fmtNumber(last7Orders)} in last 7 days` : 'Order count'}
            loading={orderCountQ.isLoading}
            onClick={openDetail({
              title: `Orders · This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
              icon: ShoppingCart,
              accent: 'sky',
              headline: fmtNumber(thisMonthOrders),
              subtitle: `Every distinct sale ticket rung up this month`,
              detailsDb: 'sql',
              detailsSql: `
                WITH m AS (SELECT MAX(SaleDate) AS d FROM SalespersonDaily)
                SELECT sd.SalesNo,
                       MIN(sd.SaleDate) AS SaleDate,
                       MAX(sd.CustomerName) AS CustomerName,
                       MAX(sd.SalesPerson) AS SalesPerson,
                       SUM(ISNULL(sd.SaleSplitAmt, 0)) AS amount
                FROM SalespersonDaily sd
                CROSS JOIN m
                WHERE YEAR(sd.SaleDate) = YEAR(m.d) AND MONTH(sd.SaleDate) = MONTH(m.d)
                  AND ${spdStore}
                GROUP BY sd.SalesNo
                ORDER BY MIN(sd.SaleDate) DESC
              `,
              detailsColumns: [
                { key: 'SaleDate',     label: 'Date', render: (r) => r.SaleDate ? new Date(r.SaleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—' },
                { key: 'SalesNo',      label: 'Sale #' },
                { key: 'CustomerName', label: 'Customer' },
                { key: 'SalesPerson',  label: 'Salesperson' },
                { key: 'amount',       label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.amount) || 0)}</span> },
              ],
              fullReportPath: '/scr',
              fullReportLabel: 'Open Sales Comparison Report',
            })}
          />
          <CustomerMixTile
            label="Customers · This Month"
            total={totalCustomers}
            newCount={newCustomers}
            returning={returningCustomers}
            loading={orderCountQ.isLoading}
            onClick={openDetail({
              title: `Customers · This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
              icon: Users,
              accent: 'violet',
              headline: fmtNumber(totalCustomers),
              subtitle: totalCustomers
                ? `${fmtNumber(newCustomers)} new · ${fmtNumber(returningCustomers)} returning this month`
                : 'No customers this month yet',
              detailsDb: 'sql',
              detailsSql: `
                WITH m AS (SELECT MAX(SaleDate) AS d FROM SalespersonDaily),
                     fc AS (
                       SELECT sd.CustomerId, MIN(sd.SaleDate) AS firstSale
                       FROM SalespersonDaily sd
                       WHERE sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> ''
                       GROUP BY sd.CustomerId
                     )
                SELECT sd.CustomerId,
                       MAX(sd.CustomerName)      AS CustomerName,
                       MIN(fc.firstSale)         AS firstSale,
                       CASE WHEN YEAR(MIN(fc.firstSale)) = YEAR(MAX(m.d))
                                 AND MONTH(MIN(fc.firstSale)) = MONTH(MAX(m.d))
                            THEN 'New' ELSE 'Returning' END AS custType,
                       SUM(sd.SaleSplitAmt)      AS spent,
                       COUNT(DISTINCT sd.SalesNo) AS orders
                FROM SalespersonDaily sd
                INNER JOIN fc ON fc.CustomerId = sd.CustomerId
                CROSS JOIN m
                WHERE YEAR(sd.SaleDate) = YEAR(m.d) AND MONTH(sd.SaleDate) = MONTH(m.d)
                  AND ${spdStore}
                GROUP BY sd.CustomerId
                ORDER BY SUM(sd.SaleSplitAmt) DESC
              `,
              detailsColumns: [
                { key: 'custType', label: 'Type', render: (r) => (
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    r.custType === 'New'
                      ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200'
                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200')}>
                    {r.custType}
                  </span>
                )},
                { key: 'CustomerName', label: 'Customer' },
                { key: 'firstSale',    label: 'First Sale', render: (r) => r.firstSale ? new Date(r.firstSale).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—' },
                { key: 'orders',       label: 'Orders', align: 'right', render: (r) => fmtNumber(Number(r.orders) || 0) },
                { key: 'spent',        label: 'Spent', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.spent) || 0)}</span> },
              ],
              detailsEmpty: 'No customers this month yet',
              fullReportPath: '/leads',
              fullReportLabel: 'Open Prospective Buyer report',
            })}
          />
        </div>

        {/* ─── Top Salespersons (this month, selected store) ─── */}
        <SectionHeading
          icon={Award}
          title={`Top Salespersons · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`}
          hint="This month · by revenue · sales count + revenue"
          action={monthSp.length > 0 ? (
            <button
              type="button"
              onClick={openDetail({
                title: `All Salespersons · ${monthName} · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                icon: Award,
                accent: 'amber',
                subtitle: 'Everyone with sales this month, ranked by revenue',
                detailsDb: 'sql',
                detailsSql: allMonthSpSql,
                detailsColumns: [
                  { key: 'salesperson', label: 'Salesperson', render: (r) => <span className="font-semibold" title={resolveSpFull(r.salesperson)}>{resolveSp(r.salesperson)}</span> },
                  { key: 'orders',      label: 'Sales', align: 'right', render: (r) => fmtNumber(Number(r.orders) || 0) },
                  { key: 'revenue',     label: 'Revenue', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.revenue) || 0)}</span> },
                ],
                detailsEmpty: 'No salesperson sales this month',
              })}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
            >
              See all salespersons <ChevronRight size={13} />
            </button>
          ) : null}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {monthSpQ.isLoading ? (
            <div className="col-span-1 py-6 text-center text-xs text-muted-fg sm:col-span-3">Loading…</div>
          ) : monthSp.length === 0 ? (
            <div className="col-span-1 py-6 text-center text-xs text-muted-fg sm:col-span-3">No salesperson sales this month.</div>
          ) : monthSp.map((s, i) => {
            const code = String(s.salesperson || '—').trim();
            const name = resolveSp(code);
            const fullName = resolveSpFull(code);
            const spOrders = Number(s.orders) || 0;
            const spRev    = Number(s.revenue) || 0;
            const medal = [
              { grad: 'from-amber-400 to-yellow-500', ring: 'ring-amber-500/30' },
              { grad: 'from-slate-300 to-slate-400',  ring: 'ring-slate-400/30' },
              { grad: 'from-orange-400 to-amber-600', ring: 'ring-orange-500/30' },
            ][i] || { grad: 'from-slate-300 to-slate-400', ring: 'ring-slate-400/30' };
            return (
              <button
                key={code}
                type="button"
                onClick={openDetail({
                  title: `${name} · ${monthName} · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                  icon: Award,
                  accent: 'amber',
                  headline: fmtCurrency(spRev),
                  subtitle: `${fmtNumber(spOrders)} sale${spOrders === 1 ? '' : 's'} this month`,
                  detailsDb: 'sql',
                  detailsSql: `
                    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalespersonDaily),
                         mb AS (SELECT DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS mStart,
                                       DATEADD(MONTH, 1, DATEFROMPARTS(YEAR(d), MONTH(d), 1)) AS mEnd FROM m)
                    SELECT sd.SalesNo,
                           MIN(sd.SaleDate) AS SaleDate,
                           MAX(sd.CustomerName) AS CustomerName,
                           SUM(ISNULL(sd.SaleSplitAmt, 0)) AS amount
                    FROM SalespersonDaily sd CROSS JOIN mb
                    WHERE sd.SaleDate >= mb.mStart AND sd.SaleDate < mb.mEnd AND ${spdStore}
                      AND LTRIM(RTRIM(sd.SalesPerson)) = '${code.replace(/'/g, "''")}'
                    GROUP BY sd.SalesNo
                    ORDER BY MIN(sd.SaleDate) DESC
                  `,
                  detailsColumns: [
                    { key: 'SaleDate',     label: 'Date', render: (r) => r.SaleDate ? new Date(r.SaleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—' },
                    { key: 'SalesNo',      label: 'Sale #' },
                    { key: 'CustomerName', label: 'Customer' },
                    { key: 'amount',       label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.amount) || 0)}</span> },
                  ],
                  detailsEmpty: `No sales for ${name} this month`,
                })}
                className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
              >
                <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-base font-extrabold text-white shadow ring-2', medal.grad, medal.ring)}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-fg" title={fullName}>{name}</div>
                  <div className="truncate text-xs text-muted-fg">
                    {fmtNumber(spOrders)} sale{spOrders === 1 ? '' : 's'}{name !== code ? ` · ${code}` : ''}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-extrabold tabular-nums text-fg">{fmtCurrency(spRev)}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-fg">revenue</div>
                </div>
              </button>
            );
          })}
        </div>

        {/* ─── Item Sold Analysis (by showroom category, this month, selected store) ─── */}
        <SectionHeading
          icon={Package}
          title={`Item Sold Analysis · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`}
          hint="Units sold this month by category · click a category for the item list"
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {/* Display order (Living first) is independent of the CASE priority
              order in ROOM_RULES, which must keep Dining before Living. */}
          {['Living Room', 'Bedroom', 'Dining Room', 'Accessories']
            .map((k) => ROOM_RULES.find((r) => r.key === k))
            .map((room) => {
            const units = itemCatByRoom[room.key] || 0;
            return (
              <HeroStat
                key={room.key}
                label={room.key}
                value={fmtNumber(units)}
                icon={room.icon}
                accent={room.accent}
                subtitle={units ? `${fmtNumber(units)} item${units === 1 ? '' : 's'} sold this month` : 'None sold this month'}
                loading={itemCatQ.isLoading}
                onClick={openDetail({
                  // LEVEL 1 — summary by item type within this room. Click a
                  // type row to drill into its individual items (level 2).
                  title: `${room.key} · Items Sold This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                  icon: room.icon,
                  accent: room.accent,
                  headline: fmtNumber(units),
                  subtitle: `${fmtNumber(units)} item${units === 1 ? '' : 's'} sold · by item type · click a type to see the items`,
                  detailsDb: 'sql',
                  detailsSql: `
                    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
                         base AS (
                           SELECT UPPER(ISNULL(Description2,'')) AS d2
                           FROM SalesItemDetail CROSS JOIN m
                           WHERE YEAR(SaleDate) = YEAR(m.d) AND MONTH(SaleDate) = MONTH(m.d)
                             AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
                         ),
                         roomed AS (
                           SELECT ${itemTypeCase} AS item_type
                           FROM base
                           WHERE (${roomCase}) = '${room.key}'
                         )
                    SELECT item_type, COUNT(*) AS units
                    FROM roomed GROUP BY item_type ORDER BY units DESC
                  `,
                  detailsColumns: [
                    { key: 'item_type', label: 'Item Type' },
                    { key: 'units', label: 'Total Sold', align: 'right', render: (r) => <span className="font-semibold">{fmtNumber(Number(r.units) || 0)}</span> },
                  ],
                  detailsEmpty: `No ${room.key.toLowerCase()} items sold this month`,
                  // LEVEL 2 — clicking a type row opens its individual items,
                  // with duplicate pieces on one sale grouped into a Qty.
                  onRowClick: (row) => ({
                    title: `${room.key} · ${row.item_type} · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                    icon: room.icon,
                    accent: room.accent,
                    headline: `${fmtNumber(Number(row.units) || 0)} ${row.item_type}`,
                    subtitle: `Individual ${row.item_type} pieces sold this month · same item on one sale is grouped with a Qty`,
                    detailsDb: 'sql',
                    detailsSql: `
                      WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
                           base AS (
                             SELECT SaleDate, SaleNo,
                                    LTRIM(RTRIM(ItemID)) AS ItemID,
                                    LTRIM(RTRIM(VendorID)) AS VendorID,
                                    LTRIM(RTRIM(ISNULL(Description2,''))) AS ItemType,
                                    UPPER(ISNULL(Description2,'')) AS d2
                             FROM SalesItemDetail CROSS JOIN m
                             WHERE YEAR(SaleDate) = YEAR(m.d) AND MONTH(SaleDate) = MONTH(m.d)
                               AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
                           ),
                           filt AS (
                             SELECT SaleDate, SaleNo, ItemID, VendorID, ItemType
                             FROM base
                             WHERE (${roomCase}) = '${room.key}'
                               AND (${itemTypeCase}) = '${String(row.item_type).replace(/'/g, "''")}'
                           )
                      SELECT MIN(SaleDate) AS SaleDate, SaleNo, ItemID, VendorID, ItemType, COUNT(*) AS Qty
                      FROM filt GROUP BY SaleNo, ItemID, VendorID, ItemType ORDER BY MIN(SaleDate) DESC
                    `,
                    detailsColumns: [
                      { key: 'SaleDate', label: 'Date', render: (r) => r.SaleDate ? new Date(r.SaleDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—' },
                      { key: 'SaleNo',   label: 'Sale #' },
                      { key: 'ItemID',   label: 'Item ID' },
                      { key: 'VendorID', label: 'Vendor' },
                      { key: 'ItemType', label: 'Description' },
                      { key: 'Qty',      label: 'Qty', align: 'right', render: (r) => {
                        const n = Number(r.Qty) || 1;
                        return n > 1
                          ? <span className="font-semibold text-primary">×{fmtNumber(n)}</span>
                          : <span className="text-muted-fg">1</span>;
                      }},
                    ],
                    detailsEmpty: `No ${row.item_type} sold this month`,
                  }),
                })}
              />
            );
          })}
        </div>

        {/* ─── Vendor Wise Analysis (top 5 vendors this month, selected store) ─── */}
        <SectionHeading
          icon={Truck}
          title={`Vendor Wise Analysis · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`}
          hint={topVendorsRevTotal > 0
            ? `Top 5 · ${fmtCurrency(topVendorsRevTotal)} revenue`
            : 'Top 5 vendors by revenue'}
          action={topVendors.length > 0 ? (
            <button
              type="button"
              onClick={openDetail({
                title: `All Vendors · ${monthName} · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                icon: Truck,
                accent: 'primary',
                subtitle: 'Every vendor with sales this month, ranked by revenue',
                detailsDb: 'sql',
                detailsSql: allVendorsSql,
                detailsColumns: [
                  { key: 'vendor',  label: 'Vendor', render: (r) => <span className="font-semibold">{r.vendor}</span> },
                  { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.revenue) || 0)}</span> },
                  { key: 'units',   label: 'Items', align: 'right', render: (r) => fmtNumber(Number(r.units) || 0) },
                  { key: 'skus',    label: 'SKUs', align: 'right', render: (r) => fmtNumber(Number(r.skus) || 0) },
                ],
                detailsEmpty: 'No vendor sales this month',
              })}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
            >
              See all vendors <ChevronRight size={13} />
            </button>
          ) : null}
        />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {vendorAnalysisQ.isLoading ? (
            <div className="col-span-2 lg:col-span-5 py-6 text-center text-xs text-muted-fg">Loading vendors…</div>
          ) : topVendors.length === 0 ? (
            <div className="col-span-2 lg:col-span-5 py-6 text-center text-xs text-muted-fg">No vendor sales this month</div>
          ) : topVendors.map((v, i) => {
            const vendor = String(v.vendor || '').trim();
            const units  = Number(v.units) || 0;
            const skus   = Number(v.skus) || 0;
            const vrev   = Number(v.revenue) || 0;
            const accent = ['primary', 'emerald', 'amber', 'violet', 'sky'][i % 5];
            return (
              <HeroStat
                key={vendor}
                label={`#${i + 1} · ${vendor}`}
                value={vrev > 0 ? fmtCompactCurrency(vrev) : fmtNumber(units)}
                fullValue={vrev > 0 ? fmtCurrency(vrev) : null}
                icon={Truck}
                logo={vendorDomain(vendor)}
                accent={accent}
                subtitle={`${fmtNumber(units)} item${units === 1 ? '' : 's'} · ${fmtNumber(skus)} SKU${skus === 1 ? '' : 's'}`}
                loading={vendorAnalysisQ.isLoading}
                onClick={openDetail({
                  title: `${vendor} · Items Sold This Month · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`,
                  icon: Truck,
                  accent,
                  headline: `${fmtNumber(units)} items`,
                  subtitle: `By item type · split into Stock Item / Star-SKU · ${fmtNumber(skus)} distinct SKUs`,
                  detailsColumns: [
                    { key: 'item_type', label: 'Item Type' },
                    { key: 'units',   label: 'Total Sold', align: 'right', render: (r) => <span className="font-semibold">{fmtNumber(r.units)}</span> },
                    { key: 'lineup',  label: 'Stock Item', align: 'right', render: (r) => r.lineup > 0 ? <span className="font-semibold text-emerald-600 dark:text-emerald-300">{fmtNumber(r.lineup)}</span> : <span className="text-muted-fg">0</span> },
                    { key: 'star',    label: 'Star SKU', align: 'right', render: (r) => r.star > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-300">{fmtNumber(r.star)}</span> : <span className="text-muted-fg">0</span> },
                  ],
                  detailsEmpty: `No items sold for ${vendor} this month`,
                  // Lineup = ItemID starts with a digit (real catalog SKU);
                  // Star SKU = ItemID starts with '*' (special order). Both
                  // derived directly from the sales table — no cross-DB needed.
                  detailsDb: 'sql',
                  detailsSql: `
                    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
                         base AS (
                           SELECT LTRIM(RTRIM(ItemID)) AS ItemID,
                                  UPPER(ISNULL(Description2,'')) AS d2
                           FROM SalesItemDetail CROSS JOIN m
                           WHERE YEAR(SaleDate) = YEAR(m.d) AND MONTH(SaleDate) = MONTH(m.d)
                             AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
                             AND LTRIM(RTRIM(VendorID)) = '${vendor.replace(/'/g, "''")}'
                         ),
                         typed AS (
                           SELECT ${itemTypeCase} AS item_type,
                                  CASE WHEN LEFT(ItemID, 1) LIKE '[0-9]' THEN 1 ELSE 0 END AS is_lineup,
                                  CASE WHEN LEFT(ItemID, 1) = '*'        THEN 1 ELSE 0 END AS is_star
                           FROM base
                         )
                    SELECT item_type,
                           COUNT(*)        AS units,
                           SUM(is_lineup)  AS lineup,
                           SUM(is_star)    AS star
                    FROM typed GROUP BY item_type ORDER BY units DESC
                  `,
                })}
              />
            );
          })}
        </div>

        {/* ─── Top Selling Items — units vs revenue (this month, selected store) ─── */}
        <SectionHeading
          icon={Package}
          title={`Top Selling Items · ${store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)'}`}
          hint="Top 5 by units sold vs by revenue · this month"
        />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <TopItemList title="Top 5 · By Units Sold" icon={Boxes} iconClass="text-primary" metric="qty" rows={topItems} loading={topItemsQ.isLoading} />
          <TopItemList title="Top 5 · By Revenue" icon={TrendingUp} iconClass="text-emerald-500" metric="revenue" rows={topItemsRev} loading={topItemsRevQ.isLoading} />
        </div>
        </>
        )}
      </div>

      {/* Metric details modal — click any HeroStat tile to open */}
      <MetricDrilldown drilldown={drilldown} onClose={() => setDrilldown(null)} />
    </>
  );
}

function FilterPill({ active, onClick, children, title, small }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-md font-medium transition outline-none',
        small ? 'h-7 px-2 text-[11px]' : 'h-8 px-3 text-xs',
        active
          ? 'bg-primary text-primary-fg shadow-sm'
          : 'text-muted-fg hover:bg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

// CustomerMixTile — a single stat tile showing this month's total customers
// split into New (first-time buyers) vs Returning, with a proportion bar and a
// legend. Styled to match HeroStat (violet accent) and clickable to drill down.
function CustomerMixTile({ label, total, newCount, returning, loading, onClick }) {
  const newPct = total > 0 ? Math.round((newCount / total) * 100) : 0;
  const retPct = total > 0 ? 100 - newPct : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-card text-left transition-all duration-300',
        'border-violet-500/40 shadow-[0_8px_30px_-12px_rgba(139,92,246,0.45)]',
        onClick && 'cursor-pointer hover:-translate-y-1 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)]',
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/20 via-violet-500/10 to-transparent opacity-90 dark:from-violet-500/25" />
      <div className="absolute -bottom-4 -right-4 opacity-[0.06] dark:opacity-[0.08]">
        <Users size={96} strokeWidth={1.5} />
      </div>

      <div className="relative p-3">
        <div className="flex items-center justify-between gap-2">
          <span title={typeof label === 'string' ? label : undefined} className="text-[10px] font-bold uppercase tracking-wider text-muted-fg leading-tight">{label}</span>
          <div className="grid h-9 w-9 place-items-center rounded-lg shrink-0 text-white shadow-md ring-2 bg-gradient-to-br from-violet-500 to-purple-500 ring-violet-500/30">
            <Users size={16} strokeWidth={2.25} />
          </div>
        </div>

        {loading ? (
          <div className="mt-3 h-[44px] w-full animate-pulse rounded bg-muted/50" />
        ) : (
          <>
            <div className="mt-1.5 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold leading-none tabular-nums text-violet-600 dark:text-violet-300">{fmtNumber(total)}</span>
              <span className="text-[11px] font-medium text-muted-fg">total</span>
            </div>

            {/* Proportion bar + compact inline legend */}
            <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-violet-500" style={{ width: `${newPct}%` }} title={`New · ${newPct}%`} />
              <div className="h-full bg-emerald-500" style={{ width: `${retPct}%` }} title={`Returning · ${retPct}%`} />
            </div>
            <div className="mt-1.5 flex items-center gap-x-3 gap-y-0.5 text-[11px] flex-wrap">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-sm bg-violet-500" />
                <span className="text-fg/80">New</span>
                <span className="font-bold tabular-nums text-fg">{fmtNumber(newCount)}</span>
                <span className="tabular-nums text-muted-fg">({newPct}%)</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-sm bg-emerald-500" />
                <span className="text-fg/80">Ret.</span>
                <span className="font-bold tabular-nums text-fg">{fmtNumber(returning)}</span>
                <span className="tabular-nums text-muted-fg">({retPct}%)</span>
              </span>
            </div>
          </>
        )}
      </div>
    </button>
  );
}

// TopItemList — compact ranked list of best-selling items (used twice: by units
// and by revenue). `metric` decides which figure is emphasized on the right.
function TopItemList({ title, icon: Icon, iconClass, metric, rows, loading }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">{Icon && <Icon size={15} className={iconClass} />} {title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 p-3 pt-0">
        {loading ? (
          <div className="py-6 text-center text-xs text-muted-fg">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-fg">No items this month.</div>
        ) : rows.map((r, i) => {
          const grad = ['from-blue-500 to-indigo-500', 'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500', 'from-violet-500 to-purple-500', 'from-sky-500 to-cyan-500'][i % 5];
          const id = trimStr(r.ItemID);
          const qtyStr = `${fmtNumber(Number(r.qty) || 0)} sold`;
          const revStr = fmtCurrency(Number(r.revenue) || 0);
          const primary   = metric === 'revenue' ? revStr : qtyStr;
          const secondary = metric === 'revenue' ? qtyStr : revStr;
          return (
            <div key={id + i} className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-muted/40">
              <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-md bg-gradient-to-br text-xs font-bold text-white', grad)}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="shrink-0 font-mono text-xs font-semibold">
                    {id}{id.startsWith('*') && <span className="ml-0.5 text-amber-500" title="Star / special-order SKU">★</span>}
                  </span>
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-fg">{trimStr(r.vendor) || '—'}</span>
                </div>
                <div className="truncate text-[11px] text-muted-fg" title={trimStr(r.descr)}>{trimStr(r.descr) || '—'}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-bold tabular-nums">{primary}</div>
                <div className="text-[10px] tabular-nums text-muted-fg">{secondary}</div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// SectionHeading — used between major dashboard sections to make scanning easy.
function SectionHeading({ icon: Icon, title, hint, action }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {Icon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon size={15} />
          </span>
        )}
        <h2 className="text-sm font-bold uppercase tracking-wider text-fg">{title}</h2>
        {action}
      </div>
      {hint && <span className="hidden shrink-0 text-[11px] italic text-muted-fg sm:block" title={hint}>{hint}</span>}
    </div>
  );
}
