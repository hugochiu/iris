import type { Context } from 'hono';
import { stream } from 'hono/streaming';
import { getActiveUpstream } from '../upstream.js';
import type { ToolCall } from '../stats/session-meta.js';

// ─── Shared types ───

export type ApiFormat = 'anthropic' | 'openai-chat' | 'openai-responses';

export interface LogState {
  // Real model / provider reported by upstream (may differ from client's requested model)
  model: string;
  provider: string | null;
  // Token accounting
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningTokens: number;
  // Upstream-reported cost (OpenRouter), if any
  cost: number | null;
  // Completion metadata
  stopReason: string | null;
  hasToolUse: boolean;
  toolCalls: ToolCall[];
  finished: boolean;
  // Stream timing (epoch ms). firstTokenAt for TTFT, lastTokenAt for TPOT.
  firstTokenAt: number | null;
  lastTokenAt: number | null;
  // Response shape reassembled from the stream, used as the JSON body for
  // non-stream clients and also stringified into the payload log.
  assembledResponse: unknown | null;
  // Session id: may be set early from request parsing, or deferred to the end
  // of parseStream for adapters that derive it from response content.
  sessionId: string | null;
  // Adapter-private data that parseRequest can stash for parseStream to use
  // when finalizing sessionId (e.g. the first user message text for hashing).
  sessionSeed: unknown;
}

export function createLogState(): LogState {
  return {
    model: '',
    provider: null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    reasoningTokens: 0,
    cost: null,
    stopReason: null,
    hasToolUse: false,
    toolCalls: [],
    finished: false,
    firstTokenAt: null,
    lastTokenAt: null,
    assembledResponse: null,
    sessionId: null,
    sessionSeed: null,
  };
}

export interface RequestLogData {
  requestId: string;
  timestamp: string;
  sessionId: string | null;
  sessionName: string | null;
  model: string;
  provider: string | null;
  realModel: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  reasoningTokens: number;
  durationMs: number;
  ttftMs: number | null;
  tpotMs: number | null;
  status: 'success' | 'error';
  errorMessage: string | null;
  hasToolUse: boolean;
  stopReason: string | null;
  preview: string | null;
  toolCalls: string | null;
  previewMsgIndex: number | null;
  apiFormat: ApiFormat;
}

export interface PayloadLogData {
  requestId: string;
  requestHeaders: string | null;
  forwardedHeaders: string | null;
  requestBody: string | null;
  responseHeaders: string | null;
  responseBody: string | null;
}

type LogCallback = (data: RequestLogData) => void;
type PayloadCallback = (data: PayloadLogData) => void;

let logCallback: LogCallback | null = null;
let payloadCallback: PayloadCallback | null = null;

export function setLogCallback(cb: LogCallback) {
  logCallback = cb;
}

export function setPayloadCallback(cb: PayloadCallback) {
  payloadCallback = cb;
}

// ─── FormatAdapter interface ───

export interface RequestParseSuccess {
  ok: true;
  /** The model string as sent by the client — stored in request_logs.model. */
  requestModel: string;
  /** The model to actually forward upstream (after tier mapping / prefix logic). */
  resolvedModel: string;
  wantsStream: boolean;
  /** Initial session id if derivable from the request alone; else null. */
  sessionId: string | null;
  /**
   * Adapter-private hint for parseStream to finalize sessionId after the
   * upstream response arrives. Opaque to the pipeline. Example: Chat adapter
   * stores the first user message text here when the first assistant reply
   * isn't in the history yet, so it can hash it together with the generated
   * assistant text once the stream completes.
   */
  sessionSeed?: unknown;
  sessionName: string | null;
  preview: string | null;
  previewMsgIndex: number | null;
  /** The body object to send upstream (stream=true, provider routing, etc. already injected). */
  forwardBody: unknown;
}

export interface RequestParseError {
  ok: false;
  status: number;
  message: string;
}

export type RequestParseResult = RequestParseSuccess | RequestParseError;

export interface FormatAdapter {
  apiFormat: ApiFormat;
  /** Upstream path appended to upstream.baseUrl, e.g. "/messages" or "/chat/completions". */
  upstreamPath: string;
  parseRequest(body: unknown): RequestParseResult;
  /**
   * Consume the upstream SSE stream, updating `state` as events flow in.
   * Must populate `state.assembledResponse` by the time the stream finishes
   * (used for non-stream client responses and payload logs).
   */
  parseStream(body: ReadableStream<Uint8Array>, state: LogState): Promise<void>;
  /** Build the error JSON body in this API's native format. */
  errorBody(status: number, message: string): object;
  /** Optional per-format header passthrough (e.g. `anthropic-version`). */
  extraHeaders?(c: Context): Record<string, string>;
}

// ─── Utility helpers ───

export function safeStringify(obj: unknown): string | null {
  try {
    return JSON.stringify(obj);
  } catch {
    return null;
  }
}

const REDACTED_HEADERS = new Set(['authorization']);

export function headersToJson(h: Headers | undefined | null): string | null {
  if (!h) return null;
  const obj: Record<string, string> = {};
  h.forEach((v, k) => {
    if (REDACTED_HEADERS.has(k.toLowerCase())) return;
    obj[k] = v;
  });
  return safeStringify(obj);
}

export function recordHeadersToJson(h: Record<string, string>): string | null {
  const obj: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (REDACTED_HEADERS.has(k.toLowerCase())) continue;
    obj[k] = v;
  }
  return safeStringify(obj);
}

