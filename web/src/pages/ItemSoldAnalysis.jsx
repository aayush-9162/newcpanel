// Item Sold Analysis — a dedicated deep-dive into what actually sold.
//
// Store attribution here uses the sale-ticket prefix, LEFT(SaleNo, 1) = '1'|'2'
// (the same key SalespersonDaily uses), NOT the BLDG column. BLDG is the
// item's physical building and is 999 for ~80% of rows, so filtering on it
// badly under-counts a store's sales.
//
// Categories use the warehouse's own CAT codes (UPH, DIN, BRM, …) which are
// far more reliable than keyword matching on the description text.

import { useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { MetricDrilldown } from '@/components/MetricDrilldown';
import { useSqlQuery } from '@/lib/api';
import { fmtNumber, fmtPercent, trimStr } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Cell, PieChart, Pie, Legend,
} from 'recharts';
import {
  Boxes, Package, PackageSearch, Sofa, BedDouble, Utensils, Lamp, Truck,
  Sparkles, Layers, Star, Hash, TreePine, TrendingUp, Building2, ChevronRight, Tag,
} from 'lucide-react';

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Store & period filters compiled into SQL fragments ──────────────────────
const STORE_CLAUSE = {
  ALL: `LEFT(CAST(SaleNo AS VARCHAR(20)), 1) IN ('1', '2')`,
  S1:  `LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '1'`,
  S2:  `LEFT(CAST(SaleNo AS VARCHAR(20)), 1) = '2'`,
};
const STORE_LABEL = { ALL: 'Both Stores', S1: 'Arden (S1)', S2: 'Waynesville (S2)' };

const PERIODS = [
  { key: 'MONTH', label: 'This Month' },
  { key: 'Q',     label: 'Last 3 Months' },
  { key: 'YTD',   label: 'Year to Date' },
  { key: 'Y12',   label: 'Last 12 Months' },
  { key: 'ALL',   label: 'All Time' },
];
// All clauses are evaluated with a CTE `m` holding MAX(SaleDate) AS d.
const PERIOD_CLAUSE = {
  MONTH: `YEAR(SaleDate) = YEAR(m.d) AND MONTH(SaleDate) = MONTH(m.d)`,
  Q:     `SaleDate >= DATEADD(month, -2, DATEFROMPARTS(YEAR(m.d), MONTH(m.d), 1))`,
  YTD:   `YEAR(SaleDate) = YEAR(m.d)`,
  Y12:   `SaleDate >= DATEADD(month, -11, DATEFROMPARTS(YEAR(m.d), MONTH(m.d), 1))`,
  ALL:   `1 = 1`,
};

// ── CAT code → friendly label + room grouping + accent ──────────────────────
const CAT_META = {
  UPS: { label: 'Upholstery · Stationary', group: 'Living Room', accent: 'primary' },
  UPM: { label: 'Upholstery · Motion',     group: 'Living Room', accent: 'primary' },
  UPH: { label: 'Upholstery · Special',    group: 'Living Room', accent: 'primary' },
  LTS: { label: 'Leather · Stationary',    group: 'Living Room', accent: 'amber' },
  LTM: { label: 'Leather · Motion',        group: 'Living Room', accent: 'amber' },
  LEA: { label: 'Leather · Special',       group: 'Living Room', accent: 'amber' },
  OCC: { label: 'Occasional Tables',       group: 'Living Room', accent: 'sky' },
  ENT: { label: 'Entertainment',           group: 'Living Room', accent: 'sky' },
  DIN: { label: 'Dining',                  group: 'Dining Room', accent: 'emerald' },
  BRM: { label: 'Bedroom Furniture',       group: 'Bedroom',     accent: 'violet' },
  BED: { label: 'Mattress & Bedding',      group: 'Bedroom',     accent: 'violet' },
  SPR: { label: 'Sleep / Parts',           group: 'Bedroom',     accent: 'violet' },
  YOU: { label: 'Youth',                   group: 'Bedroom',     accent: 'violet' },
  ACC: { label: 'Accessories',             group: 'Accessories', accent: 'rose' },
  ODC: { label: 'Outdoor · Casual',        group: 'Outdoor',     accent: 'emerald' },
  ODU: { label: 'Outdoor · Upholstery',    group: 'Outdoor',     accent: 'emerald' },
  MIS: { label: 'Misc / Special Order',    group: 'Other',       accent: 'sky' },
};
const catLabel = (c) => CAT_META[trimStr(c)]?.label || (trimStr(c) || 'Uncategorized');

