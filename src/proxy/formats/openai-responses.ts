import type {
  FormatAdapter,
  LogState,
  RequestParseResult,
} from '../pipeline.js';
import { buildProviderField, extractFirstUserText, resolveModelTier } from './shared.js';

const MAX_PREVIEW = 200;

// ─── Model resolution ───

function resolveModel(model: string): string {
  const mapped = resolveModelTier(model);
  if (mapped) return mapped;
  return model;
}

// ─── Error body in OpenAI native shape ───

function errorBody(status: number, message: string): object {
  let type = 'api_error';
  if (status === 400) type = 'invalid_request_error';
  else if (status === 401) type = 'authentication_error';
  else if (status === 403) type = 'permission_error';
  else if (status === 404) type = 'not_found_error';
  else if (status === 429) type = 'rate_limit_error';
  return {
    error: { message, type, param: null, code: null },
  };
}

// ─── Preview extraction ───

function extractPreview(input: unknown): string | null {
  let text: string | null = null;
  if (typeof input === 'string') {
    text = input;
  } else if (Array.isArray(input)) {
    // Walk backwards to find the last user-role message with text content
    for (let i = input.length - 1; i >= 0; i--) {
      const msg = input[i];
      if (msg?.role !== 'user') continue;
      if (typeof msg.content === 'string') {
        text = msg.content;
        break;
      }
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part?.type === 'input_text' && typeof part.text === 'string') {
            text = part.text;
            break;
          }
        }
        if (text) break;
      }
    }
  }
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_PREVIEW
    ? '…' + cleaned.slice(cleaned.length - (MAX_PREVIEW - 1))
    : cleaned;
}

// ─── Request parsing ───

function parseRequest(raw: unknown): RequestParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, message: 'Invalid JSON body' };
  }
  const body = raw as Record<string, unknown>;
  if (!body.input || typeof body.model !== 'string') {
    return { ok: false, status: 400, message: 'input and model are required' };
  }
  const requestModel = body.model as string;
  const resolvedModel = resolveModel(requestModel);
  const wantsStream = body.stream === true;
  const preview = extractPreview(body.input);
  const prevResponseId = typeof body.previous_response_id === 'string'
    ? body.previous_response_id
    : null;

  const providerField = buildProviderField();
  const forwardBody = {
    ...body,
    ...providerField,
    model: resolvedModel,
    stream: true,
  };

  return {
    ok: true,
    requestModel,
    resolvedModel,
    wantsStream,
    sessionId: prevResponseId,
    sessionName: typeof body.input === 'string'
      ? (body.input.length > 200 ? '…' + body.input.slice(body.input.length - 199) : body.input)
      : extractFirstUserText(body.input as unknown[]),
    preview,
    previewMsgIndex: null,
    forwardBody,
  };
}

// ─── SSE parsing + log extraction ───

async function parseStream(
  body: ReadableStream<Uint8Array>,
  state: LogState,
): Promise<void> {
  let assembledResponse: Record<string, unknown> | null = null;

  const reader = body.pipeThrough(new TextDecoderStream() as any).getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      // OpenRouter Responses SSE: each frame is "data: {json}\n\n" with no
      // separate "event:" line — the event type lives inside data.type.
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          if (!state.finished) state.finished = true;
          continue;
        }

        if (!trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        let data: any;
        try {
          data = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        const eventType: string = data?.type ?? '';

        switch (eventType) {
          case 'response.created': {
            if (data.response) {
              state.model = data.response.model ?? '';
              // OpenRouter may return provider in a custom field
              state.provider = data.response.provider ?? null;
              assembledResponse = data.response;
            }
            break;
          }
          case 'response.output_text.delta': {
            const now = Date.now();
            if (state.firstTokenAt == null) state.firstTokenAt = now;
            state.lastTokenAt = now;
            break;
          }
          case 'response.output_item.added': {
            if (data.item?.type === 'function_call' && data.item?.name) {
              state.hasToolUse = true;
              state.toolCalls.push({ name: data.item.name, label: null });
            }
            break;
          }
          case 'response.function_call_arguments.delta': {
            const now = Date.now();
            if (state.firstTokenAt == null) state.firstTokenAt = now;
            state.lastTokenAt = now;
            break;
          }
          case 'response.completed': {
            state.finished = true;
            const resp = data.response;
            if (resp) {
              assembledResponse = resp;
              state.model = resp.model ?? state.model;
              state.provider = resp.provider ?? state.provider;
              state.stopReason = resp.status ?? null;
              // Usage. OpenAI's `input_tokens` includes cached tokens; subtract
              // so `inputTokens` matches Anthropic's "new tokens" semantics.
              const usage = resp.usage;
              if (usage) {
                const totalIn = usage.input_tokens ?? 0;
                const cachedRead = usage.input_tokens_details?.cached_tokens ?? 0;
                state.cacheReadInputTokens = cachedRead;
                state.inputTokens = Math.max(0, totalIn - cachedRead);
                state.outputTokens = usage.output_tokens ?? 0;
                state.reasoningTokens = usage.output_tokens_details?.reasoning_tokens ?? 0;
                if (usage.cost != null) state.cost = usage.cost;
              }
            }
            break;
          }
        }
      }
    }
  } catch (err: any) {
    console.error('[iris] openai-responses parser error:', err.message);
  } finally {
    reader.releaseLock();
  }

  state.assembledResponse = assembledResponse;
}

// ─── Adapter export ───

export const openaiResponsesAdapter: FormatAdapter = {
  apiFormat: 'openai-responses',
  upstreamPath: '/responses',
  parseRequest,
  parseStream,
  errorBody,
};
