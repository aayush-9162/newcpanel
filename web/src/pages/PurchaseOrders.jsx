import { SqlReportPage } from '@/components/SqlReportPage';

export default function PurchaseOrders() {
  return (
    <SqlReportPage
      title="Purchase Orders"
      subtitle="PORV · 500 most recent"
      sql="SELECT TOP 500 * FROM PORV ORDER BY 1 DESC"
      filename="po.csv"
    />
  );
}
