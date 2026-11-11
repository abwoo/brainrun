/**
 * PR-13 (PR7 第一批)：独立的局部神经元实验引擎——细胞级 / 多尺度模型。
 *
 * 模型（时间 ms、电位 mV、电流 pA；HH 例外用 uA/cm^2 与 mS/cm^2）：
 * - Leaky Integrate-and-Fire：精确子阈值更新、不应期、电流注入、f-I 曲线；
 * - Hodgkin–Huxley（HH1952，6.3 °C 枪乌贼大轴突）：Na/K/漏电导、m/h/n 门控、
 *   标准参数、电流注入、动作电位、膜电位与离子电导时间序列；
 * - 多房室神经元（胞体 + 顶树突/基树突）：被动电缆 + 主动（HH）胞体，
 *   形态参数写清，轴向电导由圆柱几何与轴向电阻率算出；
 * - 突触后电流：电导型，兴奋 AMPA-like（Erev=0 mV）与抑制 GABA-like
 *   （Erev=-75 mV），alpha 函数或指数核；
 * - 跨尺度耦合：WC/JR 脑区活动 E（无量纲）→ 细胞注入电流（显式线性
 *   映射、未校准增益，与 PR5 偶极子耦合同一诚实口径）；细胞发放率 →
 *   群体驱动的反向映射。
 *
 * 与 Python 对照 `reference/python-model/cellular_reference.py`
 *（SciPy DOP853）逐式镜像：同一方程、同一参数、同一离散语义
 *（LIF 精确更新、HH/多房室 RK4、同一不应期与发放检测规则）。
 * Wilson–Cowan / Jansen–Rit 原样保留，不改动；不同模型里同名变量
 *（如 JR 的 y0 与 HH 的膜电位）绝不混淆——名字与单位分开写清。
 *
 * 纯 TS，不 import 任何 npm 包；不依赖 WASM 引擎（前端本地计算，
 * 与 DipoleLab / LocalBEMLab 同一模式）。
 */
export const CELLULAR_ID = 'local-cellular-multiscale-v1';
export const CELLULAR_LIMITATION =
  '细胞级模型是独立的局部实验引擎：LIF/HH/多房室参数取自发表值，'
  + '跨尺度耦合增益是显式假设、未经人体数据校准；细胞路线算出的'
  + '偶极矩与头皮电位是“若 80,000 个锥体细胞同步”的假设外推，'
  + '不是实测 EEG，也不是对 TVB 76 区网络的映射。';

// ---------------------------------------------------------------------------
// LIF — Leaky Integrate-and-Fire
// ---------------------------------------------------------------------------
export interface LifParams {
  /** 膜电容，pF。 */
  capacitancePF: number;
  /** 漏电导，nS。 */
  leakNS: number;
  /** 漏电位（静息电位），mV。 */
  leakReversalMv: number;
  /** 发放阈值，mV。 */
  thresholdMv: number;
  /** 复位电位，mV。 */
  resetMv: number;
  /** 绝对不应期，ms。 */
  refractoryMs: number;
  /** 积分步长，ms。 */
  dtMs: number;
}
export interface LifState {
  tMs: number;
  vMv: number;
  spikeCount: number;
  /** 剩余不应期，ms（0 = 不在不应期）。 */
  refractoryMsRemaining: number;
  lastSpikeMs: number | null;
}
/** Dayan & Abbott 2001 教科书标准值：C=250 pF，gL=25 nS（tau=10 ms）。 */
export const DEFAULT_LIF_PARAMS: Readonly<LifParams> = Object.freeze({
  capacitancePF: 250,
  leakNS: 25,
  leakReversalMv: -65,
  thresholdMv: -50,
  resetMv: -65,
  refractoryMs: 2,
  dtMs: 0.1,
});
/** 流变电流 rheobase = gL * (Vth - EL) = 25 nS * 15 mV = 375 pA。 */
export function lifRheobasePA(p: LifParams = DEFAULT_LIF_PARAMS): number {
  return p.leakNS * (p.thresholdMv - p.leakReversalMv);
}
export function validateLifParams(p: LifParams): void {
  const values = Object.values(p);
  if (values.length !== 7 || values.some((v) => !Number.isFinite(v)) ||
      p.capacitancePF <= 0 || p.leakNS <= 0 ||
      p.thresholdMv <= p.resetMv || p.refractoryMs < 0 || p.dtMs <= 0) {
    throw new RangeError('Invalid LIF parameters');
  }
}
/**
 * 恒定电流下的稳态发放率（解析式），Hz。
 * f = 1 / (t_ref + tau * ln((I*R - (Vreset-EL)) / (I*R - (Vth-EL))))，
 * tau = C/gL（ms），R = 1/gL（GOhm），I*R 单位 mV（pA * GOhm = mV）。
 * 低于流变电流时返回 0。
 */
