/**
 * PR6 (B2) — WAVES / ERP 方法学测试：JR alpha 实测、晚期机制、oddball
 * 实验 + MNE 口径 ERP 管线。
 *
 * 跑法：node --experimental-strip-types --test tests/pr6/waves-erp.test.mjs
 *
 * 数值对照：
 * - TS RK4（dt=0.5 ms）vs Python DOP853 fixture
 *   `tests/pr6/fixtures/late-response-reference.json`
 *   （`scientific/eeg/late_response_reference.py` 生成）：y0 与 q 的
 *   最大逐点差 <1e-6（mV / nA·m；PR5 实测 RK4–DOP853 差最大 4.6e-7 mV，
 *   本机制的慢核平滑，误差同量级；容差不为通过而放宽）。
 * - Alpha 峰：Welch（nFft=1024，df≈0.244 Hz）与 Python scipy Welch
 *   同口径（周期 Hann、50% 重叠、每段不去均值；调用方先减均值，
 *   与 Python 的 seg−mean 一致），峰位允差 ±0.3 Hz（约一格 bin）。
 * - ERP 形态数（峰值/潜伏期/窗均值）与 Python `erp_metrics` 同窗
 *   同口径，允差 0.005 µV / 4 ms（采样网格）。
 * - 幅度差距不断言“通过”：oddball 峰 0.17 µV  vs 真实 8.89 µV
 *   是结构性缺口，测试只断言它**没有被重缩放修掉**（见守卫测试）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_LATE_RESPONSE_PARAMS,
  LATE_RESPONSE_ID,
  ODDBALL_DRIVE_PER_S,
  PZ_GAIN_UV_PER_NAM,
  STANDARD_DRIVE_PER_S,
  analyseErp,
  detectLatch,
  differenceWaveErp,
  epochOddballExperiment,
  filterEpochsByCondition,
  runAlphaLimitCycle,
  runOddballExperiment,
  simulateLateTrial,
  validateLateResponseParams,
} from '../../app/src/lib/lateResponse.ts';
import { bandPowers, peakInWindow, welchPsd } from '../../app/src/lib/signalProcessing.ts';
import { PUBLIC_EEG_CONSTRAINT } from '../../app/src/lib/publicEegConstraint.ts';
import { DEFAULT_MORPHOLOGY } from '../../app/src/lib/localCorticalColumn.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr6/fixtures/late-response-reference.json'), 'utf8'),
);
const constraint = JSON.parse(
  readFileSync(join(root, 'scientific/forward/public_eeg_reference_values.json'), 'utf8'),
);

function assertCloseArray(a, b, atol, label) {
  assert.equal(a.length, b.length, `${label}: length ${a.length} vs ${b.length}`);
  let worst = 0;
  for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
  assert.ok(worst <= atol, `${label}: max abs diff ${worst} > ${atol}`);
  return worst;
}

function mean(xs) {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

/** Welch alpha 峰（8–13 Hz 内）与频段占比（占五个频段功率之和）。 */
function alphaPeakAndShares(x, sfreqHz = 250) {
  const m = mean(x);
  const xc = x.map((v) => v - m);
  const { freqsHz, psd } = welchPsd(xc, sfreqHz, { nFft: 1024 });
  const bands = bandPowers(freqsHz, psd);
  let peakHz = 0;
  let peakPsd = -1;
  for (let i = 0; i < freqsHz.length; i++) {
    if (freqsHz[i] >= 8 && freqsHz[i] <= 13 && psd[i] > peakPsd) {
      peakPsd = psd[i];
      peakHz = freqsHz[i];
    }
  }
  const total = bands.delta + bands.theta + bands.alpha + bands.beta + bands.gamma;
  const shares = {};
  for (const k of Object.keys(bands)) shares[k] = bands[k] / total;
  return { peakHz, shares, rms: Math.sqrt(mean(xc.map((v) => v * v))) };
}

/* ── PR-08：JR p0=220 alpha 极限环 ─────────────────────────────────── */

