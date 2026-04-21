import type { Context } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { requestLogs } from '../db/schema.js';
import { parseRange } from './range.js';
import { ERROR_CATEGORIES, categoryCaseSql } from './errors.js';

const STOP_REASONS = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence'] as const;

export async function summaryHandler(c: Context) {
  const { cutoffIso } = parseRange(c.req.query('range'));

  const errorCategorySelects = Object.fromEntries(
    ERROR_CATEGORIES.map(cat => [`err_${cat}`, categoryCaseSql(cat)]),
  );

  const stopReasonSelects = Object.fromEntries(
    STOP_REASONS.map(r => [
      `stop_${r}`,
      sql<number>`sum(case when ${requestLogs.stopReason} = ${r} then 1 else 0 end)`,
    ]),
  );

  const row = db
    .select({
      totalRequests: sql<number>`count(*)`,
      successCount: sql<number>`sum(case when ${requestLogs.status} = 'success' then 1 else 0 end)`,
      errorCount: sql<number>`sum(case when ${requestLogs.status} = 'error' then 1 else 0 end)`,
      totalCost: sql<number>`coalesce(sum(${requestLogs.cost}), 0)`,
      avgDurationMs: sql<number>`coalesce(avg(${requestLogs.durationMs}), 0)`,
      avgTtftMs: sql<number>`coalesce(avg(${requestLogs.ttftMs}), 0)`,
      avgTpotMs: sql<number>`coalesce(avg(${requestLogs.tpotMs}), 0)`,
      inputTokens: sql<number>`coalesce(sum(${requestLogs.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${requestLogs.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${requestLogs.totalTokens}), 0)`,
      cacheReadTokens: sql<number>`coalesce(sum(${requestLogs.cacheReadInputTokens}), 0)`,
      cacheCreationTokens: sql<number>`coalesce(sum(${requestLogs.cacheCreationInputTokens}), 0)`,
      toolUseCount: sql<number>`sum(case when ${requestLogs.hasToolUse} = 1 then 1 else 0 end)`,
      stopReasonKnownCount: sql<number>`sum(case when ${requestLogs.stopReason} in ('end_turn', 'tool_use', 'max_tokens', 'stop_sequence') then 1 else 0 end)`,
      ...errorCategorySelects,
      ...stopReasonSelects,
    })
    .from(requestLogs)
    .where(cutoffIso ? sql`${requestLogs.timestamp} >= ${cutoffIso}` : undefined)
    .get() as Record<string, number | null> | undefined;

  const totalRequests = Number(row?.totalRequests ?? 0);
  const successCount = Number(row?.successCount ?? 0);
  const errorCount = Number(row?.errorCount ?? 0);
  const inputTokens = Number(row?.inputTokens ?? 0);
  const cacheReadTokens = Number(row?.cacheReadTokens ?? 0);
  const cacheDenominator = cacheReadTokens + inputTokens;

  const errorCategories = Object.fromEntries(
    ERROR_CATEGORIES.map(cat => [cat, Number(row?.[`err_${cat}`] ?? 0)]),
  ) as Record<(typeof ERROR_CATEGORIES)[number], number>;

  const stopReasons = {
    end_turn: Number(row?.stop_end_turn ?? 0),
    tool_use: Number(row?.stop_tool_use ?? 0),
    max_tokens: Number(row?.stop_max_tokens ?? 0),
    stop_sequence: Number(row?.stop_stop_sequence ?? 0),
    unknown: totalRequests - Number(row?.stopReasonKnownCount ?? 0),
  };

  return c.json({
    totalRequests,
    successCount,
    errorCount,
    successRate: totalRequests > 0 ? successCount / totalRequests : 0,
    totalCost: Number(row?.totalCost ?? 0),
    avgDurationMs: Number(row?.avgDurationMs ?? 0),
    avgTtftMs: Number(row?.avgTtftMs ?? 0),
    avgTpotMs: Number(row?.avgTpotMs ?? 0),
    tokens: {
      input: inputTokens,
      output: Number(row?.outputTokens ?? 0),
      total: Number(row?.totalTokens ?? 0),
      cacheRead: cacheReadTokens,
      cacheCreation: Number(row?.cacheCreationTokens ?? 0),
    },
    cacheHitRate: cacheDenominator > 0 ? cacheReadTokens / cacheDenominator : 0,
    toolUseCount: Number(row?.toolUseCount ?? 0),
    errorCategories,
    stopReasons,
  });
}
