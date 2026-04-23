import Database from 'better-sqlite3';

const dbPath = process.env.DB_PATH || './data/iris.db';
const sqlite = new Database(dbPath);

const total = sqlite.prepare('SELECT count(*) AS c FROM request_logs').get() as { c: number };
const candidates = sqlite
  .prepare(
    `SELECT count(*) AS c
     FROM request_logs rl
     WHERE rl.session_id IS NULL
       AND EXISTS (SELECT 1 FROM request_payloads rp WHERE rp.request_id = rl.request_id)`,
  )
  .get() as { c: number };

const result = sqlite
  .prepare(
    `UPDATE request_logs
     SET session_id = (
       SELECT json_extract(
         json_extract(rp.request_body, '$.metadata.user_id'),
         '$.session_id'
       )
       FROM request_payloads rp
       WHERE rp.request_id = request_logs.request_id
     )
     WHERE session_id IS NULL
       AND EXISTS (
         SELECT 1 FROM request_payloads rp WHERE rp.request_id = request_logs.request_id
       )`,
  )
  .run();

const populated = sqlite
  .prepare('SELECT count(session_id) AS c FROM request_logs')
  .get() as { c: number };

console.log(
  `[backfill] touched ${result.changes} rows (of ${candidates.c} candidates with payload); ` +
    `session_id populated on ${populated.c} / ${total.c} total rows`,
);

sqlite.close();