test('PR-08 alpha：JR p0=220 极限环的 y0 与 Pz Welch 峰都在 alpha 频段内', () => {
  const alpha = runAlphaLimitCycle();
  assert.equal(alpha.timesMs.length, 2501, '10 s settled record at 250 Hz (2000..12000 ms incl.)');
  const y0 = alphaPeakAndShares(alpha.y0Mv);
  const pz = alphaPeakAndShares(alpha.pzUv);
  // 与 Python scipy Welch 同口径（fixture 值）：10.986 Hz。
  assert.ok(
    Math.abs(y0.peakHz - fixture.alpha_limit_cycle.y0_alpha_peak_hz) <= 0.3,
    `y0 alpha peak ${y0.peakHz} Hz vs Python ${fixture.alpha_limit_cycle.y0_alpha_peak_hz} Hz`,
  );
  assert.ok(
    Math.abs(pz.peakHz - fixture.alpha_limit_cycle.pz_alpha_peak_hz) <= 0.3,
    `Pz alpha peak ${pz.peakHz} Hz vs Python ${fixture.alpha_limit_cycle.pz_alpha_peak_hz} Hz`,
  );
  // 与 ds003061 实测对照（Pz 10.00 Hz / Oz 9.25 Hz）：模型峰 10.99 Hz，
  // 偏差 +0.99 Hz（Pz）/+1.74 Hz（Oz）——频率对上量级，未精确对上。
  const realPz = constraint.measured.psd.channels.Pz.alpha_band_peak_hz_4_13;
  const realOz = constraint.measured.psd.channels.Oz.alpha_band_peak_hz_4_13;
  assert.ok(Math.abs(y0.peakHz - realPz) < 1.5, `model ${y0.peakHz} vs real Pz ${realPz}`);
  assert.ok(y0.peakHz >= 8 && y0.peakHz <= 13, 'peak inside the alpha band');
  // 纯极限环：alpha 占 1–40 Hz 功率的 ~99.8%（Python）；真实 Pz 只有
  // 30.3%（有宽带背景），模型无背景噪声，故占比虚高——如实记录，不修。
  assert.ok(y0.shares.alpha > 0.9, `y0 alpha share ${y0.shares.alpha}`);
  assert.ok(pz.shares.alpha > 0.9, `Pz alpha share ${pz.shares.alpha}`);
  // Pz RMS 0.017 µV vs 真实基线 RMS 6.07 µV：幅度仍差 ~360 倍（单源、无背景）。
  assert.ok(
    Math.abs(pz.rms - fixture.alpha_limit_cycle.pz_rms_uv) / fixture.alpha_limit_cycle.pz_rms_uv < 0.1,
    `Pz RMS ${pz.rms} vs Python ${fixture.alpha_limit_cycle.pz_rms_uv}`,
  );
  assert.ok(pz.rms < 0.1, `Pz RMS ${pz.rms} uV is orders below real baseline 6.07 uV`);
  // 其余频段只是同一份信号的读数：没有为每个频段编造节律。
  assert.ok(y0.shares.delta < 0.05 && y0.shares.theta < 0.05, 'no spurious low-band rhythm');
});

test('PR-08 alpha：p0=220 极限环不是不动点（平衡例程应大声失败）', async () => {
  const { equilibrateJansenRit } = await import('../../app/src/lib/jansenRitColumn.ts');
  const { DEFAULT_JANSEN_RIT_PARAMS } = await import('../../app/src/lib/jansenRitColumn.ts');
  assert.throws(
    () => equilibrateJansenRit({ ...DEFAULT_JANSEN_RIT_PARAMS, baselineInputPerS: 220 }),
    /No stable physical equilibrium/,
  );
});

/* ── 晚期机制：TS RK4 vs Python DOP853 ─────────────────────────────── */

test('晚期机制：TS RK4 vs Python DOP853 逐点对照 <1e-6（oddball 试次）', () => {
  const trial = simulateLateTrial(ODDBALL_DRIVE_PER_S, { tEndMs: 800 });
  const fx = fixture.oddball_trial;
  assert.deepEqual(trial.timesMs, fx.t_ms);
  const dY0 = assertCloseArray(trial.y0Mv, fx.y0_mv, 1e-6, 'y0');
  const dQ = assertCloseArray(trial.qNAm, fx.q_nAm, 1e-6, 'q');
  const dPz = assertCloseArray(trial.pzUv, fx.pz_uv, 1e-6, 'pz');
  assert.ok(dY0 < 1e-6 && dQ < 1e-6 && dPz < 1e-6);
  assertCloseArray(trial.slowRPerS, fx.slow_r_per_s, 1e-6, 'slow r');
  assert.equal(trial.latched, false, 'default oddball trial returns to baseline');
});