export function lifAnalyticRateHz(
  iPA: number, p: LifParams = DEFAULT_LIF_PARAMS,
): number {
  validateLifParams(p);
  if (!Number.isFinite(iPA)) throw new RangeError('LIF current must be finite');
  const tauMs = p.capacitancePF / p.leakNS;
  const vInf = p.leakReversalMv + iPA / p.leakNS;
  if (vInf <= p.thresholdMv) return 0;
  const chargeMs = tauMs *
    Math.log((vInf - p.resetMv) / (vInf - p.thresholdMv));
  return 1000 / (p.refractoryMs + chargeMs);
}
export function createLifNeuron(params: LifParams = DEFAULT_LIF_PARAMS) {
  validateLifParams(params);
  const tauMs = params.capacitancePF / params.leakNS;
  const decay = Math.exp(-params.dtMs / tauMs);
  let v = params.leakReversalMv;
  let refractory = 0;
  let spikes = 0;
  let lastSpike: number | null = null;
  // 时钟用步数 × 步长（乘法）而不用累加：与 Python 的 arange(n+1)*dt
  // 逐位一致，避免累积误差把恰好落在窗口边界的发放推到边界另一侧
  //（1000 pA 时第 15 个发放恰在 100.0 ms，累加会把它算成 99.99…ms）。
  let steps = 0;
  let t = 0;
  const read = (): LifState => ({
    tMs: t, vMv: v, spikeCount: spikes,
    refractoryMsRemaining: refractory, lastSpikeMs: lastSpike,
  });
  return {
    read,
    reset: (): LifState => {
      v = params.leakReversalMv; refractory = 0; spikes = 0;
      lastSpike = null; steps = 0; t = 0; return read();
    },
    /**
     * 一步精确子阈值更新（与 Python 对照同一语义）：步内电流恒定；
     * 不应期内膜电位钉在复位电位、不应期时钟递减；步末越阈即发放、
     * 复位并开始不应期。
     */
    step: (iPA: number): LifState => {
      if (!Number.isFinite(iPA)) throw new RangeError('LIF current must be finite');
      if (refractory > 0) {
        refractory -= params.dtMs;
        v = params.resetMv;
      } else {
        const vInf = params.leakReversalMv + iPA / params.leakNS;
        const vNew = vInf + (v - vInf) * decay;
        if (vNew >= params.thresholdMv) {
          spikes += 1;
          lastSpike = (steps + 1) * params.dtMs;
          v = params.resetMv;
          refractory = params.refractoryMs;
        } else {
          v = vNew;
        }
      }
      steps += 1;
      t = steps * params.dtMs;
      return read();
    },
  };
}
export interface LifTrace {
  timesMs: number[];
  vMv: number[];
  spikeTimesMs: number[];
}
export function simulateLif(
  params: LifParams, durationMs: number,
  currentFn: (tMs: number) => number,
): LifTrace {
  validateLifParams(params);
  const neuron = createLifNeuron(params);
  const n = Math.round(durationMs / params.dtMs);
  const timesMs: number[] = [0];
  const vMv: number[] = [neuron.read().vMv];
  const spikeTimesMs: number[] = [];
  for (let k = 0; k < n; k++) {
    const before = neuron.read().spikeCount;
    neuron.step(currentFn(k * params.dtMs));
    const after = neuron.read();
    if (after.spikeCount > before) spikeTimesMs.push(after.tMs);
    timesMs.push(after.tMs);
    vMv.push(after.vMv);
  }
  return { timesMs, vMv, spikeTimesMs };
}
export function lifFiCurve(
  params: LifParams, currentsPA: number[],
  durationMs = 1000, discardMs = 100,
): { iPA: number; simHz: number; analyticHz: number }[] {
  return currentsPA.map((iPA) => {
    const trace = simulateLif(params, durationMs, () => iPA);
    const n = trace.spikeTimesMs.filter((s) => s >= discardMs).length;
    return {
      iPA,
      simHz: n / ((durationMs - discardMs) / 1000),
      analyticHz: lifAnalyticRateHz(iPA, params),
    };
  });
}

// ---------------------------------------------------------------------------
// Hodgkin-Huxley (HH1952)
// ---------------------------------------------------------------------------
export interface HodgkinHuxleyParams {
  /** 膜电容，uF/cm^2。 */
  capacitanceUFperCm2: number;
  /** Na 最大电导，mS/cm^2。 */
  gNaMSperCm2: number;
  /** K 最大电导，mS/cm^2。 */
  gKMSperCm2: number;
  /** 漏最大电导，mS/cm^2。 */
  gLMSperCm2: number;
  /** Na 反转电位，mV。 */
  eNaMv: number;
  /** K 反转电位，mV。 */
  eKMv: number;
  /** 漏反转电位（HH 漏电池），mV。 */
  eLMv: number;
  /** 静息电位（门控稳态参考点），mV。 */
  restMv: number;
  /** RK4 步长，ms。 */
  dtMs: number;
}
export interface HodgkinHuxleyState {
  tMs: number;
  vMv: number;
  m: number; h: number; n: number;
  gNaMSperCm2: number;
  gKMSperCm2: number;
  iNaUAperCm2: number;
  iKUAperCm2: number;
  iLUAperCm2: number;
  spikeCount: number;
  lastSpikeMs: number | null;
}
/**
 * Hodgkin & Huxley 1952, J. Physiol. 117:500–544（枪乌贼大轴突，6.3 °C）：
 * C=1 uF/cm^2，gNa=120，gK=36，gL=0.3 mS/cm^2，ENa=+50，EK=-77，
 * EL=-54.387 mV，Vrest=-65 mV。
 */
