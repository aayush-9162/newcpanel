// Modernized Pending Receivables page.
// Summary tab: positive / negative receivable aggregates + trend chart.
// Report tab: full SalesOpenDaily detail table with hideable columns.
//
// Data sources (MS SQL):
//   - SalesOpenDaily                       (detail rows)
//   - SaleReceivableAggregateHistory       (positive aggregate by date + profit center)
//   - SaleNegativeReceivableAggregateHistory (negative aggregate)
//
// pending_status / pending_remarks aren't part of MS SQL — those lived in a
// MySQL `pending_remarks` table that the upstream `/api/pendingReceivables`
// endpoint joined server-side. Until that table is wired up here, those
// columns are omitted.
import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend,
} from 'recharts';
import {
  DollarSign, Receipt, Clock, AlertTriangle, ArrowUpRight, ArrowDownRight,
  Download, RefreshCw, Building2, Calendar, Wallet,
  ExternalLink, Eye, EyeOff, Pin, PinOff,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';

// ─── constants ────────────────────────────────────────────────────────────────

const HIDDEN_COLS_DEFAULT = [
  'phone_number', 'delivery_name', 'delivery_addr1', 'delivery_addr2', 'deliveryvia', 'delivery_zip',
  'delivery_status', 'sale_amount', 'sale_tax_amount', 'down_pymt_percent', 'sale_finance_amt',
  'sales_person', 'cfc', 'usld', 'sale_open_close', 'balance_due', 'cust_id',
];

const EXTERNAL_LINKS = [
  { label: 'Synchrony',     href: 'https://businesscenter.synchronybusiness.com/portal/home' },
  { label: 'Mariner',       href: 'https://decisionlender.solutions/tci/auth/dealerLogin/default/dealer/default' },
  { label: 'Wells Fargo',   href: 'https://retailservices.sec.wellsfargo.com/' },
  { label: 'Old Report',    href: 'https://docs.google.com/spreadsheets/d/1t4_tTzj260h9d8tZOuccEpaTosnxj2qLRg0xkFsdM4Q/edit?gid=80927485#gid' },
];

const PIN_KEY = 'defaultTabPinned_pendings';

// ─── SQL ──────────────────────────────────────────────────────────────────────

const DETAIL_SQL = `
  SELECT
    SaleDate           AS sale_date,
    SalesNo            AS sale_no,
    CustomerId         AS cust_id,
    CustomerName       AS customer_name,
    CustomerPhone      AS phone_number,
    DeliveryName       AS delivery_name,
    DeliveryAddr1      AS delivery_addr1,
    DeliveryAddr2      AS delivery_addr2,
    DeliveryCity       AS delivery_city,
    DeliveryState      AS delivery_state,
    DeliveryZip        AS delivery_zip,
    DeliveryStatus     AS delivery_status,
    DeliveryDate       AS delivery_date,
    DeliveryVia        AS deliveryvia,
    ReadyStatus        AS ready_status,
    SaleAmt            AS sale_amount,
    SaleTaxAmt         AS sale_tax_amount,
    SaleTotalAmt       AS sale_total,
    DownPmtPercent     AS down_pymt_percent,
    BalanceDue         AS balance_due,
    SaleFinanceAmt     AS sale_finance_amt,
    ReceivableAmt      AS receivable_amt,
    Salesperson        AS sales_person,
    CFC                AS cfc,
    USLD               AS usld,
    Terms              AS terms,
    Age                AS age,
    SaleRemarks        AS sales_remarks,
    sale_open_close
  FROM SalesOpenDaily
  ORDER BY SaleDate DESC, Age DESC
`;

const AGGR_POS_SQL = `
  SELECT BusinessDate, SaleProfitCenter, OpenSalesCount,
         ReceivableAmtOpenSales, ClosedSalesCount, ReceivableAmtClosedSales
  FROM SaleReceivableAggregateHistory
  WHERE BusinessDate >= ? AND BusinessDate <= ? AND SaleProfitCenter = ?
  ORDER BY BusinessDate
`;

const AGGR_NEG_SQL = `
  SELECT BusinessDate, SaleProfitCenter, OpenSalesCount,
         ReceivableAmtOpenSales, ClosedSalesCount, ReceivableAmtClosedSales
  FROM SaleNegativeReceivableAggregateHistory
  WHERE BusinessDate >= ? AND BusinessDate <= ? AND SaleProfitCenter = ?
  ORDER BY BusinessDate
`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function num(v) {
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
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function fmtShortDate(v) {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function yesterdayISO() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ─── filter pill ──────────────────────────────────────────────────────────────

function StorePill({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'h-8 rounded-md px-3 text-xs font-semibold transition outline-none',
        active ? 'bg-emerald-500 text-white shadow-sm' : 'border border-emerald-500/40 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20',
      )}>
      {children}
    </button>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function PendingReceivables() {
  const [tab, setTab]                 = useState(() => localStorage.getItem(PIN_KEY) === 'report' ? 'report' : 'summary');
  const [from, setFrom]               = useState(yesterdayISO());
  const [to, setTo]                   = useState('');
  const [store, setStore]             = useState('ALL');
  const [showAllCols, setShowAllCols] = useState(false);
  const [pinned, setPinned]           = useState(() => localStorage.getItem(PIN_KEY) === 'report');

  const qc = useQueryClient();

  // Detail rows — full SalesOpenDaily snapshot
  const detailQ = useSqlQuery(DETAIL_SQL, []);

  // Aggregate queries — bound to current filter
  const aggrPosQ = useSqlQuery(
    AGGR_POS_SQL,
    [from, to || '2099-12-31', store],
    { enabled: tab === 'summary' && !!from },
  );
  const aggrNegQ = useSqlQuery(
    AGGR_NEG_SQL,
    [from, to || '2099-12-31', store],
    { enabled: tab === 'summary' && !!from },
  );

  const detailRows  = detailQ.data?.rows ?? [];
  const aggrPosRows = aggrPosQ.data?.rows ?? [];
  const aggrNegRows = aggrNegQ.data?.rows ?? [];

  const refresh = () => qc.invalidateQueries({ queryKey: ['sql'] });

  const togglePin = () => {
    if (pinned) { localStorage.removeItem(PIN_KEY); setPinned(false); }
    else        { localStorage.setItem(PIN_KEY, 'report'); setPinned(true); }
  };

  // Reset pin when switching to summary
  useEffect(() => {
    if (tab === 'summary' && pinned) {
      localStorage.removeItem(PIN_KEY);
      setPinned(false);
    }
  }, [tab]); // eslint-disable-line

  // Detail KPIs
  const kpi = useMemo(() => {
    let totalReceivable = 0, totalAge = 0, count = 0;
    let stale = 0, oldest = 0, largest = 0;
    for (const r of detailRows) {
      const amt = num(pick(r, 'receivable_amt'));
      totalReceivable += amt;
      if (amt > largest) largest = amt;
      const age = num(pick(r, 'age'));
      totalAge += age;
      if (age > oldest) oldest = age;
      if (age > 60) stale++;
      count++;
    }
    return {
      totalReceivable, totalAge, count, stale, oldest, largest,
      avgAge: count ? totalAge / count : 0,
      avgReceivable: count ? totalReceivable / count : 0,
    };
  }, [detailRows]);

  // Aggregate KPIs (per current filter)
  const aggrKpi = useMemo(() => {
    let posOpen = 0, posClosed = 0, negOpen = 0, negClosed = 0;
    for (const r of aggrPosRows) {
      posOpen   += num(pick(r, 'ReceivableAmtOpenSales'));
      posClosed += num(pick(r, 'ReceivableAmtClosedSales'));
    }
    for (const r of aggrNegRows) {
      negOpen   += num(pick(r, 'ReceivableAmtOpenSales'));
      negClosed += num(pick(r, 'ReceivableAmtClosedSales'));
    }
    return { posOpen, posClosed, negOpen, negClosed };
  }, [aggrPosRows, aggrNegRows]);

  // Trend chart data
  const trendData = useMemo(() => {
    const byDate = new Map();
    const ensure = (key, raw) => {
      if (!byDate.has(key)) byDate.set(key, { date: fmtShortDate(raw), positive: 0, negative: 0 });
      return byDate.get(key);
    };
    for (const r of aggrPosRows) {
      const d = pick(r, 'BusinessDate');
      if (!d) continue;
      const slot = ensure(String(d), d);
      slot.positive += num(pick(r, 'ReceivableAmtOpenSales')) + num(pick(r, 'ReceivableAmtClosedSales'));
    }
    for (const r of aggrNegRows) {
      const d = pick(r, 'BusinessDate');
      if (!d) continue;
      const slot = ensure(String(d), d);
      slot.negative -= Math.abs(num(pick(r, 'ReceivableAmtOpenSales'))) + Math.abs(num(pick(r, 'ReceivableAmtClosedSales')));
    }
    return [...byDate.values()];
  }, [aggrPosRows, aggrNegRows]);

  // Detail-table columns
  const cols = useMemo(() => {
    const base = [
      { id: 'sale_date',     accessorFn: r => pick(r, 'sale_date'),       header: 'Sale Date',
        cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
      { id: 'sale_no',       accessorFn: r => pick(r, 'sale_no'),         header: 'Sale #',
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
      { id: 'customer_name', accessorFn: r => pick(r, 'customer_name'),   header: 'Customer',
        cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span> },
      { id: 'age',           accessorFn: r => num(pick(r, 'age')),        header: 'Age',
        cell: ({ getValue }) => {
          const v = getValue();
          return <span className={cn('num font-semibold tabular-nums',
            v > 60 ? 'text-rose-600 dark:text-rose-400'
            : v > 30 ? 'text-amber-600 dark:text-amber-400'
            : 'text-fg')}>{v}d</span>;
        } },
      { id: 'terms',         accessorFn: r => pick(r, 'terms'),           header: 'Terms' },
      { id: 'sale_total',    accessorFn: r => num(pick(r, 'sale_total')), header: 'Sale Total',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'receivable_amt',accessorFn: r => num(pick(r, 'receivable_amt')), header: 'Receivable',
        cell: ({ getValue }) => {
          const v = getValue();
          return <span className={cn('font-semibold tabular-nums', v < 0 && 'text-rose-600 dark:text-rose-400')}>{fmtCurrency(v, true)}</span>;
        } },
      { id: 'delivery_date', accessorFn: r => pick(r, 'delivery_date'),   header: 'Delivery',
        cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
      { id: 'delivery_state',accessorFn: r => pick(r, 'delivery_state'),  header: 'State' },
      { id: 'ready_status',  accessorFn: r => pick(r, 'ready_status'),    header: 'Ready Status' },
      { id: 'sales_remarks', accessorFn: r => pick(r, 'sales_remarks'),   header: 'Remarks',
        cell: ({ getValue }) => <span className="block max-w-[280px] truncate text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
    ];

    if (!showAllCols) return base;

    const extra = HIDDEN_COLS_DEFAULT.map(key => ({
      id: key,
      accessorFn: r => pick(r, key),
      header: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      cell: ({ getValue }) => {
        const v = getValue();
        if (v == null || v === '') return <span className="text-muted-fg">—</span>;
        if (key.includes('amount') || key === 'balance_due' || key === 'sale_finance_amt')
          return <span className="tabular-nums">{fmtCurrency(num(v), true)}</span>;
        if (key === 'down_pymt_percent') return <span className="tabular-nums">{v}</span>;
        return v;
      },
    }));
    return [...base, ...extra];
  }, [showAllCols]);

  const subtitle = `${fmtNumber(kpi.count)} open · ${fmtCurrency(kpi.totalReceivable)} outstanding`;

  return (
    <>
      <Topbar title="Pending Receivables" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ── filter bar ── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            {tab === 'summary' && (
              <>
                <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
                  <Building2 size={14} /> Store
                </span>
                <div className="flex flex-wrap gap-1">
                  <StorePill active={store === '1'}   onClick={() => setStore('1')}>S1</StorePill>
                  <StorePill active={store === '2'}   onClick={() => setStore('2')}>S2</StorePill>
                  <StorePill active={store === 'ALL'} onClick={() => setStore('ALL')}>All</StorePill>
                </div>

                <div className="h-6 w-px bg-border mx-1" />

                <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
                  <Calendar size={14} /> From
                </span>
                <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-36 border-emerald-500/50" />
                <span className="text-xs uppercase tracking-wider text-muted-fg">To</span>
                <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-36 border-emerald-500/50" />
              </>
            )}

            {tab === 'report' && (
              <>
                <Button variant="outline" size="sm" onClick={() => setShowAllCols(s => !s)}>
                  {showAllCols ? <><EyeOff size={14} /> Hide Extra</> : <><Eye size={14} /> View All Columns</>}
                </Button>
                <div className="h-6 w-px bg-border mx-1" />
                <div className="flex flex-wrap gap-1.5">
                  {EXTERNAL_LINKS.map(l => (
                    <a key={l.label} href={l.href} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-fg transition hover:bg-muted hover:text-fg">
                      <ExternalLink size={11} /> {l.label}
                    </a>
                  ))}
                </div>
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm"
                onClick={() => rowsToCSV(tab === 'report' ? detailRows : [...aggrPosRows, ...aggrNegRows], `pending-${tab}.csv`)}
                disabled={tab === 'report' ? !detailRows.length : !aggrPosRows.length}>
                <Download size={14} /> Export
              </Button>
              <Button variant="outline" size="sm" onClick={refresh} title="Refresh">
                <RefreshCw size={14} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── hero banner ── */}
        <HeroBanner icon={Wallet} decorIcon={DollarSign} accent="primary">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">
            Outstanding Receivables
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-blue-600 to-indigo-500 bg-clip-text text-transparent">
              {fmtCompactCurrency(kpi.totalReceivable)}
            </span>
            {kpi.stale > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-rose-500 to-orange-500 text-white">
                <AlertTriangle size={14} /> {fmtNumber(kpi.stale)} stale
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{fmtNumber(kpi.count)}</strong> pending sales · avg aging <strong className="text-fg">{kpi.avgAge.toFixed(0)} days</strong> · oldest <strong className="text-fg">{kpi.oldest} days</strong>
          </div>
        </HeroBanner>

        {/* ── eye-catching hero stats ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Outstanding"
            value={fmtCompactCurrency(kpi.totalReceivable)}
            fullValue={fmtCurrency(kpi.totalReceivable)}
            icon={DollarSign}
            accent="primary"
            subtitle={kpi.count ? `${fmtNumber(kpi.count)} pending sales` : null}
            loading={detailQ.isLoading}
          />
          <HeroStat
            label="Avg per Sale"
            value={fmtCompactCurrency(kpi.avgReceivable)}
            fullValue={fmtCurrency(kpi.avgReceivable)}
            icon={Receipt}
            accent="sky"
            subtitle={kpi.largest ? `largest: ${fmtCompactCurrency(kpi.largest)}` : null}
            loading={detailQ.isLoading}
          />
          <HeroStat
            label="Avg Aging"
            value={`${kpi.avgAge.toFixed(0)}d`}
            icon={Clock}
            accent={kpi.avgAge >= 60 ? 'rose' : kpi.avgAge >= 30 ? 'amber' : 'sky'}
            urgent={kpi.avgAge >= 60}
            subtitle={kpi.oldest > 0 ? `oldest: ${kpi.oldest} days` : null}
            loading={detailQ.isLoading}
          />
          <HeroStat
            label="Stale (>60d)"
            value={fmtNumber(kpi.stale)}
            icon={AlertTriangle}
            accent={kpi.stale > 0 ? 'rose' : 'emerald'}
            urgent={kpi.stale > 0}
            subtitle={kpi.count ? `${((kpi.stale / kpi.count) * 100).toFixed(0)}% of pipeline` : null}
            loading={detailQ.isLoading}
          />
        </div>

        {/* ── tabs ── */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/30 p-0.5 self-start">
          <button onClick={() => setTab('summary')}
            className={cn('h-8 rounded-md px-4 text-sm font-medium transition',
              tab === 'summary' ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted hover:text-fg')}>
            Summary
          </button>
          <div className={cn('h-8 inline-flex items-center gap-2 rounded-md px-3 text-sm font-medium transition cursor-pointer',
            tab === 'report' ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted hover:text-fg')}
            onClick={() => setTab('report')}>
            Report
            <button onClick={(e) => { e.stopPropagation(); togglePin(); }}
              title={pinned ? 'Unpin (default = Summary)' : 'Pin as default tab'}
              className={cn('rounded p-0.5 transition',
                tab === 'report' ? 'hover:bg-primary-fg/20' : 'hover:bg-muted-foreground/10')}>
              {pinned ? <PinOff size={11} /> : <Pin size={11} />}
            </button>
          </div>
        </div>

        {/* ── tab content ── */}
        {tab === 'summary' ? (
          <SummaryView
            posRows={aggrPosRows}
            negRows={aggrNegRows}
            posLoading={aggrPosQ.isLoading}
            negLoading={aggrNegQ.isLoading}
            posError={aggrPosQ.error}
            negError={aggrNegQ.error}
            trendData={trendData}
            aggrKpi={aggrKpi}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>SalesOpenDaily — Detail</CardTitle>
              <CardDescription>
                {detailQ.isLoading ? 'Loading…' : detailQ.error ? <span className="text-rose-500">{detailQ.error.message}</span> : (
                  <>
                    {fmtNumber(detailRows.length)} pending sales{showAllCols && <span className="ml-2 inline-flex rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-200">All Columns</span>}
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <DataTable
                data={detailRows}
                columns={cols}
                loading={detailQ.isLoading}
                pageSize={50}
                emptyText={detailQ.error ? `Could not load: ${detailQ.error.message}` : 'No pending receivables.'}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

// ─── summary view ─────────────────────────────────────────────────────────────

function SummaryView({ posRows, negRows, posLoading, negLoading, posError, negError, trendData, aggrKpi }) {
  const hasData = posRows.length > 0 || negRows.length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Summary KPIs (per filter) */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <HeroStat label="Open (Positive)"   value={fmtCompactCurrency(aggrKpi.posOpen)}   fullValue={fmtCurrency(aggrKpi.posOpen)}   icon={ArrowUpRight}   accent="emerald" loading={posLoading} />
        <HeroStat label="Closed (Positive)" value={fmtCompactCurrency(aggrKpi.posClosed)} fullValue={fmtCurrency(aggrKpi.posClosed)} icon={DollarSign}     accent="sky"     loading={posLoading} />
        <HeroStat label="Open (Negative)"   value={fmtCompactCurrency(aggrKpi.negOpen)}   fullValue={fmtCurrency(aggrKpi.negOpen)}   icon={ArrowDownRight} accent="amber"   loading={negLoading} />
        <HeroStat label="Closed (Negative)" value={fmtCompactCurrency(aggrKpi.negClosed)} fullValue={fmtCurrency(aggrKpi.negClosed)} icon={DollarSign}     accent="rose"    loading={negLoading} />
      </div>

      {/* Trend chart */}
      {hasData && trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Receivable Trend</CardTitle>
            <CardDescription>Daily aggregate · positive vs negative for the selected range</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                  <YAxis tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                    tickFormatter={(v) => v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : v <= -1000 ? `-$${Math.abs(v / 1000).toFixed(0)}k` : `$${v}`} />
                  <RTooltip
                    formatter={(v) => fmtCurrency(v, true)}
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                  />
                  <Legend />
                  <Bar dataKey="positive" name="Positive" fill="#16a34a" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="negative" name="Negative" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Two aggregate tables */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <AggregateTable title="Receivable Aggregate · Positive" tone="emerald" rows={posRows} loading={posLoading} error={posError} />
        <AggregateTable title="Receivable Aggregate · Negative" tone="rose"    rows={negRows} loading={negLoading} error={negError} />
      </div>
    </div>
  );
}

function AggregateTable({ title, tone, rows, loading, error }) {
  const totals = useMemo(() => {
    let open = 0, closed = 0;
    for (const r of rows) {
      open   += num(pick(r, 'ReceivableAmtOpenSales'));
      closed += num(pick(r, 'ReceivableAmtClosedSales'));
    }
    return { open, closed, total: open + closed };
  }, [rows]);

  const headerColor = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-rose-50 dark:bg-rose-950/30';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {loading ? 'Loading…'
            : error ? <span className="text-rose-500">{error.message}</span>
            : (
              <>
                {fmtNumber(rows.length)} day{rows.length !== 1 ? 's' : ''} ·
                <span className="ml-1 font-semibold text-fg">{fmtCurrency(totals.total)} total</span>
              </>
            )}
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className={cn('text-[11px] font-semibold uppercase tracking-wider text-muted-fg', headerColor)}>
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">PC</th>
                <th className="px-3 py-2 text-right">Open</th>
                <th className="px-3 py-2 text-right">Closed</th>
                <th className="px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-t border-border">
                    {[1, 2, 3, 4, 5].map(j => (
                      <td key={j} className="px-3 py-2">
                        <div className="h-4 rounded bg-muted/60 animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-fg">No records.</td></tr>
              ) : (
                rows.map((r, i) => {
                  const open   = num(pick(r, 'ReceivableAmtOpenSales'));
                  const closed = num(pick(r, 'ReceivableAmtClosedSales'));
                  return (
                    <tr key={i} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2 tabular-nums text-xs">{fmtDate(pick(r, 'BusinessDate'))}</td>
                      <td className="px-3 py-2 text-xs font-medium">{pick(r, 'SaleProfitCenter') || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(open, true)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(closed, true)}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtCurrency(open + closed, true)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {!loading && rows.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                  <td className="px-3 py-2 text-xs uppercase tracking-wider" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(totals.open, true)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(totals.closed, true)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(totals.total, true)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
