/**
 * PR-07 多导 EEG 生成（B1）。
 *
 * 数据链路：柱模型 q(t)（Wilson–Cowan 或 Jansen–Rit，二选一或双源线性
 * 叠加）→ 球形 lead-field（`sphereForward.ts`，`interpolateSphereGain`）
 * → 多通道 µV（无限远参考）→ 噪声（独立生成、独立标注）→ 参考变换。
 *
 * ── 量纲 ─────────────────────────────────────────────────────────────
 * 采样率 sfreqHz 默认 250 Hz（与 ds003061 一致）；柱模型按自身步长
 * （WC 1 ms、JR 0.5 ms）积分后下采样到 4 ms。时间 ms、频率 Hz、电位
 * µV、偶极矩 nA·m、噪声 RMS µV。只支持 250 Hz：其它采样率下 4 ms
 * 网格与柱模型步长不对齐，`runExperiment` 直接抛错，不静默近似。
 *
 * ── 假设与边界（与 PR5 同口径） ─────────────────────────────────────
 * - q(t) → 偶极矩的耦合链是 PR5 的显式假设（`localCorticalColumn.ts`
 *   `COUPLING_ID`、JR `JANSEN_RIT_ID`），N × coherence × 电流 × 长度
 *   的乘积不可辨识，幅度未经人体数据校准；本文件只负责把 q(t) 忠实
 *   地投影成多导 EEG，不对幅度做任何“校准乘积”。
 * - 源位置与朝向是调用方给定的假设值（默认头顶 [0, 0, 16] mm、朝向
 *   +Z），不是从解剖数据反推的真实皮层柱位置。
 * - 噪声/伪迹（白噪声、1/f 粉红噪声、50 Hz 工频、慢漂移）各自由独立
 *   的生成逻辑产生，成分上带 `kind`/`label` 标注，绝不混入神经源
 *   信号；`generateNoise` 返回的 `components` 与 `total` 只含噪声。
 * - 参考变换是线性的：average（减跨通道均值）、electrode（减指定
 *   通道，该通道变为 0）、infinity（不减）。`runExperiment` 先把
 *   信号 + 噪声的无限远参考数据存进 `rawDataUvInfinity`，再按所选
 *   参考生成 `dataUv`；`reReferenceRecording` 从原始数据重算，切换
 *   参考不损失信息、不重新跑模型。
 * - 事件：运行实验时按固定间隔产生脉冲事件（默认每 1000 ms 一次，
 *   首个在 1000 ms），条件 standard/oddball 交替；事件时间戳是仿真
 *   时钟（ms），不是浏览器墙钟。ERP 分段/平均不在本文件，由 A1 的
 *   `epochRecording` / `averageEpochs` 做（B2 的 ErpTab）。
 *
 * ── 确定性 ───────────────────────────────────────────────────────────
 * 噪声用 mulberry32（32 位整数 RNG）+ Box–Muller 高斯（无缓存，每
 * 个高斯消耗恰好 2 个均匀数），种子进 `recording.seed`；同种子、
 * 同参数、同一引擎下两次运行逐值相同（测试断言 JSON 级相等）。
 * Python 对照在 `scientific/eeg/eeg_reference.py`（同一 RNG、同一
 * 成分顺序、同一归一化口径），TS/Python 数值对照见
 * `tests/pr6/eeg-recording.test.mjs` 与 `tests/pr6/test_eeg_recording.py`。
 */

import {
  COUPLING_ID,
  createLocalCorticalColumn,
  DEFAULT_RATE_PARAMS,
  equivalentMomentNAm,
  type LocalRateParams,
  type DipoleMorphology,
  DEFAULT_MORPHOLOGY,
} from './localCorticalColumn.ts';
import {
  DEFAULT_JANSEN_RIT_PARAMS,
  JANSEN_RIT_ID,
  createJansenRitColumn,
} from './jansenRitColumn.ts';
import {
  SPHERE_MODEL_ID,
  interpolateSphereGain,
  validateSphereFixture,
  type MontageKey,
  type SphereFixture,
} from './sphereForward.ts';
import type { Vec3Mm } from './volumeConduction.ts';
import type {
  EegChannel,
  EegEvent,
  EegRecording,
  EegReference,
  EpochSet,
  NoiseParams,
} from './eegData.ts';

/* ── 默认参数 ───────────────────────────────────────────────────────── */

export const DEFAULT_SFREQ_HZ = 250;
export const DEFAULT_DURATION_MS = 10000;
export const DEFAULT_EVENT_INTERVAL_MS = 1000;
export const DEFAULT_DRIVE_DURATION_MS = 100;
/** WC 脉冲驱动，无量纲（`step()` 允许 |stim| ≤ 10；PR5 对照窗用 1.4）。 */
export const DEFAULT_WC_DRIVE = 1.0;
/** JR 脉冲附加输入，1/s（与 PR5 `PULSE_PER_S = 120` 同值）。 */
export const DEFAULT_JR_DRIVE_PER_S = 120;
/** JR 静息平均输入，1/s（低分支稳定不动点；220 是 ~10.5 Hz 极限环，
 *  无稳定不动点，`createJansenRitColumn` 会抛错，本文件不支持）。 */
export const DEFAULT_JR_BASELINE_INPUT_PER_S = 90;
export const DEFAULT_SEED = 1;
/** 默认源位置（mm，球形网格内，头顶）与朝向（+Z，径向）。 */
export const DEFAULT_SOURCE_POSITION_MM: Vec3Mm = [0, 0, 16];
export const DEFAULT_SOURCE_NORMAL_HEAD: Vec3Mm = [0, 0, 1];
/** 双源模式的第二个源位置（mm）与朝向；与第一个源不同位置。 */
export const DEFAULT_SECOND_SOURCE_POSITION_MM: Vec3Mm = [16, -16, 16];
export const DEFAULT_SECOND_SOURCE_NORMAL_HEAD: Vec3Mm = [0, 0, 1];
/** UI 默认噪声（µV RMS）：白 2、粉红 1、工频 0.5、漂移 0.5。 */
export const DEFAULT_NOISE: NoiseParams = {
  whiteRmsUv: 2,
  pinkRmsUv: 1,
  line50HzRmsUv: 0.5,
  driftRmsUv: 0.5,
};
/** 噪声滑杆范围（µV RMS），前后端契约 §1.6 登记。 */
export const NOISE_SLIDER_MIN_UV = 0;
export const NOISE_SLIDER_MAX_UV = 10;

