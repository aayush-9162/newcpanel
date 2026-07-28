// Faithful + modernized clone of /auth/dmgsummary (Damage Report).
// Originally a Bootstrap table with [ALL/<BLDG buttons>] [Vendor select] +
// [Refresh] [Export]. Here, the same controls + KPI strip, status badges,
// status distribution chart, and a Tailwind data table.
//
// Data: MySQL `damagereport` LEFT JOIN `damages` + `damage_remarks`.
import { useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  PackageX, DollarSign, Building2, Tags, RefreshCw, Download, Filter, Search,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  CartesianGrid, PieChart, Pie, Cell,
} from 'recharts';

// ── helpers ─────────────────────────────────────────────────────────────
// Robust number parser — strips $ , and other non-numeric formatting.
// MySQL DECIMAL columns can come back as strings; some rows may include
// formatting. Returns 0 for null / empty / unparsable.
function num(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const cleaned = String(v).replace(/[^\d.\-]/g, '');
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Case-insensitive field lookup — guards against MySQL drivers / proxies that
// alter result key casing. Returns the first defined value across the keys.
function pick(row, ...keys) {
  if (!row) return undefined;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    const lower = k.toLowerCase();
    if (row[lower] != null) return row[lower];
    const upper = k.toUpperCase();
    if (row[upper] != null) return row[upper];
  }
  return undefined;
}