// Room groups → the CAT codes they roll up, for the top-level tiles + drilldown.
const ROOM_GROUPS = [
  { key: 'Living Room', icon: Sofa,      accent: 'primary', cats: ['UPS','UPM','UPH','LTS','LTM','LEA','OCC','ENT'] },
  { key: 'Bedroom',     icon: BedDouble, accent: 'violet',  cats: ['BRM','BED','SPR','YOU'] },
  { key: 'Dining Room', icon: Utensils,  accent: 'emerald', cats: ['DIN'] },
  { key: 'Accessories', icon: Lamp,      accent: 'rose',    cats: ['ACC'] },
  { key: 'Outdoor',     icon: TreePine,  accent: 'amber',   cats: ['ODC','ODU'] },
];

// Finer item-type classification (keyword on Description2). Priority order —
// first match wins (loveseat before sofa, etc.). Avoids the word "DROP" so the
// SQL guard doesn't reject the query.
const ITEM_TYPE_RULES = [
  { key: 'Loveseat',   kw: ['LOVESEAT','LOVE SEAT',' LS '] },
  { key: 'Sectional',  kw: ['SECTIONAL','WEDGE',' LAF',' RAF','ARMLESS','CORNER'] },
  { key: 'Chaise',     kw: ['CHAISE'] },
  { key: 'Sofa',       kw: ['SOFA'] },
  { key: 'Recliner',   kw: ['RECLIN',' REC ','PWR REC','REC W','GLIDER','GLDR','ROCKER'] },
  { key: 'Ottoman',    kw: ['OTTOMAN'] },
  { key: 'Stool',      kw: ['STOOL','BARSTOOL'] },
  { key: 'Chair',      kw: ['CHAIR'] },
  { key: 'Table',      kw: ['COCKTAIL','END TABLE','SOFA TABLE','CONSOLE','PEDESTAL','LEAF','TABLE'] },
  { key: 'Dresser',    kw: ['DRESSER'] },
  { key: 'Nightstand', kw: ['NIGHTSTAND','NIGHT STAND'] },
  { key: 'Chest',      kw: ['CHEST'] },
  { key: 'Bed',        kw: ['HEADBOARD','FOOTBOARD',' BED','RAILS','PANEL','DAYBED','BUNK','TRUNDLE'] },
  { key: 'Mattress',   kw: ['MATTRESS','MATT ','FOUNDATION','BOX SPRING','SLATS',' FND'] },
  { key: 'Mirror',     kw: ['MIRROR'] },
  { key: 'Server',     kw: ['BUFFET','SERVER','SIDEBOARD','CHINA'] },
  { key: 'Lamp',       kw: ['LAMP'] },
  { key: 'Rug',        kw: ['RUG'] },
  { key: 'Accessory',  kw: ['PILLOW','THROW','DECOR','CLOCK','CUSHION','ACCESSOR','PROTECTOR','BATTERY'] },
];
const ITEM_TYPE_CASE = `CASE ${ITEM_TYPE_RULES
  .map((r) => `WHEN ${r.kw.map((k) => `d2 LIKE '%${k}%'`).join(' OR ')} THEN '${r.key}'`)
  .join(' ')} ELSE 'Other' END`;

// Lineup (catalog SKU: ItemID starts with a digit) vs Star-SKU (special order:
// ItemID starts with '*').
const LINEUP_EXPR = `CASE WHEN LEFT(LTRIM(RTRIM(ItemID)), 1) LIKE '[0-9]' THEN 1 ELSE 0 END`;
const STAR_EXPR   = `CASE WHEN LEFT(LTRIM(RTRIM(ItemID)), 1) = '*' THEN 1 ELSE 0 END`;

