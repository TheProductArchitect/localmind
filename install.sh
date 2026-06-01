#!/usr/bin/env bash
# LocalMind one-time installer. Detects the OS and delegates to the matching
# script under scripts/install/. After this completes you never need the terminal again.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
export SRC_DIR

# ---- Detect platform ----------------------------------------------------------

PLATFORM="unknown"

if [[ "${OSTYPE:-}" == darwin* ]]; then
  case "$(uname -m)" in
    arm64) PLATFORM="macos-arm64" ;;
    x86_64) PLATFORM="macos-x86" ;;
  esac
elif [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  if grep -qiE 'microsoft|wsl' /proc/version 2>/dev/null; then
    PLATFORM="wsl2"
  elif [[ "${ID:-}" == "ubuntu" || "${ID_LIKE:-}" == *ubuntu* ]]; then
    PLATFORM="ubuntu"
  elif [[ "${ID:-}" == "debian" || "${ID_LIKE:-}" == *debian* ]]; then
    PLATFORM="debian"
  fi
fi

if [[ "$PLATFORM" == "unknown" ]]; then
  cat <<'EOF' >&2
❌ Unsupported platform.

LocalMind currently supports:
  • macOS 13+ (Apple Silicon or Intel)
  • Ubuntu 22.04 or later
  • Debian 12 or later
  • Windows 10/11 via WSL2 (Ubuntu)

If you believe your platform should work, please open an issue.
EOF
  exit 1
fi

echo "🔎 Detected platform: $PLATFORM"
SUB="$SRC_DIR/scripts/install/$PLATFORM.sh"
if [[ ! -f "$SUB" ]]; then
  echo "❌ Missing platform script: $SUB" >&2
  exit 1
fi

exec bash "$SUB"