export const DEFAULT_HH_PARAMS: Readonly<HodgkinHuxleyParams> = Object.freeze({
  capacitanceUFperCm2: 1,
  gNaMSperCm2: 120,
  gKMSperCm2: 36,
  gLMSperCm2: 0.3,
  eNaMv: 50,
  eKMv: -77,
  eLMv: -54.387,
  restMv: -65,
  dtMs: 0.025,
});
export function validateHodgkinHuxleyParams(p: HodgkinHuxleyParams): void {
  const values = Object.values(p);
  if (values.length !== 9 || values.some((v) => !Number.isFinite(v)) ||
      p.capacitanceUFperCm2 <= 0 ||
      p.gNaMSperCm2 < 0 || p.gKMSperCm2 < 0 || p.gLMSperCm2 < 0 ||
      p.dtMs <= 0 || p.dtMs > 0.1) {
    throw new RangeError('Invalid Hodgkin-Huxley parameters');
  }
}
/** x / (exp(x) - 1)，|x| < 1e-6 时用级数（alpha_m 在 v=+25、alpha_n 在 v=+10 处奇异）。 */
function rateRatio(x: number): number {
  if (Math.abs(x) < 1e-6) return 1 - x / 2 + x * x / 12 - x ** 4 / 720;
  return x / (Math.exp(x) - 1);
}
/** alpha/beta 速率（1/ms），v 为相对电位 V - Vrest（mV）。HH1952 原式。 */
export function hhAlphaBeta(vRelMv: number): [number, number, number, number, number, number] {
  const v = vRelMv;
  const aM = 0.1 * 10 * rateRatio((25 - v) / 10);
  const bM = 4 * Math.exp(-v / 18);
  const aH = 0.07 * Math.exp(-v / 20);
  const bH = 1 / (Math.exp((30 - v) / 10) + 1);
  const aN = 0.01 * 10 * rateRatio((10 - v) / 10);
  const bN = 0.125 * Math.exp(-v / 80);
  return [aM, bM, aH, bH, aN, bN];
}
/** 给定相对电位下的门控稳态值 (m0, h0, n0)。 */
export function hhSteadyGating(vRelMv = 0): [number, number, number] {
  const [aM, bM, aH, bH, aN, bN] = hhAlphaBeta(vRelMv);
  return [aM / (aM + bM), aH / (aH + bH), aN / (aN + bN)];
}
type HhFullState = readonly [number, number, number, number];
function hhDerivative(
  s: HhFullState, iUAperCm2: number, p: HodgkinHuxleyParams,
): HhFullState {
  const [v, m, h, n] = s;
  const [aM, bM, aH, bH, aN, bN] = hhAlphaBeta(v - p.restMv);
  const gNa = p.gNaMSperCm2 * m ** 3 * h;
  const gK = p.gKMSperCm2 * n ** 4;
  const iNa = gNa * (v - p.eNaMv);
  const iK = gK * (v - p.eKMv);
  const iL = p.gLMSperCm2 * (v - p.eLMv);
  const dv = (iUAperCm2 - iNa - iK - iL) / p.capacitanceUFperCm2;
  return [
    dv,
    aM * (1 - m) - bM * m,
    aH * (1 - h) - bH * h,
    aN * (1 - n) - bN * n,
  ];
}
function hhRk4(
  s: HhFullState, iUAperCm2: number, p: HodgkinHuxleyParams, dt: number,
): HhFullState {
  const add = (x: HhFullState, k: HhFullState, f: number): HhFullState =>
    [x[0] + f * k[0], x[1] + f * k[1], x[2] + f * k[2], x[3] + f * k[3]] as const;
  const k1 = hhDerivative(s, iUAperCm2, p);
  const k2 = hhDerivative(add(s, k1, dt / 2), iUAperCm2, p);
  const k3 = hhDerivative(add(s, k2, dt / 2), iUAperCm2, p);
  const k4 = hhDerivative(add(s, k3, dt), iUAperCm2, p);
  const w = (i: number) => dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
  return [s[0] + w(0), s[1] + w(1), s[2] + w(2), s[3] + w(3)] as const;
}
export function createHodgkinHuxley(params: HodgkinHuxleyParams = DEFAULT_HH_PARAMS) {
  validateHodgkinHuxleyParams(params);
  const [m0, h0, n0] = hhSteadyGating(0);
  const initial: HhFullState = [params.restMv, m0, h0, n0];
  let state: HhFullState = initial;
  let steps = 0;
  let t = 0;
  let spikes = 0;
  let lastSpike: number | null = null;
  const read = (): HodgkinHuxleyState => {
    const [v, m, h, n] = state;
    const gNa = params.gNaMSperCm2 * m ** 3 * h;
    const gK = params.gKMSperCm2 * n ** 4;
    return {
      tMs: t, vMv: v, m, h, n,
      gNaMSperCm2: gNa, gKMSperCm2: gK,
      iNaUAperCm2: gNa * (v - params.eNaMv),
      iKUAperCm2: gK * (v - params.eKMv),
      iLUAperCm2: params.gLMSperCm2 * (v - params.eLMv),
      spikeCount: spikes, lastSpikeMs: lastSpike,
    };
  };
  return {
    read,
    reset: (): HodgkinHuxleyState => {
      state = initial; steps = 0; t = 0; spikes = 0; lastSpike = null; return read();
    },
    /** 一步 RK4（步内电流恒定）；发放检测为膜电位上穿 0 mV。 */
    step: (iUAperCm2: number): HodgkinHuxleyState => {
      if (!Number.isFinite(iUAperCm2)) {
        throw new RangeError('Hodgkin-Huxley current must be finite');
      }
      const vPrev = state[0];
      state = hhRk4(state, iUAperCm2, params, params.dtMs);
      if (!state.every(Number.isFinite)) {
        throw new RangeError('Hodgkin-Huxley state diverged');
      }
      if (vPrev < 0 && state[0] >= 0) {
        spikes += 1;
        lastSpike = (steps + 1) * params.dtMs;
      }
      steps += 1;
      t = steps * params.dtMs;
      return read();
    },
  };
}
export interface HodgkinHuxleyTrace {
  timesMs: number[];
  vMv: number[];
  m: number[];
  h: number[];
  n: number[];
  gNaMSperCm2: number[];
  gKMSperCm2: number[];
  spikeTimesMs: number[];
}
export function simulateHodgkinHuxley(
  params: HodgkinHuxleyParams, durationMs: number,
  currentFn: (tMs: number) => number, sampleEveryMs = 0.1,
): HodgkinHuxleyTrace {
  validateHodgkinHuxleyParams(params);
  const neuron = createHodgkinHuxley(params);
  const nSteps = Math.round(durationMs / params.dtMs);
  const every = Math.max(1, Math.round(sampleEveryMs / params.dtMs));
  const timesMs: number[] = [0];
  const vMv: number[] = [neuron.read().vMv];
  const m: number[] = [neuron.read().m];
  const h: number[] = [neuron.read().h];
  const n: number[] = [neuron.read().n];
  const gNaMSperCm2: number[] = [neuron.read().gNaMSperCm2];
  const gKMSperCm2: number[] = [neuron.read().gKMSperCm2];
  const spikeTimesMs: number[] = [];
  for (let k = 0; k < nSteps; k++) {
    const before = neuron.read().spikeCount;
    const s = neuron.step(currentFn(k * params.dtMs));
    if (s.spikeCount > before && s.lastSpikeMs !== null) {
      spikeTimesMs.push(s.lastSpikeMs);
    }
    if ((k + 1) % every === 0 || k === nSteps - 1) {
      timesMs.push(s.tMs);
      vMv.push(s.vMv); m.push(s.m); h.push(s.h); n.push(s.n);
      gNaMSperCm2.push(s.gNaMSperCm2); gKMSperCm2.push(s.gKMSperCm2);
    }
  }
  return { timesMs, vMv, m, h, n, gNaMSperCm2, gKMSperCm2, spikeTimesMs };
}

