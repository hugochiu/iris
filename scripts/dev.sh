#!/usr/bin/env bash
# Launch backend (Hono on :3000) and frontend (Vite dev on :5173) in parallel.
# Ctrl+C stops both.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
  echo ""
  echo "[dev] shutting down..."
  kill $(jobs -p) 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[dev] backend  → http://localhost:3000"
(cd "$ROOT" && pnpm dev:back) &

echo "[dev] frontend → http://localhost:5173"
(cd "$ROOT/frontend" && pnpm dev) &

wait
