import { SqlReportPage } from '@/components/SqlReportPage';

export default function SaleMaster() {
  return (
    <SqlReportPage
      title="Sale Master"
      subtitle="SaleMaster · 500 most recent"
      sql="SELECT TOP 500 * FROM SaleMaster ORDER BY 1 DESC"
      filename="sale-master.csv"
    />
  );
}