/* ── 晚期机制：形态数（oddball 选择性晚期成分）────────────────────── */

test('晚期机制：oddball 在 300–500 ms 窗内有正成分，standard 基本没有', () => {
  const odd = simulateLateTrial(ODDBALL_DRIVE_PER_S, { tEndMs: 2000 });
  const std = simulateLateTrial(STANDARD_DRIVE_PER_S, { tEndMs: 2000 });
  const mOdd = peakInWindow(odd.timesMs, odd.pzUv, [250, 600]);
  const mStd = peakInWindow(std.timesMs, std.pzUv, [250, 600]);
  const wOdd = peakInWindow(odd.timesMs, odd.pzUv, [300, 500]);
  const wStd = peakInWindow(std.timesMs, std.pzUv, [300, 500]);
  // 与 Python erp_metrics 同窗：oddball 峰 0.174 µV @352 ms、窗均值 0.0697 µV。
  assert.ok(Math.abs(mOdd.peakUv - 0.174) < 0.005, `odd peak ${mOdd.peakUv}`);
  assert.ok(Math.abs(mOdd.latencyMs - 352) <= 4, `odd latency ${mOdd.latencyMs}`);
  assert.ok(Math.abs(wOdd.windowMeanUv - 0.0697) < 0.005, `odd window mean ${wOdd.windowMeanUv}`);
  // standard 窗均值 <0.02 µV；oddball 选择性 >5 倍。
  assert.ok(wStd.windowMeanUv < 0.02, `std window mean ${wStd.windowMeanUv}`);
  assert.ok(
    wOdd.windowMeanUv / Math.max(wStd.windowMeanUv, 1e-9) > 5,
    `odd/std window-mean ratio ${wOdd.windowMeanUv / wStd.windowMeanUv}`,
  );
  // 早期峰不受慢机制影响：两者 250 ms 前的峰都在 PR5 的 JR 量级（~0.17 µV）。
  assert.equal(odd.latched, false, 'oddball returns to baseline by 2000 ms');
  assert.equal(std.latched, false, 'standard returns to baseline by 2000 ms');
  void mStd;
});

test('晚期机制守卫：增益过大锁存会被 detectLatch 检出；参数校验拒绝非法值', () => {
  const latched = simulateLateTrial(ODDBALL_DRIVE_PER_S, {
    tEndMs: 2000,
    lateParams: { ...DEFAULT_LATE_RESPONSE_PARAMS, slowGain: 6 },
  });
  assert.equal(latched.latched, true, 'gain 6 latches (upper-branch visit does not return)');
  assert.ok(detectLatch(latched.qNAm, latched.timesMs), 'detectLatch flags the gain-6 run');
  const safe = simulateLateTrial(ODDBALL_DRIVE_PER_S, { tEndMs: 2000 });
  assert.equal(detectLatch(safe.qNAm, safe.timesMs), false, 'default gain 2.5 does not latch');
  assert.throws(() => validateLateResponseParams({ ...DEFAULT_LATE_RESPONSE_PARAMS, tauSlowMs: 5 }));
  assert.throws(() => validateLateResponseParams({ ...DEFAULT_LATE_RESPONSE_PARAMS, slowGain: -1 }));
  assert.throws(() => validateLateResponseParams({ ...DEFAULT_LATE_RESPONSE_PARAMS, delayMs: 600 }));
  assert.throws(() => simulateLateTrial(1500), /pulsePerS/);
});

