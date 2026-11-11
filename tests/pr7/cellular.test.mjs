/**
 * PR-13 细胞级模型 — TS 测试（PR7 第一批）。
 *
 * 跑法：node --experimental-strip-types --test tests/pr7/cellular.test.mjs
 *
 * 数值对照：TS 输出 vs `tests/pr7/fixtures/cellular-reference.json`
 *（Python 对照 `reference/python-model/cellular_reference.py` 生成，
 * SciPy DOP853；NEURON 内置 hh 机制另行交叉验证，见 docs/pr7-cellular.md）。
 *
 * 容差由实测积分器误差底定（见 docs/pr7-cellular.md §4.2），不是为通过而放宽：
 * - LIF：精确更新，两边同一公式，实测最大差 0.0 mV、发放时刻差 4.5e-11 ms；
 *   容差 1e-9 mV / 1e-6 ms。
 * - HH RK4 dt=0.025 ms vs DOP853：实测最大 ΔV 5.7e-3 mV（gNa 2.8e-4）；
 *   dt=0.0125 ms 时 2.8e-4 mV（20.4 倍，RK4 四阶）；容差 V 0.02 mV、
 *   m/h/n 1e-4、gNa/gK 1e-2 mS/cm^2——仍比动作电位 ~105 mV 摆幅小 3 个量级以上。
 * - 多房室被动：实测最大差 3.6e-5 mV，容差 1e-3 mV；主动：实测 7.5e-3 mV，
 *   容差 V 0.02 mV、轴向电流 1 pA（实测 0.25 pA）。
 * - LIF f-I：模拟值与解析稳态率差 ≤1%（实测），容差 2%。
 * - 确定性：同种子同参数两次运行逐值相同（JSON 级断言）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  DEFAULT_HH_PARAMS,
  DEFAULT_LIF_PARAMS,
  DEFAULT_MULTICOMP_MORPHOLOGY,
  DEFAULT_WC_TO_CELLULAR_PARAMS,
  SYNAPSE_DEFAULTS,
  cableLengthConstantUm,
  cellularDipoleNAm,
  createHodgkinHuxley,
  createLifNeuron,
  createMulticompartmentNeuron,
  deriveMulticompartmentMorphology,
  firingRateToPopulationDriveP,
  hhSteadyGating,
  impliedScalpUv,
  lifAnalyticRateHz,
  lifFiCurve,
  lifRheobasePA,
  passiveSteadyState,
  simulateHodgkinHuxley,
  simulateLif,
  simulateMulticompartment,
  synapseConductanceNS,
  synapseCurrentPA,
  wcToHhCurrentDensityUAperCm2,
  wcToLifCurrentPA,
} from '../../app/src/lib/cellular.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = JSON.parse(
  readFileSync(join(root, 'tests/pr7/fixtures/cellular-reference.json'), 'utf8'),
);
const M = fixture.metrics;
const P = fixture.parameters;

function assertCloseArray(a, b, atol, label) {
  assert.equal(a.length, b.length, `${label}: length ${a.length} vs ${b.length}`);
  let worst = 0;
  for (let i = 0; i < a.length; i++) {
    const err = Math.abs(a[i] - b[i]);
    if (err > worst) worst = err;
    assert.ok(err <= atol, `${label}[${i}]: ${a[i]} vs ${b[i]} (err ${err} > ${atol})`);
  }
  return worst;
}
function assertClose(x, y, atol, label) {
  assert.ok(Math.abs(x - y) <= atol, `${label}: ${x} vs ${y} (tol ${atol})`);
}

test('LIF：静息保持 -65 mV，600 pA 轨迹与 DOP853 逐位一致', () => {
  const rest = simulateLif(DEFAULT_LIF_PARAMS, 100, () => 0);
  assert.equal(rest.spikeTimesMs.length, 0);
  assertClose(rest.vMv[rest.vMv.length - 1], -65, 1e-12, 'LIF rest V');
  assertClose(M.lif_rest_v_mv, -65, 1e-12, 'fixture LIF rest V');
  const lif = simulateLif(DEFAULT_LIF_PARAMS, 500, () => 600);
  const fx = fixture.series.lif_600pa;
  const fxSpikes = fixture.series.lif_600pa_spikes_ms;
  assertCloseArray(lif.vMv, fx.v_mv, 1e-9, 'LIF V(t) 600 pA');
  assert.equal(lif.spikeTimesMs.length, fxSpikes.length);
  assertCloseArray(lif.spikeTimesMs, fxSpikes, 1e-6, 'LIF spike times');
});

test('LIF：f-I 曲线与解析稳态率对照，流变 375 pA', () => {
  assertClose(lifRheobasePA(), 375, 1e-9, 'rheobase');
  assertClose(P.lif.rheobase_pa, 375, 1e-9, 'fixture rheobase');
  const fi = lifFiCurve(DEFAULT_LIF_PARAMS,
    [0, 200, 300, 375, 400, 500, 600, 800, 1000, 1500, 2000]);
  for (const row of fi) {
    if (row.analyticHz === 0) {
      assert.equal(row.simHz, 0, `I=${row.iPA} pA: below rheobase must not fire`);
    } else {
      const rel = Math.abs(row.simHz - row.analyticHz) / row.analyticHz;
      assert.ok(rel <= 0.02, `I=${row.iPA} pA: sim ${row.simHz} vs analytic ${row.analyticHz} (rel ${rel})`);
    }
  }
  // 与 fixture 的 f-I 表逐项对照（同一协议）。
  const fxFi = fixture.series.lif_fi;
  assert.equal(fi.length, fxFi.length);
  for (let i = 0; i < fi.length; i++) {
    assertClose(fi[i].simHz, fxFi[i].sim_hz, 1e-9, `f-I sim ${fi[i].iPA} pA`);
    assertClose(fi[i].analyticHz, fxFi[i].analytic_hz, 1e-9, `f-I analytic ${fi[i].iPA} pA`);
  }
  // 600 pA：模拟 84.44 Hz，解析 84.69 Hz。
  assertClose(M.lif_600pa_rate_hz, 84.4444, 0.01, 'fixture 600 pA rate');
});

test('HH：静息电位 ≈ -65 mV（实测 -64.9964 mV），零电流下不动', () => {
  const hh = createHodgkinHuxley();
  for (let k = 0; k < 8000; k++) hh.step(0); // 200 ms
  const s = hh.read();
  assertClose(s.vMv, -65, 0.05, 'HH rest V after 200 ms');
  assertClose(M.hh_rest_v_mv, -64.996379, 1e-6, 'fixture HH rest V');
  assert.equal(s.spikeCount, 0);
  // 门控初值即稳态值。
  const [m0, h0, n0] = hhSteadyGating(0);
  assertClose(m0, 0.052932, 1e-6, 'm0');
  assertClose(h0, 0.596121, 1e-6, 'h0');
  assertClose(n0, 0.317677, 1e-6, 'n0');
});

test('HH：10 uA/cm^2 阶跃与 DOP853 逐点对照，锋电位峰值/宽度与 HH1952 对照', () => {
  const hh = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 100,
    (t) => (t >= 10 && t < 60 ? 10 : 0));
  const fx = fixture.series.hh_10ua;
  const wV = assertCloseArray(hh.vMv, fx.v_mv, 0.02, 'HH V(t)');
  const wM = assertCloseArray(hh.m, fx.m, 1e-4, 'HH m(t)');
  assertCloseArray(hh.h, fx.h, 1e-4, 'HH h(t)');
  assertCloseArray(hh.n, fx.n, 1e-4, 'HH n(t)');
  assertCloseArray(hh.gNaMSperCm2, fx.g_na_ms_per_cm2, 1e-2, 'HH gNa(t)');
  assertCloseArray(hh.gKMSperCm2, fx.g_k_ms_per_cm2, 1e-2, 'HH gK(t)');
  assert.equal(hh.spikeTimesMs.length, 4, 'HH spike count at 10 uA/cm^2');
  // 峰值 +39.77 mV、半宽 1.49 ms（HH1952 原文峰值约 +40 mV、半宽约 1–2 ms）。
  assertClose(M.hh_metrics_10ua.peak_mv, 39.774, 0.01, 'fixture AP peak');
  assertClose(M.hh_metrics_10ua.half_width_ms, 1.485, 0.01, 'fixture AP half-width');
  const peak = Math.max(...hh.vMv);
  assertClose(peak, 39.774, 0.5, 'TS AP peak');
  assert.ok(wV < 0.02 && wM < 1e-4, 'worst errors within tolerance');
});

test('HH：步长减半收敛（RK4 四阶：误差降 ≥10 倍，实测 20.4 倍）', () => {
  const fx = fixture.series.hh_10ua;
  const coarse = simulateHodgkinHuxley({ ...DEFAULT_HH_PARAMS, dtMs: 0.025 }, 100,
    (t) => (t >= 10 && t < 60 ? 10 : 0));
  const fine = simulateHodgkinHuxley({ ...DEFAULT_HH_PARAMS, dtMs: 0.0125 }, 100,
    (t) => (t >= 10 && t < 60 ? 10 : 0));
  const err = (tr) => Math.max(...tr.vMv.map((v, i) => Math.abs(v - fx.v_mv[i])));
  const eCoarse = err(coarse);
  const eFine = err(fine);
  assert.ok(eCoarse > 1e-3, `coarse error must be measurable, got ${eCoarse}`);
  assert.ok(eCoarse / eFine >= 10,
    `RK4 convergence: coarse ${eCoarse} / fine ${eFine} = ${eCoarse / eFine} < 10`);
});

test('HH：阈值与不应期', () => {
  // 1 ms 脉冲阈值（二分，fixture 6.934 uA/cm^2）。
  const fires = (amp) => simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 60,
    (t) => (t >= 10 && t < 11 ? amp : 0)).spikeTimesMs.length > 0;
  assert.equal(fires(5), false, '5 uA/cm^2 1 ms pulse must not fire');
  assert.equal(fires(10), true, '10 uA/cm^2 1 ms pulse must fire');
  let lo = 0;
  let hi = 40;
  while (hi - lo > 0.1) {
    const mid = (lo + hi) / 2;
    if (fires(mid)) hi = mid; else lo = mid;
  }
  assertClose((lo + hi) / 2, M.hh_threshold_1ms_pulse_ua_per_cm2, 0.3,
    'HH 1 ms pulse threshold');
  // 持续电流：5 uA/cm^2 只有起始 1 个发放、之后静默（双稳区下分支）；
  // 12 uA/cm^2 重复发放。
  const sub = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 300, () => 5);
  assert.equal(sub.spikeTimesMs.length, 1, 'sustained 5 uA/cm^2: one onset spike');
  assert.ok(sub.spikeTimesMs.every((s) => s < 100), 'no late spikes at 5 uA/cm^2');
  const sup = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 300, () => 12);
  assert.ok(sup.spikeTimesMs.length >= 15,
    `sustained 12 uA/cm^2: ${sup.spikeTimesMs.length} spikes`);
  // 不应期：两发 1 ms / 20 uA/cm^2 脉冲，间隔 3 ms 第二发失败、15 ms 成功。
  const twoPulse = (gap) => simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 60,
    (t) => ((t >= 10 && t < 11) || (t >= 10 + gap && t < 11 + gap) ? 20 : 0));
  assert.equal(twoPulse(3).spikeTimesMs.length, 1, 'gap 3 ms: refractory blocks 2nd');
  assert.equal(twoPulse(15).spikeTimesMs.length, 2, 'gap 15 ms: 2nd fires');
  assert.equal(M.hh_refractory_two_pulse['gap_3.0ms'], 1, 'fixture gap 3 ms');
  assert.equal(M.hh_refractory_two_pulse['gap_15.0ms'], 2, 'fixture gap 15 ms');
});

test('突触：AMPA/GABA 核峰值、衰减与电流符号', () => {
  const ampa = { kind: 'ampa', gMaxNS: 1, shape: 'alpha' };
  const gaba = { kind: 'gaba', gMaxNS: 1, shape: 'alpha' };
  assertClose(synapseConductanceNS(ampa, 12, [10]), 1, 1e-9, 'AMPA alpha peak at t0+tau');
  assertClose(synapseConductanceNS(gaba, 18, [10]), 1, 1e-9, 'GABA alpha peak at t0+tau');
  assertClose(synapseConductanceNS(ampa, 10, [10]), 0, 1e-12, 'alpha kernel starts at 0');
  assertClose(
    synapseConductanceNS({ kind: 'ampa', gMaxNS: 1, shape: 'exponential' }, 12, [10]),
    Math.exp(-1), 1e-12, 'exponential kernel at t0+tau');
  // 静息 -65 mV：AMPA 外向电流 -65 pA（注入 +65 pA，去极化）；
  // GABA 外向电流 +10 pA（注入 -10 pA，超极化）。
  assertClose(synapseCurrentPA(1, -65, SYNAPSE_DEFAULTS.ampa.eRevMv), -65, 1e-9, 'AMPA current');
  assertClose(synapseCurrentPA(1, -65, SYNAPSE_DEFAULTS.gaba.eRevMv), 10, 1e-9, 'GABA current');
  // 与 fixture 的电导序列逐点对照。
  const syn = fixture.series.synapse;
  const times = syn.t_ms;
  const gAmps = times.map((t) => synapseConductanceNS(ampa, t, [10]));
  assertCloseArray(gAmps, syn.ampa_alpha, 1e-9, 'AMPA alpha series');
  const gGabas = times.map((t) => synapseConductanceNS(gaba, t, [10]));
  assertCloseArray(gGabas, syn.gaba_alpha, 1e-9, 'GABA alpha series');
});

test('多房室：形态导出值与电缆长度常数', () => {
  const d = deriveMulticompartmentMorphology();
  assertClose(d.cSomaPF, 12.566371, 1e-3, 'C soma');
  assertClose(d.cApicalPF, 12.566371, 1e-3, 'C apical');
  assertClose(d.gAxialApicalNS, 31.384542, 1e-3, 'g axial apical');
  assertClose(d.gAxialBasalNS, 62.70644, 1e-3, 'g axial basal');
  assertClose(d.gNaSomaNS, 1507.964474, 1e-3, 'gNa soma absolute');
  assertClose(d.apicalSeparationUm, 110, 1e-9, 'apical separation');
  assertClose(cableLengthConstantUm(), P.cable_lambda_apical_um, 0.5, 'lambda 408 um');
  assertClose(P.cable_lambda_apical_um, 408.248, 0.01, 'fixture lambda');
});

test('多房室被动：与 DOP853 逐点对照，稳态 = 线性方程精确解，衰减符合电缆理论', () => {
  const passive = { ...DEFAULT_MULTICOMP_MORPHOLOGY, somaActive: false };
  const mc = simulateMulticompartment(passive, 600,
    (t) => [0, (t >= 100 && t < 600 ? 300 : 0), 0]);
  const fx = fixture.series.mc_passive;
  assertCloseArray(mc.vSomaMv, fx.v_soma_mv, 1e-3, 'passive Vs(t)');
  assertCloseArray(mc.vApicalMv, fx.v_apical_mv, 1e-3, 'passive Va(t)');
  assertCloseArray(mc.vBasalMv, fx.v_basal_mv, 1e-3, 'passive Vb(t)');
  // 稳态（550–600 ms 均值）与线性方程精确解差 < 1e-9 mV（fixture 实测 1e-11）。
  const tail = mc.timesMs.map((t, i) => (t >= 550 ? i : -1)).filter((i) => i >= 0);
  const mean = (arr) => tail.reduce((s, i) => s + arr[i], 0) / tail.length;
  const exact = M.multicomp_passive_exact_steady_mv;
  assertClose(mean(mc.vSomaMv), exact[0], 1e-6, 'passive steady Vs');
  assertClose(mean(mc.vApicalMv), exact[1], 1e-6, 'passive steady Va');
  assertClose(mean(mc.vBasalMv), exact[2], 1e-6, 'passive steady Vb');
  const [s0, s1, s2] = passiveSteadyState(0, 300, 0, passive);
  assertClose(s0, exact[0], 1e-9, 'TS linear solve Vs');
  assertClose(s1, exact[1], 1e-9, 'TS linear solve Va');
  assertClose(s2, exact[2], 1e-9, 'TS linear solve Vb');
  // 去极化衰减比 0.8486：小于 1（有衰减），大于无限电缆 exp(-200/408)=0.613
  //（有限电缆末端封闭，反射使衰减更小）。
  const att = M.multicomp_passive_attenuation_soma_over_apical;
  assert.ok(att > Math.exp(-200 / P.cable_lambda_apical_um) && att < 1,
    `attenuation ${att} must lie between infinite-cable 0.613 and 1`);
  assertClose(att, 0.848589, 1e-4, 'fixture attenuation ratio');
});

test('多房室主动：胞体发放与 DOP853 逐点对照，树突见衰减的反向传播锋电位', () => {
  const mc = simulateMulticompartment(DEFAULT_MULTICOMP_MORPHOLOGY, 60,
    (t) => [(t >= 10 && t < 12 ? 1000 : 0), 0, 0], 0.05);
  const fx = fixture.series.mc_active;
  assertCloseArray(mc.vSomaMv, fx.v_soma_mv, 0.02, 'active Vs(t)');
  assertCloseArray(mc.iAxialApicalPA, fx.i_axial_apical_pa, 1, 'active Iaxial(t)');
  assert.equal(mc.spikeTimesMs.length, 1, 'one somatic AP');
  assertClose(M.multicomp_active_ap_metrics.peak_mv, 37.398, 0.01, 'fixture MC AP peak');
  const peakSoma = Math.max(...mc.vSomaMv);
  const peakApi = Math.max(...mc.vApicalMv);
  assert.ok(peakApi < peakSoma, `backpropagating AP attenuates: apical ${peakApi} < soma ${peakSoma}`);
  assertClose(peakSoma, 37.398, 0.5, 'TS MC AP peak');
});

test('多房室：步长减半收敛（实测 23 倍）', () => {
  const fx = fixture.series.mc_active;
  const run = (dt) => simulateMulticompartment(DEFAULT_MULTICOMP_MORPHOLOGY, 60,
    (t) => [(t >= 10 && t < 12 ? 1000 : 0), 0, 0], 0.05, dt);
  const err = (tr) => Math.max(...tr.vSomaMv.map((v, i) => Math.abs(v - fx.v_soma_mv[i])));
  const eCoarse = err(run(0.025));
  const eFine = err(run(0.0125));
  assert.ok(eCoarse / eFine >= 10, `MC convergence: ${eCoarse} / ${eFine} = ${eCoarse / eFine}`);
});

test('跨尺度耦合：前向/反向映射数值（假设增益，写清未校准）', () => {
  assertClose(wcToLifCurrentPA(0.5), 489, 1e-9, 'WC E=0.5 -> LIF 489 pA');
  assertClose(wcToLifCurrentPA(0.1), 89, 1e-9, 'WC E=0.1 -> LIF 89 pA');
  assertClose(wcToLifCurrentPA(0.011), 0, 1e-9, 'WC E=E0 -> 0 pA');
  assertClose(wcToHhCurrentDensityUAperCm2(0.5), 9.78, 1e-9, 'WC E=0.5 -> HH 9.78 uA/cm^2');
  assertClose(firingRateToPopulationDriveP(60), 0.12, 1e-12, '60 Hz -> dP 0.12');
  assertClose(firingRateToPopulationDriveP(0), 0, 1e-12, '0 Hz -> dP 0');
  // 偶极链：1608 pA × 0.11 mm = 1.77e-4 nA·m；55.56 nA·m × 0.16 = 8.89 uV。
  assertClose(cellularDipoleNAm(1608.0318, 0.11), 1.7688e-4, 1e-8, 'cellular dipole');
  assertClose(impliedScalpUv(55.5625), 8.89, 1e-9, '55.56 nA*m -> 8.89 uV at Pz');
  assertClose(DEFAULT_WC_TO_CELLULAR_PARAMS.lifGainPaPerE, 1000, 0, 'LIF gain default');
  assertClose(DEFAULT_WC_TO_CELLULAR_PARAMS.hhGainUaPerCm2PerE, 20, 0, 'HH gain default');
});

test('PR6 幅度缺口：细胞路线量化（不重缩放，数字如实）', () => {
  const amp = M.amplitude_experiment;
  // 持续 PSP（75 pA 顶树突驱动，300–500 ms 均值）：被动胞体 -0.059 uV、
  // 主动胞体 -0.081 uV——与 JR 路线的 0.174 uV 同量级，距真实 8.89 uV 差 ~110–150 倍。
  assert.ok(Math.abs(amp.sustained_psp.pz_uv) < 0.1,
    `sustained PSP Pz must be < 0.1 uV, got ${amp.sustained_psp.pz_uv}`);
  assertClose(amp.sustained_psp.pz_uv, -0.058885, 1e-4, 'sustained PSP Pz');
  assertClose(amp.sustained_psp_active_soma.pz_uv, -0.080889, 1e-4, 'active PSP Pz');
  assert.equal(amp.sustained_psp.n_spikes, 0, 'sustained PSP is subthreshold');
  // 同步动作电位齐射峰值 2.50 uV——仍不到真实值一半，且只是 ~1 ms 瞬态，
  // 不是 200 ms 持续的 ERP。
  assert.ok(amp.ap_volley.pz_peak_uv < 8.89,
    `AP volley peak ${amp.ap_volley.pz_peak_uv} uV must stay below true 8.89 uV`);
  assertClose(amp.ap_volley.pz_peak_uv, 2.498478, 1e-4, 'AP volley peak Pz');
  // 所需偶极矩 55.56 nA·m；细胞持续路线只给出 0.368 nA·m（差 151 倍）。
  assertClose(amp.required_for_true_oddball.q_nam, 55.5625, 1e-9, 'required q');
  assert.ok(amp.required_for_true_oddball.q_nam /
    Math.abs(amp.sustained_psp.q_population_nam) > 100,
    'cellular sustained route is >100x short of the true oddball dipole');
});

test('NEURON 交叉验证数（fixture 记录）：锋电位时间差 ≤0.05 ms、峰值差 ≤0.07 mV', () => {
  const n = M.neuron_hh_comparison;
  assert.equal(n.available, true, 'NEURON must have been available at fixture generation');
  assert.equal(n.neuron_n_spikes, 4, 'NEURON spike count');
  assert.equal(n.dop853_n_spikes, 4, 'DOP853 spike count');
  assert.ok(n.max_spike_time_diff_ms <= 0.05,
    `spike times agree within 0.05 ms, got ${n.max_spike_time_diff_ms}`);
  assert.ok(Math.abs(n.neuron_peak_mv - n.dop853_peak_mv) <= 0.07,
    `peaks ${n.neuron_peak_mv} vs ${n.dop853_peak_mv}`);
  assert.ok(n.max_abs_diff_outside_spike_windows_mv <= 0.1,
    `outside ±5 ms of spikes: ${n.max_abs_diff_outside_spike_windows_mv} mV`);
});

test('确定性：同参数两次运行逐值相同；非法参数抛错', () => {
  const a = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 100, (t) => (t >= 10 && t < 60 ? 10 : 0));
  const b = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 100, (t) => (t >= 10 && t < 60 ? 10 : 0));
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'HH deterministic');
  const c = simulateLif(DEFAULT_LIF_PARAMS, 500, () => 600);
  const d = simulateLif(DEFAULT_LIF_PARAMS, 500, () => 600);
  assert.equal(JSON.stringify(c), JSON.stringify(d), 'LIF deterministic');
  const e = simulateMulticompartment(DEFAULT_MULTICOMP_MORPHOLOGY, 60,
    (t) => [(t >= 10 && t < 12 ? 1000 : 0), 0, 0], 0.05);
  const f = simulateMulticompartment(DEFAULT_MULTICOMP_MORPHOLOGY, 60,
    (t) => [(t >= 10 && t < 12 ? 1000 : 0), 0, 0], 0.05);
  assert.equal(JSON.stringify(e), JSON.stringify(f), 'multicompartment deterministic');
  assert.throws(() => createLifNeuron({ ...DEFAULT_LIF_PARAMS, capacitancePF: -1 }));
  assert.throws(() => createHodgkinHuxley({ ...DEFAULT_HH_PARAMS, dtMs: 1 }));
  assert.throws(() => synapseConductanceNS({ kind: 'ampa', gMaxNS: -1, shape: 'alpha' }, 0, []));
  assert.throws(() => wcToLifCurrentPA(1.5));
  assert.throws(() => createMulticompartmentNeuron(
    { ...DEFAULT_MULTICOMP_MORPHOLOGY, apicalLengthUm: 0 }));
  // create* 的 reset 回到同一初态。
  const hh = createHodgkinHuxley();
  for (let k = 0; k < 4000; k++) hh.step(10);
  assert.equal(hh.read().spikeCount > 0, true);
  hh.reset();
  assert.equal(hh.read().spikeCount, 0);
  assertClose(hh.read().vMv, -65, 1e-12, 'HH reset V');
  const lif = createLifNeuron();
  for (let k = 0; k < 5000; k++) lif.step(600);
  lif.reset();
  assert.equal(lif.read().spikeCount, 0);
  assertClose(lif.read().vMv, -65, 1e-12, 'LIF reset V');
});
