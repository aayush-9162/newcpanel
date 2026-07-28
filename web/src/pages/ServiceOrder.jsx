import { SqlReportPage } from '@/components/SqlReportPage';

export default function ServiceOrder() {
  return (
    <SqlReportPage
      title="Service Order"
      subtitle="Sale detail history · 500 most recent"
      sql="SELECT TOP 500 * FROM SaleDtlHis ORDER BY 1 DESC"
      filename="service-order.csv"
    />
  );
}
