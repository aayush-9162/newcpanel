// Control Panel — Quick Access portal.
// Two grids of richly-styled launcher cards:
//   1) External Tools (TMS, File Share, INFOTRACK, etc.) — open in a new tab
//   2) Forms — internal routes to in-app form pages

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Topbar } from '@/components/Topbar';
import { HeroBanner } from '@/components/HeroStat';
import { LauncherCard } from '@/components/LauncherCard';
import { FORMS } from '@/data/forms';
import { VENDORS } from '@/data/vendors';
import { VENDOR_LOGOS } from '@/data/vendorLogoFiles';
import { BrandLogo } from '@/components/BrandLogo';
import { useAuth } from '@/auth/AuthProvider';
import {
  LayoutGrid, ExternalLink, ClipboardEdit, Sparkles, Search,
  // External tool icons
  ListChecks, BarChart3, Globe2, Video, Store, FileBarChart, Clock, Truck, FileText, MessagesSquare, Package, PackageSearch, LineChart,
} from 'lucide-react';

// ─── External tools (open in new tab) ────────────────────────────────────────
const TOOLS = [
  {
    label: 'TMS',
    description: 'Task management — assignments, deadlines, and status tracking',
    href: 'http://192.168.0.211:5500/',
    icon: ListChecks,
    accent: 'primary',
  },
  {
    label: 'INFOTRACK',
    description: 'Analytics dashboards and business insights on Google Sites',
    href: 'https://sites.google.com/123cfc.com/cfc-analytics/home',
    icon: BarChart3,
    accent: 'emerald',
  },
  {
    label: 'INTRANET',
    description: 'Internal portal — policies, directory, resources',
    href: 'https://sites.google.com/123cfc.com/cfc-intranet/',
    icon: Globe2,
    accent: 'amber',
  },
  {
    label: 'MEETING',
    description: 'Join the team Google Meet huddle',
    href: 'https://meet.google.com/xwb-mbyf-gen',
    icon: Video,
    logo: 'meet.google.com',
    accent: 'sky',
  },
  {
    label: 'DispatchTrack',
    description: 'Delivery routing and tracking',
    href: 'https://carolinafurnitureconcepts.dispatchtrack.com/a18/login',
    icon: Truck,
    logo: 'dispatchtrack.com',
    accent: 'emerald',
  },
  {
    label: 'Birdeye',
    description: 'Customer reviews and messaging',
    href: 'https://app.birdeye.com/sign-in/',
    icon: MessagesSquare,
    logo: 'birdeye.com',
    accent: 'primary',
  },
  {
    label: 'ADP Time Clock',
    description: 'Clock in / out and timekeeping',
    href: 'https://online.adp.com/clock/login.html?TYPE=33554433&REALMOID=06-af229e79-8b8b-1133-9f6b-85fabf340000&GUID=&SMAUTHREASON=0&METHOD=GET&SMAGENTNAME=-SM-xG%2fsjhR3LqQrl8Bluqcb5CJsPHxtAOHb%2fepFa7ec2OFx0CU5KBY7cWZ9mpuPt1Lg&TARGET=-SM-https%3a%2f%2fclock%2eadp%2ecom%2f',
    icon: Clock,
    logo: 'adp.com',
    accent: 'amber',
  },
  {
    label: 'New UPS System',
    description: 'UPS Board',
    href: 'http://192.168.0.211:5000/login',
    icon: Package,
    accent: 'sky',
  },
  {
    label: 'Inventory Scrub',
    description: 'Inventory scrub and reconciliation',
    href: 'http://192.168.0.211.nip.io:4700/',
    icon: PackageSearch,          // background decoration / fallback
    iconSrc: '/inventoryscrub.svg',
    accent: 'emerald',
    badge: 'NEW',
  },
  {
    label: 'Daily Forms',
    description: 'Store forms portal',
    href: 'http://192.168.0.211.nip.io:1214/',
    icon: Store,
    accent: 'rose',
  },
  {
    label: 'Reports (Daily Forms)',
    description: 'Reporting portal for submitted forms',
    href: 'http://192.168.0.211.nip.io:1214/formreport/',
    icon: FileBarChart,
    accent: 'violet',
    adminOnly: true,   // only shown to the admin role
  },
  {
    label: 'Office PC Reports',
    description: 'Profit-center reports dashboard',
    href: 'http://192.168.0.211:7100/dashboard',
    icon: LineChart,
    accent: 'sky',
    adminOnly: true,   // super admin only
    badge: 'NEW',
  },
];

