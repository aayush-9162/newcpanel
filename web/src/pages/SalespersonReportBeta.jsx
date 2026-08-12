// Salesperson Report (BETA) — a NEW standalone page (separate from the existing
// /sales/performance "SalesPerson Performance"). One shared leaderboard for the
// whole team with a Daily / Monthly toggle. Daily is built first and is the
// default: it answers "how did each salesperson do yesterday, and what should
// they fix today" — rank, average ticket, attachment (items/ticket) and
// new-vs-returning customers, all for the store's most recent business day.
//
// Data: MS SQL SalespersonDaily (revenue / tickets / customers) + SalesItemDetail
// (items), salesperson codes resolved to names via MySQL employees.rv_code.

import { useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { MetricDrilldown } from '@/components/MetricDrilldown';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import {
  Trophy, ShoppingCart, Users, Receipt, Crown, Medal, Award,
  Calendar, DollarSign, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/cn';

const STORE_TO_BLDG = { ARDEN: 1, WAYNESVILLE: 2 };

// Parse a 'YYYY-MM-DD' as LOCAL midnight (a SQL DATE arrives as UTC midnight,
// which renders a day earlier west of UTC).
const localDate = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');

export default function SalespersonReportBeta() {
  const [store, setStore]   = useState('ARDEN');          // ARDEN | WAYNESVILLE
  const [period, setPeriod] = useState('daily');          // daily | monthly (monthly = soon)
  const bldg = STORE_TO_BLDG[store];
  const storeLabel = store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)';

  const [drilldown, setDrilldown] = useState(null);

  const dailyOn = period === 'daily';

  // ── Anchor day — the store's most recent business day on file (excl. today).
  const dayQ = useSqlQuery(`
    SELECT CONVERT(char(10), CAST(MAX(sd.SaleDate) AS DATE), 23) AS day
    FROM SalespersonDaily sd
    WHERE LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}' AND sd.SaleDate < CAST(GETDATE() AS DATE)
  `, [], { enabled: dailyOn });
  const dayStr = dayQ.data?.rows?.[0]?.day || null;
  const dateShort = dayStr
    ? `${localDate(dayStr).getDate()} ${localDate(dayStr).toLocaleDateString('en-US', { month: 'short' })}`
    : 'Latest day';
  const weekdayLong = dayStr ? localDate(dayStr).toLocaleDateString('en-US', { weekday: 'long' }) : '';

  const dayReady = dailyOn && !!dayStr;

  // ── Leaderboard — revenue / tickets / customers (+ new) per salesperson.
  // isNew is decided per row with a NOT EXISTS anti-join against any earlier
  // sale for that customer (small set — only the day's rows are scanned).
  const boardQ = useSqlQuery(`
    WITH todays AS (
      SELECT LTRIM(RTRIM(sd.SalesPerson)) AS salesperson,
             CAST(sd.SalesNo AS VARCHAR(20)) AS SalesNo,
             sd.CustomerId,
             ISNULL(sd.SaleSplitAmt, 0) AS amt,
             CASE WHEN NOT EXISTS (
                    SELECT 1 FROM SalespersonDaily p
                    WHERE p.CustomerId = sd.CustomerId AND p.SaleDate < '${dayStr}'
                  ) THEN 1 ELSE 0 END AS isNew
      FROM SalespersonDaily sd
      WHERE sd.SaleDate >= '${dayStr}' AND sd.SaleDate < DATEADD(DAY, 1, '${dayStr}')
        AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}'
        AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    )
    SELECT salesperson,
           COUNT(DISTINCT SalesNo)   AS orders,
           SUM(amt)                  AS revenue,
           COUNT(DISTINCT CustomerId) AS customers,
           COUNT(DISTINCT CASE WHEN isNew = 1 THEN CustomerId END) AS newCustomers
    FROM todays
    GROUP BY salesperson
    ORDER BY revenue DESC
  `, [], { enabled: dayReady });

  // ── Items per salesperson (attachment). SalesItemDetail is keyed by SaleNo
  // with no salesperson column, so we join it to each salesperson's tickets.
  const itemsQ = useSqlQuery(`
    WITH tix AS (
      SELECT DISTINCT LTRIM(RTRIM(sd.SalesPerson)) AS salesperson,
             CAST(sd.SalesNo AS VARCHAR(20)) AS SaleNo
      FROM SalespersonDaily sd
      WHERE sd.SaleDate >= '${dayStr}' AND sd.SaleDate < DATEADD(DAY, 1, '${dayStr}')
        AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}'
        AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    )
    SELECT tix.salesperson, COUNT(*) AS items
    FROM tix
    JOIN SalesItemDetail sid ON CAST(sid.SaleNo AS VARCHAR(20)) = tix.SaleNo
      AND sid.SaleDate >= '${dayStr}' AND sid.SaleDate < DATEADD(DAY, 1, '${dayStr}')
    GROUP BY tix.salesperson
  `, [], { enabled: dayReady });

  // ── Month-to-date revenue per salesperson (month start → anchor day).
  const mtdQ = useSqlQuery(`
    SELECT LTRIM(RTRIM(sd.SalesPerson)) AS salesperson, SUM(ISNULL(sd.SaleSplitAmt, 0)) AS mtd
    FROM SalespersonDaily sd
    WHERE sd.SaleDate >= DATEFROMPARTS(YEAR(CAST('${dayStr}' AS DATE)), MONTH(CAST('${dayStr}' AS DATE)), 1)
      AND sd.SaleDate < DATEADD(DAY, 1, CAST('${dayStr}' AS DATE))
      AND LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${bldg}'
      AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    GROUP BY LTRIM(RTRIM(sd.SalesPerson))
  `, [], { enabled: dayReady });

  // ── Salesperson codes → names (MySQL employees.rv_code). Split sales like
  // "BJT / CAT" resolve each part and rejoin.
  const empQ = useMysqlQuery('SELECT rv_code, name FROM employees', []);
  const empMap = useMemo(() => {
    const m = {};
    for (const r of (empQ.data?.rows ?? [])) {
      const c = String(r.rv_code || '').trim().toUpperCase();
      if (c) m[c] = String(r.name || '').trim();
    }
    return m;
  }, [empQ.data]);
  const resolveSp = (raw) => String(raw || '').split('/')
    .map((part) => { const c = part.trim(); const full = empMap[c.toUpperCase()]; return full ? (full.trim().split(/\s+/)[0] || full) : c; })
    .filter(Boolean).join(' / ') || String(raw || '—');
  const resolveSpFull = (raw) => String(raw || '').split('/')
    .map((part) => { const c = part.trim(); return empMap[c.toUpperCase()] || c; })
    .filter(Boolean).join(' / ') || String(raw || '—');

  // ── Merge the three per-salesperson queries into one ranked list.
  const rows = useMemo(() => {
    const itemsMap = {};
    for (const r of (itemsQ.data?.rows ?? [])) itemsMap[String(r.salesperson)] = Number(r.items) || 0;
    const mtdMap = {};
    for (const r of (mtdQ.data?.rows ?? [])) mtdMap[String(r.salesperson)] = Number(r.mtd) || 0;
    return (boardQ.data?.rows ?? []).map((r) => {
      const revenue   = Number(r.revenue) || 0;
      const orders    = Number(r.orders) || 0;
      const customers = Number(r.customers) || 0;
      const newC      = Number(r.newCustomers) || 0;
      const items     = itemsMap[String(r.salesperson)] || 0;
      return {
        code: r.salesperson,
        revenue, orders, customers,
        newCustomers: newC,
        returning: Math.max(0, customers - newC),
        items,
        avgTicket: orders ? revenue / orders : 0,
        itemsPerTicket: orders ? items / orders : 0,
        mtd: mtdMap[String(r.salesperson)] || 0,
      };
    });
  }, [boardQ.data, itemsQ.data, mtdQ.data]);

  // ── Team totals (the "against the room" strip).
  const team = useMemo(() => {
    let revenue = 0, orders = 0, customers = 0;
    for (const r of rows) { revenue += r.revenue; orders += r.orders; customers += r.customers; }
    return { revenue, orders, customers, people: rows.length, avgTicket: orders ? revenue / orders : 0 };
  }, [rows]);

  const loading = boardQ.isLoading || dayQ.isLoading;

  const openSp = (r) => setDrilldown({
    title: `${resolveSpFull(r.code)} · ${dateShort} · ${storeLabel}`,
    icon: Receipt,
    accent: 'sky',
    headline: fmtCurrency(r.revenue),
    subtitle: `${fmtNumber(r.orders)} ticket${r.orders === 1 ? '' : 's'} · avg ${fmtCurrency(r.avgTicket)}`,
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
    detailsEmpty: 'No tickets that day',
  });

  return (
    <>
      <Topbar title="Salesperson Report" subtitle={`BETA · ${store === 'ARDEN' ? 'S1 · Arden' : 'S2 · Waynesville'} · ${dailyOn ? dateShort : 'Monthly'}`} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
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
                Most recent day on file · <span className="font-semibold text-fg">{weekdayLong}, {dateShort}</span>
              </div>
            )}
          </CardContent>
        </Card>

        {period === 'monthly' ? (
          <MonthlySoon />
        ) : (
          <>
            {/* ═══════════════ Team summary (against the room) ═══════════════ */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <TeamStat label={`Team Sales · ${dateShort}`} value={fmtCurrency(team.revenue)} caption={`${fmtNumber(team.people)} selling`} icon={DollarSign} accent="emerald" loading={loading} />
              <TeamStat label="Tickets" value={fmtNumber(team.orders)} caption={weekdayLong || 'Latest day'} icon={ShoppingCart} accent="sky" loading={loading} />
              <TeamStat label="Store Avg Ticket" value={fmtCurrency(team.avgTicket)} caption="revenue ÷ tickets" icon={Receipt} accent="violet" loading={loading} />
              <TeamStat label="Customers" value={fmtNumber(team.customers)} caption="served that day" icon={Users} accent="amber" loading={loading} />
            </div>

            {/* ═══════════════ Leaderboard ═══════════════ */}
            <Card>
              <CardContent className="p-0">
                <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                  <Trophy size={16} className="text-amber-500" />
                  <span className="text-sm font-semibold">Leaderboard · {dateShort} · {storeLabel}</span>
                  <span className="ml-auto text-[11px] text-muted-fg">Ranked by revenue · avg ticket vs store avg ({fmtCurrency(team.avgTicket)})</span>
                </div>
                <Leaderboard
                  rows={rows}
                  loading={loading}
                  storeAvg={team.avgTicket}
                  resolveSp={resolveSp}
                  resolveSpFull={resolveSpFull}
                  onRowClick={openSp}
                />
              </CardContent>
            </Card>
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
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded-md px-3 py-1 text-xs font-semibold transition',
        active ? 'bg-primary text-primary-fg shadow' : 'text-muted-fg hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

const STAT_ACCENTS = {
  emerald: { text: 'text-emerald-600 dark:text-emerald-300', grad: 'from-emerald-500 to-teal-500', border: 'border-emerald-500/25', wash: 'from-emerald-500/5' },
  sky:     { text: 'text-sky-600 dark:text-sky-300',         grad: 'from-sky-500 to-cyan-500',     border: 'border-sky-500/25',     wash: 'from-sky-500/5' },
  violet:  { text: 'text-violet-600 dark:text-violet-300',   grad: 'from-violet-500 to-purple-500', border: 'border-violet-500/25',  wash: 'from-violet-500/5' },
  amber:   { text: 'text-amber-600 dark:text-amber-300',     grad: 'from-amber-500 to-orange-500', border: 'border-amber-500/25',   wash: 'from-amber-500/5' },
};

function TeamStat({ label, value, caption, icon: Icon, accent = 'sky', loading }) {
  const a = STAT_ACCENTS[accent] || STAT_ACCENTS.sky;
  return (
    <div className={cn('relative overflow-hidden rounded-xl border bg-card p-3.5', a.border)}>
      <div className={cn('absolute inset-0 bg-gradient-to-br via-transparent to-transparent opacity-80', a.wash)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
          {loading ? (
            <div className="mt-2 h-7 w-20 animate-pulse rounded bg-muted/50" />
          ) : (
            <>
              <div className={cn('mt-1 text-2xl font-extrabold leading-none tabular-nums', a.text)}>{value}</div>
              {caption && <div className="mt-1.5 text-[11px] font-medium text-muted-fg">{caption}</div>}
            </>
          )}
        </div>
        <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow bg-gradient-to-br', a.grad)}>
          <Icon size={15} strokeWidth={2.25} />
        </div>
      </div>
    </div>
  );
}

const RANK_ICON = [Crown, Medal, Award];
const RANK_COLOR = ['text-amber-500', 'text-slate-400', 'text-orange-400'];

function Leaderboard({ rows, loading, storeAvg, resolveSp, resolveSpFull, onRowClick }) {
  if (loading) {
    return <div className="grid place-items-center py-16 text-sm text-muted-fg">
      <div className="flex flex-col items-center gap-3"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading leaderboard…</div>
    </div>;
  }
  if (!rows.length) {
    return <div className="grid place-items-center py-16 text-sm text-muted-fg">No salesperson sales for that day.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-fg">
          <tr className="border-b border-border">
            <th className="px-3 py-2.5 text-left w-10">#</th>
            <th className="px-3 py-2.5 text-left">Salesperson</th>
            <th className="px-3 py-2.5 text-right">Sales</th>
            <th className="px-3 py-2.5 text-right">Tickets</th>
            <th className="px-3 py-2.5 text-right">Items / Ticket</th>
            <th className="px-3 py-2.5 text-right">Avg Ticket</th>
            <th className="px-3 py-2.5 text-right">Customers</th>
            <th className="px-3 py-2.5 text-right">MTD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const RankIcon = RANK_ICON[i];
            const above = r.avgTicket >= storeAvg;
            return (
              <tr
                key={r.code}
                onClick={() => onRowClick(r)}
                className="group cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="px-3 py-2.5 tabular-nums">
                  {RankIcon
                    ? <RankIcon size={16} className={RANK_COLOR[i]} />
                    : <span className="text-muted-fg">{i + 1}</span>}
                </td>
                <td className="px-3 py-2.5 font-semibold" title={resolveSpFull(r.code)}>
                  {resolveSp(r.code)}
                  {r.code !== resolveSp(r.code) && <span className="ml-1.5 text-[10px] font-normal text-muted-fg">{r.code}</span>}
                </td>
                <td className="px-3 py-2.5 text-right font-bold tabular-nums">{fmtCurrency(r.revenue)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{fmtNumber(r.orders)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  <span className="font-medium">{r.itemsPerTicket ? r.itemsPerTicket.toFixed(1) : '—'}</span>
                  <span className="ml-1 text-[10px] text-muted-fg">({fmtNumber(r.items)})</span>
                </td>
                <td className={cn('px-3 py-2.5 text-right font-semibold tabular-nums',
                  above ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-500 dark:text-rose-300')}>
                  {fmtCurrency(r.avgTicket)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">
                  {fmtNumber(r.customers)}
                  <span className="ml-1 text-[10px]">
                    <span className="text-violet-500">{fmtNumber(r.newCustomers)}n</span>
                    {' · '}
                    <span className="text-emerald-500">{fmtNumber(r.returning)}r</span>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{fmtCompactCurrency(r.mtd)}</td>
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
          The monthly leaderboard (pace-to-target, avg-ticket trend, customer mix) will land here.
          For now, switch to <span className="font-semibold text-fg">Daily</span> for yesterday's team report.
        </div>
      </CardContent>
    </Card>
  );
}
