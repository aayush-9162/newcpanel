import { SqlReportPage } from '@/components/SqlReportPage';

export default function SaleDetailRV() {
  return (
    <SqlReportPage
      title="Sale Detail RV"
      subtitle="Sale_DetailRV · 500 most recent"
      sql="SELECT TOP 500 * FROM Sale_DetailRV ORDER BY 1 DESC"
      filename="sale-detail-rv.csv"
    />
  );
}
