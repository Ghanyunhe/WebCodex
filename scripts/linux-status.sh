#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/runtime/web.pid"
PORT="${PORT:-8787}"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "codex-web-remote is running with PID $PID"
    if command -v curl >/dev/null 2>&1; then
      echo "health: $(curl -fsS "http://127.0.0.1:${PORT}/healthz" || echo unavailable)"
    fi
    exit 0
  fi
fi

echo "codex-web-remote is not running"
exit 1
