#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/runtime"
PID_FILE="$RUNTIME_DIR/web.pid"
OUT_LOG="$RUNTIME_DIR/web.out.log"
ERR_LOG="$RUNTIME_DIR/web.err.log"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

mkdir -p "$RUNTIME_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$EXISTING_PID" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "codex-web-remote is already running with PID $EXISTING_PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

cd "$ROOT_DIR"
nohup node src/server.js </dev/null >>"$OUT_LOG" 2>>"$ERR_LOG" &
NEW_PID=$!
disown "$NEW_PID" 2>/dev/null || true
echo "$NEW_PID" > "$PID_FILE"

sleep 2
if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "codex-web-remote started with PID $NEW_PID"
  echo "logs: $OUT_LOG"
else
  echo "codex-web-remote failed to start"
  exit 1
fi
