/**
 * PR-07 多导 EEG — TS 测试（B1）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr6/eeg-recording.test.mjs
 *
 * 数值对照：TS 输出 vs `tests/pr6/fixtures/eeg-recording-reference.json`
 *（Python 对照 `scientific/eeg/eeg_reference.py` 生成；合成小 fixture，
 * 不依赖 CI 生成的大球形模型）。
 * - 投影 / 参考变换 / 噪声：同一公式、同一 RNG，容差 1e-9 相对
 *   （实测最大差 8e-14，来自 V8 与 CPython 的 sin/cos 末位差异）；
 * - 柱模型 q(t)：TS RK4 vs Python SciPy DOP853（独立积分器），WC 差
 *   实测 2.0e-6 nA·m、JR 差 1.9e-8 nA·m，容差取绝对 1e-5 nA·m +
 *   相对 1e-6（积分器差异量级，仍比 µV 级物理效应小 6 个量级以上，
 *   不是为通过而放宽）；全跑电压容差绝对 1e-5 µV + 相对 1e-6
 *   （实测最大差 1.35e-6 µV）。
 * - 噪声 RMS：每成分每通道归一化到目标 RMS，容差 1e-9 相对；
 *   总噪声 RMS ≈ sqrt(Σ RMS²)，容差 5%（成分间交叉项所致）。
 * - 参考/种子/线性/导联：性质断言（见各测试注释）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_SFREQ_HZ,
  applyReference,
  channelsForMontage,
  generateNoise,
  gaussian,
  mulberry32,
  projectMoments,
  reReferenceRecording,
  recordingToCsv,
  recordingToJson,
  rms,
  runExperiment,
  simulateSourceMoments,
} from '../../app/src/lib/eegRecording.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr6/fixtures/eeg-recording-reference.json'), 'utf8'),
);
const synth = fixture.synthetic_fixture;
const labels20 = synth.montages['10-20'];
const NOISE = fixture.noise.params;

/** 逐点对照：|a−b| ≤ atol + rtol·|b|。 */
function assertClose2D(a, b, rtol, atol, label) {
  assert.equal(a.length, b.length, `${label}: rows ${a.length} vs ${b.length}`);
  let worst = 0;
  for (let r = 0; r < a.length; r++) {
    assert.equal(a[r].length, b[r].length, `${label}[${r}]: length`);
    for (let j = 0; j < a[r].length; j++) {
      const err = Math.abs(a[r][j] - b[r][j]);
      const tol = atol + rtol * Math.abs(b[r][j]);
      if (err > worst) worst = err;
      assert.ok(err <= tol, `${label}[${r}][${j}]: ${a[r][j]} vs ${b[r][j]} (err ${err} > tol ${tol})`);
    }
  }
  return worst;
}

function maxAbsDiff2D(a, b) {
  let m = 0;
  for (let r = 0; r < a.length; r++) {
    for (let j = 0; j < a[r].length; j++) m = Math.max(m, Math.abs(a[r][j] - b[r][j]));
  }
  return m;
}

test('RNG：mulberry32(1) 前 5 个均匀数与高斯前 3 个值逐位等于 Python 对照', () => {
  const rng = mulberry32(1);
  assert.deepEqual(
    [rng(), rng(), rng(), rng(), rng()],
    [0.6270739405881613, 0.002735721180215478, 0.5274470399599522, 0.9810509674716741, 0.9683778982143849],
  );
  const rng2 = mulberry32(1);
  assert.deepEqual(
    [gaussian(rng2), gaussian(rng2), gaussian(rng2)],
    [0.9659740590152261, 1.1231041937525543, -0.049227862786499016],
  );
});

test('投影：解析 q(t) 经球形 lead-field 的无限远参考电压与 Python 一致', () => {
  const v = projectMoments(synth, [0, 0, 16], [0, 0, 1], fixture.analytic_q_nAm, '10-20');
  assert.equal(v.length, 19);
  assert.equal(v[0].length, 501);
  const worst = assertClose2D(v, fixture.expected_infinity_uv, 1e-9, 1e-12, 'projection');
  assert.ok(worst < 1e-9, `projection worst err ${worst}`);
});

