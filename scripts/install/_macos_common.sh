#!/usr/bin/env bash
# Shared macOS installer body. Sourced by macos-arm64.sh and macos-x86.sh.
# Variables expected in the environment:
#   SRC_DIR   — directory of the source checkout
#   VEC_ARCH  — sqlite-vec archive name (set by the caller)
set -euo pipefail

LOG_DIR="$HOME/.localmind"
LOG="$LOG_DIR/install.log"
APP_DIR="$HOME/LocalMind"

mkdir -p "$LOG_DIR"
echo "LocalMind install started $(date)" > "$LOG"

say()  { echo "$1"; echo "$1" >> "$LOG"; }
fail() {
  say "❌ $1"
  say "   What you can try: $2"
  osascript -e "display dialog \"LocalMind install failed:\n\n$1\" buttons {\"OK\"} with icon stop" >/dev/null 2>&1 || true
  exit 1
}

# 1. Homebrew
if ! command -v brew >/dev/null 2>&1; then
  say "🍺 Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" >> "$LOG" 2>&1 \
    || fail "Homebrew installation failed." "Check your internet connection and re-run install.sh."
  eval "$(/opt/homebrew/bin/brew shellenv)" 2>/dev/null || eval "$(/usr/local/bin/brew shellenv)" 2>/dev/null || true
else
  say "🍺 Homebrew already installed."
fi

# 2. Node.js
if ! command -v node >/dev/null 2>&1; then
  say "🟢 Installing Node.js (LTS)..."
  brew install node >> "$LOG" 2>&1 || fail "Node.js installation failed." "Run 'brew install node' manually."
else
  say "🟢 Node.js already installed ($(node -v))."
fi

# 3. Ollama
if ! command -v ollama >/dev/null 2>&1; then
  say "🧠 Installing Ollama..."
  brew install ollama >> "$LOG" 2>&1 || fail "Ollama installation failed." "Run 'brew install ollama' manually."
else
  say "🧠 Ollama already installed."
fi
ollama serve >> "$LOG" 2>&1 &

# 4. PM2
if ! command -v pm2 >/dev/null 2>&1; then
  say "⚙️  Installing PM2..."
  npm install -g pm2 >> "$LOG" 2>&1 || fail "PM2 installation failed." "Run 'npm install -g pm2' manually."
else
  say "⚙️  PM2 already installed."
fi

# 4b. pi-coding-agent (https://pi.dev) — wraps as the `pi_code` agent tool.
if ! command -v pi >/dev/null 2>&1; then
  say "🥧  Installing pi-coding-agent..."
  npm install -g --ignore-scripts @earendil-works/pi-coding-agent >> "$LOG" 2>&1 \
    || say "⚠️  pi-coding-agent install failed — pi_code agent tool will surface a clear setup error until you re-run install."
else
  say "🥧  pi-coding-agent already installed."
fi

# 4c. Voice — whisper.cpp + ffmpeg for local press-to-talk transcription.
if ! command -v whisper-cli >/dev/null 2>&1; then
  say "🎙️  Installing whisper.cpp..."
  brew install whisper-cpp >> "$LOG" 2>&1 \
    || say "⚠️  whisper.cpp install failed — the mic button will fall back to a clear error message."
else
  say "🎙️  whisper.cpp already installed."
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  say "🎬 Installing ffmpeg (for STT audio conversion)..."
  brew install ffmpeg >> "$LOG" 2>&1 \
    || say "⚠️  ffmpeg install failed — STT will surface a clear error until ffmpeg is on PATH."
else
  say "🎬 ffmpeg already installed."
fi

# 4d. Whisper model — base.en is ~150MB and balances speed/quality on Apple Silicon.
MODELS_DIR="$LOG_DIR/models"
WHISPER_MODEL="$MODELS_DIR/ggml-base.en.bin"
if [ ! -f "$WHISPER_MODEL" ]; then
  say "🧠 Downloading Whisper base.en model (~150MB, one-time)..."
  mkdir -p "$MODELS_DIR"
  curl -fsSL "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" \
    -o "$WHISPER_MODEL" 2>>"$LOG" \
    && say "✅ Whisper model installed at $WHISPER_MODEL." \
    || say "⚠️  Whisper model download failed — set up later via 'curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin -o $WHISPER_MODEL'."
