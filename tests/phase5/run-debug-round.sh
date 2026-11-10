#!/bin/bash
# One full debug round: build -> phase3 -> phase4 -> acceptance -> retest
# -> debug-round (authenticity + fresh-eyes) -> compare.py -> cargo test
# -> node causal. Usage: run-debug-round.sh <N>
# Each step's output goes to tests/phase5/round-logs/r<N>/<step>.log.
# The round verdict is decided by evaluate-round.py, NOT by raw exit codes:
# acceptance/retest may fail their documented non-blocking D1 checks
# (SwiftShader first-screen time on this machine); everything else must pass.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ROUND="${1:?usage: run-debug-round.sh <round-number>}"
LOGDIR="$ROOT/tests/phase5/round-logs/r$ROUND"
mkdir -p "$LOGDIR"
VENV="$ROOT/.venv/bin/python"
export PATH="$HOME/.cargo/bin:$PATH"

run_step() {
  local name="$1"; shift
  echo "=== [$ROUND] $name ==="
  "$@" > "$LOGDIR/$name.log" 2>&1
  local rc=$?
  echo "=== [$ROUND] $name exit=$rc (see round-logs/r$ROUND/$name.log) ==="
  return $rc
}

cd "$ROOT" || exit 2

# Drop stale reports so a crashing step cannot be misread as a pass.
rm -f tests/phase3/report.json tests/phase4/report.json tests/phase5/report.json \
  tests/phase5/retest-report.json tests/phase5/debug-round-r"$ROUND".json

run_step build bash -c 'cd app && npm run build'

# Restart the preview server on the fresh build (vite preview serves dist
# from disk, but restart to be certain no stale file is served).
pkill -f "vite previe[w]" 2>/dev/null
sleep 1
(cd app && nohup npm run preview -- --port 4173 --host 127.0.0.1 > /tmp/brainrun-preview.log 2>&1 &)
for _ in $(seq 1 20); do
  if curl -s -o /dev/null --max-time 3 http://127.0.0.1:4173/; then break; fi
  sleep 1
done
curl -s -o /dev/null -w "preview:%{http_code}\n" --max-time 5 http://127.0.0.1:4173/ | tee "$LOGDIR/preview.log"

run_step phase3 "$VENV" tests/phase3/browser-test.py
run_step phase4 "$VENV" tests/phase4/browser-test.py
run_step acceptance "$VENV" tests/phase5/acceptance-test.py
run_step retest "$VENV" tests/phase5/retest.py
run_step debug-round "$VENV" tests/phase5/debug-round.py "$ROUND"
run_step compare bash -c 'cd reference/python-model && python3 compare.py'
run_step cargo-test bash -c 'cd crates/brain-core && cargo test --release'
run_step node-causal node tests/phase3/causal-node-test.mjs

python3 tests/phase5/evaluate-round.py "$ROUND" | tee "$LOGDIR/verdict.txt"

# Stop the preview server started for this round: a backgrounded vite
# holds the calling shell's process group open, so without this the
# exec session never exits (Round 1 lingered ~16 min past the verdict
# until the runtime SIGTERM'd it). The next round restarts the preview.
pkill -f "vite previe[w]" 2>/dev/null || true
