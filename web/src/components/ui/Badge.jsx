import { cn } from '@/lib/cn';

const tones = {
  default: 'bg-muted text-fg',
  primary: 'bg-accent text-accent-fg',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
};

export const Badge = ({ tone = 'default', className, ...props }) => (
  <span
    className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium', tones[tone], className)}
    {...props}
  />
);
