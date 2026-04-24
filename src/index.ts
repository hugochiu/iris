import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { config } from './config.js';
import { proxyHandler, setLogCallback, setPayloadCallback } from './proxy/handler.js';
import { db, sqlite } from './db/index.js';
import { logRequest, logPayload } from './db/logger.js';
import { statsRoutes } from './stats/index.js';

const TARGET_CREATE_SQL = `CREATE TABLE request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  session_id TEXT,
  model TEXT NOT NULL,
  provider TEXT,
  real_model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost REAL,
  cache_read_input_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  duration_ms INTEGER NOT NULL,
  ttft_ms INTEGER,
  tpot_ms REAL,
  status TEXT NOT NULL,
  error_message TEXT,
  has_tool_use INTEGER DEFAULT 0,
  stop_reason TEXT,
  session_name TEXT
)`;

const TARGET_COLUMNS = [
  'id', 'request_id', 'timestamp', 'session_id', 'model', 'provider', 'real_model',
  'input_tokens', 'output_tokens', 'total_tokens', 'cost',
  'cache_read_input_tokens', 'cache_creation_input_tokens',
  'duration_ms', 'ttft_ms', 'tpot_ms',
  'status', 'error_message', 'has_tool_use', 'stop_reason', 'session_name',
];

function migrateRequestLogs() {
  const tableExists = sqlite.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='request_logs'`,
  ).get();

  if (!tableExists) {
    sqlite.exec(TARGET_CREATE_SQL);
    return;
  }

  const columns = sqlite.prepare(`PRAGMA table_info(request_logs)`).all() as { name: string }[];
  const colNames = columns.map(c => c.name);

  const matches = colNames.length === TARGET_COLUMNS.length
    && colNames.every((name, i) => name === TARGET_COLUMNS[i]);

  if (matches) return;

  // Old schema had anthropic_model (original request model) and model (response model).
  // New schema renames them: anthropic_model -> model, model -> real_model.
  const hasLegacyAnthropicCol = colNames.includes('anthropic_model');

  const targetToSource: Record<string, string> = {};
  for (const target of TARGET_COLUMNS) {
    if (target === 'model' && hasLegacyAnthropicCol) {
      targetToSource[target] = 'COALESCE(anthropic_model, model)';
    } else if (target === 'real_model' && hasLegacyAnthropicCol && colNames.includes('model')) {
      targetToSource[target] = 'model';
    } else if (colNames.includes(target)) {
      targetToSource[target] = target;
    }
  }

  const targetCols = Object.keys(targetToSource).join(', ');
  const sourceCols = Object.values(targetToSource).join(', ');

  sqlite.exec(`ALTER TABLE request_logs RENAME TO _request_logs_old`);
  sqlite.exec(TARGET_CREATE_SQL);
  sqlite.exec(`INSERT INTO request_logs (${targetCols}) SELECT ${sourceCols} FROM _request_logs_old`);
  sqlite.exec(`DROP TABLE _request_logs_old`);
}

migrateRequestLogs();

sqlite.exec(`CREATE TABLE IF NOT EXISTS request_payloads (
  request_id TEXT PRIMARY KEY,
  request_headers TEXT,
  forwarded_headers TEXT,
  request_body TEXT,
  response_headers TEXT,
  response_body TEXT
)`);

for (const col of ['request_headers', 'forwarded_headers', 'response_headers']) {
  try {
    sqlite.exec(`ALTER TABLE request_payloads ADD COLUMN ${col} TEXT`);
  } catch {}
}

setLogCallback(logRequest);
if (config.logPayloads) {
  setPayloadCallback(logPayload);
}

const app = new Hono();

app.get('/health', (c) => c.json({ status: 'ok' }));
app.post('/v1/messages', proxyHandler);
app.route('/api', statsRoutes);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontendDist = resolve(repoRoot, 'frontend/dist');

if (existsSync(frontendDist)) {
  app.use('/*', serveStatic({ root: frontendDist }));
  const indexHtmlPath = resolve(frontendDist, 'index.html');
  const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, 'utf-8') : null;
  if (indexHtml) {
    app.get('*', (c) => c.html(indexHtml));
  }
  console.log(`[iris] dashboard UI enabled at /`);
} else {
  console.warn('[iris] frontend/dist not found — run `cd frontend && pnpm build` to enable the dashboard UI');
}

console.log(`[iris] proxy listening on http://localhost:${config.port}`);

serve({ fetch: app.fetch, port: config.port });
