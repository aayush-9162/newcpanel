// Hot Button Issues — issue tracking across the business.
//
// Pulls from three MySQL issue tables (hotbutton_issues, store_sales_issues,
// weborders) plus MS SQL SalesOpenDaily for the open-sales lookup tab.
//
// Layout:
//   - Headline KPIs (counts of open issues per category)
//   - Grouped tab navigation (Overview · Active Issues · Closed)
//   - Tab content: summary cards, sales-search table, or filtered issue list
import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Flame, AlertTriangle, Globe, Inbox, CheckCircle2, Archive,
  Search, Download, RefreshCw, X, Phone,
  LayoutDashboard,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { KpiCard } from '@/components/KpiCard';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber } from '@/lib/format';
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

function fmtPhone(v) {
  if (!v) return '';
  const digits = String(v).replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
  return v;
}

function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return v;
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function daysSince(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

// ─── SQL ──────────────────────────────────────────────────────────────────────

const HOTBUTTON_OPEN_SQL = `
  SELECT
    h.id,
    h.concern_type,
    COALESCE(e.name, h.sales_person) AS sales_person,
    h.store,
    DATE_FORMAT(h.sale_date,   '%Y-%m-%d') AS sale_date,
    DATE_FORMAT(h.created_at,  '%Y-%m-%d') AS created_on,
    h.sale_number,
    h.customer_name,
    h.customer_contact AS contact,
    h.description,
    h.steps_taken,
    h.rv_remarks,
    h.current_status,
    h.attended_by,
    h.remarks
  FROM hotbutton_issues h
  LEFT JOIN employees e ON e.rv_code = h.sales_person
  WHERE h.is_resolved = false
  ORDER BY h.id DESC
`;

const HOTBUTTON_RESOLVED_SQL = `
  SELECT
    h.id,
    h.concern_type,
    COALESCE(e.name, h.sales_person) AS sales_person,
    h.store,
    DATE_FORMAT(h.sale_date,   '%Y-%m-%d') AS sale_date,
    DATE_FORMAT(h.updated_at,  '%Y-%m-%d') AS resolved_on,
    h.sale_number,
    h.customer_name,
    h.description,
    h.steps_taken,
    h.current_status,
    h.remarks
  FROM hotbutton_issues h
  LEFT JOIN employees e ON e.rv_code = h.sales_person
  WHERE h.is_resolved = true AND h.is_archived = false
  ORDER BY h.id DESC
`;

const STORE_ISSUES_SQL = `
  SELECT
    s.id,
    s.store,
    DATE_FORMAT(s.sale_date,  '%Y-%m-%d') AS sale_date,
    DATE_FORMAT(s.created_at, '%Y-%m-%d') AS created_on,
    s.sale_number,
    s.customer_name,
    s.customer_id,
    s.customer_contact AS contact,
    s.vendor,
    s.issue_description,
    s.rv_remarks,
    s.steps_taken,
    s.current_status,
    s.remarks
  FROM store_sales_issues s
  WHERE s.store = ? AND s.is_resolved = false
  ORDER BY s.id DESC
`;

const STORE_ISSUES_RESOLVED_SQL = `
  SELECT
    s.id,
    s.store,
    DATE_FORMAT(s.sale_date,  '%Y-%m-%d') AS sale_date,
    DATE_FORMAT(s.updated_at, '%Y-%m-%d') AS resolved_on,
    s.sale_number,
    s.customer_name,
    s.vendor,
    s.issue_description,
    s.current_status
  FROM store_sales_issues s
  WHERE s.is_resolved = true
  ORDER BY s.id DESC
`;

const WEBORDERS_SQL = `
  SELECT
    w.id,
    DATE_FORMAT(w.order_date,  '%Y-%m-%d') AS order_date,
    DATE_FORMAT(w.created_at,  '%Y-%m-%d') AS created_on,
    w.sale_number,
    w.customer_name,
    w.store,
    w.description,
    w.remarks
  FROM weborders w
  ORDER BY w.id DESC
`;

const ARCHIVED_SQL = `
  SELECT
    h.id,
    'Hot Button' AS source,
    h.store,
    DATE_FORMAT(h.sale_date,  '%Y-%m-%d') AS sale_date,
    DATE_FORMAT(h.updated_at, '%Y-%m-%d') AS archived_on,
    h.sale_number,
    h.customer_name,
    h.description,
    h.current_status
  FROM hotbutton_issues h
  WHERE h.is_archived = true
  ORDER BY h.id DESC
`;

// MS SQL — open sales lookup table (used for the All Open Sales tab + search).
const OPEN_SALES_SQL = `
  SELECT
    FORMAT([SaleDate], 'yyyy-MM-dd') AS sale_date,
    [SalesNo]                        AS sale_no,
    CASE
      WHEN LEFT([SalesNo], 1) = '1' THEN 'S1'
      WHEN LEFT([SalesNo], 1) = '2' THEN 'S2'
      ELSE '555'
    END                              AS store,
    TRY_CAST([CustomerId] AS int)    AS customer_id,
    [CustomerName]                   AS customer_name,
    [CustomerPhone]                  AS contact,
    [DeliveryAddr1]                  AS delivery_addr1,
    [DeliveryCity]                   AS delivery_city,
    [DeliveryState]                  AS delivery_state,
    [DeliveryZip]                    AS delivery_zip,
    [DeliveryStatus]                 AS delivery_status,
    [DeliveryDate]                   AS delivery_date,
    [DeliveryPendingFrom]            AS delivery_pending,
    [ReadyStatus]                    AS ready_status,
    [SaleTotalAmt]                   AS sale_total,
    [BalanceDue]                     AS balance_due,
    [Salesperson]                    AS sales_person,
    [Terms]                          AS terms,
    [Age]                            AS age,
    [SaleRemarks]                    AS sales_remarks
  FROM SalesOpenDaily
  WHERE sale_open_close = 'OPEN'
  ORDER BY [SaleDate] DESC
`;

// ─── badges ───────────────────────────────────────────────────────────────────

function StoreBadge({ value }) {
  if (!value) return <span className="text-muted-fg">—</span>;
  const v = String(value).toUpperCase();
  const tone = v === 'S1'
    ? 'bg-blue-100    text-blue-700    dark:bg-blue-900/40    dark:text-blue-200'
    : v === 'S2'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
    : 'bg-slate-100  text-slate-700  dark:bg-slate-800/60  dark:text-slate-200';
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold', tone)}>{v}</span>;
}

function ConcernBadge({ value }) {
  if (!value) return <span className="text-muted-fg text-xs">—</span>;
  const v = String(value).toUpperCase();
  const isHot = v.includes('HOT');
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
      isHot
        ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200'
        : 'bg-sky-100  text-sky-700  dark:bg-sky-900/40  dark:text-sky-200',
    )}>
      {isHot && <Flame size={10} />} {value}
    </span>
  );
}

