// TopSalespersons — dashboard "Top Salespersons" board driven by the live
// UPS-system analytics API (the SAME source as the Salesperson Report BETA), so
// the figures match that report. Merges three feeds per salesperson:
//   UPS      ← sb/customer-capture (upsTaken)
//   Tickets  ← sb/care-plan (tickets)  ·  Care plans ← carePlansSold
//   Sales    ← /sales bySeller (revenue)   ·  Closing = tickets / ups
// Used by both the Daily and Monthly dashboards — pass a from/to window.
import { useMemo } from 'react';
import { Award, ChevronRight, Users, Receipt, Target } from 'lucide-react';
import { useAnalyticsQuery } from '@/lib/api';
import { fmtCurrency, fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

const numF = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Merged, sales-ranked per-salesperson floor rows for a store + date window.
export function useTopSellers(store, fromDate, toDate) {
  const sbStore = store === 'ARDEN' ? 'S1' : 'S2';
  const params = { store: sbStore, from: fromDate, to: toDate };
  const opts = { retry: 0, enabled: !!fromDate && !!toDate, staleTime: 5 * 60 * 1000 };
  const capQ   = useAnalyticsQuery('sb/customer-capture', params, opts);
  const careQ  = useAnalyticsQuery('sb/care-plan',        params, opts);
  const salesQ = useAnalyticsQuery('sales',               params, opts);

  const rows = useMemo(() => {
    const byName = new Map();
    const ensure = (nm) => {
      const k = normName(nm);
      if (!byName.has(k)) byName.set(k, { name: nm || '—', ups: null, tickets: null, sales: null, carePlans: null });
      return byName.get(k);
    };
    for (const r of (capQ.data?.rows ?? []))       { const e = ensure(r.name); e.ups = numF(r.upsTaken); }
    for (const c of (careQ.data?.rows ?? []))      { const e = ensure(c.name); e.tickets = numF(c.tickets); e.carePlans = numF(c.carePlansSold); }
    for (const s of (salesQ.data?.bySeller ?? [])) { const e = ensure(s.sellerName ?? s.name); e.sales = numF(s.revenue ?? s.sales ?? s.totalRevenue); }
    return [...byName.values()]
      .map((r) => ({ ...r, closing: (r.ups && r.ups > 0) ? ((r.tickets || 0) / r.ups) * 100 : null }))
      .filter((r) => r.name && r.name !== '—')
      .sort((a, b) => (b.sales ?? 0) - (a.sales ?? 0) || (b.ups ?? 0) - (a.ups ?? 0));
  }, [capQ.data, careQ.data, salesQ.data]);

  return {
    rows,
    loading: capQ.isLoading || careQ.isLoading || salesQ.isLoading,
    error:   capQ.error || careQ.error || salesQ.error,
  };
}

// One small metric cell inside a card (label above, value below).
function MiniStat({ icon: Icon, label, value, tint }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-lg border border-border bg-muted/30 px-1.5 py-1.5">
      <span className={cn('flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted-fg')}>
        {Icon && <Icon size={10} className={tint} />}{label}
      </span>
      <span className="text-sm font-extrabold tabular-nums leading-none text-fg">{value}</span>
    </div>
  );
}

const MEDALS = [
  { grad: 'from-amber-400 to-yellow-500', ring: 'ring-amber-500/30' },
  { grad: 'from-slate-300 to-slate-400',  ring: 'ring-slate-400/30' },
  { grad: 'from-orange-400 to-amber-600', ring: 'ring-orange-500/30' },
];

const closingTone = (c) => c == null ? 'text-muted-fg'
  : c >= 50 ? 'text-emerald-600 dark:text-emerald-300'
  : c >= 30 ? 'text-amber-600 dark:text-amber-300'
  : 'text-rose-500 dark:text-rose-300';

export function TopSalespersons({ store, fromDate, toDate, title, hint, storeLabel, label, openDetail }) {
  const { rows, loading, error } = useTopSellers(store, fromDate, toDate);

  const seeAll = {
    title: `All Salespersons · ${label} · ${storeLabel}`,
    icon: Award,
    accent: 'amber',
    subtitle: 'Everyone on the floor — UPS, tickets, closing and written sales',
    loadRows: async () => rows.map((r, i) => ({ rank: i + 1, ...r })),
    detailsColumns: [
      { key: 'rank',    label: '#', render: (r) => <span className="tabular-nums text-muted-fg">{r.rank}</span> },
      { key: 'name',    label: 'Salesperson', render: (r) => <span className="font-semibold">{r.name}</span> },
      { key: 'ups',     label: 'UPS', align: 'right', render: (r) => r.ups == null ? '—' : fmtNumber(r.ups) },
      { key: 'tickets', label: 'Tickets', align: 'right', render: (r) => r.tickets == null ? '—' : fmtNumber(r.tickets) },
      { key: 'closing', label: 'Closing', align: 'right', render: (r) => r.closing == null ? '—' : <span className={cn('font-semibold', closingTone(r.closing))}>{r.closing.toFixed(0)}%</span> },
      { key: 'carePlans', label: 'Care Plans', align: 'right', render: (r) => r.carePlans == null ? '—' : fmtNumber(r.carePlans) },
      { key: 'sales',   label: 'Written Sales', align: 'right', render: (r) => <span className="font-semibold">{fmtCurrency(r.sales || 0)}</span> },
    ],
    detailsEmpty: 'No salesperson activity for this period',
  };

  return (
    <>
      <div className="flex items-end justify-between gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary"><Award size={15} /></span>
          <h2 className="text-base font-bold uppercase tracking-wider text-fg">{title}</h2>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={openDetail(seeAll)}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold text-primary transition hover:bg-muted"
            >
              See all salespersons <ChevronRight size={13} />
            </button>
          )}
        </div>
        {hint && <span className="hidden shrink-0 text-[11px] italic text-muted-fg sm:block">{hint}</span>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {loading ? (
          <div className="col-span-1 py-6 text-center text-xs text-muted-fg sm:col-span-3">Loading floor data…</div>
        ) : error ? (
          <div className="col-span-1 rounded-lg border border-amber-500/30 bg-amber-500/5 py-6 text-center text-xs text-amber-700 dark:text-amber-300 sm:col-span-3">
            Couldn't reach the UPS system{error.message ? `: ${error.message}` : ''}.
          </div>
        ) : rows.length === 0 ? (
          <div className="col-span-1 py-6 text-center text-xs text-muted-fg sm:col-span-3">No salesperson activity for this period.</div>
        ) : rows.slice(0, 3).map((s, i) => {
          const medal = MEDALS[i] || MEDALS[2];
          return (
            <div key={s.name + i} className="relative overflow-hidden rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-3">
                <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-base font-extrabold text-white shadow ring-2', medal.grad, medal.ring)}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold text-fg" title={s.name}>{s.name}</div>
                  <div className="truncate text-[10px] uppercase tracking-wider text-muted-fg">written sales</div>
                </div>
                <div className="text-lg font-extrabold tabular-nums text-fg">{fmtCurrency(s.sales || 0)}</div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <MiniStat icon={Users}   label="UPS"     value={s.ups == null ? '—' : fmtNumber(s.ups)} tint="text-sky-500" />
                <MiniStat icon={Receipt} label="Tickets" value={s.tickets == null ? '—' : fmtNumber(s.tickets)} tint="text-violet-500" />
                <MiniStat icon={Target}  label="Closing" value={s.closing == null ? '—' : `${s.closing.toFixed(0)}%`} tint="text-emerald-500" />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
