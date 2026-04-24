import { useMemo } from 'react';
import { useSummary, useByModel, useOpenRouterModels } from '@/hooks/use-stats';
import type { ModelStats, OpenRouterModel, Range } from '@/lib/api';
import { MetricCard } from '@/components/metric-card';
import { Card } from '@/components/ui/card';
import { formatCost, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

type Savings = {
  saved: number | null;
  readSaved: number;
  writePremium: number;
};

function canonicalModelId(raw: string): string {
  const s = raw.toLowerCase().replace(/^~?anthropic\//, '');
  const tier = s.match(/(opus|sonnet|haiku)/)?.[1];
  const ver = s.match(/(\d+)[.-](\d+)/);
  if (tier && ver) return `claude-${tier}-${ver[1]}.${ver[2]}`;
  return s;
}

function computeSavings(m: ModelStats, price: OpenRouterModel | undefined): Savings {
  if (!price || price.promptCost == null || price.cacheReadCost == null) {
    return { saved: null, readSaved: 0, writePremium: 0 };
  }
  const readSaved = (m.cacheReadTokens * (price.promptCost - price.cacheReadCost)) / 1_000_000;
  let writePremium = 0;
  if (m.cacheCreationTokens > 0) {
    if (price.cacheWriteCost == null) {
      return { saved: null, readSaved, writePremium: 0 };
    }
    writePremium = (m.cacheCreationTokens * (price.cacheWriteCost - price.promptCost)) / 1_000_000;
  }
  return { saved: readSaved - writePremium, readSaved, writePremium };
}

function formatSignedCost(n: number): string {
  if (n === 0) return '$0';
  const sign = n > 0 ? '+' : '−';
  return `${sign}${formatCost(Math.abs(n))}`;
}

export function CachePage({ range }: { range: Range }) {
  const summaryQ = useSummary(range);
  const byModelQ = useByModel(range);
  const modelsQ = useOpenRouterModels();

  const priceMap = useMemo(() => {
    const map = new Map<string, OpenRouterModel>();
    for (const m of modelsQ.data?.items ?? []) {
      map.set(m.id, m);
      const canon = canonicalModelId(m.id);
      if (!map.has(canon)) map.set(canon, m);
    }
    return map;
  }, [modelsQ.data]);

  const items = byModelQ.data?.items ?? [];

  const enriched = useMemo(() => {
    return items
      .map(m => {
        const price = priceMap.get(m.model) ?? priceMap.get(canonicalModelId(m.model));
        return { stats: m, price, savings: computeSavings(m, price) };
      })
      .sort((a, b) => {
        const as = a.savings.saved ?? -Infinity;
        const bs = b.savings.saved ?? -Infinity;
        return bs - as;
      });
  }, [items, priceMap]);

  const totals = useMemo(() => {
    let saved = 0;
    let hasAny = false;
    let writePremium = 0;
    let readTokens = 0;
    let writeTokens = 0;
    for (const e of enriched) {
      readTokens += e.stats.cacheReadTokens;
      writeTokens += e.stats.cacheCreationTokens;
      if (e.savings.saved != null) {
        saved += e.savings.saved;
        writePremium += e.savings.writePremium;
        hasAny = true;
      }
    }
    return { saved: hasAny ? saved : null, writePremium, readTokens, writeTokens };
  }, [enriched]);

  const hitRate = summaryQ.data?.cacheHitRate ?? 0;
  const isLoading = summaryQ.isLoading || byModelQ.isLoading;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MetricCard
          label="Net savings"
          tone={totals.saved == null ? 'default' : totals.saved > 0 ? 'success' : 'danger'}
          value={totals.saved == null ? '—' : formatSignedCost(totals.saved)}
          sub={
            totals.saved == null
              ? 'no pricing data'
              : `vs. charging all input at full rate`
          }
        />
        <MetricCard
          label="Cache hit rate"
          tone={hitRate >= 0.6 ? 'success' : hitRate < 0.3 ? 'danger' : 'default'}
          value={formatPercent(hitRate)}
          sub={`${formatNumber(totals.readTokens)} cache-read tokens`}
        />
        <MetricCard
          label="Cache writes"
          value={formatNumber(totals.writeTokens)}
          sub={
            totals.writePremium > 0
              ? `${formatCost(totals.writePremium)} write premium`
              : 'no write premium'
          }
        />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-border text-xs">
                <Th>Model</Th>
                <Th className="text-right">Requests</Th>
                <Th className="text-right">Input</Th>
                <Th className="text-right">Cache read</Th>
                <Th className="text-right">Cache write</Th>
                <Th className="text-right">Hit rate</Th>
                <Th className="text-right">Net savings</Th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="py-8 text-center text-muted">Loading…</td></tr>
              )}
              {!isLoading && enriched.length === 0 && (
                <tr><td colSpan={7} className="py-8 text-center text-muted">No data in this range.</td></tr>
              )}
              {enriched.map(({ stats: m, savings }) => (
                <tr key={m.model} className="border-b border-border hover:bg-panel">
                  <Td>
                    <div className="font-mono text-fg text-xs">{m.model}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(m.requests)}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatNumber(m.inputTokens)}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatNumber(m.cacheReadTokens)}</Td>
                  <Td className="text-right tabular-nums text-muted">{formatNumber(m.cacheCreationTokens)}</Td>
                  <Td className="text-right tabular-nums">
                    <span className={cn(
                      m.cacheHitRate >= 0.6 ? 'text-success' : m.cacheHitRate < 0.3 ? 'text-danger' : 'text-muted',
                    )}>
                      {formatPercent(m.cacheHitRate)}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {savings.saved == null ? (
                      <span className="text-muted">—</span>
                    ) : (
                      <span className={savings.saved > 0 ? 'text-success' : savings.saved < 0 ? 'text-danger' : 'text-muted'}>
                        {formatSignedCost(savings.saved)}
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-xs text-muted px-1">
        Net savings ≈ cache_read × (prompt − cache_read_price) − cache_write × (cache_write_price − prompt).
        Rows show “—” when OpenRouter does not publish cache pricing for that model.
      </p>
    </div>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>;
}

function Td({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <td className={cn('px-3 py-2 align-top', className)}>{children}</td>;
}