// ---------------------------------------------------------------------------
// Synapses — conductance-based postsynaptic currents
// ---------------------------------------------------------------------------
export type SynapseKind = 'ampa' | 'gaba';
export type SynapseShape = 'alpha' | 'exponential';
export interface SynapseParams {
  kind: SynapseKind;
  /** 峰值电导，nS。 */
  gMaxNS: number;
  shape: SynapseShape;
  /** 核时间常数，ms；缺省取该 kind 的默认值（AMPA alpha 2 / GABA alpha 8）。 */
  tauMs?: number;
}
/**
 * AMPA-like：Erev=0 mV，alpha tau=2 ms（快兴奋）；
 * GABA-like：Erev=-75 mV，alpha tau=8 ms（快抑制）。
 * 指数核的 tau 缺省值：AMPA 2 ms、GABA 10 ms。
 * 数值均为教科书量级（Dayan & Abbott；Koch），不是拟合值。
 */
export const SYNAPSE_DEFAULTS: Readonly<Record<SynapseKind, {
  eRevMv: number; tauAlphaMs: number; tauExpMs: number;
}>> = Object.freeze({
  ampa: Object.freeze({ eRevMv: 0, tauAlphaMs: 2, tauExpMs: 2 }),
  gaba: Object.freeze({ eRevMv: -75, tauAlphaMs: 8, tauExpMs: 10 }),
});
export function synapseReversalMv(kind: SynapseKind): number {
  return SYNAPSE_DEFAULTS[kind].eRevMv;
}
function synapseTauMs(p: SynapseParams): number {
  const d = SYNAPSE_DEFAULTS[p.kind];
  return p.tauMs ?? (p.shape === 'alpha' ? d.tauAlphaMs : d.tauExpMs);
}
export function validateSynapseParams(p: SynapseParams): void {
  if (!SYNAPSE_DEFAULTS[p.kind] || (p.shape !== 'alpha' && p.shape !== 'exponential') ||
      !Number.isFinite(p.gMaxNS) || p.gMaxNS < 0 ||
      (p.tauMs !== undefined && (!Number.isFinite(p.tauMs) || p.tauMs <= 0))) {
    throw new RangeError('Invalid synapse parameters');
  }
}
/**
 * 时刻 t 的总电导（nS），对全部突触前发放时刻求和。
 * alpha：g = gMax * x * exp(1 - x)，x = (t - t0)/tau（t = t0 + tau 时取峰 gMax）；
 * exponential：g = gMax * exp(-(t - t0)/tau)。
 */
export function synapseConductanceNS(
  p: SynapseParams, tMs: number, spikeTimesMs: number[],
): number {
  validateSynapseParams(p);
  const tau = synapseTauMs(p);
  let g = 0;
  for (const t0 of spikeTimesMs) {
    const dt = tMs - t0;
    if (dt < 0) continue;
    if (p.shape === 'alpha') {
      const x = dt / tau;
      g += p.gMaxNS * x * Math.exp(1 - x);
    } else {
      g += p.gMaxNS * Math.exp(-dt / tau);
    }
  }
  return g;
}
/**
 * 外向突触电流（pA）= g * (V - Erev)；1 nS * 1 mV = 1 pA。
 * 与 HH 离子电流同一符号约定：膜方程减去它，即注入电流 = -该值
 *（静息 -65 mV 时 AMPA 电流为内向、去极化；GABA 为外向、超极化）。
 */
