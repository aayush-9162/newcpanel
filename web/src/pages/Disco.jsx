import { useState, useMemo, useCallback } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import {
  ArrowUpDown, ArrowUp, ArrowDown,
  ChevronLeft, ChevronRight,
  Download, RefreshCw, Search, X, Slash, Tags, DollarSign, Boxes,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { useMysqlQuery, runQuery } from '@/lib/api';
import { rowsToCSV } from '@/components/DataTable';
import { fmtNumber, fmtCompactCurrency, fmtCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';

// ─── constants ────────────────────────────────────────────────────────────────

const VENDORS = [
  'ALL', 'BEST', 'CATN', 'COAS', 'CRAF', 'ENGL', 'FLEX', 'FRAN', 'FUSI',
  'JOHN', 'MAGN', 'NATZ', 'OLDW', 'SIGN', 'SOUT', 'BARC', 'LIBE', 'JACK',
  'SOTH', 'SUTH', 'TEMP', 'OTHR',
];

const KNOWN_VENDORS = [
  'BEST', 'CATN', 'COAS', 'CRAF', 'ENGL', 'FLEX', 'FRAN', 'FUSI', 'JOHN',
  'MAGN', 'NATZ', 'OLDW', 'SIGN', 'SOUT', 'BARC', 'LIBE', 'JACK', 'SOTH',
  'SUTH', 'TEMP',
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function getDefaultVendor() {
  try { return localStorage.getItem('matchupDefaultVendor') || 'BEST'; } catch { return 'BEST'; }
}

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
    if (row[k.toLowerCase()] != null) return row[k.toLowerCase()];
    if (row[k.toUpperCase()] != null) return row[k.toUpperCase()];
  }
  return undefined;
}

function fmtNum(v) {
  const n = num(v);
  return n === 0 ? '—' : n.toLocaleString();
}

// ─── SQL builders ─────────────────────────────────────────────────────────────

function buildMainQuery(vendor, store) {
  const sel = store === 's1'
    ? 's.`s1`, s.`_999`,'
    : store === 's2'
    ? 's.`s2`, s.`_999`,'
    : 's.`s1`, s.`s2`, s.`_999`,';

  const flt = store === 's1'
    ? 's.s1 > 0'
    : store === 's2'
    ? 's.s2 > 0'
    : '(s.`s1` + s.`s2` + s.`_999`) > 0';

  const base = `SELECT u.\`item_id_1\` as item_id, u.\`item_desc\` as sku, u.\`item_desc_2\` as description, e.\`category\` as cat, COALESCE(e.ext_cost, u.item_lst_lnd_cost) AS ext_cost, ${sel} e.\`is_lineup\`, u.item_status as status, e.disco_remarks as remarks FROM \`invmasterreport\` u LEFT JOIN \`invmasteraux\` s ON TRIM(u.\`item_id_1\`) = TRIM(s.\`itemId\`) LEFT JOIN \`exceldata\` e ON TRIM(e.\`item_id\`) = TRIM(u.\`item_id_1\`) WHERE u.\`item_id_1\` REGEXP '^[0-9]+$' AND u.item_status = 'n' AND ${flt}`;

  if (vendor === 'ALL') return { sql: base, values: [] };
  if (vendor === 'OTHR') return {
    sql: `${base} AND TRIM(u.\`item_vend_id\`) NOT IN (${KNOWN_VENDORS.map(() => '?').join(',')})`,
    values: KNOWN_VENDORS,
  };
  return { sql: `${base} AND TRIM(u.\`item_vend_id\`) = ?`, values: [vendor] };
}

const VENDOR_SUM_SQL = "SELECT e.vend_id AS vendor, SUM(s.s1) as s1, SUM(s.s2) as s2, SUM(s.`_999`) as _999 FROM `invmasterreport` u LEFT JOIN `invmasteraux` s ON TRIM(u.`item_id_1`) = TRIM(s.`itemId`) LEFT JOIN `exceldata` e ON TRIM(e.`item_id`) = TRIM(u.`item_id_1`) WHERE u.`item_id_1` REGEXP '^[0-9]+$' AND u.item_status = 'n' AND (s.`s1` + s.`s2` + s.`_999`) > 0 GROUP BY e.vend_id ORDER BY e.vend_id";

const CAT_SUM_SQL = "SELECT e.category AS category, SUM(s.s1) as s1, SUM(s.s2) as s2, SUM(s.`_999`) as _999 FROM `invmasterreport` u LEFT JOIN `invmasteraux` s ON TRIM(u.`item_id_1`) = TRIM(s.`itemId`) LEFT JOIN `exceldata` e ON TRIM(e.`item_id`) = TRIM(u.`item_id_1`) WHERE u.`item_id_1` REGEXP '^[0-9]+$' AND u.item_status = 'n' AND (s.`s1` + s.`s2` + s.`_999`) > 0 GROUP BY e.category ORDER BY e.category";

// ─── SummaryModal ─────────────────────────────────────────────────────────────

function SummaryModal({ title, rows, isLoading, onClose }) {
  const cols = rows?.length ? Object.keys(rows[0]) : [];
  const totals = useMemo(() => {
    const t = {};
    cols.forEach(c => { t[c] = (rows || []).reduce((s, r) => s + num(r[c]), 0); });
    return t;
  }, [rows, cols]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl bg-card border border-border shadow-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="font-semibold text-fg">{title}</span>
          <button onClick={onClose} className="text-muted-fg hover:text-fg transition"><X size={16} /></button>
        </div>
        <div className="overflow-auto flex-1">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-fg">Loading…</div>
          ) : !rows?.length ? (
            <div className="p-8 text-center text-sm text-muted-fg">No data.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr>
                  {cols.map(c => (
                    <th key={c} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-fg whitespace-nowrap">
                      {c === '_999' ? '999' : c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border hover:bg-muted/40">
                    {cols.map((c, ci) => (
                      <td key={c} className="px-3 py-2 whitespace-nowrap num">
                        {ci === 0 ? (r[c] ?? '—') : fmtNum(r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-muted/60 font-semibold border-t-2 border-border">
                  {cols.map((c, ci) => (
                    <td key={c} className="px-3 py-2 whitespace-nowrap num">
                      {ci === 0 ? 'TOTAL' : fmtNum(totals[c])}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── EditableCell ─────────────────────────────────────────────────────────────

function EditableCell({ value: initial, rowId, field, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initial ?? '');
  const [flash, setFlash] = useState(false);

  const save = useCallback(async (v) => {
    const trimmed = v?.trim() ?? '';
    if (trimmed === (initial?.trim() ?? '')) { setEditing(false); return; }
    try {
      await onSave(rowId, field, trimmed);
      setFlash(true);
      setTimeout(() => setFlash(false), 900);
    } catch {}
    setEditing(false);
  }, [initial, rowId, field, onSave]);

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        onChange={e => setValue(e.target.value)}
        onBlur={() => save(value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); save(value); }
          if (e.key === 'Escape') { setValue(initial ?? ''); setEditing(false); }
        }}
        className="w-full min-w-[80px] rounded border border-primary bg-card px-1.5 py-0.5 text-sm outline-none focus:ring-1 focus:ring-primary/40"
      />
    );
  }

  return (
    <span
      title="Click to edit"
      onClick={() => { setValue(initial ?? ''); setEditing(true); }}
      className={cn(
        'block min-w-[60px] cursor-pointer rounded px-1.5 py-0.5 hover:bg-primary/10 transition',
        flash && 'bg-emerald-100 dark:bg-emerald-900/30',
        !initial && 'text-muted-fg italic text-xs',
      )}
    >
      {initial || '—'}
    </span>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function Disco() {
  const [vendor, setVendor] = useState(getDefaultVendor);
  const [store, setStore] = useState('both');
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState([]);
  const [summaryType, setSummaryType] = useState(null); // 'vendor' | 'category'

  const { sql, values } = useMemo(() => buildMainQuery(vendor, store), [vendor, store]);

  const { data: mainData, isLoading, refetch } = useMysqlQuery(sql, values, { enabled: !!vendor });
  const rows = useMemo(() => mainData?.rows ?? [], [mainData]);

  const vendorSum = useMysqlQuery(VENDOR_SUM_SQL, [], { enabled: summaryType === 'vendor' });
  const catSum = useMysqlQuery(CAT_SUM_SQL, [], { enabled: summaryType === 'category' });

  const setDefault = () => {
    if (!window.confirm(`Set ${vendor} as default vendor?`)) return;
    try { localStorage.setItem('matchupDefaultVendor', vendor); } catch {}
  };

  const handleSave = useCallback(async (itemId, field, newVal) => {
    const key = { cat: 'updateexceldataCategory', ext_cost: 'updateexceldataExtcost', remarks: 'updateexceldataDiscoRemarks' }[field];
    if (!key) return;
    await runQuery(key, { values: [newVal, itemId] });
  }, []);

  // Aggregate stats for the hero banner
  const kpi = useMemo(() => {
    let totalUnits = 0, totalExtCost = 0, s1Units = 0, s2Units = 0, w999Units = 0;
    const cats = new Set();
    for (const r of rows) {
      const s1 = num(pick(r, 's1'));
      const s2 = num(pick(r, 's2'));
      const w9 = num(pick(r, '_999'));
      s1Units += s1; s2Units += s2; w999Units += w9;
      totalUnits += s1 + s2 + w9;
      totalExtCost += num(pick(r, 'ext_cost'));
      const c = pick(r, 'cat');
      if (c) cats.add(String(c).trim());
    }
    return { totalItems: rows.length, totalUnits, totalExtCost, s1Units, s2Units, w999Units, categoryCount: cats.size };
  }, [rows]);

  const cols = useMemo(() => {
    const hasBoth = store === 'both';
    const hasS1 = store === 's1' || hasBoth;
    const hasS2 = store === 's2' || hasBoth;

    const plain = (key, header) => ({
      id: key,
      accessorFn: r => pick(r, key) ?? '',
      header,
      cell: ({ getValue }) => {
        const v = getValue();
        return v ? String(v) : <span className="text-muted-fg">—</span>;
      },
    });

    const editable = (key, header) => ({
      id: key,
      accessorFn: r => pick(r, key) ?? '',
      header,
      cell: ({ row, getValue }) => (
        <EditableCell
          value={getValue()}
          rowId={pick(row.original, 'item_id')}
          field={key}
          onSave={handleSave}
        />
      ),
    });

    const numCol = (key, header) => ({
      id: key,
      accessorFn: r => num(pick(r, key)),
      header,
      cell: ({ getValue }) => {
        const n = getValue();
        return <span className={cn('num', n === 0 && 'text-muted-fg')}>{n === 0 ? '—' : n.toLocaleString()}</span>;
      },
    });

    return [
      plain('item_id', 'Item ID'),
      plain('sku', 'SKU / Desc'),
      plain('description', 'Description 2'),
      editable('cat', 'Category'),
      editable('ext_cost', 'Ext Cost'),
      ...(hasS1 ? [numCol('s1', 'S1')] : []),
      ...(hasS2 ? [numCol('s2', 'S2')] : []),
      numCol('_999', '999'),
      plain('is_lineup', 'LineUp'),
      plain('status', 'Status'),
      editable('remarks', 'Remarks'),
    ];
  }, [store, handleSave]);

  const table = useReactTable({
    data: rows,
    columns: cols,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 100 } },
  });

  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <>
      <Topbar title="Discontinued Items" subtitle={`${fmtNumber(kpi.totalItems)} items · ${fmtNumber(kpi.totalUnits)} units · vendor ${vendor}`} />

      <div className="flex flex-1 flex-col gap-4 p-5 animate-fade-in">
        {/* ── hero banner ── */}
        <HeroBanner icon={Slash} decorIcon={Boxes} accent="amber">
          <div className="text-[11px] font-bold uppercase tracking-widest text-amber-700 dark:text-amber-300">
            Discontinued Inventory · {vendor}
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-amber-600 to-orange-500 bg-clip-text text-transparent">
              {fmtNumber(kpi.totalUnits)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-amber-500 to-orange-500 text-white">
              <Boxes size={14} /> {fmtNumber(kpi.totalItems)} items
            </span>
            {kpi.totalExtCost > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-violet-500 to-purple-500 text-white">
                <DollarSign size={14} /> {fmtCompactCurrency(kpi.totalExtCost)}
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{fmtNumber(kpi.s1Units)}</strong> at S1 · <strong className="text-fg">{fmtNumber(kpi.s2Units)}</strong> at S2 · <strong className="text-fg">{fmtNumber(kpi.w999Units)}</strong> at warehouse · {kpi.categoryCount} categor{kpi.categoryCount === 1 ? 'y' : 'ies'}
          </div>
        </HeroBanner>

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Discontinued Items"
            value={fmtNumber(kpi.totalItems)}
            icon={Slash}
            accent="amber"
            urgent={kpi.totalItems > 50}
            subtitle={`Across ${kpi.categoryCount} categor${kpi.categoryCount === 1 ? 'y' : 'ies'}`}
            loading={isLoading}
          />
          <HeroStat
            label="Total Units"
            value={fmtNumber(kpi.totalUnits)}
            icon={Boxes}
            accent="amber"
            subtitle={kpi.totalItems ? `${(kpi.totalUnits / Math.max(kpi.totalItems, 1)).toFixed(1)} units per SKU avg` : null}
            loading={isLoading}
          />
          <HeroStat
            label="Extended Cost"
            value={fmtCompactCurrency(kpi.totalExtCost)}
            fullValue={fmtCurrency(kpi.totalExtCost)}
            icon={DollarSign}
            accent="violet"
            subtitle="Total inventory carrying cost"
            loading={isLoading}
          />
          <HeroStat
            label="Store Split"
            value={
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400">{fmtNumber(kpi.s1Units)}</span>
                <span className="text-muted-fg/70 text-base font-normal">/</span>
                <span className="text-blue-600 dark:text-blue-400">{fmtNumber(kpi.s2Units)}</span>
              </span>
            }
            icon={Tags}
            accent="sky"
            subtitle={`Warehouse: ${fmtNumber(kpi.w999Units)} units`}
            loading={isLoading}
          />
        </div>

        {/* ── controls bar ── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 p-3">
            <Button variant="outline" size="sm" onClick={() => setSummaryType('vendor')}>Vendor</Button>
            <Button variant="outline" size="sm" onClick={() => setSummaryType('category')}>Category</Button>

            <div className="h-5 w-px bg-border mx-1" />

            {[['s1', 'S1'], ['s2', 'S2'], ['both', 'Both']].map(([v, label]) => (
              <button
                key={v}
                onClick={() => setStore(v)}
                className={cn(
                  'rounded border-2 px-3 py-1 text-sm font-medium transition',
                  store === v
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600'
                    : 'border-border text-muted-fg hover:border-emerald-400',
                )}
              >
                {label}
              </button>
            ))}

            <div className="h-5 w-px bg-border mx-1" />

            <button
              onClick={setDefault}
              className="text-xs text-primary underline-offset-2 hover:underline"
            >
              Set Default
            </button>
            <select
              value={vendor}
              onChange={e => setVendor(e.target.value)}
              className="rounded-lg border-2 border-emerald-500 bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/30 w-28"
            >
              {VENDORS.map(v => <option key={v} value={v}>{v}</option>)}
            </select>

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => rowsToCSV(rows, `disco-${vendor}.csv`)}
                disabled={!rows.length}
              >
                <Download size={14} /> Export
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw size={14} />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── data table ── */}
        <Card className="flex-1">
          <CardContent className="flex flex-col gap-3 p-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-xs">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
                <Input
                  value={globalFilter}
                  onChange={e => setGlobalFilter(e.target.value)}
                  placeholder="Filter visible rows…"
                  className="pl-8"
                />
              </div>
              <span className="ml-auto text-xs text-muted-fg num">
                {isLoading ? '…' : `${filteredCount.toLocaleString()} / ${rows.length.toLocaleString()} rows`}
              </span>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-muted/60 backdrop-blur">
                  {table.getHeaderGroups().map(hg => (
                    <tr key={hg.id} className="border-b border-border">
                      {hg.headers.map(h => {
                        const dir = h.column.getIsSorted();
                        const sortable = h.column.getCanSort();
                        return (
                          <th
                            key={h.id}
                            onClick={sortable ? h.column.getToggleSortingHandler() : undefined}
                            className={cn(
                              'whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-fg',
                              sortable && 'cursor-pointer select-none hover:text-fg',
                            )}
                          >
                            <span className="inline-flex items-center gap-1">
                              {flexRender(h.column.columnDef.header, h.getContext())}
                              {sortable && (
                                dir === 'asc' ? <ArrowUp size={12} /> :
                                dir === 'desc' ? <ArrowDown size={12} /> :
                                <ArrowUpDown size={12} className="opacity-40" />
                              )}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-border">
                          {cols.map((_, j) => (
                            <td key={j} className="px-3 py-2.5">
                              <div className="h-4 rounded bg-muted/60 animate-pulse" style={{ width: `${60 + (j % 4) * 20}px` }} />
                            </td>
                          ))}
                        </tr>
                      ))
                    : table.getRowModel().rows.length === 0
                    ? (
                        <tr>
                          <td colSpan={cols.length} className="px-3 py-10 text-center text-sm text-muted-fg">
                            {vendor ? 'No discontinued items found for this selection.' : 'Select a vendor to load data.'}
                          </td>
                        </tr>
                      )
                    : table.getRowModel().rows.map(row => (
                        <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition">
                          {row.getVisibleCells().map(cell => (
                            <td key={cell.id} className="whitespace-nowrap px-3 py-1.5">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      ))
                  }
                </tbody>
              </table>
            </div>

            {table.getPageCount() > 1 && (
              <div className="flex items-center justify-between gap-2 text-xs text-muted-fg">
                <span>
                  Page <span className="num text-fg">{table.getState().pagination.pageIndex + 1}</span> of{' '}
                  <span className="num text-fg">{table.getPageCount()}</span>
                </span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
                    <ChevronLeft size={14} />
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
                    <ChevronRight size={14} />
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-4 border-t border-border pt-2 text-xs text-muted-fg">
              <span>Total Records: <strong className="text-fg num">{rows.length.toLocaleString()}</strong></span>
              {filteredCount !== rows.length && (
                <span>Visible: <strong className="text-fg num">{filteredCount.toLocaleString()}</strong></span>
              )}
              <span className="text-muted-fg/60">
                Category, Ext Cost, and Remarks columns are editable — click a cell and press Enter to save.
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── summary modal ── */}
      {summaryType && (
        <SummaryModal
          title={summaryType === 'vendor' ? 'Vendor Summary' : 'Category Summary'}
          rows={summaryType === 'vendor' ? (vendorSum.data?.rows ?? null) : (catSum.data?.rows ?? null)}
          isLoading={summaryType === 'vendor' ? vendorSum.isLoading : catSum.isLoading}
          onClose={() => setSummaryType(null)}
        />
      )}
    </>
  );
}
