import { useEffect, useMemo, useState } from 'react';

type Mode = 'request' | 'response' | 'headers';

export function JsonTree({ data, mode = 'response' }: { data: unknown; mode?: Mode }) {
  const [version, setVersion] = useState(0);
  const [defaultOpen, setDefaultOpen] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  // request 侧：messages 数组通常很长（含历史轮 + system prompt + tool schemas），
  // 只默认展开最近一条 user message；其余按"浅层折叠"启发式处理。
  // response/headers 侧：默认全展开，redacted_thinking 例外。
  const autoExpandPaths = useMemo(
    () => (mode === 'request' ? computeRequestAutoExpandPaths(data) : new Set<string>()),
    [data, mode],
  );

  function expandAll() { setDefaultOpen(true); setVersion(v => v + 1); }
  function collapseAll() { setDefaultOpen(false); setVersion(v => v + 1); }
  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="text-xs font-mono">
      <div className="flex gap-3 pb-2 mb-2 border-b border-border text-[11px]">
        <button onClick={expandAll} className="text-muted hover:text-fg">Expand all</button>
        <button onClick={collapseAll} className="text-muted hover:text-fg">Collapse all</button>
        <button onClick={copyJson} className="text-muted hover:text-fg">{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <JsonNode
        value={data}
        depth={0}
        path=""
        version={version}
        forced={defaultOpen}
        mode={mode}
        autoExpandPaths={autoExpandPaths}
      />
    </div>
  );
}

function computeRequestAutoExpandPaths(data: unknown): Set<string> {
  const set = new Set<string>();
  if (!data || typeof data !== 'object') return set;
  const messages = (data as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return set;

  set.add('messages');
  messages.forEach((msg, i) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { role?: unknown; content?: unknown };
    if (m.role !== 'user') return;
    if (!Array.isArray(m.content)) return;

    const msgPath = `messages.${i}`;
    const contentPath = `${msgPath}.content`;
    const textIndices: number[] = [];
    m.content.forEach((item, j) => {
      if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'text') {
        textIndices.push(j);
      }
    });
    if (textIndices.length === 0) return;

    set.add(msgPath);
    set.add(contentPath);
    textIndices.forEach(j => set.add(`${contentPath}.${j}`));
  });
  return set;
}

interface NodeProps {
  value: unknown;
  depth: number;
  path: string;
  version: number;
  forced: boolean | null;
  mode: Mode;
  autoExpandPaths: Set<string>;
}

function JsonNode({ value, depth, path, version, forced, mode, autoExpandPaths }: NodeProps) {
  if (value === null) return <span className="text-purple-600">null</span>;
  if (value === undefined) return <span className="text-slate-400">undefined</span>;
  if (typeof value === 'boolean') return <span className="text-purple-600">{String(value)}</span>;
  if (typeof value === 'number') return <span className="text-amber-700 tabular-nums">{value}</span>;
  if (typeof value === 'string') return <StringValue value={value} mode={mode} />;
  if (typeof value === 'object') {
    return (
      <Collapsible
        value={value as object | unknown[]}
        depth={depth}
        path={path}
        version={version}
        forced={forced}
        mode={mode}
        autoExpandPaths={autoExpandPaths}
      />
    );
  }
  return <span className="text-slate-500">{String(value)}</span>;
}

function StringValue({ value, mode }: { value: string; mode: Mode }) {
  // request 侧默认折叠长字符串避免 system prompt / 历史轮糊屏；
  // response/headers 侧用户要看完整内容，默认展开。
  const [expanded, setExpanded] = useState(mode !== 'request');
  const TRUNCATE = 240;
  const isLong = value.length > TRUNCATE;
  const shown = !expanded && isLong ? value.slice(0, TRUNCATE) : value;
  const escaped = shown.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  return (
    <span className="text-emerald-700 break-all">
      "{escaped}{!expanded && isLong && '…'}"
      {isLong && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="ml-1 text-[10px] text-muted hover:text-fg underline"
        >
          {expanded ? 'collapse' : `show ${value.length} chars`}
        </button>
      )}
    </span>
  );
}

function Collapsible({
  value,
  depth,
  path,
  version,
  forced,
  mode,
  autoExpandPaths,
}: {
  value: object | unknown[];
  depth: number;
  path: string;
  version: number;
  forced: boolean | null;
  mode: Mode;
  autoExpandPaths: Set<string>;
}) {
  const isArray = Array.isArray(value);
  const entries: [string | number, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value);
  const count = entries.length;

  // Anthropic 的 redacted_thinking block 里 data 是一段 base64-like 加密串，展开无信息量
  const isRedactedThinking = !isArray && (value as { type?: unknown }).type === 'redacted_thinking';
  const initial = mode === 'request'
    ? autoExpandPaths.has(path) || (depth < 2 && count <= 20)
    : !isRedactedThinking;
  const [open, setOpen] = useState<boolean>(initial);

  useEffect(() => {
    if (forced !== null) setOpen(forced);
  }, [version, forced]);

  if (count === 0) {
    return <span className="text-slate-500">{isArray ? '[]' : '{}'}</span>;
  }

  const summary = `${count} ${isArray ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'key' : 'keys')}`;

  if (!open) {
    return (
      <span>
        <Toggle open={false} onClick={() => setOpen(true)} />
        <span className="text-slate-400">{isArray ? '[' : '{'}</span>
        <span className="text-slate-400 italic mx-1 cursor-pointer hover:text-slate-600" onClick={() => setOpen(true)}>
          {summary}
        </span>
        <span className="text-slate-400">{isArray ? ']' : '}'}</span>
      </span>
    );
  }

  return (
    <span>
      <Toggle open={true} onClick={() => setOpen(false)} />
      <span className="text-slate-400">{isArray ? '[' : '{'}</span>
      <div className="pl-4 ml-1 border-l border-slate-200">
        {entries.map(([k, v], i) => {
          const childPath = path === '' ? String(k) : `${path}.${k}`;
          return (
            <div key={k} className="whitespace-pre-wrap break-all">
              {!isArray && (
                <>
                  <span className="text-sky-700">"{k}"</span>
                  <span className="text-slate-400">: </span>
                </>
              )}
              <JsonNode
                value={v}
                depth={depth + 1}
                path={childPath}
                version={version}
                forced={forced}
                mode={mode}
                autoExpandPaths={autoExpandPaths}
              />
              {i < entries.length - 1 && <span className="text-slate-400">,</span>}
            </div>
          );
        })}
      </div>
      <span className="text-slate-400">{isArray ? ']' : '}'}</span>
    </span>
  );
}

function Toggle({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center justify-center w-4 text-slate-400 hover:text-slate-600 align-middle select-none"
      aria-label={open ? 'Collapse' : 'Expand'}
    >
      {open ? '▾' : '▸'}
    </button>
  );
}
