import type { Context } from 'hono';
import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requestLogs } from '../db/schema.js';
import { parseRange } from './range.js';
import type { ToolCall } from './session-meta.js';

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
  activeDurationMs: sql<number>`coalesce(sum(${requestLogs.durationMs}), 0)`,
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
  activeDurationMs: number;
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
    activeDurationMs: Number(r.activeDurationMs),
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

  const requestsWithPreview = requests.map((r) => {
    let toolCalls: ToolCall[] | null = null;
    if (r.toolCalls) {
      try { toolCalls = JSON.parse(r.toolCalls) as ToolCall[]; } catch {}
    }
    const { toolCalls: _raw, ...rest } = r;
    const previewMsgIndex =
      r.previewMsgIndex == null || r.previewMsgIndex < 0 ? null : r.previewMsgIndex;
    return { ...rest, preview: r.preview || null, toolCalls, previewMsgIndex };
  });

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
