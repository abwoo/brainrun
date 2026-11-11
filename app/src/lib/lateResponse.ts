/**
 * PR6 (B2) — 晚期成分机制（late response）+ oddball 实验 + ERP 分析。
 *
 * 对应 Python 独立对照 `scientific/eeg/late_response_reference.py`
 *（SciPy DOP853；TS 为 RK4、dt = 0.5 ms；数值对照容差见
 * `tests/pr6/waves-erp.test.mjs`，y0 与 q 均为 <1e-6 级）。
 *
 * ── 机制：慢突触电流 + 延迟再入（slow NMDA-like synaptic current）──
 * 快通路收到的传入驱动（40 ms 矩形刺激脉冲）同时驱动一个第二慢的
 * 二阶突触核：
 *
 *   dr/dt = w
 *   dw/dt = a_s² · (gain · stim(t − delay) − r) − 2·a_s·w,
 *   a_s = 1/τ_slow，τ_slow = 200 ms，delay = 100 ms，gain = 2.5。
 *
 * 其输出 r(t) [1/s] 作为额外传入反馈回同一 JR 柱：
 * p(t) = p0 + stim(t) + r(t)。这是一个带参数的动力学机制（慢突触核
 * 自带时间常数、延迟与增益），**不是**在输出上加一段固定 P300 波形：
 * 晚期波形由慢核 + 柱 ODE 演化出来，oddball/standard 差异由驱动幅度
 *（300 vs 120 1/s）经过同一慢核产生，响应在刺激后回到基线（无锁存）。
 * 快/慢双动力学对应同一传入驱动的两条突触电流（快 AMPA-like 经 JR
 * 的 y1 核、慢 NMDA-like 经本慢核）；100 ms 延迟代表多突触再入环路
 * 的传导时间（皮层-丘脑/皮层-皮层环路），不是拟合参数。
 *
 * 静息时 stim = 0 ⇒ r = 0（精确成立），基线就是普通 JR p0=90 低分支
 * 不动点（`equilibrateJansenRit` 求得，与 Python fsolve 一致）。
 *
 * ── 硬上限（结构性，不可调参修好）──
 * y0 受 JR sigmoid 饱和限制在 ~0.16 mV ⇒ q 峰 ≲1.3 nA·m ⇒ Pz
 * ≲0.21 µV，无论慢增益多大。本机制只修形态（晚期窗内从 ~0 变为非零、
 * 潜伏期落在 250–600 ms 窗内、oddball 选择性），不修幅度：与真实
 * P300（8.89 µV @410 ms）的幅度差距仍在（峰值约 51 倍），见
 * `docs/pr6-erp-mechanism.md` 与 `docs/pr6-acceptance.md`。
 * **全模块不做任何幅度重缩放**：N×coherence×pA×mm 乘积结构不可辨识
 *（见 `docs/pr5-public-eeg-constraint.md`），Pz 增益固定用 PR5 的
 * 球形头中央值 0.160 µV/(nA·m)，不按实测/模型比值反推。
 *
 * ── 安全 ──
 * 增益 ≳4 时慢反馈会把柱子短暂推上 JR 上分支并锁存（q 在 2000 ms
 * 后仍不回零；见 Python 原型与测试）。默认增益 2.5（实测安全上限约
 * 3.5–4）；`detectLatch` 在每次长跑后检查回零情况，锁存即报
 * `latched: true`（不静默通过）；`step` 内有 JR 同款发散守卫
 *（y0/y1/y2 越出 [−10, 100] mV、非有限值、r 超过 slowMaxPerS 即抛错）。
 *
 * ── 量纲 ──
 * 时间 ms、时间常数/延迟 ms、电位 mV、发放率 1/s、偶极矩 nA·m、
 * EEG µV、频率 Hz。输出采样 250 Hz（4 ms 网格，与 ds003061 一致）。
 * Pz 通道位置 [0, −50, 90] mm（head-RAS 示意值，沿用 PR5 测试的
 * Pz 位置）；µV 换算不用该位置插值 lead-field，而用 PR5 已发表的
 * 球形头 Pz 中央增益 0.160 µV/(nA·m)（范围 0.130–0.188）。
 */

