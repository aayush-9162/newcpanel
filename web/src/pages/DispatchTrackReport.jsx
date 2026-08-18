// DispatchTrack Report — delivery operations analytics from the CFC Analytics
// Delivery module (sub-module E), proxied server-side (/api/analytics/delivery/*).
// Source is the locally-synced dispatchtrack_orders table (last completed sync).
//
// Field names in that module aren't fully pinned yet, so values are read
// defensively (pick over likely keys) and the raw responses are logged once for
// confirmation. Store here is a LABEL (Arden / Waynesville), not S1/S2.

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent } from '@/components/ui/Card';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { useAnalyticsQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber, fmtCompactCurrency } from '@/lib/format';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip,
} from 'recharts';
import {
  Truck, CheckCircle2, XCircle, Clock, Users, DollarSign, AlertTriangle,
  MapPin, Gauge, Wallet,
} from 'lucide-react';
import { cn } from '@/lib/cn';

// ─── helpers ────────────────────────────────────────────────────────────────
const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const pick = (obj, keys) => {
  if (!obj) return undefined;
  const norm = (s) => String(s).toLowerCase().replace(/[_\s]/g, '');
  const map = {}; for (const k of Object.keys(obj)) map[norm(k)] = obj[k];
  for (const k of keys) { const v = map[norm(k)]; if (v !== undefined) return v; }
  return undefined;
};
const pctStr = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);

const RANGES = [
  { id: '30d',   label: 'Last 30 days' },
  { id: 'week',  label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'year',  label: 'This Year' },
];
const STORES = [
  { id: '', label: 'Both' },
  { id: 'Arden', label: 'Arden' },
  { id: 'Waynesville', label: 'Waynesville' },
];

function rangeParams(range, now) {
  const iso = (d) => d.toISOString().slice(0, 10);
  if (range === 'week')  return { week: iso(now) };
  if (range === 'month') return { month: iso(now).slice(0, 7) };
  if (range === 'year')  return { year: now.getFullYear() };
  return {}; // trailing 30 days (server default)
}

function Pill({ active, onClick, children }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded-md px-3 py-1 text-xs font-semibold transition',
        active ? 'bg-primary text-primary-fg shadow' : 'text-muted-fg hover:text-fg')}>
      {children}
    </button>
  );
}

