# Iris

**A Claude Code → OpenRouter proxy with a cost-aware dashboard.**

Forward requests from Claude Code (or any Anthropic Messages API client) to OpenRouter, while recording every call's **tokens, actual cost, latency, and full payload** to SQLite. A browser dashboard shows you exactly where every cent goes.

[中文 README](./README.md)

![license](https://img.shields.io/badge/license-ISC-blue.svg)
![node](https://img.shields.io/badge/node-%E2%89%A520-green.svg)

## Why Iris

There are plenty of Claude-to-OpenAI-compatible proxies out there. Iris has exactly one differentiator: **it knows how much each call actually cost you.**

OpenRouter exposes a `usage.cost` field in its SSE response with the **real billed amount** — not a token-price estimate, the actual charge. Iris extracts this field into the database, so the dashboard can answer:

- How much have I spent today / this week / this month?
- Which model is burning the most money?
- Which single call was the most expensive, and was it input- or output-heavy?
- Cross-model comparison of real cost per million tokens

If you run a lot of Claude Code agent loops and care about where the money goes, this project is for you.

## Features

- **Messages API proxy** — Anthropic-compatible `POST /v1/messages`, both streaming and non-streaming
- **Model routing** — requests matching `opus` / `sonnet` / `haiku` can be remapped from the dashboard to any OpenRouter model (e.g. send Claude Code's Opus traffic to DeepSeek, GLM-4.6, or anything else on OpenRouter) — no client-side config changes
- **Multi-upstream switching** — configure a second upstream via `OPENROUTER_ALT_*` (official key / relay key / self-hosted gateway) and swap between them from the dashboard without touching env vars
- **Provider allowlist** — pin OpenRouter to specific providers (e.g. DeepInfra only, skip Novita) to dodge quality issues with specific providers
- **Full logging** — request headers / body, response headers / body, token usage, and cost all land in SQLite
- **Dashboard** — 6 tabs:
  - **Overview** — total spend, request count, token usage, time-bucketed trends
  - **Sessions** — aggregated per Claude Code session; see exactly how much each agent loop cost
  - **Logs** — detail list + per-request payload panel
  - **Models** — per-model aggregation of cost / tokens / call count
  - **Cache** — cache hit ratio, cache-read / cache-write cost breakdown
  - **Settings** — model routing, provider allowlist, upstream switching
- **Time ranges** — today / 24h / 7d / 30d / all (global filter)

## Stack

- **Backend** — Hono + `@hono/node-server` + better-sqlite3 + Drizzle ORM, running TypeScript directly via tsx
- **Frontend** — React 19 + Vite + Tailwind CSS + TanStack Query + Recharts

## Quick start

Requires Node.js ≥ 20 and pnpm.

```bash
git clone https://github.com/hugochiu/iris.git
cd iris
pnpm bootstrap                   # install deps + create .env + init DB

# Put your OpenRouter key in your shell profile (not in .env)
echo 'export OPENROUTER_API_KEY=sk-or-...' >> ~/.zshrc && source ~/.zshrc

pnpm dev                         # start both backend and frontend
```

After startup:

- Backend proxy: http://localhost:3000
- Dashboard (dev): http://localhost:5173

For production, run `pnpm serve` — the frontend is built and served by the backend from `/`, on a single port (:3000).

## Configuration

`.env` fields (see [.env.example](.env.example)):

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | **required** | Primary upstream API key. **Read from the system environment** — do not put it in `.env` (avoids accidental leaks) |
| `PORT` | `3000` | Proxy listen port |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Primary upstream URL |
| `OPENROUTER_NAME` | `Primary` | Display name for the primary upstream in the dashboard |
| `OPENROUTER_ALT_API_KEY` | — | Alt upstream key (optional; only active when `ALT_BASE_URL` is also set) |
| `OPENROUTER_ALT_BASE_URL` | — | Alt upstream URL (optional; e.g. a relay or self-hosted gateway) |
| `OPENROUTER_ALT_NAME` | `Alt` | Display name for the alt upstream |
| `DEFAULT_MODEL` | `anthropic/claude-opus-4.6` | Default model when the client does not specify one |
| `DB_PATH` | `./data/iris.db` | SQLite database path |
| `LOG_PAYLOADS` | `true` | Whether to record full request / response payloads (disable if they're too large) |

> Only the OpenRouter official upstream returns a `usage.cost` field. If the alt upstream is some other OpenAI-compatible gateway, the dashboard can still count tokens but `cost` will be empty.

## Usage

### Point Claude Code at the proxy

Set env vars to route Claude Code through Iris:

```bash
export ANTHROPIC_BASE_URL=http://localhost:3000
# ANTHROPIC_API_KEY can be anything — the proxy uses its own OPENROUTER_API_KEY upstream
claude
```

### Direct call

```bash
curl http://localhost:3000/v1/messages \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-opus-4-7",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### Model routing

If the request's `model` field contains `opus`, `sonnet`, or `haiku`, it gets rewritten to whatever you've configured on the Settings page. For example, with `opus → deepseek/deepseek-v3.2-exp`, every `claude-opus-*` request runs on DeepSeek instead.

Without a mapping, the default behavior applies: model names containing `/` (e.g. `openai/gpt-4o`) pass through as-is, and bare names get an automatic `anthropic/` prefix.

## Development

| Command | What it does |
|---|---|
| `pnpm bootstrap` | First-time install (deps + .env + init DB) |
| `pnpm dev` | Dev mode: backend (:3000, `tsx watch` hot reload) + frontend (:5173, vite HMR) |
| `pnpm dev:back` | Backend only |
| `pnpm serve` | Production: frontend built and served by backend from `/` (single port :3000) |

In dev mode the frontend proxies `/api/*` to :3000 via Vite, so you only need to visit :5173.

### Schema migrations

Schema changes are reconciled at startup by idempotent logic: `request_logs` is handled by `migrateRequestLogs()` in [src/index.ts](src/index.ts) (create-new-table → copy-data → drop-old), and other tables / indexes are guaranteed by `CREATE TABLE IF NOT EXISTS` / `ensureColumn` in [src/db/index.ts](src/db/index.ts).

**Do not use `drizzle-kit push`** — see [CLAUDE.md](CLAUDE.md) for the reasoning.

### After pulling code

After `git pull`, if `package.json` changed, the easiest path is to re-run `pnpm bootstrap` — every step is idempotent (already-installed deps are skipped, existing `.env` is not overwritten). Schema needs no manual action; it self-aligns at startup.

If you only want to update deps:

```bash
pnpm install && (cd frontend && pnpm install)
```

Note: `pnpm dev` itself does **not** install or check deps — if deps change and you skip the install, you'll hit `Cannot find module`.

## Project structure

```
src/
  index.ts                   # Hono entry, route registration + static serving + startup migration
  config.ts                  # Env var parsing, primary/alt upstream assembly
  upstream.ts                # Active-upstream read/write (active state lives in DB)
  proxy/handler.ts           # /v1/messages proxy, streaming parser, model routing, log capture
  stats/                     # Dashboard stats API
    summary.ts               #   Totals (cost, tokens, request count)
    timeseries.ts            #   Time-bucketed trends
    by-model.ts              #   Per-model aggregation
    logs.ts                  #   Request list + single-log detail
    sessions.ts              #   Per-session aggregation + detail
    session-meta.ts          #   Extract preview / tool calls from messages
    errors.ts, range.ts      #   Error classification, time-range parsing
    settings.ts              #   Read/write API for model mapping / provider routing / upstream
  db/
    index.ts                 #   better-sqlite3 + startup invariants (CREATE TABLE / ensureColumn)
    schema.ts                #   Drizzle schema (for ORM type inference)
    logger.ts                #   Writes to request_logs / request_payloads
    settings.ts              #   KV-style settings table (model map, provider routing, active upstream)
    backfill-session-meta.ts #   Background backfill for session_name / preview / tool_calls on old rows
frontend/
  src/
    App.tsx                  # Main layout + tab switching + URL state
    pages/
      overview.tsx           #   Totals + trend chart
      sessions.tsx           #   Session list
      session-detail.tsx     #   Request sequence for a single session
      logs.tsx               #   Request details
      by-model.tsx           #   Per-model aggregation
      cache.tsx              #   Cache hit ratio / cache cost
      settings.tsx           #   Model map / provider / upstream switch
    components/              # metric-card, json-tree, log-detail, range-picker, etc.
    lib/api.ts               # Frontend API client
scripts/
  setup.sh                   # First-time install
  dev.sh                     # Parallel dev-mode launcher
  build.sh                   # Production build + launch
  backfill-session-meta.sh   # Manually trigger session metadata backfill
  rebuild-tool-call-labels.sh # Rebuild tool-call labels on historical logs
data/                        # SQLite database (gitignored)
```

## FAQ

**Can I plug in another OpenAI / Anthropic-compatible upstream (relay, self-hosted gateway, direct-to-official)?**

Yes — put the URL and key in `OPENROUTER_ALT_*` and you can switch upstreams from the Settings page. But the dashboard's cost field depends on OpenRouter's proprietary `usage.cost` — on any other upstream, tokens and latency still work, but spend will be empty.

**Can I make Claude Code's Opus requests run on DeepSeek / GLM / some cheaper model?**

Yes. On the Settings page, change the `opus` target to the OpenRouter model id you want (e.g. `deepseek/deepseek-v3.2-exp`) — no changes needed on the Claude Code side. `sonnet` / `haiku` work the same way.

**Will the database get huge?**

With `LOG_PAYLOADS=true` (the default), full request/response bodies are stored, which grows fast on long conversations or large contexts. Turn it off to keep only metadata (tokens, cost, latency).

**Can it be multi-user?**

No. This is a single-machine, single-user tool with no auth. Don't expose it to the public internet.

## License

ISC
