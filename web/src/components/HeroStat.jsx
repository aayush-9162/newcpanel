// HeroStat — eye-catching stat tile shared across pages.
//
// Used as the headline KPI element in modernized pages (Hot Button, Zipcode
// Analysis, etc.). Features:
//   - Gradient surface tint
//   - Drop-shadow glow matching the accent color
//   - Decorative oversized icon faintly in the corner
//   - Gradient icon tile with a colored ring
//   - Animated pulsing dot when `urgent` is true
//   - Auto-shrinking value text so long currency strings ($3.14M) still fit
//   - Optional `fullValue` shown as a hover tooltip
//   - Optional sparkline along the bottom edge of the value
//
// Pass `onClick` to make the tile clickable (used for jumping to drill-down
// tabs from a summary page).
import { Sparkline } from './Sparkline.jsx';
import { cn } from '@/lib/cn';

export const STAT_PALETTE = {
  rose: {
    surface: 'from-rose-500/20 via-rose-500/10 to-transparent dark:from-rose-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(244,63,94,0.45)]',
    iconBg:  'bg-gradient-to-br from-rose-500 to-rose-600',
    iconRing: 'ring-rose-500/30',
    text:    'text-rose-600 dark:text-rose-300',
    accent:  'bg-rose-500',
    border:  'border-rose-500/40',
    spark:   '#e11d48',
    gradText:'from-rose-600 to-orange-500',
  },
  amber: {
    surface: 'from-amber-500/20 via-amber-500/10 to-transparent dark:from-amber-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(245,158,11,0.45)]',
    iconBg:  'bg-gradient-to-br from-amber-500 to-orange-500',
    iconRing: 'ring-amber-500/30',
    text:    'text-amber-600 dark:text-amber-300',
    accent:  'bg-amber-500',
    border:  'border-amber-500/40',
    spark:   '#d97706',
    gradText:'from-amber-600 to-orange-500',
  },
  sky: {
    surface: 'from-sky-500/20 via-sky-500/10 to-transparent dark:from-sky-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(14,165,233,0.45)]',
    iconBg:  'bg-gradient-to-br from-sky-500 to-cyan-500',
    iconRing: 'ring-sky-500/30',
    text:    'text-sky-600 dark:text-sky-300',
    accent:  'bg-sky-500',
    border:  'border-sky-500/40',
    spark:   '#0284c7',
    gradText:'from-sky-600 to-cyan-500',
  },
  violet: {
    surface: 'from-violet-500/20 via-violet-500/10 to-transparent dark:from-violet-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(139,92,246,0.45)]',
    iconBg:  'bg-gradient-to-br from-violet-500 to-purple-500',
    iconRing: 'ring-violet-500/30',
    text:    'text-violet-600 dark:text-violet-300',
    accent:  'bg-violet-500',
    border:  'border-violet-500/40',
    spark:   '#7c3aed',
    gradText:'from-violet-600 to-purple-500',
  },
  emerald: {
    surface: 'from-emerald-500/20 via-emerald-500/10 to-transparent dark:from-emerald-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(16,185,129,0.45)]',
    iconBg:  'bg-gradient-to-br from-emerald-500 to-teal-500',
    iconRing: 'ring-emerald-500/30',
    text:    'text-emerald-600 dark:text-emerald-300',
    accent:  'bg-emerald-500',
    border:  'border-emerald-500/40',
    spark:   '#059669',
    gradText:'from-emerald-600 to-teal-500',
  },
  primary: {
    surface: 'from-blue-500/20 via-blue-500/10 to-transparent dark:from-blue-500/25',
    glow:    'shadow-[0_8px_30px_-12px_rgba(59,130,246,0.45)]',
    iconBg:  'bg-gradient-to-br from-blue-500 to-indigo-500',
    iconRing: 'ring-blue-500/30',
    text:    'text-blue-600 dark:text-blue-300',
    accent:  'bg-blue-500',
    border:  'border-blue-500/40',
    spark:   '#3b82f6',
    gradText:'from-blue-600 to-indigo-500',
  },
};

