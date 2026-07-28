import { SqlReportPage } from '@/components/SqlReportPage';

// The original site keeps yearly/monthly targets in a `store_targets` table.
// That table is referenced from scr.js but isn't in our schema dump — so until
// it is registered, this page reads month-wise sales aggregates instead.
export default function Targets() {
  return (
    <SqlReportPage
      title="Targets"
      subtitle="Monthly aggregates (proxy until store_targets is wired up)"
      sql={`SELECT ProfitCenter, MonthName,
                   ISNULL(CurrentYear_W, 0) AS thisYearWritten,
                   ISNULL(LastYear_W, 0) AS lastYearWritten,
                   ISNULL(LastYear_W, 0) * 1.10 AS suggestedTarget
            FROM SalesAggrMonthWiseReport
            ORDER BY ProfitCenter, CASE MonthName
              WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
              WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
              WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
              WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12 END`}
      filename="targets.csv"
    />
  );
}
