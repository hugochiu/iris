import { useState } from 'react';
import { LayoutDashboard, ScrollText, Boxes, type LucideIcon } from 'lucide-react';
import { RangePicker } from '@/components/range-picker';
import { OverviewPage } from '@/pages/overview';
import { LogsPage } from '@/pages/logs';
import { ByModelPage } from '@/pages/by-model';
import type { Range } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'logs' | 'models';

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'logs', label: 'Logs', icon: ScrollText },
  { value: 'models', label: 'Models', icon: Boxes },
];

export function App() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<Range>('7d');

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-border bg-white/90 backdrop-blur">
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold text-base">Iris</span>
          </div>
          <nav className="flex gap-1">
            {TABS.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.value}
                  onClick={() => setTab(t.value)}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md font-medium transition-colors',
                    tab === t.value ? 'bg-panel text-fg' : 'text-muted hover:text-fg hover:bg-panel',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </nav>
          <div className="flex-1" />
          <RangePicker value={range} onChange={setRange} />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-5 py-5">
        {tab === 'overview' && <OverviewPage range={range} />}
        {tab === 'logs' && <LogsPage range={range} />}
        {tab === 'models' && <ByModelPage range={range} />}
      </main>
    </div>
  );
}
