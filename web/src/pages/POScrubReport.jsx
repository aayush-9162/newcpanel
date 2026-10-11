// PO Scrub Report — mirrors the "PO SCRUB" Google spreadsheet inside CFC Hub.
// Every visible tab (one per vendor) is fetched via the server proxy with its
// display values AND cell background colours. The sheet uses colour as status:
//   green row  → Confirmed (scrubbed OK)    yellow row → Pending / follow-up
//   red cell   → Flagged value (e.g. late)   no colour  → Unmarked
// Rows are grouped by PO (continuation rows with a blank S.NO / PO# are extra
// invoice / shipment lines of the PO above), and the many "SCRUB DATE – …"
// history columns collapse into a Latest Scrub column + an expandable timeline.
import { Fragment, useMemo, useState, useEffect, useRef } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { usePoScrubQuery, poScrubGet } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  FileSpreadsheet, Search, RefreshCw, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown,
  Maximize2, Minimize2, ChevronRight, CheckCircle2, Clock, Flag, Circle, Package, History, Layers,
} from 'lucide-react';

const cell = (c) => String(c ?? '').trim();
const nonEmpty = (row) => (row || []).filter((c) => cell(c) !== '').length;
const isNumeric = (s) => { const t = cell(s); return t !== '' && /^[-+]?\$?\s?[\d,]+(\.\d+)?\s?%?$/.test(t); };
const isDate = (s) => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cell(s));
const toNum = (s) => { const n = parseFloat(cell(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

// ── Colour → status ──────────────────────────────────────────────────────────
function statusOfHex(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  if (g > 150 && g > r + 25 && g > b + 25) return 'ok';            // greens
  if (r > 200 && g > 190 && b < Math.min(r, g) - 60) return 'pending'; // yellows
  if (r > 200 && r - g >= 35 && r - b >= 35) return 'flag';        // reds / pinks
  return null;
}
// Most common status among a row's coloured cells (the row's "fill").
function rowStatus(colorRow) {
  const counts = {};
  for (const h of colorRow || []) { const s = statusOfHex(h); if (s) counts[s] = (counts[s] || 0) + 1; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  // A single red cell is a cell flag, not a red row — require a real fill.
  if (!best) return null;
  if (best[0] === 'flag' && best[1] < 3) return null;
  return best[0];
}

const STATUS = {
  ok:      { label: 'Confirmed', icon: CheckCircle2, pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200', stripe: 'border-l-emerald-500', row: 'bg-emerald-50 dark:bg-emerald-950', dot: 'bg-emerald-500', card: 'from-emerald-500/15 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30' },
  pending: { label: 'Pending',   icon: Clock,        pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',     stripe: 'border-l-amber-400',   row: 'bg-amber-50 dark:bg-amber-950',     dot: 'bg-amber-400',   card: 'from-amber-500/15 text-amber-700 dark:text-amber-300 ring-amber-500/30' },
  flag:    { label: 'Flagged',   icon: Flag,         pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',         stripe: 'border-l-rose-500',    row: 'bg-rose-50 dark:bg-rose-950',       dot: 'bg-rose-500',    card: 'from-rose-500/15 text-rose-700 dark:text-rose-300 ring-rose-500/30' },
  none:    { label: 'Unmarked',  icon: Circle,       pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',        stripe: 'border-l-slate-300 dark:border-l-slate-600', row: 'bg-card', dot: 'bg-slate-400', card: 'from-slate-500/10 text-slate-600 dark:text-slate-300 ring-slate-500/20' },
};

// ── Sheet → PO groups ────────────────────────────────────────────────────────
function shapeSheet(sheet) {
  const values = Array.isArray(sheet?.values) ? sheet.values : [];
  const colors = Array.isArray(sheet?.colors) ? sheet.colors : [];
  let headerIdx = values.findIndex((r) => nonEmpty(r) >= 2);
  if (headerIdx < 0) return null;
  const header = (values[headerIdx] || []).map(cell);
  const cols = Math.max(header.length, ...values.slice(headerIdx + 1).map((r) => (r || []).length), 0);
  const H = (i) => (header[i] || '').toUpperCase();

  const idx = (re) => { for (let i = 0; i < cols; i++) if (re.test(H(i))) return i; return -1; };
  const snoCol = idx(/^S\.?\s*NO/);
  const poCol = (() => { const i = idx(/^PO\s*#|^PO\s*NO|^PO$/); return i >= 0 ? i : (snoCol === 0 ? 1 : 0); })();
  const scrubCols = [];
  const coreCols = [];
  for (let i = 0; i < cols; i++) {
    if (i === snoCol) continue;
    if (/SCRUB\s*DATE/.test(H(i))) {
      const m = (header[i] || '').match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
      scrubCols.push({ col: i, label: m ? m[1].replace(/\/(\d{2})?(\d{2})$/, (x, a, b) => `/${b}`) : ((header[i] || '').replace(/SCRUB\s*DATE\s*-?\s*/i, '').trim() || `#${scrubCols.length + 1}`) });
    } else if (header[i] || values.slice(headerIdx + 1).some((r) => cell(r?.[i]))) {
      coreCols.push(i);
    }
  }
  const remCol = idx(/REMAINING\s*QTY/);

  // Group rows: a row with a PO# starts a PO; following rows without one are
  // continuation lines of that PO.
  const groups = [];
  for (let r = headerIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (nonEmpty(row) === 0) continue;
    const colorRow = colors[r] || [];
    const po = cell(row[poCol]);
    if (po || !groups.length) {
      const st = rowStatus(colorRow) || 'none';
      groups.push({ key: `${r}`, sno: snoCol >= 0 ? cell(row[snoCol]) : '', po, main: row, mainColors: colorRow, lines: [], lineColors: [], status: st });
    } else {
      const g = groups[groups.length - 1];
      g.lines.push(row); g.lineColors.push(colorRow);
    }
  }
  // Derived per-PO facts.
  for (const g of groups) {
    const all = [g.main, ...g.lines];
    const allColors = [g.mainColors, ...g.lineColors];
    // Cell-level red flags (outside a red row) → mark the PO as flagged too.
    g.flagCells = new Set();
    allColors.forEach((cr, li) => (cr || []).forEach((h, ci) => {
      if (statusOfHex(h) === 'flag' && cell(all[li]?.[ci])) g.flagCells.add(`${li}:${ci}`);
    }));
    if (g.flagCells.size && g.status !== 'pending') g.status = 'flag';
    // Scrub history (left → right is chronological). Combine main + lines.
    g.history = scrubCols.map((s) => ({ label: s.label, value: all.map((r) => cell(r?.[s.col])).filter(Boolean).join(' · ') }))
      .filter((h) => h.value);
    g.latest = g.history.length ? g.history[g.history.length - 1] : null;
    g.remaining = remCol >= 0 ? toNum(g.main[remCol]) : 0;
    g.search = all.map((r) => (r || []).join(' ')).join(' ').toLowerCase();
  }

  // Column type for alignment / sorting (from main rows).
  const colType = {};
  for (const c of coreCols) {
    let num = 0, date = 0, tot = 0;
    for (const g of groups) { const v = cell(g.main[c]); if (!v) continue; tot++; if (isNumeric(v)) num++; else if (isDate(v)) date++; }
    colType[c] = tot === 0 ? 'text' : num / tot >= 0.6 ? 'num' : date / tot >= 0.6 ? 'date' : 'text';
  }
  const lastScrub = [...scrubCols].reverse().find((s) => groups.some((g) => [g.main, ...g.lines].some((r) => cell(r?.[s.col]))));
  return { header, cols, snoCol, poCol, coreCols: coreCols.filter((c) => c !== poCol), scrubCols, remCol, groups, colType, lastScrub: lastScrub?.label || null };
}

// ── All vendors → one table ──────────────────────────────────────────────────
// Each vendor tab has slightly different columns, so the combined view uses the
// union of column headers (matched by name, first-seen order) plus a Vendor
// column at index 0. Every PO's cells and flags are re-indexed into that space.
const VENDOR_COL = 0;
function combineShaped(list, names) {
  const valid = list.map((s, i) => (s ? { s, name: cell(names[i]) || `Tab ${i + 1}` } : null)).filter(Boolean);
  if (!valid.length) return null;
  // Vendors name the same field differently (lead-time weeks, "EXPEC SHIP DATE
  // BY VEN" vs "EXPECTED DATE BY VENDOR", …) — fold those into one column.
  const canon = (h) => {
    const u = cell(h).toUpperCase().replace(/\s+/g, ' ');
    if (/^EXPECTED DATE\s*-\s*\d+\s*WEEKS?$/.test(u)) return { key: 'EXP_LEAD', label: 'Expected Date (lead time)' };
    if (/^EXPEC(TED)?\.?\s*(SHIP\s*)?DATE BY VEN/.test(u)) return { key: 'EXP_VENDOR', label: 'Expected Date by Vendor' };
    if (/^QTY SHOWING ON VENDOR/.test(u)) return { key: 'QTY_VENDOR', label: 'Qty on Vendor Website' };
    return { key: u, label: cell(h) };
  };
  const keyOf = (h) => canon(h).key;
  const header = ['Vendor', 'PO#'];             // 0 = vendor, 1 = PO#
  const colIndex = new Map();
  for (const { s } of valid) {
    for (const c of s.coreCols) {
      const { key, label } = canon(s.header[c]);
      if (key && !colIndex.has(key)) { colIndex.set(key, header.length); header.push(label); }
    }
  }
  const groups = [];
  for (const { s, name } of valid) {
    const map = new Map([[s.poCol, 1]]);
    for (const c of s.coreCols) { const u = colIndex.get(keyOf(s.header[c])); if (u != null) map.set(c, u); }
    const remap = (row) => { const out = new Array(header.length).fill(''); out[VENDOR_COL] = name; for (const [c, u] of map) out[u] = row?.[c] ?? ''; return out; };
    for (const g of s.groups) {
      const flagCells = new Set();
      for (const f of g.flagCells) { const [li, c] = f.split(':'); const u = map.get(Number(c)); if (u != null) flagCells.add(`${li}:${u}`); }
      groups.push({ ...g, key: `${name}::${g.key}`, vendor: name, main: remap(g.main), lines: g.lines.map(remap), flagCells, search: `${g.search} ${name.toLowerCase()}` });
    }
  }
  const coreCols = [VENDOR_COL, ...[...colIndex.values()]];
  const colType = { [VENDOR_COL]: 'text' };
  for (const c of colIndex.values()) {
    let num = 0, date = 0, tot = 0;
    for (const g of groups) { const v = cell(g.main[c]); if (!v) continue; tot++; if (isNumeric(v)) num++; else if (isDate(v)) date++; }
    colType[c] = tot === 0 ? 'text' : num / tot >= 0.6 ? 'num' : date / tot >= 0.6 ? 'date' : 'text';
  }
  // Most recent scrub label across vendors (labels are MM/DD/YY dates).
  const lastScrub = valid.map(({ s }) => s.lastScrub).filter(Boolean)
    .sort((a, b) => (Date.parse(b) || 0) - (Date.parse(a) || 0))[0] || null;
  return {
    header, poCol: 1, coreCols, colType, groups, lastScrub, isAll: true,
    scrubCols: valid.some(({ s }) => s.scrubCols.length) ? [{}] : [],
    remCol: valid.some(({ s }) => s.remCol >= 0) ? 1 : -1,
  };
}

function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.none;
  const Icon = s.icon;
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold', s.pill)}><Icon size={11} />{s.label}</span>;
}

function ScrubValue({ entry }) {
  if (!entry) return <span className="text-xs text-muted-fg">—</span>;
  const ok = /^ok$/i.test(entry.value);
  return ok ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200">
      <CheckCircle2 size={11} /> OK <span className="font-medium opacity-70">· {entry.label}</span>
    </span>
  ) : (
    <div className="max-w-[260px]">
      <span className="mr-1 rounded bg-sky-100 px-1 py-px text-[10px] font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-200">{entry.label}</span>
      <span className="line-clamp-2 cursor-help text-[12px] hover:line-clamp-none" title={entry.value}>{entry.value}</span>
    </div>
  );
}

export default function POScrubReport() {
  // Auto-refresh every 5 hours; use the Refresh button for an immediate live pull.
  const { data, isLoading, error, refetch, isFetching } = usePoScrubQuery({
    refetchInterval: 5 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [active, setActive] = useState(-1);   // -1 = All vendors
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [sort, setSort] = useState({ col: null, dir: 'asc' });
  const [open, setOpen] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const rootRef = useRef(null);

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

  const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
  useEffect(() => { if (active > sheets.length - 1) setActive(-1); }, [sheets.length, active]);

  // Shape every tab once (cheap) so the tab bar can show per-vendor counts.
  const shapedAll = useMemo(() => sheets.map((s) => { try { return shapeSheet(s); } catch { return null; } }), [sheets]);
  const combined = useMemo(() => { try { return combineShaped(shapedAll, sheets.map((s) => s?.name)); } catch { return null; } }, [shapedAll, sheets]);
  const isAll = active === -1;
  const sheet = isAll ? (sheets.length ? { name: 'All vendors' } : null) : sheets[active];
  const shaped = isAll ? combined : (shapedAll[active] || null);

  const counts = useMemo(() => {
    const c = { all: 0, ok: 0, pending: 0, flag: 0, none: 0, remaining: 0 };
    for (const g of shaped?.groups || []) { c.all++; c[g.status] = (c[g.status] || 0) + 1; c.remaining += g.remaining; }
    return c;
  }, [shaped]);

  const rows = useMemo(() => {
    if (!shaped) return [];
    const needle = q.trim().toLowerCase();
    let out = shaped.groups.filter((g) => (!statusFilter || g.status === statusFilter) && (!needle || g.search.includes(needle)));
    if (sort.col != null) {
      const c = sort.col;
      const type = c === 'latest' ? 'text' : c === 'status' ? 'text' : (shaped.colType[c] || 'text');
      const keyOf = (g) => {
        if (c === 'status') return STATUS[g.status]?.label || '';
        if (c === 'latest') return g.latest ? `${g.latest.label} ${g.latest.value}`.toLowerCase() : null;
        const t = cell(g.main[c]);
        if (!t) return null;
        if (type === 'num') return toNum(t);
        if (type === 'date') { const d = new Date(t).getTime(); return Number.isFinite(d) ? d : null; }
        return t.toLowerCase();
      };
      out = [...out].sort((ga, gb) => {
        const a = keyOf(ga), b = keyOf(gb);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        const cmp = a < b ? -1 : a > b ? 1 : 0;
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }
    return out;
  }, [shaped, q, statusFilter, sort]);

  const toggleSort = (c) => setSort((s) => s.col !== c ? { col: c, dir: 'asc' } : s.dir === 'asc' ? { col: c, dir: 'desc' } : { col: null, dir: 'asc' });
  const toggleOpen = (k) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const switchTab = (i) => { setActive(i); setQ(''); setStatusFilter(null); setSort({ col: null, dir: 'asc' }); setOpen(new Set()); };

  const hardRefresh = async () => {
    setRefreshing(true);
    try { await poScrubGet(true); await refetch(); } catch { /* surfaced via query error */ }
    finally { setRefreshing(false); }
  };

  const fetchedAt = data?.fetchedAt ? new Date(data.fetchedAt) : null;
  const colTotal = shaped ? shaped.coreCols.length + 4 : 1;

  const SortHead = ({ col, label, align = 'left', className }) => {
    const sorted = sort.col === col;
    return (
      <th className={cn('group sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted p-0', className)}>
        <button type="button" onClick={() => toggleSort(col)} title={label}
          className={cn('flex w-full items-center gap-1 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider transition hover:text-primary',
            align === 'right' ? 'justify-end' : 'justify-start', sorted ? 'text-primary' : 'text-muted-fg')}>
          <span className="max-w-[160px] truncate">{label || ' '}</span>
          {sorted ? (sort.dir === 'asc' ? <ArrowUp size={12} className="shrink-0" /> : <ArrowDown size={12} className="shrink-0" />)
            : <ArrowUpDown size={12} className="shrink-0 opacity-0 transition group-hover:opacity-60" />}
        </button>
      </th>
    );
  };

  const renderCell = (g, li, row, c) => {
    const raw = cell(row?.[c]);
    if (!raw) return <span className="text-muted-fg/40">—</span>;
    const flagged = g.flagCells.has(`${li}:${c}`);
    const isNum = shaped.colType[c] === 'num';
    const inner = isNum ? raw
      : <span className="line-clamp-3 cursor-help hover:line-clamp-none" title={raw}>{raw}</span>;
    return flagged
      ? <span className="inline-block rounded bg-rose-200/80 px-1 font-semibold text-rose-800 ring-1 ring-rose-400/60 dark:bg-rose-900/60 dark:text-rose-100" title="Flagged in sheet">{inner}</span>
      : inner;
  };

  return (
    <>
      <Topbar title="PO Scrub Report" subtitle={data?.title || 'Purchase-order scrub tracker'} />

      <div ref={rootRef} className={cn('flex min-h-0 flex-1 flex-col gap-3 bg-bg p-4', isFull && 'overflow-hidden')}>
        {/* Toolbar + vendor tabs */}
        <Card className="shrink-0">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent px-4 py-3">
              <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold">{data?.title || 'PO Scrub Report'}</span>
              {sheets.length > 0 && <span className="text-[11px] text-muted-fg">· {sheets.length} vendor{sheets.length === 1 ? '' : 's'}</span>}
              <div className="ml-auto flex items-center gap-2">
                {fetchedAt && (
                  <span className="hidden text-[11px] text-muted-fg sm:inline">
                    Updated {fetchedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
                <button type="button" onClick={hardRefresh} disabled={refreshing || isFetching}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-muted disabled:opacity-50">
                  <RefreshCw size={13} className={cn((refreshing || isFetching) && 'animate-spin')} /> Refresh
                </button>
                <button type="button" onClick={toggleFull} title={isFull ? 'Exit full screen' : 'View full screen'}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-primary transition hover:bg-muted">
                  {isFull ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  <span className="hidden sm:inline">{isFull ? 'Exit' : 'Full screen'}</span>
                </button>
              </div>
            </div>

            {sheets.length > 0 && (
              <div className="flex gap-1 overflow-x-auto px-2 py-2">
                {/* All vendors — every PO in one table */}
                {(() => {
                  const n = combined?.groups?.length || 0;
                  const flags = combined?.groups?.filter((g) => g.status === 'flag').length || 0;
                  return (
                    <button type="button" onClick={() => switchTab(-1)}
                      className={cn('relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition',
                        isAll ? 'bg-primary text-primary-fg shadow-sm' : 'border border-primary/30 text-primary hover:bg-primary/10')}>
                      All
                      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', isAll ? 'bg-white/25' : 'bg-primary/10')}>{n}</span>
                      {flags > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-card" title={`${flags} flagged`} />}
                    </button>
                  );
                })()}
                <span className="mx-1 my-1 w-px shrink-0 bg-border" />
                {sheets.map((s, i) => {
                  const sh = shapedAll[i];
                  const n = sh?.groups?.length || 0;
                  const flags = sh?.groups?.filter((g) => g.status === 'flag').length || 0;
                  return (
                    <button key={s.name + i} type="button" onClick={() => switchTab(i)}
                      className={cn('relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                        i === active ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted')}>
                      {s.name.trim()}
                      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', i === active ? 'bg-white/25' : 'bg-muted')}>{n}</span>
                      {flags > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-card" title={`${flags} flagged`} />}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

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
                  <div className="mt-1.5 text-xs text-muted-fg">Check that <code>PO_SCRUB_SHEET_ID</code> and <code>po-scrub-oauth.json</code> are present on the server.</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : !sheet || !shaped ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-fg">{sheet ? 'This tab has no table to show.' : 'No sheets found.'}</CardContent></Card>
        ) : (
          <>
            {/* KPI cards — click a status to filter */}
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <button type="button" onClick={() => setStatusFilter(null)}
                className={cn('rounded-xl border bg-card p-3 text-left transition hover:shadow-sm', !statusFilter ? 'border-primary ring-2 ring-primary/20' : 'border-border')}>
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg"><Package size={12} /> {sheet.name.trim()} POs</div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums">{fmtNumber(counts.all)}</div>
              </button>
              {['ok', 'pending', 'flag', 'none'].map((k) => {
                const s = STATUS[k]; const Icon = s.icon;
                return (
                  <button key={k} type="button" onClick={() => setStatusFilter((f) => (f === k ? null : k))} disabled={!counts[k]}
                    className={cn('rounded-xl border bg-gradient-to-br to-transparent p-3 text-left transition hover:shadow-sm disabled:opacity-40',
                      s.card, statusFilter === k ? 'border-transparent ring-2' : 'border-border')}>
                    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider"><Icon size={12} /> {s.label}</div>
                    <div className="mt-1 text-2xl font-extrabold tabular-nums text-fg">{fmtNumber(counts[k] || 0)}</div>
                  </button>
                );
              })}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg"><History size={12} /> {shaped.remCol >= 0 ? 'Remaining Qty' : 'Last Scrub'}</div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums">{shaped.remCol >= 0 ? fmtNumber(counts.remaining) : (shaped.lastScrub || '—')}</div>
                {shaped.remCol >= 0 && shaped.lastScrub && <div className="text-[10px] text-muted-fg">last scrub {shaped.lastScrub}</div>}
              </div>
            </div>

            {/* Table */}
            <Card className="flex min-h-0 flex-1 flex-col">
              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-4 py-2.5">
                  <div className="relative w-full max-w-xs">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${sheet.name.trim()} — PO, ACK, invoice, remarks…`}
                      className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/50" />
                  </div>
                  <span className="text-[11px] text-muted-fg">{rows.length} of {counts.all} PO{counts.all === 1 ? '' : 's'}</span>
                  <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-fg">
                    <span className="font-semibold">Sheet colours:</span>
                    {['ok', 'pending', 'flag'].map((k) => (
                      <span key={k} className="inline-flex items-center gap-1"><span className={cn('h-2.5 w-2.5 rounded-sm', STATUS[k].dot)} />{STATUS[k].label}</span>
                    ))}
                  </div>
                </div>

                <div className="po-scroll min-h-0 flex-1 overflow-auto rounded-b-xl">
                  <table className="min-w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr>
                        <th className="sticky left-0 top-0 z-30 w-14 min-w-[3.5rem] border-b border-r border-border bg-muted px-2 py-2.5 text-right text-[10px] font-bold text-muted-fg">S.NO</th>
                        <SortHead col={shaped.poCol} label={shaped.header[shaped.poCol] || 'PO#'} className="left-[3.5rem] z-30 border-r" />
                        <SortHead col="status" label="Status" />
                        <SortHead col="latest" label={shaped.scrubCols.length ? 'Latest Scrub' : ' '} />
                        {shaped.coreCols.map((c) => (
                          <SortHead key={c} col={c} label={shaped.header[c]} align={shaped.colType[c] === 'num' ? 'right' : 'left'} />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.length === 0 ? (
                        <tr><td colSpan={colTotal} className="px-4 py-10 text-center text-sm text-muted-fg">No matching POs.</td></tr>
                      ) : rows.map((g) => {
                        const S = STATUS[g.status] || STATUS.none;
                        const isOpen = open.has(g.key);
                        const canOpen = g.lines.length > 0 || g.history.length > 1;
                        // Columns that carry data on the extra lines → the detail mini-table.
                        const lineCols = g.lines.length
                          ? shaped.coreCols.filter((c) => !(shaped.isAll && c === VENDOR_COL) && g.lines.some((ln) => cell(ln?.[c])))
                          : [];
                        // One cell per PO: main value + a "+N" chip for values that live
                        // on the extra lines (hover lists them all, click opens details).
                        const cellWithExtras = (c) => {
                          const main = cell(g.main?.[c]);
                          const extras = g.lines.map((ln, li) => ({ v: cell(ln?.[c]), li: li + 1 })).filter((x) => x.v);
                          if (!extras.length) return renderCell(g, 0, g.main, c);
                          const first = main ? null : extras[0];
                          const rest = main ? extras : extras.slice(1);
                          const allVals = [main, ...extras.map((x) => x.v)].filter(Boolean);
                          return (
                            <div className={cn('flex items-start gap-1.5', shaped.colType[c] === 'num' && 'justify-end')}>
                              <div className="min-w-0">{first ? renderCell(g, first.li, g.lines[first.li - 1], c) : renderCell(g, 0, g.main, c)}</div>
                              {rest.length > 0 && (
                                <button type="button" onClick={() => toggleOpen(g.key)} title={allVals.join('\n')}
                                  className="mt-px shrink-0 rounded-full bg-primary/10 px-1.5 text-[10px] font-bold leading-4 text-primary transition hover:bg-primary/20">
                                  +{rest.length}
                                </button>
                              )}
                            </div>
                          );
                        };
                        return (
                          <Fragment key={g.key}>
                            <tr className={cn('group/row', S.row)}>
                              <td className={cn('sticky left-0 z-10 border-b border-l-4 border-r border-border/60 px-2 py-2 text-right align-top', S.row, S.stripe)}>
                                <div className="flex items-center justify-end gap-1">
                                  {canOpen && (
                                    <button type="button" onClick={() => toggleOpen(g.key)} title={isOpen ? 'Hide details' : 'Show details'}
                                      className="grid h-5 w-5 place-items-center rounded text-muted-fg transition hover:bg-black/5 hover:text-fg dark:hover:bg-white/10">
                                      <ChevronRight size={13} className={cn('transition-transform', isOpen && 'rotate-90')} />
                                    </button>
                                  )}
                                  <span className="text-[11px] font-semibold tabular-nums text-muted-fg">{g.sno || ''}</span>
                                </div>
                              </td>
                              <td className={cn('sticky left-[3.5rem] z-10 whitespace-nowrap border-b border-r border-border/60 px-3 py-2 align-top font-bold text-primary', S.row)}>
                                {renderCell(g, 0, g.main, shaped.poCol)}
                                {g.lines.length > 0 && (
                                  <button type="button" onClick={() => toggleOpen(g.key)}
                                    className="mt-1 flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-primary/20">
                                    <Layers size={10} /> {g.lines.length} more line{g.lines.length === 1 ? '' : 's'}
                                  </button>
                                )}
                              </td>
                              <td className="whitespace-nowrap border-b border-border/40 px-3 py-2 align-top"><StatusPill status={g.status} /></td>
                              <td className="border-b border-border/40 px-3 py-2 align-top">{shaped.scrubCols.length ? <ScrubValue entry={g.latest} /> : null}</td>
                              {shaped.coreCols.map((c) => (
                                <td key={c} className={cn('border-b border-border/40 px-3 py-2 align-top text-[13px]',
                                  shaped.colType[c] === 'num' ? 'whitespace-nowrap text-right font-semibold tabular-nums' : 'max-w-[280px] whitespace-normal break-words')}>
                                  {shaped.isAll && c === VENDOR_COL ? (
                                    <button type="button" onClick={() => { const i = sheets.findIndex((s) => cell(s?.name) === g.vendor); if (i >= 0) switchTab(i); }}
                                      title={`Open ${g.vendor} tab`}
                                      className="whitespace-nowrap rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-primary transition hover:bg-primary/20">
                                      {g.vendor}
                                    </button>
                                  ) : cellWithExtras(c)}
                                </td>
                              ))}
                            </tr>

                            {/* Detail panel: additional lines as a mini-table + scrub history */}
                            {isOpen && (
                              <tr>
                                <td className={cn('sticky left-0 z-10 border-b border-l-4 border-border/40 bg-muted/60', S.stripe)} />
                                <td colSpan={colTotal - 1} className="border-b border-border/40 bg-muted/30 px-3 py-3">
                                  <div className="sticky left-[3.5rem] flex max-w-[calc(100vw-22rem)] flex-col gap-4">
                                    {g.lines.length > 0 && (
                                      <div>
                                        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg">
                                          <Layers size={12} /> Additional lines · PO {g.po}
                                          <span className="rounded-full bg-muted px-1.5 tabular-nums">{g.lines.length}</span>
                                        </div>
                                        <div className="max-w-full overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                                          <table className="text-[12px]">
                                            <thead className="bg-muted/60">
                                              <tr>
                                                <th className="px-2.5 py-1.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-fg">#</th>
                                                {lineCols.map((c) => (
                                                  <th key={c} className={cn('whitespace-nowrap px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg',
                                                    shaped.colType[c] === 'num' ? 'text-right' : 'text-left')}>{shaped.header[c]}</th>
                                                ))}
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {g.lines.map((ln, li) => (
                                                <tr key={li} className="border-t border-border/60 hover:bg-muted/30">
                                                  <td className="px-2.5 py-1.5 align-top text-[11px] font-semibold text-muted-fg">{li + 1}</td>
                                                  {lineCols.map((c) => (
                                                    <td key={c} className={cn('px-2.5 py-1.5 align-top',
                                                      shaped.colType[c] === 'num' ? 'whitespace-nowrap text-right font-semibold tabular-nums' : 'max-w-[300px] whitespace-normal break-words')}>
                                                      {cell(ln?.[c]) ? renderCell(g, li + 1, ln, c) : <span className="text-muted-fg/40">—</span>}
                                                    </td>
                                                  ))}
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      </div>
                                    )}
                                    {g.history.length > 0 && (
                                      <div>
                                        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg"><History size={12} /> Scrub history · PO {g.po}</div>
                                        <ol className="flex flex-wrap gap-2">
                                          {g.history.map((h, hi) => {
                                            const ok = /^ok$/i.test(h.value);
                                            return (
                                              <li key={hi} className={cn('max-w-[320px] rounded-lg border px-2.5 py-1.5 text-[12px]',
                                                ok ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950' : 'border-border bg-card',
                                                hi === g.history.length - 1 && 'ring-2 ring-primary/30')}>
                                                <div className="text-[10px] font-bold text-muted-fg">{h.label}{hi === g.history.length - 1 && ' · latest'}</div>
                                                <div className={cn(ok && 'font-bold text-emerald-700 dark:text-emerald-300')}>{ok ? '✓ OK' : h.value}</div>
                                              </li>
                                            );
                                          })}
                                        </ol>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
