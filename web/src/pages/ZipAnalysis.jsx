// Zipcode Analysis — deep geographic revenue analytics.
//
// Reads `SalesAggrZipWiseYearlyReport` (yearly revenue by zip) and computes
// these per-zip enrichments:
//   - Change vs the previous year (percent)
//   - 4-year revenue series (for sparklines and the drill-down chart)
//   - Performance bucket (Rising / Growing / Stable / Declining / Falling)
//   - Revenue size bucket (Major / Significant / Active / Minor)
//
// The headline year is auto-detected: we take the most recent year that has
// any revenue, so the page still works in early-Jan when the current year
// is mostly empty.
import { useState, useMemo, useEffect } from 'react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, LineChart, Line, Cell, Legend,
} from 'recharts';
import {
  MapPin, DollarSign, TrendingUp, TrendingDown, Target, Search,
  Download, RefreshCw, ArrowUpRight, ArrowDownRight, Minus, X, Sparkles,
  Building2, BarChart3, ChevronRight, ArrowLeft, Layers, Globe2,
  Map as MapIcon, Wallet,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Sparkline } from '@/components/Sparkline';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

const NOW                 = new Date();
const CURRENT_YEAR        = NOW.getFullYear();
const START_OF_YEAR       = new Date(CURRENT_YEAR, 0, 1);
const IS_LEAP_YEAR        = (CURRENT_YEAR % 4 === 0 && CURRENT_YEAR % 100 !== 0) || CURRENT_YEAR % 400 === 0;
const DAYS_IN_YEAR        = IS_LEAP_YEAR ? 366 : 365;
const DAY_OF_YEAR         = Math.min(
  DAYS_IN_YEAR,
  Math.floor((NOW - START_OF_YEAR) / 86_400_000) + 1,
);
// Fraction of the current year that has elapsed (e.g. May 4 → 0.339).
// Floored at 0.01 so we never divide by zero in projections.
const YEAR_PROGRESS       = Math.max(0.01, DAY_OF_YEAR / DAYS_IN_YEAR);
const TODAY_FORMATTED     = NOW.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

// Calendar periods elapsed in the current year — used as the denominator for
// avg weekly / monthly per-area calculations. We use 7-day weeks (not ISO)
// so the math matches a fair "per-calendar-week" view.
const WEEKS_ELAPSED_THIS_YEAR  = Math.max(1, Math.ceil(DAY_OF_YEAR / 7));
const MONTHS_ELAPSED_THIS_YEAR = NOW.getMonth() + 1;
const WEEKS_LAST_YEAR          = 52;
const MONTHS_LAST_YEAR         = 12;

// Performance buckets — group zipcodes by year-over-year change.
const PERFORMANCE_BUCKETS = {
  rising: {
    label: 'Rising',
    description: 'Up more than 20% vs last year',
    color: '#16a34a',
    badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  },
  growing: {
    label: 'Growing',
    description: 'Up 5% to 20% vs last year',
    color: '#84cc16',
    badge: 'bg-lime-100 text-lime-700 dark:bg-lime-900/40 dark:text-lime-200',
  },
  stable: {
    label: 'Stable',
    description: 'Within ±5% of last year',
    color: '#3b82f6',
    badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200',
  },
  declining: {
    label: 'Declining',
    description: 'Down 5% to 20% vs last year',
    color: '#f59e0b',
    badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
  },
  falling: {
    label: 'Falling',
    description: 'Down more than 20% vs last year',
    color: '#ef4444',
    badge: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200',
  },
  dormant: {
    label: 'Dormant',
    description: 'Had revenue last year but nothing yet this year',
    color: '#a1a1aa',
    badge: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300',
  },
  unknown: {
    label: 'New / No History',
    description: 'No prior-year revenue to compare against',
    color: '#94a3b8',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200',
  },
};

// Note: dormant (current = 0 but prior > 0) is its own category; it isn't
// "falling fast", it just hasn't booked yet this period.
function classifyPerformance(percentChange, currentRevenue, priorRevenue) {
  if (currentRevenue === 0 && priorRevenue > 0) return 'dormant';
  if (percentChange == null) return 'unknown';
  if (percentChange  >  20) return 'rising';
  if (percentChange  >   5) return 'growing';
  if (percentChange >=  -5) return 'stable';
  if (percentChange >= -20) return 'declining';
  return 'falling';
}

// Revenue size buckets — group zipcodes by sales volume.
const SIZE_BUCKETS = [
  { id: 'major',       label: 'Major Markets',       description: '$50,000 or more',  min: 50000, color: '#0ea5e9' },
  { id: 'significant', label: 'Significant Markets', description: '$10,000 – $50,000', min: 10000, color: '#22c55e' },
  { id: 'active',      label: 'Active Markets',      description: '$1,000 – $10,000',  min: 1000,  color: '#a855f7' },
  { id: 'minor',       label: 'Minor Markets',       description: 'Under $1,000',     min: 0,     color: '#94a3b8' },
];

function classifySize(revenue) {
  for (const b of SIZE_BUCKETS) if (revenue >= b.min) return b.id;
  return 'minor';
}

// ─── change indicator ─────────────────────────────────────────────────────────

function ChangeIndicator({ percentChange, compact }) {
  if (percentChange == null) {
    return <span className="text-muted-fg text-xs italic">no comparison</span>;
  }
  const Icon = percentChange > 1 ? ArrowUpRight : percentChange < -1 ? ArrowDownRight : Minus;
  const colorClass = percentChange > 1
    ? 'text-emerald-600 dark:text-emerald-400'
    : percentChange < -1
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-muted-fg';
  return (
    <span className={cn('inline-flex items-center gap-0.5 font-semibold tabular-nums', colorClass, compact ? 'text-xs' : 'text-sm')}>
      <Icon size={compact ? 12 : 14} className="shrink-0" />
      {percentChange > 0 ? '+' : ''}{percentChange.toFixed(1)}%
    </span>
  );
}

function PerformanceBadge({ bucket }) {
  const meta = PERFORMANCE_BUCKETS[bucket] || PERFORMANCE_BUCKETS.unknown;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', meta.badge)}
      title={meta.description}>
      {meta.label}
    </span>
  );
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const MAIN_SQL = `
  SELECT
    r.DeliveryZip,
    c.Cities AS DeliveryCity,
    COALESCE(SUM(r.CurrentYear), 0)  AS CurrentYear,
    COALESCE(SUM(r.LastYear), 0)     AS LastYear,
    COALESCE(SUM(r.PreviousYear), 0) AS PreviousYear,
    COALESCE(SUM(r.Previous), 0)     AS Previous
  FROM SalesAggrZipWiseYearlyReport r
  LEFT JOIN (
    SELECT DeliveryZip, STRING_AGG(TRIM(DeliveryCity), ', ') AS Cities
    FROM (SELECT DISTINCT DeliveryZip, DeliveryCity FROM SalesAggrZipWiseYearlyReport) t
    GROUP BY DeliveryZip
  ) c ON r.DeliveryZip = c.DeliveryZip
  GROUP BY r.DeliveryZip, c.Cities
`;

// Per-city per-week revenue for the current year — drives the area-level
// Best Week and Best Month columns. We aggregate to (week, month, city) so
// the same client-side reduce can compute both metrics from one fetch.
const AREA_WEEKLY_SQL = `
  SELECT
    DATEPART(WEEK,  S.wrt_cng_bdat)  AS week_num,
    DATEPART(MONTH, S.wrt_cng_bdat)  AS month_num,
    MIN(CAST(S.wrt_cng_bdat AS DATE)) AS week_start,
    LTRIM(RTRIM(
      COALESCE(
        NULLIF(LTRIM(RTRIM(SR.DeliveryCity)), ''),
        NULLIF(LTRIM(RTRIM(SR.BillingCity)),  ''),
        'Unknown'
      )
    )) AS city,
    SUM(S.wrt_sls) AS revenue
  FROM SaleWRT S
  LEFT JOIN SaleRV SR ON S.wrt_so_no = SR.sales_no
  WHERE YEAR(S.wrt_cng_bdat) = YEAR(GETDATE())
    AND S.wrt_pft_ctr IN (1, 2)
  GROUP BY
    DATEPART(WEEK,  S.wrt_cng_bdat),
    DATEPART(MONTH, S.wrt_cng_bdat),
    LTRIM(RTRIM(
      COALESCE(
        NULLIF(LTRIM(RTRIM(SR.DeliveryCity)), ''),
        NULLIF(LTRIM(RTRIM(SR.BillingCity)),  ''),
        'Unknown'
      )
    ))
`;

