import { useMemo } from 'react';
import { useByModel, useOpenRouterModels } from '@/hooks/use-stats';
import type { OpenRouterModel, Range } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatCost, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

export function ByModelPage({ range }: { range: Range }) {
  const { data, isLoading } = useByModel(range);
  const { data: catalog } = useOpenRouterModels();
  const priceMap = useMemo(() => {
    const map = new Map<string, OpenRouterModel>();
    for (const m of catalog?.items ?? []) map.set(m.id, m);
    return map;
  }, [catalog]);
  const items = data?.items ?? [];
  const totalCost = items.reduce((acc, m) => acc + m.cost, 0);
  const totalRequests = items.reduce((acc, m) => acc + m.requests, 0);
  const totalInput = items.reduce((acc, m) => acc + m.inputTokens, 0);
  const totalCacheRead = items.reduce((acc, m) => acc + m.cacheReadTokens, 0);
  const totalCacheHitRate = totalInput + totalCacheRead > 0 ? totalCacheRead / (totalInput + totalCacheRead) : 0;

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border text-xs">
              <Th>Model</Th>
              <Th className="text-right">Requests</Th>
              <Th className="text-right">Share</Th>
              <Th className="text-right">Cost</Th>
              <Th className="text-right">Avg in / out tokens</Th>
              <Th className="text-right">Input $/M</Th>
              <Th className="text-right">Output $/M</Th>
              <Th className="text-right">Cache Hit</Th>
              <Th className="text-right">Success</Th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={9} className="py-8 text-center text-muted">Loading…</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={9} className="py-8 text-center text-muted">No data in this range.</td></tr>
            )}
            {items.map(m => {
              const share = totalRequests > 0 ? m.requests / totalRequests : 0;
              const spec = lookupPrice(m.model, priceMap);
              return (
                <tr key={m.model} className="border-b border-border hover:bg-panel">
                  <Td>
                    <div className="font-mono text-fg text-xs">{m.model}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(m.requests)}</Td>
                  <Td className="text-right tabular-nums w-32">
                    <div className="flex items-center gap-2 justify-end">
                      <span className="text-muted text-xs">{formatPercent(share)}</span>
                      <div className="w-20 h-1.5 bg-panel rounded-full overflow-hidden">
                        <div className="h-full bg-accent" style={{ width: `${share * 100}%` }} />
                      </div>
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums text-accent">{formatCost(m.cost)}</Td>
                  <Td className="text-right tabular-nums text-muted">
                    {formatNumber(m.avgInputTokens)} / {formatNumber(m.avgOutputTokens)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    <PriceCell main={spec?.promptCost} cache={spec?.cacheReadCost} known={spec != null} />
                  </Td>
                  <Td className="text-right tabular-nums">
                    <PriceCell main={spec?.completionCost} cache={spec?.cacheWriteCost} known={spec != null} />
                  </Td>
                  <Td className="text-right tabular-nums">
                    <span className={cn(
                      m.cacheHitRate >= 0.6 ? 'text-success' : m.cacheHitRate < 0.3 ? 'text-danger' : 'text-muted',
                    )}>
                      {formatPercent(m.cacheHitRate)}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <Badge tone={m.successRate >= 0.99 ? 'success' : m.successRate < 0.9 ? 'danger' : 'warning'}>
                      {formatPercent(m.successRate)}
                    </Badge>
                  </Td>
                </tr>
              );
            })}
            {items.length > 0 && (
              <tr className="text-muted text-xs">
                <Td className="font-medium">Total</Td>
                <Td className="text-right tabular-nums">{formatNumber(totalRequests)}</Td>
                <Td />
                <Td className="text-right tabular-nums text-accent">{formatCost(totalCost)}</Td>
                <Td />
                <Td />
                <Td />
                <Td className="text-right tabular-nums">{formatPercent(totalCacheHitRate)}</Td>
                <Td />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>;
}

function Td({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <td className={cn('px-3 py-2 align-top', className)}>{children}</td>;
}

function PriceCell({ main, cache, known }: { main: number | undefined; cache: number | undefined; known: boolean }) {
  if (!known) return <span className="text-muted">—</span>;
  return (
    <div className="flex flex-col items-end leading-tight">
      <span className="text-fg">{formatPrice(main)}</span>
      <span className="text-muted text-[10px]">cache {formatPrice(cache)}</span>
    </div>
  );
}

function formatPrice(v: number | undefined): string {
  if (v == null) return '—';
  if (v === 0) return 'Free';
  return `$${v.toFixed(2)}`;
}

function lookupPrice(id: string, map: Map<string, OpenRouterModel>): OpenRouterModel | undefined {
  const direct = map.get(id);
  if (direct) return direct;
  for (const cand of claudeCandidates(id)) {
    const hit = map.get(cand);
    if (hit) return hit;
  }
  return undefined;
}

function claudeCandidates(id: string): string[] {
  const lower = id.toLowerCase();
  if (!lower.includes('claude')) return [];
  const tier = lower.includes('opus') ? 'opus'
    : lower.includes('sonnet') ? 'sonnet'
    : lower.includes('haiku') ? 'haiku'
    : null;
  if (!tier) return [];
  const v = lower.match(/(\d+)[.-](\d+)/);
  if (!v) return [];
  const ver = `${v[1]}.${v[2]}`;
  return [`anthropic/claude-${tier}-${ver}`, `anthropic/claude-${ver}-${tier}`];
}