export type SourceModel = 'wc' | 'jr' | 'both';

export function sourceModelId(model: SourceModel): string {
  if (model === 'wc') return COUPLING_ID;
  if (model === 'jr') return JANSEN_RIT_ID;
  return `${COUPLING_ID}+${JANSEN_RIT_ID}`;
}

/** 参考方式的人类可读标签（UI 与导出共用）。 */
export function referenceLabel(ref: EegReference): string {
  if (ref.mode === 'electrode') return `电极参考 (${ref.label})`;
  if (ref.mode === 'average') return '平均参考';
  return '无限远参考';
}

/* ── 小工具 ─────────────────────────────────────────────────────────── */

/** 一组数的 RMS（µV）；空数组抛错。 */
export function rms(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('rms: empty input');
  let s = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) throw new RangeError('rms: non-finite value');
    s += v * v;
  }
  return Math.sqrt(s / values.length);
}

function assertUnitVec3(v: Vec3Mm, name: string): void {
  if (
    v.length !== 3 ||
    !v.every(Number.isFinite) ||
    Math.abs(Math.hypot(...v) - 1) > 1e-3
  ) {
    throw new RangeError(`${name} must be a finite unit 3-vector, got [${v}]`);
  }
}

/* ── 确定性 RNG ─────────────────────────────────────────────────────── */

/**
 * mulberry32：32 位整数 RNG（seed >>> 0）。输出 [0, 1) 的均匀数。
 * 与 Python 对照 `scientific/eeg/eeg_reference.py` 的 `mulberry32`
 * 逐位同构（同种子同序列，见对照测试）。
 */
export function mulberry32(seed: number): () => number {
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
 * 标准正态高斯（Box–Muller，无缓存）：每次调用恰好消耗 2 个均匀数
 * （u1, u2），返回 sqrt(−2 ln u1)·cos(2πu2)。u1 下限 1e-12 防 log(0)
 *（与 Python 对照同款守卫，正常种子下永不触发）。
 */
export function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/* ── 噪声 ───────────────────────────────────────────────────────────── */

export type NoiseComponentKind = 'white' | 'pink' | 'line50' | 'drift';

export interface NoiseComponentTrace {
  kind: NoiseComponentKind;
  /**
   * 人类可读标注。噪声/伪迹成分，绝不是神经源活动；下游分析（ERP/
   * 时频/地形/源定位）读 `EegRecording.dataUv` 时不得把这些成分
   * 当作神经源信号解释。
   */
  label: string;
  /** [通道][采样]，µV。 */
  data: number[][];
}

export interface GeneratedNoise {
  components: NoiseComponentTrace[];
  /** 各成分之和，[通道][采样]，µV。 */
  total: number[][];
}

const NOISE_LABELS: Record<NoiseComponentKind, string> = {
  white: '白噪声（伪迹，非神经源）',
  pink: '1/f 粉红噪声（伪迹，非神经源）',
  line50: '50 Hz 工频干扰（伪迹，非神经源）',
  drift: '慢漂移（伪迹，非神经源）',
};

/** 把一条单通道迹按目标 RMS 缩放（目标 0 时返回全零迹）。 */
function normalizeToRms(trace: number[], targetRmsUv: number): number[] {
  if (targetRmsUv === 0) return trace.map(() => 0);
  const actual = rms(trace);
  if (actual === 0) throw new RangeError('normalizeToRms: zero trace cannot be scaled to nonzero RMS');
  const k = targetRmsUv / actual;
  return trace.map((v) => v * k);
}

/**
 * 噪声生成（µV）。四个成分各自独立生成、独立标注；成分顺序固定为
 * 白 → 粉红 → 工频 → 漂移，同一 RNG 流按此顺序消耗，同种子同参数
 * 下逐值复现（TS 内 bit 一致；TS/Python 对照容差 1e-9 相对）。
 * 每成分每通道归一化到目标 RMS（µV）；总噪声 RMS ≈ sqrt(Σ RMS²)
 *（成分间交叉项很小，测试容差 5%）。
 */
export function generateNoise(
  params: NoiseParams,
  nChannels: number,
  nSamples: number,
  sfreqHz: number,
  seed: number,
): GeneratedNoise {
  for (const [k, v] of Object.entries(params)) {
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError(`generateNoise: ${k} must be a finite non-negative RMS (µV), got ${v}`);
    }
  }
  if (!Number.isInteger(nChannels) || nChannels < 1) {
    throw new RangeError(`generateNoise: nChannels must be a positive integer, got ${nChannels}`);
  }
  if (!Number.isInteger(nSamples) || nSamples < 1) {
    throw new RangeError(`generateNoise: nSamples must be a positive integer, got ${nSamples}`);
  }
  if (!Number.isFinite(sfreqHz) || sfreqHz <= 0) {
    throw new RangeError(`generateNoise: sfreqHz must be positive, got ${sfreqHz}`);
  }
  const rng = mulberry32(seed);
  const components: NoiseComponentTrace[] = [];
  const total: number[][] = Array.from({ length: nChannels }, () =>
    new Array<number>(nSamples).fill(0),
  );
  const push = (kind: NoiseComponentKind, data: number[][]) => {
    components.push({ kind, label: NOISE_LABELS[kind], data });
    for (let c = 0; c < nChannels; c++) {
      for (let j = 0; j < nSamples; j++) total[c][j] += data[c][j];
    }
  };

  // 白噪声：逐采样点独立高斯，每通道归一化到 whiteRmsUv。
  if (params.whiteRmsUv > 0) {
    const data: number[][] = [];
    for (let c = 0; c < nChannels; c++) {
      const raw = Array.from({ length: nSamples }, () => gaussian(rng));
      data.push(normalizeToRms(raw, params.whiteRmsUv));
    }
    push('white', data);
  } else {
    push('white', Array.from({ length: nChannels }, () => new Array<number>(nSamples).fill(0)));
  }

  // 1/f 粉红噪声：Voss–McCartney，16 行；每采样点只重画一行（行号 =
  // 计数器最低置位，counter 从 1 开始），行和即采样值；每通道归一化。
  if (params.pinkRmsUv > 0) {
    const data: number[][] = [];
    for (let c = 0; c < nChannels; c++) {
      const rows = new Array<number>(16).fill(0);
      const raw = new Array<number>(nSamples);
      let counter = 0;
      for (let j = 0; j < nSamples; j++) {
        counter += 1;
        let k = 0;
        while (((counter >> k) & 1) === 0) k++;
        rows[k] = gaussian(rng);
        let s = 0;
        for (let r = 0; r < 16; r++) s += rows[r];
        raw[j] = s;
      }
      data.push(normalizeToRms(raw, params.pinkRmsUv));
    }
    push('pink', data);
  } else {
    push('pink', Array.from({ length: nChannels }, () => new Array<number>(nSamples).fill(0)));
  }

  // 50 Hz 工频：每通道随机相位正弦，幅值 √2·RMS；每通道归一化
  //（采样点数不是 5 的倍数时离散 RMS 与 A/√2 有端点偏差）。
  if (params.line50HzRmsUv > 0) {
    const data: number[][] = [];
    for (let c = 0; c < nChannels; c++) {
      const phase = rng() * 2 * Math.PI;
      const amp = Math.SQRT2 * params.line50HzRmsUv;
      const raw = Array.from(
        { length: nSamples },
        (_, j) => amp * Math.sin((2 * Math.PI * 50 * j) / sfreqHz + phase),
      );
      data.push(normalizeToRms(raw, params.line50HzRmsUv));
    }
    push('line50', data);
  } else {
    push('line50', Array.from({ length: nChannels }, () => new Array<number>(nSamples).fill(0)));
  }

  // 慢漂移：0.1 / 0.23 / 0.41 Hz 三正弦等幅叠加（随机相位），
  // 每通道归一化到 driftRmsUv。
  if (params.driftRmsUv > 0) {
    const freqs = [0.1, 0.23, 0.41];
    const data: number[][] = [];
    for (let c = 0; c < nChannels; c++) {
      const phases = freqs.map(() => rng() * 2 * Math.PI);
      const raw = Array.from({ length: nSamples }, (_, j) => {
        let s = 0;
        for (let f = 0; f < freqs.length; f++) {
          s += Math.sin((2 * Math.PI * freqs[f] * j) / sfreqHz + phases[f]);
        }
        return s;
      });
      data.push(normalizeToRms(raw, params.driftRmsUv));
    }
    push('drift', data);
  } else {
    push('drift', Array.from({ length: nChannels }, () => new Array<number>(nSamples).fill(0)));
  }

  return { components, total };
}