import {
  DEFAULT_JANSEN_RIT_PARAMS,
  DEFAULT_JR_MORPHOLOGY,
  createJansenRitColumn,
  equilibrateJansenRit,
  equivalentMomentNAmJR,
  jansenRitSigmoidPerS,
  validateJansenRitParams,
  type JansenRitParams,
} from './jansenRitColumn.ts';
import { validateMorphology, type DipoleMorphology } from './localCorticalColumn.ts';
import { SPHERE_MODEL_ID } from './sphereForward.ts';
import type { EegEvent, EegRecording, EpochSet, ErpResult } from './eegData.ts';
import { averageEpochs, epochRecording, peakInWindow } from './signalProcessing.ts';

/** 本机制的源模型 id（进 `EegRecording.sourceModelId`）。 */
export const LATE_RESPONSE_ID = 'local-jansen-rit-slow-late-v1';

/** Pz 球形头增益中央值，µV/(nA·m)（PR5 约束文档，四层球形头，顶叶中线径向源）。 */
export const PZ_GAIN_UV_PER_NAM = 0.16;
/** 同上，4 个顶叶源变体的范围（只作不确定性说明，不参与计算）。 */
export const PZ_GAIN_RANGE_UV_PER_NAM: readonly [number, number] = [0.13, 0.188];

/** 慢机制参数。 */
export interface LateResponseParams {
  /** 慢核时间常数 τ_slow，ms。 */
  tauSlowMs: number;
  /** 再入延迟，ms（慢核驱动取 stim(t − delay)）。 */
  delayMs: number;
  /** 慢核增益，无量纲（驱动 = gain × 延迟后刺激，1/s）。 */
  slowGain: number;
  /** 慢核输出 r 的数值守卫上限，1/s（正常使用下永不触发：r ≤ gain×1000）。 */
  slowMaxPerS: number;
}

/** 默认慢机制参数（与 Python 对照 `TAU_SLOW_MS / DELAY_MS / SLOW_GAIN` 同值）。 */
export const DEFAULT_LATE_RESPONSE_PARAMS: Readonly<LateResponseParams> = Object.freeze({
  tauSlowMs: 200,
  delayMs: 100,
  slowGain: 2.5,
  slowMaxPerS: 5000,
});

/** Oddball 实验协议（与 Python 对照同值；PR5 的标准脉冲 120 1/s、40 ms 沿用）。 */
export const STIM_DURATION_MS = 40;
export const STANDARD_DRIVE_PER_S = 120;
export const ODDBALL_DRIVE_PER_S = 300;
/** 默认试次数与固定 ISI（ds003061 约 1 个刺激/秒；比例 4:1 ≈ 真实 476:99）。 */
export const DEFAULT_N_TRIALS = 40;
export const DEFAULT_ISI_MS = 1000;

/** P300 窗（峰值）与窗均值窗，与 ds003061 约束口径一致。 */
export const P300_PEAK_WINDOW_MS: readonly [number, number] = [250, 600];
export const P300_MEAN_WINDOW_MS: readonly [number, number] = [300, 500];
/** MNE 口径 epoch：−200–800 ms、基线 −200–0 ms、峰峰值 >150 µV 剔除。 */
export const ERP_TMIN_MS = -200;
export const ERP_TMAX_MS = 800;
export const ERP_BASELINE_MS: readonly [number, number] = [-200, 0];
export const ERP_REJECT_PEAK_TO_PEAK_UV = 150;

export function validateLateResponseParams(p: LateResponseParams): void {
  if (
    !Number.isFinite(p.tauSlowMs) || p.tauSlowMs < 20 || p.tauSlowMs > 1000 ||
    !Number.isFinite(p.delayMs) || p.delayMs < 0 || p.delayMs > 500 ||
    !Number.isFinite(p.slowGain) || p.slowGain < 0 || p.slowGain > 100 ||
    !Number.isFinite(p.slowMaxPerS) || p.slowMaxPerS <= 0 || p.slowMaxPerS > 100000
  ) {
    throw new RangeError(`Invalid late-response parameters: ${JSON.stringify(p)}`);
  }
}

/** 8 维增广状态：JR 的 y0..y5 + 慢核 (r, w)。r 单位 1/s，w 单位 1/s 每 ms。 */
type LateState = readonly [number, number, number, number, number, number, number, number];

