import type { Context } from 'hono';
import { and, desc, eq, like, lt, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requestLogs, requestPayloads } from '../db/schema.js';
import { parseRange } from './range.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function logsListHandler(c: Context) {
  const { cutoffIso } = parseRange(c.req.query('range'));
  const status = c.req.query('status');
  const model = c.req.query('model');
  const hasToolUse = c.req.query('hasToolUse');
  const cursor = c.req.query('cursor');
  const limitRaw = parseInt(c.req.query('limit') || String(DEFAULT_LIMIT), 10);
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : DEFAULT_LIMIT), MAX_LIMIT);

  const filters: SQL[] = [];
  if (cutoffIso) filters.push(sql`${requestLogs.timestamp} >= ${cutoffIso}`);
  if (status === 'success' || status === 'error') filters.push(eq(requestLogs.status, status));
  if (model) {
    const pattern = `%${model}%`;
    filters.push(or(like(requestLogs.model, pattern), like(requestLogs.realModel, pattern))!);
  }
  if (hasToolUse === 'true') filters.push(eq(requestLogs.hasToolUse, true));
  else if (hasToolUse === 'false') filters.push(eq(requestLogs.hasToolUse, false));
  if (cursor) {
    const cursorId = parseInt(cursor, 10);
    if (Number.isFinite(cursorId)) filters.push(lt(requestLogs.id, cursorId));
  }

  const rows = db
    .select()
    .from(requestLogs)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(requestLogs.id))
    .limit(limit)
    .all();

  const nextCursor = rows.length === limit ? String(rows[rows.length - 1].id) : null;

  return c.json({ items: rows, nextCursor });
}

function tryParseJson(value: string | null): unknown {
  if (value == null) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export async function logDetailHandler(c: Context) {
  const requestId = c.req.param('requestId');
  if (!requestId) return c.json({ error: 'missing_request_id' }, 400);

  const log = db
    .select()
    .from(requestLogs)
    .where(eq(requestLogs.requestId, requestId))
    .get();

  if (!log) return c.json({ error: 'not_found' }, 404);

  const payload = db
    .select()
    .from(requestPayloads)
    .where(eq(requestPayloads.requestId, requestId))
    .get();

  const parsedPayload = payload
    ? {
        requestId: payload.requestId,
        requestHeaders: tryParseJson(payload.requestHeaders),
        forwardedHeaders: tryParseJson(payload.forwardedHeaders),
        requestBody: tryParseJson(payload.requestBody),
        responseHeaders: tryParseJson(payload.responseHeaders),
        responseBody: tryParseJson(payload.responseBody),
      }
    : null;

  return c.json({ log, payload: parsedPayload });
}
