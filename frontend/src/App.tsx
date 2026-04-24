import { useEffect, useState } from 'react';
import { LayoutDashboard, ScrollText, Boxes, Layers, type LucideIcon } from 'lucide-react';
import { RangePicker } from '@/components/range-picker';
import { OverviewPage } from '@/pages/overview';
import { LogsPage } from '@/pages/logs';
import { ByModelPage } from '@/pages/by-model';
import { SessionsPage } from '@/pages/sessions';
import type { Range } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'logs' | 'models' | 'sessions';

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'sessions', label: 'Sessions', icon: Layers },
  { value: 'logs', label: 'Logs', icon: ScrollText },
  { value: 'models', label: 'Models', icon: Boxes },
];

const TAB_VALUES = TABS.map(t => t.value);
const RANGE_VALUES: Range[] = ['today', '24h', '7d', '30d', 'all'];
const DEFAULT_RANGE: Range = 'today';

function readTabFromUrl(): Tab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return (TAB_VALUES as string[]).includes(t ?? '') ? (t as Tab) : 'overview';
}

function readRangeFromUrl(): Range {
  const r = new URLSearchParams(window.location.search).get('range');
  return (RANGE_VALUES as string[]).includes(r ?? '') ? (r as Range) : DEFAULT_RANGE;
}

export function App() {
  const [tab, setTab] = useState<Tab>(() => readTabFromUrl());
  const [range, setRange] = useState<Range>(() => readRangeFromUrl());
  const [sessionsKey, setSessionsKey] = useState(0);

  function onTabClick(next: Tab) {
    if (next === 'sessions' && tab === 'sessions') {
      const url = new URL(window.location.href);
      if (
        url.searchParams.has('session') ||
        url.searchParams.has('session_log') ||
        url.searchParams.has('session_pane')
      ) {
        url.searchParams.delete('session');
        url.searchParams.delete('session_log');
        url.searchParams.delete('session_pane');
        window.history.replaceState(null, '', url.toString());
      }
      setSessionsKey(k => k + 1);
      return;
    }
    setTab(next);
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    if (tab === 'overview') {
      if (url.searchParams.has('tab')) { url.searchParams.delete('tab'); changed = true; }
    } else if (url.searchParams.get('tab') !== tab) {
      url.searchParams.set('tab', tab); changed = true;
    }
    if (changed) window.history.replaceState(null, '', url.toString());
  }, [tab]);

  useEffect(() => {
    const url = new URL(window.location.href);
    let changed = false;
    if (range === DEFAULT_RANGE) {
      if (url.searchParams.has('range')) { url.searchParams.delete('range'); changed = true; }
    } else if (url.searchParams.get('range') !== range) {
      url.searchParams.set('range', range); changed = true;
    }
    if (changed) window.history.replaceState(null, '', url.toString());
  }, [range]);

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
                  onClick={() => onTabClick(t.value)}
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
        {tab === 'sessions' && <SessionsPage key={sessionsKey} range={range} />}
      </main>
    </div>
  );
}
