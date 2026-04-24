import type { Context } from 'hono';
import { and, asc, eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requestLogs, requestPayloads } from '../db/schema.js';
import { parseRange } from './range.js';

function stripContextTags(text: string): string {
  return text.replace(/<(system-reminder|ide_opened_file|ide_selection|command-[a-z-]+)>[\s\S]*?<\/\1>/gi, '');
}

export interface ToolCall {
  name: string;
  label: string | null;
}

const MAX_LABEL = 48;

function truncateHead(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LABEL ? one.slice(0, MAX_LABEL - 1) + '…' : one;
}

function truncateTail(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LABEL ? '…' + one.slice(one.length - (MAX_LABEL - 1)) : one;
}

function extractToolLabel(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  const pick = (k: string): string | null =>
    typeof i[k] === 'string' && (i[k] as string).length > 0 ? (i[k] as string) : null;
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const p = pick('file_path') ?? pick('notebook_path');
      return p ? truncateTail(p) : null;
    }
    case 'Bash': {
      const c = pick('command');
      return c ? truncateHead(c) : null;
    }
    case 'Grep': {
      const p = pick('pattern');
      return p ? truncateHead(p) : null;
    }
    case 'Glob': {
      const p = pick('pattern');
      return p ? truncateHead(p) : null;
    }
    case 'WebFetch': {
      const u = pick('url');
      return u ? truncateTail(u) : null;
    }
    case 'WebSearch': {
      const q = pick('query');
      return q ? truncateHead(q) : null;
    }
    case 'Task':
    case 'Agent': {
      const d = pick('description') ?? pick('subagent_type');
      return d ? truncateHead(d) : null;
    }
    default:
      return null;
  }
}

function extractToolCalls(responseBodyText: string | null): ToolCall[] | null {
  if (!responseBodyText) return null;
  let msg: { content?: unknown };
  try {
    msg = JSON.parse(responseBodyText);
  } catch {
    return null;
  }
  const content = msg?.content;
  if (!Array.isArray(content)) return null;
  const calls: ToolCall[] = [];
  for (const block of content as Array<{ type?: string; name?: string; input?: unknown }>) {
    if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name) {
      calls.push({ name: block.name, label: extractToolLabel(block.name, block.input) });
    }
  }
  return calls.length > 0 ? calls : null;
}