function lateDerivative(
  s: LateState,
  pTotalPerS: number,
  slowTargetPerS: number,
  jr: JansenRitParams,
  late: LateResponseParams,
): LateState {
  const [y0, y1, y2, y3, y4, y5, r, w] = s;
  const a = jr.rateExcPerS / 1000;
  const b = jr.rateInhPerS / 1000;
  const aS = 1 / late.tauSlowMs;
  const sPerMs = (v: number) => jansenRitSigmoidPerS(v, jr) / 1000;
  return [
    y3,
    y4,
    y5,
    jr.gainExcMv * a * sPerMs(y1 - y2) - 2 * a * y3 - a * a * y0,
    jr.gainExcMv * a * (pTotalPerS / 1000 + jr.c2 * sPerMs(jr.c1 * y0)) -
      2 * a * y4 - a * a * y1,
    jr.gainInhMv * b * jr.c4 * sPerMs(jr.c3 * y0) - 2 * b * y5 - b * b * y2,
    w,
    aS * aS * (slowTargetPerS - r) - 2 * aS * w,
  ];
}

function rk4Step(
  s: LateState,
  stimulusAt: (tMs: number) => number,
  tMs: number,
  jr: JansenRitParams,
  late: LateResponseParams,
  dtMs: number,
): LateState {
  // 关键：每级（k1–k4）都在该级的时刻上取值（t、t+dt/2、t+dt），p_total
  // 用该级状态的 r（不是步首 r）——若全步共用步首值，r 在步内的变化
  // 被忽略，形成一阶误差：实测 dt=0.5 ms 时 y0 差 4.5e-4 mV（相对信号
  // 0.3%），且随 dt 一阶缩小（dt=0.25 时 2.3e-4）。
  // 边沿处的左右极限：刺激是分段常数、边沿落在步长网格上。k1 在步首
  // 取右极限（步向右走）、k4 在步末取左极限（从步内逼近）——即 k4 的
  // 输入时刻取 t+dt−ε；若 k4 也取右极限，相当于把脉冲缩短 dt/6，实测
  // 在 t=40 ms 处引入 3e-4 mV 的一阶误差。k2/k3 在半步上，永不落在边沿上。
  // 这样处理后，TS RK4 与 Python DOP853 的差回到 <1e-6 mV
  //（见 tests/pr6/waves-erp.test.mjs）。
  const stage = (st: LateState, tStage: number, leftLimit: boolean): LateState => {
    const tt = leftLimit ? tStage - 1e-9 : tStage;
    const stim = stimulusAt(tt);
    if (!Number.isFinite(stim) || stim < 0 || stim > 1000) {
      throw new RangeError(`Unphysical/nonfinite late-response stimulus ${stim} 1/s at t=${tt} ms`);
    }
    const stimDelayed = stimulusAt(tt - late.delayMs);
    const target = Math.min(late.slowGain * stimDelayed, late.slowMaxPerS);
    return lateDerivative(st, jr.baselineInputPerS + stim + st[6], target, jr, late);
  };
  const add = (x: LateState, k: LateState, f: number): LateState =>
    [x[0] + f * k[0], x[1] + f * k[1], x[2] + f * k[2], x[3] + f * k[3],
     x[4] + f * k[4], x[5] + f * k[5], x[6] + f * k[6], x[7] + f * k[7]] as const;
  const k1 = stage(s, tMs, false);
  const k2 = stage(add(s, k1, dtMs / 2), tMs + dtMs / 2, false);
  const k3 = stage(add(s, k2, dtMs / 2), tMs + dtMs / 2, false);
  const k4 = stage(add(s, k3, dtMs), tMs + dtMs, true);
  const w = (i: number) => dtMs * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
  return [s[0] + w(0), s[1] + w(1), s[2] + w(2), s[3] + w(3),
          s[4] + w(4), s[5] + w(5), s[6] + w(6), s[7] + w(7)] as const;
}

export interface LateResponseState {
  tMs: number;
  y0: number;
  y1: number;
  y2: number;
  y1MinusY2: number;
  /** 慢核输出 r，1/s（反馈回柱子的额外传入）。 */
  slowRPerS: number;
  /** 慢核当前目标，1/s（= gain × 延迟后刺激，截断到 slowMaxPerS）。 */
  slowTargetPerS: number;
  /** 当前刺激驱动，1/s。 */
  stimulusPerS: number;
  baselineY0: number;
  equivalentMomentNAm: number;
  /** Pz 电位，µV（q × 0.160，PR5 球形头中央增益）。 */
  pzUv: number;
}

export interface LateResponseColumnOptions {
  jrParams?: JansenRitParams;
  lateParams?: LateResponseParams;
  morphology?: DipoleMorphology;
  /** 刺激驱动函数：stimulusAt(tMs) → 附加输入，1/s（试次外为 0）。 */
  stimulusAt?: (tMs: number) => number;
  /** 仿真时钟起点，ms（试次内一般为 −200）。 */
  t0Ms?: number;
}