export default function DispatchTrackReport() {
  const [range, setRange] = useState('30d');
  const [store, setStore] = useState('');
  // A fixed "now" avoids new Date() churn re-triggering queries each render.
  const now = useMemo(() => new Date(), []);
  const params = useMemo(() => ({ ...rangeParams(range, now), ...(store ? { store } : {}) }), [range, store, now]);
  const opts = { retry: 0, staleTime: 5 * 60 * 1000 };

  const summaryQ = useAnalyticsQuery('delivery/summary', params, opts);
  const driversQ = useAnalyticsQuery('delivery/driver-performance', params, opts);
  const storeQ   = useAnalyticsQuery('delivery/store', params, opts);
  const costQ    = useAnalyticsQuery('delivery/cost', params, opts);
  const excQ     = useAnalyticsQuery('delivery/exceptions', { ...params, limit: 25 }, opts);

  // TEMP: log shapes once to confirm field names.
  useEffect(() => {
    const L = (t, d) => { if (d) try { console.log('%c[Delivery] ' + t, 'color:#0ea5e9;font-weight:bold', d); } catch { /* ignore */ } };
    L('summary', summaryQ.data); L('driver-performance', driversQ.data);
    L('store', storeQ.data); L('cost', costQ.data); L('exceptions', excQ.data);
  }, [summaryQ.data, driversQ.data, storeQ.data, costQ.data, excQ.data]);

  // ── KPIs from summary ──
  const s = summaryQ.data || {};
  const kpis = s.kpis || s.summary || {};
  const totalStops    = num(pick(kpis, ['totalStops', 'stops', 'total_stops'])) ?? 0;
  const completed     = num(pick(kpis, ['completed', 'deliveriesCompleted', 'completedDeliveries'])) ?? 0;
  const failed        = num(pick(kpis, ['failed', 'failedDeliveries'])) ?? 0;
  const deliveries    = num(pick(kpis, ['totalDeliveries', 'deliveries'])) ?? (completed + failed);
  const completionPct = num(pick(kpis, ['completionPct', 'completionRate', 'completion']));
  const failurePct    = num(pick(kpis, ['failurePct', 'failureRate', 'failure']));
  const avgTime       = num(pick(kpis, ['avgDeliveryTimeMin', 'avgDeliveryTime', 'averageDeliveryTime', 'avgTime']));
  const amountDue     = num(pick(kpis, ['amountDue', 'totalAmountDue']));
  const driverCount   = num(pick(s, ['driverCount', 'drivers'])) ?? (driversQ.data?.drivers?.length ?? null);
  const avgStops      = num(pick(s, ['avgStopsPerDriver']));

  // ── Trend series ──
  const trend = useMemo(() => {
    const t = s.trend || s.byDay || [];
    return (Array.isArray(t) ? t : []).map((r) => ({
      label: String(pick(r, ['label', 'date', 'day', 'month', 'key']) ?? ''),
      stops: num(pick(r, ['totalStops', 'stops'])) ?? 0,
      completed: num(pick(r, ['completed', 'deliveriesCompleted'])) ?? 0,
    }));
  }, [s]);

  // ── Drivers ──
  const drivers = useMemo(() => {
    const arr = driversQ.data?.drivers ?? driversQ.data?.rows ?? [];
    return arr.map((d) => ({
      name: pick(d, ['driverName', 'driver', 'name']) || '(unassigned)',
      deliveries: num(pick(d, ['totalDeliveries', 'deliveries'])),
      completed: num(pick(d, ['deliveriesCompleted', 'completed'])),
      failed: num(pick(d, ['failedDeliveries', 'failed'])),
      stops: num(pick(d, ['totalStops', 'stops'])),
      completionPct: num(pick(d, ['completionPct', 'completionRate'])),
      avgTime: num(pick(d, ['avgDeliveryTimeMin', 'avgDeliveryTime'])),
    })).sort((a, b) => (b.completed ?? 0) - (a.completed ?? 0));
  }, [driversQ.data]);

  // ── Stores ──
  const stores = useMemo(() => {
    const arr = storeQ.data?.stores ?? storeQ.data?.rows ?? [];
    return arr.map((r) => ({
      store: pick(r, ['store', 'name']) || '(unknown)',
      deliveries: num(pick(r, ['deliveries', 'totalDeliveries'])),
      completed: num(pick(r, ['completed'])),
      failed: num(pick(r, ['failed'])),
      stops: num(pick(r, ['totalStops', 'stops'])),
      completionPct: num(pick(r, ['completionPct', 'completionRate'])),
    }));
  }, [storeQ.data]);

  // ── Cost totals ──
  const cost = costQ.data?.totals || {};
  const amtDue      = num(pick(cost, ['amountDue']));
  const delCharges  = num(pick(cost, ['deliveryCharges']));
  const codAmount   = num(pick(cost, ['codAmount']));
  const collected   = num(pick(cost, ['paymentCollected', 'collected']));
  const avgCostStop = num(pick(cost, ['avgCostPerStop']));

  // ── Exceptions ──
  const exceptions = excQ.data?.rows ?? [];
  const exceptionsTotal = num(excQ.data?.total) ?? exceptions.length;
  const byStatus = excQ.data?.byStatus ?? [];

  const loading = summaryQ.isLoading;
  const err = summaryQ.error;

  return (
    <>
      <Topbar title="DispatchTrack Report" subtitle={`Delivery operations · ${store || 'Both stores'} · ${RANGES.find((r) => r.id === range)?.label}`} />
      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* Filters */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {STORES.map((o) => <Pill key={o.id} active={store === o.id} onClick={() => setStore(o.id)}>{o.label}</Pill>)}
            </div>
            <div className="h-6 w-px bg-border" />
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {RANGES.map((o) => <Pill key={o.id} active={range === o.id} onClick={() => setRange(o.id)}>{o.label}</Pill>)}
            </div>
            <span className="ml-auto text-[11px] text-muted-fg">Reflects the last DispatchTrack sync</span>
          </CardContent>
        </Card>

        {err ? (
          <Card><CardContent className="p-4 text-sm text-rose-600 dark:text-rose-300">
            Couldn't reach DispatchTrack analytics: {err.message}
          </CardContent></Card>
        ) : (
          <>
            {/* Hero */}
            <HeroBanner icon={Truck} decorIcon={Truck} accent="primary">
              <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
                {store || 'All stores'} · {RANGES.find((r) => r.id === range)?.label} · Delivery operations
              </div>
              <div className="mt-1 flex items-baseline gap-2.5 flex-wrap">
                <span className="text-4xl font-extrabold tabular-nums tracking-tight text-blue-700 dark:text-blue-200">
                  {loading ? '…' : fmtNumber(deliveries)}
                </span>
                <span className="text-sm font-medium text-muted-fg">deliveries · {pctStr(completionPct)} completed</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Chip label="Total Stops" value={fmtNumber(totalStops)} />
                <Chip label="Completed" value={fmtNumber(completed)} />
                <Chip label="Failed" value={fmtNumber(failed)} tone="rose" />
                <Chip label="Failure %" value={pctStr(failurePct)} tone="rose" />
                <Chip label="Avg Time" value={avgTime == null ? '—' : `${Math.round(avgTime)} min`} />
                <Chip label="Drivers" value={driverCount == null ? '—' : fmtNumber(driverCount)} />
              </div>
            </HeroBanner>

            {/* KPI stats */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <HeroStat label="Completion Rate" value={pctStr(completionPct)} icon={CheckCircle2} accent="emerald" loading={loading}
                subtitle={`${fmtNumber(completed)} of ${fmtNumber(deliveries)} delivered`} />
              <HeroStat label="Failed Deliveries" value={fmtNumber(failed)} icon={XCircle} accent={failed > 0 ? 'rose' : 'emerald'} loading={loading}
                subtitle={failurePct != null ? `${pctStr(failurePct)} failure rate` : null} urgent={failed > 0} />
              <HeroStat label="Avg Delivery Time" value={avgTime == null ? '—' : `${Math.round(avgTime)}m`} icon={Clock} accent="violet" loading={loading}
                subtitle={avgStops != null ? `${avgStops.toFixed(1)} stops / driver` : null} />
              <HeroStat label="Amount Due" value={amountDue == null ? '—' : fmtCompactCurrency(amountDue)}
                fullValue={amountDue == null ? null : fmtCurrency(amountDue)} icon={DollarSign} accent="amber" loading={loading}
                subtitle={collected != null ? `${fmtCompactCurrency(collected)} collected` : null} />
            </div>

            {/* Trend */}
            {trend.length > 1 && (
              <Card>
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center gap-2"><Gauge size={16} className="text-primary" /><span className="text-sm font-semibold">Delivery Trend</span></div>
                  <div className="h-[240px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trend} margin={{ top: 6, right: 16, left: 4, bottom: 4 }}>
                        <defs>
                          <linearGradient id="dtStops" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="label" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                        <YAxis tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                        <RTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                        <Area type="monotone" dataKey="stops" name="Stops" stroke="#3b82f6" strokeWidth={2} fill="url(#dtStops)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Driver performance */}
            <Card>
              <CardContent className="p-0">
                <SectionHead icon={Users} title="Driver Performance" hint={`${fmtNumber(drivers.length)} drivers`} />
                {driversQ.isLoading ? <Spinner /> : drivers.length === 0 ? <Empty /> : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-fg">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2.5 text-left w-9">#</th>
                          <th className="px-3 py-2.5 text-left">Driver</th>
                          <th className="px-3 py-2.5 text-right">Deliveries</th>
                          <th className="px-3 py-2.5 text-right">Completed</th>
                          <th className="px-3 py-2.5 text-right">Failed</th>
                          <th className="px-3 py-2.5 text-right">Stops</th>
                          <th className="px-3 py-2.5 text-right">Completion</th>
                          <th className="px-3 py-2.5 text-right">Avg Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drivers.map((d, i) => (
                          <tr key={d.name + i} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2.5 tabular-nums text-muted-fg">{i + 1}</td>
                            <td className="px-3 py-2.5 font-semibold">{d.name}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{d.deliveries == null ? '—' : fmtNumber(d.deliveries)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{d.completed == null ? '—' : fmtNumber(d.completed)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-rose-500 dark:text-rose-300">{d.failed == null ? '—' : fmtNumber(d.failed)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{d.stops == null ? '—' : fmtNumber(d.stops)}</td>
                            <td className={cn('px-3 py-2.5 text-right tabular-nums font-semibold',
                              d.completionPct == null ? 'text-muted-fg' : d.completionPct >= 90 ? 'text-emerald-600 dark:text-emerald-300' : d.completionPct >= 75 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-500 dark:text-rose-300')}>
                              {pctStr(d.completionPct)}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{d.avgTime == null ? '—' : `${Math.round(d.avgTime)}m`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Store comparison + Cost */}
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardContent className="p-0">
                  <SectionHead icon={MapPin} title="Store Comparison" />
                  {stores.length === 0 ? <Empty /> : (
                    <div className="divide-y divide-border">
                      {stores.map((r, i) => (
                        <div key={r.store + i} className="flex items-center gap-3 px-4 py-3">
                          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary text-xs font-bold">
                            {r.store.slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold">{r.store}</div>
                            <div className="text-[11px] text-muted-fg">{fmtNumber(r.deliveries ?? 0)} deliveries · {fmtNumber(r.stops ?? 0)} stops</div>
                          </div>
                          <div className={cn('text-right text-sm font-bold tabular-nums',
                            (r.completionPct ?? 0) >= 90 ? 'text-emerald-600 dark:text-emerald-300' : 'text-amber-600 dark:text-amber-300')}>
                            {pctStr(r.completionPct)}
                            <div className="text-[10px] font-normal text-rose-500">{fmtNumber(r.failed ?? 0)} failed</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <SectionHead icon={Wallet} title="Cost & Collections" />
                  <div className="grid grid-cols-2 gap-3 p-4">
                    <MiniStat label="Amount Due" value={amtDue == null ? '—' : fmtCurrency(amtDue)} />
                    <MiniStat label="Collected" value={collected == null ? '—' : fmtCurrency(collected)} tone="emerald" />
                    <MiniStat label="Delivery Charges" value={delCharges == null ? '—' : fmtCurrency(delCharges)} />
                    <MiniStat label="COD" value={codAmount == null ? '—' : fmtCurrency(codAmount)} />
                    <MiniStat label="Avg Cost / Stop" value={avgCostStop == null ? '—' : fmtCurrency(avgCostStop)} />
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Exceptions */}
            <Card>
              <CardContent className="p-0">
                <SectionHead icon={AlertTriangle} title="Exceptions — failed / problem deliveries" hint={`${fmtNumber(exceptionsTotal)} total`} />
                {byStatus.length > 0 && (
                  <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
                    {byStatus.map((b, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                        {pick(b, ['status']) || '—'} <strong className="tabular-nums">{fmtNumber(num(pick(b, ['count'])) ?? 0)}</strong>
                      </span>
                    ))}
                  </div>
                )}
                {excQ.isLoading ? <Spinner /> : exceptions.length === 0 ? (
                  <div className="grid place-items-center py-8 text-sm text-muted-fg">No exceptions in this window 🎉</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-fg">
                        <tr className="border-b border-border">
                          {Object.keys(exceptions[0]).slice(0, 6).map((c) => <th key={c} className="px-3 py-2 text-left">{c}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {exceptions.map((r, i) => (
                          <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                            {Object.keys(exceptions[0]).slice(0, 6).map((c) => (
                              <td key={c} className="px-3 py-2 text-muted-fg">{r[c] == null ? '—' : String(r[c])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

// ─── small building blocks ──────────────────────────────────────────────────
function Chip({ label, value, tone }) {
  return (
    <div className={cn('rounded-xl border px-3 py-2',
      tone === 'rose' ? 'border-rose-500/30 bg-rose-500/5' : 'border-blue-500/20 bg-white/50 dark:bg-white/5')}>
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
      <div className={cn('mt-0.5 truncate text-sm font-extrabold tabular-nums', tone === 'rose' ? 'text-rose-600 dark:text-rose-300' : 'text-blue-900 dark:text-blue-100')}>{value}</div>
    </div>
  );
}
function MiniStat({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-fg">{label}</div>
      <div className={cn('mt-0.5 text-base font-extrabold tabular-nums', tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-300' : 'text-fg')}>{value}</div>
    </div>
  );
}
function SectionHead({ icon: Icon, title, hint }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <Icon size={16} className="text-primary" />
      <span className="text-sm font-semibold">{title}</span>
      {hint && <span className="ml-auto text-[11px] text-muted-fg">{hint}</span>}
    </div>
  );
}
function Spinner() {
  return (
    <div className="grid place-items-center py-10 text-sm text-muted-fg">
      <div className="flex flex-col items-center gap-3"><div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />Loading…</div>
    </div>
  );
}
function Empty() {
  return <div className="grid place-items-center py-10 text-sm text-muted-fg">No data for this window.</div>;
}
