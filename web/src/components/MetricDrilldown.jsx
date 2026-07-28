// MetricDrilldown — modal shown when the user clicks any dashboard tile.
//
// The tile passes a config to setDrilldown({...}). Two flavors are supported:
//
//   1) LIST mode (typical): the modal fetches the underlying records via
//      `detailsSql` + `detailsDb` and renders them in a table using
//      `detailsColumns`. Example:
//
//        setDrilldown({
//          title: 'New Customers · This Month',
//          icon: User,
//          accent: 'violet',
//          headline: '14',
//          subtitle: 'First-time buyers at Arden (S1) this month',
//          detailsDb: 'sql',
//          detailsSql: 'SELECT ... FROM ... WHERE ...',
//          detailsColumns: [
//            { key: 'CustomerName', label: 'Customer' },
//            { key: 'firstSale',    label: 'First Sale', render: r => fmtDate(r.firstSale) },
//            { key: 'spent',        label: 'Spent',      align: 'right', render: r => fmtCurrency(r.spent) },
//          ],
//          fullReportPath: '/leads',
//        });
//
//   2) BREAKDOWN mode: when there's no list to show (e.g. YTD vs LY is just
//      a couple of numbers), pass `breakdown: [{label, value, hint?}]`
//      instead of the details* trio.

