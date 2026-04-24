import { useEffect, useState } from 'react';
import { useSessions } from '@/hooks/use-stats';
import type { Range } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatCost, formatLongDuration, formatNumber, formatTimestamp } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SessionDetailPage } from './session-detail';

export function SessionsPage({ range }: { range: Range }) {
  const [selectedSession, setSelectedSession] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get('session'),
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedSession) {
      if (url.searchParams.get('session') !== selectedSession) {
        url.searchParams.set('session', selectedSession);
        window.history.replaceState(null, '', url.toString());
      }
    } else if (url.searchParams.has('session')) {
      url.searchParams.delete('session');
      window.history.replaceState(null, '', url.toString());
    }
  }, [selectedSession]);

  if (selectedSession) {
    return (
      <SessionDetailPage
        sessionId={selectedSession}
        onBack={() => setSelectedSession(null)}
      />
    );
  }

  return <SessionsList range={range} onOpen={setSelectedSession} />;
}

function SessionsList({
  range,
  onOpen,
}: {
  range: Range;
  onOpen: (sessionId: string) => void;
}) {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([]);

  useEffect(() => {
    setCursor(undefined);
    setCursorStack([]);
  }, [range]);

  const sessions = useSessions(range, cursor);
  const items = sessions.data?.items ?? [];

  function next() {
    if (!sessions.data?.nextCursor) return;
    setCursorStack(s => [...s, cursor]);
    setCursor(sessions.data.nextCursor);
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
      <Card className="overflow-hidden">
        <div className="overflow-x-auto scroll-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <Th>Session</Th>
                <Th>Started</Th>
                <Th className="text-right">Span</Th>
                <Th className="text-right">Active</Th>
                <Th className="text-right">Requests</Th>
                <Th>Models</Th>
                <Th className="text-right">Total cost</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {sessions.isLoading && (
                <tr><td colSpan={8} className="py-8 text-center text-muted">Loading…</td></tr>
              )}
              {!sessions.isLoading && items.length === 0 && (
                <tr><td colSpan={8} className="py-8 text-center text-muted">No sessions in this range.</td></tr>
              )}
              {items.map(s => {
                const durationMs =
                  new Date(s.lastTimestamp).getTime() - new Date(s.firstTimestamp).getTime();
                const modelsPreview = s.models.slice(0, 3);
                const extra = s.models.length - modelsPreview.length;
                return (
                  <tr
                    key={s.sessionId}
                    onClick={() => onOpen(s.sessionId)}
                    className="border-b border-border hover:bg-panel cursor-pointer"
                  >
                    <Td>
                      {s.sessionName ? (
                        <div className="max-w-[420px] break-words whitespace-pre-wrap" title={s.sessionName}>
                          {s.sessionName}
                        </div>
                      ) : (
                        <div className="text-muted italic">(no message)</div>
                      )}
                      <div className="font-mono text-muted text-[11px]">{s.sessionId.slice(0, 12)}…</div>
                    </Td>
                    <Td className="tabular-nums text-muted">{formatTimestamp(s.firstTimestamp)}</Td>
                    <Td className="text-right tabular-nums"><span title="First request → last request">{formatLongDuration(durationMs)}</span></Td>
                    <Td className="text-right tabular-nums"><span title="Sum of per-request processing time">{formatLongDuration(s.activeDurationMs)}</span></Td>
                    <Td className="text-right tabular-nums">{formatNumber(s.requestCount)}</Td>
                    <Td>
                      <div
                        className="text-muted text-[11px] font-mono"
                        title={s.models.join('\n')}
                      >
                        {modelsPreview.map((m, i) => (
                          <div key={i}>{m}</div>
                        ))}
                        {extra > 0 && <div className="text-fg">+{extra} more</div>}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums text-accent">{formatCost(s.totalCost)}</Td>
                    <Td>
                      <Badge tone={s.hasError ? 'danger' : 'success'}>
                        {s.hasError ? 'has error' : 'ok'}
                      </Badge>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between text-xs text-muted">
        <div>{items.length > 0 && `${items.length} sessions`}</div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={prev} disabled={cursorStack.length === 0}>Prev</Button>
          <Button variant="outline" size="sm" onClick={next} disabled={!sessions.data?.nextCursor}>Next</Button>
        </div>
      </div>
    </div>
  );
}

function Th({ className, children }: { className?: string; children: React.ReactNode }) {
  return <th className={cn('px-3 py-2 font-medium', className)}>{children}</th>;
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-3 py-2 align-top', className)}>{children}</td>;
}