test('参考变换：三种参考与 Python 一致；平均参考每采样点均值为 0；电极参考该通道为 0', () => {
  const vInf = projectMoments(synth, [0, 0, 16], [0, 0, 1], fixture.analytic_q_nAm, '10-20');
  assertClose2D(applyReference(vInf, { mode: 'infinity' }, labels20), fixture.expected_infinity_uv, 1e-9, 1e-12, 'infinity');
  const vAvg = applyReference(vInf, { mode: 'average' }, labels20);
  assertClose2D(vAvg, fixture.expected_average_uv, 1e-9, 1e-12, 'average');
  const vEl = applyReference(vInf, { mode: 'electrode', label: 'Cz' }, labels20);
  assertClose2D(vEl, fixture.expected_electrode_cz_uv, 1e-9, 1e-12, 'electrode-Cz');
  // 平均参考：每采样点跨通道均值 ≈ 0（1e-9 µV 内）。
  for (let j = 0; j < vAvg[0].length; j++) {
    const mean = vAvg.reduce((s, row) => s + row[j], 0) / vAvg.length;
    assert.ok(Math.abs(mean) < 1e-9, `average-ref sample ${j} mean ${mean}`);
  }
  // 电极参考：Cz 行全零。
  const cz = labels20.indexOf('Cz');
  assert.ok(vEl[cz].every((x) => x === 0), 'electrode-ref channel must be all zeros');
  // 无限远参考：原样返回（新数组，值相等）。
  const vInf2 = applyReference(vInf, { mode: 'infinity' }, labels20);
  assert.notEqual(vInf2, vInf, 'must return a copy, not the input');
  assert.deepEqual(vInf2, vInf);
  // 未知电极抛错。
  assert.throws(() => applyReference(vInf, { mode: 'electrode', label: 'NoSuch' }, labels20), RangeError);
});

test('噪声：四成分逐值与 Python 一致；每成分每通道 RMS 等于目标；总 RMS ≈ sqrt(ΣRMS²)', () => {
  const gen = generateNoise(NOISE, 19, 501, 250, 7);
  assert.equal(gen.components.length, 4);
  for (const comp of gen.components) {
    assert.ok(comp.label.includes('非神经源'), `${comp.kind} must be labelled non-neural, got ${comp.label}`);
    assertClose2D(comp.data, fixture.noise.components[comp.kind], 1e-9, 1e-12, `noise ${comp.kind}`);
    const target = { white: 2, pink: 1, line50: 0.5, drift: 0.5 }[comp.kind];
    for (let c = 0; c < 19; c++) {
      const r = rms(comp.data[c]);
      assert.ok(Math.abs(r - target) <= 1e-9 * target, `${comp.kind} ch${c} RMS ${r} vs ${target}`);
    }
  }
  assertClose2D(gen.total, fixture.noise.total, 1e-9, 1e-12, 'noise total');
  // 总 RMS：sqrt(4+1+0.25+0.25)=2.3452 µV，容差 5%（成分间交叉项）。
  const totalRms = rms(gen.total[0]);
  const expect = Math.sqrt(4 + 1 + 0.25 + 0.25);
  assert.ok(Math.abs(totalRms - expect) / expect < 0.05, `total RMS ${totalRms} vs ${expect}`);
  // 全零参数 → 全零噪声。
  const zero = generateNoise({ whiteRmsUv: 0, pinkRmsUv: 0, line50HzRmsUv: 0, driftRmsUv: 0 }, 3, 100, 250, 1);
  assert.ok(zero.total.flat().every((x) => x === 0));
  assert.throws(() => generateNoise({ ...NOISE, whiteRmsUv: -1 }, 3, 100, 250, 1), RangeError);
});

test('柱模型 q(t)：WC/JR 的 TS RK4 与 Python DOP853 在积分器差异内一致', () => {
  const base = {
    durationMs: 2000,
    events: [{ tMs: 1000, wcDrive: 1.0, jrDrivePerS: 120 }],
    driveDurationMs: 100,
    sourcePositionMm: [0, 0, 16],
    sourceNormalHead: [0, 0, 1],
    secondSourcePositionMm: [16, -16, 16],
    secondSourceNormalHead: [0, 0, 1],
    jrBaselineInputPerS: 90,
  };
  const wc = simulateSourceMoments({ ...base, sourceModel: 'wc' });
  assert.deepEqual(wc.timesMs.slice(0, 3), [0, 4, 8]);
  assert.equal(wc.sources.length, 1);
  assertClose2D([wc.sources[0].momentsNAm], [fixture.run_wc.q_nAm], 1e-6, 1e-5, 'WC q');
  const jr = simulateSourceMoments({ ...base, sourceModel: 'jr' });
  assertClose2D([jr.sources[0].momentsNAm], [fixture.run_jr_q_nAm], 1e-6, 1e-6, 'JR q');
});

