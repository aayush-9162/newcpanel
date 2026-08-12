// Salesperson Report (BETA) — a NEW standalone page (separate from the existing
// /sales/performance "SalesPerson Performance"). One shared team report with a
// Daily / Monthly toggle. Daily is built first and default.
//
// The daily view answers, per salesperson: how did they do today, what's their
// share of the day, and — with their monthly target — are they on pace
// (achieved so far, current vs required daily average, and a month-end forecast).
//
// Data: MS SQL SalespersonDaily (today's revenue / tickets / customers / biggest
// sale + month-to-date) + SalesItemDetail (items); codes → names + monthly
// targets via MySQL employees (rv_code, name, default_target).

import { useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { HeroBanner } from '@/components/HeroStat';
import { MetricDrilldown } from '@/components/MetricDrilldown';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import {
  Trophy, Receipt, Crown, Medal, Award, Calendar, Sparkles,
  Flame, Gem, UserPlus, TrendingUp, TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const STORE_TO_BLDG = { ARDEN: 1, WAYNESVILLE: 2 };

// Parse a 'YYYY-MM-DD' as LOCAL midnight (a SQL DATE arrives as UTC midnight,
// which renders a day earlier west of UTC).
const localDate = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');

export default function SalespersonReportBeta() {
  const [store, setStore]   = useState('ARDEN');          // ARDEN | WAYNESVILLE
  const [period, setPeriod] = useState('daily');          // daily | monthly (soon)
  const bldg = STORE_TO_BLDG[store];
  const storeLabel = store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)';

  const [drilldown, setDrilldown] = useState(null);
  const dailyOn = period === 'daily';

  // ── Anchor day — the store's most recent business day on file (excl. today).
  // Anchored on SaleWRT (the written-sales truth the Dashboard uses), so totals
  // reconcile with the rest of the app.
  const dayQ = useSqlQuery(`
    SELECT CONVERT(char(10), CAST(MAX(wrt_cng_bdat) AS DATE), 23) AS day
    FROM SaleWRT WHERE wrt_pft_ctr = ${bldg} AND wrt_cng_bdat < CAST(GETDATE() AS DATE)
  `, [], { enabled: dailyOn });
  const dayStr = dayQ.data?.rows?.[0]?.day || null;
  const anchor = dayStr ? localDate(dayStr) : null;
  const dateShort = anchor ? `${anchor.getDate()} ${anchor.toLocaleDateString('en-US', { month: 'short' })}` : 'Latest day';
  const weekdayLong = anchor ? anchor.toLocaleDateString('en-US', { weekday: 'long' }) : '';
  const monthName = anchor ? anchor.toLocaleDateString('en-US', { month: 'long' }) : '';

  // Calendar-day pace: elapsed / total / remaining days in the anchor month.
  const monthTotalDays = anchor ? new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate() : 30;
  const daysElapsed    = anchor ? anchor.getDate() : 0;
  const daysRemaining  = Math.max(0, monthTotalDays - daysElapsed);

  const dayReady = dailyOn && !!dayStr;

  // ── Team totals for the day — from the SaleWRT truth (revenue + orders) and
  // SalesItemDetail (items), plus distinct customers / new customers. These are
  // the numbers that must match the Dashboard.
  const teamQ = useSqlQuery(`
    SELECT
      (SELECT SUM(S.wrt_sls) FROM SaleWRT S
         WHERE S.wrt_pft_ctr = ${bldg} AND S.wrt_cng_bdat >= '${dayStr}' AND S.wrt_cng_bdat < DATEADD(DAY, 1, '${dayStr}')) AS revenue,
      (SELECT COUNT(*) FROM (
         SELECT S.wrt_so_no FROM SaleWRT S
           WHERE S.wrt_pft_ctr = ${bldg} AND S.wrt_cng_bdat >= '${dayStr}' AND S.wrt_cng_bdat < DATEADD(DAY, 1, '${dayStr}')
           GROUP BY S.wrt_so_no HAVING SUM(S.wrt_sls) > 0) t) AS orders,
      (SELECT COUNT(*) FROM SalesItemDetail sid
         WHERE LEFT(CAST(sid.SaleNo AS VARCHAR(20)), 1) = '${bldg}' AND sid.SaleDate >= '${dayStr}' AND sid.SaleDate < DATEADD(DAY, 1, '${dayStr}')) AS items,
      (SELECT COUNT(DISTINCT sd.CustomerId) FROM SalespersonDaily sd
         WHERE sd.SaleDate >= '${dayStr}' AND sd.SaleDate < DATEADD(DAY, 1, '${dayStr}')
           AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}' AND sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> '') AS customers,
      (SELECT COUNT(*) FROM (
         SELECT DISTINCT sd.CustomerId FROM SalespersonDaily sd
           WHERE sd.SaleDate >= '${dayStr}' AND sd.SaleDate < DATEADD(DAY, 1, '${dayStr}')
             AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}' AND sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> ''
             AND NOT EXISTS (SELECT 1 FROM SalespersonDaily p WHERE p.CustomerId = sd.CustomerId AND p.SaleDate < '${dayStr}')) x) AS newCustomers
  `, [], { enabled: dayReady });

  // ── Per-salesperson attribution (today). Each sale's REAL revenue (SaleWRT)
  // is split across its salespeople in proportion to their SaleSplitAmt share
  // (falls back to an equal split). Because SaleSplitAmt is used only as a
  // within-sale weight and then scaled to the SaleWRT amount, any systematic
  // scaling in SaleSplitAmt cancels out — the totals reconcile to SaleWRT.
  const boardQ = useSqlQuery(`
    WITH saleRev AS (
      SELECT CAST(S.wrt_so_no AS VARCHAR(20)) AS SaleNo, SUM(S.wrt_sls) AS amt
      FROM SaleWRT S
      WHERE S.wrt_pft_ctr = ${bldg} AND S.wrt_cng_bdat >= '${dayStr}' AND S.wrt_cng_bdat < DATEADD(DAY, 1, '${dayStr}')
      GROUP BY CAST(S.wrt_so_no AS VARCHAR(20))
    ),
    sp AS (
      SELECT LTRIM(RTRIM(sd.SalesPerson)) AS salesperson,
             CAST(sd.SalesNo AS VARCHAR(20)) AS SaleNo,
             sd.CustomerId,
             ISNULL(sd.SaleSplitAmt, 0) AS split,
             CASE WHEN NOT EXISTS (
                    SELECT 1 FROM SalespersonDaily p
                    WHERE p.CustomerId = sd.CustomerId AND p.SaleDate < '${dayStr}'
                  ) THEN 1 ELSE 0 END AS isNew
      FROM SalespersonDaily sd
      WHERE sd.SaleDate >= '${dayStr}' AND sd.SaleDate < DATEADD(DAY, 1, '${dayStr}')
        AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}'
        AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    ),
    tot AS (SELECT SaleNo, SUM(split) AS totSplit, COUNT(*) AS n FROM sp GROUP BY SaleNo),
    attr AS (
      SELECT sp.salesperson, sp.SaleNo, sp.CustomerId, sp.isNew,
             ISNULL(sr.amt, 0) * (CASE WHEN t.totSplit > 0 THEN sp.split * 1.0 / t.totSplit ELSE 1.0 / t.n END) AS rev
      FROM sp
      JOIN tot t ON t.SaleNo = sp.SaleNo
      LEFT JOIN saleRev sr ON sr.SaleNo = sp.SaleNo
    )
    SELECT salesperson,
           COUNT(DISTINCT SaleNo)    AS orders,
           SUM(rev)                  AS revenue,
           COUNT(DISTINCT CustomerId) AS customers,
           COUNT(DISTINCT CASE WHEN isNew = 1 THEN CustomerId END) AS newCustomers,
           MAX(rev)                  AS maxTicket
    FROM attr
    GROUP BY salesperson
    ORDER BY revenue DESC
  `, [], { enabled: dayReady });

  // ── Month-to-date revenue per salesperson — same proportional attribution
  // over the month-start → anchor-day window.
  const mtdQ = useSqlQuery(`
    WITH saleRev AS (
      SELECT CAST(S.wrt_so_no AS VARCHAR(20)) AS SaleNo, SUM(S.wrt_sls) AS amt
      FROM SaleWRT S
      WHERE S.wrt_pft_ctr = ${bldg}
        AND S.wrt_cng_bdat >= DATEFROMPARTS(YEAR(CAST('${dayStr}' AS DATE)), MONTH(CAST('${dayStr}' AS DATE)), 1)
        AND S.wrt_cng_bdat < DATEADD(DAY, 1, CAST('${dayStr}' AS DATE))
      GROUP BY CAST(S.wrt_so_no AS VARCHAR(20))
    ),
    sp AS (
      SELECT LTRIM(RTRIM(sd.SalesPerson)) AS salesperson,
             CAST(sd.SalesNo AS VARCHAR(20)) AS SaleNo,
             ISNULL(sd.SaleSplitAmt, 0) AS split
      FROM SalespersonDaily sd
      WHERE sd.SaleDate >= DATEFROMPARTS(YEAR(CAST('${dayStr}' AS DATE)), MONTH(CAST('${dayStr}' AS DATE)), 1)
        AND sd.SaleDate < DATEADD(DAY, 1, CAST('${dayStr}' AS DATE))
        AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}'
        AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    ),
    tot AS (SELECT SaleNo, SUM(split) AS totSplit, COUNT(*) AS n FROM sp GROUP BY SaleNo)
    SELECT sp.salesperson,
           SUM(ISNULL(sr.amt, 0) * (CASE WHEN t.totSplit > 0 THEN sp.split * 1.0 / t.totSplit ELSE 1.0 / t.n END)) AS mtd
    FROM sp
    JOIN tot t ON t.SaleNo = sp.SaleNo
    LEFT JOIN saleRev sr ON sr.SaleNo = sp.SaleNo
    GROUP BY sp.salesperson
  `, [], { enabled: dayReady });

  // ── Employees — code → name + monthly target (MySQL). Split sales like
  // "BJT / CAT" resolve each part; the target is the sum of the parts.
  const empQ = useMysqlQuery('SELECT rv_code, name, default_target FROM employees', []);
  const empMap = useMemo(() => {
    const m = {};
    for (const r of (empQ.data?.rows ?? [])) {
      const c = String(r.rv_code || '').trim().toUpperCase();
      if (c) m[c] = { name: String(r.name || '').trim(), target: Number(r.default_target) || 0 };
    }
    return m;
  }, [empQ.data]);
  const resolveSp = (raw) => String(raw || '').split('/')
    .map((part) => { const c = part.trim(); const e = empMap[c.toUpperCase()]; return e?.name ? (e.name.split(/\s+/)[0] || e.name) : c; })
    .filter(Boolean).join(' / ') || String(raw || '—');
  const resolveSpFull = (raw) => String(raw || '').split('/')
    .map((part) => { const c = part.trim(); return empMap[c.toUpperCase()]?.name || c; })
    .filter(Boolean).join(' / ') || String(raw || '—');
  const resolveTarget = (raw) => String(raw || '').split('/')
    .reduce((sum, part) => sum + (empMap[part.trim().toUpperCase()]?.target || 0), 0);

  // ── Merge today + MTD + target into one ranked list with pace metrics.
  const rows = useMemo(() => {
    const mtdMap = {};
    for (const r of (mtdQ.data?.rows ?? [])) mtdMap[String(r.salesperson)] = Number(r.mtd) || 0;
    return (boardQ.data?.rows ?? []).map((r) => {
      const revenue   = Number(r.revenue) || 0;
      const orders    = Number(r.orders) || 0;
      const customers = Number(r.customers) || 0;
      const newC      = Number(r.newCustomers) || 0;
      const mtd       = mtdMap[String(r.salesperson)] || 0;
      const target    = resolveTarget(r.salesperson);
      const currAvg   = daysElapsed  > 0 ? mtd / daysElapsed : 0;
      const reqAvg    = target > 0 && daysRemaining > 0 ? Math.max(0, (target - mtd) / daysRemaining) : 0;
      const forecast  = currAvg * monthTotalDays;
      return {
        code: r.salesperson,
        name: resolveSp(r.salesperson),
        fullName: resolveSpFull(r.salesperson),
        revenue, orders, customers,
        newCustomers: newC,
        returning: Math.max(0, customers - newC),
        maxTicket: Number(r.maxTicket) || 0,
        avgTicket: orders ? revenue / orders : 0,
        mtd, target, currAvg, reqAvg, forecast,
        pctAchieved: target > 0 ? (mtd / target) * 100 : null,
        forecastPct: target > 0 ? (forecast / target) * 100 : null,
        onPace: target > 0 ? forecast >= target : null,
      };
    });
  }, [boardQ.data, mtdQ.data, empMap, daysElapsed, daysRemaining, monthTotalDays]);

  // ── Team totals (today) — from the SaleWRT/SalesItemDetail truth (teamQ), so
  // they reconcile with the Dashboard. People count comes from the board.
  const team = useMemo(() => {
    const t = teamQ.data?.rows?.[0] ?? {};
    const revenue = Number(t.revenue) || 0;
    const orders  = Number(t.orders) || 0;
    return {
      revenue, orders,
      items: Number(t.items) || 0,
      customers: Number(t.customers) || 0,
      newCustomers: Number(t.newCustomers) || 0,
      people: rows.length,
      avgTicket: orders ? revenue / orders : 0,
    };
  }, [teamQ.data, rows.length]);

  // ── Standouts — the day's highlights (friendly labels, no items/ticket).
  const standouts = useMemo(() => {
    if (!rows.length) return [];
    const pick = (fn) => rows.reduce((a, b) => (fn(b) > fn(a) ? b : a), rows[0]);
    const bigSale = pick((r) => r.maxTicket);
    const bestAvg = rows.filter((r) => r.orders > 0).sort((a, b) => b.avgTicket - a.avgTicket)[0];
    const newChamp = pick((r) => r.newCustomers);
    const out = [];
    if (bigSale && bigSale.maxTicket > 0) out.push({ icon: Flame, tint: 'amber', title: 'Biggest sale today', name: bigSale.name, full: bigSale.fullName, detail: fmtCurrency(bigSale.maxTicket) });
    if (bestAvg && bestAvg.avgTicket > 0) out.push({ icon: Gem, tint: 'violet', title: 'Best average sale', name: bestAvg.name, full: bestAvg.fullName, detail: `${fmtCurrency(bestAvg.avgTicket)} / sale` });
    if (newChamp && newChamp.newCustomers > 0) out.push({ icon: UserPlus, tint: 'emerald', title: 'Most new customers', name: newChamp.name, full: newChamp.fullName, detail: `${fmtNumber(newChamp.newCustomers)} new` });
    return out;
  }, [rows]);

  const loading = boardQ.isLoading || dayQ.isLoading || teamQ.isLoading;
  const top = rows[0] || null;

  const openSp = (r) => setDrilldown({
    title: `${r.fullName} · ${dateShort} · ${storeLabel}`,
    icon: Receipt,
    accent: 'sky',
    headline: fmtCurrency(r.revenue),
    subtitle: `${fmtNumber(r.orders)} sale${r.orders === 1 ? '' : 's'} today · avg ${fmtCurrency(r.avgTicket)}`,
    detailsDb: 'sql',
    detailsSql: `
      SELECT CAST(sd.SalesNo AS VARCHAR(20)) AS SalesNo,
             MAX(sd.CustomerName) AS CustomerName,
             SUM(ISNULL(sd.SaleSplitAmt, 0)) AS amount
      FROM SalespersonDaily sd
      WHERE sd.SaleDate >= '${dayStr}' AND sd.SaleDate < DATEADD(DAY, 1, '${dayStr}')
        AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}'
        AND LTRIM(RTRIM(sd.SalesPerson)) = '${String(r.code).replace(/'/g, "''")}'
      GROUP BY CAST(sd.SalesNo AS VARCHAR(20))
      ORDER BY amount DESC
    `,
    detailsColumns: [
      { key: 'SalesNo', label: 'Sale #' },
      { key: 'CustomerName', label: 'Customer', render: (x) => x.CustomerName || '—' },
      { key: 'amount', label: 'Amount', align: 'right', render: (x) => <span className="font-semibold">{fmtCurrency(Number(x.amount) || 0)}</span> },
    ],
    detailsEmpty: 'No sales that day',
  });

  return (
    <>
      <Topbar title="Salesperson Report" subtitle={`BETA · ${store === 'ARDEN' ? 'S1 · Arden' : 'S2 · Waynesville'} · ${dailyOn ? dateShort : 'Monthly'}`} />

      <div className="flex flex-1 flex-col gap-4 p-5 animate-fade-in">
        {/* ═══════════════ Filters ═══════════════ */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
              <Sparkles size={11} /> Beta
            </span>
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <Pill active={store === 'ARDEN'}       onClick={() => setStore('ARDEN')}       title="Arden">S1</Pill>
              <Pill active={store === 'WAYNESVILLE'} onClick={() => setStore('WAYNESVILLE')} title="Waynesville">S2</Pill>
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <Pill active={period === 'daily'}   onClick={() => setPeriod('daily')}   title="Yesterday view">Daily</Pill>
              <Pill active={period === 'monthly'} onClick={() => setPeriod('monthly')} title="This-month view (coming soon)">Monthly</Pill>
            </div>
            {dailyOn && dayStr && (
              <div className="ml-auto text-xs text-muted-fg">
                Latest day · <span className="font-semibold text-fg">{weekdayLong}, {dateShort}</span>
                <span className="ml-2 text-[11px]">Day {daysElapsed}/{monthTotalDays} of {monthName}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {period === 'monthly' ? (
          <MonthlySoon />
        ) : (
          <>
            {/* ═══════════════ Day hero — team summary ═══════════════ */}
            <HeroBanner icon={Trophy} decorIcon={Trophy} accent="emerald">
              <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                {storeLabel} · {weekdayLong ? `${weekdayLong}, ` : ''}{dateShort} · Team day
              </div>
              <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
                <span className="text-3xl font-extrabold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-200">
                  {loading ? '…' : fmtCurrency(team.revenue)}
                </span>
                <span className="text-sm font-medium text-muted-fg">total sales</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <Meta label="Orders" value={fmtNumber(team.orders)} />
                <Meta label="Items sold" value={fmtNumber(team.items)} />
                <Meta label="Avg sale" value={fmtCurrency(team.avgTicket)} />
                <Meta label="Customers" value={`${fmtNumber(team.customers)} · ${fmtNumber(team.newCustomers)} new`} />
                <Meta label="On the floor" value={fmtNumber(team.people)} />
                {top && <Meta label="Leader" value={`${top.name} · ${fmtCurrency(top.revenue)}`} highlight />}
              </div>
            </HeroBanner>

            {loading ? (
              <Card><CardContent className="grid place-items-center py-20 text-sm text-muted-fg">
                <div className="flex flex-col items-center gap-3"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading team report…</div>
              </CardContent></Card>
            ) : rows.length === 0 ? (
              <Card><CardContent className="grid place-items-center py-20 text-sm text-muted-fg">No salesperson sales for {storeLabel} on {dateShort}.</CardContent></Card>
            ) : (
              <>
                {/* ═══════════════ Top 3 (compact) ═══════════════ */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {rows.slice(0, 3).map((r, i) => (
                    <PodiumCard key={r.code} rank={i} row={r} teamRev={team.revenue} onClick={() => openSp(r)} />
                  ))}
                </div>

                {/* ═══════════════ Standouts ═══════════════ */}
                {standouts.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {standouts.map((s) => <Standout key={s.title} {...s} />)}
                  </div>
                )}

                {/* ═══════════════ Target-pace leaderboard ═══════════════ */}
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 border-b border-border bg-gradient-to-r from-amber-500/10 via-transparent to-transparent px-4 py-3">
                      <Trophy size={16} className="text-amber-500" />
                      <span className="text-sm font-semibold">Team pace · {monthName}</span>
                      <span className="ml-auto text-[11px] text-muted-fg">Today's sales &amp; monthly target progress · {daysRemaining} day{daysRemaining === 1 ? '' : 's'} left</span>
                    </div>
                    <Leaderboard rows={rows} teamRev={team.revenue} onRowClick={openSp} />
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </div>

      <MetricDrilldown drilldown={drilldown} onClose={() => setDrilldown(null)} />
    </>
  );
}

// ─────────────────────────── sub-components ───────────────────────────

function Pill({ active, onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={cn('rounded-md px-3 py-1 text-xs font-semibold transition',
        active ? 'bg-primary text-primary-fg shadow' : 'text-muted-fg hover:text-fg')}>
      {children}
    </button>
  );
}

function Meta({ label, value, highlight }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-fg">{label}</span>
      <span className={cn('font-bold tabular-nums', highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg')}>{value}</span>
    </div>
  );
}

// Compact top-3 — a slim card with a rank medal, today's sales and share bar.
// Subtle tint (a colored left rail + soft icon), not a loud full gradient.
const PODIUM = [
  { icon: Crown, label: '1st', rail: 'bg-amber-400',  card: 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent',  chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',  bar: 'from-amber-400 to-orange-400' },
  { icon: Medal, label: '2nd', rail: 'bg-slate-400',  card: 'border-slate-400/40 bg-gradient-to-br from-slate-400/10 via-slate-400/5 to-transparent',  chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-200',  bar: 'from-slate-400 to-slate-500' },
  { icon: Award, label: '3rd', rail: 'bg-orange-400', card: 'border-orange-500/40 bg-gradient-to-br from-orange-500/10 via-orange-500/5 to-transparent', chip: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-200', bar: 'from-orange-400 to-amber-500' },
];

function PodiumCard({ rank, row, teamRev, onClick }) {
  const p = PODIUM[rank] || PODIUM[2];
  const Icon = p.icon;
  const share = teamRev > 0 ? Math.min(100, (row.revenue / teamRev) * 100) : 0;
  return (
    <button type="button" onClick={onClick} title={row.fullName}
      className={cn('group relative flex items-center gap-3 overflow-hidden rounded-xl border p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md', p.card)}>
      <span className={cn('absolute inset-y-0 left-0 w-1', p.rail)} />
      <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg', p.chip)}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-bold" title={row.fullName}>{row.name}</span>
          <span className={cn('rounded px-1 text-[9px] font-bold uppercase', p.chip)}>{p.label}</span>
        </div>
        <div className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-lg font-extrabold tabular-nums">{fmtCurrency(row.revenue)}</span>
          <span className="text-[11px] text-muted-fg">{fmtNumber(row.orders)} sale{row.orders === 1 ? '' : 's'}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full bg-gradient-to-r', p.bar)} style={{ width: `${share}%` }} />
          </div>
          <span className="w-14 shrink-0 text-right text-[10px] font-medium text-muted-fg">{share.toFixed(0)}% of day</span>
        </div>
      </div>
    </button>
  );
}

const TINT = {
  amber:   { card: 'border-amber-500/40 bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent',   bg: 'bg-gradient-to-br from-amber-500 to-orange-500',   fg: 'text-amber-600 dark:text-amber-300' },
  violet:  { card: 'border-violet-500/40 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent', bg: 'bg-gradient-to-br from-violet-500 to-purple-500', fg: 'text-violet-600 dark:text-violet-300' },
  emerald: { card: 'border-emerald-500/40 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent', bg: 'bg-gradient-to-br from-emerald-500 to-teal-500', fg: 'text-emerald-600 dark:text-emerald-300' },
};

function Standout({ icon: Icon, tint, title, name, full, detail }) {
  const t = TINT[tint] || TINT.amber;
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border p-3 shadow-sm', t.card)}>
      <div className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white shadow', t.bg)}>
        <Icon size={18} strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{title}</div>
        <div className="truncate text-sm font-semibold" title={full}>{name}</div>
      </div>
      <div className={cn('shrink-0 text-sm font-extrabold tabular-nums', t.fg)}>{detail}</div>
    </div>
  );
}

const RANK_ICON = [Crown, Medal, Award];
const RANK_COLOR = ['text-amber-500', 'text-slate-400', 'text-orange-400'];

// Target-pace leaderboard. Per salesperson: today's sales + share of the day,
// their monthly target, how much they've achieved (MTD), current vs required
// daily average, and a month-end forecast (on pace / behind).
function Leaderboard({ rows, teamRev, onRowClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-fg">
          <tr className="border-b border-border">
            <th className="px-3 py-2.5 text-left w-9">#</th>
            <th className="px-3 py-2.5 text-left">Salesperson</th>
            <th className="px-3 py-2.5 text-right">Today</th>
            <th className="px-3 py-2.5 text-right">Share</th>
            <th className="px-3 py-2.5 text-right">Target</th>
            <th className="px-3 py-2.5 text-left w-44">Achieved</th>
            <th className="px-3 py-2.5 text-right">Avg / Day</th>
            <th className="px-3 py-2.5 text-right">Need / Day</th>
            <th className="px-3 py-2.5 text-right">Forecast</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const RankIcon = RANK_ICON[i];
            const share = teamRev > 0 ? (r.revenue / teamRev) * 100 : 0;
            const paceGood = r.reqAvg > 0 ? r.currAvg >= r.reqAvg : true;
            return (
              <tr key={r.code} onClick={() => onRowClick(r)}
                className="group cursor-pointer border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2.5">
                  {RankIcon ? <RankIcon size={15} className={RANK_COLOR[i]} /> : <span className="text-muted-fg tabular-nums">{i + 1}</span>}
                </td>
                <td className="px-3 py-2.5 font-semibold" title={r.fullName}>
                  {r.name}
                  {r.code !== r.name && <span className="ml-1.5 text-[10px] font-normal text-muted-fg">{r.code}</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums">{fmtCurrency(r.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{share.toFixed(0)}%</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{r.target > 0 ? fmtCompactCurrency(r.target) : '—'}</td>
                <td className="px-3 py-2.5">
                  {r.target > 0 ? (
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className={cn('h-full rounded-full bg-gradient-to-r',
                          r.pctAchieved >= 100 ? 'from-emerald-500 to-teal-500' : r.pctAchieved >= 60 ? 'from-sky-500 to-cyan-500' : 'from-amber-500 to-orange-500')}
                          style={{ width: `${Math.min(100, r.pctAchieved)}%` }} />
                      </div>
                      <span className="w-9 shrink-0 text-right text-[10px] font-semibold tabular-nums">{r.pctAchieved.toFixed(0)}%</span>
                    </div>
                  ) : (
                    <span className="text-[11px] text-muted-fg">{fmtCompactCurrency(r.mtd)} so far</span>
                  )}
                </td>
                <td className={cn('px-3 py-2.5 text-right tabular-nums font-medium', paceGood ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500 dark:text-rose-300')}>
                  {fmtCompactCurrency(r.currAvg)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{r.reqAvg > 0 ? fmtCompactCurrency(r.reqAvg) : '—'}</td>
                <td className="px-3 py-2.5 text-right">
                  <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums',
                    r.onPace == null ? 'bg-muted text-muted-fg'
                      : r.onPace ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                      : 'bg-rose-100 text-rose-600 dark:bg-rose-900/40 dark:text-rose-200')}>
                    {r.onPace != null && (r.onPace ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
                    {fmtCompactCurrency(r.forecast)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MonthlySoon() {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-2 py-16 text-center">
        <Calendar size={28} className="text-muted-fg" />
        <div className="text-sm font-semibold">Monthly view is coming next</div>
        <div className="max-w-md text-xs text-muted-fg">
          The full monthly leaderboard (target progress, average-sale trend, customer mix) will land here.
          For now, switch to <span className="font-semibold text-fg">Daily</span> for the team's day report.
        </div>
      </CardContent>
    </Card>
  );
}
