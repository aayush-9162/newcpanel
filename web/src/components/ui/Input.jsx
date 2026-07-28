import * as React from 'react';
import { cn } from '@/lib/cn';

export const Input = React.forwardRef(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none transition placeholder:text-muted-fg focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
