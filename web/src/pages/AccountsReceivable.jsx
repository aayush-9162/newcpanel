import { SqlReportPage } from '@/components/SqlReportPage';

export default function AccountsReceivable() {
  return (
    <SqlReportPage
      title="Accounts Receivable"
      subtitle="AR_RV · 500 most recent"
      sql="SELECT TOP 500 * FROM AR_RV ORDER BY 1 DESC"
      filename="ar.csv"
    />
  );
}
