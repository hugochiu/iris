import { useLogDetail } from '@/hooks/use-stats';
import { formatCost, formatDuration, formatNumber, formatTimestamp } from '@/lib/format';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { JsonTree } from './json-tree';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type Pane = 'request' | 'response' | 'headers';

const PANES: Pane[] = ['request', 'response', 'headers'];

function readPaneFromUrl(): Pane {
  const p = new URLSearchParams(window.location.search).get('pane');
  return (PANES as string[]).includes(p ?? '') ? (p as Pane) : 'request';
}

function writePaneToUrl(pane: Pane) {
  const url = new URL(window.location.href);
  if (url.searchParams.get('pane') === pane) return;
  url.searchParams.set('pane', pane);
  window.history.replaceState(null, '', url.toString());
}

export function LogDetailDrawer({
  requestId,
  onClose,
}: {
  requestId: string | null;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<Pane>(() => readPaneFromUrl());
  const { data, isLoading } = useLogDetail(requestId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (requestId) writePaneToUrl(pane);
  }, [pane, requestId]);

  if (!requestId) return null;

  const log = data?.log;
  const payload = data?.payload;

  const paneContent = (() => {
    if (!payload) return null;
    if (pane === 'request') return payload.requestBody;
    if (pane === 'response') return payload.responseBody;
    return {
      incoming: payload.requestHeaders,
      forwarded: payload.forwardedHeaders,
      response: payload.responseHeaders,
    };
  })();

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-3xl bg-white border-l border-border flex flex-col shadow-xl">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <div className="text-xs text-muted">Request</div>
            <div className="text-sm font-mono mt-0.5 break-all">{requestId}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>Close (Esc)</Button>
        </div>

        {isLoading && <div className="p-6 text-sm text-muted">Loading…</div>}

        {log && (
          <div className="px-5 py-3 border-b border-border grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-xs">
            <Field label="Status">
              <Badge tone={log.status === 'success' ? 'success' : 'danger'}>{log.status}</Badge>
            </Field>
            <Field label="Model">
              <div className="font-mono text-fg">{log.model}</div>
              {log.realModel && <div className="text-muted text-[11px]">→ {log.realModel}</div>}
            </Field>
            <Field label="Provider">
              <div className="text-fg">{log.provider ?? '—'}</div>
            </Field>
            <Field label="Timestamp">
              <div className="text-fg tabular-nums">{formatTimestamp(log.timestamp)}</div>
            </Field>
            <Field label="Tokens">
              <div className="text-fg tabular-nums">
                {formatNumber(log.inputTokens)} in / {formatNumber(log.outputTokens)} out
              </div>
              {(log.cacheReadInputTokens > 0 || log.cacheCreationInputTokens > 0) && (
                <div className="text-muted text-[11px] tabular-nums">
                  cache: {formatNumber(log.cacheReadInputTokens)} read / {formatNumber(log.cacheCreationInputTokens)} write
                </div>
              )}
            </Field>
            <Field label="Cost">
              <div className="text-accent tabular-nums">{log.cost != null ? formatCost(log.cost) : '—'}</div>
            </Field>
            <Field label="Duration">
              <div className="text-fg tabular-nums">{formatDuration(log.durationMs)}</div>
            </Field>
            <Field label="TTFT">
              <div className="text-fg tabular-nums">{log.ttftMs != null ? formatDuration(log.ttftMs) : '—'}</div>
            </Field>
            <Field label="TPOT">
              <div className="text-fg tabular-nums">
                {log.tpotMs != null ? formatDuration(log.tpotMs) : '—'}
              </div>
              {log.tpotMs != null && log.tpotMs > 0 && (
                <div className="text-muted text-[11px] tabular-nums">≈ {(1000 / log.tpotMs).toFixed(1)} tok/s</div>
              )}
            </Field>
            <Field label="Stop / Tool">
              <div className="text-fg">
                {log.stopReason ?? '—'}
                {log.hasToolUse && <Badge tone="accent" className="ml-1">tool</Badge>}
              </div>
            </Field>
          </div>
        )}

        {log?.errorMessage && (
          <div className="px-5 py-3 bg-danger/10 border-b border-danger/30 text-xs font-mono text-danger whitespace-pre-wrap break-all">
            {log.errorMessage}
          </div>
        )}

        <div className="px-5 pt-3 flex gap-1 border-b border-border">
          {(['request', 'response', 'headers'] as Pane[]).map(p => (
            <button
              key={p}
              onClick={() => setPane(p)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-t border-b-2 -mb-px',
                pane === p
                  ? 'border-accent text-fg'
                  : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {p}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto scroll-thin">
          <div className="p-5">
            {paneContent == null ? (
              <span className="text-xs text-muted">No payload captured.</span>
            ) : typeof paneContent === 'string' ? (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all text-fg/90">{paneContent}</pre>
            ) : (
              <JsonTree data={paneContent} mode={pane} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-muted text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