fi

# 4e. Python openai/whisper for batch STT — heavier, higher-quality, GPU-aware.
# Optional — only attempted if Python + pip are available. The /api/voice/stt-batch
# endpoint detects whether `whisper` is on PATH and surfaces a clear hint otherwise.
if command -v python3 >/dev/null 2>&1 && command -v pip3 >/dev/null 2>&1; then
  if ! command -v whisper >/dev/null 2>&1; then
    say "🎙️  Installing openai/whisper for batch transcription (will take a minute)..."
    pip3 install -q --user --upgrade openai-whisper >> "$LOG" 2>&1 \
      && say "✅ openai/whisper installed (CPU mode by default; GPU auto-detected if torch+CUDA available)." \
      || say "⚠️  openai/whisper install failed — batch STT will surface an install hint until 'pip3 install --user openai-whisper' completes."
  fi
fi

# 5. Copy app files
say "📦 Copying LocalMind to $APP_DIR..."
mkdir -p "$APP_DIR"
rsync -a --exclude node_modules --exclude .next --exclude .git "$SRC_DIR/" "$APP_DIR/" >> "$LOG" 2>&1 \
  || fail "Could not copy application files." "Check disk space and permissions on $APP_DIR."

# 6. npm install + Playwright
say "📥 Installing dependencies (this can take a few minutes)..."
( cd "$APP_DIR" && npm install >> "$LOG" 2>&1 ) || fail "npm install failed." "See $LOG for details."

say "🌐 Installing the Chromium browser for the browser tool..."
( cd "$APP_DIR" && npx playwright install chromium --with-deps >> "$LOG" 2>&1 ) \
  || say "⚠️  Chromium install failed — run 'npx playwright install chromium' later to enable the browser tool."

# 7. sqlite-vec
say "🧮 Installing the sqlite-vec vector extension..."
mkdir -p "$LOG_DIR/extensions"
if [[ -n "${VEC_ARCH:-}" ]]; then
  curl -fsSL "https://github.com/asg017/sqlite-vec/releases/download/v0.1.6/${VEC_ARCH}" \
    -o /tmp/sqlite-vec.tar.gz 2>>"$LOG" \
    && tar -xzf /tmp/sqlite-vec.tar.gz -C "$LOG_DIR/extensions" 2>>"$LOG" \
    && say "✅ sqlite-vec installed." \
    || say "⚠️  sqlite-vec download failed — using the JS vector-search fallback (fully functional)."
fi

# 8. .env secrets
if [ ! -f "$APP_DIR/.env" ]; then
  printf "LOCALMIND_JWT_SECRET=%s\nLOCALMIND_INTERNAL_TOKEN=%s\n" \
    "$(openssl rand -hex 48)" "$(openssl rand -hex 24)" > "$APP_DIR/.env"
fi

# 9. Build
say "🔨 Building the app..."
( cd "$APP_DIR" && npm run build >> "$LOG" 2>&1 ) || fail "Build failed." "See $LOG for details."

# 10. PM2 register
say "🚀 Registering LocalMind as a startup process..."
( cd "$APP_DIR" && pm2 start ecosystem.config.js >> "$LOG" 2>&1 && pm2 save >> "$LOG" 2>&1 ) \
  || fail "Could not register LocalMind with PM2." "See $LOG for details."

# 11. launchd plist
PLIST="$HOME/Library/LaunchAgents/com.localmind.plist"
say "🔁 Creating login startup agent..."
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localmind</string>
  <key>ProgramArguments</key>
  <array><string>$(command -v pm2)</string><string>resurrect</string></array>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
EOF
launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST" >> "$LOG" 2>&1 || say "⚠️  launchd agent could not be loaded (non-fatal)."

# 12. Done
say "✅ LocalMind installed successfully."
osascript -e 'display dialog "LocalMind is installed and running.\n\nOpening http://localhost:3000" buttons {"Open"} default button "Open" with icon note' >/dev/null 2>&1 || true
open "http://localhost:3000" 2>/dev/null || true