/* ── 参考变换 ───────────────────────────────────────────────────────── */

/**
 * 参考变换（线性，逐采样点；返回新数组，不改输入）。
 * - infinity：原样返回（无限远参考，信号 + 噪声的原始值）。
 * - average：减去该采样点跨通道均值。
 * - electrode：减去指定通道的迹（该通道变为全零；标签须在当前导联内）。
 */
export function applyReference(
  dataUv: number[][],
  reference: EegReference,
  channelLabels: string[],
): number[][] {
  if (dataUv.length === 0) throw new RangeError('applyReference: no channels');
  if (dataUv.length !== channelLabels.length) {
    throw new RangeError(
      `applyReference: channel count ${dataUv.length} vs label count ${channelLabels.length}`,
    );
  }
  const nSamples = dataUv[0].length;
  for (let c = 0; c < dataUv.length; c++) {
    if (dataUv[c].length !== nSamples) {
      throw new RangeError('applyReference: ragged dataUv (all channels must share the time axis)');
    }
    for (let j = 0; j < nSamples; j++) {
      if (!Number.isFinite(dataUv[c][j])) throw new RangeError('applyReference: non-finite value');
    }
  }
  if (reference.mode === 'infinity') {
    return dataUv.map((row) => [...row]);
  }
  if (reference.mode === 'electrode') {
    const refIdx = channelLabels.indexOf(reference.label);
    if (refIdx < 0) {
      throw new RangeError(
        `applyReference: reference electrode ${reference.label} not in current montage (${channelLabels.join(', ')})`,
      );
    }
    return dataUv.map((row) => row.map((v, j) => v - dataUv[refIdx][j]));
  }
  // average：减去该采样点跨通道均值。
  const out: number[][] = dataUv.map(() => new Array<number>(nSamples).fill(0));
  for (let j = 0; j < nSamples; j++) {
    let mean = 0;
    for (let c = 0; c < dataUv.length; c++) mean += dataUv[c][j];
    mean /= dataUv.length;
    for (let c = 0; c < dataUv.length; c++) out[c][j] = dataUv[c][j] - mean;
  }
  return out;
}

/**
 * 无损切换参考：从 `rec.rawDataUvInfinity` 重算。缺原始数据时抛错
 *（不从已参考过的 `dataUv` 反推，平均参考丢掉的跨通道均值找不回来）。
 */
