import { SqlReportPage } from '@/components/SqlReportPage';

export default function SalesItems() {
  return (
    <SqlReportPage
      title="Sales Items"
      subtitle="SalesItemDetail · 500 records"
      sql="SELECT TOP 500 * FROM SalesItemDetail"
      filename="sales-items.csv"
    />
  );
}
