/**
 * PR8-D item 1 — 基线 RMS：OU 背景驱动实验（回退决定，数字锁定）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/methods-baseline-ou.test.mjs
 *
 * 实验设计：OU 过程由 `eegRecording.ts` 的确定性 RNG（mulberry32 +
 * Box-Muller）逐点生成，经柱 `step(ou)` 喂入——柱模型本身未改、
 * 无内置背景驱动（见下结论）。基线 Pz RMS = q RMS × 0.16 µV/(nA·m)，
 * 目标是公开 EEG 约束的 6.07 µV（`publicEegConstraint.ts`）。
 *
 * 结论（实测，不采纳）：OU 在不破坏刺激响应的强度下给出的基线 RMS
 * 比目标小 100 倍以上；把强度推到能接近目标的量级时柱子饱和、
 * 响应被淹没。τ 扫 20–500 ms 也不改善（q RMS 随 τ 增大反而减小）。
 * 因此局部柱不加背景驱动，基线 RMS 0 仍是已知限制。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalCorticalColumn } from '../../app/src/lib/localCorticalColumn.ts';
import { createJansenRitColumn } from '../../app/src/lib/jansenRitColumn.ts';
import { PUBLIC_EEG_CONSTRAINT } from '../../app/src/lib/publicEegConstraint.ts';
import { gaussian, mulberry32, rms } from '../../app/src/lib/eegRecording.ts';
import { peakInWindow } from '../../app/src/lib/signalProcessing.ts';
import {
  ODDBALL_DRIVE_PER_S,
  simulateLateTrial,
} from '../../app/src/lib/lateResponse.ts';

const PZ_GAIN = 0.16;

/** 有种子的 OU 序列：x += a·x + σ·√(1−a²)·N(0,1)，a = exp(−dt/τ)。 */
function ouSequence(n, dtMs, tauMs, sigma, seed) {
  const rng = mulberry32(seed);
  const a = Math.exp(-dtMs / tauMs);
  const b = sigma * Math.sqrt(1 - a * a);
  const out = new Array(n);
  let x = 0;
  for (let i = 0; i < n; i++) { x = a * x + b * gaussian(rng); out[i] = x; }
  return out;
}

test('WC 柱 + OU 背景：不破坏响应的强度下基线 Pz RMS 只有目标的 ~0.7%', () => {
  assert.equal(PUBLIC_EEG_CONSTRAINT.baselineRmsUvAtPz, 6.07);
  // 无 OU 的脉冲峰（对照）：1.4 模型单位 @100 ms，100 ms。
  const col0 = createLocalCorticalColumn();
  let peak0 = 0;
  for (let i = 0; i < 600; i++) {
    const s = col0.step(i >= 100 && i < 200 ? 1.4 : 0);
    peak0 = Math.max(peak0, Math.abs(s.equivalentMomentNAm));
  }
  assert.ok(Math.abs(peak0 - 4.4146) < 0.001, `no-OU peak ${peak0}`);
  // σ=0.2、τ=20 ms：峰值只降 2.1%，但 2000 ms 基线 Pz RMS 仅 0.043 µV。
  const col = createLocalCorticalColumn();
  const ou = ouSequence(600, 1, 20, 0.2, 7);
  let peak = 0;
  const q = [];
  for (let i = 0; i < 600; i++) {
    const s = col.step(ou[i] + (i >= 100 && i < 200 ? 1.4 : 0));
    q.push(s.equivalentMomentNAm);
    peak = Math.max(peak, Math.abs(s.equivalentMomentNAm));
  }
  assert.ok(Math.abs(peak - peak0) / peak0 < 0.05, `OU peak ${peak} vs ${peak0}`);
  const colB = createLocalCorticalColumn();
  const ouB = ouSequence(2000, 1, 20, 0.2, 7);
  const qb = [];
  for (let i = 0; i < 2000; i++) qb.push(colB.step(ouB[i]).equivalentMomentNAm);
  const pzRms = rms(qb) * PZ_GAIN;
  assert.ok(pzRms > 0.02 && pzRms < 0.06, `WC OU baseline Pz RMS ${pzRms} µV (target 6.07)`);
  assert.ok(pzRms / 6.07 < 0.01, 'two orders of magnitude below the real baseline RMS');
  // 更强的 σ=0.5：基线 0.152 µV（仍差 40 倍），峰值已降 10%。
  const colC = createLocalCorticalColumn();
  const ouC = ouSequence(600, 1, 20, 0.5, 7);
  let peakC = 0;
  const qC = [];
  for (let i = 0; i < 600; i++) {
    const s = colC.step(ouC[i] + (i >= 100 && i < 200 ? 1.4 : 0));
    qC.push(s.equivalentMomentNAm);
    peakC = Math.max(peakC, Math.abs(s.equivalentMomentNAm));
  }
  assert.ok(Math.abs(peakC - peak0) / peak0 > 0.05, 'sigma 0.5 already eats the response');
  assert.ok(rms(qC.slice(0, 100)) * PZ_GAIN < 0.3, 'even sigma 0.5 stays far below 6.07 µV');
});

