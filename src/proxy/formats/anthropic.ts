import type { Context } from 'hono';
import {
  extractLatestUserPreviewFromMessages,
  extractToolCallsFromContent,
} from '../../stats/session-meta.js';
import type {
  FormatAdapter,
  LogState,
  RequestParseResult,
} from '../pipeline.js';
import { buildProviderField, extractFirstUserText, resolveModelTier } from './shared.js';

// ─── Model resolution ───

function resolveModel(model: string): string {
  const mapped = resolveModelTier(model);
  if (mapped) return mapped;
  if (model.includes('/')) return model;
  return `anthropic/${model}`;
}

// ─── Error body in Anthropic native shape ───

function mapErrorType(status: number): string {
  if (status === 400) return 'invalid_request_error';
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 429) return 'rate_limit_error';
  if (status === 529) return 'overloaded_error';
  return 'api_error';
}

function errorBody(status: number, message: string): object {
  return {
    type: 'error',
    error: { type: mapErrorType(status), message },
  };
}

// ─── PII scrubbing (system prompt) ───

function scrubText(text: string): string {
  return text.replace(/^Git user: .+$/gm, 'Git user: anonymous');
}

function scrubSystem(system: unknown): unknown {
  if (typeof system === 'string') return scrubText(system);
  if (Array.isArray(system)) {
    return system.map((block: any) =>
      block?.type === 'text' && typeof block.text === 'string'
        ? { ...block, text: scrubText(block.text) }
        : block,
    );
  }
  return system;
}

// ─── Session / session-name extraction ───

function extractSessionId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const userId = (metadata as any).user_id;
  if (typeof userId !== 'string') return null;
  try {
    const parsed = JSON.parse(userId);
    const sid = parsed?.session_id;
    return typeof sid === 'string' && sid.length > 0 ? sid : null;
  } catch {
    console.warn('[iris] failed to parse metadata.user_id as JSON');
    return null;
  }
}

// ─── Request parsing ───

interface AnthropicRequestBody {
  model?: unknown;
  messages?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  metadata?: unknown;
  system?: unknown;
  [key: string]: unknown;
}

function parseRequest(raw: unknown): RequestParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, message: 'Invalid JSON body' };
  }
  const body = raw as AnthropicRequestBody;
  if (!body.messages || !body.max_tokens || typeof body.model !== 'string') {
    return {
      ok: false,
      status: 400,
      message: 'messages and max_tokens are required',
    };
  }
  const requestModel = body.model;
  const resolvedModel = resolveModel(requestModel);
  const wantsStream = body.stream === true;
  const { metadata, ...bodyWithoutMetadata } = body;
  const sessionId = extractSessionId(metadata);
  const sessionName = extractFirstUserText(body.messages);
  const previewInfo = extractLatestUserPreviewFromMessages(body.messages);
  const preview = previewInfo?.text ?? null;
  const previewMsgIndex = previewInfo?.msgIndex ?? null;
  if ('system' in bodyWithoutMetadata) {
    bodyWithoutMetadata.system = scrubSystem(bodyWithoutMetadata.system);
  }
  const providerField = buildProviderField();
  // Always request streaming upstream so we can tee for logging; we re-assemble
  // a single JSON response for clients that didn't ask for stream.
  const forwardBody = {
    ...bodyWithoutMetadata,
    ...providerField,
    model: resolvedModel,
    stream: true,
  };
  return {
    ok: true,
    requestModel,
    resolvedModel,
    wantsStream,
    sessionId,
    sessionName,
    preview,
    previewMsgIndex,
    forwardBody,
  };
}

// ─── Extra headers (anthropic-version passthrough) ───

function extraHeaders(c: Context): Record<string, string> {
  const anthropicVersion = c.req.header('anthropic-version');
  return anthropicVersion ? { 'anthropic-version': anthropicVersion } : {};
}

// ─── SSE parsing + log extraction ───

interface AnthropicParseState {
  contentBlocks: any[];
  responseMessage: any | null;
}

function extractLogData(
  eventType: string,
  data: any,
  state: LogState,
  local: AnthropicParseState,
): void {
  switch (eventType) {
    case 'message_start': {
      const usage = data.message?.usage;
      state.model = data.message?.model ?? '';
      state.provider = data.message?.provider ?? null;
      state.inputTokens = usage?.input_tokens ?? 0;
      state.cacheCreationInputTokens = usage?.cache_creation_input_tokens ?? 0;
      state.cacheReadInputTokens = usage?.cache_read_input_tokens ?? 0;
      if (usage?.cost != null) state.cost = usage.cost;
      local.responseMessage = data.message ?? null;
      break;
    }
    case 'content_block_start': {
      if (data.content_block?.type === 'tool_use') state.hasToolUse = true;
      const idx = data.index ?? 0;
      local.contentBlocks[idx] = { ...data.content_block };
      if (local.contentBlocks[idx].type === 'text') local.contentBlocks[idx].text = '';
      if (local.contentBlocks[idx].type === 'tool_use') local.contentBlocks[idx].input = '';
      break;
    }
    case 'content_block_delta': {
      const idx = data.index ?? 0;
      const block = local.contentBlocks[idx];
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
      const block = local.contentBlocks[idx];
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
      if (local.responseMessage) {
        if (data.delta) Object.assign(local.responseMessage, data.delta);
        if (du) local.responseMessage.usage = { ...local.responseMessage.usage, ...du };
      }
      break;
    }
    case 'message_stop':
      state.finished = true;
      if (local.responseMessage) {
        local.responseMessage.content = local.contentBlocks.filter(Boolean);
        state.assembledResponse = local.responseMessage;
      }
      // Final pass: derive tool_calls summary from finalized content blocks.
      {
        const calls = extractToolCallsFromContent(local.contentBlocks.filter(Boolean));
        if (calls) state.toolCalls = calls;
      }
      break;
  }
}

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

async function parseStream(
  body: ReadableStream<Uint8Array>,
  state: LogState,
): Promise<void> {
  const local: AnthropicParseState = { contentBlocks: [], responseMessage: null };
  try {
    for await (const { event, data } of parseAnthropicSSE(body)) {
      extractLogData(event, data, state, local);
    }
  } catch (err: any) {
    console.error('[iris] anthropic parser error:', err.message);
  }
}

// ─── Adapter export ───

export const anthropicAdapter: FormatAdapter = {
  apiFormat: 'anthropic',
  upstreamPath: '/messages',
  parseRequest,
  parseStream,
  errorBody,
  extraHeaders,
};