export default function CPanel() {
  const { hasRole } = useAuth();
  // Admin-only tools (e.g. Form Reports) are shown only to the Super Admin.
  const tools = TOOLS.filter((t) => !t.adminOnly || hasRole('superadmin'));

  return (
    <>
      <Topbar
        title="Quick Access"
        subtitle="External Tools & Company Forms"
        actions={(
          <Link
            to="/vendors"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-fg/80 transition hover:bg-muted hover:text-fg"
            title="Vendor websites & price sheets"
          >
            <Store size={14} className="text-primary" />
            <span className="hidden sm:inline">Vendor Website / Price List</span>
            <span className="sm:hidden">Vendors</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-fg">{VENDORS.length}</span>
          </Link>
        )}
      />
      <div className="flex flex-1 flex-col gap-6 p-5 animate-fade-in">

        {/* Welcome hero */}
        <HeroBanner icon={LayoutGrid} decorIcon={Sparkles} accent="primary">
          <div className="text-[11px] font-bold uppercase tracking-widest text-blue-700 dark:text-blue-300">
            Carolina Furniture Concepts
          </div>
          <div className="mt-1 bg-gradient-to-br from-blue-600 to-indigo-500 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent">
            Quick Access Portal
          </div>
          <div className="mt-2 text-sm text-muted-fg">
            External tools and company forms — everything you need, in one place.
          </div>
        </HeroBanner>

        {/* External Tools */}
        <SectionHeading
          icon={ExternalLink}
          title="External Tools"
          hint="Opens in a new tab"
          count={tools.length}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {tools.map((t) => (
            <LauncherCard key={t.label} {...t} external />
          ))}
        </div>

        {/* Forms */}
        <SectionHeading
          icon={ClipboardEdit}
          title="Forms"
          hint="Submit a request or capture"
          count={FORMS.length}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {FORMS.map((f) => (
            <LauncherCard key={f.label} {...f} />
          ))}
        </div>

      </div>
    </>
  );
}

// Vendor initials — last-resort fallback when no logo file exists.
function initialsOf(name) {
  return String(name || '').split(/[\s&/-]+/).filter(Boolean).map((s) => s[0]).slice(0, 2).join('').toUpperCase() || '?';
}

// ─── Vendors — logo card with Website + Price Sheet buttons ──────────────────
export function VendorSites({ forceAll = false }) {
  const [query, setQuery] = useState('');
  const [showAllState, setShowAll] = useState(false);
  const showAll = forceAll || showAllState;
  const INITIAL = 12;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? VENDORS.filter((v) => v.name.toLowerCase().includes(q)) : VENDORS;
  }, [query]);

  const expanded = showAll || !!query.trim();
  const visible = expanded ? filtered : filtered.slice(0, INITIAL);
  const hidden = VENDORS.length - INITIAL;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary"><Store size={16} /></span>
          <h2 className="text-base font-bold uppercase tracking-wider text-fg">Vendors &amp; Price Sheets</h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-fg">{VENDORS.length}</span>
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendor…"
            className="h-9 w-56 rounded-lg border border-border bg-card pl-8 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-fg">No vendor matches “{query}”.</div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((v) => (
            <div
              key={v.name}
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/40 hover:shadow-md"
            >
              {/* Logo panel — framed on white so brand marks read cleanly */}
              <div className="grid h-24 place-items-center border-b border-border bg-white p-3">
                <BrandLogo
                  src={VENDOR_LOGOS[v.domain]}
                  name={v.name}
                  imgClassName="max-h-full max-w-full object-contain"
                  fallback={<span className="text-xl font-extrabold tracking-tight text-slate-400">{initialsOf(v.name)}</span>}
                />
              </div>

              {/* Website + price-sheet buttons */}
              <div className="flex flex-1 flex-col gap-1.5 p-2">
                {v.website ? (
                  <a
                    href={v.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${v.name} — website`}
                    className="truncate rounded-md bg-blue-600 px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-white transition hover:bg-blue-700"
                  >
                    {v.name}
                  </a>
                ) : (
                  <div className="truncate rounded-md bg-muted px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wide text-fg/80" title={v.name}>
                    {v.name}
                  </div>
                )}
                {v.pricesheets.map((ps) => (
                  <a
                    key={ps.label}
                    href={ps.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-1 truncate rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50"
                  >
                    <FileText size={12} /> {v.pricesheets.length === 1 ? 'Price Sheet' : ps.label}
                  </a>
                ))}
                {!v.website && v.pricesheets.length === 0 && (
                  <span className="py-1 text-center text-[11px] italic text-muted-fg">No links</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!forceAll && !query.trim() && hidden > 0 && (
        <button
          type="button"
          onClick={() => setShowAll((s) => !s)}
          className="mx-auto mt-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-muted"
        >
          {showAllState ? 'Show less' : `Show all ${VENDORS.length} vendors`}
        </button>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function SectionHeading({ icon: Icon, title, hint, count }) {
  return (
    <div className="flex items-end justify-between gap-3 pt-1">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon size={16} />
          </span>
        )}
        <h2 className="text-base font-bold uppercase tracking-wider text-fg">{title}</h2>
        {count != null && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-fg">
            {count}
          </span>
        )}
      </div>
      {hint && <span className="text-[11px] italic text-muted-fg" title={hint}>{hint}</span>}
    </div>
  );
}