const CHART_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#14b8a6', '#a855f7'];

export default function ItemSoldAnalysis() {
  const [store, setStore]   = useState('ALL');   // ALL | S1 | S2
  const [period, setPeriod] = useState('MONTH');
  const [drilldown, setDrilldown] = useState(null);
  const openDetail = (config) => () => setDrilldown(config);

  const storeClause = STORE_CLAUSE[store];
  const periodClause = PERIOD_CLAUSE[period];
  const periodLabel = PERIODS.find((p) => p.key === period)?.label || '';
  const scope = `${storeClause} AND ${periodClause}`;

  // ── 1) Headline KPIs ──────────────────────────────────────────────────────
  const kpiSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT COUNT(*)                       AS units,
           COUNT(DISTINCT ItemID)         AS skus,
           COUNT(DISTINCT LTRIM(RTRIM(VendorID))) AS vendors,
           SUM(${LINEUP_EXPR})            AS lineup,
           SUM(${STAR_EXPR})              AS star
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${scope}
  `;
  const kpiQ = useSqlQuery(kpiSql, []);
  const kpi = kpiQ.data?.rows?.[0] ?? {};
  const units   = Number(kpi.units)   || 0;
  const skus     = Number(kpi.skus)    || 0;
  const vendors  = Number(kpi.vendors) || 0;
  const lineup   = Number(kpi.lineup)  || 0;
  const star     = Number(kpi.star)    || 0;
  const lineupPct = units > 0 ? Math.round((lineup / units) * 100) : 0;

  // ── 2) By CAT category ────────────────────────────────────────────────────
  const catSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT CAT, COUNT(*) AS units, COUNT(DISTINCT ItemID) AS skus,
           COUNT(DISTINCT LTRIM(RTRIM(VendorID))) AS vendors
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${scope}
    GROUP BY CAT
    ORDER BY units DESC
  `;
  const catQ = useSqlQuery(catSql, []);
  const catRows = catQ.data?.rows ?? [];

  // Roll CAT rows up into room groups for the top tiles.
  const roomTotals = useMemo(() => {
    const byCat = {};
    for (const r of catRows) byCat[trimStr(r.CAT)] = Number(r.units) || 0;
    return ROOM_GROUPS.map((g) => ({
      ...g,
      units: g.cats.reduce((s, c) => s + (byCat[c] || 0), 0),
    }));
  }, [catRows]);

  // ── 3) By item type (finer keyword classification) ────────────────────────
  const typeSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail),
         base AS (
           SELECT UPPER(ISNULL(Description2, '')) AS d2
           FROM SalesItemDetail CROSS JOIN m
           WHERE ${scope}
         ),
         typed AS (SELECT ${ITEM_TYPE_CASE} AS item_type FROM base)
    SELECT item_type, COUNT(*) AS units
    FROM typed GROUP BY item_type ORDER BY units DESC
  `;
  const typeQ = useSqlQuery(typeSql, []);
  const typeRows = useMemo(
    () => (typeQ.data?.rows ?? [])
      .filter((r) => r.item_type !== 'Other')
      .slice(0, 12)
      .map((r) => ({ type: r.item_type, units: Number(r.units) || 0 })),
    [typeQ.data],
  );

  // ── 4) Top vendors ────────────────────────────────────────────────────────
  const vendorSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT TOP 12 LTRIM(RTRIM(VendorID)) AS vendor,
           COUNT(*) AS units, COUNT(DISTINCT ItemID) AS skus
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${scope}
      AND VendorID IS NOT NULL
      AND LTRIM(RTRIM(VendorID)) NOT IN ('CFC', 'USLD', 'NONE', '')
    GROUP BY LTRIM(RTRIM(VendorID))
    ORDER BY units DESC
  `;
  const vendorQ = useSqlQuery(vendorSql, []);
  const vendorRows = vendorQ.data?.rows ?? [];
  const vendorMax = vendorRows.reduce((mx, v) => Math.max(mx, Number(v.units) || 0), 0);

  // ── 5) Top selling items (SKUs) ───────────────────────────────────────────
  const itemSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT TOP 25 LTRIM(RTRIM(ItemID)) AS ItemID,
           MAX(Description2) AS descr,
           MAX(LTRIM(RTRIM(VendorID))) AS vendor,
           MAX(CAT) AS cat,
           COUNT(*) AS units
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${scope}
      AND ItemID IS NOT NULL AND LTRIM(RTRIM(ItemID)) <> ''
    GROUP BY LTRIM(RTRIM(ItemID))
    ORDER BY units DESC
  `;
  const itemQ = useSqlQuery(itemSql, []);
  const itemRows = itemQ.data?.rows ?? [];

  // ── 6) Monthly trend (last 12 months, respects store filter) ──────────────
  const trendSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT YEAR(SaleDate) AS yr, MONTH(SaleDate) AS mo, COUNT(*) AS units
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${storeClause}
      AND SaleDate >= DATEADD(month, -11, DATEFROMPARTS(YEAR(m.d), MONTH(m.d), 1))
    GROUP BY YEAR(SaleDate), MONTH(SaleDate)
    ORDER BY yr, mo
  `;
  const trendQ = useSqlQuery(trendSql, []);
  const trendData = useMemo(
    () => (trendQ.data?.rows ?? []).map((r) => ({
      label: `${MONTHS_SHORT[(Number(r.mo) || 1) - 1]} '${String(r.yr).slice(2)}`,
      units: Number(r.units) || 0,
    })),
    [trendQ.data],
  );

  // ── 7) Store comparison (always both stores, for the period) ──────────────
  const storeCmpSql = `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT LEFT(CAST(SaleNo AS VARCHAR(20)), 1) AS store,
           COUNT(*) AS units, COUNT(DISTINCT ItemID) AS skus,
           COUNT(DISTINCT LTRIM(RTRIM(VendorID))) AS vendors
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${periodClause}
      AND LEFT(CAST(SaleNo AS VARCHAR(20)), 1) IN ('1', '2')
    GROUP BY LEFT(CAST(SaleNo AS VARCHAR(20)), 1)
  `;
  const storeCmpQ = useSqlQuery(storeCmpSql, []);
  const storeCmp = useMemo(() => {
    const map = { '1': { units: 0, skus: 0, vendors: 0 }, '2': { units: 0, skus: 0, vendors: 0 } };
    for (const r of (storeCmpQ.data?.rows ?? [])) {
      map[trimStr(r.store)] = { units: Number(r.units) || 0, skus: Number(r.skus) || 0, vendors: Number(r.vendors) || 0 };
    }
    return map;
  }, [storeCmpQ.data]);

  const lineupPie = useMemo(() => ([
    { name: 'Lineup (catalog)', value: lineup },
    { name: 'Star-SKU (special order)', value: star },
  ]), [lineup, star]);

  // ── drilldown builders ────────────────────────────────────────────────────
  const itemListColumns = [
    { key: 'ItemID', label: 'Item ID' },
    { key: 'descr',  label: 'Description', render: (r) => trimStr(r.descr) || '—' },
    { key: 'vendor', label: 'Vendor' },
    { key: 'units',  label: 'Units', align: 'right', render: (r) => <span className="font-semibold">{fmtNumber(Number(r.units) || 0)}</span> },
  ];
  const itemListSql = (extraWhere) => `
    WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
    SELECT TOP 400 LTRIM(RTRIM(ItemID)) AS ItemID,
           MAX(Description2) AS descr,
           MAX(LTRIM(RTRIM(VendorID))) AS vendor,
           COUNT(*) AS units
    FROM SalesItemDetail CROSS JOIN m
    WHERE ${scope} AND ${extraWhere}
      AND ItemID IS NOT NULL AND LTRIM(RTRIM(ItemID)) <> ''
    GROUP BY LTRIM(RTRIM(ItemID))
    ORDER BY units DESC
  `;

  const openRoom = (g) => openDetail({
    title: `${g.key} · Items Sold · ${STORE_LABEL[store]}`,
    icon: g.icon, accent: g.accent,
    headline: `${fmtNumber(g.units)} units`,
    subtitle: `${periodLabel} · categories: ${g.cats.map(catLabel).join(', ')}`,
    detailsDb: 'sql',
    detailsSql: itemListSql(`CAT IN (${g.cats.map((c) => `'${c}'`).join(', ')})`),
    detailsColumns: itemListColumns,
    detailsEmpty: `No ${g.key} items sold in this period`,
  });

  const openCat = (cat, unitCount, accent) => openDetail({
    title: `${catLabel(cat)} · Items Sold · ${STORE_LABEL[store]}`,
    icon: Tag, accent,
    headline: `${fmtNumber(unitCount)} units`,
    subtitle: `${periodLabel} · CAT code "${trimStr(cat)}"`,
    detailsDb: 'sql',
    detailsSql: itemListSql(`CAT = '${trimStr(cat).replace(/'/g, "''")}'`),
    detailsColumns: itemListColumns,
    detailsEmpty: 'No items sold in this category for the period',
  });

  const openVendor = (vendor, unitCount, accent) => openDetail({
    title: `${vendor} · Items Sold · ${STORE_LABEL[store]}`,
    icon: Truck, accent,
    headline: `${fmtNumber(unitCount)} units`,
    subtitle: `${periodLabel} · split into Lineup / Star-SKU`,
    detailsDb: 'sql',
    detailsSql: `
      WITH m AS (SELECT MAX(SaleDate) AS d FROM SalesItemDetail)
      SELECT TOP 400 LTRIM(RTRIM(ItemID)) AS ItemID,
             MAX(Description2) AS descr,
             MAX(CAT) AS cat,
             MAX(CASE WHEN LEFT(LTRIM(RTRIM(ItemID)), 1) = '*' THEN 'Star-SKU' ELSE 'Lineup' END) AS kind,
             COUNT(*) AS units
      FROM SalesItemDetail CROSS JOIN m
      WHERE ${scope} AND LTRIM(RTRIM(VendorID)) = '${vendor.replace(/'/g, "''")}'
      GROUP BY LTRIM(RTRIM(ItemID))
      ORDER BY units DESC
    `,
    detailsColumns: [
      { key: 'ItemID', label: 'Item ID' },
      { key: 'descr',  label: 'Description', render: (r) => trimStr(r.descr) || '—' },
      { key: 'cat',    label: 'Category', render: (r) => catLabel(r.cat) },
      { key: 'kind',   label: 'Type', render: (r) => (
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold',
          r.kind === 'Star-SKU'
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200')}>
          {r.kind}
        </span>
      )},
      { key: 'units',  label: 'Units', align: 'right', render: (r) => <span className="font-semibold">{fmtNumber(Number(r.units) || 0)}</span> },
    ],
    detailsEmpty: `No items sold for ${vendor} this period`,
  });

  const loading = kpiQ.isLoading;
  const catMax = catRows.reduce((mx, r) => Math.max(mx, Number(r.units) || 0), 0);

  return (
    <>
      <Topbar title="Item Sold Analysis" subtitle={`${STORE_LABEL[store]} · ${periodLabel}`} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* ═══════════ Filters ═══════════ */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Store</span>
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {[['ALL', 'Both'], ['S1', 'S1 · Arden'], ['S2', 'S2 · Waynesville']].map(([v, label]) => (
                <Pill key={v} active={store === v} onClick={() => setStore(v)}>{label}</Pill>
              ))}
            </div>
            <div className="h-6 w-px bg-border" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Period</span>
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {PERIODS.map((p) => (
                <Pill key={p.key} active={period === p.key} onClick={() => setPeriod(p.key)}>{p.label}</Pill>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ═══════════ Hero ═══════════ */}
        <HeroBanner icon={PackageSearch} decorIcon={Boxes} accent="primary">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
            {STORE_LABEL[store]} · {periodLabel} · Units Sold
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-blue-600 to-indigo-500 bg-clip-text text-transparent">
              {loading ? '…' : fmtNumber(units)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
              <Package size={14} /> {fmtNumber(skus)} SKUs
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
              <Truck size={14} /> {fmtNumber(vendors)} vendors
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{fmtNumber(lineup)}</strong> catalog (lineup) · <strong className="text-fg">{fmtNumber(star)}</strong> special-order (★ SKU) · {lineupPct}% from the lineup
          </div>
        </HeroBanner>

        {/* ═══════════ KPI strip ═══════════ */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat label="Total Units Sold" value={fmtNumber(units)} icon={Boxes} accent="primary"
            subtitle={`${STORE_LABEL[store]} · ${periodLabel}`} loading={loading} />
          <HeroStat label="Distinct SKUs" value={fmtNumber(skus)} icon={Package} accent="sky"
            subtitle={units ? `${(units / Math.max(skus, 1)).toFixed(1)} units per SKU avg` : null} loading={loading} />
          <HeroStat label="Vendors Sold" value={fmtNumber(vendors)} icon={Truck} accent="emerald"
            subtitle="Distinct suppliers with a sale" loading={loading} />
          <HeroStat label="Lineup vs ★ SKU"
            value={<span className="inline-flex items-baseline gap-1.5">
              <span className="text-emerald-600 dark:text-emerald-400">{fmtNumber(lineup)}</span>
              <span className="text-muted-fg/70 text-base font-normal">/</span>
              <span className="text-amber-600 dark:text-amber-400">{fmtNumber(star)}</span>
            </span>}
            icon={Star} accent="amber" subtitle={`${lineupPct}% catalog · ${100 - lineupPct}% special order`} loading={loading} />
        </div>

        {/* ═══════════ Room groups ═══════════ */}
        <SectionHeading icon={Layers} title="By Room" hint="Category codes rolled up into showrooms · click for the item list" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {roomTotals.map((g) => (
            <HeroStat key={g.key} label={g.key} value={fmtNumber(g.units)} icon={g.icon} accent={g.accent}
              subtitle={g.units ? `${fmtNumber(g.units)} unit${g.units === 1 ? '' : 's'} · ${periodLabel}` : 'None this period'}
              loading={catQ.isLoading} onClick={openRoom(g)} />
          ))}
        </div>

        {/* ═══════════ Category (CAT) breakdown ═══════════ */}
        <SectionHeading icon={Sparkles} title="By Category" hint="Warehouse CAT codes · click a bar to see the items" />
        <Card>
          <CardContent className="flex flex-col gap-1.5 p-4">
            {catQ.isLoading ? (
              <div className="py-8 text-center text-xs text-muted-fg">Loading categories…</div>
            ) : catRows.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-fg">No items sold in this period</div>
            ) : catRows.map((r) => {
              const u = Number(r.units) || 0;
              const meta = CAT_META[trimStr(r.CAT)] || { accent: 'sky' };
              const pct = catMax > 0 ? (u / catMax) * 100 : 0;
              const share = units > 0 ? (u / units) * 100 : 0;
              return (
                <button key={trimStr(r.CAT) || 'none'} type="button" onClick={openCat(r.CAT, u, meta.accent)}
                  className="group grid grid-cols-[minmax(140px,190px)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/50">
                  <span className="flex items-center gap-2 truncate text-sm font-medium" title={catLabel(r.CAT)}>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-fg">{trimStr(r.CAT) || '—'}</span>
                    <span className="truncate">{catLabel(r.CAT)}</span>
                  </span>
                  <span className="relative h-5 overflow-hidden rounded bg-muted/50">
                    <span className={cn('absolute inset-y-0 left-0 rounded transition-all', BAR_BG[meta.accent] || BAR_BG.sky)} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-sm font-bold">{fmtNumber(u)}</span>
                    <span className="w-12 text-right text-[11px] text-muted-fg">{fmtPercent(share, 0)}</span>
                    <ChevronRight size={13} className="text-muted-fg opacity-0 transition group-hover:opacity-100" />
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* ═══════════ Item type + Lineup/Star ═══════════ */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Hash size={16} className="text-primary" /> By Item Type</CardTitle>
              <CardDescription>Finer than category — sofas vs loveseats vs recliners, this period</CardDescription>
            </CardHeader>
            <CardContent>
              {typeQ.isLoading ? (
                <div className="py-8 text-center text-xs text-muted-fg">Loading…</div>
              ) : typeRows.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-fg">No classified items this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(220, typeRows.length * 30)}>
                  <BarChart data={typeRows} layout="vertical" margin={{ left: 10, right: 24, top: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 11 }} className="text-muted-fg" />
                    <YAxis type="category" dataKey="type" width={90} tick={{ fontSize: 12 }} className="text-muted-fg" />
                    <RTooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }} formatter={(v) => [fmtNumber(v), 'units']} />
                    <Bar dataKey="units" radius={[0, 6, 6, 0]}>
                      {typeRows.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Star size={16} className="text-amber-500" /> Lineup vs Star-SKU</CardTitle>
              <CardDescription>Catalog SKUs vs special orders</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-8 text-center text-xs text-muted-fg">Loading…</div>
              ) : units === 0 ? (
                <div className="py-8 text-center text-xs text-muted-fg">No items this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={lineupPie} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      <Cell fill="#10b981" />
                      <Cell fill="#f59e0b" />
                    </Pie>
                    <RTooltip formatter={(v, n) => [fmtNumber(v), n]} contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }} />
                    <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ═══════════ Top vendors ═══════════ */}
        <SectionHeading icon={Truck} title="Top Vendors" hint="By units sold this period · click a vendor for its items" />
        <Card>
          <CardContent className="grid grid-cols-1 gap-1.5 p-4 md:grid-cols-2">
            {vendorQ.isLoading ? (
              <div className="col-span-full py-8 text-center text-xs text-muted-fg">Loading vendors…</div>
            ) : vendorRows.length === 0 ? (
              <div className="col-span-full py-8 text-center text-xs text-muted-fg">No vendor sales this period</div>
            ) : vendorRows.map((v, i) => {
              const u = Number(v.units) || 0;
              const vn = trimStr(v.vendor);
              const accent = ['primary', 'emerald', 'amber', 'violet', 'sky', 'rose'][i % 6];
              const pct = vendorMax > 0 ? (u / vendorMax) * 100 : 0;
              return (
                <button key={vn} type="button" onClick={openVendor(vn, u, accent)}
                  className="group grid grid-cols-[24px_minmax(70px,100px)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-muted/50">
                  <span className="text-xs font-bold tabular-nums text-muted-fg">{i + 1}</span>
                  <span className="truncate text-sm font-semibold" title={vn}>{vn}</span>
                  <span className="relative h-5 overflow-hidden rounded bg-muted/50">
                    <span className={cn('absolute inset-y-0 left-0 rounded transition-all', BAR_BG[accent] || BAR_BG.sky)} style={{ width: `${Math.max(pct, 2)}%` }} />
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    <span className="text-sm font-bold">{fmtNumber(u)}</span>
                    <span className="w-14 text-right text-[11px] text-muted-fg">{fmtNumber(Number(v.skus) || 0)} SKUs</span>
                    <ChevronRight size={13} className="text-muted-fg opacity-0 transition group-hover:opacity-100" />
                  </span>
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* ═══════════ Monthly trend + Store comparison ═══════════ */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp size={16} className="text-primary" /> Units Sold · Last 12 Months</CardTitle>
              <CardDescription>{STORE_LABEL[store]} · monthly unit volume</CardDescription>
            </CardHeader>
            <CardContent>
              {trendQ.isLoading ? (
                <div className="py-8 text-center text-xs text-muted-fg">Loading trend…</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={trendData} margin={{ left: 0, right: 8, top: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} className="text-muted-fg" />
                    <YAxis tick={{ fontSize: 11 }} className="text-muted-fg" width={40} />
                    <RTooltip cursor={{ fill: 'rgba(148,163,184,0.12)' }} contentStyle={{ borderRadius: 12, border: '1px solid hsl(var(--border))', background: 'hsl(var(--card))', fontSize: 12 }} formatter={(v) => [fmtNumber(v), 'units']} />
                    <Bar dataKey="units" fill="#3b82f6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 size={16} className="text-primary" /> Store Comparison</CardTitle>
              <CardDescription>Both stores · {periodLabel}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {[['1', 'Arden', 'S1', 'primary'], ['2', 'Waynesville', 'S2', 'emerald']].map(([k, name, tag, accent]) => {
                const s = storeCmp[k] || { units: 0, skus: 0, vendors: 0 };
                const total = (storeCmp['1']?.units || 0) + (storeCmp['2']?.units || 0);
                const share = total > 0 ? (s.units / total) * 100 : 0;
                return (
                  <div key={k} className="rounded-xl border border-border bg-muted/30 p-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-[11px] font-bold text-primary">{tag}</span>
                        <span className="font-semibold">{name}</span>
                      </div>
                      <span className="text-xl font-extrabold tabular-nums">{fmtNumber(s.units)}</span>
                    </div>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                      <span className={cn('block h-full rounded-full', BAR_BG[accent])} style={{ width: `${share}%` }} />
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-fg">
                      {fmtPercent(share, 0)} of units · {fmtNumber(s.skus)} SKUs · {fmtNumber(s.vendors)} vendors
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>

        {/* ═══════════ Top selling items ═══════════ */}
        <SectionHeading icon={Package} title="Top Selling Items" hint={`Best-selling SKUs · ${periodLabel}`} />
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="border-b border-border">
                    <th className="w-8 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">#</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Item ID</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Description</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Vendor</th>
                    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Category</th>
                    <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Units</th>
                  </tr>
                </thead>
                <tbody>
                  {itemQ.isLoading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-fg">Loading items…</td></tr>
                  ) : itemRows.length === 0 ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-fg">No items sold this period</td></tr>
                  ) : itemRows.map((r, i) => (
                    <tr key={trimStr(r.ItemID) + i} className="border-b border-border last:border-0 hover:bg-muted/30">
                      <td className="px-3 py-2 text-xs font-bold tabular-nums text-muted-fg">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {trimStr(r.ItemID)}
                        {trimStr(r.ItemID).startsWith('*') && <span className="ml-1 text-amber-500" title="Star / special-order SKU">★</span>}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2" title={trimStr(r.descr)}>{trimStr(r.descr) || '—'}</td>
                      <td className="px-3 py-2">{trimStr(r.vendor) || '—'}</td>
                      <td className="px-3 py-2 text-xs text-muted-fg">{catLabel(r.cat)}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{fmtNumber(Number(r.units) || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <MetricDrilldown drilldown={drilldown} onClose={() => setDrilldown(null)} />
    </>
  );
}

// Solid bar-fill classes keyed by accent (for the horizontal bar lists).
const BAR_BG = {
  primary: 'bg-blue-500',
  emerald: 'bg-emerald-500',
  amber:   'bg-amber-500',
  violet:  'bg-violet-500',
  sky:     'bg-sky-500',
  rose:    'bg-rose-500',
};

function Pill({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded-md px-3 py-1 text-xs font-medium transition outline-none',
        active ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:bg-muted hover:text-fg')}>
      {children}
    </button>
  );
}

function SectionHeading({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-1">
      <div className="flex items-center gap-2">
        {Icon && <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><Icon size={15} /></span>}
        <h2 className="text-sm font-bold uppercase tracking-wider text-fg">{title}</h2>
      </div>
      {hint && <span className="text-[11px] text-muted-fg italic" title={hint}>{hint}</span>}
    </div>
  );
}