export function synapseCurrentPA(gNS: number, vMv: number, eRevMv: number): number {
  if (![gNS, vMv, eRevMv].every(Number.isFinite)) {
    throw new RangeError('Synaptic current inputs must be finite');
  }
  return gNS * (vMv - eRevMv);
}

// ---------------------------------------------------------------------------
// Multi-compartment neuron — soma (HH active) + apical/basal dendrites
// ---------------------------------------------------------------------------
export interface CompartmentMorphology {
  somaDiameterUm: number;
  somaLengthUm: number;
  apicalDiameterUm: number;
  apicalLengthUm: number;
  basalDiameterUm: number;
  basalLengthUm: number;
  /** 轴向电阻率，Ohm*cm。 */
  raOhmCm: number;
  /** 比膜电容，uF/cm^2。 */
  cmUFperCm2: number;
  /** 被动漏电导密度，mS/cm^2。 */
  gLeakMSperCm2: number;
  /** 被动漏反转电位（= 静息电位），mV。 */
  eLeakMv: number;
  /** 胞体是否主动（HH）；false = 全被动电缆，用于电缆理论对照。 */
  somaActive: boolean;
}
export interface DerivedMorphology {
  areaSomaCm2: number;
  areaApicalCm2: number;
  areaBasalCm2: number;
  cSomaPF: number;
  cApicalPF: number;
  cBasalPF: number;
  gLeakSomaNS: number;
  gLeakApicalNS: number;
  gLeakBasalNS: number;
  gAxialApicalNS: number;
  gAxialBasalNS: number;
  /** 胞体 HH 绝对电导（密度 × 胞体面积），nS。 */
  gNaSomaNS: number;
  gKSomaNS: number;
  /** 房室中心间距（胞体中心到树突中心），um——细胞偶极的几何源-汇间距。 */
  apicalSeparationUm: number;
  basalSeparationUm: number;
}
export interface MulticompartmentState {
  tMs: number;
  vSomaMv: number;
  m: number; h: number; n: number;
  vApicalMv: number;
  vBasalMv: number;
  /** 胞体→顶树突轴向电流，pA（nS * mV = pA；负值 = 顶树突→胞体）。 */
  iAxialApicalPA: number;
  iAxialBasalPA: number;
  spikeCount: number;
  lastSpikeMs: number | null;
  /** 胞体-顶树突轴向电流对应的单细胞偶极矩，nA·m（几何间距 110 um）。 */
  equivalentMomentNAm: number;
  /** 同上 × 80,000 同步锥体细胞（PR5 假设）× Pz 增益 0.16 uV/(nA·m)。 */
  impliedScalpUv: number;
}
/**
 * 形态（锥体细胞教科书量级）：胞体圆柱 d=20 um、L=20 um；
 * 顶树突 d=2 um、L=200 um；基树突 d=2 um、L=100 um；
 * Ra=100 Ohm*cm，Cm=1 uF/cm^2，漏密度 0.3 mS/cm^2。
 */
export const DEFAULT_MULTICOMP_MORPHOLOGY: Readonly<CompartmentMorphology> =
  Object.freeze({
    somaDiameterUm: 20, somaLengthUm: 20,
    apicalDiameterUm: 2, apicalLengthUm: 200,
    basalDiameterUm: 2, basalLengthUm: 100,
    raOhmCm: 100, cmUFperCm2: 1,
    gLeakMSperCm2: 0.3, eLeakMv: -65,
    somaActive: true,
  });
export function validateMulticompMorphology(m: CompartmentMorphology): void {
  const values = Object.values(m).filter((v) => typeof v === 'number');
  if (values.length !== 10 || values.some((v) => !Number.isFinite(v)) ||
      [m.somaDiameterUm, m.somaLengthUm, m.apicalDiameterUm, m.apicalLengthUm,
       m.basalDiameterUm, m.basalLengthUm, m.raOhmCm, m.cmUFperCm2,
       m.gLeakMSperCm2].some((v) => v <= 0)) {
    throw new RangeError('Invalid compartment morphology');
  }
}
const UM2_TO_CM2 = 1e-8;
function cylAreaUm2(dUm: number, lUm: number): number {
  return Math.PI * dUm * lUm;
}
function cylCrossUm2(dUm: number): number {
  return Math.PI * (dUm / 2) ** 2;
}
/**
 * 由几何导出面积、电容、漏电导与轴向电导。
 * 轴向电导 = 1 / (R_half_1 + R_half_2)，R_half = Ra * (L/2) / A_cross。
 * 导出值（默认形态）：C_soma=C_apical=12.57 pF，C_basal=6.28 pF；
 * g_axial 顶树突 31.38 nS、基树突 62.71 nS；胞体 gNa=1508 nS、gK=452 nS。
 */
