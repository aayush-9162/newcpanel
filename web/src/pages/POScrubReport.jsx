// PO Scrub Report — mirrors the "PO SCRUB REPORT" Google spreadsheet inside CFC
// Hub. Every tab is fetched (as display values) from a bound Apps Script Web App,
// proxied by the server, and rendered here as a searchable table with a tab bar.
import { useMemo, useState, useEffect } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { usePoScrubQuery, poScrubGet } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FileSpreadsheet, Search, RefreshCw, AlertTriangle, X } from 'lucide-react';

const cell = (c) => String(c ?? '').trim();
const nonEmpty = (row) => row.filter((c) => cell(c) !== '').length;
const isEmptyRow = (row) => nonEmpty(row) === 0;
// Cells that read as a number / currency / percent → right-aligned, monospaced.
const isNumeric = (s) => { const t = cell(s); return t !== '' && /^[-+]?\$?\s?[\d,]+(\.\d+)?\s?%?$/.test(t); };

// Split a sheet's 2D values into: leading title rows (single-cell banners), the
// header row (first row with ≥2 filled cells), and the body rows below it
// (fully-empty rows dropped so the table reads cleanly).
function shapeSheet(values) {
  const rows = values ?? [];
  let headerIdx = rows.findIndex((r) => nonEmpty(r) >= 2);
  if (headerIdx < 0) headerIdx = rows.length ? 0 : -1;
  const titles = rows.slice(0, Math.max(0, headerIdx)).map((r) => r.find((c) => cell(c) !== '') || '').filter(Boolean);
  const header = headerIdx >= 0 ? rows[headerIdx] : [];
  const body   = (headerIdx >= 0 ? rows.slice(headerIdx + 1) : []).filter((r) => !isEmptyRow(r));
  const cols   = Math.max(header.length, ...body.map((r) => r.length), 0);
  return { titles, header, body, cols };
}

// Colored pill for a Status-like column.
function StatusBadge({ value }) {
  const v = value.toLowerCase();
  const tone = v.includes('open') ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
    : (v.includes('close') || v.includes('complete') || v.includes('done') || v.includes('received')) ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200'
    : (v.includes('hold') || v.includes('pending') || v.includes('back')) ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
    : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200';
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', tone)}>{value}</span>;
}

