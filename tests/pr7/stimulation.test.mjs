/**
 * PR-14 (brainrun 2.0 plan §15.3/§15.4) — stimulation methodology tests.
 *
 * 跑法：node --experimental-strip-types --test tests/pr7/stimulation.test.mjs
 *
 * 数值对照：
 * - TES 场与 Python 闭式解 fixture（scientific/forward/
 *   stimulation_reference.py 生成）逐点对照；同一公式双实现，
 *   容差 1e-9 V/m（实测见各断言输出）。
 * - TMS 感应电场与 Python 环路积分 fixture 对照；TS 用 360 段、
 *   Python 用 3600 段，容差 1e-4 V/m（实测段数收敛差 <1e-6 V/m）。
 * - 叠加线性：电流翻倍则场翻倍（相对误差 <1e-12）。
 * - Level D 单调性：WC 与 JR 的峰值 |q| 随场增大不减小、无故不反号。
 * - 感觉：闪烁 Welch PSD 峰落在刺激频率 ±1 Hz 内（复用 PR6 welchPsd，
 *   不重新实现）；听觉强度/ISI 扫描给出有序且不同的响应。
 * - TS 与 Python q(t) 逐点对照：WC 绝对 1e-5 nA·m + 相对 1e-6、
 *   JR 绝对 1e-6 nA·m + 相对 1e-6（PR6 同口径；实测见断言）。
 *   闪烁是连续正弦驱动，TS 在步中点采样驱动、Python 用连续驱动，
 *   容差 1e-3 nA·m（实测 3.4e-4 nA·m，约 3 倍误差底）。
 * - 确定性：同一实验两次运行逐值相同。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_TES_ELECTRODES,
  DEFAULT_TES_TARGET_MM,
  DEFAULT_TMS_COIL,
  DEFAULT_TMS_TARGET_MM,
  FIELD_TO_JR_GAIN_DEFAULT,
  FIELD_TO_WC_GAIN_DEFAULT,
  STIMULATION_ID,
  fieldToDrive,
  normalComponentVm,
  runAuditoryTrain,
  runDirectDrive,
  runLevelDResponse,
  runVisualFlicker,
  summarizeResponse,
  tesElectricField,
  tesFieldGrid,
  tmsFieldGrid,
  tmsInducedField,
} from '../../app/src/lib/stimulation.ts';
import { welchPsd } from '../../app/src/lib/signalProcessing.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr7/fixtures/stimulation-reference.json'), 'utf8'),
);

function maxAbsDiff(a, b, label) {
  assert.equal(a.length, b.length, `${label}: length ${a.length} vs ${b.length}`);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  return worst;
}
function assertCloseVec(a, b, atol, label) {
  const worst = maxAbsDiff(a, b, label);
  assert.ok(worst <= atol, `${label}: max abs diff ${worst} > ${atol}`);
  return worst;
}

test('model ids are stamped', () => {
  assert.equal(fixture.tes.electrodes.length, 2);
  const f = tesElectricField(DEFAULT_TES_ELECTRODES, DEFAULT_TES_TARGET_MM);
  assert.equal(f.modelId, 'tes-uniform-infinite-point-source-v1');
  const t = tmsInducedField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assert.equal(t.modelId, 'tms-circular-coil-uniform-conductor-v1');
  assert.ok(STIMULATION_ID.startsWith('brain-stimulation-lab-pr14'));
});

test('TES field matches Python closed-form solution', () => {
  const f = tesElectricField(DEFAULT_TES_ELECTRODES, DEFAULT_TES_TARGET_MM);
  const worst = assertCloseVec(f.fieldVm, fixture.tes.fieldVm, 1e-9, 'TES field');
  assert.ok(Math.abs(f.magnitudeVm - fixture.tes.magnitudeVm) <= 1e-9);
  assert.ok(Math.abs(f.magnitudeVm - 0.7926961168085789) < 1e-9,
    `TES magnitude ${f.magnitudeVm}`);
  // Target under the anode: field points mostly downward (-z), ~0.79 V/m at 2 mA.
  assert.ok(f.fieldVm[2] < -0.7, `TES Ez ${f.fieldVm[2]} should dominate downward`);
  assert.ok(Math.abs(f.fieldVm[0]) < 1e-12, `TES Ex ${f.fieldVm[0]} should vanish by symmetry`);
  for (const pt of fixture.tes.gridSample) {
    const g = tesElectricField(DEFAULT_TES_ELECTRODES, pt.positionMm);
    assertCloseVec(g.fieldVm, pt.fieldVm, 1e-9, `TES grid ${pt.positionMm}`);
  }
  console.log(`TES vs Python closed form: max diff ${worst.toExponential(2)} V/m`);
});

test('TES superposition is linear in current', () => {
  const base = tesElectricField(DEFAULT_TES_ELECTRODES, DEFAULT_TES_TARGET_MM);
  const doubled = tesElectricField(
    DEFAULT_TES_ELECTRODES.map(e => ({ ...e, currentMA: e.currentMA * 2 })),
    DEFAULT_TES_TARGET_MM,
  );
  const rel = maxAbsDiff(doubled.fieldVm, base.fieldVm.map(v => 2 * v), 'TES linearity')
    / base.magnitudeVm;
  assert.ok(rel < 1e-12, `TES linearity rel error ${rel}`);
  // Halved conductivity doubles the field (E ~ 1/sigma).
  const halfSigma = tesElectricField(DEFAULT_TES_ELECTRODES, DEFAULT_TES_TARGET_MM, 0.165);
  assert.ok(Math.abs(halfSigma.magnitudeVm - 2 * base.magnitudeVm) < 1e-9);
});

test('TES validation rejects unbalanced and off-scalp electrodes', () => {
  assert.throws(() => tesElectricField(
    [{ label: 'A', positionMm: [0, 0, 95], currentMA: 2 },
     { label: 'C', positionMm: [0, -95, 0], currentMA: -1 }],
    DEFAULT_TES_TARGET_MM), /sum to zero/);
  assert.throws(() => tesElectricField(
    [{ label: 'A', positionMm: [0, 0, 50], currentMA: 2 },
     { label: 'C', positionMm: [0, -95, 0], currentMA: -2 }],
    DEFAULT_TES_TARGET_MM), /scalp sphere/);
  assert.throws(() => tesElectricField(DEFAULT_TES_ELECTRODES, [0, 0, 90]),
    /inside the brain sphere/);
});

test('TMS field matches Python loop integral and vanishes on axis', () => {
  const f = tmsInducedField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  const worst = assertCloseVec(f.fieldVm, fixture.tms.fieldVm, 1e-4, 'TMS field');
  assert.ok(Math.abs(f.magnitudeVm - fixture.tms.magnitudeVm) <= 1e-4);
  assert.ok(Math.abs(f.magnitudeVm - 84.99438468225266) < 1e-4,
    `TMS magnitude ${f.magnitudeVm}`);
  // 360 vs 3600 segments: trapezoid on a periodic loop converges fast.
  const conv = maxAbsDiff(f.fieldVm, fixture.tms.fieldVm360Segments, 'TMS segments');
  assert.ok(conv < 1e-6, `TMS 360-vs-3600 segment diff ${conv}`);
  // On the coil axis the induced field cancels by symmetry.
  assert.ok(fixture.tms.axisFieldMagnitudeVm < 1e-9,
    `axis field ${fixture.tms.axisFieldMagnitudeVm}`);
  const onAxis = tmsInducedField(DEFAULT_TMS_COIL, [0, 0, 70]);
  assert.ok(onAxis.magnitudeVm < 1e-9, `TS axis field ${onAxis.magnitudeVm}`);
  // Direction: azimuthal — perpendicular to the coil axis and to the
  // radial offset (target at +x from the axis => field along -y for dI/dt > 0).
  assert.ok(Math.abs(f.fieldVm[0]) < 1e-6 && Math.abs(f.fieldVm[2]) < 1e-6,
    `TMS field ${f.fieldVm} should be purely azimuthal (-y)`);
  assert.ok(f.fieldVm[1] < 0, 'TMS field should point -y for +dI/dt');
  // Linear in turns and in dI/dt.
  const doubled = tmsInducedField(
    { ...DEFAULT_TMS_COIL, dIdtAPerS: DEFAULT_TMS_COIL.dIdtAPerS * 2 },
    DEFAULT_TMS_TARGET_MM,
  );
  assert.ok(Math.abs(doubled.magnitudeVm - 2 * f.magnitudeVm) < 1e-9);
  console.log(`TMS vs Python loop integral: max diff ${worst.toExponential(2)} V/m`);
});

test('field grids cover the brain volume', () => {
  const tes = tesFieldGrid(DEFAULT_TES_ELECTRODES, 0.33, 40);
  const tms = tmsFieldGrid(DEFAULT_TMS_COIL, 40);
  assert.ok(tes.length > 20 && tms.length > 20, `grid sizes ${tes.length}/${tms.length}`);
  for (const p of [...tes, ...tms]) {
    assert.ok(p.magnitudeVm >= 0 && Number.isFinite(p.magnitudeVm));
    assert.ok(Math.hypot(...p.positionMm) <= 85.5 + 1e-9);
  }
  const tesMax = Math.max(...tes.map(p => p.magnitudeVm));
  const tmsMax = Math.max(...tms.map(p => p.magnitudeVm));
  // TMS fields are ~100x TES fields at the default targets (85 vs 0.79 V/m);
  // on a coarse 40 mm grid the TMS maximum is missed (coil plane is
  // outside the sampled volume), so the scale claim is checked at the
  // default targets, not on the grid.
  assert.ok(tmsMax > tesMax, `grid TMS max ${tmsMax} vs TES max ${tesMax}`);
  const tesDefault = tesElectricField(DEFAULT_TES_ELECTRODES, DEFAULT_TES_TARGET_MM);
  const tmsDefault = tmsInducedField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assert.ok(tmsDefault.magnitudeVm > 50 * tesDefault.magnitudeVm,
    `default-target TMS ${tmsDefault.magnitudeVm} vs TES ${tesDefault.magnitudeVm}`);
});

test('Level A direct drive is a labelled model input, not a field', () => {
  const r = runDirectDrive({ model: 'wc', drive: 1.4, durationMs: 40 });
  assert.ok(r.peakAbsQNAm > 0.5, `WC direct-drive peak ${r.peakAbsQNAm}`);
  assert.equal(r.timesMs[0], 0);
  assert.ok(r.eegUv.every((v, i) => Math.abs(v - r.qNAm[i] * 0.16) < 1e-12));
  const zero = runDirectDrive({ model: 'wc', drive: 0, durationMs: 40 });
  assert.ok(zero.peakAbsQNAm < 1e-12, `zero drive peak ${zero.peakAbsQNAm}`);
});

test('Level D WC: response grows monotonically with field, no sign flip', () => {
  const fields = [0, 25, 50, 100, 200];
  const peaks = fields.map(f => runLevelDResponse({
    fieldVm: [0, 0, f], model: 'wc',
  }).peakAbsQNAm);
  for (let i = 1; i < peaks.length; i++) {
    assert.ok(peaks[i] >= peaks[i - 1] - 1e-12,
      `WC Level D peak fell: ${peaks[i - 1]} -> ${peaks[i]} at ${fields[i]} V/m`);
  }
  assert.ok(peaks[4] > 4, `WC Level D peak at 200 V/m: ${peaks[4]}`);
  assert.ok(peaks[0] < 1e-12, `WC Level D peak at 0 V/m: ${peaks[0]}`);
  // Signed response at the peak is positive for every nonzero field.
  for (const f of [25, 50, 100, 200]) {
    const r = runLevelDResponse({ fieldVm: [0, 0, f], model: 'wc' });
    const qi = r.qNAm[r.timesMs.indexOf(r.peakTimeMs)];
    assert.ok(qi > 0, `WC Level D signed peak at ${f} V/m: ${qi}`);
  }
  // TS vs Python q(t) at 100 V/m (WC gain 0.01 -> drive 1.0).
  const r100 = runLevelDResponse({ fieldVm: [0, 0, 100], model: 'wc' });
  const s = fixture.levelD.wc.series100;
  const worst = maxAbsDiff(r100.qNAm, s.q_nAm, 'Level D WC q(t)');
  assert.ok(worst <= 1e-5, `Level D WC q(t) max diff ${worst} > 1e-5 nA*m`);
  assert.ok(r100.peakAbsQNAm > 0.9 * fixture.levelD.wc.peaks[3],
    `WC peak ${r100.peakAbsQNAm} vs Python ${fixture.levelD.wc.peaks[3]}`);
  console.log(`Level D WC peaks: ${peaks.map(p => p.toFixed(3)).join(', ')} nA*m; ` +
    `q(t) vs Python max diff ${worst.toExponential(2)} nA*m`);
});

test('Level D JR: response grows monotonically with field (branch-switch jump documented)', () => {
  const fields = [0, 25, 50, 100, 200];
  const peaks = fields.map(f => runLevelDResponse({
    fieldVm: [0, 0, f], model: 'jr',
  }).peakAbsQNAm);
  for (let i = 1; i < peaks.length; i++) {
    assert.ok(peaks[i] >= peaks[i - 1] - 1e-9,
      `JR Level D peak fell: ${peaks[i - 1]} -> ${peaks[i]} at ${fields[i]} V/m`);
  }
  assert.ok(peaks[1] < 0.2, `JR peak at 25 V/m ${peaks[1]} (below switch)`);
  assert.ok(peaks[2] > 0.9, `JR peak at 50 V/m ${peaks[2]} (branch switch, not a dose-response)`);
  const r25 = runLevelDResponse({ fieldVm: [0, 0, 25], model: 'jr' });
  const s = fixture.levelD.jr.series25;
  const worst = maxAbsDiff(r25.qNAm, s.q_nAm, 'Level D JR q(t)');
  assert.ok(worst <= 1e-6, `Level D JR q(t) max diff ${worst} > 1e-6 nA*m`);
  console.log(`Level D JR peaks: ${peaks.map(p => p.toFixed(3)).join(', ')} nA*m; ` +
    `q(t) vs Python max diff ${worst.toExponential(2)} nA*m`);
});

test('Level D gain is uncalibrated and must not be silently clamped', () => {
  const d = fieldToDrive(100);
  assert.ok(Math.abs(d.wcDrive - 100 * FIELD_TO_WC_GAIN_DEFAULT) < 1e-12);
  assert.ok(Math.abs(d.jrDrivePerS - 100 * FIELD_TO_JR_GAIN_DEFAULT) < 1e-12);
  // A normal component, not the field magnitude: a field perpendicular
  // to the cortical normal drives nothing.
  assert.ok(Math.abs(normalComponentVm([100, 0, 0], [0, 0, 1])) < 1e-12);
  assert.ok(Math.abs(normalComponentVm([0, 0, 100], [0, 0, 1]) - 100) < 1e-12);
  assert.throws(() => fieldToDrive(200, { jrGain: 10 }), /out of column range/);
  assert.throws(() => fieldToDrive(-100), /out of column range/);
});

test('visual flicker: Welch PSD peak lands on the flicker frequency', () => {
  for (const freqHz of [8, 10, 20]) {
    const r = runVisualFlicker({ freqHz, intensity: 1 });
    const steady = r.qNAm.filter((_, i) => r.timesMs[i] >= 500)
      .map(v => v - 0); // welchPsd does not demean per segment; subtract global mean
    const mean = steady.reduce((a, b) => a + b, 0) / steady.length;
    const { freqsHz, psd } = welchPsd(steady.map(v => v - mean), 250, { nFft: 256 });
    let peakF = freqsHz[0], peakP = -Infinity;
    for (let k = 1; k < psd.length; k++) {
      if (psd[k] > peakP) { peakP = psd[k]; peakF = freqsHz[k]; }
    }
    assert.ok(Math.abs(peakF - freqHz) <= 1,
      `flicker ${freqHz} Hz: Welch peak ${peakF} Hz`);
    console.log(`flicker ${freqHz} Hz: Welch peak ${peakF} Hz, peak |q| ${r.peakAbsQNAm.toFixed(3)} nA*m`);
  }
  // Intensity scales the response monotonically.
  const peaks = [0.25, 0.5, 1].map(i => runVisualFlicker({ freqHz: 10, intensity: i }).peakAbsQNAm);
  assert.ok(peaks[0] < peaks[1] && peaks[1] < peaks[2], `flicker intensity peaks ${peaks}`);
  // TS vs Python q(t) at 10 Hz, intensity 1 (continuous vs step-sampled drive).
  const r = runVisualFlicker({ freqHz: 10, intensity: 1 });
  const s = fixture.flickerWc;
  const worst = maxAbsDiff(r.qNAm, s.q_nAm, 'flicker q(t)');
  assert.ok(worst <= 1e-3, `flicker q(t) max diff ${worst} > 1e-3 nA*m`);
  console.log(`flicker q(t) vs Python max diff ${worst.toExponential(2)} nA*m`);
});

test('auditory train: intensity and ISI scans give ordered, distinct responses', () => {
  const intensityPeaks = [0.25, 0.5, 1].map(i =>
    runAuditoryTrain({ toneHz: 1000, intensity: i, isiMs: 500 }).peakAbsQNAm);
  assert.ok(intensityPeaks[0] < intensityPeaks[1] && intensityPeaks[1] < intensityPeaks[2],
    `auditory intensity peaks ${intensityPeaks}`);
  const isiMeans = [250, 500, 1000].map(isi =>
    // ISI 1000 needs a 5000 ms run to fit all 5 bursts; the scan metric
    // is the fixed [500, 1500] ms window, so totalMs does not move it.
    runAuditoryTrain({ toneHz: 1000, intensity: 1, isiMs: isi, totalMs: 5000 }).fixedWindowMeanAbsQNAm);
  assert.ok(isiMeans[0] > isiMeans[1] && isiMeans[1] > isiMeans[2],
    `auditory ISI fixed-window means ${isiMeans}`);
  for (const d of fixture.auditoryWc.isiScan) {
    const ts = runAuditoryTrain({ toneHz: 1000, intensity: 1, isiMs: d.isiMs, totalMs: 5000 });
    assert.ok(Math.abs(ts.fixedWindowMeanAbsQNAm - d.fixedWindowMeanAbsQNAm) < 1e-5,
      `ISI ${d.isiMs} mean ${ts.fixedWindowMeanAbsQNAm} vs Python ${d.fixedWindowMeanAbsQNAm}`);
  }
  for (const d of fixture.auditoryWc.intensityScan) {
    // Fixture peaks are over 0-1500 ms (first two bursts); the WC column
    // has no adaptation, so every burst peak is the same and the peak
    // over the full 3000 ms run is the same number.
    const ts = runAuditoryTrain({ toneHz: 1000, intensity: d.intensity, isiMs: 500, totalMs: 3000 });
    assert.ok(Math.abs(ts.peakAbsQNAm - d.peakAbsQNAm) < 1e-5,
      `intensity ${d.intensity} peak ${ts.peakAbsQNAm} vs Python ${d.peakAbsQNAm}`);
  }
  // Tone frequency is metadata only: same envelope, same trace.
  const a = runAuditoryTrain({ toneHz: 440, intensity: 1, isiMs: 500 });
  const b = runAuditoryTrain({ toneHz: 4000, intensity: 1, isiMs: 500 });
  assert.deepEqual(a.qNAm, b.qNAm);
  assert.equal(a.toneHz, 440);
  assert.equal(b.toneHz, 4000);
  // TS vs Python q(t) at ISI 500.
  const r = runAuditoryTrain({ toneHz: 1000, intensity: 1, isiMs: 500 });
  const s = fixture.auditoryWc.series500;
  const worst = maxAbsDiff(r.qNAm, s.q_nAm, 'auditory q(t)');
  assert.ok(worst <= 1e-5, `auditory q(t) max diff ${worst} > 1e-5 nA*m`);
  console.log(`auditory ISI means: ${isiMeans.map(v => v.toFixed(3)).join(', ')} nA*m; ` +
    `intensity peaks: ${intensityPeaks.map(v => v.toFixed(3)).join(', ')} nA*m; ` +
    `q(t) vs Python max diff ${worst.toExponential(2)} nA*m`);
});

test('determinism: identical reruns are bitwise identical', () => {
  const a = runVisualFlicker({ freqHz: 10, intensity: 1 });
  const b = runVisualFlicker({ freqHz: 10, intensity: 1 });
  assert.deepEqual(a.qNAm, b.qNAm);
  const c = tmsInducedField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  const d = tmsInducedField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assert.deepEqual(c.fieldVm, d.fieldVm);
  const s = summarizeResponse(a.timesMs, a.qNAm, [500, 4000]);
  assert.ok(s.nSamples > 0 && s.peakAbsQNAm > 0);
});
