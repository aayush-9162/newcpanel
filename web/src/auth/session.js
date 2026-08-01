// Tiny localStorage-backed holder for our app session token.
// Kept in its own module so both AuthProvider and the api layer can read/clear
// it without importing each other (avoids a circular dependency).

const KEY = 'cfc.session.token';

export function getStoredToken() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

export function setStoredToken(token) {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export function clearStoredToken() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
