// Floor Sales — items sold off the showroom floor. When a floor sample sells, its
// spot goes empty, so this page doubles as a REFILL BOARD: for each sold item we
// look up its live stock locations (ALB = Aisle·Level·Bay) from the inventory API
// and tell the team whether the spot can be refilled from the warehouse (999),
// is still stocked on the floor, or needs a reorder.
//
// Views: Daily (defaults to the latest sales day) · Weekly · Monthly, driven by a
// single calendar anchor + a store selector.
import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { HeroBanner } from '@/components/HeroStat';
import { useSqlQuery, useFloorLabelsQuery } from '@/lib/api';
import { rowsToCSV } from '@/components/DataTable';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  Sofa, Truck, PackageX, Boxes, MapPin, Calendar, Search, Download,
  AlertTriangle, ShoppingCart, Clock, ChevronDown,
} from 'lucide-react';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseISO = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');
const shortDate = (s) => s ? parseISO(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const longDate = (s) => s ? parseISO(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : '';

const STORES = [
  { value: 1, label: 'Arden', code: 'S1' },
  { value: 2, label: 'Waynesville', code: 'S2' },
];
const MODES = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
];

// ALB = Aisle·Level·Bay location string for a stock label.
const albOf = (l) => [l.aisle, l.level, l.bay].filter((x) => String(x ?? '').trim() !== '').join('·') || '—';

const STATUS = {
  refill:  { label: 'Refill from warehouse', tone: 'amber',   icon: Truck,        blurb: 'Floor spot empty — stock waiting in the warehouse' },
  reorder: { label: 'Reorder needed',        tone: 'rose',    icon: PackageX,     blurb: 'No stock on hand anywhere — order more' },
  onfloor: { label: 'Still on the floor',    tone: 'emerald', icon: Boxes,        blurb: 'Display still has stock — nothing to do' },
  unknown: { label: 'Checking stock…',       tone: 'slate',   icon: AlertTriangle,blurb: 'Location lookup unavailable' },
};
const TONE = {
  amber:   { chip: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200', ring: 'border-amber-500/40', dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-300', grad: 'from-amber-500 to-orange-500' },
  rose:    { chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200', ring: 'border-rose-500/40', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-300', grad: 'from-rose-500 to-red-500' },
  emerald: { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200', ring: 'border-emerald-500/40', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-300', grad: 'from-emerald-500 to-teal-500' },
  slate:   { chip: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200', ring: 'border-slate-500/30', dot: 'bg-slate-400', text: 'text-slate-500 dark:text-slate-300', grad: 'from-slate-400 to-slate-500' },
};

export default function FloorSales() {
  const [store, setStore] = useState(1);
  const [mode, setMode]   = useState('daily');
  const [anchor, setAnchor] = useState('');
  const [q, setQ] = useState('');
  const [openGroups, setOpenGroups] = useState({ refill: true, reorder: true, onfloor: false, unknown: false });

  // Latest sales day on file for the store — the Daily default ("yesterday").
  const latestQ = useSqlQuery(
    `SELECT CONVERT(char(10), MAX(SaleDate), 23) AS d FROM SalesItemDetail WHERE BLDG = ? AND SaleDate < CAST(GETDATE() AS DATE)`,
    [store],
  );
  const latest = latestQ.data?.rows?.[0]?.d || null;
  useEffect(() => { if (!anchor && latest) setAnchor(latest); }, [latest, anchor]);

  // Resolve the date window from the mode + calendar anchor.
  const range = useMemo(() => {
    if (!anchor) return { from: '', to: '', label: '' };
    const d = parseISO(anchor);
    if (mode === 'daily') return { from: anchor, to: anchor, label: longDate(anchor) };
    if (mode === 'weekly') {
      const start = new Date(d); start.setDate(d.getDate() - d.getDay());
      const end = new Date(start); end.setDate(start.getDate() + 6);
      return { from: iso(start), to: iso(end), label: `Week of ${shortDate(iso(start))} – ${shortDate(iso(end))}` };
    }
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return { from: iso(start), to: iso(end), label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) };
  }, [mode, anchor]);

  // Floor sales = in-stock item lines (OnOrder = 0, i.e. not special orders).
  const sql = range.from
    ? `SELECT SaleDate, SaleNo, ItemID, VendorID, CAT, Description, BLDG, OnOrder, DeliveryDate, DeliveryStatus, ReadyStatus, ItemStatus
       FROM SalesItemDetail
       WHERE BLDG = ? AND SaleDate >= ? AND SaleDate <= ? AND ISNULL(OnOrder, 0) = 0
       ORDER BY SaleDate DESC`
    : 'SELECT 1 AS x WHERE 1 = 0';
  const { data, isLoading } = useSqlQuery(sql, range.from ? [store, range.from, range.to] : [], { enabled: !!range.from });
  const rows = data?.rows ?? [];

  // Unique item IDs → batch ALB lookup.
  const itemIds = useMemo(() => [...new Set(rows.map((r) => String(r.ItemID ?? '').trim()).filter(Boolean))], [rows]);
  const labelsQ = useFloorLabelsQuery(itemIds);
  const labelsMap = labelsQ.data ?? {};

  // Aggregate lines → one card per item, enriched with locations + refill status.
  const items = useMemo(() => {
    const byId = new Map();
    for (const r of rows) {
      const id = String(r.ItemID ?? '').trim();
      if (!id) continue;
      if (!byId.has(id)) byId.set(id, {
        itemId: id, vendor: r.VendorID, cat: r.CAT, description: r.Description,
        qty: 0, sales: new Set(), lastSold: null, deliveryStatus: r.DeliveryStatus, deliveryDate: r.DeliveryDate,
      });
      const e = byId.get(id);
      e.qty += 1;
      if (r.SaleNo != null) e.sales.add(r.SaleNo);
      if (!e.lastSold || String(r.SaleDate) > String(e.lastSold)) { e.lastSold = r.SaleDate; e.deliveryStatus = r.DeliveryStatus; e.deliveryDate = r.DeliveryDate; }
    }
    return [...byId.values()].map((e) => {
      const lk = labelsMap[e.itemId];
      const labels = lk?.labels ?? [];
      const inB = (b) => labels.filter((l) => Number(l.building) === b);
      const s1 = inB(1).length, s2 = inB(2).length, wh = inB(999).length;
      const floorQty = store === 1 ? s1 : s2;
      const otherStoreQty = store === 1 ? s2 : s1;
      // ALB locations for the SELECTED store's floor only (deduped).
      const floorAlb = [...new Set(inB(store).map(albOf))].filter((x) => x && x !== '—');
      let status;
      if (!lk || lk.count == null) status = 'unknown';
      else if (floorQty > 0) status = 'onfloor';
      else if (wh > 0 || otherStoreQty > 0) status = 'refill';
      else status = 'reorder';
      return { ...e, salesCount: e.sales.size, s1, s2, wh, floorQty, floorAlb, onHand: lk?.count ?? null, status };
    }).sort((a, b) => (b.qty - a.qty) || String(a.itemId).localeCompare(String(b.itemId)));
  }, [rows, labelsMap, store]);

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return items;
    return items.filter((i) => [i.itemId, i.vendor, i.cat, i.description].some((v) => String(v ?? '').toLowerCase().includes(n)));
  }, [items, q]);

  const kpi = useMemo(() => {
    const k = { lines: rows.length, items: items.length, sales: new Set(rows.map((r) => r.SaleNo)).size, refill: 0, reorder: 0, onfloor: 0 };
    for (const i of items) { if (i.status === 'refill') k.refill++; else if (i.status === 'reorder') k.reorder++; else if (i.status === 'onfloor') k.onfloor++; }
    return k;
  }, [rows, items]);

  const groups = useMemo(() => {
    const g = { refill: [], reorder: [], onfloor: [], unknown: [] };
    for (const i of filtered) (g[i.status] ?? g.unknown).push(i);
    return g;
  }, [filtered]);

  const exportCsv = () => rowsToCSV(items.map((i) => ({
    ItemID: i.itemId, Vendor: i.vendor, Category: i.cat, Description: i.description,
    QtySold: i.qty, Sales: i.salesCount, LastSold: i.lastSold,
    Status: STATUS[i.status].label,
    S1: i.s1, S2: i.s2, WH_999: i.wh, OnHand: i.onHand,
    [`S${store}_ALB`]: i.floorAlb.join(' | '),
  })), `floor-sales-${STORES.find((s) => s.value === store)?.code}-${range.from}.csv`);

  const storeMeta = STORES.find((s) => s.value === store);
  const busy = isLoading || labelsQ.isLoading;

  return (
    <>
      <Topbar title="Floor Sales" subtitle={`${storeMeta?.code} · ${storeMeta?.label} · ${range.label || '…'}`} />
      <div className="flex flex-col gap-5 p-5">
        {/* ── Controls ── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {STORES.map((s) => (
                <button key={s.value} type="button" onClick={() => setStore(s.value)}
                  className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition', store === s.value ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted')}>
                  {s.code} · {s.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {MODES.map((m) => (
                <button key={m.id} type="button" onClick={() => setMode(m.id)}
                  className={cn('rounded-md px-3 py-1.5 text-xs font-semibold transition', mode === m.id ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted')}>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs">
              <Calendar size={14} className="text-primary" />
              <input type="date" value={anchor} max={iso(new Date())} onChange={(e) => setAnchor(e.target.value)}
                className="bg-transparent text-xs font-semibold outline-none" />
            </label>
            <span className="hidden text-[11px] text-muted-fg sm:inline">{range.from === range.to ? range.from : `${range.from} → ${range.to}`}</span>
            <button type="button" onClick={exportCsv} disabled={!items.length}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-muted disabled:opacity-50">
              <Download size={13} /> Export
            </button>
          </CardContent>
        </Card>

        {/* ── Hero ── */}
        <div className="relative">
          <HeroBanner icon={Sofa} decorIcon={Sofa} accent="primary">
            <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
              {storeMeta?.label} · Floor sales · {range.label}
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-3">
              <span className="bg-gradient-to-br from-blue-600 to-indigo-500 bg-clip-text text-5xl font-extrabold tabular-nums tracking-tight text-transparent">
                {fmtNumber(kpi.lines)}
              </span>
              <span className="text-sm font-medium text-muted-fg">item{kpi.lines === 1 ? '' : 's'} sold off the floor · {fmtNumber(kpi.sales)} sale{kpi.sales === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <HeroChip icon={Truck}   tone="amber"   label="Refill from WH" value={busy ? '…' : fmtNumber(kpi.refill)} />
              <HeroChip icon={PackageX} tone="rose"    label="Reorder" value={busy ? '…' : fmtNumber(kpi.reorder)} />
              <HeroChip icon={Boxes}   tone="emerald" label="Still stocked" value={busy ? '…' : fmtNumber(kpi.onfloor)} />
              <HeroChip icon={ShoppingCart} tone="slate" label="Distinct items" value={fmtNumber(kpi.items)} />
            </div>
          </HeroBanner>
        </div>

        {/* ── Search ── */}
        <div className="flex items-center gap-2">
          <div className="relative max-w-sm flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, vendor, category…"
              className="w-full rounded-lg border border-border bg-card py-2 pl-8 pr-3 text-sm outline-none focus:border-primary/50" />
          </div>
          <span className="text-[11px] text-muted-fg">{filtered.length} item{filtered.length === 1 ? '' : 's'}</span>
          {labelsQ.isLoading && <span className="text-[11px] italic text-muted-fg">· looking up locations…</span>}
        </div>

        {/* ── Refill board ── */}
        {isLoading ? (
          <div className="grid place-items-center py-16 text-sm text-muted-fg">
            <div className="flex flex-col items-center gap-3"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading floor sales…</div>
          </div>
        ) : items.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-fg">No floor sales for {range.label}.</CardContent></Card>
        ) : (
          <div className="space-y-4">
            {['refill', 'reorder', 'onfloor', 'unknown'].map((key) => {
              const list = groups[key];
              if (!list.length) return null;
              const meta = STATUS[key];
              const tone = TONE[meta.tone];
              const Icon = meta.icon;
              const open = openGroups[key];
              return (
                <Card key={key} className={cn('overflow-hidden', tone.ring)}>
                  <button type="button" onClick={() => setOpenGroups((g) => ({ ...g, [key]: !g[key] }))}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-muted/40">
                    <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white shadow', tone.grad)}>
                      <Icon size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold">{meta.label}</span>
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums', tone.chip)}>{list.length}</span>
                      </div>
                      <div className="truncate text-[11px] text-muted-fg">{meta.blurb}</div>
                    </div>
                    <ChevronDown size={16} className={cn('shrink-0 text-muted-fg transition-transform', open && 'rotate-180')} />
                  </button>
                  {open && (
                    <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((it) => <ItemCard key={it.itemId} it={it} store={store} />)}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function HeroChip({ icon: Icon, tone, label, value }) {
  const t = TONE[tone];
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-card/70 px-2.5 py-1.5 backdrop-blur-sm">
      <span className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white', 'bg-gradient-to-br', t.grad)}><Icon size={13} /></span>
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
        <div className="text-sm font-extrabold tabular-nums leading-none">{value}</div>
      </div>
    </div>
  );
}

// One building's on-hand quantity cell (S1 / S2 / 999).
function StockCell({ code, qty, highlight, warehouse, loading }) {
  const has = qty > 0;
  return (
    <div className={cn(
      'flex flex-col items-center rounded-lg border py-1.5',
      highlight ? 'border-primary/50 bg-primary/10'
        : warehouse ? 'border-amber-500/40 bg-amber-500/10'
        : 'border-border bg-muted/20',
    )}>
      <span className={cn('text-[9px] font-bold uppercase tracking-wider',
        highlight ? 'text-primary' : warehouse ? 'text-amber-600 dark:text-amber-300' : 'text-muted-fg')}>{code}</span>
      <span className={cn('text-lg font-extrabold tabular-nums leading-none',
        loading ? 'text-muted-fg/40' : has ? 'text-fg' : 'text-muted-fg/30')}>
        {loading ? '·' : fmtNumber(qty)}
      </span>
    </div>
  );
}

function ItemCard({ it, store }) {
  const meta = STATUS[it.status];
  const tone = TONE[meta.tone];
  const loading = it.onHand == null;
  return (
    <div className={cn('relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-3 pl-4 shadow-sm transition hover:shadow-md', tone.ring)}>
      <span className={cn('absolute inset-y-0 left-0 w-1.5', tone.dot)} />
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold leading-tight" title={it.description}>{it.description || it.itemId}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-fg">
            {it.vendor && <span className="font-semibold text-fg/70">{it.vendor}</span>}{it.vendor ? ' · ' : ''}#{it.itemId}{it.cat ? ` · ${it.cat}` : ''}
          </div>
        </div>
        {it.qty > 1 && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary" title="Units sold in this period">×{it.qty}</span>
        )}
      </div>

      {/* On-hand by building — S1 · S2 · 999 (warehouse) */}
      <div>
        <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-fg">
          <MapPin size={10} /> On hand{loading && <span className="italic normal-case tracking-normal">· checking…</span>}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <StockCell code="S1"  qty={it.s1} highlight={store === 1} loading={loading} />
          <StockCell code="S2"  qty={it.s2} highlight={store === 2} loading={loading} />
          <StockCell code="999" qty={it.wh} warehouse loading={loading} />
        </div>
        {it.floorAlb.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted-fg">Floor spot · S{store}</span>
            {it.floorAlb.map((a, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-primary">
                <MapPin size={10} />{a}
              </span>
            ))}
          </div>
        ) : it.status === 'refill' ? (
          <div className="mt-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-300">Floor spot cleared — refill from warehouse (999)</div>
        ) : it.status === 'reorder' ? (
          <div className="mt-1.5 text-[11px] font-semibold text-rose-500 dark:text-rose-300">Floor spot empty — no stock anywhere</div>
        ) : null}
      </div>

      {/* Footer: status + on-hand total + when sold */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-[11px]">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', tone.chip)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />{meta.label}
        </span>
        <span className="ml-auto inline-flex items-center gap-1 text-muted-fg"><Clock size={11} />{shortDate(it.lastSold)}</span>
      </div>
    </div>
  );
}
