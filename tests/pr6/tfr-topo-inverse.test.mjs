/**
 * PR6 时频/地形/源定位 — TS 测试（B3：PR-10/11/12）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr6/tfr-topo-inverse.test.mjs
 *
 * 球形 fixture：`app/public/forward-assets/sphere-model.json` 由 CI/本地
 * 生成、不入库；本地生成命令：
 *   ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py
 * 缺失时本测试直接失败并报出该命令（不是静默跳过）。
 *
 * 数值对照（均为舍入量级，不为通过而放宽）：
 * - multitaper ERSP 小 fixture：ERSP 1e-6 dB、ITC 1e-9（与 A1 的
 *   morlet/stft ERSP 容差同级）；
 * - 球面样条网格 vs Python fixture：1e-9（同公式、求和顺序差异量级）；
 * - 盲测无噪声配置 vs Python fixture：偶极子位置精确相等、残差 1e-9 µV、
 *   MNE 峰值/分布范围相对 1e-6。
 * 估计器行为的断言（误差、分布范围）是描述性界限：数值来自实测的
 * 估计器性质（见 docs/pr6-topo-inverse.md），不是方法学容差——
 * 偶极子拟合无噪声时精确恢复，MNE 无深度加权时峰值误差本来就大，
 * 测试如实报告这些数，不靠放宽门槛让测试通过。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { erspItc, morletTfr } from '../../app/src/lib/signalProcessing.ts';
import {
  sphericalSplineCoefficients,
  sphericalSplineTopography,
  evaluateSpline,
  forwardHeadPotential,
  topoAtTime,
} from '../../app/src/lib/topography.ts';
import {
  buildLeadField,
  dipoleFit,
  mneInverse,
  blindTest,
  localizationErrorMm,
  MNE_LAMBDA2_DEFAULT,
} from '../../app/src/lib/sourceLocalization.ts';
import { sphereElectrodePotentials } from '../../app/src/lib/sphereForward.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const signalFixture = JSON.parse(readFileSync(join(root, 'tests/pr6/fixtures/signal-reference.json'), 'utf8'));
const smallFixture = JSON.parse(readFileSync(join(root, 'tests/pr6/fixtures/multitaper-ersp-small.json'), 'utf8'));
const topoInvFixture = JSON.parse(readFileSync(join(root, 'tests/pr6/fixtures/tfr-topo-inverse-reference.json'), 'utf8'));

const spherePath = join(root, 'app/public/forward-assets/sphere-model.json');
if (!existsSync(spherePath)) {
  throw new Error(
    'Missing sphere forward fixture: app/public/forward-assets/sphere-model.json. ' +
      'Generate it locally with: ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py ' +
      '(CI generates it before running tests).',
  );
}
const sphere = JSON.parse(readFileSync(spherePath, 'utf8'));

/** 逐点对照：|a−b| ≤ atol + rtol·|b|。 */
function assertCloseArray(a, b, rtol, atol, label) {
  assert.equal(a.length, b.length, `${label}: length ${a.length} vs ${b.length}`);
  for (let i = 0; i < a.length; i++) {
    const err = Math.abs(a[i] - b[i]);
    const tol = atol + rtol * Math.abs(b[i]);
    assert.ok(err <= tol, `${label}[${i}]: ${a[i]} vs ${b[i]} (err ${err} > tol ${tol})`);
  }
}

function assertClose2D(a, b, rtol, atol, label) {
  assert.equal(a.length, b.length, `${label}: rows ${a.length} vs ${b.length}`);
  for (let r = 0; r < a.length; r++) assertCloseArray(a[r], b[r], rtol, atol, `${label}[${r}]`);
}

/** signal-reference.json 里的 ERP fixture 重建成 EpochSet（A1 同款）。 */
function erpEpochs() {
  const erp = signalFixture.erp;
  return {
    tminMs: erp.tmin_ms,
    tmaxMs: erp.tmax_ms,
    baselineMs: erp.baseline_ms,
    timesMs: erp.times_ms,
    trials: erp.trials,
    kept: erp.kept,
    events: erp.events,
    sfreqHz: 250,
    channels: ['Pz', 'Cz'],
  };
}

