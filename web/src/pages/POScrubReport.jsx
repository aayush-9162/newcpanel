// PO Scrub Report — mirrors the "PO SCRUB REPORT" Google spreadsheet inside CFC
// Hub. Every tab is fetched (as display values) from a bound Apps Script Web App,
// proxied by the server, and rendered here as a searchable table with a tab bar.
import { useMemo, useState, useEffect } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { usePoScrubQuery, poScrubGet } from '@/lib/api';
import { cn } from '@/lib/cn';
import { FileSpreadsheet, Search, RefreshCw, ExternalLink, AlertTriangle } from 'lucide-react';

const nonEmpty = (row) => row.filter((c) => String(c ?? '').trim() !== '').length;

// Split a sheet's 2D values into: leading title rows (single-cell banners), the
// header row (first row with ≥2 filled cells), and the body rows below it.
function shapeSheet(values) {
  const rows = values ?? [];
  let headerIdx = rows.findIndex((r) => nonEmpty(r) >= 2);
  if (headerIdx < 0) headerIdx = rows.length ? 0 : -1;
  const titles = rows.slice(0, Math.max(0, headerIdx)).map((r) => r.find((c) => String(c ?? '').trim() !== '') || '').filter(Boolean);
  const header = headerIdx >= 0 ? rows[headerIdx] : [];
  const body   = headerIdx >= 0 ? rows.slice(headerIdx + 1) : [];
  const cols   = Math.max(header.length, ...body.map((r) => r.length), 0);
  return { titles, header, body, cols };
}

export default function POScrubReport() {
  // Auto-refresh every 5 hours; use the Refresh button for an immediate live pull.
  const { data, isLoading, error, refetch, isFetching } = usePoScrubQuery({
    refetchInterval: 5 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [active, setActive] = useState(0);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const sheets = data?.sheets ?? [];
  // Keep the active tab valid if the sheet list changes.
  useEffect(() => { if (active > sheets.length - 1) setActive(0); }, [sheets.length, active]);

  const sheet = sheets[active];
  const shaped = useMemo(() => (sheet ? shapeSheet(sheet.values) : null), [sheet]);

  const bodyRows = useMemo(() => {
    if (!shaped) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return shaped.body;
    return shaped.body.filter((r) => r.some((c) => String(c ?? '').toLowerCase().includes(needle)));
  }, [shaped, q]);

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

      <div className="space-y-4">
        {/* Toolbar: tab bar + search + refresh */}
        <Card>
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
                    onClick={() => { setActive(i); setQ(''); }}
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
                <span className="text-[11px] text-muted-fg">
                  {bodyRows.length} row{bodyRows.length === 1 ? '' : 's'}{q && shaped ? ` of ${shaped.body.length}` : ''}
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
                    Check that the Apps Script Web App is deployed and <code>PO_SCRUB_URL</code> / <code>PO_SCRUB_TOKEN</code> are set on the server.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : !sheet ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-fg">No sheets found.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              {shaped.titles.length > 0 && (
                <div className="flex flex-wrap gap-2 border-b border-border bg-emerald-500/10 px-4 py-2.5">
                  {shaped.titles.map((t, i) => (
                    <span key={i} className="text-sm font-bold text-emerald-800 dark:text-emerald-200">{t}</span>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
                    <tr className="border-b border-border">
                      <th className="px-2 py-2 text-right text-[10px] font-semibold text-muted-fg">#</th>
                      {Array.from({ length: shaped.cols }).map((_, c) => (
                        <th key={c} className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-muted-fg">
                          {String(shaped.header[c] ?? '').trim()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bodyRows.length === 0 ? (
                      <tr><td colSpan={shaped.cols + 1} className="px-4 py-10 text-center text-sm text-muted-fg">No matching rows.</td></tr>
                    ) : bodyRows.map((row, ri) => {
                      // A row with a single filled cell reads as a section band.
                      const filled = nonEmpty(row);
                      if (filled === 1) {
                        const text = row.find((c) => String(c ?? '').trim() !== '') || '';
                        return (
                          <tr key={ri} className="bg-emerald-500/5">
                            <td className="px-2 py-2 text-right text-[10px] text-muted-fg">{ri + 1}</td>
                            <td colSpan={shaped.cols} className="px-3 py-2 text-sm font-semibold text-emerald-800 dark:text-emerald-200">{text}</td>
                          </tr>
                        );
                      }
                      return (
                        <tr key={ri} className="border-b border-border/60 last:border-0 odd:bg-muted/20 hover:bg-muted/40">
                          <td className="px-2 py-1.5 text-right text-[10px] tabular-nums text-muted-fg">{ri + 1}</td>
                          {Array.from({ length: shaped.cols }).map((_, c) => (
                            <td key={c} className="whitespace-nowrap px-3 py-1.5 align-top">{String(row[c] ?? '').trim()}</td>
                          ))}
                        </tr>
                      );
                    })}
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
