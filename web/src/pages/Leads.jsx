// Modernized Prospective Buyers (Leads) page.
// KPI strip + status pie + filterable lead table, with inline editing in
// "Base Data" mode and a slide-in form for new entries.
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RTooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Users, UserCheck, Flame, Building2, Phone,
  Plus, Download, RefreshCw, Calendar, X,
} from 'lucide-react';
import { Topbar } from '@/components/Topbar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { HeroStat, HeroBanner } from '@/components/HeroStat';
import { DataTable, rowsToCSV } from '@/components/DataTable';
import { useMysqlQuery, runQuery } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { cn } from '@/lib/cn';

// ─── constants ────────────────────────────────────────────────────────────────

const VIEWS = [
  { id: 'all',         label: 'All' },
  { id: 'assigned-s1', label: 'Assigned S1', status: 'assigned s1' },
  { id: 'assigned-s2', label: 'Assigned S2', status: 'assigned s2' },
  { id: 'closed-s1',   label: 'Closed S1',   status: 'closed s1'   },
  { id: 'closed-s2',   label: 'Closed S2',   status: 'closed s2'   },
  { id: 'unassigned',  label: 'Un Assigned',  status: 'un assigned' },
  { id: 'basedata',    label: 'Base Data',    edit: true },
];

const CONTACT_VIA  = ['BIRDEYE', 'EMAIL', 'PHONE CALL', 'WEBSITE', 'WALK IN'];
const CONCERN_OPTS = ['HOT', 'COLD'];
const STATUS_OPTS  = ['Un Assigned', 'Assigned S1', 'Assigned S2', 'Closed S1', 'Closed S2'];
const CONV_OPTS    = ['SALE CLOSED', 'PURCHASED FROM SOMEWHERE ELSE', 'CUSTOMER CHANGED MIND', 'PRICE NOT COMPETITIVE'];

const STATUS_META = {
  'un assigned':  { label: 'Un Assigned', chart: '#94a3b8',  bg: 'bg-slate-100  text-slate-700  dark:bg-slate-800/60 dark:text-slate-200'  },
  'assigned s1':  { label: 'Assigned S1', chart: '#3b82f6',  bg: 'bg-blue-100   text-blue-700   dark:bg-blue-900/40   dark:text-blue-200'   },
  'assigned s2':  { label: 'Assigned S2', chart: '#6366f1',  bg: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200' },
  'closed s1':    { label: 'Closed S1',   chart: '#16a34a',  bg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' },
  'closed s2':    { label: 'Closed S2',   chart: '#15803d',  bg: 'bg-green-100  text-green-700  dark:bg-green-900/40  dark:text-green-200'  },
};

const CONV_META = {
  'sale closed':                   { chart: '#16a34a', bg: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200' },
  'purchased from somewhere else': { chart: '#f97316', bg: 'bg-orange-100  text-orange-700  dark:bg-orange-900/40  dark:text-orange-200'  },
  'customer changed mind':         { chart: '#1e40af', bg: 'bg-sky-100     text-sky-700     dark:bg-sky-900/40     dark:text-sky-200'     },
  'price not competitive':         { chart: '#92400e', bg: 'bg-amber-100   text-amber-700   dark:bg-amber-900/40   dark:text-amber-200'   },
};

// ─── SQL ──────────────────────────────────────────────────────────────────────

const YEARS_SQL     = 'SELECT DISTINCT YEAR(created_at) AS year FROM leads ORDER BY year DESC';
const MONTHS_SQL    = 'SELECT DISTINCT MONTH(created_at) AS month, MONTHNAME(created_at) AS mnth FROM leads WHERE YEAR(created_at)=? ORDER BY month';
const EMPLOYEES_SQL = 'SELECT id, name FROM employees WHERE is_active=1 ORDER BY name';
const STORES_SQL    = "SELECT id, location FROM store WHERE store_type='Showroom' ORDER BY location";

const DATA_BASE = `SELECT l.id, l.customer_name, l.customer_email, l.contact_number, l.contact_via, l.looking_for, l.concern_type, x.name AS attended_by, z.name AS assisted_by, y.name AS assigned_to, s.location, l.conversion, l.status, DATE_FORMAT(l.last_contact,'%Y-%m-%d') AS last_contact, l.not_buying_reason, l.remarks, l.created_at FROM leads l LEFT JOIN users x ON x.id=l.attended_by LEFT JOIN users y ON y.id=l.assigned_to LEFT JOIN users z ON z.id=l.assisted_by LEFT JOIN store s ON s.id=l.location WHERE YEAR(l.created_at)=? AND MONTH(l.created_at)=?`;

function buildDataQuery(viewId, year, month) {
  const view = VIEWS.find(v => v.id === viewId);
  if (!view) return { sql: '', values: [] };
  if (view.status) return {
    sql: `${DATA_BASE} AND LOWER(TRIM(l.status))=LOWER(?) ORDER BY l.created_at DESC`,
    values: [year, month, view.status],
  };
  return { sql: `${DATA_BASE} ORDER BY l.created_at DESC`, values: [year, month] };
}

// ─── badges ───────────────────────────────────────────────────────────────────

function StatusBadge({ value }) {
  const v = (value || '').toString().toLowerCase().trim();
  const meta = STATUS_META[v];
  if (!meta) return <span className="text-muted-fg">—</span>;
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', meta.bg)}>{meta.label}</span>;
}

function ConversionBadge({ value }) {
  const v = (value || '').toString().toLowerCase().trim();
  const meta = CONV_META[v];
  if (!meta) return <span className="text-muted-fg">—</span>;
  return <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium', meta.bg)}>{value}</span>;
}

function ConcernBadge({ value }) {
  if (!value) return <span className="text-muted-fg">—</span>;
  const isHot = value.toUpperCase() === 'HOT';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
      isHot
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        : 'bg-sky-100   text-sky-700   dark:bg-sky-900/40   dark:text-sky-200',
    )}>
      {isHot && <Flame size={10} />} {value}
    </span>
  );
}

