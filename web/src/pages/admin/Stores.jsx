import { SqlReportPage } from '@/components/SqlReportPage';

export default function Stores() {
  return (
    <SqlReportPage
      title="Stores / Profit Centers"
      subtitle="Distinct profit centers across the sales aggregates"
      sql={`SELECT ProfitCenter,
                   COUNT(*) AS monthEntries,
                   SUM(ISNULL(CurrentYear_W, 0)) + SUM(ISNULL(CurrentYear_D, 0)) AS thisYearTotal,
                   SUM(ISNULL(LastYear_W, 0))   + SUM(ISNULL(LastYear_D, 0))   AS lastYearTotal
            FROM SalesAggrMonthWiseReport
            GROUP BY ProfitCenter
            ORDER BY thisYearTotal DESC`}
      filename="stores.csv"
    />
  );
}
