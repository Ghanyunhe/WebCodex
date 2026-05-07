#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/runtime"
OUT_LOG="$RUNTIME_DIR/web.out.log"
ERR_LOG="$RUNTIME_DIR/web.err.log"

mkdir -p "$RUNTIME_DIR"
touch "$OUT_LOG" "$ERR_LOG"

tail -n 200 -f "$OUT_LOG" "$ERR_LOG"
