// Control Panel — Quick Access portal.
// Two grids of richly-styled launcher cards:
//   1) External Tools (TMS, File Share, INFOTRACK, etc.) — open in a new tab
//   2) Forms — internal routes to in-app form pages

import { Topbar } from '@/components/Topbar';
import { HeroBanner } from '@/components/HeroStat';
import { LauncherCard } from '@/components/LauncherCard';
import { FORMS } from '@/data/forms';
import {
  LayoutGrid, ExternalLink, ClipboardEdit, Sparkles,
  // External tool icons
  ListChecks, FolderOpen, BarChart3, Globe2, Video, ClipboardCheck,
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
    label: 'File Share',
    description: 'Shared drive for company documents and files',
    href: 'http://26.14.50.15:3300',
    icon: FolderOpen,
    accent: 'sky',
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
    accent: 'sky',
  },
  {
    label: 'PO Scrubbing',
    description: 'Purchase order review and cleanup tool',
    href: 'http://192.168.0.211:4500',
    icon: ClipboardCheck,
    accent: 'violet',
  },
];

export default function CPanel() {
  return (
    <>
      <Topbar title="Control Panel" subtitle="Quick Access · External Tools & Forms" />
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
          count={TOOLS.length}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {TOOLS.map((t) => (
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

