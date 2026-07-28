import { SqlReportPage } from '@/components/SqlReportPage';

export default function Vendors() {
  return (
    <SqlReportPage
      title="Vendors"
      subtitle="Distinct vendor IDs across the inventory master report"
      sql={`SELECT LTRIM(RTRIM(item_vend_id)) AS vendor,
                   COUNT(*) AS skus,
                   SUM(ISNULL(OnOrder, 0)) AS onOrderItems,
                   SUM(ISNULL(ThisYear_W, 0)) AS thisYearWritten
            FROM InvMasterReport
            WHERE item_vend_id IS NOT NULL AND LTRIM(RTRIM(item_vend_id)) <> ''
            GROUP BY LTRIM(RTRIM(item_vend_id))
            ORDER BY skus DESC`}
      filename="vendors.csv"
    />
  );
}
