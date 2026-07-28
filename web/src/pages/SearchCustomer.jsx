// Faithful clone of /auth/search/customer — debounced search + match table.
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, inferColumns, rowsToCSV } from '@/components/DataTable';
import { useReportQuery } from '@/lib/api';
import { Search } from 'lucide-react';

export default function SearchCustomer() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(term.trim()), 300); return () => clearTimeout(t); }, [term]);

  const { data, isLoading } = useReportQuery('customerSearch', { term: debounced }, { enabled: debounced.length >= 2 });
  const rows = data?.rows ?? [];
  const cols = useMemo(() => inferColumns(rows[0]), [rows]);

  return (
    <>
      <Topbar title="Customer Search" subtitle="Search CustMaster by id, name, phone or email" />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="p-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-fg" />
              <Input autoFocus placeholder="Type at least 2 characters…" value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            {debounced.length < 2 ? (
              <div className="py-12 text-center text-sm text-muted-fg">Enter a query to search.</div>
            ) : (
              <DataTable data={rows} columns={cols} loading={isLoading} pageSize={50} onExport={() => rowsToCSV(rows, `search-${debounced}.csv`)} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
