import { useState } from 'react';
import { SqlReportPage } from '@/components/SqlReportPage';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

const YEARS = [2026, 2025, 2024, 2023];
const MONTHS = [
  { v: 1, n: 'January' }, { v: 2, n: 'February' }, { v: 3, n: 'March' },
  { v: 4, n: 'April' }, { v: 5, n: 'May' }, { v: 6, n: 'June' },
  { v: 7, n: 'July' }, { v: 8, n: 'August' }, { v: 9, n: 'September' },
  { v: 10, n: 'October' }, { v: 11, n: 'November' }, { v: 12, n: 'December' },
];

export default function ClosedSales() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);

  // Closed sales for a given month — pulled from SalespersonDaily
  // (SaleMaster has no SaleDate column; its DeliveryDate is varchar).
  const sql = `SELECT TOP 500 SaleDate, SalesNo, CustomerName, SalesPerson, SaleAmt, SaleSplitAmt, Sale_Open_Close
               FROM SalespersonDaily
               WHERE YEAR(SaleDate) = ? AND MONTH(SaleDate) = ?
               ORDER BY SaleDate DESC, SalesNo DESC`;

  const filters = (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-xs uppercase tracking-wider text-muted-fg">Year</span>
        <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-32">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </Select>
        <span className="text-xs uppercase tracking-wider text-muted-fg">Month</span>
        <Select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="w-40">
          {MONTHS.map((m) => <option key={m.v} value={m.v}>{m.n}</option>)}
        </Select>
      </CardContent>
    </Card>
  );

  return (
    <SqlReportPage
      title="Closed Sales"
      subtitle={`${year} · ${MONTHS.find((m) => m.v === month)?.n}`}
      sql={sql}
      values={[year, month]}
      filename={`closed-${year}-${month}.csv`}
      filters={filters}
    />
  );
}
