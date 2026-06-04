#!/usr/bin/env bash
# Shared Linux installer body. Sourced by ubuntu.sh / debian.sh / wsl2.sh.
# Variables expected from the caller:
#   SRC_DIR          — directory of the source checkout
#   STARTUP_MODE     — "systemd" or "bashrc"
#   POST_NOTIFY_CMD  — final notification command (optional)
set -euo pipefail

LOG_DIR="$HOME/.localmind"
LOG="$LOG_DIR/install.log"
APP_DIR="$HOME/LocalMind"

mkdir -p "$LOG_DIR"
echo "LocalMind install started $(date)" > "$LOG"

say()  { echo "$1"; echo "$1" >> "$LOG"; }
fail() { say "❌ $1"; say "   What you can try: $2"; exit 1; }

need_sudo() {
  if [[ $EUID -eq 0 ]]; then "$@"; else sudo "$@"; fi
}

# 1. Node.js LTS via NodeSource
if ! command -v node >/dev/null 2>&1; then
  say "🟢 Installing Node.js (LTS)..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x -o /tmp/nodesource.sh >> "$LOG" 2>&1 \
    || fail "Could not download NodeSource setup script." "Check your internet connection."
  need_sudo -E bash /tmp/nodesource.sh >> "$LOG" 2>&1 || fail "NodeSource setup failed." "See $LOG."
  need_sudo apt-get install -y nodejs >> "$LOG" 2>&1 || fail "Node.js installation failed." "See $LOG."
else
  say "🟢 Node.js already installed ($(node -v))."
fi

# 2. Ollama
if ! command -v ollama >/dev/null 2>&1; then
  say "🧠 Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh >> "$LOG" 2>&1 \
    || fail "Ollama installation failed." "Run 'curl -fsSL https://ollama.com/install.sh | sh' manually."
else
  say "🧠 Ollama already installed."
fi
# Start the daemon if not already running (skip on WSL2 — handled separately).
if [[ "${STARTUP_MODE}" == "systemd" ]] && command -v systemctl >/dev/null 2>&1; then
  systemctl --user start ollama >/dev/null 2>&1 || ollama serve >> "$LOG" 2>&1 &
else
  pgrep -x ollama >/dev/null || ollama serve >> "$LOG" 2>&1 &
fi

# 3. PM2
if ! command -v pm2 >/dev/null 2>&1; then
  say "⚙️  Installing PM2..."
  need_sudo npm install -g pm2 >> "$LOG" 2>&1 || fail "PM2 installation failed." "Run 'sudo npm install -g pm2' manually."
else
  say "⚙️  PM2 already installed."
fi

# 3b. pi-coding-agent (https://pi.dev) — wraps as the `pi_code` agent tool.
if ! command -v pi >/dev/null 2>&1; then
  say "🥧  Installing pi-coding-agent..."
  need_sudo npm install -g --ignore-scripts @earendil-works/pi-coding-agent >> "$LOG" 2>&1 \
    || say "⚠️  pi-coding-agent install failed — pi_code agent tool will surface a clear setup error until you re-run install."
else
  say "🥧  pi-coding-agent already installed."
fi

# 3c. Voice: ffmpeg from apt is always available; whisper.cpp ships no
# apt package, so we build from source via cmake. Skip both if cmake is
# unavailable — the STT route will surface a clear error.
if ! command -v ffmpeg >/dev/null 2>&1; then
  say "🎬 Installing ffmpeg..."
  need_sudo apt-get install -y ffmpeg >> "$LOG" 2>&1 \
    || say "⚠️  ffmpeg install failed — voice features will surface a clear error."
fi
if ! command -v whisper-cli >/dev/null 2>&1; then
  if command -v cmake >/dev/null 2>&1 && command -v g++ >/dev/null 2>&1; then
    say "🎙️  Building whisper.cpp from source (~3 minutes)..."
    BUILD_DIR="/tmp/whisper-cpp-build"
    rm -rf "$BUILD_DIR"
    git clone --depth 1 https://github.com/ggerganov/whisper.cpp.git "$BUILD_DIR" >> "$LOG" 2>&1 \
      && ( cd "$BUILD_DIR" && cmake -B build >> "$LOG" 2>&1 && cmake --build build --config Release -j >> "$LOG" 2>&1 \
        && need_sudo cp "build/bin/whisper-cli" /usr/local/bin/whisper-cli >> "$LOG" 2>&1 ) \
      && say "✅ whisper.cpp built and installed." \
      || say "⚠️  whisper.cpp build failed — voice features will surface a clear error. See $LOG."
  else
    say "⚠️  cmake or g++ not available — skipping whisper.cpp. Install build-essential cmake and re-run."
  fi
fi

# 3d. Whisper model — base.en is ~150MB and balances speed/quality.
MODELS_DIR="$LOG_DIR/models"
WHISPER_MODEL="$MODELS_DIR/ggml-base.en.bin"
if [ ! -f "$WHISPER_MODEL" ]; then
  say "🧠 Downloading Whisper base.en model (~150MB, one-time)..."
  mkdir -p "$MODELS_DIR"
  curl -fsSL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" \
    -o "$WHISPER_MODEL" 2>>"$LOG" \
    && say "✅ Whisper model installed at $WHISPER_MODEL." \
    || say "⚠️  Whisper model download failed — set up later."
