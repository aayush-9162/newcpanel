// Tracker Report — suspicious web-visit monitoring per workstation.
// Data comes from the external visit-tracker API, proxied through our server
// at /api/tracker/suspicious?date=YYYY-MM-DD.

import { useEffect, useMemo, useState } from 'react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { HeroStat } from '@/components/HeroStat';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { getTrackerReport } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';
import {
  ShieldAlert, Ban, MonitorSmartphone, Clock, Search, RefreshCw, ExternalLink,
  Globe, User, Loader2, AlertTriangle,
} from 'lucide-react';

// ── date helpers (local calendar day, never UTC-shifted) ────────────────────
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); };

function fmtDuration(sec) {
  sec = Number(sec) || 0;
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

const clock = (ts) => (ts && ts.length >= 16 ? ts.slice(11, 16) : '—'); // "HH:MM"

// Pull the search term out of a Google / Bing / Yahoo search URL.
function searchInfo(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const q = u.searchParams.get('q');
  const p = u.searchParams.get('p');
  if ((host === 'google.com' || host === 'bing.com') && q) return { engine: host === 'google.com' ? 'Google' : 'Bing', query: q };
  if (host === 'yahoo.com' && (p || q)) return { engine: 'Yahoo', query: p || q };
  return null;
}

const prettyDomain = (d) => String(d || '').replace(/^www\./, '');
const shortPath = (url) => { try { const u = new URL(url); return (u.pathname + u.search).slice(0, 60); } catch { return ''; } };

export default function TrackerReport() {
  const [date, setDate] = useState(yesterday());
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [filter, setFilter] = useState('');

  const load = async (d) => {
    setState({ loading: true, error: null, data: null });
    try {
      const data = await getTrackerReport(d);
      setState({ loading: false, error: null, data });
    } catch (e) {
      setState({ loading: false, error: e.message, data: null });
    }
  };
  useEffect(() => { load(date); }, [date]); // eslint-disable-line

  const visits = state.data?.visits ?? [];

  // Sort busiest-first (most time on suspicious sites).
  const sorted = useMemo(
    () => [...visits].sort((a, b) => (Number(b.total_sec) || 0) - (Number(a.total_sec) || 0)),
    [visits],
  );

  const filtered = useMemo(() => {
    const n = filter.trim().toLowerCase();
    if (!n) return sorted;
    return sorted.filter((v) =>
      [v.hostname, v.label, v.os_user, v.domain, v.url].some((x) => String(x || '').toLowerCase().includes(n)),
    );
  }, [sorted, filter]);

  // KPIs
  const kpi = useMemo(() => {
    const machines = new Set(), blocked = [];
    let totalSec = 0, totalVisits = 0;
    for (const v of visits) {
      machines.add(v.machine_uuid || v.hostname);
      totalSec += Number(v.total_sec) || 0;
      totalVisits += Number(v.visits) || 0;
      if (v.blocked) blocked.push(v);
    }
    return { rows: visits.length, machines: machines.size, blocked: blocked.length, totalSec, totalVisits };
  }, [visits]);

  // Per-machine rollup (top time-wasters)
  const byMachine = useMemo(() => {
    const m = new Map();
    for (const v of visits) {
      const key = v.machine_uuid || v.hostname;
      const e = m.get(key) || { hostname: v.hostname, label: v.label, os_user: v.os_user, sec: 0, visits: 0, domains: new Set() };
      e.sec += Number(v.total_sec) || 0;
      e.visits += Number(v.visits) || 0;
      e.domains.add(prettyDomain(v.domain));
      m.set(key, e);
    }
    const list = [...m.values()].map((e) => ({ ...e, domains: e.domains.size })).sort((a, b) => b.sec - a.sec);
    const max = list.reduce((mx, e) => Math.max(mx, e.sec), 0);
    return { list, max };
  }, [visits]);

  return (
    <>
      <Topbar title="Tracker Report" subtitle={`Suspicious web activity · ${date}`} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">
        {/* Controls */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-fg">Date</span>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-9 w-44" />
            </label>
            <Button variant="outline" size="sm" onClick={() => load(date)}>
              <RefreshCw size={14} className={state.loading ? 'animate-spin' : ''} /> Refresh
            </Button>
            <div className="relative ml-auto">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter machine, user, site…" className="h-9 w-64 pl-8" />
            </div>
          </CardContent>
        </Card>

        {state.error ? (
          <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Couldn't load the tracker report</div>
              <div className="mt-0.5 text-xs">{state.error}</div>
              <div className="mt-1 text-[11px] text-muted-fg">The tracker service must be reachable from the app server (TRACKER_URL).</div>
            </div>
          </div>
        ) : state.loading ? (
          <div className="grid place-items-center py-20 text-sm text-muted-fg">
            <div className="flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Loading suspicious activity…</div>
          </div>
        ) : (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <HeroStat label="Suspicious Visits" value={fmtNumber(kpi.rows)} icon={ShieldAlert} accent="rose"
                subtitle={`${fmtNumber(kpi.totalVisits)} page hits`} />
              <HeroStat label="Blocked" value={fmtNumber(kpi.blocked)} icon={Ban} accent={kpi.blocked ? 'amber' : 'emerald'}
                subtitle={kpi.blocked ? 'Auto-blocked entries' : 'None blocked'} />
              <HeroStat label="Machines" value={fmtNumber(kpi.machines)} icon={MonitorSmartphone} accent="sky"
                subtitle="Workstations with hits" />
              <HeroStat label="Time on Sites" value={fmtDuration(kpi.totalSec)} icon={Clock} accent="violet"
                subtitle="Total across all machines" />
            </div>

            {/* Top machines */}
            {byMachine.list.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><MonitorSmartphone size={16} className="text-primary" /> Top Machines by Time</CardTitle>
                  <CardDescription>Which workstations spent the most time on suspicious sites</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-1.5">
                  {byMachine.list.slice(0, 6).map((e, i) => {
                    const pct = byMachine.max > 0 ? (e.sec / byMachine.max) * 100 : 0;
                    return (
                      <div key={i} className="grid grid-cols-[minmax(150px,220px)_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5">
                        <span className="flex items-center gap-2 truncate text-sm">
                          {e.label && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{e.label}</span>}
                          <span className="truncate font-medium">{e.hostname}</span>
                          <span className="truncate text-[11px] text-muted-fg">{e.os_user}</span>
                        </span>
                        <span className="relative h-5 overflow-hidden rounded bg-muted/50">
                          <span className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-rose-500 to-orange-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                        </span>
                        <span className="flex items-center gap-3 tabular-nums">
                          <span className="text-sm font-bold">{fmtDuration(e.sec)}</span>
                          <span className="w-16 text-right text-[11px] text-muted-fg">{fmtNumber(e.domains)} sites</span>
                        </span>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            )}

            {/* Visits table */}
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
                <CardTitle className="flex items-center gap-2"><Globe size={16} className="text-primary" /> Suspicious Visits</CardTitle>
                <span className="text-xs text-muted-fg">{fmtNumber(filtered.length)} of {fmtNumber(visits.length)}</span>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40">
                      <tr className="border-b border-border">
                        <th className="w-8 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">#</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Machine</th>
                        <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Activity</th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Visits</th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Time</th>
                        <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Last</th>
                        <th className="px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-fg">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-fg">No suspicious visits for this date.</td></tr>
                      ) : filtered.map((v, i) => {
                        const s = searchInfo(v.url);
                        return (
                          <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2.5 text-xs font-bold tabular-nums text-muted-fg">{i + 1}</td>
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-1.5">
                                {v.label && <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{v.label}</span>}
                                <span className="font-medium">{v.hostname}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-fg"><User size={10} /> {v.os_user || '—'}</div>
                            </td>
                            <td className="max-w-[420px] px-3 py-2.5">
                              {s ? (
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-300">
                                    <Search size={11} /> {s.engine}
                                  </span>
                                  <span className="truncate font-medium" title={s.query}>“{s.query}”</span>
                                </div>
                              ) : (
                                <div className="min-w-0">
                                  <div className="truncate font-medium" title={v.url}>{prettyDomain(v.domain)}</div>
                                  <div className="truncate text-[11px] text-muted-fg" title={v.url}>{shortPath(v.url)}</div>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmtNumber(v.visits)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{fmtDuration(v.total_sec)}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums text-muted-fg">{clock(v.last_seen)}</td>
                            <td className="px-3 py-2.5 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                {v.blocked ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300"><Ban size={11} /> Blocked</span>
                                ) : (
                                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-fg">Allowed</span>
                                )}
                                <a href={v.url} target="_blank" rel="noopener noreferrer" title="Open URL" className="text-muted-fg hover:text-primary"><ExternalLink size={13} /></a>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
