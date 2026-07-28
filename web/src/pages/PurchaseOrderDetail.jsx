import { SqlReportPage } from '@/components/SqlReportPage';

export default function PurchaseOrderDetail() {
  return (
    <SqlReportPage
      title="PO Detail"
      subtitle="PO_dtlRV · 500 most recent"
      sql="SELECT TOP 500 * FROM PO_dtlRV ORDER BY 1 DESC"
      filename="po-detail.csv"
    />
  );
}