/* ── PR-10 时频 ─────────────────────────────────────────────────────── */

test('PR-10 erspItc: 三种方法各有 ERSP/ITC，ITC 在 [0,1] 内、ERSP 有限', () => {
  const ep = erpEpochs();
  for (const method of ['stft', 'morlet', 'multitaper']) {
    const r = erspItc(ep, 'Pz', [5, 10, 20], method, [-200, 0]);
    assert.equal(r.erspDb.length, 3, `${method}: 3 frequency rows`);
    assert.equal(r.itc.length, 3, `${method}: 3 ITC rows`);
    for (let f = 0; f < 3; f++) {
      for (let j = 0; j < r.erspDb[f].length; j++) {
        assert.ok(Number.isFinite(r.erspDb[f][j]), `${method} ersp[${f}][${j}] finite`);
        assert.ok(r.itc[f][j] >= 0 && r.itc[f][j] <= 1, `${method} itc[${f}][${j}] in [0,1]: ${r.itc[f][j]}`);
      }
    }
    // 合成 ERP 含 410 ms 处的高斯 bump：三种方法在 10 Hz 上都应看到正 ERSP。
    const max10 = Math.max(...r.erspDb[1]);
    assert.ok(max10 > 1, `${method}: 10 Hz max ERSP ${max10.toFixed(2)} dB should exceed 1 dB`);
  }
});

test('PR-10 三种方法的结果不直接混比：同数据、STFT 与 Morlet 的 ERSP 峰值差 > 0.5 dB', () => {
  const ep = erpEpochs();
  const rM = erspItc(ep, 'Pz', [5, 10, 20], 'morlet', [-200, 0]);
  const rS = erspItc(ep, 'Pz', [5, 10, 20], 'stft', [-200, 0]);
  const maxM = Math.max(...rM.erspDb[1]);
  const maxS = Math.max(...rS.erspDb[1]);
  // 实测：morlet 3.36 dB、stft 5.37 dB。窗长与泄漏特性不同，峰值本来就不一样；
  // UI 必须注明方法与参数，不得把两种方法的数字放进同一张表直接比。
  assert.ok(
    Math.abs(maxM - maxS) > 0.5,
    `morlet max ${maxM.toFixed(2)} dB vs stft max ${maxS.toFixed(2)} dB should differ by > 0.5 dB`,
  );
});

test('PR-10 multitaper ERSP 小规模 fixture：与 Python 逐点对照（A1 残留项）', () => {
  const ep = smallFixture.epochs;
  const epochs = {
    tminMs: ep.tmin_ms,
    tmaxMs: ep.tmax_ms,
    baselineMs: ep.baseline_ms,
    timesMs: ep.times_ms,
    trials: ep.trials,
    kept: [true, true, true],
    events: [],
    sfreqHz: ep.sfreq_hz,
    channels: ep.channels,
  };
  const r = erspItc(epochs, 'Pz', smallFixture.meta.freqs_hz, 'multitaper', [-200, 0]);
  assertCloseArray(r.timesMs, smallFixture.times_ms, 0, 1e-9, 'multitaper ersp times');
  assertClose2D(r.erspDb, smallFixture.ersp_db, 0, 1e-6, 'multitaper ersp');
  assertClose2D(r.itc, smallFixture.itc, 0, 1e-9, 'multitaper itc');
  // 形态（Python 实测）：20 Hz 突发在刺激后 100–300 ms 均值约 +5.73 dB、ITC ≈ 1.00。
  const fi20 = smallFixture.meta.freqs_hz.indexOf(20);
  const postIdx = r.timesMs.map((t, j) => (t >= 100 && t <= 300 ? j : -1)).filter((j) => j >= 0);
  const postMean = postIdx.reduce((s, j) => s + r.erspDb[fi20][j], 0) / postIdx.length;
  const postItc = postIdx.reduce((s, j) => s + r.itc[fi20][j], 0) / postIdx.length;
  assert.ok(postMean > 3, `20 Hz post ERSP mean ${postMean.toFixed(2)} dB should exceed 3 dB`);
  assert.ok(postItc > 0.9, `20 Hz post ITC mean ${postItc.toFixed(3)} should exceed 0.9`);
});