function AgeBadge({ days }) {
  if (days == null) return <span className="text-muted-fg text-xs">—</span>;
  const tone = days > 14 ? 'text-rose-600 dark:text-rose-400'
             : days > 7  ? 'text-amber-600 dark:text-amber-400'
             : 'text-emerald-600 dark:text-emerald-400';
  return <span className={cn('text-xs font-semibold tabular-nums', tone)}>{days}d</span>;
}

// ─── tab navigation ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'summary',    label: 'Summary',       group: 'overview', icon: LayoutDashboard, description: 'Issue counts at a glance' },
  { id: 'opensales',  label: 'All Open Sales', group: 'overview', icon: Inbox,           description: 'Browse open sales · search to create issues' },

  { id: 'hotbutton',  label: 'Hot Button',     group: 'active', icon: Flame,         description: 'Active hot button issues across stores' },
  { id: 'issue-s1',   label: 'Arden (S1)',     group: 'active', icon: AlertTriangle, description: 'Open store issues at Arden' },
  { id: 'issue-s2',   label: 'Waynesville (S2)', group: 'active', icon: AlertTriangle, description: 'Open store issues at Waynesville' },
  { id: 'weborders',  label: 'Web Orders',     group: 'active', icon: Globe,         description: 'Web order escalations' },

  { id: 'resolved-hb',  label: 'Resolved Hot Button', group: 'closed', icon: CheckCircle2, description: 'Hot button issues marked resolved' },
  { id: 'resolved-store', label: 'Resolved Store',     group: 'closed', icon: CheckCircle2, description: 'Store issues marked resolved' },
  { id: 'archived',     label: 'Archived',           group: 'closed', icon: Archive,      description: 'Archived issues (long-term storage)' },
];

const GROUPS = [
  { id: 'overview', label: null,            icon: null },
  { id: 'active',   label: 'ACTIVE ISSUES', icon: Flame },
  { id: 'closed',   label: 'CLOSED',        icon: CheckCircle2 },
];

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

// ─── eye-catching stat tiles ──────────────────────────────────────────────────