/**
 * 带慢机制的 JR 柱（有确定性仿真时钟）。步进 dt = jrParams.dtMs（默认
 * 0.5 ms RK4）；刺激驱动在 RK4 各级时刻上取值（见 `rk4Step` 注释），
 * 不是全步共用步首值。基线为 p0 低分支不动点（r = 0）。
 */
export function createLateResponseColumn(opts: LateResponseColumnOptions = {}) {
  const jr = opts.jrParams ?? DEFAULT_JANSEN_RIT_PARAMS;
  const late = opts.lateParams ?? DEFAULT_LATE_RESPONSE_PARAMS;
  const morphology = opts.morphology ?? DEFAULT_JR_MORPHOLOGY;
  const stimulusAt = opts.stimulusAt ?? (() => 0);
  validateJansenRitParams(jr);
  validateLateResponseParams(late);
  validateMorphology(morphology);
  // 静息时 r = 0 精确成立，基线即普通 JR 不动点（+ [0, 0]）。
  const jrBaseline = equilibrateJansenRit(jr);
  const baseline: LateState = [...jrBaseline, 0, 0] as const;
  let state: LateState = baseline;
  let t = opts.t0Ms ?? 0;
  const read = (): LateResponseState => {
    const q = equivalentMomentNAmJR(state[0], baseline[0], morphology);
    return {
      tMs: t,
      y0: state[0],
      y1: state[1],
      y2: state[2],
      y1MinusY2: state[1] - state[2],
      slowRPerS: state[6],
      slowTargetPerS: Math.min(
        late.slowGain * stimulusAt(t - late.delayMs), late.slowMaxPerS),
      stimulusPerS: stimulusAt(t),
      baselineY0: baseline[0],
      equivalentMomentNAm: q,
      pzUv: q * PZ_GAIN_UV_PER_NAM,
    };
  };
  return {
    read,
    reset: (): LateResponseState => {
      state = baseline;
      t = opts.t0Ms ?? 0;
      return read();
    },
    /** 步进一个 dtMs：刺激与延迟后刺激在 RK4 各级时刻上取值（见 rk4Step）。 */
    step: (): LateResponseState => {
      state = rk4Step(state, stimulusAt, t, jr, late, jr.dtMs);
      if (
        state.some((v) => !Number.isFinite(v)) ||
        state[0] < -10 || state[0] > 100 ||
        state[1] < -10 || state[1] > 100 ||
        state[2] < -10 || state[2] > 100 ||
        state[6] < -1e-9 || state[6] > late.slowMaxPerS + 1e-9
      ) {
        throw new RangeError('Late-response column diverged (state out of bounds)');
      }
      t += jr.dtMs;
      return read();
    },
  };
}

export interface LateTrialResult {
  timesMs: number[];
  y0Mv: number[];
  qNAm: number[];
  pzUv: number[];
  slowRPerS: number[];
  baselineY0Mv: number;
  /** 长跑末尾是否未回基线（锁存检测，见 `detectLatch`）。 */
  latched: boolean;
  peakAbsQNAm: number;
}

/**
 * 锁存检测：末尾 `tailMs` 内 |q| 均值超过峰值 |q| 的 `ratio` 即判锁存。
 * 安全跑的比值 ~1e-4，锁存跑 ~0.5–0.75；阈值 0.05 远离两者。
 */
export function detectLatch(
  qNAm: readonly number[],
  timesMs: readonly number[],
  tailMs = 100,
  ratio = 0.05,
): boolean {
  if (qNAm.length === 0) return false;
  let peak = 0;
  for (const q of qNAm) peak = Math.max(peak, Math.abs(q));
  if (peak === 0) return false;
  const tEnd = timesMs[timesMs.length - 1];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < qNAm.length; i++) {
    if (timesMs[i] >= tEnd - tailMs) {
      sum += Math.abs(qNAm[i]);
      n++;
    }
  }
  return n > 0 && sum / n > ratio * peak;
}

export interface LateTrialOptions {
  jrParams?: JansenRitParams;
  lateParams?: LateResponseParams;
  morphology?: DipoleMorphology;
  /** 试次起点，ms（默认 −200，与 epoch tmin 对齐）。 */
  tStartMs?: number;
  /** 试次终点，ms（默认 2000，够锁存检测；实验用 800）。 */
  tEndMs?: number;
  /** 输出采样间隔，ms（默认 4，即 250 Hz）。 */
  sampleDtMs?: number;
}

