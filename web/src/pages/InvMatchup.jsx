// Faithful clone of /auth/inv/matchup — vendor select + InvMasterReport rows.
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { DataTable, inferColumns, rowsToCSV } from '@/components/DataTable';
import { Button } from '@/components/ui/Button';
import { useReportQuery, useSqlQuery } from '@/lib/api';
import { trimStr } from '@/lib/format';

export default function InvMatchup() {
  const vendors = useReportQuery('vendors');
  const [vendor, setVendor] = useState('');
  useEffect(() => { if (!vendor && vendors.data?.rows.length) setVendor(trimStr(vendors.data.rows[0].vendor)); }, [vendor, vendors.data]);

  // Matchup heuristic: items with both available stock and demand signal
  const sql = `SELECT item_vend_id, item_id, item_id_1, item_desc, item_desc_2,
                      [Available (Loc#1)] AS avail_s1, [Available (Loc#2)] AS avail_s2,
                      [Available (Loc#999)] AS avail_999,
                      [Reserved (Loc#1)] AS res_s1, [Reserved (Loc#2)] AS res_s2,
                      OnOrder, ThisMonth_W, ThisYear_W
               FROM InvMasterReport
               WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))
                 AND (ISNULL([Available (Loc#1)], 0) + ISNULL([Available (Loc#2)], 0)
                      + ISNULL([Available (Loc#999)], 0) + ISNULL([Reserved (Loc#1)], 0)
                      + ISNULL([Reserved (Loc#2)], 0)) > 0
               ORDER BY item_id`;
  const { data, isLoading } = useSqlQuery(sql, [vendor], { enabled: !!vendor });
  const rows = data?.rows ?? [];
  const cols = useMemo(() => inferColumns(rows[0]), [rows]);

  return (
    <>
      <Topbar title="Matchup" subtitle="Available + reserved inventory by vendor" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-xs uppercase tracking-wider text-muted-fg">Vendor</span>
            <Select value={vendor} onChange={(e) => setVendor(e.target.value)} className="w-56">
              <option value="">Select…</option>
              {(vendors.data?.rows ?? []).map((v) => <option key={trimStr(v.vendor)} value={trimStr(v.vendor)}>{trimStr(v.vendor)}</option>)}
            </Select>
            <Button variant="outline" size="sm" onClick={() => rowsToCSV(rows, `matchup-${vendor}.csv`)} disabled={!rows.length}>Export CSV</Button>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <DataTable data={rows} columns={cols} loading={isLoading} pageSize={50} emptyText={vendor ? 'No matchup items.' : 'Pick a vendor.'} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
