/**
 * PR-15 — 双脑对照、时间机器、闭环控制 TS 测试（C 子代理）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr7/experiments.test.mjs
 *
 * 数值对照链：
 * - JR 步进器 vs `createJansenRitColumn`（预言机，同一自由运行）：
 *   逐值相同（差 0.0，实测）；本文件步进器用同一 RK4、同式导数，
 *   只是把六维状态暴露出来做快照/恢复。
 * - TS vs Python（`reference/python-model/experiments_pr7.py` 生成的
 *   `tests/pr7/fixtures/experiments-reference.json`）：自由运行 y0/q/Pz
 *   最坏差实测 8e-16（Math.exp 与 math.exp 的末位差异，随 4000 步
 *   累积），容差取绝对 1e-9（比 µV/mV 级物理效应小 9 个量级以上，
 *   不是为通过而放宽）；AB 峰差、ERP 峰差、PID 指标、阈值触发时刻、
 *   分支分叉量、适应驱动、误触发率逐项对照，容差 1e-9 或精确相等。
 * - 源定位对照：球形正向模型 `app/public/forward-assets/sphere-model.json`
 *   由 CI/本地生成（`~/workspace/eeg-venv/bin/python
 *   scientific/forward/generate_sphere_model.py`），缺失时按 PR6 同款
 *   报错退出，不静默跳过。
 * - 60 s 稳定性：闭环阈值控制跑满 60 s，y0 有界、不发散（实测
 *   max|y0| = 0.158 mV，运行约 0.2 s）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createJansenRitColumn, DEFAULT_JANSEN_RIT_PARAMS } from '../../app/src/lib/jansenRitColumn.ts';
import { welchPsd } from '../../app/src/lib/signalProcessing.ts';
import {
  compareBranches,
  compareControlVsNoControl,
  compareLocalization,
  compareRuns,
  goertzelPower,
  indexedGaussian,
  runAB,
  runClosedLoop,
  runSingleExperiment,
  simulatePidStepResponse,
  splitmix32Uniform,
  TimeMachine,
} from '../../app/src/lib/experiments.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr7/fixtures/experiments-reference.json'), 'utf8'),
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

const FREE_CFG = {
  durationMs: 2000,
  events: [{ tMs: 1000, drivePerS: 120, durationMs: 100 }],
};
const THR_CFG = {
  base: {
    durationMs: 3000,
    events: [{ tMs: 1000, drivePerS: 300, durationMs: 100 }],
  },
  feature: { kind: 'instant' },
  controller: 'threshold',
  threshold: { threshold: 0.1, outputPerS: -80 },
  measurementNoiseRmsUv: 0.02,
  noiseSeed: 7,
};

function maxAbsDiff(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/* ── 步进器与确定性 ─────────────────────────────────────────────────── */

test('JR 步进器 vs createJansenRitColumn 预言机：同一自由运行逐值相同（差 0.0）', () => {
  const col = createJansenRitColumn(DEFAULT_JANSEN_RIT_PARAMS);
  const run = runSingleExperiment(FREE_CFG);
  let maxDy0 = 0;
  let maxDq = 0;
  for (let i = 0; i <= 4000; i++) {
    if (i > 0) col.step((i - 1) * 0.5 >= 1000 && (i - 1) * 0.5 < 1100 ? 120 : 0);
    const s = col.read();
    maxDy0 = Math.max(maxDy0, Math.abs(s.y0 - run.y0Mv[i]));
    maxDq = Math.max(maxDq, Math.abs(s.equivalentMomentNAm - run.qNAm[i]));
  }
  assert.equal(maxDy0, 0, `y0 oracle diff ${maxDy0}`);
  assert.equal(maxDq, 0, `q oracle diff ${maxDq}`);
});

test('确定性：同配置两次运行逐值相同（JSON 级相等）', () => {
  const a = runSingleExperiment(FREE_CFG);
  const b = runSingleExperiment(FREE_CFG);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c1 = runClosedLoop(THR_CFG);
  const c2 = runClosedLoop(THR_CFG);
  assert.equal(JSON.stringify(c1), JSON.stringify(c2));
});

