#!/usr/bin/env bash
# One-time setup. Creates the venv, installs the package + chromium.
# Run this BEFORE LocalMind tries to spawn the MCP server — it does heavy
# network I/O (pip, playwright), which the MCP outbound proxy would block
# if invoked from a spawned MCP child.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="$HERE/.venv"

# Phase markers the UI parses to drive a progress bar. Each line starts with
# `[step]` (advance) or `[error]` (surface red); the streaming endpoint
# forwards them verbatim. Keep the names stable — the client side reads them.
step() { echo "[step] $1"; }
fail() { echo "[error] $1" >&2; exit 1; }

if ! command -v python3 >/dev/null 2>&1; then
  fail "python3 not found on PATH. Install Python 3.10+ and retry."
fi

step "creating-venv"
if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV" || fail "could not create venv at $VENV"
fi

step "upgrading-pip"
"$VENV/bin/pip" install --upgrade pip || fail "pip upgrade failed"

step "installing-deps"
"$VENV/bin/pip" install -e "$HERE" || fail "pip install -e failed"

step "installing-chromium"
"$VENV/bin/python" -m playwright install chromium || fail "playwright chromium install failed"

step "done"
echo "[secure-browser-mcp] bootstrap complete: $VENV"
