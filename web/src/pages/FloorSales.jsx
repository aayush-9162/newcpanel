// Faithful clone of /auth/fms — store + date range + sale items table.
import { useState, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, inferColumns, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { Receipt, Package, Truck, Building2 } from 'lucide-react';

// SalesItemDetail uses BLDG (location code), not ProfitCenter.
const STORES = [
  { value: 1, label: 'S1 · Arden' },
  { value: 2, label: 'S2 · Waynesville' },
  { value: 999, label: '999 · Warehouse' },
];

function isoDate(d) { return d.toISOString().slice(0, 10); }

export default function FloorSales() {
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);
  const [store, setStore] = useState(1);
  const [from, setFrom] = useState(isoDate(monthAgo));
  const [to, setTo] = useState(isoDate(today));

  const sql = `SELECT TOP 500 SaleDate, SaleNo, ItemID, VendorID, CAT, Description, BLDG,
                      [999] AS w_999, OnOrder, DeliveryDate, DeliveryStatus, ReadyStatus, ItemStatus
               FROM SalesItemDetail
               WHERE BLDG = ? AND SaleDate >= ? AND SaleDate <= ?
               ORDER BY SaleDate DESC`;
  const { data, isLoading } = useSqlQuery(sql, [store, from, to]);
  const rows = data?.rows ?? [];

  const totals = useMemo(() => {
    let lines = rows.length;
    let onOrder = 0;
    const sales = new Set();
    rows.forEach((r) => { onOrder += Number(r.OnOrder) || 0; sales.add(r.SaleNo); });
    return { lines, onOrder, sales: sales.size };
  }, [rows]);

  const cols = useMemo(() => inferColumns(rows[0]), [rows]);

  return (
    <>
      <Topbar title="Floor Sales" subtitle={`Store ${store} · ${from} → ${to}`} />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex gap-1">
              {STORES.map((s) => (
                <Button key={s.value} size="sm" variant={store === s.value ? 'primary' : 'outline'} onClick={() => setStore(s.value)}>{s.label}</Button>
              ))}
            </div>
            <span className="ml-3 text-xs uppercase tracking-wider text-muted-fg">From</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            <span className="text-xs uppercase tracking-wider text-muted-fg">To</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            <Button className="ml-auto" variant="outline" size="sm" onClick={() => rowsToCSV(rows, `floor-sales-${store}.csv`)} disabled={!rows.length}>Export CSV</Button>
          </CardContent>
        </Card>

        <HeroBanner icon={Building2} decorIcon={Receipt} accent="primary">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
            Floor Sales · {STORES.find(s => s.value === store)?.label} · {from} → {to}
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-blue-600 to-indigo-500 bg-clip-text text-transparent">
              {fmtNumber(totals.lines)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-violet-500 to-purple-500 text-white">
              <Package size={14} /> {fmtNumber(totals.sales)} sales
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{fmtNumber(totals.onOrder)}</strong> units on order
          </div>
        </HeroBanner>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <HeroStat
            label="Item Lines"
            value={fmtNumber(totals.lines)}
            icon={Receipt}
            accent="primary"
            subtitle="Line items in this period"
            loading={isLoading}
          />
          <HeroStat
            label="Distinct Sales"
            value={fmtNumber(totals.sales)}
            icon={Package}
            accent="violet"
            subtitle={totals.sales ? `${(totals.lines / Math.max(totals.sales, 1)).toFixed(1)} items per sale` : null}
            loading={isLoading}
          />
          <HeroStat
            label="On Order Qty"
            value={fmtNumber(totals.onOrder)}
            icon={Truck}
            accent={totals.onOrder > 0 ? 'amber' : 'emerald'}
            urgent={totals.onOrder > 50}
            subtitle="Units awaiting delivery from vendors"
            loading={isLoading}
          />
        </div>

        <Card>
          <CardContent className="p-4">
            <DataTable data={rows} columns={cols} loading={isLoading} pageSize={50} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