import { useEffect, useMemo, useState } from 'react';
import { X, TrendingUp, ExternalLink, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { cn } from '@/lib/cn';

const ACCENT_GRAD = {
  primary: 'from-blue-500 to-indigo-500',
  emerald: 'from-emerald-500 to-teal-500',
  amber:   'from-amber-500 to-orange-500',
  rose:    'from-rose-500 to-red-500',
  violet:  'from-violet-500 to-purple-500',
  sky:     'from-sky-500 to-cyan-500',
};
const ACCENT_TEXT = {
  primary: 'text-blue-600 dark:text-blue-300',
  emerald: 'text-emerald-600 dark:text-emerald-300',
  amber:   'text-amber-600 dark:text-amber-300',
  rose:    'text-rose-600 dark:text-rose-300',
  violet:  'text-violet-600 dark:text-violet-300',
  sky:     'text-sky-600 dark:text-sky-300',
};

export function MetricDrilldown({ drilldown, onClose }) {
  if (!drilldown) return null;
  return <Panel drilldown={drilldown} onClose={onClose} />;
}

// Split into a child component so hooks (useSqlQuery / useMysqlQuery) are only
// called when the modal is actually open — otherwise React fires them every
// render even when there's nothing to fetch.
function Panel({ drilldown, onClose }) {
  const navigate = useNavigate();
  const [search, setSearch]     = useState('');

  useEffect(() => {
    const onEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEsc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const {
    title, icon: Icon, accent = 'primary',
    headline, fullHeadline, subtitle,
    breakdown,
    detailsDb, detailsSql, detailsValues = [], detailsColumns, detailsEmpty,
    loadRows,
    fullReportPath, fullReportLabel,
  } = drilldown;

  // Only one of the two hooks actually fires (the other is disabled), but both
  // must be called every render for the hook rules. When `loadRows` is given,
  // both stay disabled and we use the custom async loader instead (used for
  // cross-database merges the SQL passthrough can't do in one query).
  const sqlQ = useSqlQuery(detailsSql || 'SELECT 1', detailsValues, {
    enabled: !loadRows && detailsDb === 'sql' && !!detailsSql,
  });
  const mysqlQ = useMysqlQuery(detailsSql || 'SELECT 1', detailsValues, {
    enabled: !loadRows && detailsDb === 'mysql' && !!detailsSql,
  });

  // Custom async loader path.
  const [custom, setCustom] = useState({ loading: !!loadRows, rows: [], error: null });
  useEffect(() => {
    if (!loadRows) return;
    let cancelled = false;
    setCustom({ loading: true, rows: [], error: null });
    Promise.resolve()
      .then(() => loadRows())
      .then((r) => { if (!cancelled) setCustom({ loading: false, rows: r || [], error: null }); })
      .catch((e) => { if (!cancelled) setCustom({ loading: false, rows: [], error: e }); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line — run once when the modal opens

  const q = loadRows
    ? { data: { rows: custom.rows }, isLoading: custom.loading, error: custom.error }
    : (detailsDb === 'mysql' ? mysqlQ : sqlQ);
  const hasList = !!loadRows || !!detailsSql;
  const rows = q.data?.rows ?? [];

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) =>
      Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(needle)),
    );
  }, [rows, search]);

  const grad = ACCENT_GRAD[accent] || ACCENT_GRAD.primary;
  const textAccent = ACCENT_TEXT[accent] || ACCENT_TEXT.primary;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-drilldown-title"
    >
      <div
        className="w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className={cn('grid h-11 w-11 place-items-center rounded-xl text-white shadow-lg shrink-0 bg-gradient-to-br', grad)}>
                <Icon size={20} strokeWidth={2.25} />
              </div>
            )}
            <div className="min-w-0">
              <h2 id="metric-drilldown-title" className="text-lg font-bold leading-tight truncate" title={title}>{title}</h2>
              {subtitle && <p className="text-xs text-muted-fg mt-0.5">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border text-muted-fg hover:bg-muted transition"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Headline value */}
        {headline && (
          <div className="border-b border-border px-5 pt-4 pb-3">
            <div title={fullHeadline || undefined} className={cn('text-3xl md:text-4xl font-extrabold tabular-nums leading-none', textAccent)}>
              {headline}
            </div>
          </div>
        )}

        {/* Content area (scrolls) */}
        <div className="flex-1 overflow-y-auto p-5">
          {/* Search bar (only if we have a list to filter) */}
          {hasList && !q.isLoading && rows.length > 5 && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 focus-within:border-primary/50">
              <Search size={14} className="text-muted-fg" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Filter ${rows.length} records…`}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-fg"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-[11px] text-muted-fg hover:text-fg">clear</button>
              )}
            </div>
          )}

          {/* LIST MODE — records fetched from SQL or a custom async loader */}
          {hasList && detailsColumns && (
            <DetailsTable
              loading={q.isLoading}
              error={q.error}
              rows={filtered}
              totalRows={rows.length}
              columns={detailsColumns}
              emptyMessage={detailsEmpty || 'No records to show'}
            />
          )}

          {/* BREAKDOWN MODE — static numeric summary */}
          {breakdown && breakdown.length > 0 && (
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-muted/40 border-b border-border">
                <TrendingUp size={13} className={textAccent} />
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-fg">Breakdown</span>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {breakdown.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-fg/90">{row.label}</div>
                        {row.hint && <div className="text-[11px] text-muted-fg mt-0.5">{row.hint}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Nothing configured */}
          {!hasList && !breakdown && (
            <div className="grid place-items-center py-12 text-sm text-muted-fg">
              No details configured for this tile.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border p-4">
          <div className="text-[11px] text-muted-fg">
            {hasList && !q.isLoading && !q.error && (
              <>Showing <strong className="text-fg">{filtered.length}</strong>{search && rows.length !== filtered.length ? ` of ${rows.length}` : ''} record{filtered.length === 1 ? '' : 's'}</>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-fg/80 hover:bg-muted transition"
            >
              Close
            </button>
            {fullReportPath && (
              <button
                type="button"
                onClick={() => { onClose(); navigate(fullReportPath); }}
                className={cn('inline-flex items-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold text-white shadow bg-gradient-to-r', grad)}
              >
                <ExternalLink size={14} />
                {fullReportLabel || 'Open full report'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Table that renders the detail records, with loading/error/empty states.
function DetailsTable({ loading, error, rows, totalRows, columns, emptyMessage }) {
  if (loading) {
    return (
      <div className="grid place-items-center py-16 text-sm text-muted-fg">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          Loading records…
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-300">
        Couldn't load records: {error.message}
      </div>
    );
  }
  if (!totalRows) {
    return (
      <div className="grid place-items-center py-16 text-sm text-muted-fg">
        {emptyMessage}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 sticky top-0">
            <tr className="border-b border-border">
              <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg w-8">#</th>
              {columns.map((c) => (
                <th key={c.key} className={cn(
                  'px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-fg',
                  c.align === 'right' ? 'text-right' : 'text-left',
                )}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="px-4 py-6 text-center text-xs text-muted-fg">No matches for that filter.</td></tr>
            ) : rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2 text-xs font-bold tabular-nums text-muted-fg">{i + 1}</td>
                {columns.map((c) => (
                  <td key={c.key} className={cn(
                    'px-3 py-2',
                    c.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                  )}>
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
