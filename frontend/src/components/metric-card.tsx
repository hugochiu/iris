import { Card } from './ui/card';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function MetricCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: 'default' | 'success' | 'danger' | 'accent' | 'warning';
}) {
  const valueClass = {
    default: 'text-fg',
    success: 'text-success',
    danger: 'text-danger',
    accent: 'text-accent',
    warning: 'text-warning',
  }[tone];

  return (
    <Card className="px-4 py-3">
      <div className="text-xs font-medium text-muted uppercase tracking-wide">{label}</div>
      <div className={cn('mt-1.5 text-2xl font-semibold tabular-nums', valueClass)}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted tabular-nums">{sub}</div>}
    </Card>
  );
}
