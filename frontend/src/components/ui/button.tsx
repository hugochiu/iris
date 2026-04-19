import { cn } from '@/lib/utils';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'ghost' | 'outline';
type Size = 'sm' | 'md';

const variantClass: Record<Variant, string> = {
  default: 'bg-fg text-white hover:bg-fg/90',
  ghost: 'hover:bg-panel text-muted hover:text-fg',
  outline: 'border border-border bg-white hover:bg-panel text-fg',
};

const sizeClass: Record<Size, string> = {
  sm: 'h-7 px-2 text-xs',
  md: 'h-9 px-3 text-sm',
};

export function Button({
  variant = 'default',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center rounded-md font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none',
        variantClass[variant],
        sizeClass[size],
        className,
      )}
      {...rest}
    />
  );
}
