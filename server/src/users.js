// Email → role store, persisted to server/data/users.json.
//
// This is the whole access-control list: an email must appear here (with a
// role) to be allowed into the app. The /admin page reads and writes it
// through the admin API; sign-in (auth.js) looks a user up here after Google
// verifies their identity.
//
// Roles are single-valued per user. The frontend RBAC works on arrays, so a
// user's role is exposed as roles: [role].

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const FILE     = join(DATA_DIR, 'users.json');

// The roles the app understands. Kept in sync with web/src/routes.js.
export const ROLES = ['admin', 'manager', 'salesperson', 'viewer'];

// The role a signed-in user gets when their email is NOT explicitly listed.
// Anyone who can sign in but hasn't been assigned a role lands here.
// Override with DEFAULT_ROLE in server/.env (must be one of ROLES).
export const DEFAULT_ROLE = ROLES.includes(process.env.DEFAULT_ROLE)
  ? process.env.DEFAULT_ROLE
  : 'salesperson';

const norm = (e) => String(e || '').trim().toLowerCase();

function ensureFile() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(FILE)) writeFileSync(FILE, JSON.stringify({ users: [] }, null, 2));
}

// Returns the full user list: [{ email, name, role }]
export function readUsers() {
  ensureFile();
  try {
    const raw = JSON.parse(readFileSync(FILE, 'utf8'));
    const list = Array.isArray(raw?.users) ? raw.users : [];
    return list
      .filter((u) => u && u.email)
      .map((u) => ({ email: norm(u.email), name: u.name || '', role: ROLES.includes(u.role) ? u.role : 'viewer' }));
  } catch {
    return [];
  }
}

function writeUsers(list) {
  ensureFile();
  writeFileSync(FILE, JSON.stringify({ users: list }, null, 2));
  return list;
}

// Look up a single user by email (case-insensitive). null if not explicitly
// listed. Use this when you need to know whether a role was ASSIGNED.
export function findUser(email) {
  const e = norm(email);
  return readUsers().find((u) => u.email === e) || null;
}

// Effective identity for any signed-in email. Returns the explicit record if
// present, otherwise a synthetic one carrying DEFAULT_ROLE. Never returns null,
// so signing in always yields at least the default role. `assigned` tells the
// caller whether the role came from the store or the fallback.
export function resolveUser(email, fallbackName = '') {
  const rec = findUser(email);
  if (rec) return { ...rec, assigned: true };
  return { email: norm(email), name: fallbackName || '', role: DEFAULT_ROLE, assigned: false };
}

// Like resolveUser, but PERSISTS a first-time user with the default role so
// they show up in the access list (and can be promoted from /admin). Called at
// sign-in. Existing users are returned untouched. `created` flags a new record.
export function ensureUser(email, name = '') {
  const rec = findUser(email);
  if (rec) return { ...rec, created: false };
  const saved = upsertUser({ email, name, role: DEFAULT_ROLE });
  return { ...saved, created: true };
}

// Add or update a user. Returns the saved record. Throws on bad input.
export function upsertUser({ email, name, role }) {
  const e = norm(email);
  if (!e || !e.includes('@')) throw new Error('a valid email is required');
  if (!ROLES.includes(role)) throw new Error(`role must be one of: ${ROLES.join(', ')}`);
  const list = readUsers();
  const existing = list.find((u) => u.email === e);
  if (existing) {
    existing.role = role;
    if (name != null) existing.name = name;
  } else {
    list.push({ email: e, name: name || '', role });
  }
  writeUsers(list);
  return list.find((u) => u.email === e);
}

// Remove a user by email. Returns true if one was removed.
export function removeUser(email) {
  const e = norm(email);
  const list = readUsers();
  const next = list.filter((u) => u.email !== e);
  if (next.length === list.length) return false;
  writeUsers(next);
  return true;
}
