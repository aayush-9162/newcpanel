import { Card, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { Sparkline } from './Sparkline.jsx';
import { cn } from '@/lib/cn';

// Each tone styles three things: the card surface tint, the icon chip
// background, and a paired sparkline color.
const TONES = {
  primary: { card: 'bg-card', icon: 'bg-accent text-accent-fg', spark: 'hsl(var(--primary))' },
  success: { card: 'bg-success/[0.06] dark:bg-success/15', icon: 'bg-success/15 text-success', spark: 'hsl(var(--success))' },
  warning: { card: 'bg-warning/[0.06] dark:bg-warning/15', icon: 'bg-warning/15 text-warning', spark: 'hsl(var(--warning))' },
  danger:  { card: 'bg-danger/[0.06] dark:bg-danger/15',  icon: 'bg-danger/15 text-danger',   spark: 'hsl(var(--danger))' },
  amber:   { card: 'bg-amber-50/60 dark:bg-amber-950/30',     icon: 'bg-amber-200/60 text-amber-700 dark:bg-amber-800/40 dark:text-amber-200',       spark: '#d97706' },
  emerald: { card: 'bg-emerald-50/70 dark:bg-emerald-950/30', icon: 'bg-emerald-200/60 text-emerald-700 dark:bg-emerald-800/40 dark:text-emerald-200', spark: '#059669' },
  rose:    { card: 'bg-rose-50/70 dark:bg-rose-950/30',       icon: 'bg-rose-200/60 text-rose-700 dark:bg-rose-800/40 dark:text-rose-200',          spark: '#e11d48' },
  sky:     { card: 'bg-sky-50/70 dark:bg-sky-950/30',         icon: 'bg-sky-200/60 text-sky-700 dark:bg-sky-800/40 dark:text-sky-200',              spark: '#0284c7' },
  violet:  { card: 'bg-violet-50/70 dark:bg-violet-950/30',   icon: 'bg-violet-200/60 text-violet-700 dark:bg-violet-800/40 dark:text-violet-200',  spark: '#7c3aed' },
  teal:    { card: 'bg-teal-50/70 dark:bg-teal-950/30',       icon: 'bg-teal-200/60 text-teal-700 dark:bg-teal-800/40 dark:text-teal-200',          spark: '#0d9488' },
  orange:  { card: 'bg-orange-50/70 dark:bg-orange-950/30',   icon: 'bg-orange-200/60 text-orange-700 dark:bg-orange-800/40 dark:text-orange-200',  spark: '#ea580c' },
  fuchsia: { card: 'bg-fuchsia-50/70 dark:bg-fuchsia-950/30', icon: 'bg-fuchsia-200/60 text-fuchsia-700 dark:bg-fuchsia-800/40 dark:text-fuchsia-200', spark: '#c026d3' },
};

export function KpiCard({ label, value, delta, icon: Icon, loading, tone = 'primary', sparkline }) {
  const t = TONES[tone] || TONES.primary;

  return (
    <Card className={cn('overflow-hidden', t.card)}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {Icon && (
                <div className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-lg', t.icon)}>
                  <Icon size={16} />
                </div>
              )}
              <div className="text-xs uppercase tracking-wider text-muted-fg truncate">{label}</div>
            </div>
            <div className="mt-2 num text-2xl font-semibold tracking-tight">
              {loading ? <Skeleton className="h-7 w-24" /> : value}
            </div>
            {delta && !loading && (
              <div className={cn('mt-1 text-xs', delta.positive ? 'text-success' : 'text-danger')}>
                {delta.value}
              </div>
            )}
          </div>
          {sparkline && sparkline.length > 1 && !loading && (
            <div className="shrink-0 self-end" style={{ width: 96 }}>
              <Sparkline data={sparkline} color={t.spark} height={40} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
