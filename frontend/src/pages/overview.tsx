import { useSummary, useTimeseries, useByModel } from '@/hooks/use-stats';
import { ERROR_CATEGORIES, STOP_REASONS, type ErrorCategory, type Range, type StopReason } from '@/lib/api';
import { MetricCard } from '@/components/metric-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { formatCost, formatDuration, formatNumber, formatPercent, formatBucketLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';

const ERROR_LABELS: Record<ErrorCategory, string> = {
  rate_limit: 'Rate limit',
  timeout: 'Timeout',
  server_error: 'Server 5xx',
  context_length: 'Context length',
  auth: 'Auth',
  connection: 'Connection',
  stream: 'Stream',
  other: 'Other',
};

const STOP_LABELS: Record<StopReason, string> = {
  end_turn: 'end_turn',
  tool_use: 'tool_use',
  max_tokens: 'max_tokens',
  stop_sequence: 'stop_sequence',
  unknown: 'unknown',
};

const PIE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const TOKEN_SERIES = [
  { key: 'inputTokens', name: 'input', color: '#3b82f6' },
  { key: 'outputTokens', name: 'output', color: '#10b981' },
  { key: 'cacheReadTokens', name: 'cache read', color: '#cbd5e1' },
  { key: 'cacheCreationTokens', name: 'cache write', color: '#f59e0b' },
] as const;

type TooltipPayloadItem = {
  dataKey: string;
  name: string;
  value: number;
  color: string;
};

function TokenTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const ordered = TOKEN_SERIES
    .map(s => payload.find(p => p.dataKey === s.key))
    .filter((p): p is TooltipPayloadItem => !!p);
  const total = ordered.reduce((sum, p) => sum + (p.value || 0), 0);
  return (
    <div className="bg-white border border-border rounded-lg shadow-md px-3 py-2 text-xs min-w-[180px]">
      <div className="text-muted mb-1.5">{label}</div>
      <div className="space-y-1">
        {ordered.map(p => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm" style={{ background: p.color }} />
              <span className="text-muted">{p.name}</span>
            </span>
            <span className="tabular-nums">
              <span className="text-foreground font-medium">{formatNumber(p.value)}</span>
              {total > 0 && (
                <span className="text-muted ml-2">{((p.value / total) * 100).toFixed(1)}%</span>
              )}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between gap-4 pt-1.5 mt-1 border-t border-border">
          <span className="text-muted">total</span>
          <span className="text-foreground font-medium tabular-nums">{formatNumber(total)}</span>
        </div>
      </div>
    </div>
  );
}

export function OverviewPage({ range }: { range: Range }) {
  const summary = useSummary(range);
  const ts = useTimeseries(range);
  const byModel = useByModel(range);

  const s = summary.data;
  const points = (ts.data?.points ?? []).map(p => ({
    ...p,
    label: formatBucketLabel(p.ts, ts.data!.bucket),
  }));

  const tokenTotals = points.reduce(
    (acc, p) => ({
      inputTokens: acc.inputTokens + p.inputTokens,
      outputTokens: acc.outputTokens + p.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + p.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + p.cacheCreationTokens,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  );
  const tokenGrandTotal =
    tokenTotals.inputTokens +
    tokenTotals.outputTokens +
    tokenTotals.cacheReadTokens +
    tokenTotals.cacheCreationTokens;

  const errorItems = s
    ? ERROR_CATEGORIES.map(cat => ({ key: cat, label: ERROR_LABELS[cat], count: s.errorCategories[cat] ?? 0 }))
        .filter(it => it.count > 0)
        .sort((a, b) => b.count - a.count)
    : [];
  const errorTotal = errorItems.reduce((acc, it) => acc + it.count, 0);

  const stopItems = s
    ? STOP_REASONS.map(r => ({ key: r, label: STOP_LABELS[r], count: s.stopReasons[r] ?? 0 }))
        .filter(it => it.count > 0)
        .sort((a, b) => b.count - a.count)
    : [];
  const stopTotal = stopItems.reduce((acc, it) => acc + it.count, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard
          label="Requests"
          value={s ? formatNumber(s.totalRequests) : '—'}
          sub={s && <><span className="text-success">{s.successCount} ok</span> · <span className="text-danger">{s.errorCount} err</span></>}
        />
        <MetricCard
          label="Total Cost"
          value={s ? formatCost(s.totalCost) : '—'}
          sub={s && s.totalRequests > 0 ? `avg ${formatCost(s.totalCost / s.totalRequests)}/req` : undefined}
          tone="accent"
        />
        <MetricCard
          label="Success Rate"
          value={s ? formatPercent(s.successRate) : '—'}
          tone={s && s.successRate >= 0.99 ? 'success' : s && s.successRate < 0.9 ? 'danger' : 'default'}
        />
        <MetricCard
          label="Cache Hit Rate"
          value={s ? formatPercent(s.cacheHitRate) : '—'}
          tone={s ? (s.cacheHitRate >= 0.6 ? 'success' : s.cacheHitRate < 0.3 ? 'warning' : 'default') : 'default'}
          sub={s ? `${formatNumber(s.tokens.cacheRead)} cached in` : undefined}
        />
        <MetricCard
          label="Avg Latency"
          value={s ? formatDuration(s.avgDurationMs) : '—'}
          sub={s && `${s.toolUseCount} tool uses`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-4">
              <span>Cost & cache hit over time</span>
              <div className="flex gap-3 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#3b82f6' }} /><span className="text-muted">cost</span></span>
                <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: '#10b981' }} /><span className="text-muted">cache hit</span></span>
              </div>
            </div>
          </CardHeader>
          <CardBody>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                  <CartesianGrid stroke="hsl(240 6% 90%)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="cost" tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis yAxisId="hit" orientation="right" domain={[0, 1]} tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${Math.round(v * 100)}%`} />
                  <Tooltip
                    contentStyle={{ background: '#fff', border: '1px solid hsl(240 6% 90%)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                    formatter={(v: number, name: string) => (name === 'cache hit' ? formatPercent(v) : formatCost(v))}
                    labelStyle={{ color: 'hsl(240 4% 46%)' }}
                  />
                  <Line yAxisId="cost" type="monotone" dataKey="cost" name="cost" stroke="#3b82f6" strokeWidth={2} dot={points.length === 1 ? { r: 5, fill: '#3b82f6', stroke: '#3b82f6' } : false} />
                  <Line yAxisId="hit" type="monotone" dataKey="cacheHitRate" name="cache hit" stroke="#10b981" strokeWidth={2} dot={points.length === 1 ? { r: 2.5, fill: '#10b981', stroke: '#10b981', strokeDasharray: '0' } : false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-4">
              <span>Token usage</span>
              <span className="text-foreground font-medium tabular-nums">{formatNumber(tokenGrandTotal)}</span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
              {TOKEN_SERIES.map(series => {
                const value = tokenTotals[series.key as keyof typeof tokenTotals];
                const pct = tokenGrandTotal > 0 ? (value / tokenGrandTotal) * 100 : 0;
                return (
                  <span key={series.key} className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-sm" style={{ background: series.color }} />
                    <span className="text-muted">{series.name}</span>
                    <span className="tabular-nums text-foreground font-medium">{formatNumber(value)}</span>
                    {tokenGrandTotal > 0 && (
                      <span className="tabular-nums text-muted">{pct.toFixed(0)}%</span>
                    )}
                  </span>
                );
              })}
            </div>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }} barCategoryGap="30%">
                  <CartesianGrid stroke="hsl(240 6% 90%)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => formatNumber(v)} width={56} />
                  <Tooltip cursor={{ fill: 'hsl(240 6% 90% / 0.4)' }} content={<TokenTooltip />} />
                  {TOKEN_SERIES.map((series, i) => (
                    <Bar
                      key={series.key}
                      dataKey={series.key}
                      name={series.name}
                      stackId="a"
                      fill={series.color}
                      maxBarSize={56}
                      radius={i === TOKEN_SERIES.length - 1 ? [3, 3, 0, 0] : 0}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-4">
              <span>Error breakdown</span>
              <span className="text-xs text-muted tabular-nums">{errorTotal} error{errorTotal === 1 ? '' : 's'}</span>
            </div>
          </CardHeader>
          <CardBody>
            {!s ? (
              <div className="py-8 text-center text-muted text-sm">Loading…</div>
            ) : errorItems.length === 0 ? (
              <div className="py-8 text-center text-muted text-sm">No errors in this range.</div>
            ) : (
              <div className="space-y-2">
                {errorItems.map(it => {
                  const pct = errorTotal > 0 ? it.count / errorTotal : 0;
                  return (
                    <div key={it.key} className="flex items-center gap-3 text-sm">
                      <span className="w-28 text-muted shrink-0">{it.label}</span>
                      <div className="flex-1 h-2 bg-panel rounded-full overflow-hidden">
                        <div className="h-full bg-danger/70" style={{ width: `${pct * 100}%` }} />
                      </div>
                      <span className="tabular-nums text-fg w-10 text-right">{it.count}</span>
                      <span className="tabular-nums text-muted w-12 text-right text-xs">{formatPercent(pct)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-4">
              <span>Stop reasons</span>
              <span className="text-xs text-muted tabular-nums">{stopTotal} req</span>
            </div>
          </CardHeader>
          <CardBody>
            {!s ? (
              <div className="py-8 text-center text-muted text-sm">Loading…</div>
            ) : stopItems.length === 0 ? (
              <div className="py-8 text-center text-muted text-sm">No data in this range.</div>
            ) : (
              <div className="space-y-2">
                {stopItems.map(it => {
                  const pct = stopTotal > 0 ? it.count / stopTotal : 0;
                  const isTruncation = it.key === 'max_tokens' && pct > 0.02;
                  return (
                    <div key={it.key} className="flex items-center gap-3 text-sm">
                      <span className={cn('w-28 shrink-0 font-mono text-xs', isTruncation ? 'text-warning' : 'text-muted')}>{it.label}</span>
                      <div className="flex-1 h-2 bg-panel rounded-full overflow-hidden">
                        <div className={cn('h-full', isTruncation ? 'bg-warning/80' : 'bg-accent/60')} style={{ width: `${pct * 100}%` }} />
                      </div>
                      <span className="tabular-nums text-fg w-10 text-right">{it.count}</span>
                      <span className="tabular-nums text-muted w-12 text-right text-xs">{formatPercent(pct)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>Model distribution</CardHeader>
        <CardBody>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={byModel.data?.items ?? []}
                  dataKey="requests"
                  nameKey="model"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  innerRadius={50}
                  paddingAngle={2}
                >
                  {(byModel.data?.items ?? []).map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid hsl(240 6% 90%)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                  formatter={(v: number) => `${v} requests`}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(240 4% 46%)' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
