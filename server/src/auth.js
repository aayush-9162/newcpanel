// Authentication — Google Sign-In + our own short-lived session token.
//
// Flow:
//   1) Browser signs in with Google (GIS) and gets a Google ID token.
//   2) POST /api/auth/google { credential } — we verify that ID token against
//      Google's public keys, then look the email up in the users.json store.
//      If allow-listed, we mint OUR OWN app token (HS256, 12h) carrying the
//      identity (email/name/picture).
//   3) Every /api/* request sends that app token as a Bearer. requireAuth
//      verifies it and re-reads the CURRENT role from the store on each call,
//      so an admin's role change takes effect immediately (no re-login).
//
// Env (server/.env):
//   GOOGLE_CLIENT_ID  — the OAuth client id the browser used (token audience)
//   APP_JWT_SECRET    — secret for signing our app tokens

import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { resolveUser } from './users.js';
import { allowedRoutesFor } from './roles.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const APP_JWT_SECRET   = new TextEncoder().encode(
  process.env.APP_JWT_SECRET || 'dev-insecure-secret-change-me',
);

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
// Google's rotating public keys. jose caches + refreshes automatically.
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

// Verify a Google ID token (the `credential` from GIS). Returns the verified
// identity; throws if the token is invalid, expired, or for another client.
export async function verifyGoogleCredential(credential) {
  if (!credential) throw new Error('missing credential');
  const opts = { issuer: GOOGLE_ISSUERS };
  if (GOOGLE_CLIENT_ID) opts.audience = GOOGLE_CLIENT_ID; // pin to our client
  const { payload } = await jwtVerify(credential, GOOGLE_JWKS, opts);
  if (payload.email_verified === false) throw new Error('email not verified by Google');
  return {
    email:   String(payload.email || '').trim().toLowerCase(),
    name:    payload.name || '',
    picture: payload.picture || '',
  };
}

// Mint our own session token. Identity only — the role is looked up live on
// every request, so we don't bake a stale role into a 12h token.
export async function issueAppToken({ email, name, picture }) {
  return await new SignJWT({ email, name, picture })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(APP_JWT_SECRET);
}

function extractBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

// requireAuth — validates our app token AND confirms the email is still
// allow-listed. Attaches req.user = { email, name, role, roles, picture }.
export async function requireAuth(req, res, next) {
  const token = extractBearer(req);
  if (!token) return res.status(401).json({ error: 'missing bearer token' });

  let payload;
  try {
    ({ payload } = await jwtVerify(token, APP_JWT_SECRET));
  } catch (err) {
    return res.status(401).json({ error: 'invalid session', reason: err.message });
  }

  // Live role lookup — the store is the source of truth. An email that isn't
  // explicitly assigned resolves to the default role (salesperson), so a valid
  // signed-in user always has at least that access.
  const record = resolveUser(payload.email, payload.name);
  req.user = {
    email:   record.email,
    name:    record.name || payload.name || '',
    picture: payload.picture || '',
    role:    record.role,
    roles:   [record.role],
    allowedRoutes: allowedRoutesFor(record.role),  // '*' or string[]
  };
  next();
}

// requireRole('admin') or requireRole(['admin','manager']). Use after requireAuth.
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