export default function POScrubReport() {
  // Auto-refresh every 5 hours; use the Refresh button for an immediate live pull.
  const { data, isLoading, error, refetch, isFetching } = usePoScrubQuery({
    refetchInterval: 5 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [colFilters, setColFilters] = useState({}); // { [colIndex]: filterText }
  const [refreshing, setRefreshing] = useState(false);

  const sheets = data?.sheets ?? [];
  // Keep the active tab valid if the sheet list changes.
  useEffect(() => { if (active > sheets.length - 1) setActive(0); }, [sheets.length, active]);

  const sheet = sheets[active];
  const shaped = useMemo(() => (sheet ? shapeSheet(sheet.values) : null), [sheet]);

  const activeColFilters = useMemo(
    () => Object.entries(colFilters).filter(([, v]) => String(v).trim() !== '').map(([c, v]) => [Number(c), String(v).toLowerCase()]),
    [colFilters],
  );
  const bodyRows = useMemo(() => {
    if (!shaped) return [];
    const needle = q.trim().toLowerCase();
    if (!needle && activeColFilters.length === 0) return shaped.body;
    return shaped.body.filter((r) => {
      if (needle && !r.some((c) => String(c ?? '').toLowerCase().includes(needle))) return false;
      for (const [c, v] of activeColFilters) {
        if (!String(r[c] ?? '').toLowerCase().includes(v)) return false;
      }
      return true;
    });
  }, [shaped, q, activeColFilters]);

  // A column is "numeric" (right-aligned) when most of its filled cells parse as numbers.
  const colNumeric = useMemo(() => {
    if (!shaped) return [];
    return Array.from({ length: shaped.cols }).map((_, c) => {
      let num = 0, tot = 0;
      for (const r of shaped.body) { const v = cell(r[c]); if (v) { tot++; if (isNumeric(v)) num++; } }
      return tot > 0 && num / tot >= 0.6;
    });
  }, [shaped]);

  // Hard refresh — bypass the server cache, then refetch the query.
  const hardRefresh = async () => {
    setRefreshing(true);
    try { await poScrubGet(true); await refetch(); } catch { /* surfaced via query error */ }
    finally { setRefreshing(false); }
  };

  const fetchedAt = data?.fetchedAt ? new Date(data.fetchedAt) : null;

  return (
    <>
      <Topbar title="PO Scrub Report" subtitle={data?.title || 'Purchase-order scrub tracker'} />

      <div className="flex flex-1 flex-col gap-4 p-4 min-h-0">
        {/* Toolbar: tab bar + search + refresh */}
        <Card className="shrink-0">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent px-4 py-3">
              <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold">{data?.title || 'PO Scrub Report'}</span>
              {sheets.length > 0 && <span className="text-[11px] text-muted-fg">· {sheets.length} sheet{sheets.length === 1 ? '' : 's'}</span>}
              <div className="ml-auto flex items-center gap-2">
                {fetchedAt && (
                  <span className="hidden text-[11px] text-muted-fg sm:inline">
                    Updated {fetchedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={hardRefresh}
                  disabled={refreshing || isFetching}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-muted disabled:opacity-50"
                >
                  <RefreshCw size={13} className={cn((refreshing || isFetching) && 'animate-spin')} /> Refresh
                </button>
              </div>
            </div>

            {/* Tab bar */}
            {sheets.length > 0 && (
              <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2">
                {sheets.map((s, i) => (
                  <button
                    key={s.name + i}
                    type="button"
                    onClick={() => { setActive(i); setQ(''); setColFilters({}); }}
                    className={cn(
                      'shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                      i === active ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted',
                    )}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}

            {/* Search */}
            {sheet && (
              <div className="flex items-center gap-2 px-4 py-2.5">
                <div className="relative flex-1 max-w-sm">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${sheet.name}…`}
                    className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/50"
                  />
                </div>
                {(q || activeColFilters.length > 0) && (
                  <button
                    type="button"
                    onClick={() => { setQ(''); setColFilters({}); }}
                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold text-muted-fg transition hover:bg-muted"
                  >
                    <X size={12} /> Clear filters
                  </button>
                )}
                <span className="text-[11px] text-muted-fg">
                  {bodyRows.length} row{bodyRows.length === 1 ? '' : 's'}{(q || activeColFilters.length) && shaped ? ` of ${shaped.body.length}` : ''}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Body */}
        {isLoading ? (
          <div className="grid place-items-center py-16 text-sm text-muted-fg">
            <div className="flex flex-col items-center gap-3"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading sheet…</div>
          </div>
        ) : error ? (
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold">Couldn't load the PO Scrub sheet.</div>
                  <div className="mt-0.5 text-xs">{error.message}</div>
                  <div className="mt-1.5 text-xs text-muted-fg">
                    Check that <code>PO_SCRUB_SHEET_ID</code> and <code>po-scrub-oauth.json</code> are present on the server (run the one-time consent script if needed).
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : !sheet ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-fg">No sheets found.</CardContent></Card>
        ) : (
          <Card className="flex flex-1 flex-col min-h-0">
            <CardContent className="flex flex-1 flex-col min-h-0 p-0">
              {shaped.titles.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-emerald-500/20 via-emerald-500/5 to-transparent px-4 py-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" />
                  {shaped.titles.map((t, i) => (
                    <span key={i} className="text-sm font-extrabold tracking-tight text-emerald-800 dark:text-emerald-200">{t}</span>
                  ))}
                </div>
              )}
              {/* The scroll box now FILLS the card, which fills the viewport — so the
                  page itself never scrolls and the horizontal bar is always on screen.
                  Header + first two columns (#, PO) freeze. */}
              <div className="po-scroll min-h-0 flex-1 overflow-auto rounded-b-xl">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 w-11 min-w-[2.75rem] border-b border-r border-border bg-muted px-2 py-2 text-right align-bottom text-[10px] font-bold text-muted-fg">#</th>
                      {Array.from({ length: shaped.cols }).map((_, c) => (
                        <th
                          key={c}
                          className={cn(
                            'sticky top-0 z-20 border-b border-border bg-muted px-2 py-1.5 align-top',
                            c === 0 && 'left-[2.75rem] z-30 border-r',
                          )}
                        >
                          <div className={cn('whitespace-nowrap px-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted-fg', colNumeric[c] ? 'text-right' : 'text-left')}>
                            {String(shaped.header[c] ?? '').trim() || ' '}
                          </div>
                          <input
                            value={colFilters[c] ?? ''}
                            onChange={(e) => setColFilters((f) => ({ ...f, [c]: e.target.value }))}
                            placeholder="filter…"
                            className={cn(
                              'w-full min-w-[80px] rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-fg outline-none focus:border-primary/60',
                              colFilters[c] && 'border-primary/60 bg-primary/5',
                            )}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.length === 0 ? (
                      <tr><td colSpan={shaped.cols + 1} className="px-4 py-10 text-center text-sm text-muted-fg">No matching rows.</td></tr>
                    ) : bodyRows.map((row, ri) => (
                      <tr key={ri} className={cn('hover:bg-primary/[0.06]', ri % 2 === 1 && 'bg-muted/25')}>
                        <td className="sticky left-0 z-10 border-b border-r border-border/60 bg-card px-2 py-2 text-right text-[10px] tabular-nums text-muted-fg/70 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]">{ri + 1}</td>
                        {Array.from({ length: shaped.cols }).map((_, c) => {
                          const raw = cell(row[c]);
                          const isStatus = String(shaped.header[c] ?? '').toLowerCase().includes('status') && raw;
                          return (
                            <td
                              key={c}
                              className={cn(
                                'border-b border-border/40 px-3 py-2 align-top text-[13px]',
                                colNumeric[c] ? 'whitespace-nowrap text-right tabular-nums font-medium text-fg' : 'max-w-[300px] whitespace-normal break-words',
                                c === 0 && 'sticky left-[2.75rem] z-10 border-r border-border/60 bg-card font-bold text-primary shadow-[2px_0_4px_-2px_rgba(0,0,0,0.15)]',
                              )}
                            >
                              {isStatus ? <StatusBadge value={raw} /> : raw}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
