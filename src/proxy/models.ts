import type { Context } from 'hono';
import { fetchUpstreamModelsRaw, type RawUpstreamModel } from '../upstream-models.js';

interface OpenAIModelEntry {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
  [key: string]: unknown;
}

function toOpenAIEntry(m: RawUpstreamModel): OpenAIModelEntry | null {
  const id = typeof m.id === 'string' ? m.id : null;
  if (!id) return null;

  const slashIdx = id.indexOf('/');
  const owned_by =
    typeof m.owned_by === 'string' && m.owned_by
      ? m.owned_by
      : slashIdx > 0
        ? id.slice(0, slashIdx)
        : 'upstream';

  const createdRaw = m.created;
  const created =
    typeof createdRaw === 'number' && Number.isFinite(createdRaw)
      ? createdRaw
      : Math.floor(Date.now() / 1000);

  // Passthrough everything else (name, description, context_length, pricing,
  // architecture, top_provider, ...) so downstream clients like Cline get the
  // full metadata they already know how to parse.
  return {
    ...m,
    id,
    object: 'model',
    created,
    owned_by,
  };
}

export async function listModelsHandler(c: Context) {
  const result = await fetchUpstreamModelsRaw();
  if (!result.ok) {
    return c.json(
      { error: { message: result.error, type: 'upstream_error', detail: result.detail } },
      result.status as any,
    );
  }
  const data = result.items
    .map(toOpenAIEntry)
    .filter((m): m is OpenAIModelEntry => m !== null);
  return c.json({ object: 'list', data });
}

export async function getModelHandler(c: Context) {
  // Model IDs often contain "/" (e.g. "anthropic/claude-opus-4.6"), so we use
  // a wildcard route and read req.path instead of a named param.
  const prefix = '/v1/models/';
  const rawPath = c.req.path;
  const idx = rawPath.indexOf(prefix);
  const rawId = idx >= 0 ? rawPath.slice(idx + prefix.length) : '';
  const id = decodeURIComponent(rawId);

  if (!id) {
    return c.json(
      { error: { message: 'Model id is required', type: 'invalid_request_error' } },
      400,
    );
  }

  const result = await fetchUpstreamModelsRaw();
  if (!result.ok) {
    return c.json(
      { error: { message: result.error, type: 'upstream_error', detail: result.detail } },
      result.status as any,
    );
  }

  const found = result.items.find((m) => typeof m.id === 'string' && m.id === id);
  if (!found) {
    return c.json(
      { error: { message: `Model not found: ${id}`, type: 'not_found_error' } },
      404,
    );
  }
  const entry = toOpenAIEntry(found);
  if (!entry) {
    return c.json(
      { error: { message: `Model not found: ${id}`, type: 'not_found_error' } },
      404,
    );
  }
  return c.json(entry);
}