test('TS vs Python：自由运行 y0/q/Pz 与 fixture 一致（实测最坏差 8e-16，容差 1e-9）', () => {
  const run = runSingleExperiment(FREE_CFG);
  const fr = fixture.free_run;
  assert.equal(run.timesMs4.length, fr.times_ms4.length);
  const wY0 = maxAbsDiff(run.y0Mv.filter((_, i) => i % 8 === 0), fr.y0_4ms);
  const wQ = maxAbsDiff(run.qNAm.filter((_, i) => i % 8 === 0), fr.q_nAm_4ms);
  const wE = maxAbsDiff(run.eegUvPz, fr.eeg_uv_pz);
  assert.ok(wY0 < 1e-9, `y0 worst ${wY0}`);
  assert.ok(wQ < 1e-9, `q worst ${wQ}`);
  assert.ok(wE < 1e-9, `eeg worst ${wE}`);
});

test('确定性噪声：splitmix32 哈希与 Python 同式（序号索引，恢复后重跑逐值相同）', () => {
  // Python 同种子同序号的值（见 test_experiments.py 的同一断言）。
  assert.ok(Math.abs(splitmix32Uniform(7, 0) - 0.13706416846252978) < 1e-12);
  assert.ok(Math.abs(indexedGaussian(7, 0) - (-1.9002125408373438)) < 1e-12);
});

/* ── 双脑 A/B ───────────────────────────────────────────────────────── */

test('双脑同配置 → 比较输出逐值相同（差 0.0）', () => {
  const { comparison } = runAB(FREE_CFG, FREE_CFG);
  assert.equal(comparison.sharedTimesMs, true);
  assert.equal(comparison.maxAbsY0DiffMv, 0);
  assert.equal(comparison.meanAbsY0DiffMv, 0);
  assert.equal(comparison.peakY0DiffMv, 0);
  assert.equal(comparison.rmsEegDiffUv, 0);
  assert.equal(comparison.psdPeakShiftHz, 0);
  assert.equal(comparison.erpPeakDiffUv, 0);
});

test('双脑改一个条件（驱动 120 → 300 1/s）→ 量化差异，与 Python fixture 一致', () => {
  const { comparison } = runAB(
    FREE_CFG,
    { durationMs: 2000, events: [{ tMs: 1000, drivePerS: 300, durationMs: 100 }] },
  );
  const fx = fixture.ab_comparison;
  assert.ok(Math.abs(comparison.peakY0DiffMv - fx.peak_y0_diff_mv) < 1e-9,
    `peakY0 diff ${comparison.peakY0DiffMv} vs ${fx.peak_y0_diff_mv}`);
  assert.ok(Math.abs(comparison.erpPeakDiffUv - fx.erp_peak_diff_uv) < 1e-9,
    `ERP peak diff ${comparison.erpPeakDiffUv} vs ${fx.erp_peak_diff_uv}`);
  assert.ok(comparison.maxAbsY0DiffMv > 0.005, `max diff ${comparison.maxAbsY0DiffMv} should be visible`);
  assert.ok(Math.abs(comparison.psdPeakHzA - fx.psd_peak_hz_a) < 1e-9);
  assert.ok(Math.abs(comparison.psdPeakHzB - fx.psd_peak_hz_b) < 1e-9);
});

test('双脑 PSD 峰移：p0=220 极限环 alpha 峰 10.99 Hz；p0=90 基线是平坦不动点、无振荡', () => {
  const lc = runSingleExperiment({ durationMs: 12000, baselineInputPerS: 220, limitCycle: true });
  const base = runSingleExperiment({ durationMs: 12000, baselineInputPerS: 90 });
  const segOf = (run) => run.y0Mv.filter((_, i) => run.timesMs[i] >= 2000 && i % 8 === 0);
  const segLc = segOf(lc);
  const segBase = segOf(base);
  // 基线是平坦不动点：沉降段方差 ~0（PSD 峰对平坦信号无意义，不作峰位置断言）。
  const variance = (xs) => {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    return xs.reduce((s, v) => s + (v - m) * (v - m), 0) / xs.length;
  };
  assert.ok(variance(segBase) < 1e-12, `baseline variance ${variance(segBase)} mV²`);
  // 极限环 y0 振幅小（标准差约 0.013 mV），但周期明确：方差实测 1.7e-4 mV²。
  assert.ok(variance(segLc) > 1e-5, `limit-cycle variance ${variance(segLc)} mV²`);
  const m = segLc.reduce((s, v) => s + v, 0) / segLc.length;
  const { freqsHz, psd } = welchPsd(segLc.map((v) => v - m), 250, { nFft: 1024 });
  let best = 0;
  let bestP = -Infinity;
  for (let i = 0; i < freqsHz.length; i++) {
    if (freqsHz[i] >= 1 && psd[i] > bestP) {
      bestP = psd[i];
      best = freqsHz[i];
    }
  }
  assert.ok(best >= 10 && best <= 12, `limit-cycle peak ${best} Hz`);
});