test('全跑：2 s WC 实验与 Python DOP853 全跑在积分器差异内一致', () => {
  const { recording, events } = runExperiment({
    fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: NOISE, seed: 7,
  });
  assert.deepEqual(events, fixture.run_wc.events);
  assert.equal(recording.version, 1);
  assert.equal(recording.sfreqHz, DEFAULT_SFREQ_HZ);
  assert.equal(recording.montage, '10-20');
  assert.equal(recording.channels.length, 19);
  assert.equal(recording.timesMs.length, 501);
  assert.equal(recording.seed, 7);
  assert.deepEqual(recording.noise, NOISE);
  assert.ok(recording.rawDataUvInfinity, 'recording must carry raw infinity-reference data');
  const worst = assertClose2D(recording.dataUv, fixture.run_wc.expected_average_uv, 1e-6, 1e-5, 'full WC run');
  assert.ok(worst < 1e-5, `full run worst err ${worst}`);
});

test('R4：三种参考数值各不相同；切换参考无损（从原始数据重算）', () => {
  const { recording } = runExperiment({
    fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: NOISE, seed: 7,
  });
  const avg = reReferenceRecording(recording, { mode: 'average' });
  const inf = reReferenceRecording(recording, { mode: 'infinity' });
  const el = reReferenceRecording(recording, { mode: 'electrode', label: 'Cz' });
  // 三者两两最大差都 > 0.01 µV（实测 1.87 / 7.08 / 7.55 µV）。
  assert.ok(maxAbsDiff2D(avg.dataUv, inf.dataUv) > 0.01, 'average vs infinity must differ');
  assert.ok(maxAbsDiff2D(avg.dataUv, el.dataUv) > 0.01, 'average vs electrode must differ');
  assert.ok(maxAbsDiff2D(inf.dataUv, el.dataUv) > 0.01, 'infinity vs electrode must differ');
  // 无限远参考即原始数据；平均参考后仍能切回无限远（无损）。
  assert.deepEqual(inf.dataUv, recording.rawDataUvInfinity);
  assert.deepEqual(reReferenceRecording(avg, { mode: 'infinity' }).dataUv, recording.rawDataUvInfinity);
  // 缺原始数据时抛错，不静默反推。
  const { rawDataUvInfinity: _drop, ...bare } = recording;
  assert.throws(() => reReferenceRecording(bare, { mode: 'average' }), RangeError);
  // 参考标签进 recording。
  assert.deepEqual(el.reference, { mode: 'electrode', label: 'Cz' });
});

test('种子复现：同种子逐值相同（JSON 级），异种子不同', () => {
  const a = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: NOISE, seed: 7 });
  const b = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: NOISE, seed: 7 });
  assert.equal(JSON.stringify(b.recording), JSON.stringify(a.recording));
  assert.deepEqual(b.events, a.events);
  const c = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: NOISE, seed: 8 });
  assert.notEqual(JSON.stringify(c.recording), JSON.stringify(a.recording));
  // 无噪声时种子不影响信号（信号是确定性 ODE；种子只进噪声）。
  // 注意：两次运行的 recording.seed 元数据本身不同（99 vs 100），
  // 所以这里只比较数据，不比较全 JSON。
  const d = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: null, seed: 99 });
  const e = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: null, seed: 100 });
  assert.deepEqual(e.recording.dataUv, d.recording.dataUv);
  assert.deepEqual(e.recording.rawDataUvInfinity, d.recording.rawDataUvInfinity);
});

test('线性叠加：双源 = WC 单源 + JR 单源（同一位置/朝向）', () => {
  const pos = [0, 0, 16];
  const common = { fixture: synth, durationMs: 2000, reference: { mode: 'infinity' }, noise: null, sourcePositionMm: pos };
  const wc = runExperiment({ ...common, sourceModel: 'wc' });
  const jr = runExperiment({ ...common, sourceModel: 'jr' });
  const both = runExperiment({ ...common, sourceModel: 'both', secondSourcePositionMm: pos });
  const sum = wc.recording.dataUv.map((row, c) => row.map((v, j) => v + jr.recording.dataUv[c][j]));
  const worst = maxAbsDiff2D(both.recording.dataUv, sum);
  assert.ok(worst < 1e-9, `linearity worst err ${worst}`);
});