/**
 * 单试次：刺激脉冲在 t=0、持续 `STIM_DURATION_MS`、幅度 `pulsePerS`。
 * 从平衡基线起跑，输出 250 Hz 采样轨迹。默认跑到 2000 ms 以便锁存检测。
 */
export function simulateLateTrial(
  pulsePerS: number,
  opts: LateTrialOptions = {},
): LateTrialResult {
  const jr = opts.jrParams ?? DEFAULT_JANSEN_RIT_PARAMS;
  const tStartMs = opts.tStartMs ?? ERP_TMIN_MS;
  const tEndMs = opts.tEndMs ?? 2000;
  const sampleDtMs = opts.sampleDtMs ?? 4;
  if (!Number.isFinite(pulsePerS) || pulsePerS < 0 || pulsePerS > 1000) {
    throw new RangeError(`pulsePerS must be in [0, 1000] 1/s, got ${pulsePerS}`);
  }
  if (tEndMs <= tStartMs) throw new RangeError('simulateLateTrial: need tStartMs < tEndMs');
  if (Math.abs(tStartMs / sampleDtMs - Math.round(tStartMs / sampleDtMs)) > 1e-9) {
    throw new RangeError('simulateLateTrial: tStartMs must be a multiple of sampleDtMs');
  }
  const stimulusAt = (t: number) =>
    t >= 0 && t < STIM_DURATION_MS ? pulsePerS : 0;
  const col = createLateResponseColumn({
    jrParams: jr,
    lateParams: opts.lateParams,
    morphology: opts.morphology,
    stimulusAt,
    t0Ms: tStartMs,
  });
  const stepsPerSample = Math.round(sampleDtMs / jr.dtMs);
  if (Math.abs(stepsPerSample * jr.dtMs - sampleDtMs) > 1e-9) {
    throw new RangeError('simulateLateTrial: sampleDtMs must be a multiple of jr dtMs');
  }
  const timesMs: number[] = [];
  const y0Mv: number[] = [];
  const qNAm: number[] = [];
  const pzUv: number[] = [];
  const slowRPerS: number[] = [];
  let peakAbsQNAm = 0;
  const nSteps = Math.round((tEndMs - tStartMs) / jr.dtMs);
  for (let i = 0; i <= nSteps; i++) {
    if (i % stepsPerSample === 0) {
      const s = col.read();
      timesMs.push(s.tMs);
      y0Mv.push(s.y0);
      qNAm.push(s.equivalentMomentNAm);
      pzUv.push(s.pzUv);
      slowRPerS.push(s.slowRPerS);
      peakAbsQNAm = Math.max(peakAbsQNAm, Math.abs(s.equivalentMomentNAm));
    }
    if (i < nSteps) col.step();
  }
  return {
    timesMs,
    y0Mv,
    qNAm,
    pzUv,
    slowRPerS,
    baselineY0Mv: col.read().baselineY0,
    latched: detectLatch(qNAm, timesMs),
    peakAbsQNAm,
  };
}

/* ── PR-08：JR p0=220 alpha 极限环 ─────────────────────────────────── */

export interface AlphaLimitCycleResult {
  /** 250 Hz 采样时刻（已去掉前 settleMs），ms。 */
  timesMs: number[];
  y0Mv: number[];
  qNAm: number[];
  pzUv: number[];
  baselineY0Mv: number;
}

/**
 * JR p0=220 极限环：从零起跑（**不**做不动点平衡——p0=220 没有稳定
 * 不动点，是约 10.5 Hz 极限环；`equilibrateJansenRit` 在此会大声失败，
 * 故直接用 `equilibrate: false`）。默认跑 12 s、去掉前 2 s，返回
 * 10 s 连续记录（250 Hz）。Welch PSD 由调用方用 A1 的 `welchPsd` 做。
 */
