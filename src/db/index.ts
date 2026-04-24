import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const sqlite: DatabaseType = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');

// Idempotent guards for schema features that drizzle-kit push can't reliably apply
// (e.g. add column + add index in one batch). Safe to re-run on every startup.
ensureColumn('request_logs', 'session_id', 'TEXT');
ensureColumn('request_logs', 'session_name', 'TEXT');
sqlite.exec(
  `CREATE INDEX IF NOT EXISTS request_logs_session_ts_idx ON request_logs(session_id, timestamp);`,
);

function ensureColumn(table: string, column: string, type: string): void {
  const cols = sqlite.prepare(`PRAGMA table_info(${table});`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
  console.log(`[iris] added column ${table}.${column}`);
}

export const db = drizzle(sqlite, { schema });
