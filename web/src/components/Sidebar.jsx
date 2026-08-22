import { NavLink } from 'react-router-dom';
import { routes } from '@/routes';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

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
      <div className="flex h-16 flex-col justify-center gap-1 border-b border-border px-4">
        <img
          src="/cfc_logo.webp"
          alt="Carolina Furniture Concepts"
          className="w-[190px] max-w-full self-start object-contain dark:brightness-0 dark:invert"
        />
        <span className="pl-0.5 text-[11px] font-semibold text-muted-fg">CFC Hub</span>
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
                      {r.badge && (
                        <span className="ml-auto shrink-0 rounded-full bg-emerald-500 px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white shadow-sm">
                          {r.badge}
                        </span>
                      )}
                      {!r.built && r.path !== '/' && !r.badge && (
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
