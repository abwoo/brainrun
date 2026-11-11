/**
 * PR3 cross-check — Node side: drive the nodejs-target WASM engine on the
 * real 76-node TVB network through the PR3 API (set_weight / set_bias)
 * and dump sampled E traces + scenario scalars to
 * tests/pr3/wasm-scenarios.json for comparison against the Python
 * reference (tests/pr3/crosscheck-python.py).
 *
 * Run:  node tests/pr3/crosscheck-node.mjs
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

/** Peak rise of node `node`'s E over `trace` vs its value at `baseIdx`. */
function peakDelta(trace, baseIdx, node) {
  const base = trace[baseIdx][node];
  let peak = 0;
  for (let k = baseIdx; k < trace.length; k++) {
    const d = trace[k][node] - base;
    if (d > peak) peak = d;
  }
  return peak;
}

/** Mean E of `node` over the last `n` sampled rows. */
function tailMean(trace, node, n = 50) {
  const rows = trace.slice(-n);
  return rows.reduce((s, r) => s + r[node], 0) / rows.length;
}

const out = {};

// S0: baseline pulse on node 73 (lV1) -> target 54 (lPCS), W[54][73]=3.0.
// (Chosen by scan: this edge dominates 54's response to a 73 pulse;
// zeroing it drops the peak to ~5% — most edges on the dense 76-node
// network are swamped by multi-hop paths and show no measurable change.)
{
  const sim = newSim();
  runSampled(sim, 2000);
  const ePre = Array.from(sim.snapshot_e());
  sim.add_stimulus(73, sim.time_ms(), 100, 2.0);
  const trace = runSampled(sim, 2000);
  out.S0_pulse73_baseline = { trace, ePre, peak_dE54: peakDelta(trace, 0, 54) };
  sim.free();
}
// S1: same pulse with the edge 73 -> 54 zeroed (set_weight is single-sided:
// W[54][73] = 0; the reverse edge W[73][54] = 0.0 stays untouched).
{
  const sim = newSim();
  const stored = sim.set_weight(54, 73, 0.0);
  const reverse = sim.get_weight(73, 54);
  runSampled(sim, 2000);
  sim.add_stimulus(73, sim.time_ms(), 100, 2.0);
  const trace = runSampled(sim, 2000);
  out.S1_pulse73_weight54_73_zero = { trace, stored, reverse, peak_dE54: peakDelta(trace, 0, 54) };
  sim.free();
}
// S2: pulse on node 69 (lTCI) -> target 40 (lAMYG), edge W[40][69] doubled
// 1.0 -> 2.0, plus the undoubled baseline.  Also records the reverse edge
// W[69][40] to prove the edit was single-sided (it must stay 1.0).
{
  const sim = newSim();
  runSampled(sim, 2000);
  sim.add_stimulus(69, sim.time_ms(), 100, 2.0);
  const traceBase = runSampled(sim, 2000);
  out.S2a_pulse69_baseline = { trace: traceBase, peak_dE40: peakDelta(traceBase, 0, 40) };
  sim.free();
  const sim2 = newSim();
  sim2.set_weight(40, 69, 2.0);
  const reverse2 = sim2.get_weight(69, 40);
  runSampled(sim2, 2000);
  sim2.add_stimulus(69, sim2.time_ms(), 100, 2.0);
  const trace = runSampled(sim2, 2000);
  out.S2b_pulse69_weight40_69_doubled = { trace, reverse: reverse2, peak_dE40: peakDelta(trace, 0, 40) };
  sim2.free();
}
// S3: sustained excitatory bias +0.5 on node 40 (steady state).
{
  const sim = newSim();
  sim.set_bias(40, 0.5);
  const trace = runSampled(sim, 3000);
  out.S3_bias40_plus05 = { trace, steady_E40: tailMean(trace, 40), steady_E0: tailMean(trace, 0) };
  sim.free();
}
// S4: sustained inhibitory bias -0.5 on node 40.
{
  const sim = newSim();
  sim.set_bias(40, -0.5);
  const trace = runSampled(sim, 3000);
  out.S4_bias40_minus05 = { trace, steady_E40: tailMean(trace, 40), steady_E0: tailMean(trace, 0) };
  sim.free();
}
// S5: bias on then cleared -> back to the un-biased steady state.
{
  const sim = newSim();
  sim.set_bias(40, 0.5);
  runSampled(sim, 2000);
  const eBiased = sim.snapshot_e()[40];
  sim.clear_bias(40);
  const trace = runSampled(sim, 2000);
  out.S5_bias40_cleared = { trace, eBiased, steady_E40: tailMean(trace, 40) };
  sim.free();
}
// S0b: no-bias steady state (reference for S3/S4/S5).
{
  const sim = newSim();
  const trace = runSampled(sim, 3000);
  out.S0b_no_bias_steady = { trace, steady_E40: tailMean(trace, 40), steady_E0: tailMean(trace, 0) };
  sim.free();
}

writeFileSync(join(ROOT, 'tests', 'pr3', 'wasm-scenarios.json'), JSON.stringify(out));
for (const [k, v] of Object.entries(out)) {
  const scalars = Object.entries(v).filter(([kk]) => kk !== 'trace' && kk !== 'ePre')
    .map(([kk, vv]) => `${kk}=${typeof vv === 'number' ? vv.toFixed(6) : vv}`).join(' ');
  console.log(`${k}: ${scalars}`);
}
console.log('wrote tests/pr3/wasm-scenarios.json');
