import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import * as schema from './schema.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

export const sqlite: DatabaseType = new Database(config.dbPath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });
