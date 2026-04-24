import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requestLogs } from '../db/schema.js';
import { parseRange } from './range.js';

export async function byModelHandler(c: Context) {
  const { cutoffIso } = parseRange(c.req.query('range'));

  const modelExpr = sql<string>`coalesce(${requestLogs.realModel}, ${requestLogs.model})`;

  const rows = db
    .select({
      model: sql<string>`${modelExpr} as model`,
      requests: sql<number>`count(*)`,
      cost: sql<number>`coalesce(sum(${requestLogs.cost}), 0)`,
      avgInputTokens: sql<number>`coalesce(avg(${requestLogs.inputTokens}), 0)`,
      avgOutputTokens: sql<number>`coalesce(avg(${requestLogs.outputTokens}), 0)`,
      successCount: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`,
      inputTokensSum: sql<number>`coalesce(sum(${requestLogs.inputTokens}), 0)`,
      cacheReadTokensSum: sql<number>`coalesce(sum(${requestLogs.cacheReadInputTokens}), 0)`,
      cacheCreationTokensSum: sql<number>`coalesce(sum(${requestLogs.cacheCreationInputTokens}), 0)`,
    })
    .from(requestLogs)
    .where(cutoffIso ? sql`${requestLogs.timestamp} >= ${cutoffIso}` : undefined)
    .groupBy(modelExpr)
    .orderBy(sql`count(*) desc`)
    .all();

  return c.json({
    items: rows.map(r => {
      const requests = Number(r.requests);
      const inputSum = Number(r.inputTokensSum);
      const cacheReadSum = Number(r.cacheReadTokensSum);
      const cacheDenom = inputSum + cacheReadSum;
      return {
        model: r.model,
        requests,
        cost: Number(r.cost),
        avgInputTokens: Number(r.avgInputTokens),
        avgOutputTokens: Number(r.avgOutputTokens),
        successRate: requests > 0 ? Number(r.successCount) / requests : 0,
        cacheHitRate: cacheDenom > 0 ? cacheReadSum / cacheDenom : 0,
        inputTokens: inputSum,
        cacheReadTokens: cacheReadSum,
        cacheCreationTokens: Number(r.cacheCreationTokensSum),
      };
    }),
  });
}
