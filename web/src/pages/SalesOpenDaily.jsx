import { SqlReportPage } from '@/components/SqlReportPage';

export default function SalesOpenDaily() {
  return (
    <SqlReportPage
      title="Open Daily"
      subtitle="SalesOpenDaily · 500 records"
      sql="SELECT TOP 500 * FROM SalesOpenDaily"
      filename="sales-open-daily.csv"
    />
  );
}