export function HeroStat({
  label,
  value,
  fullValue,
  icon: Icon,
  accent = 'sky',
  subtitle,
  urgent,
  loading,
  onClick,
  sparkline,
  className,
}) {
  const p = STAT_PALETTE[accent] || STAT_PALETTE.sky;
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-card text-left transition-all duration-300',
        p.border, p.glow,
        onClick && 'hover:-translate-y-1 hover:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.25)] cursor-pointer',
        className,
      )}
    >
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-90', p.surface)} />
      {Icon && (
        <div className="absolute -bottom-4 -right-4 opacity-[0.06] dark:opacity-[0.08]">
          <Icon size={120} strokeWidth={1.5} />
        </div>
      )}

      <div className="relative p-4">
        {/* Label spans the full card width so long names like
            "Outstanding Receivables" never get cut off. */}
        <div className="flex items-center gap-2">
          <span
            title={typeof label === 'string' ? label : undefined}
            className="text-[10px] font-bold uppercase tracking-wider text-muted-fg leading-tight"
          >{label}</span>
          {urgent && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-75', p.accent)} />
              <span className={cn('relative inline-flex h-2 w-2 rounded-full', p.accent)} />
            </span>
          )}
        </div>

        <div className="mt-2 flex items-center gap-3">
          {Icon && (
            <div className={cn(
              'grid h-11 w-11 place-items-center rounded-xl shrink-0 text-white shadow-lg ring-2 ring-offset-0',
              p.iconBg, p.iconRing,
            )}>
              <Icon size={18} strokeWidth={2.25} />
            </div>
          )}
          <div
            title={fullValue || undefined}
            className={cn(
              'min-w-0 flex-1 font-extrabold tabular-nums tracking-tight leading-none whitespace-nowrap',
              p.text,
              // Auto-shrink to keep the whole value visible — never ellipsises.
              typeof value === 'string' && value.length > 10 ? 'text-base'
                : typeof value === 'string' && value.length > 8 ? 'text-lg'
                : typeof value === 'string' && value.length > 6 ? 'text-xl'
                : typeof value === 'string' && value.length > 4 ? 'text-2xl'
                : 'text-3xl',
            )}
          >
            {loading
              ? <span className="inline-block h-8 w-24 rounded bg-muted/60 animate-pulse align-middle" />
              : value}
          </div>
        </div>

        {subtitle && <div title={typeof subtitle === 'string' ? subtitle : undefined} className="text-[11px] text-muted-fg mt-2 line-clamp-1">{subtitle}</div>}
        {sparkline && sparkline.length > 1 && !loading && (
          <div className="mt-2 h-6 -mx-1">
            <Sparkline data={sparkline} dataKey="value" color={p.spark} type="area" height={24} />
          </div>
        )}
      </div>
    </Wrapper>
  );
}

// HeroBanner — full-width attention-grabbing banner used at the top of
// modernized pages. Pass any children for the body content.
export function HeroBanner({ icon: Icon, accent = 'primary', decorIcon, children, className }) {
  const p = STAT_PALETTE[accent] || STAT_PALETTE.primary;
  const Decor = decorIcon || Icon;
  return (
    <div className={cn('relative overflow-hidden rounded-2xl border', p.border, p.glow, className)}>
      <div className={cn('absolute inset-0 bg-gradient-to-br opacity-90', p.surface)} />
      {Decor && (
        <div className="absolute -top-8 -right-8 opacity-[0.08]">
          <Decor size={200} strokeWidth={1.5} />
        </div>
      )}
      <div className="relative p-6 flex flex-wrap items-center gap-6">
        {Icon && (
          <div className={cn(
            'grid h-16 w-16 place-items-center rounded-2xl text-white shadow-xl ring-4',
            p.iconBg, p.iconRing,
          )}>
            <Icon size={28} strokeWidth={2.25} />
          </div>
        )}
        <div className="flex-1 min-w-[260px]">{children}</div>
      </div>
    </div>
  );
}
