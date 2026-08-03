import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { queries } from './queries/index.js';
import { runSql, runMysql } from './upstream.js';
import { checkSelectOnly } from './sqlGuard.js';
import { requireAuth, requireRole, verifyGoogleCredential, issueAppToken } from './auth.js';
import { ensureUser, readUsers, upsertUser, removeUser } from './users.js';
import { readRoles, upsertRole, deleteRole, allowedRoutesFor } from './roles.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built React app (produced by `npm --workspace web run build` → server/public).
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
const PORT = Number(process.env.PORT || 1215);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Public — no auth required.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, queries: Object.keys(queries) });
});

// Public — sign-in. Verify the Google ID token, confirm the email is
// allow-listed, and mint our own app session token.
app.post('/api/auth/google', async (req, res) => {
  const { credential } = req.body ?? {};
  let identity;
  try {
    identity = await verifyGoogleCredential(credential);
  } catch (err) {
    return res.status(401).json({ error: 'google verification failed', reason: err.message });
  }
  // Unlisted emails are allowed in and CREATED in the store with the default
  // role (salesperson) rather than rejected — so they appear on the /admin page
  // where an admin can raise their role.
  const record = ensureUser(identity.email, identity.name);
  const token = await issueAppToken(identity);
  res.json({
    token,
    user: {
      email:   record.email,
      name:    record.name || identity.name,
      picture: identity.picture,
      role:    record.role,
      roles:   [record.role],
      allowedRoutes: allowedRoutesFor(record.role),
    },
  });
});

// Protected from here on. Every /api/* route below requires a valid app token.
app.use('/api', requireAuth);

// Who am I — returns the current user with their LIVE role (used by the
// frontend to validate a stored token on load and to refresh roles).
app.get('/api/auth/me', (req, res) => {
  res.json({ user: req.user });
});

// ─── Admin: manage the email → role allow-list (admin only) ─────────────────
app.get('/api/admin/users', requireRole('admin'), (_req, res) => {
  res.json({ roles: readRoles(), users: readUsers() });
});

app.post('/api/admin/users', requireRole('admin'), (req, res) => {
  const { email, name, role } = req.body ?? {};
  try {
    const saved = upsertUser({ email, name, role });
    res.json({ ok: true, user: saved });
  } catch (err) {
    res.status(400).json({ error: 'invalid', reason: err.message });
  }
});

app.delete('/api/admin/users', requireRole('admin'), (req, res) => {
  const email = String(req.body?.email || req.query?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email required' });
  if (email === req.user.email) {
    return res.status(400).json({ error: 'you cannot remove your own admin access' });
  }
  const removed = removeUser(email);
  res.json({ ok: removed, removed });
});

// ─── Admin: manage roles + their page permissions (admin only) ──────────────
app.get('/api/admin/roles', requireRole('admin'), (_req, res) => {
  res.json({ roles: readRoles() });
});

// Create or update a role: { id, label, routes:[...], allowAll? }
app.post('/api/admin/roles', requireRole('admin'), (req, res) => {
  const { id, label, routes, allowAll } = req.body ?? {};
  try {
    const saved = upsertRole({ id, label, routes, allowAll });
    res.json({ ok: true, role: saved });
  } catch (err) {
    res.status(400).json({ error: 'invalid', reason: err.message });
  }
});

// Delete a non-system role. Users on it drop to the default role.
app.delete('/api/admin/roles', requireRole('admin'), (req, res) => {
  const id = String(req.body?.id || req.query?.id || '').trim().toLowerCase();
  if (!id) return res.status(400).json({ error: 'role id required' });
  if (id === req.user.role) {
    return res.status(400).json({ error: 'you cannot delete the role you are signed in with' });
  }
  const removed = deleteRole(id);
  if (!removed) return res.status(400).json({ error: 'role not found or is a system role' });
  res.json({ ok: true });
});

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

// ─── Serve the built React app (production) ─────────────────────────────────
// Static assets first, then an SPA fallback so client-side routes (e.g.
// /dashboard) resolve on a hard refresh. /api/* is excluded so unmatched API
// calls still 404 instead of returning index.html.
if (existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
}

// Bind to 0.0.0.0 so the app is reachable at the machine's LAN IP.
app.listen(PORT, '0.0.0.0', () => {
  const built = existsSync(PUBLIC_DIR);
  console.log(`[server] listening on http://0.0.0.0:${PORT}  (open at http://<this-ip>:${PORT})`);
  console.log(`[server] web app: ${built ? `serving built UI from ${PUBLIC_DIR}` : 'NOT built — run: npm --workspace web run build'}`);
  console.log(`[server] MySQL upstream: ${process.env.UPSTREAM_URL || '(unset)'}`);
  console.log(`[server] ${Object.keys(queries).length} named queries + hardened /api/sql passthrough`);
});
