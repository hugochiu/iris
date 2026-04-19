#!/usr/bin/env bash
# Build frontend for production, then start backend which serves frontend/dist.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[build] building frontend..."
(cd "$ROOT/frontend" && pnpm build)

echo "[build] starting backend on :3000"
exec pnpm --dir "$ROOT" start
