/**
 * PR6: EEG 分析共享数据模型（计划 §4.1 的 EEGState / ExperimentState /
 * AnalysisState 在本批的实现）。
 *
 * 本文件是 PR-07–PR-12 共享的数据基础（计划 §18 依赖关系）：一个实验产生
 * `EegRecording` + `EegEvent[]`，ERP / 时频 / 地形 / 源定位全部读同一份
 * 记录，不许各写一套不相关的模拟波形。
 *
 * 单位总则（与 docs/frontend-backend-contract.md §0 一致）：长度 mm、电位 µV、
 * 偶极矩 nA·m、时间 ms、频率 Hz。采样率 sfreqHz 默认 250 Hz（与 ds003061 一致）。
 */
import type { Vec3Mm } from './volumeConduction.ts';
import type { MontageKey } from './sphereForward.ts';

export interface EegChannel {
  label: string;
  positionMm: Vec3Mm;
}

export type EegReference =
  | { mode: 'average' | 'infinity' }
  | { mode: 'electrode'; label: string };

export interface NoiseParams {
  /** 白噪声 RMS，µV。 */
  whiteRmsUv: number;
  /** 1/f 粉红噪声 RMS，µV。 */
  pinkRmsUv: number;
  /** 50 Hz 工频 RMS，µV。 */
  line50HzRmsUv: number;
  /** 慢漂移 RMS，µV。 */
  driftRmsUv: number;
}

export interface EegRecording {
  version: 1;
  /** 采样率，Hz（默认 250，与 ds003061 一致）。 */
  sfreqHz: number;
  /** 采样时刻，ms。 */
  timesMs: number[];
  /** 导联标签与位置。 */
  channels: EegChannel[];
  /** [通道][采样]，µV。 */
  dataUv: number[][];
  reference: EegReference;
  montage: MontageKey;
  /** 正向模型 id，如 SPHERE_MODEL_ID。 */
  forwardModelId: string;
  /** 源模型 id，如 JANSEN_RIT_ID / COUPLING_ID。 */
  sourceModelId: string;
  /** 噪声种子（确定性复现用）。 */
  seed: number;
  /** null = 无噪声。 */
  noise: NoiseParams | null;
  /**
   * 未经参考变换的原始多导数据（无限远参考，µV），与 `dataUv` 同形。
   * PR-07 新增的可选字段：有它时 `reReferenceRecording` 才能无损切换
   * 参考（平均参考会丢掉跨通道均值，无法从 `dataUv` 反推）；缺它时
   * 切换参考会抛错。B2/B3 不依赖本字段，读 `dataUv` 即可。
   */
  rawDataUvInfinity?: number[][];
}

export interface EegEvent {
  id: number;
  type: 'standard' | 'oddball' | 'noise' | 'pulse';
  /** 仿真时钟上的时间戳，ms（不是浏览器墙钟）。 */
  tMs: number;
  condition: 'standard' | 'oddball';
  /** 该事件用的刺激驱动数值。 */
  drive: number;
  /** 驱动单位：'wc' = Wilson–Cowan 无量纲驱动；'jr' = Jansen–Rit 1/s。 */
  driveUnit: 'wc' | 'jr';
}

export interface EpochSet {
  tminMs: number;
  tmaxMs: number;
  /** 基线窗，ms，如 [-200, 0]。 */
  baselineMs: [number, number];
  /** 相对事件的采样时刻，ms。 */
  timesMs: number[];
  /** [试次][通道][采样]，µV，已基线校正。 */
  trials: number[][][];
  /** 每试次是否保留（峰峰值剔除），与输入事件一一对应。 */
  kept: boolean[];
  /** 保留试次对应的事件（与 trials 一一对应）。 */
  events: EegEvent[];
  sfreqHz: number;
  channels: string[];
}

export interface ErpResult {
  timesMs: number[];
  /** [通道][采样]，µV。 */
  meanUv: number[][];
  /** [通道][采样]，µV。 */
  semUv: number[][];
  n: number;
  peakUv: number;
  peakLatencyMs: number;
  windowMeanUv: number;
  channel: string;
  windowMs: [number, number];
}

export type EegBandName = 'delta' | 'theta' | 'alpha' | 'beta' | 'gamma';

/** EEG 频段（Hz）。唯一定义处；signalProcessing.ts 从这里 import，不许另写一份。 */
export const EEG_BANDS: Record<EegBandName, [number, number]> = {
  delta: [0.5, 4],
  theta: [4, 8],
  alpha: [8, 13],
  beta: [13, 30],
  gamma: [30, 45],
};

export interface PsdResult {
  freqsHz: number[];
  /** [通道][频率]，µV²/Hz。 */
  psdUv2PerHz: number[][];
  /** 每频段每通道的功率，µV²。 */
  bandPowerUv2: Record<EegBandName, number[]>;
  /** 每通道的谱峰频率，Hz。 */
  peakHz: number[];
}

export interface TfrResult {
  timesMs: number[];
  freqsHz: number[];
  /** [频率][时间]，单通道，dB（ERSP）或 µV²（功率）。 */
  powerDb: number[][];
  /** [频率][时间]，单通道，0–1。 */
  itc: number[][];
  channel: string;
  method: 'stft' | 'morlet' | 'multitaper';
}

export interface TopoResult {
  atTimeMs: number;
  /** 所选导联的实测值，µV。 */
  electrodeValues: { label: string; valueUv: number }[];
  /** 2D 插值场（球面样条），明确标注为插值。 */
  grid: { x: number; y: number; valueUv: number }[];
  method: 'spherical-spline';
  /** 3D：345 个传感器位置的正向计算值（L·q，无插值）。 */
  forwardValues: { label: string; valueUv: number }[];
}

export interface DipoleFitResult {
  estimatedPositionMm: Vec3Mm;
  estimatedMomentNAm: Vec3Mm;
  residualRmsUv: number;
  truePositionMm: Vec3Mm;
  trueMomentNAm: Vec3Mm;
  localizationErrorMm: number;
}

export interface MneInverseResult {
  /** 估计分布峰值位置，mm。 */
  estimatedPositionMm: Vec3Mm;
  peakValue: number;
  spreadMm: number;
  localizationErrorMm: number;
  truePositionMm: Vec3Mm;
  lambda2: number;
  method: 'MNE';
}
