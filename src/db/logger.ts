import { db } from './index.js';
import { requestLogs, requestPayloads } from './schema.js';
import type { RequestLogData, PayloadLogData } from '../proxy/handler.js';

export function logRequest(data: RequestLogData): void {
  try {
    db.insert(requestLogs)
      .values({
        requestId: data.requestId,
        timestamp: data.timestamp,
        model: data.model,
        provider: data.provider,
        realModel: data.realModel,
        inputTokens: data.inputTokens,
        outputTokens: data.outputTokens,
        totalTokens: data.totalTokens,
        cost: data.cost,
        cacheReadInputTokens: data.cacheReadInputTokens,
        cacheCreationInputTokens: data.cacheCreationInputTokens,
        durationMs: data.durationMs,
        ttftMs: data.ttftMs,
        tpotMs: data.tpotMs,
        status: data.status,
        errorMessage: data.errorMessage,
        hasToolUse: data.hasToolUse,
        stopReason: data.stopReason,
      })
      .run();
  } catch (err: any) {
    console.error('[iris] failed to log request:', err.message);
  }
}

export function logPayload(data: PayloadLogData): void {
  try {
    db.insert(requestPayloads)
      .values({
        requestId: data.requestId,
        requestHeaders: data.requestHeaders,
        forwardedHeaders: data.forwardedHeaders,
        requestBody: data.requestBody,
        responseHeaders: data.responseHeaders,
        responseBody: data.responseBody,
      })
      .run();
  } catch (err: any) {
    console.error('[iris] failed to log payload:', err.message);
  }
}
