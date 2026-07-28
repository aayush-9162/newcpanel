import { SqlReportPage } from '@/components/SqlReportPage';

export default function SaleRV() {
  return (
    <SqlReportPage
      title="Sale RV"
      subtitle="SaleRV · 500 most recent"
      sql="SELECT TOP 500 * FROM SaleRV ORDER BY 1 DESC"
      filename="sale-rv.csv"
    />
  );
}
