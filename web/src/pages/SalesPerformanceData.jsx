import { SqlReportPage } from '@/components/SqlReportPage';

export default function SalesPerformanceData() {
  return (
    <SqlReportPage
      title="SalesPerson Performance Data"
      subtitle="SalespersonDaily · 500 most recent rows"
      sql="SELECT TOP 500 SaleDate, SalesPerson, CustomerName, SalesNo, SaleAmt, SaleSplitAmt, SplitPercent, Sale_Open_Close FROM SalespersonDaily ORDER BY SaleDate DESC"
      filename="sales-performance-data.csv"
    />
  );
}
