// DashboardDaily — the "Daily" (yesterday) view of the Dashboard, shown when
// the Monthly/Daily toggle is set to Daily. Everything here is scoped to the
// most recent business day on file (MAX SaleDate) for the selected store, which
// is what the rest of the app calls "yesterday".
//
// Sections: yesterday headline · KPI tiles (orders / units / avg / customers) ·
// Area-wise sales (top 5 + see-all popup) · Top 5 vendors · Item Sold Analysis.
// Self-contained: its own drill-down modal, so it composes cleanly inside the
// parent Dashboard.

import { useMemo, useState } from 'react';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { MetricDrilldown } from '@/components/MetricDrilldown';
import { useSqlQuery, useMysqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { ROOM_RULES, roomCase, itemTypeCase } from '@/lib/salesRules';
import { vendorDomain } from '@/data/vendorLogos';
import {
  Calendar, ShoppingCart, Users, Truck, Package, MapPin, Boxes, Activity, ChevronRight, Award,
} from 'lucide-react';
import { cn } from '@/lib/cn';

// Parse a 'YYYY-MM-DD' as LOCAL midnight (SQL DATE arrives as UTC midnight,
// which renders a day earlier west of UTC). See Dashboard.localDate.
const localDate = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00');

export default function DashboardDaily({ store, selectedBldg }) {
  const storeLabel = store === 'ARDEN' ? 'Arden (S1)' : 'Waynesville (S2)';
  const spdStore = `LEFT(CAST(sd.SalesNo AS VARCHAR(20)), 1) = '${selectedBldg}'`;

  const [drilldown, setDrilldown] = useState(null);
  const openDetail = (config) => () => setDrilldown(config);

  // ── KPI query — orders / revenue / customers (new vs returning) for the
  //    latest day on file. Correlated sub-selects all key off the same m.d.
  // Revenue + orders come from SaleWRT (the same source the area-wise section
  // uses, and which reliably has the store's latest sales day). The day is the
  // store's most recent SaleWRT date.
  const kpiSql = `
    WITH m AS (SELECT MAX(CAST(wrt_cng_bdat AS DATE)) AS d FROM SaleWRT WHERE wrt_pft_ctr = ${selectedBldg} AND CAST(wrt_cng_bdat AS DATE) < CAST(GETDATE() AS DATE))
    SELECT
      (SELECT CONVERT(char(10), d, 23) FROM m) AS day,
      (SELECT COUNT(DISTINCT S.wrt_so_no) FROM SaleWRT S CROSS JOIN m
         WHERE CAST(S.wrt_cng_bdat AS DATE) = m.d AND S.wrt_pft_ctr = ${selectedBldg}) AS orders,
      (SELECT SUM(S.wrt_sls) FROM SaleWRT S CROSS JOIN m
         WHERE CAST(S.wrt_cng_bdat AS DATE) = m.d AND S.wrt_pft_ctr = ${selectedBldg}) AS revenue
  `;
  const kpiQ = useSqlQuery(kpiSql, []);
  const k = kpiQ.data?.rows?.[0] ?? {};
  const orders    = Number(k.orders) || 0;
  const revenue   = Number(k.revenue) || 0;
  const dayStr    = k.day || null;
  const dayLabel  = dayStr ? localDate(dayStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
  // Short "8 Aug" style date used in place of the word "Yesterday" on labels.
  const dateShort = dayStr
    ? `${localDate(dayStr).getDate()} ${localDate(dayStr).toLocaleDateString('en-US', { month: 'short' })}`
    : 'Latest day';
  const weekdayLong = dayStr ? localDate(dayStr).toLocaleDateString('en-US', { weekday: 'long' }) : '';

  // Customers (total / new / returning) for that same day — from SalespersonDaily
  // (the only source with first-purchase history), anchored on the SaleWRT day.
  // Only the day's customers are checked for prior history (fast anti-join),
  // instead of computing a first-sale date for every customer in the table.
  const custSql = `
    WITH w AS (SELECT MAX(CAST(wrt_cng_bdat AS DATE)) AS d FROM SaleWRT WHERE wrt_pft_ctr = ${selectedBldg} AND CAST(wrt_cng_bdat AS DATE) < CAST(GETDATE() AS DATE)),
         dayc AS (
           SELECT DISTINCT sd.CustomerId
           FROM SalespersonDaily sd CROSS JOIN w
           WHERE ${spdStore} AND CAST(sd.SaleDate AS DATE) = w.d
             AND sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> ''
         )
    SELECT
      (SELECT COUNT(*) FROM dayc) AS customers,
      (SELECT COUNT(*) FROM dayc c CROSS JOIN w
         WHERE NOT EXISTS (
           SELECT 1 FROM SalespersonDaily s2
           WHERE s2.CustomerId = c.CustomerId AND CAST(s2.SaleDate AS DATE) < w.d
         )) AS newCustomers
  `;
  const custQ = useSqlQuery(custSql, []);
  const cust = custQ.data?.rows?.[0] ?? {};
  const customers = Number(cust.customers) || 0;
  const newC      = Number(cust.newCustomers) || 0;
  const returning = Math.max(0, customers - newC);

  // Top salespeople for the day — orders (sales count) + total revenue, from
  // SalespersonDaily, anchored on the SaleWRT day (kicks off once it's known).
  const spSql = dayStr ? `
    SELECT TOP 3 LTRIM(RTRIM(sd.SalesPerson)) AS salesperson,
           COUNT(DISTINCT sd.SalesNo)         AS orders,
           SUM(ISNULL(sd.SaleSplitAmt, 0))    AS revenue
    FROM SalespersonDaily sd
    WHERE CAST(sd.SaleDate AS DATE) = '${dayStr}' AND ${spdStore}
      AND sd.SalesPerson IS NOT NULL AND LTRIM(RTRIM(sd.SalesPerson)) <> ''
    GROUP BY LTRIM(RTRIM(sd.SalesPerson))
    ORDER BY revenue DESC
  ` : 'SELECT 1';
  const spQ = useSqlQuery(spSql, [], { enabled: !!dayStr });
  const topSalespeople = dayStr ? (spQ.data?.rows ?? []) : [];

  // Salesperson codes → full names (MySQL employees.rv_code → name). A code like
  // "BJT / CAT / JEC" is a split sale — resolve each part and rejoin.
  const empQ = useMysqlQuery('SELECT rv_code, name FROM employees', []);
  const empMap = useMemo(() => {
    const m = {};
    for (const r of (empQ.data?.rows ?? [])) {
      const c = String(r.rv_code || '').trim().toUpperCase();
      if (c) m[c] = String(r.name || '').trim();
    }
    return m;
  }, [empQ.data]);
  const resolveSp = (raw) => String(raw || '')
    .split('/')
    .map((part) => {
      const c = part.trim();
      const full = empMap[c.toUpperCase()];
      return full ? (full.trim().split(/\s+/)[0] || full) : c; // first name only
    })
    .filter(Boolean)
    .join(' / ') || String(raw || '—');
  // Full name(s) — used for the hover tooltip.
  const resolveSpFull = (raw) => String(raw || '')
    .split('/')
    .map((part) => { const c = part.trim(); return empMap[c.toUpperCase()] || c; })
    .filter(Boolean)
    .join(' / ') || String(raw || '—');

  // ── Units sold (SalesItemDetail latest day).
  const unitsSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail WHERE LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}' AND SaleDate < CAST(GETDATE() AS DATE))
    SELECT (SELECT COUNT(*) FROM SalesItemDetail s
              WHERE s.SaleDate = m.d AND LEFT(CAST(s.SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}') AS units
    FROM m
  `;
  const unitsQ = useSqlQuery(unitsSql, []);
  const units = Number(unitsQ.data?.rows?.[0]?.units) || 0;

  // ── Area-wise: latest day's sales grouped by delivery zip → city (area).
  const areaCityExpr = `LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(SR.DeliveryCity)),''), NULLIF(LTRIM(RTRIM(SR.BillingCity)),''), 'Unknown')))`;
  const areaZipExpr  = `LTRIM(RTRIM(COALESCE(NULLIF(LTRIM(RTRIM(SR.DeliveryZip)),''),  NULLIF(LTRIM(RTRIM(SR.BillingZip)),''),  'Unknown')))`;
  const areaSql = `
    WITH m AS (SELECT MAX(CAST(wrt_cng_bdat AS DATE)) AS d FROM SaleWRT WHERE wrt_pft_ctr = ${selectedBldg} AND CAST(wrt_cng_bdat AS DATE) < CAST(GETDATE() AS DATE))
    SELECT ${areaCityExpr} AS City,
           ${areaZipExpr}  AS Zip,
           SUM(S.wrt_sls)              AS Revenue,
           COUNT(DISTINCT S.wrt_so_no) AS Orders
    FROM SaleWRT S
    CROSS JOIN m
    LEFT JOIN SaleRV SR ON S.wrt_so_no = SR.sales_no
    WHERE CAST(S.wrt_cng_bdat AS DATE) = m.d AND S.wrt_pft_ctr = ${selectedBldg}
    GROUP BY ${areaCityExpr}, ${areaZipExpr}
    HAVING SUM(S.wrt_sls) <> 0
    ORDER BY Revenue DESC
  `;
  const areaQ = useSqlQuery(areaSql, []);
  const yAreas = useMemo(() => {
    const rows = areaQ.data?.rows ?? [];
    const map = new Map();
    let total = 0;
    for (const r of rows) {
      const name = String(r.City || 'Unknown').trim() || 'Unknown';
      const zip  = String(r.Zip || '').trim() || '—';
      const rev  = Number(r.Revenue) || 0;
      const ord  = Number(r.Orders) || 0;
      total += rev;
      if (!map.has(name)) map.set(name, { name, revenue: 0, orders: 0, zips: [] });
      const a = map.get(name);
      a.revenue += rev; a.orders += ord;
      a.zips.push({ zip, revenue: rev, orders: ord });
    }
    const areas = [...map.values()]
      .map((a) => ({ ...a, zipCount: a.zips.length, zips: a.zips.sort((x, y) => y.revenue - x.revenue) }))
      .sort((a, b) => b.revenue - a.revenue);
    return { areas, total };
  }, [areaQ.data]);

  // ── Top 5 vendors ranked BY REVENUE (latest day). SalesItemDetail has no
  //    per-line price, so each sale's revenue (from SaleWRT) is split across its
  //    vendors in proportion to item count; vendors are then ranked by that.
  const vendorSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail WHERE LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}' AND SaleDate < CAST(GETDATE() AS DATE)),
         det AS (
           SELECT CAST(SaleNo AS VARCHAR(20)) AS SaleNo,
                  LTRIM(RTRIM(VendorID))       AS vendor,
                  LTRIM(RTRIM(ItemID))         AS ItemID
           FROM SalesItemDetail CROSS JOIN m
           WHERE SaleDate = m.d AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
             AND VendorID IS NOT NULL AND LTRIM(RTRIM(VendorID)) NOT IN ('CFC', 'USLD', 'NONE', '')
         ),
         vitems AS (SELECT SaleNo, vendor, COUNT(*) AS items FROM det GROUP BY SaleNo, vendor),
         saleTot AS (SELECT SaleNo, SUM(items) AS totItems FROM vitems GROUP BY SaleNo),
         saleRev AS (
           SELECT CAST(S.wrt_so_no AS VARCHAR(20)) AS SaleNo, SUM(S.wrt_sls) AS amt
           FROM SaleWRT S CROSS JOIN m
           WHERE S.wrt_pft_ctr = ${selectedBldg} AND CAST(S.wrt_cng_bdat AS DATE) = m.d
           GROUP BY CAST(S.wrt_so_no AS VARCHAR(20))
         ),
         vrev AS (
           SELECT vi.vendor, SUM(ISNULL(sr.amt, 0) * vi.items * 1.0 / NULLIF(st.totItems, 0)) AS revenue
           FROM vitems vi JOIN saleTot st ON st.SaleNo = vi.SaleNo
           LEFT JOIN saleRev sr ON sr.SaleNo = vi.SaleNo
           GROUP BY vi.vendor
         ),
         vagg AS (SELECT vendor, COUNT(*) AS units, COUNT(DISTINCT ItemID) AS skus FROM det GROUP BY vendor)
    SELECT TOP 5 vagg.vendor AS vendor, vagg.units AS units, vagg.skus AS skus, ISNULL(vrev.revenue, 0) AS revenue
    FROM vagg LEFT JOIN vrev ON vrev.vendor = vagg.vendor
    ORDER BY revenue DESC
  `;
  const vendorQ = useSqlQuery(vendorSql, []);
  const topVendors = vendorQ.data?.rows ?? [];
  const topVendorsRevTotal = topVendors.reduce((s, v) => s + (Number(v.revenue) || 0), 0);

  // ── Item Sold by room (latest day).
  const itemCatSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail WHERE LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}' AND SaleDate < CAST(GETDATE() AS DATE)),
         base AS (
           SELECT UPPER(ISNULL(Description2,'')) AS d2
           FROM SalesItemDetail CROSS JOIN m
           WHERE SaleDate = m.d AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
         ),
         cat AS (SELECT ${roomCase} AS room FROM base)
    SELECT room, COUNT(*) AS units FROM cat GROUP BY room
  `;
  const itemCatQ = useSqlQuery(itemCatSql, []);
  const itemCatByRoom = useMemo(() => {
    const map = {};
    for (const r of (itemCatQ.data?.rows ?? [])) map[r.room] = Number(r.units) || 0;
    return map;
  }, [itemCatQ.data]);

  // Zip breakdown config for one area (drill target).
  const areaZipConfig = (a) => ({
    title: `${a.name} · Zip Codes · ${dayLabel}`,
    icon: MapPin,
    accent: 'primary',
    headline: fmtCurrency(a.revenue),
    subtitle: `${fmtNumber(a.zipCount)} zip code${a.zipCount === 1 ? '' : 's'} · ${fmtNumber(a.orders)} order${a.orders === 1 ? '' : 's'}`,
    loadRows: () => a.zips.map((z) => ({ zip: z.zip, orders: z.orders, revenue: z.revenue })),
    detailsColumns: [
      { key: 'zip', label: 'Zip Code', render: (r) => <span className="font-mono font-semibold">{r.zip}</span> },
      { key: 'orders', label: 'Orders', align: 'right', render: (r) => fmtNumber(r.orders) },
      { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(r.revenue)}</span> },
    ],
    detailsEmpty: 'No zip codes',
  });

  // "See all areas" popup — every area, click one to drill into its zips.
  const allAreasConfig = {
    title: `All Areas · ${dateShort} · ${storeLabel}`,
    icon: MapPin,
    accent: 'primary',
    headline: fmtCurrency(yAreas.total),
    subtitle: `${fmtNumber(yAreas.areas.length)} area${yAreas.areas.length === 1 ? '' : 's'} · click an area to see its zip codes`,
    loadRows: () => yAreas.areas.map((a) => ({ name: a.name, zips: a.zipCount, orders: a.orders, revenue: a.revenue, _area: a })),
    detailsColumns: [
      { key: 'name', label: 'Area' },
      { key: 'zips', label: 'Zip Codes', align: 'right', render: (r) => fmtNumber(r.zips) },
      { key: 'orders', label: 'Orders', align: 'right', render: (r) => fmtNumber(r.orders) },
      { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(r.revenue)}</span> },
    ],
    onRowClick: (row) => areaZipConfig(row._area),
    detailsEmpty: 'No sales yesterday',
  };

  const top5Areas = yAreas.areas.slice(0, 5);
  const topArea = yAreas.areas[0] || null;
  const topAreaShare = topArea && yAreas.total ? ((topArea.revenue / yAreas.total) * 100).toFixed(1) : '0';
  const noSalesYet = !kpiQ.isLoading && orders === 0 && revenue === 0;

  return (
    <>
      {/* ═══════════════ YESTERDAY headline ═══════════════ */}
      <HeroBanner icon={Calendar} decorIcon={Calendar} accent="emerald">
        <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
          {storeLabel}{weekdayLong ? ` · ${weekdayLong}` : ''} · {dateShort}
        </div>
        <div className="mt-1 flex items-baseline gap-3 flex-wrap">
          <span
            title={fmtCurrency(revenue, true)}
            className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-emerald-600 to-teal-500 bg-clip-text text-transparent"
          >
            {fmtCurrency(revenue)}
          </span>
          <span className="text-sm font-medium text-muted-fg">
            {noSalesYet ? 'no sales on file for the latest day' : `${fmtNumber(orders)} order${orders === 1 ? '' : 's'} · ${fmtNumber(units)} item${units === 1 ? '' : 's'} sold`}
          </span>
        </div>
      </HeroBanner>

      {/* ═══════════════ KPI tiles (compact) ═══════════════ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label={`Orders · ${dateShort}`}
          value={fmtNumber(orders)}
          caption={weekdayLong || 'Latest day'}
          icon={ShoppingCart}
          accent="sky"
          loading={kpiQ.isLoading}
          onClick={openDetail({
            title: `Orders · ${dateShort} · ${storeLabel}`,
            icon: ShoppingCart,
            accent: 'sky',
            headline: fmtNumber(orders),
            subtitle: `Every distinct sale ticket on ${dayLabel || 'the latest day'}`,
            detailsDb: 'sql',
            detailsSql: dayStr ? `
              SELECT CAST(S.wrt_so_no AS VARCHAR(20)) AS SaleNo, SUM(S.wrt_sls) AS amount
              FROM SaleWRT S
              WHERE CAST(S.wrt_cng_bdat AS DATE) = '${dayStr}' AND S.wrt_pft_ctr = ${selectedBldg}
              GROUP BY CAST(S.wrt_so_no AS VARCHAR(20))
              ORDER BY amount DESC
            ` : undefined,
            detailsColumns: [
              { key: 'SaleNo', label: 'Sale #' },
              { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.amount) || 0)}</span> },
            ],
            detailsEmpty: 'No orders yesterday',
          })}
        />
        <StatCard
          label={`Items Sold · ${dateShort}`}
          value={fmtNumber(units)}
          caption={orders ? `${(units / orders).toFixed(1)} per order` : 'units sold'}
          icon={Boxes}
          accent="primary"
          loading={unitsQ.isLoading}
        />
        <StatCard
          label={`Customers · ${dateShort}`}
          value={fmtNumber(customers)}
          caption={customers ? `${fmtNumber(newC)} new · ${fmtNumber(returning)} returning` : 'no customers'}
          icon={Users}
          accent="violet"
          loading={custQ.isLoading}
          onClick={openDetail({
            title: `Customers · ${dateShort} · ${storeLabel}`,
            icon: Users,
            accent: 'violet',
            headline: fmtNumber(customers),
            subtitle: customers
              ? `${fmtNumber(newC)} new · ${fmtNumber(returning)} returning on ${dayLabel || 'the latest day'}`
              : 'No customers yesterday',
            detailsDb: 'sql',
            detailsSql: dayStr ? `
              WITH fc AS (
                     SELECT sd.CustomerId, MIN(sd.SaleDate) AS firstSale
                     FROM SalespersonDaily sd
                     WHERE sd.CustomerId IS NOT NULL AND LTRIM(RTRIM(sd.CustomerId)) <> ''
                     GROUP BY sd.CustomerId
                   )
              SELECT sd.CustomerId,
                     MAX(sd.CustomerName) AS CustomerName,
                     MIN(fc.firstSale)    AS firstSale,
                     CASE WHEN CAST(MIN(fc.firstSale) AS DATE) = '${dayStr}' THEN 'New' ELSE 'Returning' END AS custType,
                     SUM(sd.SaleSplitAmt)      AS spent,
                     COUNT(DISTINCT sd.SalesNo) AS orders
              FROM SalespersonDaily sd
              INNER JOIN fc ON fc.CustomerId = sd.CustomerId
              WHERE CAST(sd.SaleDate AS DATE) = '${dayStr}' AND ${spdStore}
              GROUP BY sd.CustomerId
              ORDER BY SUM(sd.SaleSplitAmt) DESC
            ` : undefined,
            detailsColumns: [
              { key: 'custType', label: 'Type', render: (r) => (
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  r.custType === 'New'
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200'
                    : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200')}>
                  {r.custType}
                </span>
              )},
              { key: 'CustomerName', label: 'Customer' },
              { key: 'firstSale',    label: 'First Sale', render: (r) => r.firstSale ? new Date(r.firstSale).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—' },
              { key: 'orders',       label: 'Orders', align: 'right', render: (r) => fmtNumber(Number(r.orders) || 0) },
              { key: 'spent',        label: 'Spent', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.spent) || 0)}</span> },
            ],
            detailsEmpty: 'No customers yesterday',
          })}
        />
        <StatCard
          label={`Top Area · ${dateShort}`}
          value={topArea ? fmtCompactCurrency(topArea.revenue) : '—'}
          caption={topArea ? `${topArea.name} · ${topAreaShare}% of day` : 'no sales'}
          icon={MapPin}
          accent="emerald"
          loading={areaQ.isLoading}
          onClick={topArea ? openDetail(areaZipConfig(topArea)) : undefined}
        />
      </div>

      {/* ═══════════════ Area-wise sales (top 5 + see all) ═══════════════ */}
      <SectionHeading
        icon={MapPin}
        title={`Area Wise Sales · ${dateShort} · ${storeLabel}`}
        hint={yAreas.total > 0
          ? `${fmtNumber(yAreas.areas.length)} areas · ${fmtCurrency(yAreas.total)} · click an area for its zip codes`
          : 'Top areas by revenue · click an area for its zip codes'}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {areaQ.isLoading ? (
          <div className="col-span-2 py-6 text-center text-xs text-muted-fg lg:col-span-5">Loading…</div>
        ) : top5Areas.length === 0 ? (
          <div className="col-span-2 py-6 text-center text-xs text-muted-fg lg:col-span-5">No sales yesterday for {storeLabel}.</div>
        ) : top5Areas.map((a, i) => {
          const share = yAreas.total ? ((a.revenue / yAreas.total) * 100).toFixed(1) : '0';
          return (
            <HeroStat
              key={a.name}
              label={a.name}
              value={fmtCompactCurrency(a.revenue)}
              fullValue={fmtCurrency(a.revenue)}
              icon={MapPin}
              accent={['primary', 'emerald', 'amber', 'violet', 'sky'][i % 5]}
              subtitle={`${fmtNumber(a.zipCount)} zip${a.zipCount === 1 ? '' : 's'} · ${fmtNumber(a.orders)} ord · ${share}%`}
              loading={areaQ.isLoading}
              onClick={openDetail(areaZipConfig(a))}
            />
          );
        })}
      </div>
      {yAreas.areas.length > 5 && (
        <div className="text-center">
          <button
            type="button"
            onClick={openDetail(allAreasConfig)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-muted"
          >
            See all {fmtNumber(yAreas.areas.length)} areas →
          </button>
        </div>
      )}

      {/* ═══════════════ Top Salespersons ═══════════════ */}
      <SectionHeading
        icon={Award}
        title={`Top Salespersons · ${dateShort} · ${storeLabel}`}
        hint="By revenue on the day · sales count + total revenue"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {spQ.isLoading ? (
          <div className="col-span-1 py-6 text-center text-xs text-muted-fg sm:col-span-3">Loading…</div>
        ) : topSalespeople.length === 0 ? (
          <div className="col-span-1 py-6 text-center text-xs text-muted-fg sm:col-span-3">No salesperson sales on file for this day.</div>
        ) : topSalespeople.map((s, i) => {
          const code = String(s.salesperson || '—').trim();
          const name = resolveSp(code);
          const fullName = resolveSpFull(code);
          const spOrders = Number(s.orders) || 0;
          const spRev    = Number(s.revenue) || 0;
          const medal = [
            { grad: 'from-amber-400 to-yellow-500',  ring: 'ring-amber-500/30' },
            { grad: 'from-slate-300 to-slate-400',   ring: 'ring-slate-400/30' },
            { grad: 'from-orange-400 to-amber-600',  ring: 'ring-orange-500/30' },
          ][i] || { grad: 'from-slate-300 to-slate-400', ring: 'ring-slate-400/30' };
          return (
            <button
              key={code}
              type="button"
              onClick={openDetail({
                title: `${name} · ${dateShort} · ${storeLabel}`,
                icon: Award,
                accent: 'amber',
                headline: fmtCurrency(spRev),
                subtitle: `${fmtNumber(spOrders)} sale${spOrders === 1 ? '' : 's'} on ${dayLabel || 'the latest day'}`,
                detailsDb: 'sql',
                detailsSql: dayStr ? `
                  SELECT sd.SalesNo,
                         MAX(sd.CustomerName) AS CustomerName,
                         SUM(ISNULL(sd.SaleSplitAmt, 0)) AS amount
                  FROM SalespersonDaily sd
                  WHERE CAST(sd.SaleDate AS DATE) = '${dayStr}' AND ${spdStore}
                    AND LTRIM(RTRIM(sd.SalesPerson)) = '${code.replace(/'/g, "''")}'
                  GROUP BY sd.SalesNo
                  ORDER BY amount DESC
                ` : undefined,
                detailsColumns: [
                  { key: 'SalesNo',      label: 'Sale #' },
                  { key: 'CustomerName', label: 'Customer' },
                  { key: 'amount',       label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(Number(r.amount) || 0)}</span> },
                ],
                detailsEmpty: `No sales for ${name} on this day`,
              })}
              className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
            >
              <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-base font-extrabold text-white shadow ring-2', medal.grad, medal.ring)}>
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-bold text-fg" title={fullName}>{name}</div>
                <div className="truncate text-xs text-muted-fg">
                  {fmtNumber(spOrders)} sale{spOrders === 1 ? '' : 's'}{name !== code ? ` · ${code}` : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-extrabold tabular-nums text-fg">{fmtCurrency(spRev)}</div>
                <div className="text-[10px] uppercase tracking-wider text-muted-fg">revenue</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* ═══════════════ Top 5 vendors (yesterday) ═══════════════ */}
      <SectionHeading
        icon={Truck}
        title={`Vendor Wise Analysis · ${dateShort} · ${storeLabel}`}
        hint={topVendorsRevTotal > 0
          ? `Top 5 vendors · ${fmtCurrency(topVendorsRevTotal)} revenue · click for their item-type breakdown`
          : 'Top 5 vendors by units sold yesterday · click for their item-type breakdown'}
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {vendorQ.isLoading ? (
          <div className="col-span-2 lg:col-span-5 py-6 text-center text-xs text-muted-fg">Loading vendors…</div>
        ) : topVendors.length === 0 ? (
          <div className="col-span-2 lg:col-span-5 py-6 text-center text-xs text-muted-fg">No vendor sales yesterday</div>
        ) : topVendors.map((v, i) => {
          const vendor = String(v.vendor || '').trim();
          const vunits = Number(v.units) || 0;
          const skus   = Number(v.skus) || 0;
          const vrev   = Number(v.revenue) || 0;
          const accent = ['primary', 'emerald', 'amber', 'violet', 'sky'][i % 5];
          return (
            <HeroStat
              key={vendor}
              label={`#${i + 1} · ${vendor}`}
              value={vrev > 0 ? fmtCompactCurrency(vrev) : fmtNumber(vunits)}
              fullValue={vrev > 0 ? fmtCurrency(vrev) : null}
              icon={Truck}
              logo={vendorDomain(vendor)}
              accent={accent}
              subtitle={`${fmtNumber(vunits)} item${vunits === 1 ? '' : 's'} · ${fmtNumber(skus)} SKU${skus === 1 ? '' : 's'}`}
              loading={vendorQ.isLoading}
              onClick={openDetail({
                title: `${vendor} · Items Sold · ${dateShort} · ${storeLabel}`,
                icon: Truck,
                accent,
                headline: `${fmtNumber(vunits)} items`,
                subtitle: `By item type · Stock Item / Star-SKU · ${fmtNumber(skus)} distinct SKUs`,
                detailsDb: 'sql',
                detailsSql: `
                  WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail WHERE LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}' AND SaleDate < CAST(GETDATE() AS DATE)),
                       base AS (
                         SELECT LTRIM(RTRIM(ItemID)) AS ItemID,
                                UPPER(ISNULL(Description2,'')) AS d2
                         FROM SalesItemDetail CROSS JOIN m
                         WHERE SaleDate = m.d
                           AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
                           AND LTRIM(RTRIM(VendorID)) = '${vendor.replace(/'/g, "''")}'
                       ),
                       typed AS (
                         SELECT ${itemTypeCase} AS item_type,
                                CASE WHEN LEFT(ItemID, 1) LIKE '[0-9]' THEN 1 ELSE 0 END AS is_lineup,
                                CASE WHEN LEFT(ItemID, 1) = '*'        THEN 1 ELSE 0 END AS is_star
                         FROM base
                       )
                  SELECT item_type,
                         COUNT(*)        AS units,
                         SUM(is_lineup)  AS lineup,
                         SUM(is_star)    AS star
                  FROM typed GROUP BY item_type ORDER BY units DESC
                `,
                detailsColumns: [
                  { key: 'item_type', label: 'Item Type' },
                  { key: 'units',   label: 'Total Sold', align: 'right', render: (r) => <span className="font-semibold">{fmtNumber(r.units)}</span> },
                  { key: 'lineup',  label: 'Stock Item', align: 'right', render: (r) => r.lineup > 0 ? <span className="font-semibold text-emerald-600 dark:text-emerald-300">{fmtNumber(r.lineup)}</span> : <span className="text-muted-fg">0</span> },
                  { key: 'star',    label: 'Star SKU', align: 'right', render: (r) => r.star > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-300">{fmtNumber(r.star)}</span> : <span className="text-muted-fg">0</span> },
                ],
                detailsEmpty: `No items sold for ${vendor} yesterday`,
              })}
            />
          );
        })}
      </div>

      {/* ═══════════════ Item Sold Analysis (yesterday) ═══════════════ */}
      <SectionHeading
        icon={Package}
        title={`Item Sold Analysis · ${dateShort} · ${storeLabel}`}
        hint="Units sold by category · click a category for the item list"
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {['Living Room', 'Bedroom', 'Dining Room', 'Accessories']
          .map((key) => ROOM_RULES.find((r) => r.key === key))
          .map((room) => {
            const runits = itemCatByRoom[room.key] || 0;
            return (
              <HeroStat
                key={room.key}
                label={room.key}
                value={fmtNumber(runits)}
                icon={room.icon}
                accent={room.accent}
                subtitle={runits ? `${fmtNumber(runits)} item${runits === 1 ? '' : 's'} sold yesterday` : 'None sold yesterday'}
                loading={itemCatQ.isLoading}
                onClick={openDetail({
                  title: `${room.key} · Items Sold · ${dateShort} · ${storeLabel}`,
                  icon: room.icon,
                  accent: room.accent,
                  headline: fmtNumber(runits),
                  subtitle: `${fmtNumber(runits)} item${runits === 1 ? '' : 's'} sold · by item type · click a type to see the items`,
                  detailsDb: 'sql',
                  detailsSql: `
                    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail WHERE LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}' AND SaleDate < CAST(GETDATE() AS DATE)),
                         base AS (
                           SELECT UPPER(ISNULL(Description2,'')) AS d2
                           FROM SalesItemDetail CROSS JOIN m
                           WHERE SaleDate = m.d AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
                         ),
                         roomed AS (
                           SELECT ${itemTypeCase} AS item_type
                           FROM base
                           WHERE (${roomCase}) = '${room.key}'
                         )
                    SELECT item_type, COUNT(*) AS units
                    FROM roomed GROUP BY item_type ORDER BY units DESC
                  `,
                  detailsColumns: [
                    { key: 'item_type', label: 'Item Type' },
                    { key: 'units', label: 'Total Sold', align: 'right', render: (r) => <span className="font-semibold">{fmtNumber(Number(r.units) || 0)}</span> },
                  ],
                  detailsEmpty: `No ${room.key.toLowerCase()} items sold yesterday`,
                  onRowClick: (row) => ({
                    title: `${room.key} · ${row.item_type} · ${storeLabel}`,
                    icon: room.icon,
                    accent: room.accent,
                    headline: `${fmtNumber(Number(row.units) || 0)} ${row.item_type}`,
                    subtitle: `Individual ${row.item_type} pieces sold yesterday · same item on one sale is grouped with a Qty`,
                    detailsDb: 'sql',
                    detailsSql: `
                      WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail WHERE LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}' AND SaleDate < CAST(GETDATE() AS DATE)),
                           base AS (
                             SELECT SaleDate, SaleNo,
                                    LTRIM(RTRIM(ItemID)) AS ItemID,
                                    LTRIM(RTRIM(VendorID)) AS VendorID,
                                    LTRIM(RTRIM(ISNULL(Description2,''))) AS ItemType,
                                    UPPER(ISNULL(Description2,'')) AS d2
                             FROM SalesItemDetail CROSS JOIN m
                             WHERE SaleDate = m.d AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '${selectedBldg}'
                           ),
                           filt AS (
                             SELECT SaleDate, SaleNo, ItemID, VendorID, ItemType
                             FROM base
                             WHERE (${roomCase}) = '${room.key}'
                               AND (${itemTypeCase}) = '${String(row.item_type).replace(/'/g, "''")}'
                           )
                      SELECT MIN(SaleDate) AS SaleDate, SaleNo, ItemID, VendorID, ItemType, COUNT(*) AS Qty
                      FROM filt GROUP BY SaleNo, ItemID, VendorID, ItemType ORDER BY MIN(SaleDate) DESC
                    `,
                    detailsColumns: [
                      { key: 'SaleNo',   label: 'Sale #' },
                      { key: 'ItemID',   label: 'Item ID' },
                      { key: 'VendorID', label: 'Vendor' },
                      { key: 'ItemType', label: 'Description' },
                      { key: 'Qty',      label: 'Qty', align: 'right', render: (r) => {
                        const n = Number(r.Qty) || 1;
                        return n > 1
                          ? <span className="font-semibold text-primary">×{fmtNumber(n)}</span>
                          : <span className="text-muted-fg">1</span>;
                      }},
                    ],
                    detailsEmpty: `No ${row.item_type} sold yesterday`,
                  }),
                })}
              />
            );
          })}
      </div>

      <MetricDrilldown drilldown={drilldown} onClose={() => setDrilldown(null)} />
    </>
  );
}