export function runAlphaLimitCycle(opts: {
  durationMs?: number;
  settleMs?: number;
  sampleDtMs?: number;
  morphology?: DipoleMorphology;
} = {}): AlphaLimitCycleResult {
  const durationMs = opts.durationMs ?? 12000;
  const settleMs = opts.settleMs ?? 2000;
  const sampleDtMs = opts.sampleDtMs ?? 4;
  const morphology = opts.morphology ?? DEFAULT_JR_MORPHOLOGY;
  const jrParams = { ...DEFAULT_JANSEN_RIT_PARAMS, baselineInputPerS: 220 };
  validateJansenRitParams(jrParams);
  const col = createJansenRitColumn(jrParams, morphology, { equilibrate: false });
  const stepsPerSample = Math.round(sampleDtMs / jrParams.dtMs);
  const timesMs: number[] = [];
  const y0Mv: number[] = [];
  const nSteps = Math.round(durationMs / jrParams.dtMs);
  for (let i = 0; i <= nSteps; i++) {
    const t = i * jrParams.dtMs;
    if (i % stepsPerSample === 0 && t >= settleMs) {
      timesMs.push(t);
      y0Mv.push(col.read().y0);
    }
    if (i < nSteps) col.step();
  }
  // 注意：equilibrate=false 时基线是零初值，q 不能以 0 为基线；
  // 这里按沉降段均值重定基线（与 Python 对照一致）。
  let baseSum = 0;
  for (const v of y0Mv) baseSum += v;
  const baselineY0Mv = baseSum / y0Mv.length;
  const qNAm = y0Mv.map((y0) => equivalentMomentNAmJR(y0, baselineY0Mv, morphology));
  return {
    timesMs,
    y0Mv,
    qNAm,
    pzUv: qNAm.map((q) => q * PZ_GAIN_UV_PER_NAM),
    baselineY0Mv,
  };
}

/* ── PR-09：oddball 实验 ───────────────────────────────────────────── */

export interface OddballExperimentOptions {
  jrParams?: JansenRitParams;
  lateParams?: LateResponseParams;
  morphology?: DipoleMorphology;
  /** 试次数（默认 40：32 标准 + 8 oddball，每 5 个试次 1 个 oddball）。 */
  nTrials?: number;
  /** 固定 ISI，ms（默认 1000；只定事件时间戳，各试次独立从基线起跑）。 */
  isiMs?: number;
  /**
   * 测量噪声 RMS，µV（默认 0）。白噪声、有种子、可复现；**明确标注为
   * 测量噪声，不是神经源活动**。B1 的 PR-07 全噪声模型落地后由壳层
   * 替换，此处只为试次 SEM / 试次数量效应演示提供可控的试次变异性。
   */
  noiseRmsUv?: number;
  seed?: number;
}

export interface OddballExperimentResult {
  recording: EegRecording;
  events: EegEvent[];
  /** 实验参数快照（EegEvent 类型无快照字段，随结果对象一起返回）。 */
  paramsSnapshot: {
    jrParams: JansenRitParams;
    lateParams: LateResponseParams;
    morphology: DipoleMorphology;
    pzGainUvPerNAm: number;
    sourceModelId: string;
    protocol: {
      nTrials: number;
      isiMs: number;
      stimDurationMs: number;
      standardDrivePerS: number;
      oddballDrivePerS: number;
      noiseRmsUv: number;
      seed: number;
    };
  };
}

/** mulberry32 确定性 RNG（种子复现用；与 B1 的噪声约定一致的思路）。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Oddball 实验：每试次独立从平衡基线起跑（−200–800 ms），刺激在 t=0。
 * 事件时间戳是仿真时钟（累计 ISI），不是浏览器墙钟。相邻 epoch 在
 * 800/−200 ms 边界点共享一个采样点（ISI=1000 时），两端都在静息态，
 * 数值一致到 ~1e-4 µV；填充时后一试次覆盖该共享点。
 * 返回单通道 Pz 记录（250 Hz）+ 事件表 + 参数快照。
 */
