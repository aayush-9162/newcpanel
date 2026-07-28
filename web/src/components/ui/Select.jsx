import * as React from 'react';
import { cn } from '@/lib/cn';

export const Select = React.forwardRef(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Select.displayName = 'Select';
