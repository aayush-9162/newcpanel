// Faithful clone of /auth/pricelist — search + InvMasterReport price table.
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery } from '@/lib/api';
import { fmtCurrency, trimStr } from '@/lib/format';
import { Search } from 'lucide-react';

export default function Pricelist() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 300); return () => clearTimeout(t); }, [term]);

  const like = `%${debounced}%`;
  const sql = debounced.length >= 1
    ? `SELECT TOP 500 item_vend_id, item_id, item_id_1, item_desc, item_desc_2, item_style,
                     item_lst_lnd_cost, item_prc_2, item_lst_cost
       FROM InvMasterReport
       WHERE item_id LIKE ? OR item_desc LIKE ? OR item_desc_2 LIKE ? OR item_style LIKE ?
       ORDER BY item_id`
    : `SELECT TOP 500 item_vend_id, item_id, item_id_1, item_desc, item_desc_2, item_style,
                     item_lst_lnd_cost, item_prc_2, item_lst_cost
       FROM InvMasterReport
       ORDER BY item_id`;
  const values = debounced ? [like, like, like, like] : [];
  const { data, isLoading } = useSqlQuery(sql, values);
  const rows = data?.rows ?? [];

  const columns = useMemo(() => [
    { accessorKey: 'item_vend_id', header: 'Vendor', cell: ({ getValue }) => trimStr(getValue()) },
    { accessorKey: 'item_id', header: 'SKU', cell: ({ getValue }) => <span className="font-medium">{trimStr(getValue())}</span> },
    { accessorKey: 'item_desc', header: 'Description', cell: ({ getValue }) => <span className="truncate" title={trimStr(getValue())}>{trimStr(getValue())}</span> },
    { accessorKey: 'item_style', header: 'Style', cell: ({ getValue }) => trimStr(getValue()) },
    { accessorKey: 'item_lst_lnd_cost', header: 'Cost', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
    { accessorKey: 'item_lst_cost', header: 'Last Cost', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
    { accessorKey: 'item_prc_2', header: 'Price', cell: ({ getValue }) => fmtCurrency(Number(getValue()), true) },
  ], []);

  return (
    <>
      <Topbar title="Price List" subtitle="Search by SKU, description, or style" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
              <Input placeholder="Search SKU, description, style…" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
            <Button variant="outline" size="sm" onClick={() => rowsToCSV(rows, 'pricelist.csv')} disabled={!rows.length}>Export CSV</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <DataTable data={rows} columns={columns} loading={isLoading} pageSize={50} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
