import { useQuery } from '@tanstack/react-query';
import { keycloak, getToken, login, logout } from '@/auth/keycloak';

// Once a 401-driven forced logout is in flight, don't fire more of them —
// otherwise every parallel query would trigger its own logout and thrash.
let forcedLogoutInFlight = false;

// authFetch — wraps fetch() with the current access token (auto-refreshed
// if within 30s of expiry). On 401:
//   - If we have an authenticated Keycloak session, the token was rejected
//     (stale issuer, revoked, clock skew, etc.). Force a full logout so
//     the SSO cookie is dropped and the next visit gets a clean login.
//   - If we're not authenticated, kick off a fresh login.
async function authFetch(input, init = {}) {
  const token = await getToken(30);
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 401) {
    if (!forcedLogoutInFlight) {
      forcedLogoutInFlight = true;
      const body = await res.clone().json().catch(() => ({}));
      const detail = [body.error, body.reason].filter(Boolean).join(' — ') || 'unknown';
      console.warn(`[auth] server rejected token, forcing logout — ${detail}`);
      if (keycloak.authenticated) logout();
      else login();
    }
    throw new Error('session expired');
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