fi

# 3e. openai/whisper for batch / higher-quality / GPU. GPU users benefit most
# since the Python whisper uses torch + CUDA automatically when available.
if command -v python3 >/dev/null 2>&1 && command -v pip3 >/dev/null 2>&1; then
  if ! command -v whisper >/dev/null 2>&1; then
    say "🎙️  Installing openai/whisper for batch transcription..."
    pip3 install -q --user --upgrade openai-whisper >> "$LOG" 2>&1 \
      && say "✅ openai/whisper installed." \
      || say "⚠️  openai/whisper install failed — batch STT will surface an install hint until 'pip3 install --user openai-whisper' completes."
  fi
fi

# 4. Copy app files
say "📦 Copying LocalMind to $APP_DIR..."
mkdir -p "$APP_DIR"
rsync -a --exclude node_modules --exclude .next --exclude .git "$SRC_DIR/" "$APP_DIR/" >> "$LOG" 2>&1 \
  || fail "Could not copy application files." "Check disk space and permissions on $APP_DIR."

# 5. npm install
say "📥 Installing dependencies (this can take a few minutes)..."
( cd "$APP_DIR" && npm install >> "$LOG" 2>&1 ) || fail "npm install failed." "See $LOG."

# 6. Playwright Chromium with system deps
say "🌐 Installing Chromium for the browser tool..."
( cd "$APP_DIR" && npx playwright install chromium --with-deps >> "$LOG" 2>&1 ) \
  || say "⚠️  Chromium install failed — run 'npx playwright install chromium --with-deps' later."

# 7. sqlite-vec
say "🧮 Installing the sqlite-vec vector extension..."
mkdir -p "$LOG_DIR/extensions"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) VEC_FILE="sqlite-vec-0.1.6-loadable-linux-aarch64.tar.gz" ;;
  x86_64)        VEC_FILE="sqlite-vec-0.1.6-loadable-linux-x86_64.tar.gz" ;;
  *)             VEC_FILE="" ;;
esac
if [[ -n "$VEC_FILE" ]]; then
  curl -fsSL "https://github.com/asg017/sqlite-vec/releases/download/v0.1.6/${VEC_FILE}" \
    -o /tmp/sqlite-vec.tar.gz 2>>"$LOG" \
    && tar -xzf /tmp/sqlite-vec.tar.gz -C "$LOG_DIR/extensions" 2>>"$LOG" \
    && say "✅ sqlite-vec installed." \
    || say "⚠️  sqlite-vec download failed — using the JS vector-search fallback (fully functional)."
fi

# 8. .env secrets
if [[ ! -f "$APP_DIR/.env" ]]; then
  printf "LOCALMIND_JWT_SECRET=%s\nLOCALMIND_INTERNAL_TOKEN=%s\n" \
    "$(openssl rand -hex 48)" "$(openssl rand -hex 24)" > "$APP_DIR/.env"
fi

# 9. Build
say "🔨 Building the app..."
( cd "$APP_DIR" && npm run build >> "$LOG" 2>&1 ) || fail "Build failed." "See $LOG."

# 10. PM2 register
say "🚀 Registering LocalMind with PM2..."
( cd "$APP_DIR" && pm2 start ecosystem.config.js >> "$LOG" 2>&1 && pm2 save >> "$LOG" 2>&1 ) \
  || fail "Could not register LocalMind with PM2." "See $LOG."

# 11. Login startup
if [[ "${STARTUP_MODE}" == "systemd" ]]; then
  say "🔁 Creating systemd user service..."
  mkdir -p "$HOME/.config/systemd/user"
  PM2_PATH="$(command -v pm2)"
  cat > "$HOME/.config/systemd/user/localmind.service" <<EOF
[Unit]
Description=LocalMind
After=network.target

[Service]
Type=forking
ExecStart=${PM2_PATH} resurrect
ExecStop=${PM2_PATH} kill
Restart=on-failure
WorkingDirectory=${APP_DIR}

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload >> "$LOG" 2>&1 || true
  systemctl --user enable --now localmind >> "$LOG" 2>&1 \
    || say "⚠️  systemctl --user enable failed (may require 'loginctl enable-linger \$USER' for headless servers)."
elif [[ "${STARTUP_MODE}" == "bashrc" ]]; then
  say "🔁 Adding bashrc startup hook..."
  for RC in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ -f "$RC" ]] || continue
    if ! grep -q ">>> localmind startup >>>" "$RC"; then
      cat >> "$RC" <<EOF

# >>> localmind startup >>>
command -v pm2 >/dev/null && pm2 list >/dev/null 2>&1 || (cd "$APP_DIR" && pm2 start ecosystem.config.js >/dev/null 2>&1)
# <<< localmind startup <<<
EOF
    fi
  done
fi

# 12. Final notification
say "✅ LocalMind installed successfully."
if [[ -n "${POST_NOTIFY_CMD:-}" ]]; then
  eval "${POST_NOTIFY_CMD}" || true
elif command -v notify-send >/dev/null 2>&1; then
  notify-send "LocalMind" "Installed and running at http://localhost:3000" || true
fi

if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "http://localhost:3000" >/dev/null 2>&1 || true
fi
