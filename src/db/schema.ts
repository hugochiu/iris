import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const requestLogs = sqliteTable(
  'request_logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    requestId: text('request_id').notNull(),
    timestamp: text('timestamp').notNull(),
    sessionId: text('session_id'),
    model: text('model').notNull(),
    provider: text('provider'),
    realModel: text('real_model'),
    inputTokens: integer('input_tokens').default(0),
    outputTokens: integer('output_tokens').default(0),
    totalTokens: integer('total_tokens').default(0),
    cost: real('cost'),
    cacheReadInputTokens: integer('cache_read_input_tokens').default(0),
    cacheCreationInputTokens: integer('cache_creation_input_tokens').default(0),
    durationMs: integer('duration_ms').notNull(),
    ttftMs: integer('ttft_ms'),
    tpotMs: real('tpot_ms'),
    status: text('status').notNull(),
    errorMessage: text('error_message'),
    hasToolUse: integer('has_tool_use', { mode: 'boolean' }).default(false),
    stopReason: text('stop_reason'),
  },
);

export const requestPayloads = sqliteTable('request_payloads', {
  requestId: text('request_id').primaryKey(),
  requestHeaders: text('request_headers'),
  forwardedHeaders: text('forwarded_headers'),
  requestBody: text('request_body'),
  responseHeaders: text('response_headers'),
  responseBody: text('response_body'),
});
