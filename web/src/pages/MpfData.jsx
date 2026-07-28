import { useState } from 'react';
import { SqlReportPage } from '@/components/SqlReportPage';
import { Card, CardContent } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';

const YEARS = [2026, 2025, 2024, 2023];
const MONTHS = [
  { v: 0, n: 'All' },
  { v: 1, n: 'January' }, { v: 2, n: 'February' }, { v: 3, n: 'March' },
  { v: 4, n: 'April' }, { v: 5, n: 'May' }, { v: 6, n: 'June' },
  { v: 7, n: 'July' }, { v: 8, n: 'August' }, { v: 9, n: 'September' },
  { v: 10, n: 'October' }, { v: 11, n: 'November' }, { v: 12, n: 'December' },
];

export default function MpfData() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(0);

  const where = month === 0 ? `WHERE YEAR(SaleDate) = ${year}` : `WHERE YEAR(SaleDate) = ${year} AND MONTH(SaleDate) = ${month}`;
  const sql = `SELECT TOP 500 SaleDate, CustomerName, SalesNo, SalesPerson, SaleAmt, SaleSplitAmt, SplitPercent
               FROM SalespersonDaily ${where} ORDER BY SaleDate DESC`;

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
      title="Associate Manager Data"
      subtitle="Helped-by manager records"
      sql={sql}
      filters={filters}
      filename={`mpf-${year}-${month}.csv`}
    />
  );
}
