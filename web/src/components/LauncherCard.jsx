// LauncherCard — compact, eye-catching card used in launcher grids
// (CPanel external tools, Dashboard quick forms, etc).
//
// Renders an <a target="_blank"> when given `href` + `external`, otherwise a
// <Link> to `to`. The accent pulls its gradient palette from STAT_PALETTE so
// every launcher card matches the visual language used by HeroStat tiles.

import { Link } from 'react-router-dom';
import { STAT_PALETTE } from '@/components/HeroStat';
import { BrandLogo } from '@/components/BrandLogo';
import { cn } from '@/lib/cn';
import { ExternalLink, ArrowRight } from 'lucide-react';

export function LauncherCard({
  label,
  description,
  href,
  to,
  icon: Icon,
  logo,          // optional brand domain — shows the real logo on a white tile
  accent = 'primary',
  badge,
  external,
}) {
  const p = STAT_PALETTE[accent] || STAT_PALETTE.primary;

  // Logo tile (white, so brand marks read cleanly) or the accent icon tile.
  const iconTile = logo ? (
    <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-white p-1.5 shadow-md ring-2 ring-black/5 transition-transform duration-300 group-hover:scale-110">
      <BrandLogo
        domain={logo}
        name={label}
        imgClassName="h-full w-full object-contain"
        fallback={<Icon size={16} strokeWidth={2.25} className="text-slate-500" />}
      />
    </div>
  ) : (
    <div className={cn(
      'grid h-9 w-9 place-items-center rounded-xl text-white shadow-md ring-2 ring-offset-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3',
      p.iconBg, p.iconRing,
    )}>
      <Icon size={16} strokeWidth={2.25} />
    </div>
  );

  const content = (
    <div
      className={cn(
        'group relative h-full overflow-hidden rounded-2xl border bg-card transition-all duration-300',
        p.border, p.glow,
        'hover:-translate-y-1 hover:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]',
      )}
    >
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-80', p.surface)} />
      <div className="absolute -bottom-4 -right-4 opacity-[0.07] dark:opacity-[0.09]">
        <Icon size={84} strokeWidth={1.5} />
      </div>

      <div className="relative flex h-full flex-col p-3">
        <div className="flex items-start justify-between gap-1.5">
          {iconTile}

          {badge && (
            <span className="rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow">
              {badge}
            </span>
          )}
          {!badge && external && (
            <span className="text-muted-fg opacity-40 transition group-hover:opacity-100 group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
              <ExternalLink size={13} />
            </span>
          )}
          {!badge && !external && (
            <span className="text-muted-fg opacity-40 transition group-hover:opacity-100 group-hover:translate-x-1">
              <ArrowRight size={13} />
            </span>
          )}
        </div>

        <div className="mt-2 flex-1">
          <div
            title={label}
            className={cn(
              'bg-gradient-to-br bg-clip-text text-sm font-bold leading-tight tracking-tight text-transparent',
              p.gradText,
            )}
          >
            {label}
          </div>
          <div title={description} className="mt-1 line-clamp-2 text-[10.5px] leading-snug text-muted-fg">
            {description}
          </div>
        </div>
      </div>
    </div>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full">
        {content}
      </a>
    );
  }
  return <Link to={to} className="block h-full">{content}</Link>;
}
