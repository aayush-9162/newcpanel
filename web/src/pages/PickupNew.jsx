// Modernized Delivery / Pickup page.
// Single SalesOpenDaily query feeds 10 client-side filter tabs + a Summary
// view that breaks deliverable / pickup sales down by store and stage.
import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Truck, Package, Building2, MapPin, CalendarDays, AlertTriangle,
  Download, RefreshCw, Eye, EyeOff, X, LayoutDashboard, Inbox, Globe2,
  Sunrise, Search,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery, runSql } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';

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

function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

function isoDate(d) {
  return d.toISOString().split('T')[0];
}

function tomorrowISO() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return isoDate(d);
}

function weekRange() {
  // Sunday-based: original uses `DATEPART(WEEKDAY, GETDATE())` which is Sunday=1.
  const today = new Date();
  const dow = today.getDay(); // Sun=0..Sat=6
  const start = new Date(today);
  if (dow === 0) start.setDate(today.getDate() + 1); // Sunday → start = Monday
  else start.setDate(today.getDate() - (dow - 1));   // else → start = Monday of this week
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start: isoDate(start), end: isoDate(end) };
}

// ─── tab filters (mirror the original SQL WHERE clauses) ──────────────────────
//
// Each filter receives a row (lowercased keys after our SELECT aliasing) and
// returns true/false. Names mirror the original SQL.

function isFullDeliverable(loc) {
  return r => pick(r, 'location') === loc
          && (pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '').includes('D')
          && !pick(r, 'casteddate')
          && (pick(r, 'delivery_state') || '') === 'NC'
          && (pick(r, 'ready_status')   || '') === 'Full';
}

function isScheduled(loc) {
  return r => pick(r, 'location') === loc
          && (pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '').includes('D')
          && !!pick(r, 'casteddate')
          && (pick(r, 'delivery_state') || '') === 'NC';
}

function isOutOfArea() {
  return r => {
    const dpf = (pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '');
    const state = (pick(r, 'delivery_state') || '');
    return (state !== 'NC' || dpf === 'D5') && dpf.includes('D');
  };
}

function isPartialDel(loc) {
  return r => pick(r, 'location') === loc
          && (pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '').includes('D')
          && (pick(r, 'delivery_state') || '') === 'NC'
          && !pick(r, 'casteddate')
          && (pick(r, 'ready_status') || '') !== 'Full';
}

function isReadyPickup(loc) {
  if (loc === '999') {
    return r => {
      const dpf = pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '';
      return dpf.endsWith('P') && (pick(r, 'ready_status') || '') === 'Full';
    };
  }
  const tag = loc === 'S1' ? 'P1' : 'P2';
  return r => pick(r, 'location') === loc
          && (pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '').includes(tag)
          && (pick(r, 'ready_status') || '') === 'Full';
}

function isPartialPickup(loc) {
  if (loc === '999') {
    return r => {
      const dpf = pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '';
      return dpf.includes('P') && (pick(r, 'ready_status') || '') !== 'Full';
    };
  }
  const tag = loc === 'S1' ? 'P1' : 'P2';
  return r => pick(r, 'location') === loc
          && (pick(r, 'DeliveryPendingFrom', 'deliverypendingfrom') || '').includes(tag)
          && (pick(r, 'ready_status') || '') !== 'Full';
}