// ─── inline edit cells ────────────────────────────────────────────────────────

function EditText({ value: init, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(init ?? '');
  const [flash, setFlash] = useState(false);

  const save = async (val) => {
    const t = (val ?? '').trim();
    if (t === (init ?? '').trim()) { setEditing(false); return; }
    try { await onSave(t); setFlash(true); setTimeout(() => setFlash(false), 800); } catch {}
    setEditing(false);
  };

  if (editing) return (
    <input autoFocus value={v} onChange={e => setV(e.target.value)}
      onBlur={() => save(v)}
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(v); } if (e.key === 'Escape') { setV(init ?? ''); setEditing(false); } }}
      className="w-full min-w-[100px] rounded-md border border-primary/60 bg-card px-2 py-0.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
    />
  );
  return (
    <span onClick={() => { setV(init ?? ''); setEditing(true); }}
      className={cn(
        'block min-w-[60px] cursor-text rounded-md px-1.5 py-0.5 text-sm transition hover:bg-primary/10',
        flash && 'bg-emerald-100 dark:bg-emerald-900/30',
        !init && 'text-muted-fg italic',
      )}>
      {init || '—'}
    </span>
  );
}

function EditSelect({ displayValue, options, onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) return (
    <select autoFocus defaultValue=""
      onChange={async e => { try { if (e.target.value) await onSave(e.target.value); } catch {} setEditing(false); }}
      onBlur={() => setEditing(false)}
      className="rounded-md border border-primary/60 bg-card px-1.5 py-0.5 text-sm outline-none min-w-[120px]">
      <option value="">—</option>
      {options.map(o => {
        const val = typeof o === 'object' ? o.value : o;
        const lbl = typeof o === 'object' ? o.label : o;
        return <option key={val} value={val}>{lbl}</option>;
      })}
    </select>
  );
  return (
    <span onClick={() => setEditing(true)}
      className="block min-w-[80px] cursor-pointer rounded-md px-1.5 py-0.5 text-sm transition hover:bg-primary/10">
      {displayValue || <span className="text-muted-fg italic">—</span>}
    </span>
  );
}

