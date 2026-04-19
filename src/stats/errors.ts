import { sql, type SQL } from 'drizzle-orm';
import { requestLogs } from '../db/schema.js';

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

export function classifyError(msg: string | null | undefined): ErrorCategory | null {
  if (!msg) return null;
  if (/^Connection failed/i.test(msg)) return 'connection';
  if (/^Stream ended/i.test(msg)) return 'stream';
  if (/Upstream\s+429|rate[_\s-]?limit/i.test(msg)) return 'rate_limit';
  if (/Upstream\s+40[13]|authentication|invalid api key|unauthorized/i.test(msg)) return 'auth';
  if (/Upstream\s+408|timeout|timed out/i.test(msg)) return 'timeout';
  if (/context.{0,10}length|prompt.{0,10}too.{0,10}long|max.{0,10}tokens.{0,10}exceed/i.test(msg)) return 'context_length';
  if (/Upstream\s+5\d\d/.test(msg)) return 'server_error';
  return 'other';
}

export function categoryCaseSql(category: ErrorCategory): SQL<number> {
  const err = requestLogs.errorMessage;
  const status = requestLogs.status;
  const errOnly = sql`${status} = 'error' and ${err} is not null`;

  switch (category) {
    case 'connection':
      return sql<number>`sum(case when ${errOnly} and ${err} like 'Connection failed%' then 1 else 0 end)`;
    case 'stream':
      return sql<number>`sum(case when ${errOnly} and ${err} like 'Stream ended%' then 1 else 0 end)`;
    case 'rate_limit':
      return sql<number>`sum(case when ${errOnly} and (${err} like '%Upstream 429%' or ${err} like '%rate_limit%' or ${err} like '%rate limit%') then 1 else 0 end)`;
    case 'auth':
      return sql<number>`sum(case when ${errOnly} and (${err} like '%Upstream 401%' or ${err} like '%Upstream 403%' or ${err} like '%authentication%' or ${err} like '%invalid api key%' or ${err} like '%unauthorized%') then 1 else 0 end)`;
    case 'timeout':
      return sql<number>`sum(case when ${errOnly} and (${err} like '%Upstream 408%' or ${err} like '%timeout%' or ${err} like '%timed out%') then 1 else 0 end)`;
    case 'context_length':
      return sql<number>`sum(case when ${errOnly} and (${err} like '%context length%' or ${err} like '%context_length%' or ${err} like '%prompt is too long%' or ${err} like '%max_tokens%exceed%') then 1 else 0 end)`;
    case 'server_error':
      return sql<number>`sum(case when ${errOnly} and (
        ${err} like '%Upstream 500%' or ${err} like '%Upstream 501%' or ${err} like '%Upstream 502%' or
        ${err} like '%Upstream 503%' or ${err} like '%Upstream 504%' or ${err} like '%Upstream 505%'
      ) then 1 else 0 end)`;
    case 'other':
      return sql<number>`sum(case when ${errOnly} and not (
        ${err} like 'Connection failed%' or
        ${err} like 'Stream ended%' or
        ${err} like '%Upstream 429%' or ${err} like '%rate_limit%' or ${err} like '%rate limit%' or
        ${err} like '%Upstream 401%' or ${err} like '%Upstream 403%' or ${err} like '%authentication%' or ${err} like '%invalid api key%' or ${err} like '%unauthorized%' or
        ${err} like '%Upstream 408%' or ${err} like '%timeout%' or ${err} like '%timed out%' or
        ${err} like '%context length%' or ${err} like '%context_length%' or ${err} like '%prompt is too long%' or ${err} like '%max_tokens%exceed%' or
        ${err} like '%Upstream 500%' or ${err} like '%Upstream 501%' or ${err} like '%Upstream 502%' or
        ${err} like '%Upstream 503%' or ${err} like '%Upstream 504%' or ${err} like '%Upstream 505%'
      ) then 1 else 0 end)`;
  }
}
