// JWT verification middleware for Keycloak-issued tokens.
//
// Verifies every incoming Bearer token against Keycloak's JWKS endpoint.
// Validates issuer + signature + expiry. Attaches { sub, username, email,
// roles } to `req.user` on success; returns 401 on failure.
//
// Env (read from server/.env via dotenv in index.js):
//   KEYCLOAK_URL    e.g. http://localhost:8080
//   KEYCLOAK_REALM  e.g. cfc
//
// Optional helpers:
//   requireAuth     — must be authenticated (any role).
//   requireRole(r)  — must be authenticated AND have realm role `r` (or any of `r` if array).

import { createRemoteJWKSet, jwtVerify } from 'jose';

const KC_URL   = (process.env.KEYCLOAK_URL   || 'http://localhost:8080').replace(/\/+$/, '');
const KC_REALM =  process.env.KEYCLOAK_REALM || 'cfc';

const ISSUER       = `${KC_URL}/realms/${KC_REALM}`;
const JWKS_URL     = new URL(`${ISSUER}/protocol/openid-connect/certs`);
// createRemoteJWKSet caches keys in memory and refreshes on key-rotation.
const JWKS = createRemoteJWKSet(JWKS_URL, { cooldownDuration: 30_000, cacheMaxAge: 600_000 });

function extractBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

async function verify(token) {
  // Don't pin audience — Keycloak's default access tokens use the client_id as
  // `azp` rather than `aud`. Issuer + signature + expiry is sufficient.
  const { payload } = await jwtVerify(token, JWKS, { issuer: ISSUER });
  return payload;
}

// `requireAuth` — must be authenticated. On success, attaches:
//   req.user = { sub, username, email, name, roles, raw }
export async function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  try {
    const p = await verify(token);
    req.user = {
      sub:      p.sub,
      username: p.preferred_username,
      email:    p.email,
      name:     p.name,
      roles:    Array.isArray(p.roles) ? p.roles
                : Array.isArray(p.realm_access?.roles) ? p.realm_access.roles
                : [],
      raw:      p,
    };
    next();
  } catch (err) {
    res.status(401).json({ error: 'invalid token', reason: err.message });
  }
}

// `requireRole('admin')` or `requireRole(['admin', 'manager'])`.
// Use AFTER requireAuth in the middleware chain.
export function requireRole(role) {
  const wanted = Array.isArray(role) ? role : [role];
  return (req, res, next) => {
    const have = req.user?.roles || [];
    if (!wanted.some((r) => have.includes(r))) {
      return res.status(403).json({ error: 'forbidden', need: wanted, have });
    }
    next();
  };
}
