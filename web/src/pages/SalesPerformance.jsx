// Faithful clone of /auth/sales/performance — SALES-PERSON PERFORMANCE.
// Real data from MySQL `sp_performance` joined to `employees` by rv_code.
// Layout: header with year/month + Summary link + tabs (Achievements / Data).
// Achievements tab: top-3 podium (crown / silver / bronze) on the left,
// top-10 bar chart on the right. Data tab: full ranking table.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompact, fmtPercent } from '@/lib/format';
import { Crown, Award, Medal, RefreshCw, Trophy, Target, Sparkles, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts';

const MONTHS = [
  { v: 1, n: 'January' }, { v: 2, n: 'February' }, { v: 3, n: 'March' },
  { v: 4, n: 'April' }, { v: 5, n: 'May' }, { v: 6, n: 'June' },
  { v: 7, n: 'July' }, { v: 8, n: 'August' }, { v: 9, n: 'September' },
  { v: 10, n: 'October' }, { v: 11, n: 'November' }, { v: 12, n: 'December' },
  { v: 0, n: 'All' },
];

const YEARS_SQL = `
  SELECT DISTINCT YEAR(SaleDate) AS y FROM sp_performance
  WHERE SaleDate IS NOT NULL ORDER BY y DESC
`;

function buildPerfSql({ year, month }) {
  const where = month === 0
    ? `WHERE YEAR(sp.SaleDate) = ${year}`
    : `WHERE YEAR(sp.SaleDate) = ${year} AND MONTH(sp.SaleDate) = ${month}`;
  return `
    SELECT
      sp.PrimarySalesperson AS code,
      e.name AS name,
      e.store AS store,
      e.default_target AS target,
      e.is_active AS is_active,
      SUM(sp.SaleSplitAmt) AS revenue,
      COUNT(DISTINCT sp.SalesNo) AS sales
    FROM sp_performance sp
    LEFT JOIN employees e ON e.rv_code = sp.PrimarySalesperson
    ${where}
      AND sp.PrimarySalesperson IS NOT NULL
      AND TRIM(sp.PrimarySalesperson) <> ''
      AND sp.PrimarySalesperson <> 'HA'
    GROUP BY sp.PrimarySalesperson, e.name, e.store, e.default_target, e.is_active
    ORDER BY revenue DESC
  `;
}

const STORE_LABEL = { 1: 'S1 · Arden', 2: 'S2 · Waynesville' };

export default function SalesPerformance() {
  const today = new Date();
  const [tab, setTab] = useState('achievements'); // 'achievements' | 'data'
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const yearsQ = useMysqlQuery(YEARS_SQL, []);
  const years = (yearsQ.data?.rows ?? []).map((r) => Number(r.y));
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const sql = useMemo(() => buildPerfSql({ year, month }), [year, month]);
  const { data, isLoading, error } = useMysqlQuery(sql, []);
  const rows = data?.rows ?? [];

  const monthName = MONTHS.find((m) => m.v === month)?.n;
  const podium = rows.slice(0, 3);
  const top10 = rows.slice(0, 10).map((r, i) => ({
    name: r.name || r.code,
    code: r.code,
    value: Number(r.revenue) || 0,
    fill: i === 0 ? '#10b981' : i === 1 ? '#06b6d4' : i === 2 ? '#f59e0b' : 'hsl(var(--primary))',
  }));

  const totals = useMemo(() => {
    let revenue = 0, sales = 0;
    rows.forEach((r) => { revenue += Number(r.revenue) || 0; sales += Number(r.sales) || 0; });
    return { revenue, sales, count: rows.length };
  }, [rows]);

  return (
    <>
      <Topbar
        title="SALES-PERSON PERFORMANCE"
        subtitle={`${year} · ${monthName}`}
      />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ---- HEADER FILTERS ---- */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <Link
              to="/sales/performance/summary"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Summary
              <ExternalLink size={12} />
            </Link>

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-muted-fg">Month</span>
              <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-32">
                {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.n}</option>)}
              </Select>
              <span className="text-xs uppercase tracking-wider text-muted-fg">Year</span>
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" disabled={yearsQ.isLoading}>
                {(years.length ? years : [today.getFullYear()]).map((y) => <option key={y} value={y}>{y}</option>)}
              </Select>
              <Button variant="outline" size="icon" title="Refresh" onClick={() => window.location.reload()}>
                <RefreshCw size={14} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ---- TABS ---- */}
        <div className="flex items-center gap-1 border-b border-border">
          <TabButton active={tab === 'achievements'} onClick={() => setTab('achievements')}>
            Achievements
          </TabButton>
          <TabButton active={tab === 'data'} onClick={() => setTab('data')}>
            Data
          </TabButton>
        </div>

        {error && (
          <Card className="border-danger/30">
            <CardContent className="p-4 text-sm text-danger">
              Could not reach MySQL: {error.message}
            </CardContent>
          </Card>
        )}

        {/* ---- ACHIEVEMENTS TAB ---- */}
        {tab === 'achievements' && (
          <div className="grid gap-5 lg:grid-cols-2">
            {/* Left: Podium */}
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy size={18} className="text-amber-500" />
                  Top performers · {monthName} {year}
                </CardTitle>
                <CardDescription>From <code>sp_performance</code> joined to <code>employees</code> by rv_code.</CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="py-12 text-center text-muted-fg">Loading…</div>
                ) : podium.length === 0 ? (
                  <div className="py-12 text-center text-muted-fg">No records for {monthName} {year}.</div>
                ) : (
                  <div className="flex flex-col gap-4">
                    {podium[0] && <PodiumOne row={podium[0]} />}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {podium[1] && <PodiumSmall rank={2} row={podium[1]} />}
                      {podium[2] && <PodiumSmall rank={3} row={podium[2]} />}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Right: Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Top 10 by revenue</CardTitle>
                <CardDescription>{totals.count} salespeople · {fmtCurrency(totals.revenue)} total · {fmtNumber(totals.sales)} sales</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[420px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={top10} margin={{ top: 10, right: 16, bottom: 16, left: 12 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="code" stroke="hsl(var(--muted-fg))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(v) => '$' + fmtCompact(v)} />
                      <Tooltip
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                        formatter={(v) => fmtCurrency(v)}
                        labelFormatter={(l) => {
                          const r = top10.find((x) => x.code === l);
                          return r ? r.name : l;
                        }}
                      />
                      <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                        {top10.map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ---- DATA TAB ---- */}
        {tab === 'data' && (
          <Card>
            <CardHeader>
              <CardTitle>Full ranking · {monthName} {year}</CardTitle>
              <CardDescription>{rows.length} salespeople · sorted by revenue.</CardDescription>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <DataTable rows={rows} loading={isLoading} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

// ------- sub-components -------

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px px-5 py-2.5 text-sm font-medium transition border-b-2',
        active
          ? 'border-primary text-fg'
          : 'border-transparent text-muted-fg hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

function PodiumOne({ row }) {
  const target = Number(row.target) || 0;
  const revenue = Number(row.revenue) || 0;
  const pct = target > 0 ? Math.min(100, (revenue / target) * 100) : null;
  return (
    <div className="relative flex flex-col items-center gap-1 overflow-hidden rounded-2xl border border-emerald-300/50 bg-gradient-to-br from-emerald-500/95 via-emerald-600/95 to-teal-700 p-6 text-white shadow-[0_18px_38px_rgba(17,54,36,0.35)]">
      {/* sparkle stars */}
      <Sparkles size={14} className="absolute right-3 top-3 text-yellow-200/80" />
      <Sparkles size={11} className="absolute right-9 top-5 text-yellow-200/70 animate-pulse" />
      <Sparkles size={10} className="absolute left-4 top-4 text-yellow-200/70" />
      <Sparkles size={9} className="absolute left-12 top-10 text-yellow-200/60 animate-pulse" />

      {/* big watermark "1" */}
      <span className="absolute left-2 top-1/2 -translate-y-1/2 select-none font-black leading-none text-white/15 pointer-events-none" style={{ fontSize: '15rem' }}>
        1
      </span>

      <Crown size={64} className="relative z-10 drop-shadow-[0_6px_18px_rgba(251,191,36,0.55)]" />
      <div className="relative z-10 mt-1 text-[11px] font-bold uppercase tracking-[0.18em] opacity-90">Top Performer</div>
      <div className="relative z-10 font-serif italic text-4xl font-extrabold tracking-tight">{row.name || row.code}</div>
      <div className="relative z-10 text-base font-medium opacity-90">
        {fmtCurrency(revenue)} · {fmtNumber(row.sales)} sales
      </div>
      {pct != null && (
        <div className="relative z-10 mt-2 w-full max-w-xs">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/25">
            <div className="h-full rounded-full bg-yellow-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] font-medium opacity-90">
            <span className="flex items-center gap-1"><Target size={10} />Target {fmtCurrency(target)}</span>
            <span className="num">{fmtPercent(pct, 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PodiumSmall({ rank, row }) {
  const isSilver = rank === 2;
  const target = Number(row.target) || 0;
  const revenue = Number(row.revenue) || 0;
  const pct = target > 0 ? Math.min(100, (revenue / target) * 100) : null;
  const Icon = isSilver ? Award : Medal;
  const wrapClass = isSilver
    ? 'bg-gradient-to-br from-cyan-400/90 to-cyan-600/90 text-slate-900'
    : 'bg-gradient-to-br from-amber-300/90 to-amber-500/90 text-amber-950';
  const labelClass = isSilver ? 'text-cyan-50' : 'text-amber-50';
  return (
    <div className={cn('relative flex flex-col items-center gap-1 overflow-hidden rounded-2xl border border-white/40 p-5 shadow-md', wrapClass)}>
      <Icon size={42} className="drop-shadow-[0_6px_14px_rgba(15,23,42,0.35)]" />
      <div className={cn('text-[10px] font-bold uppercase tracking-[0.18em] opacity-85', labelClass)}>
        {rank === 2 ? '2ND PLACE' : '3RD PLACE'}
      </div>
      <div className="font-serif italic text-2xl font-extrabold">{row.name || row.code}</div>
      <div className="text-sm font-medium opacity-85">{fmtCurrency(revenue)} · {fmtNumber(row.sales)} sales</div>
      {pct != null && (
        <div className="mt-1 w-full">
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/40">
            <div className="h-full rounded-full bg-white/80" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[10px] opacity-80">
            <span>Target {fmtCurrency(target)}</span>
            <span className="num">{fmtPercent(pct, 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DataTable({ rows, loading }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">Rank</th>
          <th className="px-4 py-2.5 text-left">Name</th>
          <th className="px-4 py-2.5 text-left">Code</th>
          <th className="px-4 py-2.5 text-left">Store</th>
          <th className="px-4 py-2.5 text-right">Revenue</th>
          <th className="px-4 py-2.5 text-right">Sales</th>
          <th className="px-4 py-2.5 text-right">Avg / Sale</th>
          <th className="px-4 py-2.5 text-right">Target</th>
          <th className="px-4 py-2.5 text-right">% to Target</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={9} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.length === 0 ? (
          <tr><td colSpan={9} className="py-8 text-center text-muted-fg">No records.</td></tr>
        ) : rows.map((r, i) => {
          const rev = Number(r.revenue) || 0;
          const sales = Number(r.sales) || 0;
          const tgt = Number(r.target) || 0;
          const pct = tgt > 0 ? (rev / tgt) * 100 : null;
          const active = Number(r.is_active) === 1 || r.is_active == null;
          return (
            <tr key={r.code} className={cn('border-t border-border', !active && 'opacity-60')}>
              <td className="px-4 py-2.5 num">
                {i < 3 ? (
                  <Badge tone="warning">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} #{i + 1}</Badge>
                ) : <span className="text-muted-fg">#{i + 1}</span>}
              </td>
              <td className="px-4 py-2.5 font-medium">
                {r.name || '—'}
                {!active && <span className="ml-2 text-[10px] text-muted-fg">(inactive)</span>}
              </td>
              <td className="px-4 py-2.5 text-muted-fg num">{r.code}</td>
              <td className="px-4 py-2.5 text-muted-fg">{STORE_LABEL[r.store] || (r.store ? `Store ${r.store}` : '—')}</td>
              <td className="px-4 py-2.5 text-right num">{fmtCurrency(rev)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtNumber(sales)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{sales ? fmtCurrency(rev / sales) : '—'}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{tgt ? fmtCurrency(tgt) : '—'}</td>
              <td className={cn('px-4 py-2.5 text-right num',
                pct == null ? '' : pct >= 100 ? 'text-success' : pct >= 75 ? 'text-warning' : 'text-danger')}>
                {pct == null ? '—' : fmtPercent(pct, 0)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
