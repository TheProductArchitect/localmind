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

# Cursor (and some CI sandboxes) inject PLAYWRIGHT_BROWSERS_PATH into a
# temporary cache that often has a partial chromium tree but not
# chromium_headless_shell. Prefer the user's real Playwright cache.
DEFAULT_PW_CACHE="${HOME}/Library/Caches/ms-playwright"
if [[ "$(uname -s)" != "Darwin" ]]; then
  DEFAULT_PW_CACHE="${HOME}/.cache/ms-playwright"
fi

need_fallback=0
if [[ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]]; then
  need_fallback=0
elif ! ls "${PLAYWRIGHT_BROWSERS_PATH}"/chromium_headless_shell-*/chrome-headless-shell-*/*/chrome-headless-shell >/dev/null 2>&1 \
  && ! ls "${PLAYWRIGHT_BROWSERS_PATH}"/chromium_headless_shell-*/chrome-headless-shell-*/chrome-headless-shell >/dev/null 2>&1; then
  # Directory may exist with chromium-NNN only — headless shell is what
  # Secure Browser launches. Force the real cache.
  need_fallback=1
fi

if [[ "$need_fallback" -eq 1 ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="$DEFAULT_PW_CACHE"
fi

exec "$BIN"
