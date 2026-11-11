/**
 * PR8-A — 四个模式与 15 个一键科学场景（计划 §16.1 / §16.3）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/modes-scenarios.test.mjs
 *
 * 覆盖：
 * - 场景预设合法（`validateScenarioPresets`，含与真实后端默认值的交叉核对）；
 * - 模式切换状态机（四个已知模式通过，未知模式抛 RangeError，不静默回落）；
 * - 每个场景 id 都映射到真实后端函数：S1–S3 在 `runScenarioCompute` 里
 *   抛错（必须走实时引擎）；S4–S15 同步跑出有限的关键结果数字；
 * - 需要球形正向模型的场景在 fixture 为 null 时抛错，不编造 lead-field；
 * - 无空场景：15 个 id 连续、每个都有预设、后端字符串、模式与实验台指向。
 *
 * 球形正向模型须先生成（与 tests/pr7 同款要求）：
 *   ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py
 * 缺 fixture 时本文件直接抛错（不跳过、不放宽），因为 S5–S7、S10、S11、S6
 * 没有它就无法证明“映射到真实后端函数”。
 *
 * 容差说明：本文件不断言模型输出的“好坏”（如 P300 幅度），只断言计算
 * 真实发生且数值有限、确定性（同输入两次运行逐值相同）。S4 的 alpha 峰
 * 频率断言用宽窗 [10, 12] Hz（实测 10.99 Hz），不是为通过而放宽——
 * 它只证明“极限环确实跑出了 alpha 附近的峰”，精确值由契约 §1.12 登记。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  APP_MODES,
  MODE_DESCRIPTIONS,
  MODE_LABELS,
  SCENARIOS,
  alphaLimitCycleRecording,
  getScenario,
  runScenarioCompute,
  transitionMode,
  validateScenarioPresets,
} from '../../app/src/lib/scenarios.ts';
import { validateSphereFixture } from '../../app/src/lib/sphereForward.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const spherePath = join(root, 'app/public/forward-assets/sphere-model.json');
if (!existsSync(spherePath)) {
  throw new Error(
    'Missing sphere forward fixture: app/public/forward-assets/sphere-model.json. ' +
      'Generate it locally with: ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py ' +
      'from the repo root.',
  );
}
const fixture = JSON.parse(readFileSync(spherePath, 'utf8'));
validateSphereFixture(fixture);

const ctx = { fixture };

function assertFiniteKeyNumbers(result, id) {
  assert.ok(result.keyNumbers.length > 0, `S${id}: no key numbers`);
  for (const k of result.keyNumbers) {
    assert.ok(Number.isFinite(k.value), `S${id}: key number ${k.label} is not finite: ${k.value}`);
    assert.equal(typeof k.label, 'string');
    assert.equal(typeof k.unit, 'string');
  }
  assert.equal(typeof result.note, 'string');
  assert.ok(result.note.length > 0, `S${id}: empty note`);
}

test('presets: all 15 scenario presets validate (incl. cross-checks against real backend defaults)', () => {
  validateScenarioPresets();
});

test('modes: exactly four modes with labels and descriptions', () => {
  assert.deepEqual([...APP_MODES], ['play', 'waves', 'eeg', 'explore']);
  for (const m of APP_MODES) {
    assert.equal(typeof MODE_LABELS[m], 'string');
    assert.ok(MODE_LABELS[m].length > 0);
    assert.equal(typeof MODE_DESCRIPTIONS[m], 'string');
    assert.ok(MODE_DESCRIPTIONS[m].length > 0);
  }
});

test('modes: transitionMode accepts the four modes, rejects anything else', () => {
  for (const m of APP_MODES) {
    assert.equal(transitionMode('play', m), m);
    assert.equal(transitionMode('eeg', m), m);
  }
  for (const bad of ['bogus', 'PLAY', '', 'waves ', 'eeg2']) {
    assert.throws(() => transitionMode('play', bad), RangeError, `mode ${JSON.stringify(bad)} must throw`);
  }
});

test('scenarios: ids 1-15, no gaps, no duplicates, no empty scenario', () => {
  assert.equal(SCENARIOS.length, 15);
  const ids = SCENARIOS.map((s) => s.id).sort((a, b) => a - b);
  assert.deepEqual(ids, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  for (const s of SCENARIOS) {
    assert.equal(typeof s.title, 'string');
    assert.ok(s.title.length > 0, `S${s.id}: empty title`);
    assert.equal(typeof s.summary, 'string');
    assert.ok(s.summary.length > 0, `S${s.id}: empty summary`);
    assert.ok(APP_MODES.includes(s.mode), `S${s.id}: bad mode ${s.mode}`);
    assert.equal(typeof s.backend, 'string');
    assert.ok(s.backend.length > 0, `S${s.id}: empty backend`);
    assert.equal(typeof s.preset, 'object');
    assert.ok(Object.keys(s.preset).length > 0, `S${s.id}: empty preset`);
    assert.equal(typeof s.requiresFixture, 'boolean');
    assert.equal(typeof s.needsLiveSim, 'boolean');
    assert.equal(s.needsLiveSim, s.id <= 3, `S${s.id}: only S1-S3 are live-sim`);
    assert.equal(s.requiresFixture, [5, 6, 7, 10, 11].includes(s.id), `S${s.id}: fixture flag mismatch`);
  }
});

test('scenarios: getScenario throws on unknown id', () => {
  assert.throws(() => getScenario(0), RangeError);
  assert.throws(() => getScenario(16), RangeError);
  assert.throws(() => getScenario(99), RangeError);
});

test('scenarios: S1-S3 throw from runScenarioCompute (live engine only, no fake numbers)', () => {
  for (const id of [1, 2, 3]) {
    assert.throws(
      () => runScenarioCompute(id, ctx),
      /live Wilson–Cowan simulation/,
      `S${id} must refuse to compute without the live engine`,
    );
  }
});

test('scenarios: S7 uses 10-10 (FCz/C1/C2/CPz are not 10-20 labels)', () => {
  const s7 = getScenario(7);
  assert.equal(s7.preset.montage, '10-10');
  assert.deepEqual(s7.preset.electrodes, ['FCz', 'C1', 'Cz', 'C2', 'CPz']);
  // 10-20 里确实没有这四个标签（fixture 是 MNE 标准导联的实测）：
  assert.ok(!fixture.montages['10-20'].includes('FCz'));
  assert.ok(!fixture.montages['10-20'].includes('C1'));
  assert.ok(fixture.montages['10-10'].includes('FCz'));
  assert.ok(fixture.montages['10-10'].includes('CPz'));
});

test('scenarios: S10 samples after the only event (400 ms was before it, topo was identically zero)', () => {
  const s10 = getScenario(10);
  assert.equal(s10.preset.atTimeMs, 1050);
  const r = runScenarioCompute(10, ctx);
  assertFiniteKeyNumbers(r, 10);
  const topoPeak = r.keyNumbers.find((k) => k.label === '地形峰值电位');
  assert.ok(topoPeak, 'S10 must report a topo peak');
  assert.ok(Math.abs(topoPeak.value) > 0.01, `S10 topo peak must be non-zero, got ${topoPeak.value}`);
});

test('scenarios: S4-S15 all run on real backends and return finite key numbers', () => {
  for (const id of [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    const r = runScenarioCompute(id, ctx);
    assert.equal(r.scenarioId, id);
    assertFiniteKeyNumbers(r, id);
  }
});

test('scenarios: S4 alpha limit cycle really peaks near 11 Hz (real JR run, not a stub)', () => {
  const r = runScenarioCompute(4, ctx);
  const peak = r.keyNumbers.find((k) => k.label === 'alpha 峰频率');
  assert.ok(peak, 'S4 must report an alpha peak frequency');
  assert.ok(peak.value >= 10 && peak.value <= 12, `S4 alpha peak ${peak.value} Hz outside [10, 12]`);
  const share = r.keyNumbers.find((k) => k.label === 'alpha 功率占比');
  assert.ok(share.value > 0.9, `S4 alpha share ${share.value} should be near 1 for a pure limit cycle`);
  // S4 的记录可直接供 WAVES 模式画 PSD：Pz 单通道、250 Hz、2501 点
  //（2000–12000 ms 每 4 ms 一个点，含两端）。
  assert.ok(r.alphaRecording, 'S4 must return the Pz recording for WAVES mode');
  assert.equal(r.alphaRecording.sfreqHz, 250);
  assert.equal(r.alphaRecording.channels.length, 1);
  assert.equal(r.alphaRecording.channels[0].label, 'Pz');
  assert.equal(r.alphaRecording.dataUv[0].length, 2501);
});

test('scenarios: S6 montage channel counts are the real fixture counts (19/94/343)', () => {
  const r = runScenarioCompute(6, ctx);
  const counts = {};
  for (const k of r.keyNumbers) {
    const m = k.label.match(/^(10-20|10-10|10-05) 导联数$/);
    if (m) counts[m[1]] = k.value;
  }
  assert.deepEqual(counts, { '10-20': 19, '10-10': 94, '10-05': 343 });
});

test('scenarios: S11 blind test reports both errors finite (dipole fit ~0, MNE large)', () => {
  const r = runScenarioCompute(11, ctx);
  const dipole = r.keyNumbers.find((k) => k.label === '偶极子拟合定位误差');
  const mne = r.keyNumbers.find((k) => k.label === 'MNE 定位误差');
  assert.ok(dipole.value < 1, `S11 dipole error ${dipole.value} mm should be ~0 (noiseless)`);
  assert.ok(mne.value > 10, `S11 MNE error ${mne.value} mm should be large (known depth bias)`);
});

test('scenarios: S13 HH step really spikes (4 spikes, first ~12 ms)', () => {
  const r = runScenarioCompute(13, ctx);
  const spikes = r.keyNumbers.find((k) => k.label === '动作电位数');
  const first = r.keyNumbers.find((k) => k.label === '首个锋电位');
  assert.equal(spikes.value, 4);
  assert.ok(first.value >= 10 && first.value <= 15, `S13 first spike ${first.value} ms outside [10, 15]`);
});

test('scenarios: S14 potentials scale as 1/sigma (same dipole, same sensor)', () => {
  const r = runScenarioCompute(14, ctx);
  const vals = r.keyNumbers.map((k) => k.value);
  assert.equal(vals.length, 3);
  // V ∝ 1/σ：0.10→0.33 应为约 0.10/0.33，0.33→1.00 应为约 0.33。
  assert.ok(Math.abs(vals[1] / vals[0] - 0.1 / 0.33) < 1e-9);
  assert.ok(Math.abs(vals[2] / vals[1] - 0.33) < 1e-9);
});

test('scenarios: fixture-needing scenarios throw without a fixture (never fabricate a lead-field)', () => {
  for (const id of [5, 6, 7, 10, 11]) {
    assert.throws(
      () => runScenarioCompute(id, { fixture: null }),
      /sphere forward model/,
      `S${id} must refuse without a fixture`,
    );
  }
  // 不需要 fixture 的场景在 null 下照常跑。
  const r = runScenarioCompute(4, { fixture: null });
  assertFiniteKeyNumbers(r, 4);
});

test('scenarios: compute scenarios are deterministic (same input, same numbers)', () => {
  for (const id of [4, 8, 13, 15]) {
    const a = runScenarioCompute(id, ctx);
    const b = runScenarioCompute(id, ctx);
    assert.deepEqual(
      a.keyNumbers.map((k) => k.value),
      b.keyNumbers.map((k) => k.value),
      `S${id} must be deterministic`,
    );
  }
});

test('scenarios: alphaLimitCycleRecording shape (WAVES mode input)', () => {
  const rec = alphaLimitCycleRecording();
  assert.equal(rec.sfreqHz, 250);
  assert.equal(rec.timesMs.length, 2501);
  assert.ok(rec.timesMs[0] >= 2000, 'recording must start after the 2 s settle');
  assert.ok(rec.timesMs[rec.timesMs.length - 1] <= 12000);
});
