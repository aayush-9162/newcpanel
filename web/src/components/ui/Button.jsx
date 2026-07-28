import * as React from 'react';
import { cn } from '@/lib/cn';

const variants = {
  primary: 'bg-primary text-primary-fg hover:opacity-90 focus-visible:ring-ring',
  secondary: 'bg-muted text-fg hover:bg-muted/70 focus-visible:ring-ring',
  outline: 'border border-border bg-card hover:bg-muted focus-visible:ring-ring',
  ghost: 'hover:bg-muted',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizes = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-4 text-sm',
  lg: 'h-10 px-5 text-sm',
  icon: 'h-9 w-9 p-0',
};

export const Button = React.forwardRef(({ className, variant = 'primary', size = 'md', ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition outline-none ring-offset-2 focus-visible:ring-2 disabled:pointer-events-none disabled:opacity-50',
      variants[variant],
      sizes[size],
      className,
    )}
    {...props}
  />
));
Button.displayName = 'Button';