function extractLatestUserPreview(bodyText: string | null): string | null {
  if (!bodyText) return null;
  let body: { messages?: unknown };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const messages = body?.messages;
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== 'user') continue;
    const rawTexts: string[] = [];
    if (typeof msg.content === 'string') {
      rawTexts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const b of msg.content as Array<{ type?: string; text?: string }>) {
        if (b?.type === 'text' && typeof b.text === 'string') rawTexts.push(b.text);
      }
    }
    for (const raw of rawTexts) {
      const cleaned = stripContextTags(raw).replace(/\s+/g, ' ').trim();
      if (cleaned) return cleaned.slice(0, 200);
    }
  }
  return null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const sessionAggregateColumns = {
  sessionId: requestLogs.sessionId,
  sessionName: sql<string | null>`max(${requestLogs.sessionName})`,
  requestCount: sql<number>`count(*)`,
  totalCost: sql<number>`coalesce(sum(${requestLogs.cost}), 0)`,
  totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`,
  inputTokens: sql<number>`coalesce(sum(${requestLogs.inputTokens}), 0)`,
  outputTokens: sql<number>`coalesce(sum(${requestLogs.outputTokens}), 0)`,
  firstTimestamp: sql<string>`min(${requestLogs.timestamp})`,
  lastTimestamp: sql<string>`max(${requestLogs.timestamp})`,
  modelCount: sql<number>`count(distinct coalesce(${requestLogs.realModel}, ${requestLogs.model}))`,
  models: sql<string | null>`group_concat(distinct coalesce(${requestLogs.realModel}, ${requestLogs.model}))`,
  errorCount: sql<number>`sum(case when ${requestLogs.status} = 'error' then 1 else 0 end)`,
};

type RawSessionRow = {
  sessionId: string | null;
  sessionName: string | null;
  requestCount: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  firstTimestamp: string;
  lastTimestamp: string;
  modelCount: number;
  models: string | null;
  errorCount: number;
};

function shapeSession(r: RawSessionRow) {
  return {
    sessionId: r.sessionId ?? '',
    sessionName: r.sessionName,
    requestCount: Number(r.requestCount),
    totalCost: Number(r.totalCost),
    totalTokens: Number(r.totalTokens),
    inputTokens: Number(r.inputTokens),
    outputTokens: Number(r.outputTokens),
    firstTimestamp: r.firstTimestamp,
    lastTimestamp: r.lastTimestamp,
    modelCount: Number(r.modelCount),
    models: (r.models ?? '').split(',').filter(Boolean),
    hasError: Number(r.errorCount) > 0,
  };
}

export async function sessionsListHandler(c: Context) {
  const { cutoffIso } = parseRange(c.req.query('range'));
  const cursor = c.req.query('cursor');
  const limitRaw = parseInt(c.req.query('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(
    Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  const whereFilters: SQL[] = [isNotNull(requestLogs.sessionId)];
  if (cutoffIso) whereFilters.push(sql`${requestLogs.timestamp} >= ${cutoffIso}`);

  const rows = db
    .select(sessionAggregateColumns)
    .from(requestLogs)
    .where(and(...whereFilters))
    .groupBy(requestLogs.sessionId)
    .having(cursor ? sql`max(${requestLogs.timestamp}) < ${cursor}` : undefined)
    .orderBy(sql`max(${requestLogs.timestamp}) desc`)
    .limit(limit)
    .all() as RawSessionRow[];

  const items = rows.map(shapeSession);
  const nextCursor = rows.length === limit ? rows[rows.length - 1].lastTimestamp : null;

  return c.json({ items, nextCursor });
}

export async function sessionDetailHandler(c: Context) {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) return c.json({ error: 'missing_session_id' }, 400);

  const summaryRow = db
    .select(sessionAggregateColumns)
    .from(requestLogs)
    .where(eq(requestLogs.sessionId, sessionId))
    .groupBy(requestLogs.sessionId)
    .get() as RawSessionRow | undefined;

  if (!summaryRow || summaryRow.sessionId == null) {
    return c.json({ error: 'not_found' }, 404);
  }

  const requests = db
    .select()
    .from(requestLogs)
    .where(eq(requestLogs.sessionId, sessionId))
    .orderBy(asc(requestLogs.timestamp))
    .all();

  const requestIds = requests.map((r) => r.requestId);
  const payloadRows = requestIds.length > 0
    ? db
        .select({
          requestId: requestPayloads.requestId,
          requestBody: requestPayloads.requestBody,
          responseBody: requestPayloads.responseBody,
        })
        .from(requestPayloads)
        .where(inArray(requestPayloads.requestId, requestIds))
        .all()
    : [];
  const previewMap = new Map<string, string | null>();
  const toolCallsMap = new Map<string, ToolCall[] | null>();
  for (const p of payloadRows) {
    previewMap.set(p.requestId, extractLatestUserPreview(p.requestBody));
    toolCallsMap.set(p.requestId, extractToolCalls(p.responseBody));
  }
  const requestsWithPreview = requests.map((r) => ({
    ...r,
    preview: previewMap.get(r.requestId) ?? null,
    toolCalls: toolCallsMap.get(r.requestId) ?? null,
  }));

  const modelBreakdown = db
    .select({
      model: sql<string>`coalesce(${requestLogs.realModel}, ${requestLogs.model})`,
      count: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${requestLogs.cost}), 0)`,
    })
    .from(requestLogs)
    .where(eq(requestLogs.sessionId, sessionId))
    .groupBy(sql`coalesce(${requestLogs.realModel}, ${requestLogs.model})`)
    .orderBy(sql`coalesce(sum(${requestLogs.cost}), 0) desc`)
    .all();

  const timeseries = requests.map((r) => ({
    ts: r.timestamp,
    cost: r.cost ?? 0,
    inputTokens: r.inputTokens ?? 0,
    outputTokens: r.outputTokens ?? 0,
    totalTokens: r.totalTokens ?? 0,
    requestId: r.requestId,
  }));

  return c.json({
    summary: shapeSession(summaryRow),
    timeseries,
    requests: requestsWithPreview,
    modelBreakdown: modelBreakdown.map((m) => ({
      model: m.model,
      count: Number(m.count),
      cost: Number(m.cost),
    })),
  });
}
