/**
 * PR8-D item 2 — Alpha 宽带背景：WAVES 的 PSD 叠加 PR6 噪声模型（已采纳）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/methods-alpha-background.test.mjs
 *
 * 做法：JR p0=220 极限环 10 s Pz 迹（`runAlphaLimitCycle`）+ PR6 噪声
 * 模型默认参数（`generateNoise` 白 2 / 粉红 1 / 工频 0.5 / 漂移 0.5 µV
 * RMS，种子 1），Welch nFft=1024，与 Python scipy 同口径。UI 开关在
 * `WavesTab.tsx`（默认关；打开只改变 PSD 输入，不改记录、不跑模型）。
 *
 * 实测：纯极限环 alpha 占比 99.81% → 叠加默认噪声后 13.49%（真实 Pz
 * 30.3%）：方向对了（宽带背景把虚高的占比拉下来），但加过了头——
 * 极限环 Pz RMS 只有 0.017 µV，默认噪声 RMS 2.30 µV 把它压住了。
 * 噪声 ×0.02 时占比 35.0%（接近真实），但那是凑出来的缩放，不采纳；
 * 采纳的是未经缩放的默认噪声模型 + 如实标注。Python 独立对照见
 * tests/pr8/test_alpha_background.py。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runAlphaLimitCycle } from '../../app/src/lib/lateResponse.ts';
import {
  DEFAULT_NOISE,
  generateNoise,
  rms,
} from '../../app/src/lib/eegRecording.ts';
import { bandPowers, welchPsd } from '../../app/src/lib/signalProcessing.ts';

function alphaShareAndPeak(x) {
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  const xc = x.map((v) => v - m);
  const { freqsHz, psd } = welchPsd(xc, 250, { nFft: 1024 });
  const bands = bandPowers(freqsHz, psd);
  const total = ['delta', 'theta', 'alpha', 'beta', 'gamma']
    .reduce((s, b) => s + bands[b], 0);
  let peakHz = 0;
  let peakPsd = -1;
  for (let i = 0; i < freqsHz.length; i++) {
    if (freqsHz[i] >= 8 && freqsHz[i] <= 13 && psd[i] > peakPsd) {
      peakPsd = psd[i];
      peakHz = freqsHz[i];
    }
  }
  return { alphaShare: bands.alpha / total, peakHz, rmsUv: rms(xc) };
}

test('纯极限环：alpha 占比 99.8%，Pz RMS 0.017 µV（PR6 数字复现）', () => {
  const lc = runAlphaLimitCycle();
  assert.equal(lc.timesMs.length, 2501);
  const s = alphaShareAndPeak(lc.pzUv);
  assert.ok(Math.abs(s.alphaShare - 0.9981) < 0.002, `alpha share ${s.alphaShare}`);
  assert.ok(Math.abs(s.peakHz - 10.99) < 0.05, `alpha peak ${s.peakHz} Hz`);
  assert.ok(Math.abs(s.rmsUv - 0.0167) < 0.001, `Pz RMS ${s.rmsUv} µV`);
});

test('叠加 PR6 默认噪声背景：alpha 占比 99.8% → 13.5%，RMS 2.30 µV', () => {
  const lc = runAlphaLimitCycle();
  const noise = generateNoise(DEFAULT_NOISE, 1, lc.pzUv.length, 250, 1);
  assert.deepEqual(DEFAULT_NOISE, { whiteRmsUv: 2, pinkRmsUv: 1, line50HzRmsUv: 0.5, driftRmsUv: 0.5 });
  const mixed = lc.pzUv.map((v, i) => v + noise.total[0][i]);
  const s = alphaShareAndPeak(mixed);
  assert.ok(Math.abs(s.alphaShare - 0.1349) < 0.01, `mixed alpha share ${s.alphaShare}`);
  assert.ok(Math.abs(s.rmsUv - 2.301) < 0.01, `mixed RMS ${s.rmsUv} µV`);
  // 峰仍在 alpha 频段内（噪声未把峰推出频段）。
  assert.ok(s.peakHz >= 8 && s.peakHz <= 13, `mixed peak ${s.peakHz} Hz`);
  // 同一噪声、同一信号：逐值确定。
  const noise2 = generateNoise(DEFAULT_NOISE, 1, lc.pzUv.length, 250, 1);
  assert.deepEqual(noise2.total, noise.total);
});

test('噪声缩放曲线：×0.02 时占比 35.0%（接近真实 30.3%），但缩放是凑出来的，不采纳', () => {
  const lc = runAlphaLimitCycle();
  const scaled = generateNoise(
    { whiteRmsUv: 0.04, pinkRmsUv: 0.02, line50HzRmsUv: 0.01, driftRmsUv: 0.01 },
    1, lc.pzUv.length, 250, 1);
  const mixed = lc.pzUv.map((v, i) => v + scaled.total[0][i]);
  const s = alphaShareAndPeak(mixed);
  assert.ok(Math.abs(s.alphaShare - 0.3504) < 0.01, `x0.02 alpha share ${s.alphaShare}`);
  // 0.02 缩放后的噪声 RMS 只有 0.046 µV——远小于真实基线 6.07 µV，
  // 这个“接近”没有物理依据：信号本身太弱，任何缩放都能凑出 30%。
  assert.ok(s.rmsUv < 0.1, `x0.02 RMS ${s.rmsUv} µV is far below real baseline 6.07 µV`);
});