const STAT_PALETTE = {
  rose:    {
    surface: 'from-rose-500/20 via-rose-500/10 to-transparent dark:from-rose-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(244,63,94,0.45)]',
    iconBg:  'bg-gradient-to-br from-rose-500 to-rose-600',
    iconRing: 'ring-rose-500/30',
    text:    'text-rose-600 dark:text-rose-300',
    accent:  'bg-rose-500',
    border:  'border-rose-500/40',
  },
  amber:   {
    surface: 'from-amber-500/20 via-amber-500/10 to-transparent dark:from-amber-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(245,158,11,0.45)]',
    iconBg:  'bg-gradient-to-br from-amber-500 to-orange-500',
    iconRing: 'ring-amber-500/30',
    text:    'text-amber-600 dark:text-amber-300',
    accent:  'bg-amber-500',
    border:  'border-amber-500/40',
  },
  sky:     {
    surface: 'from-sky-500/20 via-sky-500/10 to-transparent dark:from-sky-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(14,165,233,0.45)]',
    iconBg:  'bg-gradient-to-br from-sky-500 to-cyan-500',
    iconRing: 'ring-sky-500/30',
    text:    'text-sky-600 dark:text-sky-300',
    accent:  'bg-sky-500',
    border:  'border-sky-500/40',
  },
  violet:  {
    surface: 'from-violet-500/20 via-violet-500/10 to-transparent dark:from-violet-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(139,92,246,0.45)]',
    iconBg:  'bg-gradient-to-br from-violet-500 to-purple-500',
    iconRing: 'ring-violet-500/30',
    text:    'text-violet-600 dark:text-violet-300',
    accent:  'bg-violet-500',
    border:  'border-violet-500/40',
  },
  emerald: {
    surface: 'from-emerald-500/20 via-emerald-500/10 to-transparent dark:from-emerald-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(16,185,129,0.45)]',
    iconBg:  'bg-gradient-to-br from-emerald-500 to-teal-500',
    iconRing: 'ring-emerald-500/30',
    text:    'text-emerald-600 dark:text-emerald-300',
    accent:  'bg-emerald-500',
    border:  'border-emerald-500/40',
  },
  slate:   {
    surface: 'from-slate-500/15 via-slate-500/10 to-transparent dark:from-slate-500/20',
    glow:    'shadow-[0_8px_30px_-12px_rgba(100,116,139,0.35)]',
    iconBg:  'bg-gradient-to-br from-slate-500 to-slate-600',
    iconRing: 'ring-slate-500/30',
    text:    'text-slate-700 dark:text-slate-300',
    accent:  'bg-slate-500',
    border:  'border-slate-500/40',
  },
};

// HeroStat — large attention-grabbing number with gradient background, glow,
// gradient icon tile, and an animated dot for urgent items.
function HeroStat({ label, count, icon: Icon, accent = 'sky', subtitle, urgent, loading, onClick }) {
  const p = STAT_PALETTE[accent] || STAT_PALETTE.sky;
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-card text-left transition-all duration-300',
        p.border, p.glow,
        onClick && 'hover:-translate-y-1 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)] cursor-pointer',
      )}
    >
      {/* Gradient surface */}
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-90', p.surface)} />
      {/* Decorative oversized icon faintly in the corner */}
      <div className="absolute -bottom-4 -right-4 opacity-[0.06] dark:opacity-[0.08]">
        <Icon size={120} strokeWidth={1.5} />
      </div>

      <div className="relative p-5 flex items-start gap-4">
        <div className={cn(
          'grid h-12 w-12 place-items-center rounded-xl shrink-0 text-white shadow-lg ring-2 ring-offset-0',
          p.iconBg, p.iconRing,
        )}>
          <Icon size={20} strokeWidth={2.25} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">{label}</span>
            {urgent && count > 0 && (
              <span className="relative flex h-2 w-2">
                <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', p.accent)} />
                <span className={cn('relative inline-flex h-2 w-2 rounded-full', p.accent)} />
              </span>
            )}
          </div>
          <div className={cn('mt-1 text-4xl font-extrabold tabular-nums tracking-tight leading-none', p.text)}>
            {loading ? <span className="inline-block h-9 w-20 rounded bg-muted/60 animate-pulse align-middle" /> : fmtNumber(count)}
          </div>
          {subtitle && <div className="text-[11px] text-muted-fg mt-2 truncate">{subtitle}</div>}
        </div>
      </div>
    </Wrapper>
  );
}

