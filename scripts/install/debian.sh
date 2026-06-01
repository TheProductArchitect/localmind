#!/usr/bin/env bash
# Debian 12+ — identical to Ubuntu in current LocalMind dependencies. If specific
# package-name overrides become needed (older Debian, non-systemd containers),
# set them in this file before sourcing the common script.
set -euo pipefail
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export SRC_DIR
export STARTUP_MODE="systemd"
exec bash "$SRC_DIR/scripts/install/_linux_common.sh"
