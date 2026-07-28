import { SqlReportPage } from '@/components/SqlReportPage';

export default function SalesOpenHistory() {
  return (
    <SqlReportPage
      title="Open Daily (History)"
      subtitle="SalesOpenDailyHistory · 500 records"
      sql="SELECT TOP 500 * FROM SalesOpenDailyHistory"
      filename="open-history.csv"
    />
  );
}
