/**
 * PR-15 — 双脑对照、时间机器、闭环控制（计划 PR-15，2.0 plan §15.1/§15.2/§15.5）。
 *
 * 被控对象 / 实验对象：局部 Jansen–Rit 皮层柱（`jansenRitColumn.ts`，
 * Jansen & Rit 1995）。本文件**不另发明一套动力学**：JR 的六个一阶 ODE
 * 与 `jansenRitColumn.ts` 的 `derivative` 逐项同式（RK4，dt = 0.5 ms），
 * sigmoid 直接复用 `jansenRitSigmoidPerS`，偶极矩耦合复用
 * `equivalentMomentNAmJR`，Pz 代理增益复用 PR6 的 `PZ_GAIN_UV_PER_NAM`
 *（0.16 µV/(nA·m)，`lateResponse.ts`）。之所以不在此复用
 * `createJansenRitColumn` 的闭包对象，是因为时间机器需要读写完整的
 * 六维状态（y0–y5，含三个导数分量）做快照/恢复，而该对象只暴露
 * y0/y1/y2；测试里用该对象作预言机（oracle），同一自由运行的 y0/q
 * 逐值对照（容差 1e-9，见 `tests/pr7/experiments.test.mjs`）。
 *
 * ── 量纲 ─────────────────────────────────────────────────────────────
 * 时间 ms（固定步长 dt = 0.5 ms，与 JR 默认一致）；电位 mV（y0/y1/y2）；
 * 输入 1/s（JR 附加输入，含事件驱动与控制器输出）；偶极矩 nA·m；
 * Pz 代理电位 µV（q × 0.16 µV/(nA·m)，与 PR6 同口径）；频段功率 µV²；
 * 频率 Hz；位置 mm；定位误差 mm。控制器输出 u 的单位是 1/s，加在 JR
 * 静息输入 p0 上：u > 0 兴奋、u < 0 抑制（下限 −p0，即不能把总输入
 * 推成负值）。
 *
 * ── 确定性 ───────────────────────────────────────────────────────────
 * 柱模型本身是确定性的（无 RNG）。测量噪声是**按采样序号索引**的
 * 确定性函数（splitmix32 哈希 → Box–Muller，种子进配置），不是流式
 * RNG：从快照恢复后重跑，同一序号的噪声逐值相同，分支点之前轨迹
 * 逐值重合。Python 对照 `reference/python-model/experiments_pr7.py`
 * 用同一哈希、同一 RK4、同一控制律。
 *
 * ── 诚实边界 ─────────────────────────────────────────────────────────
 * - q(t) → Pz 的耦合链是 PR5 的显式假设（N × coherence × 电流 × 长度
 *   不可辨识），幅度未经人体数据校准；本模块只比较**同一假设链下**
 *   的条件差异，不宣称绝对幅度。
 * - 闭环初版仅用于模拟环境，**不直接控制人体设备**（组件与文档均标注）。
 * - 基线 RMS 仍是 0、alpha 占比 99.8% vs 真实 30.3% 是 PR6 已知缺口，
 *   不属本批范围（见 `docs/pr7-experiments.md`）。
 * - 跨试次适应（突触压抑）是本批顺带实现的 PR6 残留：可选
 *   `adaptation`，重复驱动下有效驱动逐次衰减并量化；不开时试次独立。
 */

import {
  DEFAULT_JANSEN_RIT_PARAMS,
  DEFAULT_JR_MORPHOLOGY,
  equilibrateJansenRit,
  equivalentMomentNAmJR,
  jansenRitSigmoidPerS,
  validateJansenRitParams,
  type JansenRitParams,
} from './jansenRitColumn.ts';
import { PZ_GAIN_UV_PER_NAM } from './lateResponse.ts';
import { averageEpochs, epochRecording, peakInWindow, welchPsd } from './signalProcessing.ts';
import type { EegEvent, EegRecording } from './eegData.ts';
import {
  blindTest,
  type BlindTestResult,
} from './sourceLocalization.ts';
import type { MontageKey, SphereFixture } from './sphereForward.ts';
import type { Vec3Mm } from './volumeConduction.ts';

export const EXPERIMENTS_ID = 'pr15-experiments-v1';
/** 固定积分步长，ms（与 JR 默认 dtMs 一致，不可调）。 */
export const DT_MS = 0.5;
/** 控制器节拍：每 8 个植物步 = 4 ms（250 Hz），与 EEG 采样率一致。 */
export const CONTROL_TICK_STEPS = 8;
export const CONTROL_DT_MS = DT_MS * CONTROL_TICK_STEPS;
/** 闭环仅用于模拟环境的标注（组件与文档复用同一字符串）。 */
export const CLOSED_LOOP_SIMULATION_ONLY =
  '闭环初版仅用于模拟环境，不直接控制人体设备。';

/* ── 配置 ───────────────────────────────────────────────────────────── */

export interface ExperimentEventInput {
  /** 事件起始时刻，ms（须为 dt=0.5 ms 的整数倍）。 */
  tMs: number;
  /** 事件驱动，1/s（JR 附加输入，[0, 1000]）。 */
  drivePerS: number;
  /** 事件持续时长，ms（须为 0.5 ms 的整数倍）。 */
  durationMs: number;
}

/** 跨试次适应：突触压抑（Tsodyks–Markram 式单资源模型）。 */
export interface AdaptationConfig {
  /** 每次事件起始消耗的可用资源比例 U，(0, 1)。 */
  utilization: number;
  /** 资源恢复时间常数 τ_rec，ms（> 0）。 */
  tauRecMs: number;
}

export interface ExperimentConfig {
  /** 总时长，ms（须为 0.5 ms 的整数倍，> 0）。 */
  durationMs: number;
  /** JR 参数（默认 DEFAULT_JANSEN_RIT_PARAMS）。 */
  jrParams?: JansenRitParams;
  /** 静息平均输入 p0，1/s（默认 90；220 为 ~10.5 Hz 极限环，须配
   *  `limitCycle: true`，此时不用不动点基线）。 */
  baselineInputPerS?: number;
  /** 事件表（驱动脉冲，仿真时钟时间戳）。 */
  events?: ExperimentEventInput[];
  /** 跨试次适应（null/缺省 = 试次独立重启、无适应）。 */
  adaptation?: AdaptationConfig | null;
  /** 极限环模式（p0=220）：从零初值起跑，不求不动点；q 以沉降段
   *  y0 均值为基线（与 PR6 `runAlphaLimitCycle` 同口径）。 */
  limitCycle?: boolean;
  /** 沉降段（极限环模式下求基线均值用的起始时刻），ms，默认 2000。 */
  settleMs?: number;
}

