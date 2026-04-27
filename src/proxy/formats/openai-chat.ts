import { createHash } from 'node:crypto';
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

function extractPreview(messages: unknown[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== 'user') continue;
    let text: string | null = null;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          text = part.text;
          break;
        }
      }
    }
    if (text) {
      const cleaned = text.replace(/\s+/g, ' ').trim();
      if (cleaned) {
        return cleaned.length > MAX_PREVIEW
          ? '…' + cleaned.slice(cleaned.length - (MAX_PREVIEW - 1))
          : cleaned;
      }
    }
  }
  return null;
}

// ─── Cache control injection (Anthropic-only) ───
//
// OpenAI Chat Completions clients don't know to send cache_control breakpoints,
// but Anthropic models served via this format still require them — without
// explicit markers, OpenRouter won't cache anything. We inject up to 3
// ephemeral breakpoints on what is stable across turns: the system prompt,
// the tool definitions, and the last turn of prior conversation (everything
// except the newest user message). Anthropic allows up to 4 breakpoints; short
// content that falls below its cache threshold silently no-ops.

function isAnthropicModel(model: string): boolean {
  return model.startsWith('anthropic/');
}

function toContentBlocks(content: unknown): any[] | null {
  if (content == null) return null;
  if (typeof content === 'string') {
    if (!content) return null;
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content)) {
    return content.length > 0 ? content.map((b) => ({ ...b })) : null;
  }
  return null;
}

function injectCacheControl(body: Record<string, any>): void {
  if (typeof body.model !== 'string' || !isAnthropicModel(body.model)) return;

  // 1. Tools: mark the last tool
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    const tools = body.tools.map((t: any) => ({ ...t }));
    const last = tools[tools.length - 1];
    if (last && typeof last === 'object') {
      last.cache_control = { type: 'ephemeral' };
      body.tools = tools;
    }
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) return;
  const messages = body.messages.map((m: any) => ({ ...m }));
  body.messages = messages;

  let sysIdx = -1;

  // 2. System message at index 0: expand to block array, mark last block
  if (messages[0]?.role === 'system') {
    sysIdx = 0;
    const blocks = toContentBlocks(messages[0].content);
    if (blocks && blocks.length > 0) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: 'ephemeral' },
      };
      messages[0] = { ...messages[0], content: blocks };
    }
  }

  // 3. Second-to-last message (the last stable prior turn before the new user message)
  const secondLastIdx = messages.length - 2;
  if (secondLastIdx > sysIdx) {
    const m = messages[secondLastIdx];
    const blocks = toContentBlocks(m?.content);
    if (blocks && blocks.length > 0) {
      blocks[blocks.length - 1] = {
        ...blocks[blocks.length - 1],
        cache_control: { type: 'ephemeral' },
      };
      messages[secondLastIdx] = { ...m, content: blocks };
    }
  }
}

// ─── Request parsing ───

// ─── Session derivation ───
// Hash the first user message + first assistant message to derive a stable
// session id that groups all turns of the same conversation together.

interface ChatSessionSeed {
  firstUser: string | null;
  firstAssistant: string | null;
}

function extractSessionSeed(messages: unknown[]): ChatSessionSeed {
  let firstUser: string | null = null;
  let firstAssistant: string | null = null;
  for (const msg of messages) {
    const m = msg as { role?: string; content?: unknown };
    if (!firstUser && m?.role === 'user') {
      firstUser = extractTextContent(m.content);
    } else if (!firstAssistant && m?.role === 'assistant') {
      firstAssistant = extractTextContent(m.content);
    }
    if (firstUser && firstAssistant) break;
  }
  return { firstUser, firstAssistant };
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const part of content) {
      if (part?.type === 'text' && typeof part.text === 'string') return part.text;
    }
  }
  return null;
}

function deriveSessionId(seed: ChatSessionSeed, assistantText: string | null): string | null {
  const user = seed.firstUser;
  const asst = seed.firstAssistant ?? assistantText;
  if (!user || !asst) return null;
  return createHash('sha256')
    .update(user)
    .update('\0')
    .update(asst)
    .digest('hex')
    .slice(0, 16);
}

function parseRequest(raw: unknown): RequestParseResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, status: 400, message: 'Invalid JSON body' };
  }
  const body = raw as Record<string, unknown>;
  if (!body.messages || typeof body.model !== 'string') {
    return { ok: false, status: 400, message: 'messages and model are required' };
  }
  const requestModel = body.model as string;
  const resolvedModel = resolveModel(requestModel);
  const wantsStream = body.stream === true;
  const preview = extractPreview(body.messages as unknown[]);
  const seed = extractSessionSeed(body.messages as unknown[]);
  // If we already have both user+assistant in history, derive session now.
  // Otherwise defer: parseStream will finalize once the first assistant reply arrives.
  const sessionId = deriveSessionId(seed, null);

  const providerField = buildProviderField();
  const forwardBody: Record<string, any> = {
    ...body,
    ...providerField,
    model: resolvedModel,
    stream: true,
    stream_options: { include_usage: true },
  };
  injectCacheControl(forwardBody);

  return {
    ok: true,
    requestModel,
    resolvedModel,
    wantsStream,
    sessionId,
    sessionSeed: seed,
    sessionName: extractFirstUserText(body.messages),
    preview,
    previewMsgIndex: null,
    forwardBody,
  };
}

// ─── SSE parsing + log extraction ───

interface ChatParseState {
  responseId: string;
  responseModel: string;
  created: number;
  choices: ChatChoice[];
  usage: Record<string, unknown> | null;
  systemFingerprint: string | null;
}

