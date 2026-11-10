#!/usr/bin/env bash
# Build the brain-wasm crate for the browser (web target) and for Node
# causal tests (nodejs target).  Run from the repo root.
# Requires: cargo, wasm-pack (see ~/.cargo/bin).
set -euo pipefail
export PATH="$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")/.."

echo "== web target -> app/public/wasm/ =="
wasm-pack build crates/brain-wasm --target web --out-dir ../../app/public/wasm --out-name brain_wasm

echo "== nodejs target -> tests/phase3/wasm-node/ (test-only, gitignored) =="
wasm-pack build crates/brain-wasm --target nodejs --out-dir ../../tests/phase3/wasm-node --out-name brain_wasm

echo "done."
ls -la app/public/wasm/ | grep -E "wasm|js"