test('导联切换：10-20=19 导、10-10=25 导，标签与 fixture 一致，10-20 ⊆ 10-10', () => {
  assert.equal(channelsForMontage(synth, '10-20').length, 19);
  assert.equal(channelsForMontage(synth, '10-10').length, 25);
  assert.equal(channelsForMontage(synth, '10-05').length, 25);
  assert.deepEqual(channelsForMontage(synth, '10-20').map((c) => c.label), labels20);
  const run1010 = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', montage: '10-10', noise: null });
  assert.equal(run1010.recording.channels.length, 25);
  assert.equal(run1010.recording.montage, '10-10');
  const labels1010 = new Set(run1010.recording.channels.map((c) => c.label));
  assert.ok(labels20.every((l) => labels1010.has(l)), '10-20 labels must be a subset of 10-10');
  // 通道位置在 95 mm 球面上（允差 0.01 mm，与 validateSphereFixture 同口径）。
  for (const ch of run1010.recording.channels) {
    const r = Math.hypot(...ch.positionMm);
    assert.ok(Math.abs(r - 95) < 0.01, `${ch.label} radius ${r}`);
  }
});

test('事件表：2 s 只有 1 个事件；10 s 有 9 个，时间 1000–9000 ms，条件交替', () => {
  const short = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: null });
  assert.deepEqual(short.events.map((e) => [e.tMs, e.condition]), [[1000, 'standard']]);
  assert.equal(short.events[0].type, 'pulse');
  assert.equal(short.events[0].driveUnit, 'wc');
  const long = runExperiment({ fixture: synth, durationMs: 10000, sourceModel: 'wc', noise: null });
  assert.equal(long.events.length, 9);
  assert.deepEqual(long.events.map((e) => e.tMs), [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
  assert.deepEqual(
    long.events.map((e) => e.condition),
    ['standard', 'oddball', 'standard', 'oddball', 'standard', 'oddball', 'standard', 'oddball', 'standard'],
  );
  const jr = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'jr', noise: null });
  assert.equal(jr.events[0].driveUnit, 'jr');
  assert.equal(jr.events[0].drive, 120);
});

test('导出：CSV/JSON 往返无损，CSV 含元数据注释与全部通道', () => {
  const { recording } = runExperiment({ fixture: synth, durationMs: 2000, sourceModel: 'wc', noise: NOISE, seed: 7 });
  const parsed = JSON.parse(recordingToJson(recording));
  assert.deepEqual(parsed.dataUv, recording.dataUv);
  assert.deepEqual(parsed.rawDataUvInfinity, recording.rawDataUvInfinity);
  const csv = recordingToCsv(recording);
  const lines = csv.trim().split('\n');
  assert.ok(lines[0].startsWith('# forward_model_id=mne-four-layer-sphere-ras-v1'));
  assert.ok(lines[2].includes('"average"'), 'CSV must record the reference');
  assert.ok(lines[3].includes('montage=10-20'));
  assert.ok(lines[6].includes('whiteRmsUv'));
  assert.equal(lines[7], `time_ms,${labels20.join(',')}`);
  assert.equal(lines.length, 7 + 1 + 501);
  const row = lines[8].split(',').map(Number);
  assert.equal(row[0], 0);
  assert.ok(Math.abs(row[1] - recording.dataUv[0][0]) < 1e-12, 'CSV first value round-trips');
});

test('守卫：非法采样率/时长/参数抛错，不静默近似', () => {
  assert.throws(() => runExperiment({ fixture: synth, sfreqHz: 500 }), RangeError);
  assert.throws(() => runExperiment({ fixture: synth, durationMs: 1999 }), RangeError);
  assert.throws(() => runExperiment({ fixture: synth, durationMs: 1000 }), RangeError);
  assert.throws(
    () => simulateSourceMoments({
      durationMs: 2000, events: [], driveDurationMs: 100, sourceModel: 'wc',
      sourcePositionMm: [0, 0, 16], sourceNormalHead: [0, 0, 2],
      secondSourcePositionMm: [16, -16, 16], secondSourceNormalHead: [0, 0, 1],
      jrBaselineInputPerS: 90,
    }),
    RangeError,
  );
});