test('源定位对照：深源 [16,16,16] MNE 误差 55.4 mm vs 浅源 [48,48,48] 0 mm（深度偏置量化）', () => {
  const loc = compareLocalization(
    sphere,
    '10-20',
    { positionMm: [16, 16, 16], momentNAm: [0, 10, 5] },
    { positionMm: [48, 48, 48], momentNAm: [0, 10, 5] },
  );
  assert.equal(loc.dipoleErrorDiffMm, 0, 'dipole fit recovers both on-grid sources exactly');
  assert.ok(loc.a.mne.localizationErrorMm > 50, `deep MNE error ${loc.a.mne.localizationErrorMm}`);
  assert.equal(loc.b.mne.localizationErrorMm, 0, 'shallow MNE error');
  assert.ok(loc.mneErrorDiffMm < -50, `MNE error diff ${loc.mneErrorDiffMm}`);
  assert.ok(loc.mneSpreadDiffMm < -30, `spread diff ${loc.mneSpreadDiffMm}`);
});

/* ── 时间机器 ───────────────────────────────────────────────────────── */

test('单步：一次一个 dt（0.5 ms）；暂停时不推进；stepTo 到达目标时刻', () => {
  const tm = new TimeMachine(FREE_CFG);
  assert.equal(tm.timeMs, 0);
  tm.step();
  assert.equal(tm.timeMs, 0.5);
  tm.stepN(3);
  assert.equal(tm.timeMs, 2);
  tm.pause();
  assert.equal(tm.step(), null);
  assert.equal(tm.timeMs, 2);
  tm.resume();
  tm.stepTo(100);
  assert.equal(tm.timeMs, 100);
});

test('快照恢复往返：JSON 序列化后恢复、重跑，与原轨迹逐值相同（差 0.0）', () => {
  const tm = new TimeMachine(FREE_CFG);
  tm.stepTo(2000);
  const snap = tm.getHistory().find((s) => Math.abs(s.tMs - 1000) < 1e-9);
  assert.ok(snap, 'snapshot at 1000 ms exists');
  const snapJson = JSON.parse(JSON.stringify(snap));
  const tm2 = new TimeMachine(FREE_CFG);
  tm2.restore(snapJson);
  tm2.stepTo(2000);
  const h1 = tm.getHistory().filter((s) => s.tMs >= 1000 - 1e-9);
  const h2 = tm2.getHistory().filter((s) => s.tMs >= 1000 - 1e-9);
  assert.equal(h1.length, h2.length);
  let md = 0;
  for (let i = 0; i < h1.length; i++) md = Math.max(md, Math.abs(h1[i].readout.y0 - h2[i].readout.y0));
  assert.equal(md, 0, `branch-point replay diff ${md}`);
  // 恢复点快照本身在历史里（restore 补进）。
  assert.ok(tm2.getHistory().some((s) => Math.abs(s.tMs - 1000) < 1e-9));
});

test('回放来自真实保存的状态：replay 的快照值等于同一运行的 y0', () => {
  const tm = new TimeMachine(FREE_CFG);
  tm.stepTo(2000);
  const run = runSingleExperiment(FREE_CFG);
  assert.equal(tm.getHistory().length, 201, 'snapshots every 10 ms over 2000 ms');
  const seg = tm.replay(900, 1100);
  assert.equal(seg.length, 21);
  for (const s of seg) {
    const idx = Math.round(s.tMs / 0.5);
    assert.equal(s.readout.y0, run.y0Mv[idx], `replay y0 at ${s.tMs} ms`);
    assert.equal(s.readout.qNAm, run.qNAm[idx]);
  }
});

