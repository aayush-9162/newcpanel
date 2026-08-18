import {
  Home,
  LayoutDashboard,
  TrendingUp,
  ShieldCheck,
  PieChart,
  PackageX,
  Slash,
  Users,
  Receipt,
  Truck,
  MapPin,
  AlertTriangle,
  Wrench,
  FileEdit,
  ClipboardEdit,
  Boxes,
  UserCog,
  ShieldAlert,
  Trophy,
} from 'lucide-react';

// `home: true` → shown on the cpanel home left panel.
// `built: true` → has its own React page; otherwise StubPage is rendered.
//
// `roles` → optional allow-list of realm roles that may see / open this route.
// Omit it to allow everyone with a valid Keycloak login. Used by the Sidebar
// to hide rows and by App.jsx to block direct-URL access for forbidden roles.
//
// Salespeople are intentionally restricted to: SalesPerson Performance,
// Floor Sales, Discontinued Items (+ Home/Dashboard for navigation).
// Managers are restricted from a few sensitive financial reports too —
// those use ADMIN_ONLY instead of MGR.
const MGR        = ['superadmin', 'manager', 'viewer']; // everything except salesperson
const ADMIN_ONLY = ['superadmin'];                       // owner-only reports

export const routes = [
  // Home — Control Panel is visible to everyone. Dashboard is for the owner
  // (admin) + viewer — NOT managers or salespeople.
  { path: '/',            label: 'Quick Access', icon: Home,            group: 'Home', built: true },
  { path: '/dashboard',   label: 'Dashboard',     icon: LayoutDashboard, group: 'Home', built: true, home: true, roles: ['admin', 'viewer'] },
  { path: '/admin',       label: 'User Management', icon: UserCog,       group: 'Home', built: true, roles: ADMIN_ONLY },

  // Sales Comparison Report — pinned to the top of Reports (admin + manager).
  { path: '/scr',               label: 'Sales Comparison Report', icon: TrendingUp, group: 'Reports', built: true, home: true, roles: ['admin', 'manager'] },

  // Item Sold Analysis — deep dive into what sold (managers + admin + viewer).
  { path: '/item-sold-analysis', label: 'Item Sold Analysis', icon: Boxes, group: 'Reports', built: true, home: true, roles: MGR },

  // Reports that salesperson IS allowed to see — no roles restriction
  { path: '/sales/performance', label: 'SalesPerson Performance', icon: TrendingUp, group: 'Reports', built: true, home: true },
  { path: '/sales/report-beta', label: 'Salesperson Report BETA', icon: Trophy, group: 'Reports', built: true, home: true },
  { path: '/fms',               label: 'Floor Sales',             icon: Receipt,    group: 'Reports', built: true, home: true },
  { path: '/disco',             label: 'Discontinued Items',      icon: Slash,      group: 'Reports', built: true, home: true },

  // Reports admin + manager + viewer can see (excludes salesperson)
  { path: '/mpr',                label: 'Manager Performance',     icon: ShieldCheck,   group: 'Reports', built: true, home: true, roles: MGR },
  { path: '/dmgsummary',         label: 'Damage Report',           icon: PackageX,      group: 'Reports', built: true, home: true, roles: MGR },
  { path: '/leads',              label: 'Prospective Buyer',       icon: Users,         group: 'Reports', built: true, roles: MGR },
  { path: '/pickup/new',         label: 'Delivery & Pickup',       icon: Truck,         group: 'Reports', built: true, roles: MGR },
  { path: '/dispatchtrack',      label: 'DispatchTrack Report',    icon: Truck,         group: 'Reports', built: true, home: true, roles: MGR },
  { path: '/hot-button-issues',  label: 'Hot Button Issues',       icon: AlertTriangle, group: 'Reports', built: true, roles: MGR },

  // Owner-only reports — admin sees them, manager / viewer / salesperson do not
  { path: '/gmr',                label: 'Gross Margin',            icon: PieChart,      group: 'Reports', built: true, home: true, roles: ADMIN_ONLY },
  { path: '/pendingReceivables', label: 'Pending Receivables',     icon: Receipt,       group: 'Reports', built: true, roles: ADMIN_ONLY },
  { path: '/zip/analysis',       label: 'Zipcode Analysis',        icon: MapPin,        group: 'Reports', built: true, roles: ADMIN_ONLY },
  { path: '/service-order',      label: 'Service Order',           icon: Wrench,        group: 'Reports', built: true, roles: ADMIN_ONLY },

  // Tracker Report — suspicious web-visit monitoring (admin by default; grant
  // to other roles from User Management → Roles & Permissions).
  { path: '/tracker',            label: 'Tracker Report',          icon: ShieldAlert,   group: 'Reports', built: true, roles: ADMIN_ONLY },

  // Forms
  { path: '/mpf', label: 'Associate Manager Form', icon: FileEdit, group: 'Forms', built: true },
  { path: '/spf', label: 'Sales Performance Form', icon: FileEdit, group: 'Forms', built: true },
  { path: '/pbf', label: 'Prospective Buyer Form', icon: FileEdit, group: 'Forms', built: true },
  { path: '/damage/create', label: 'Report Damage', icon: ClipboardEdit, group: 'Forms', built: true },
  { path: '/mrf', label: 'Inventory Request Form', icon: ClipboardEdit, group: 'Forms', built: true },
];

// Access is now driven by the SERVER (server/data/roles.json), delivered per
// user as `allowedRoutes` on /api/auth/me. The per-route `roles` fields above
// are only the original seed reference — they are NOT used for enforcement.
//
// A route is accessible if the user's allowedRoutes cover its path. Quick
// Access ('/') is always allowed so no one is ever locked out of the landing.
export function isRouteAllowed(routePath, allowedRoutes) {
  if (routePath === '/') return true;
  if (allowedRoutes === '*' || allowedRoutes === true) return true;
  return Array.isArray(allowedRoutes) && allowedRoutes.includes(routePath);
}

// Routes an admin may toggle per role in the /admin permissions matrix.
// Excludes only '/' (Quick Access is always on). User Management ('/admin') and
// Tracker Report ('/tracker') ARE listed so they can be granted when needed.
export const PERMISSIONABLE_ROUTES = routes.filter((r) => r.path !== '/');

// External links shown in the topbar on every page. (Cleared — these tools are
// launched from the Quick Access portal instead.)
export const externalLinks = [];