// SectionHeading — local copy (keeps this view self-contained).
function SectionHeading({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-2">
      <div className="flex items-center gap-2">
        {Icon && (
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon size={15} />
          </span>
        )}
        <h2 className="text-base font-bold uppercase tracking-wider text-fg">{title}</h2>
      </div>
      {hint && <span className="hidden text-[11px] italic text-muted-fg sm:block">{hint}</span>}
    </div>
  );
}

// StatCard — a headline KPI tile (big number + caption). Styled to match
// CustomerMixTile and stretches to the row height so the KPI row reads evenly.
const STAT_ACCENTS = {
  sky:     { border: 'border-sky-500/40',    grad: 'from-sky-500 to-cyan-500',      ring: 'ring-sky-500/30',    text: 'text-sky-600 dark:text-sky-300',       wash: 'from-sky-500/15 dark:from-sky-500/20' },
  primary: { border: 'border-blue-500/40',   grad: 'from-blue-500 to-indigo-500',   ring: 'ring-blue-500/30',   text: 'text-blue-600 dark:text-blue-300',     wash: 'from-blue-500/15 dark:from-blue-500/20' },
  violet:  { border: 'border-violet-500/40', grad: 'from-violet-500 to-purple-500', ring: 'ring-violet-500/30', text: 'text-violet-600 dark:text-violet-300', wash: 'from-violet-500/15 dark:from-violet-500/20' },
  emerald: { border: 'border-emerald-500/40',grad: 'from-emerald-500 to-teal-500',  ring: 'ring-emerald-500/30',text: 'text-emerald-600 dark:text-emerald-300',wash: 'from-emerald-500/15 dark:from-emerald-500/20' },
};
function StatCard({ label, value, caption, icon: Icon, accent = 'sky', loading, onClick }) {
  const a = STAT_ACCENTS[accent] || STAT_ACCENTS.sky;
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      {...(onClick ? { type: 'button', onClick } : {})}
      className={cn(
        'group relative w-full overflow-hidden rounded-xl border bg-card p-3.5 text-left transition-all duration-200',
        a.border,
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md',
      )}
    >
      <div className={cn('absolute inset-0 bg-gradient-to-br via-transparent to-transparent opacity-80', a.wash)} />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[10px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
          {loading ? (
            <div className="mt-2 h-7 w-16 animate-pulse rounded bg-muted/50" />
          ) : (
            <>
              <div className={cn('mt-1 text-3xl font-extrabold leading-none tabular-nums', a.text)}>{value}</div>
              {caption && <div className="mt-1.5 text-[11px] font-medium text-muted-fg">{caption}</div>}
            </>
          )}
        </div>
        <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white shadow ring-2 bg-gradient-to-br', a.grad, a.ring)}>
          <Icon size={15} strokeWidth={2.25} />
        </div>
      </div>
    </Comp>
  );
}

