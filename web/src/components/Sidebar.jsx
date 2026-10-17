import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { routes } from '@/routes';
import { useAuth } from '@/auth/AuthProvider';
import { cn } from '@/lib/cn';

// Section order in the sidebar.
// Forms are intentionally excluded — they're launched from the Dashboard's
// "Quick Forms" section (and from the Control Panel) instead.
const ORDER = ['Home', 'Reports'];

// `collapsed` shrinks the sidebar to an icon-only rail (wide reports such as
// the Sales Comparison Report open that way); `onToggle` switches it.
export function Sidebar({ collapsed = false, onToggle }) {
  const { canAccess } = useAuth();
  // Only show routes the current user's role is permitted to open.
  const grouped = routes
    .filter((r) => canAccess(r.path))
    .reduce((acc, r) => {
      (acc[r.group] ||= []).push(r);
      return acc;
    }, {});

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleBtn = onToggle && (
    <button
      type="button"
      onClick={onToggle}
      title={collapsed ? 'Open sidebar' : 'Close sidebar'}
      aria-label={collapsed ? 'Open sidebar' : 'Close sidebar'}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-fg transition hover:bg-muted hover:text-fg"
    >
      <ToggleIcon size={17} />
    </button>
  );

  return (
    <aside
      className={cn(
        'hidden lg:flex shrink-0 flex-col border-r border-border bg-card/50 transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      {collapsed ? (
        <div className="flex h-16 items-center justify-center border-b border-border">{toggleBtn}</div>
      ) : (
        <div className="flex h-16 items-center gap-2 border-b border-border px-4">
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <img
              src="/cfc_logo.webp"
              alt="Carolina Furniture Concepts"
              className="w-[190px] max-w-full self-start object-contain dark:brightness-0 dark:invert"
            />
            <span className="pl-0.5 text-[11px] font-semibold text-muted-fg">CFC Hub</span>
          </div>
          {toggleBtn}
        </div>
      )}

      <nav className={cn('flex-1 overflow-y-auto py-4', collapsed ? 'px-2' : 'px-3')}>
        {ORDER.filter((g) => grouped[g]?.length).map((group) => (
          <div key={group} className="mb-5">
            {collapsed
              ? <div className="mx-2 mb-2 border-t border-border" />
              : (
                <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-fg">
                  {group}
                </div>
              )}
            <ul className="space-y-0.5">
              {grouped[group].map((r) => {
                const Icon = r.icon;
                return (
                  <li key={r.path}>
                    <NavLink
                      to={r.path}
                      end={r.path === '/'}
                      title={collapsed ? r.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'group relative flex items-center rounded-lg py-2 text-sm text-fg/80 transition',
                          collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                          'hover:bg-muted hover:text-fg',
                          isActive && 'bg-accent text-accent-fg font-medium',
                        )
                      }
                    >
                      <Icon size={collapsed ? 18 : 16} className="shrink-0" />
                      {collapsed ? (
                        r.badge && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      ) : (
                        <>
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
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('border-t border-border text-[11px] text-muted-fg', collapsed ? 'p-2 text-center' : 'p-4')}>
        v0.3
        {!collapsed && import.meta.env.VITE_DATA_HOST && (
          <> · Connected to <span className="text-fg/80">{import.meta.env.VITE_DATA_HOST}</span></>
        )}
      </div>
    </aside>
  );
}
