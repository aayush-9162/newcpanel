// Faithful clone of /auth/gmr (and /auth/grossMarginReport).
//
// Layout mirrors the Bootstrap original:
//   [GM% radio: <55% / ≥55%]   [Show Graph]  [Year]  [Month]  [Week]  [SalesPerson]
//   ── Summary (by primary salesperson, weekly margin columns + total)
//   ── Details (individual records, exportable)
//
// Data source: MS SQL `SalesGrossMarginDetail` (CFC_AUTO_DB).
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useSqlQuery } from '@/lib/api';
import { fmtCurrency, fmtPercent, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import { cn } from '@/lib/cn';
import { DollarSign, Receipt, TrendingDown, TrendingUp, Percent, BarChart3, Download, X, PieChart } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip, CartesianGrid } from 'recharts';

const MONTHS = [
  { num: 1, name: 'January' }, { num: 2, name: 'February' }, { num: 3, name: 'March' },
  { num: 4, name: 'April' }, { num: 5, name: 'May' }, { num: 6, name: 'June' },
  { num: 7, name: 'July' }, { num: 8, name: 'August' }, { num: 9, name: 'September' },
  { num: 10, name: 'October' }, { num: 11, name: 'November' }, { num: 12, name: 'December' },
];

// Group raw detail rows by PrimarySalesPerson into a 4-week summary.
// Each weekly cell is the margin LOSS (LossOfMargin) when GM% < 55%, or
// margin GAIN (SaleAmt - TotalCost) when GM% ≥ 55%.
//
// Week buckets are by day-of-month (matching the original cpanel):
//   Days 1–7 → Week 1, 8–14 → Week 2, 15–21 → Week 3, 22–31 → Week 4.
// (SaleWeek in the source is week-of-year, not week-of-month, so we can't
// use it directly.)
function dayToWeekOfMonth(dom) {
  if (dom <= 7)  return 1;
  if (dom <= 14) return 2;
  if (dom <= 21) return 3;
  return 4;
}

function buildSummary(rows, gmFilter) {
  const isLoss = gmFilter === 'less';
  const byPerson = new Map();

  for (const r of rows) {
    const sp = (r.PrimarySalesPerson || r.SalesPerson || '—').toString().trim();
    const d = r.SaleDate ? new Date(r.SaleDate) : null;
    const dom = d && !isNaN(d) ? d.getUTCDate() : null;
    const wk = dom ? dayToWeekOfMonth(dom) : null;

    const lom = Number(r.LossOfMargin) || 0;
    const sale = Number(r.SaleAmt) || 0;
    const cost = Number(r.TotalCost) || 0;
    const gm = sale - cost;
    const value = isLoss ? lom : gm;

    if (!byPerson.has(sp)) {
      byPerson.set(sp, {
        PrimarySalesPerson: sp,
        'WEEK #1': 0, 'WEEK #2': 0, 'WEEK #3': 0, 'WEEK #4': 0,
        Total: 0, Margin: 0,
      });
    }
    const row = byPerson.get(sp);
    if (wk) row[`WEEK #${wk}`] += value;
    row.Total += value;
    row.Margin += isLoss ? -lom : gm;
  }

  const out = Array.from(byPerson.values()).sort((a, b) =>
    isLoss ? b.Total - a.Total : b.Total - a.Total
  );

  // Grand total row
  if (out.length) {
    const total = {
      PrimarySalesPerson: 'Grand Total',
      'WEEK #1': 0, 'WEEK #2': 0, 'WEEK #3': 0, 'WEEK #4': 0,
      Total: 0, Margin: 0,
      _grand: true,
    };
    for (const r of out) {
      total['WEEK #1'] += r['WEEK #1'];
      total['WEEK #2'] += r['WEEK #2'];
      total['WEEK #3'] += r['WEEK #3'];
      total['WEEK #4'] += r['WEEK #4'];
      total.Total += r.Total;
      total.Margin += r.Margin;
    }
    out.push(total);
  }
  return out;
}