export function reReferenceRecording(rec: EegRecording, reference: EegReference): EegRecording {
  if (!rec.rawDataUvInfinity) {
    throw new RangeError(
      'reReferenceRecording: recording has no rawDataUvInfinity (cannot re-reference without the infinity-reference data)',
    );
  }
  const labels = rec.channels.map((c) => c.label);
  return {
    ...rec,
    dataUv: applyReference(rec.rawDataUvInfinity, reference, labels),
    reference: reference.mode === 'electrode'
      ? { mode: 'electrode', label: reference.label }
      : { mode: reference.mode },
  };
}

/* ── 导联与正向投影 ─────────────────────────────────────────────────── */

/** 按导联取通道（标签 + 球面位置）；导联切换即重建这份配置。 */
export function channelsForMontage(fixture: SphereFixture, montage: MontageKey): EegChannel[] {
  const labels = fixture.montages[montage];
  if (!labels) throw new RangeError(`channelsForMontage: unknown montage ${montage}`);
  const byLabel = new Map(fixture.sensors.map((s) => [s.label, s]));
  return labels.map((label) => {
    const s = byLabel.get(label);
    if (!s) throw new RangeError(`channelsForMontage: montage sensor ${label} not in lead field`);
    return { label, positionMm: [...s.position_mm] as Vec3Mm };
  });
}

/**
 * 单源偶极矩序列 → 多导无限远参考电压（µV）。
 * 每通道先算标量系数 c_ch = gain_ch · normal（gain 为三线性插值后的
 * 3 向量增益，µV/(nA·m)），再逐采样 V_ch[t] = c_ch · q[t]。
 * 纯线性：双源叠加即两个源的电压相加（测试断言）。
 */
export function projectMoments(
  fixture: SphereFixture,
  positionMm: Vec3Mm,
  normalHead: Vec3Mm,
  momentsNAm: number[],
  montage: MontageKey,
): number[][] {
  assertUnitVec3(normalHead, 'normalHead');
  for (const q of momentsNAm) {
    if (!Number.isFinite(q)) throw new RangeError('projectMoments: non-finite moment');
  }
  const gains = interpolateSphereGain(fixture, positionMm);
  const byLabel = new Map(fixture.sensors.map((s, i) => [s.label, i]));
  const labels = fixture.montages[montage];
  if (!labels) throw new RangeError(`projectMoments: unknown montage ${montage}`);
  return labels.map((label) => {
    const i = byLabel.get(label);
    if (i === undefined) throw new RangeError(`projectMoments: montage sensor ${label} not in lead field`);
    const g = gains[i];
    const coeff = g[0] * normalHead[0] + g[1] * normalHead[1] + g[2] * normalHead[2];
    return momentsNAm.map((q) => coeff * q);
  });
}

/* ── 柱模型 q(t) ────────────────────────────────────────────────────── */

export interface SourceMoments {
  positionMm: Vec3Mm;
  normalHead: Vec3Mm;
  /** 下采样到 250 Hz 的偶极矩序列，nA·m。 */
  momentsNAm: number[];
}

export interface SimulateSourcesOptions {
  durationMs: number;
  /** 事件：{tMs, wcDrive, jrDrivePerS}；驱动只在 [tMs, tMs+driveDurationMs) 内施加。 */
  events: { tMs: number; wcDrive: number; jrDrivePerS: number }[];
  driveDurationMs: number;
  sourceModel: SourceModel;
  sourcePositionMm: Vec3Mm;
  sourceNormalHead: Vec3Mm;
  secondSourcePositionMm: Vec3Mm;
  secondSourceNormalHead: Vec3Mm;
  jrBaselineInputPerS: number;
  wcParams?: LocalRateParams;
  wcMorphology?: DipoleMorphology;
}

/**
 * 跑柱模型并下采样到 250 Hz（4 ms 网格，含 t=0）。
 * - WC：dt=1 ms，每 4 步取 1 个样；JR：dt=0.5 ms，每 8 步取 1 个样。
 * - 'both'：WC 与 JR 各跑一遍（同一事件时刻，不同驱动单位），返回
 *   两个源；线性叠加在投影后做，不在 q 上混。
 * 抛错：durationMs 不是 4 的倍数、事件出界、柱模型发散（上游抛错原样透传）。
 */