// Tabs are organised into navigation groups. The shape matches what the
// rendering code expects (`id`, `label`, `filter`, `desc`) plus a `group` key.
const TABS = [
  // overview
  { id: 'summary',    label: 'Summary',  group: 'overview', icon: LayoutDashboard,
    desc: 'Breakdown of deliverable & pickup pipeline by store and stage' },
  { id: 'opensales',  label: 'All Open', group: 'overview', icon: Inbox,
    filter: () => true,
    desc: 'Every open sale awaiting delivery or pickup' },

  // delivery
  { id: 'dels1',      label: 'S1',       group: 'delivery', icon: Truck,
    filter: isFullDeliverable('S1'),
    desc: 'Fully deliverable, NC, S1, un-scheduled' },
  { id: 'dels2',      label: 'S2',       group: 'delivery', icon: Truck,
    filter: isFullDeliverable('S2'),
    desc: 'Fully deliverable, NC, S2, un-scheduled' },
  { id: 'outofarea',  label: 'Out of Area', group: 'delivery', icon: Globe2,
    filter: isOutOfArea(),
    desc: 'Delivery outside NC or D5 zone' },

  // pickup
  { id: 'pks1',       label: 'S1',       group: 'pickup', icon: Package,
    filter: isReadyPickup('S1'),
    desc: 'Ready for pickup at Arden (S1)' },
  { id: 'pks2',       label: 'S2',       group: 'pickup', icon: Package,
    filter: isReadyPickup('S2'),
    desc: 'Ready for pickup at Waynesville (S2)' },
  { id: 'pk999',      label: '999',      group: 'pickup', icon: Building2,
    filter: isReadyPickup('999'),
    desc: 'Ready for pickup at warehouse (999)' },

  // schedule
  { id: 'nextdaydel', label: 'Tomorrow', group: 'schedule', icon: Sunrise,
    filter: null,
    desc: 'Deliveries scheduled for tomorrow' },
  { id: 'weekelydel', label: 'This Week', group: 'schedule', icon: CalendarDays,
    filter: null,
    desc: 'Deliveries scheduled this week' },
];

const GROUPS = [
  { id: 'overview', label: null,        icon: null },
  { id: 'delivery', label: 'DELIVERY',  icon: Truck },
  { id: 'pickup',   label: 'PICKUP',    icon: Package },
  { id: 'schedule', label: 'SCHEDULE',  icon: CalendarDays },
];

// ─── SQL ──────────────────────────────────────────────────────────────────────

const BASE_SQL = `
  SELECT
    a.[SaleDate]                                            AS sale_date_raw,
    FORMAT(a.[SaleDate], 'MM/dd/yyyy')                      AS sale_date,
    a.[SalesNo]                                             AS sale_no,
    CASE WHEN LEFT(a.[SalesNo], 1) = '1' THEN 'S1' ELSE 'S2' END AS [location],
    TRY_CAST(a.[CustomerId] AS INT)                         AS cust_id,
    a.[CustomerName]                                        AS customer_name,
    a.[CustomerPhone]                                       AS phone_number,
    b.[cust_email]                                          AS cust_email,
    a.[DeliveryName]                                        AS delivery_name,
    a.[DeliveryAddr1]                                       AS delivery_addr1,
    a.[DeliveryAddr2]                                       AS delivery_addr2,
    a.[DeliveryCity]                                        AS delivery_city,
    a.[DeliveryState]                                       AS delivery_state,
    a.[DeliveryZip]                                         AS delivery_zip,
    a.[DeliveryStatus]                                      AS delivery_status,
    TRY_CAST(a.[DeliveryDate] AS DATE)                      AS casteddate,
    DATENAME(WEEKDAY, TRY_CAST(a.[DeliveryDate] AS DATE))   AS date_name,
    FORMAT(TRY_CAST(a.[DeliveryDate] AS DATE), 'MM/dd/yyyy') AS delivery_date,
    a.[DeliveryVia]                                         AS delivery_via,
    a.[DeliveryPendingFrom]                                 AS DeliveryPendingFrom,
    a.[ReadyStatus]                                         AS ready_status,
    a.[SaleAmt]                                             AS sale_amount,
    a.[SaleTaxAmt]                                          AS sale_tax_amount,
    a.[SaleTotalAmt]                                        AS sale_total,
    a.[DownPmt]                                             AS down_pymt,
    a.[DownPmtPercent]                                      AS down_pymt_percent,
    a.[BalanceDue]                                          AS balance_due,
    a.[SaleFinanceAmt]                                      AS sale_finance_amt,
    a.[ReceivableAmt]                                       AS receivable_amt,
    a.[Salesperson]                                         AS sales_person,
    a.[cfc],
    a.[usld],
    a.[terms],
    a.[age],
    a.[SaleRemarks]                                         AS sales_remarks,
    a.[sale_open_close]
  FROM [SalesOpenDaily] a
  LEFT JOIN dbo.CustMaster b ON b.cust_id = a.CustomerId
  WHERE a.[sale_open_close] = 'OPEN' AND a.[DeliveryVia] NOT LIKE '%S1%'
  ORDER BY a.[SaleDate] ASC
`;