test('PR-10 频段功率随时间：beta 带功率在突发后约为基线的 19 倍', () => {
  const ep = smallFixture.epochs;
  // 与 TfrTab.tsx 同款算法：逐试次 Morlet 功率 → 频段内平均 → 试次平均。
  const freqs = [13, 15, 17, 20, 23, 26, 30]; // beta 13–30 Hz
  const nT = ep.times_ms.length;
  const acc = new Array(nT).fill(0);
  for (const tr of ep.trials) {
    const r = morletTfr(tr[0], 250, freqs, { cycles: 5 });
    for (let j = 0; j < nT; j++) {
      let s = 0;
      for (let f = 0; f < freqs.length; f++) s += r.power[f][j];
      acc[j] += s / freqs.length;
    }
  }
  const avg = acc.map((v) => v / ep.trials.length);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const base = mean(avg.filter((_, j) => ep.times_ms[j] < 0));
  const post = mean(avg.filter((_, j) => ep.times_ms[j] >= 100 && ep.times_ms[j] <= 300));
  assert.ok(post / base > 10, `beta power post/baseline ratio ${(post / base).toFixed(1)} should exceed 10`);
});

/* ── PR-11 地形 ─────────────────────────────────────────────────────── */

test('PR-11 球面样条网格：与 Python 同公式实现逐点对照', () => {
  const t = topoInvFixture.topography;
  const els = t.labels.map((lb, i) => ({ label: lb, positionMm: t.positions_mm[i] }));
  const topo = sphericalSplineTopography(els, t.values_uv, { gridResolution: 25 });
  assert.equal(topo.grid.length, t.grid.length, `grid points ${topo.grid.length} vs ${t.grid.length}`);
  for (let k = 0; k < t.grid.length; k++) {
    assert.ok(Math.abs(topo.grid[k].x - t.grid[k].x) < 1e-12, `grid[${k}].x`);
    assert.ok(Math.abs(topo.grid[k].y - t.grid[k].y) < 1e-12, `grid[${k}].y`);
    const err = Math.abs(topo.grid[k].valueUv - t.grid[k].value_uv);
    assert.ok(err <= 1e-9, `grid[${k}].valueUv err ${err}`);
  }
});

test('PR-11 样条在电极点上近乎重现实测值（λ=1e-5 平滑所致的残差 ≤ 0.02 µV）', () => {
  const t = topoInvFixture.topography;
  const els = t.labels.map((lb, i) => ({ label: lb, positionMm: t.positions_mm[i] }));
  const coeffs = sphericalSplineCoefficients(els, t.values_uv);
  // 解的是 (G+λI)C + c0 = V，故电极点复现误差 = λ·|C_i|（量级 1e-5×权重~1e3）。
  // 这是平滑样条的有意行为，不是求解错误（直接重算残差为 5.5e-15，见文档）。
  let worst = 0;
  for (let i = 0; i < els.length; i++) {
    const p = els[i].positionMm;
    const v = evaluateSpline(coeffs, [p[0] / 95, p[1] / 95, p[2] / 95]);
    worst = Math.max(worst, Math.abs(v - t.values_uv[i]));
  }
  assert.ok(worst <= 0.02, `at-electrode max err ${worst.toExponential(2)} µV should be <= 0.02 µV`);
  // 网格值不得离谱外推：不超过电极值范围外 0.1 µV。
  const topo = sphericalSplineTopography(els, t.values_uv, { gridResolution: 25 });
  const lo = Math.min(...t.values_uv);
  const hi = Math.max(...t.values_uv);
  for (const g of topo.grid) {
    assert.ok(g.valueUv >= lo - 0.1 && g.valueUv <= hi + 0.1, `grid value ${g.valueUv} outside [${lo}, ${hi}] ± 0.1`);
  }
});

