import 'dotenv/config';
import sql from 'mssql';

// Hybrid data layer:
//   - MS SQL  (CFC_AUTO_DB) → DIRECT connection via `mssql`. Bypasses the
//     upstream service so it keeps working even when that service is down.
//   - MySQL   (db_cfc)      → forwarded to the upstream HTTP API
//     (UPSTREAM_URL/api/mysql/select), which is working fine.
//
// Credentials / URL live in server/.env. The SELECT-only guard in
// sqlGuard.js still runs (in index.js) before any query reaches here.

// ─── MS SQL ─────────────────────────────────────────────────────────────────
const mssqlConfig = {
  server:   process.env.MSSQL_HOST     || '192.168.68.8',
  port:     Number(process.env.MSSQL_PORT || 1433),
  database: process.env.MSSQL_DATABASE || 'CFC_AUTO_DB',
  user:     process.env.MSSQL_USER     || '',
  password: process.env.MSSQL_PASSWORD || '',
  options: {
    encrypt: String(process.env.MSSQL_ENCRYPT ?? 'true') === 'true',
    trustServerCertificate: String(process.env.MSSQL_TRUST_SERVER_CERT ?? 'true') === 'true',
    enableArithAbort: true,
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
  connectionTimeout: 15_000,
  requestTimeout: Number(process.env.DB_QUERY_TIMEOUT_MS || 30_000),
};

let mssqlPoolPromise = null;
function getMssqlPool() {
  if (!mssqlPoolPromise) {
    mssqlPoolPromise = new sql.ConnectionPool(mssqlConfig)
      .connect()
      .then((pool) => {
        console.log(`[db] MS SQL connected → ${mssqlConfig.server}:${mssqlConfig.port}/${mssqlConfig.database}`);
        pool.on('error', (e) => {
          console.error('[db] MS SQL pool error:', e.message);
          mssqlPoolPromise = null; // force reconnect on next query
        });
        return pool;
      })
      .catch((e) => {
        mssqlPoolPromise = null;   // let the next call retry a fresh connect
        throw e;
      });
  }
  return mssqlPoolPromise;
}

// Errors that mean "the pool/connection is dead" — worth dropping it and
// reconnecting rather than failing every subsequent request.
const CONN_ERROR_CODES = new Set([
  'ELOGIN', 'ECONNCLOSED', 'ECONNRESET', 'ESOCKET', 'ETIMEOUT', 'ENOTOPEN', 'EABORT',
]);
function isConnError(err) {
  return CONN_ERROR_CODES.has(err?.code) || /closed|not connected|socket|login/i.test(err?.message || '');
}

async function runSqlOnce(qry, values) {
  const pool = await getMssqlPool();
  const request = pool.request();
  let i = 0;
  const converted = qry.replace(/\?/g, () => {
    const name = `p${i}`;
    request.input(name, values[i]);
    i += 1;
    return `@${name}`;
  });
  const result = await request.query(converted);
  return { data: result.recordset || [] };
}

// MS SQL — main warehouse (CFC_AUTO_DB). If the cached pool has gone stale
// (e.g. the DB briefly locked the login), drop it and reconnect once so we
// self-heal instead of 502-ing every request until a manual restart.
export async function runSql(qry, values = []) {
  try {
    return await runSqlOnce(qry, values);
  } catch (err) {
    if (!isConnError(err)) throw err;
    console.warn('[db] MS SQL query failed on a stale pool — reconnecting:', err.message);
    try { const p = await mssqlPoolPromise; await p?.close(); } catch { /* ignore */ }
    mssqlPoolPromise = null;          // force a fresh connect
    return await runSqlOnce(qry, values);   // one retry on a new pool
  }
}

// ─── MySQL — forwarded to the upstream HTTP API ─────────────────────────────
const UPSTREAM_URL = process.env.UPSTREAM_URL || 'http://192.168.68.8:3000';
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 15_000);

// MySQL — application DB (db_cfc) where managers / leads / damages / etc. live.
// Still served by the upstream service (which is working), so we forward.
export async function runMysql(qry, values = []) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(`${UPSTREAM_URL}/api/mysql/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qry, values }),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`upstream ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`upstream MySQL timeout after ${UPSTREAM_TIMEOUT_MS}ms (${UPSTREAM_URL})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
