// Faithful clone of /auth/mpr — Manager Performance (Target).
// Real data source: MySQL `db_cfc.managers_performance` joined to `managers`
// and `employees` (the application DB the original site uses too).

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompact, fmtPercent } from '@/lib/format';
import { Trophy, RefreshCw, Crown, Award, Medal, Target } from 'lucide-react';
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

// Years available in the managers_performance table.
const YEARS_SQL = `
  SELECT DISTINCT YEAR(created_at) AS y
  FROM managers_performance WHERE created_at IS NOT NULL
  ORDER BY y DESC
`;

// Managers excluded from the report (test / system entries).
const EXCLUDED_MANAGERS = ['Sandeep Gupta'];
const excludeClause = EXCLUDED_MANAGERS.map((n) => `'${n.replace(/'/g, "''")}'`).join(', ');

// Performance view: aggregate by manager.
function buildManagerSql({ year, month }) {
  return `
    SELECT m.id, m.name, m.store, m.default_target, m.is_active,
           COALESCE(SUM(mp.sale_amount), 0) AS revenue,
           COUNT(mp.id) AS sales
    FROM managers m
    LEFT JOIN managers_performance mp ON mp.manager = m.id AND mp.is_valid = 1
      AND ${month === 0 ? `YEAR(mp.created_at) = ${year}` : `YEAR(mp.created_at) = ${year} AND MONTH(mp.created_at) = ${month}`}
    WHERE m.name NOT IN (${excludeClause})
    GROUP BY m.id, m.name, m.store, m.default_target, m.is_active
    ORDER BY revenue DESC
  `;
}

// Associated view: manager × salesperson breakdown.
function buildAssociatedSql({ year, month }) {
  const where = month === 0
    ? `WHERE YEAR(mp.created_at) = ${year}`
    : `WHERE YEAR(mp.created_at) = ${year} AND MONTH(mp.created_at) = ${month}`;
  return `
    SELECT m.name AS manager,
           e.name AS salesperson,
           e.person_code AS sp_code,
           SUM(mp.sale_amount) AS revenue,
           COUNT(*) AS sales
    FROM managers_performance mp
    LEFT JOIN managers m ON mp.manager = m.id
    LEFT JOIN employees e ON mp.sales_person = e.id
    ${where}
      AND mp.is_valid = 1
      AND mp.manager IS NOT NULL
      AND mp.sales_person IS NOT NULL
      AND m.name NOT IN (${excludeClause})
    GROUP BY m.name, e.name, e.person_code
    ORDER BY revenue DESC
    LIMIT 50
  `;
}

const STORE_LABEL = { 1: 'S1 · Arden', 2: 'S2 · Waynesville' };
const PODIUM = ['hsl(42,75%,50%)', 'hsl(220,12%,75%)', 'hsl(28,75%,48%)']; // gold / silver / bronze