test('PR-11 正向头皮电位：345 个传感器、每点 L·q 直接求值，与 sphereElectrodePotentials 一致', () => {
  const fwd = forwardHeadPotential(sphere, [16, 16, 16], [0, 10, 5], { mode: 'infinity' });
  assert.equal(fwd.labels.length, 345, 'all 345 sensors');
  assert.equal(fwd.valueUv.length, 345);
  // 同一源、同一参考（infinity）、同一 10-05 子集：必须逐点相等（同一公式）。
  const se = sphereElectrodePotentials(sphere, [16, 16, 16], [0, 10, 5], '10-05', { mode: 'infinity' });
  for (let k = 0; k < se.sensors.length; k++) {
    const i = fwd.labels.indexOf(se.sensors[k].label);
    assert.ok(i >= 0, `sensor ${se.sensors[k].label} present`);
    assert.ok(
      Math.abs(fwd.valueUv[i] - se.voltageUv[k]) < 1e-12,
      `${se.sensors[k].label}: ${fwd.valueUv[i]} vs ${se.voltageUv[k]}`,
    );
  }
  // average 参考：345 个值的均值必须为 0（参考定义本身）。
  const avg = forwardHeadPotential(sphere, [16, 16, 16], [0, 10, 5], { mode: 'average' });
  const mean = avg.valueUv.reduce((a, b) => a + b, 0) / avg.valueUv.length;
  assert.ok(Math.abs(mean) < 1e-12, `average-ref mean ${mean}`);
  // 源在网格外抛错。
  assert.throws(() => forwardHeadPotential(sphere, [100, 0, 0], [0, 10, 0]), RangeError);
});

test('PR-11 topoAtTime：取最近采样点的电极值并做插值地形', () => {
  const t = topoInvFixture.topography;
  const recording = {
    version: 1,
    sfreqHz: 250,
    timesMs: [0, 4, 8],
    channels: t.labels.map((lb, i) => ({ label: lb, positionMm: t.positions_mm[i] })),
    dataUv: t.labels.map((_, i) => [t.values_uv[i], t.values_uv[i] * 2, t.values_uv[i] * 3]),
    reference: { mode: 'average' },
    montage: '10-20',
    forwardModelId: 'mne-four-layer-sphere-ras-v1',
    sourceModelId: 'fixture',
    seed: 0,
    noise: null,
  };
  const topo = topoAtTime(recording, 5); // 最近采样点是 4 ms（第二列）
  assert.equal(topo.atTimeMs, 4);
  assert.equal(topo.method, 'spherical-spline');
  assert.equal(topo.electrodeValues.length, 19);
  assertCloseArray(
    topo.electrodeValues.map((e) => e.valueUv),
    t.values_uv.map((v) => v * 2),
    0,
    1e-12,
    'electrode values at 4 ms',
  );
  assert.ok(topo.grid.length > 400, `grid points ${topo.grid.length}`);
  assert.deepEqual(topo.forwardValues, [], 'forwardValues empty: 2D topo has no forward values');
});

test('PR-11 插值输入校验：少于 4 个电极、长度不一致时抛错', () => {
  assert.throws(
    () => sphericalSplineCoefficients([{ label: 'Cz', positionMm: [0, 0, 95] }], [1]),
    RangeError,
  );
  const els = topoInvFixture.topography.labels.map((lb, i) => ({
    label: lb,
    positionMm: topoInvFixture.topography.positions_mm[i],
  }));
  assert.throws(() => sphericalSplineCoefficients(els, [1, 2]), RangeError);
});

/* ── PR-12 源定位 ───────────────────────────────────────────────────── */

