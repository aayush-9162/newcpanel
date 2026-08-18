import { useQuery } from '@tanstack/react-query';
import { getStoredToken, clearStoredToken } from '@/auth/session';

// Once a forced logout is in flight, don't fire more — otherwise every
// parallel query would trigger its own reload and thrash.
let forcedLogoutInFlight = false;

// authFetch — wraps fetch() with our app session token as a Bearer.
// A dead session (401, or a 403 that means the email was removed from the
// access list) clears the token and reloads so <AuthProvider> shows the login
// screen. A plain 403 "forbidden" (wrong role for an admin endpoint) is passed
// through for the caller to handle.
async function authFetch(input, init = {}) {
  const token = getStoredToken();
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 401 || res.status === 403) {
    const body = await res.clone().json().catch(() => ({}));
    const sessionDead = res.status === 401 || body?.error === 'not authorized';
    if (sessionDead) {
      if (!forcedLogoutInFlight) {
        forcedLogoutInFlight = true;
        console.warn('[auth] session rejected, signing out');
        clearStoredToken();
        window.location.reload();
      }
      throw new Error('session expired');
    }
  }
  return res;
}

// Named-query call — server resolves the SQL from the catalog.
// Used for mutations and curated reports.
export async function runQuery(name, params = {}) {
  const res = await authFetch(`/api/q/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Query ${name} failed (${res.status})`);
  }
  return res.json();
}

async function postQuery(path, qry, values) {
  const res = await authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ qry, values }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.reason || json.message || `SQL failed (${res.status})`);
  return json;
}

// Hardened raw-SQL passthrough — SELECT-only, server-side enforced.
// /api/sql  → MS SQL (CFC_AUTO_DB) — sales/inventory data warehouse
// /api/mysql → MySQL (db_cfc)      — application data: managers, leads, etc.
export const runSql   = (qry, values = []) => postQuery('/api/sql',   qry, values);
export const runMysql = (qry, values = []) => postQuery('/api/mysql', qry, values);

export function useReportQuery(name, params = {}, options = {}) {
  return useQuery({
    queryKey: [name, params],
    queryFn: () => runQuery(name, params),
    ...options,
  });
}

// Hook variant for raw SQL. The cache key is the SQL+values pair; pass
// `enabled:false` to defer until inputs are ready.
export function useSqlQuery(qry, values = [], options = {}) {
  return useQuery({
    queryKey: ['sql', qry, values],
    queryFn: () => runSql(qry, values),
    ...options,
  });
}

export function useMysqlQuery(qry, values = [], options = {}) {
  return useQuery({
    queryKey: ['mysql', qry, values],
    queryFn: () => runMysql(qry, values),
    ...options,
  });
}

// Clear the server-side SQL result cache (header Refresh button). Best-effort.
export async function clearServerCache() {
  try { await authFetch('/api/cache/clear', { method: 'POST' }); } catch { /* ignore */ }
}

// CFC Analytics Module (UPS / floor-conversion) — proxied server-side.
// `path` is the analytics subpath, e.g. 'legacy-ups/conversion/salesperson'.
export async function analyticsGet(path, params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const qs = new URLSearchParams(clean).toString();
  const res = await authFetch(`/api/analytics/${path}${qs ? `?${qs}` : ''}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.message || json.error || `Analytics request failed (${res.status})`);
  return json;
}

// Hook variant — cache key is the path+params pair.
export function useAnalyticsQuery(path, params = {}, options = {}) {
  return useQuery({
    queryKey: ['analytics', path, params],
    queryFn: () => analyticsGet(path, params),
    ...options,
  });
}

// ─── Admin: manage the email → role access list (admin only) ────────────────
export async function adminListUsers() {
  const res = await authFetch('/api/admin/users');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.reason || json.error || 'Failed to load users');
  return json; // { roles: [...], users: [{ email, name, role }] }
}

export async function adminSaveUser({ email, name, role }) {
  const res = await authFetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, role }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.reason || json.error || 'Save failed');
  return json.user;
}

export async function adminDeleteUser(email) {
  const res = await authFetch('/api/admin/users', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Delete failed');
  return json;
}

// ─── Tracker Report — suspicious visits for a date (proxied server-side) ────
export async function getTrackerReport(date) {
  const res = await authFetch(`/api/tracker/suspicious?date=${encodeURIComponent(date)}`);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || `Tracker request failed (${res.status})`);
  return json; // { date, count, visits: [...] }
}

// ─── Admin: manage roles + their page permissions (admin only) ──────────────
export async function adminListRoles() {
  const res = await authFetch('/api/admin/roles');
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.reason || json.error || 'Failed to load roles');
  return json.roles || [];
}

export async function adminSaveRole({ id, label, routes, allowAll }) {
  const res = await authFetch('/api/admin/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, label, routes, allowAll }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.reason || json.error || 'Save failed');
  return json.role;
}

export async function adminDeleteRole(id) {
  const res = await authFetch('/api/admin/roles', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'Delete failed');
  return json;
}