export function deriveMulticompartmentMorphology(
  m: CompartmentMorphology = DEFAULT_MULTICOMP_MORPHOLOGY,
): DerivedMorphology {
  validateMulticompMorphology(m);
  const aSoma = cylAreaUm2(m.somaDiameterUm, m.somaLengthUm) * UM2_TO_CM2;
  const aApi = cylAreaUm2(m.apicalDiameterUm, m.apicalLengthUm) * UM2_TO_CM2;
  const aBas = cylAreaUm2(m.basalDiameterUm, m.basalLengthUm) * UM2_TO_CM2;
  const axialNS = (d1: number, l1: number, d2: number, l2: number): number => {
    const r1 = m.raOhmCm * (l1 / 2 * 1e-4) / (cylCrossUm2(d1) * UM2_TO_CM2);
    const r2 = m.raOhmCm * (l2 / 2 * 1e-4) / (cylCrossUm2(d2) * UM2_TO_CM2);
    return 1e9 / (r1 + r2); // Ohm^-1 -> nS
  };
  const hh = DEFAULT_HH_PARAMS;
  return {
    areaSomaCm2: aSoma, areaApicalCm2: aApi, areaBasalCm2: aBas,
    cSomaPF: m.cmUFperCm2 * aSoma * 1e6,
    cApicalPF: m.cmUFperCm2 * aApi * 1e6,
    cBasalPF: m.cmUFperCm2 * aBas * 1e6,
    gLeakSomaNS: m.gLeakMSperCm2 * aSoma * 1e6,
    gLeakApicalNS: m.gLeakMSperCm2 * aApi * 1e6,
    gLeakBasalNS: m.gLeakMSperCm2 * aBas * 1e6,
    gAxialApicalNS: axialNS(m.somaDiameterUm, m.somaLengthUm, m.apicalDiameterUm, m.apicalLengthUm),
    gAxialBasalNS: axialNS(m.somaDiameterUm, m.somaLengthUm, m.basalDiameterUm, m.basalLengthUm),
    gNaSomaNS: hh.gNaMSperCm2 * aSoma * 1e6,
    gKSomaNS: hh.gKMSperCm2 * aSoma * 1e6,
    apicalSeparationUm: (m.somaLengthUm + m.apicalLengthUm) / 2,
    basalSeparationUm: (m.somaLengthUm + m.basalLengthUm) / 2,
  };
}
/** 无限电缆长度常数 lambda = sqrt(d * Rm / (4 * Ra))；顶树突默认 408 um。 */
export function cableLengthConstantUm(
  dUm = 2, raOhmCm = 100,
  gLeakMSperCm2 = DEFAULT_MULTICOMP_MORPHOLOGY.gLeakMSperCm2,
): number {
  const rMOhmCm2 = 1 / (gLeakMSperCm2 * 1e-3);
  return Math.sqrt(dUm * 1e-4 * rMOhmCm2 / (4 * raOhmCm)) * 1e4;
}
type McFullState = readonly [number, number, number, number, number, number];
function mcDerivative(
  s: McFullState, iSomaPA: number, iApiPA: number, iBasPA: number,
  morph: CompartmentMorphology, derived: DerivedMorphology,
): McFullState {
  const [vs, m, h, n, va, vb] = s;
  const hh = DEFAULT_HH_PARAMS;
  const [aM, bM, aH, bH, aN, bN] = hhAlphaBeta(vs - hh.restMv);
  let iNa = 0;
  let iK = 0;
  // 主动胞体用 HH 漏电池（Na 窗口电流在静息处平衡它）；被动胞体
  // 与树突的漏反转在静息电位本身（见 Python 对照 E_LEAK_MV 注释）。
  let iLSoma = derived.gLeakSomaNS * (vs - morph.eLeakMv);
  if (morph.somaActive) {
    iNa = derived.gNaSomaNS * m ** 3 * h * (vs - hh.eNaMv);
    iK = derived.gKSomaNS * n ** 4 * (vs - hh.eKMv);
    iLSoma = derived.gLeakSomaNS * (vs - hh.eLMv);
  }
  const iAxApi = derived.gAxialApicalNS * (vs - va);
  const iAxBas = derived.gAxialBasalNS * (vs - vb);
  const dvs = (iSomaPA - iNa - iK - iLSoma - iAxApi - iAxBas) / derived.cSomaPF;
  const dva = (iApiPA - derived.gLeakApicalNS * (va - morph.eLeakMv) -
    derived.gAxialApicalNS * (va - vs)) / derived.cApicalPF;
  const dvb = (iBasPA - derived.gLeakBasalNS * (vb - morph.eLeakMv) -
    derived.gAxialBasalNS * (vb - vs)) / derived.cBasalPF;
  return [
    dvs,
    aM * (1 - m) - bM * m,
    aH * (1 - h) - bH * h,
    aN * (1 - n) - bN * n,
    dva, dvb,
  ];
}
function mcRk4(
  s: McFullState, iSomaPA: number, iApiPA: number, iBasPA: number,
  morph: CompartmentMorphology, derived: DerivedMorphology, dt: number,
): McFullState {
  const add = (x: McFullState, k: McFullState, f: number): McFullState =>
    [x[0] + f * k[0], x[1] + f * k[1], x[2] + f * k[2],
     x[3] + f * k[3], x[4] + f * k[4], x[5] + f * k[5]] as const;
  const k1 = mcDerivative(s, iSomaPA, iApiPA, iBasPA, morph, derived);
  const k2 = mcDerivative(add(s, k1, dt / 2), iSomaPA, iApiPA, iBasPA, morph, derived);
  const k3 = mcDerivative(add(s, k2, dt / 2), iSomaPA, iApiPA, iBasPA, morph, derived);
  const k4 = mcDerivative(add(s, k3, dt), iSomaPA, iApiPA, iBasPA, morph, derived);
  const w = (i: number) => dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
  return [s[0] + w(0), s[1] + w(1), s[2] + w(2),
          s[3] + w(3), s[4] + w(4), s[5] + w(5)] as const;
}
export function createMulticompartmentNeuron(
  morph: CompartmentMorphology = DEFAULT_MULTICOMP_MORPHOLOGY,
  opts: { dtMs?: number } = {},
) {
  validateMulticompMorphology(morph);
  const dtMs = opts.dtMs ?? DEFAULT_HH_PARAMS.dtMs;
  if (!Number.isFinite(dtMs) || dtMs <= 0 || dtMs > 0.1) {
    throw new RangeError('Invalid multicompartment step');
  }
  const derived = deriveMulticompartmentMorphology(morph);
  const hh = DEFAULT_HH_PARAMS;
  const [m0, h0, n0] = hhSteadyGating(0);
  const initial: McFullState = [hh.restMv, m0, h0, n0, hh.restMv, hh.restMv];
  let state: McFullState = initial;
  let steps = 0;
  let t = 0;
  let spikes = 0;
  let lastSpike: number | null = null;
  const read = (): MulticompartmentState => {
    const [vs, m, h, n, va, vb] = state;
    const iAxApi = derived.gAxialApicalNS * (vs - va);
    const q = cellularDipoleNAm(iAxApi, derived.apicalSeparationUm / 1000);
    return {
      tMs: t, vSomaMv: vs, m, h, n, vApicalMv: va, vBasalMv: vb,
      iAxialApicalPA: iAxApi,
      iAxialBasalPA: derived.gAxialBasalNS * (vs - vb),
      spikeCount: spikes, lastSpikeMs: lastSpike,
      equivalentMomentNAm: q,
      impliedScalpUv: impliedScalpUv(
        q * DEFAULT_DIPOLE_N_CELLS * DEFAULT_DIPOLE_COHERENCE),
    };
  };
  return {
    read,
    derived,
    reset: (): MulticompartmentState => {
      state = initial; steps = 0; t = 0; spikes = 0; lastSpike = null; return read();
    },
    /** 一步 RK4；三个房室的注入电流（pA）在步内恒定；发放检测看胞体上穿 0 mV。 */
    step: (iSomaPA = 0, iApicalPA = 0, iBasalPA = 0): MulticompartmentState => {
      if (![iSomaPA, iApicalPA, iBasalPA].every(Number.isFinite)) {
        throw new RangeError('Multicompartment currents must be finite');
      }
      const vPrev = state[0];
      state = mcRk4(state, iSomaPA, iApicalPA, iBasalPA, morph, derived, dtMs);
      if (!state.every(Number.isFinite)) {
        throw new RangeError('Multicompartment state diverged');
      }
      if (vPrev < 0 && state[0] >= 0) {
        spikes += 1;
        lastSpike = (steps + 1) * dtMs;
      }
      steps += 1;
      t = steps * dtMs;
      return read();
    },
  };
}
export interface MulticompartmentTrace {
  timesMs: number[];
  vSomaMv: number[];
  vApicalMv: number[];
  vBasalMv: number[];
  iAxialApicalPA: number[];
  spikeTimesMs: number[];
}
export function simulateMulticompartment(
  morph: CompartmentMorphology, durationMs: number,
  currentFn: (tMs: number) => [number, number, number],
  sampleEveryMs = 0.1, dtMs = DEFAULT_HH_PARAMS.dtMs,
): MulticompartmentTrace {
  const neuron = createMulticompartmentNeuron(morph, { dtMs });
  const nSteps = Math.round(durationMs / dtMs);
  const every = Math.max(1, Math.round(sampleEveryMs / dtMs));
  const timesMs: number[] = [0];
  const vSomaMv: number[] = [neuron.read().vSomaMv];
  const vApicalMv: number[] = [neuron.read().vApicalMv];
  const vBasalMv: number[] = [neuron.read().vBasalMv];
  const iAxialApicalPA: number[] = [neuron.read().iAxialApicalPA];
  const spikeTimesMs: number[] = [];
  for (let k = 0; k < nSteps; k++) {
    const before = neuron.read().spikeCount;
    const [iS, iA, iB] = currentFn(k * dtMs);
    const s = neuron.step(iS, iA, iB);
    if (s.spikeCount > before && s.lastSpikeMs !== null) {
      spikeTimesMs.push(s.lastSpikeMs);
    }
    if ((k + 1) % every === 0 || k === nSteps - 1) {
      timesMs.push(s.tMs);
      vSomaMv.push(s.vSomaMv); vApicalMv.push(s.vApicalMv);
      vBasalMv.push(s.vBasalMv); iAxialApicalPA.push(s.iAxialApicalPA);
    }
  }
  return { timesMs, vSomaMv, vApicalMv, vBasalMv, iAxialApicalPA, spikeTimesMs };
}
/**
 * 全被动三房室线性系统的精确稳态（3×3 高斯消元），用于电缆理论对照：
 * 顶树突注入恒定电流时，电压必须从树突向胞体衰减。
 */