export function simulateSourceMoments(opts: SimulateSourcesOptions): {
  timesMs: number[];
  sources: SourceMoments[];
} {
  const { durationMs } = opts;
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs % 4 !== 0) {
    throw new RangeError(`simulateSourceMoments: durationMs must be a positive multiple of 4, got ${durationMs}`);
  }
  if (opts.driveDurationMs <= 0) {
    throw new RangeError(`simulateSourceMoments: driveDurationMs must be positive, got ${opts.driveDurationMs}`);
  }
  for (const ev of opts.events) {
    if (ev.tMs < 0 || ev.tMs + opts.driveDurationMs > durationMs) {
      throw new RangeError(`simulateSourceMoments: event at ${ev.tMs} ms with ${opts.driveDurationMs} ms drive exceeds duration ${durationMs} ms`);
    }
  }
  assertUnitVec3(opts.sourceNormalHead, 'sourceNormalHead');
  assertUnitVec3(opts.secondSourceNormalHead, 'secondSourceNormalHead');
  const nSamples = durationMs / 4 + 1;
  const timesMs = Array.from({ length: nSamples }, (_, j) => j * 4);

  const driveAt = (tMs: number, kind: 'wc' | 'jr'): number => {
    for (const ev of opts.events) {
      if (tMs >= ev.tMs && tMs < ev.tMs + opts.driveDurationMs) {
        return kind === 'wc' ? ev.wcDrive : ev.jrDrivePerS;
      }
    }
    return 0;
  };

  const sources: SourceMoments[] = [];
  if (opts.sourceModel === 'wc' || opts.sourceModel === 'both') {
    const wcP = opts.wcParams ?? DEFAULT_RATE_PARAMS;
    if (4 % wcP.dtMs !== 0 || durationMs % wcP.dtMs !== 0) {
      throw new RangeError(
        `simulateSourceMoments: WC dtMs=${wcP.dtMs} must divide both 4 ms and durationMs=${durationMs}`,
      );
    }
    const col = createLocalCorticalColumn(wcP, opts.wcMorphology ?? DEFAULT_MORPHOLOGY);
    const momentsNAm: number[] = [col.read().equivalentMomentNAm];
    const sampleEvery = Math.round(4 / wcP.dtMs);
    const steps = Math.round(durationMs / wcP.dtMs);
    for (let s = 1; s <= steps; s++) {
      col.step(driveAt((s - 1) * wcP.dtMs, 'wc'));
      if (s % sampleEvery === 0) momentsNAm.push(col.read().equivalentMomentNAm);
    }
    if (momentsNAm.length !== nSamples) {
      throw new RangeError(`WC sampling mismatch: ${momentsNAm.length} vs ${nSamples}`);
    }
    sources.push({
      positionMm: opts.sourcePositionMm,
      normalHead: opts.sourceNormalHead,
      momentsNAm,
    });
  }
  if (opts.sourceModel === 'jr' || opts.sourceModel === 'both') {
    const jrParams = {
      ...DEFAULT_JANSEN_RIT_PARAMS,
      baselineInputPerS: opts.jrBaselineInputPerS,
    };
    const col = createJansenRitColumn(jrParams, DEFAULT_MORPHOLOGY);
    const momentsNAm: number[] = [col.read().equivalentMomentNAm];
    const dtMs = DEFAULT_JANSEN_RIT_PARAMS.dtMs;
    const sampleEvery = Math.round(4 / dtMs);
    const steps = Math.round(durationMs / dtMs);
    for (let s = 1; s <= steps; s++) {
      col.step(driveAt((s - 1) * dtMs, 'jr'));
      if (s % sampleEvery === 0) momentsNAm.push(col.read().equivalentMomentNAm);
    }
    if (momentsNAm.length !== nSamples) {
      throw new RangeError(`JR sampling mismatch: ${momentsNAm.length} vs ${nSamples}`);
    }
    sources.push({
      positionMm: opts.sourceModel === 'both' ? opts.secondSourcePositionMm : opts.sourcePositionMm,
      normalHead: opts.sourceModel === 'both' ? opts.secondSourceNormalHead : opts.sourceNormalHead,
      momentsNAm,
    });
  }
  return { timesMs, sources };
}

/* ── 运行实验 ───────────────────────────────────────────────────────── */

export interface RunExperimentOptions {
  fixture: SphereFixture;
  durationMs?: number;
  /** 只支持 250（柱模型步长与 4 ms 网格对齐的要求，见文件头）。 */
  sfreqHz?: number;
  montage?: MontageKey;
  reference?: EegReference;
  sourceModel?: SourceModel;
  sourcePositionMm?: Vec3Mm;
  sourceNormalHead?: Vec3Mm;
  secondSourcePositionMm?: Vec3Mm;
  secondSourceNormalHead?: Vec3Mm;
  eventIntervalMs?: number;
  driveDurationMs?: number;
  wcDrive?: number;
  jrDrivePerS?: number;
  jrBaselineInputPerS?: number;
  /** null = 无噪声（默认）；否则按给定 RMS 生成四成分噪声。 */
  noise?: NoiseParams | null;
  seed?: number;
}

/**
 * 运行一次多导 EEG 实验：事件表 → 柱模型 q(t) → 球形 lead-field →
 * 多通道 µV（无限远参考）→ 噪声 → 参考变换。
 * 返回 `{ recording, events }`；`recording.rawDataUvInfinity` 存无限远
 * 参考数据，供 `reReferenceRecording` 无损切换参考。
 */