// SummaryCard — used in the Summary tab. Larger, with a progress bar showing
// share of total active issues.
function SummaryCard({ label, count, icon: Icon, accent, description, onClick, totalActive, urgent }) {
  const p = STAT_PALETTE[accent] || STAT_PALETTE.sky;
  const sharePercent = totalActive > 0 ? Math.min(100, (count / totalActive) * 100) : 0;
  return (
    <button type="button" onClick={onClick}
      className={cn(
        'group relative text-left overflow-hidden rounded-2xl border bg-card transition-all duration-300',
        p.border, p.glow,
        'hover:-translate-y-1 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)]',
      )}>
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-80 group-hover:opacity-100 transition-opacity', p.surface)} />
      <div className="absolute -bottom-6 -right-6 opacity-[0.07]">
        <Icon size={140} strokeWidth={1.5} />
      </div>

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className={cn(
            'grid h-11 w-11 place-items-center rounded-xl text-white shadow-lg ring-2',
            p.iconBg, p.iconRing,
          )}>
            <Icon size={20} strokeWidth={2.25} />
          </div>
          {urgent && count > 0 && (
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white animate-pulse',
              p.accent,
            )}>
              <Flame size={10} /> URGENT
            </span>
          )}
        </div>

        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
        <div className={cn('mt-0.5 text-4xl font-extrabold tabular-nums tracking-tight leading-none', p.text)}>
          {fmtNumber(count)}
        </div>
        <div className="text-[11px] text-muted-fg mt-1.5 line-clamp-1">{description}</div>

        {totalActive > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-fg mb-1">
              <span>{sharePercent.toFixed(0)}% of active</span>
              <span className="font-semibold">→</span>
            </div>
            <div className="relative h-1.5 rounded-full bg-foreground/10 overflow-hidden">
              <div className={cn('absolute inset-y-0 left-0 rounded-full transition-all duration-500', p.accent)}
                style={{ width: `${sharePercent}%` }} />
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

// CriticalIssuesFeed — show the most pressing items right on the summary tab.
// Lists active hot button issues sorted by age, with vivid age badges.
function CriticalIssuesFeed({ rows, onPick }) {
  if (!rows.length) {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-8 text-center">
          <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/10 text-emerald-500">
            <CheckCircle2 size={26} />
          </div>
          <p className="text-sm font-semibold">All clear — no active hot button issues.</p>
          <p className="text-xs text-muted-fg mt-1">When new issues arrive they'll appear here, sorted by urgency.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-rose-500/10 via-rose-500/5 to-transparent border-b border-border">
        <CardTitle className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-md">
            <Flame size={14} />
          </span>
          Most Critical · Top {Math.min(rows.length, 6)}
        </CardTitle>
        <CardDescription>Active hot button issues sorted by age — oldest first</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-border">
          {rows.map((r, i) => {
            const age = daysSince(pick(r, 'created_on'));
            const ageTone = age == null ? 'slate'
                          : age > 14 ? 'rose'
                          : age > 7  ? 'amber'
                          : 'emerald';
            const ageBg = ageTone === 'rose'   ? 'bg-gradient-to-br from-rose-500 to-rose-600 text-white shadow-rose-500/30'
                        : ageTone === 'amber'  ? 'bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-amber-500/30'
                        : ageTone === 'slate'  ? 'bg-gradient-to-br from-slate-500 to-slate-600 text-white shadow-slate-500/30'
                        : 'bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-emerald-500/30';
            return (
              <button key={r.id || i} type="button" onClick={() => onPick && onPick()}
                className="w-full flex items-center gap-3 p-4 text-left transition hover:bg-muted/30">
                <div className={cn('flex flex-col items-center justify-center h-14 w-14 rounded-xl shadow-md shrink-0', ageBg)}>
                  <span className="text-xl font-extrabold tabular-nums leading-none">{age ?? '—'}</span>
                  <span className="text-[9px] font-semibold uppercase tracking-wider opacity-90 mt-0.5">days</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold text-primary">#{pick(r, 'sale_number')}</span>
                    <StoreBadge value={pick(r, 'store')} />
                    <ConcernBadge value={pick(r, 'concern_type')} />
                  </div>
                  <div className="mt-1 font-semibold text-sm truncate">{pick(r, 'customer_name') || '—'}</div>
                  <div className="text-xs text-muted-fg line-clamp-1 mt-0.5">{pick(r, 'description') || 'No description'}</div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-[11px] text-muted-fg">Salesperson</div>
                  <div className="text-xs font-medium">{pick(r, 'sales_person') || '—'}</div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function HotButtonIssues() {
  const [tab, setTab]               = useState('summary');
  const [globalSearch, setSearch]   = useState('');
  const [debouncedSearch, setDebSearch] = useState('');

  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['mysql'] });
    qc.invalidateQueries({ queryKey: ['sql'] });
  };

  useEffect(() => {
    const handle = setTimeout(() => setDebSearch(globalSearch.trim().toLowerCase()), 250);
    return () => clearTimeout(handle);
  }, [globalSearch]);

  // ── load every dataset once (small data, MySQL is fast) ──
  const hotbuttonOpenQ      = useMysqlQuery(HOTBUTTON_OPEN_SQL,      []);
  const hotbuttonResolvedQ  = useMysqlQuery(HOTBUTTON_RESOLVED_SQL,  []);
  const issueS1Q            = useMysqlQuery(STORE_ISSUES_SQL,        ['S1']);
  const issueS2Q            = useMysqlQuery(STORE_ISSUES_SQL,        ['S2']);
  const storeResolvedQ      = useMysqlQuery(STORE_ISSUES_RESOLVED_SQL, []);
  const webordersQ          = useMysqlQuery(WEBORDERS_SQL,           []);
  const archivedQ           = useMysqlQuery(ARCHIVED_SQL,            []);

  // Open sales — only fetched when the user opens that tab
  const openSalesQ = useSqlQuery(OPEN_SALES_SQL, [], { enabled: tab === 'opensales' });

  const hotbuttonOpenRows     = hotbuttonOpenQ.data?.rows     ?? [];
  const hotbuttonResolvedRows = hotbuttonResolvedQ.data?.rows ?? [];
  const issueS1Rows           = issueS1Q.data?.rows           ?? [];
  const issueS2Rows           = issueS2Q.data?.rows           ?? [];
  const storeResolvedRows     = storeResolvedQ.data?.rows     ?? [];
  const webordersRows         = webordersQ.data?.rows         ?? [];
  const archivedRows          = archivedQ.data?.rows          ?? [];
  const openSalesRows         = openSalesQ.data?.rows         ?? [];

  const tabCounts = {
    opensales:        openSalesRows.length,
    hotbutton:        hotbuttonOpenRows.length,
    'issue-s1':       issueS1Rows.length,
    'issue-s2':       issueS2Rows.length,
    weborders:        webordersRows.length,
    'resolved-hb':    hotbuttonResolvedRows.length,
    'resolved-store': storeResolvedRows.length,
    archived:         archivedRows.length,
  };

  // Pick the rows for the current tab + apply global search
  const { rows, columns, loading, error, emptyText, exportFilename } = useMemo(() => {
    let rows = [], columns = [], loading = false, error = null, emptyText = 'No records.', exportFilename = `hotbutton-${tab}.csv`;

    switch (tab) {
      case 'hotbutton':
        rows = hotbuttonOpenRows;
        columns = makeIssueColumns({ kind: 'hotbutton' });
        loading = hotbuttonOpenQ.isLoading;
        error = hotbuttonOpenQ.error;
        emptyText = 'No open hot button issues.';
        break;
      case 'issue-s1':
        rows = issueS1Rows;
        columns = makeIssueColumns({ kind: 'store' });
        loading = issueS1Q.isLoading;
        error = issueS1Q.error;
        emptyText = 'No open store issues at Arden.';
        break;
      case 'issue-s2':
        rows = issueS2Rows;
        columns = makeIssueColumns({ kind: 'store' });
        loading = issueS2Q.isLoading;
        error = issueS2Q.error;
        emptyText = 'No open store issues at Waynesville.';
        break;
      case 'weborders':
        rows = webordersRows;
        columns = makeWebordersColumns();
        loading = webordersQ.isLoading;
        error = webordersQ.error;
        emptyText = 'No web orders.';
        break;
      case 'resolved-hb':
        rows = hotbuttonResolvedRows;
        columns = makeIssueColumns({ kind: 'resolved-hb' });
        loading = hotbuttonResolvedQ.isLoading;
        error = hotbuttonResolvedQ.error;
        emptyText = 'No resolved hot button issues.';
        break;
      case 'resolved-store':
        rows = storeResolvedRows;
        columns = makeStoreResolvedColumns();
        loading = storeResolvedQ.isLoading;
        error = storeResolvedQ.error;
        emptyText = 'No resolved store issues.';
        break;
      case 'archived':
        rows = archivedRows;
        columns = makeArchivedColumns();
        loading = archivedQ.isLoading;
        error = archivedQ.error;
        emptyText = 'No archived issues.';
        break;
      case 'opensales':
        rows = openSalesRows;
        columns = makeOpenSalesColumns();
        loading = openSalesQ.isLoading;
        error = openSalesQ.error;
        emptyText = openSalesQ.error ? `Error: ${openSalesQ.error.message}` : 'No open sales found.';
        break;
      default:
        break;
    }

    if (debouncedSearch) {
      rows = rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(debouncedSearch)));
    }

    return { rows, columns, loading, error, emptyText, exportFilename };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, debouncedSearch,
      hotbuttonOpenRows, hotbuttonResolvedRows, issueS1Rows, issueS2Rows,
      storeResolvedRows, webordersRows, archivedRows, openSalesRows,
      hotbuttonOpenQ.isLoading, hotbuttonResolvedQ.isLoading, issueS1Q.isLoading,
      issueS2Q.isLoading, storeResolvedQ.isLoading, webordersQ.isLoading,
      archivedQ.isLoading, openSalesQ.isLoading,
  ]);

  const subtitle = `${fmtNumber(
    tabCounts.hotbutton + tabCounts['issue-s1'] + tabCounts['issue-s2'] + tabCounts.weborders
  )} active issues across all categories`;

  return (
    <>
      <Topbar title="Hot Button Issues" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ── attention-grabbing hero stats ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Active Hot Button"
            count={tabCounts.hotbutton}
            icon={Flame}
            accent="rose"
            urgent
            subtitle={tabCounts.hotbutton > 0 ? 'Cross-store escalations · needs attention' : 'All clear'}
            loading={hotbuttonOpenQ.isLoading}
            onClick={() => setTab('hotbutton')}
          />
          <HeroStat
            label="Arden (S1)"
            count={tabCounts['issue-s1']}
            icon={AlertTriangle}
            accent="amber"
            urgent={tabCounts['issue-s1'] > 5}
            subtitle="Open store-level issues"
            loading={issueS1Q.isLoading}
            onClick={() => setTab('issue-s1')}
          />
          <HeroStat
            label="Waynesville (S2)"
            count={tabCounts['issue-s2']}
            icon={AlertTriangle}
            accent="sky"
            urgent={tabCounts['issue-s2'] > 5}
            subtitle="Open store-level issues"
            loading={issueS2Q.isLoading}
            onClick={() => setTab('issue-s2')}
          />
          <HeroStat
            label="Web Orders"
            count={tabCounts.weborders}
            icon={Globe}
            accent="violet"
            subtitle="Online order escalations"
            loading={webordersQ.isLoading}
            onClick={() => setTab('weborders')}
          />
        </div>

        {/* ── tabs ── */}
        <TabsNav tab={tab} setTab={setTab} tabCounts={tabCounts} />

        {/* ── filter bar ── */}
        {tab !== 'summary' && (
          <Card>
            <CardContent className="flex flex-wrap items-center gap-3 p-3">
              <div className="relative flex-1 min-w-[240px] max-w-md">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
                <Input value={globalSearch} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by sale number, customer, contact, address…" className="pl-8" />
              </div>
              {debouncedSearch && (
                <button onClick={() => setSearch('')}
                  className="text-xs text-primary hover:underline">Clear</button>
              )}
              <div className="ml-auto flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => rowsToCSV(rows, exportFilename)} disabled={!rows.length}>
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
          <SummaryView
            tabCounts={tabCounts}
            setTab={setTab}
            criticalRows={hotbuttonOpenRows}
            loading={hotbuttonOpenQ.isLoading || issueS1Q.isLoading || issueS2Q.isLoading || webordersQ.isLoading}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{TABS.find(t => t.id === tab)?.label}</CardTitle>
              <CardDescription>
                {loading ? 'Loading…' :
                  error ? <span className="text-rose-500">{error.message}</span> : (
                    <>
                      Showing <span className="font-semibold text-fg">{fmtNumber(rows.length)}</span> records
                      <span className="text-muted-fg/70"> · {TABS.find(t => t.id === tab)?.description}</span>
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

// ─── summary view ─────────────────────────────────────────────────────────────

function SummaryView({ tabCounts, setTab, criticalRows, loading }) {
  const totalActive = tabCounts.hotbutton + tabCounts['issue-s1'] + tabCounts['issue-s2'] + tabCounts.weborders;

  const activeCards = [
    { id: 'hotbutton',  label: 'Hot Button',     count: tabCounts.hotbutton,     icon: Flame,         accent: 'rose',   urgent: tabCounts.hotbutton > 0,  description: 'Cross-store hot escalations awaiting action' },
    { id: 'issue-s1',   label: 'Arden (S1)',     count: tabCounts['issue-s1'],   icon: AlertTriangle, accent: 'amber',  urgent: tabCounts['issue-s1'] > 5, description: 'Open store-level issues at Arden' },
    { id: 'issue-s2',   label: 'Waynesville (S2)', count: tabCounts['issue-s2'], icon: AlertTriangle, accent: 'sky',    urgent: tabCounts['issue-s2'] > 5, description: 'Open store-level issues at Waynesville' },
    { id: 'weborders',  label: 'Web Orders',     count: tabCounts.weborders,     icon: Globe,         accent: 'violet', description: 'Online order escalations' },
  ];

  const referenceCards = [
    { id: 'resolved-hb',    label: 'Resolved Hot Button', count: tabCounts['resolved-hb'],    icon: CheckCircle2, accent: 'emerald', description: 'Hot button issues marked resolved' },
    { id: 'resolved-store', label: 'Resolved Store',      count: tabCounts['resolved-store'], icon: CheckCircle2, accent: 'emerald', description: 'Store issues marked resolved' },
    { id: 'archived',       label: 'Archived',            count: tabCounts.archived,          icon: Archive,      accent: 'slate',   description: 'Long-term storage of past issues' },
    { id: 'opensales',      label: 'All Open Sales',      count: tabCounts.opensales,         icon: Inbox,        accent: 'sky',     description: 'Browse open sales · search to create issues' },
  ];

  // Top 6 most aged hot button issues
  const topCritical = useMemo(() =>
    [...criticalRows]
      .map(r => ({ ...r, _age: daysSince(pick(r, 'created_on')) ?? 0 }))
      .sort((a, b) => (b._age ?? 0) - (a._age ?? 0))
      .slice(0, 6)
  , [criticalRows]);

  return (
    <div className="space-y-6">
      {/* Hero banner */}
      <div className="relative overflow-hidden rounded-2xl border border-border">
        <div className="absolute inset-0 bg-gradient-to-br from-rose-500/15 via-amber-500/10 to-transparent" />
        <div className="absolute -top-8 -right-8 opacity-10">
          <Flame size={200} strokeWidth={1.5} />
        </div>
        <div className="relative p-6 flex flex-wrap items-center gap-6">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-xl ring-4 ring-rose-500/20">
            <Flame size={28} strokeWidth={2.25} />
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] font-bold uppercase tracking-widest text-rose-600 dark:text-rose-300">Active Issues Pipeline</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-rose-600 to-orange-500 bg-clip-text text-transparent">
                {fmtNumber(totalActive)}
              </span>
              <span className="text-sm text-muted-fg">open across {activeCards.filter(c => c.count > 0).length} categories</span>
            </div>
            <div className="mt-2 text-xs text-muted-fg">
              Click any tile below to drill into a category, or open the <strong className="text-fg">Most Critical</strong> feed for the oldest items first.
            </div>
          </div>
        </div>
      </div>

      {/* Active issues — bigger, more dramatic cards with progress bars */}
      <div>
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 text-white shadow-md ring-2 ring-rose-500/20">
            <Flame size={18} />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight">Active Issues</h3>
            <p className="text-xs text-muted-fg">Open issues awaiting resolution · click any tile to drill in</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {activeCards.map(c => (
            <SummaryCard key={c.id} {...c} totalActive={totalActive} onClick={() => setTab(c.id)} />
          ))}
        </div>
      </div>

      {/* Most critical activity feed */}
      <CriticalIssuesFeed rows={topCritical} onPick={() => setTab('hotbutton')} />

      {/* Reference cards */}
      <div>
        <div className="flex items-center gap-2 mb-3 px-1">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md ring-2 ring-emerald-500/20">
            <CheckCircle2 size={18} />
          </div>
          <div>
            <h3 className="text-base font-bold tracking-tight">Closed &amp; Reference</h3>
            <p className="text-xs text-muted-fg">Resolved issues, archived records, and the full open-sales list</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {referenceCards.map(c => (
            <SummaryCard key={c.id} {...c} totalActive={0} onClick={() => setTab(c.id)} />
          ))}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-fg">
          <span className="inline-block h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
          Loading issue counts…
        </div>
      )}
    </div>
  );
}

// ─── column factories ─────────────────────────────────────────────────────────

function makeIssueColumns({ kind }) {
  return [
    { id: 'sale_no', accessorFn: r => pick(r, 'sale_number'), header: 'Sale #',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'sale_date', accessorFn: r => pick(r, 'sale_date'), header: 'Sale Date',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'store', accessorFn: r => pick(r, 'store'), header: 'Store',
      cell: ({ getValue }) => <StoreBadge value={getValue()} /> },
    ...(kind === 'hotbutton' || kind === 'resolved-hb'
      ? [{ id: 'concern', accessorFn: r => pick(r, 'concern_type'), header: 'Concern',
          cell: ({ getValue }) => <ConcernBadge value={getValue()} /> }]
      : [{ id: 'vendor', accessorFn: r => pick(r, 'vendor'), header: 'Vendor',
          cell: ({ getValue }) => getValue() || <span className="text-muted-fg">—</span> }]),
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
    { id: 'sales_person', accessorFn: r => pick(r, 'sales_person'), header: 'Salesperson',
      cell: ({ getValue }) => getValue() || <span className="text-muted-fg">—</span> },
    { id: 'description',
      accessorFn: r => pick(r, kind === 'store' ? 'issue_description' : 'description'),
      header: kind === 'store' ? 'Issue' : 'Description',
      cell: ({ getValue }) => <span className="block max-w-[320px] truncate text-sm" title={getValue()}>{getValue() || <span className="text-muted-fg">—</span>}</span> },
    { id: 'steps_taken', accessorFn: r => pick(r, 'steps_taken'), header: 'Steps Taken',
      cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-sm text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'current_status', accessorFn: r => pick(r, 'current_status'), header: 'Status',
      cell: ({ getValue }) => getValue()
        ? <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-200">{getValue()}</span>
        : <span className="text-muted-fg">—</span> },
    ...(kind === 'resolved-hb'
      ? [{ id: 'resolved_on', accessorFn: r => pick(r, 'resolved_on'), header: 'Resolved On',
          cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> }]
      : [{ id: 'age', accessorFn: r => daysSince(pick(r, 'created_on')), header: 'Age',
          cell: ({ getValue }) => <AgeBadge days={getValue()} /> }]),
  ];
}

function makeWebordersColumns() {
  return [
    { id: 'order_date', accessorFn: r => pick(r, 'order_date'), header: 'Order Date',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'sale_no', accessorFn: r => pick(r, 'sale_number'), header: 'Sale #',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'store', accessorFn: r => pick(r, 'store'), header: 'Store',
      cell: ({ getValue }) => <StoreBadge value={getValue()} /> },
    { id: 'customer', accessorFn: r => pick(r, 'customer_name'), header: 'Customer',
      cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span> },
    { id: 'description', accessorFn: r => pick(r, 'description'), header: 'Description',
      cell: ({ getValue }) => <span className="block max-w-[360px] truncate text-sm" title={getValue()}>{getValue() || <span className="text-muted-fg">—</span>}</span> },
    { id: 'remarks', accessorFn: r => pick(r, 'remarks'), header: 'Remarks',
      cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-sm text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'age', accessorFn: r => daysSince(pick(r, 'created_on')), header: 'Age',
      cell: ({ getValue }) => <AgeBadge days={getValue()} /> },
  ];
}

function makeStoreResolvedColumns() {
  return [
    { id: 'sale_no', accessorFn: r => pick(r, 'sale_number'), header: 'Sale #',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'store', accessorFn: r => pick(r, 'store'), header: 'Store',
      cell: ({ getValue }) => <StoreBadge value={getValue()} /> },
    { id: 'sale_date', accessorFn: r => pick(r, 'sale_date'), header: 'Sale Date',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'customer', accessorFn: r => pick(r, 'customer_name'), header: 'Customer',
      cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span> },
    { id: 'vendor', accessorFn: r => pick(r, 'vendor'), header: 'Vendor',
      cell: ({ getValue }) => getValue() || <span className="text-muted-fg">—</span> },
    { id: 'description', accessorFn: r => pick(r, 'issue_description'), header: 'Issue',
      cell: ({ getValue }) => <span className="block max-w-[360px] truncate text-sm" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'current_status', accessorFn: r => pick(r, 'current_status'), header: 'Status' },
    { id: 'resolved_on', accessorFn: r => pick(r, 'resolved_on'), header: 'Resolved On',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
  ];
}

function makeArchivedColumns() {
  return [
    { id: 'source', accessorFn: r => pick(r, 'source'), header: 'Source',
      cell: ({ getValue }) => <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium">{getValue()}</span> },
    { id: 'sale_no', accessorFn: r => pick(r, 'sale_number'), header: 'Sale #',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || '—'}</span> },
    { id: 'store', accessorFn: r => pick(r, 'store'), header: 'Store',
      cell: ({ getValue }) => <StoreBadge value={getValue()} /> },
    { id: 'sale_date', accessorFn: r => pick(r, 'sale_date'), header: 'Sale Date',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'customer', accessorFn: r => pick(r, 'customer_name'), header: 'Customer',
      cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span> },
    { id: 'description', accessorFn: r => pick(r, 'description'), header: 'Description',
      cell: ({ getValue }) => <span className="block max-w-[360px] truncate text-sm" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'archived_on', accessorFn: r => pick(r, 'archived_on'), header: 'Archived On',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
  ];
}

function makeOpenSalesColumns() {
  return [
    { id: 'sale_date', accessorFn: r => pick(r, 'sale_date'), header: 'Sale Date',
      cell: ({ getValue }) => <span className="tabular-nums text-xs">{fmtDate(getValue())}</span> },
    { id: 'sale_no', accessorFn: r => pick(r, 'sale_no'), header: 'Sale #',
      cell: ({ getValue }) => <span className="font-mono text-xs text-primary">{getValue() || '—'}</span> },
    { id: 'store', accessorFn: r => pick(r, 'store'), header: 'Store',
      cell: ({ getValue }) => <StoreBadge value={getValue()} /> },
    { id: 'customer', accessorFn: r => pick(r, 'customer_name'), header: 'Customer',
      cell: ({ getValue, row }) => (
        <div>
          <div className="font-medium text-sm">{getValue() || '—'}</div>
          <div className="text-[11px] text-muted-fg">
            ID {pick(row.original, 'customer_id') || '—'}
            {pick(row.original, 'contact') && <> · {fmtPhone(pick(row.original, 'contact'))}</>}
          </div>
        </div>
      ) },
    { id: 'delivery', accessorFn: r => `${pick(r, 'delivery_city') || ''} ${pick(r, 'delivery_state') || ''}`, header: 'Location',
      cell: ({ row }) => {
        const city = pick(row.original, 'delivery_city');
        const state = pick(row.original, 'delivery_state');
        const zip = pick(row.original, 'delivery_zip');
        return (
          <div className="text-xs">
            <div>{city || '—'}{state ? `, ${state}` : ''}</div>
            <div className="text-muted-fg">{zip}</div>
          </div>
        );
      } },
    { id: 'sale_total', accessorFn: r => parseNumber(pick(r, 'sale_total')), header: 'Sale Total',
      cell: ({ getValue }) => <span className="tabular-nums font-semibold">{fmtCurrency(getValue(), true)}</span> },
    { id: 'balance', accessorFn: r => parseNumber(pick(r, 'balance_due')), header: 'Balance Due',
      cell: ({ getValue }) => {
        const v = getValue();
        return <span className={cn('tabular-nums', v > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-muted-fg')}>{fmtCurrency(v, true)}</span>;
      } },
    { id: 'ready', accessorFn: r => pick(r, 'ready_status'), header: 'Ready',
      cell: ({ getValue }) => {
        const v = getValue();
        if (!v) return <span className="text-muted-fg">—</span>;
        return (
          <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium',
            v === 'Full' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200')}>{v}</span>
        );
      } },
    { id: 'terms', accessorFn: r => pick(r, 'terms'), header: 'Terms',
      cell: ({ getValue }) => {
        const v = getValue();
        if (v === 'COD') return <span className="rounded-full bg-yellow-200/80 dark:bg-yellow-900/40 px-2 py-0.5 text-[10px] font-bold text-yellow-800 dark:text-yellow-200">COD</span>;
        return v || '—';
      } },
    { id: 'age', accessorFn: r => parseNumber(pick(r, 'age')), header: 'Age',
      cell: ({ getValue }) => <AgeBadge days={getValue()} /> },
    { id: 'sales_remarks', accessorFn: r => pick(r, 'sales_remarks'), header: 'Remarks',
      cell: ({ getValue }) => <span className="block max-w-[280px] truncate text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
  ];
}
