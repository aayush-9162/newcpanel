// Generic faithful-clone report page: header (title + filters slot) → DataTable.
// Use this for pages that are "filter bar + a table from a SQL query".
// Bespoke pages with charts/KPIs build their own layout.

import { Topbar } from './Topbar.jsx';
import { Card, CardContent } from '@/components/ui/Card';
import { DataTable, inferColumns, rowsToCSV } from './DataTable.jsx';
import { useSqlQuery } from '@/lib/api';
import { AlertCircle } from 'lucide-react';

export function SqlReportPage({
  title,
  subtitle,
  sql,
  values = [],
  enabled = true,
  filename,
  filters,         // optional ReactNode rendered above the table
  columns,         // optional explicit columns; otherwise inferred
  pageSize = 50,
  emptyText,
  cellOverrides,   // optional Record<colKey, (value, row) => ReactNode>
}) {
  const { data, isLoading, error } = useSqlQuery(sql, values, { enabled });
  const rows = data?.rows ?? [];
  const cols = columns ?? inferColumns(rows[0]);
  const finalCols = cellOverrides
    ? cols.map((c) => (cellOverrides[c.id] ? { ...c, cell: ({ getValue, row }) => cellOverrides[c.id](getValue(), row.original) } : c))
    : cols;

  return (
    <>
      <Topbar title={title} subtitle={subtitle} />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {filters}
        {error && (
          <Card className="border-danger/30">
            <CardContent className="flex items-center gap-3 p-4 text-sm text-danger">
              <AlertCircle size={18} />
              <span>{error.message}</span>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4">
            <DataTable
              data={rows}
              columns={finalCols}
              loading={isLoading}
              pageSize={pageSize}
              emptyText={emptyText ?? 'No records found.'}
              onExport={() => rowsToCSV(rows, filename || `${title.toLowerCase().replace(/\s+/g, '-')}.csv`)}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