export function validateExperimentConfig(cfg: ExperimentConfig): void {
  if (!Number.isFinite(cfg.durationMs) || cfg.durationMs <= 0 ||
      Math.abs(cfg.durationMs / DT_MS - Math.round(cfg.durationMs / DT_MS)) > 1e-9) {
    throw new RangeError(`ExperimentConfig: durationMs must be a positive multiple of ${DT_MS}, got ${cfg.durationMs}`);
  }
  const params = cfg.jrParams ?? DEFAULT_JANSEN_RIT_PARAMS;
  validateJansenRitParams(params);
  const p0 = cfg.baselineInputPerS ?? params.baselineInputPerS;
  if (!Number.isFinite(p0) || p0 < 0) {
    throw new RangeError(`ExperimentConfig: baselineInputPerS must be >= 0, got ${p0}`);
  }
  if (cfg.limitCycle && Math.abs(params.dtMs - DT_MS) > 1e-12) {
    throw new RangeError('ExperimentConfig: limitCycle mode requires dtMs = 0.5');
  }
  for (const ev of cfg.events ?? []) {
    if (!Number.isFinite(ev.tMs) || ev.tMs < 0 ||
        Math.abs(ev.tMs / DT_MS - Math.round(ev.tMs / DT_MS)) > 1e-9) {
      throw new RangeError(`ExperimentConfig: event tMs must be a multiple of ${DT_MS}, got ${ev.tMs}`);
    }
    if (!Number.isFinite(ev.durationMs) || ev.durationMs <= 0 ||
        Math.abs(ev.durationMs / DT_MS - Math.round(ev.durationMs / DT_MS)) > 1e-9) {
      throw new RangeError(`ExperimentConfig: event durationMs must be a positive multiple of ${DT_MS}, got ${ev.durationMs}`);
    }
    if (ev.tMs + ev.durationMs > cfg.durationMs + 1e-9) {
      throw new RangeError(`ExperimentConfig: event at ${ev.tMs} ms exceeds duration ${cfg.durationMs} ms`);
    }
    if (!Number.isFinite(ev.drivePerS) || ev.drivePerS < 0 || ev.drivePerS > 1000) {
      throw new RangeError(`ExperimentConfig: event drivePerS must be in [0, 1000], got ${ev.drivePerS}`);
    }
  }
  if (cfg.adaptation) {
    const a = cfg.adaptation;
    if (!(a.utilization > 0 && a.utilization < 1)) {
      throw new RangeError(`AdaptationConfig: utilization must be in (0, 1), got ${a.utilization}`);
    }
    if (!(a.tauRecMs > 0)) {
      throw new RangeError(`AdaptationConfig: tauRecMs must be > 0, got ${a.tauRecMs}`);
    }
  }
}

/* ── 确定性噪声（按序号索引的哈希高斯）────────────────────────────── */

