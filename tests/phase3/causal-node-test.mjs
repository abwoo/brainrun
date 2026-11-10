/**
 * Phase 3 因果自检 — Node 版（直接驱动 nodejs-target 的 WASM 引擎）。
 *
 * 跑：node tests/phase3/causal-node-test.mjs
 * 前置：scripts/build-wasm.sh（生成 tests/phase3/wasm-node/）。
 *
 * 全部数字来自真实运行；任一检查失败即以非零退出码结束。
 * 对照基准：reference/python-model/outputs/rust_default_demo.json
 * （Rust 原生 brain-core-run，演示预设，节点 40、t=1000 ms、100 ms、幅度 2.0）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const wasmDir = join(ROOT, 'tests', 'phase3', 'wasm-node');
// nodejs target is CJS with synchronous init (no default export).
import { createRequire } from 'node:module';
const { WasmSim } = createRequire(import.meta.url)(join(wasmDir, 'brain_wasm.js'));

const conn = JSON.parse(readFileSync(join(ROOT, 'app', 'public', 'brain-assets', 'connectivity.json'), 'utf8'));
const weights = conn.weights.flat();
const lengths = conn.lengths.flat();

const results = [];
function check(name, ok, detail = '') {
  results.push({ check: name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
}

function newSim() {
  return new WasmSim(new Float64Array(weights), new Float64Array(lengths));
}

/** 记录每 10 ms 一次的 E 快照（76 列），便于对照与复现比较。 */
function runTrace(sim, totalMs, sampleEveryMs = 10) {
  const trace = [];
  let nextSample = 0;
  for (let t = 0; t < totalMs; t++) {
    if (!sim.step()) throw new Error(`diverged at t=${t} ms: ${sim.divergence_detail()}`);
    if (t + 1 >= nextSample) {
      trace.push(Array.from(sim.snapshot_e()));
      nextSample += sampleEveryMs;
    }
  }
  return trace;
}

// --- 1. 无刺激 = 无响应 -------------------------------------------------
{
  const sim = newSim();
  const trace = runTrace(sim, 3000);
  const maxE = Math.max(...trace.flat());
  check('no stimulus -> no response', maxE < 0.05, `max E over 3000 ms = ${maxE.toFixed(4)} (baseline ~0.011)`);
  sim.free();
}

// --- 2. 脉冲响应：幅度与恢复 --------------------------------------------
{
  const sim = newSim();
  sim.advance(1000);
  sim.add_stimulus(40, 1000, 100, 2.0);
  const peak = { e: 0, t: 0 };
  let eAt1500 = 0;
  for (let t = 1000; t < 3000; t++) {
    sim.step();
    const e40 = sim.snapshot_e()[40];
    if (e40 > peak.e) {
      peak.e = e40;
      peak.t = t + 1;
    }
    if (t + 1 === 1500) eAt1500 = e40;
  }
  check('pulse peak is model-driven', peak.e > 0.3, `node 40 peak E = ${peak.e.toFixed(4)} at t=${peak.t} ms`);
  check('pulse recovers to baseline', eAt1500 < 0.05, `node 40 E at t=1500 ms = ${eAt1500.toFixed(4)}`);
  sim.free();
}

// --- 3. G=0 时刺激不传播 -------------------------------------------------
{
  const base = newSim();
  base.set_g(0);
  const baseTrace = runTrace(base, 3000);
  const stim = newSim();
  stim.set_g(0);
  stim.advance(1000);
  stim.add_stimulus(40, 1000, 100, 2.0);
  const stimTrace = runTrace(stim, 2000);
  let maxDiffOthers = 0;
  for (let s = 0; s < stimTrace.length; s++) {
    for (let n = 0; n < 76; n++) {
      if (n === 40) continue;
      // baseTrace index 100 = t=1000 ms (sampled every 10 ms)
      const d = Math.abs(stimTrace[s][n] - baseTrace[100 + s][n]);
      if (d > maxDiffOthers) maxDiffOthers = d;
    }
  }
  check('G=0: stimulus does not spread', maxDiffOthers === 0, `max |dE| on other 75 nodes = ${maxDiffOthers}`);
  base.free();
  stim.free();
}

// --- 4. 按住释放后 P 回到 0 ----------------------------------------------
{
  const sim = newSim();
  sim.advance(1000);
  sim.add_stimulus(40, 1000, 1e9, 2.0); // hold
  sim.advance(500);
  const pDuring = sim.snapshot_p()[40];
  sim.clear_stimuli_on_node(40); // release
  sim.advance(100);
  const pAfter = sim.snapshot_p()[40];
  check('hold applies input while held', pDuring === 2.0, `P[40] during hold = ${pDuring}`);
  check('release stops input', pAfter === 0, `P[40] 100 ms after release = ${pAfter}`);
  sim.free();
}

// --- 5. 确定性：相同操作序列两次结果一致 --------------------------------
{
  const runSeq = () => {
    const sim = newSim();
    sim.advance(1000);
    sim.add_stimulus(40, 1000, 100, 2.0);
    const trace = runTrace(sim, 2000);
    sim.free();
    return trace;
  };
  const a = runSeq();
  const b = runSeq();
  let maxDiff = 0;
  for (let s = 0; s < a.length; s++) {
    for (let n = 0; n < 76; n++) {
      maxDiff = Math.max(maxDiff, Math.abs(a[s][n] - b[s][n]));
    }
  }
  check('reset + replay is deterministic', maxDiff === 0, `max |dE| between two runs = ${maxDiff}`);
}

// --- 6. WASM 与 Rust 原生逐数一致 ----------------------------------------
{
  const ref = JSON.parse(readFileSync(join(ROOT, 'reference', 'python-model', 'outputs', 'rust_default_demo.json'), 'utf8'));
  const sim = newSim();
  sim.add_stimulus(40, 1000, 100, 2.0);
  // 与 rust_default_demo.json 同采样：每 10 ms 一行，行 0 为 t=0。
  const trace = [];
  trace.push(Array.from(sim.snapshot_e())); // t=0
  for (let t = 0; t < 5000; t++) {
    sim.step();
    if ((t + 1) % 10 === 0) trace.push(Array.from(sim.snapshot_e()));
  }
  let maxDiff = 0;
  for (let s = 0; s < trace.length; s++) {
    const refRow = ref.E[s * 10];
    for (let n = 0; n < 76; n++) {
      maxDiff = Math.max(maxDiff, Math.abs(trace[s][n] - refRow[n]));
    }
  }
  check('WASM matches native Rust', maxDiff < 1e-9, `max |dE| vs brain-core-run = ${maxDiff.toExponential(2)} over 501 samples x 76 nodes`);
  sim.free();
}

// --- 7. Reset 恢复初始状态 ------------------------------------------------
{
  const sim = newSim();
  sim.advance(2000);
  sim.reset();
  const e = sim.snapshot_e();
  const i = sim.snapshot_i();
  check('reset restores initial state', sim.time_ms() === 0 && e.every((v) => v === 0) && i.every((v) => v === 0),
    `time_ms=${sim.time_ms()}, max|E|=${Math.max(...e.map(Math.abs))}`);
  sim.free();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
