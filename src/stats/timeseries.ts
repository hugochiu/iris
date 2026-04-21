import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requestLogs } from '../db/schema.js';
import { parseRange, parseBucket } from './range.js';

const BUCKET_FORMAT = {
  '5min':
    "strftime('%Y-%m-%dT%H:', timestamp) || printf('%02d', cast(strftime('%M', timestamp) as int) / 5 * 5) || ':00Z'",
  hour: "strftime('%Y-%m-%dT%H:00:00Z', timestamp)",
  day: "strftime('%Y-%m-%dT00:00:00Z', timestamp)",
} as const;

export async function timeseriesHandler(c: Context) {
  const { range, cutoffIso } = parseRange(c.req.query('range'));
  const bucket = parseBucket(c.req.query('bucket'), range);

  const bucketExpr = sql.raw(BUCKET_FORMAT[bucket]);

  const rows = db
    .select({
      ts: sql<string>`${bucketExpr} as ts`,
      requests: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${requestLogs.cost}), 0)`,
      inputTokens: sql<number>`coalesce(sum(${requestLogs.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${requestLogs.outputTokens}), 0)`,
      cacheReadTokens: sql<number>`coalesce(sum(${requestLogs.cacheReadInputTokens}), 0)`,
      cacheCreationTokens: sql<number>`coalesce(sum(${requestLogs.cacheCreationInputTokens}), 0)`,
      avgTtftMs: sql<number>`coalesce(avg(${requestLogs.ttftMs}), 0)`,
      avgTpotMs: sql<number>`coalesce(avg(${requestLogs.tpotMs}), 0)`,
    })
    .from(requestLogs)
    .where(cutoffIso ? sql`${requestLogs.timestamp} >= ${cutoffIso}` : undefined)
    .groupBy(bucketExpr)
    .orderBy(bucketExpr)
    .all();

  return c.json({
    bucket,
    points: rows.map(r => {
      const input = Number(r.inputTokens);
      const cacheRead = Number(r.cacheReadTokens);
      const denom = input + cacheRead;
      return {
        ts: r.ts,
        requests: Number(r.requests),
        cost: Number(r.cost),
        inputTokens: input,
        outputTokens: Number(r.outputTokens),
        cacheReadTokens: cacheRead,
        cacheCreationTokens: Number(r.cacheCreationTokens),
        cacheHitRate: denom > 0 ? cacheRead / denom : 0,
        avgTtftMs: Number(r.avgTtftMs),
        avgTpotMs: Number(r.avgTpotMs),
      };
    }),
  });
}
