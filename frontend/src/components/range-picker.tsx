import type { Range } from '@/lib/api';
import { cn } from '@/lib/utils';

const OPTIONS: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
];

export function RangePicker({ value, onChange }: { value: Range; onChange: (v: Range) => void }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-white p-0.5">
      {OPTIONS.map(opt => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded transition-colors',
            value === opt.value ? 'bg-fg text-white' : 'text-muted hover:text-fg hover:bg-panel',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
