import { SqlReportPage } from '@/components/SqlReportPage';

export default function DamageData() {
  return (
    <SqlReportPage
      title="Damage Data"
      subtitle="Editable damage records (read-only here)"
      sql="SELECT TOP 500 * FROM DamagedItemsFormCapture ORDER BY 1 DESC"
      filename="damage-data.csv"
    />
  );
}
