import { SqlReportPage } from '@/components/SqlReportPage';

export default function SalesDaily() {
  return (
    <SqlReportPage
      title="Daily Aggregate"
      subtitle="SalesAggrDayWiseReport · 500 records"
      sql="SELECT TOP 500 * FROM SalesAggrDayWiseReport"
      filename="sales-daily.csv"
    />
  );
}