export function runExperiment(opts: RunExperimentOptions): {
  recording: EegRecording;
  events: EegEvent[];
} {
  validateSphereFixture(opts.fixture);
  const sfreqHz = opts.sfreqHz ?? DEFAULT_SFREQ_HZ;
  if (sfreqHz !== DEFAULT_SFREQ_HZ) {
    throw new RangeError(`runExperiment: only sfreqHz=${DEFAULT_SFREQ_HZ} is supported, got ${sfreqHz}`);
  }
  const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
  const montage = opts.montage ?? '10-20';
  const reference = opts.reference ?? { mode: 'average' };
  const sourceModel = opts.sourceModel ?? 'wc';
  const eventIntervalMs = opts.eventIntervalMs ?? DEFAULT_EVENT_INTERVAL_MS;
  const driveDurationMs = opts.driveDurationMs ?? DEFAULT_DRIVE_DURATION_MS;
  const wcDrive = opts.wcDrive ?? DEFAULT_WC_DRIVE;
  const jrDrivePerS = opts.jrDrivePerS ?? DEFAULT_JR_DRIVE_PER_S;
  const seed = opts.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(seed)) throw new RangeError(`runExperiment: seed must be an integer, got ${seed}`);
  if (eventIntervalMs <= 0 || driveDurationMs > eventIntervalMs) {
    throw new RangeError(
      `runExperiment: need 0 < driveDurationMs (${driveDurationMs}) <= eventIntervalMs (${eventIntervalMs})`,
    );
  }

  // 事件表：首个在 eventIntervalMs，之后每 eventIntervalMs 一次；
  // 末个事件的驱动窗须在记录内（留 500 ms 尾）。
  const simEvents: { tMs: number; wcDrive: number; jrDrivePerS: number }[] = [];
  const events: EegEvent[] = [];
  let id = 0;
  for (let t = eventIntervalMs; t + driveDurationMs <= durationMs - 500; t += eventIntervalMs) {
    const condition = id % 2 === 0 ? 'standard' : 'oddball';
    simEvents.push({ tMs: t, wcDrive, jrDrivePerS });
    events.push({
      id,
      type: 'pulse',
      tMs: t,
      condition,
      drive: sourceModel === 'jr' ? jrDrivePerS : wcDrive,
      driveUnit: sourceModel === 'jr' ? 'jr' : 'wc',
    });
    id++;
  }
  if (events.length === 0) {
    throw new RangeError(
      `runExperiment: durationMs=${durationMs} ms is too short for one event (need >= ${eventIntervalMs + driveDurationMs + 500} ms)`,
    );
  }

  const { timesMs, sources } = simulateSourceMoments({
    durationMs,
    events: simEvents,
    driveDurationMs,
    sourceModel,
    sourcePositionMm: opts.sourcePositionMm ?? DEFAULT_SOURCE_POSITION_MM,
    sourceNormalHead: opts.sourceNormalHead ?? DEFAULT_SOURCE_NORMAL_HEAD,
    secondSourcePositionMm: opts.secondSourcePositionMm ?? DEFAULT_SECOND_SOURCE_POSITION_MM,
    secondSourceNormalHead: opts.secondSourceNormalHead ?? DEFAULT_SECOND_SOURCE_NORMAL_HEAD,
    jrBaselineInputPerS: opts.jrBaselineInputPerS ?? DEFAULT_JR_BASELINE_INPUT_PER_S,
  });

  const channels = channelsForMontage(opts.fixture, montage);
  const nSamples = timesMs.length;
  const raw: number[][] = channels.map(() => new Array<number>(nSamples).fill(0));
  for (const src of sources) {
    const projected = projectMoments(
      opts.fixture,
      src.positionMm,
      src.normalHead,
      src.momentsNAm,
      montage,
    );
    for (let c = 0; c < channels.length; c++) {
      for (let j = 0; j < nSamples; j++) raw[c][j] += projected[c][j];
    }
  }

  const noise = opts.noise ?? null;
  if (noise) {
    const gen = generateNoise(noise, channels.length, nSamples, sfreqHz, seed);
    for (let c = 0; c < channels.length; c++) {
      for (let j = 0; j < nSamples; j++) raw[c][j] += gen.total[c][j];
    }
  }

  const labels = channels.map((c) => c.label);
  const recording: EegRecording = {
    version: 1,
    sfreqHz,
    timesMs,
    channels,
    dataUv: applyReference(raw, reference, labels),
    reference: reference.mode === 'electrode'
      ? { mode: 'electrode', label: reference.label }
      : { mode: reference.mode },
    montage,
    forwardModelId: SPHERE_MODEL_ID,
    sourceModelId: sourceModelId(sourceModel),
    seed,
    noise,
    rawDataUvInfinity: raw,
  };
  return { recording, events };
}

/* ── 直播推导（PR8-LINK，§4.1 统一仿真状态）─────────────────────── */

/**
 * 直播推导的记录标识（`EegRecording.sourceModelId`）。与 `runExperiment`
 * 的柱模型 id 不同：这份记录不是独立柱模型跑出来的，是直播 WC 网络
 * 的快照流推导出来的，界面与契约都必须写清来源。
 */
export const LIVE_DERIVATION_ID = 'live-wc-snapshot-interp-v1';
/** Worker 快照的标称广播率（Hz）；`set_snapshot_hz` 默认 60 Hz。 */
export const LIVE_SNAPSHOT_HZ = 60;
/** 直播推导要求的最短快照历史跨度（ms）；不足时抛错，不编造记录。 */
export const LIVE_MIN_SPAN_MS = 1000;

/** 一条直播快照（`SimClient.getSnapshotHistory()` 的元素形状）。 */
export interface LiveSnapshotSample {
  /** 仿真时钟 ms（不是浏览器墙钟）。 */
  t_ms: number;
  /** 全脑 E（无量纲，0..1）。 */
  e: ArrayLike<number>;
  /** 全脑 I（无量纲，0..1）。 */
  i: ArrayLike<number>;
}

/** 一次脉冲标记（`SimClient.getMarkers()` 的元素形状）。 */
export interface LivePulseMarker {
  t_ms: number;
  node: number;
  kind: 'pulse' | 'hold';
  /** 发送时用的刺激幅度（模型单位）；缺失时按默认 WC 驱动计。 */
  amplitude?: number;
}

/**
 * 源位置钳制进球形 lead-field 网格（`source_grid_axis_mm`，目前 ±48 mm）。
 * TVB 脑区中心坐标超出网格时 `interpolateSphereGain` 会抛错；直播源位置
 * 必须先钳制再投影。钳制本身是演示映射的一部分（TVB 中心未配准到 HEAD），
 * 调用方须在界面上写清原始中心与钳制后位置。
 */
export function clampSourcePositionMm(fixture: SphereFixture, positionMm: Vec3Mm): Vec3Mm {
  const axis = fixture.source_grid_axis_mm;
  if (!axis || axis.length < 2) throw new RangeError('clampSourcePositionMm: fixture has no source_grid_axis_mm');
  const lo = axis[0];
  const hi = axis[axis.length - 1];
  for (const v of positionMm) {
    if (!Number.isFinite(v)) throw new RangeError(`clampSourcePositionMm: non-finite coordinate ${v}`);
  }
  return [
    Math.min(hi, Math.max(lo, positionMm[0])),
    Math.min(hi, Math.max(lo, positionMm[1])),
    Math.min(hi, Math.max(lo, positionMm[2])),
  ];
}

/**
 * 直播快照流 → 选中脑区的偶极矩序列（250 Hz，4 ms 网格）。
 *
 * - E(t)、I(t) 各自在 60 Hz 快照点之间线性插值，再经 PR5 q 链
 *   `equivalentMomentNAm(E, I, baselineE, baselineI)` 算 q(t)。
 * - 基线由调用方给（EEG 台用窗口首样本 E/I；HEAD/DIPOLE 用选区切换时
 *   的 E/I），不是本函数猜的。
 * - 有效采样率是快照率（标称 60 Hz，实测值见返回的 `snapshotHz`）：
 *   250 Hz 网格上的高频成分是插值产物，不是实测，调用方必须如实标注。
 * 抛错：样本 <2 条、脑区越界、E/I 非有限或出 [0,1]、时间跨度 <1 s、
 * 时间戳不递增（排序后仍有重复时间戳且 E/I 不同时插值分母为零——
 * 本函数按分母为零时取左端点处理，不抛错）。
 */
