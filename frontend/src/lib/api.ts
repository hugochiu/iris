export type Range = 'today' | '24h' | '7d' | '30d' | 'all';
export type Bucket = '5min' | 'hour' | 'day';

export const ERROR_CATEGORIES = [
  'rate_limit',
  'timeout',
  'server_error',
  'context_length',
  'auth',
  'connection',
  'stream',
  'other',
] as const;
export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const STOP_REASONS = ['end_turn', 'tool_use', 'max_tokens', 'stop_sequence', 'unknown'] as const;
export type StopReason = (typeof STOP_REASONS)[number];

export interface Summary {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  totalCost: number;
  avgDurationMs: number;
  avgTtftMs: number;
  avgTpotMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
    cacheRead: number;
    cacheCreation: number;
  };
  cacheHitRate: number;
  toolUseCount: number;
  errorCategories: Record<ErrorCategory, number>;
  stopReasons: Record<StopReason, number>;
}

export interface TimeseriesPoint {
  ts: string;
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  cacheHitRate: number;
  avgTtftMs: number;
  avgTpotMs: number;
}

export interface Timeseries {
  bucket: Bucket;
  points: TimeseriesPoint[];
}

export interface ModelStats {
  model: string;
  requests: number;
  cost: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  successRate: number;
  cacheHitRate: number;
  inputTokens: number;
  cacheReadTokens: number;
}

export interface LogRow {
  id: number;
  requestId: string;
  timestamp: string;
  model: string;
  provider: string | null;
  realModel: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number | null;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  durationMs: number;
  ttftMs: number | null;
  tpotMs: number | null;
  status: 'success' | 'error';
  errorMessage: string | null;
  hasToolUse: boolean;
  stopReason: string | null;
}

export interface LogsPage {
  items: LogRow[];
  nextCursor: string | null;
}

export interface PayloadPayload {
  requestId: string;
  requestHeaders: unknown;
  forwardedHeaders: unknown;
  requestBody: unknown;
  responseHeaders: unknown;
  responseBody: unknown;
}

export interface LogDetail {
  log: LogRow;
  payload: PayloadPayload | null;
}

export interface LogsQuery {
  cursor?: string;
  limit?: number;
  status?: 'success' | 'error';
  model?: string;
  range?: Range;
  hasToolUse?: 'true' | 'false';
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function qs(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const api = {
  summary: (range: Range) =>
    get<Summary>(`/api/stats/summary${qs({ range })}`),
  timeseries: (range: Range, bucket?: Bucket) =>
    get<Timeseries>(`/api/stats/timeseries${qs({ range, bucket })}`),
  byModel: (range: Range) =>
    get<{ items: ModelStats[] }>(`/api/stats/by-model${qs({ range })}`),
  logs: (q: LogsQuery) =>
    get<LogsPage>(`/api/logs${qs(q as Record<string, string | number | undefined>)}`),
  logDetail: (requestId: string) =>
    get<LogDetail>(`/api/logs/${encodeURIComponent(requestId)}`),
};