export function passiveSteadyState(
  iSomaPA: number, iApicalPA: number, iBasalPA: number,
  morph: CompartmentMorphology = DEFAULT_MULTICOMP_MORPHOLOGY,
): [number, number, number] {
  const d = deriveMulticompartmentMorphology(morph);
  const el = morph.eLeakMv;
  const g = [
    [d.gLeakSomaNS + d.gAxialApicalNS + d.gAxialBasalNS, -d.gAxialApicalNS, -d.gAxialBasalNS],
    [-d.gAxialApicalNS, d.gLeakApicalNS + d.gAxialApicalNS, 0],
    [-d.gAxialBasalNS, 0, d.gLeakBasalNS + d.gAxialBasalNS],
  ];
  const rhs = [
    iSomaPA + el * d.gLeakSomaNS,
    iApicalPA + el * d.gLeakApicalNS,
    iBasalPA + el * d.gLeakBasalNS,
  ];
  // Gaussian elimination with partial pivoting (3x3).
  const a = g.map((row, i) => [...row, rhs[i]]);
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    }
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = col + 1; r < 3; r++) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c < 4; c++) a[r][c] -= f * a[col][c];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = a[r][3];
    for (let c = r + 1; c < 3; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return [x[0], x[1], x[2]];
}

// ---------------------------------------------------------------------------
// Cross-scale coupling (ASSUMED, uncalibrated — same status as PR5)
// ---------------------------------------------------------------------------
/** WC 网络静息平均 E（契约 §4.1）。 */
export const WC_BASELINE_E = 0.011;
export interface WcToCellularParams {
  baselineE: number;
  /** LIF 用增益，pA / 单位 E。 */
  lifGainPaPerE: number;
  /** HH 用增益，uA/cm^2 / 单位 E。 */
  hhGainUaPerCm2PerE: number;
}
/**
 * 前向映射的默认增益（假设，未校准）：
 * - LIF 1000 pA/单位 E：E=0.5 → 489 pA，刚过 LIF 流变 375 pA，约 60 Hz；
 *   E=0.1 → 89 pA，阈下无发放。
 * - HH 20 uA/cm^2/单位 E：E=0.5 → 9.78 uA/cm^2，恰在 HH 持续电流阈值
 *   （~9.8）附近；E=0.1 → 1.78，静默。
 * 两套细胞模型单位不同（pA 对 uA/cm^2），一个增益不可能对两者同时
 * 合理——所以分开给、各自写清算出的数；这本身就是诚实陈述的一部分。
 */