test('PR-12 盲测无噪声配置：与 Python fixture 逐项对照（偶极子精确恢复）', () => {
  for (const cfg of topoInvFixture.blind) {
    const r = blindTest(sphere, cfg.montage, cfg.true_position_mm, cfg.true_moment_nAm, {
      lambda2: cfg.lambda2,
    });
    // 偶极子拟合：位置精确相等（同一网格点）、矩 1e-6、残差 ~0。
    assert.deepEqual(r.dipole.estimatedPositionMm, cfg.dipole.estimated_position_mm, `${cfg.montage} dipole position`);
    assertCloseArray(r.dipole.estimatedMomentNAm, cfg.dipole.estimated_moment_nAm, 0, 1e-6, `${cfg.montage} dipole moment`);
    assert.ok(r.dipole.residualRmsUv < 1e-9, `${cfg.montage} dipole residual ${r.dipole.residualRmsUv}`);
    assert.equal(r.dipole.localizationErrorMm, 0, `${cfg.montage} dipole error`);
    // MNE：峰值位置精确相等、峰值与分布范围相对 1e-6。
    assert.deepEqual(r.mne.estimatedPositionMm, cfg.mne.estimated_position_mm, `${cfg.montage} MNE position`);
    const peakErr = Math.abs(r.mne.peakValue - cfg.mne.peak_value) / Math.max(1e-12, Math.abs(cfg.mne.peak_value));
    assert.ok(peakErr <= 1e-6, `${cfg.montage} MNE peak rel err ${peakErr}`);
    const spreadErr = Math.abs(r.mne.spreadMm - cfg.mne.spread_mm) / Math.max(1e-12, cfg.mne.spread_mm);
    assert.ok(spreadErr <= 1e-6, `${cfg.montage} MNE spread rel err ${spreadErr}`);
    assert.equal(r.mne.localizationErrorMm, cfg.mne.localization_error_mm, `${cfg.montage} MNE error`);
  }
});

test('PR-12 盲测：网格点外的源落在最近网格点上（[0,0,0] → 27.7 mm）', () => {
  const r = blindTest(sphere, '10-20', [0, 0, 0], [0, 10, 0]);
  // 最近网格点 [±16, ±16, ±16]，距离 √(3×16²) = 27.7 mm；残差小但非零（插值失配）。
  assert.ok(
    Math.abs(r.dipole.localizationErrorMm - 27.712812921102035) < 1e-9,
    `off-grid dipole error ${r.dipole.localizationErrorMm}`,
  );
  assert.ok(r.dipole.residualRmsUv < 0.2, `off-grid residual ${r.dipole.residualRmsUv}`);
});

test('PR-12 盲测有噪声（0.5 µV，seed 7）：偶极子拟合残差≈噪声水平，误差为噪声所限', () => {
  const cases = [
    { pos: [16, 16, 16], mom: [0, 10, 5] },
    { pos: [-16, -16, -16], mom: [0, 10, 0] },
    { pos: [48, 48, 48], mom: [0, 0, 10] },
  ];
  for (const c of cases) {
    const r = blindTest(sphere, '10-20', c.pos, c.mom, { noiseRmsUv: 0.5, seed: 7 });
    // 残差 RMS 应≈噪声 RMS（0.5 µV）：拟合把信号解释掉了，剩下的就是噪声。
    assert.ok(
      r.dipole.residualRmsUv >= 0.3 && r.dipole.residualRmsUv <= 0.7,
      `residual ${r.dipole.residualRmsUv.toFixed(3)} µV should be near noise 0.5 µV`,
    );
    // 信号 max|V| ~1 µV、噪声 0.5 µV（SNR ~2）：误差 32–55 mm 是噪声所限，
    // 不是实现错误；只断言不超过两倍网格间距（64 mm）。
    assert.ok(r.dipole.localizationErrorMm <= 64, `dipole error ${r.dipole.localizationErrorMm} mm`);
    // MNE：只断言它跑通且分布范围为正、不过分发散（误差本身很大，见文档）。
    assert.ok(r.mne.localizationErrorMm <= 120, `MNE error ${r.mne.localizationErrorMm} mm`);
    assert.ok(r.mne.spreadMm > 0 && r.mne.spreadMm < 130, `MNE spread ${r.mne.spreadMm} mm`);
  }
});