// CustomerMixTile — total customers with a New vs Returning split bar.
function CustomerMixTile({ label, total, newCount, returning, loading, onClick }) {
  const newPct = total > 0 ? Math.round((newCount / total) * 100) : 0;
  const retPct = total > 0 ? 100 - newPct : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative h-full overflow-hidden rounded-2xl border bg-card text-left transition-all duration-300',
        'border-violet-500/40 shadow-[0_8px_30px_-12px_rgba(139,92,246,0.45)]',
        onClick && 'cursor-pointer hover:-translate-y-1 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)]',
      )}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-violet-500/20 via-violet-500/10 to-transparent opacity-90 dark:from-violet-500/25" />
      <div className="absolute -bottom-4 -right-4 opacity-[0.06] dark:opacity-[0.08]">
        <Users size={120} strokeWidth={1.5} />
      </div>
      <div className="relative p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-fg leading-tight">{label}</span>
          <div className="grid h-8 w-8 place-items-center rounded-lg shrink-0 text-white shadow-lg ring-2 bg-gradient-to-br from-violet-500 to-purple-500 ring-violet-500/30">
            <Users size={15} strokeWidth={2.25} />
          </div>
        </div>
        {loading ? (
          <div className="mt-3 h-[78px] w-full animate-pulse rounded bg-muted/50" />
        ) : (
          <>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-3xl font-extrabold leading-none tabular-nums text-violet-600 dark:text-violet-300">{fmtNumber(total)}</span>
              <span className="text-[11px] font-medium text-muted-fg">total</span>
            </div>
            <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-violet-500 transition-all" style={{ width: `${newPct}%` }} title={`New · ${newPct}%`} />
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${retPct}%` }} title={`Returning · ${retPct}%`} />
            </div>
            <div className="mt-2.5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-violet-500" />
                <span className="text-xs text-fg/80">New</span>
                <span className="ml-auto text-sm font-bold tabular-nums text-fg">{fmtNumber(newCount)}</span>
                <span className="w-9 text-right text-[10px] tabular-nums text-muted-fg">{newPct}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-emerald-500" />
                <span className="text-xs text-fg/80">Returning</span>
                <span className="ml-auto text-sm font-bold tabular-nums text-fg">{fmtNumber(returning)}</span>
                <span className="w-9 text-right text-[10px] tabular-nums text-muted-fg">{retPct}%</span>
              </div>
            </div>
          </>
        )}
      </div>
    </button>
  );
}
