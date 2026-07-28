import { SqlReportPage } from '@/components/SqlReportPage';

export default function Customers() {
  return (
    <SqlReportPage
      title="Customers"
      subtitle="CustMaster · 500 most recent"
      sql="SELECT TOP 500 * FROM CustMaster ORDER BY 1 DESC"
      filename="customers.csv"
    />
  );
}
