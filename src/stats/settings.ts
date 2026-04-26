import type { Context } from 'hono';
import {
  getModelMapping,
  setModelMapping,
  getProviderRouting,
  setProviderRouting,
  type ModelMapping,
  type ProviderRouting,
  type Tier,
} from '../db/settings.js';
import { getActiveUpstream } from '../upstream.js';

const TIERS: Tier[] = ['opus', 'sonnet', 'haiku'];
const MAX_LEN = 200;

export async function getModelsHandler(c: Context) {
  return c.json(getModelMapping());
}

export async function updateModelsHandler(c: Context) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Body must be an object' }, 400);
  }

  const patch: Partial<ModelMapping> = {};
  for (const tier of TIERS) {
    const v = (body as Record<string, unknown>)[tier];
    if (v === undefined) continue;
    if (typeof v !== 'string') {
      return c.json({ error: `${tier} must be a string` }, 400);
    }
    if (v.length > MAX_LEN || /[\r\n]/.test(v)) {
      return c.json({ error: `${tier} contains invalid characters or is too long` }, 400);
    }
    patch[tier] = v.trim();
  }

  const next = setModelMapping(patch);
  return c.json(next);
}

type OpenRouterModel = {
  id: string;
  name?: string;
  context_length?: number;
  maxCompletionTokens?: number;
  modality?: string;
  promptCost?: number;
  completionCost?: number;
  cacheReadCost?: number;
  cacheWriteCost?: number;
};
let modelsCache: { at: number; items: OpenRouterModel[] } | null = null;
const MODELS_TTL_MS = 10 * 60 * 1000;

function pricePerMillion(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined;
  const n = parseFloat(v);
  if (!isFinite(n) || n < 0) return undefined;
  return n * 1_000_000;
}

export async function listOpenRouterModelsHandler(c: Context) {
  const now = Date.now();
  if (modelsCache && now - modelsCache.at < MODELS_TTL_MS) {
    return c.json({ items: modelsCache.items, cached: true });
  }

  const upstream = getActiveUpstream();
  const url = `${upstream.baseUrl}/models`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${upstream.apiKey}` },
    });
  } catch (err: any) {
    return c.json({ error: `Failed to reach OpenRouter: ${err?.message ?? err}` }, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return c.json({ error: `OpenRouter returned ${res.status}`, detail: text.slice(0, 500) }, 502);
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const items: OpenRouterModel[] = (json.data ?? []).map((m) => {
    const pricing = (m.pricing as Record<string, unknown> | undefined) ?? {};
    const arch = (m.architecture as Record<string, unknown> | undefined) ?? {};
    const top = (m.top_provider as Record<string, unknown> | undefined) ?? {};
    return {
      id: String(m.id ?? ''),
      name: typeof m.name === 'string' ? m.name : undefined,
      context_length: typeof m.context_length === 'number' ? m.context_length : undefined,
      maxCompletionTokens: typeof top.max_completion_tokens === 'number' ? top.max_completion_tokens : undefined,
      modality: typeof arch.modality === 'string' ? arch.modality : undefined,
      promptCost: pricePerMillion(pricing.prompt),
      completionCost: pricePerMillion(pricing.completion),
      cacheReadCost: pricePerMillion(pricing.input_cache_read),
      cacheWriteCost: pricePerMillion(pricing.input_cache_write),
    };
  }).filter((m) => m.id);

  modelsCache = { at: now, items };
  return c.json({ items, cached: false });
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_PROVIDERS = 50;

export async function getProviderRoutingHandler(c: Context) {
  return c.json(getProviderRouting());
}

export async function updateProviderRoutingHandler(c: Context) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Body must be an object' }, 400);
  }

  const raw = body as Record<string, unknown>;
  const onlyRaw = raw.only;
  if (!Array.isArray(onlyRaw)) {
    return c.json({ error: 'only must be an array of strings' }, 400);
  }
  if (onlyRaw.length > MAX_PROVIDERS) {
    return c.json({ error: `only may contain at most ${MAX_PROVIDERS} entries` }, 400);
  }
  const seen = new Set<string>();
  const only: string[] = [];
  for (const v of onlyRaw) {
    if (typeof v !== 'string') {
      return c.json({ error: 'only must be an array of strings' }, 400);
    }
    const slug = v.trim().toLowerCase();
    if (!SLUG_RE.test(slug)) {
      return c.json({ error: `invalid provider slug: ${v}` }, 400);
    }
    if (seen.has(slug)) continue;
    seen.add(slug);
    only.push(slug);
  }

  const allowFallbacksRaw = raw.allowFallbacks;
  const allowFallbacks = allowFallbacksRaw === undefined ? true : !!allowFallbacksRaw;
  if (allowFallbacksRaw !== undefined && typeof allowFallbacksRaw !== 'boolean') {
    return c.json({ error: 'allowFallbacks must be a boolean' }, 400);
  }

  const next: ProviderRouting = { only, allowFallbacks };
  return c.json(setProviderRouting(next));
}

type OpenRouterProvider = { slug: string; name: string };
let providersCache: { at: number; items: OpenRouterProvider[] } | null = null;
const PROVIDERS_TTL_MS = 10 * 60 * 1000;

export async function listOpenRouterProvidersHandler(c: Context) {
  const now = Date.now();
  if (providersCache && now - providersCache.at < PROVIDERS_TTL_MS) {
    return c.json({ items: providersCache.items, cached: true });
  }

  const upstream = getActiveUpstream();
  const url = `${upstream.baseUrl}/providers`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${upstream.apiKey}` },
    });
  } catch (err: any) {
    return c.json({ error: `Failed to reach OpenRouter: ${err?.message ?? err}` }, 502);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return c.json({ error: `OpenRouter returned ${res.status}`, detail: text.slice(0, 500) }, 502);
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
  const items: OpenRouterProvider[] = (json.data ?? [])
    .map((p) => ({
      slug: typeof p.slug === 'string' ? p.slug : '',
      name: typeof p.name === 'string' ? p.name : '',
    }))
    .filter((p) => p.slug)
    .sort((a, b) => (a.name || a.slug).localeCompare(b.name || b.slug));

  providersCache = { at: now, items };
  return c.json({ items, cached: false });
}

// ─── Upstream switching ───

import { listUpstreams, setActiveUpstream } from '../upstream.js';
import type { UpstreamId } from '../config.js';

export async function getUpstreamsHandler(c: Context) {
  return c.json(listUpstreams());
}

export async function switchUpstreamHandler(c: Context) {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'Body must be an object' }, 400);
  }
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== 'string') {
    return c.json({ error: 'id must be a string' }, 400);
  }
  try {
    setActiveUpstream(id as UpstreamId);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }
  return c.json(listUpstreams());
}
