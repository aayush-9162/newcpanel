// Sales Comparison Report — "Old design".
//
// A faithful copy of the original cpanel page (http://192.168.0.211:3000/auth/scr):
// same sections, same queries, same calculations, same colours and highlights.
// Data comes from the old page's own MySQL queries through the whitelisted
// server proxy (/api/scr-legacy/query — see server/src/scrLegacy.js); the sale
// item drill-down reads MS SQL exactly like the original did.
//
// CFC (both stores) works like the original: every query runs once per store
// and the row sets are added together.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Topbar } from '@/components/Topbar';
import { scrLegacyQuery, runSql } from '@/lib/api';
import { cn } from '@/lib/cn';
import { RotateCcw, Plus, Minus, X, FileSpreadsheet } from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';

// ── Constants & helpers (ported from the original scr.js / help.js / utils.js) ──
const MONTHS = [
  { short: 'Jan', number: 1, full: 'January' }, { short: 'Feb', number: 2, full: 'February' },
  { short: 'Mar', number: 3, full: 'March' }, { short: 'Apr', number: 4, full: 'April' },
  { short: 'May', number: 5, full: 'May' }, { short: 'Jun', number: 6, full: 'June' },
  { short: 'Jul', number: 7, full: 'July' }, { short: 'Aug', number: 8, full: 'August' },
  { short: 'Sep', number: 9, full: 'September' }, { short: 'Oct', number: 10, full: 'October' },
  { short: 'Nov', number: 11, full: 'November' }, { short: 'Dec', number: 12, full: 'December' },
];
const MON_NUM = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const CFC = 'CFC';
const storesFor = (s) => (s === CFC ? ['ARDEN', 'WAYNESVILLE'] : [s]);
const storeLabel = (s) => (s === CFC ? CFC : s.charAt(0) + s.slice(1).toLowerCase());

