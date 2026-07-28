import * as React from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

export function DataTable({
  data,
  columns,
  loading,
  searchPlaceholder = 'Filter visible rows…',
  pageSize = 25,
  emptyText = 'No records found',
  onExport,
  compact,
}) {
  const [sorting, setSorting] = React.useState([]);
  const [globalFilter, setGlobalFilter] = React.useState('');

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize } },
  });

  return (
    <div className="flex flex-col gap-3">
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
            <Input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-8"
            />
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-muted-fg">
            <span className="num">{table.getFilteredRowModel().rows.length}</span> rows
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport}>
                <Download size={14} /> Export CSV
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-[1] bg-muted/60 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b border-border">
                {hg.headers.map((h) => {
                  const sortDir = h.column.getIsSorted();
                  const canSort = h.column.getCanSort();
                  return (
                    <th
                      key={h.id}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                      className={cn(
                        'whitespace-nowrap px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-fg',
                        canSort && 'cursor-pointer select-none hover:text-fg',
                      )}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort &&
                          (sortDir === 'asc' ? <ArrowUp size={12} /> : sortDir === 'desc' ? <ArrowDown size={12} /> : <ArrowUpDown size={12} className="opacity-40" />)}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border">
                    {columns.map((_, j) => (
                      <td key={j} className="px-3 py-3">
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.length === 0
              ? (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-muted-fg">
                      {emptyText}
                    </td>
                  </tr>
                )
              : table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className="border-b border-border last:border-0 transition hover:bg-muted/40">
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="whitespace-nowrap px-3 py-2.5 num">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>

      {!compact && table.getPageCount() > 1 && (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-fg">
          <div>
            Page <span className="num text-fg">{table.getState().pagination.pageIndex + 1}</span> of{' '}
            <span className="num text-fg">{table.getPageCount()}</span>
          </div>
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
    </div>
  );
}

export function inferColumns(sample) {
  if (!sample) return [];
  return Object.keys(sample).map((key) => ({
    id: key,
    accessorKey: key,
    header: key,
    cell: ({ getValue }) => {
      const v = getValue();
      if (v == null) return <span className="text-muted-fg">—</span>;
      if (typeof v === 'string') return v.trim();
      if (typeof v === 'number') return v.toLocaleString();
      return String(v);
    },
  }));
}

export function rowsToCSV(rows, filename = 'export.csv') {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v) => {
    if (v == null) return '';
    let s = typeof v === 'string' ? v : String(v);
    s = s.trim().replace(/\r?\n/g, ' ');
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => escape(r[c])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
