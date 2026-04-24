import { useQuery } from '@tanstack/react-query';
import { api, type Range, type Bucket, type LogsQuery } from '@/lib/api';

export function useSummary(range: Range) {
  return useQuery({
    queryKey: ['summary', range],
    queryFn: () => api.summary(range),
    refetchInterval: 30_000,
  });
}

export function useTimeseries(range: Range, bucket?: Bucket) {
  return useQuery({
    queryKey: ['timeseries', range, bucket],
    queryFn: () => api.timeseries(range, bucket),
    refetchInterval: 30_000,
  });
}

export function useByModel(range: Range) {
  return useQuery({
    queryKey: ['by-model', range],
    queryFn: () => api.byModel(range),
    refetchInterval: 30_000,
  });
}

export function useLogs(q: LogsQuery) {
  return useQuery({
    queryKey: ['logs', q],
    queryFn: () => api.logs(q),
    refetchInterval: 15_000,
  });
}

export function useLogDetail(requestId: string | null) {
  return useQuery({
    queryKey: ['log-detail', requestId],
    queryFn: () => api.logDetail(requestId!),
    enabled: requestId != null,
  });
}

export function useSessions(range: Range, cursor?: string) {
  return useQuery({
    queryKey: ['sessions', range, cursor],
    queryFn: () => api.sessions(range, cursor),
    refetchInterval: 30_000,
  });
}

export function useSessionDetail(sessionId: string | null) {
  return useQuery({
    queryKey: ['session-detail', sessionId],
    queryFn: () => api.sessionDetail(sessionId!),
    enabled: sessionId != null,
    refetchInterval: 30_000,
  });
}

export function useOpenRouterModels() {
  return useQuery({
    queryKey: ['settings', 'openrouter-models'],
    queryFn: () => api.settings.listOpenRouterModels(),
    staleTime: 10 * 60_000,
  });
}
