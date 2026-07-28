import { SqlReportPage } from '@/components/SqlReportPage';

export default function SaleHistory() {
  return (
    <SqlReportPage
      title="Sale Detail History"
      subtitle="SaleDtlHis · 500 most recent"
      sql="SELECT TOP 500 * FROM SaleDtlHis ORDER BY 1 DESC"
      filename="sale-history.csv"
    />
  );
}