export function runOddballExperiment(
  opts: OddballExperimentOptions = {},
): OddballExperimentResult {
  const jr = opts.jrParams ?? DEFAULT_JANSEN_RIT_PARAMS;
  const late = opts.lateParams ?? DEFAULT_LATE_RESPONSE_PARAMS;
  const morphology = opts.morphology ?? DEFAULT_JR_MORPHOLOGY;
  const nTrials = opts.nTrials ?? DEFAULT_N_TRIALS;
  const isiMs = opts.isiMs ?? DEFAULT_ISI_MS;
  const noiseRmsUv = opts.noiseRmsUv ?? 0;
  const seed = opts.seed ?? 1;
  if (!Number.isInteger(nTrials) || nTrials < 2) {
    throw new RangeError(`nTrials must be an integer >= 2, got ${nTrials}`);
  }
  if (!(isiMs >= ERP_TMAX_MS - ERP_TMIN_MS)) {
    throw new RangeError(`isiMs must be >= epoch length ${ERP_TMAX_MS - ERP_TMIN_MS} ms, got ${isiMs}`);
  }
  if (!Number.isFinite(noiseRmsUv) || noiseRmsUv < 0) {
    throw new RangeError(`noiseRmsUv must be >= 0, got ${noiseRmsUv}`);
  }
  const samplesPerTrial = Math.round((ERP_TMAX_MS - ERP_TMIN_MS) / 4);
  const nSamples = samplesPerTrial * nTrials + 1;
  const timesMs: number[] = [];
  for (let i = 0; i < nSamples; i++) timesMs.push(ERP_TMIN_MS + i * 4);
  const data = new Array<number>(nSamples).fill(0);
  const events: EegEvent[] = [];
  for (let k = 0; k < nTrials; k++) {
    const oddball = (k + 1) % 5 === 0;
    const pulse = oddball ? ODDBALL_DRIVE_PER_S : STANDARD_DRIVE_PER_S;
    const trial = simulateLateTrial(pulse, {
      jrParams: jr,
      lateParams: late,
      morphology,
      tStartMs: ERP_TMIN_MS,
      tEndMs: ERP_TMAX_MS,
      sampleDtMs: 4,
    });
    // trial.timesMs 为 −200..800（251 点）；第 251 点与下一试次的第 1 点同属一个绝对时刻。
    for (let j = 0; j < trial.timesMs.length; j++) {
      data[k * samplesPerTrial + j] = trial.pzUv[j];
    }
    events.push({
      id: k,
      type: oddball ? 'oddball' : 'standard',
      tMs: k * isiMs,
      condition: oddball ? 'oddball' : 'standard',
      drive: pulse,
      driveUnit: 'jr',
    });
  }
  if (noiseRmsUv > 0) {
    const rand = mulberry32(seed);
    let spare: number | null = null;
    for (let i = 0; i < nSamples; i++) {
      let g: number;
      if (spare !== null) {
        g = spare;
        spare = null;
      } else {
        let u1 = 0;
        while (u1 === 0) u1 = rand();
        const u2 = rand();
        const r = Math.sqrt(-2 * Math.log(u1));
        g = r * Math.cos(2 * Math.PI * u2);
        spare = r * Math.sin(2 * Math.PI * u2);
      }
      data[i] += g * noiseRmsUv;
    }
  }
  const recording: EegRecording = {
    version: 1,
    sfreqHz: 250,
    timesMs,
    channels: [{ label: 'Pz', positionMm: [0, -50, 90] }],
    dataUv: [data],
    reference: { mode: 'average' },
    montage: '10-20',
    forwardModelId: SPHERE_MODEL_ID,
    sourceModelId: LATE_RESPONSE_ID,
    seed,
    noise:
      noiseRmsUv > 0
        ? { whiteRmsUv: noiseRmsUv, pinkRmsUv: 0, line50HzRmsUv: 0, driftRmsUv: 0 }
        : null,
  };
  return {
    recording,
    events,
    paramsSnapshot: {
      jrParams: jr,
      lateParams: late,
      morphology,
      pzGainUvPerNAm: PZ_GAIN_UV_PER_NAM,
      sourceModelId: LATE_RESPONSE_ID,
      protocol: {
        nTrials,
        isiMs,
        stimDurationMs: STIM_DURATION_MS,
        standardDrivePerS: STANDARD_DRIVE_PER_S,
        oddballDrivePerS: ODDBALL_DRIVE_PER_S,
        noiseRmsUv,
        seed,
      },
    },
  };
}

/* ── PR-09：ERP 分析（A1 函数之上的条件对照）──────────────────────── */

export function filterEpochsByCondition(
  epochs: EpochSet,
  condition: 'standard' | 'oddball',
): EpochSet {
  const idx: number[] = [];
  for (let i = 0; i < epochs.events.length; i++) {
    if (epochs.events[i].condition === condition) idx.push(i);
  }
  return {
    ...epochs,
    trials: idx.map((i) => epochs.trials[i]),
    // 子集内的试次全部是已保留试次（kept 与输入事件对齐的原语义在此不适用，见注释）。
    kept: idx.map(() => true),
    events: idx.map((i) => epochs.events[i]),
  };
}

/**
 * 单条件 ERP：叠加平均 + SEM（A1 `averageEpochs`）+ P300 窗峰值/潜伏期
 * 与 300–500 ms 窗均值（A1 `peakInWindow`，MNE `get_peak(mode='abs')` 口径）。
 */