/** splitmix32：32 位整数哈希 → [0, 1) 均匀数（与 Python 对照同式）。 */
export function splitmix32Uniform(seed: number, index: number): number {
  let z = (Math.imul(seed | 0, 1) + Math.imul(index | 0, 0x9e3779b9)) | 0;
  z = (z + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return ((z ^ (z >>> 16)) >>> 0) / 4294967296;
}

/** 第 index 个确定性标准正态样本（Box–Muller，消耗序号 2i 与 2i+1）。 */
export function indexedGaussian(seed: number, index: number): number {
  const u1 = Math.max(splitmix32Uniform(seed, 2 * index), 1e-12);
  const u2 = splitmix32Uniform(seed, 2 * index + 1);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/* ── JR 植物步进器（六维状态，可快照/恢复）────────────────────────── */

export type JrFullState = readonly [number, number, number, number, number, number];

/**
 * JR 导数（与 `jansenRitColumn.ts` 的 `derivative` 逐项同式）：
 * 状态 [y0, y1, y2, y3, y4, y5]，y3–y5 为 y0–y2 的导数（mV/ms）；
 * 输入为总平均输入（p0 + 事件驱动 + 控制器输出），1/s。
 */
export function jrDerivative(
  s: JrFullState,
  inputPerS: number,
  p: JansenRitParams,
): JrFullState {
  const [y0, y1, y2, y3, y4, y5] = s;
  const a = p.rateExcPerS / 1000; // 1/ms
  const b = p.rateInhPerS / 1000; // 1/ms
  const sPerMs = (v: number) => jansenRitSigmoidPerS(v, p) / 1000; // 1/ms
  const inputPerMs = inputPerS / 1000; // 1/ms
  return [
    y3,
    y4,
    y5,
    p.gainExcMv * a * sPerMs(y1 - y2) - 2 * a * y3 - a * a * y0,
    p.gainExcMv * a * (inputPerMs + p.c2 * sPerMs(p.c1 * y0)) -
      2 * a * y4 - a * a * y1,
    p.gainInhMv * b * p.c4 * sPerMs(p.c3 * y0) - 2 * b * y5 - b * b * y2,
  ];
}

function jrRk4(s: JrFullState, inputPerS: number, p: JansenRitParams, dt: number): JrFullState {
  const add = (x: JrFullState, k: JrFullState, f: number): JrFullState =>
    [x[0] + f * k[0], x[1] + f * k[1], x[2] + f * k[2],
     x[3] + f * k[3], x[4] + f * k[4], x[5] + f * k[5]] as const;
  const k1 = jrDerivative(s, inputPerS, p);
  const k2 = jrDerivative(add(s, k1, dt / 2), inputPerS, p);
  const k3 = jrDerivative(add(s, k2, dt / 2), inputPerS, p);
  const k4 = jrDerivative(add(s, k3, dt), inputPerS, p);
  const w = (i: number) => dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
  return [s[0] + w(0), s[1] + w(1), s[2] + w(2),
          s[3] + w(3), s[4] + w(4), s[5] + w(5)] as const;
}

interface RuntimeEvent extends ExperimentEventInput {
  /** 该事件本次实际生效的驱动（压抑后），1/s；未起始时为 drivePerS。 */
  effectiveDrivePerS: number;
  started: boolean;
}

/**
 * 单步植物：持有一个 JR 柱的六维状态、仿真时钟、事件表与适应资源。
 * `step(controlInputPerS)` 推进一个 dt（0.5 ms）。`snapshot()` /
 * `restore()` 做快照往返；快照含事件起始状态与适应资源，恢复后
 * 重跑与原轨迹逐值相同（确定性，见测试）。
 */
export class JrPlant {
  readonly params: JansenRitParams;
  readonly baselineInputPerS: number;
  readonly baselineY0: number;
  readonly limitCycle: boolean;
  private state: JrFullState;
  private tMs = 0;
  private events: RuntimeEvent[];
  private adaptationX = 1;
  private readonly adaptation: AdaptationConfig | null;

  constructor(cfg: ExperimentConfig) {
    validateExperimentConfig(cfg);
    this.params = { ...(cfg.jrParams ?? DEFAULT_JANSEN_RIT_PARAMS) };
    this.baselineInputPerS = cfg.baselineInputPerS ?? this.params.baselineInputPerS;
    this.params.baselineInputPerS = this.baselineInputPerS;
    this.limitCycle = cfg.limitCycle ?? false;
    this.adaptation = cfg.adaptation ?? null;
    this.events = (cfg.events ?? []).map((ev) => ({
      ...ev,
      effectiveDrivePerS: ev.drivePerS,
      started: false,
    }));
    if (this.limitCycle) {
      // 极限环：从零初值起跑；基线 y0 在运行结束时由沉降段均值重定
      //（`runSingleExperiment` 事后重算 q；运行中 q 暂以 0 为基线，
      // 不作为分析量使用）。
      this.state = [0, 0, 0, 0, 0, 0];
      this.baselineY0 = 0;
    } else {
      const eq = equilibrateJansenRit(this.params);
      this.state = eq;
      this.baselineY0 = eq[0];
    }
  }

  get timeMs(): number {
    return this.tMs;
  }

  get fullState(): JrFullState {
    return this.state;
  }

  get adaptationResource(): number {
    return this.adaptationX;
  }

  /** 各事件实际生效的驱动（压抑后），1/s；未起始的事件返回设定驱动。 */
  getEffectiveDrives(): number[] {
    return this.events.map((ev) => ev.effectiveDrivePerS);
  }

  /** 当前时刻生效的事件驱动（压抑后），1/s；并推进适应资源。 */
  private eventDriveAt(tMs: number): number {
    let drive = 0;
    for (const ev of this.events) {
      if (Math.abs(tMs - ev.tMs) < 1e-9 && !ev.started) {
        // 事件起始：消耗资源，有效驱动 = 设定驱动 × 剩余资源。
        ev.started = true;
        ev.effectiveDrivePerS = this.adaptation
          ? ev.drivePerS * this.adaptationX
          : ev.drivePerS;
        if (this.adaptation) this.adaptationX *= 1 - this.adaptation.utilization;
      }
      if (tMs >= ev.tMs - 1e-9 && tMs < ev.tMs + ev.durationMs - 1e-9) {
        drive += ev.effectiveDrivePerS;
      }
    }
    return drive;
  }

  /** 推进一个 dt；`controlInputPerS` 为控制器输出（1/s，可负，钳制
   *  到总输入 ≥ 0）。返回步末读数。 */
  step(controlInputPerS = 0): { tMs: number; y0: number; qNAm: number; eegUv: number } {
    if (!Number.isFinite(controlInputPerS)) {
      throw new RangeError('JrPlant.step: controlInputPerS must be finite');
    }
    if (this.adaptation) {
      // 资源按 τ_rec 指数恢复（每步一次，与事件起始的消耗同口径）。
      this.adaptationX += (1 - this.adaptationX) * (DT_MS / this.adaptation.tauRecMs);
      if (this.adaptationX > 1) this.adaptationX = 1;
    }
    const drive = this.eventDriveAt(this.tMs);
    const total = Math.max(0, this.baselineInputPerS + drive + controlInputPerS);
    this.state = jrRk4(this.state, total, this.params, DT_MS);
    if (this.state.some((v) => !Number.isFinite(v)) ||
        this.state[0] < -10 || this.state[0] > 100 ||
        this.state[1] < -10 || this.state[1] > 100 ||
        this.state[2] < -10 || this.state[2] > 100) {
      throw new RangeError('JrPlant: Jansen-Rit population diverged');
    }
    this.tMs += DT_MS;
    return this.read();
  }

  read(): { tMs: number; y0: number; qNAm: number; eegUv: number } {
    const q = equivalentMomentNAmJR(this.state[0], this.baselineY0, DEFAULT_JR_MORPHOLOGY);
    return { tMs: this.tMs, y0: this.state[0], qNAm: q, eegUv: q * PZ_GAIN_UV_PER_NAM };
  }

  /** 快照：六维状态 + 时钟 + 事件起始状态 + 适应资源（JSON 可序列化）。 */
  snapshot(): PlantSnapshot {
    return {
      tMs: this.tMs,
      state: [...this.state],
      adaptationX: this.adaptationX,
      events: this.events.map((ev) => ({ started: ev.started, effectiveDrivePerS: ev.effectiveDrivePerS })),
    };
  }

  restore(snap: PlantSnapshot): void {
    if (snap.state.length !== 6 || !snap.state.every(Number.isFinite)) {
      throw new RangeError('JrPlant.restore: snapshot state must be 6 finite numbers');
    }
    if (snap.events.length !== this.events.length) {
      throw new RangeError('JrPlant.restore: snapshot event count mismatches this plant');
    }
    this.state = [...snap.state] as unknown as JrFullState;
    this.tMs = snap.tMs;
    this.adaptationX = snap.adaptationX;
    for (let i = 0; i < this.events.length; i++) {
      this.events[i].started = snap.events[i].started;
      this.events[i].effectiveDrivePerS = snap.events[i].effectiveDrivePerS;
    }
  }
}

export interface PlantSnapshot {
  tMs: number;
  state: number[];
  adaptationX: number;
  events: { started: boolean; effectiveDrivePerS: number }[];
}

/* ── 单次实验运行（开环）────────────────────────────────────────────── */

export interface ExperimentRun {
  config: ExperimentConfig;
  /** 0.5 ms 网格（含 t=0），与 y0/qNAm 一一对应。 */
  timesMs: number[];
  /** 锥体 PSP y0，mV。 */
  y0Mv: number[];
  /** 偶极矩，nA·m（极限环模式以沉降段 y0 均值为基线重算）。 */
  qNAm: number[];
  /** 4 ms 网格（250 Hz，含 t=0），与 eegUvPz 一一对应。 */
  timesMs4: number[];
  /** Pz 代理 EEG，µV。 */
  eegUvPz: number[];
  /** 各事件实际生效的驱动（压抑后），1/s，与 config.events 一一对应。 */
  effectiveDrivesPerS: number[];
  /** 沉降段 y0 均值（极限环模式的 q 基线；不动点模式 = 不动点 y0）。 */
  baselineY0Mv: number;
}

/** 跑一次开环实验：事件驱动 → JR 柱 → q(t) → Pz 代理 EEG。 */
export function runSingleExperiment(cfg: ExperimentConfig): ExperimentRun {
  validateExperimentConfig(cfg);
  const plant = new JrPlant(cfg);
  const nSteps = Math.round(cfg.durationMs / DT_MS);
  const timesMs: number[] = [0];
  const y0Mv: number[] = [plant.read().y0];
  const qNAm: number[] = [plant.read().qNAm];
  const timesMs4: number[] = [0];
  const eegUvPz: number[] = [plant.read().eegUv];
  for (let s = 1; s <= nSteps; s++) {
    const r = plant.step(0);
    timesMs.push(r.tMs);
    y0Mv.push(r.y0);
    qNAm.push(r.qNAm);
    if (s % CONTROL_TICK_STEPS === 0) {
      timesMs4.push(r.tMs);
      eegUvPz.push(r.eegUv);
    }
  }
  let baselineY0Mv = plant.baselineY0;
  let qFinal = qNAm;
  if (cfg.limitCycle) {
    // 沉降段均值重定基线（与 PR6 runAlphaLimitCycle 同口径），q 重算。
    const settleMs = cfg.settleMs ?? 2000;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < timesMs.length; i++) {
      if (timesMs[i] >= settleMs) {
        sum += y0Mv[i];
        cnt++;
      }
    }
    if (cnt === 0) throw new RangeError('runSingleExperiment: limitCycle settle window has no samples');
    baselineY0Mv = sum / cnt;
    qFinal = y0Mv.map((y0) => equivalentMomentNAmJR(y0, baselineY0Mv, DEFAULT_JR_MORPHOLOGY));
    // Pz 同步重算（4 ms 网格取 y0 的对应采样）。
    const eeg: number[] = [];
    for (let j = 0; j < timesMs4.length; j++) {
      const idx = Math.round(timesMs4[j] / DT_MS);
      eeg.push(qFinal[idx] * PZ_GAIN_UV_PER_NAM);
    }
    return {
      config: cfg,
      timesMs,
      y0Mv,
      qNAm: qFinal,
      timesMs4,
      eegUvPz: eeg,
      effectiveDrivesPerS: plant.getEffectiveDrives(),
      baselineY0Mv,
    };
  }
  return {
    config: cfg,
    timesMs,
    y0Mv,
    qNAm: qFinal,
    timesMs4,
    eegUvPz,
    effectiveDrivesPerS: plant.getEffectiveDrives(),
    baselineY0Mv,
  };
}

/* ── 比较：峰值 / RMS / PSD / ERP ─────────────────────────────────────── */

function peakOf(values: number[]): { peak: number; index: number } {
  let peak = -Infinity;
  let index = -1;
  for (let i = 0; i < values.length; i++) {
    if (Math.abs(values[i]) > peak) {
      peak = Math.abs(values[i]);
      index = i;
    }
  }
  return { peak, index };
}

function rmsOf(values: number[]): number {
  let s = 0;
  for (const v of values) s += v * v;
  return Math.sqrt(s / values.length);
}

function maxAbsDiff(a: number[], b: number[]): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** 把一次运行转成单通道 Pz 的 EegRecording（250 Hz），供 A1 的
 *  epoch/平均/峰值函数复用；事件时间戳是仿真时钟（ms）。 */
export function runToRecording(run: ExperimentRun, channel = 'Pz'): { recording: EegRecording; events: EegEvent[] } {
  const events: EegEvent[] = (run.config.events ?? []).map((ev, id) => ({
    id,
    type: 'pulse',
    tMs: ev.tMs,
    condition: id % 2 === 0 ? 'standard' : 'oddball',
    drive: ev.drivePerS,
    driveUnit: 'jr',
  }));
  const recording: EegRecording = {
    version: 1,
    sfreqHz: 250,
    timesMs: [...run.timesMs4],
    channels: [{ label: channel, positionMm: [0, 0, 16] }],
    dataUv: [run.eegUvPz.map((v) => v)],
    reference: { mode: 'infinity' },
    montage: '10-20',
    forwardModelId: 'pr15-experiments-v1',
    sourceModelId: 'local-jansen-rit-assumed-dipole-v1',
    seed: 0,
    noise: null,
  };
  return { recording, events };
}

export interface RunComparison {
  /** 两条轨迹是否共享同一时间轴（A/B 的要求：相同时长、同一步长）。 */
  sharedTimesMs: boolean;
  /** y0 峰值差（B − A），mV；及其各自峰值。 */
  peakY0DiffMv: number;
  peakY0A: number;
  peakY0B: number;
  /** y0 峰值时刻差（B − A），ms。 */
  peakTimeDiffMs: number;
  /** Pz EEG RMS 差（B − A），µV。 */
  rmsEegDiffUv: number;
  /** y0 轨迹逐点最大绝对差，mV。 */
  maxAbsY0DiffMv: number;
  /** y0 轨迹逐点平均绝对差，mV。 */
  meanAbsY0DiffMv: number;
  /** Welch PSD 峰值频率（y0，去均值后），Hz；及其差。 */
  psdPeakHzA: number;
  psdPeakHzB: number;
  psdPeakShiftHz: number;
  /** 事件锁定平均 ERP（Pz，窗 −200–800 ms，基线 −200–0 ms）峰值差，µV。 */
  erpPeakDiffUv: number;
  erpPeakA: number;
  erpPeakB: number;
  erpLatencyDiffMs: number;
  /** 各事件实际生效驱动（压抑后），1/s。 */
  effectiveDrivesA: number[];
  effectiveDrivesB: number[];
}

function psdPeakHz(y0: number[]): number {
  const mean = y0.reduce((s, v) => s + v, 0) / y0.length;
  const xc = y0.map((v) => v - mean);
  // 4 ms 网格（250 Hz）；nFft=1024（df≈0.244 Hz），与 PR6 WAVES 同口径。
  const { freqsHz, psd } = welchPsd(xc, 250, { nFft: 1024 });
  let best = 0;
  let bestP = -Infinity;
  for (let i = 0; i < freqsHz.length; i++) {
    if (freqsHz[i] >= 1 && psd[i] > bestP) {
      bestP = psd[i];
      best = freqsHz[i];
    }
  }
  return best;
}

function erpPeak(run: ExperimentRun): { peakUv: number; latencyMs: number } | null {
  const events = run.config.events ?? [];
  if (events.length === 0) return null;
  const { recording, events: evs } = runToRecording(run);
  const epochs = epochRecording(recording, evs, -200, 800, [-200, 0]);
  if (epochs.trials.length === 0) return null;
  const avg = averageEpochs(epochs);
  // 单通道 Pz（通道 0），窗 0–600 ms 取绝对值最大峰。
  return peakInWindow(avg.timesMs, avg.meanUv[0], [0, 600]);
}

/**
 * 双脑 A/B 对照：同一配置跑两次（或两个配置各跑一次），比较数值差异。
 * 要求：两配置时长相同（否则时间轴不共享，直接抛错）；模型、种子、
 * 输入事件在配置里给定，只改一个条件时差异即该条件的效应。
 * 比较输出是数值差异（峰值差、PSD 峰移、ERP 峰差），不只是两张图。
 */
export function compareRuns(a: ExperimentRun, b: ExperimentRun): RunComparison {
  if (a.timesMs.length !== b.timesMs.length ||
      a.timesMs.some((t, i) => Math.abs(t - b.timesMs[i]) > 1e-9)) {
    throw new RangeError('compareRuns: runs must share the same time axis (same duration and dt)');
  }
  const pkA = peakOf(a.y0Mv);
  const pkB = peakOf(b.y0Mv);
  const psdA = psdPeakHz(a.y0Mv.filter((_, i) => i % CONTROL_TICK_STEPS === 0));
  const psdB = psdPeakHz(b.y0Mv.filter((_, i) => i % CONTROL_TICK_STEPS === 0));
  const erpA = erpPeak(a);
  const erpB = erpPeak(b);
  return {
    sharedTimesMs: true,
    peakY0DiffMv: Math.abs(b.y0Mv[pkB.index]) - Math.abs(a.y0Mv[pkA.index]),
    peakY0A: Math.abs(a.y0Mv[pkA.index]),
    peakY0B: Math.abs(b.y0Mv[pkB.index]),
    peakTimeDiffMs: b.timesMs[pkB.index] - a.timesMs[pkA.index],
    rmsEegDiffUv: rmsOf(b.eegUvPz) - rmsOf(a.eegUvPz),
    maxAbsY0DiffMv: maxAbsDiff(a.y0Mv, b.y0Mv),
    meanAbsY0DiffMv: a.y0Mv.reduce((s, v, i) => s + Math.abs(v - b.y0Mv[i]), 0) / a.y0Mv.length,
    psdPeakHzA: psdA,
    psdPeakHzB: psdB,
    psdPeakShiftHz: psdB - psdA,
    erpPeakDiffUv: erpA && erpB ? erpB.peakUv - erpA.peakUv : NaN,
    erpPeakA: erpA ? erpA.peakUv : NaN,
    erpPeakB: erpB ? erpB.peakUv : NaN,
    erpLatencyDiffMs: erpA && erpB ? erpB.latencyMs - erpA.latencyMs : NaN,
    effectiveDrivesA: [...a.effectiveDrivesPerS],
    effectiveDrivesB: [...b.effectiveDrivesPerS],
  };
}

/** 跑两个配置并比较（A/B 的一站式入口）。 */
export function runAB(configA: ExperimentConfig, configB: ExperimentConfig): {
  a: ExperimentRun;
  b: ExperimentRun;
  comparison: RunComparison;
} {
  const a = runSingleExperiment(configA);
  const b = runSingleExperiment(configB);
  return { a, b, comparison: compareRuns(a, b) };
}

/* ── 源定位对照（A/B 的网络响应/源定位一节）────────────────────────── */

export interface LocalizationComparison {
  /** A/B 各自的偶极子拟合与 MNE 盲测结果（真值只在事后评估里出现，
   *  逆解函数内部无真值标签——`blindTest` 的盲测语义）。 */
  a: BlindTestResult;
  b: BlindTestResult;
  /** 偶极子拟合定位误差差（B − A），mm。 */
  dipoleErrorDiffMm: number;
  /** MNE 定位误差差（B − A），mm。 */
  mneErrorDiffMm: number;
  /** MNE 分布范围差（B − A），mm。 */
  mneSpreadDiffMm: number;
}

/**
 * 源定位对照：在 ERP 峰值时刻（或给定时刻）的偶极矩下，正向生成
 * 多导 EEG → 偶极子拟合 + MNE 逆解 → 比较两条件的定位误差。
 * `momentNAmAtPeak` 是该条件在所选时刻的偶极矩（nA·m），调用方从
 * 各自的 `ExperimentRun.qNAm` 里取（时刻须在两条轨迹上一致）。
 */
export function compareLocalization(
  fixture: SphereFixture,
  montage: MontageKey,
  a: { positionMm: Vec3Mm; momentNAm: Vec3Mm },
  b: { positionMm: Vec3Mm; momentNAm: Vec3Mm },
): LocalizationComparison {
  const ra = blindTest(fixture, montage, a.positionMm, a.momentNAm);
  const rb = blindTest(fixture, montage, b.positionMm, b.momentNAm);
  return {
    a: ra,
    b: rb,
    dipoleErrorDiffMm: rb.dipole.localizationErrorMm - ra.dipole.localizationErrorMm,
    mneErrorDiffMm: rb.mne.localizationErrorMm - ra.mne.localizationErrorMm,
    mneSpreadDiffMm: rb.mne.spreadMm - ra.mne.spreadMm,
  };
}

/* ── 时间机器 ───────────────────────────────────────────────────────── */

/**
 * 时间机器快照：植物快照 + 控制器状态（闭环运行时才非零）+ 读数。
 * 全部 JSON 可序列化；`restore()` 后重跑与原轨迹逐值相同。
 */
export interface TimeMachineSnapshot extends PlantSnapshot {
  /** 控制器积分（PID），1/s·s；开环为 0。 */
  pidIntegral: number;
  /** 控制器上一误差（PID 微分项），特征单位；开环为 0。 */
  pidPrevError: number;
  /** 延迟线（已发出未生效的控制器输出，1/s）；开环为空。 */
  delayBuffer: number[];
  /** 快照时刻的读数（y0 mV、q nA·m、Pz µV），回放直接取用。 */
  readout: { y0: number; qNAm: number; eegUv: number };
}

export interface TimeMachineOptions {
  /** 快照间隔，ms（默认 10 ms；须为 0.5 ms 的整数倍）。 */
  snapshotIntervalMs?: number;
}

/**
 * 时间机器：暂停 / 单步（一次一个 dt=0.5 ms）/ 历史缓冲（带 t_ms 的
 * 快照列表）/ 回放（拖动已记录的快照历史）/ 慢动作（回放倍率是视图
 * 参数，`replay()` 返回快照、UI 按倍率步进）/ 恢复模型快照 /
 * 从历史状态改参数后重新运行（`fork()`）。所有回放均来自真实保存
 * 的状态或确定性重算，不编造历史。
 */
export class TimeMachine {
  readonly config: ExperimentConfig;
  readonly plant: JrPlant;
  readonly snapshotIntervalMs: number;
  private history: TimeMachineSnapshot[] = [];
  private stepsSinceSnapshot = 0;
  private pausedFlag = false;

  constructor(cfg: ExperimentConfig, opts: TimeMachineOptions = {}) {
    validateExperimentConfig(cfg);
    this.config = cfg;
    this.plant = new JrPlant(cfg);
    this.snapshotIntervalMs = opts.snapshotIntervalMs ?? 10;
    if (!(this.snapshotIntervalMs > 0) ||
        Math.abs(this.snapshotIntervalMs / DT_MS - Math.round(this.snapshotIntervalMs / DT_MS)) > 1e-9) {
      throw new RangeError(`TimeMachine: snapshotIntervalMs must be a positive multiple of ${DT_MS}`);
    }
    this.recordSnapshot();
  }

  get timeMs(): number {
    return this.plant.timeMs;
  }

  get paused(): boolean {
    return this.pausedFlag;
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
  }

  /** 单步运行：一次一个 dt（0.5 ms）；暂停时不推进。 */
  step(controlInputPerS = 0): { tMs: number; y0: number; qNAm: number; eegUv: number } | null {
    if (this.pausedFlag) return null;
    const r = this.plant.step(controlInputPerS);
    this.stepsSinceSnapshot++;
    if (this.stepsSinceSnapshot * DT_MS >= this.snapshotIntervalMs - 1e-9) {
      this.recordSnapshot();
      this.stepsSinceSnapshot = 0;
    }
    return r;
  }

  /** 推进 n 个 dt（n 个单步的循环；暂停时不推进）。 */
  stepN(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  /** 推进到目标时刻（ms）；目标须在当前时刻之后。 */
  stepTo(tMs: number): void {
    if (tMs < this.plant.timeMs - 1e-9) {
      throw new RangeError(`TimeMachine.stepTo: target ${tMs} ms is before current ${this.plant.timeMs} ms`);
    }
    const n = Math.round((tMs - this.plant.timeMs) / DT_MS);
    this.stepN(n);
  }

  private recordSnapshot(): TimeMachineSnapshot {
    const snap: TimeMachineSnapshot = {
      ...this.plant.snapshot(),
      pidIntegral: 0,
      pidPrevError: 0,
      delayBuffer: [],
      readout: this.plant.read(),
    };
    this.history.push(snap);
    return snap;
  }

  /** 历史缓冲：带 t_ms 的快照列表（真实保存的状态）。 */
  getHistory(): TimeMachineSnapshot[] {
    return [...this.history];
  }

  /** 回放：返回 [t0Ms, t1Ms] 内已记录的快照（拖动历史即取这段）。 */
  replay(t0Ms: number, t1Ms: number): TimeMachineSnapshot[] {
    return this.history.filter((s) => s.tMs >= t0Ms - 1e-9 && s.tMs <= t1Ms + 1e-9);
  }

  /** 取最接近 tMs 的快照（不存在时返回 null）。 */
  snapshotAt(tMs: number): TimeMachineSnapshot | null {
    let best: TimeMachineSnapshot | null = null;
    let bestD = Infinity;
    for (const s of this.history) {
      const d = Math.abs(s.tMs - tMs);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** 恢复模型快照：回到该时刻的状态，并截断该时刻之后的历史
   * （分支点之后的历史作废；恢复本身不改变配置）。 */
  restore(snap: TimeMachineSnapshot): void {
    this.plant.restore(snap);
    this.history = this.history.filter((s) => s.tMs <= snap.tMs + 1e-9);
    // 恢复点本身就是一份快照：若历史里没有它（例如从另一台机器
    // fork/恢复过来），把它补进历史，否则分支点处少一个快照。
    const last = this.history[this.history.length - 1];
    if (!last || Math.abs(last.tMs - snap.tMs) > 1e-9) this.history.push(snap);
    // 恢复点本身就是一份快照，下一次快照在 snapshotIntervalMs 之后。
    this.stepsSinceSnapshot = 0;
  }

  /**
   * 从历史状态改参数后重新运行（分支）：在快照时刻复制当前机器，
   * 应用参数补丁（改 JR 参数 / 基线输入 / 事件驱动等），返回新机器；
   * 分支点之前两条轨迹逐值相同（同一份历史），分支点之后按新参数跑。
   * 注意：改 `jrParams`/`baselineInputPerS` 会重算不动点基线，但
   * 六维状态保持快照值（状态是物理量，基线只是 q 的参考零点）。
   */
  fork(snap: TimeMachineSnapshot, patch: Partial<ExperimentConfig>): TimeMachine {
    const next = new TimeMachine({ ...this.config, ...patch });
    next.plant.restore(snap);
    // fork 的机器继承分支点之前的历史（逐值相同的前缀）。
    next.history = this.history.filter((s) => s.tMs <= snap.tMs + 1e-9);
    next.stepsSinceSnapshot = 0;
    return next;
  }

  /** 当前读数（y0/q/Pz）。 */
  read(): { tMs: number; y0: number; qNAm: number; eegUv: number } {
    return this.plant.read();
  }
}

/**
 * 两条分支轨迹的数值比较（须共享时间轴前缀）：分支点之前逐点最大差
 *（应 ≈ 0）与分支点之后逐点最大差/均值差（量化分叉效应）。
 */
export function compareBranches(
  a: ExperimentRun,
  b: ExperimentRun,
  branchMs: number,
): {
  maxAbsY0DiffBeforeMv: number;
  maxAbsY0DiffAfterMv: number;
  meanAbsY0DiffAfterMv: number;
  maxAbsEegDiffAfterUv: number;
} {
  if (a.timesMs.length !== b.timesMs.length) {
    throw new RangeError('compareBranches: runs must share the same time axis');
  }
  let before = 0;
  let after = 0;
  let afterSum = 0;
  let afterN = 0;
  let afterEeg = 0;
  for (let i = 0; i < a.timesMs.length; i++) {
    const d = Math.abs(a.y0Mv[i] - b.y0Mv[i]);
    if (a.timesMs[i] <= branchMs + 1e-9) {
      before = Math.max(before, d);
    } else {
      after = Math.max(after, d);
      afterSum += d;
      afterN++;
    }
  }
  for (let j = 0; j < a.timesMs4.length; j++) {
    if (a.timesMs4[j] > branchMs + 1e-9) {
      afterEeg = Math.max(afterEeg, Math.abs(a.eegUvPz[j] - b.eegUvPz[j]));
    }
  }
  return {
    maxAbsY0DiffBeforeMv: before,
    maxAbsY0DiffAfterMv: after,
    meanAbsY0DiffAfterMv: afterN > 0 ? afterSum / afterN : 0,
    maxAbsEegDiffAfterUv: afterEeg,
  };
}

/* ── PID 控制器 ─────────────────────────────────────────────────────── */

export interface PidParams {
  /** 比例增益 Kp，输出单位 1/s 每单位误差（特征单位见所用特征）。 */
  kp: number;
  /** 积分增益 Ki，1/s 每（特征单位·s）。 */
  ki: number;
  /** 微分增益 Kd，1/s 每（特征单位/s）。 */
  kd: number;
  /** 目标特征值（setpoint），特征单位。 */
  setpoint: number;
  /** 输出下限，1/s（默认 −90，即最多把总输入拉回 p0−90 ≥ 0 的边界；
   *  控制器输出加在 p0 上，总输入仍钳制 ≥ 0）。 */
  outputMinPerS?: number;
  /** 输出上限，1/s（默认 300）。 */
  outputMaxPerS?: number;
  /** 积分钳制（抗饱和），单位 1/s·s；默认 Infinity（只靠条件积分）。 */
  integralClamp?: number;
}

export const DEFAULT_PID_OUTPUT_MIN_PER_S = -90;
export const DEFAULT_PID_OUTPUT_MAX_PER_S = 300;

/**
 * PID 控制器（位置式，带抗饱和）：
 * u = Kp·e + Ki·∫e dt + Kd·de/dt，e = setpoint − measurement。
 * 抗饱和：输出饱和且误差会把输出进一步推向饱和时，暂停积分
 *（条件积分）；积分另有独立钳制 `integralClamp`。
 * 状态（integral / prevError）可快照，见 `PidController.snapshot()`。
 */
export class PidController {
  readonly params: Required<PidParams>;
  private integral = 0;
  private prevError: number | null = null;

  constructor(params: PidParams) {
    if (![params.kp, params.ki, params.kd, params.setpoint].every(Number.isFinite)) {
      throw new RangeError('PidController: kp/ki/kd/setpoint must be finite');
    }
    if (params.kp < 0 || params.ki < 0 || params.kd < 0) {
      throw new RangeError('PidController: gains must be >= 0');
    }
    this.params = {
      kp: params.kp,
      ki: params.ki,
      kd: params.kd,
      setpoint: params.setpoint,
      outputMinPerS: params.outputMinPerS ?? DEFAULT_PID_OUTPUT_MIN_PER_S,
      outputMaxPerS: params.outputMaxPerS ?? DEFAULT_PID_OUTPUT_MAX_PER_S,
      integralClamp: params.integralClamp ?? Infinity,
    };
    if (!(this.params.outputMinPerS < this.params.outputMaxPerS)) {
      throw new RangeError('PidController: need outputMinPerS < outputMaxPerS');
    }
    if (!(this.params.integralClamp > 0)) {
      throw new RangeError('PidController: integralClamp must be > 0');
    }
  }

  get integralValue(): number {
    return this.integral;
  }

  get prevErrorValue(): number | null {
    return this.prevError;
  }

  /** 一步控制：measurement 为当前特征值，dtMs 为控制器节拍（ms）。 */
  step(measurement: number, dtMs: number): number {
    if (!Number.isFinite(measurement) || !(dtMs > 0)) {
      throw new RangeError('PidController.step: measurement must be finite and dtMs > 0');
    }
    const dtS = dtMs / 1000;
    const e = this.params.setpoint - measurement;
    const derivative = this.prevError === null ? 0 : (e - this.prevError) / dtS;
    // 试算输出（用旧积分），判断是否饱和、误差是否推向饱和。
    const p = this.params;
    const trial = p.kp * e + p.ki * this.integral + p.kd * derivative;
    const saturatedHigh = trial > p.outputMaxPerS;
    const saturatedLow = trial < p.outputMinPerS;
    const pushingFurther =
      (saturatedHigh && e > 0) || (saturatedLow && e < 0);
    if (!pushingFurther) {
      this.integral += e * dtS;
      if (this.integral > p.integralClamp) this.integral = p.integralClamp;
      if (this.integral < -p.integralClamp) this.integral = -p.integralClamp;
    }
    this.prevError = e;
    const u = p.kp * e + p.ki * this.integral + p.kd * derivative;
    return Math.min(p.outputMaxPerS, Math.max(p.outputMinPerS, u));
  }

  reset(): void {
    this.integral = 0;
    this.prevError = null;
  }

  snapshot(): { integral: number; prevError: number | null } {
    return { integral: this.integral, prevError: this.prevError };
  }

  restore(snap: { integral: number; prevError: number | null }): void {
    this.integral = snap.integral;
    this.prevError = snap.prevError;
  }
}

/**
 * 一阶植物上的 PID 阶跃响应（控制器本身的干净验证，与 JR 植物无关）：
 * dx/dt = (u − x)/τ，u 为 PID 输出，目标为 setpoint。返回超调（%）、
 * 安定时间（进入 ±2% 带后不再出去的时刻，ms）、稳态误差。
 * 用于“PID 阶跃响应收敛”测试（数值与 Python 对照一致）。
 */
export function simulatePidStepResponse(opts: {
  pid: PidParams;
  /** 一阶植物时间常数 τ，ms。 */
  plantTauMs: number;
  /** 总时长，ms（须为 dtMs 的整数倍）。 */
  durationMs: number;
  /** 控制器节拍，ms（默认 4，与闭环节拍一致）。 */
  dtMs?: number;
  /** 植物初值（默认 0）。 */
  x0?: number;
}): {
  timesMs: number[];
  x: number[];
  u: number[];
  overshootPct: number;
  settlingTimeMs: number | null;
  steadyStateError: number;
} {
  const dtMs = opts.dtMs ?? CONTROL_DT_MS;
  if (!(opts.plantTauMs > 0)) throw new RangeError('simulatePidStepResponse: plantTauMs must be > 0');
  if (!(opts.durationMs > 0) || Math.abs(opts.durationMs / dtMs - Math.round(opts.durationMs / dtMs)) > 1e-9) {
    throw new RangeError('simulatePidStepResponse: durationMs must be a positive multiple of dtMs');
  }
  const pid = new PidController(opts.pid);
  const n = Math.round(opts.durationMs / dtMs);
  const timesMs: number[] = [0];
  const x: number[] = [opts.x0 ?? 0];
  const u: number[] = [0];
  let cur = opts.x0 ?? 0;
  for (let i = 1; i <= n; i++) {
    const ui = pid.step(cur, dtMs);
    // 植物用精确指数积分（一步内 u 恒定）：x += (u−x)(1−e^{−dt/τ})。
    cur += (ui - cur) * (1 - Math.exp(-dtMs / opts.plantTauMs));
    timesMs.push(i * dtMs);
    x.push(cur);
    u.push(ui);
  }
  const sp = opts.pid.setpoint;
  const band = 0.02 * Math.abs(sp);
  let peak = -Infinity;
  for (const v of x) peak = Math.max(peak, v);
  const overshootPct = sp === 0 ? 0 : (Math.max(0, peak - sp) / Math.abs(sp)) * 100;
  let settlingTimeMs: number | null = null;
  for (let i = x.length - 1; i >= 0; i--) {
    if (Math.abs(x[i] - sp) > band) {
      settlingTimeMs = i + 1 < x.length ? timesMs[i + 1] : null;
      break;
    }
    if (i === 0) settlingTimeMs = 0;
  }
  const steadyStateError = sp - x[x.length - 1];
  return { timesMs, x, u, overshootPct, settlingTimeMs, steadyStateError };
}

/* ── 特征提取 ───────────────────────────────────────────────────────── */

export type FeatureKind = 'alphaPower' | 'rms' | 'instant';

export interface FeatureConfig {
  kind: FeatureKind;
  /** 滑窗长度，ms（alphaPower/rms 用；instant 不用）。默认 252 ms
   *  （63 个 4 ms 采样点，Goertzel 窗）。 */
  windowMs?: number;
  /** alphaPower 的目标频率，Hz（默认 10）。 */
  targetFreqHz?: number;
}

export const DEFAULT_FEATURE_WINDOW_MS = 252;
export const DEFAULT_FEATURE_FREQ_HZ = 10;

/**
 * 单频 Goertzel 功率：窗内信号在目标频率上的均方功率（µV²）。
 * 标定：纯正弦幅值 A 在中心频率处功率 = A²/2（与 `signalProcessing`
 * 的 Morlet 标定同口径）。窗长 N 个采样点，采样率 fs Hz。
 */
export function goertzelPower(samples: number[], freqHz: number, sfreqHz: number): number {
  if (samples.length === 0) throw new RangeError('goertzelPower: empty window');
  if (!(freqHz > 0 && freqHz < sfreqHz / 2)) {
    throw new RangeError(`goertzelPower: freqHz ${freqHz} must be in (0, ${sfreqHz / 2})`);
  }
  const n = samples.length;
  const w = (2 * Math.PI * freqHz) / sfreqHz;
  const coeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    s0 = samples[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  // X = s1·e^{−iw(n−1)} − s2·e^{−iwn} 的实部/虚部。
  const re = s1 * Math.cos(w * (n - 1)) - s2 * Math.cos(w * n);
  const im = -(s1 * Math.sin(w * (n - 1)) - s2 * Math.sin(w * n));
  const amp = (2 * Math.hypot(re, im)) / n;
  return (amp * amp) / 2;
}

/** 特征提取器：持有一个滑窗（4 ms 节拍），每节拍输出一个特征值。 */
export class FeatureExtractor {
  readonly kind: FeatureKind;
  readonly windowSamples: number;
  readonly targetFreqHz: number;
  private window: number[] = [];

  constructor(cfg: FeatureConfig) {
    this.kind = cfg.kind;
    const windowMs = cfg.windowMs ?? DEFAULT_FEATURE_WINDOW_MS;
    if (!(windowMs > 0)) throw new RangeError('FeatureExtractor: windowMs must be > 0');
    this.windowSamples = Math.max(1, Math.round(windowMs / CONTROL_DT_MS));
    this.targetFreqHz = cfg.targetFreqHz ?? DEFAULT_FEATURE_FREQ_HZ;
  }

  /** 喂入一个新采样（µV，4 ms 节拍），返回当前特征值（µV² 或 µV）。 */
  push(sampleUv: number): number {
    if (!Number.isFinite(sampleUv)) throw new RangeError('FeatureExtractor.push: sample must be finite');
    this.window.push(sampleUv);
    if (this.window.length > this.windowSamples) this.window.shift();
    if (this.kind === 'instant') return sampleUv;
    if (this.kind === 'rms') {
      let s = 0;
      for (const v of this.window) s += v * v;
      return Math.sqrt(s / this.window.length);
    }
    return goertzelPower(this.window, this.targetFreqHz, 250);
  }

  reset(): void {
    this.window = [];
  }
}

/* ── 闭环运行 ───────────────────────────────────────────────────────── */

export type ControllerMode = 'off' | 'threshold' | 'pid';

export interface ThresholdConfig {
  /** 触发阈值（特征单位：alphaPower 为 µV²，rms/instant 为 µV）。 */
  threshold: number;
  /** 触发时输出的控制量，1/s（负值 = 抑制；默认 −80）。 */
  outputPerS?: number;
}

export interface ClosedLoopConfig {
  /** 植物与事件配置（时长、JR 参数、事件表、适应）。 */
  base: ExperimentConfig;
  /** 特征提取（默认 alphaPower，10 Hz，252 ms 窗）。 */
  feature?: FeatureConfig;
  /** 控制器模式（默认 'off'，即无控制对照）。 */
  controller?: ControllerMode;
  /** 阈值控制器参数（mode='threshold' 时用）。 */
  threshold?: ThresholdConfig;
  /** PID 参数（mode='pid' 时用）。 */
  pid?: PidParams;
  /** 控制器输出到植物的延迟，ms（默认 0；须为 4 ms 的整数倍）。 */
  delayMs?: number;
  /** 测量噪声 RMS，µV（默认 0；> 0 时加到特征输入上，种子复现）。 */
  measurementNoiseRmsUv?: number;
  /** 测量噪声种子（默认 7）。 */
  noiseSeed?: number;
}

export interface ClosedLoopRun {
  config: ClosedLoopConfig;
  /** 控制器节拍时间轴（4 ms 网格，含 t=0），ms。 */
  timesMs: number[];
  /** 特征值序列（µV² 或 µV，取决于特征种类；已含测量噪声）。 */
  feature: number[];
  /** 控制器指令输出（延迟前），1/s。 */
  commandedPerS: number[];
  /** 实际施加到植物的控制输出（延迟后），1/s。 */
  appliedPerS: number[];
  /** Pz 代理 EEG（4 ms 网格），µV。 */
  eegUvPz: number[];
  /** y0（4 ms 网格），mV。 */
  y0Mv: number[];
  /** 各节拍控制器是否触发（applied ≠ 0）。 */
  triggered: boolean[];
  metrics: ClosedLoopMetrics;
}

export interface ClosedLoopMetrics {
  /** 触发节拍占比（无控制时为 0；纯噪声运行时即误触发率）。 */
  triggerFraction: number;
  /** 首次触发时刻（ms；相对实验起点；从未触发为 null）。 */
  firstTriggerMs: number | null;
  /** 相对首个事件起始的响应时延（ms；无事件或未触发为 null）。 */
  responseLatencyMs: number | null;
  /** 控制器输出峰值绝对值，1/s。 */
  maxAbsControlPerS: number;
  /** y0 峰值绝对值，mV（稳定性：有界判据之一）。 */
  maxAbsY0Mv: number;
  /** Pz 峰值绝对值，µV。 */
  maxAbsEegUv: number;
  /** y0 RMS（mV）与 Pz RMS（µV），用于有控制/无控制对照。 */
  rmsY0Mv: number;
  rmsEegUv: number;
  /** 是否发散（任一读数非有限或 y0 越出 [−10, 100] mV）。 */
  diverged: boolean;
  /** 延迟，ms（回显配置）。 */
  delayMs: number;
}

/**
 * 闭环运行：模拟 EEG（Pz 代理）→ 特征提取 → 状态判定 → 控制器 →
 * 延迟 → 虚拟刺激（加到 JR 输入上）→ 神经响应。
 * 植物以 0.5 ms 步进，控制器以 4 ms 节拍运行；特征窗内为最近
 * 252 ms 的 Pz 采样；测量噪声按节拍序号索引、种子复现。
 */
export function runClosedLoop(cfg: ClosedLoopConfig): ClosedLoopRun {
  validateExperimentConfig(cfg.base);
  const delayMs = cfg.delayMs ?? 0;
  if (!(delayMs >= 0) || Math.abs(delayMs / CONTROL_DT_MS - Math.round(delayMs / CONTROL_DT_MS)) > 1e-9) {
    throw new RangeError(`ClosedLoopConfig: delayMs must be a non-negative multiple of ${CONTROL_DT_MS}, got ${delayMs}`);
  }
  const noiseRms = cfg.measurementNoiseRmsUv ?? 0;
  if (!(noiseRms >= 0)) throw new RangeError(`ClosedLoopConfig: measurementNoiseRmsUv must be >= 0, got ${noiseRms}`);
  const mode = cfg.controller ?? 'off';
  if (mode === 'threshold' && !cfg.threshold) {
    throw new RangeError('ClosedLoopConfig: threshold mode needs a threshold config');
  }
  if (mode === 'pid' && !cfg.pid) {
    throw new RangeError('ClosedLoopConfig: pid mode needs pid params');
  }
  if (cfg.threshold && !Number.isFinite(cfg.threshold.threshold)) {
    throw new RangeError('ClosedLoopConfig: threshold must be finite');
  }

  const plant = new JrPlant(cfg.base);
  const extractor = new FeatureExtractor(cfg.feature ?? { kind: 'alphaPower' });
  const pid = mode === 'pid' ? new PidController(cfg.pid as PidParams) : null;
  const delayTicks = Math.round(delayMs / CONTROL_DT_MS);
  const delayQueue: number[] = [];
  const noiseSeed = cfg.noiseSeed ?? 7;

  const nTicks = Math.round(cfg.base.durationMs / CONTROL_DT_MS);
  const timesMs: number[] = [0];
  const feature: number[] = [];
  const commandedPerS: number[] = [];
  const appliedPerS: number[] = [];
  const eegUvPz: number[] = [plant.read().eegUv];
  const y0Mv: number[] = [plant.read().y0];
  const triggered: boolean[] = [];

  // 控制器在每个 4 ms 节拍起点根据当前读数算一次控制量（窗内为截至
  // 该时刻的最近 252 ms Pz 采样），该控制量施加于接下来的 8 个植物步。
  // feature/commanded/applied/triggered 各 nTicks 项，对应节拍起点
  // timesMs[0..nTicks−1]；eegUvPz/y0Mv/timesMs 各 nTicks+1 项（含终点）。
  for (let tick = 0; tick < nTicks; tick++) {
    const r = plant.read();
    const noisy = r.eegUv + (noiseRms > 0 ? noiseRms * indexedGaussian(noiseSeed, tick) : 0);
    const f = extractor.push(noisy);
    let cmd = 0;
    if (mode === 'threshold') {
      const th = cfg.threshold as ThresholdConfig;
      cmd = f > th.threshold ? (th.outputPerS ?? -80) : 0;
    } else if (mode === 'pid' && pid) {
      cmd = pid.step(f, CONTROL_DT_MS);
    }
    feature.push(f);
    commandedPerS.push(cmd);
    delayQueue.push(cmd);
    const applied = delayQueue.length > delayTicks ? delayQueue.shift() as number : 0;
    appliedPerS.push(applied);
    triggered.push(applied !== 0);
    for (let s = 0; s < CONTROL_TICK_STEPS; s++) plant.step(applied);
    const r2 = plant.read();
    timesMs.push(r2.tMs);
    eegUvPz.push(r2.eegUv);
    y0Mv.push(r2.y0);
  }

  let maxAbsY0 = 0;
  let maxAbsEeg = 0;
  let diverged = false;
  for (const v of y0Mv) {
    if (!Number.isFinite(v)) diverged = true;
    else maxAbsY0 = Math.max(maxAbsY0, Math.abs(v));
  }
  for (const v of eegUvPz) {
    if (!Number.isFinite(v)) diverged = true;
    else maxAbsEeg = Math.max(maxAbsEeg, Math.abs(v));
  }
  if (maxAbsY0 > 100) diverged = true;
  const nTrig = triggered.filter(Boolean).length;
  const firstTrigIdx = triggered.findIndex(Boolean);
  const firstEventMs = (cfg.base.events ?? []).length > 0
    ? Math.min(...(cfg.base.events as ExperimentEventInput[]).map((e) => e.tMs))
    : null;
  const metrics: ClosedLoopMetrics = {
    triggerFraction: triggered.length > 0 ? nTrig / triggered.length : 0,
    firstTriggerMs: firstTrigIdx >= 0 ? timesMs[firstTrigIdx] : null,
    responseLatencyMs:
      firstTrigIdx >= 0 && firstEventMs !== null
        ? timesMs[firstTrigIdx] - firstEventMs
        : null,
    maxAbsControlPerS: appliedPerS.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
    maxAbsY0Mv: maxAbsY0,
    maxAbsEegUv: maxAbsEeg,
    rmsY0Mv: rmsOf(y0Mv),
    rmsEegUv: rmsOf(eegUvPz),
    diverged,
    delayMs,
  };
  return {
    config: cfg,
    timesMs,
    feature,
    commandedPerS,
    appliedPerS,
    eegUvPz,
    y0Mv,
    triggered,
    metrics,
  };
}

/** 有控制 vs 无控制对照：同一 base 配置，只开关控制器，数值比较。 */
export function compareControlVsNoControl(
  base: ExperimentConfig,
  controlled: Omit<ClosedLoopConfig, 'base'>,
): {
  noControl: ClosedLoopRun;
  controlled: ClosedLoopRun;
  rmsEegDiffUv: number;
  rmsY0DiffMv: number;
  peakEegDiffUv: number;
  triggerFraction: number;
} {
  const noControl = runClosedLoop({ base, controller: 'off' });
  const withControl = runClosedLoop({ base, ...controlled });
  return {
    noControl,
    controlled: withControl,
    rmsEegDiffUv: withControl.metrics.rmsEegUv - noControl.metrics.rmsEegUv,
    rmsY0DiffMv: withControl.metrics.rmsY0Mv - noControl.metrics.rmsY0Mv,
    peakEegDiffUv: withControl.metrics.maxAbsEegUv - noControl.metrics.maxAbsEegUv,
    triggerFraction: withControl.metrics.triggerFraction,
  };
}
