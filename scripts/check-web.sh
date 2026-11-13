#!/usr/bin/env bash
# Demo page network layer and replay-analysis tests. Needs node (18+) and python3 only.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v node >/dev/null || { echo "missing tool: node (18 or newer)" >&2; exit 1; }
node --check web/app.js
node --check web/check.js
node --check web/verdict.js
node --check web/customs.js
node --check web/rule.js
node --test web/test/net.test.mjs web/test/customs.test.mjs web/test/rule.test.mjs
python3 -m unittest discover -s spikes -p 'test_*.py'
