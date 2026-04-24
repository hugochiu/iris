// One-shot backfill for all sessions-page fields on historical request_logs rows.
// Covers: session_id, session_name, preview, tool_calls, preview_msg_index.
//
// Run with: tsx scripts/backfill-session-meta.ts
// DB path defaults to ./data/iris.db (override via DB_PATH env var).

import Database from 'better-sqlite3';
import {
  extractLatestUserPreviewFromBody,
  extractToolCallsFromResponse,
} from '../src/stats/session-meta.js';

const dbPath = process.env.DB_PATH || './data/iris.db';
const sqlite = new Database(dbPath);

// Keep in sync with handler.ts extractFirstUserMessage. Duplicated here so the
// script doesn't have to import from the proxy module (which pulls in HTTP deps).
function stripContextTags(text: string): string {
  return text.replace(
    /<(system-reminder|ide_opened_file|ide_selection|command-[a-z-]+)>[\s\S]*?<\/\1>/gi,
    '',
  );
}

function extractFirstUserMessage(bodyText: string | null): string | null {
  if (!bodyText) return null;
  let body: { messages?: unknown };
  try {
    body = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const messages = body?.messages;
  if (!Array.isArray(messages)) return null;
  const first = messages[0] as { role?: string; content?: unknown } | undefined;
  if (!first || first.role !== 'user') return null;
  const rawTexts: string[] = [];
  if (typeof first.content === 'string') {
    rawTexts.push(first.content);
  } else if (Array.isArray(first.content)) {
    for (const b of first.content as Array<{ type?: string; text?: string }>) {
      if (b?.type === 'text' && typeof b.text === 'string') rawTexts.push(b.text);
    }
  }
  for (const raw of rawTexts) {
    const cleaned = stripContextTags(raw).replace(/\s+/g, ' ').trim();
    if (cleaned) {
      return cleaned.length > 200 ? '…' + cleaned.slice(cleaned.length - 199) : cleaned;
    }
  }
  return null;
}

// ─── stage 1: session_id via SQL (fast, no row-by-row work) ────────────────
const sidCandidates = sqlite
  .prepare(
    `SELECT count(*) AS c FROM request_logs rl
     WHERE rl.session_id IS NULL
       AND EXISTS (SELECT 1 FROM request_payloads rp WHERE rp.request_id = rl.request_id)`,
  )
  .get() as { c: number };

const sidResult = sqlite
  .prepare(
    `UPDATE request_logs
     SET session_id = (
       SELECT json_extract(
         json_extract(rp.request_body, '$.metadata.user_id'),
         '$.session_id'
       )
       FROM request_payloads rp WHERE rp.request_id = request_logs.request_id
     )
     WHERE session_id IS NULL
       AND EXISTS (SELECT 1 FROM request_payloads rp WHERE rp.request_id = request_logs.request_id)`,
  )
  .run();

console.log(`[backfill] session_id: touched ${sidResult.changes} / ${sidCandidates.c} candidates`);

// ─── stage 2: session_name / preview / tool_calls / preview_msg_index ──────
// Sentinels match src/db/backfill-session-meta.ts so the ingest-time code and
// this script agree on "already processed, nothing extractable".
const SENTINEL = '';
const INDEX_SENTINEL = -1;

const metaCandidates = sqlite
  .prepare(
    `SELECT count(*) AS c FROM request_logs
     WHERE session_name IS NULL OR preview_msg_index IS NULL`,
  )
  .get() as { c: number };

console.log(`[backfill] session-meta candidates: ${metaCandidates.c}`);

const CHUNK = 500;

const selectChunk = sqlite.prepare<[number, number]>(`
  SELECT l.id, l.session_name, l.preview_msg_index, p.request_body, p.response_body
  FROM request_logs l
  LEFT JOIN request_payloads p ON p.request_id = l.request_id
  WHERE l.id > ?
    AND (l.session_name IS NULL OR l.preview_msg_index IS NULL)
  ORDER BY l.id
  LIMIT ?
`);

const updateName = sqlite.prepare(
  `UPDATE request_logs SET session_name = ? WHERE id = ? AND session_name IS NULL`,
);

const updateMeta = sqlite.prepare(
  `UPDATE request_logs
   SET preview = ?, tool_calls = ?, preview_msg_index = ?
   WHERE id = ? AND preview_msg_index IS NULL`,
);

interface ChunkRow {
  id: number;
  session_name: string | null;
  preview_msg_index: number | null;
  request_body: string | null;
  response_body: string | null;
}

let lastId = 0;
let scanned = 0;
let nameUpdates = 0;
let metaUpdates = 0;

const tx = sqlite.transaction((rows: ChunkRow[]) => {
  for (const r of rows) {
    if (r.session_name == null) {
      const name = extractFirstUserMessage(r.request_body);
      if (name != null) {
        updateName.run(name, r.id);
        nameUpdates++;
      }
    }
    if (r.preview_msg_index == null) {
      const pv = extractLatestUserPreviewFromBody(r.request_body);
      const preview = pv?.text ?? SENTINEL;
      const msgIndex = pv?.msgIndex ?? INDEX_SENTINEL;
      const calls = extractToolCallsFromResponse(r.response_body);
      const toolCalls = calls ? JSON.stringify(calls) : SENTINEL;
      updateMeta.run(preview, toolCalls, msgIndex, r.id);
      metaUpdates++;
    }
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
      `[backfill] session-meta: scanned ${scanned} (id ≤ ${lastId}), ` +
        `name=${nameUpdates} meta=${metaUpdates}`,
    );
  }
}

console.log(
  `[backfill] session-meta done: scanned ${scanned}, name updates=${nameUpdates}, meta updates=${metaUpdates}`,
);

// ─── final stats ───────────────────────────────────────────────────────────
const final = sqlite
  .prepare(
    `SELECT
       count(*) AS total,
       count(session_id) AS sid,
       count(session_name) AS sname,
       count(preview) AS pv,
       count(tool_calls) AS tc,
       count(preview_msg_index) AS pmi
     FROM request_logs`,
  )
  .get() as {
  total: number;
  sid: number;
  sname: number;
  pv: number;
  tc: number;
  pmi: number;
};

console.log(`[backfill] populated (non-NULL) / total:`);
console.log(`  session_id:         ${final.sid} / ${final.total}`);
console.log(`  session_name:       ${final.sname} / ${final.total}`);
console.log(`  preview:            ${final.pv} / ${final.total}`);
console.log(`  tool_calls:         ${final.tc} / ${final.total}`);
console.log(`  preview_msg_index:  ${final.pmi} / ${final.total}`);

sqlite.close();
