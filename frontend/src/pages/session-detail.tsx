import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useSessionDetail } from '@/hooks/use-stats';
import type { SessionTimeseriesPoint } from '@/lib/api';
import { MetricCard } from '@/components/metric-card';
import { Card, CardHeader, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LogDetailDrawer } from '@/components/log-detail';
import { formatCost, formatDuration, formatNumber, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from 'recharts';

export function SessionDetailPage({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}) {
  const { data, isLoading, error } = useSessionDetail(sessionId);
  const [selectedLog, setSelectedLog] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('log'),
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedLog) {
      if (url.searchParams.get('log') !== selectedLog) {
        url.searchParams.set('log', selectedLog);
        window.history.replaceState(null, '', url.toString());
      }
    } else if (url.searchParams.has('log') || url.searchParams.has('pane')) {
      url.searchParams.delete('log');
      url.searchParams.delete('pane');
      window.history.replaceState(null, '', url.toString());
    }
  }, [selectedLog]);

  const chartData = useMemo(
    () =>
      (data?.timeseries ?? []).map((p, idx) => ({
        ...p,
        label: formatTimestamp(p.ts),
        idx,
      })),
    [data?.timeseries],
  );

  const renderHeader = (sessionName: string | null) => (
    <div className="flex items-center gap-3 min-w-0">
      <Button variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to sessions
      </Button>
      <div className="min-w-0">
        {sessionName && (
          <div className="text-sm font-medium truncate max-w-[600px]">{sessionName}</div>
        )}
        <div className="font-mono text-xs text-muted break-all">{sessionId}</div>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        {renderHeader(null)}
        <Card className="p-8 text-center text-muted text-sm">Loading…</Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        {renderHeader(null)}
        <Card className="p-8 text-center text-danger text-sm">Session not found.</Card>
      </div>
    );
  }

  const { summary, requests, modelBreakdown } = data;
  const durationMs =
    new Date(summary.lastTimestamp).getTime() - new Date(summary.firstTimestamp).getTime();

  return (
    <div className="space-y-4">
      {renderHeader(summary.sessionName)}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricCard label="Total cost" value={formatCost(summary.totalCost)} tone="accent" />
        <MetricCard label="Total tokens" value={formatNumber(summary.totalTokens)} />
        <MetricCard label="Requests" value={formatNumber(summary.requestCount)} />
        <MetricCard
          label="Duration"
          value={formatDuration(durationMs)}
          sub={formatTimestamp(summary.firstTimestamp)}
        />
        <MetricCard
          label="Models"
          value={String(summary.modelCount)}
          sub={summary.models.join(', ')}
        />
      </div>

      <Card>
        <CardHeader>Per-request cost & tokens</CardHeader>
        <CardBody>
          {chartData.length === 0 ? (
            <div className="py-8 text-center text-muted text-sm">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  stroke="#d1d5db"
                />
                <YAxis
                  yAxisId="cost"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  stroke="#d1d5db"
                  tickFormatter={v => formatCost(v)}
                />
                <YAxis
                  yAxisId="tokens"
                  orientation="right"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  stroke="#d1d5db"
                  tickFormatter={v => formatNumber(v)}
                />
                <Tooltip content={<SessionTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line
                  yAxisId="cost"
                  type="monotone"
                  dataKey="cost"
                  name="cost"
                  stroke="#3b82f6"
                  dot={{ r: 2 }}
                  strokeWidth={2}
                />
                <Line
                  yAxisId="tokens"
                  type="monotone"
                  dataKey="totalTokens"
                  name="tokens"
                  stroke="#10b981"
                  dot={{ r: 2 }}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>Models used</CardHeader>
        <CardBody>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <Th>Model</Th>
                <Th className="text-right">Requests</Th>
                <Th className="text-right">Cost</Th>
              </tr>
            </thead>
            <tbody>
              {modelBreakdown.map(m => (
                <tr key={m.model} className="border-b border-border last:border-0">
                  <Td><span className="font-mono">{m.model}</span></Td>
                  <Td className="text-right tabular-nums">{formatNumber(m.count)}</Td>
                  <Td className="text-right tabular-nums text-accent">{formatCost(m.cost)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader>Requests</CardHeader>
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <Th>Time</Th>
                <Th>Model</Th>
                <Th>Tools</Th>
                <Th className="text-right">In</Th>
                <Th className="text-right">Out</Th>
                <Th className="text-right">Cache R/W</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Dur</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr><td colSpan={9} className="py-8 text-center text-muted">No requests.</td></tr>
              )}
              {[...requests].reverse().map(row => (
                <tr
                  key={row.id}
                  onClick={() => setSelectedLog(row.requestId)}
                  className="border-b border-border hover:bg-panel cursor-pointer"
                >
                  <Td className="tabular-nums font-mono text-muted align-top">{formatTimestamp(row.timestamp)}</Td>
                  <Td>
                    {row.preview && (
                      <div className="mb-1 max-w-[420px] truncate" title={row.preview}>{row.preview}</div>
                    )}
                    <div className="font-mono text-muted text-[11px]">{row.model}</div>
                    {row.realModel && row.realModel !== row.model && (
                      <div className="text-muted text-[11px]">→ {row.realModel}</div>
                    )}
                  </Td>
                  <Td>
                    {row.hasToolUse && (
                      row.toolNames && row.toolNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {row.toolNames.map((name, i) => (
                            <Badge key={i} tone="accent">{name}</Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge tone="accent">tool</Badge>
                      )
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.inputTokens)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.outputTokens)}</Td>
                  <Td className="text-right tabular-nums text-muted">
                    {formatNumber(row.cacheReadInputTokens)}/{formatNumber(row.cacheCreationInputTokens)}
                  </Td>
                  <Td className="text-right tabular-nums text-accent">{row.cost != null ? formatCost(row.cost) : '—'}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(row.durationMs)}</Td>
                  <Td>
                    <Badge tone={row.status === 'success' ? 'success' : 'danger'}>{row.status}</Badge>
                    {row.stopReason && row.stopReason !== 'end_turn' && row.stopReason !== 'tool_use' && (
                      <div className="text-muted text-[11px] mt-1">{row.stopReason}</div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <LogDetailDrawer requestId={selectedLog} onClose={() => setSelectedLog(null)} />
    </div>
  );
}

function SessionTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ payload: SessionTimeseriesPoint & { label: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const raw = payload[0].payload;
  return (
    <div className="bg-white border border-border rounded-lg shadow-md px-3 py-2 text-xs min-w-[200px]">
      <div className="text-muted mb-1.5">{label}</div>
      <div className="space-y-0.5">
        <Row label="cost" value={formatCost(raw.cost)} />
        <Row label="input" value={formatNumber(raw.inputTokens)} />
        <Row label="output" value={formatNumber(raw.outputTokens)} />
        <Row label="total" value={formatNumber(raw.totalTokens)} />
        <div className="text-[10px] font-mono text-muted mt-1 break-all">{raw.requestId}</div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>;
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-3 py-2 align-top', className)}>{children}</td>;
}
