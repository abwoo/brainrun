/**
 * PR8-D — TES/TMS 补齐：8 字形线圈 + 双相波形（TS 方法学测试）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/methods-stimulation.test.mjs
 *
 * 对照链：TS（`app/src/lib/stimulation.ts`）vs Python
 *（`scientific/forward/stimulation_reference.py` 生成的
 * `tests/pr7/fixtures/stimulation-reference.json`，新增 `figure8` /
 * `biphasic` 两节；同一公式双实现）。容差：8 字形场 1e-6 V/m
 *（360 段 TS vs 3600 段 Python 的段数收敛差实测 <1e-6 V/m，与 PR7
 * 圆环口径一致）；双相 E(t) 1e-4 V/m（同一收敛口径）。
 * FEM/BEM 场不在本批做（见 tests/pr8/debug-rounds-d.md）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  BIPHASIC_PERIOD_RANGE_MS,
  DEFAULT_BIPHASIC_PERIOD_MS,
  DEFAULT_TMS_COIL,
  DEFAULT_TMS_TARGET_MM,
  FIGURE_EIGHT_MODEL_ID,
  biphasicDIdtAt,
  figureEightFieldGrid,
  figureEightLoopCoils,
  tmsBiphasicPulse,
  tmsFieldForShape,
  tmsFigureEightField,
  tmsInducedField,
} from '../../app/src/lib/stimulation.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr7/fixtures/stimulation-reference.json'), 'utf8'),
);

function assertVecClose(a, b, tol, label) {
  assert.equal(a.length, b.length, `${label}: length`);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(a[i] - b[i]) < tol, `${label}[${i}]: ${a[i]} vs ${b[i]}`);
  }
}

test('8 字形线圈：两环中心沿线圈平面偏移 ±半径，反向电流（与 Python 一致）', () => {
  const [a, b] = figureEightLoopCoils(DEFAULT_TMS_COIL);
  assert.deepEqual(a.centerMm, fixture.figure8.loopCentresMm[0]);
  assert.deepEqual(b.centerMm, fixture.figure8.loopCentresMm[1]);
  assert.equal(a.dIdtAPerS, DEFAULT_TMS_COIL.dIdtAPerS);
  assert.equal(b.dIdtAPerS, -DEFAULT_TMS_COIL.dIdtAPerS);
  assert.equal(a.radiusMm, DEFAULT_TMS_COIL.radiusMm);
  assert.equal(b.radiusMm, DEFAULT_TMS_COIL.radiusMm);
  assert.deepEqual(a.axis, DEFAULT_TMS_COIL.axis);
});

test('8 字形场 = 两环场线性叠加（TS 内自洽，逐分量 <1e-12 V/m）', () => {
  const [a, b] = figureEightLoopCoils(DEFAULT_TMS_COIL);
  const fa = tmsInducedField(a, DEFAULT_TMS_TARGET_MM);
  const fb = tmsInducedField(b, DEFAULT_TMS_TARGET_MM);
  const f8 = tmsFigureEightField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assert.equal(f8.modelId, FIGURE_EIGHT_MODEL_ID);
  assertVecClose(f8.fieldVm,
    [fa.fieldVm[0] + fb.fieldVm[0], fa.fieldVm[1] + fb.fieldVm[1], fa.fieldVm[2] + fb.fieldVm[2]],
    1e-12, 'figure8 = loopA + loopB');
  assert.equal(f8.fieldVm[2], 0, 'z 分量为零（线圈平面内的环，感应场无 z 分量）');
});

test('8 字形场与 Python fixture 一致；交界处场增强、圆环轴上为零而 8 字形不为零', () => {
  const f8 = tmsFigureEightField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assertVecClose(f8.fieldVm, fixture.figure8.fieldVm, 1e-6, 'figure8 field vs Python');
  assert.ok(Math.abs(f8.magnitudeVm - fixture.figure8.magnitudeVm) < 1e-6,
    `figure8 |E| ${f8.magnitudeVm} vs Python ${fixture.figure8.magnitudeVm}`);
  const f8_360 = tmsFigureEightField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM, 360);
  assertVecClose(f8_360.fieldVm, fixture.figure8.fieldVm360Segments, 1e-6,
    'figure8 360 segments vs Python 3600');
  // 默认目标 [30,0,70]：8 字形 131.58 V/m > 圆环 84.99 V/m。
  const circ = tmsInducedField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assert.ok(f8.magnitudeVm > circ.magnitudeVm,
    `figure8 ${f8.magnitudeVm} > circular ${circ.magnitudeVm} at default target`);
  // 轴上 [0,0,70]：圆环为零（对称性），8 字形在交界正下方 178.50 V/m。
  const circAxis = tmsInducedField(DEFAULT_TMS_COIL, [0, 0, 70]);
  assert.ok(circAxis.magnitudeVm < 1e-9, `circular on-axis ${circAxis.magnitudeVm}`);
  const f8Axis = tmsFigureEightField(DEFAULT_TMS_COIL, [0, 0, 70]);
  assert.ok(Math.abs(f8Axis.magnitudeVm - fixture.figure8.axisFieldMagnitudeVm) < 1e-6,
    `figure8 on-axis ${f8Axis.magnitudeVm} vs Python ${fixture.figure8.axisFieldMagnitudeVm}`);
  assert.ok(f8Axis.magnitudeVm > 100, 'figure8 focal field under the junction is large');
  // 形状分发与直接调用一致。
  assert.deepEqual(
    tmsFieldForShape(DEFAULT_TMS_COIL, 'figure8', DEFAULT_TMS_TARGET_MM).fieldVm,
    f8.fieldVm);
  assert.deepEqual(
    tmsFieldForShape(DEFAULT_TMS_COIL, 'circular', DEFAULT_TMS_TARGET_MM).fieldVm,
    circ.fieldVm);
  assert.throws(() => tmsFieldForShape(DEFAULT_TMS_COIL, 'triangle', DEFAULT_TMS_TARGET_MM), RangeError);
});

test('8 字形网格：每点等于单点场（逐点 <1e-9 V/m）', () => {
  const grid = figureEightFieldGrid(DEFAULT_TMS_COIL, 40);
  assert.ok(grid.length > 0, 'grid is non-empty');
  for (const p of grid.slice(0, 5)) {
    const f = tmsFigureEightField(DEFAULT_TMS_COIL, p.positionMm);
    assertVecClose(p.fieldVm, f.fieldVm, 1e-9, `grid point ${p.positionMm}`);
    assert.ok(Math.abs(p.magnitudeVm - f.magnitudeVm) < 1e-9);
  }
  assert.throws(() => figureEightFieldGrid(DEFAULT_TMS_COIL, 0), RangeError);
  assert.throws(() => figureEightFieldGrid(DEFAULT_TMS_COIL, 41), RangeError);
});

test('双相波形 dI/dt(t)：余弦单周期，周期外为零，半周期反号', () => {
  const T = DEFAULT_BIPHASIC_PERIOD_MS;
  assert.equal(DEFAULT_BIPHASIC_PERIOD_MS, 0.3);
  assert.deepEqual(BIPHASIC_PERIOD_RANGE_MS, [0.1, 1.0]);
  assert.ok(Math.abs(biphasicDIdtAt(0, 1e8, T) - 1e8) < 1e-6);
  assert.ok(Math.abs(biphasicDIdtAt(T / 4, 1e8, T)) < 1e-6, 'quarter period crosses zero');
  assert.ok(Math.abs(biphasicDIdtAt(T / 2, 1e8, T) + 1e8) < 1e-6);
  assert.ok(Math.abs(biphasicDIdtAt(T, 1e8, T) - 1e8) < 1e-6);
  assert.equal(biphasicDIdtAt(-0.01, 1e8, T), 0, 'before the pulse');
  assert.equal(biphasicDIdtAt(T + 0.01, 1e8, T), 0, 'after the pulse');
  assert.throws(() => biphasicDIdtAt(0, 3e8, T), RangeError);
  assert.throws(() => biphasicDIdtAt(0, 1e8, 0.01), RangeError);
});

test('双相脉冲 E(t)：与 Python fixture 一致；E(t) = 峰值场 × cos(2πt/T)', () => {
  const fx = fixture.biphasic;
  const pulse = tmsBiphasicPulse(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM, {});
  assert.deepEqual(pulse.timesMs, fx.timesMs);
  assert.ok(Math.abs(pulse.peakMagnitudeVm - fx.peakMagnitudeVm) < 1e-4,
    `biphasic peak |E| ${pulse.peakMagnitudeVm} vs Python ${fx.peakMagnitudeVm}`);
  assert.equal(pulse.peakTimeMs, 0);
  for (let i = 0; i < fx.timesMs.length; i++) {
    assert.ok(Math.abs(pulse.dIdtAPerS[i] - fx.dIdtAPerS[i]) < 1,
      `dI/dt[${i}] ${pulse.dIdtAPerS[i]} vs ${fx.dIdtAPerS[i]}`);
    assertVecClose(pulse.fieldVm[i], fx.fieldVm[i], 1e-4, `E(t)[${i}]`);
  }
  // 半周期处 E 反号、幅值相等；周期末回到峰值。
  const half = pulse.fieldVm[15];
  const start = pulse.fieldVm[0];
  assertVecClose(half, start.map((v) => -v), 1e-9, 'E(T/2) = -E(0)');
  assertVecClose(pulse.fieldVm[30], start, 1e-9, 'E(T) = E(0)');
  // 8 字形脉冲：峰值等于 8 字形静态场。
  const f8pulse = tmsBiphasicPulse(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM, { shape: 'figure8' });
  const f8 = tmsFigureEightField(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM);
  assert.ok(Math.abs(f8pulse.peakMagnitudeVm - f8.magnitudeVm) < 1e-9);
  assert.throws(
    () => tmsBiphasicPulse(DEFAULT_TMS_COIL, DEFAULT_TMS_TARGET_MM, { periodMs: 0.31, sampleDtMs: 0.1 }),
    RangeError);
});