// Highlight current week column based on day-of-month bucketing (matches original)
function currentWeekIdx() {
  const d = new Date().getDate();
  if (d <= 8) return 1;
  if (d <= 14) return 2;
  if (d <= 21) return 3;
  return 4;
}

export default function GrossMargin() {
  // Distinct years from SalesGrossMarginDetail
  const yearsQ = useSqlQuery(
    `SELECT DISTINCT YEAR(SaleDate) AS y FROM SalesGrossMarginDetail WHERE SaleDate IS NOT NULL ORDER BY y DESC`,
    [],
  );
  const years = yearsQ.data?.rows.map((r) => Number(r.y)) ?? [];

  const [year, setYear] = useState(null);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [week, setWeek] = useState('');         // '' = ALL
  const [sp, setSp] = useState('');             // '' = ALL
  const [gmFilter, setGmFilter] = useState('less'); // 'less' (<55) or 'greater' (>=55)
  const [showGraph, setShowGraph] = useState(false);

  useEffect(() => {
    if (year == null && years.length) setYear(years[0]);
  }, [year, years]);

  // ── filters → SQL clauses
  const monthClause = `AND MONTH(SaleDate) = ${Number(month)}`;
  // Week filter uses week-of-month (1-4) based on day-of-month, matching the
  // WEEK #1-4 columns shown in the summary table.
  const WEEK_RANGES = { 1: [1, 7], 2: [8, 14], 3: [15, 21], 4: [22, 31] };
  const weekClause = week && WEEK_RANGES[week]
    ? `AND DAY(SaleDate) BETWEEN ${WEEK_RANGES[week][0]} AND ${WEEK_RANGES[week][1]}`
    : '';
  const spClause = sp
    ? `AND (PrimarySalesPerson = '${sp.replace(/'/g, "''")}' OR SalesPerson = '${sp.replace(/'/g, "''")}')`
    : '';
  const gmClause = gmFilter === 'less' ? 'AND ISNULL(GMarginPct, 0) < 55' : 'AND ISNULL(GMarginPct, 0) >= 55';

  const baseWhere = year
    ? `WHERE YEAR(SaleDate) = ${year} ${monthClause} ${weekClause} ${spClause} ${gmClause}`
    : '';

  // ── KPIs (top-level summary)
  const kpiSql = year
    ? `SELECT COUNT(*) AS records,
              ISNULL(SUM(SaleAmt), 0)       AS saleSum,
              ISNULL(SUM(TotalCost), 0)     AS costSum,
              ISNULL(SUM(LossOfMargin), 0)  AS lossSum,
              ISNULL(AVG(GMarginPct), 0)    AS avgGmPct
       FROM SalesGrossMarginDetail
       ${baseWhere}`
    : '';
  const kpi = useSqlQuery(kpiSql, [], { enabled: !!year });
  const k = kpi.data?.rows[0];
  const grossProfit = (Number(k?.saleSum) || 0) - (Number(k?.costSum) || 0);
  const grossPct = k?.saleSum ? (grossProfit / Number(k.saleSum)) * 100 : null;

  // ── Details (raw rows)
  const detailSql = year
    ? `SELECT TOP 2000 SaleWeek, SaleDate, MonthYear, SalesNo, CustomerId, CustomerName,
              SaleAmt, TotalCost, GMarginPct, LossOfMargin, SalesPerson, PrimarySalesPerson
       FROM SalesGrossMarginDetail
       ${baseWhere}
       ORDER BY SaleDate DESC`
    : '';
  const details = useSqlQuery(detailSql, [], { enabled: !!year });
  const rows = details.data?.rows ?? [];

  // ── Distinct salesperson list (for filter dropdown), tied to year+month
  const spListSql = year
    ? `SELECT DISTINCT PrimarySalesPerson AS sp
       FROM SalesGrossMarginDetail
       WHERE YEAR(SaleDate) = ${year} AND MONTH(SaleDate) = ${Number(month)}
         AND PrimarySalesPerson IS NOT NULL AND LTRIM(RTRIM(PrimarySalesPerson)) <> ''
       ORDER BY PrimarySalesPerson`
    : '';
  const spListQ = useSqlQuery(spListSql, [], { enabled: !!year });
  const spList = spListQ.data?.rows.map((r) => r.sp).filter(Boolean) ?? [];

  // Week dropdown — fixed buckets 1..4 (week-of-month), matches the summary columns.
  const weekList = [1, 2, 3, 4];

  // ── Summary aggregation (client-side, from `rows`)
  const summary = useMemo(() => buildSummary(rows, gmFilter), [rows, gmFilter]);
  const cw = currentWeekIdx();

  // ── chart data (exclude grand total, sort by Margin)
  const chartData = useMemo(
    () =>
      summary
        .filter((r) => !r._grand)
        .map((r) => ({ name: r.PrimarySalesPerson, margin: Math.abs(r.Margin) }))
        .sort((a, b) => b.margin - a.margin)
        .slice(0, 20),
    [summary],
  );

  // ── Details columns (with custom renderers)
  const detailCols = useMemo(
    () => [
      { id: 'SaleWeek', accessorKey: 'SaleWeek', header: 'Week',
        cell: ({ getValue }) => <span className="font-semibold text-center block">{getValue() ?? '—'}</span> },
      { id: 'SaleDate', accessorKey: 'SaleDate', header: 'Dated',
        cell: ({ getValue }) => {
          const v = getValue();
          if (!v) return <span className="text-muted-fg">—</span>;
          const d = new Date(v);
          return isNaN(d) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
        } },
      { id: 'SalesNo',     accessorKey: 'SalesNo',     header: 'Sale #' },
      { id: 'CustomerId',  accessorKey: 'CustomerId',  header: 'Cust ID' },
      { id: 'CustomerName',accessorKey: 'CustomerName',header: 'Customer' },
      { id: 'SaleAmt',     accessorKey: 'SaleAmt',     header: 'Sale Amt',
        cell: ({ getValue }) => fmtCurrency(getValue(), true) },
      { id: 'TotalCost',   accessorKey: 'TotalCost',   header: 'Total Cost',
        cell: ({ getValue }) => fmtCurrency(getValue(), true) },
      { id: 'GMarginPct',  accessorKey: 'GMarginPct',  header: 'GM %',
        cell: ({ getValue }) => {
          const v = Number(getValue()) || 0;
          return <span className={v < 55 ? 'text-danger font-semibold' : 'text-success font-semibold'}>{v.toFixed(2)}%</span>;
        } },
      { id: 'LossOfMargin',accessorKey: 'LossOfMargin',header: 'Loss of Margin',
        cell: ({ getValue }) => <span className="text-danger">{fmtCurrency(getValue(), true)}</span> },
      { id: 'PrimarySalesPerson', accessorKey: 'PrimarySalesPerson', header: 'Primary SP' },
      { id: 'SalesPerson',        accessorKey: 'SalesPerson',        header: 'Sales Person' },
    ],
    [],
  );

  const monthName = MONTHS.find((m) => m.num === Number(month))?.name || '';
  const subtitle = `${year ?? '…'} · ${monthName}${week ? ` · Week ${week}` : ''}${sp ? ` · ${sp}` : ''} · GM ${gmFilter === 'less' ? '< 55%' : '≥ 55%'}`;

  return (
    <>
      <Topbar title="Gross Margin Report" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* Filter Bar */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              <Button
                size="sm"
                variant={gmFilter === 'less' ? 'primary' : 'ghost'}
                onClick={() => setGmFilter('less')}
                title="Records with GM% below 55"
              >
                {'< 55%'}
              </Button>
              <Button
                size="sm"
                variant={gmFilter === 'greater' ? 'primary' : 'ghost'}
                onClick={() => setGmFilter('greater')}
                title="Records with GM% at or above 55"
              >
                {'≥ 55%'}
              </Button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowGraph(true)}
              title="View employee margin chart"
              disabled={!chartData.length}
            >
              <BarChart3 size={14} /> Show Graph
            </Button>

            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
                Year
                <Select
                  value={year ?? ''}
                  onChange={(e) => { setYear(Number(e.target.value)); setSp(''); setWeek(''); }}
                  className="w-28"
                >
                  {years.map((y) => <option key={y} value={y}>{y}</option>)}
                </Select>
              </label>

              <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
                Month
                <Select
                  value={month}
                  onChange={(e) => { setMonth(Number(e.target.value)); setSp(''); setWeek(''); }}
                  className="w-36"
                >
                  {MONTHS.map((m) => <option key={m.num} value={m.num}>{m.name}</option>)}
                </Select>
              </label>

              <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
                Week
                <Select value={week} onChange={(e) => setWeek(e.target.value)} className="w-24">
                  <option value="">ALL</option>
                  {weekList.map((w) => <option key={w} value={w}>{w}</option>)}
                </Select>
              </label>

              <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
                SalesPerson
                <Select value={sp} onChange={(e) => setSp(e.target.value)} className="w-40">
                  <option value="">ALL</option>
                  {spList.map((p) => <option key={p} value={p}>{p}</option>)}
                </Select>
              </label>

              <Button
                variant="outline"
                size="sm"
                onClick={() => rowsToCSV(rows, `gross-margin-${year}-${monthName}.csv`)}
                disabled={!rows.length}
              >
                <Download size={14} /> Export
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Hero banner */}
        <HeroBanner icon={PieChart} decorIcon={TrendingUp} accent={grossPct == null ? 'primary' : grossPct >= 55 ? 'emerald' : 'amber'}>
          <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">
            Gross Margin Performance
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className={cn(
              'text-5xl font-extrabold tabular-nums tracking-tight bg-clip-text text-transparent bg-gradient-to-br',
              grossPct == null ? 'from-blue-600 to-indigo-500'
              : grossPct >= 55 ? 'from-emerald-600 to-teal-500'
              : 'from-amber-600 to-orange-500',
            )}>
              {fmtPercent(grossPct)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-blue-500 to-indigo-500 text-white">
              <DollarSign size={14} /> {fmtCompactCurrency(grossProfit)} profit
            </span>
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{fmtNumber(k?.records)}</strong> records · <strong className="text-fg">{fmtCompactCurrency(k?.saleSum)}</strong> sales
            {k?.lossSum > 0 && <> · <strong className="text-rose-600 dark:text-rose-400">{fmtCompactCurrency(k.lossSum)}</strong> margin lost</>}
          </div>
        </HeroBanner>

        {/* KPI strip */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <HeroStat
            label="Records"
            value={fmtNumber(k?.records)}
            icon={Receipt}
            accent="primary"
            subtitle="Sales in this period"
            loading={kpi.isLoading}
          />
          <HeroStat
            label="Sales Total"
            value={fmtCompactCurrency(k?.saleSum)}
            fullValue={fmtCurrency(k?.saleSum)}
            icon={DollarSign}
            accent="sky"
            subtitle="Total revenue"
            loading={kpi.isLoading}
          />
          <HeroStat
            label="Gross Profit"
            value={fmtCompactCurrency(grossProfit)}
            fullValue={fmtCurrency(grossProfit)}
            icon={TrendingUp}
            accent="emerald"
            subtitle="After cost of goods"
            loading={kpi.isLoading}
          />
          <HeroStat
            label="Avg GM %"
            value={fmtPercent(grossPct)}
            icon={Percent}
            accent={grossPct == null ? 'primary' : grossPct >= 55 ? 'emerald' : 'amber'}
            urgent={grossPct != null && grossPct < 40}
            subtitle={grossPct == null ? null : grossPct >= 55 ? 'Healthy margin' : 'Below 55% target'}
            loading={kpi.isLoading}
          />
          <HeroStat
            label="Loss of Margin"
            value={fmtCompactCurrency(k?.lossSum)}
            fullValue={fmtCurrency(k?.lossSum)}
            icon={TrendingDown}
            accent="rose"
            urgent={k?.lossSum > 0}
            subtitle="Margin lost on under-target sales"
            loading={kpi.isLoading}
          />
        </div>

        {/* Summary (by primary salesperson, weekly columns) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-primary">Summary</CardTitle>
            <CardDescription>
              By primary salesperson · Click a week to drill down · Current week highlighted
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-3">
            <div className="overflow-x-auto px-5">
              <table className="w-full text-sm">
                <thead className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider">Primary Sales Person</th>
                    {[1, 2, 3, 4].map((w) => (
                      <th
                        key={w}
                        onClick={() => setWeek(String(w))}
                        className={[
                          'px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition',
                          w === cw ? 'bg-emerald-200/60 dark:bg-emerald-800/40' : '',
                        ].join(' ')}
                        title={`Filter to week ${w}`}
                      >
                        WEEK #{w}
                      </th>
                    ))}
                    <th className="px-3 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider">Total</th>
                    <th className="px-3 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {!summary.length ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-8 text-center text-muted-fg">
                        {details.isLoading ? 'Loading…' : 'No records found'}
                      </td>
                    </tr>
                  ) : (
                    summary.map((r) => (
                      <tr
                        key={r.PrimarySalesPerson}
                        className={[
                          'border-b border-border transition hover:bg-muted/40',
                          r._grand ? 'bg-sky-50 dark:bg-sky-950/30 font-bold' : '',
                        ].join(' ')}
                      >
                        <td
                          className={[
                            'px-3 py-2.5 text-left',
                            !r._grand ? 'cursor-pointer text-primary hover:underline' : '',
                          ].join(' ')}
                          onClick={() => !r._grand && setSp(r.PrimarySalesPerson)}
                          title={!r._grand ? 'Filter to this salesperson' : undefined}
                        >
                          {r.PrimarySalesPerson}
                        </td>
                        {[1, 2, 3, 4].map((w) => (
                          <td
                            key={w}
                            className={[
                              'px-3 py-2.5 text-center num',
                              w === cw ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : '',
                            ].join(' ')}
                          >
                            {r[`WEEK #${w}`] ? fmtCurrency(r[`WEEK #${w}`]) : <span className="text-muted-fg">—</span>}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-center num">{fmtCurrency(r.Total)}</td>
                        <td className={[
                          'px-3 py-2.5 text-right num',
                          gmFilter === 'less' ? 'text-danger' : 'text-success',
                        ].join(' ')}>
                          {fmtCurrency(r.Margin, true)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-primary">Details</CardTitle>
            <CardDescription>
              Up to 2,000 records · Use the filter to narrow further
            </CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <DataTable data={rows} columns={detailCols} loading={details.isLoading} pageSize={50} />
          </CardContent>
        </Card>
      </div>

      {/* Graph Modal */}
      {showGraph && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={() => setShowGraph(false)}
        >
          <div
            className="relative w-[min(95vw,1100px)] max-h-[85vh] overflow-auto rounded-2xl border border-border bg-card p-6 shadow-2xl animate-fade-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">Employee Sales Margin — {monthName} {year}</h3>
                <p className="text-xs text-muted-fg">
                  {gmFilter === 'less' ? 'Loss of margin' : 'Margin earned'} per primary salesperson · Top 20
                </p>
              </div>
              <Button variant="outline" size="icon" onClick={() => setShowGraph(false)}>
                <X size={16} />
              </Button>
            </div>
            <div style={{ height: 460 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 24, left: 12, bottom: 70 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="name"
                    angle={-35}
                    textAnchor="end"
                    interval={0}
                    height={70}
                    tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                  />
                  <YAxis
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }}
                  />
                  <RTooltip
                    formatter={(v) => fmtCurrency(v, true)}
                    contentStyle={{
                      background: 'hsl(var(--card))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: 8,
                    }}
                  />
                  <Bar
                    dataKey="margin"
                    fill={gmFilter === 'less' ? '#e11d48' : '#059669'}
                    radius={[6, 6, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
