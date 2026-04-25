#!/usr/bin/env bash
# Rebuild request_logs.tool_calls on rows processed under an older MAX_LABEL.
# Re-parses response_body with the current session-meta extractor and
# overwrites tool_calls. Safe to re-run; rows with tool_calls IS NULL or
# tool_calls = '' (sentinel) are skipped.
#
# Usage: ./scripts/rebuild-tool-call-labels.sh [db_path]
#   db_path defaults to ./data/iris.db (or $DB_PATH if set).

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_PATH="${1:-${DB_PATH:-$ROOT/data/iris.db}}"

if [ ! -f "$DB_PATH" ]; then
  echo "[rebuild] db not found: $DB_PATH" >&2
  exit 1
fi

echo "[rebuild] db: $DB_PATH"
cd "$ROOT"
DB_PATH="$DB_PATH" pnpm exec tsx scripts/rebuild-tool-call-labels.ts
