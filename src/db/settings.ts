import { sqlite } from './index.js';

export type Tier = 'opus' | 'sonnet' | 'haiku';
export type ModelMapping = Record<Tier, string>;

const TIERS: Tier[] = ['opus', 'sonnet', 'haiku'];
const keyFor = (tier: Tier): string => `model_map.${tier}`;

const selectStmt = sqlite.prepare(`SELECT value FROM settings WHERE key = ?`);

const upsertStmt = sqlite.prepare(
  `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
);

export function getModelMapping(): ModelMapping {
  const out = { opus: '', sonnet: '', haiku: '' } as ModelMapping;
  for (const tier of TIERS) {
    const row = selectStmt.get(keyFor(tier)) as { value: string } | undefined;
    if (row) out[tier] = row.value;
  }
  return out;
}

export function setModelMapping(mapping: Partial<ModelMapping>): ModelMapping {
  const now = new Date().toISOString();
  for (const tier of TIERS) {
    const value = mapping[tier];
    if (value === undefined) continue;
    upsertStmt.run(keyFor(tier), value, now);
  }
  return getModelMapping();
}

export interface ProviderRouting {
  only: string[];
  allowFallbacks: boolean;
}

const PROVIDER_ROUTING_KEY = 'provider_routing';
const DEFAULT_ROUTING: ProviderRouting = { only: [], allowFallbacks: true };

export function getProviderRouting(): ProviderRouting {
  const row = selectStmt.get(PROVIDER_ROUTING_KEY) as { value: string } | undefined;
  if (!row) return { ...DEFAULT_ROUTING };
  try {
    const parsed = JSON.parse(row.value);
    const only = Array.isArray(parsed?.only) ? parsed.only.filter((s: unknown) => typeof s === 'string') : [];
    const allowFallbacks = typeof parsed?.allowFallbacks === 'boolean' ? parsed.allowFallbacks : true;
    return { only, allowFallbacks };
  } catch {
    return { ...DEFAULT_ROUTING };
  }
}

export function setProviderRouting(routing: ProviderRouting): ProviderRouting {
  const now = new Date().toISOString();
  upsertStmt.run(PROVIDER_ROUTING_KEY, JSON.stringify(routing), now);
  return getProviderRouting();
}
