// Individual salesperson — pick from dropdown, see their monthly revenue chart.
import { useState, useEffect, useMemo } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { KpiCard } from '@/components/KpiCard';
import { useSqlQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompact } from '@/lib/format';
import { DollarSign, ShoppingCart, TrendingUp } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';

export default function SalesPerformanceEmployee() {
  const peopleQ = useSqlQuery(
    `SELECT DISTINCT SalesPerson AS name FROM SalespersonDaily WHERE SalesPerson IS NOT NULL AND LTRIM(RTRIM(SalesPerson)) <> '' ORDER BY SalesPerson`,
    [],
  );
  const people = peopleQ.data?.rows ?? [];
  const [name, setName] = useState('');
  useEffect(() => { if (!name && people.length) setName(people[0].name); }, [name, people]);

  const today = new Date();
  const year = today.getFullYear();
  const sql = `SELECT MONTH(SaleDate) AS m, SUM(SaleSplitAmt) AS revenue, COUNT(DISTINCT SalesNo) AS orders
               FROM SalespersonDaily
               WHERE SalesPerson = ? AND YEAR(SaleDate) = ${year}
               GROUP BY MONTH(SaleDate) ORDER BY m`;
  const { data, isLoading } = useSqlQuery(sql, [name], { enabled: !!name });
  const monthRows = data?.rows ?? [];
  const monthly = useMemo(() => {
    const arr = Array.from({ length: 12 }, (_, i) => ({ month: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][i], revenue: 0, orders: 0 }));
    monthRows.forEach((r) => {
      const i = Number(r.m) - 1;
      if (i >= 0 && i < 12) { arr[i].revenue = Number(r.revenue) || 0; arr[i].orders = Number(r.orders) || 0; }
    });
    return arr;
  }, [monthRows]);

  const totals = useMemo(() => monthly.reduce((acc, r) => ({ revenue: acc.revenue + r.revenue, orders: acc.orders + r.orders }), { revenue: 0, orders: 0 }), [monthly]);

  return (
    <>
      <Topbar title="Individual Performance" subtitle={`${name || '…'} · ${year}`} />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="text-xs uppercase tracking-wider text-muted-fg">Salesperson</span>
            <Select value={name} onChange={(e) => setName(e.target.value)} className="w-72" disabled={peopleQ.isLoading}>
              <option value="">Select…</option>
              {people.map((p) => <option key={p.name} value={p.name}>{(p.name || '').toString().trim()}</option>)}
            </Select>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KpiCard label="YTD Revenue" value={fmtCurrency(totals.revenue)} icon={DollarSign} tone="success" loading={isLoading} />
          <KpiCard label="YTD Orders" value={fmtNumber(totals.orders)} icon={ShoppingCart} loading={isLoading} />
          <KpiCard label="Avg Order" value={totals.orders ? fmtCurrency(totals.revenue / totals.orders) : '—'} icon={TrendingUp} tone="primary" loading={isLoading} />
        </div>

        <Card>
          <CardHeader><CardTitle>Monthly revenue</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={monthly}>
                  <defs>
                    <linearGradient id="emp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" stroke="hsl(var(--muted-fg))" fontSize={11} />
                  <YAxis stroke="hsl(var(--muted-fg))" fontSize={11} tickFormatter={(v) => fmtCompact(v)} />
                  <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }} formatter={(v) => fmtCurrency(v)} />
                  <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#emp)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
