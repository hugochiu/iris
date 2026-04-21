import { useSummary, useTimeseries, useByModel } from '@/hooks/use-stats';
import { ERROR_CATEGORIES, STOP_REASONS, type ErrorCategory, type Range, type StopReason, type Bucket, type TimeseriesPoint } from '@/lib/api';
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
  AreaChart,
  Area,
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
  { key: 'inputTokens', shareKey: 'inputShare', name: 'input', color: '#3b82f6' },
  { key: 'outputTokens', shareKey: 'outputShare', name: 'output', color: '#10b981' },
  { key: 'cacheReadTokens', shareKey: 'cacheReadShare', name: 'cache read', color: '#cbd5e1' },
  { key: 'cacheCreationTokens', shareKey: 'cacheCreationShare', name: 'cache write', color: '#f59e0b' },
] as const;

const STEP_MS: Record<Bucket, number> = {
  '5min': 5 * 60_000,
  hour: 60 * 60_000,
  day: 24 * 60 * 60_000,
};

function bucketIso(ms: number, bucket: Bucket): string {
  const d = new Date(ms);
  const Y = d.getUTCFullYear();
  const M = String(d.getUTCMonth() + 1).padStart(2, '0');
  const D = String(d.getUTCDate()).padStart(2, '0');
  if (bucket === 'day') return `${Y}-${M}-${D}T00:00:00Z`;
  const h = String(d.getUTCHours()).padStart(2, '0');
  if (bucket === 'hour') return `${Y}-${M}-${D}T${h}:00:00Z`;
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D}T${h}:${m}:00Z`;
}

function fillGaps(points: TimeseriesPoint[], range: Range, bucket: Bucket): TimeseriesPoint[] {
  if (range === 'all') return points;
  const now = Date.now();
  let startMs: number;
  if (range === 'today') {
    const d = new Date();
    startMs = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  } else if (range === '24h') startMs = now - 24 * 60 * 60_000;
  else if (range === '7d') startMs = now - 7 * 24 * 60 * 60_000;
  else startMs = now - 30 * 24 * 60 * 60_000;

  const step = STEP_MS[bucket];
  const floorMs = (ms: number): number => {
    if (bucket === 'day') {
      const d = new Date(ms);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    }
    return Math.floor(ms / step) * step;
  };
  const advance = (ms: number): number => {
    if (bucket !== 'day') return ms + step;
    const d = new Date(ms);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  };

  const map = new Map(points.map(p => [p.ts, p]));
  const out: TimeseriesPoint[] = [];
  for (let t = floorMs(startMs); t <= floorMs(now); t = advance(t)) {
    const ts = bucketIso(t, bucket);
    out.push(
      map.get(ts) ?? {
        ts,
        requests: 0,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        cacheHitRate: 0,
        avgTtftMs: 0,
        avgTpotMs: 0,
      },
    );
  }
  return out;
}

type TooltipPayloadItem = {
  dataKey: string;
  name: string;
  value: number;
  color: string;
  payload: TimeseriesPoint;
};

function TokenTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadItem[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const raw = payload[0].payload;
  const total =
    raw.inputTokens + raw.outputTokens + raw.cacheReadTokens + raw.cacheCreationTokens;
  return (
    <div className="bg-white border border-border rounded-lg shadow-md px-3 py-2 text-xs min-w-[200px]">
      <div className="text-muted mb-1.5">{label}</div>
      <div className="space-y-1">
        {TOKEN_SERIES.map(s => {
          const v = raw[s.key as keyof TimeseriesPoint] as number;
          return (
            <div key={s.key} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: s.color }} />
                <span className="text-muted">{s.name}</span>
              </span>
              <span className="tabular-nums">
                <span className="text-foreground font-medium">{formatNumber(v)}</span>
                {total > 0 && (
                  <span className="text-muted ml-2">{((v / total) * 100).toFixed(1)}%</span>
                )}
              </span>
            </div>
          );
        })}
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
  const bucket = ts.data?.bucket;
  const filledPoints = bucket ? fillGaps(ts.data!.points, range, bucket) : [];
  const points = filledPoints.map(p => {
    const tokenTotal =
      p.inputTokens + p.outputTokens + p.cacheReadTokens + p.cacheCreationTokens;
    return {
      ...p,
      label: bucket ? formatBucketLabel(p.ts, bucket) : '',
      inputShare: tokenTotal > 0 ? p.inputTokens / tokenTotal : 0,
      outputShare: tokenTotal > 0 ? p.outputTokens / tokenTotal : 0,
      cacheReadShare: tokenTotal > 0 ? p.cacheReadTokens / tokenTotal : 0,
      cacheCreationShare: tokenTotal > 0 ? p.cacheCreationTokens / tokenTotal : 0,
    };
  });

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
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
        <MetricCard
          label="Avg TTFT"
          value={s && s.avgTtftMs > 0 ? formatDuration(s.avgTtftMs) : '—'}
          sub="time to first token"
        />
        <MetricCard
          label="Avg TPOT"
          value={s && s.avgTpotMs > 0 ? formatDuration(s.avgTpotMs) : '—'}
          sub={s && s.avgTpotMs > 0 ? `≈ ${(1000 / s.avgTpotMs).toFixed(1)} tok/s` : 'per output token'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-4">
              <span>Cost & cache hit over time</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted text-xs">total</span>
                <span className="text-foreground font-medium tabular-nums">{s ? formatCost(s.totalCost) : '—'}</span>
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: '#3b82f6' }} />
                <span className="text-muted">cost</span>
                <span className="tabular-nums text-foreground font-medium">{s ? formatCost(s.totalCost) : '—'}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm" style={{ background: '#10b981' }} />
                <span className="text-muted">cache hit</span>
                <span className="tabular-nums text-foreground font-medium">{s ? formatPercent(s.cacheHitRate) : '—'}</span>
              </span>
            </div>
            <div className="h-52">
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
                  <Line yAxisId="cost" type="monotone" dataKey="cost" name="cost" stroke="#3b82f6" strokeWidth={2} dot={points.length === 1 ? { r: 4, fill: '#3b82f6', stroke: '#3b82f6' } : false} />
                  <Line yAxisId="hit" type="monotone" dataKey="cacheHitRate" name="cache hit" stroke="#10b981" strokeWidth={2} dot={points.length === 1 ? { r: 4, fill: '#10b981', stroke: '#10b981', strokeDasharray: '0' } : false} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-baseline justify-between gap-4">
              <span>Token usage</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-muted text-xs">total</span>
                <span className="text-foreground font-medium tabular-nums">{formatNumber(tokenGrandTotal)}</span>
              </span>
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
                <AreaChart data={points} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                  <CartesianGrid stroke="hsl(240 6% 90%)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis
                    tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, 1]}
                    ticks={[0, 0.25, 0.5, 0.75, 1]}
                    tickFormatter={v => `${Math.round(v * 100)}%`}
                    width={56}
                  />
                  <Tooltip cursor={{ stroke: 'hsl(240 6% 80%)', strokeWidth: 1 }} content={<TokenTooltip />} />
                  {TOKEN_SERIES.map(series => (
                    <Area
                      key={series.key}
                      type="monotone"
                      dataKey={series.shareKey}
                      name={series.name}
                      stackId="a"
                      stroke={series.color}
                      fill={series.color}
                      fillOpacity={0.7}
                      strokeWidth={1}
                      dot={false}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {([
          { key: 'avgTtftMs', label: 'TTFT', color: '#3b82f6', avg: s?.avgTtftMs ?? 0 },
          { key: 'avgTpotMs', label: 'TPOT', color: '#10b981', avg: s?.avgTpotMs ?? 0 },
        ] as const).map(series => (
          <Card key={series.key}>
            <CardHeader>
              <div className="flex items-baseline justify-between gap-4">
                <span>{series.label} over time</span>
                <span className="flex items-baseline gap-1.5">
                  <span className="text-muted text-xs">avg</span>
                  <span className="text-foreground font-medium tabular-nums">{s && series.avg > 0 ? formatDuration(series.avg) : '—'}</span>
                </span>
              </div>
            </CardHeader>
            <CardBody>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 8, bottom: 4, left: -8 }}>
                    <CartesianGrid stroke="hsl(240 6% 90%)" strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: 'hsl(240 4% 46%)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => formatDuration(v)} width={56} />
                    <Tooltip
                      contentStyle={{ background: '#fff', border: '1px solid hsl(240 6% 90%)', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                      formatter={(v: number) => formatDuration(v)}
                      labelStyle={{ color: 'hsl(240 4% 46%)' }}
                    />
                    <Line type="monotone" dataKey={series.key} name={series.label} stroke={series.color} strokeWidth={2} dot={points.length === 1 ? { r: 4, fill: series.color, stroke: series.color } : false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>
        ))}
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
