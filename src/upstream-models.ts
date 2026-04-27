import { getActiveUpstream } from './upstream.js';

export type RawUpstreamModel = Record<string, unknown>;

export type UpstreamModelsResult =
  | { ok: true; items: RawUpstreamModel[]; cached: boolean }
  | { ok: false; status: number; error: string; detail?: string };

let cache: { at: number; items: RawUpstreamModel[] } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function fetchUpstreamModelsRaw(): Promise<UpstreamModelsResult> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) {
    return { ok: true, items: cache.items, cached: true };
  }

  const upstream = getActiveUpstream();
  const url = `${upstream.baseUrl}/models`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${upstream.apiKey}` },
    });
  } catch (err: any) {
    return { ok: false, status: 502, error: `Failed to reach upstream: ${err?.message ?? err}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return {
      ok: false,
      status: 502,
      error: `Upstream returned ${res.status}`,
      detail: text.slice(0, 500),
    };
  }
  const json = (await res.json()) as { data?: RawUpstreamModel[] };
  const items = (json.data ?? []).filter((m) => typeof m?.id === 'string' && m.id);
  cache = { at: now, items };
  return { ok: true, items, cached: false };
}
