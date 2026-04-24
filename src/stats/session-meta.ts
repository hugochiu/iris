// Helpers for extracting session-row metadata (user-message preview and
// tool-call summaries) from Anthropic request/response payloads. Used by the
// proxy ingest path (object input, no extra JSON parse) and by the one-shot
// backfill for historical rows (string input, parses the stored payload).

export interface ToolCall {
  name: string;
  label: string | null;
}

const MAX_LABEL = 48;
const MAX_PREVIEW = 200;

function stripContextTags(text: string): string {
  return text.replace(
    /<(system-reminder|ide_opened_file|ide_selection|command-[a-z-]+)>[\s\S]*?<\/\1>/gi,
    '',
  );
}

function truncateHead(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LABEL ? one.slice(0, MAX_LABEL - 1) + '…' : one;
}

function truncateTail(s: string): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > MAX_LABEL ? '…' + one.slice(one.length - (MAX_LABEL - 1)) : one;
}

function extractToolLabel(name: string, input: unknown): string | null {
  if (!input || typeof input !== 'object') return null;
  const i = input as Record<string, unknown>;
  const pick = (k: string): string | null =>
    typeof i[k] === 'string' && (i[k] as string).length > 0 ? (i[k] as string) : null;
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const p = pick('file_path') ?? pick('notebook_path');
      return p ? truncateTail(p) : null;
    }
    case 'Bash': {
      const c = pick('command');
      return c ? truncateHead(c) : null;
    }
    case 'Grep':
    case 'Glob': {
      const p = pick('pattern');
      return p ? truncateHead(p) : null;
    }
    case 'WebFetch': {
      const u = pick('url');
      return u ? truncateTail(u) : null;
    }
    case 'WebSearch': {
      const q = pick('query');
      return q ? truncateHead(q) : null;
    }
    case 'Task':
    case 'Agent': {
      const d = pick('description') ?? pick('subagent_type');
      return d ? truncateHead(d) : null;
    }
    default:
      return null;
  }
}

// Extract tool_use blocks from an already-parsed response content array
// (what we have mid-stream in the proxy handler).
export function extractToolCallsFromContent(content: unknown): ToolCall[] | null {
  if (!Array.isArray(content)) return null;
  const calls: ToolCall[] = [];
  for (const block of content as Array<{ type?: string; name?: string; input?: unknown }>) {
    if (block?.type === 'tool_use' && typeof block.name === 'string' && block.name) {
      calls.push({ name: block.name, label: extractToolLabel(block.name, block.input) });
    }
  }
  return calls.length > 0 ? calls : null;
}

export interface PreviewResult {
  text: string;
  msgIndex: number;
}

// Extract the latest user-message text from an already-parsed messages array,
// along with the index of that message. The index is the turn fingerprint:
// two requests with the same preview text but different indices belong to
// different user turns (e.g. user sent the identical prompt twice).
export function extractLatestUserPreviewFromMessages(messages: unknown): PreviewResult | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as { role?: string; content?: unknown };
    if (msg?.role !== 'user') continue;
    const rawTexts: string[] = [];
    if (typeof msg.content === 'string') {
      rawTexts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const b of msg.content as Array<{ type?: string; text?: string }>) {
        if (b?.type === 'text' && typeof b.text === 'string') rawTexts.push(b.text);
      }
    }
    for (const raw of rawTexts) {
      const cleaned = stripContextTags(raw).replace(/\s+/g, ' ').trim();
      if (cleaned) {
        const text = cleaned.length > MAX_PREVIEW
          ? '…' + cleaned.slice(cleaned.length - (MAX_PREVIEW - 1))
          : cleaned;
        return { text, msgIndex: i };
      }
    }
  }
  return null;
}

// Backfill variant: parse a stored JSON string, then delegate.
export function extractLatestUserPreviewFromBody(bodyText: string | null): PreviewResult | null {
  if (!bodyText) return null;
  try {
    const body = JSON.parse(bodyText) as { messages?: unknown };
    return extractLatestUserPreviewFromMessages(body?.messages);
  } catch {
    return null;
  }
}

export function extractToolCallsFromResponse(responseText: string | null): ToolCall[] | null {
  if (!responseText) return null;
  try {
    const msg = JSON.parse(responseText) as { content?: unknown };
    return extractToolCallsFromContent(msg?.content);
  } catch {
    return null;
  }
}