export default function ManagerPerformance() {
  const today = new Date();
  const [view, setView] = useState('performance'); // 'performance' | 'associated'
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  const yearsQ = useMysqlQuery(YEARS_SQL, []);
  const years = (yearsQ.data?.rows ?? []).map((r) => Number(r.y));
  useEffect(() => {
    if (years.length && !years.includes(year)) setYear(years[0]);
  }, [years, year]);

  const sql = useMemo(
    () => (view === 'performance' ? buildManagerSql({ year, month }) : buildAssociatedSql({ year, month })),
    [view, year, month],
  );
  const { data, isLoading, error } = useMysqlQuery(sql, []);
  const rows = data?.rows ?? [];

  const monthName = MONTHS.find((m) => m.v === month)?.n;

  // For chart
  const chartData = useMemo(() => {
    if (view === 'performance') {
      return rows
        .filter((r) => Number(r.revenue) > 0)
        .slice(0, 10)
        .map((r, i) => ({
          name: r.name,
          value: Number(r.revenue) || 0,
          fill: i < 3 ? PODIUM[i] : 'hsl(var(--primary))',
        }));
    }
    return rows.slice(0, 10).map((r, i) => ({
      name: `${r.manager} → ${r.sp_code || r.salesperson}`,
      value: Number(r.revenue) || 0,
      fill: i < 3 ? PODIUM[i] : 'hsl(var(--primary))',
    }));
  }, [rows, view]);

  // Top 3 managers for the podium (only in performance view)
  const podium = view === 'performance' ? rows.filter((r) => Number(r.revenue) > 0).slice(0, 3) : [];

  return (
    <>
      <Topbar
        title="Manager Performance (Target)"
        subtitle={`${year} · ${monthName}${view === 'associated' ? ' · Associated' : ''}`}
      />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ---- FILTER BAR ---- */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex gap-1">
              <Button size="sm" variant={view === 'performance' ? 'primary' : 'outline'} onClick={() => setView('performance')}>
                Manager's Performance
              </Button>
              <Button size="sm" variant={view === 'associated' ? 'primary' : 'outline'} onClick={() => setView('associated')}>
                Manager Associated
              </Button>
            </div>

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

        {error && (
          <Card className="border-danger/30">
            <CardContent className="p-4 text-sm text-danger">
              Could not reach MySQL: {error.message}. Restart the backend (<code className="rounded bg-muted px-1">npm start</code>) so the new <code>/api/mysql</code> endpoint registers.
            </CardContent>
          </Card>
        )}

        {/* ---- TOP PERFORMER PODIUM (Performance view only) ---- */}
        {view === 'performance' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy size={18} className="text-amber-500" />
                Top managers · {monthName} {year}
              </CardTitle>
              <CardDescription>From <code>managers_performance</code> joined to <code>managers</code> · target progress in each tile.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="py-12 text-center text-muted-fg">Loading…</div>
              ) : podium.length === 0 ? (
                <div className="py-12 text-center text-muted-fg">No records for {monthName} {year}.</div>
              ) : (
                <div className="grid gap-4 md:grid-cols-3">
                  {podium[1] && <PodiumCard rank={2} row={podium[1]} />}
                  {podium[0] && <PodiumCard rank={1} row={podium[0]} />}
                  {podium[2] && <PodiumCard rank={3} row={podium[2]} />}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ---- CHART ---- */}
        <Card>
          <CardHeader>
            <CardTitle>{view === 'performance' ? 'Top managers · revenue' : 'Manager × salesperson · revenue'}</CardTitle>
            <CardDescription>Top 10 — top 3 highlighted gold / silver / bronze.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 16, bottom: 16, left: 12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    stroke="hsl(var(--muted-fg))"
                    fontSize={11}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(v) => '$' + fmtCompact(v)} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                    formatter={(v) => fmtCurrency(v)}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    {chartData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* ---- TABLE ---- */}
        <Card>
          <CardHeader>
            <CardTitle>{view === 'performance' ? 'All managers' : 'Manager × salesperson breakdown'}</CardTitle>
            <CardDescription>{rows.length} entries · sorted by revenue</CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {view === 'performance' ? (
              <ManagerTable rows={rows} loading={isLoading} />
            ) : (
              <AssociatedTable rows={rows} loading={isLoading} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function PodiumCard({ rank, row }) {
  const Icon = rank === 1 ? Crown : rank === 2 ? Award : Medal;
  const bg = rank === 1
    ? 'bg-amber-50/70 dark:bg-amber-950/30'
    : rank === 2
    ? 'bg-slate-100/70 dark:bg-slate-900/30'
    : 'bg-orange-50/70 dark:bg-orange-950/30';
  const iconBg = rank === 1
    ? 'bg-amber-200/70 text-amber-700 dark:bg-amber-800/40 dark:text-amber-200'
    : rank === 2
    ? 'bg-slate-200/70 text-slate-700 dark:bg-slate-700/40 dark:text-slate-200'
    : 'bg-orange-200/70 text-orange-700 dark:bg-orange-800/40 dark:text-orange-200';
  const order = rank === 1 ? 'md:order-2 md:scale-105' : rank === 2 ? 'md:order-1' : 'md:order-3';
  const target = Number(row.default_target) || 0;
  const revenue = Number(row.revenue) || 0;
  const pct = target > 0 ? Math.min(100, (revenue / target) * 100) : null;

  return (
    <div className={`relative flex flex-col items-center gap-2 rounded-xl border border-border ${bg} p-5 ${order}`}>
      <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-card px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-border">
        #{rank}
      </div>
      <div className={`grid h-14 w-14 place-items-center rounded-full ${iconBg}`}>
        <Icon size={26} />
      </div>
      <div className="text-base font-semibold tracking-tight text-center">{row.name}</div>
      <div className="num text-2xl font-bold">{fmtCurrency(revenue)}</div>
      <div className="text-xs text-muted-fg">
        {fmtNumber(row.sales)} {Number(row.sales) === 1 ? 'sale' : 'sales'} · {STORE_LABEL[row.store] || `Store ${row.store}`}
      </div>
      {pct != null && (
        <div className="mt-1 w-full">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-fg">
            <span className="flex items-center gap-1"><Target size={10} />Target {fmtCurrency(target)}</span>
            <span className="num">{fmtPercent(pct, 0)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function ManagerTable({ rows, loading }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">Rank</th>
          <th className="px-4 py-2.5 text-left">Manager</th>
          <th className="px-4 py-2.5 text-left">Store</th>
          <th className="px-4 py-2.5 text-right">Revenue</th>
          <th className="px-4 py-2.5 text-right">Sales</th>
          <th className="px-4 py-2.5 text-right">Target</th>
          <th className="px-4 py-2.5 text-right">% to Target</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={7} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.length === 0 ? (
          <tr><td colSpan={7} className="py-8 text-center text-muted-fg">No records.</td></tr>
        ) : rows.map((r, i) => {
          const rev = Number(r.revenue) || 0;
          const tgt = Number(r.default_target) || 0;
          const pct = tgt > 0 ? (rev / tgt) * 100 : null;
          const active = Number(r.is_active) === 1;
          return (
            <tr key={r.id} className={`border-t border-border ${!active ? 'opacity-60' : ''}`}>
              <td className="px-4 py-2.5 num">
                {i < 3 && rev > 0 ? (
                  <Badge tone="warning">{i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'} #{i + 1}</Badge>
                ) : <span className="text-muted-fg">#{i + 1}</span>}
              </td>
              <td className="px-4 py-2.5 font-medium">
                {r.name}
                {!active && <span className="ml-2 text-[10px] text-muted-fg">(inactive)</span>}
              </td>
              <td className="px-4 py-2.5 text-muted-fg">{STORE_LABEL[r.store] || `Store ${r.store}`}</td>
              <td className="px-4 py-2.5 text-right num">{fmtCurrency(rev)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtNumber(r.sales)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{tgt ? fmtCurrency(tgt) : '—'}</td>
              <td className={`px-4 py-2.5 text-right num ${pct == null ? '' : pct >= 100 ? 'text-success' : pct >= 75 ? 'text-warning' : 'text-danger'}`}>
                {pct == null ? '—' : fmtPercent(pct, 0)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function AssociatedTable({ rows, loading }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/60 text-[11px] uppercase tracking-wider text-muted-fg">
        <tr>
          <th className="px-4 py-2.5 text-left">Rank</th>
          <th className="px-4 py-2.5 text-left">Manager</th>
          <th className="px-4 py-2.5 text-left">Salesperson</th>
          <th className="px-4 py-2.5 text-right">Revenue</th>
          <th className="px-4 py-2.5 text-right">Sales</th>
        </tr>
      </thead>
      <tbody>
        {loading ? (
          <tr><td colSpan={5} className="py-8 text-center text-muted-fg">Loading…</td></tr>
        ) : rows.length === 0 ? (
          <tr><td colSpan={5} className="py-8 text-center text-muted-fg">No records.</td></tr>
        ) : rows.map((r, i) => {
          const rev = Number(r.revenue) || 0;
          return (
            <tr key={`${r.manager}-${r.salesperson}-${i}`} className="border-t border-border">
              <td className="px-4 py-2.5 num text-muted-fg">#{i + 1}</td>
              <td className="px-4 py-2.5 font-medium">{r.manager || '—'}</td>
              <td className="px-4 py-2.5">
                {r.salesperson || '—'}
                {r.sp_code && <span className="ml-2 text-[11px] text-muted-fg">({r.sp_code})</span>}
              </td>
              <td className="px-4 py-2.5 text-right num">{fmtCurrency(rev)}</td>
              <td className="px-4 py-2.5 text-right num text-muted-fg">{fmtNumber(r.sales)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
