#!/usr/bin/env bash
# Windows Subsystem for Linux 2 — no native init, so we use the bashrc hook
# pattern and open the Windows browser at the end via cmd.exe.
set -euo pipefail
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export SRC_DIR
export STARTUP_MODE="bashrc"

# Replace the default xdg-open behaviour with a Windows-side browser launch.
export POST_NOTIFY_CMD='cmd.exe /c start http://localhost:3000 >/dev/null 2>&1 || true'

exec bash "$SRC_DIR/scripts/install/_linux_common.sh"