export function analyseErp(
  epochs: EpochSet,
  channel: string,
  peakWindowMs: readonly [number, number] = P300_PEAK_WINDOW_MS,
  meanWindowMs: readonly [number, number] = P300_MEAN_WINDOW_MS,
): ErpResult {
  const chIdx = epochs.channels.indexOf(channel);
  if (chIdx < 0) throw new RangeError(`analyseErp: channel ${channel} not in EpochSet`);
  const avg = averageEpochs(epochs);
  const peak = peakInWindow(avg.timesMs, avg.meanUv[chIdx], [peakWindowMs[0], peakWindowMs[1]]);
  // 窗均值与峰值窗可以不同：peakInWindow 的 windowMeanUv 是按峰值窗算的，这里按均值窗重算。
  const mean = peakInWindow(avg.timesMs, avg.meanUv[chIdx], [meanWindowMs[0], meanWindowMs[1]]);
  return {
    timesMs: avg.timesMs,
    meanUv: avg.meanUv,
    semUv: avg.semUv,
    n: avg.n,
    peakUv: peak.peakUv,
    peakLatencyMs: peak.latencyMs,
    windowMeanUv: mean.windowMeanUv,
    channel,
    windowMs: [peakWindowMs[0], peakWindowMs[1]],
  };
}

export interface ErpDifference {
  timesMs: number[];
  /** oddball − standard，µV（逐采样点）。 */
  diffUv: number[];
  /** 传播 SEM = √(SEM_odd² + SEM_std²)，µV。 */
  semUv: number[];
  channel: string;
  windowMs: [number, number];
  peakUv: number;
  peakLatencyMs: number;
  windowMeanUv: number;
}

/**
 * 差异波（oddball − standard）：均值相减，SEM 按独立试次传播。
 * `channelRow` 是该通道在 `ErpResult.meanUv/semUv` 行里的下标
 *（`analyseErp` 保留全部通道行，行号由 `epochs.channels` 决定，两边
 * 来自同一记录故一致；单通道 Pz 记录时为 0）。
 */
export function differenceWaveErp(
  odd: ErpResult,
  std: ErpResult,
  channelRow = 0,
  meanWindowMs: readonly [number, number] = P300_MEAN_WINDOW_MS,
): ErpDifference {
  if (odd.channel !== std.channel) {
    throw new RangeError(`differenceWaveErp: channel mismatch ${odd.channel} vs ${std.channel}`);
  }
  if (odd.timesMs.length !== std.timesMs.length) {
    throw new RangeError('differenceWaveErp: time axis length mismatch');
  }
  if (channelRow < 0 || channelRow >= odd.meanUv.length || channelRow >= std.meanUv.length) {
    throw new RangeError(`differenceWaveErp: channelRow ${channelRow} out of range`);
  }
  const nT = odd.timesMs.length;
  const diffUv = new Array<number>(nT);
  const semUv = new Array<number>(nT);
  for (let j = 0; j < nT; j++) {
    diffUv[j] = odd.meanUv[channelRow][j] - std.meanUv[channelRow][j];
    semUv[j] = Math.hypot(odd.semUv[channelRow][j], std.semUv[channelRow][j]);
  }
  const peak = peakInWindow(odd.timesMs, diffUv, [odd.windowMs[0], odd.windowMs[1]]);
  const mean = peakInWindow(odd.timesMs, diffUv, [meanWindowMs[0], meanWindowMs[1]]);
  return {
    timesMs: [...odd.timesMs],
    diffUv,
    semUv,
    channel: odd.channel,
    windowMs: [odd.windowMs[0], odd.windowMs[1]],
    peakUv: peak.peakUv,
    peakLatencyMs: peak.latencyMs,
    windowMeanUv: mean.windowMeanUv,
  };
}

/**
 * MNE 口径 epoch 切分（A1 `epochRecording` 的 PR-09 便捷封装）：
 * −200–800 ms、基线 −200–0 ms、峰峰值 >150 µV 剔除。
 */
export function epochOddballExperiment(
  recording: EegRecording,
  events: EegEvent[],
): EpochSet {
  return epochRecording(
    recording,
    events,
    ERP_TMIN_MS,
    ERP_TMAX_MS,
    [ERP_BASELINE_MS[0], ERP_BASELINE_MS[1]],
    ERP_REJECT_PEAK_TO_PEAK_UV,
  );
}
