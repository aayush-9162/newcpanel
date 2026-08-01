// AuthProvider — Google Sign-In + our own app session token.
//
// - On load, if we have a stored token, validate it against /api/auth/me and
//   pull the user's current role. Invalid/expired → show the login screen.
// - loginWithGoogle(credential) swaps a Google ID token for our app token.
// - The whole app renders behind login: unauthenticated users see <Login/>.
//
// useAuth() exposes: { user, profile (alias), roles, hasRole, token,
//                      loginWithGoogle, logout, status }.

import { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { getStoredToken, setStoredToken, clearStoredToken } from './session';
import Login from '@/pages/Login.jsx';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'init', user: null });

  // Validate a stored token on first load.
  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();
    if (!token) { setState({ status: 'unauthenticated', user: null }); return; }

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((data) => { if (!cancelled) setState({ status: 'authenticated', user: data.user }); })
      .catch(() => { if (!cancelled) { clearStoredToken(); setState({ status: 'unauthenticated', user: null }); } });

    return () => { cancelled = true; };
  }, []);

  // Exchange a Google credential for our app token. Throws with a friendly
  // message on failure (e.g. email not on the access list) so <Login/> can
  // surface it.
  const loginWithGoogle = useCallback(async (credential) => {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.reason || data.error || 'Sign-in failed. Please try again.');
    }
    setStoredToken(data.token);
    setState({ status: 'authenticated', user: data.user });
    return data.user;
  }, []);

  const logout = useCallback(() => {
    clearStoredToken();
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* ignore */ }
    setState({ status: 'unauthenticated', user: null });
  }, []);

  const user  = state.user;
  const roles = user?.roles || [];
  const hasRole = useCallback((name) => roles.includes(name), [roles]);

  const value = {
    status: state.status,
    user,
    profile: user,           // alias — some components read `profile`
    roles,
    hasRole,
    token: getStoredToken(),
    loginWithGoogle,
    logout,
  };

  let content;
  if (state.status === 'init') {
    content = (
      <div className="grid min-h-screen place-items-center bg-bg text-fg">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-fg">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Loading…</span>
        </div>
      </div>
    );
  } else if (state.status !== 'authenticated') {
    content = <Login />;
  } else {
    content = children;
  }

  return <AuthCtx.Provider value={value}>{content}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}

// Route gate — render `fallback` (or a "Not authorized" panel) if the user
// lacks `role`. Pass a string or array of strings.
export function RequireRole({ role, fallback, children }) {
  const { hasRole } = useAuth();
  const need = Array.isArray(role) ? role : [role];
  if (!need.some((r) => hasRole(r))) {
    return fallback ?? (
      <div className="grid min-h-[40vh] place-items-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="mt-2 text-sm text-muted-fg">
            This area requires one of: <strong>{need.join(', ')}</strong>.
          </p>
        </div>
      </div>
    );
  }
  return children;
}
