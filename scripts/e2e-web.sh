#!/usr/bin/env bash
# Browser e2e: drives index.html and inspect.html against NEAR testnet and mainnet in a tab of an already
# running browser (CDP on CUSTOMS_CDP, default http://127.0.0.1:9396), at 1440 and 390 px, and writes screenshots.
# Usage: scripts/e2e-web.sh [out-dir]   (default .progress/screens/round1)
set -euo pipefail
cd "$(dirname "$0")/.."
exec node web/test/e2e.mjs "$@"
