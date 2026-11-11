/**
 * PR-15 拉伸项 — MNE 深度偏置 TS 测试。
 *
 * 跑法：node --experimental-strip-types --test tests/pr7/depth-weighted-inverse.test.mjs
 *
 * 对照链：TS（`app/src/lib/depthWeightedInverse.ts`）vs Python
 *（`scientific/eeg/depth_reference.py` 生成的
 * `tests/pr7/fixtures/depth-reference.json`，numpy 同公式）。
 * 峰值位置（离散网格点）精确相等；定位误差精确相等（容差 1e-9 mm）；
 * 分布范围相对 1e-6（TS 高斯消元 vs numpy 求解的末位差异量级）。
 * 球形正向模型须先生成（见 experiments.test.mjs 的同款报错）。
 *
 * 诚实结论（本文件断言的就是实测值，不美化）：
 * - 无噪声深源 [16,16,16]：plain 55.43 → depth 45.25 → dSPM 0.00 →
 *   eLORETA 32.00 mm；浅源 [48,48,48]：plain 0 → depth 0 →
 *   dSPM 55.43（变坏）→ eLORETA 78.38 mm。
 * - 有噪声（0.5 µV，numpy 种子 7 的数据存在 fixture 里，TS 直接读
 *   存下的数据跑逆解——两边噪声流不同，不各自生成）：深源 depth
 *   96.00 mm（比 plain 的 78.38 更差），深源 eLORETA 90.51 mm、
 *   浅源 eLORETA 78.38 mm。
 *   没有一种方法同时修好深浅两端，残留仍在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mneInverse, buildLeadField } from '../../app/src/lib/sourceLocalization.ts';
import {
  DEPTH_WEIGHT_DEFAULT,
  depthWeightedMneInverse,
  depthWeights,
  dspmInverse,
  eloretaInverse,
  evaluateDepthMethods,
} from '../../app/src/lib/depthWeightedInverse.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr7/fixtures/depth-reference.json'), 'utf8'),
);
const spherePath = join(root, 'app/public/forward-assets/sphere-model.json');
if (!existsSync(spherePath)) {
  throw new Error(
    'Missing sphere forward fixture: app/public/forward-assets/sphere-model.json. ' +
      'Generate it locally with: ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py ' +
      'from the repo root.',
  );
}
const sphere = JSON.parse(readFileSync(spherePath, 'utf8'));

function maxAbsDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

function assertCaseMatchesFixture(caseName, got, want) {
  assert.deepEqual(got.plainMne.estimatedPositionMm, want.plain_mne.estimated_position_mm, `${caseName} plain position`);
  assert.ok(Math.abs(got.plainMne.localizationErrorMm - want.plain_mne.localization_error_mm) < 1e-9, `${caseName} plain error`);
  assert.deepEqual(got.depthWeighted.estimatedPositionMm, want.depth_weighted.estimated_position_mm, `${caseName} depth position`);
  assert.ok(Math.abs(got.depthWeighted.localizationErrorMm - want.depth_weighted.localization_error_mm) < 1e-9, `${caseName} depth error`);
  assert.deepEqual(got.dspm.estimatedPositionMm, want.dspm.estimated_position_mm, `${caseName} dSPM position`);
  assert.ok(Math.abs(got.dspm.localizationErrorMm - want.dspm.localization_error_mm) < 1e-9, `${caseName} dSPM error`);
  assert.deepEqual(got.eloreta.estimatedPositionMm, want.eloreta.estimated_position_mm, `${caseName} eLORETA position`);
  assert.ok(Math.abs(got.eloreta.localizationErrorMm - want.eloreta.localization_error_mm) < 1e-9, `${caseName} eLORETA error`);
  for (const [gk, wk] of [['plainMne', 'plain_mne'], ['depthWeighted', 'depth_weighted'], ['dspm', 'dspm'], ['eloreta', 'eloreta']]) {
    const rel = Math.abs(got[gk].spreadMm - want[wk].spread_mm) / Math.max(1e-12, want[wk].spread_mm);
    assert.ok(rel < 1e-6, `${caseName} ${gk} spread rel err ${rel}`);
  }
}

test('无噪声深源：plain 55.43 → depth 45.25 → dSPM 0.00 → eLORETA 32.00 mm（与 Python 一致）', () => {
  const got = evaluateDepthMethods(sphere, '10-20', [16, 16, 16], [0, 10, 5]);
  const want = fixture.cases.deep;
  assert.ok(maxAbsDiff(got.dataUv, want.data_uv) < 1e-9, 'forward data matches Python');
  assertCaseMatchesFixture('deep', got, want);
  assert.ok(got.depthWeighted.localizationErrorMm < got.plainMne.localizationErrorMm,
    'depth weighting improves the deep source (noiseless)');
  assert.equal(got.dspm.localizationErrorMm, 0, 'dSPM fixes the deep source');
});

test('无噪声浅源：plain/depth 均为 0 mm，dSPM 变坏到 55.43 mm，eLORETA 78.38 mm（与 Python 一致）', () => {
  const got = evaluateDepthMethods(sphere, '10-20', [48, 48, 48], [0, 10, 5]);
  const want = fixture.cases.shallow;
  assert.ok(maxAbsDiff(got.dataUv, want.data_uv) < 1e-9, 'forward data matches Python');
  assertCaseMatchesFixture('shallow', got, want);
  assert.equal(got.depthWeighted.localizationErrorMm, 0, 'depth keeps the shallow source exact');
  assert.ok(Math.abs(got.dspm.localizationErrorMm - 55.42562584220407) < 1e-9,
    'dSPM breaks the shallow source (measured, not a bug: noise normalisation pushes the peak deep)');
});

test('有噪声（0.5 µV，fixture 存下的数据）：四种方法与 Python 逐项一致', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  for (const caseName of ['deep_noisy', 'shallow_noisy']) {
    const want = fixture.cases[caseName];
    const dataUv = want.data_uv;
    const plain = mneInverse(leadField, dataUv);
    const dw = depthWeightedMneInverse(leadField, dataUv);
    const ds = dspmInverse(leadField, dataUv);
    const elo = eloretaInverse(leadField, dataUv);
    assert.deepEqual(plain.estimatedPositionMm, want.plain_mne.estimated_position_mm, `${caseName} plain position`);
    assert.deepEqual(dw.estimatedPositionMm, want.depth_weighted.estimated_position_mm, `${caseName} depth position`);
    assert.deepEqual(ds.estimatedPositionMm, want.dspm.estimated_position_mm, `${caseName} dSPM position`);
    assert.deepEqual(elo.estimatedPositionMm, want.eloreta.estimated_position_mm, `${caseName} eLORETA position`);
    assert.ok(Math.abs(dw.spreadMm - want.depth_weighted.spread_mm) / want.depth_weighted.spread_mm < 1e-6);
  }
  // 有噪声深源：深度加权比 plain 更差（96.00 vs 78.38 mm）——如实记录，不掩盖。
  const deepNoisy = fixture.cases.deep_noisy;
  assert.ok(deepNoisy.depth_weighted.localization_error_mm > deepNoisy.plain_mne.localization_error_mm,
    'noisy deep: depth weighting is worse than plain MNE');
  assert.ok(Math.abs(fixture.cases.shallow_noisy.eloreta.localization_error_mm - 78.38) < 0.01,
    'noisy shallow eLORETA error ~78 mm');
  assert.ok(Math.abs(fixture.cases.deep_noisy.eloreta.localization_error_mm - 90.51) < 0.01,
    'noisy deep eLORETA error ~91 mm');
});

test('depth = 0 时深度加权退化为 plain MNE（同一公式）', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  const dataUv = fixture.cases.deep.data_uv;
  const plain = mneInverse(leadField, dataUv);
  const dw0 = depthWeightedMneInverse(leadField, dataUv, { depth: 0 });
  assert.deepEqual(dw0.estimatedPositionMm, plain.estimatedPositionMm);
  assert.ok(Math.abs(dw0.peakValue - plain.peakValue) / plain.peakValue < 1e-9);
  assert.ok(Math.abs(dw0.spreadMm - plain.spreadMm) / plain.spreadMm < 1e-9);
});

test('深度权重：表浅源列模大、权重小；深源列模小、权重被放大', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  const w = depthWeights(leadField, DEPTH_WEIGHT_DEFAULT);
  assert.equal(w.length, 64);
  const idx = (p) => leadField.sourcePositionsMm.findIndex(
    (q) => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]);
  // 深源 [16,16,16] 的权重应大于浅源 [48,48,48]（列模小 → 补偿大）。
  assert.ok(w[idx([16, 16, 16])] > w[idx([48, 48, 48])],
    'deep source gets a larger depth weight than the shallow source');
  assert.throws(() => depthWeights(leadField, -0.1), RangeError);
  assert.throws(() => depthWeights(leadField, 3), RangeError);
});

test('eLORETA 收敛：12 轮内收敛（max 相对变化 < 1e-3），输出有限', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  for (const caseName of ['deep', 'shallow']) {
    const elo = eloretaInverse(leadField, fixture.cases[caseName].data_uv);
    assert.equal(elo.iterations, fixture.cases[caseName].eloreta.iterations,
      `${caseName} eLORETA iterations`);
    assert.ok(elo.finalMaxChange < 1e-3, `${caseName} final change ${elo.finalMaxChange}`);
    assert.ok(elo.sourceNorms.every(Number.isFinite));
    assert.ok(Number.isFinite(elo.spreadMm) && elo.spreadMm > 0);
  }
});
