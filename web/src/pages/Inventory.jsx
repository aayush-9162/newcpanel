// Inventory overview (/auth/inventory) — vendor select + InvMasterReport columns the
// original page shows.
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useReportQuery, useSqlQuery } from '@/lib/api';
import { trimStr, fmtNumber, fmtCurrency } from '@/lib/format';
import { Search } from 'lucide-react';

export default function Inventory() {
  const vendors = useReportQuery('vendors');
  const [vendor, setVendor] = useState('');
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { if (!vendor && vendors.data?.rows.length) setVendor(trimStr(vendors.data.rows[0].vendor)); }, [vendor, vendors.data]);
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 300); return () => clearTimeout(t); }, [term]);

  const like = `%${debounced}%`;
  const sql = debounced.length >= 2
    ? `SELECT item_vend_id, item_id, item_id_1, item_desc, item_desc_2,
              [Available (Loc#1)] AS s1, [Available (Loc#2)] AS s2, [Available (Loc#999)] AS w_999, [Available (Loc#888)] AS w_888,
              OnOrder, ThisMonth_W, ThisYear_W, item_lst_lnd_cost, item_prc_2
       FROM InvMasterReport
       WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))
         AND (item_id LIKE ? OR item_desc LIKE ? OR item_desc_2 LIKE ?)
       ORDER BY item_id`
    : `SELECT item_vend_id, item_id, item_id_1, item_desc, item_desc_2,
              [Available (Loc#1)] AS s1, [Available (Loc#2)] AS s2, [Available (Loc#999)] AS w_999, [Available (Loc#888)] AS w_888,
              OnOrder, ThisMonth_W, ThisYear_W, item_lst_lnd_cost, item_prc_2
       FROM InvMasterReport
       WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))
       ORDER BY item_id`;
  const values = debounced.length >= 2 ? [vendor, like, like, like] : [vendor];
  const { data, isLoading } = useSqlQuery(sql, values, { enabled: !!vendor });
  const rows = data?.rows ?? [];

  const columns = useMemo(() => [
    { accessorKey: 'item_id', header: 'Item ID', cell: ({ getValue }) => <span className="font-medium">{trimStr(getValue())}</span> },
    { accessorKey: 'item_desc', header: 'Description', cell: ({ getValue }) => <span className="truncate" title={trimStr(getValue())}>{trimStr(getValue())}</span> },
    { accessorKey: 's1', header: 'S1', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 's2', header: 'S2', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'w_999', header: '999', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'w_888', header: '888', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'OnOrder', header: 'On Order', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'ThisMonth_W', header: 'This Mo', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'ThisYear_W', header: 'This Yr', cell: ({ getValue }) => fmtNumber(Number(getValue())) },
    { accessorKey: 'item_lst_lnd_cost', header: 'Cost', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
    { accessorKey: 'item_prc_2', header: 'Price', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
  ], []);

  return (
    <>
      <Topbar title="Inventory" subtitle="InvMasterReport · vendor view" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="grid gap-3 p-3 md:grid-cols-[280px_1fr_auto]">
            <Select value={vendor} onChange={(e) => setVendor(e.target.value)} disabled={vendors.isLoading}>
              <option value="">Select vendor…</option>
              {(vendors.data?.rows ?? []).map((v) => <option key={trimStr(v.vendor)} value={trimStr(v.vendor)}>{trimStr(v.vendor)}</option>)}
            </Select>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
              <Input placeholder="Search id or description…" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" disabled={!vendor} />
            </div>
            <Button variant="outline" onClick={() => rowsToCSV(rows, `inventory-${vendor}.csv`)} disabled={!rows.length}>Export CSV</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <DataTable data={rows} columns={columns} loading={isLoading} pageSize={50} emptyText={vendor ? 'No items.' : 'Pick a vendor.'} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
