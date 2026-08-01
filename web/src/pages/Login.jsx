// Login — full-page gate shown by <AuthProvider> when nobody is signed in.
// Renders Google's official "Sign in with Google" button (GIS). On success we
// hand the returned Google credential to loginWithGoogle(), which swaps it for
// our app session token (and rejects if the email isn't on the access list).

import { useEffect, useRef, useState } from 'react';
import { LayoutGrid, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

// Load the Google Identity Services script once; resolve when it's ready.
function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    let s = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (!s) {
      s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener('load', () => resolve());
    s.addEventListener('error', () => reject(new Error('Could not load Google Sign-In. Check your connection.')));
  });
}

export default function Login() {
  const { loginWithGoogle } = useAuth();
  const btnRef = useRef(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!CLIENT_ID) { setError('Google sign-in is not configured (missing VITE_GOOGLE_CLIENT_ID).'); return; }

    loadGis()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: CLIENT_ID,
          auto_select: false,
          callback: async (resp) => {
            setError(null);
            setBusy(true);
            try {
              await loginWithGoogle(resp.credential);
              // On success AuthProvider swaps the tree to the app — nothing else to do.
            } catch (e) {
              setError(e.message || 'Sign-in failed.');
              setBusy(false);
            }
          },
        });
        if (btnRef.current) {
          window.google.accounts.id.renderButton(btnRef.current, {
            theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 280,
          });
        }
      })
      .catch((e) => { if (!cancelled) setError(e.message); });

    return () => { cancelled = true; };
  }, [loginWithGoogle]);

  return (
    <div className="grid min-h-screen place-items-center bg-bg p-6 text-fg">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-xl">
        <div className="flex flex-col items-center text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 text-white shadow-lg">
            <LayoutGrid size={26} />
          </div>
          <h1 className="mt-4 text-xl font-bold tracking-tight">CFC Cpanel</h1>
          <p className="mt-1 text-sm text-muted-fg">Carolina Furniture Concepts</p>
          <p className="mt-4 text-sm text-muted-fg">Sign in with your company Google account to continue.</p>
        </div>

        <div className="mt-6 flex min-h-[44px] items-center justify-center">
          {busy
            ? <div className="flex items-center gap-2 text-sm text-muted-fg">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" /> Signing in…
              </div>
            : <div ref={btnRef} />}
        </div>

        {error && (
          <div className="mt-5 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-300">
            <ShieldAlert size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="mt-6 text-center text-[11px] text-muted-fg">
          New accounts get basic (salesperson) access automatically. Ask an admin for a higher role.
        </p>
      </div>
    </div>
  );
}
