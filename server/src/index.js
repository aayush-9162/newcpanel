import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { queries } from './queries/index.js';
import { runSql, runMysql } from './upstream.js';
import { checkSelectOnly } from './sqlGuard.js';
import { requireAuth } from './auth.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Public — no auth required.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, queries: Object.keys(queries) });
});

// Protected from here on. Every /api/* route below requires a valid
// Keycloak-issued Bearer token.
app.use('/api', requireAuth);

app.get('/api/queries', (_req, res) => {
  res.json({ queries: Object.keys(queries) });
});

const cache = new Map();
const TTL_MS = 5_000;

// Named-query endpoint: every entry in queries/index.js. Used for any mutation
// (create*/update*/delete*) and for curated reports.
app.post('/api/q/:name', async (req, res) => {
  const name = req.params.name;
  const def = queries[name];
  if (!def) return res.status(404).json({ error: `unknown query: ${name}` });

  const parsed = def.params.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid params', issues: parsed.error.issues });
  }

  const { qry, values } = def.build(parsed.data);
  const key = `${name}::${JSON.stringify(values)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return res.json(hit.payload);

  try {
    const result = await runSql(qry, values);
    const payload = { name, count: result.data.length, rows: result.data };
    cache.set(key, { at: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    res.status(502).json({ error: 'upstream error', message: err.message });
  }
});

// Hardened raw-SQL passthrough — SELECT/WITH only, no semicolons, no
// INSERT/UPDATE/DELETE/DROP/ALTER/EXEC/etc. Intended for ad-hoc report queries
// that mirror the original cpanel's `key:'na'` pattern.
app.post('/api/sql', async (req, res) => {
  const { qry, values = [] } = req.body ?? {};
  const reason = checkSelectOnly(qry);
  if (reason) return res.status(400).json({ error: 'rejected', reason });
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array' });

  try {
    const result = await runSql(qry, values);
    res.json({ count: result.data.length, rows: result.data });
  } catch (err) {
    res.status(502).json({ error: 'upstream error', message: err.message });
  }
});

// Same hardened guard, but forwards to the upstream MySQL endpoint instead
// (db_cfc — where managers, leads, damages, helped-by-manager etc. live).
app.post('/api/mysql', async (req, res) => {
  const { qry, values = [] } = req.body ?? {};
  const reason = checkSelectOnly(qry);
  if (reason) return res.status(400).json({ error: 'rejected', reason });
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array' });

  try {
    const result = await runMysql(qry, values);
    res.json({ count: result.data.length, rows: result.data });
  } catch (err) {
    res.status(502).json({ error: 'upstream error', message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  console.log(`[server] upstream: ${process.env.UPSTREAM_URL || 'http://192.168.64.8:3000'}`);
  console.log(`[server] ${Object.keys(queries).length} named queries + hardened /api/sql passthrough`);
});
