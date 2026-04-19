import { cn } from '@/lib/utils';
import type { PropsWithChildren } from 'react';

type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'accent';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-panel text-muted border-border',
  success: 'bg-success/10 text-success border-success/25',
  danger: 'bg-danger/10 text-danger border-danger/25',
  warning: 'bg-warning/10 text-warning border-warning/25',
  accent: 'bg-accent/10 text-accent border-accent/25',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
}: PropsWithChildren<{ tone?: Tone; className?: string }>) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