function buildLogData(
  requestId: string,
  startTime: number,
  requestModel: string,
  sessionName: string | null,
  state: LogState,
  status: 'success' | 'error',
  errorMessage: string | null,
  preview: string | null,
  toolCalls: string | null,
  previewMsgIndex: number | null,
  apiFormat: ApiFormat,
): RequestLogData {
  const ttftMs = state.firstTokenAt != null ? state.firstTokenAt - startTime : null;
  let tpotMs: number | null = null;
  if (state.firstTokenAt != null && state.lastTokenAt != null && state.outputTokens > 0) {
    tpotMs = state.outputTokens >= 2
      ? (state.lastTokenAt - state.firstTokenAt) / (state.outputTokens - 1)
      : null;
  }
  return {
    requestId,
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId,
    sessionName,
    model: requestModel,
    provider: state.provider,
    realModel: state.model || null,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    totalTokens: state.inputTokens + state.outputTokens,
    cost: state.cost,
    cacheReadInputTokens: state.cacheReadInputTokens,
    cacheCreationInputTokens: state.cacheCreationInputTokens,
    reasoningTokens: state.reasoningTokens,
    durationMs: Date.now() - startTime,
    ttftMs,
    tpotMs,
    status,
    errorMessage,
    hasToolUse: state.hasToolUse,
    stopReason: state.stopReason,
    preview,
    toolCalls,
    previewMsgIndex,
    apiFormat,
  };
}

// ─── Main proxy pipeline ───

export async function runProxy(c: Context, adapter: FormatAdapter) {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  const reqHeadersJson = headersToJson(c.req.raw.headers);

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json(adapter.errorBody(400, 'Invalid JSON body'), 400);
  }

  const parsed = adapter.parseRequest(rawBody);
  if (!parsed.ok) {
    return c.json(adapter.errorBody(parsed.status, parsed.message), parsed.status as any);
  }

  const {
    requestModel,
    wantsStream,
    sessionId: initialSessionId,
    sessionSeed,
    sessionName,
    preview,
    previewMsgIndex,
    forwardBody,
  } = parsed;

  const upstream = getActiveUpstream();
  const upstreamUrl = `${upstream.baseUrl}${adapter.upstreamPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${upstream.apiKey}`,
    'User-Agent': 'Go-http-client/2.0',
    'HTTP-Referer': '',
    'X-OpenRouter-Title': '',
  };
  if (adapter.extraHeaders) {
    Object.assign(headers, adapter.extraHeaders(c));
  }
  const fwdHeadersJson = recordHeadersToJson(headers);

  const reqBodyStr = safeStringify(forwardBody);

  const emitErrorLogs = (
    errorMessage: string,
    responseHeaders: string | null,
    responseBody: string | null,
  ) => {
    const state = createLogState();
    state.sessionId = initialSessionId;
    if (logCallback) {
      setImmediate(() =>
        logCallback!(
          buildLogData(
            requestId, startTime, requestModel, sessionName, state,
            'error', errorMessage, preview, null, previewMsgIndex, adapter.apiFormat,
          ),
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
          responseHeaders,
          responseBody,
        }),
      );
    }
  };

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(forwardBody),
    });
  } catch (err: any) {
    emitErrorLogs(`Connection failed: ${err.message}`, null, null);
    return c.json(adapter.errorBody(502, `Upstream connection failed: ${err.message}`), 502);
  }

  if (!upstreamRes.ok) {
    let errorText: string;
    try {
      errorText = await upstreamRes.text();
    } catch {
      errorText = 'Unknown error';
    }
    const respHeadersJson = headersToJson(upstreamRes.headers);
    emitErrorLogs(`Upstream ${upstreamRes.status}: ${errorText}`, respHeadersJson, errorText);

    // If the upstream returned a native-format error JSON, pass it through unchanged.
    try {
      const errJson = JSON.parse(errorText);
      if (errJson && typeof errJson === 'object') {
        return c.json(errJson as object, upstreamRes.status as any);
      }
    } catch {}
    return c.json(adapter.errorBody(upstreamRes.status, errorText), upstreamRes.status as any);
  }

  if (!upstreamRes.body) {
    return c.json(adapter.errorBody(502, 'No response body from upstream'), 502);
  }

  const logState = createLogState();
  logState.sessionId = initialSessionId;
  logState.sessionSeed = sessionSeed;
  const respHeadersJson = headersToJson(upstreamRes.headers);

  const emitLogs = () => {
    const status = logState.finished ? 'success' : 'error';
    const errorMsg = logState.finished ? null : 'Stream ended without terminator';
    const respBodyStr = logState.assembledResponse ? safeStringify(logState.assembledResponse) : null;
    const toolCallsStr = logState.toolCalls.length > 0 ? safeStringify(logState.toolCalls) : null;
    if (logCallback) {
      setImmediate(() =>
        logCallback!(
          buildLogData(
            requestId, startTime, requestModel, sessionName, logState,
            status, errorMsg, preview, toolCallsStr, previewMsgIndex, adapter.apiFormat,
          ),
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
    await adapter.parseStream(upstreamRes.body, logState);
    emitLogs();

    if (!logState.finished || !logState.assembledResponse) {
      return c.json(adapter.errorBody(502, 'Upstream stream ended without terminator'), 502);
    }

    c.header('X-Request-Id', requestId);
    return c.json(logState.assembledResponse as object);
  }

  const [passThroughStream, loggingStream] = upstreamRes.body.tee();

  return stream(c, async (streamWriter) => {
    c.header('Content-Type', 'text/event-stream');
    c.header('Cache-Control', 'no-cache');
    c.header('Connection', 'keep-alive');
    c.header('X-Request-Id', requestId);

    const logPromise = adapter.parseStream(loggingStream, logState).catch((err) => {
      console.error(`[iris] logging parser error for ${requestId}:`, err?.message ?? err);
    });

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
