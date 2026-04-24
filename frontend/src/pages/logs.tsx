import { useEffect, useState } from 'react';
import { useLogs } from '@/hooks/use-stats';
import type { Range, LogsQuery } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LogDetailDrawer } from '@/components/log-detail';
import { formatCost, formatDuration, formatNumber, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';

export function LogsPage({ range }: { range: Range }) {
  const [status, setStatus] = useState<'' | 'success' | 'error'>('');
  const [modelQuery, setModelQuery] = useState('');
  const [toolUse, setToolUse] = useState<'' | 'true' | 'false'>('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);
  const [selected, setSelected] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('log'),
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected) {
      if (url.searchParams.get('log') !== selected) {
        url.searchParams.set('log', selected);
        window.history.replaceState(null, '', url.toString());
      }
    } else if (url.searchParams.has('log') || url.searchParams.has('pane')) {
      url.searchParams.delete('log');
      url.searchParams.delete('pane');
      window.history.replaceState(null, '', url.toString());
    }
  }, [selected]);

  const query: LogsQuery = {
    range,
    cursor,
    limit: 50,
    status: status || undefined,
    model: modelQuery || undefined,
    hasToolUse: toolUse || undefined,
  };

  const logs = useLogs(query);
  const items = logs.data?.items ?? [];

  function resetPagination() {
    setCursor(undefined);
    setCursorStack([]);
  }

  function next() {
    if (!logs.data?.nextCursor) return;
    setCursorStack(s => [...s, cursor]);
    setCursor(logs.data.nextCursor);
  }

  function prev() {
    if (cursorStack.length === 0) return;
    const copy = [...cursorStack];
    const last = copy.pop();
    setCursorStack(copy);
    setCursor(last);
  }

  return (
    <div className="space-y-3">
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={e => { setStatus(e.target.value as '' | 'success' | 'error'); resetPagination(); }}
          className="h-8 rounded-md bg-white border border-border px-2 text-xs text-fg"
        >
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
        </select>
        <select
          value={toolUse}
          onChange={e => { setToolUse(e.target.value as '' | 'true' | 'false'); resetPagination(); }}
          className="h-8 rounded-md bg-white border border-border px-2 text-xs text-fg"
        >
          <option value="">Any tool use</option>
          <option value="true">With tool use</option>
          <option value="false">Without tool use</option>
        </select>
        <input
          type="text"
          placeholder="filter by model…"
          value={modelQuery}
          onChange={e => { setModelQuery(e.target.value); resetPagination(); }}
          className="h-8 rounded-md bg-white border border-border px-2 text-xs text-fg placeholder:text-muted w-56 focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <Th>Time</Th>
                <Th>Model</Th>
                <Th className="text-right">In</Th>
                <Th className="text-right">Out</Th>
                <Th className="text-right">Cache R/W</Th>
                <Th className="text-right">Cost</Th>
                <Th className="text-right">Dur</Th>
                <Th className="text-right">TTFT / TPOT</Th>
                <Th>Status</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && !logs.isLoading && (
                <tr><td colSpan={10} className="py-8 text-center text-muted">No logs match current filters.</td></tr>
              )}
              {items.map(row => (
                <tr
                  key={row.id}
                  onClick={() => setSelected(row.requestId)}
                  className="border-b border-border hover:bg-panel cursor-pointer"
                >
                  <Td className="tabular-nums font-mono text-muted">{formatTimestamp(row.timestamp)}</Td>
                  <Td>
                    <div className="font-mono">{row.model}</div>
                    {row.realModel && row.realModel !== row.model && (
                      <div className="text-muted text-[11px]">→ {row.realModel}</div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.inputTokens)}</Td>
                  <Td className="text-right tabular-nums">{formatNumber(row.outputTokens)}</Td>
                  <Td className="text-right tabular-nums text-muted">
                    {formatNumber(row.cacheReadInputTokens)}/{formatNumber(row.cacheCreationInputTokens)}
                  </Td>
                  <Td className="text-right tabular-nums text-accent">{row.cost != null ? formatCost(row.cost) : '—'}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(row.durationMs)}</Td>
                  <Td className="text-right tabular-nums text-muted">
                    {row.ttftMs != null ? formatDuration(row.ttftMs) : '—'}
                    <span className="mx-1 text-border">/</span>
                    {row.tpotMs != null ? formatDuration(row.tpotMs) : '—'}
                  </Td>
                  <Td>
                    <Badge tone={row.status === 'success' ? 'success' : 'danger'}>{row.status}</Badge>
                  </Td>
                  <Td>
                    {row.hasToolUse && <Badge tone="accent">tool</Badge>}
                    {row.stopReason && row.stopReason !== 'end_turn' && row.stopReason !== 'tool_use' && (
                      <Badge tone="warning" className="ml-1">{row.stopReason}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted">
        <div>{items.length > 0 && `${items.length} rows`}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={prev} disabled={cursorStack.length === 0}>Prev</Button>
          <Button variant="outline" size="sm" onClick={next} disabled={!logs.data?.nextCursor}>Next</Button>
        </div>
      </div>

      <LogDetailDrawer requestId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>;
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-3 py-2 align-top', className)}>{children}</td>;
}
