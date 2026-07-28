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
const MGR        = ['admin', 'manager', 'viewer']; // everything except salesperson
const ADMIN_ONLY = ['admin'];                       // owner-only reports

export const routes = [
  // Home — Control Panel is visible to everyone. Dashboard is for
  // owners/managers (company-wide sales numbers), not salespeople.
  { path: '/',            label: 'Control Panel', icon: Home,            group: 'Home', built: true },
  { path: '/dashboard',   label: 'Dashboard',     icon: LayoutDashboard, group: 'Home', built: true, home: true, roles: MGR },

  // Sales Comparison Report — pinned to the top of Reports (owner-only).
  { path: '/scr',               label: 'Sales Comparison Report', icon: TrendingUp, group: 'Reports', built: true, home: true, roles: ADMIN_ONLY },

  // Reports that salesperson IS allowed to see — no roles restriction
  { path: '/sales/performance', label: 'SalesPerson Performance', icon: TrendingUp, group: 'Reports', built: true, home: true },
  { path: '/fms',               label: 'Floor Sales',             icon: Receipt,    group: 'Reports', built: true, home: true },
  { path: '/disco',             label: 'Discontinued Items',      icon: Slash,      group: 'Reports', built: true, home: true },

  // Reports admin + manager + viewer can see (excludes salesperson)
  { path: '/mpr',                label: 'Manager Performance',     icon: ShieldCheck,   group: 'Reports', built: true, home: true, roles: MGR },
  { path: '/dmgsummary',         label: 'Damage Report',           icon: PackageX,      group: 'Reports', built: true, home: true, roles: MGR },
  { path: '/leads',              label: 'Prospective Buyer',       icon: Users,         group: 'Reports', built: true, roles: MGR },
  { path: '/pickup/new',         label: 'Delivery & Pickup',       icon: Truck,         group: 'Reports', built: true, roles: MGR },
  { path: '/hot-button-issues',  label: 'Hot Button Issues',       icon: AlertTriangle, group: 'Reports', built: true, roles: MGR },

  // Owner-only reports — admin sees them, manager / viewer / salesperson do not
  { path: '/gmr',                label: 'Gross Margin',            icon: PieChart,      group: 'Reports', built: true, home: true, roles: ADMIN_ONLY },
  { path: '/pendingReceivables', label: 'Pending Receivables',     icon: Receipt,       group: 'Reports', built: true, roles: ADMIN_ONLY },
  { path: '/zip/analysis',       label: 'Zipcode Analysis',        icon: MapPin,        group: 'Reports', built: true, roles: ADMIN_ONLY },
  { path: '/service-order',      label: 'Service Order',           icon: Wrench,        group: 'Reports', built: true, roles: ADMIN_ONLY },

  // Forms
  { path: '/mpf', label: 'Associate Manager Form', icon: FileEdit, group: 'Forms', built: true },
  { path: '/spf', label: 'Sales Performance Form', icon: FileEdit, group: 'Forms', built: true },
  { path: '/pbf', label: 'Prospective Buyer Form', icon: FileEdit, group: 'Forms', built: true },
  { path: '/damage/create', label: 'Report Damage', icon: ClipboardEdit, group: 'Forms', built: true },
  { path: '/mrf', label: 'Inventory Request Form', icon: ClipboardEdit, group: 'Forms', built: true },
];

// Returns true if the given route is visible/accessible to a user with these roles.
// A route with no `roles` field is open to everyone authenticated.
export function isRouteAllowed(route, userRoles) {
  if (!route.roles || route.roles.length === 0) return true;
  return route.roles.some((r) => userRoles.includes(r));
}

// External links shown in the topbar on every page.
export const externalLinks = [
  { label: 'TMS', href: 'http://192.168.0.211:5500/', tone: 'primary' },
  { label: 'File Share', href: 'http://26.14.50.15:3300', tone: 'primary' },
  { label: 'INFOTRACK', href: 'https://sites.google.com/123cfc.com/cfc-analytics/home', tone: 'primary' },
  { label: 'INTRANET', href: 'https://sites.google.com/123cfc.com/cfc-intranet/', tone: 'warning' },
  { label: 'MEETING', href: 'https://meet.google.com/xwb-mbyf-gen', tone: 'success' },
  { label: 'PO Scrubbing', href: 'http://192.168.0.211:4500', tone: 'primary' },
  { label: 'Sales Form', href: 'http://26.95.221.233:5000', tone: 'success', badge: 'New' },
];
