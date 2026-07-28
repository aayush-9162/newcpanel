// Service Order — modernized service-order tracker.
//
// One MySQL query loads every open service order (joined with service_remarks),
// and seven client-side tabs filter that set: All Open · Pending Scheduling ·
// Parts Awaited · Scheduled · Waiting Updates. Two more tabs query the
// `svc_need_attention` table directly. The Closed Sales tab is fetched on
// demand with a quarter filter.
import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Wrench, Clock, Package, CalendarCheck, AlertTriangle, Bell, CheckCircle2,
  Search, Download, RefreshCw, X, Hourglass, Cog, Settings, Activity,
  LayoutDashboard, Inbox, Phone, MapPin, Boxes, ChevronRight, ArrowRight,
  Zap, Gauge,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useMysqlQuery } from '@/lib/api';
import { fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';

// ─── helpers ──────────────────────────────────────────────────────────────────

function parseNumber(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function pick(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    const lo = k.toLowerCase(); if (row[lo] != null) return row[lo];
    const up = k.toUpperCase(); if (row[up] != null) return row[up];
  }
  return undefined;
}

function fmtDate(v) {
  if (!v) return '—';
  if (typeof v === 'string' && v.toUpperCase() === 'ASAP') return v;
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function fmtPhone(v) {
  if (!v) return '';
  const digits = String(v).replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return v;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const OPEN_SVC_SQL = `
  SELECT
    DATE_FORMAT(s.saledate, '%Y-%m-%d')                                            AS service_date,
    s.salesno                                                                      AS sales_no,
    CAST(s.customerid AS SIGNED)                                                   AS cust_id,
    s.customername                                                                 AS customer_name,
    s.customerphone                                                                AS contact,
    s.deliverycity                                                                 AS city,
    s.deliverystate                                                                AS state,
    s.deliveryzip                                                                  AS zip,
    s.deliverydate                                                                 AS delivery_date_raw,
    COALESCE(DATE_FORMAT(STR_TO_DATE(s.deliverydate, '%Y-%m-%d'), '%Y-%m-%d'),
             'ASAP')                                                               AS delivery_date,
    s.readystatus                                                                  AS ready_status,
    s.salesperson                                                                  AS sales_person,
    s.age                                                                          AS age,
    s.saleremarks                                                                  AS rv_remarks,
    r.remark                                                                       AS service_remark
  FROM salesopendaily s
  LEFT JOIN service_remarks r ON r.salesno = s.salesno
  WHERE s.service = 1 AND s.sale_open_close = 'OPEN'
  ORDER BY s.saledate
`;

const CLOSED_SALES_SQL = `
  SELECT
    DATE_FORMAT(s.saledate, '%Y-%m-%d')                                            AS service_date,
    s.salesno                                                                      AS sales_no,
    CAST(s.customerid AS SIGNED)                                                   AS cust_id,
    s.customername                                                                 AS customer_name,
    s.customerphone                                                                AS contact,
    s.deliverycity                                                                 AS city,
    s.deliverystate                                                                AS state,
    s.deliveryzip                                                                  AS zip,
    s.deliverydate                                                                 AS delivery_date_raw,
    COALESCE(DATE_FORMAT(STR_TO_DATE(s.deliverydate, '%Y-%m-%d'), '%Y-%m-%d'),
             'ASAP')                                                               AS delivery_date,
    s.readystatus                                                                  AS ready_status,
    s.salesperson                                                                  AS sales_person,
    s.age                                                                          AS age,
    s.saleremarks                                                                  AS rv_remarks,
    r.remark                                                                       AS service_remark
  FROM salesopendaily s
  LEFT JOIN service_remarks r ON r.salesno = s.salesno
  WHERE s.service = 0 AND s.sale_open_close = 'CLOSED'
    AND s.saledate >= ? AND s.saledate < ?
  ORDER BY s.saledate DESC
`;

const NEED_ATTN_SQL = `
  SELECT *
  FROM svc_need_attention
  WHERE is_resolved = ?
  ORDER BY id DESC
`;

// ─── tab classification ───────────────────────────────────────────────────────

function isPendingScheduling(r) {
  const dd = (pick(r, 'delivery_date', 'delivery_date_raw') || '').toString().toUpperCase();
  const ready = (pick(r, 'ready_status') || '').toString().toLowerCase();
  return dd === 'ASAP' && ready === 'full';
}

function isPartsAwaited(r) {
  const ready = (pick(r, 'ready_status') || '').toString();
  return ready === 'Partial' || ready === 'None';
}

function isScheduled(r) {
  const dd = (pick(r, 'delivery_date_raw') || '').toString();
  const ready = (pick(r, 'ready_status') || '').toString().toLowerCase();
  if (dd.toUpperCase() === 'ASAP' || !dd) return false;
  if (ready !== 'full') return false;
  return dd >= todayISO();
}

function isWaitingUpdates(r) {
  const dd = (pick(r, 'delivery_date_raw') || '').toString();
  if (!dd || dd.toUpperCase() === 'ASAP') return false;
  return dd < todayISO();
}

// ─── aging buckets ────────────────────────────────────────────────────────────

const AGING_BUCKETS = [
  { id: '0-30',   label: '0–30 Days',   min: 0,   max: 30,  color: '#22c55e', accent: 'emerald' },
  { id: '31-60',  label: '31–60 Days',  min: 31,  max: 60,  color: '#06b6d4', accent: 'sky'     },
  { id: '61-90',  label: '61–90 Days',  min: 61,  max: 90,  color: '#f59e0b', accent: 'amber'   },
  { id: '91-180', label: '91–180 Days', min: 91,  max: 180, color: '#ef4444', accent: 'rose'    },
  { id: '180+',   label: '180+ Days',   min: 181, max: null,color: '#71717a', accent: 'slate'   },
];

function ageBucketFor(age) {
  for (const b of AGING_BUCKETS) {
    if (b.max == null && age >= b.min) return b.id;
    if (age >= b.min && age <= b.max) return b.id;
  }
  return null;
}

// ─── tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'summary',     label: 'Summary',          group: 'overview', icon: LayoutDashboard },
  { id: 'openso',      label: 'All Open',         group: 'active',   icon: Inbox,         filter: () => true },
  { id: 'pending',     label: 'Pending Schedule', group: 'active',   icon: Clock,         filter: isPendingScheduling },
  { id: 'partsawaited',label: 'Parts Awaited',    group: 'active',   icon: Package,       filter: isPartsAwaited },
  { id: 'scheduled',   label: 'Scheduled',        group: 'active',   icon: CalendarCheck, filter: isScheduled },
  { id: 'updates',     label: 'Waiting Updates',  group: 'active',   icon: AlertTriangle, filter: isWaitingUpdates },
  { id: 'closedso',    label: 'Closed Sales',     group: 'closed',   icon: CheckCircle2 },
  { id: 'attention',   label: 'Needs Attention',  group: 'closed',   icon: Bell },
  { id: 'rslvattention', label: 'Resolved Attn.', group: 'closed',   icon: CheckCircle2 },
];

const GROUPS = [
  { id: 'overview', label: null,            icon: null },
  { id: 'active',   label: 'ACTIVE ORDERS', icon: Wrench },
  { id: 'closed',   label: 'CLOSED & REF',  icon: CheckCircle2 },
];

// ─── tab nav components ───────────────────────────────────────────────────────

function Tab({ active, onClick, icon: Icon, label, count }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition outline-none',
        active
          ? 'bg-primary text-primary-fg shadow-sm shadow-primary/20'
          : 'text-muted-fg hover:bg-muted hover:text-fg',
      )}>
      {Icon && <Icon size={14} className={active ? 'opacity-90' : 'opacity-70'} />}
      <span>{label}</span>
      {count != null && (
        <span className={cn(
          'inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums',
          active ? 'bg-primary-fg/25 text-primary-fg' : 'bg-foreground/10 text-foreground/70',
        )}>{count}</span>
      )}
    </button>
  );
}

