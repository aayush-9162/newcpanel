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

// ALB = Aisle·Level·Bay. Building 999 = warehouse; 1/2 = a store floor.
const albOf = (l) => [l.aisle, l.level, l.bay].filter((x) => String(x ?? '').trim() !== '').join('·') || '—';
const buildingName = (b) => Number(b) === 999 ? 'Warehouse' : `Store ${b}`;

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
      const floor = labels.filter((l) => Number(l.building) === Number(store));
      const wh = labels.filter((l) => Number(l.building) === 999);
      const otherStore = labels.filter((l) => Number(l.building) !== 999 && Number(l.building) !== Number(store));
      let status;
      if (!lk || lk.count == null) status = labelsQ.isLoading ? 'unknown' : 'unknown';
      else if (floor.length > 0) status = 'onfloor';
      else if (wh.length > 0 || otherStore.length > 0) status = 'refill';
      else status = 'reorder';
      return { ...e, salesCount: e.sales.size, labels, floor, wh, otherStore, onHand: lk?.count ?? null, status };
    }).sort((a, b) => (b.qty - a.qty) || String(a.itemId).localeCompare(String(b.itemId)));
  }, [rows, labelsMap, store, labelsQ.isLoading]);

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
    FloorALB: i.floor.map(albOf).join(' | '),
    WarehouseALB: i.wh.map(albOf).join(' | '),
    OnHand: i.onHand,
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

function AlbTag({ label, tone, prefix }) {
  const t = TONE[tone];
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums', t.chip)}>
      <MapPin size={11} />{prefix ? `${prefix} ` : ''}{label}
    </span>
  );
}

function ItemCard({ it, store }) {
  const meta = STATUS[it.status];
  const tone = TONE[meta.tone];
  return (
    <div className={cn('flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm', tone.ring)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold" title={it.description}>{it.description || it.itemId}</div>
          <div className="truncate text-[11px] text-muted-fg">
            {it.vendor && <span className="font-semibold">{it.vendor}</span>}{it.vendor ? ' · ' : ''}#{it.itemId}{it.cat ? ` · ${it.cat}` : ''}
          </div>
        </div>
        {it.qty > 1 && (
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary">×{it.qty}</span>
        )}
      </div>

      {/* Locations / ALB */}
      <div className="flex flex-wrap items-center gap-1.5">
        {it.floor.length > 0 && it.floor.map((l, i) => <AlbTag key={'f' + i} tone="emerald" prefix="Floor" label={albOf(l)} />)}
        {it.wh.length > 0 && it.wh.map((l, i) => <AlbTag key={'w' + i} tone="amber" prefix="WH" label={albOf(l)} />)}
        {it.otherStore.length > 0 && it.otherStore.map((l, i) => <AlbTag key={'o' + i} tone="slate" prefix={buildingName(l.building)} label={albOf(l)} />)}
        {it.labels.length === 0 && it.onHand === 0 && <span className="text-[11px] font-semibold text-rose-500 dark:text-rose-300">Empty spot · no stock anywhere</span>}
        {it.onHand == null && <span className="text-[11px] italic text-muted-fg">location lookup pending…</span>}
      </div>

      {/* Footer: status + when sold + on-hand */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-2 text-[11px]">
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold', tone.chip)}>
          <span className={cn('h-1.5 w-1.5 rounded-full', tone.dot)} />{meta.label}
        </span>
        {it.onHand != null && <span className="text-muted-fg">{fmtNumber(it.onHand)} on hand</span>}
        <span className="ml-auto inline-flex items-center gap-1 text-muted-fg"><Clock size={11} />{shortDate(it.lastSold)}</span>
      </div>
    </div>
  );
}