export function deriveLiveMoments(
  samples: readonly LiveSnapshotSample[],
  node: number,
  baselineE: number,
  baselineI: number,
  morphology: DipoleMorphology = DEFAULT_MORPHOLOGY,
): {
  timesMs: number[];
  momentsNAm: number[];
  /** 窗口起点（仿真时钟 ms）；记录的 timesMs 是相对时间（0 起）。 */
  t0Ms: number;
  durationMs: number;
  spanMs: number;
  sampleCount: number;
  /** 实测快照率（Hz，由样本数/跨度算出）。 */
  snapshotHz: number;
} {
  if (!Array.isArray(samples) || samples.length < 2) {
    throw new RangeError('deriveLiveMoments: need at least 2 snapshot samples');
  }
  const sorted = [...samples].sort((a, b) => a.t_ms - b.t_ms);
  const nRegions = sorted[0].e.length;
  if (!Number.isInteger(node) || node < 0 || node >= nRegions) {
    throw new RangeError(`deriveLiveMoments: node ${node} out of range (0..${nRegions - 1})`);
  }
  for (const s of sorted) {
    if (!Number.isFinite(s.t_ms)) throw new RangeError('deriveLiveMoments: non-finite snapshot t_ms');
    if (s.e.length !== nRegions || s.i.length !== nRegions) {
      throw new RangeError('deriveLiveMoments: snapshot E/I length mismatch across samples');
    }
    const e = s.e[node];
    const i = s.i[node];
    if (![e, i, baselineE, baselineI].every(Number.isFinite) || e < 0 || e > 1 || i < 0 || i > 1) {
      throw new RangeError('deriveLiveMoments: snapshot E/I must be finite fractions in [0, 1]');
    }
  }
  const t0Ms = sorted[0].t_ms;
  const t1 = sorted[sorted.length - 1].t_ms;
  const spanMs = t1 - t0Ms;
  if (spanMs < LIVE_MIN_SPAN_MS) {
    throw new RangeError(
      `deriveLiveMoments: snapshot span ${spanMs.toFixed(1)} ms < ${LIVE_MIN_SPAN_MS} ms (need >= 1 s of live history)`,
    );
  }
  const durationMs = Math.floor(spanMs / 4) * 4;
  const nSamples = durationMs / 4 + 1;
  const timesMs = Array.from({ length: nSamples }, (_, j) => j * 4);
  const momentsNAm: number[] = new Array<number>(nSamples);
  let seg = 0;
  for (let j = 0; j < nSamples; j++) {
    const tAbs = t0Ms + timesMs[j];
    while (seg < sorted.length - 2 && sorted[seg + 1].t_ms <= tAbs) seg++;
    const a = sorted[seg];
    const b = sorted[seg + 1];
    const dt = b.t_ms - a.t_ms;
    const f = dt <= 0 ? 0 : Math.min(1, Math.max(0, (tAbs - a.t_ms) / dt));
    const e = a.e[node] + f * (b.e[node] - a.e[node]);
    const i = a.i[node] + f * (b.i[node] - a.i[node]);
    momentsNAm[j] = equivalentMomentNAm(e, i, baselineE, baselineI, morphology);
  }
  return {
    timesMs,
    momentsNAm,
    t0Ms,
    durationMs,
    spanMs,
    sampleCount: sorted.length,
    snapshotHz: ((sorted.length - 1) * 1000) / spanMs,
  };
}

export interface RunLiveExperimentOptions {
  fixture: SphereFixture;
  /** 直播快照历史（`SimClient.getSnapshotHistory()`，按时间升序为佳）。 */
  samples: readonly LiveSnapshotSample[];
  /** 选中脑区 id（源脑区）。 */
  node: number;
  /** 静息基线 E/I（调用方给，见 `deriveLiveMoments`）。 */
  baselineE: number;
  baselineI: number;
  /** 脉冲标记（`SimClient.getMarkers()`）；只有同脑区、窗内、pulse 的才计入事件表。 */
  markers?: readonly LivePulseMarker[];
  /** 源位置（TVB 脑区中心；函数内钳制进 lead-field 网格）。 */
  positionMm: Vec3Mm;
  normalHead?: Vec3Mm;
  montage?: MontageKey;
  reference?: EegReference;
  /** null = 无噪声（默认）；否则按给定 RMS 生成四成分噪声（与 `runExperiment` 同款）。 */
  noise?: NoiseParams | null;
  seed?: number;
  morphology?: DipoleMorphology;
}

/**
 * 从直播推导一次多导 EEG 实验：快照流 E(t)/I(t) → 线性插值 250 Hz →
 * q(t)（PR5 假设链）→ 球形 lead-field → 多通道 µV（无限远参考）→
 * 噪声 → 参考变换。事件表只取真实脉冲标记，不按固定间隔编造事件；
 * 无脉冲时事件表为空（ERP tab 显示“还没有事件表”，不崩）。
 * 返回的 `sourcePositionMm` 是钳制后的实际源位置。
 * `runExperiment` 的现有行为与测试一字未动。
 */