function TabsNav({ tab, setTab, tabCounts }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
        {GROUPS.map((g, gi) => {
          const groupTabs = TABS.filter(t => t.group === g.id);
          if (!groupTabs.length) return null;
          return (
            <div key={g.id} className="flex items-center gap-1">
              {gi > 0 && <div className="h-6 w-px bg-border/80 mx-1" />}
              {g.label && (
                <span className="inline-flex items-center gap-1 px-2 select-none">
                  {g.icon && <g.icon size={11} className="text-muted-fg/50" />}
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-fg/60">{g.label}</span>
                </span>
              )}
              {groupTabs.map(t => (
                <Tab
                  key={t.id}
                  active={tab === t.id}
                  onClick={() => setTab(t.id)}
                  icon={t.icon}
                  label={t.label}
                  count={t.id === 'summary' ? null : tabCounts[t.id]}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ready-status badge ───────────────────────────────────────────────────────

function ReadyBadge({ value }) {
  if (!value) return <span className="text-muted-fg">—</span>;
  const v = String(value).toLowerCase();
  const tone = v === 'full' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
             : v === 'partial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
             : v === 'none' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200'
             : 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-200';
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium', tone)}>{value}</span>;
}

function AgeBadge({ age }) {
  if (age == null) return <span className="text-muted-fg">—</span>;
  const bucket = AGING_BUCKETS.find(b => ageBucketFor(age) === b.id);
  const tone = bucket?.accent === 'emerald' ? 'text-emerald-600 dark:text-emerald-400'
             : bucket?.accent === 'sky'     ? 'text-sky-600 dark:text-sky-400'
             : bucket?.accent === 'amber'   ? 'text-amber-600 dark:text-amber-400'
             : bucket?.accent === 'rose'    ? 'text-rose-600 dark:text-rose-400'
             : 'text-slate-600 dark:text-slate-400';
  return <span className={cn('text-xs font-bold tabular-nums', tone)}>{age}d</span>;
}

// ─── main page ────────────────────────────────────────────────────────────────

const QUARTER_OPTIONS = (() => {
  // Last 6 quarters (3-month windows) ending now.
  const out = [];
  const now = new Date();
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for (let i = 0; i < 6; i++) {
    const startOffset = (i + 1) * 3;
    const endOffset   = i * 3;
    const start = new Date(now.getFullYear(), now.getMonth() - startOffset + 1, 1);
    const end   = new Date(now.getFullYear(), now.getMonth() - endOffset   + 1, 1);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-01`;
    const endStr   = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-01`;
    const endLabelMonth = end.getMonth() === 0 ? 11 : end.getMonth() - 1;
    const endLabelYear  = end.getMonth() === 0 ? end.getFullYear() - 1 : end.getFullYear();
    const label = `${months[start.getMonth()]} ${start.getFullYear()} – ${months[endLabelMonth]} ${endLabelYear}`;
    out.push({ value: `${startStr}|${endStr}`, label });
  }
  return out;
})();

export default function ServiceOrderNew() {
  const [tab, setTab]         = useState('summary');
  const [search, setSearch]   = useState('');
  const [debounced, setDeb]   = useState('');
  const [quarter, setQuarter] = useState(QUARTER_OPTIONS[0].value);

  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['mysql'] });

  useEffect(() => {
    const t = setTimeout(() => setDeb(search.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // ── data fetching ──────────────────────────────────────────────────────────

  // All open service orders — drives Summary + the 5 active tabs (client-side filtered).
  const openQ = useMysqlQuery(OPEN_SVC_SQL, []);
  const openRows = useMemo(() => openQ.data?.rows ?? [], [openQ.data]);

  // Closed sales — only fetched when on that tab.
  const [qStart, qEnd] = quarter.split('|');
  const closedQ = useMysqlQuery(CLOSED_SALES_SQL, [qStart, qEnd], { enabled: tab === 'closedso' });
  const closedRows = useMemo(() => closedQ.data?.rows ?? [], [closedQ.data]);

  // Need-attention queries — fetched on demand.
  const attnOpenQ     = useMysqlQuery(NEED_ATTN_SQL, [0], { enabled: tab === 'attention' });
  const attnResolvedQ = useMysqlQuery(NEED_ATTN_SQL, [1], { enabled: tab === 'rslvattention' });

  // ── KPIs derived from openRows ─────────────────────────────────────────────

  const kpi = useMemo(() => {
    const counts = { 'pending': 0, 'partsawaited': 0, 'scheduled': 0, 'updates': 0 };
    const aging = Object.fromEntries(AGING_BUCKETS.map(b => [b.id, 0]));
    let totalAge = 0;
    let oldest = 0;
    for (const r of openRows) {
      if (isPendingScheduling(r)) counts.pending++;
      if (isPartsAwaited(r))      counts.partsawaited++;
      if (isScheduled(r))         counts.scheduled++;
      if (isWaitingUpdates(r))    counts.updates++;
      const age = parseNumber(pick(r, 'age'));
      totalAge += age;
      if (age > oldest) oldest = age;
      const bucket = ageBucketFor(age);
      if (bucket) aging[bucket]++;
    }
    return {
      total: openRows.length,
      avgAge: openRows.length ? totalAge / openRows.length : 0,
      oldest,
      counts,
      aging,
    };
  }, [openRows]);

  // Tab counts for the badges.
  const tabCounts = {
    openso:        kpi.total,
    pending:       kpi.counts.pending,
    partsawaited:  kpi.counts.partsawaited,
    scheduled:     kpi.counts.scheduled,
    updates:       kpi.counts.updates,
    closedso:      tab === 'closedso' ? closedRows.length : null,
    attention:     tab === 'attention' ? (attnOpenQ.data?.rows?.length ?? 0) : null,
    rslvattention: tab === 'rslvattention' ? (attnResolvedQ.data?.rows?.length ?? 0) : null,
  };

  // ── filter rows for current tab ────────────────────────────────────────────

  const { rows, columns, loading, error, emptyText } = useMemo(() => {
    let rows = [], columns = [], loading = false, error = null, emptyText = 'No records.';
    switch (tab) {
      case 'openso':
        rows = openRows; loading = openQ.isLoading; error = openQ.error;
        columns = makeServiceColumns({ highlightDelivery: true });
        emptyText = 'No open service orders.'; break;
      case 'pending':
        rows = openRows.filter(isPendingScheduling); loading = openQ.isLoading;
        columns = makeServiceColumns(); emptyText = 'Nothing pending scheduling.'; break;
      case 'partsawaited':
        rows = openRows.filter(isPartsAwaited); loading = openQ.isLoading;
        columns = makeServiceColumns(); emptyText = 'No parts awaited.'; break;
      case 'scheduled':
        rows = openRows.filter(isScheduled); loading = openQ.isLoading;
        columns = makeServiceColumns({ highlightDelivery: true }); emptyText = 'Nothing scheduled.'; break;
      case 'updates':
        rows = openRows.filter(isWaitingUpdates); loading = openQ.isLoading;
        columns = makeServiceColumns({ highlightOverdue: true }); emptyText = 'Nothing waiting updates.'; break;
      case 'closedso':
        rows = closedRows; loading = closedQ.isLoading; error = closedQ.error;
        columns = makeServiceColumns({ closed: true }); emptyText = 'No closed sales in this period.'; break;
      case 'attention':
        rows = attnOpenQ.data?.rows ?? []; loading = attnOpenQ.isLoading; error = attnOpenQ.error;
        columns = makeAttentionColumns(); emptyText = 'No open attention items.'; break;
      case 'rslvattention':
        rows = attnResolvedQ.data?.rows ?? []; loading = attnResolvedQ.isLoading; error = attnResolvedQ.error;
        columns = makeAttentionColumns(); emptyText = 'No resolved attention items.'; break;
      default: break;
    }
    if (debounced) {
      rows = rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(debounced)));
    }
    return { rows, columns, loading, error, emptyText };
  // eslint-disable-next-line
  }, [tab, debounced, openRows, closedRows, openQ.isLoading, closedQ.isLoading,
      openQ.error, closedQ.error, attnOpenQ.data, attnOpenQ.isLoading, attnOpenQ.error,
      attnResolvedQ.data, attnResolvedQ.isLoading, attnResolvedQ.error]);

  const subtitle = `${fmtNumber(kpi.total)} open service orders · avg age ${kpi.avgAge.toFixed(0)}d · oldest ${kpi.oldest}d`;

  return (
    <>
      <Topbar title="Service Order" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ── distinctive dark service-ops hero ── */}
        <ServiceHero kpi={kpi} loading={openQ.isLoading} />

        {/* ── service pipeline (horizontal flow) ── */}
        <ServicePipeline kpi={kpi} setTab={setTab} loading={openQ.isLoading} />

        {/* ── aging timeline (single stacked bar) ── */}
        <AgingTimeline aging={kpi.aging} total={kpi.total} loading={openQ.isLoading} setTab={setTab} />

        {/* ── tabs ── */}
        <TabsNav tab={tab} setTab={setTab} tabCounts={tabCounts} />

        {/* ── filter bar ── */}
        {tab !== 'summary' && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by Sale #, customer, contact, city, sales person…" className="pl-8" />
              </div>

              {tab === 'closedso' && (
                <>
                  <span className="text-xs uppercase tracking-wider text-muted-fg">Period</span>
                  <select value={quarter} onChange={e => setQuarter(e.target.value)}
                    className="rounded-lg border-2 border-amber-500/50 bg-card px-3 py-1.5 text-sm font-medium outline-none focus:ring-2 focus:ring-amber-500/20">
                    {QUARTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </>
              )}

              {debounced && (
                <button onClick={() => setSearch('')}
                  className="text-xs text-primary hover:underline">Clear</button>
              )}

              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm"
                  onClick={() => rowsToCSV(rows, `service-${tab}.csv`)} disabled={!rows.length}>
                  <Download size={14} /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={refresh}>
                  <RefreshCw size={14} />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── content ── */}
        {tab === 'summary' ? (
          <SummaryView kpi={kpi} setTab={setTab} loading={openQ.isLoading} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{TABS.find(t => t.id === tab)?.label}</CardTitle>
              <CardDescription>
                {loading ? 'Loading…' : error ? <span className="text-rose-500">{error.message}</span> : (
                  <>
                    Showing <span className="font-semibold text-fg">{fmtNumber(rows.length)}</span> records
                    {tab === 'closedso' && <> · {QUARTER_OPTIONS.find(q => q.value === quarter)?.label}</>}
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <DataTable
                data={rows}
                columns={columns}
                loading={loading}
                pageSize={50}
                emptyText={emptyText}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

// ─── distinctive service-ops hero (dark gradient + rotating gear) ────────────

function ServiceHero({ kpi, loading }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-orange-500/30 shadow-[0_20px_50px_-15px_rgba(249,115,22,0.4)]">
      {/* Layered dark gradient background — service / industrial feel */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-orange-950/40 to-slate-950" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(249,115,22,0.25),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_left,rgba(251,191,36,0.15),transparent_55%)]" />

      {/* Decorative rotating gear */}
      <div className="absolute -right-12 -top-12 opacity-[0.07]">
        <Cog size={260} strokeWidth={1.25} className="animate-[spin_22s_linear_infinite] text-amber-300" />
      </div>
      <div className="absolute -left-10 -bottom-10 opacity-[0.05]">
        <Settings size={180} strokeWidth={1.5} className="animate-[spin_28s_linear_infinite_reverse] text-orange-300" />
      </div>

      {/* Diagonal shine line */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-1/2 -left-1/4 h-[200%] w-1/3 -rotate-12 bg-gradient-to-b from-transparent via-white/[0.04] to-transparent" />
      </div>

      <div className="relative p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-6">
          {/* Big icon block */}
          <div className="relative grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-xl shadow-orange-500/40 ring-4 ring-orange-500/20 shrink-0">
            <Wrench size={36} strokeWidth={2} />
            <span className="absolute -top-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-amber-400 text-slate-900 shadow-md">
              <Zap size={12} strokeWidth={3} />
            </span>
          </div>

          {/* Headline */}
          <div className="flex-1 min-w-[280px]">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-orange-300">
              Service Operations
            </div>
            <div className="mt-1 flex items-baseline gap-3 flex-wrap">
              <span className="text-6xl font-black tabular-nums tracking-tight bg-gradient-to-br from-orange-300 via-amber-200 to-orange-400 bg-clip-text text-transparent drop-shadow-[0_2px_8px_rgba(251,146,60,0.4)]">
                {loading ? '…' : fmtNumber(kpi.total)}
              </span>
              <span className="text-sm font-semibold uppercase tracking-wider text-orange-200/90">
                Open Orders
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {kpi.counts.updates > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/20 backdrop-blur-sm border border-rose-400/40 px-3 py-1.5 text-xs font-bold text-rose-100 shadow-md">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-400" />
                  </span>
                  {fmtNumber(kpi.counts.updates)} OVERDUE
                </span>
              )}
              {kpi.counts.partsawaited > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 backdrop-blur-sm border border-amber-400/40 px-3 py-1.5 text-xs font-bold text-amber-100 shadow-md">
                  <Package size={12} /> {fmtNumber(kpi.counts.partsawaited)} PARTS WAITED
                </span>
              )}
              {kpi.counts.pending > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/20 backdrop-blur-sm border border-sky-400/40 px-3 py-1.5 text-xs font-bold text-sky-100 shadow-md">
                  <Clock size={12} /> {fmtNumber(kpi.counts.pending)} TO SCHEDULE
                </span>
              )}
            </div>
          </div>

          {/* Vertical divider + right-side gauge stats */}
          <div className="hidden sm:block h-24 w-px bg-gradient-to-b from-transparent via-orange-300/30 to-transparent" />
          <div className="flex gap-6">
            <GaugeStat label="AVG AGE" value={`${kpi.avgAge.toFixed(0)}d`} icon={Hourglass}
              tone={kpi.avgAge >= 90 ? 'rose' : kpi.avgAge >= 60 ? 'amber' : 'emerald'} />
            <GaugeStat label="OLDEST" value={`${fmtNumber(kpi.oldest)}d`} icon={Gauge}
              tone={kpi.oldest >= 180 ? 'rose' : kpi.oldest >= 90 ? 'amber' : 'emerald'} />
          </div>
        </div>
      </div>
    </div>
  );
}

function GaugeStat({ label, value, icon: Icon, tone }) {
  const toneColor = tone === 'rose'    ? 'text-rose-300'
                  : tone === 'amber'   ? 'text-amber-300'
                  : tone === 'emerald' ? 'text-emerald-300'
                  : 'text-orange-200';
  return (
    <div className="text-center">
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-orange-200/70">{label}</div>
      <div className="mt-1 flex items-center gap-1.5 justify-center">
        {Icon && <Icon size={20} className={cn('opacity-80', toneColor)} />}
        <span className={cn('text-3xl font-black tabular-nums tracking-tight', toneColor)}>{value}</span>
      </div>
    </div>
  );
}

// ─── service pipeline (horizontal flow with arrows) ──────────────────────────

function ServicePipeline({ kpi, setTab, loading }) {
  // Service ticket flow: pending → parts → scheduled → updates (overdue)
  const stages = [
    {
      tab:   'pending',
      label: 'Pending Schedule',
      desc:  'Ready · awaiting date',
      icon:  Clock,
      count: kpi.counts.pending,
      tone:  'sky',
      gradient:    'from-sky-500 to-cyan-500',
      bgTint:      'bg-sky-50/60 dark:bg-sky-950/30',
      borderTint:  'border-sky-500/30',
      shadowTint:  'shadow-[0_8px_25px_-8px_rgba(14,165,233,0.35)]',
      textColor:   'text-sky-600 dark:text-sky-300',
    },
    {
      tab:   'partsawaited',
      label: 'Parts Awaited',
      desc:  'Ready: partial / none',
      icon:  Package,
      count: kpi.counts.partsawaited,
      tone:  'amber',
      gradient:    'from-amber-500 to-orange-500',
      bgTint:      'bg-amber-50/60 dark:bg-amber-950/30',
      borderTint:  'border-amber-500/30',
      shadowTint:  'shadow-[0_8px_25px_-8px_rgba(245,158,11,0.35)]',
      textColor:   'text-amber-600 dark:text-amber-300',
    },
    {
      tab:   'scheduled',
      label: 'Scheduled',
      desc:  'Booked for future date',
      icon:  CalendarCheck,
      count: kpi.counts.scheduled,
      tone:  'emerald',
      gradient:    'from-emerald-500 to-teal-500',
      bgTint:      'bg-emerald-50/60 dark:bg-emerald-950/30',
      borderTint:  'border-emerald-500/30',
      shadowTint:  'shadow-[0_8px_25px_-8px_rgba(16,185,129,0.35)]',
      textColor:   'text-emerald-600 dark:text-emerald-300',
    },
    {
      tab:   'updates',
      label: 'Overdue',
      desc:  'Past delivery date',
      icon:  AlertTriangle,
      count: kpi.counts.updates,
      tone:  'rose',
      gradient:    'from-rose-500 to-red-500',
      bgTint:      'bg-rose-50/60 dark:bg-rose-950/30',
      borderTint:  'border-rose-500/30',
      shadowTint:  'shadow-[0_8px_25px_-8px_rgba(244,63,94,0.4)]',
      textColor:   'text-rose-600 dark:text-rose-300',
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-red-500 text-white shadow-md ring-2 ring-orange-500/20">
          <Activity size={18} />
        </div>
        <div>
          <h3 className="text-base font-bold tracking-tight">Service Pipeline</h3>
          <p className="text-xs text-muted-fg">From scheduling → parts → completion · click any stage to drill in</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4 lg:gap-2">
        {stages.map((s, i) => {
          const Icon = s.icon;
          const isUrgent = s.tone === 'rose' && s.count > 0;
          return (
            <div key={s.tab} className="relative">
              {/* Pipeline arrow connector (visible on lg+, between cards) */}
              {i < stages.length - 1 && (
                <div className="hidden lg:block absolute top-1/2 -right-1.5 z-10 -translate-y-1/2">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-card border border-border shadow-sm">
                    <ChevronRight size={14} className="text-muted-fg" />
                  </div>
                </div>
              )}

              <button type="button" onClick={() => setTab(s.tab)}
                className={cn(
                  'group relative w-full overflow-hidden rounded-2xl border-2 text-left transition-all duration-300',
                  s.borderTint, s.bgTint, s.shadowTint,
                  'hover:-translate-y-1 hover:shadow-2xl',
                )}
              >
                {/* Stage number */}
                <div className="absolute top-2 right-2 grid h-6 w-6 place-items-center rounded-full bg-card/70 backdrop-blur text-[10px] font-bold text-muted-fg">
                  {i + 1}
                </div>

                {/* Decorative big icon */}
                <div className="absolute -bottom-3 -right-3 opacity-[0.08]">
                  <Icon size={100} strokeWidth={1.25} />
                </div>

                <div className="relative p-4">
                  <div className={cn(
                    'inline-grid h-12 w-12 place-items-center rounded-xl text-white shadow-lg ring-2 ring-white/20',
                    'bg-gradient-to-br', s.gradient,
                  )}>
                    <Icon size={22} strokeWidth={2.25} />
                  </div>

                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{s.label}</span>
                    {isUrgent && (
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
                      </span>
                    )}
                  </div>

                  <div className={cn('mt-1 text-4xl font-black tabular-nums tracking-tight leading-none', s.textColor)}>
                    {loading ? <span className="inline-block h-9 w-16 rounded bg-muted/60 animate-pulse" /> : fmtNumber(s.count)}
                  </div>
                  <div className="text-[11px] text-muted-fg mt-1.5">{s.desc}</div>

                  <div className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-muted-fg group-hover:text-fg group-hover:gap-2 transition-all">
                    Open list <ArrowRight size={12} />
                  </div>
                </div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── aging timeline (single horizontal stacked bar) ──────────────────────────

function AgingTimeline({ aging, total, loading, setTab }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-violet-500/10 via-purple-500/5 to-transparent border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md">
            <Hourglass size={14} />
          </span>
          Aging Timeline
        </CardTitle>
        <CardDescription>How long open orders have been on the books · click a segment to filter</CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {loading ? (
          <div className="h-16 rounded-xl bg-muted/60 animate-pulse" />
        ) : total === 0 ? (
          <div className="py-6 text-center text-sm text-muted-fg">No open service orders.</div>
        ) : (
          <>
            {/* Single stacked bar */}
            <div className="relative flex h-16 w-full overflow-hidden rounded-xl bg-muted/40 ring-1 ring-border">
              {AGING_BUCKETS.map(b => {
                const count = aging[b.id] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                if (pct === 0) return null;
                return (
                  <button key={b.id}
                    onClick={() => setTab('openso')}
                    title={`${b.label}: ${count} orders (${pct.toFixed(1)}%)`}
                    className="group relative flex items-center justify-center transition-all hover:brightness-110"
                    style={{ width: `${pct}%`, background: b.color, minWidth: pct > 0 && pct < 4 ? '36px' : 'auto' }}>
                    <div className="text-center text-white font-bold drop-shadow-md">
                      <div className="text-base leading-none tabular-nums">{count}</div>
                      <div className="text-[9px] uppercase tracking-wider opacity-90 mt-0.5">{pct.toFixed(0)}%</div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Legend below */}
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {AGING_BUCKETS.map(b => {
                const count = aging[b.id] ?? 0;
                const pct = total > 0 ? (count / total) * 100 : 0;
                return (
                  <div key={b.id}
                    className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                    <span className="inline-block h-3 w-3 rounded-sm shrink-0 shadow-sm" style={{ background: b.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg leading-tight">{b.label}</div>
                      <div className="flex items-baseline justify-between gap-1">
                        <span className="text-base font-bold tabular-nums" style={{ color: b.color }}>{fmtNumber(count)}</span>
                        <span className="text-[10px] tabular-nums text-muted-fg">{pct.toFixed(0)}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// (legacy AgingBreakdown — kept for reference but no longer rendered)
function AgingBreakdown({ aging, total, loading }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-violet-500 to-purple-500 text-white shadow-md ring-2 ring-violet-500/20">
          <Hourglass size={18} />
        </div>
        <div>
          <h3 className="text-base font-bold tracking-tight">Aging Breakdown</h3>
          <p className="text-xs text-muted-fg">How long open service orders have been on the books</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {AGING_BUCKETS.map(b => {
          const count = aging[b.id] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={b.id}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition hover:shadow-md hover:-translate-y-0.5">
              <div className="h-1" style={{ background: b.color }} />
              <div className="p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{b.label}</div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                  <span className="text-3xl font-extrabold tabular-nums tracking-tight" style={{ color: b.color }}>
                    {loading ? <span className="inline-block h-7 w-12 rounded bg-muted/60 animate-pulse" /> : fmtNumber(count)}
                  </span>
                  {total > 0 && !loading && (
                    <span className="text-[11px] tabular-nums text-muted-fg">{pct.toFixed(0)}%</span>
                  )}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: b.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── summary view ─────────────────────────────────────────────────────────────

function SummaryView({ kpi, setTab, loading }) {
  const cards = [
    { id: 'openso',       label: 'All Open',         count: kpi.total,                icon: Inbox,         accent: 'primary', description: 'Every active service ticket' },
    { id: 'pending',      label: 'Pending Schedule', count: kpi.counts.pending,       icon: Clock,         accent: 'sky',     description: 'Ready · awaiting a delivery date' },
    { id: 'partsawaited', label: 'Parts Awaited',    count: kpi.counts.partsawaited,  icon: Package,       accent: 'amber',   description: 'Ready status: partial or none' },
    { id: 'scheduled',    label: 'Scheduled',        count: kpi.counts.scheduled,     icon: CalendarCheck, accent: 'emerald', description: 'Booked for a future date' },
    { id: 'updates',      label: 'Overdue Updates',  count: kpi.counts.updates,       icon: AlertTriangle, accent: 'rose',    description: 'Past delivery date · needs action', urgent: true },
    { id: 'closedso',     label: 'Closed Sales',     count: null,                     icon: CheckCircle2,  accent: 'slate',   description: 'Reference · search closed records' },
    { id: 'attention',    label: 'Needs Attention',  count: null,                     icon: Bell,          accent: 'rose',    description: 'Manually flagged items' },
    { id: 'rslvattention',label: 'Resolved Attn.',   count: null,                     icon: CheckCircle2,  accent: 'emerald', description: 'Previously resolved attention items' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 px-1">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 text-white shadow-md ring-2 ring-blue-500/20">
          <LayoutDashboard size={18} />
        </div>
        <div>
          <h3 className="text-base font-bold tracking-tight">Quick Navigation</h3>
          <p className="text-xs text-muted-fg">Click any tile to jump to that view</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(c => (
          <SummaryTile key={c.id} {...c} onClick={() => setTab(c.id)} />
        ))}
      </div>
      {loading && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-fg">
          <span className="inline-block h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
          Loading service orders…
        </div>
      )}
    </div>
  );
}

function SummaryTile({ label, count, icon: Icon, accent, description, onClick, urgent }) {
  const accentMap = {
    primary: { stripe: 'from-blue-500 to-indigo-500',     iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-500',     ring: 'ring-blue-500/20',     text: 'text-blue-600 dark:text-blue-300' },
    sky:     { stripe: 'from-sky-500 to-cyan-500',        iconBg: 'bg-gradient-to-br from-sky-500 to-cyan-500',        ring: 'ring-sky-500/20',      text: 'text-sky-600 dark:text-sky-300' },
    amber:   { stripe: 'from-amber-500 to-orange-500',    iconBg: 'bg-gradient-to-br from-amber-500 to-orange-500',    ring: 'ring-amber-500/20',    text: 'text-amber-600 dark:text-amber-300' },
    emerald: { stripe: 'from-emerald-500 to-teal-500',    iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-500',    ring: 'ring-emerald-500/20',  text: 'text-emerald-600 dark:text-emerald-300' },
    rose:    { stripe: 'from-rose-500 to-orange-500',     iconBg: 'bg-gradient-to-br from-rose-500 to-rose-600',       ring: 'ring-rose-500/20',     text: 'text-rose-600 dark:text-rose-300' },
    slate:   { stripe: 'from-slate-500 to-slate-600',     iconBg: 'bg-gradient-to-br from-slate-500 to-slate-600',     ring: 'ring-slate-500/20',    text: 'text-slate-600 dark:text-slate-300' },
  };
  const p = accentMap[accent] || accentMap.primary;
  return (
    <button type="button" onClick={onClick}
      className="text-left overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg">
      <div className={cn('h-1 bg-gradient-to-r', p.stripe)} />
      <div className="p-4 flex items-center gap-3">
        <div className={cn('grid h-11 w-11 place-items-center rounded-xl text-white shadow-md ring-2 shrink-0', p.iconBg, p.ring)}>
          <Icon size={20} strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg truncate">{label}</span>
            {urgent && count > 0 && (
              <span className="relative flex h-2 w-2 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
            )}
          </div>
          <div className={cn('mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight leading-none', p.text)}>
            {count != null ? fmtNumber(count) : '→'}
          </div>
          <div className="text-[11px] text-muted-fg mt-1 line-clamp-1">{description}</div>
        </div>
      </div>
    </button>
  );
}

// ─── column factories ─────────────────────────────────────────────────────────

function makeServiceColumns({ highlightDelivery, highlightOverdue, closed } = {}) {
  return [
    { id: 'service_date', accessorFn: r => pick(r, 'service_date'),
      header: closed ? 'Sale Date' : 'Service Date',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'sales_no', accessorFn: r => pick(r, 'sales_no'),
      header: closed ? 'Sale No' : 'Service No',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'cust_id', accessorFn: r => pick(r, 'cust_id'), header: 'Cust ID',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'customer', accessorFn: r => pick(r, 'customer_name'), header: 'Customer',
      cell: ({ getValue, row }) => (
        <div>
          <div className="font-medium text-sm">{getValue() || '—'}</div>
          {pick(row.original, 'contact') && (
            <div className="text-[11px] text-muted-fg flex items-center gap-1">
              <Phone size={10} /> {fmtPhone(pick(row.original, 'contact'))}
            </div>
          )}
        </div>
      ) },
    { id: 'location', accessorFn: r => `${pick(r, 'city') || ''} ${pick(r, 'state') || ''}`, header: 'Location',
      cell: ({ row }) => {
        const city = pick(row.original, 'city');
        const state = pick(row.original, 'state');
        const zip = pick(row.original, 'zip');
        return (
          <div className="flex items-start gap-1 text-xs">
            <MapPin size={11} className="mt-0.5 text-muted-fg shrink-0" />
            <div>
              <div>{city || '—'}{state ? `, ${state}` : ''}</div>
              <div className="text-muted-fg">{zip}</div>
            </div>
          </div>
        );
      } },
    { id: 'delivery_date', accessorFn: r => pick(r, 'delivery_date'), header: closed ? 'Delivery' : 'Delivery Date',
      cell: ({ getValue }) => {
        const v = getValue();
        if (!v) return <span className="text-muted-fg">—</span>;
        if (String(v).toUpperCase() === 'ASAP') {
          return <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-200">ASAP</span>;
        }
        const cls = highlightOverdue ? 'text-rose-600 dark:text-rose-400 font-semibold'
                  : highlightDelivery ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                  : '';
        return <span className={cn('tabular-nums text-xs', cls)}>{fmtDate(v)}</span>;
      } },
    { id: 'ready_status', accessorFn: r => pick(r, 'ready_status'), header: 'Ready',
      cell: ({ getValue }) => <ReadyBadge value={getValue()} /> },
    { id: 'sales_person', accessorFn: r => pick(r, 'sales_person'), header: 'Salesperson' },
    { id: 'age', accessorFn: r => parseNumber(pick(r, 'age')), header: 'Age',
      cell: ({ getValue }) => <AgeBadge age={getValue()} /> },
    { id: 'rv_remarks', accessorFn: r => pick(r, 'rv_remarks'), header: 'RV Remarks',
      cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-xs text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'service_remark', accessorFn: r => pick(r, 'service_remark'), header: 'Service Remarks',
      cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-xs" title={getValue()}>{getValue() || '—'}</span> },
  ];
}

function makeAttentionColumns() {
  return [
    { id: 'id', accessorFn: r => pick(r, 'id'), header: 'ID',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue()}</span> },
    { id: 'sales_no', accessorFn: r => pick(r, 'salesno', 'sales_no'), header: 'Sale #',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'customer_name', accessorFn: r => pick(r, 'customer_name', 'customername'), header: 'Customer',
      cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span> },
    { id: 'reason', accessorFn: r => pick(r, 'reason', 'description', 'remark'), header: 'Reason',
      cell: ({ getValue }) => <span className="block max-w-[400px] truncate text-sm" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'created_at', accessorFn: r => pick(r, 'created_at'), header: 'Created',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'updated_at', accessorFn: r => pick(r, 'updated_at'), header: 'Updated',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
  ];
}