function EditBadge({ value: init, options, render, onSave }) {
  const [editing, setEditing] = useState(false);
  if (editing) return (
    <select autoFocus defaultValue={init ?? ''}
      onChange={async e => { try { await onSave(e.target.value); } catch {} setEditing(false); }}
      onBlur={() => setEditing(false)}
      className="rounded-md border border-primary/60 bg-card px-1.5 py-0.5 text-sm outline-none min-w-[140px]">
      <option value="">—</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  return <span onClick={() => setEditing(true)} className="cursor-pointer transition hover:opacity-75">{render(init)}</span>;
}

function EditDate({ value: init, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(init ?? '');
  if (editing) return (
    <input type="date" autoFocus value={v} onChange={e => setV(e.target.value)}
      onBlur={async () => { try { if (v) await onSave(v); } catch {} setEditing(false); }}
      onKeyDown={e => { if (e.key === 'Escape') setEditing(false); }}
      className="rounded-md border border-primary/60 bg-card px-1.5 py-0.5 text-sm outline-none"
    />
  );
  return (
    <span onClick={() => { setV(init ?? ''); setEditing(true); }}
      className="block cursor-pointer rounded-md px-1.5 py-0.5 text-sm transition hover:bg-primary/10">
      {init || <span className="text-muted-fg italic">—</span>}
    </span>
  );
}

// ─── New Entry slide-over ─────────────────────────────────────────────────────

function NewEntryModal({ employees, stores, onClose, onSuccess }) {
  const init = { customer_name: '', customer_email: '', contact_number: '', contact_via: '', looking_for: '', concern_type: '', attended_by: '', location: '', remarks: '', status: 'Un Assigned' };
  const [form, setForm] = useState(init);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const f = key => e => setForm(p => ({ ...p, [key]: e.target.value }));

  const submit = async (e) => {
    e?.preventDefault();
    if (!form.customer_name.trim()) { setError('Customer Name is required.'); return; }
    setBusy(true);
    try {
      await runQuery('createLead', {
        values: [form.customer_name, form.customer_email, form.contact_number, form.contact_via,
                 form.looking_for, form.concern_type, form.attended_by || null, form.location || null,
                 form.remarks, form.status],
      });
      onSuccess();
    } catch (err) { setError(err.message || 'Failed to create lead.'); }
    finally { setBusy(false); }
  };

  const Field = ({ label, span = 1, children }) => (
    <div className={cn('flex flex-col gap-1.5', span === 2 && 'col-span-2')}>
      <label className="text-xs font-medium uppercase tracking-wider text-muted-fg">{label}</label>
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-2xl m-4 rounded-2xl bg-card border border-border shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <div className="text-base font-semibold text-fg">New Lead</div>
            <div className="text-xs text-muted-fg">Add a prospective buyer to the pipeline</div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-fg hover:bg-muted hover:text-fg transition">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="overflow-auto flex-1 p-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Customer Name *" span={2}>
              <Input value={form.customer_name} onChange={f('customer_name')} placeholder="Full name" />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.customer_email} onChange={f('customer_email')} placeholder="email@example.com" />
            </Field>
            <Field label="Phone">
              <Input value={form.contact_number} onChange={f('contact_number')} placeholder="(555) 555-5555" />
            </Field>
            <Field label="Contact Via">
              <Select value={form.contact_via} onChange={f('contact_via')}>
                <option value="">Select…</option>
                {CONTACT_VIA.map(o => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Concern">
              <Select value={form.concern_type} onChange={f('concern_type')}>
                <option value="">Select…</option>
                {CONCERN_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Looking For" span={2}>
              <Input value={form.looking_for} onChange={f('looking_for')} placeholder="What are they looking for?" />
            </Field>
            <Field label="Attended By">
              <Select value={form.attended_by} onChange={f('attended_by')}>
                <option value="">Select…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            <Field label="Location">
              <Select value={form.location} onChange={f('location')}>
                <option value="">Select…</option>
                {stores.map(s => <option key={s.id} value={s.id}>{s.location}</option>)}
              </Select>
            </Field>
            <Field label="Status" span={2}>
              <Select value={form.status} onChange={f('status')}>
                {STATUS_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
              </Select>
            </Field>
            <Field label="Remarks" span={2}>
              <textarea value={form.remarks} onChange={f('remarks')} rows={3}
                placeholder="Notes…"
                className="resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
            </Field>
          </div>
          {error && <p className="mt-3 rounded-md bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{error}</p>}
        </form>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20 shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Create Lead'}</Button>
        </div>
      </div>
    </div>
  );
}

// ─── filter pill ──────────────────────────────────────────────────────────────

function FilterPill({ active, onClick, children, count }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 h-8 rounded-md px-3 text-xs font-medium transition outline-none',
        active
          ? 'bg-primary text-primary-fg shadow-sm'
          : 'text-muted-fg hover:bg-muted hover:text-fg',
      )}
    >
      {children}
      {count != null && (
        <span className={cn(
          'inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums',
          active ? 'bg-primary-fg/20 text-primary-fg' : 'bg-muted-foreground/10 text-muted-fg',
        )}>{count}</span>
      )}
    </button>
  );
}

// ─── month / year names ───────────────────────────────────────────────────────

const MONTH_NAMES = ['—','January','February','March','April','May','June','July','August','September','October','November','December'];

// ─── main page ────────────────────────────────────────────────────────────────

export default function Leads() {
  const [year, setYear]           = useState(new Date().getFullYear());
  const [month, setMonth]         = useState(new Date().getMonth() + 1);
  const [view, setView]           = useState('all');
  const [showNewForm, setNewForm] = useState(false);

  const qc      = useQueryClient();
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['mysql'] }), [qc]);

  // Year / month dropdown data
  const yearsQ  = useMysqlQuery(YEARS_SQL,  []);
  const monthsQ = useMysqlQuery(MONTHS_SQL, [year]);

  useEffect(() => {
    const available = (monthsQ.data?.rows ?? []).map(r => Number(r.month));
    if (available.length && !available.includes(Number(month))) setMonth(available[0]);
  }, [monthsQ.data]); // eslint-disable-line

  // Detail data — query for the currently-selected view
  const { sql: dSql, values: dVals } = useMemo(() => buildDataQuery(view, year, month), [view, year, month]);
  const dataQ = useMysqlQuery(dSql, dVals, { enabled: !!dSql });

  // Always-on summary query for the KPI strip + chart (independent of view)
  const allDataQ = useMysqlQuery(
    `${DATA_BASE} ORDER BY l.created_at DESC`, [year, month],
    { staleTime: 30_000 },
  );

  // Supporting data
  const employeesQ = useMysqlQuery(EMPLOYEES_SQL, []);
  const storesQ    = useMysqlQuery(STORES_SQL, []);
  const employees  = useMemo(() => employeesQ.data?.rows ?? [], [employeesQ.data]);
  const stores     = useMemo(() => storesQ.data?.rows    ?? [], [storesQ.data]);
  const empOpts    = useMemo(() => employees.map(e => ({ value: String(e.id), label: e.name })), [employees]);
  const storeOpts  = useMemo(() => stores.map(s    => ({ value: String(s.id), label: s.location })), [stores]);

  const rows = useMemo(() => dataQ.data?.rows ?? [], [dataQ.data]);
  const allRows = useMemo(() => allDataQ.data?.rows ?? [], [allDataQ.data]);

  // KPIs — derived from dimensions that vary in real data (store, channel, reps),
  // not just status/conversion (which can be uniform on small datasets).
  const kpi = useMemo(() => {
    const counts = { 'un assigned': 0, 'assigned s1': 0, 'assigned s2': 0, 'closed s1': 0, 'closed s2': 0 };
    const channelMap = new Map();
    const reps = new Set();
    let s1 = 0, s2 = 0, hot = 0;
    for (const r of allRows) {
      const s = (r.status || '').toString().toLowerCase().trim();
      if (counts[s] != null) counts[s]++;
      if (s.includes('s1'))      s1++;
      else if (s.includes('s2')) s2++;
      if (r.contact_via)  channelMap.set(r.contact_via, (channelMap.get(r.contact_via) || 0) + 1);
      if (r.attended_by)  reps.add(r.attended_by);
      if ((r.concern_type || '').toString().toUpperCase() === 'HOT') hot++;
    }
    const topChannel = [...channelMap.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      total: allRows.length,
      s1, s2,
      hot,
      reps: reps.size,
      channels: channelMap.size,
      topChannel: topChannel ? { name: topChannel[0], count: topChannel[1] } : null,
      counts,
    };
  }, [allRows]);

  const statusChart = useMemo(() => {
    return Object.entries(kpi.counts)
      .filter(([, v]) => v > 0)
      .map(([k, v]) => ({ name: STATUS_META[k].label, value: v, fill: STATUS_META[k].chart }));
  }, [kpi]);

  const topAttended = useMemo(() => {
    const map = new Map();
    for (const r of allRows) {
      const name = r.attended_by;
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, count]) => ({ name, count }));
  }, [allRows]);

  // Per-tab counts
  const viewCounts = useMemo(() => {
    const out = { all: kpi.total };
    for (const v of VIEWS) {
      if (!v.status) continue;
      out[v.id] = kpi.counts[v.status] || 0;
    }
    return out;
  }, [kpi]);

  // Mutations
  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this lead?')) return;
    const pwd = window.prompt('Enter password to confirm:');
    if (pwd === null) return;
    try {
      await runQuery('deleteLead', { values: [id, pwd] });
      refresh();
    } catch (e) { alert(e.message || 'Delete failed.'); }
  }, [refresh]);

  const handleSave = useCallback(async (rowId, field, value) => {
    try {
      await runQuery('updateLeads', { values: [rowId, field, value] });
      refresh();
    } catch {}
  }, [refresh]);

  // Columns
  const isBase = view === 'basedata';
  const cols = useMemo(() => {
    const txt = (key, header) => ({
      id: key, accessorKey: key, header,
      cell: ({ getValue, row }) => isBase
        ? <EditText value={getValue()} onSave={v => handleSave(row.original.id, key, v)} />
        : (getValue() || <span className="text-muted-fg">—</span>),
    });

    return [
      {
        id: 'id', accessorKey: 'id', header: 'ID',
        cell: ({ getValue }) => (
          <button onClick={() => handleDelete(getValue())}
            title="Click to delete"
            className="font-mono text-xs text-primary hover:underline">
            #{getValue()}
          </button>
        ),
      },
      txt('customer_name',  'Customer'),
      txt('contact_number', 'Phone'),
      txt('customer_email', 'Email'),
      {
        id: 'contact_via', accessorKey: 'contact_via', header: 'Via',
        cell: ({ getValue, row }) => isBase
          ? <EditSelect displayValue={getValue()} options={CONTACT_VIA} onSave={v => handleSave(row.original.id, 'contact_via', v)} />
          : <span className="text-xs">{getValue() || <span className="text-muted-fg">—</span>}</span>,
      },
      {
        id: 'concern_type', accessorKey: 'concern_type', header: 'Concern',
        cell: ({ getValue, row }) => isBase
          ? <EditBadge value={getValue()} options={CONCERN_OPTS} render={v => <ConcernBadge value={v} />} onSave={v => handleSave(row.original.id, 'concern_type', v)} />
          : <ConcernBadge value={getValue()} />,
      },
      txt('looking_for', 'Looking For'),
      {
        id: 'attended_by', accessorKey: 'attended_by', header: 'Attended By',
        cell: ({ getValue, row }) => isBase
          ? <EditSelect displayValue={getValue()} options={empOpts} onSave={v => handleSave(row.original.id, 'attended_by', v)} />
          : <span className="text-sm">{getValue() || <span className="text-muted-fg">—</span>}</span>,
      },
      {
        id: 'assisted_by', accessorKey: 'assisted_by', header: 'Assisted',
        cell: ({ getValue, row }) => isBase
          ? <EditSelect displayValue={getValue()} options={empOpts} onSave={v => handleSave(row.original.id, 'assisted_by', v)} />
          : <span className="text-sm">{getValue() || <span className="text-muted-fg">—</span>}</span>,
      },
      {
        id: 'assigned_to', accessorKey: 'assigned_to', header: 'Assigned To',
        cell: ({ getValue, row }) => isBase
          ? <EditSelect displayValue={getValue()} options={empOpts} onSave={v => handleSave(row.original.id, 'assigned_to', v)} />
          : <span className="text-sm">{getValue() || <span className="text-muted-fg">—</span>}</span>,
      },
      {
        id: 'location', accessorKey: 'location', header: 'Location',
        cell: ({ getValue, row }) => isBase
          ? <EditSelect displayValue={getValue()} options={storeOpts} onSave={v => handleSave(row.original.id, 'location', v)} />
          : <span className="text-sm">{getValue() || <span className="text-muted-fg">—</span>}</span>,
      },
      {
        id: 'status', accessorKey: 'status', header: 'Status',
        cell: ({ getValue, row }) => isBase
          ? <EditBadge value={getValue()} options={STATUS_OPTS} render={v => <StatusBadge value={v} />} onSave={v => handleSave(row.original.id, 'status', v)} />
          : <StatusBadge value={getValue()} />,
      },
      {
        id: 'conversion', accessorKey: 'conversion', header: 'Conversion',
        cell: ({ getValue, row }) => isBase
          ? <EditBadge value={getValue()} options={CONV_OPTS} render={v => <ConversionBadge value={v} />} onSave={v => handleSave(row.original.id, 'conversion', v)} />
          : <ConversionBadge value={getValue()} />,
      },
      {
        id: 'last_contact', accessorKey: 'last_contact', header: 'Last Contact',
        cell: ({ getValue, row }) => isBase
          ? <EditDate value={getValue()} onSave={v => handleSave(row.original.id, 'last_contact', v)} />
          : <span className="text-sm tabular-nums">{getValue() || <span className="text-muted-fg">—</span>}</span>,
      },
      txt('not_buying_reason', 'Reason'),
      txt('remarks', 'Remarks'),
    ];
  }, [isBase, empOpts, storeOpts, handleSave, handleDelete]);

  const yearOpts  = yearsQ.data?.rows ?? [];
  const monthLbl  = MONTH_NAMES[month] || month;
  const subtitle  = `${kpi.total ? fmtNumber(kpi.total) : '0'} leads · ${monthLbl} ${year}${view === 'all' ? '' : ` · ${VIEWS.find(v => v.id === view)?.label}`}`;

  return (
    <>
      <Topbar title="Prospective Buyers" subtitle={subtitle} />

      <div className="flex flex-1 flex-col gap-5 p-5 animate-fade-in">

        {/* ── filter bar ── */}
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 p-3">
            <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-fg">
              <Calendar size={14} /> Period
            </span>
            <Select value={year} onChange={e => setYear(Number(e.target.value))} className="w-24">
              {yearOpts.length
                ? yearOpts.map(r => <option key={r.year} value={r.year}>{r.year}</option>)
                : <option value={year}>{year}</option>}
            </Select>
            <Select value={month} onChange={e => setMonth(Number(e.target.value))} className="w-36">
              {(monthsQ.data?.rows ?? []).length
                ? monthsQ.data.rows.map(r => <option key={r.month} value={r.month}>{r.mnth}</option>)
                : <option value={month}>{monthLbl}</option>}
            </Select>

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => rowsToCSV(rows, `leads-${year}-${month}-${view}.csv`)} disabled={!rows.length}>
                <Download size={14} /> Export
              </Button>
              <Button variant="outline" size="sm" onClick={refresh} title="Refresh">
                <RefreshCw size={14} />
              </Button>
              <Button size="sm" onClick={() => setNewForm(true)}>
                <Plus size={14} /> New Lead
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── hero banner ── */}
        <HeroBanner icon={Users} decorIcon={Flame} accent="primary">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-600 dark:text-blue-300">
            Lead Pipeline · {monthLbl} {year}
          </div>
          <div className="mt-1 flex items-baseline gap-3 flex-wrap">
            <span className="text-5xl font-extrabold tabular-nums tracking-tight bg-gradient-to-br from-blue-600 to-violet-500 bg-clip-text text-transparent">
              {fmtNumber(kpi.total)}
            </span>
            {kpi.hot > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-bold tabular-nums shadow-md bg-gradient-to-br from-amber-500 to-orange-500 text-white">
                <Flame size={14} /> {fmtNumber(kpi.hot)} hot
              </span>
            )}
          </div>
          <div className="mt-2 text-xs text-muted-fg">
            <strong className="text-fg">{kpi.s1}</strong> at S1 · <strong className="text-fg">{kpi.s2}</strong> at S2 · handled by <strong className="text-fg">{kpi.reps}</strong> {kpi.reps === 1 ? 'salesperson' : 'salespeople'}
          </div>
        </HeroBanner>

        {/* ── eye-catching hero stats ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <HeroStat
            label="Total Leads"
            value={fmtNumber(kpi.total)}
            icon={Users}
            accent="primary"
            subtitle={kpi.total ? `${kpi.hot} hot · ${kpi.total - kpi.hot} cold` : null}
            loading={allDataQ.isLoading}
          />
          <HeroStat
            label="Store Split"
            value={
              <span className="inline-flex items-baseline gap-1.5">
                <span className="text-emerald-600 dark:text-emerald-400">{fmtNumber(kpi.s1)}</span>
                <span className="text-muted-fg/70 text-base font-normal">/</span>
                <span className="text-blue-600 dark:text-blue-400">{fmtNumber(kpi.s2)}</span>
              </span>
            }
            icon={Building2}
            accent="sky"
            subtitle="S1 Arden · S2 Waynesville"
            loading={allDataQ.isLoading}
          />
          <HeroStat
            label="Top Channel"
            value={kpi.topChannel?.name || '—'}
            icon={Phone}
            accent="violet"
            subtitle={kpi.topChannel ? `${kpi.topChannel.count} of ${kpi.total} · ${kpi.channels} channel${kpi.channels !== 1 ? 's' : ''} used` : null}
            loading={allDataQ.isLoading}
          />
          <HeroStat
            label="Active Salespeople"
            value={fmtNumber(kpi.reps)}
            icon={UserCheck}
            accent="emerald"
            subtitle={kpi.reps ? `${(kpi.total / kpi.reps).toFixed(1)} avg leads each` : null}
            loading={allDataQ.isLoading}
          />
        </div>

        {/* ── insights row ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>Status Distribution</CardTitle>
              <CardDescription>How leads are progressing this period · click a status to filter</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div style={{ height: 220 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusChart.length ? statusChart : [{ name: 'No data', value: 1, fill: '#e5e7eb' }]}
                        dataKey="value" nameKey="name"
                        innerRadius={50} outerRadius={85} stroke="none">
                        {(statusChart.length ? statusChart : [{ fill: '#e5e7eb' }]).map((d, i) => <Cell key={i} fill={d.fill} />)}
                      </Pie>
                      <RTooltip
                        formatter={(v, n) => [fmtNumber(v), n]}
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-col justify-center gap-1.5 text-sm">
                  {Object.entries(STATUS_META).map(([k, m]) => {
                    const c = kpi.counts[k] || 0;
                    const targetView = VIEWS.find(v => v.status === k);
                    return (
                      <button key={k} type="button"
                        onClick={() => targetView && setView(targetView.id)}
                        className={cn(
                          'flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1.5 transition hover:bg-muted/50',
                          targetView && view === targetView.id && 'ring-2 ring-primary',
                        )}>
                        <span className="flex items-center gap-2">
                          <span className="inline-block h-3 w-3 rounded-full" style={{ background: m.chart }} />
                          <span>{m.label}</span>
                        </span>
                        <span className="num font-semibold">{fmtNumber(c)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Attendants</CardTitle>
              <CardDescription>Leads handled this period</CardDescription>
            </CardHeader>
            <CardContent className="px-2 pb-3">
              <div style={{ height: 270 }}>
                {topAttended.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-fg">No attended leads yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topAttended} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis type="number" tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" width={80} tick={{ fill: 'hsl(var(--muted-fg))', fontSize: 11 }} />
                      <RTooltip
                        formatter={(v) => [fmtNumber(v), 'Leads']}
                        contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }}
                      />
                      <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── leads table ── */}
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Leads</CardTitle>
              <CardDescription>
                {dataQ.isLoading ? 'Loading…' : (
                  <>
                    Showing <span className="font-semibold text-fg">{fmtNumber(rows.length)}</span> records
                    {isBase && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-200">Edit Mode</span>}
                  </>
                )}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
              {VIEWS.map(v => (
                <FilterPill
                  key={v.id}
                  active={view === v.id}
                  onClick={() => setView(v.id)}
                  count={viewCounts[v.id]}>
                  {v.label}
                </FilterPill>
              ))}
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <DataTable
              data={rows}
              columns={cols}
              loading={dataQ.isLoading}
              pageSize={50}
              emptyText={dataQ.error ? `Could not reach MySQL: ${dataQ.error.message}` : 'No leads match this filter.'}
            />
            {isBase && (
              <p className="mt-3 text-center text-xs text-muted-fg/70">
                All cells in Base Data are editable. Click any value to edit · click <span className="font-mono text-primary">#ID</span> to delete.
                Inline saves require an <code className="rounded bg-muted px-1">updateLeads</code> backend named query.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {showNewForm && (
        <NewEntryModal
          employees={employees}
          stores={stores}
          onClose={() => setNewForm(false)}
          onSuccess={() => { setNewForm(false); refresh(); }}
        />
      )}
    </>
  );
}