test('JR 柱 + OU 背景：同样数量级上不去（σ=20 时基线 Pz RMS 0.003 µV）', () => {
  const col0 = createJansenRitColumn();
  let peak0 = 0;
  for (let i = 0; i < 1200; i++) {
    const s = col0.step(i >= 200 && i < 280 ? 120 : 0);
    peak0 = Math.max(peak0, Math.abs(s.equivalentMomentNAm));
  }
  assert.ok(Math.abs(peak0 - 1.0329) < 0.001, `JR no-OU peak ${peak0}`);
  const col = createJansenRitColumn();
  const ou = ouSequence(4000, 0.5, 20, 20, 7);
  const q = [];
  for (let i = 0; i < 4000; i++) q.push(col.step(Math.max(0, ou[i])).equivalentMomentNAm);
  assert.ok(rms(q) * PZ_GAIN < 0.01, `JR OU baseline Pz RMS ${rms(q) * PZ_GAIN} µV`);
  const colP = createJansenRitColumn();
  const ouP = ouSequence(1200, 0.5, 20, 20, 7);
  let peak = 0;
  for (let i = 0; i < 1200; i++) {
    const s = colP.step(Math.max(0, ouP[i] + (i >= 200 && i < 280 ? 120 : 0)));
    peak = Math.max(peak, Math.abs(s.equivalentMomentNAm));
  }
  assert.ok(Math.abs(peak - peak0) / peak0 < 0.01, 'JR pulse peak preserved at sigma 20');
});

test('OU 时间常数扫查：τ 越长 q RMS 越小（20 ms 最优，仍差两个量级）', () => {
  for (const [tau, lo, hi] of [[20, 0.03, 0.06], [100, 0.02, 0.06], [500, 0.01, 0.04]]) {
    const col = createLocalCorticalColumn();
    const ou = ouSequence(2000, 1, tau, 0.2, 7);
    const q = [];
    for (let i = 0; i < 2000; i++) q.push(col.step(ou[i]).equivalentMomentNAm);
    const pzRms = rms(q) * PZ_GAIN;
    assert.ok(pzRms > lo && pzRms < hi, `tau=${tau}ms Pz RMS ${pzRms} µV`);
  }
});

test('ERP 未被破坏：晚期机制无背景驱动，oddball 试次数字与 PR6 一致', () => {
  const tr = simulateLateTrial(ODDBALL_DRIVE_PER_S, { tEndMs: 800 });
  const pk = peakInWindow(tr.timesMs, tr.pzUv, [250, 600]);
  const mean = peakInWindow(tr.timesMs, tr.pzUv, [300, 500]);
  assert.ok(Math.abs(pk.peakUv - 0.17418) < 0.001, `P300 peak ${pk.peakUv} µV`);
  assert.equal(pk.latencyMs, 352);
  assert.ok(Math.abs(mean.windowMeanUv - 0.06972) < 0.001, `300-500 ms mean ${mean.windowMeanUv} µV`);
  const base = tr.pzUv.filter((_, i) => tr.timesMs[i] < 0);
  assert.equal(rms(base), 0, 'pre-stimulus baseline RMS is still exactly 0 (known limitation)');
  assert.equal(tr.latched, false);
});
