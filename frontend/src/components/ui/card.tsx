import { cn } from '@/lib/utils';
import type { HTMLAttributes, PropsWithChildren } from 'react';

export function Card({ className, children, ...rest }: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-white shadow-sm', className)}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('px-4 pt-4 pb-2 text-sm text-muted', className)}>{children}</div>;
}

export function CardBody({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <div className={cn('px-4 pb-4', className)}>{children}</div>;
}

export function CardTitle({ className, children }: PropsWithChildren<{ className?: string }>) {
  return <h3 className={cn('text-sm font-medium text-muted', className)}>{children}</h3>;
}
