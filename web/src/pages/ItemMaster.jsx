import { SqlReportPage } from '@/components/SqlReportPage';

export default function ItemMaster() {
  return (
    <SqlReportPage
      title="Item Master"
      subtitle="ItemMaster · 500 records"
      sql="SELECT TOP 500 * FROM ItemMaster"
      filename="item-master.csv"
    />
  );
}