test('非辨识性守卫：Pz 增益是 PR5 中央值，不按实测/模型比值重缩放；幅度缺口未被修掉', () => {
  assert.equal(PZ_GAIN_UV_PER_NAM, 0.16, 'Pz gain is the PR5 central value, not a fit');
  assert.equal(PUBLIC_EEG_CONSTRAINT.p300PeakUvAtPz, 8.89);
  // 形态学乘积是自由尺度（翻倍 N 即翻倍 q），不是拟合参数。
  const base = simulateLateTrial(ODDBALL_DRIVE_PER_S, { tEndMs: 800 });
  const doubled = simulateLateTrial(ODDBALL_DRIVE_PER_S, {
    tEndMs: 800,
    morphology: { ...DEFAULT_MORPHOLOGY, effectivePyramidalCells: 2_000_000 },
  });
  const peakBase = peakInWindow(base.timesMs, base.pzUv, [250, 600]).peakUv;
  const peakDoubled = peakInWindow(doubled.timesMs, doubled.pzUv, [250, 600]).peakUv;
  assert.ok(Math.abs(peakDoubled / peakBase - 2) < 1e-9, 'doubling N doubles the output (free scale)');
  // 缺口如实保留：默认形态学下 oddball 峰 0.17 µV，远低于真实 8.89 µV。
  assert.ok(peakBase < 0.5, `model oddball peak ${peakBase} uV is far below real 8.89 uV (gap NOT rescaled away)`);
});

/* ── PR-09：oddball 实验 + MNE 口径 ERP ───────────────────────────── */

test('PR-09 事件系统：仿真时钟时间戳、条件、驱动、参数快照', () => {
  const { recording, events, paramsSnapshot } = runOddballExperiment({ nTrials: 40 });
  assert.equal(events.length, 40);
  assert.equal(events.filter((e) => e.condition === 'oddball').length, 8);
  assert.equal(events.filter((e) => e.condition === 'standard').length, 32);
  events.forEach((e, k) => {
    assert.equal(e.id, k);
    assert.equal(e.tMs, k * 1000, 'sim-clock timestamp (cumulative ISI), not wall clock');
    assert.equal(e.driveUnit, 'jr');
    assert.equal(e.drive, e.condition === 'oddball' ? 300 : 120);
  });
  assert.equal(recording.sfreqHz, 250);
  assert.equal(recording.channels.length, 1);
  assert.equal(recording.channels[0].label, 'Pz');
  assert.equal(recording.timesMs.length, 250 * 40 + 1);
  assert.equal(recording.sourceModelId, LATE_RESPONSE_ID);
  assert.equal(recording.noise, null, 'default run has no measurement noise');
  assert.equal(paramsSnapshot.pzGainUvPerNAm, 0.16);
  assert.equal(paramsSnapshot.lateParams.slowGain, 2.5);
  assert.equal(paramsSnapshot.protocol.isiMs, 1000);
});

