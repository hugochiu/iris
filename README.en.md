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
- **Automatic model mapping** — unprefixed model names (e.g. `claude-opus-4-7`) are auto-prefixed to `anthropic/claude-opus-4-7`
- **Full logging** — request headers / body, response headers / body, token usage, and cost all land in SQLite
- **Dashboard** — Overview (summary) / Logs (details) / Models (per-model aggregation), with 24h / 7d / 30d / all time ranges
- **Log detail panel** — full payload view for each call; user message text blocks are expanded by default

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
| `OPENROUTER_API_KEY` | **required** | OpenRouter API key. **Read from system environment variable** — do not put it in `.env` (avoids accidental leaks) |
| `PORT` | `3000` | Proxy listen port |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Upstream OpenRouter URL |
| `DEFAULT_MODEL` | `anthropic/claude-opus-4.6` | Default model when the client does not specify one |
| `DB_PATH` | `./data/iris.db` | SQLite database path |
| `LOG_PAYLOADS` | `true` | Whether to record full request / response payloads (disable if they're too large) |

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

## Development

| Command | What it does |
|---|---|
| `pnpm bootstrap` | First-time install (deps + .env + init DB) |
| `pnpm dev` | Dev mode: backend (:3000, `tsx watch` hot reload) + frontend (:5173, vite HMR) |
| `pnpm dev:back` | Backend only |
| `pnpm serve` | Production: frontend built and served by backend from `/` (single port :3000) |
| `pnpm db:push` | Apply Drizzle schema changes |

In dev mode the frontend proxies `/api/*` to :3000 via Vite, so you only need to visit :5173.

## Project structure

```
src/
  index.ts              # Hono entry, route registration + frontend static serving
  config.ts             # Environment variable parsing
  proxy/handler.ts      # /v1/messages proxy, streaming response parser, log capture
  stats/                # Dashboard stats API (summary / timeseries / by-model / logs)
  db/                   # Drizzle schema + logger
frontend/
  src/
    App.tsx             # Main layout + tab switching
    pages/              # Overview / Logs / ByModel
    components/         # metric-card, json-tree, log-detail, etc.
    hooks/use-stats.ts  # React Query wrappers
    lib/api.ts          # Frontend API client
scripts/
  setup.sh              # First-time install
  dev.sh                # Parallel dev-mode launcher
  build.sh              # Production build + launch
data/                   # SQLite database (gitignored)
```

## FAQ

**Can I use this with DeepSeek / Groq / ollama or other OpenAI-compatible upstreams?**

The proxy layer can, but the dashboard's cost field will be empty — it depends on OpenRouter's proprietary `usage.cost` in the response. Other upstreams only return token counts, so you'll see token usage but not actual spend. That's why Iris currently targets OpenRouter specifically.

**Will the database get huge?**

With `LOG_PAYLOADS=true` (the default), full request/response bodies are stored, which grows fast on long conversations or large contexts. Turn it off to keep only metadata (tokens, cost, latency).

**Can it be multi-user?**

No. This is a single-machine, single-user tool with no auth. Don't expose it to the public internet.

## License

ISC