interface ChatChoice {
  index: number;
  message: {
    role: string;
    content: string | null;
    tool_calls: ChatToolCall[];
  };
  finish_reason: string | null;
}

interface ChatToolCall {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

async function parseStream(
  body: ReadableStream<Uint8Array>,
  state: LogState,
): Promise<void> {
  const local: ChatParseState = {
    responseId: '',
    responseModel: '',
    created: 0,
    choices: [],
    usage: null,
    systemFingerprint: null,
  };

  const reader = body.pipeThrough(new TextDecoderStream() as any).getReader();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      const lines = buffer.split('\n');
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) continue;

        if (trimmed === 'data: [DONE]') {
          state.finished = true;
          continue;
        }

        if (!trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);
        let chunk: any;
        try {
          chunk = JSON.parse(jsonStr);
        } catch {
          continue;
        }

        // Capture response metadata from first chunk
        if (chunk.id && !local.responseId) {
          local.responseId = chunk.id;
          local.created = chunk.created ?? 0;
          local.systemFingerprint = chunk.system_fingerprint ?? null;
        }
        if (chunk.model) {
          local.responseModel = chunk.model;
          state.model = chunk.model;
        }

        // OpenRouter provider info
        if (chunk.provider) state.provider = chunk.provider;

        // Process choices
        if (Array.isArray(chunk.choices)) {
          for (const choice of chunk.choices) {
            const idx = choice.index ?? 0;
            if (!local.choices[idx]) {
              local.choices[idx] = {
                index: idx,
                message: { role: 'assistant', content: null, tool_calls: [] },
                finish_reason: null,
              };
            }
            const c = local.choices[idx];

            if (choice.delta) {
              const d = choice.delta;
              if (d.role) c.message.role = d.role;

              if (typeof d.content === 'string') {
                const now = Date.now();
                if (state.firstTokenAt == null) state.firstTokenAt = now;
                state.lastTokenAt = now;
                c.message.content = (c.message.content ?? '') + d.content;
              }

              if (Array.isArray(d.tool_calls)) {
                state.hasToolUse = true;
                const now = Date.now();
                if (state.firstTokenAt == null) state.firstTokenAt = now;
                state.lastTokenAt = now;

                for (const tc of d.tool_calls) {
                  const tcIdx = tc.index ?? 0;
                  if (!c.message.tool_calls[tcIdx]) {
                    c.message.tool_calls[tcIdx] = {
                      id: tc.id ?? '',
                      type: tc.type ?? 'function',
                      function: { name: '', arguments: '' },
                    };
                  }
                  const existing = c.message.tool_calls[tcIdx];
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.function.name = tc.function.name;
                  if (tc.function?.arguments) {
                    existing.function.arguments += tc.function.arguments;
                  }
                }
              }
            }

            if (choice.finish_reason) {
              c.finish_reason = choice.finish_reason;
            }
          }
        }

        // Usage (usually in the last chunk when stream_options.include_usage is true).
        // OpenAI's `prompt_tokens` is the TOTAL input (cached + cache_write + new),
        // while Anthropic's `input_tokens` is NEW tokens only. To keep the dashboard
        // column comparable across formats, we subtract cache tokens here so that
        // inputTokens means "new input tokens" consistently.
        if (chunk.usage) {
          local.usage = chunk.usage;
          const prompt = chunk.usage.prompt_tokens ?? 0;
          const cachedRead = chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
          const cachedWrite = chunk.usage.prompt_tokens_details?.cache_write_tokens ?? 0;
          state.cacheReadInputTokens = cachedRead;
          state.cacheCreationInputTokens = cachedWrite;
          state.inputTokens = Math.max(0, prompt - cachedRead - cachedWrite);
          state.outputTokens = chunk.usage.completion_tokens ?? 0;
          state.reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0;
          if (chunk.usage.cost != null) state.cost = chunk.usage.cost;
        }
      }
    }
  } catch (err: any) {
    console.error('[iris] openai-chat parser error:', err.message);
  } finally {
    reader.releaseLock();
  }

  // Derive stop_reason from the first choice
  if (local.choices[0]?.finish_reason) {
    state.stopReason = local.choices[0].finish_reason;
  }

  // Build tool calls summary for the log
  for (const choice of local.choices) {
    if (!choice) continue;
    for (const tc of choice.message.tool_calls) {
      if (tc?.function?.name) {
        state.toolCalls.push({ name: tc.function.name, label: null });
      }
    }
  }

  // Assemble the non-stream response object
  const cleanChoices = local.choices.filter(Boolean).map(c => ({
    index: c.index,
    message: {
      role: c.message.role,
      content: c.message.content,
      ...(c.message.tool_calls.length > 0 ? { tool_calls: c.message.tool_calls.filter(Boolean) } : {}),
    },
    finish_reason: c.finish_reason,
  }));

  state.assembledResponse = {
    id: local.responseId,
    object: 'chat.completion',
    created: local.created,
    model: local.responseModel,
    choices: cleanChoices,
    usage: local.usage,
    ...(local.systemFingerprint ? { system_fingerprint: local.systemFingerprint } : {}),
  };

  // Finalize session id: if parseRequest couldn't derive it (first turn —
  // only user, no assistant yet), use the generated assistant text.
  if (!state.sessionId && state.sessionSeed) {
    const seed = state.sessionSeed as ChatSessionSeed;
    const assistantText = local.choices[0]?.message?.content ?? null;
    state.sessionId = deriveSessionId(seed, assistantText);
  }
}

// ─── Adapter export ───

export const openaiChatAdapter: FormatAdapter = {
  apiFormat: 'openai-chat',
  upstreamPath: '/chat/completions',
  parseRequest,
  parseStream,
  errorBody,
};
