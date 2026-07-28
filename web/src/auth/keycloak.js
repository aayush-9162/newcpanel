// Singleton Keycloak adapter for the cpanel SPA.
//
// One instance for the whole app — created at module load, initialized once
// in <AuthProvider>. Exposes helpers used elsewhere:
//   - getToken()      — current access token (auto-refreshes if near expiry)
//   - getRoles()      — realm roles parsed from the token
//   - hasRole(name)   — boolean
//   - login() / logout()
//
// Config comes from Vite env vars (set in web/.env). Defaults match the
// SSO docker-compose at C:\Users\aayus\Desktop\test\sso.

import Keycloak from 'keycloak-js';

const URL    = import.meta.env.VITE_KEYCLOAK_URL    || 'http://localhost:8080';
const REALM  = import.meta.env.VITE_KEYCLOAK_REALM  || 'cfc';
const CLIENT = import.meta.env.VITE_KEYCLOAK_CLIENT || 'cpanel-web';

export const keycloak = new Keycloak({ url: URL, realm: REALM, clientId: CLIENT });

// Ensures the access token has at least `minValiditySec` seconds remaining.
// Returns the (possibly refreshed) token string. Throws if the refresh fails,
// which the api layer treats as a hard logout signal.
export async function getToken(minValiditySec = 30) {
  try {
    await keycloak.updateToken(minValiditySec);
  } catch (err) {
    // Refresh failed — session expired or revoked. Force re-login.
    console.warn('[auth] token refresh failed, redirecting to login', err);
    keycloak.login();
    throw err;
  }
  return keycloak.token;
}

export function getRoles() {
  const p = keycloak.tokenParsed || {};
  if (Array.isArray(p.roles)) return p.roles;                       // from our protocol mapper
  if (Array.isArray(p.realm_access?.roles)) return p.realm_access.roles;
  return [];
}

export function hasRole(name) {
  return getRoles().includes(name);
}

export function getProfile() {
  const p = keycloak.tokenParsed || {};
  return {
    sub:      p.sub,
    username: p.preferred_username,
    email:    p.email,
    name:     p.name || p.preferred_username,
    given:    p.given_name,
    family:   p.family_name,
    roles:    getRoles(),
  };
}

export function login()  { return keycloak.login(); }
export function logout() {
  return keycloak.logout({ redirectUri: window.location.origin });
}