const MONTH_SHORT_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Average buying capacity — per zip/city, the average revenue per order
// ("typical spend per purchase"). Written sales joined to the RV header for the
// delivery/billing geography. Current year, both stores.
const CAPACITY_ZIP_EXPR  = `LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(SR.DeliveryZip)),''),  NULLIF(LTRIM(RTRIM(SR.BillingZip)),''),  'Unknown')))`;
const CAPACITY_CITY_EXPR = `LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(SR.DeliveryCity)),''), NULLIF(LTRIM(RTRIM(SR.BillingCity)),''), 'Unknown')))`;
const CAPACITY_SQL = `
  SELECT ${CAPACITY_ZIP_EXPR} AS Zip, ${CAPACITY_CITY_EXPR} AS City,
         SUM(S.wrt_sls)              AS revenue,
         COUNT(DISTINCT S.wrt_so_no) AS orders
  FROM SaleWRT S
  LEFT JOIN SaleRV SR ON S.wrt_so_no = SR.sales_no
  WHERE S.wrt_pft_ctr IN (1, 2) AND YEAR(S.wrt_cng_bdat) = YEAR(GETDATE())
  GROUP BY ${CAPACITY_ZIP_EXPR}, ${CAPACITY_CITY_EXPR}
  HAVING SUM(S.wrt_sls) > 0 AND COUNT(DISTINCT S.wrt_so_no) > 0
`;

// ─── drill-down modal ────────────────────────────────────────────────────────

