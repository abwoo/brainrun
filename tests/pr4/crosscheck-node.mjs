/**
 * PR4 cross-check — Node side: drive the nodejs-target WASM engine on the
 * real 76-node TVB network through the PR4 API (background modes, seeds,
 * snapshots) and dump sampled E traces + scenario scalars to
 * tests/pr4/wasm-scenarios.json for comparison against the Python
 * reference (tests/pr4/crosscheck-python.py).
 *
 * Run:  node tests/pr4/crosscheck-node.mjs
 * Prereq: scripts/build-wasm.sh (generates tests/phase3/wasm-node/).
 * All numbers come from a real run of the WASM engine.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wasmDir = join(ROOT, 'tests', 'phase3', 'wasm-node');
const { WasmSim } = createRequire(import.meta.url)(join(wasmDir, 'brain_wasm.js'));

const conn = JSON.parse(readFileSync(join(ROOT, 'app', 'public', 'brain-assets', 'connectivity.json'), 'utf8'));
const weights = conn.weights.flat();
const lengths = conn.lengths.flat();

function newSim() {
  return new WasmSim(new Float64Array(weights), new Float64Array(lengths));
}

/** Step `ms` milliseconds, sampling E every 10 ms (returns sampled rows). */
function runSampled(sim, ms, sampleEveryMs = 10) {
  const trace = [];
  let nextSample = sampleEveryMs;
  for (let t = 0; t < ms; t++) {
    if (!sim.step()) throw new Error(`diverged at t=${sim.time_ms()} ms: ${sim.divergence_detail()}`);
    if (t + 1 >= nextSample) {
      trace.push(Array.from(sim.snapshot_e()));
      nextSample += sampleEveryMs;
    }
  }
  return trace;
}

/** Step `ms` ms with a pulse on `node` during [startMs, startMs+durMs). */
function runSampledWithPulse(sim, ms, node, startMs, durMs, amp, sampleEveryMs = 10) {
  const trace = [];
  let nextSample = sampleEveryMs;
  for (let t = 0; t < ms; t++) {
    if (t === startMs) sim.add_stimulus(node, sim.time_ms(), durMs, amp);
    if (!sim.step()) throw new Error(`diverged at t=${sim.time_ms()} ms: ${sim.divergence_detail()}`);
    if (t + 1 >= nextSample) {
      trace.push(Array.from(sim.snapshot_e()));
      nextSample += sampleEveryMs;
    }
  }
  return trace;
}

function meanE(trace) {
  return trace.map((row) => row.reduce((s, v) => s + v, 0) / row.length);
}

const out = {};

// S0: Spontaneous, seed 0, 2000 ms, pulse 40 at t=1000 ms.
{
  const sim = newSim();
  sim.set_background_mode(1);
  const trace = runSampledWithPulse(sim, 2000, 40, 1000, 100, 2.0);
  out.S0_spont_seed0 = { trace, meanE: meanE(trace) };
}
// S1: same, seed 1 (must differ from S0).
{
  const sim = newSim();
  sim.set_seed(1);
  sim.set_background_mode(1);
  const trace = runSampledWithPulse(sim, 2000, 40, 1000, 100, 2.0);
  out.S1_spont_seed1 = { trace, meanE: meanE(trace) };
}
// S2: Spontaneous, seed 0, no pulse — determinism twin of S0's first half.
{
  const sim = newSim();
  sim.set_background_mode(1);
  const trace = runSampled(sim, 2000);
  out.S2_spont_seed0_nopulse = { trace, meanE: meanE(trace) };
}
// S3: Oscillatory preset, 4000 ms, pulse 40 at t=2000 ms.
{
  const sim = newSim();
  sim.set_background_mode(2);
  const trace = runSampledWithPulse(sim, 4000, 40, 2000, 100, 2.0);
  out.S3_osc = { trace, meanE: meanE(trace) };
}
// S4: snapshot round-trip under Spontaneous + noise. Run 1500 ms,
// snapshot, run 500 ms (control tail), restore, run 500 ms again.
{
  const sim = newSim();
  sim.set_background_mode(1);
  runSampled(sim, 1500);
  const snapJson = sim.take_snapshot();
  const snapE = Array.from(sim.snapshot_e());
  const control = runSampled(sim, 500);
  sim.restore_snapshot(snapJson);
  const restoredE = Array.from(sim.snapshot_e());
  const after = runSampled(sim, 500);
  out.S4_snapshot = {
    snapE,
    restoredE,
    controlTail: control[control.length - 1],
    afterTail: after[after.length - 1],
    controlTrace: control,
    afterTrace: after,
  };
}
// S5: Quiet determinism twin — reset + rerun equals the first run.
{
  const sim = newSim();
  const t1 = runSampled(sim, 2000);
  sim.reset();
  const t2 = runSampled(sim, 2000);
  out.S5_quiet_reset_rerun = { t1, t2 };
}

writeFileSync(join(ROOT, 'tests', 'pr4', 'wasm-scenarios.json'), JSON.stringify(out));
console.log('wrote tests/pr4/wasm-scenarios.json');
console.log('S0 meanE range:', Math.min(...out.S0_spont_seed0.meanE).toFixed(4), '-', Math.max(...out.S0_spont_seed0.meanE).toFixed(4));
console.log('S3 meanE range:', Math.min(...out.S3_osc.meanE).toFixed(4), '-', Math.max(...out.S3_osc.meanE).toFixed(4));