test('分支比较：分支点之前差 0.0，改驱动后分叉量与 Python 一致（约 0.0776 mV）', () => {
  const tm = new TimeMachine(FREE_CFG);
  tm.stepTo(2000);
  const snap = tm.getHistory().find((s) => Math.abs(s.tMs - 1000) < 1e-9);
  const forked = tm.fork(snap, {
    events: [{ tMs: 1000, drivePerS: 300, durationMs: 100 }],
  });
  forked.stepTo(2000);
  const a = runSingleExperiment(FREE_CFG);
  const b = runSingleExperiment({
    durationMs: 2000,
    events: [{ tMs: 1000, drivePerS: 300, durationMs: 100 }],
  });
  // fork 的机器与“从头按新配置跑”在分支点后也应逐值相同（同一确定性重算）。
  const cmp = compareBranches(a, b, 1000);
  assert.equal(cmp.maxAbsY0DiffBeforeMv, 0, 'before branch point');
  // 全轨迹（0.5 ms 网格）的分叉量与 Python 的 10 ms 快照采样分叉量
  // 差约 5e-5 mV——是采样网格不同，不是模型差异；容差取 1e-3 mV。
  assert.ok(Math.abs(cmp.maxAbsY0DiffAfterMv - fixture.branch.diverge_max_diff_mv) < 1e-3,
    `diverge ${cmp.maxAbsY0DiffAfterMv} vs ${fixture.branch.diverge_max_diff_mv}`);
  assert.ok(cmp.maxAbsEegDiffAfterUv > 0.005, 'EEG diverges after branch');
  // 同网格对照：两台时间机器的 10 ms 快照历史逐点比，与 Python fixture
  // 的分叉量一致到 1e-9（同一采样口径）。
  const hF = forked.getHistory().filter((s) => s.tMs >= 1000 - 1e-9);
  const hO = tm.getHistory().filter((s) => s.tMs >= 1000 - 1e-9);
  assert.equal(hF.length, hO.length);
  let md = 0;
  for (let i = 0; i < hF.length; i++) md = Math.max(md, Math.abs(hF[i].readout.y0 - hO[i].readout.y0));
  assert.ok(Math.abs(md - fixture.branch.diverge_max_diff_mv) < 1e-9,
    `snapshot-grid diverge ${md} vs ${fixture.branch.diverge_max_diff_mv}`);
  // fork 的历史前缀与原机器逐值相同。
  const hFork = forked.getHistory().filter((s) => s.tMs <= 1000 + 1e-9);
  const hOrig = tm.getHistory().filter((s) => s.tMs <= 1000 + 1e-9);
  assert.equal(hFork.length, hOrig.length);
  for (let i = 0; i < hFork.length; i++) {
    assert.equal(hFork[i].readout.y0, hOrig[i].readout.y0);
  }
});

test('跨试次适应：重复驱动下有效驱动逐次衰减（300 → 177 → 127 → 106 → 98 1/s）', () => {
  const adapt = runSingleExperiment({
    durationMs: 2000,
    events: [0, 1, 2, 3, 4].map((k) => ({ tMs: 1000 + 200 * k, drivePerS: 300, durationMs: 40 })),
    adaptation: { utilization: 0.5, tauRecMs: 1000 },
  });
  const fx = fixture.adaptation.effective_drives_per_s;
  assert.equal(adapt.effectiveDrivesPerS.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.ok(Math.abs(adapt.effectiveDrivesPerS[i] - fx[i]) < 1e-9,
      `drive[${i}] ${adapt.effectiveDrivesPerS[i]} vs ${fx[i]}`);
  }
  for (let i = 1; i < 5; i++) {
    assert.ok(adapt.effectiveDrivesPerS[i] < adapt.effectiveDrivesPerS[i - 1], 'strictly decreasing');
  }
  assert.ok(adapt.effectiveDrivesPerS[4] < 150, '5th drive strongly depressed');
});

/* ── 闭环 ───────────────────────────────────────────────────────────── */

test('Goertzel 标定：幅值 5 µV 的 10 Hz 纯正弦功率 = 12.5 µV²', () => {
  const xs = Array.from({ length: 500 }, (_, i) => 5 * Math.sin((2 * Math.PI * 10 * i) / 250));
  const p = goertzelPower(xs, 10, 250);
  assert.ok(Math.abs(p - 12.5) < 1e-9, `goertzel power ${p}`);
});

test('PID 阶跃响应收敛：超调 0%、安定 388 ms、稳态误差 ~0（与 Python 一致）', () => {
  const r = simulatePidStepResponse(
    { pid: { kp: 2, ki: 10, kd: 0, setpoint: 1 }, plantTauMs: 200, durationMs: 3000 },
  );
  const fx = fixture.pid_step;
  assert.ok(Math.abs(r.overshootPct - fx.overshoot_pct) < 1e-9, `overshoot ${r.overshootPct}`);
  assert.equal(r.settlingTimeMs, fx.settling_time_ms);
  assert.ok(Math.abs(r.steadyStateError) < 1e-6, `steady err ${r.steadyStateError}`);
});

test('闭环阈值在预期时刻触发：首触发 1044 ms、时延 44 ms（与 Python 一致）', () => {
  const r = runClosedLoop(THR_CFG);
  const fx = fixture.threshold;
  assert.equal(r.metrics.firstTriggerMs, fx.first_trigger_ms);
  assert.equal(r.metrics.responseLatencyMs, fx.response_latency_ms);
  assert.ok(Math.abs(r.metrics.triggerFraction - fx.trigger_fraction) < 1e-9);
  assert.ok(Math.abs(r.metrics.maxAbsEegUv - fx.max_abs_eeg_uv) < 1e-9);
  assert.equal(r.metrics.diverged, false);
});