export const DEFAULT_WC_TO_CELLULAR_PARAMS: Readonly<WcToCellularParams> =
  Object.freeze({ baselineE: WC_BASELINE_E, lifGainPaPerE: 1000, hhGainUaPerCm2PerE: 20 });
export interface RateToPopulationParams {
  baselineHz: number;
  /** P 单位 / Hz。 */
  gainPPerHz: number;
}
export const DEFAULT_RATE_TO_POPULATION_PARAMS: Readonly<RateToPopulationParams> =
  Object.freeze({ baselineHz: 0, gainPPerHz: 0.002 });
/** 偶极链共用 PR5 的假设数（未重拟合）：N=1,000,000，coherence=0.08。 */
export const DEFAULT_DIPOLE_N_CELLS = 1_000_000;
export const DEFAULT_DIPOLE_COHERENCE = 0.08;
/** Pz 增益 0.16 uV/(nA·m)（PR6 §1.8，球形头中央值）。 */
export const DEFAULT_PZ_GAIN_UV_PER_NAM = 0.16;
/** 真实 oddball P300 在 Pz 的峰值 8.89 uV（公开 EEG 约束，PR6）。 */
export const TRUE_ODDBALL_PZ_UV = 8.89;

export function wcToLifCurrentPA(
  e: number, p: WcToCellularParams = DEFAULT_WC_TO_CELLULAR_PARAMS,
): number {
  if (!Number.isFinite(e) || e < 0 || e > 1) {
    throw new RangeError('Region activity E must be a finite fraction in [0, 1]');
  }
  return p.lifGainPaPerE * (e - p.baselineE);
}
export function wcToHhCurrentDensityUAperCm2(
  e: number, p: WcToCellularParams = DEFAULT_WC_TO_CELLULAR_PARAMS,
): number {
  if (!Number.isFinite(e) || e < 0 || e > 1) {
    throw new RangeError('Region activity E must be a finite fraction in [0, 1]');
  }
  return p.hhGainUaPerCm2PerE * (e - p.baselineE);
}
/** 反向映射：dP = gain * (rate - baseline)；60 Hz LIF 发放 → dP = 0.12。 */
export function firingRateToPopulationDriveP(
  rateHz: number,
  p: RateToPopulationParams = DEFAULT_RATE_TO_POPULATION_PARAMS,
): number {
  if (!Number.isFinite(rateHz) || rateHz < 0) {
    throw new RangeError('Firing rate must be finite and >= 0 Hz');
  }
  return p.gainPPerHz * (rateHz - p.baselineHz);
}
/** 细胞偶极矩：q = I_axial * d * 1e-6 [nA·m]（pA * mm = 1e-6 nA·m）。 */
export function cellularDipoleNAm(axialCurrentPA: number, separationMm: number): number {
  if (![axialCurrentPA, separationMm].every(Number.isFinite)) {
    throw new RangeError('Cellular dipole inputs must be finite');
  }
  return axialCurrentPA * separationMm * 1e-6;
}
/** 径向偶极子在 Pz 的头皮电位（uV）= q * Pz 增益。 */
export function impliedScalpUv(
  qNAm: number, pzGainUvPerNAm = DEFAULT_PZ_GAIN_UV_PER_NAM,
): number {
  if (![qNAm, pzGainUvPerNAm].every(Number.isFinite)) {
    throw new RangeError('Implied scalp potential inputs must be finite');
  }
  return qNAm * pzGainUvPerNAm;
}
