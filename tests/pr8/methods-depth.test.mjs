/**
 * PR8-D item 3 — 深度偏置组合方法（不采纳默认改动，数字锁定）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/methods-depth.test.mjs
 * 球形正向模型须先生成：
 *   ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py
 *
 * 试过的方法（全部用已导出的逆解函数拼装，不动产品代码）：
 * - 深度指数扫查 depth ∈ {0.4, 0.8, 1.2, 1.6}（MNE-depth 与 dSPM）；
 * - 组合分数：max 归一化后的 depth-MNE(1.2) 与 dSPM(1.2) 取均值 / 乘积；
 * - 噪声参数匹配（逆解 noiseRmsUv 取真实 0.5 而非默认 1.0）；
 * - λ² 扫查 {1/36, 1/9, 1/3, 1}。
 *
 * 结论：无噪声时 depth=1.2 同时修好深浅两端（深 0.00 / 浅 0.00 mm），
 * 组合分数同样 0/0；但有噪声 0.5 µV 时深源没有一种方法可靠修好——
 * 结果随噪声实现大幅摆动（fixture 实现：dSPM(1.2) 深 45.25 mm；
 * TS seed-7 实现：同方法深 96.00 mm），且 depth=1.2 在有噪声时
 * 把浅源推坏到 135.76 mm（TS 实现）。因此默认 depth=0.8 不动，
 * 不新增组合逆解；深度偏置仍是残留项。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildLeadField, localizationErrorMm, mneInverse } from '../../app/src/lib/sourceLocalization.ts';
import {
  depthWeightedMneInverse,
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
const DEEP = [16, 16, 16];
const SHALLOW = [48, 48, 48];
const MOMENT = [0, 10, 5];

function errOf(est, pos) {
  return localizationErrorMm(est.estimatedPositionMm, pos);
}
function peakPositionOf(norms, leadField) {
  let bi = 0;
  for (let i = 1; i < norms.length; i++) if (norms[i] > norms[bi]) bi = i;
  return leadField.sourcePositionsMm[bi];
}
/** 组合分数：两份 max 归一化分布的均值 / 乘积，再取峰。
 *  两份分布是 depth-MNE(1.2) 与 dSPM(1.2)（同一深度指数）。 */
function combinedErrors(dataUv, leadField, pos) {
  const dw = depthWeightedMneInverse(leadField, dataUv, { depth: 1.2 });
  const dsp = dspmInverse(leadField, dataUv, { depth: 1.2 });
  const n1 = dw.sourceNorms;
  const n2 = dsp.dspmValues;
  const m1 = Math.max(...n1);
  const m2 = Math.max(...n2);
  const mean = n1.map((v, i) => 0.5 * (v / m1 + n2[i] / m2));
  const prod = n1.map((v, i) => (v / m1) * (n2[i] / m2));
  return {
    mean: localizationErrorMm(peakPositionOf(mean, leadField), pos),
    prod: localizationErrorMm(peakPositionOf(prod, leadField), pos),
  };
}

test('无噪声深度指数扫查：depth=1.2 同时修好深浅两端（深 0 / 浅 0 mm）', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  for (const [name, pos] of [['deep', DEEP], ['shallow', SHALLOW]]) {
    const { dataUv } = evaluateDepthMethods(sphere, '10-20', pos, MOMENT);
    for (const depth of [0.4, 0.8, 1.2, 1.6]) {
      const dw = depthWeightedMneInverse(leadField, dataUv, { depth });
      const dsp = dspmInverse(leadField, dataUv, { depth });
      if (name === 'deep') {
        assert.ok(errOf(dw, pos) <= 45.26, `deep depth=${depth} MNE ${errOf(dw, pos)}`);
        assert.equal(errOf(dsp, pos), 0, `deep depth=${depth} dSPM fixes the deep source`);
      } else {
        assert.equal(errOf(dw, pos), 0, `shallow depth=${depth} MNE keeps 0`);
        assert.ok(Math.abs(errOf(dsp, pos) - 55.43) < 0.01,
          `shallow depth=${depth} dSPM still breaks to 55.43 mm`);
      }
    }
    // depth=1.2 的 MNE：深浅同时为 0。
    const dw12 = depthWeightedMneInverse(leadField, dataUv, { depth: 1.2 });
    assert.equal(errOf(dw12, pos), 0, `${name} depth=1.2 MNE error is 0 (noiseless)`);
  }
});

test('无噪声组合分数：均值 / 乘积都同时修好深浅两端（0 / 0 mm）', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  for (const [name, pos] of [['deep', DEEP], ['shallow', SHALLOW]]) {
    const { dataUv } = evaluateDepthMethods(sphere, '10-20', pos, MOMENT);
    const c = combinedErrors(dataUv, leadField, pos);
    assert.equal(c.mean, 0, `${name} combined-mean error`);
    assert.equal(c.prod, 0, `${name} combined-product error`);
  }
});