test('延迟 40 ms：首触发时刻恰好后移 40 ms（1044 → 1084 ms）', () => {
  const r = runClosedLoop({ ...THR_CFG, delayMs: 40 });
  assert.equal(r.metrics.firstTriggerMs, 1084);
  assert.equal(r.metrics.responseLatencyMs, 84);
  assert.equal(r.metrics.delayMs, 40);
});

test('有控制 vs 无控制：阈值抑制使 RMS 与峰值都下降（与 Python 一致）', () => {
  const { rmsEegDiffUv, peakEegDiffUv, noControl, controlled } = compareControlVsNoControl(
    THR_CFG.base,
    {
      feature: { kind: 'instant' },
      controller: 'threshold',
      threshold: { threshold: 0.1, outputPerS: -80 },
      measurementNoiseRmsUv: 0.02,
      noiseSeed: 7,
    },
  );
  const fx = fixture.control_vs_no_control;
  assert.ok(Math.abs(rmsEegDiffUv - fx.rms_eeg_diff_uv) < 1e-9, `rms diff ${rmsEegDiffUv}`);
  assert.ok(Math.abs(peakEegDiffUv - fx.peak_eeg_diff_uv) < 1e-9, `peak diff ${peakEegDiffUv}`);
  assert.ok(rmsEegDiffUv < 0, 'controlled RMS below no-control');
  assert.ok(peakEegDiffUv < 0, 'controlled peak below no-control');
  assert.equal(noControl.metrics.triggerFraction, 0);
  assert.ok(controlled.metrics.triggerFraction > 0.02);
});

test('纯噪声输入的误触发率：建窗后 0.34%（< 1%）；全程 2% 来自前 252 ms 建窗期', () => {
  const r = runClosedLoop({
    base: { durationMs: 5000 },
    feature: { kind: 'alphaPower' },
    controller: 'threshold',
    threshold: { threshold: 0.05, outputPerS: -80 },
    measurementNoiseRmsUv: 0.5,
    noiseSeed: 7,
  });
  const fx = fixture.noise_only;
  assert.ok(Math.abs(r.metrics.triggerFraction - fx.trigger_fraction) < 1e-9);
  const post = r.triggered.filter((_, i) => r.timesMs[i] >= 300);
  const postFrac = post.filter(Boolean).length / post.length;
  assert.ok(Math.abs(postFrac - fx.post_warmup_trigger_fraction) < 1e-9, `post-warmup ${postFrac}`);
  assert.ok(postFrac < 0.01, `post-warmup false trigger rate ${postFrac} should be < 1%`);
});

test('60 s 稳定性有界：闭环阈值跑满 60 s，y0 不发散（max|y0| = 0.158 mV）', () => {
  const r = runClosedLoop({
    base: {
      durationMs: 60000,
      events: [{ tMs: 1000, drivePerS: 300, durationMs: 100 }],
    },
    feature: { kind: 'instant' },
    controller: 'threshold',
    threshold: { threshold: 0.1, outputPerS: -80 },
    measurementNoiseRmsUv: 0.02,
    noiseSeed: 7,
  });
  assert.equal(r.metrics.diverged, false);
  assert.ok(r.metrics.maxAbsY0Mv < 1, `max|y0| ${r.metrics.maxAbsY0Mv} mV over 60 s`);
  assert.ok(r.timesMs[r.timesMs.length - 1] === 60000, 'ran the full 60 s');
});

/* ── 配置校验 ───────────────────────────────────────────────────────── */

test('配置校验：非法时长/越界事件/缺控制器参数时抛错', () => {
  assert.throws(() => runSingleExperiment({ durationMs: 1000.3 }), RangeError);
  assert.throws(
    () => runSingleExperiment({ durationMs: 1000, events: [{ tMs: 950, drivePerS: 100, durationMs: 100 }] }),
    RangeError,
  );
  assert.throws(
    () => runClosedLoop({ base: { durationMs: 1000 }, controller: 'threshold' }),
    RangeError,
  );
  assert.throws(
    () => runClosedLoop({ base: { durationMs: 1000 }, controller: 'pid' }),
    RangeError,
  );
  assert.throws(() => runClosedLoop({ base: { durationMs: 1000 }, delayMs: 6 }), RangeError);
});
