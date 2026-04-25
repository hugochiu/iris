import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutDashboard, ScrollText, Boxes, Layers, Zap, Settings as SettingsIcon, type LucideIcon } from 'lucide-react';
import { RangePicker } from '@/components/range-picker';
import { OverviewPage } from '@/pages/overview';
import { LogsPage } from '@/pages/logs';
import { ByModelPage } from '@/pages/by-model';
import { SessionsPage } from '@/pages/sessions';
import { CachePage } from '@/pages/cache';
import { SettingsPage } from '@/pages/settings';
import type { Range } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'logs' | 'models' | 'sessions' | 'cache' | 'settings';

const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'overview', label: 'Overview', icon: LayoutDashboard },
  { value: 'sessions', label: 'Sessions', icon: Layers },
  { value: 'logs', label: 'Logs', icon: ScrollText },
  { value: 'models', label: 'Models', icon: Boxes },
  { value: 'cache', label: 'Cache', icon: Zap },
  { value: 'settings', label: 'Settings', icon: SettingsIcon },
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

function routeKeyFor(tab: Tab): string {
  if (tab === 'sessions') {
    const s = new URLSearchParams(window.location.search).get('session');
    return s ? `sessions:${s}` : 'sessions:list';
  }
  return tab;
}

export function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>(() => readTabFromUrl());
  const [range, setRange] = useState<Range>(() => readRangeFromUrl());
  const [sessionsKey, setSessionsKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const scrollPositions = useRef<Map<string, number>>(new Map());

  function handleRefresh() {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setTimeout(() => qc.invalidateQueries(), 300);
    setTimeout(() => setIsRefreshing(false), 500);
  }

  function onTabClick(next: Tab) {
    scrollPositions.current.set(routeKeyFor(tab), window.scrollY);
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
      scrollPositions.current.delete('sessions:list');
      window.scrollTo(0, 0);
      setSessionsKey(k => k + 1);
      return;
    }
    setTab(next);
  }

  useEffect(() => {
    const target = scrollPositions.current.get(routeKeyFor(tab)) ?? 0;
    if (target === 0) {
      window.scrollTo(0, 0);
      return;
    }
    let done = false;
    const tryScroll = () => {
      if (done) return true;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (maxY >= target) {
        window.scrollTo(0, target);
        done = true;
        return true;
      }
      return false;
    };
    if (tryScroll()) return;
    const observer = new ResizeObserver(() => { tryScroll(); });
    observer.observe(document.documentElement);
    const timeout = setTimeout(() => { observer.disconnect(); }, 2000);
    return () => {
      observer.disconnect();
      clearTimeout(timeout);
    };
  }, [tab, sessionsKey]);

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
      <header
        className={cn(
          'sticky top-0 z-10 border-b bg-white/90 backdrop-blur transition-[border-color,box-shadow] duration-200',
          isRefreshing
            ? 'border-accent shadow-[0_2px_10px_-1px_hsl(217_91%_55%/0.5)]'
            : 'border-border',
        )}
      >
        <div className="max-w-7xl mx-auto px-5 h-14 flex items-center gap-6">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Refresh"
            aria-label="Refresh"
            className="flex items-center gap-2 rounded-md px-1.5 py-1 -mx-1.5 transition-colors hover:bg-panel cursor-pointer disabled:cursor-pointer"
          >
            <img src="/favicon.svg" alt="" className="h-6 w-6" />
            <span className="font-semibold text-base">Iris</span>
          </button>
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
        {tab === 'cache' && <CachePage range={range} />}
        {tab === 'settings' && <SettingsPage />}
      </main>
    </div>
  );
}