test('有噪声（fixture 实现）：depth=1.2 修不好深源、dSPM(1.2) 深 45.25 但浅仍坏', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  const deep = fixture.cases.deep_noisy.data_uv;
  const shallow = fixture.cases.shallow_noisy.data_uv;
  // 深源：plain 78.38；depth=1.2 更差（96.00）；dSPM(1.2) 45.25（改善但未修好）。
  assert.ok(Math.abs(fixture.cases.deep_noisy.plain_mne.localization_error_mm - 78.38) < 0.01);
  assert.ok(Math.abs(errOf(depthWeightedMneInverse(leadField, deep, { depth: 1.2 }), DEEP) - 96.00) < 0.01,
    'noisy deep depth=1.2 is worse than plain');
  assert.ok(Math.abs(errOf(dspmInverse(leadField, deep, { depth: 1.2 }), DEEP) - 45.25) < 0.01,
    'noisy deep dSPM(1.2) improves to 45.25 but does not fix');
  // 浅源：depth=1.2 保持 0，但 dSPM(1.2) 仍为 55.43——没有一种方法同时修好两端。
  assert.equal(errOf(depthWeightedMneInverse(leadField, shallow, { depth: 1.2 }), SHALLOW), 0);
  assert.ok(Math.abs(errOf(dspmInverse(leadField, shallow, { depth: 1.2 }), SHALLOW) - 55.43) < 0.01);
  // 组合分数：深 90.51（比 plain 更差），浅 0。
  const c = combinedErrors(deep, leadField, DEEP);
  assert.ok(Math.abs(c.mean - 90.51) < 0.01, `noisy deep combined-mean ${c.mean}`);
  assert.ok(Math.abs(c.prod - 90.51) < 0.01, `noisy deep combined-product ${c.prod}`);
  const cs = combinedErrors(shallow, leadField, SHALLOW);
  assert.equal(cs.mean, 0);
  assert.equal(cs.prod, 0);
});

test('有噪声（TS seed-7 实现）：同一方法结果大幅摆动，修好深源不可靠', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  const { dataUv } = evaluateDepthMethods(sphere, '10-20', DEEP, MOMENT, { noiseRmsUv: 0.5, seed: 7 });
  const plain = mneInverse(leadField, dataUv);
  // TS 实现：plain 71.55（fixture 实现是 78.38——噪声实现不同，数字不同）。
  assert.ok(Math.abs(errOf(plain, DEEP) - 71.55) < 0.01, `TS-noise plain deep ${errOf(plain, DEEP)}`);
  // 同一 dSPM(1.2)：fixture 实现 45.25，TS 实现 96.00——结论随实现摆动。
  assert.ok(Math.abs(errOf(dspmInverse(leadField, dataUv, { depth: 1.2 }), DEEP) - 96.00) < 0.01,
    'TS-noise dSPM(1.2) deep is 96.00, not 45.25');
  // depth=1.2 在 TS 实现下把浅源推坏到 135.76 mm。
  const { dataUv: sData } = evaluateDepthMethods(sphere, '10-20', SHALLOW, MOMENT, { noiseRmsUv: 0.5, seed: 7 });
  assert.ok(Math.abs(errOf(depthWeightedMneInverse(leadField, sData, { depth: 1.2 }), SHALLOW) - 135.76) < 0.01,
    'TS-noise depth=1.2 breaks the noisy shallow source to 135.76 mm');
});

test('λ² 扫查与噪声参数匹配：都不能在有噪声时同时修好深浅两端', () => {
  const leadField = buildLeadField(sphere, '10-20', { mode: 'average' });
  const { dataUv } = evaluateDepthMethods(sphere, '10-20', DEEP, MOMENT, { noiseRmsUv: 0.5, seed: 7 });
  for (const lam of [1 / 36, 1 / 9, 1 / 3, 1]) {
    const p = mneInverse(leadField, dataUv, { lambda2: lam, noiseRmsUv: 0.5 });
    assert.ok(errOf(p, DEEP) >= 71.55, `lambda2=${lam} plain deep ${errOf(p, DEEP)}`);
    const dw = depthWeightedMneInverse(leadField, dataUv, { lambda2: lam, noiseRmsUv: 0.5, depth: 0.8 });
    assert.ok(errOf(dw, DEEP) >= 71.55, `lambda2=${lam} depth deep ${errOf(dw, DEEP)}`);
  }
  // 噪声参数匹配（逆解 noiseRmsUv=0.5 = 真实噪声）不改变深源误差。
  assert.ok(Math.abs(errOf(depthWeightedMneInverse(leadField, dataUv, { depth: 0.8, noiseRmsUv: 0.5 }), DEEP) - 78.38) < 0.01);
  assert.ok(Math.abs(errOf(dspmInverse(leadField, dataUv, { depth: 0, noiseRmsUv: 0.5 }), DEEP) - 78.38) < 0.01);
  // eLORETA 有噪声深源仍差（fixture 实现 90.51）。
  assert.ok(Math.abs(fixture.cases.deep_noisy.eloreta.localization_error_mm - 90.51) < 0.01);
  const elo = eloretaInverse(leadField, fixture.cases.deep_noisy.data_uv);
  assert.ok(Math.abs(errOf(elo, DEEP) - 90.51) < 0.01);
});
