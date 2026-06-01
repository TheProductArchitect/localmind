#!/usr/bin/env bash
set -euo pipefail
SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
export SRC_DIR
export VEC_ARCH="sqlite-vec-0.1.6-loadable-macos-aarch64.tar.gz"
exec bash "$SRC_DIR/scripts/install/_macos_common.sh"