// Status definitions — palette matches the original Bootstrap colors.
const STATUS = {
  ''                : { label: 'Unset',           bg: 'bg-muted text-muted-fg',                 chart: '#94a3b8' },
  'PART'            : { label: 'Part',            bg: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200', chart: '#fde047' },
  'IN HOUSE REPAIR' : { label: 'In-House Repair', bg: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200',             chart: '#38bdf8' },
  'CREDIT'          : { label: 'Credit',          bg: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-200', chart: '#fb923c' },
  'SELL AS IS'      : { label: 'Sell As Is',      bg: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200',         chart: '#f43f5e' },
  'CREDIT REC.'     : { label: 'Credit Rec.',     bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200', chart: '#22c55e' },
};
const STATUS_KEYS = Object.keys(STATUS).filter((k) => k !== '');

function StatusBadge({ value }) {
  const v = (value || '').toString().trim().toUpperCase();
  const meta = STATUS[v] || STATUS[''];
  if (!v) return <span className="text-muted-fg">—</span>;
  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', meta.bg)}>
      {meta.label}
    </span>
  );
}

export default function DmgSummary() {
  const [bldg, setBldg]     = useState('ALL');     // location
  const [vendor, setVendor] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [q, setQ]           = useState('');         // free-text search

  // --- distinct locations
  const locQ = useMysqlQuery(
    `SELECT DISTINCT BLDG AS bldg FROM damagereport WHERE BLDG IS NOT NULL AND TRIM(BLDG) <> '' ORDER BY BLDG`,
    [],
  );
  const locations = locQ.data?.rows.map((r) => pick(r, 'bldg', 'BLDG')).filter(Boolean) ?? [];

  // --- distinct vendors (scoped to selected location)
  const vendorQ = useMysqlQuery(
    bldg === 'ALL'
      ? `SELECT DISTINCT VendorId AS vendor FROM damagereport WHERE VendorId IS NOT NULL AND TRIM(VendorId) <> '' ORDER BY VendorId`
      : `SELECT DISTINCT VendorId AS vendor FROM damagereport WHERE BLDG = '${bldg.replace(/'/g, "''")}' AND VendorId IS NOT NULL AND TRIM(VendorId) <> '' ORDER BY VendorId`,
    [],
  );
  const vendors = vendorQ.data?.rows.map((r) => pick(r, 'vendor', 'VendorId')).filter(Boolean) ?? [];

  // --- main damage rows (joined with damages + damage_remarks for status/remarks)
  const where = [];
  if (bldg !== 'ALL')   where.push(`r.BLDG = '${bldg.replace(/'/g, "''")}'`);
  if (vendor !== 'ALL') where.push(`r.VendorId = '${vendor.replace(/'/g, "''")}'`);
  if (status !== 'ALL') {
    where.push(status === 'UNSET'
      ? `(k.status IS NULL OR TRIM(k.status) = '')`
      : `k.status = '${status.replace(/'/g, "''")}'`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // Lower-case aliases everywhere — most reliable across drivers / proxies.
  //
  // Cost note: the upstream damage report stores Cost as a FORMATTED currency
  // string ("$54.21"), per the original stored proc:
  //   FORMAT(item_avg_cost, 'C', 'en-US') as [Cost]
  // MySQL's CAST(...AS DECIMAL) returns 0 for any string with a `$` or comma,
  // so we DON'T cast here — we send the string through and let `num()` parse
  // it on the client.
  const dataSql = `
    SELECT
      d.id                                              AS id,
      r.LabelId                                         AS labelid,
      CAST(r.ItemId AS UNSIGNED)                        AS itemid,
      r.VendorId                                        AS vendor,
      TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(r.ItemDescription, '|', 2), '|', -1)) AS itemdescription,
      r.ItemDescription2                                AS itemdescription2,
      r.Cost                                            AS cost,
      r.BLDG                                            AS bldg,
      r.A                                               AS a,
      r.L                                               AS l,
      r.B                                               AS b,
      r.RVComments                                      AS rvcomments,
      k.status                                          AS status,
      k.remarks                                         AS remarks
    FROM damagereport r
    LEFT JOIN damages        d ON d.label_id            = TRIM(r.LabelId)
    LEFT JOIN damage_remarks k ON k.label_id            = TRIM(r.LabelId)
    ${whereSql}
    ORDER BY r.ItemDescription2
    LIMIT 5000
  `;
  const rowsQ = useMysqlQuery(dataSql, []);
  const allRows = rowsQ.data?.rows ?? [];

  // --- client-side text search
  const rows = useMemo(() => {
    if (!q.trim()) return allRows;
    const needle = q.trim().toLowerCase();
    return allRows.filter((r) =>
      Object.values(r).some((v) => v != null && String(v).toLowerCase().includes(needle)),
    );
  }, [allRows, q]);

  // --- KPIs (case-insensitive field access; robust currency parsing)
  const stats = useMemo(() => {
    let totalCost = 0;
    const vendorSet = new Set();
    const bldgSet = new Set();
    const byStatus = Object.fromEntries(STATUS_KEYS.map((k) => [k, 0]));
    let unset = 0;
    for (const r of rows) {
      totalCost += num(pick(r, 'cost', 'Cost'));
      const v = pick(r, 'vendor', 'Vendor', 'VendorId');
      if (v) vendorSet.add(v);
      const b = pick(r, 'bldg', 'BLDG');
      if (b) bldgSet.add(b);
      const s = (pick(r, 'status') || '').toString().trim().toUpperCase();
      if (s && byStatus[s] != null) byStatus[s]++;
      else unset++;
    }
    return { totalCost, vendors: vendorSet.size, bldgs: bldgSet.size, byStatus, unset };
  }, [rows]);

  // --- status distribution chart
  const statusChart = useMemo(() => {
    const out = STATUS_KEYS
      .map((k) => ({ name: STATUS[k].label, key: k, value: stats.byStatus[k], fill: STATUS[k].chart }))
      .filter((d) => d.value > 0);
    if (stats.unset > 0) out.push({ name: 'Unset', key: '', value: stats.unset, fill: STATUS[''].chart });
    return out;
  }, [stats]);

  // --- top vendors by damage count
  const topVendors = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const v = pick(r, 'vendor', 'Vendor', 'VendorId');
      if (!v) continue;
      const cur = map.get(v) || { vendor: v, count: 0, cost: 0 };
      cur.count += 1;
      cur.cost += num(pick(r, 'cost', 'Cost'));
      map.set(v, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [rows]);

  // Columns use accessorFn so they tolerate any casing the upstream returns.
  const cols = useMemo(() => [
    { id: 'labelid',     accessorFn: (r) => pick(r, 'labelid', 'LabelId'),         header: 'Label ID',
      cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() ?? '—'}</span> },
    { id: 'itemid',      accessorFn: (r) => pick(r, 'itemid', 'ItemId'),           header: 'Item ID' },
    { id: 'vendor',      accessorFn: (r) => pick(r, 'vendor', 'Vendor', 'VendorId'), header: 'Vendor',
      cell: ({ getValue }) => <span className="font-semibold">{getValue() ?? '—'}</span> },
    { id: 'description', accessorFn: (r) => pick(r, 'itemdescription', 'ItemDescription'), header: 'Description',
      cell: ({ getValue }) => <span className="block max-w-[260px] truncate" title={getValue()}>{getValue() ?? '—'}</span> },
    { id: 'description2',accessorFn: (r) => pick(r, 'itemdescription2', 'ItemDescription2'), header: 'Description 2',
      cell: ({ getValue }) => <span className="block max-w-[200px] truncate" title={getValue()}>{getValue() ?? '—'}</span> },
    { id: 'cost',        accessorFn: (r) => num(pick(r, 'cost', 'Cost')),          header: 'Cost',
      cell: ({ getValue }) => {
        const v = getValue();
        return v > 0 ? fmtCurrency(v, true) : <span className="text-muted-fg">—</span>;
      } },
    { id: 'bldg',        accessorFn: (r) => pick(r, 'bldg', 'BLDG'),               header: 'BLDG',
      cell: ({ getValue }) => <span className="text-center font-semibold">{getValue() ?? '—'}</span> },
    { id: 'a', accessorFn: (r) => pick(r, 'a', 'A'), header: 'A' },
    { id: 'l', accessorFn: (r) => pick(r, 'l', 'L'), header: 'L' },
    { id: 'b', accessorFn: (r) => pick(r, 'b', 'B'), header: 'B' },
    { id: 'status',      accessorFn: (r) => pick(r, 'status'),                     header: 'Status',
      cell: ({ getValue }) => <StatusBadge value={getValue()} /> },
    { id: 'remarks',     accessorFn: (r) => pick(r, 'remarks'),                    header: 'Remarks',
      cell: ({ getValue }) => <span className="block max-w-[180px] truncate text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
    { id: 'rvcomments',  accessorFn: (r) => pick(r, 'rvcomments', 'RVComments'),   header: 'RV Comments',
      cell: ({ getValue }) => <span className="block max-w-[160px] truncate text-muted-fg" title={getValue()}>{getValue() || '—'}</span> },
  ], []);

  const subtitle = `${rowsQ.isLoading ? '…' : fmtNumber(rows.length)} records · ${bldg === 'ALL' ? 'All locations' : `BLDG ${bldg}`}${vendor !== 'ALL' ? ` · ${vendor}` : ''}${status !== 'ALL' ? ` · ${STATUS[status === 'UNSET' ? '' : status]?.label || status}` : ''}`;

  return (
    <>
      <Topbar title="Damage Report" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* Filter bar */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
              <Building2 size={14} /> Location
            </span>
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <FilterPill active={bldg === 'ALL'} onClick={() => { setBldg('ALL'); setVendor('ALL'); }}>ALL</FilterPill>
              {locations.map((b) => (
                <FilterPill
                  key={b}
                  active={bldg === b}
                  onClick={() => { setBldg(b); setVendor('ALL'); }}
                >
                  {b}
                </FilterPill>
              ))}
            </div>

            <div className="h-6 w-px bg-border" />

            <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
              <Tags size={14} /> Vendor
              <Select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-36">
                <option value="ALL">ALL</option>
                {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
              </Select>
            </label>

            <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
              <Filter size={14} /> Status
              <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
                <option value="ALL">ALL</option>
                {STATUS_KEYS.map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
                <option value="UNSET">Unset</option>
              </Select>
            </label>

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
                <Input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search label, item, description…"
                  className="pl-8 w-64"
                />
              </div>
              <Button variant="outline" size="sm" onClick={() => rowsQ.refetch()} title="Refresh">
                <RefreshCw size={14} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => rowsToCSV(rows, `damage-report-${bldg}-${vendor}.csv`)}
                disabled={!rows.length}
              >
                <Download size={14} /> Export
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Hero banner */}
        <HeroBanner icon={PackageX} decorIcon={DollarSign} accent="rose">
          <div className="text-[11px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">
            Damage Pipeline
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-rose-600 to-orange-500 bg-clip-text text-transparent">
              {fmtCompactCurrency(stats.totalCost)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-rose-500 to-orange-500 text-white">
              <PackageX size={14} /> {fmtNumber(rows.length)} items
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            Across <strong className="text-fg">{fmtNumber(stats.vendors)}</strong> vendors and <strong className="text-fg">{fmtNumber(stats.bldgs)}</strong> locations
          </div>
        </HeroBanner>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Damaged Items"
            value={fmtNumber(rows.length)}
            icon={PackageX}
            accent="rose"
            urgent={rows.length > 50}
            subtitle="Total reported damages"
            loading={rowsQ.isLoading}
          />
          <HeroStat
            label="Total Cost"
            value={fmtCompactCurrency(stats.totalCost)}
            fullValue={fmtCurrency(stats.totalCost)}
            icon={DollarSign}
            accent="amber"
            subtitle={rows.length ? `${fmtCompactCurrency(stats.totalCost / Math.max(rows.length, 1))} avg per item` : null}
            loading={rowsQ.isLoading}
          />
          <HeroStat
            label="Vendors"
            value={fmtNumber(stats.vendors)}
            icon={Tags}
            accent="violet"
            subtitle="Distinct suppliers affected"
            loading={rowsQ.isLoading}
          />
          <HeroStat
            label="Locations"
            value={fmtNumber(stats.bldgs)}
            icon={Building2}
            accent="sky"
            subtitle="Buildings with damages"
            loading={rowsQ.isLoading}
          />
        </div>

        {/* Status overview + Top vendors */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Status Distribution</CardTitle>
              <CardDescription>How damaged items are dispositioned</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {/* Pie */}
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusChart.length ? statusChart : [{ name: 'No data', value: 1, fill: '#e5e7eb' }]}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={80}
                        stroke="none"
                      >
                        {(statusChart.length ? statusChart : [{ fill: '#e5e7eb' }]).map((d, i) => (
                          <Cell key={i} fill={d.fill} />
                        ))}
                      </Pie>
                      <RTooltip
                        formatter={(v, n) => [fmtNumber(v), n]}
                        contentStyle={{
                          background: 'hsl(var(--card))',
                          border: '1px solid hsl(var(--border))',
                          borderRadius: 8,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend with counts */}
                <div className="flex flex-col justify-center gap-2 text-sm">
                  {STATUS_KEYS.map((k) => {
                    const c = stats.byStatus[k];
                    const meta = STATUS[k];
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setStatus(status === k ? 'ALL' : k)}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5 transition hover:bg-muted/50',
                          status === k && 'ring-2 ring-primary',
                        )}
                      >
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ background: meta.chart }} />
                          <span className="text-sm">{meta.label}</span>
                        </span>
                        <span className="num font-semibold">{fmtNumber(c)}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setStatus(status === 'UNSET' ? 'ALL' : 'UNSET')}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5 transition hover:bg-muted/50',
                      status === 'UNSET' && 'ring-2 ring-primary',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full bg-slate-400" />
                      <span className="text-sm">Unset</span>
                    </span>
                    <span className="num font-semibold">{fmtNumber(stats.unset)}</span>
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Vendors</CardTitle>
              <CardDescription>By damage count · click to filter</CardDescription>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <div style={{ height: 270 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={topVendors} layout="vertical" margin={{ top: 8, right: 24, left: 12, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis type="number" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                    <YAxis
                      type="category"
                      dataKey="vendor"
                      tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                      width={70}
                    />
                    <RTooltip
                      formatter={(v, n) => n === 'count' ? [fmtNumber(v), 'Items'] : [fmtCurrency(v), 'Cost']}
                      contentStyle={{
                        background: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: 8,
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="hsl(var(--primary))"
                      radius={[0, 6, 6, 0]}
                      onClick={(d) => d?.vendor && setVendor(d.vendor)}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Damage table */}
        <Card>
          <CardHeader>
            <CardTitle>Damaged Items</CardTitle>
            <CardDescription>
              {rowsQ.isLoading
                ? 'Loading…'
                : (
                  <>
                    Showing <span className="font-semibold text-fg">{fmtNumber(rows.length)}</span>
                    {q ? <> of <span className="font-semibold text-fg">{fmtNumber(allRows.length)}</span> total</> : null}
                    {' '}records
                    {allRows.length >= 5000 && <span className="text-warning"> · capped at 5,000 — narrow the filter to see more</span>}
                  </>
                )}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <DataTable
              data={rows}
              columns={cols}
              loading={rowsQ.isLoading}
              pageSize={50}
              emptyText={rowsQ.error ? `Could not reach MySQL: ${rowsQ.error.message}` : 'No damaged items match these filters'}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FilterPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 rounded-md px-2.5 text-xs font-medium transition outline-none',
        active
          ? 'bg-primary text-primary-fg shadow-sm'
          : 'text-muted-fg hover:bg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
