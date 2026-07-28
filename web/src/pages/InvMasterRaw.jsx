import { SqlReportPage } from '@/components/SqlReportPage';

export default function InvMasterRaw() {
  return (
    <SqlReportPage
      title="Inventory (Raw)"
      subtitle="InvMaster · 500 records"
      sql="SELECT TOP 500 * FROM InvMaster"
      filename="inv-master-raw.csv"
    />
  );
}
