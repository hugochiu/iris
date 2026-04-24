#!/usr/bin/env bash
# Backfill sessions-page fields (session_id / session_name / preview /
# tool_calls / preview_msg_index) on historical request_logs rows.
# Safe to re-run; idempotent via sentinels.
#
# Usage: ./scripts/backfill-session-meta.sh [db_path]
#   db_path defaults to ./data/iris.db (or $DB_PATH if set).

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${1:-${DB_PATH:-$ROOT/data/iris.db}}"

if [ ! -f "$DB_PATH" ]; then
  echo "[backfill] db not found: $DB_PATH" >&2
  exit 1
fi

echo "[backfill] db: $DB_PATH"
cd "$ROOT"
DB_PATH="$DB_PATH" pnpm exec tsx scripts/backfill-session-meta.ts
