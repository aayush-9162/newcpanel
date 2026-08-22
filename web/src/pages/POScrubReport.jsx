// PO Scrub Report — mirrors the "PO SCRUB REPORT" Google spreadsheet inside CFC
// Hub. Every tab is fetched (as display values) from the sheet via the server
// proxy, and rendered here as a searchable, sortable table with a tab bar.
import { useMemo, useState, useEffect, useRef } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { usePoScrubQuery, poScrubGet } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FileSpreadsheet, Search, RefreshCw, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, Maximize2, Minimize2 } from 'lucide-react';

const cell = (c) => String(c ?? '').trim();
const nonEmpty = (row) => row.filter((c) => cell(c) !== '').length;
const isEmptyRow = (row) => nonEmpty(row) === 0;
// Cells that read as a number / currency / percent → right-aligned, numeric sort.
const isNumeric = (s) => { const t = cell(s); return t !== '' && /^[-+]?\$?\s?[\d,]+(\.\d+)?\s?%?$/.test(t); };
// Cells that read as a M/D/YYYY date → sorted chronologically.
const isDate = (s) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell(s));

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
  const [sort, setSort] = useState({ col: null, dir: 'asc' }); // click a header to sort
  const [refreshing, setRefreshing] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const rootRef = useRef(null);

  // Native fullscreen on the report container.
  const toggleFull = () => {
    const el = rootRef.current;
    if (!document.fullscreenElement) el?.requestFullscreen?.();
    else document.exitFullscreen?.();
  };
  useEffect(() => {
    const onFs = () => setIsFull(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const sheets = data?.sheets ?? [];
  // Keep the active tab valid if the sheet list changes.
  useEffect(() => { if (active > sheets.length - 1) setActive(0); }, [sheets.length, active]);

  const sheet = sheets[active];
  const shaped = useMemo(() => (sheet ? shapeSheet(sheet.values) : null), [sheet]);

  // Global search (across all cells).
  const searchedRows = useMemo(() => {
    if (!shaped) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return shaped.body;
    return shaped.body.filter((r) => r.some((c) => String(c ?? '').toLowerCase().includes(needle)));
  }, [shaped, q]);

  // Per-column type: 'num' (right-aligned + numeric sort), 'date' (chronological
  // sort), or 'text' — inferred from the majority of a column's filled cells.
  const colType = useMemo(() => {
    if (!shaped) return [];
    return Array.from({ length: shaped.cols }).map((_, c) => {
      let num = 0, date = 0, tot = 0;
      for (const r of shaped.body) {
        const v = cell(r[c]);
        if (!v) continue;
        tot++;
        if (isNumeric(v)) num++; else if (isDate(v)) date++;
      }
      if (tot === 0) return 'text';
      if (num / tot >= 0.6) return 'num';
      if (date / tot >= 0.6) return 'date';
      return 'text';
    });
  }, [shaped]);

  // Sort the searched rows by the chosen column (empties always sink to the bottom).
  const bodyRows = useMemo(() => {
    if (sort.col == null || sort.col >= (colType.length || 0)) return searchedRows;
    const c = sort.col, type = colType[c];
    const keyOf = (row) => {
      const t = cell(row[c]);
      if (t === '') return null;
      if (type === 'num')  { const n = parseFloat(t.replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : null; }
      if (type === 'date') { const d = new Date(t).getTime(); return Number.isFinite(d) ? d : null; }
      return t.toLowerCase();
    };
    const out = [...searchedRows];
    out.sort((ra, rb) => {
      const a = keyOf(ra), b = keyOf(rb);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      const cmp = a < b ? -1 : a > b ? 1 : 0;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return out;
  }, [searchedRows, sort, colType]);

  // Click a header to cycle: asc → desc → off.
  const toggleSort = (c) => setSort((s) => s.col !== c ? { col: c, dir: 'asc' } : s.dir === 'asc' ? { col: c, dir: 'desc' } : { col: null, dir: 'asc' });

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

      <div ref={rootRef} className={cn('flex min-h-0 flex-1 flex-col gap-4 bg-bg p-4', isFull && 'overflow-hidden')}>
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
                <button
                  type="button"
                  onClick={toggleFull}
                  title={isFull ? 'Exit full screen' : 'View full screen'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
                >
                  {isFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  <span className="hidden sm:inline">{isFull ? 'Exit' : 'Full screen'}</span>
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
                    onClick={() => { setActive(i); setQ(''); setSort({ col: null, dir: 'asc' }); }}
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
                <div className="relative max-w-sm flex-1">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder={`Search ${sheet.name}…`}
                    className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/50"
                  />
                </div>
                <span className="text-[11px] text-muted-fg">
                  {bodyRows.length} row{bodyRows.length === 1 ? '' : 's'}{q && shaped ? ` of ${shaped.body.length}` : ''}
                </span>
                <span className="ml-auto hidden text-[11px] italic text-muted-fg sm:inline">Click a column to sort</span>
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
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardContent className="flex min-h-0 flex-1 flex-col p-0">
              {shaped.titles.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-emerald-500/20 via-emerald-500/5 to-transparent px-4 py-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_8px] shadow-emerald-500/50" />
                  {shaped.titles.map((t, i) => (
                    <span key={i} className="text-sm font-extrabold tracking-tight text-emerald-800 dark:text-emerald-200">{t}</span>
                  ))}
                </div>
              )}
              {/* The scroll box FILLS the card, which fills the viewport — so the page
                  itself never scrolls and the horizontal bar is always on screen.
                  Header + first two columns (#, PO) freeze. */}
              <div className="po-scroll min-h-0 flex-1 overflow-auto rounded-b-xl">
                <table className="min-w-full border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 top-0 z-30 w-11 min-w-[2.75rem] border-b border-r border-border bg-muted px-2 py-2.5 text-right text-[10px] font-bold text-muted-fg">#</th>
                      {Array.from({ length: shaped.cols }).map((_, c) => {
                        const isNum = colType[c] === 'num';
                        const sorted = sort.col === c;
                        return (
                          <th
                            key={c}
                            className={cn(
                              'group sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted p-0',
                              c === 0 && 'left-[2.75rem] z-30 border-r',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => toggleSort(c)}
                              title="Sort"
                              className={cn(
                                'flex w-full items-center gap-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition hover:text-primary',
                                isNum ? 'justify-end' : 'justify-start',
                                sorted ? 'text-primary' : 'text-muted-fg',
                              )}
                            >
                              <span className="truncate">{String(shaped.header[c] ?? '').trim() || ' '}</span>
                              {sorted
                                ? (sort.dir === 'asc' ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />)
                                : <ArrowUpDown size={12} className="shrink-0 opacity-0 transition group-hover:opacity-60" />}
                            </button>
                          </th>
                        );
                      })}
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
                                colType[c] === 'num' ? 'whitespace-nowrap text-right tabular-nums font-medium text-fg' : 'max-w-[300px] whitespace-normal break-words',
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
