#!/usr/bin/env bash
# LocalMind desktop launcher (desktop icon / autostart entry point).
#
# Runs the PRODUCTION build. The dev server (`next dev`) recompiles thousands of
# modules on navigation and ships unminified React, which is what made the app
# feel hung once a chat started. Pass --dev to force dev mode for debugging.
#
# Deliberately no `set -u`: sourcing nvm.sh trips unbound-variable errors and
# would abort the launcher before it can even write to its log.
set -o pipefail

REPO_DIR="/home/venu/Documents/Github/LocalMind/localmind"
LOG_DIR="$HOME/.localmind"
PORT="${LM_APP_PORT:-3000}"
DEV_MODE=0
[ "${1:-}" = "--dev" ] && DEV_MODE=1

# --- Node environment (GUI launches do not inherit the shell's nvm setup) ---
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh" --no-use >/dev/null 2>&1
  nvm use --lts >/dev/null 2>&1 || nvm use node >/dev/null 2>&1 || true
fi
if ! command -v node >/dev/null 2>&1; then
  # Highest installed nvm version wins when nvm itself is unavailable.
  for candidate in $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V -r); do
    if [ -x "$candidate/node" ]; then export PATH="$candidate:$PATH"; break; fi
  done
fi

cd "$REPO_DIR" || exit 1
mkdir -p "$LOG_DIR"
exec >> "$LOG_DIR/launcher.log" 2>&1
echo "--- LocalMind launch $(date) (dev=$DEV_MODE) ---"

if ! command -v node >/dev/null 2>&1; then
  echo "FATAL: node not found on PATH"
  command -v notify-send >/dev/null && notify-send "LocalMind" "Node.js not found — cannot start."
  exit 1
fi
echo "node $(node -v)"

if [ "$DEV_MODE" = "1" ]; then
  export LM_APP_URL="http://localhost:3001"
  if ! curl -sf -m 1 "$LM_APP_URL" >/dev/null 2>&1; then
    echo "Starting dev server on 3001..."
    nohup npm run dev > "$LOG_DIR/dev-server.log" 2>&1 &
    for _ in $(seq 1 60); do
      curl -sf -m 1 "$LM_APP_URL" >/dev/null 2>&1 && break
      sleep 0.5
    done
  fi
else
  # Reuse an already-running server (PM2 / systemd); otherwise build once and
  # let Electron own the `next start` lifecycle so closing the app stops it.
  if curl -sf -m 1 "http://localhost:$PORT" >/dev/null 2>&1; then
    echo "Reusing server already listening on $PORT."
    export LM_APP_URL="http://localhost:$PORT"
  elif [ ! -f ".next/BUILD_ID" ]; then
    echo "No production build — building (one-time, several minutes)..."
    command -v notify-send >/dev/null && \
      notify-send "LocalMind" "First launch: building the app. The window will open when it's ready." || true
    if ! npm run build; then
      echo "FATAL: production build failed"
      command -v notify-send >/dev/null && notify-send "LocalMind" "Build failed — see ~/.localmind/launcher.log"
      exit 1
    fi
  fi
fi

# Reminders/automations need a scheduler; standalone `next start` has no
# worker.js process, so run it in-process.
export LOCALMIND_IN_PROCESS_SCHEDULER=1
export LM_APP_PORT="$PORT"

echo "Launching Electron shell..."
# --no-sandbox: the bundled chrome-sandbox helper is not setuid-root in a
# plain npm install, and Electron refuses to start without one or the other.
exec env -u ELECTRON_RUN_AS_NODE npx electron --no-sandbox electron/main.js
