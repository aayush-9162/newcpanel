// Faithful clone of /auth/invmasterreport — vendor select + debounced search + InvMasterReport table.
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { KpiCard } from '@/components/KpiCard';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useReportQuery } from '@/lib/api';
import { fmtNumber, fmtCurrency, trimStr } from '@/lib/format';
import { Boxes, AlertTriangle, Truck, Search } from 'lucide-react';

const LOC = ['1', '2', '999', '888', '501', '303', '777'];
const sumLoc = (r, kind) => LOC.reduce((acc, l) => acc + (Number(r[`${kind} (Loc#${l})`]) || 0), 0);

export default function InvMasterReport() {
  const vendors = useReportQuery('vendors');
  const [vendor, setVendor] = useState(() => localStorage.getItem('imr.vendor') || '');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => { if (vendor) localStorage.setItem('imr.vendor', vendor); }, [vendor]);
  useEffect(() => { if (!vendor && vendors.data?.rows.length) setVendor(trimStr(vendors.data.rows[0].vendor)); }, [vendor, vendors.data]);
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 300); return () => clearTimeout(t); }, [term]);

  const useSearch = debounced.length >= 2;
  const list = useReportQuery(useSearch ? 'invMasterSearch' : 'invMasterByVendor', useSearch ? { vendor, term: debounced } : { vendor }, { enabled: !!vendor });
  const kpis = useReportQuery('invMasterKpisByVendor', { vendor }, { enabled: !!vendor });
  const rows = list.data?.rows ?? [];
  const k = kpis.data?.rows[0];

  const columns = useMemo(() => [
    { accessorKey: 'item_id', header: 'Item', cell: ({ getValue, row }) => (
      <div className="flex flex-col"><span className="font-medium">{trimStr(getValue())}</span><span className="text-[11px] text-muted-fg">{trimStr(row.original.item_id_1)}</span></div>
    )},
    { accessorKey: 'item_desc', header: 'Description', cell: ({ getValue, row }) => (
      <div className="flex max-w-xs flex-col"><span className="truncate" title={trimStr(getValue())}>{trimStr(getValue())}</span><span className="truncate text-[11px] text-muted-fg" title={trimStr(row.original.item_desc_2)}>{trimStr(row.original.item_desc_2)}</span></div>
    )},
    { id: 'avail', header: 'Available', accessorFn: (r) => sumLoc(r, 'Available'), cell: ({ getValue }) => { const n = Number(getValue()); return <Badge tone={n > 0 ? 'success' : 'default'}>{fmtNumber(n)}</Badge>; }},
    { id: 'damaged', header: 'Damaged', accessorFn: (r) => sumLoc(r, 'Damaged'), cell: ({ getValue }) => { const n = Number(getValue()); return n > 0 ? <Badge tone="danger">{fmtNumber(n)}</Badge> : <span className="text-muted-fg">—</span>; }},
    { id: 'reserved', header: 'Reserved', accessorFn: (r) => sumLoc(r, 'Reserved'), cell: ({ getValue }) => { const n = Number(getValue()); return n > 0 ? <Badge tone="warning">{fmtNumber(n)}</Badge> : <span className="text-muted-fg">—</span>; }},
    { accessorKey: 'OnOrder', header: 'On Order', cell: ({ getValue }) => { const n = Number(getValue()) || 0; return n > 0 ? <Badge tone="primary">{fmtNumber(n)}</Badge> : <span className="text-muted-fg">—</span>; }},
    { accessorKey: 'ThisMonth_W', header: 'This Mo', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'LastMonth_W', header: 'Last Mo', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'ThisYear_W', header: 'This Yr', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'LastYear_W', header: 'Last Yr', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'item_lst_lnd_cost', header: 'Cost', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
    { accessorKey: 'item_prc_2', header: 'Price', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
  ], []);

  return (
    <>
      <Topbar title="Inventory Master Report" subtitle="InvMasterReport · live" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="grid gap-3 p-3 md:grid-cols-[280px_1fr_auto]">
            <Select value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={vendors.isLoading}>
              <option value="">Select vendor…</option>
              {(vendors.data?.rows ?? []).map((v) => <option key={trimStr(v.vendor)} value={trimStr(v.vendor)}>{trimStr(v.vendor)}</option>)}
            </Select>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
              <Input placeholder="Search by item id or description…" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" disabled={!vendor} />
            </div>
            <Button variant="outline" onClick={() => rowsToCSV(rows, `inv-master-${vendor}.csv`)} disabled={!rows.length}>Export CSV</Button>
          </CardContent>
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Items" value={fmtNumber(k?.items)} icon={Boxes} loading={kpis.isLoading} />
          <KpiCard label="On Order" value={fmtNumber(k?.onOrderItems)} icon={Truck} loading={kpis.isLoading} />
          <KpiCard label="Available units" value={fmtNumber(k?.totalAvailable)} icon={Boxes} tone="success" loading={kpis.isLoading} />
          <KpiCard label="Damaged units" value={fmtNumber(k?.totalDamaged)} icon={AlertTriangle} tone="warning" loading={kpis.isLoading} />
        </div>
        <Card>
          <CardContent className="p-4">
            <DataTable data={rows} columns={columns} loading={list.isLoading} pageSize={50} emptyText={vendor ? 'No items match.' : 'Pick a vendor to start.'} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