const blank = (v) => v === null || v === undefined || v === '';
const toNumber = (v) => { const n = parseFloat(v); return Number.isNaN(n) ? 0 : n; };
const toMoney = (v) => Math.round(toNumber(v) * 100) / 100;
const addValues = (a, b) => (blank(a) ? b : blank(b) ? a : toMoney(toNumber(a) + toNumber(b)));
function sumColumn(rows, col) {
  const vals = rows.map((r) => r[col]).filter((v) => !blank(v));
  return vals.length ? toMoney(vals.reduce((t, v) => t + toNumber(v), 0)) : null;
}
// Rows matching on `keys` become one row with the `sum` columns added (CFC).
function mergeStoreRows(sets, keys = [], sum = []) {
  const out = [];
  const index = new Map();
  for (const rows of sets) {
    for (const row of rows || []) {
      const id = keys.length ? keys.map((c) => row[c]).join('|') : '_';
      const hit = index.get(id);
      if (!hit) { const copy = { ...row }; index.set(id, copy); out.push(copy); continue; }
      for (const c of sum) if (c in row) hit[c] = addValues(hit[c], row[c]);
    }
  }
  return out;
}
// Running totals can't simply be added across stores — rebuild them from daily figures.
function rebuildDayTotals(rows) {
  rows.sort((a, b) => parseInt(a.DayMonth, 10) - parseInt(b.DayMonth, 10));
  let ty = 0, ly = 0;
  for (const r of rows) {
    ty = toMoney(ty + toNumber(r.ThisYear));
    ly = toMoney(ly + toNumber(r.LastYear));
    r.TYR = ty; r.LYR = ly;
    r.Difference = toMoney(toNumber(r.ThisYear) - toNumber(r.LastYear));
  }
  return rows;
}
function rebuildChangePct(rows) {
  for (const r of rows) {
    const ly = toNumber(r.LastYear);
    r['Ch(%)'] = ly === 0 ? 0 : parseFloat((((toNumber(r.ThisYear) - ly) / ly) * 100).toFixed(2));
  }
  return rows;
}
function parseNumber(value) {
  if (value == null) return 0;
  if (typeof value === 'string') value = value.replace(/,/g, '');
  if (Number.isNaN(Number(value))) return 0;
  return parseFloat(value);
}
const parseToDecimal = (v) => { const n = parseNumber(v); return Number.isNaN(n) ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parseCurrency = (v) => { const n = parseNumber(v); return USD.format(Number.isNaN(n) ? 0 : n); };
const getOrdinal = (n) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const daysInMonth = (m, y) => new Date(y, m, 0).getDate();
const signCls = (n) => (n < 0 ? 't-red' : n > 0 ? 't-green' : '');

async function byStore(store, q, params, merge = {}) {
  const stores = storesFor(store);
  const sets = await Promise.all(stores.map((s) => scrLegacyQuery(q, { ...params, store: s })));
  return stores.length === 1 ? sets[0] : mergeStoreRows(sets, merge.keys || [], merge.sum || []);
}
const useLegacy = (key, fn) => useQuery({ queryKey: ['scr-legacy', ...key], queryFn: fn, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false });

// A saved CFC target wins; otherwise CFC is the sum of the two store targets.
async function getMonthTarget(store, category, year, monthNumber) {
  const read = async (s) => {
    const rows = await scrLegacyQuery('target', { store: s, category, year, month: monthNumber });
    return parseFloat(rows?.[0]?.target_amount) || 0;
  };
  if (store === CFC) { const own = await read(CFC); if (own > 0) return own; }
  const amounts = await Promise.all(storesFor(store).map(read));
  return amounts.reduce((t, a) => t + a, 0) || null;
}

// ── Excel-style cell selection (port of attachTableSelection) ─────────────────
// Click / Ctrl-click / Shift-click / drag numeric cells, or click a header for
// the whole column; a bar at the bottom shows Count, Sum, Avg, Min, Max.
function useCellSelection(ref, deps) {
  useEffect(() => {
    const table = ref.current;
    if (!table) return undefined;
    const bar = document.createElement('div');
    bar.className = 'scr-old-infobar';
    bar.style.display = 'none';
    document.body.appendChild(bar);
    const num = (td) => {
      let raw = td.getAttribute('data-value');
      if (raw == null) raw = td.textContent;
      raw = String(raw).trim();
      if (!raw || ['null', 'na', '-'].includes(raw.toLowerCase())) return NaN;
      const v = Number(raw.replace(/[, ]+/g, '').replace(/[^0-9.-]/g, ''));
      return Number.isFinite(v) ? v : NaN;
    };
    let cells = []; const index = new Map(); const sel = new Set();
    let last = null, dragging = false, addMode = true;
    const refresh = () => {
      cells = []; index.clear();
      table.querySelectorAll('tbody td').forEach((td) => { if (Number.isFinite(num(td))) { index.set(td, cells.length); cells.push(td); } });
    };
    refresh();
    const render = () => {
      cells.forEach((td, i) => td.classList.toggle('tbl-selected', sel.has(i)));
      table.querySelectorAll('th').forEach((th) => th.classList.remove('tbl-col-selected'));
      const head = table.tHead?.rows?.[0];
      if (head) {
        for (let c = 0; c < head.cells.length; c++) {
          const inCol = Array.from(table.tBodies[0]?.rows || []).map((r) => r.cells[c]).filter((td) => td && index.has(td));
          if (inCol.length && inCol.every((td) => sel.has(index.get(td)))) head.cells[c].classList.add('tbl-col-selected');
        }
      }
      const vals = [...sel].map((i) => num(cells[i])).filter(Number.isFinite);
      if (!vals.length) { bar.style.display = 'none'; bar.textContent = ''; return; }
      const sum = vals.reduce((a, b) => a + b, 0);
      const f = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
      bar.innerHTML = `<strong>Count:</strong> ${vals.length} &nbsp;|&nbsp; <strong>Sum:</strong> ${f(sum)} &nbsp;|&nbsp; <strong>Avg:</strong> ${f(sum / vals.length)} &nbsp;|&nbsp; <strong>Min:</strong> ${Math.min(...vals).toLocaleString()} &nbsp;|&nbsp; <strong>Max:</strong> ${Math.max(...vals).toLocaleString()}`;
      bar.style.display = 'block';
    };
    const onClick = (ev) => {
      const t = ev.target.closest('td,th');
      if (!t || !table.contains(t)) return;
      if (t.tagName === 'TH') {
        const col = t.cellIndex;
        const ids = Array.from(table.tBodies[0]?.rows || []).map((r) => r.cells[col]).filter((td) => td && index.has(td)).map((td) => index.get(td));
        if (!ids.length) return;
        const add = ev.ctrlKey || ev.metaKey;
        if (!add) sel.clear();
        ids.forEach((i) => (add && sel.has(i) ? sel.delete(i) : sel.add(i)));
        last = ids[ids.length - 1];
        render();
        return;
      }
      if (!index.has(t)) return;
      const i = index.get(t);
      if (ev.shiftKey && last !== null) { for (let k = Math.min(last, i); k <= Math.max(last, i); k++) sel.add(k); last = i; render(); return; }
      if (ev.ctrlKey || ev.metaKey) { sel.has(i) ? sel.delete(i) : sel.add(i); last = i; render(); return; }
      if (sel.size === 1 && sel.has(i)) { sel.clear(); last = null; } else { sel.clear(); sel.add(i); last = i; }
      render();
    };
    const onDown = (ev) => {
      const t = ev.target.closest('td');
      if (!t || !table.contains(t) || ev.shiftKey) return;
      dragging = true;
      const i = index.has(t) ? index.get(t) : null;
      addMode = !(i !== null && sel.has(i));
    };
    const onOver = (ev) => {
      if (!dragging) return;
      const t = ev.target.closest('td');
      if (!t || !index.has(t)) return;
      const i = index.get(t);
      addMode ? sel.add(i) : sel.delete(i);
      render();
    };
    const onUp = () => { dragging = false; };
    const onKey = (ev) => { if (ev.key === 'Escape' && sel.size) { sel.clear(); render(); } };
    table.addEventListener('click', onClick);
    table.addEventListener('mousedown', onDown);
    table.addEventListener('mouseover', onOver);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return () => {
      table.removeEventListener('click', onClick);
      table.removeEventListener('mousedown', onDown);
      table.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      cells.forEach((td) => td.classList.remove('tbl-selected'));
      bar.remove();
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

// ── Small shared UI ──────────────────────────────────────────────────────────
const Status = ({ q, empty }) => (q.isLoading
  ? <div className="muted py-3">Loading…</div>
  : q.error ? <div className="t-danger py-3">Couldn't load: {q.error.message}</div>
  : empty ? <div className="muted py-3" style={{ fontSize: 20 }}>{empty}</div> : null);

function Modal({ title, size = 'lg', onClose, extra, children }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scr-old-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={cn('dialog', size === 'fullscreen' && 'full')}>
        <div className="mhead">
          <h5>{title}{extra}</h5>
          <button type="button" className="mclose" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="mbody">{children}</div>
      </div>
    </div>
  );
}

function downloadCsv(rows, columns, filename) {
  try {
    const esc = (v) => { const s = v == null ? '' : String(v).trim(); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const csv = [columns.map((c) => esc(c.label)).join(','), ...rows.map((r) => columns.map((c) => esc(r[c.key])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* download is best-effort */ }
}

// ── Sales comparison: daily table ────────────────────────────────────────────
function DailyTable({ rows, onItems }) {
  const ref = useRef(null);
  useCellSelection(ref, [rows]);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tot = (k) => rows.reduce((t, r) => { const n = parseNumber(r[k]); return t + (Number.isNaN(n) ? 0 : n); }, 0);
  const tLY = tot('LastYear'), tTY = tot('ThisYear');
  const weekend = (d) => d === 'Sat' || d === 'Sun';
  const ly_ty = (v) => { const n = parseNumber(v); return n ? parseToDecimal(n) : ''; };
  return (
    <table ref={ref} className="tbl hover custom cols">
      <thead>
        <tr><th>Date</th><th className="tc">DayLY</th><th className="te">LastYear</th><th className="tc">DayTY</th><th className="te">ThisYear</th><th className="te">Difference</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const d = parseNumber(r.Difference);
          const future = r.Dated && new Date(r.Dated) >= today;
          const diffText = future ? '' : d ? parseToDecimal(d) : (blank(r.Difference) ? '' : String(r.Difference));
          return (
            <tr key={i} style={r.DayMonth ? undefined : { display: 'none' }}>
              <td data-value={r.DayMonth ?? ''}>{r.DayMonth}</td>
              <td className={cn('tc', weekend(r.DayLY) && 'bg-warn fw-semibold')} data-value={r.DayLY ?? ''}>{r.DayLY}</td>
              <td className="te role-btn" title="Click to view Item Details" data-value={r.LastYear ?? ''}
                onClick={() => parseNumber(r.LastYear) && onItems(r.DayMonth, 'LastYear')}>{ly_ty(r.LastYear)}</td>
              <td className={cn('tc', weekend(r.DayTY) && 'bg-warn fw-semibold')} data-value={r.DayTY ?? ''}>{r.DayTY}</td>
              <td className="te role-btn" title="Click to view Item Details" data-value={r.ThisYear ?? ''}
                onClick={() => parseNumber(r.ThisYear) && onItems(r.DayMonth, 'ThisYear')}>{ly_ty(r.ThisYear)}</td>
              <td className={cn('te', signCls(d))} data-value={r.Difference ?? ''}>{diffText}</td>
            </tr>
          );
        })}
      </tbody>
      {rows.length > 1 && (
        <tfoot>
          <tr>
            <td /><td />
            <td className="te fw-bold">{parseCurrency(tLY)}</td>
            <td />
            <td className="te fw-bold">{parseCurrency(tTY)}</td>
            <td className={cn('te fw-bold', tTY - tLY < 0 ? 't-danger' : 't-green')}>{parseCurrency(tTY - tLY)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// ── Performance matrix + donut ───────────────────────────────────────────────
function Matrix({ m, monthObj }) {
  const now = new Date();
  const cMonth = now.getMonth() + 1;
  const { a, ly, ty, target, days } = m;
  const lastDate = now.getDate() - 1;
  const daysRemaining = monthObj.number === cMonth ? days - (lastDate + 1) : 0;
  const shortfall = target - ty;
  const achieved = shortfall <= 0;
  const avgReq = daysRemaining && !achieved ? parseCurrency(shortfall / daysRemaining) : 'N/A';
  const lymtd = parseNumber(a.salesLastYear), tymtd = parseNumber(a.salesThisYear);
  const asly = parseNumber(a.avgSalesLastYear), asty = parseNumber(a.avgSalesThisYear);
  const isCur = monthObj.number === cMonth;
  let trending = { text: 'N/A', cls: '' };
  if (isCur) trending = { text: parseCurrency(asty * days), cls: 't-greenone' };
  else if (monthObj.number < cMonth) trending = { text: parseCurrency(ty), cls: ly > ty ? 't-red' : 't-greenone' };
  return (
    <table className="tbl hover">
      <thead><tr><th>Performance Matrix</th><th className="te">Last Year</th><th className="te">This Year</th></tr></thead>
      <tbody className="divider">
        <tr><td>MTD <span>[ Till {getOrdinal(lastDate)} {monthObj.full} ]</span></td><td className="te">{parseCurrency(a.salesLastYear)}</td><td className={cn('te', tymtd > lymtd ? 't-green' : 't-red')}>{parseCurrency(a.salesThisYear)}</td></tr>
        <tr><td>MONTH TOTAL</td><td className="te">{parseCurrency(ly)}</td><td className={cn('te', ty > ly ? 't-green' : 't-red')}>{parseCurrency(ty)}</td></tr>
        <tr><td>AVG SALES/DAY</td><td className="te">{parseCurrency(ly / days)}</td><td className="te">{monthObj.number >= cMonth ? 'N/A' : parseCurrency(ty / days)}</td></tr>
        <tr><td>AVG SALES TILL DATE</td><td className="te">{isCur ? parseCurrency(asly) : 'N/A'}</td><td className={cn('te', isCur && (asty > asly ? 't-green' : 't-red'))}>{isCur ? parseCurrency(asty) : 'N/A'}</td></tr>
        <tr><td>MONTH TARGET</td><td /><td className="te fw-semibold t-primary" title="Month's Target">{parseCurrency(target)}</td></tr>
        <tr><td>AVG REQD./DAY FOR DAYS<br />LEFT TO ACHIEVE TARGET</td><td /><td className={cn('te fw-semibold', achieved && 't-green')} title={achieved ? 'Target Achieved' : ''}>{avgReq}</td></tr>
        <tr><td>TRENDING</td><td /><td className={cn('te fw-semibold', trending.cls)}>{trending.text}</td></tr>
      </tbody>
    </table>
  );
}

function Donut({ target, sales }) {
  const t = Number(target) || 0, s = Number(sales) || 0;
  const over = t ? ((s - t) / t) * 100 : 0;
  let percent = t ? ((s / t) * 100).toFixed(1) : '0.0';
  let data;
  if (t && s >= t) {
    percent = '100';
    if (over > 10) {
      const extra = ((s - t) / s) * 100;
      data = [{ name: 'Target Achieved', value: 100 - extra, color: '#00f0ff' }, { name: 'Overachieved', value: extra, color: '#39ff14' }];
    } else data = [{ name: 'Target Achieved', value: 1, color: '#00f0ff' }];
  } else {
    data = [{ name: 'Sales Achived', value: s, color: '#20c997' }, { name: 'Remaining', value: Math.max(0, t - s), color: '#F97316' }];
  }
  const tip = (val, name) => {
    if (t && s >= t && over > 10) return name === 'Target Achieved' ? [`$${t.toLocaleString('en-US')}`, 'Target'] : [`$${(s - t).toLocaleString('en-US')}`, 'Extra'];
    if (t && s >= t) return [`$${s.toLocaleString('en-US')}`, 'Target Exceeded'];
    return [`$${Number(val).toLocaleString('en-US')}`, name];
  };
  return (
    <div style={{ width: 300 }} className="tc">
      <div style={{ position: 'relative', width: 300, height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="70%" outerRadius="100%" stroke="none" isAnimationActive>
              {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            </Pie>
            <Tooltip formatter={tip} contentStyle={{ background: '#212529', border: 0, borderRadius: 6, color: '#dee2e6' }} itemStyle={{ color: '#dee2e6' }} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none' }}>
          <div style={{ fontSize: 17 }}>{percent}%</div>
          <div className="small">Targeted Value</div>
        </div>
      </div>
      <div className="legend">
        {data.map((d) => <span key={d.name}><i style={{ background: d.color }} />{d.name}</span>)}
      </div>
    </div>
  );
}

function CumulativeChart({ rows, month }) {
  const data = useMemo(() => {
    const maxDay = Math.max(0, ...rows.map((d) => parseInt(String(d.DayMonth).split('-')[0], 10) || 0));
    const total = maxDay > 20 ? 31 : maxDay > 10 ? 20 : 10;
    const map = {};
    for (const d of rows) map[String(d.DayMonth).split('-')[0]] = d;
    return Array.from({ length: total }, (_, i) => {
      const day = String(i + 1).padStart(2, '0');
      const r = map[day];
      return { day, ly: r ? toNumber(r.LYR) : null, ty: r ? toNumber(r.TYR) : null };
    });
  }, [rows]);
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' });
  return (
    <div style={{ width: '100%', height: 350, paddingRight: 20 }}>
      <div className="tc fw-bold" style={{ fontSize: 18, color: '#666', marginBottom: 6 }}>Cumulative sales comparison for ({month})</div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="rgba(0,0,0,.1)" vertical />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${compact.format(v)}`} />
          <Tooltip formatter={(v, n) => [v != null ? `$${Number(v).toLocaleString()}` : 'No Data', n]} />
          <Legend verticalAlign="bottom" />
          <Line type="monotone" dataKey="ly" name="Last Year" stroke="green" dot={{ r: 2 }} strokeWidth={2} connectNulls={false} />
          <Line type="monotone" dataKey="ty" name="This Year" stroke="yellowgreen" dot={{ r: 2 }} strokeWidth={2} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Weekly / quarterly ───────────────────────────────────────────────────────
function WeeklyTable({ rows }) {
  const day = new Date().getDate();
  const inRange = (rng) => {
    const [a, b] = String(rng || '').trim().split('-');
    const s = parseInt(a, 10), e = parseInt(b, 10) || s;
    return !Number.isNaN(s) && !Number.isNaN(e) && day >= s && day <= e;
  };
  return (
    <table className="tbl hover">
      <thead><tr><th>DateRange</th><th className="te">LastYear</th><th className="te">ThisYear</th><th className="te">Difference</th></tr></thead>
      <tbody className="divider">
        {rows.map((r, i) => (
          <tr key={i}>
            <td className={cn(inRange(r.WeekGroup) && 'bg-hl fw-semibold')}>{r.WeekGroup}</td>
            <td className="te">{parseToDecimal(r.LastYear)}</td>
            <td className="te">{parseToDecimal(r.ThisYear)}</td>
            <td className={cn('te', signCls(parseNumber(r.Difference)))}>{parseToDecimal(r.Difference)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QuarterTable({ rows }) {
  const [open, setOpen] = useState(() => new Set());
  const curQ = Math.ceil((new Date().getMonth() + 1) / 3);
  const toggle = (q) => setOpen((s) => { const n = new Set(s); n.has(q) ? n.delete(q) : n.add(q); return n; });
  return (
    <table className="tbl hover custom">
      <thead><tr><th style={{ width: 40 }} /><th>Month</th><th className="te">LastYear</th><th className="te">ThisYear</th><th className="te">Difference</th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const q = parseInt(r.QuarterNumber, 10);
          const isTotal = String(r.MonthName || '').includes('Total');
          const hideDiff = isTotal && q >= curQ;
          const d = parseNumber(r.Difference);
          if (!isTotal && !open.has(q)) return null;
          return (
            <tr key={i}>
              <td>{isTotal && (
                <span className="role-btn fw-bold" title="Toggle Details" onClick={() => toggle(q)}>
                  {open.has(q) ? <Minus size={14} /> : <Plus size={14} />}
                </span>
              )}</td>
              <td className={cn(q === curQ && 'bg-hl fw-semibold')}>{r.MonthName}</td>
              <td className="te">{parseToDecimal(r.LastYear)}</td>
              <td className="te">{parseToDecimal(r.ThisYear)}</td>
              <td className={cn('te', !hideDiff && signCls(d))}>{hideDiff ? '' : parseToDecimal(r.Difference)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Sales summary (month-wise) ───────────────────────────────────────────────
function createReport(data, store, category) {
  const curIdx = new Date().getMonth();
  const stores = storesFor(store);
  const filtered = (data || []).filter((d) => stores.includes(d.ProfitCenter) && d.SaleCategory === category);
  const rLY = { Year: 'LastYear' }, rTY = { Year: 'ThisYear' }, rDiff = { Year: 'Difference' }, rCh = { Year: 'Change' };
  let lyAll = 0, tyAll = 0, lyPrev = 0, diffPrev = 0;
  MONTHS.forEach((m, i) => {
    const recs = filtered.filter((d) => d.MonthName === m.full);
    const last = sumColumn(recs, 'LastYear'), curr = sumColumn(recs, 'ThisYear');
    rLY[m.short] = last; rTY[m.short] = curr;
    if (last != null) lyAll += last;
    if (curr != null) tyAll += curr;
    if (i < curIdx && last != null && curr != null) {
      const diff = curr - last;
      rDiff[m.short] = parseFloat(diff.toFixed(2));
      rCh[m.short] = last !== 0 ? parseFloat(((diff / last) * 100).toFixed(2)) : null;
      diffPrev += diff; lyPrev += last;
    } else { rDiff[m.short] = null; rCh[m.short] = null; }
  });
  rLY.Total = parseCurrency(lyAll);
  rTY.Total = parseCurrency(tyAll);
  rDiff.Total = parseCurrency(diffPrev);
  rCh.Total = lyPrev !== 0 ? parseFloat(((diffPrev / lyPrev) * 100).toFixed(2)) : null;
  return { rows: [rLY, rTY, rDiff, rCh], base: { diff: diffPrev, last: lyPrev } };
}

function SummaryTable({ report, mtd, selShort }) {
  const ref = useRef(null);
  useCellSelection(ref, [report, mtd]);
  const now = new Date();
  const curShort = now.toLocaleString('en-US', { month: 'short' });
  // Running month: like-for-like month-till-date difference / change (marked *).
  const over = {};
  if (mtd && mtd.lastYearMTD) {
    const diff = mtd.thisYearMTD - mtd.lastYearMTD;
    const change = (diff / mtd.lastYearMTD) * 100;
    const tip = `Till date only (1-${mtd.cutOffDay} ${curShort}): last year ${parseToDecimal(mtd.lastYearMTD)} vs this year ${parseToDecimal(mtd.thisYearMTD)}`;
    over[`2:${curShort}`] = { v: diff, text: parseToDecimal(diff), tip };
    over[`3:${curShort}`] = { v: change, text: change.toFixed(2), tip };
    const totalDiff = report.base.diff + diff, totalLast = report.base.last + mtd.lastYearMTD;
    const totalChange = totalLast !== 0 ? (totalDiff / totalLast) * 100 : 0;
    const totalTip = `Completed months plus ${curShort} till date (1-${mtd.cutOffDay})`;
    over['2:Total'] = { v: totalDiff, text: parseCurrency(totalDiff), tip: totalTip };
    over['3:Total'] = { v: totalChange, text: totalChange.toFixed(2), tip: totalTip };
  }
  const cols = ['Year', ...MONTHS.map((m) => m.short), 'Total'];
  const cellText = (ri, k, v) => {
    if (blank(v)) return '';
    if (ri < 3 && !Number.isNaN(Number(v))) return parseToDecimal(v);
    return String(v);
  };
  return (
    <table ref={ref} className="tbl hover custom cols">
      <thead><tr>{cols.map((k) => <th key={k} className={cn(k !== 'Year' && 'te', k === 'Year' && 'fw-bold', k === 'Total' && 'fw-bold', k === selShort && 'bg-warn')}>{k}</th>)}</tr></thead>
      <tbody>
        {report.rows.map((r, ri) => (
          <tr key={ri}>
            {cols.map((k) => {
              const o = over[`${ri}:${k}`];
              const v = o ? o.v : r[k];
              const n = parseNumber(o ? o.v : r[k]);
              const colored = (ri === 2 || ri === 3) && k !== 'Year';
              return (
                <td key={k} data-value={v ?? ''} title={o?.tip}
                  className={cn(k !== 'Year' && 'te', k === 'Year' && 'fw-bold', k === 'Total' && 'fw-bold', k === selShort && 'bg-warn',
                    o && 'mtd-cell', colored && !blank(v) && (n > 0 ? 't-green fw-semibold' : n < 0 ? 't-red' : ''))}>
                  {o ? <>{o.text}<sup className="mtd-mark">*</sup></> : cellText(ri, k, r[k])}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MonthTillDateModal({ store, category, onClose }) {
  const monthNumber = new Date().getMonth() + 1;
  const q = useLegacy(['mtd-modal', store, category, monthNumber],
    () => byStore(store, 'monthTillDate', { category, monthNumber }, { keys: ['MonthName'], sum: ['LastYear', 'ThisYear', 'Difference'] }));
  const rows = q.data || [];
  return (
    <Modal title="Sales Summary" onClose={onClose}>
      <Status q={q} empty={!q.isLoading && !q.error && !rows.length ? 'No records' : null} />
      {rows.length > 0 && (
        <table className="tbl hover">
          <thead><tr><th>MonthName</th><th className="te">LastYear</th><th className="te">ThisYear</th><th className="te">Difference</th></tr></thead>
          <tbody className="divider">
            {rows.map((r, i) => {
              const d = parseNumber(r.Difference);
              const lastRow = i === rows.length - 1;
              return (
                <tr key={i} className={cn(lastRow && 'fw-bold')}>
                  <td>{r.MonthName}</td>
                  <td className="te">{parseCurrency(r.LastYear)}</td>
                  <td className="te">{parseCurrency(r.ThisYear)}</td>
                  <td className={cn('te', d > 0 ? 't-greenone' : d < 0 ? 't-red' : '')}>{parseCurrency(r.Difference)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

// ── Yearly (Written / Delivered) ─────────────────────────────────────────────
function YearlyTable({ rows, selMonth }) {
  const cur = new Date().getMonth() + 1;
  const monthNum = Object.fromEntries(MONTHS.map((m) => [m.full, m.number]));
  let ly = 0, ty = 0, df = 0, pLy = 0, pTy = 0;
  for (const r of rows) {
    const a = parseFloat(String(r.LastYear ?? '').replace(/[^0-9.-]+/g, ''));
    const b = parseFloat(String(r.ThisYear ?? '').replace(/[^0-9.-]+/g, ''));
    const c = parseFloat(String(r.Diff ?? '').replace(/[^0-9.-]+/g, ''));
    if (!Number.isNaN(a)) ly += a;
    if (!Number.isNaN(b)) ty += b;
    if (!Number.isNaN(c)) df += c;
    const mn = monthNum[String(r.Month || '').trim()] || 0;
    if (mn > 0 && mn <= cur) { if (!Number.isNaN(a)) pLy += a; if (!Number.isNaN(b)) pTy += b; }
  }
  const change = pLy !== 0 ? ((pTy - pLy) / pLy) * 100 : 0;
  return (
    <table className="tbl hover custom cols">
      <thead><tr><th>Month</th><th className="te">LastYear</th><th className="te">ThisYear</th><th className="te">Diff</th><th className="te">Ch(%)</th></tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const hl = r.Month === selMonth && 'bg-warn';
          const dn = parseNumber(r.Diff), cn_ = Number(r['Ch(%)']);
          return (
            <tr key={i}>
              <td className={cn(hl)}>{r.Month}</td>
              <td className={cn('te', hl)}>{blank(r.LastYear) ? '' : parseToDecimal(r.LastYear)}</td>
              <td className={cn('te', hl)}>{blank(r.ThisYear) ? '' : parseToDecimal(r.ThisYear)}</td>
              <td className={cn('te', hl, !blank(r.Diff) && signCls(dn))}>{blank(r.Diff) ? '' : parseToDecimal(r.Diff)}</td>
              <td className={cn('te', hl, signCls(cn_))}>{blank(r['Ch(%)']) ? '' : String(r['Ch(%)'])}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td className="fw-bold">TOTAL</td>
          <td className="te fw-bold">{parseToDecimal(ly)}</td>
          <td className="te fw-bold">{parseToDecimal(ty)}</td>
          <td className="te fw-bold">{parseToDecimal(df)}</td>
          <td className="te fw-bold">{change.toFixed(2)}%</td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── 4 years ──────────────────────────────────────────────────────────────────
function FourYearsTable({ rows, selMonth }) {
  const year = new Date().getFullYear();
  const keys = ['Previous', 'PreviousYear', 'LastYear', 'ThisYear'];
  const label = { Previous: year - 3, PreviousYear: year - 2, LastYear: year - 1, ThisYear: year };
  const totals = Object.fromEntries(keys.map((k) => [k, rows.reduce((t, r) => { const n = parseNumber(r[k]); return t + (Number.isNaN(n) ? 0 : n); }, 0)]));
  const arrow = (oldV, newV) => {
    const o = Number(oldV), n = Number(newV);
    if (!o || !n || Number.isNaN(o) || Number.isNaN(n)) return null;
    const pct = Math.abs(((n - o) / o) * 100).toFixed(2).padStart(5, '0');
    return <span className={cn('arrow', n > o ? 'up' : 'down')}> {pct}%</span>;
  };
  const prevOf = { PreviousYear: 'Previous', LastYear: 'PreviousYear', ThisYear: 'LastYear' };
  const fmt = (v) => { const n = parseNumber(v); return n ? parseToDecimal(n) : ''; };
  return (
    <table className="tbl hover custom cols">
      <thead><tr><th>MonthName</th>{keys.map((k) => <th key={k} className="te">{label[k]}</th>)}</tr></thead>
      <tbody>
        {rows.map((r, i) => {
          const hl = r.MonthName === selMonth && 'bg-warn';
          return (
            <tr key={i}>
              <td className={cn(hl)}>{r.MonthName}</td>
              {keys.map((k) => {
                const n = parseFloat(r[k]);
                return (
                  <td key={k} className={cn('te', hl, !Number.isNaN(n) && n >= 1000000 && 'million')} data-value={r[k] ?? ''}>
                    {fmt(r[k])}{prevOf[k] && arrow(r[prevOf[k]], r[k])}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
      {rows.length > 1 && (
        <tfoot>
          <tr>
            <td className="fw-bold">TOTAL</td>
            {keys.map((k) => <td key={k} className="te fw-bold">{parseCurrency(totals[k])}{prevOf[k] && arrow(totals[prevOf[k]], totals[k])}</td>)}
          </tr>
        </tfoot>
      )}
    </table>
  );
}

// ── Sale item drill-down (MS SQL, like the original) ─────────────────────────
const ITEM_COLS = [
  ['Sale_Date', 'Sale Date'], ['sales_no', 'Sales No'], ['Location', 'Location'], ['customer', 'Customer'], ['city', 'City'],
  ['state', 'State'], ['zip', 'Zip'], ['sale_item', 'Sale Item'], ['sku', 'SKU'], ['sale_desc2', 'Sale Desc2'], ['qty', 'QTY'],
  ['sale_price', 'Sale Price'], ['Cost', 'Cost'], ['Status', 'Status'],
].map(([key, label]) => ({ key, label }));

function ItemsModal({ store, date, onClose }) {
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  useEffect(() => {
    let alive = true;
    const locs = storesFor(store).map((s) => (s === 'ARDEN' ? 1 : 2)).join(', ');
    const sql = `SELECT FORMAT(CONVERT(DATE, CONVERT(CHAR(8), a.sale_date), 112), 'MM-dd-yyyy') AS Sale_Date, a.sales_no, b.sale_loc AS [Location], a.BillingName AS customer, a.BillingCity AS [city], a.BillingState AS [state], a.BillingZip AS [zip], b.sale_item, b.sale_desc AS [sku], b.sale_desc2, b.sale_qty AS [qty], b.sale_price, b.sale_unit_cost AS [Cost], b.sale_open_close AS [Status] FROM SaleRV a JOIN Sale_DetailRV b ON a.sales_no = b.sale_no WHERE a.sale_date = ? AND b.sale_profit_ctr IN (${locs}) ORDER BY a.sale_date DESC`;
    runSql(sql, [String(date)])
      .then((j) => { if (alive) setState({ loading: false, rows: Array.isArray(j?.rows) ? j.rows : [], error: null }); })
      .catch((e) => { if (alive) setState({ loading: false, rows: [], error: e }); });
    return () => { alive = false; };
  }, [store, date]);
  return (
    <Modal title={`Sale Item Details ${storeLabel(store)}`} size="fullscreen" onClose={onClose}
      extra={state.rows.length > 0 && (
        <button type="button" className="btnx o-success sm" style={{ marginLeft: 12 }} title="Download Table as Excel"
          onClick={() => downloadCsv(state.rows, ITEM_COLS, `sale-items-${date}.csv`)}><FileSpreadsheet size={14} /></button>
      )}>
      {state.loading ? <div className="muted py-3">Loading…</div>
        : state.error ? <div className="t-danger py-3">Couldn't load items: {state.error.message}</div>
        : !state.rows.length ? <div className="muted py-3">No items found.</div>
        : (
          <table className="tbl hover custom cols">
            <thead className="primary"><tr>{ITEM_COLS.map((c) => <th key={c.key}>{c.label}</th>)}</tr></thead>
            <tbody>{state.rows.map((r, i) => <tr key={i}>{ITEM_COLS.map((c) => <td key={c.key}>{r[c.key] == null ? '' : String(r[c.key])}</td>)}</tr>)}</tbody>
          </table>
        )}
    </Modal>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SCRLegacy({ toggle }) {
  const qc = useQueryClient();
  const now = new Date();
  const cMonth = now.getMonth() + 1;
  const [store, setStoreRaw] = useState('ARDEN');
  const [category, setCategoryRaw] = useState('Written');
  const [monthNum, setMonthNum] = useState(cMonth);
  const [items, setItems] = useState(null);      // { date } for the drill-down
  const [mtdOpen, setMtdOpen] = useState(false);
  // Like the original, switching store / category resets to the current month.
  const setStore = (s) => { setStoreRaw(s); setMonthNum(cMonth); };
  const setCategory = (c) => { setCategoryRaw(c); setMonthNum(cMonth); };

  const monthObj = MONTHS[monthNum - 1];
  const month = monthObj.full;
  const graphDay = monthNum === cMonth ? now.getDate() - 1 : daysInMonth(monthNum, now.getFullYear());

  const dailyQ = useLegacy(['daily', store, category, month], async () => {
    const rows = await byStore(store, 'daily', { month, category }, { keys: ['DayMonth'], sum: ['LastYear', 'ThisYear'] });
    return store === CFC ? rebuildDayTotals(rows) : rows;
  });
  const graphQ = useLegacy(['graph', store, category, month, graphDay], async () => {
    const rows = await byStore(store, 'graph', { month, category, day: graphDay }, { keys: ['DayMonth'], sum: ['LastYear', 'ThisYear'] });
    return store === CFC ? rebuildDayTotals(rows) : rows;
  });
  const matrixQ = useLegacy(['matrix', store, category, month], async () => {
    const [avgRows, totalRows] = await Promise.all([
      byStore(store, 'avg', { month, category, day: now.getDate() }, { sum: ['salesLastYear', 'salesThisYear', 'avgSalesLastYear', 'avgSalesThisYear'] }),
      byStore(store, 'monthTotal', { month, category }, { sum: ['lastYearMonthTotal', 'thisYearMonthTotal'] }),
    ]);
    const ly = parseNumber(totalRows[0]?.lastYearMonthTotal), ty = parseNumber(totalRows[0]?.thisYearMonthTotal);
    const manual = await getMonthTarget(store, category, now.getFullYear(), monthNum);
    return { a: avgRows[0] || {}, ly, ty, target: manual || ly * 1.1, days: daysInMonth(monthNum, now.getFullYear()) };
  });
  const weeklyQ = useLegacy(['weekly', store, category, month],
    () => byStore(store, 'weekly', { month, category }, { keys: ['WeekGroup'], sum: ['LastYear', 'ThisYear', 'Difference'] }));
  const quarterQ = useLegacy(['quarter', store, category],
    () => byStore(store, 'quarter', { category }, { keys: ['MonthName'], sum: ['LastYear', 'ThisYear', 'Difference'] }));
  const monthwiseQ = useLegacy(['monthwise'], () => scrLegacyQuery('monthwise', {}));
  const mtdQ = useLegacy(['mtdCompare', store, category], async () => {
    const rows = await scrLegacyQuery('mtdCompare', { stores: storesFor(store), month: MONTHS[cMonth - 1].full, category });
    const r = rows[0];
    if (!r || r.CutOffDay == null) return null;
    return { cutOffDay: parseInt(r.CutOffDay, 10), lastYearMTD: parseFloat(r.LastYearMTD) || 0, thisYearMTD: parseFloat(r.ThisYearMTD) || 0 };
  });
  const yearlyQ = useLegacy(['yearly', store], async () => {
    const merge = { keys: ['Month'], sum: ['LastYear', 'ThisYear', 'Diff'] };
    const [w, d] = await Promise.all([
      byStore(store, 'yearly', { category: 'Written' }, merge),
      byStore(store, 'yearly', { category: 'Delivered' }, merge),
    ]);
    if (store === CFC) { rebuildChangePct(w); rebuildChangePct(d); }
    return { w, d };
  });
  const fourQ = useLegacy(['fourYears', store, category],
    () => byStore(store, 'fourYears', { category }, { keys: ['MonthName'], sum: ['ThisYear', 'LastYear', 'PreviousYear', 'Previous'] }));

  const report = useMemo(() => (monthwiseQ.data ? createReport(monthwiseQ.data, store, category) : null), [monthwiseQ.data, store, category]);

  const openItems = (dayMonth, key) => {
    const [day, mon] = String(dayMonth || '').split('-');
    const mm = MON_NUM[mon];
    if (!mm || !/^\d{2}$/.test(day)) return;
    const y = key === 'ThisYear' ? now.getFullYear() : now.getFullYear() - 1;
    setItems({ date: `${y}${mm}${day}` });
  };
  const refresh = () => qc.invalidateQueries({ queryKey: ['scr-legacy'] });

  const radio = (on, label, title, onClick, cls = 'o-success') => (
    <button type="button" title={title} onClick={onClick} className={cn('btnx', cls, on && 'on')}>{label}</button>
  );

  return (
    <>
      <Topbar title="Sales Comparison Report" subtitle={`${storeLabel(store)} · ${category} · ${month}`} rightActions={toggle} />
      <div className="scr-old">
        <style>{OLD_CSS}</style>
        <div className="wrap">
          {/* Header controls */}
          <div className="sticky-head">
            <div className="hdr">
              <div className="hdr-left">
                <h3>Sales Comparison Report</h3>
                <h5 className="t-primary">{storeLabel(store)}</h5>
                <h5>/</h5>
                <h5 className="t-primary">{category}</h5>
              </div>
              <div className="hdr-right">
                <button type="button" className="btnx o-secondary" title="Refresh Data" onClick={refresh}><RotateCcw size={15} /></button>
                <div className="vr" />
                <div className="grp">
                  {radio(store === 'ARDEN', 'S1', 'Store Arden', () => setStore('ARDEN'))}
                  {radio(store === 'WAYNESVILLE', 'S2', 'Store Waynesville', () => setStore('WAYNESVILLE'))}
                  {radio(store === CFC, 'CFC', 'Both Stores Combined', () => setStore(CFC))}
                </div>
                <div className="vr" />
                <div className="grp">
                  {radio(category === 'Written', 'W', 'Written Sales', () => setCategory('Written'))}
                  {radio(category === 'Delivered', 'D', 'Delivered Sales', () => setCategory('Delivered'))}
                </div>
              </div>
            </div>
            <div className="months">
              {MONTHS.map((m) => (
                <button key={m.number} type="button" title={m.full} onClick={() => setMonthNum(m.number)}
                  className={cn('btnx lg o-primary', monthNum === m.number && 'on')}>{m.short}</button>
              ))}
            </div>
          </div>

          {/* Sales comparison */}
          <div>
            <h4 className="sec">Sales Comparison (<span className="fw-semibold">{month}</span>)</h4>
            <div className="cmp">
              <div className="cmp-l">
                <Status q={dailyQ} empty={!dailyQ.isLoading && !dailyQ.error && !(dailyQ.data || []).length ? `No Records Found For ${month}` : null} />
                {(dailyQ.data || []).length > 0 && <DailyTable rows={dailyQ.data} onItems={openItems} />}
              </div>
              <div className="cmp-r">
                <Status q={matrixQ} />
                {matrixQ.data && <>
                  <Matrix m={matrixQ.data} monthObj={monthObj} />
                  <Donut target={matrixQ.data.target} sales={matrixQ.data.ty} />
                </>}
                {(graphQ.data || []).length > 0 ? <CumulativeChart rows={graphQ.data} month={month} /> : <Status q={graphQ} />}
              </div>
            </div>
          </div>
          <hr />

          {/* Weekly / quarterly */}
          <div>
            <h4 className="sec">Weekly / Quarterly Report </h4>
            <div className="two">
              <div>
                <p className="tc mb-2">Weekly Sales LastYear and ThisYear</p>
                <Status q={weeklyQ} />
                {(weeklyQ.data || []).length > 0 && <WeeklyTable rows={weeklyQ.data} />}
              </div>
              <div>
                <p className="tc mb-2">Quarterly Total of LastYear and ThisYear</p>
                <Status q={quarterQ} />
                {(quarterQ.data || []).length > 0 && <QuarterTable rows={quarterQ.data} />}
              </div>
            </div>
          </div>
          <hr />

          {/* Sales summary */}
          <div>
            <h4 className="sec" style={{ marginBottom: 0 }}>Sales Summary</h4>
            <div className="sumhead">
              <p>Month Wise Sales Summary</p>
              <button type="button" className="btn-link" onClick={() => setMtdOpen(true)}>Month_Till_Date</button>
            </div>
            <Status q={monthwiseQ} />
            {report && <div className="scrollx"><SummaryTable report={report} mtd={mtdQ.data} selShort={monthObj.short} /></div>}
          </div>
          <hr />

          {/* Yearly */}
          <div>
            <h4 className="sec">Yearly Report </h4>
            <Status q={yearlyQ} />
            {yearlyQ.data && (
              <div className="two">
                <div><p className="fw-bold tc">Written</p><YearlyTable rows={yearlyQ.data.w} selMonth={month} /></div>
                <div><p className="fw-bold tc">Delivered</p><YearlyTable rows={yearlyQ.data.d} selMonth={month} /></div>
              </div>
            )}
          </div>
          <hr />

          {/* 4 years */}
          <div>
            <h4 className="sec">4 Years Report </h4>
            <Status q={fourQ} />
            {(fourQ.data || []).length > 0 && <FourYearsTable rows={fourQ.data} selMonth={month} />}
          </div>
          <hr />

          <h4 className="sec">********** End of Report **********</h4>
        </div>
      </div>

      {items && <ItemsModal store={store} date={items.date} onClose={() => setItems(null)} />}
      {mtdOpen && <MonthTillDateModal store={store} category={category} onClose={() => setMtdOpen(false)} />}
    </>
  );
}

// Bootstrap-like styling scoped to the old design (the original page used
// Bootstrap 5 at an 85% base font size). Light + dark aware.
const OLD_CSS = `
.scr-old{--b:#dee2e6;--fg:#212529;--muted:#6c757d;--hover:rgba(0,0,0,.075);--sec:#cfe2ff;--warn:#fff3cd;--head:#fcfcfd;--primary-bg:#cfe2ff;
  font-size:13.6px;line-height:1.5;color:var(--fg);background:var(--head)}
.dark .scr-old{--b:#495057;--fg:#dee2e6;--muted:#adb5bd;--hover:rgba(255,255,255,.075);--sec:#031633;--warn:#332701;--head:#1a1d20;--primary-bg:#031633}
.scr-old .wrap{max-width:1320px;margin:0 auto;padding:0 12px 32px;display:flex;flex-direction:column;gap:20.4px}
.scr-old .sticky-head{position:sticky;top:4rem;z-index:5;background:var(--head);padding:6.8px 6.8px 20.4px}
.scr-old .hdr{display:flex;flex-wrap:wrap;gap:6.8px;border-bottom:1px solid var(--b);padding-bottom:6.8px}
.scr-old .hdr-left{display:flex;align-items:center;gap:6.8px;flex:1 1 480px}
.scr-old .hdr-left h3{margin-right:auto}
.scr-old .hdr-right{display:flex;align-items:center;justify-content:flex-end;gap:20.4px;flex:1 1 480px}
.scr-old .grp{display:flex;gap:4px}
.scr-old .vr{width:1px;align-self:stretch;min-height:28px;background:currentColor;opacity:.25}
.scr-old .months{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px;padding:6.8px 0;margin-top:6.8px}
.scr-old h3{font-size:23.8px;font-weight:500;margin:0;line-height:1.2}
.scr-old h5{font-size:17px;font-weight:500;margin:0;line-height:1.2}
.scr-old h4.sec{font-size:20.4px;font-weight:500;line-height:1.2;text-align:center;padding:6.8px 0;margin:0 0 20.4px;background:var(--sec)}
.scr-old hr{border:0;border-top:1px solid currentColor;opacity:.25;margin:0}
.scr-old p{margin:0 0 13.6px}.scr-old .mb-2{margin-bottom:6.8px}
.scr-old .small{font-size:.875em}.scr-old .muted{color:var(--muted)}.scr-old .py-3{padding:10px 0}
.scr-old .cmp{display:grid;gap:20px}
@media(min-width:992px){.scr-old .cmp{grid-template-columns:5fr 2fr 5fr}.scr-old .cmp-r{grid-column:3}}
.scr-old .cmp-r{display:flex;flex-direction:column;align-items:center;gap:6.8px}
.scr-old .two{display:grid;gap:24px}
@media(min-width:992px){.scr-old .two{grid-template-columns:40% 40%;justify-content:space-between}}
.scr-old .sumhead{display:flex;justify-content:space-between;align-items:center;gap:34px;margin:6.8px 0}
.scr-old .sumhead p{margin:0}
.scr-old .scrollx{overflow-x:auto}
.scr-old .legend{display:flex;justify-content:center;flex-wrap:wrap;gap:10px;font-size:12px;margin-top:2px}
.scr-old .legend i{display:inline-block;width:36px;height:11px;margin-right:6px;vertical-align:-1px}
.scr-old .btnx{display:inline-flex;align-items:center;gap:4px;padding:5.1px 10.2px;font-size:13.6px;line-height:1.5;border:2px solid;border-radius:5.1px;background:transparent;cursor:pointer;transition:background-color .15s,color .15s}
.scr-old .btnx.lg{padding:6.8px 13.6px;font-size:17px;border-radius:6.8px}
.scr-old .btnx.sm,.scr-old-modal .btnx.sm{padding:2px 8px;font-size:12px}
.scr-old .o-success,.scr-old-modal .o-success{color:#198754;border-color:#198754}
.scr-old .o-success:hover,.scr-old .o-success.on,.scr-old-modal .o-success:hover{color:#fff;background:#198754}
.scr-old .o-primary{color:#0d6efd;border-color:#0d6efd}
.scr-old .o-primary:hover,.scr-old .o-primary.on{color:#fff;background:#0d6efd}
.scr-old .o-secondary{color:#6c757d;border-color:#6c757d}
.scr-old .o-secondary:hover{color:#fff;background:#6c757d}
.scr-old .btn-link{color:#0d6efd;text-decoration:underline;background:none;border:0;padding:5px 10px;cursor:pointer;font-size:13.6px}
.scr-old table.tbl,.scr-old-modal table.tbl{width:100%;border-collapse:collapse;margin-bottom:6.8px;color:var(--fg)}
.scr-old table.tbl>*>tr>*,.scr-old-modal table.tbl>*>tr>*{padding:3.4px;border-bottom:1px solid var(--b);vertical-align:middle}
.scr-old table.tbl thead th,.scr-old-modal table.tbl thead th{font-weight:700;text-align:left;vertical-align:bottom}
.scr-old table.tbl.custom thead th{vertical-align:top}
.scr-old table.tbl tbody.divider>tr:first-child>*,.scr-old-modal table.tbl tbody.divider>tr:first-child>*{border-top:2px solid currentColor}
.scr-old table.tbl.hover tbody tr:hover>*,.scr-old-modal table.tbl.hover tbody tr:hover>*{box-shadow:inset 0 0 0 9999px var(--hover)}
.scr-old table.cols>*>tr>*:not(:last-child),.scr-old-modal table.cols>*>tr>*:not(:last-child){border-right:1px solid #ccc}
.dark .scr-old table.cols>*>tr>*:not(:last-child){border-right-color:#495057}
.scr-old-modal thead.primary th{background:var(--primary-bg)}
.scr-old .te,.scr-old-modal .te{text-align:right}.scr-old .tc,.scr-old-modal .tc{text-align:center}
.scr-old .fw-bold,.scr-old-modal .fw-bold{font-weight:700}.scr-old .fw-semibold{font-weight:600}
.scr-old .t-green,.scr-old-modal .t-green{color:#26ba00!important}
.scr-old .t-greenone,.scr-old-modal .t-greenone{color:rgb(27,178,87)!important}
.scr-old .t-red,.scr-old-modal .t-red{color:red!important}
.scr-old .t-danger,.scr-old-modal .t-danger{color:#dc3545!important}
.scr-old .t-primary{color:#0d6efd!important}
.scr-old .bg-warn{background-color:var(--warn)!important}
.scr-old .bg-hl{background-color:#ffe67d!important;color:#212529}
.scr-old .million{background:linear-gradient(180deg,#d8f8e7 0%,#c3f2da 100%)!important;color:#0b6b3a!important;font-weight:600;box-shadow:inset 0 0 0 1px rgba(16,133,82,.28)}
.scr-old .arrow{margin-left:6px;font-size:.8em;font-weight:bold;white-space:nowrap}
.scr-old .arrow.up{color:#26ba00!important}.scr-old .arrow.down{color:red!important}
.scr-old .role-btn{cursor:pointer}
.scr-old .mtd-cell{cursor:help}.scr-old .mtd-mark{margin-left:2px;font-size:.9em;color:#6c757d}
.scr-old td.tbl-selected{background-color:rgba(13,110,253,.9)!important;color:#fff!important}
.scr-old th.tbl-col-selected{background-color:rgba(13,110,253,.08)!important}
.scr-old-infobar{position:fixed;left:16px;right:16px;bottom:14px;z-index:1100;padding:14px 8px;border-radius:6px;background:#6c757d;color:#fff;box-shadow:0 1rem 3rem rgba(0,0,0,.175);font-size:13.6px;text-align:center}
.scr-old-modal{--b:#dee2e6;--fg:#212529;--muted:#6c757d;--hover:rgba(0,0,0,.075);--primary-bg:#cfe2ff;position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.5);display:flex;align-items:flex-start;justify-content:center;padding:28px 12px;font-size:13.6px;color:var(--fg)}
.dark .scr-old-modal{--b:#495057;--fg:#dee2e6;--muted:#adb5bd;--hover:rgba(255,255,255,.075);--primary-bg:#031633}
.scr-old-modal .dialog{background:#fff;border-radius:8px;width:100%;max-width:800px;max-height:calc(100vh - 56px);display:flex;flex-direction:column;box-shadow:0 .5rem 1rem rgba(0,0,0,.15)}
.dark .scr-old-modal .dialog{background:#212529}
.scr-old-modal .dialog.full{max-width:none;height:calc(100vh - 56px)}
.scr-old-modal .mhead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--b)}
.scr-old-modal .mhead h5{font-size:17px;font-weight:500;margin:0;display:flex;align-items:center}
.scr-old-modal .mclose{border:0;background:none;cursor:pointer;color:var(--muted)}
.scr-old-modal .mbody{padding:0 16px 12px;overflow:auto}
.scr-old-modal .muted{color:var(--muted)}.scr-old-modal .py-3{padding:10px 0}
`;
