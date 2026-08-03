import { NavLink } from 'react-router-dom';
import { routes } from '@/routes';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';
import { LayoutGrid } from 'lucide-react';

// Section order in the sidebar.
// Forms are intentionally excluded — they're launched from the Dashboard's
// "Quick Forms" section (and from the Control Panel) instead.
const ORDER = ['Home', 'Reports'];

export function Sidebar() {
  const { canAccess } = useAuth();
  // Only show routes the current user's role is permitted to open.
  const grouped = routes
    .filter((r) => canAccess(r.path))
    .reduce((acc, r) => {
      (acc[r.group] ||= []).push(r);
      return acc;
    }, {});

  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card/50">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-fg shadow">
          <LayoutGrid size={18} />
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">CFC Cpanel</span>
          <span className="text-[11px] text-muted-fg">Modern</span>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {ORDER.filter((g) => grouped[g]?.length).map((group) => (
          <div key={group} className="mb-5">
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">
              {group}
            </div>
            <ul className="space-y-0.5">
              {grouped[group].map((r) => {
                const Icon = r.icon;
                return (
                  <li key={r.path}>
                    <NavLink
                      to={r.path}
                      end={r.path === '/'}
                      className={({ isActive }) =>
                        cn(
                          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-fg/80 transition',
                          'hover:bg-muted hover:text-fg',
                          isActive && 'bg-accent text-accent-fg font-medium',
                        )
                      }
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className="truncate">{r.label}</span>
                      {!r.built && r.path !== '/' && (
                        <span className="ml-auto rounded bg-muted px-1 py-px text-[9px] text-muted-fg group-hover:bg-card">
                          stub
                        </span>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-4 text-[11px] text-muted-fg">
        v0.3
        {import.meta.env.VITE_DATA_HOST && (
          <> · Connected to <span className="text-fg/80">{import.meta.env.VITE_DATA_HOST}</span></>
        )}
      </div>
    </aside>
  );
}
