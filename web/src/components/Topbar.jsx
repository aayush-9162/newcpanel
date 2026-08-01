import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, Sun, RefreshCw, LogOut, User as UserIcon, Shield } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useQueryClient } from '@tanstack/react-query';
import { externalLinks } from '@/routes';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

const TONES = {
  primary: 'bg-primary/10 text-primary hover:bg-primary/20',
  warning: 'bg-warning/10 text-warning hover:bg-warning/20',
  success: 'bg-success/10 text-success hover:bg-success/20',
};

export function Topbar({ title, subtitle }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const qc = useQueryClient();

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-3 border-b border-border bg-bg/80 px-5 backdrop-blur">
      <div className="flex flex-col leading-tight min-w-0">
        <h1 className="text-lg font-semibold tracking-tight truncate">{title}</h1>
        {subtitle && <p className="text-xs text-muted-fg truncate">{subtitle}</p>}
      </div>

      <div className="ml-auto flex items-center gap-1.5 overflow-x-auto">
        <div className="hidden md:flex items-center gap-1">
          {externalLinks.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              title={l.href}
              className={cn(
                'relative rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap transition',
                TONES[l.tone] || TONES.primary,
              )}
            >
              {l.label}
              {l.badge && (
                <span className="absolute -top-1 -right-1 rounded-full bg-success px-1 text-[9px] font-semibold text-white shadow ring-1 ring-card">
                  {l.badge}
                </span>
              )}
            </a>
          ))}
        </div>

        <div className="ml-2 flex items-center gap-2 shrink-0">
          <Button variant="outline" size="icon" title="Refresh data" onClick={() => qc.invalidateQueries()}>
            <RefreshCw size={16} />
          </Button>
          <Button variant="outline" size="icon" title="Toggle theme" onClick={() => setDark((d) => !d)}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <UserMenu />
        </div>
      </div>
    </header>
  );
}

// UserMenu — avatar button that opens a dropdown showing the signed-in user,
// their role, an admin shortcut, and a Sign out action.
function UserMenu() {
  const { user, hasRole, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const initials = (user?.name || user?.email || '?')
    .split(/[\s@.]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  const Avatar = ({ size }) => (
    user?.picture
      ? <img src={user.picture} alt="" referrerPolicy="no-referrer"
          className="rounded-full object-cover" style={{ height: size, width: size }} />
      : <span className="grid place-items-center rounded-full bg-primary font-bold text-primary-fg"
          style={{ height: size, width: size }}>{initials || <UserIcon size={14} />}</span>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={user?.name || user?.email}
        className="grid h-9 w-9 place-items-center overflow-hidden rounded-full text-[11px] shadow ring-1 ring-primary/30 hover:opacity-90"
      >
        <Avatar size={36} />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-20 w-64 rounded-xl border border-border bg-card p-3 shadow-xl">
          <div className="flex items-center gap-3 border-b border-border pb-3">
            <div className="h-10 w-10 overflow-hidden rounded-full"><Avatar size={40} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold" title={user?.name}>{user?.name || user?.email}</div>
              <div className="truncate text-[11px] text-muted-fg" title={user?.email}>{user?.email || '—'}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 px-1 py-2 text-[11px]">
            <Shield size={12} className="text-muted-fg" />
            <span className="text-muted-fg uppercase tracking-wider">Role</span>
            <div className="flex flex-wrap gap-1">
              {(user?.roles || []).map((r) => (
                <span key={r} className="rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{r}</span>
              ))}
            </div>
          </div>

          {hasRole('admin') && (
            <button
              type="button"
              onClick={() => { setOpen(false); navigate('/admin'); }}
              className="mb-2 flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-fg/80 transition hover:bg-muted"
            >
              <UserIcon size={14} /> User Management
            </button>
          )}

          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300"
          >
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
