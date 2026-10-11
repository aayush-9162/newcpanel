// PO Scrub Report — a PO tracker built on the "PO SCRUB" Google spreadsheet.
//
// The sheet is the data source, not the layout. Each vendor tab is read via the
// server proxy (display values + cell background colours) and turned into one
// record per PO with derived, decision-ready facts the sheet doesn't show:
//   • arrival status — overdue / arriving soon / on track / no ETA / received
//   • received progress — ordered vs remaining quantity
//   • lateness vs the target date (PO date + N weeks)
//   • missing ACKs, invoices, remarks, scrub history, flagged values
// Sheet colours are kept as a secondary status (green = Confirmed, yellow =
// Pending, red = Flagged). Click a PO for a full detail panel.
import { useMemo, useState, useEffect, useRef } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { usePoScrubQuery, poScrubGet } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  FileSpreadsheet, Search, RefreshCw, AlertTriangle, Maximize2, Minimize2, CheckCircle2, Clock, Flag, Circle,
  Package, History, X, Truck, FileText, MessageSquare, ExternalLink, Layers, Hourglass, PackageCheck,
  AlertCircle, CalendarClock, ChevronRight, Store,
} from 'lucide-react';

const cell = (c) => String(c ?? '').trim();
const nonEmpty = (row) => (row || []).filter((c) => cell(c) !== '').length;
const toNum = (s) => { const n = parseFloat(cell(s).replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0; };

// ── Colour → status (sheet's own markers) ────────────────────────────────────
function statusOfHex(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  if (g > 150 && g > r + 25 && g > b + 25) return 'ok';               // greens
  if (r > 200 && g > 190 && b < Math.min(r, g) - 60) return 'pending'; // yellows
  if (r > 200 && r - g >= 35 && r - b >= 35) return 'flag';           // reds / pinks
  return null;
}
function rowStatus(colorRow) {
  const counts = {};
  for (const h of colorRow || []) { const s = statusOfHex(h); if (s) counts[s] = (counts[s] || 0) + 1; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  if (best[0] === 'flag' && best[1] < 3) return null; // single red cell = cell flag, not a red row
  return best[0];
}

const STATUS = {
  ok:      { label: 'Confirmed', icon: CheckCircle2, pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200', stripe: 'border-l-emerald-500', dot: 'bg-emerald-500' },
  pending: { label: 'Pending',   icon: Clock,        pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',       stripe: 'border-l-amber-400',   dot: 'bg-amber-400' },
  flag:    { label: 'Flagged',   icon: Flag,         pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',           stripe: 'border-l-rose-500',    dot: 'bg-rose-500' },
  none:    { label: 'Unmarked',  icon: Circle,       pill: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',          stripe: 'border-l-slate-300 dark:border-l-slate-600', dot: 'bg-slate-400' },
};

// Arrival status — the main lens of the tracker.
const TIMING = {
  overdue:  { label: 'Overdue',       icon: AlertCircle,   chip: 'bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-900/50 dark:text-rose-200 dark:ring-rose-800',              rank: 0 },
  soon:     { label: 'Arriving soon', icon: Truck,         chip: 'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-900/50 dark:text-amber-200 dark:ring-amber-800',      rank: 1 },
  ontrack:  { label: 'On track',      icon: CalendarClock, chip: 'bg-sky-100 text-sky-700 ring-sky-300 dark:bg-sky-900/50 dark:text-sky-200 dark:ring-sky-800',                  rank: 2 },
  noeta:    { label: 'No ETA',        icon: Hourglass,     chip: 'bg-slate-100 text-slate-600 ring-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700',        rank: 3 },
  received: { label: 'Received',      icon: PackageCheck,  chip: 'bg-emerald-100 text-emerald-700 ring-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:ring-emerald-800', rank: 4 },
};

// ── Dates ────────────────────────────────────────────────────────────────────
function parseDates(s) {
  const out = [];
  const re = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/g;
  let m;
  while ((m = re.exec(String(s ?? '')))) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const d = new Date(y, Number(m[1]) - 1, Number(m[2]));
    if (!Number.isNaN(d.getTime())) out.push(d);
  }
  return out;
}
const today0 = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
const daysBetween = (a, b) => Math.round((a - b) / 86400000);
const fmtD = (d) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');
function spanText(days) {
  const a = Math.abs(days);
  return a >= 60 ? `${Math.round(a / 30)} months` : `${a} day${a === 1 ? '' : 's'}`;
}
function rel(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  return days > 0 ? `in ${spanText(days)}` : `${spanText(days)} ago`;
}

// ── Sheet → PO groups (S.NO/PO# row starts a PO; blank-PO rows are its extra lines)
function shapeSheet(sheet) {
  const values = Array.isArray(sheet?.values) ? sheet.values : [];
  const colors = Array.isArray(sheet?.colors) ? sheet.colors : [];
  const headerIdx = values.findIndex((r) => nonEmpty(r) >= 2);
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
    if (i === snoCol || i === poCol) continue;
    if (/SCRUB\s*DATE/.test(H(i))) {
      const m = (header[i] || '').match(/(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/);
      scrubCols.push({ col: i, label: m ? m[1].replace(/\/(\d{2})?(\d{2})$/, (x, a, b) => `/${b}`) : ((header[i] || '').replace(/SCRUB\s*DATE\s*-?\s*/i, '').trim() || `#${scrubCols.length + 1}`) });
    } else if (header[i] || values.slice(headerIdx + 1).some((r) => cell(r?.[i]))) {
      coreCols.push(i);
    }
  }
  const groups = [];
  for (let r = headerIdx + 1; r < values.length; r++) {
    const row = values[r] || [];
    if (nonEmpty(row) === 0) continue;
    const colorRow = colors[r] || [];
    const po = cell(row[poCol]);
    if (po || !groups.length) {
      groups.push({ key: `${r}`, sno: snoCol >= 0 ? cell(row[snoCol]) : '', po, main: row, mainColors: colorRow, lines: [], lineColors: [], status: rowStatus(colorRow) || 'none' });
    } else {
      const g = groups[groups.length - 1];
      g.lines.push(row); g.lineColors.push(colorRow);
    }
  }
  for (const g of groups) {
    const all = [g.main, ...g.lines];
    const allColors = [g.mainColors, ...g.lineColors];
    g.flagCells = new Set();
    allColors.forEach((cr, li) => (cr || []).forEach((h, ci) => {
      if (statusOfHex(h) === 'flag' && cell(all[li]?.[ci])) g.flagCells.add(`${li}:${ci}`);
    }));
    if (g.flagCells.size && g.status !== 'pending') g.status = 'flag';
    g.history = scrubCols.map((s) => ({ label: s.label, value: all.map((r) => cell(r?.[s.col])).filter(Boolean).join(' · ') })).filter((h) => h.value);
    g.latest = g.history.length ? g.history[g.history.length - 1] : null;
    g.search = all.map((r) => (r || []).join(' ')).join(' ').toLowerCase();
  }
  return { header, poCol, coreCols, groups };
}

// ── Header → semantic field (vendors name the same field differently) ─────────
const FIELD_RULES = [
  ['ack', /^ACK/],
  ['type', /^STOCK\s*\/?\s*SO|^STOCK$/],
  ['orderType', /^ORDER\s*TYPE/],
  ['poDate', /^PO\s*DATE/],
  ['portEta', /DATE\s*AT\s*PORT|ARR(IVAL)?\.?\s*DATE.*PORT/],
  ['vendorEta', /^EXPEC(TED)?\.?\s*(SHIP\s*)?DATE\s*BY\s*VEN/],
  ['target', /^EXPECTED\s*DATE\s*-\s*\d+\s*WEEKS?/],
  ['invoiceDate', /^INVOICE\s*DATE/],
  ['origQty', /^ORIGINAL/],
  ['remQty', /REMAINING\s*QTY/],
  ['vendorQty', /QTY\s*SHOWING\s*ON\s*VENDOR/],
  ['invQty', /QTY\s*IN\s*INVOICE/],
  ['invoiceNo', /^INVOICE\s*NO/],
  ['remarks2', /^REMARKS\s*\d/],
  ['remarks', /^REMARKS/],
  ['estDel', /^EST\.?\s*DEL/],
];
const fieldOf = (h) => { const u = cell(h).toUpperCase().replace(/\s+/g, ' '); for (const [f, re] of FIELD_RULES) if (re.test(u)) return f; return null; };

// One PO group → a tracker record with derived facts.
function buildRecords(shaped, vendor, gid) {
  if (!shaped) return [];
  const cols = {};
  const extraCols = [];
  for (const c of shaped.coreCols) {
    const f = fieldOf(shaped.header[c]);
    if (f && cols[f] == null) cols[f] = c; else extraCols.push(c);
  }
  const t0 = today0();
  return shaped.groups.map((g) => {
    const rows = [g.main, ...g.lines];
    const v = (f, r = g.main) => (cols[f] != null ? cell(r?.[cols[f]]) : '');
    const vals = (f) => rows.map((r) => v(f, r)).filter(Boolean);
    const isFlag = (f) => cols[f] != null && rows.some((_, li) => g.flagCells.has(`${li}:${cols[f]}`));
    const latestOf = (f) => { const ds = vals(f).flatMap(parseDates); return ds.length ? new Date(Math.max(...ds)) : null; };

    const orig = v('origQty') ? toNum(v('origQty')) : null;
    const rem = cols.remQty != null && v('remQty') !== '' ? toNum(v('remQty')) : null;
    const portEta = latestOf('portEta'), vendorEta = latestOf('vendorEta'), estDel = latestOf('estDel');
    const eta = portEta || vendorEta || estDel;
    const etaSrc = portEta ? 'Arrival at port' : vendorEta ? 'Vendor expected' : estDel ? 'Est. delivery' : null;
    const target = parseDates(v('target'))[0] || null;
    const targetWeeks = cols.target != null ? ((shaped.header[cols.target] || '').match(/(\d+)\s*WEEK/i)?.[1] || null) : null;
    const poDate = parseDates(v('poDate'))[0] || null;
    const received = rem === 0;
    const etaDays = eta ? daysBetween(eta, t0) : null;
    const timing = received ? 'received' : eta == null ? 'noeta' : etaDays < 0 ? 'overdue' : etaDays <= 14 ? 'soon' : 'ontrack';
    const acks = [...new Set(vals('ack'))];

    return {
      key: `${vendor}::${g.key}`, vendor, gid, po: g.po || '—', sno: g.sno, status: g.status,
      acks, type: v('type'), orderType: v('orderType'),
      poDate, ageDays: poDate ? daysBetween(t0, poDate) : null,
      orig, rem, receivedQty: orig != null && rem != null ? Math.max(0, orig - rem) : null,
      vendorQty: v('vendorQty') ? toNum(v('vendorQty')) : null,
      eta, etaSrc, etaDays, timing, portEta, vendorEta, estDel, target, targetWeeks,
      lateVsTarget: eta && target && !received ? daysBetween(eta, target) : null,
      invoices: rows.map((r) => ({ no: v('invoiceNo', r), date: v('invoiceDate', r), qty: v('invQty', r) })).filter((x) => x.no || x.date || x.qty),
      remarks: [...vals('remarks'), ...vals('remarks2')],
      latest: g.latest, history: g.history,
      etaFlagged: isFlag('portEta') || isFlag('vendorEta') || isFlag('estDel'),
      qtyFlagged: isFlag('remQty') || isFlag('vendorQty') || isFlag('origQty'),
      flagged: [...g.flagCells].map((k) => { const [li, c] = k.split(':').map(Number); return { label: c === shaped.poCol ? 'PO#' : (shaped.header[c] || 'Value'), value: cell(rows[li]?.[c]) }; }),
      subLines: g.lines.map((ln, i) => shaped.coreCols
        .map((c) => ({ label: shaped.header[c], value: cell(ln?.[c]), flagged: g.flagCells.has(`${i + 1}:${c}`) }))
        .filter((x) => x.value)),
      extras: extraCols.map((c) => ({ label: shaped.header[c], value: cell(g.main?.[c]) })).filter((x) => x.value),
      search: `${g.search} ${vendor.toLowerCase()}`,
    };
  });
}

// ── Small UI pieces ──────────────────────────────────────────────────────────
function StatusPill({ status, small }) {
  const s = STATUS[status] || STATUS.none; const Icon = s.icon;
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-semibold', small ? 'px-1.5 py-px text-[10px]' : 'px-2 py-0.5 text-[11px]', s.pill)}><Icon size={small ? 10 : 11} />{s.label}</span>;
}
function TimingChip({ rec, big }) {
  const t = TIMING[rec.timing] || TIMING.noeta; const Icon = t.icon;
  const text = rec.timing === 'overdue' ? `Overdue ${spanText(rec.etaDays)}`
    : rec.timing === 'soon' ? (rec.etaDays === 0 ? 'Arrives today' : `Arrives in ${spanText(rec.etaDays)}`)
    : rec.timing === 'ontrack' ? `Due in ${spanText(rec.etaDays)}`
    : t.label;
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full font-bold ring-1', big ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]', t.chip)}><Icon size={big ? 13 : 11} />{text}</span>;
}
function QtyBar({ rec, compact }) {
  if (rec.orig == null && rec.rem == null) return <span className="text-xs text-muted-fg">No quantities recorded</span>;
  const pct = rec.orig ? Math.min(100, Math.round(((rec.receivedQty ?? 0) / rec.orig) * 100)) : null;
  return (
    <div className="w-full">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        {rec.orig != null
          ? <span className="text-muted-fg"><b className="text-sm text-fg tabular-nums">{fmtNumber(rec.receivedQty ?? 0)}</b> / {fmtNumber(rec.orig)} received</span>
          : <span className="text-muted-fg">Ordered qty not set</span>}
        {pct != null && <span className="font-bold tabular-nums text-muted-fg">{pct}%</span>}
      </div>
      {pct != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-sky-500' : 'bg-amber-500')} style={{ width: `${pct}%` }} />
        </div>
      )}
      {!compact && rec.rem != null && rec.rem > 0 && (
        <div className={cn('mt-1 text-[11px] font-semibold', rec.qtyFlagged ? 'text-rose-600 dark:text-rose-300' : 'text-fg/80')}>
          {fmtNumber(rec.rem)} still open{rec.vendorQty != null && rec.vendorQty !== rec.rem ? ` · vendor shows ${fmtNumber(rec.vendorQty)}` : ''}
        </div>
      )}
    </div>
  );
}

// ── PO card (one per PO in the list) ─────────────────────────────────────────
function POCard({ rec, showVendor, onOpen }) {
  const s = STATUS[rec.status] || STATUS.none;
  const open = () => onOpen(rec.key);
  const note = rec.remarks[0] || (rec.latest && !/^ok$/i.test(rec.latest.value) ? rec.latest.value : '');
  return (
    <div role="button" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }}
      className={cn('grid cursor-pointer grid-cols-1 gap-3 rounded-xl border border-l-4 border-border bg-card p-3.5 transition hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30 md:grid-cols-2 xl:grid-cols-12', s.stripe)}>
      {/* Identity */}
      <div className="min-w-0 xl:col-span-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-extrabold tracking-tight text-primary">PO {rec.po}</span>
          {showVendor && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">{rec.vendor}</span>}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {rec.type && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-fg/80">{rec.type}</span>}
          {rec.orderType && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-fg">{rec.orderType}</span>}
          <StatusPill status={rec.status} small />
        </div>
        <div className="mt-1.5 text-[11px] text-muted-fg">
          {rec.acks.length
            ? <>ACK <b className="text-fg/80">{rec.acks[0]}</b>{rec.acks.length > 1 && ` +${rec.acks.length - 1}`}</>
            : <span className="font-semibold text-violet-600 dark:text-violet-300">Awaiting ACK</span>}
          {rec.poDate && <> · ordered {fmtD(rec.poDate)}</>}
        </div>
      </div>

      {/* Quantity */}
      <div className="xl:col-span-3"><QtyBar rec={rec} /></div>

      {/* Arrival */}
      <div className="xl:col-span-3">
        <TimingChip rec={rec} />
        {rec.eta && (
          <div className={cn('mt-1.5 text-[12px]', rec.etaFlagged && 'font-semibold text-rose-600 dark:text-rose-300')}>
            <span className="text-muted-fg">{rec.etaSrc}:</span> <b>{fmtD(rec.eta)}</b>
          </div>
        )}
        {rec.lateVsTarget != null && (rec.lateVsTarget > 0
          ? <div className="mt-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-300">{spanText(rec.lateVsTarget)} later than target</div>
          : <div className="mt-0.5 text-[11px] text-emerald-700 dark:text-emerald-300">Within target{rec.targetWeeks ? ` (${rec.targetWeeks} wk)` : ''}</div>)}
      </div>

      {/* Activity */}
      <div className="min-w-0 xl:col-span-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {rec.latest && (/^ok$/i.test(rec.latest.value)
            ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200"><CheckCircle2 size={10} /> Scrub OK · {rec.latest.label}</span>
            : <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:bg-sky-900/50 dark:text-sky-200"><History size={10} /> Scrub {rec.latest.label}</span>)}
          {rec.invoices.length > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-fg/80"><FileText size={10} /> {rec.invoices.length} invoice{rec.invoices.length === 1 ? '' : 's'}</span>}
          {rec.subLines.length > 0 && <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-fg/80"><Layers size={10} /> {rec.subLines.length} more line{rec.subLines.length === 1 ? '' : 's'}</span>}
        </div>
        {note && <p className="mt-1.5 line-clamp-2 text-[12px] text-fg/80" title={rec.remarks.join('\n') || note}>{note}</p>}
      </div>
    </div>
  );
}

// ── Detail panel (slide-over) ────────────────────────────────────────────────
function Section({ icon: Icon, title, children, count }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg">
        <Icon size={12} /> {title}{count != null && <span className="rounded-full bg-muted px-1.5 tabular-nums">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function PODrawer({ rec, sheetUrl, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!rec) return null;
  const t0 = today0();
  const milestones = [
    { label: 'PO placed', date: rec.poDate, placed: true },
    { label: `Target${rec.targetWeeks ? ` (PO + ${rec.targetWeeks} wk)` : ''}`, date: rec.target, target: true },
    { label: 'Vendor expected date', date: rec.vendorEta, flagged: rec.etaFlagged },
    { label: 'Arrival at port', date: rec.portEta, flagged: rec.etaFlagged },
    { label: 'Est. delivery', date: rec.estDel },
  ].filter((m) => m.date).sort((a, b) => a.date - b.date);
  const stat = (label, value, tone) => (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
      <div className={cn('mt-0.5 text-lg font-extrabold tabular-nums', tone)}>{value}</div>
    </div>
  );
  const s = STATUS[rec.status] || STATUS.none;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className={cn('relative flex h-full w-full max-w-xl flex-col border-l-4 bg-bg shadow-2xl', s.stripe)} role="dialog" aria-modal="true">
        <div className="border-b border-border bg-card px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{rec.vendor}{rec.sno ? ` · S.NO ${rec.sno}` : ''}</div>
              <div className="text-2xl font-extrabold tracking-tight text-primary">PO {rec.po}</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <TimingChip rec={rec} big />
                <StatusPill status={rec.status} />
                {rec.type && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase">{rec.type}</span>}
                {rec.orderType && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-fg">{rec.orderType}</span>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border text-muted-fg transition hover:bg-muted" aria-label="Close"><X size={16} /></button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stat('Ordered', rec.orig != null ? fmtNumber(rec.orig) : '—')}
            {stat('Received', rec.receivedQty != null ? fmtNumber(rec.receivedQty) : '—', 'text-emerald-600 dark:text-emerald-300')}
            {stat('Still open', rec.rem != null ? fmtNumber(rec.rem) : '—', rec.qtyFlagged ? 'text-rose-600 dark:text-rose-300' : rec.rem ? 'text-amber-600 dark:text-amber-300' : '')}
            {stat('On vendor site', rec.vendorQty != null ? fmtNumber(rec.vendorQty) : '—')}
          </div>
          <QtyBar rec={rec} compact />

          <div className="grid grid-cols-2 gap-2 text-[12px]">
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">Acknowledgement</div>
              {rec.acks.length ? rec.acks.map((a) => <div key={a} className="font-semibold">{a}</div>) : <div className="font-semibold text-violet-600 dark:text-violet-300">Awaiting ACK</div>}
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">PO age</div>
              <div className="font-semibold">{rec.ageDays != null ? `${fmtNumber(rec.ageDays)} days` : '—'}</div>
              {rec.poDate && <div className="text-muted-fg">placed {fmtD(rec.poDate)}</div>}
            </div>
          </div>

          {milestones.length > 0 && (
            <Section icon={CalendarClock} title="Dates">
              <ol className="relative ml-2 border-l-2 border-border pl-4">
                {milestones.map((m, i) => {
                  const d = daysBetween(m.date, t0);
                  const late = !m.target && !m.placed && d < 0 && rec.timing !== 'received';
                  return (
                    <li key={i} className="relative pb-3 last:pb-0">
                      <span className={cn('absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-2 ring-bg',
                        m.target ? 'bg-violet-500' : late ? 'bg-rose-500' : d < 0 ? 'bg-slate-400' : 'bg-sky-500')} />
                      <div className="text-[11px] font-semibold text-muted-fg">{m.label}</div>
                      <div className={cn('text-sm font-bold', (late || m.flagged) && 'text-rose-600 dark:text-rose-300')}>
                        {fmtD(m.date)} <span className="text-[11px] font-medium text-muted-fg">· {rel(d)}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              {rec.lateVsTarget != null && (
                <div className={cn('mt-2 rounded-lg px-3 py-2 text-[12px] font-semibold',
                  rec.lateVsTarget > 0 ? 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-200' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200')}>
                  {rec.lateVsTarget > 0 ? `Expected ${spanText(rec.lateVsTarget)} later than target` : `On or ahead of target by ${spanText(rec.lateVsTarget)}`}
                </div>
              )}
            </Section>
          )}

          {rec.flagged.length > 0 && (
            <Section icon={Flag} title="Flagged in sheet" count={rec.flagged.length}>
              <div className="space-y-1">
                {rec.flagged.map((f, i) => (
                  <div key={i} className="flex justify-between gap-3 rounded-lg bg-rose-50 px-3 py-1.5 text-[12px] dark:bg-rose-950">
                    <span className="text-rose-700/80 dark:text-rose-300/80">{f.label}</span>
                    <span className="text-right font-semibold text-rose-700 dark:text-rose-200">{f.value}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {rec.invoices.length > 0 && (
            <Section icon={FileText} title="Invoices & shipments" count={rec.invoices.length}>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-[12px]">
                  <thead className="bg-muted/60 text-[10px] uppercase tracking-wider text-muted-fg">
                    <tr><th className="px-3 py-1.5 text-left">Invoice #</th><th className="px-3 py-1.5 text-left">Date</th><th className="px-3 py-1.5 text-right">Qty</th></tr>
                  </thead>
                  <tbody>
                    {rec.invoices.map((iv, i) => (
                      <tr key={i} className="border-t border-border/60 bg-card align-top">
                        <td className="px-3 py-1.5 font-semibold">{iv.no || '—'}</td>
                        <td className="px-3 py-1.5">{iv.date || '—'}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{iv.qty || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {rec.remarks.length > 0 && (
            <Section icon={MessageSquare} title="Remarks" count={rec.remarks.length}>
              <div className="space-y-1.5">
                {rec.remarks.map((r, i) => <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 text-[12px]">{r}</div>)}
              </div>
            </Section>
          )}

          {rec.subLines.length > 0 && (
            <Section icon={Layers} title="Additional lines" count={rec.subLines.length}>
              <div className="space-y-2">
                {rec.subLines.map((fields, i) => (
                  <div key={i} className="rounded-lg border border-border bg-card px-3 py-2">
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-fg">Line {i + 1}</div>
                    <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[12px]">
                      {fields.map((f, j) => (
                        <div key={j} className="contents">
                          <dt className="text-muted-fg">{f.label}</dt>
                          <dd className={cn('font-medium', f.flagged && 'font-semibold text-rose-600 dark:text-rose-300')}>{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {rec.extras.length > 0 && (
            <Section icon={Package} title="Other details">
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-[12px]">
                {rec.extras.map((f, j) => (
                  <div key={j} className="contents"><dt className="text-muted-fg">{f.label}</dt><dd className="font-medium">{f.value}</dd></div>
                ))}
              </dl>
            </Section>
          )}

          {rec.history.length > 0 && (
            <Section icon={History} title="Scrub history" count={rec.history.length}>
              <ol className="space-y-1.5">
                {[...rec.history].reverse().map((h, i) => {
                  const ok = /^ok$/i.test(h.value);
                  return (
                    <li key={i} className={cn('flex gap-3 rounded-lg border px-3 py-1.5 text-[12px]',
                      ok ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950' : 'border-border bg-card', i === 0 && 'ring-2 ring-primary/30')}>
                      <span className="w-20 shrink-0 font-bold text-muted-fg">{h.label}{i === 0 && <span className="block text-[9px] uppercase text-primary">latest</span>}</span>
                      <span className={cn(ok && 'font-bold text-emerald-700 dark:text-emerald-300')}>{ok ? '✓ OK' : h.value}</span>
                    </li>
                  );
                })}
              </ol>
            </Section>
          )}
        </div>

        {sheetUrl && (
          <div className="border-t border-border bg-card px-5 py-3">
            <a href={`${sheetUrl}${rec.gid != null ? `#gid=${rec.gid}` : ''}`} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline">
              <ExternalLink size={13} /> Open {rec.vendor} tab in Google Sheets
            </a>
          </div>
        )}
      </aside>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
const VIEWS = [
  { key: 'all', label: 'All POs' },
  { key: 'overdue', label: 'Overdue', test: (r) => r.timing === 'overdue' },
  { key: 'soon', label: 'Arriving ≤ 14 days', test: (r) => r.timing === 'soon' },
  { key: 'noack', label: 'Awaiting ACK', test: (r) => !r.acks.length && r.timing !== 'received' },
  { key: 'noeta', label: 'No ETA', test: (r) => r.timing === 'noeta' },
  { key: 'received', label: 'Received', test: (r) => r.timing === 'received' },
  { key: 'c:ok', label: 'Confirmed', test: (r) => r.status === 'ok', dot: STATUS.ok.dot },
  { key: 'c:pending', label: 'Pending', test: (r) => r.status === 'pending', dot: STATUS.pending.dot },
  { key: 'c:flag', label: 'Flagged', test: (r) => r.status === 'flag', dot: STATUS.flag.dot },
  { key: 'c:none', label: 'Unmarked', test: (r) => r.status === 'none', dot: STATUS.none.dot },
];
const SORTS = {
  attention: { label: 'Needs attention', fn: (a, b) => (TIMING[a.timing].rank - TIMING[b.timing].rank) || ((a.etaDays ?? 1e9) - (b.etaDays ?? 1e9)) },
  eta: { label: 'Arrival date', fn: (a, b) => ((a.eta?.getTime() ?? 9e15) - (b.eta?.getTime() ?? 9e15)) },
  newest: { label: 'Newest PO', fn: (a, b) => ((b.poDate?.getTime() ?? 0) - (a.poDate?.getTime() ?? 0)) },
  open: { label: 'Most qty open', fn: (a, b) => ((b.rem ?? -1) - (a.rem ?? -1)) },
  po: { label: 'PO number', fn: (a, b) => String(a.po).localeCompare(String(b.po), undefined, { numeric: true }) },
};

export default function POScrubReport() {
  const { data, isLoading, error, refetch, isFetching } = usePoScrubQuery({
    refetchInterval: 5 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
  const [active, setActive] = useState(-1);          // -1 = All vendors
  const [q, setQ] = useState('');
  const [view, setView] = useState('all');
  const [sortKey, setSortKey] = useState('attention');
  const [selectedKey, setSelectedKey] = useState(null);
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

  const sheets = useMemo(() => (Array.isArray(data?.sheets) ? data.sheets : []), [data]);
  useEffect(() => { if (active > sheets.length - 1) setActive(-1); }, [sheets.length, active]);

  // Records per vendor tab (each parsed defensively — one bad tab never blanks the page).
  const recordsByTab = useMemo(() => sheets.map((s) => {
    try { return buildRecords(shapeSheet(s), cell(s?.name) || 'Vendor', s?.gid ?? null); } catch { return []; }
  }), [sheets]);
  const isAll = active === -1;
  const records = useMemo(() => (isAll ? recordsByTab.flat() : (recordsByTab[active] || [])), [isAll, recordsByTab, active]);
  const selected = useMemo(() => records.find((r) => r.key === selectedKey) || null, [records, selectedKey]);

  const stats = useMemo(() => {
    const st = { total: records.length, open: 0, overdue: 0, soon: 0, noack: 0, received: 0, openQty: 0 };
    for (const r of records) {
      if (r.timing !== 'received') st.open++;
      if (r.timing === 'overdue') st.overdue++;
      if (r.timing === 'soon') st.soon++;
      if (r.timing === 'received') st.received++;
      if (!r.acks.length && r.timing !== 'received') st.noack++;
      if (r.rem > 0) st.openQty += r.rem;
    }
    return st;
  }, [records]);
  const viewCount = (k) => { const v = VIEWS.find((x) => x.key === k); return v?.test ? records.filter(v.test).length : records.length; };

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const v = VIEWS.find((x) => x.key === view);
    return records
      .filter((r) => (!v?.test || v.test(r)) && (!needle || r.search.includes(needle)))
      .sort(SORTS[sortKey]?.fn || SORTS.attention.fn);
  }, [records, q, view, sortKey]);

  // Vendor overview (All view): open / overdue / open qty per vendor.
  const vendorSummary = useMemo(() => sheets.map((s, i) => {
    const recs = recordsByTab[i] || [];
    return {
      i, name: cell(s?.name), total: recs.length,
      open: recs.filter((r) => r.timing !== 'received').length,
      overdue: recs.filter((r) => r.timing === 'overdue').length,
      soon: recs.filter((r) => r.timing === 'soon').length,
      openQty: recs.reduce((t, r) => t + (r.rem > 0 ? r.rem : 0), 0),
    };
  }).filter((v) => v.total > 0), [sheets, recordsByTab]);

  const switchTab = (i) => { setActive(i); setQ(''); setView('all'); setSelectedKey(null); };
  const hardRefresh = async () => {
    setRefreshing(true);
    try { await poScrubGet(true); await refetch(); } catch { /* surfaced via query error */ }
    finally { setRefreshing(false); }
  };
  const fetchedAt = data?.fetchedAt ? new Date(data.fetchedAt) : null;
  const scopeName = isAll ? 'All vendors' : cell(sheets[active]?.name);
  const totalAll = recordsByTab.reduce((t, r) => t + r.length, 0);

  const kpi = (k, label, value, Icon, tone, sub) => (
    <button type="button" onClick={() => setView((cur) => (cur === k ? 'all' : k))}
      className={cn('rounded-xl border bg-card p-3 text-left transition hover:shadow-sm',
        view === k ? 'border-primary ring-2 ring-primary/20' : 'border-border')}>
      <div className={cn('flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider', tone)}><Icon size={12} /> {label}</div>
      <div className="mt-1 text-2xl font-extrabold tabular-nums">{value}</div>
      {sub && <div className="text-[10px] text-muted-fg">{sub}</div>}
    </button>
  );

  return (
    <>
      <Topbar title="PO Scrub Report" subtitle={data?.title || 'Purchase-order tracker'} />

      <div ref={rootRef} className={cn('flex flex-1 flex-col gap-3 bg-bg p-4', isFull && 'overflow-auto')}>
        {/* Toolbar + vendor tabs */}
        <Card className="shrink-0">
          <CardContent className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-gradient-to-r from-emerald-500/10 via-transparent to-transparent px-4 py-3">
              <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
              <span className="text-sm font-semibold">{data?.title || 'PO Scrub Report'}</span>
              {sheets.length > 0 && <span className="text-[11px] text-muted-fg">· {sheets.length} vendors</span>}
              <div className="ml-auto flex items-center gap-2">
                {fetchedAt && <span className="hidden text-[11px] text-muted-fg sm:inline">Updated {fetchedAt.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>}
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
                <button type="button" onClick={() => switchTab(-1)}
                  className={cn('relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-bold transition',
                    isAll ? 'bg-primary text-primary-fg shadow-sm' : 'border border-primary/30 text-primary hover:bg-primary/10')}>
                  All <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', isAll ? 'bg-white/25' : 'bg-primary/10')}>{totalAll}</span>
                </button>
                <span className="mx-1 my-1 w-px shrink-0 bg-border" />
                {sheets.map((s, i) => {
                  const recs = recordsByTab[i] || [];
                  const overdue = recs.filter((r) => r.timing === 'overdue').length;
                  return (
                    <button key={`${s?.name}${i}`} type="button" onClick={() => switchTab(i)}
                      className={cn('relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                        i === active ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted')}>
                      {cell(s?.name)}
                      <span className={cn('rounded-full px-1.5 text-[10px] tabular-nums', i === active ? 'bg-white/25' : 'bg-muted')}>{recs.length}</span>
                      {overdue > 0 && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-card" title={`${overdue} overdue`} />}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid place-items-center py-16 text-sm text-muted-fg">
            <div className="flex flex-col items-center gap-3"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading POs…</div>
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
        ) : !sheets.length ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-fg">No vendor tabs found in the sheet.</CardContent></Card>
        ) : (
          <>
            {/* KPI cards (click to filter) */}
            <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              {kpi('all', `${scopeName} · Open POs`, fmtNumber(stats.open), Package, 'text-muted-fg', `of ${fmtNumber(stats.total)} total`)}
              {kpi('overdue', 'Overdue', fmtNumber(stats.overdue), AlertCircle, 'text-rose-600 dark:text-rose-300', 'past expected date')}
              {kpi('soon', 'Arriving ≤ 14 days', fmtNumber(stats.soon), Truck, 'text-amber-600 dark:text-amber-300', 'plan receiving')}
              {kpi('noack', 'Awaiting ACK', fmtNumber(stats.noack), Hourglass, 'text-violet-600 dark:text-violet-300', 'no vendor ack yet')}
              {kpi('received', 'Fully received', fmtNumber(stats.received), PackageCheck, 'text-emerald-600 dark:text-emerald-300', 'remaining qty = 0')}
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg"><Layers size={12} /> Open qty</div>
                <div className="mt-1 text-2xl font-extrabold tabular-nums">{fmtNumber(stats.openQty)}</div>
                <div className="text-[10px] text-muted-fg">units still to receive</div>
              </div>
            </div>

            {/* Vendor overview — All view only */}
            {isAll && vendorSummary.length > 0 && (
              <Card className="shrink-0">
                <CardContent className="p-3">
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-fg"><Store size={12} /> By vendor <span className="font-medium normal-case tracking-normal">· click to open</span></div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                    {[...vendorSummary].sort((a, b) => b.overdue - a.overdue || b.openQty - a.openQty).map((v) => (
                      <button key={v.i} type="button" onClick={() => switchTab(v.i)}
                        className={cn('flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left transition hover:border-primary/40 hover:shadow-sm',
                          v.overdue ? 'border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/40' : 'border-border bg-card')}>
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-bold">{v.name}</div>
                          <div className="text-[10px] text-muted-fg">
                            {v.open} open{v.overdue > 0 && <span className="font-bold text-rose-600 dark:text-rose-300"> · {v.overdue} overdue</span>}{v.soon > 0 && <span className="font-semibold text-amber-600 dark:text-amber-300"> · {v.soon} soon</span>}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-extrabold tabular-nums">{fmtNumber(v.openQty)}</div>
                          <div className="text-[9px] uppercase text-muted-fg">open qty</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Filter bar */}
            <Card className="shrink-0">
              <CardContent className="flex flex-col gap-2.5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-full max-w-sm">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${scopeName} — PO, ACK, invoice, remarks…`}
                      className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-3 text-sm outline-none focus:border-primary/50" />
                  </div>
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-fg">
                    Sort
                    <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
                      className="rounded-lg border border-border bg-card px-2 py-1.5 text-xs font-semibold text-fg outline-none focus:border-primary/50">
                      {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {VIEWS.map((v, i) => {
                    const n = viewCount(v.key);
                    const firstColour = v.key.startsWith('c:') && !VIEWS[i - 1]?.key.startsWith('c:');
                    return (
                      <span key={v.key} className="contents">
                        {firstColour && <span className="mx-1 text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Sheet colour</span>}
                        <button type="button" onClick={() => setView(v.key)} disabled={!n && v.key !== 'all'}
                          className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition disabled:opacity-40',
                            view === v.key ? 'border-primary bg-primary text-primary-fg' : 'border-border bg-card text-fg/80 hover:bg-muted')}>
                          {v.dot && <span className={cn('h-2 w-2 rounded-full', v.dot)} />}
                          {v.label}
                          <span className={cn('rounded-full px-1 tabular-nums', view === v.key ? 'bg-white/25' : 'bg-muted')}>{n}</span>
                        </button>
                      </span>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* PO list */}
            <div className="flex items-center justify-between px-1 text-[11px] text-muted-fg">
              <span>{list.length} PO{list.length === 1 ? '' : 's'} · sorted by {SORTS[sortKey]?.label.toLowerCase()}</span>
              <span className="hidden items-center gap-1 sm:inline-flex">Click a PO for full details <ChevronRight size={12} /></span>
            </div>
            {list.length === 0 ? (
              <Card><CardContent className="py-12 text-center text-sm text-muted-fg">No POs match this filter.</CardContent></Card>
            ) : (
              <div className="flex flex-col gap-2">
                {list.map((r) => <POCard key={r.key} rec={r} showVendor={isAll} onOpen={setSelectedKey} />)}
              </div>
            )}
          </>
        )}

        {/* Detail panel lives inside rootRef so it still shows in full-screen mode */}
        {selected && <PODrawer rec={selected} sheetUrl={data?.url} onClose={() => setSelectedKey(null)} />}
      </div>
    </>
  );
}
