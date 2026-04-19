#!/usr/bin/env bash
# First-time setup on a new machine.
# Installs deps, creates .env if missing, initializes the SQLite database.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "[setup] pnpm not found. Install it first: npm i -g pnpm"
  exit 1
fi

echo "[setup] installing backend deps..."
pnpm install

echo "[setup] installing frontend deps..."
(cd frontend && pnpm install)

if [ ! -f .env ]; then
  echo "[setup] creating .env from .env.example"
  cp .env.example .env
fi

mkdir -p data

echo "[setup] initializing database schema..."
pnpm db:push

echo ""
echo "[setup] done. next steps:"
echo "  1. export OPENROUTER_API_KEY in your shell profile (~/.zshrc / ~/.bashrc)"
echo "     e.g.  echo 'export OPENROUTER_API_KEY=sk-or-...' >> ~/.zshrc"
echo "  2. run 'pnpm dev'    for dev mode (backend :3000 + vite :5173)"
echo "     or 'pnpm serve'   for production mode (build + serve on :3000)"
