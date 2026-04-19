export type Range = '24h' | '7d' | '30d' | 'all';
export type Bucket = 'hour' | 'day';

const RANGE_MS: Record<Exclude<Range, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function parseRange(raw: string | undefined): { range: Range; cutoffIso: string | null } {
  const range: Range = raw === '24h' || raw === '30d' || raw === 'all' || raw === '7d' ? raw : '7d';
  if (range === 'all') return { range, cutoffIso: null };
  return { range, cutoffIso: new Date(Date.now() - RANGE_MS[range]).toISOString() };
}

export function parseBucket(raw: string | undefined, range: Range): Bucket {
  if (raw === 'hour' || raw === 'day') return raw;
  return range === '24h' ? 'hour' : 'day';
}
