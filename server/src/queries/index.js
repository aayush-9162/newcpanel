import { z } from 'zod';

const Empty = z.object({}).passthrough();

function def(d) {
  return d;
}

export const queries = {
  // ---------- Lookups ----------
  vendors: def({
    params: Empty,
    build: () => ({
      qry: `SELECT DISTINCT LTRIM(RTRIM(item_vend_id)) AS vendor
            FROM InvMasterReport
            WHERE item_vend_id IS NOT NULL AND LTRIM(RTRIM(item_vend_id)) <> ''
            ORDER BY 1`,
      values: [],
    }),
  }),

  profitCenters: def({
    params: Empty,
    build: () => ({
      qry: `SELECT DISTINCT ProfitCenter FROM SalesAggrMonthWiseReport ORDER BY 1`,
      values: [],
    }),
  }),

  // ---------- Inventory Master Report ----------
  invMasterByVendor: def({
    params: z.object({ vendor: z.string().min(1).max(50) }),
    build: ({ vendor }) => ({
      qry: `SELECT * FROM InvMasterReport
            WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))
            ORDER BY item_id`,
      values: [vendor],
    }),
  }),

  invMasterSearch: def({
    params: z.object({
      vendor: z.string().optional(),
      term: z.string().min(1).max(80),
    }),
    build: ({ vendor, term }) => {
      const like = `%${term}%`;
      if (vendor) {
        return {
          qry: `SELECT * FROM InvMasterReport
                WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))
                  AND (item_id LIKE ? OR item_desc LIKE ? OR item_desc_2 LIKE ?)
                ORDER BY item_id`,
          values: [vendor, like, like, like],
        };
      }
      return {
        qry: `SELECT TOP 500 * FROM InvMasterReport
              WHERE item_id LIKE ? OR item_desc LIKE ? OR item_desc_2 LIKE ?
              ORDER BY item_id`,
        values: [like, like, like],
      };
    },
  }),

  invMasterKpisByVendor: def({
    params: z.object({ vendor: z.string().min(1) }),
    build: ({ vendor }) => ({
      qry: `SELECT
              COUNT(*) AS items,
              SUM(CASE WHEN OnOrder > 0 THEN 1 ELSE 0 END) AS onOrderItems,
              SUM(CAST([Available (Loc#1)] AS INT) + CAST([Available (Loc#2)] AS INT)
                  + CAST([Available (Loc#999)] AS INT) + CAST([Available (Loc#888)] AS INT)
                  + CAST([Available (Loc#501)] AS INT) + CAST([Available (Loc#303)] AS INT)
                  + CAST([Available (Loc#777)] AS INT)) AS totalAvailable,
              SUM(CAST([Damaged (Loc#1)] AS INT) + CAST([Damaged (Loc#2)] AS INT)
                  + CAST([Damaged (Loc#999)] AS INT) + CAST([Damaged (Loc#888)] AS INT)
                  + CAST([Damaged (Loc#501)] AS INT) + CAST([Damaged (Loc#303)] AS INT)
                  + CAST([Damaged (Loc#777)] AS INT)) AS totalDamaged
            FROM InvMasterReport
            WHERE LTRIM(RTRIM(item_vend_id)) = LTRIM(RTRIM(?))`,
      values: [vendor],
    }),
  }),

  // ---------- Dashboard ----------
  dashboardKpis: def({
    params: Empty,
    build: () => ({
      qry: `SELECT
              (SELECT COUNT(*) FROM InvMasterReport) AS totalSkus,
              (SELECT COUNT(DISTINCT LTRIM(RTRIM(item_vend_id))) FROM InvMasterReport) AS totalVendors,
              (SELECT COUNT(*) FROM SalespersonDaily WHERE SaleDate >= DATEADD(day, -30, GETDATE())) AS sales30d,
              (SELECT ISNULL(SUM(SaleAmt), 0) FROM SalespersonDaily WHERE SaleDate >= DATEADD(day, -30, GETDATE())) AS revenue30d,
              (SELECT COUNT(*) FROM DamagedItemsFormCapture) AS damages,
              (SELECT COUNT(*) FROM u_Queue WHERE Active = 'Y') AS activeQueue`,
      values: [],
    }),
  }),

  dashboardRevenueDaily: def({
    params: Empty,
    build: () => ({
      qry: `SELECT
              CONVERT(varchar(10), SaleDate, 23) AS day,
              SUM(SaleAmt) AS revenue,
              COUNT(*) AS orders
            FROM SalespersonDaily
            WHERE SaleDate >= DATEADD(day, -29, CAST(GETDATE() AS DATE))
            GROUP BY CONVERT(varchar(10), SaleDate, 23)
            ORDER BY day`,
      values: [],
    }),
  }),

  dashboardTopVendors: def({
    params: Empty,
    build: () => ({
      qry: `SELECT TOP 10
              LTRIM(RTRIM(item_vend_id)) AS vendor,
              COUNT(*) AS items
            FROM InvMasterReport
            WHERE item_vend_id IS NOT NULL AND LTRIM(RTRIM(item_vend_id)) <> ''
            GROUP BY LTRIM(RTRIM(item_vend_id))
            ORDER BY COUNT(*) DESC`,
      values: [],
    }),
  }),

  // ---------- Sales Performance ----------
  salesMonthlyComparison: def({
    params: z.object({
      profitCenter: z.string().min(1).default('ARDEN'),
      category: z.enum(['Written', 'Delivered']).default('Written'),
    }),
    build: ({ profitCenter, category }) => {
      const isW = category === 'Written';
      return {
        qry: `SELECT MonthName,
                ${isW ? 'CurrentYear_W' : 'CurrentYear_D'} AS ThisYear,
                ${isW ? 'LastYear_W' : 'LastYear_D'} AS LastYear,
                ${isW ? 'PreviousYear_W' : 'PreviousYear_D'} AS PreviousYear,
                ${isW ? 'Previous_W' : 'Previous_D'} AS Previous
              FROM SalesAggrMonthWiseReport
              WHERE ProfitCenter = ?
              ORDER BY CASE MonthName
                WHEN 'January' THEN 1 WHEN 'February' THEN 2 WHEN 'March' THEN 3
                WHEN 'April' THEN 4 WHEN 'May' THEN 5 WHEN 'June' THEN 6
                WHEN 'July' THEN 7 WHEN 'August' THEN 8 WHEN 'September' THEN 9
                WHEN 'October' THEN 10 WHEN 'November' THEN 11 WHEN 'December' THEN 12
              END`,
        values: [profitCenter],
      };
    },
  }),

  // SCR: daily comparison with running totals (mirrors `viewsalesaggrdaywisereport`
  // logic from the original scr.js)
  scrDaily: def({
    params: z.object({
      profitCenter: z.string().min(1).default('ARDEN'),
      category: z.enum(['Written', 'Delivered']).default('Written'),
      monthName: z.string().min(3).max(12),
    }),
    build: ({ profitCenter, category, monthName }) => {
      const isW = category === 'Written';
      const cy = isW ? 'CurrentYear_W' : 'CurrentYear_D';
      const ly = isW ? 'LastYear_W' : 'LastYear_D';
      const cat = isW ? 'SaleCategory_W' : 'SaleCategory_D';
      return {
        qry: `SELECT x.DayMonth,
                     x.LastYear,
                     x.ThisYear,
                     (ISNULL(x.ThisYear,0) - ISNULL(x.LastYear,0)) AS Difference,
                     SUM(ISNULL(x.ThisYear,0)) OVER (ORDER BY x.SortDay) AS TYR,
                     SUM(ISNULL(x.LastYear,0)) OVER (ORDER BY x.SortDay) AS LYR
              FROM (
                SELECT s.DayMonth,
                       s.${cy} AS ThisYear,
                       s.${ly} AS LastYear,
                       s.${cat} AS SaleCategory,
                       s.ProfitCenter,
                       CAST(LEFT(s.DayMonth, CHARINDEX('-', s.DayMonth) - 1) AS INT) AS SortDay
                FROM SalesAggrDayWiseReport s
              ) x
              WHERE x.ProfitCenter = ?
                AND x.DayMonth LIKE ?
                AND x.SaleCategory = ?
              ORDER BY x.SortDay`,
        values: [profitCenter, `%${monthName}`, category],
      };
    },
  }),

  salesDailyByCenter: def({
    params: z.object({ profitCenter: z.string().min(1).default('ARDEN'), days: z.number().int().positive().max(365).default(60) }),
    build: ({ profitCenter, days }) => ({
      qry: `SELECT TOP (?)
              CONVERT(varchar(10), SaleDate, 23) AS day,
              SUM(SaleAmt) AS revenue,
              COUNT(*) AS orders
            FROM SalespersonDaily
            WHERE SaleDate >= DATEADD(day, -?, CAST(GETDATE() AS DATE))
            GROUP BY CONVERT(varchar(10), SaleDate, 23)
            ORDER BY day`,
      values: [days, days],
    }),
  }),

  // ---------- Sales by Zip ----------
  salesByZip: def({
    params: Empty,
    build: () => ({
      qry: `SELECT TOP 100 DeliveryZip, DeliveryCity, CurrentYear, LastYear, PreviousYear, Previous
            FROM SalesAggrZipWiseYearlyReport
            ORDER BY CurrentYear DESC`,
      values: [],
    }),
  }),

  salesByZipKpis: def({
    params: Empty,
    build: () => ({
      qry: `SELECT
              COUNT(*) AS zipCount,
              ISNULL(SUM(CurrentYear), 0) AS revenueThisYear,
              ISNULL(SUM(LastYear), 0) AS revenueLastYear,
              ISNULL(SUM(PreviousYear), 0) AS revenuePrevYear
            FROM SalesAggrZipWiseYearlyReport`,
      values: [],
    }),
  }),

  // ---------- Gross Margin ----------
  grossMarginRecent: def({
    params: Empty,
    build: () => ({
      qry: `SELECT TOP 500 * FROM SalesGrossMarginDetail`,
      values: [],
    }),
  }),

  // ---------- Generic table list & preview ----------
  itemMasterList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM ItemMaster`, values: [] }),
  }),
  invMasterRawList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM InvMaster`, values: [] }),
  }),
  saleMasterList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SaleMaster`, values: [] }),
  }),
  salesItemList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SalesItemDetail`, values: [] }),
  }),
  salesOpenDailyList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SalesOpenDaily`, values: [] }),
  }),
  salesOpenDailyHistory: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SalesOpenDailyHistory`, values: [] }),
  }),
  salesAggrDayWiseList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SalesAggrDayWiseReport`, values: [] }),
  }),
  salesAggrMonthWiseList: def({
    params: Empty,
    build: () => ({ qry: `SELECT * FROM SalesAggrMonthWiseReport ORDER BY ProfitCenter`, values: [] }),
  }),
  deliveryMasterList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM DeliveryMaster`, values: [] }),
  }),
  deliveryDatesList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM DeliveryDates`, values: [] }),
  }),
  saleHistoryList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SaleDtlHis`, values: [] }),
  }),
  saleRvList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM SaleRV`, values: [] }),
  }),
  saleDetailRvList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM Sale_DetailRV`, values: [] }),
  }),
  arRvList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM AR_RV`, values: [] }),
  }),
  poList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM PORV`, values: [] }),
  }),
  poDetailList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM PO_dtlRV`, values: [] }),
  }),
  pdfDataList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 200 * FROM pdf_data`, values: [] }),
  }),
  queueList: def({
    params: Empty,
    build: () => ({
      qry: `SELECT TOP 500 q.QueueId, q.UserId, u.Username, q.BusinessDate, q.OrderQ, q.AddDateTime, q.Active
            FROM u_Queue q LEFT JOIN u_UserMaster u ON u.UserId = q.UserId
            ORDER BY q.AddDateTime DESC`,
      values: [],
    }),
  }),
  saleAssignList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM u_SaleAssign ORDER BY 1 DESC`, values: [] }),
  }),
  dailyLogList: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM u_DailyLog ORDER BY 1 DESC`, values: [] }),
  }),
  userList: def({
    params: Empty,
    build: () => ({ qry: `SELECT * FROM u_UserMaster ORDER BY 1`, values: [] }),
  }),
  damagesRecent: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM DamagedItemsFormCapture ORDER BY 1 DESC`, values: [] }),
  }),
  damagesKpis: def({
    params: Empty,
    build: () => ({
      qry: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN CAST(1 AS INT) = 1 THEN 1 ELSE 0 END) AS recent
            FROM DamagedItemsFormCapture`,
      values: [],
    }),
  }),
  customersRecent: def({
    params: Empty,
    build: () => ({ qry: `SELECT TOP 500 * FROM CustMaster ORDER BY 1 DESC`, values: [] }),
  }),
  customerSearch: def({
    params: z.object({ term: z.string().min(1).max(80) }),
    build: ({ term }) => {
      const t = `%${term}%`;
      return {
        qry: `SELECT TOP 200 * FROM CustMaster
              WHERE cust_id LIKE ? OR cust_nam LIKE ? OR cust_phone_no LIKE ?
                 OR cust_phone_no_2 LIKE ? OR cust_email LIKE ? OR cust_city LIKE ? OR cust_zip_cod LIKE ?`,
        values: [t, t, t, t, t, t, t],
      };
    },
  }),

  // Generic safelisted preview — used by routes whose schema mapping is not yet curated.
  tablePreview: def({
    params: z.object({
      table: z.enum([
        'InvMaster', 'InvMasterReport', 'InvMasterRaw', 'ItemMaster',
        'SaleMaster', 'SaleRV', 'Sale_DetailRV', 'SaleDtlHis', 'SaleWRT', 'AR_RV',
        'CustMaster', 'DamagedItemsFormCapture', 'DeliveryMaster', 'DeliveryDates',
        'PORV', 'PO_dtlRV', 'pdf_data',
        'SalesGrossMarginDetail', 'SalesItemDetail', 'SalesOpenDaily', 'SalesOpenDailyHistory',
        'SalespersonDaily', 'SalesAggrMonthWiseReport', 'SalesAggrDayWiseReport', 'SalesAggrZipWiseYearlyReport',
        'u_DailyLog', 'u_Queue', 'u_UserMaster', 'u_SaleAssign', 'u_LogStatusMaster',
      ]),
    }),
    build: ({ table }) => ({ qry: `SELECT TOP 200 * FROM ${table}`, values: [] }),
  }),
};
