import { SqlReportPage } from '@/components/SqlReportPage';

export default function InventoryRequest() {
  return (
    <SqlReportPage
      title="Inventory Request"
      subtitle="DeliveryDates · 500 most recent"
      sql="SELECT TOP 500 * FROM DeliveryDates ORDER BY 1 DESC"
      filename="inventory-requests.csv"
    />
  );
}