test('PR-09 ERP：MNE 口径分段/基线/平均/峰值/差异波', () => {
  const { recording, events } = runOddballExperiment({ nTrials: 40 });
  const epochs = epochOddballExperiment(recording, events);
  assert.equal(epochs.timesMs.length, 251, '-200..800 ms at 250 Hz');
  assert.equal(epochs.trials.length, 40, 'no rejection without noise/artifacts');
  assert.ok(epochs.kept.every(Boolean));
  assert.deepEqual(epochs.baselineMs, [-200, 0]);
  const oddEp = filterEpochsByCondition(epochs, 'oddball');
  const stdEp = filterEpochsByCondition(epochs, 'standard');
  assert.equal(oddEp.trials.length, 8);
  assert.equal(stdEp.trials.length, 32);
  const odd = analyseErp(oddEp, 'Pz');
  const std = analyseErp(stdEp, 'Pz');
  assert.equal(odd.n, 8);
  assert.equal(std.n, 32);
  assert.ok(Math.abs(odd.peakUv - 0.174) < 0.005, `odd ERP peak ${odd.peakUv}`);
  assert.ok(Math.abs(odd.peakLatencyMs - 352) <= 4, `odd ERP latency ${odd.peakLatencyMs}`);
  assert.ok(Math.abs(odd.windowMeanUv - 0.0697) < 0.005, `odd ERP window mean ${odd.windowMeanUv}`);
  assert.ok(std.windowMeanUv < 0.02, `std ERP window mean ${std.windowMeanUv}`);
  // 确定性试次（无噪声）→ SEM 应为 0（数值上 <1e-3 µV）。严格为 0
  // 不成立：相邻 epoch 在 800/−200 ms 边界点共享一个采样点，末试次
  // 的该点取自试次自身、其余试次取自下一试次的基线，两端都在静息态、
  // 差 ~1e-4 µV——约定使然，不是试次变异（见 lateResponse.ts）。
  let maxSem = 0;
  for (const row of odd.semUv) for (const v of row) maxSem = Math.max(maxSem, Math.abs(v));
  assert.ok(maxSem < 1e-3, `noiseless max SEM ${maxSem} uV (boundary convention only)`);
  const diff = differenceWaveErp(odd, std, 0);
  assert.ok(Math.abs(diff.peakUv - (odd.peakUv - std.peakUv)) < 0.02, `diff peak ${diff.peakUv}`);
  assert.ok(diff.windowMeanUv > 0.05, `diff window mean ${diff.windowMeanUv}`);
  assert.ok(diff.peakLatencyMs >= 250 && diff.peakLatencyMs <= 600);
  // 与 ds003061 同窗对照：真实差异波峰 9.14 µV @414 ms；模型 0.16 µV——形态对、幅度差 50 倍以上。
  const realDiff = constraint.measured.erp.difference_oddball_minus_standard.Pz;
  assert.equal(realDiff.p300_window_peak_uv, 9.14);
  assert.ok(diff.peakUv < 0.5, 'model difference wave far below real 9.14 uV (gap kept, not rescaled)');
  assert.throws(() => analyseErp(oddEp, 'Cz'), /not in EpochSet/);
  assert.throws(() => differenceWaveErp({ ...odd, channel: 'Cz' }, std, 0), /channel mismatch/);
});

test('PR-09 剔除：峰峰值 >150 µV 的试次被剔除（MNE 口径）', () => {
  const { recording, events } = runOddballExperiment({ nTrials: 10 });
  // 在第 3 个试次的 epoch 中部（+400 ms，远离共享边界点）注入 200 µV 伪迹。
  const bad = { ...recording, dataUv: [recording.dataUv[0].slice()] };
  const idx = 2 * 250 + 150; // 试次 2（第 3 个），相对 +400 ms
  bad.dataUv[0][idx] += 200;
  bad.dataUv[0][idx + 1] += 200;
  const epochs = epochOddballExperiment(bad, events);
  assert.equal(epochs.kept[2], false, 'artifact trial rejected');
  assert.equal(epochs.trials.length, 9);
  assert.equal(epochs.events.length, 9);
  assert.ok(epochs.kept.filter(Boolean).length === 9);
});

test('PR-09 试次数量效应：SEM 随试次数增加而缩小（测量噪声 0.25 µV）', () => {
  const run = (nTrials) => {
    const { recording, events } = runOddballExperiment({ nTrials, noiseRmsUv: 0.25, seed: 7 });
    const epochs = epochOddballExperiment(recording, events);
    const odd = analyseErp(filterEpochsByCondition(epochs, 'oddball'), 'Pz');
    const jPeak = odd.timesMs.indexOf(odd.peakLatencyMs);
    return { semAtPeak: odd.semUv[0][jPeak], windowMean: odd.windowMeanUv, n: odd.n };
  };
  const small = run(10); // 2 oddball trials
  const large = run(40); // 8 oddball trials
  assert.equal(small.n, 2);
  assert.equal(large.n, 8);
  assert.ok(large.semAtPeak < small.semAtPeak * 0.75,
    `SEM shrinks with trials: n=2 -> ${small.semAtPeak}, n=8 -> ${large.semAtPeak}`);
  // 注意不用噪声下的“峰值”做收敛断言：峰值是窗内 |值| 的最大值，
  // 取最大本身会把噪声正偏抬进峰值（选择偏差；实测 n=8 时噪声峰可达
  // 0.43 µV，而无噪声峰 0.174 µV）。无偏的量是窗均值（50 点平均）：
  // 其 SEM ≈ 0.25/√8/√50 ≈ 0.012 µV，断言落在无噪声窗均值附近。
  assert.ok(Math.abs(large.windowMean - 0.0697) < 0.05,
    `noisy window mean ${large.windowMean} vs noiseless 0.0697`);
});
