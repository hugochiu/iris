// One-shot backfill for request_logs.preview / tool_calls on rows that
// predate the ingest-time computation. Runs in the background at startup
// in small chunks so a huge payload can't stall request handling.

import { sqlite } from './index.js';
import {
  extractLatestUserPreviewFromBody,
  extractToolCallsFromResponse,
} from '../stats/session-meta.js';

const CHUNK = 50;

interface Row {
  request_id: string;
  request_body: string | null;
  response_body: string | null;
}

export function scheduleBackfillSessionMeta(): void {
  // Rows that have no payload (or whose payload yields nothing) still need
  // to be marked so we don't re-process them forever. Sentinel: empty string /
  // -1 for the message-index column.
  const SENTINEL = '';
  const INDEX_SENTINEL = -1;

  // We use preview_msg_index as the "unprocessed" marker because the original
  // preview/tool_calls pass already ran against existing DBs with non-NULL
  // sentinels. Historical rows still need preview_msg_index filled in for
  // turn-grouping to distinguish identical-text prompts.
  const countRow = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM request_logs WHERE preview_msg_index IS NULL`)
    .get() as { n: number } | undefined;
  const total = countRow?.n ?? 0;
  if (total === 0) return;

  console.log(`[iris] backfilling session-meta for ${total} rows (background)…`);

  const selectChunk = sqlite.prepare<[]>(`
    SELECT l.request_id, p.request_body, p.response_body
    FROM request_logs l
    LEFT JOIN request_payloads p ON p.request_id = l.request_id
    WHERE l.preview_msg_index IS NULL
    LIMIT ${CHUNK}
  `);
  const update = sqlite.prepare(`
    UPDATE request_logs SET preview = ?, tool_calls = ?, preview_msg_index = ? WHERE request_id = ?
  `);

  let processed = 0;
  const tick = () => {
    const rows = selectChunk.all() as Row[];
    if (rows.length === 0) {
      console.log(`[iris] session-meta backfill done (${processed} rows)`);
      return;
    }
    const tx = sqlite.transaction((batch: Row[]) => {
      for (const r of batch) {
        const pv = extractLatestUserPreviewFromBody(r.request_body);
        const preview = pv?.text ?? SENTINEL;
        const msgIndex = pv?.msgIndex ?? INDEX_SENTINEL;
        const calls = extractToolCallsFromResponse(r.response_body);
        const toolCalls = calls ? JSON.stringify(calls) : SENTINEL;
        update.run(preview, toolCalls, msgIndex, r.request_id);
      }
    });
    try {
      tx(rows);
    } catch (err: any) {
      console.error('[iris] session-meta backfill chunk failed:', err.message);
      return;
    }
    processed += rows.length;
    setImmediate(tick);
  };
  setImmediate(tick);
}