test('PR-12 参考一致性：lead-field 与数据用不同参考时拟合变差；同参考时精确', () => {
  // 同参考（average）：无噪声精确恢复。
  const ok = blindTest(sphere, '10-20', [16, 16, 16], [0, 10, 5], { reference: { mode: 'average' } });
  assert.equal(ok.dipole.localizationErrorMm, 0);
  // 不同参考：数据是 infinity 参考，lead-field 是 average 参考 → 残差显著非零。
  const { voltageUv } = sphereElectrodePotentials(sphere, [16, 16, 16], [0, 10, 5], '10-20', { mode: 'infinity' });
  const lfAvg = buildLeadField(sphere, '10-20', { mode: 'average' });
  const fit = dipoleFit(lfAvg, voltageUv);
  assert.ok(fit.residualRmsUv > 0.05, `mismatched-reference residual ${fit.residualRmsUv} µV should exceed 0.05`);
  // average 与 infinity 的 lead-field 列确实不同（列均值非零）。
  const lfInf = buildLeadField(sphere, '10-20', { mode: 'infinity' });
  let maxDiff = 0;
  for (let i = 0; i < lfAvg.gain.length; i++) {
    for (let j = 0; j < lfAvg.gain[i].length; j++) {
      maxDiff = Math.max(maxDiff, Math.abs(lfAvg.gain[i][j] - lfInf.gain[i][j]));
    }
  }
  assert.ok(maxDiff > 1e-6, `lead-field avg vs inf max diff ${maxDiff}`);
});

test('PR-12 MNE λ²：正则化越小，峰值幅度越大（收缩越轻）', () => {
  const r1 = blindTest(sphere, '10-20', [48, 48, 48], [0, 0, 10], { lambda2: MNE_LAMBDA2_DEFAULT });
  const r2 = blindTest(sphere, '10-20', [48, 48, 48], [0, 0, 10], { lambda2: 0.01 });
  assert.ok(r2.mne.peakValue > r1.mne.peakValue, `peak λ²=0.01 (${r2.mne.peakValue.toFixed(2)}) > λ²=1/9 (${r1.mne.peakValue.toFixed(2)})`);
  assert.equal(r1.mne.localizationErrorMm, 0, 'corner source localizes exactly at λ²=1/9');
  assert.equal(r2.mne.localizationErrorMm, 0, 'corner source localizes exactly at λ²=0.01');
});

test('PR-12 输入校验：数据长度不符、λ²/σ 非正时抛错', () => {
  const lf = buildLeadField(sphere, '10-20');
  assert.throws(() => dipoleFit(lf, [1, 2, 3]), RangeError);
  assert.throws(() => mneInverse(lf, new Array(19).fill(0), { lambda2: 0 }), RangeError);
  assert.throws(() => mneInverse(lf, new Array(19).fill(0), { noiseRmsUv: -1 }), RangeError);
  assert.throws(() => blindTest(sphere, '10-20', [200, 0, 0], [0, 10, 0]), RangeError);
});

test('PR-12 盲测卫生：逆解函数签名里没有真值参数（真值只进合成与评估）', () => {
  // dipoleFit / mneInverse 只接受 (leadField, dataUv[, opts])——
  // 用函数形参数量卡住：将来有人往逆解里加真值参数，本测试失败。
  // mneInverse 的第 3 个形参是 opts（lambda2/noiseRmsUv），不是真值。
  assert.equal(dipoleFit.length, 2, 'dipoleFit(leadField, dataUv)');
  assert.equal(mneInverse.length, 3, 'mneInverse(leadField, dataUv, opts)');
  assert.equal(localizationErrorMm.length, 2, 'localizationErrorMm(a, b)');
});