// ─── sale-detail modal ────────────────────────────────────────────────────────

function SaleDetailModal({ saleNo, onClose }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);

  useMemo(() => {
    if (!saleNo) return;
    const sql = `
      SELECT [sale_no], [sale_loc] AS [loc],
        COALESCE(CAST(TRY_CAST([sale_item] AS int) AS varchar(20)), [sale_item]) AS [sale_item],
        [sale_desc], [sale_desc2], [sale_qty] AS [qty], [sale_qty_ret] AS [qty_return],
        [sale_price] AS Price, [sale_unit_cost] AS Cost
      FROM dbo.Sale_DetailRV WHERE sale_no = ?`;
    runSql(sql, [String(saleNo)])
      .then(r => setRows(r.rows ?? []))
      .catch(e => setError(e.message));
  }, [saleNo]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-4xl m-4 rounded-2xl bg-card border border-border shadow-2xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="text-base font-semibold text-fg">Sale Items</div>
            <div className="text-xs text-muted-fg font-mono">Sale #{saleNo}</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition">
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto flex-1">
          {!rows && !error ? (
            <div className="p-8 text-center text-sm text-muted-fg">Loading…</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-rose-500">{error}</div>
          ) : !rows.length ? (
            <div className="p-8 text-center text-sm text-muted-fg">No items found.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="border-b border-border">
                  {['Loc', 'Item', 'Description', 'Description 2', 'Qty', 'Returned', 'Price', 'Cost'].map(h =>
                    <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-fg whitespace-nowrap">{h}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/30">
                    <td className="px-3 py-2 font-medium">{pick(r, 'loc')}</td>
                    <td className="px-3 py-2 font-mono text-xs">{pick(r, 'sale_item')}</td>
                    <td className="px-3 py-2">{pick(r, 'sale_desc') || '—'}</td>
                    <td className="px-3 py-2 text-muted-fg">{pick(r, 'sale_desc2') || '—'}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{pick(r, 'qty')}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{pick(r, 'qty_return') || 0}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(num(pick(r, 'Price')), true)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-fg">{fmtCurrency(num(pick(r, 'Cost')), true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── summary cards ────────────────────────────────────────────────────────────

function StoreCard({ label, sublabel, accent, sections }) {
  const stripeMap = {
    primary: 'from-blue-500 to-blue-400',
    success: 'from-emerald-500 to-emerald-400',
    warning: 'from-amber-500 to-amber-400',
    info:    'from-sky-500 to-sky-400',
  };
  const textMap = {
    primary: 'text-blue-600 dark:text-blue-400',
    success: 'text-emerald-600 dark:text-emerald-400',
    warning: 'text-amber-600 dark:text-amber-400',
    info:    'text-sky-600 dark:text-sky-400',
  };

  const total = sections.reduce((s, x) => s + x.count, 0);
  const totalAmt = sections.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm transition hover:shadow-md">
      <div className={cn('h-1 bg-gradient-to-r', stripeMap[accent])} />
      <div className="p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className={cn('text-lg font-bold tracking-tight', textMap[accent])}>{label}</div>
            {sublabel && <div className="text-[11px] text-muted-fg">{sublabel}</div>}
          </div>
          <div className="text-right">
            <div className="num text-2xl font-bold tabular-nums">{fmtNumber(total)}</div>
            <div className="text-[11px] text-muted-fg num">{fmtCurrency(totalAmt)}</div>
          </div>
        </div>
        <div className="space-y-1">
          {sections.map(s => (
            <div key={s.label} className="flex items-center justify-between rounded-lg px-3 py-2 transition hover:bg-muted/40">
              <span className="text-[12px] text-muted-fg flex-1 pr-3">{s.label}</span>
              <span className="num font-semibold tabular-nums tracking-tight">{fmtNumber(s.count)}</span>
              <span className="num text-xs text-muted-fg ml-3 tabular-nums w-20 text-right">{fmtCurrency(s.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── tab button + grouped nav ─────────────────────────────────────────────────

function Tab({ active, onClick, icon: Icon, label, count }) {
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'group relative inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium transition outline-none',
        active
          ? 'bg-primary text-primary-fg shadow-sm shadow-primary/20'
          : 'text-muted-fg hover:bg-muted hover:text-fg',
      )}>
      {Icon && <Icon size={14} className={cn('shrink-0', active ? 'opacity-90' : 'opacity-70')} />}
      <span>{label}</span>
      {count != null && (
        <span className={cn(
          'inline-flex h-[18px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums',
          active ? 'bg-primary-fg/25 text-primary-fg' : 'bg-foreground/10 text-foreground/70 group-hover:bg-foreground/15',
        )}>{count}</span>
      )}
    </button>
  );
}

function GroupLabel({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 select-none">
      {Icon && <Icon size={11} className="text-muted-fg/50" />}
      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-muted-fg/60">{children}</span>
    </span>
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
              {g.label && <GroupLabel icon={g.icon}>{g.label}</GroupLabel>}
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

// ─── main page ────────────────────────────────────────────────────────────────

const DEFAULT_HIDDEN = new Set([
  'cust_id', 'cust_email', 'delivery_name', 'delivery_addr1', 'delivery_addr2', 'delivery_zip',
  'delivery_status', 'delivery_via', 'sale_amount', 'sale_tax_amount',
  'down_pymt', 'down_pymt_percent', 'sale_finance_amt', 'receivable_amt',
  'sales_person', 'cfc', 'usld', 'sale_open_close', 'date_name',
]);

export default function PickupNew() {
  const [tab, setTab]               = useState('summary');
  const [showAll, setShowAll]       = useState(false);
  const [globalQ, setGlobalQ]       = useState('');
  const [detailSale, setDetailSale] = useState(null);

  const qc = useQueryClient();
  const dataQ = useSqlQuery(BASE_SQL, []);
  const allRows = useMemo(() => dataQ.data?.rows ?? [], [dataQ.data]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['sql'] });

  // Filtered rows for the active tab
  const filteredRows = useMemo(() => {
    if (tab === 'summary') return [];
    if (tab === 'nextdaydel') {
      const tmr = tomorrowISO();
      return allRows.filter(r => {
        const cd = pick(r, 'casteddate');
        const dpf = pick(r, 'DeliveryPendingFrom') || '';
        if (!cd || !dpf.includes('D')) return false;
        return isoDate(new Date(cd)) === tmr;
      });
    }
    if (tab === 'weekelydel') {
      const { start, end } = weekRange();
      return allRows.filter(r => {
        const cd = pick(r, 'casteddate');
        const dpf = pick(r, 'DeliveryPendingFrom') || '';
        if (!cd || !dpf.startsWith('D')) return false;
        const iso = isoDate(new Date(cd));
        return iso >= start && iso <= end;
      });
    }
    const tabDef = TABS.find(t => t.id === tab);
    if (!tabDef?.filter) return allRows;
    return allRows.filter(tabDef.filter);
  }, [allRows, tab]);

  // Apply global free-text search on top
  const visibleRows = useMemo(() => {
    if (!globalQ.trim()) return filteredRows;
    const needle = globalQ.toLowerCase().trim();
    return filteredRows.filter(r =>
      Object.values(r).some(v => v != null && String(v).toLowerCase().includes(needle))
    );
  }, [filteredRows, globalQ]);

  // KPIs from full set
  const kpi = useMemo(() => {
    let count = 0, totalValue = 0, delPending = 0, pickupPending = 0;
    for (const r of allRows) {
      count++;
      totalValue += num(pick(r, 'sale_total'));
      const dpf = (pick(r, 'DeliveryPendingFrom') || '');
      if (dpf.includes('D')) delPending++;
      if (dpf.includes('P')) pickupPending++;
    }
    return { count, totalValue, delPending, pickupPending };
  }, [allRows]);

  // Tab counts (for badges in pill)
  const tabCounts = useMemo(() => {
    const out = {};
    for (const t of TABS) {
      if (t.id === 'summary') continue;
      if (t.id === 'opensales') { out[t.id] = allRows.length; continue; }
      if (t.id === 'nextdaydel') {
        const tmr = tomorrowISO();
        out[t.id] = allRows.filter(r => {
          const cd = pick(r, 'casteddate');
          const dpf = pick(r, 'DeliveryPendingFrom') || '';
          if (!cd || !dpf.includes('D')) return false;
          return isoDate(new Date(cd)) === tmr;
        }).length;
        continue;
      }
      if (t.id === 'weekelydel') {
        const { start, end } = weekRange();
        out[t.id] = allRows.filter(r => {
          const cd = pick(r, 'casteddate');
          const dpf = pick(r, 'DeliveryPendingFrom') || '';
          if (!cd || !dpf.startsWith('D')) return false;
          const iso = isoDate(new Date(cd));
          return iso >= start && iso <= end;
        }).length;
        continue;
      }
      out[t.id] = allRows.filter(t.filter).length;
    }
    return out;
  }, [allRows]);

  // Summary breakdown
  const summary = useMemo(() => {
    const bucket = (filterFn) => {
      let count = 0, amount = 0;
      for (const r of allRows) {
        if (!filterFn(r)) continue;
        count++;
        amount += num(pick(r, 'sale_total'));
      }
      return { count, amount };
    };
    return {
      delS1Full:     bucket(isFullDeliverable('S1')),
      delS2Full:     bucket(isFullDeliverable('S2')),
      delOutFull:    bucket(r => isOutOfArea()(r) && !pick(r, 'casteddate')),
      delS1Sched:    bucket(isScheduled('S1')),
      delS2Sched:    bucket(isScheduled('S2')),
      delOutSched:   bucket(r => isOutOfArea()(r) && !!pick(r, 'casteddate')),
      delS1Partial:  bucket(isPartialDel('S1')),
      delS2Partial:  bucket(isPartialDel('S2')),
      delOutPartial: bucket(r => {
        const dpf = pick(r, 'DeliveryPendingFrom') || '';
        return dpf.includes('D')
          && (pick(r, 'delivery_state') || '') !== 'NC'
          && !pick(r, 'casteddate')
          && (pick(r, 'ready_status') || '') !== 'Full';
      }),
      pkS1Ready:     bucket(isReadyPickup('S1')),
      pkS2Ready:     bucket(isReadyPickup('S2')),
      pk999Ready:    bucket(isReadyPickup('999')),
      pkS1Partial:   bucket(isPartialPickup('S1')),
      pkS2Partial:   bucket(isPartialPickup('S2')),
      pk999Partial:  bucket(isPartialPickup('999')),
    };
  }, [allRows]);

  // Columns
  const cols = useMemo(() => {
    const all = [
      { id: 'sale_date', accessorFn: r => pick(r, 'sale_date_raw'), header: 'Sale Date',
        cell: ({ row }) => <span className="tabular-nums text-xs">{pick(row.original, 'sale_date') || fmtDate(pick(row.original, 'sale_date_raw'))}</span> },
      { id: 'sale_no', accessorFn: r => pick(r, 'sale_no'), header: 'Sale #',
        cell: ({ getValue }) => (
          <button onClick={() => setDetailSale(getValue())}
            className="font-mono text-xs text-primary hover:underline" title="View item details">
            {getValue()}
          </button>
        ) },
      { id: 'location', accessorFn: r => pick(r, 'location'), header: 'Loc',
        cell: ({ getValue }) => (
          <span className={cn('inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold',
            getValue() === 'S1' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200')}>
            {getValue() || '—'}
          </span>
        ) },
      { id: 'cust_id', accessorFn: r => pick(r, 'cust_id'), header: 'Cust ID',
        cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
      { id: 'customer_name', accessorFn: r => pick(r, 'customer_name'), header: 'Customer',
        cell: ({ getValue, row }) => (
          <div>
            <div className="font-medium">{getValue() || '—'}</div>
            <div className="text-[10px] text-muted-fg">{pick(row.original, 'phone_number')}</div>
          </div>
        ) },
      { id: 'phone_number', accessorFn: r => pick(r, 'phone_number'), header: 'Phone' },
      { id: 'cust_email', accessorFn: r => pick(r, 'cust_email'), header: 'Email',
        cell: ({ getValue }) => getValue() ? <a href={`mailto:${getValue()}`} className="text-primary hover:underline text-xs">{getValue()}</a> : <span className="text-muted-fg">—</span> },
      { id: 'delivery_name', accessorFn: r => pick(r, 'delivery_name'), header: 'Deliver To' },
      { id: 'delivery_addr1', accessorFn: r => pick(r, 'delivery_addr1'), header: 'Addr 1' },
      { id: 'delivery_addr2', accessorFn: r => pick(r, 'delivery_addr2'), header: 'Addr 2' },
      { id: 'delivery_city', accessorFn: r => pick(r, 'delivery_city'), header: 'City' },
      { id: 'delivery_state', accessorFn: r => pick(r, 'delivery_state'), header: 'State',
        cell: ({ getValue }) => <span className="font-medium tracking-wider">{getValue() || '—'}</span> },
      { id: 'delivery_zip', accessorFn: r => pick(r, 'delivery_zip'), header: 'Zip' },
      { id: 'delivery_status', accessorFn: r => pick(r, 'delivery_status'), header: 'Del Status' },
      { id: 'delivery_date', accessorFn: r => pick(r, 'delivery_date'), header: 'Delivery',
        cell: ({ getValue, row }) => {
          const v = getValue();
          if (!v) return <span className="text-muted-fg italic text-xs">unscheduled</span>;
          return (
            <div className="text-xs">
              <div className="tabular-nums">{v}</div>
              {tab === 'weekelydel' && pick(row.original, 'date_name') && (
                <div className="text-[10px] text-muted-fg">{pick(row.original, 'date_name')}</div>
              )}
            </div>
          );
        } },
      { id: 'delivery_via', accessorFn: r => pick(r, 'delivery_via'), header: 'Via' },
      { id: 'DeliveryPendingFrom', accessorFn: r => pick(r, 'DeliveryPendingFrom'), header: 'Pending',
        cell: ({ getValue }) => <span className="font-mono text-[11px]">{getValue() || '—'}</span> },
      { id: 'ready_status', accessorFn: r => pick(r, 'ready_status'), header: 'Ready',
        cell: ({ getValue }) => {
          const v = getValue();
          if (!v) return <span className="text-muted-fg">—</span>;
          return (
            <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
              v === 'Full' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200')}>
              {v}
            </span>
          );
        } },
      { id: 'sale_amount', accessorFn: r => num(pick(r, 'sale_amount')), header: 'Amount',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'sale_tax_amount', accessorFn: r => num(pick(r, 'sale_tax_amount')), header: 'Tax',
        cell: ({ getValue }) => <span className="tabular-nums text-muted-fg">{fmtCurrency(getValue(), true)}</span> },
      { id: 'sale_total', accessorFn: r => num(pick(r, 'sale_total')), header: 'Total',
        cell: ({ getValue }) => <span className="tabular-nums font-semibold">{fmtCurrency(getValue(), true)}</span> },
      { id: 'down_pymt', accessorFn: r => num(pick(r, 'down_pymt')), header: 'Down',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'down_pymt_percent', accessorFn: r => pick(r, 'down_pymt_percent'), header: 'Down %' },
      { id: 'balance_due', accessorFn: r => num(pick(r, 'balance_due')), header: 'Balance',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'sale_finance_amt', accessorFn: r => num(pick(r, 'sale_finance_amt')), header: 'Finance',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'receivable_amt', accessorFn: r => num(pick(r, 'receivable_amt')), header: 'Receivable',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'sales_person', accessorFn: r => pick(r, 'sales_person'), header: 'Sales' },
      { id: 'cfc', accessorFn: r => num(pick(r, 'cfc')), header: 'CFC',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'usld', accessorFn: r => num(pick(r, 'usld')), header: 'USLD',
        cell: ({ getValue }) => <span className="tabular-nums">{fmtCurrency(getValue(), true)}</span> },
      { id: 'terms', accessorFn: r => pick(r, 'terms'), header: 'Terms',
        cell: ({ getValue }) => {
          const v = getValue();
          if (v === 'COD') return <span className="rounded-full bg-yellow-200/80 dark:bg-yellow-900/40 px-2 py-0.5 text-[10px] font-bold text-yellow-800 dark:text-yellow-200">COD</span>;
          return v || '—';
        } },
      { id: 'age', accessorFn: r => num(pick(r, 'age')), header: 'Age',
        cell: ({ getValue }) => {
          const v = getValue();
          return <span className={cn('tabular-nums font-semibold',
            v > 60 ? 'text-rose-600 dark:text-rose-400'
            : v > 30 ? 'text-amber-600 dark:text-amber-400' : '')}>{v}d</span>;
        } },
      { id: 'sales_remarks', accessorFn: r => pick(r, 'sales_remarks'), header: 'Remarks',
        cell: ({ getValue }) => <span className="block max-w-[280px] truncate text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
      { id: 'sale_open_close', accessorFn: r => pick(r, 'sale_open_close'), header: 'Status' },
    ];
    return showAll ? all : all.filter(c => !DEFAULT_HIDDEN.has(c.id));
  }, [showAll, tab]);

  const activeTabDef = TABS.find(t => t.id === tab);
  const subtitle = `${fmtNumber(kpi.count)} open sales · ${fmtCurrency(kpi.totalValue)} pipeline`;

  return (
    <>
      <Topbar title="Delivery & Pickup" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ── hero banner ── */}
        <HeroBanner icon={Truck} decorIcon={Package} accent="emerald">
          <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-300">
            Open Pipeline
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-emerald-600 to-teal-500 bg-clip-text text-transparent">
              {fmtCompactCurrency(kpi.totalValue)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
              <Inbox size={14} /> {fmtNumber(kpi.count)} sales
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{fmtNumber(kpi.delPending)}</strong> awaiting delivery · <strong className="text-fg">{fmtNumber(kpi.pickupPending)}</strong> awaiting pickup
          </div>
        </HeroBanner>

        {/* ── eye-catching hero stats ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Open Sales"
            value={fmtNumber(kpi.count)}
            icon={Inbox}
            accent="primary"
            subtitle="Awaiting delivery or pickup"
            loading={dataQ.isLoading}
          />
          <HeroStat
            label="Pipeline Value"
            value={fmtCompactCurrency(kpi.totalValue)}
            fullValue={fmtCurrency(kpi.totalValue)}
            icon={Building2}
            accent="emerald"
            subtitle={kpi.count ? `${fmtCompactCurrency(kpi.totalValue / Math.max(kpi.count, 1))} avg per sale` : null}
            loading={dataQ.isLoading}
          />
          <HeroStat
            label="Pending Delivery"
            value={fmtNumber(kpi.delPending)}
            icon={Truck}
            accent="sky"
            subtitle={kpi.count ? `${((kpi.delPending / Math.max(kpi.count, 1)) * 100).toFixed(0)}% of total` : null}
            loading={dataQ.isLoading}
          />
          <HeroStat
            label="Pending Pickup"
            value={fmtNumber(kpi.pickupPending)}
            icon={MapPin}
            accent="amber"
            subtitle={kpi.count ? `${((kpi.pickupPending / Math.max(kpi.count, 1)) * 100).toFixed(0)}% of total` : null}
            loading={dataQ.isLoading}
          />
        </div>

        {/* ── grouped tab navigation ── */}
        <TabsNav tab={tab} setTab={setTab} tabCounts={tabCounts} />

        {/* ── filter bar (only for data tabs) ── */}
        {tab !== 'summary' && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
              <div className="relative flex-1 min-w-[220px] max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
                <Input value={globalQ} onChange={e => setGlobalQ(e.target.value)}
                  placeholder="Search by customer, phone, address…" className="pl-8" />
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowAll(s => !s)}>
                {showAll ? <><EyeOff size={14} /> Compact view</> : <><Eye size={14} /> View all columns</>}
              </Button>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 dark:bg-yellow-900/30 px-2.5 py-0.5 text-[11px] font-medium text-yellow-800 dark:text-yellow-200">
                <span className="inline-block h-2 w-2 rounded-full bg-yellow-400" />
                COD rows highlighted
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm"
                  onClick={() => rowsToCSV(visibleRows, `pickup-${tab}.csv`)}
                  disabled={!visibleRows.length}>
                  <Download size={14} /> Export
                </Button>
                <Button variant="outline" size="sm" onClick={refresh} title="Refresh">
                  <RefreshCw size={14} />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── content ── */}
        {tab === 'summary' ? (
          <SummaryView summary={summary} loading={dataQ.isLoading} />
        ) : (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{activeTabDef?.label}</CardTitle>
                <CardDescription>
                  {dataQ.isLoading ? 'Loading…' : (
                    <>
                      <span className="font-semibold text-fg">{fmtNumber(visibleRows.length)}</span> records
                      <span className="text-muted-fg/70"> · {activeTabDef?.desc}</span>
                    </>
                  )}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <DataTable
                data={visibleRows}
                columns={cols}
                loading={dataQ.isLoading}
                pageSize={50}
                emptyText={dataQ.error ? `Error: ${dataQ.error.message}` : 'No records.'}
              />
            </CardContent>
          </Card>
        )}
      </div>

      {detailSale && <SaleDetailModal saleNo={detailSale} onClose={() => setDetailSale(null)} />}
    </>
  );
}

// ─── summary view ─────────────────────────────────────────────────────────────

function SummaryView({ summary, loading }) {
  if (loading) {
    return (
      <div className="space-y-5">
        {[1,2].map(i => (
          <div key={i} className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {[1,2,3].map(j => <div key={j} className="h-44 rounded-2xl bg-muted/60 animate-pulse" />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <Truck size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">Deliverable Sales</h3>
              <p className="text-xs text-muted-fg">Sales pending delivery, broken out by store and stage</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StoreCard label="S1" sublabel="Arden" accent="primary" sections={[
            { label: 'Fully deliverable · un-scheduled',  ...summary.delS1Full },
            { label: 'Scheduled',                          ...summary.delS1Sched },
            { label: 'Open · partial inventory',           ...summary.delS1Partial },
          ]} />
          <StoreCard label="S2" sublabel="Waynesville" accent="success" sections={[
            { label: 'Fully deliverable · un-scheduled',  ...summary.delS2Full },
            { label: 'Scheduled',                          ...summary.delS2Sched },
            { label: 'Open · partial inventory',           ...summary.delS2Partial },
          ]} />
          <StoreCard label="Out of Area" sublabel="Outside NC" accent="warning" sections={[
            { label: 'Fully deliverable · un-scheduled',  ...summary.delOutFull },
            { label: 'Scheduled',                          ...summary.delOutSched },
            { label: 'Open · partial inventory',           ...summary.delOutPartial },
          ]} />
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500">
              <Package size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">Pickup Sales</h3>
              <p className="text-xs text-muted-fg">Sales pending customer pickup, by location</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StoreCard label="S1" sublabel="Arden" accent="primary" sections={[
            { label: 'Ready for pickup',         ...summary.pkS1Ready },
            { label: 'Open · partial inventory', ...summary.pkS1Partial },
          ]} />
          <StoreCard label="S2" sublabel="Waynesville" accent="success" sections={[
            { label: 'Ready for pickup',         ...summary.pkS2Ready },
            { label: 'Open · partial inventory', ...summary.pkS2Partial },
          ]} />
          <StoreCard label="999" sublabel="Warehouse" accent="info" sections={[
            { label: 'Ready for pickup',         ...summary.pk999Ready },
            { label: 'Open · partial inventory', ...summary.pk999Partial },
          ]} />
        </div>
      </section>
    </div>
  );
}
