// AuthProvider — initializes Keycloak once, blocks the app behind login,
// and exposes the parsed user via the useAuth() hook.
//
// Usage (main.jsx):
//   <AuthProvider>
//     <App />
//   </AuthProvider>
//
// Anywhere inside the tree:
//   const { profile, hasRole, logout } = useAuth();

import { createContext, useContext, useEffect, useState } from 'react';
import { keycloak, getProfile, getRoles, hasRole as kHasRole, login, logout } from './keycloak';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'init', profile: null });

  useEffect(() => {
    let cancelled = false;

    // `login-required` makes Keycloak redirect to the SSO login page if the
    // user isn't authenticated — no in-app login screen needed.
    // PKCE S256 is the safe default for SPAs.
    // `checkLoginIframe: false` avoids 3rd-party cookie issues in modern browsers.
    keycloak
      .init({
        onLoad: 'login-required',
        pkceMethod: 'S256',
        checkLoginIframe: false,
      })
      .then((authenticated) => {
        if (cancelled) return;
        if (!authenticated) {
          setState({ status: 'unauthenticated', profile: null });
          return;
        }
        setState({ status: 'authenticated', profile: getProfile() });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[auth] keycloak init failed', err);
        setState({ status: 'error', profile: null, error: err });
      });

    // Refresh the user profile after the token rotates (e.g. roles changed).
    keycloak.onAuthRefreshSuccess = () => {
      if (!cancelled) setState((s) => ({ ...s, profile: getProfile() }));
    };
    // If the refresh fails entirely the keycloak helper will redirect to login.
    keycloak.onAuthLogout = () => {
      if (!cancelled) setState({ status: 'unauthenticated', profile: null });
    };

    return () => { cancelled = true; };
  }, []);

  if (state.status === 'init') {
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-fg">
        <div className="flex flex-col items-center gap-3 text-sm text-muted-fg">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span>Connecting to single sign-on…</span>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
        <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
          <h1 className="text-lg font-semibold">Sign-in unavailable</h1>
          <p className="mt-2 text-sm text-muted-fg">
            Couldn't reach the SSO server. Check that the Keycloak container is running
            (<code className="rounded bg-muted px-1.5 py-0.5">docker compose ps</code> in the sso folder).
          </p>
          <button onClick={() => location.reload()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-fg hover:opacity-90">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    // Should be rare with onLoad: 'login-required', but handle it anyway.
    return (
      <div className="grid min-h-screen place-items-center bg-bg text-fg">
        <button onClick={login} className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-fg hover:opacity-90">
          Sign in
        </button>
      </div>
    );
  }

  const value = {
    profile: state.profile,
    roles: getRoles(),
    hasRole: kHasRole,
    login,
    logout,
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}

// Optional route gate — render `fallback` (or "Not authorized") if the user
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
