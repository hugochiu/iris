import type { Context } from 'hono';
import { stream } from 'hono/streaming';
import { config } from '../config.js';

// ─── Utilities (inlined from deleted transform.ts) ───

function resolveModel(model: string): string {
  if (model.includes('/')) return model;
  return `anthropic/${model}`;
}

function mapErrorType(status: number): string {
  if (status === 400) return 'invalid_request_error';
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 529) return 'overloaded_error';
  return 'api_error';
}

function createAnthropicError(status: number, message: string): object {
  return {
    type: 'error',
    error: { type: mapErrorType(status), message },
  };
}

// ─── Log State ───

interface LogState {
  model: string;
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  cost: number | null;
  stopReason: string | null;
  hasToolUse: boolean;
  finished: boolean;
  responseMessage: any | null;
  contentBlocks: any[];
  firstTokenAt: number | null;
  lastTokenAt: number | null;
}

function createLogState(): LogState {
  return {
    model: '',
    provider: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    cost: null,
    stopReason: null,
    hasToolUse: false,
    finished: false,
    responseMessage: null,
    contentBlocks: [],
    firstTokenAt: null,
    lastTokenAt: null,
  };
}

function extractLogData(eventType: string, data: any, state: LogState): void {
  switch (eventType) {
    case 'message_start': {
      const usage = data.message?.usage;
      state.model = data.message?.model ?? '';
      state.provider = data.message?.provider ?? null;
      state.inputTokens = usage?.input_tokens ?? 0;
      state.cacheCreationInputTokens = usage?.cache_creation_input_tokens ?? 0;
      state.cacheReadInputTokens = usage?.cache_read_input_tokens ?? 0;
      if (usage?.cost != null) state.cost = usage.cost;
      state.responseMessage = data.message ?? null;
      break;
    }
    case 'content_block_start': {
      if (data.content_block?.type === 'tool_use') state.hasToolUse = true;
      const idx = data.index ?? 0;
      state.contentBlocks[idx] = { ...data.content_block };
      if (state.contentBlocks[idx].type === 'text') state.contentBlocks[idx].text = '';
      if (state.contentBlocks[idx].type === 'tool_use') state.contentBlocks[idx].input = '';
      break;
    }
    case 'content_block_delta': {
      const idx = data.index ?? 0;
      const block = state.contentBlocks[idx];
      if (!block) break;
      const delta = data.delta;
      const isTokenDelta =
        delta?.type === 'text_delta' ||
        delta?.type === 'input_json_delta' ||
        delta?.type === 'thinking_delta';
      if (isTokenDelta) {
        const now = Date.now();
        if (state.firstTokenAt == null) state.firstTokenAt = now;
        state.lastTokenAt = now;
      }
      if (delta?.type === 'text_delta') block.text = (block.text ?? '') + (delta.text ?? '');
      else if (delta?.type === 'input_json_delta') block.input = (block.input ?? '') + (delta.partial_json ?? '');
      else if (delta?.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + (delta.thinking ?? '');
      break;
    }
    case 'content_block_stop': {
      const idx = data.index ?? 0;
      const block = state.contentBlocks[idx];
      if (block?.type === 'tool_use' && typeof block.input === 'string') {
        try { block.input = JSON.parse(block.input || '{}'); } catch {}
      }
      break;
    }
    case 'message_delta': {
      const du = data.usage;
      state.stopReason = data.delta?.stop_reason ?? state.stopReason;
      state.inputTokens = du?.input_tokens ?? state.inputTokens;
      state.outputTokens = du?.output_tokens ?? state.outputTokens;
      state.cacheCreationInputTokens = du?.cache_creation_input_tokens ?? state.cacheCreationInputTokens;
      state.cacheReadInputTokens = du?.cache_read_input_tokens ?? state.cacheReadInputTokens;
      if (du?.cost != null) state.cost = du.cost;
      if (state.responseMessage) {
        if (data.delta) Object.assign(state.responseMessage, data.delta);
        if (du) state.responseMessage.usage = { ...state.responseMessage.usage, ...du };
      }
      break;
    }
    case 'message_stop':
      state.finished = true;
      if (state.responseMessage) {
        state.responseMessage.content = state.contentBlocks.filter(Boolean);
      }
      break;
  }
}

// ─── Anthropic SSE Parser ───

async function* parseAnthropicSSE(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: any }> {
  const reader = body.pipeThrough(new TextDecoderStream() as any).getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      const parts = buffer.split('\n\n');
      buffer = parts.pop()!;

      for (const part of parts) {
        const lines = part.split('\n');
        let eventType = '';
        let dataStr = '';

        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim();
          else if (line.startsWith('data: ')) dataStr = line.slice(6).trim();
        }

        if (!dataStr) continue;
        try {
          yield { event: eventType, data: JSON.parse(dataStr) };
        } catch {
          // skip malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function parseForLogging(
  body: ReadableStream<Uint8Array>,
  state: LogState,
): Promise<void> {
  try {
    for await (const { event, data } of parseAnthropicSSE(body)) {
      extractLogData(event, data, state);
    }
  } catch (err: any) {
    console.error('[iris] logging parser error:', err.message);
  }
}

// ─── Request Log Data ───

export interface RequestLogData {
  requestId: string;
  timestamp: string;
  model: string;
  provider: string | null;
  realModel: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  durationMs: number;
  ttftMs: number | null;
  tpotMs: number | null;
  status: 'success' | 'error';
  errorMessage: string | null;
  hasToolUse: boolean;
  stopReason: string | null;
}

type LogCallback = (data: RequestLogData) => void;

export interface PayloadLogData {
  requestId: string;
  requestHeaders: string | null;
  forwardedHeaders: string | null;
  requestBody: string | null;
  responseHeaders: string | null;
  responseBody: string | null;
}

type PayloadCallback = (data: PayloadLogData) => void;

let logCallback: LogCallback | null = null;
let payloadCallback: PayloadCallback | null = null;

export function setLogCallback(cb: LogCallback) {
  logCallback = cb;
}

export function setPayloadCallback(cb: PayloadCallback) {
  payloadCallback = cb;
}

function buildLogData(
  requestId: string,
  startTime: number,
  requestModel: string,
  state: LogState,
  status: 'success' | 'error',
  errorMessage: string | null,
): RequestLogData {
  const ttftMs = state.firstTokenAt != null ? state.firstTokenAt - startTime : null;
  let tpotMs: number | null = null;
  if (state.firstTokenAt != null && state.lastTokenAt != null && state.outputTokens > 0) {
    tpotMs = state.outputTokens >= 2
      ? (state.lastTokenAt - state.firstTokenAt) / (state.outputTokens - 1)
      : 0;
  }
  return {
    requestId,
    timestamp: new Date().toISOString(),
    model: requestModel,
    provider: state.provider,
    realModel: state.model || null,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    totalTokens: state.inputTokens + state.outputTokens,
    cost: state.cost,
    cacheReadInputTokens: state.cacheReadInputTokens,
    cacheCreationInputTokens: state.cacheCreationInputTokens,
    durationMs: Date.now() - startTime,
    ttftMs,
    tpotMs,
    status,
    errorMessage,
    hasToolUse: state.hasToolUse,
    stopReason: state.stopReason,
  };
}

// ─── Proxy Handler ───

interface ProxyRequestBody {
  model: string;
  messages: unknown[];
  max_tokens: number;
  stream?: boolean;
  [key: string]: unknown;
}

export async function proxyHandler(c: Context) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const reqHeadersJson = headersToJson(c.req.raw.headers);

  let body: ProxyRequestBody;
  try {
    body = await c.req.json();
  } catch {
    return c.json(createAnthropicError(400, 'Invalid JSON body'), 400);
  }

  if (!body.messages || !body.max_tokens) {
    return c.json(
      createAnthropicError(400, 'messages and max_tokens are required'),
      400,
    );
  }

  const resolvedModel = resolveModel(body.model);
  const wantsStream = body.stream === true;
  const { metadata: _metadata, ...bodyWithoutMetadata } = body;
  // Always request streaming upstream so we can tee for logging; we re-assemble
  // a single JSON response for clients that didn't ask for stream.
  const requestBody = { ...bodyWithoutMetadata, model: resolvedModel, stream: true };
  const upstreamUrl = `${config.openRouterBaseUrl}/messages`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.openRouterApiKey}`,
    'User-Agent': 'Go-http-client/2.0',
    'HTTP-Referer': '',
    'X-OpenRouter-Title': '',
  };
  const anthropicVersion = c.req.header('anthropic-version');
  if (anthropicVersion) {
    headers['anthropic-version'] = anthropicVersion;
  }
  const fwdHeadersJson = recordHeadersToJson(headers);

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });
  } catch (err: any) {
    const state = createLogState();
    if (logCallback) {
      setImmediate(() =>
        logCallback!(
          buildLogData(requestId, startTime, body.model, state, 'error', `Connection failed: ${err.message}`),
        ),
      );
    }
    if (payloadCallback) {
      const reqBodyStr = safeStringify(bodyWithoutMetadata);
      setImmediate(() =>
        payloadCallback!({
          requestId,
          requestHeaders: reqHeadersJson,
          forwardedHeaders: fwdHeadersJson,
          requestBody: reqBodyStr,
          responseHeaders: null,
          responseBody: null,
        }),
      );
    }
    return c.json(
      createAnthropicError(502, `Upstream connection failed: ${err.message}`),
      502,
    );
  }

  if (!upstreamRes.ok) {
    let errorText: string;
    try {
      errorText = await upstreamRes.text();
    } catch {
      errorText = 'Unknown error';
    }

    const state = createLogState();
    if (logCallback) {
      setImmediate(() =>
        logCallback!(
          buildLogData(requestId, startTime, body.model, state, 'error', `Upstream ${upstreamRes.status}: ${errorText}`),
        ),
      );
    }
    if (payloadCallback) {
      const reqBodyStr = safeStringify(bodyWithoutMetadata);
      const respHeadersJson = headersToJson(upstreamRes.headers);
      setImmediate(() =>
        payloadCallback!({
          requestId,
          requestHeaders: reqHeadersJson,
          forwardedHeaders: fwdHeadersJson,
          requestBody: reqBodyStr,
          responseHeaders: respHeadersJson,
          responseBody: errorText,
        }),
      );
    }

    try {
      const errJson = JSON.parse(errorText);
      if (errJson.type === 'error') {
        return c.json(errJson, upstreamRes.status as any);
      }
    } catch {}
    return c.json(
      createAnthropicError(upstreamRes.status, errorText),
      upstreamRes.status as any,
    );
  }

  if (!upstreamRes.body) {
    return c.json(createAnthropicError(502, 'No response body from upstream'), 502);
  }

  const logState = createLogState();
  const respHeadersJson = headersToJson(upstreamRes.headers);
  const reqBodyStr = safeStringify(bodyWithoutMetadata);

  const emitLogs = () => {
    const status = logState.finished ? 'success' : 'error';
    const errorMsg = logState.finished ? null : 'Stream ended without message_stop';
    const respBodyStr = logState.responseMessage ? safeStringify(logState.responseMessage) : null;
    if (logCallback) {
      setImmediate(() =>
        logCallback!(
          buildLogData(requestId, startTime, body.model, logState, status, errorMsg),
        ),
      );
    }
    if (payloadCallback) {
      setImmediate(() =>
        payloadCallback!({
          requestId,
          requestHeaders: reqHeadersJson,
          forwardedHeaders: fwdHeadersJson,
          requestBody: reqBodyStr,
          responseHeaders: respHeadersJson,
          responseBody: respBodyStr,
        }),
      );
    }
  };

  if (!wantsStream) {
    await parseForLogging(upstreamRes.body, logState);
    emitLogs();

    if (!logState.finished || !logState.responseMessage) {
      return c.json(
        createAnthropicError(502, 'Upstream stream ended without message_stop'),
        502,
      );
    }

    c.header('X-Request-Id', requestId);
    return c.json(logState.responseMessage);
  }

  const [passThroughStream, loggingStream] = upstreamRes.body.tee();

  return stream(c, async (streamWriter) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Request-Id', requestId);

    const logPromise = parseForLogging(loggingStream, logState);

    try {
      const reader = passThroughStream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await streamWriter.write(decoder.decode(value, { stream: true }));
      }
      reader.releaseLock();
    } catch (err: any) {
      console.error(`[iris] stream error for ${requestId}:`, err.message);
    }

    await logPromise;
    emitLogs();
  });
}

function safeStringify(obj: unknown): string | null {
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

const REDACTED_HEADERS = new Set(['authorization']);

function headersToJson(h: Headers | undefined | null): string | null {
  if (!h) return null;
  const obj: Record<string, string> = {};
  h.forEach((v, k) => {
    if (REDACTED_HEADERS.has(k.toLowerCase())) return;
    obj[k] = v;
  });
  return safeStringify(obj);
}

function recordHeadersToJson(h: Record<string, string>): string | null {
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (REDACTED_HEADERS.has(k.toLowerCase())) continue;
    obj[k] = v;
  }
  return safeStringify(obj);
}
