// Faithful clone of /auth/inv/mto — vendor select + InvMasterReport rows
// matching the MTO criteria (currently shows items with positive on-order or
// store-level shortage signals).
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { DataTable, inferColumns, rowsToCSV } from '@/components/DataTable';
import { Button } from '@/components/ui/Button';
import { useReportQuery, useSqlQuery } from '@/lib/api';
import { trimStr } from '@/lib/format';

export default function InvMTO() {
  const vendors = useReportQuery('vendors');
  const [vendor, setVendor] = useState('');
  useEffect(() => { if (!vendor && vendors.data?.rows.length) setVendor(trimStr(vendors.data.rows[0].vendor)); }, [vendor, vendors.data]);

  const sql = `SELECT item_vend_id, item_id, item_id_1, item_desc, item_desc_2, OnOrder, OnOrderReserved,
                      ThisMonth_W, LastMonth_W, ThisYear_W, LastYear_W,
                      item_lst_lnd_cost, item_prc_2
               FROM InvMasterReport
               WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))
                 AND ISNULL(OnOrder, 0) > 0
               ORDER BY item_id`;
  const { data, isLoading } = useSqlQuery(sql, [vendor], { enabled: !!vendor });
  const rows = data?.rows ?? [];
  const cols = useMemo(() => inferColumns(rows[0]), [rows]);

  return (
    <>
      <Topbar title="MTO" subtitle="On-order items by vendor" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-xs uppercase tracking-wider text-muted-fg">Vendor</span>
            <Select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-56">
              <option value="">Select…</option>
              {(vendors.data?.rows ?? []).map((v) => <option key={trimStr(v.vendor)} value={trimStr(v.vendor)}>{trimStr(v.vendor)}</option>)}
            </Select>
            <Button variant="outline" size="sm" onClick={() => rowsToCSV(rows, `mto-${vendor}.csv`)} disabled={!rows.length}>Export CSV</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <DataTable data={rows} columns={cols} loading={isLoading} pageSize={50} emptyText={vendor ? 'No on-order items for this vendor.' : 'Pick a vendor.'} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
