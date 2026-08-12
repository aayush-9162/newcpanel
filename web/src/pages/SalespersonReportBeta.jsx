// Salesperson Report (BETA) — a NEW standalone page (separate from the existing
// /sales/performance "SalesPerson Performance"). One shared leaderboard for the
// whole team with a Daily / Monthly toggle. Daily is built first and default: it
// answers "how did each salesperson do yesterday, and what should they fix
// today" — rank, average ticket, attachment (items/ticket), new-vs-returning
// customers and standout callouts, for the store's most recent business day.
//
// Data: MS SQL SalespersonDaily (revenue / tickets / customers / biggest ticket)
// + SalesItemDetail (items); codes resolved to names via MySQL employees.rv_code.

import { useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { HeroBanner } from '@/components/HeroStat';
import { MetricDrilldown } from '@/components/MetricDrilldown';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompact, fmtCompactCurrency } from '@/lib/format';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';
import {
  Trophy, Receipt, Crown, Medal, Award, Calendar,
  Sparkles, Zap, Package, Gem, UserPlus, BarChart3,
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

  // ── Leaderboard — revenue / tickets / customers (+ new) + biggest single
  // ticket per salesperson. isNew is decided per row with a NOT EXISTS
  // anti-join against any earlier sale for that customer.
  const boardQ = useSqlQuery(`
    WITH dayrows AS (
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
    ),
    tickets AS (
      SELECT salesperson, SalesNo, SUM(amt) AS ticketAmt FROM dayrows GROUP BY salesperson, SalesNo
    )
    SELECT r.salesperson,
           COUNT(DISTINCT r.SalesNo)    AS orders,
           SUM(r.amt)                   AS revenue,
           COUNT(DISTINCT r.CustomerId) AS customers,
           COUNT(DISTINCT CASE WHEN r.isNew = 1 THEN r.CustomerId END) AS newCustomers,
           (SELECT MAX(t.ticketAmt) FROM tickets t WHERE t.salesperson = r.salesperson) AS maxTicket
    FROM dayrows r
    GROUP BY r.salesperson
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
        name: resolveSp(r.salesperson),
        fullName: resolveSpFull(r.salesperson),
        revenue, orders, customers,
        newCustomers: newC,
        returning: Math.max(0, customers - newC),
        items,
        maxTicket: Number(r.maxTicket) || 0,
        avgTicket: orders ? revenue / orders : 0,
        itemsPerTicket: orders ? items / orders : 0,
        mtd: mtdMap[String(r.salesperson)] || 0,
      };
    });
  }, [boardQ.data, itemsQ.data, mtdQ.data, empMap]);

  // ── Team totals (the "against the room" context).
  const team = useMemo(() => {
    let revenue = 0, orders = 0, customers = 0, newC = 0;
    for (const r of rows) { revenue += r.revenue; orders += r.orders; customers += r.customers; newC += r.newCustomers; }
    return { revenue, orders, customers, newCustomers: newC, people: rows.length, avgTicket: orders ? revenue / orders : 0 };
  }, [rows]);

  // ── Standouts — best in each dimension (derived from the merged rows).
  const standouts = useMemo(() => {
    if (!rows.length) return [];
    const best = (fn, min = 0) => rows.reduce((a, b) => (fn(b) > fn(a) ? b : a), rows[0]) || null;
    const bigTicket = best((r) => r.maxTicket);
    const attach    = rows.filter((r) => r.orders > 0).sort((a, b) => b.itemsPerTicket - a.itemsPerTicket)[0];
    const basket    = rows.filter((r) => r.orders > 0).sort((a, b) => b.avgTicket - a.avgTicket)[0];
    const newChamp  = best((r) => r.newCustomers);
    const out = [];
    if (bigTicket && bigTicket.maxTicket > 0) out.push({ icon: Zap, tint: 'amber', title: 'Biggest ticket', name: bigTicket.name, full: bigTicket.fullName, detail: fmtCurrency(bigTicket.maxTicket) });
    if (attach && attach.itemsPerTicket > 0) out.push({ icon: Package, tint: 'sky', title: 'Attachment leader', name: attach.name, full: attach.fullName, detail: `${attach.itemsPerTicket.toFixed(1)} items / ticket` });
    if (basket && basket.avgTicket > 0) out.push({ icon: Gem, tint: 'violet', title: 'Biggest baskets', name: basket.name, full: basket.fullName, detail: `${fmtCurrency(basket.avgTicket)} avg` });
    if (newChamp && newChamp.newCustomers > 0) out.push({ icon: UserPlus, tint: 'emerald', title: 'New-customer champ', name: newChamp.name, full: newChamp.fullName, detail: `${fmtNumber(newChamp.newCustomers)} new` });
    return out;
  }, [rows]);

  // ── Revenue-by-salesperson chart data.
  const chartData = useMemo(() => rows.slice(0, 12).map((r, i) => ({
    name: r.name,
    code: r.code,
    value: r.revenue,
    fill: i === 0 ? '#10b981' : i === 1 ? '#06b6d4' : i === 2 ? '#f59e0b' : 'hsl(var(--primary))',
  })), [rows]);

  const loading = boardQ.isLoading || dayQ.isLoading;
  const top = rows[0] || null;

  const openSp = (r) => setDrilldown({
    title: `${r.fullName} · ${dateShort} · ${storeLabel}`,
    icon: Receipt,
    accent: 'sky',
    headline: fmtCurrency(r.revenue),
    subtitle: `${fmtNumber(r.orders)} ticket${r.orders === 1 ? '' : 's'} · avg ${fmtCurrency(r.avgTicket)} · ${fmtNumber(r.items)} items`,
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
            {/* ═══════════════ Day hero — team + top performer ═══════════════ */}
            <HeroBanner icon={Trophy} decorIcon={Trophy} accent="emerald">
              <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
                {storeLabel} · {weekdayLong ? `${weekdayLong}, ` : ''}{dateShort} · Team day report
              </div>
              <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
                <span className="text-4xl font-extrabold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-200">
                  {loading ? '…' : fmtCurrency(team.revenue)}
                </span>
                <span className="text-sm font-medium text-muted-fg">team sales</span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <Meta label="Tickets" value={fmtNumber(team.orders)} />
                <Meta label="Store avg ticket" value={fmtCurrency(team.avgTicket)} />
                <Meta label="Customers" value={`${fmtNumber(team.customers)} (${fmtNumber(team.newCustomers)} new)`} />
                <Meta label="Selling today" value={fmtNumber(team.people)} />
                {top && <Meta label="Top performer" value={`${top.name} · ${fmtCurrency(top.revenue)}`} highlight />}
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
                {/* ═══════════════ Podium — top 3 ═══════════════ */}
                <div className="grid gap-4 lg:grid-cols-3">
                  {rows.slice(0, 3).map((r, i) => (
                    <PodiumCard key={r.code} rank={i} row={r} teamRev={team.revenue} onClick={() => openSp(r)} />
                  ))}
                </div>

                {/* ═══════════════ Chart + standouts ═══════════════ */}
                <div className="grid gap-4 lg:grid-cols-3">
                  <Card className="lg:col-span-2">
                    <CardContent className="p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <BarChart3 size={16} className="text-primary" />
                        <span className="text-sm font-semibold">Revenue by salesperson · {dateShort}</span>
                      </div>
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                            <XAxis type="number" stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(v) => '$' + fmtCompact(v)} />
                            <YAxis type="category" dataKey="name" stroke="hsl(var(--muted-fg))" fontSize={12} width={90} />
                            <Tooltip
                              cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                              contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                              formatter={(v) => [fmtCurrency(v), 'Revenue']}
                            />
                            <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                              {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <Sparkles size={16} className="text-amber-500" />
                        <span className="text-sm font-semibold">Today's standouts</span>
                      </div>
                      <div className="flex flex-col gap-2.5">
                        {standouts.map((s) => <Standout key={s.title} {...s} />)}
                        {standouts.length === 0 && <div className="py-6 text-center text-xs text-muted-fg">No standouts yet.</div>}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* ═══════════════ Full leaderboard ═══════════════ */}
                <Card>
                  <CardContent className="p-0">
                    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
                      <Trophy size={16} className="text-amber-500" />
                      <span className="text-sm font-semibold">Leaderboard · {dateShort} · {storeLabel}</span>
                      <span className="ml-auto text-[11px] text-muted-fg">Ranked by revenue · avg ticket colored vs store avg ({fmtCurrency(team.avgTicket)})</span>
                    </div>
                    <Leaderboard rows={rows} storeAvg={team.avgTicket} teamRev={team.revenue} onRowClick={openSp} />
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

function Meta({ label, value, highlight }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-fg">{label}</span>
      <span className={cn('font-bold tabular-nums', highlight ? 'text-emerald-700 dark:text-emerald-300' : 'text-fg')}>{value}</span>
    </div>
  );
}

const PODIUM = [
  { icon: Crown, wrap: 'from-emerald-500/95 via-emerald-600/95 to-teal-700 border-emerald-300/50 text-white', badge: 'Top Performer', bar: 'bg-yellow-300', barTrack: 'bg-white/25', sub: 'text-white/90' },
  { icon: Medal, wrap: 'from-cyan-400/90 to-cyan-600/90 border-white/40 text-slate-900', badge: '2nd Place', bar: 'bg-white/80', barTrack: 'bg-white/40', sub: 'text-slate-800/80' },
  { icon: Award, wrap: 'from-amber-300/90 to-amber-500/90 border-white/40 text-amber-950', badge: '3rd Place', bar: 'bg-white/80', barTrack: 'bg-white/40', sub: 'text-amber-950/80' },
];

function PodiumCard({ rank, row, teamRev, onClick }) {
  const p = PODIUM[rank] || PODIUM[2];
  const Icon = p.icon;
  const share = teamRev > 0 ? Math.min(100, (row.revenue / teamRev) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      title={row.fullName}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-gradient-to-br p-5 text-left shadow-lg transition hover:-translate-y-0.5',
        p.wrap,
      )}
    >
      <span className="pointer-events-none absolute -left-2 top-1/2 -translate-y-1/2 select-none font-black leading-none opacity-10" style={{ fontSize: '9rem' }}>
        {rank + 1}
      </span>
      <div className="relative flex items-center gap-3">
        <Icon size={rank === 0 ? 40 : 32} className="drop-shadow" />
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] opacity-80">{p.badge}</div>
          <div className="truncate font-serif text-2xl font-extrabold italic">{row.name}</div>
        </div>
      </div>
      <div className="relative mt-3 text-3xl font-extrabold tabular-nums">{fmtCurrency(row.revenue)}</div>
      <div className={cn('relative mt-0.5 text-xs font-medium', p.sub)}>
        {fmtNumber(row.orders)} sale{row.orders === 1 ? '' : 's'} · {fmtCurrency(row.avgTicket)} avg · {row.itemsPerTicket ? row.itemsPerTicket.toFixed(1) : '0'} items/tkt
      </div>
      <div className="relative mt-3">
        <div className={cn('h-1.5 w-full overflow-hidden rounded-full', p.barTrack)}>
          <div className={cn('h-full rounded-full', p.bar)} style={{ width: `${share}%` }} />
        </div>
        <div className={cn('mt-1 flex items-center justify-between text-[10px] font-medium', p.sub)}>
          <span>Share of team</span>
          <span className="tabular-nums">{share.toFixed(0)}%</span>
        </div>
      </div>
    </button>
  );
}

const TINT = {
  amber:   { bg: 'bg-amber-100 dark:bg-amber-900/30', fg: 'text-amber-600 dark:text-amber-300' },
  sky:     { bg: 'bg-sky-100 dark:bg-sky-900/30',     fg: 'text-sky-600 dark:text-sky-300' },
  violet:  { bg: 'bg-violet-100 dark:bg-violet-900/30', fg: 'text-violet-600 dark:text-violet-300' },
  emerald: { bg: 'bg-emerald-100 dark:bg-emerald-900/30', fg: 'text-emerald-600 dark:text-emerald-300' },
};

function Standout({ icon: Icon, tint, title, name, full, detail }) {
  const t = TINT[tint] || TINT.sky;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5">
      <div className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg', t.bg)}>
        <Icon size={17} className={t.fg} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{title}</div>
        <div className="truncate text-sm font-semibold" title={full}>{name}</div>
      </div>
      <div className={cn('shrink-0 text-sm font-bold tabular-nums', t.fg)}>{detail}</div>
    </div>
  );
}

const RANK_ICON = [Crown, Medal, Award];
const RANK_COLOR = ['text-amber-500', 'text-slate-400', 'text-orange-400'];

function Leaderboard({ rows, storeAvg, teamRev, onRowClick }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-fg">
          <tr className="border-b border-border">
            <th className="px-3 py-2.5 text-left w-10">#</th>
            <th className="px-3 py-2.5 text-left">Salesperson</th>
            <th className="px-3 py-2.5 text-left w-40">Share of team</th>
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
            const share = teamRev > 0 ? (r.revenue / teamRev) * 100 : 0;
            return (
              <tr
                key={r.code}
                onClick={() => onRowClick(r)}
                className="group cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
              >
                <td className="px-3 py-2.5 tabular-nums">
                  {RankIcon ? <RankIcon size={16} className={RANK_COLOR[i]} /> : <span className="text-muted-fg">{i + 1}</span>}
                </td>
                <td className="px-3 py-2.5 font-semibold" title={r.fullName}>
                  {r.name}
                  {r.code !== r.name && <span className="ml-1.5 text-[10px] font-normal text-muted-fg">{r.code}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" style={{ width: `${share}%` }} />
                    </div>
                    <span className="w-8 shrink-0 text-right text-[10px] tabular-nums text-muted-fg">{share.toFixed(0)}%</span>
                  </div>
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
          For now, switch to <span className="font-semibold text-fg">Daily</span> for the team's day report.
        </div>
      </CardContent>
    </Card>
  );
}
