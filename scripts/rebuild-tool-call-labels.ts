// One-shot rebuild of request_logs.tool_calls for rows that were already
// processed under a smaller MAX_LABEL. Re-parses response_body with the
// current session-meta extractor and overwrites tool_calls.
//
// Only touches rows where tool_calls is a non-empty JSON string (i.e. an
// earlier backfill/ingest already populated it). Rows with tool_calls = ''
// (sentinel for "response had no tool_use") and tool_calls IS NULL (never
// processed — handled by scripts/backfill-session-meta.ts) are skipped.
//
// Run with: tsx scripts/rebuild-tool-call-labels.ts
// DB path defaults to ./data/iris.db (override via DB_PATH env var).

import Database from 'better-sqlite3';
import { extractToolCallsFromResponse } from '../src/stats/session-meta.js';

const dbPath = process.env.DB_PATH || './data/iris.db';
const sqlite = new Database(dbPath);
sqlite.pragma('busy_timeout = 10000');

const candidates = sqlite
  .prepare(
    `SELECT count(*) AS c FROM request_logs
     WHERE tool_calls IS NOT NULL AND tool_calls != ''`,
  )
  .get() as { c: number };

console.log(`[rebuild] tool_calls candidates: ${candidates.c}`);
if (candidates.c === 0) {
  sqlite.close();
  process.exit(0);
}

const CHUNK = 500;

const selectChunk = sqlite.prepare<[number, number]>(`
  SELECT l.id, l.tool_calls, p.response_body
  FROM request_logs l
  LEFT JOIN request_payloads p ON p.request_id = l.request_id
  WHERE l.id > ?
    AND l.tool_calls IS NOT NULL AND l.tool_calls != ''
  ORDER BY l.id
  LIMIT ?
`);

const update = sqlite.prepare(`UPDATE request_logs SET tool_calls = ? WHERE id = ?`);

interface ChunkRow {
  id: number;
  tool_calls: string;
  response_body: string | null;
}

let lastId = 0;
let scanned = 0;
let changed = 0;
let cleared = 0;
let unchanged = 0;

const tx = sqlite.transaction((rows: ChunkRow[]) => {
  for (const r of rows) {
    const calls = extractToolCallsFromResponse(r.response_body);
    const next = calls ? JSON.stringify(calls) : '';
    if (next === r.tool_calls) {
      unchanged++;
      continue;
    }
    update.run(next, r.id);
    if (next === '') cleared++;
    else changed++;
  }
});

while (true) {
  const rows = selectChunk.all(lastId, CHUNK) as ChunkRow[];
  if (rows.length === 0) break;
  tx(rows);
  lastId = rows[rows.length - 1].id;
  scanned += rows.length;
  if (scanned % 5000 === 0 || rows.length < CHUNK) {
    console.log(
      `[rebuild] scanned ${scanned} (id ≤ ${lastId}), changed=${changed} cleared=${cleared} unchanged=${unchanged}`,
    );
  }
}

console.log(
  `[rebuild] done: scanned ${scanned}, changed=${changed}, cleared=${cleared}, unchanged=${unchanged}`,
);

sqlite.close();
