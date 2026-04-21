export type Range = 'today' | '24h' | '7d' | '30d' | 'all';
export type Bucket = '5min' | 'hour' | 'day';

const RANGE_MS: Record<'24h' | '7d' | '30d', number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function parseRange(raw: string | undefined): { range: Range; cutoffIso: string | null } {
  const range: Range =
    raw === 'today' || raw === '24h' || raw === '30d' || raw === 'all' || raw === '7d' ? raw : '7d';
  if (range === 'all') return { range, cutoffIso: null };
  if (range === 'today') {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { range, cutoffIso: startOfDay.toISOString() };
  }
  return { range, cutoffIso: new Date(Date.now() - RANGE_MS[range]).toISOString() };
}

export function parseBucket(raw: string | undefined, range: Range): Bucket {
  if (raw === '5min' || raw === 'hour' || raw === 'day') return raw;
  if (range === 'today') return '5min';
  if (range === '24h') return 'hour';
  return 'day';
}