function ZipDrillDown({ row, onClose, headlineYear }) {
  if (!row) return null;
  const series = [
    { year: CURRENT_YEAR - 3, label: String(CURRENT_YEAR - 3), revenue: row.revenue3YearsAgo },
    { year: CURRENT_YEAR - 2, label: String(CURRENT_YEAR - 2), revenue: row.revenue2YearsAgo },
    { year: CURRENT_YEAR - 1, label: String(CURRENT_YEAR - 1), revenue: row.revenuePreviousYear },
    { year: CURRENT_YEAR,     label: String(CURRENT_YEAR),     revenue: row.revenueCurrentYear },
  ];
  const totalAcrossYears = series.reduce((sum, p) => sum + p.revenue, 0);
  const peakRevenue = Math.max(...series.map(p => p.revenue));
  const peakYear = series.find(p => p.revenue === peakRevenue)?.year;

  // Average yearly growth rate from the oldest non-zero year to current.
  const oldestNonZero = series.find(p => p.revenue > 0);
  const newestNonZero = [...series].reverse().find(p => p.revenue > 0);
  let averageYearlyGrowth = null;
  if (oldestNonZero && newestNonZero && oldestNonZero.year !== newestNonZero.year && oldestNonZero.revenue > 0) {
    const yearSpan = newestNonZero.year - oldestNonZero.year;
    averageYearlyGrowth = (Math.pow(newestNonZero.revenue / oldestNonZero.revenue, 1 / yearSpan) - 1) * 100;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-2xl m-4 rounded-2xl bg-card border border-border shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <MapPin size={18} />
            </div>
            <div>
              <div className="text-lg font-semibold tracking-tight">Zipcode {row.DeliveryZip}</div>
              <div className="text-xs text-muted-fg">{row.DeliveryCity || '—'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PerformanceBadge bucket={row.performanceBucket} />
            <button onClick={onClose} className="rounded-lg p-1.5 text-muted-fg hover:bg-muted hover:text-fg">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="overflow-auto flex-1 p-5 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <DrillStat
              label={row.annualizedProjection ? `Revenue ${headlineYear} YTD` : `Revenue ${headlineYear}`}
              value={fmtCurrency(row.headlineRevenue)}
              sub={row.annualizedProjection ? `Projected: ${fmtCurrency(row.annualizedProjection)}` : null}
              tone="primary"
            />
            <DrillStat
              label={row.annualizedProjection ? 'vs Same Period Last Year' : 'Change vs Prior Year'}
              value={<ChangeIndicator percentChange={row.percentChangeVsPrior} />}
              sub={row.priorYearSamePeriod > 0
                ? `${fmtCurrency(row.priorYearSamePeriod)} ${headlineYear - 1}${row.annualizedProjection ? ' (est.)' : ''}`
                : null}
              tone={row.percentChangeVsPrior > 0 ? 'emerald' : row.percentChangeVsPrior < 0 ? 'rose' : 'sky'}
            />
            <DrillStat
              label="Average Yearly Growth"
              value={averageYearlyGrowth != null ? <ChangeIndicator percentChange={averageYearlyGrowth} /> : <span className="text-muted-fg text-xs">—</span>}
              sub={averageYearlyGrowth != null ? 'compounded over recorded years' : null}
              tone="violet"
            />
            <DrillStat
              label="Peak Year"
              value={peakYear ? `${peakYear}` : '—'}
              sub={peakRevenue > 0 ? fmtCurrency(peakRevenue) : null}
              tone="amber"
            />
          </div>

          <div className="rounded-xl border border-border p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-fg mb-2">Revenue by Year</div>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                    tickFormatter={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
                  <RechartsTooltip formatter={(v) => fmtCurrency(v, true)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Year</th>
                  <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Revenue</th>
                  <th className="px-4 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Share of 4-Year Total</th>
                </tr>
              </thead>
              <tbody>
                {series.slice().reverse().map(p => (
                  <tr key={p.year} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{p.year}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold">{fmtCurrency(p.revenue, true)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-fg">{totalAcrossYears ? ((p.revenue / totalAcrossYears) * 100).toFixed(1) : '0.0'}%</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtCurrency(totalAcrossYears, true)}</td>
                  <td className="px-4 py-2 text-right text-muted-fg">100.0%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function DrillStat({ label, value, sub, tone = 'primary' }) {
  const toneMap = {
    primary: 'bg-primary/5',
    emerald: 'bg-emerald-50 dark:bg-emerald-950/20',
    rose:    'bg-rose-50 dark:bg-rose-950/20',
    sky:     'bg-sky-50 dark:bg-sky-950/20',
    violet:  'bg-violet-50 dark:bg-violet-950/20',
    amber:   'bg-amber-50 dark:bg-amber-950/20',
  };
  return (
    <div className={cn('rounded-xl border border-border p-3', toneMap[tone])}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-fg">{label}</div>
      <div className="mt-1 text-base font-bold tracking-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-fg">{sub}</div>}
    </div>
  );
}

// ─── insight list card ────────────────────────────────────────────────────────

function InsightList({ title, icon: Icon, accent, items, onPick, valueLabel, headlineYear }) {
  const accentMap = {
    emerald: 'text-emerald-500 bg-emerald-500/10',
    rose:    'text-rose-500    bg-rose-500/10',
    primary: 'text-primary     bg-primary/10',
    amber:   'text-amber-500   bg-amber-500/10',
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0 pb-3">
        <div className={cn('grid h-9 w-9 place-items-center rounded-xl', accentMap[accent])}>
          <Icon size={18} />
        </div>
        <div>
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription className="text-[11px]">{valueLabel}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0 px-3 pb-3">
        {items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-fg">No matches in current data.</p>
        ) : (
          <div className="space-y-1">
            {items.map((row, index) => (
              <button key={row.DeliveryZip}
                onClick={() => onPick(row)}
                className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition hover:bg-muted/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-bold text-muted-fg/60 w-4 tabular-nums">{index + 1}</span>
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold">{row.DeliveryZip}</div>
                    <div className="text-[10px] text-muted-fg truncate max-w-[180px]" title={row.DeliveryCity}>{row.DeliveryCity || '—'}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-semibold tabular-nums">{fmtCurrency(row.headlineRevenue)}</div>
                  {row.percentChangeVsPrior != null && <ChangeIndicator percentChange={row.percentChangeVsPrior} compact />}
                </div>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── performance filter pills ────────────────────────────────────────────────

function PerformanceFilter({ value, onChange, counts }) {
  const buckets = ['all', 'rising', 'growing', 'stable', 'declining', 'falling', 'dormant'];
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1">
      {buckets.map(bucket => {
        const meta = bucket === 'all'
          ? { label: 'Show All',         color: '#6b7280', description: 'No filter' }
          : PERFORMANCE_BUCKETS[bucket];
        const count = bucket === 'all' ? counts.all : (counts[bucket] || 0);
        const isActive = value === bucket;
        return (
          <button key={bucket} onClick={() => onChange(bucket)}
            title={meta.description}
            className={cn(
              'inline-flex items-center gap-1.5 h-7 rounded-md px-2.5 text-xs font-medium transition',
              isActive ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted hover:text-fg',
            )}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: meta.color }} />
            {meta.label}
            <span className={cn('inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums',
              isActive ? 'bg-primary-fg/20' : 'bg-foreground/10')}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── average buying capacity report ───────────────────────────────────────────
// Self-contained: fetches per-zip revenue + order counts and ranks areas (and
// zipcodes) by average spend per order — a proxy for the buying power of each
// market. Higher avg = customers there write bigger tickets.
function AvgBuyingCapacity() {
  const [view, setView] = useState('areas'); // 'areas' | 'zips'
  const q = useSqlQuery(CAPACITY_SQL, []);

  const zips = useMemo(() => {
    const rows = q.data?.rows ?? [];
    return rows.map((r) => {
      const revenue = parseNumber(r.revenue);
      const orders  = parseNumber(r.orders);
      return {
        zip: String(r.Zip || 'Unknown'),
        city: String(r.City || '—'),
        revenue, orders,
        avg: orders > 0 ? revenue / orders : 0,
      };
    });
  }, [q.data]);

  const areas = useMemo(() => {
    const map = new Map();
    for (const z of zips) {
      const primary = (z.city || '').split(',').map((s) => s.trim()).filter(Boolean)[0] || 'Unknown';
      if (!map.has(primary)) map.set(primary, { name: primary, revenue: 0, orders: 0, zipcodes: 0 });
      const a = map.get(primary);
      a.revenue += z.revenue; a.orders += z.orders; a.zipcodes += 1;
    }
    return [...map.values()].map((a) => ({ ...a, avg: a.orders > 0 ? a.revenue / a.orders : 0 }));
  }, [zips]);

  // Team-wide average for context (total revenue / total orders).
  const overall = useMemo(() => {
    let revenue = 0, orders = 0;
    for (const z of zips) { revenue += z.revenue; orders += z.orders; }
    return { avg: orders > 0 ? revenue / orders : 0, orders };
  }, [zips]);

  const list = useMemo(() => {
    const base = view === 'areas' ? areas : zips;
    return [...base].sort((a, b) => b.avg - a.avg);
  }, [view, areas, zips]);

  const maxAvg = Math.max(...list.map((r) => r.avg), 1);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center gap-3 space-y-0">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500">
          <Wallet size={18} />
        </div>
        <div className="min-w-0">
          <CardTitle className="text-sm">Average Buying Capacity · {CURRENT_YEAR}</CardTitle>
          <CardDescription className="text-[11px]">
            Average spend per order by market · store-wide avg {fmtCurrency(overall.avg)} across {fmtNumber(overall.orders)} orders
          </CardDescription>
        </div>
        <div className="ml-auto flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
          <button onClick={() => setView('areas')}
            className={cn('rounded-md px-3 py-1 text-xs font-semibold transition', view === 'areas' ? 'bg-primary text-primary-fg shadow' : 'text-muted-fg hover:text-fg')}>
            Areas
          </button>
          <button onClick={() => setView('zips')}
            className={cn('rounded-md px-3 py-1 text-xs font-semibold transition', view === 'zips' ? 'bg-primary text-primary-fg shadow' : 'text-muted-fg hover:text-fg')}>
            Zipcodes
          </button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {q.isLoading ? (
          <div className="grid place-items-center py-12 text-sm text-muted-fg">
            <div className="flex flex-col items-center gap-3"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading…</div>
          </div>
        ) : list.length === 0 ? (
          <div className="grid place-items-center py-12 text-sm text-muted-fg">No data for {CURRENT_YEAR} yet.</div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60 text-[10px] uppercase tracking-wider text-muted-fg backdrop-blur">
                <tr className="border-b border-border">
                  <th className="px-3 py-2.5 text-left w-9">#</th>
                  <th className="px-3 py-2.5 text-left">{view === 'areas' ? 'Area / City' : 'Zipcode'}</th>
                  <th className="px-3 py-2.5 text-right">Orders</th>
                  <th className="px-3 py-2.5 text-right">Revenue</th>
                  <th className="px-3 py-2.5 text-left w-52">Avg / Order (buying capacity)</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => {
                  const width = (r.avg / maxAvg) * 100;
                  const aboveAvg = r.avg >= overall.avg;
                  return (
                    <tr key={view === 'areas' ? r.name : r.zip} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2.5 tabular-nums text-muted-fg">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        {view === 'areas' ? (
                          <div className="flex flex-col">
                            <span className="font-semibold">{r.name}</span>
                            <span className="text-[10px] text-muted-fg">{fmtNumber(r.zipcodes)} zipcode{r.zipcodes === 1 ? '' : 's'}</span>
                          </div>
                        ) : (
                          <div className="flex flex-col">
                            <span className="font-mono font-semibold">{r.zip}</span>
                            <span className="text-[10px] text-muted-fg truncate max-w-[200px]" title={r.city}>{r.city}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{fmtNumber(r.orders)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{fmtCompactCurrency(r.revenue)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div className={cn('h-full rounded-full bg-gradient-to-r', aboveAvg ? 'from-emerald-500 to-teal-500' : 'from-sky-500 to-cyan-500')}
                              style={{ width: `${width}%` }} />
                          </div>
                          <span className={cn('w-20 shrink-0 text-right font-bold tabular-nums', aboveAvg ? 'text-emerald-600 dark:text-emerald-300' : 'text-fg')}>
                            {fmtCurrency(r.avg)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function ZipAnalysis() {
  const [searchTerm, setSearchTerm]               = useState('');
  const [debouncedSearch, setDebouncedSearch]     = useState('');
  const [performanceFilter, setPerformanceFilter] = useState('all');
  const [drillRow, setDrillRow]                   = useState(null);
  // Area drill-down: when an area (city) is selected, the table shows zips
  // inside that area instead of the full areas list.
  const [selectedArea, setSelectedArea]           = useState(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchTerm.trim()), 250);
    return () => clearTimeout(handle);
  }, [searchTerm]);

  const { data, isLoading, error, refetch } = useSqlQuery(MAIN_SQL, []);
  const areaWeeklyQ = useSqlQuery(AREA_WEEKLY_SQL, []);

  // Per-area best week + best month (current year only). Uppercased / trimmed
  // city is the key so it matches the area `name` regardless of formatting.
  const areaWeeklyStats = useMemo(() => {
    const rows = areaWeeklyQ.data?.rows ?? [];
    if (!rows.length) return new Map();

    // Group rows by city
    const byCity = new Map();
    for (const r of rows) {
      const cityKey = String(r.city || '').trim().toUpperCase();
      if (!cityKey) continue;
      if (!byCity.has(cityKey)) byCity.set(cityKey, []);
      byCity.get(cityKey).push({
        week:      parseNumber(r.week_num),
        month:     parseNumber(r.month_num),
        weekStart: r.week_start,
        revenue:   parseNumber(r.revenue),
      });
    }

    const fmtWeekStart = (raw) => {
      if (!raw) return '';
      const d = new Date(raw);
      if (isNaN(d)) return String(raw);
      // Render in UTC so SQL dates (UTC midnight) don't shift a day back.
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    };

    // For each city: best single week + best month (sum of weeks within month).
    // Also keep the full per-month revenue map so we can drive the
    // "Top 5 Areas · Monthly Trend" chart from the same fetch.
    const out = new Map();
    for (const [city, weeks] of byCity) {
      let bestWeek = null;
      const monthRevs = new Map();
      for (const w of weeks) {
        if (!bestWeek || w.revenue > bestWeek.revenue) {
          bestWeek = { week: w.week, revenue: w.revenue, start: fmtWeekStart(w.weekStart) };
        }
        monthRevs.set(w.month, (monthRevs.get(w.month) || 0) + w.revenue);
      }
      let bestMonth = null;
      for (const [m, rev] of monthRevs) {
        if (!bestMonth || rev > bestMonth.revenue) {
          bestMonth = { month: m, revenue: rev, label: MONTH_SHORT_NAMES[m - 1] || `M${m}` };
        }
      }
      out.set(city, { bestWeek, bestMonth, monthRevs });
    }
    return out;
  }, [areaWeeklyQ.data]);

  // Step 1: parse raw rows into typed numbers.
  const rawRows = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows.map(r => ({
      DeliveryZip:           r.DeliveryZip,
      DeliveryCity:          r.DeliveryCity,
      revenueCurrentYear:    parseNumber(r.CurrentYear),
      revenuePreviousYear:   parseNumber(r.LastYear),
      revenue2YearsAgo:      parseNumber(r.PreviousYear),
      revenue3YearsAgo:      parseNumber(r.Previous),
    }));
  }, [data]);

  // Step 2: figure out which year to use as the headline.
  //
  // We use the current year whenever it has any revenue — even if only a
  // few weeks in. The comparison logic prorates last year to the same
  // calendar period, so partial vs partial is a fair fight. Only fall
  // through to a prior year when the current year is entirely empty.
  const headlineYear = useMemo(() => {
    const totals = {
      [CURRENT_YEAR]:     rawRows.reduce((s, r) => s + r.revenueCurrentYear,  0),
      [CURRENT_YEAR - 1]: rawRows.reduce((s, r) => s + r.revenuePreviousYear, 0),
      [CURRENT_YEAR - 2]: rawRows.reduce((s, r) => s + r.revenue2YearsAgo,    0),
      [CURRENT_YEAR - 3]: rawRows.reduce((s, r) => s + r.revenue3YearsAgo,    0),
    };
    if (totals[CURRENT_YEAR]     > 0) return CURRENT_YEAR;
    if (totals[CURRENT_YEAR - 1] > 0) return CURRENT_YEAR - 1;
    if (totals[CURRENT_YEAR - 2] > 0) return CURRENT_YEAR - 2;
    return CURRENT_YEAR - 3;
  }, [rawRows]);

  // Step 3: enrich each row with derived metrics relative to the headline year.
  //
  // When the headline year is the current (in-progress) year, we want a fair
  // year-over-year comparison: scale last year's full-year revenue down by
  // the fraction of the year that has elapsed so far. So on May 4 (day 124
  // of 365), we compare 2026 YTD against ~34% of full-year 2025.
  //
  // When the headline year is a prior, completed year, we compare full-year
  // to full-year — no proration needed.
  const isHeadlineYearInProgress = headlineYear === CURRENT_YEAR && YEAR_PROGRESS < 0.95;
  const priorScale = isHeadlineYearInProgress ? YEAR_PROGRESS : 1;

  const enriched = useMemo(() => {
    const yearShift = CURRENT_YEAR - headlineYear; // 0, 1, 2, or 3
    return rawRows.map(r => {
      const yearValues = [r.revenueCurrentYear, r.revenuePreviousYear, r.revenue2YearsAgo, r.revenue3YearsAgo];
      const headlineRevenue       = yearValues[yearShift]     ?? 0;
      const priorYearFullRevenue  = yearValues[yearShift + 1] ?? 0;
      // Estimated prior-year revenue for the same calendar period as the
      // headline year. For an in-progress year that's `priorYearFull * progress`.
      const priorYearSamePeriod   = priorYearFullRevenue * priorScale;
      const annualizedProjection  = isHeadlineYearInProgress && headlineRevenue > 0
        ? headlineRevenue / YEAR_PROGRESS
        : null;

      const percentChangeVsPrior = priorYearSamePeriod > 0
        ? ((headlineRevenue - priorYearSamePeriod) / priorYearSamePeriod) * 100
        : null;
      const performanceBucket = classifyPerformance(percentChangeVsPrior, headlineRevenue, priorYearSamePeriod);
      const sizeBucket = classifySize(headlineRevenue);

      return {
        ...r,
        headlineRevenue,
        priorYearFullRevenue,
        priorYearSamePeriod,
        annualizedProjection,
        percentChangeVsPrior,
        performanceBucket,
        sizeBucket,
        // Also expose the legacy field name "priorYearRevenue" so existing
        // call sites keep working — but it now points at the same-period
        // estimate, which is the meaningful comparison value.
        priorYearRevenue: priorYearSamePeriod,
        revenueSeries: [
          { year: CURRENT_YEAR - 3, value: r.revenue3YearsAgo },
          { year: CURRENT_YEAR - 2, value: r.revenue2YearsAgo },
          { year: CURRENT_YEAR - 1, value: r.revenuePreviousYear },
          { year: CURRENT_YEAR,     value: r.revenueCurrentYear },
        ],
      };
    });
  }, [rawRows, headlineYear, isHeadlineYearInProgress, priorScale]);

  // Step 3.5: aggregate zipcodes into areas (by primary city).
  //
  // Each zip's "primary area" is its first city when DeliveryCity contains
  // multiple comma-separated names. We then sum revenue across all zips in
  // each area and recompute trend metrics at the area level so a sales
  // manager can see geography at the city level first, then drill into
  // specific zipcodes.
  const areas = useMemo(() => {
    const areaMap = new Map();

    for (const r of enriched) {
      const cityRaw = r.DeliveryCity || '';
      const primary = cityRaw.split(',').map(s => s.trim()).filter(Boolean)[0] || 'Unknown';
      if (!areaMap.has(primary)) {
        areaMap.set(primary, {
          name: primary,
          zipcodes: [],
          headlineRevenue: 0,
          priorYearSamePeriod: 0,
          priorYearFullRevenue: 0,
          revenue3YearsAgo: 0,
          revenue2YearsAgo: 0,
          revenuePreviousYear: 0,
          revenueCurrentYear: 0,
        });
      }
      const a = areaMap.get(primary);
      a.zipcodes.push(r);
      a.headlineRevenue      += r.headlineRevenue;
      a.priorYearSamePeriod  += r.priorYearSamePeriod;
      a.priorYearFullRevenue += r.priorYearFullRevenue;
      a.revenue3YearsAgo     += r.revenue3YearsAgo;
      a.revenue2YearsAgo     += r.revenue2YearsAgo;
      a.revenuePreviousYear  += r.revenuePreviousYear;
      a.revenueCurrentYear   += r.revenueCurrentYear;
    }

    // Compute area-level trend metrics
    const out = [];
    for (const a of areaMap.values()) {
      const percentChangeVsPrior = a.priorYearSamePeriod > 0
        ? ((a.headlineRevenue - a.priorYearSamePeriod) / a.priorYearSamePeriod) * 100
        : null;
      const performanceBucket = classifyPerformance(percentChangeVsPrior, a.headlineRevenue, a.priorYearSamePeriod);
      const sizeBucket        = classifySize(a.headlineRevenue);
      const annualizedProjection = isHeadlineYearInProgress && a.headlineRevenue > 0
        ? a.headlineRevenue / YEAR_PROGRESS
        : null;
      const activeZipcodeCount = a.zipcodes.filter(z => z.headlineRevenue > 0).length;

      // Per-calendar-week / per-calendar-month averages. We divide by elapsed
      // periods (not "weeks-with-sales") so two areas with the same total
      // revenue but different cadence can still be compared fairly.
      const avgWeeklyThisYear  = a.revenueCurrentYear  / WEEKS_ELAPSED_THIS_YEAR;
      const avgWeeklyLastYear  = a.revenuePreviousYear / WEEKS_LAST_YEAR;
      const avgMonthlyThisYear = a.revenueCurrentYear  / MONTHS_ELAPSED_THIS_YEAR;
      const avgMonthlyLastYear = a.revenuePreviousYear / MONTHS_LAST_YEAR;

      // Lookup best week / best month from the per-area weekly stats.
      const stats     = areaWeeklyStats.get(a.name.toUpperCase().trim()) || {};
      const bestWeek  = stats.bestWeek  || null;
      const bestMonth = stats.bestMonth || null;

      out.push({
        ...a,
        zipcodeCount: a.zipcodes.length,
        activeZipcodeCount,
        percentChangeVsPrior,
        performanceBucket,
        sizeBucket,
        annualizedProjection,
        avgWeeklyThisYear, avgWeeklyLastYear,
        avgMonthlyThisYear, avgMonthlyLastYear,
        bestWeek, bestMonth,
        revenueSeries: [
          { year: CURRENT_YEAR - 3, value: a.revenue3YearsAgo },
          { year: CURRENT_YEAR - 2, value: a.revenue2YearsAgo },
          { year: CURRENT_YEAR - 1, value: a.revenuePreviousYear },
          { year: CURRENT_YEAR,     value: a.revenueCurrentYear },
        ],
      });
    }
    return out;
  }, [enriched, isHeadlineYearInProgress, areaWeeklyStats]);

  // The currently selected area object (or null when in areas view).
  const selectedAreaData = useMemo(
    () => selectedArea ? areas.find(a => a.name === selectedArea) || null : null,
    [areas, selectedArea],
  );

  // Step 4: search + performance filter for the main table.
  // When drilled into an area, only consider zips inside that area.
  const filteredRows = useMemo(() => {
    let rows = selectedAreaData ? selectedAreaData.zipcodes : enriched;
    if (debouncedSearch) {
      const needle = debouncedSearch.toLowerCase();
      rows = rows.filter(r =>
        String(r.DeliveryZip).toLowerCase().includes(needle) ||
        (r.DeliveryCity || '').toLowerCase().includes(needle)
      );
    }
    if (performanceFilter !== 'all') {
      rows = rows.filter(r => r.performanceBucket === performanceFilter);
    }
    return rows;
  }, [enriched, selectedAreaData, debouncedSearch, performanceFilter]);

  // Areas view filter (search + performance applied to the areas list).
  const filteredAreas = useMemo(() => {
    let rows = areas;
    if (debouncedSearch) {
      const needle = debouncedSearch.toLowerCase();
      rows = rows.filter(a => a.name.toLowerCase().includes(needle));
    }
    if (performanceFilter !== 'all') {
      rows = rows.filter(a => a.performanceBucket === performanceFilter);
    }
    return [...rows].sort((a, b) => b.headlineRevenue - a.headlineRevenue);
  }, [areas, debouncedSearch, performanceFilter]);

  // True when we're showing the area-level table (no area selected).
  const isAreasView = !selectedArea;

  // Step 5: aggregate KPIs across all enriched rows.
  const summary = useMemo(() => {
    let totalHeadlineRevenue       = 0;
    let totalPriorYearSamePeriod   = 0;
    let totalPriorYearFullRevenue  = 0;
    let activeZipcodeCount         = 0;
    let topRow                     = null;
    let topRevenue                 = 0;
    for (const r of enriched) {
      totalHeadlineRevenue      += r.headlineRevenue;
      totalPriorYearSamePeriod  += r.priorYearSamePeriod;
      totalPriorYearFullRevenue += r.priorYearFullRevenue;
      if (r.headlineRevenue > 0) activeZipcodeCount++;
      if (r.headlineRevenue > topRevenue) { topRevenue = r.headlineRevenue; topRow = r; }
    }
    const percentChangeVsPrior = totalPriorYearSamePeriod > 0
      ? ((totalHeadlineRevenue - totalPriorYearSamePeriod) / totalPriorYearSamePeriod) * 100
      : null;
    const annualizedProjection = isHeadlineYearInProgress && totalHeadlineRevenue > 0
      ? totalHeadlineRevenue / YEAR_PROGRESS
      : null;

    // Concentration: revenue share of top 10 zipcodes.
    const sortedByRevenue = [...enriched].sort((a, b) => b.headlineRevenue - a.headlineRevenue);
    const top10Revenue = sortedByRevenue.slice(0, 10).reduce((s, r) => s + r.headlineRevenue, 0);
    const top10ConcentrationPercent = totalHeadlineRevenue > 0
      ? (top10Revenue / totalHeadlineRevenue) * 100
      : 0;

    return {
      totalZipcodes: enriched.length,
      activeZipcodeCount,
      totalHeadlineRevenue,
      totalPriorYearSamePeriod,
      totalPriorYearFullRevenue,
      annualizedProjection,
      percentChangeVsPrior,
      topRow,
      topRevenue,
      top10ConcentrationPercent,
    };
  }, [enriched, isHeadlineYearInProgress]);

  // Step 6: counts per performance bucket (for filter pills).
  const performanceCounts = useMemo(() => {
    const out = { all: enriched.length };
    for (const key of Object.keys(PERFORMANCE_BUCKETS)) out[key] = 0;
    for (const r of enriched) out[r.performanceBucket] = (out[r.performanceBucket] || 0) + 1;
    return out;
  }, [enriched]);

  // Step 7: top 10 zipcodes (chart) + insight lists.
  const top10Zipcodes = useMemo(() =>
    [...enriched]
      .filter(r => r.headlineRevenue > 0)
      .sort((a, b) => b.headlineRevenue - a.headlineRevenue)
      .slice(0, 10)
      .map(r => ({ zip: r.DeliveryZip, revenue: r.headlineRevenue, city: r.DeliveryCity }))
  , [enriched]);

  const yearTrend = useMemo(() => {
    const totals = [0, 0, 0, 0];
    for (const r of enriched) {
      totals[0] += r.revenue3YearsAgo;
      totals[1] += r.revenue2YearsAgo;
      totals[2] += r.revenuePreviousYear;
      totals[3] += r.revenueCurrentYear;
    }
    return [
      { year: String(CURRENT_YEAR - 3), revenue: totals[0] },
      { year: String(CURRENT_YEAR - 2), revenue: totals[1] },
      { year: String(CURRENT_YEAR - 1), revenue: totals[2] },
      { year: String(CURRENT_YEAR),     revenue: totals[3] },
    ];
  }, [enriched]);

  // Top 5 areas, broken out month by month for the current year.
  // Each chart row is { month: 'Jan', 'Asheville': 12345, 'Hendersonville': 8902, ... }
  // so Recharts can stack/line them. Months go up to the current month only —
  // we don't pad future months with zeros.
  const topAreasMonthly = useMemo(() => {
    const top5 = [...areas]
      .filter(a => a.headlineRevenue > 0)
      .sort((a, b) => b.headlineRevenue - a.headlineRevenue)
      .slice(0, 5);

    if (!top5.length) return { data: [], areaNames: [] };

    const currentMonthIdx = NOW.getMonth() + 1; // 1..12
    const data = [];
    for (let m = 1; m <= currentMonthIdx; m++) {
      const row = { month: MONTH_SHORT_NAMES[m - 1], _monthNum: m };
      for (const area of top5) {
        const stats = areaWeeklyStats.get(area.name.toUpperCase().trim());
        const rev = stats?.monthRevs?.get(m) ?? 0;
        row[area.name] = rev;
      }
      data.push(row);
    }
    return { data, areaNames: top5.map(a => a.name) };
  }, [areas, areaWeeklyStats]);

  // Revenue size distribution: how many zipcodes fall into each $ bucket.
  const sizeDistribution = useMemo(() => {
    const counts = {};
    const totalRevenueByBucket = {};
    for (const b of SIZE_BUCKETS) { counts[b.id] = 0; totalRevenueByBucket[b.id] = 0; }
    for (const r of enriched) {
      counts[r.sizeBucket] = (counts[r.sizeBucket] || 0) + 1;
      totalRevenueByBucket[r.sizeBucket] = (totalRevenueByBucket[r.sizeBucket] || 0) + r.headlineRevenue;
    }
    return SIZE_BUCKETS.map(b => ({
      id: b.id,
      label: b.label,
      description: b.description,
      color: b.color,
      count: counts[b.id] || 0,
      revenue: totalRevenueByBucket[b.id] || 0,
    }));
  }, [enriched]);

  // Rising stars: real growth — meaningful current revenue plus a non-trivial
  // history (using full-year prior to avoid noise from tiny prorated amounts).
  const risingStarZipcodes = useMemo(() =>
    [...enriched]
      .filter(r =>
        r.percentChangeVsPrior != null &&
        r.percentChangeVsPrior > 20 &&
        r.headlineRevenue > 1000 &&
        r.priorYearFullRevenue > 1000,
      )
      .sort((a, b) => b.percentChangeVsPrior - a.percentChangeVsPrior)
      .slice(0, 6)
  , [enriched]);

  // Declining markets: actual declines — must still have current revenue
  // (otherwise it's "Dormant", not "Declining"). Uses full-year prior as the
  // size threshold so big markets don't get filtered out by proration.
  const decliningMarketZipcodes = useMemo(() =>
    [...enriched]
      .filter(r =>
        r.percentChangeVsPrior != null &&
        r.percentChangeVsPrior < -10 &&
        r.priorYearFullRevenue > 1000 &&
        r.headlineRevenue > 0,
      )
      .sort((a, b) => a.percentChangeVsPrior - b.percentChangeVsPrior)
      .slice(0, 6)
  , [enriched]);

  // Top performers: only positive revenue (negative is refunds, not "top").
  const topPerformerZipcodes = useMemo(() =>
    [...enriched]
      .filter(r => r.headlineRevenue > 0)
      .sort((a, b) => b.headlineRevenue - a.headlineRevenue)
      .slice(0, 6)
  , [enriched]);

  const maxHeadlineRevenue = Math.max(...enriched.map(r => r.headlineRevenue), 1);

  // Step 8: data-table columns.
  const columns = useMemo(() => [
    {
      id: 'zip', accessorFn: r => r.DeliveryZip, header: 'Zipcode',
      cell: ({ getValue, row }) => (
        <button onClick={() => setDrillRow(row.original)}
          className="font-mono text-xs font-semibold text-primary hover:underline" title="Open detailed analysis">
          {getValue()}
        </button>
      ),
    },
    {
      id: 'city', accessorFn: r => r.DeliveryCity, header: 'City',
      cell: ({ getValue }) => <span className="block max-w-[260px] truncate" title={getValue()}>{getValue() || '—'}</span>,
    },
    {
      id: 'performance', accessorFn: r => r.performanceBucket, header: 'Performance',
      cell: ({ getValue }) => <PerformanceBadge bucket={getValue()} />,
    },
    {
      id: 'sparkline', accessorFn: r => r.headlineRevenue, header: '4-Year Trend',
      cell: ({ row }) => {
        const r = row.original;
        const color = PERFORMANCE_BUCKETS[r.performanceBucket]?.color || '#94a3b8';
        return (
          <div className="w-20 h-7"
            title={r.revenueSeries.map(p => `${p.year}: ${fmtCurrency(p.value)}`).join('  ·  ')}>
            <Sparkline data={r.revenueSeries} dataKey="value" color={color} height={28} type="area" />
          </div>
        );
      },
    },
    {
      id: 'headline', accessorFn: r => r.headlineRevenue,
      header: isHeadlineYearInProgress ? `${headlineYear} YTD` : `Revenue ${headlineYear}`,
      cell: ({ getValue }) => {
        const v = getValue();
        const intensity = Math.min(1, v / maxHeadlineRevenue);
        return (
          <span className="num font-bold tabular-nums px-2 py-0.5 rounded-md inline-block"
            style={{ background: `hsl(var(--primary) / ${intensity * 0.18})` }}>
            {fmtCurrency(v)}
          </span>
        );
      },
    },
    {
      id: 'change', accessorFn: r => r.percentChangeVsPrior ?? -Infinity,
      header: isHeadlineYearInProgress ? 'vs Same Period Last Year' : 'Change vs Last Year',
      cell: ({ row }) => <ChangeIndicator percentChange={row.original.percentChangeVsPrior} />,
    },
    {
      id: 'prior',   accessorFn: r => r.priorYearSamePeriod,
      header: isHeadlineYearInProgress
        ? `${headlineYear - 1} Same Period (est.)`
        : `Revenue ${headlineYear - 1}`,
      cell: ({ getValue }) => <span className="tabular-nums text-muted-fg">{fmtCurrency(getValue())}</span>,
    },
    {
      id: 'prior-full', accessorFn: r => r.priorYearFullRevenue,
      header: `${headlineYear - 1} Full Year`,
      cell: ({ getValue }) => <span className="tabular-nums text-muted-fg/70">{fmtCurrency(getValue())}</span>,
    },
    {
      id: 'two-yrs',
      accessorFn: r => {
        const point = r.revenueSeries.find(p => p.year === headlineYear - 2);
        return point ? point.value : 0;
      },
      header: `Revenue ${headlineYear - 2} Full Year`,
      cell: ({ row }) => {
        const point = row.original.revenueSeries.find(p => p.year === headlineYear - 2);
        return <span className="tabular-nums text-muted-fg/70">{fmtCurrency(point?.value ?? 0)}</span>;
      },
    },
  ], [maxHeadlineRevenue, headlineYear, isHeadlineYearInProgress]);

  // Area-level table columns (used when no area is selected — the default view).
  const maxAreaRevenue = Math.max(...areas.map(a => a.headlineRevenue), 1);
  const areaColumns = useMemo(() => [
    {
      id: 'name', accessorFn: r => r.name, header: 'Area / City',
      cell: ({ getValue, row }) => (
        <button onClick={() => setSelectedArea(getValue())}
          className="group inline-flex items-center gap-2 text-left transition" title="Click to view zipcodes inside this area">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 text-white text-[10px] font-bold shrink-0">
            {(getValue() || '?').substring(0, 2).toUpperCase()}
          </span>
          <span className="flex flex-col min-w-0">
            <span className="font-semibold text-sm truncate group-hover:text-primary transition">{getValue() || 'Unknown'}</span>
            <span className="text-[10px] text-muted-fg">{fmtNumber(row.original.zipcodeCount)} zipcodes · {fmtNumber(row.original.activeZipcodeCount)} active</span>
          </span>
        </button>
      ),
    },
    {
      id: 'performance', accessorFn: r => r.performanceBucket, header: 'Performance',
      cell: ({ getValue }) => <PerformanceBadge bucket={getValue()} />,
    },
    {
      id: 'sparkline', accessorFn: r => r.headlineRevenue, header: '4-Year Trend',
      cell: ({ row }) => {
        const a = row.original;
        const color = PERFORMANCE_BUCKETS[a.performanceBucket]?.color || '#94a3b8';
        return (
          <div className="w-24 h-7"
            title={a.revenueSeries.map(p => `${p.year}: ${fmtCurrency(p.value)}`).join('  ·  ')}>
            <Sparkline data={a.revenueSeries} dataKey="value" color={color} height={28} type="area" />
          </div>
        );
      },
    },
    {
      id: 'headline', accessorFn: r => r.headlineRevenue,
      header: isHeadlineYearInProgress ? `${headlineYear} YTD` : `Revenue ${headlineYear}`,
      cell: ({ getValue }) => {
        const v = getValue();
        const intensity = Math.min(1, v / maxAreaRevenue);
        return (
          <span className="num font-bold tabular-nums px-2 py-0.5 rounded-md inline-block"
            style={{ background: `hsl(var(--primary) / ${intensity * 0.22})` }}>
            {fmtCurrency(v)}
          </span>
        );
      },
    },
    {
      id: 'change', accessorFn: r => r.percentChangeVsPrior ?? -Infinity,
      header: isHeadlineYearInProgress ? 'vs Same Period Last Year' : 'Change vs Last Year',
      cell: ({ row }) => <ChangeIndicator percentChange={row.original.percentChangeVsPrior} />,
    },
    {
      id: 'prior', accessorFn: r => r.priorYearSamePeriod,
      header: isHeadlineYearInProgress ? `${headlineYear - 1} Same Period (est.)` : `Revenue ${headlineYear - 1}`,
      cell: ({ getValue }) => <span className="tabular-nums text-muted-fg">{fmtCurrency(getValue())}</span>,
    },
    {
      id: 'weeklyAvg', accessorFn: r => r.avgWeeklyThisYear, header: 'Weekly Avg',
      cell: ({ row }) => {
        const a = row.original;
        const tY  = a.avgWeeklyThisYear;
        const lY  = a.avgWeeklyLastYear;
        const diff = lY > 0 ? ((tY - lY) / lY) * 100 : null;
        return (
          <div className="text-right leading-tight"
            title={`${CURRENT_YEAR}: ${fmtCurrency(tY)}/wk · ${CURRENT_YEAR - 1}: ${fmtCurrency(lY)}/wk`}>
            <div className="text-xs font-semibold tabular-nums text-fg">{fmtCompactCurrency(tY)}</div>
            <div className="text-[10px] tabular-nums text-muted-fg">{fmtCompactCurrency(lY)}</div>
            {diff != null && Math.abs(diff) >= 1 && (
              <div className={cn(
                'text-[10px] font-semibold tabular-nums',
                diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>
                {diff > 0 ? '+' : ''}{diff.toFixed(0)}%
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'monthlyAvg', accessorFn: r => r.avgMonthlyThisYear, header: 'Monthly Avg',
      cell: ({ row }) => {
        const a = row.original;
        const tY  = a.avgMonthlyThisYear;
        const lY  = a.avgMonthlyLastYear;
        const diff = lY > 0 ? ((tY - lY) / lY) * 100 : null;
        return (
          <div className="text-right leading-tight"
            title={`${CURRENT_YEAR}: ${fmtCurrency(tY)}/mo · ${CURRENT_YEAR - 1}: ${fmtCurrency(lY)}/mo`}>
            <div className="text-xs font-semibold tabular-nums text-fg">{fmtCompactCurrency(tY)}</div>
            <div className="text-[10px] tabular-nums text-muted-fg">{fmtCompactCurrency(lY)}</div>
            {diff != null && Math.abs(diff) >= 1 && (
              <div className={cn(
                'text-[10px] font-semibold tabular-nums',
                diff > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>
                {diff > 0 ? '+' : ''}{diff.toFixed(0)}%
              </div>
            )}
          </div>
        );
      },
    },
    {
      id: 'bestWeek', accessorFn: r => r.bestWeek?.revenue ?? 0, header: 'Best Week',
      cell: ({ row }) => {
        const bw = row.original.bestWeek;
        if (!bw || !bw.revenue) return <span className="text-muted-fg text-xs">—</span>;
        return (
          <div className="text-right leading-tight"
            title={`Best week of ${CURRENT_YEAR}: ${fmtCurrency(bw.revenue)} starting ${bw.start}`}>
            <div className="text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
              {fmtCompactCurrency(bw.revenue)}
            </div>
            <div className="text-[10px] text-muted-fg">
              Wk {bw.week}{bw.start ? ` · ${bw.start}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      id: 'bestMonth', accessorFn: r => r.bestMonth?.revenue ?? 0, header: 'Best Month',
      cell: ({ row }) => {
        const bm = row.original.bestMonth;
        if (!bm || !bm.revenue) return <span className="text-muted-fg text-xs">—</span>;
        return (
          <div className="text-right leading-tight"
            title={`Best month of ${CURRENT_YEAR}: ${fmtCurrency(bm.revenue)} in ${bm.label}`}>
            <div className="text-xs font-semibold tabular-nums text-violet-700 dark:text-violet-400">
              {fmtCompactCurrency(bm.revenue)}
            </div>
            <div className="text-[10px] text-muted-fg">{bm.label}</div>
          </div>
        );
      },
    },
    {
      id: 'drill', accessorFn: r => r.zipcodeCount, header: '',
      cell: ({ row }) => (
        <button onClick={() => setSelectedArea(row.original.name)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:gap-2 transition-all">
          View Zipcodes <ChevronRight size={14} />
        </button>
      ),
    },
  ], [maxAreaRevenue, headlineYear, isHeadlineYearInProgress]);

  const subtitle = isHeadlineYearInProgress
    ? `${fmtNumber(summary.activeZipcodeCount)} active zipcodes · ${fmtCurrency(summary.totalHeadlineRevenue)} year-to-date · ${
        summary.percentChangeVsPrior != null
          ? `${summary.percentChangeVsPrior > 0 ? '+' : ''}${summary.percentChangeVsPrior.toFixed(1)}% vs same period in ${headlineYear - 1}`
          : `same period ${headlineYear - 1} unavailable`
      }`
    : `${fmtNumber(summary.activeZipcodeCount)} active zipcodes · ${fmtCurrency(summary.totalHeadlineRevenue)} in ${headlineYear}${
        summary.percentChangeVsPrior != null
          ? ` · ${summary.percentChangeVsPrior > 0 ? '+' : ''}${summary.percentChangeVsPrior.toFixed(1)}% vs ${headlineYear - 1}`
          : ''
      }`;

  // Pick the gradient and palette key for the change indicator.
  const changeAccent = summary.percentChangeVsPrior == null   ? 'sky'
                     : summary.percentChangeVsPrior >= 5      ? 'emerald'
                     : summary.percentChangeVsPrior >= -5     ? 'amber'
                     : 'rose';

  return (
    <>
      <Topbar title="Zipcode Analysis" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ── hero banner ── */}
        <HeroBanner icon={Globe2} decorIcon={MapIcon} accent="primary">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">
            {isHeadlineYearInProgress ? `${headlineYear} Revenue · Year-to-Date` : `${headlineYear} Total Revenue`}
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-blue-600 to-violet-500 bg-clip-text text-transparent">
              {fmtCompactCurrency(summary.totalHeadlineRevenue)}
            </span>
            {summary.percentChangeVsPrior != null && (
              <span className={cn(
                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md',
                summary.percentChangeVsPrior >= 0
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white'
                  : 'bg-gradient-to-br from-rose-500 to-orange-500 text-white',
              )}>
                {summary.percentChangeVsPrior >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {summary.percentChangeVsPrior > 0 ? '+' : ''}{summary.percentChangeVsPrior.toFixed(1)}%
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            Across <strong className="text-fg">{fmtNumber(areas.length)}</strong> areas / <strong className="text-fg">{fmtNumber(summary.activeZipcodeCount)}</strong> active zipcodes
            {isHeadlineYearInProgress && <> · projected <strong className="text-fg">{fmtCompactCurrency(summary.annualizedProjection)}</strong> year-end</>}
          </div>
        </HeroBanner>

        {/* ── eye-catching hero stats ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label={isHeadlineYearInProgress ? `Revenue YTD` : `Revenue ${headlineYear}`}
            value={fmtCompactCurrency(summary.totalHeadlineRevenue)}
            fullValue={fmtCurrency(summary.totalHeadlineRevenue)}
            icon={DollarSign}
            accent="primary"
            subtitle={isHeadlineYearInProgress
              ? `${fmtCurrency(summary.totalHeadlineRevenue)} through ${TODAY_FORMATTED}`
              : `${fmtCurrency(summary.totalHeadlineRevenue)} full-year total`}
            sparkline={yearTrend.map(p => ({ value: p.revenue }))}
            loading={isLoading}
          />
          <HeroStat
            label={isHeadlineYearInProgress ? `vs Same Period ${headlineYear - 1}` : `Change vs ${headlineYear - 1}`}
            value={summary.percentChangeVsPrior != null
              ? `${summary.percentChangeVsPrior > 0 ? '+' : ''}${summary.percentChangeVsPrior.toFixed(1)}%`
              : '—'}
            icon={(summary.percentChangeVsPrior ?? 0) >= 0 ? TrendingUp : TrendingDown}
            accent={changeAccent}
            urgent={changeAccent === 'rose'}
            subtitle={summary.totalPriorYearSamePeriod
              ? (isHeadlineYearInProgress
                  ? `${fmtCompactCurrency(summary.totalPriorYearSamePeriod)} through ${TODAY_FORMATTED} (est.)`
                  : `${fmtCompactCurrency(summary.totalPriorYearSamePeriod)} last year`)
              : null}
            loading={isLoading}
          />
          {isHeadlineYearInProgress ? (
            <HeroStat
              label="Projected Year-End"
              value={summary.annualizedProjection ? fmtCompactCurrency(summary.annualizedProjection) : '—'}
              fullValue={summary.annualizedProjection ? fmtCurrency(summary.annualizedProjection) : null}
              icon={Target}
              accent="violet"
              subtitle={summary.annualizedProjection && summary.totalPriorYearFullRevenue
                ? `${fmtCurrency(summary.annualizedProjection)} · vs ${fmtCompactCurrency(summary.totalPriorYearFullRevenue)} last year`
                : 'Annualised pace'}
              loading={isLoading}
            />
          ) : (
            <HeroStat
              label="Active Zipcodes"
              value={fmtNumber(summary.activeZipcodeCount)}
              icon={MapPin}
              accent="violet"
              subtitle={summary.totalZipcodes
                ? `${fmtNumber(summary.totalZipcodes - summary.activeZipcodeCount)} dormant`
                : null}
              loading={isLoading}
            />
          )}
          <HeroStat
            label="Top 10 Revenue Share"
            value={`${summary.top10ConcentrationPercent.toFixed(1)}%`}
            icon={summary.top10ConcentrationPercent > 60 ? Sparkles : Target}
            accent={summary.top10ConcentrationPercent > 60 ? 'rose' : summary.top10ConcentrationPercent > 40 ? 'amber' : 'emerald'}
            subtitle={summary.topRow ? `#1 · ${summary.topRow.DeliveryZip} (${fmtCompactCurrency(summary.topRevenue)})` : null}
            loading={isLoading}
          />
        </div>

        {/* ── methodology note ── */}
        {isHeadlineYearInProgress && (
          <div className="-mt-2 flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 dark:bg-sky-950/30 dark:border-sky-900/60 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">
            <span className="font-semibold">Year-to-date comparison:</span>
            <span className="text-sky-700 dark:text-sky-300/80">
              {headlineYear} runs Jan 1 → {TODAY_FORMATTED} ({DAY_OF_YEAR} days, {(YEAR_PROGRESS * 100).toFixed(1)}% of the year).
              {' '}{headlineYear - 1} totals are prorated to the same window for a fair like-for-like comparison.
            </span>
          </div>
        )}

        {/* ── top-5 areas monthly trend + revenue distribution by size ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Top 5 Areas · Monthly Trend</CardTitle>
              <CardDescription>
                Monthly revenue for the five largest areas in {CURRENT_YEAR}
                {topAreasMonthly.areaNames.length > 0 && (
                  <> · {topAreasMonthly.areaNames.slice(0, 3).join(', ')}{topAreasMonthly.areaNames.length > 3 ? '…' : ''}</>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div style={{ height: 260 }}>
                {topAreasMonthly.data.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-fg">
                    {areaWeeklyQ.isLoading ? 'Loading monthly area data…' : 'No monthly data yet.'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={topAreasMonthly.data} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="month" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                      <YAxis tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                        tickFormatter={v => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
                      <RechartsTooltip formatter={(v) => fmtCurrency(v, true)}
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                      <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} iconType="circle" />
                      {topAreasMonthly.areaNames.map((areaName, i) => {
                        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];
                        return (
                          <Line key={areaName}
                            type="monotone"
                            dataKey={areaName}
                            stroke={colors[i % colors.length]}
                            strokeWidth={2.25}
                            dot={{ r: 3, fill: colors[i % colors.length], strokeWidth: 0 }}
                            activeDot={{ r: 5 }} />
                        );
                      })}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Revenue Distribution by Size</CardTitle>
              <CardDescription>How many zipcodes fall into each revenue tier in {headlineYear}</CardDescription>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="space-y-2.5">
                {sizeDistribution.map(bucket => {
                  const totalRows = enriched.length || 1;
                  const widthPercent = (bucket.count / totalRows) * 100;
                  return (
                    <div key={bucket.id} className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: bucket.color }} />
                          <span className="text-xs font-semibold truncate">{bucket.label}</span>
                        </div>
                        <span className="text-xs font-bold tabular-nums shrink-0">{fmtNumber(bucket.count)}</span>
                      </div>
                      <div className="text-[10px] text-muted-fg pl-4.5 ml-0.5">{bucket.description}</div>
                      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                        <div className="absolute inset-y-0 left-0 rounded-full transition-all"
                          style={{ width: `${widthPercent}%`, background: bucket.color }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-fg pt-0.5">
                        <span>{widthPercent.toFixed(1)}% of zipcodes</span>
                        <span className="tabular-nums">{fmtCurrency(bucket.revenue)} total</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── average buying capacity by area / zipcode ── */}
        <AvgBuyingCapacity />

        {/* ── top 10 zipcodes by revenue ── */}
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Zipcodes by Revenue · {headlineYear}</CardTitle>
            <CardDescription>Click a bar to open the detailed breakdown for that zipcode</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={top10Zipcodes} layout="vertical" margin={{ top: 8, right: 24, left: 16, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                    tickFormatter={v => v >= 1_000_000 ? `$${(v/1_000_000).toFixed(1)}M` : v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${v}`} />
                  <YAxis type="category" dataKey="zip" width={70}
                    tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11, fontFamily: 'ui-monospace, monospace' }} />
                  <RechartsTooltip formatter={(v) => fmtCurrency(v, true)}
                    labelFormatter={(z) => {
                      const r = top10Zipcodes.find(t => t.zip === z);
                      return r ? `${r.zip} · ${r.city}` : z;
                    }}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} cursor="pointer"
                    onClick={(d) => {
                      const r = enriched.find(e => e.DeliveryZip === d?.zip);
                      if (r) setDrillRow(r);
                    }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* ── insight lists ── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <InsightList
            title="Top Performers"
            valueLabel={`Highest revenue in ${headlineYear}`}
            icon={Building2}
            accent="primary"
            items={topPerformerZipcodes}
            onPick={setDrillRow}
            headlineYear={headlineYear}
          />
          <InsightList
            title="Rising Stars"
            valueLabel="Biggest gains over last year (more than 20%)"
            icon={Sparkles}
            accent="emerald"
            items={risingStarZipcodes}
            onPick={setDrillRow}
            headlineYear={headlineYear}
          />
          <InsightList
            title="Declining Markets"
            valueLabel="Biggest drops over last year (more than 10%)"
            icon={TrendingDown}
            accent="rose"
            items={decliningMarketZipcodes}
            onPick={setDrillRow}
            headlineYear={headlineYear}
          />
        </div>

        {/* ── search + filter + table (area drill-down) ── */}
        <Card className="overflow-hidden">
          <CardHeader className={cn(
            isAreasView
              ? 'bg-gradient-to-r from-blue-500/10 via-violet-500/5 to-transparent border-b border-border'
              : 'bg-gradient-to-r from-emerald-500/10 via-sky-500/5 to-transparent border-b border-border'
          )}>
            {/* Breadcrumb */}
            <nav className="flex items-center gap-1 text-xs text-muted-fg mb-2">
              <button onClick={() => setSelectedArea(null)}
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 transition',
                  isAreasView ? 'font-semibold text-fg' : 'hover:bg-muted hover:text-fg',
                )}>
                <Layers size={12} /> Areas
              </button>
              {selectedArea && (
                <>
                  <ChevronRight size={12} className="text-muted-fg/50" />
                  <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-fg">
                    <MapPin size={12} /> {selectedArea}
                  </span>
                </>
              )}
            </nav>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className={cn(
                  'grid h-10 w-10 place-items-center rounded-xl text-white shadow-md ring-2',
                  isAreasView
                    ? 'bg-gradient-to-br from-blue-500 to-violet-500 ring-blue-500/20'
                    : 'bg-gradient-to-br from-emerald-500 to-sky-500 ring-emerald-500/20',
                )}>
                  {isAreasView ? <Layers size={20} /> : <MapPin size={20} />}
                </div>
                <div>
                  <CardTitle className="text-base">
                    {isAreasView
                      ? 'Areas Overview'
                      : `Zipcodes in ${selectedArea}`}
                  </CardTitle>
                  <CardDescription>
                    {isLoading ? 'Loading…'
                      : error ? <span className="text-rose-500">{error.message}</span>
                      : isAreasView
                        ? <>Showing <span className="font-semibold text-fg">{fmtNumber(filteredAreas.length)}</span> of {fmtNumber(areas.length)} areas · Weekly Avg &amp; Monthly Avg show <strong className="text-fg">{CURRENT_YEAR}</strong> on top, <strong className="text-fg">{CURRENT_YEAR - 1}</strong> below · Best Week / Best Month are {CURRENT_YEAR} highs · click an area to drill into its zipcodes</>
                        : <>Showing <span className="font-semibold text-fg">{fmtNumber(filteredRows.length)}</span> of {fmtNumber(selectedAreaData?.zipcodes.length ?? 0)} zipcodes in this area · {fmtCurrency(selectedAreaData?.headlineRevenue ?? 0)} total {isHeadlineYearInProgress ? 'YTD' : ''}</>}
                    {(debouncedSearch || performanceFilter !== 'all') &&
                      <button onClick={() => { setSearchTerm(''); setPerformanceFilter('all'); }}
                        className="ml-2 text-xs text-primary hover:underline">Clear filters</button>}
                  </CardDescription>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!isAreasView && (
                  <Button variant="outline" size="sm" onClick={() => setSelectedArea(null)}>
                    <ArrowLeft size={14} /> Back to Areas
                  </Button>
                )}
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
                  <Input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    placeholder={isAreasView ? 'Search area / city…' : 'Search zipcode or city…'} className="pl-8 w-56" />
                </div>
                <Button variant="outline" size="sm"
                  onClick={() => rowsToCSV(isAreasView ? filteredAreas : filteredRows, isAreasView ? 'areas.csv' : `zipcodes-${selectedArea}.csv`)}
                  disabled={(isAreasView ? !filteredAreas.length : !filteredRows.length)}>
                  <Download size={14} /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={() => refetch()}>
                  <RefreshCw size={14} />
                </Button>
              </div>
            </div>
            <div className="mt-3">
              <PerformanceFilter value={performanceFilter} onChange={setPerformanceFilter} counts={performanceCounts} />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isAreasView ? (
              <DataTable
                data={filteredAreas}
                columns={areaColumns}
                loading={isLoading}
                pageSize={10}
                emptyText={error ? `Error: ${error.message}` : 'No areas match your filters.'}
              />
            ) : (
              <DataTable
                data={filteredRows}
                columns={columns}
                loading={isLoading}
                pageSize={10}
                emptyText={error ? `Error: ${error.message}` : 'No zipcodes match your filters.'}
              />
            )}
          </CardContent>
        </Card>
      </div>

      <ZipDrillDown row={drillRow} onClose={() => setDrillRow(null)} headlineYear={headlineYear} />
    </>
  );
}