export function runLiveExperiment(opts: RunLiveExperimentOptions): {
  recording: EegRecording;
  events: EegEvent[];
  sourcePositionMm: Vec3Mm;
  snapshotHz: number;
  t0Ms: number;
} {
  validateSphereFixture(opts.fixture);
  const montage = opts.montage ?? '10-20';
  const reference = opts.reference ?? { mode: 'average' };
  const seed = opts.seed ?? DEFAULT_SEED;
  if (!Number.isInteger(seed)) throw new RangeError(`runLiveExperiment: seed must be an integer, got ${seed}`);
  const normalHead = opts.normalHead ?? DEFAULT_SOURCE_NORMAL_HEAD;
  const clamped = clampSourcePositionMm(opts.fixture, opts.positionMm);
  const { timesMs, momentsNAm, t0Ms, durationMs, snapshotHz } = deriveLiveMoments(
    opts.samples,
    opts.node,
    opts.baselineE,
    opts.baselineI,
    opts.morphology,
  );
  const channels = channelsForMontage(opts.fixture, montage);
  const raw = projectMoments(opts.fixture, clamped, normalHead, momentsNAm, montage);
  const noise = opts.noise ?? null;
  if (noise) {
    const gen = generateNoise(noise, channels.length, timesMs.length, DEFAULT_SFREQ_HZ, seed);
    for (let c = 0; c < channels.length; c++) {
      for (let j = 0; j < timesMs.length; j++) raw[c][j] += gen.total[c][j];
    }
  }
  const labels = channels.map((c) => c.label);
  const recording: EegRecording = {
    version: 1,
    sfreqHz: DEFAULT_SFREQ_HZ,
    timesMs,
    channels,
    dataUv: applyReference(raw, reference, labels),
    reference: reference.mode === 'electrode'
      ? { mode: 'electrode', label: reference.label }
      : { mode: reference.mode },
    montage,
    forwardModelId: SPHERE_MODEL_ID,
    sourceModelId: LIVE_DERIVATION_ID,
    seed,
    noise,
    rawDataUvInfinity: raw,
  };
  const events: EegEvent[] = [];
  let id = 0;
  for (const m of opts.markers ?? []) {
    if (m.kind !== 'pulse' || m.node !== opts.node) continue;
    const rel = m.t_ms - t0Ms;
    if (rel < 0 || rel > durationMs) continue;
    events.push({
      id,
      type: 'pulse',
      tMs: rel,
      // LIVE cortical clicks have no standardized oddball task definition.
      // Never manufacture standard/oddball groups by alternating pulses.
      condition: 'unclassified',
      drive: m.amplitude ?? DEFAULT_WC_DRIVE,
      driveUnit: 'wc',
    });
    id++;
  }
  return { recording, events, sourcePositionMm: clamped, snapshotHz, t0Ms };
}

/* ── 直播记录持久化（PR8-LINK：关弹窗不再丢记录）──────────────────── */

/**
 * 模块级 store：最后一份 EEG 记录 + 事件表 + 分段（不论是直播推导还是
 * 独立柱模型跑出来的）。`EegAnalysisLab` 挂载时从这里恢复、运行时写回；
 * 弹窗关掉、模式切换都不丢记录。只存引用，不做深拷贝（调用方不改动它）。
 */
export interface LiveRecordingStoreValue {
  recording: EegRecording;
  events: EegEvent[];
  epochs: EpochSet | null;
}
let liveRecordingStore: LiveRecordingStoreValue | null = null;
export function getLiveRecordingStore(): LiveRecordingStoreValue | null {
  return liveRecordingStore;
}
export function setLiveRecordingStore(v: LiveRecordingStoreValue | null): void {
  liveRecordingStore = v;
}

/* ── 感觉靶区映射（PR8-LINK：感觉输入进主仿真）────────────────────── */

/**
 * 感觉输入的靶脑区（按 `brainData` label 找，不写死 id 之外的任何假设）：
 * 视觉闪烁 → 双侧初级视皮层 V1；听觉 burst → 双侧初级听皮层 A1。
 * label 在 `app/public/brain-assets/regions.json` 里是 rV1/lV1/rA1/lA1
 *（id 35/73/0/38）；找不到时返回空数组，调用方不得编造节点。
 */
export const SENSORY_VISUAL_REGION_LABELS = ['rV1', 'lV1'] as const;
export const SENSORY_AUDITORY_REGION_LABELS = ['rA1', 'lA1'] as const;
export function sensoryTargetNodes(
  regions: ReadonlyArray<{ label: string }>,
  kind: 'visual' | 'auditory',
): number[] {
  const want: readonly string[] =
    kind === 'visual' ? SENSORY_VISUAL_REGION_LABELS : SENSORY_AUDITORY_REGION_LABELS;
  const out: number[] = [];
  regions.forEach((r, idx) => {
    if (want.includes(r.label)) out.push(idx);
  });
  return out;
}

/* ── 导出 ───────────────────────────────────────────────────────────── */

/** 导出 JSON（含元数据与全部采样；`rawDataUvInfinity` 一并导出，保证可复现参考切换）。 */
export function recordingToJson(rec: EegRecording): string {
  return JSON.stringify(rec, null, 2);
}

/**
 * 导出 CSV：`#` 注释行写元数据（参考、导联、正向/源模型 id、种子、
 * 噪声 RMS），随后表头 `time_ms,<通道…>` 与逐采样行（µV，全精度）。
 */
export function recordingToCsv(rec: EegRecording): string {
  const labels = rec.channels.map((c) => c.label);
  const lines: string[] = [
    `# forward_model_id=${rec.forwardModelId}`,
    `# source_model_id=${rec.sourceModelId}`,
    `# reference=${JSON.stringify(rec.reference)}`,
    `# montage=${rec.montage}`,
    `# sfreq_hz=${rec.sfreqHz}`,
    `# seed=${rec.seed}`,
    `# noise=${rec.noise ? JSON.stringify(rec.noise) : 'null'}`,
    ['time_ms', ...labels].join(','),
  ];
  for (let j = 0; j < rec.timesMs.length; j++) {
    lines.push([String(rec.timesMs[j]), ...rec.dataUv.map((row) => String(row[j]))].join(','));
  }
  return lines.join('\n') + '\n';
}
