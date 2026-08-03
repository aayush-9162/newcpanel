// Role definitions + per-role page permissions, persisted to
// server/data/roles.json. Managed from the /admin "Roles & Permissions" panel.
//
// A role = { id, label, allowAll?, system?, routes[] }
//   - allowAll: true  → full access (the admin role). `routes` is ignored.
//   - routes: string[] → the route paths this role may open.
//   - system: true    → built-in; cannot be deleted or renamed.
//
// Quick Access ('/') is always accessible and User Management ('/admin') is
// always admin-only — neither is stored per-role (see the frontend guard).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE     = join(DATA_DIR, 'roles.json');

// Seeded if the file is missing — mirrors the original hard-coded RBAC.
const SEED = {
  roles: [
    { id: 'admin', label: 'Admin', system: true, allowAll: true, routes: [] },
    { id: 'manager', label: 'Manager', routes: ['/scr', '/item-sold-analysis', '/sales/performance', '/fms', '/disco', '/mpr', '/dmgsummary', '/leads', '/pickup/new', '/hot-button-issues', '/mpf', '/spf', '/pbf', '/damage/create', '/mrf'] },
    { id: 'viewer', label: 'Viewer', routes: ['/dashboard', '/item-sold-analysis', '/sales/performance', '/fms', '/disco', '/mpr', '/dmgsummary', '/leads', '/pickup/new', '/hot-button-issues', '/mpf', '/spf', '/pbf', '/damage/create', '/mrf'] },
    { id: 'salesperson', label: 'Salesperson', routes: ['/sales/performance', '/fms', '/disco', '/mpf', '/spf', '/pbf', '/damage/create', '/mrf'] },
  ],
};

const slug = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify(SEED, null, 2));
}

export function readRoles() {
  ensureFile();
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'));
    const list = Array.isArray(raw?.roles) ? raw.roles : [];
    return list
      .filter((r) => r && r.id)
      .map((r) => ({
        id: slug(r.id),
        label: r.label || r.id,
        system: !!r.system,
        allowAll: !!r.allowAll,
        routes: Array.isArray(r.routes) ? [...new Set(r.routes.map(String))] : [],
      }));
  } catch {
    return SEED.roles;
  }
}

function writeRoles(list) {
  ensureFile();
  writeFileSync(FILE, JSON.stringify({ roles: list }, null, 2));
  return list;
}

export function roleIds() {
  return readRoles().map((r) => r.id);
}

export function getRole(id) {
  const i = slug(id);
  return readRoles().find((r) => r.id === i) || null;
}

// The route paths a role may open. '*' means everything (admin/allowAll).
export function allowedRoutesFor(roleId) {
  const r = getRole(roleId);
  if (!r) return [];
  if (r.allowAll) return '*';
  return r.routes || [];
}

// Create or update a role. Only label/allowAll/routes are mutable; a system
// role's id and system flag are preserved. Returns the saved role.
export function upsertRole({ id, label, routes, allowAll }) {
  const rid = slug(id);
  if (!rid) throw new Error('a role id/name is required');
  const list = readRoles();
  const existing = list.find((r) => r.id === rid);
  if (existing) {
    if (label != null) existing.label = label;
    if (Array.isArray(routes)) existing.routes = [...new Set(routes.map(String))];
    if (!existing.system && allowAll != null) existing.allowAll = !!allowAll;
  } else {
    list.push({ id: rid, label: label || rid, system: false, allowAll: !!allowAll, routes: Array.isArray(routes) ? [...new Set(routes.map(String))] : [] });
  }
  writeRoles(list);
  return list.find((r) => r.id === rid);
}

// Delete a non-system role. Users on it fall back to the default role on their
// next request (see users.resolveUser). Returns true if removed.
export function deleteRole(id) {
  const rid = slug(id);
  const list = readRoles();
  const target = list.find((r) => r.id === rid);
  if (!target || target.system) return false;
  const next = list.filter((r) => r.id !== rid);
  writeRoles(next);
  return true;
}
