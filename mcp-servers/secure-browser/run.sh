#!/usr/bin/env bash
# MCP launcher. Must be fast — the MCP host treats slow startup or any non-
# zero exit as "Connection closed". All network work (pip, playwright) lives
# in bootstrap.sh; this script only exec's the already-installed server.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="$HERE/.venv"
BIN="$VENV/bin/secure-browser-mcp"

if [ ! -x "$BIN" ]; then
  echo "[secure-browser-mcp] not bootstrapped yet. Run: $HERE/bootstrap.sh" >&2
  exit 127
fi

exec "$BIN"
