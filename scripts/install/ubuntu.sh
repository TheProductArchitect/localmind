#!/usr/bin/env bash
set -euo pipefail
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export SRC_DIR
export STARTUP_MODE="systemd"
exec bash "$SRC_DIR/scripts/install/_linux_common.sh"
