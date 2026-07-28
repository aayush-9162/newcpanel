import { cn } from '@/lib/cn';

export const Skeleton = ({ className, ...props }) => (
  <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />
);
