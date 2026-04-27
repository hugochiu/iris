import { getModelMapping, getProviderRouting, type Tier } from '../../db/settings.js';

const MAX_NAME = 200;

// Claude Code 会在 messages[0] 里塞 <system-reminder>、<ide_opened_file>、
// <ide_selection> 等上下文 block。识别"真正的用户文本"：去掉这些包裹标签的块。
// OpenAI 格式请求一般没有这些 tag，strip 是 no-op；保留以便复用。
function stripContextTags(text: string): string {
  return text.replace(
    /<(system-reminder|ide_opened_file|ide_selection|command-[a-z-]+)>[\s\S]*?<\/\1>/gi,
    '',
  );
}

/**
 * Extract the first user message text as a session name.
 * Works for both Anthropic Messages (content: string | block[]) and OpenAI Chat
 * Completions (content: string | array of {type, text, ...}).
 */
export function extractFirstUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const m of messages) {
    const msg = m as { role?: string; content?: unknown };
    if (msg?.role !== 'user') continue;
    const rawTexts: string[] = [];
    if (typeof msg.content === 'string') {
      rawTexts.push(msg.content);
    } else if (Array.isArray(msg.content)) {
      for (const b of msg.content as Array<{ type?: string; text?: string }>) {
        if (b?.type === 'text' && typeof b.text === 'string') rawTexts.push(b.text);
        else if (b?.type === 'input_text' && typeof b.text === 'string') rawTexts.push(b.text);
      }
    } else {
      continue;
    }
    for (const raw of rawTexts) {
      const cleaned = stripContextTags(raw).replace(/\s+/g, ' ').trim();
      if (cleaned) {
        return cleaned.length > MAX_NAME
          ? '…' + cleaned.slice(cleaned.length - (MAX_NAME - 1))
          : cleaned;
      }
    }
    return null; // First user had content but nothing extractable — don't keep looking
  }
  return null;
}

export function detectTier(model: string): Tier | null {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  return null;
}

/** Returns the mapped model if the input's name implies a tier; otherwise null. */
export function resolveModelTier(model: string): string | null {
  const tier = detectTier(model);
  if (!tier) return null;
  const override = getModelMapping()[tier];
  return override || null;
}

/** Builds the OpenRouter `provider` field, or `{}` if no routing is configured. */
export function buildProviderField(): { provider?: { only: string[]; allow_fallbacks: boolean } } {
  const routing = getProviderRouting();
  if (routing.only.length === 0) return {};
  return { provider: { only: routing.only, allow_fallbacks: routing.allowFallbacks } };
}
