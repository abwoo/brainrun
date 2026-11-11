/**
 * PR8-A — 四个模式（计划 §16.1）与 15 个一键科学场景（计划 §16.3）。
 *
 * 本模块是纯 TypeScript（无 React、无 WASM、无 DOM）：场景定义、
 * 预设校验与可计算场景的真实分发。每个场景都映射到一个真实后端
 * 函数（见 SCENARIOS 的 `backend` 字段与契约 §1.12），绝无只换
 * 标题不跑计算的假按钮。
 *
 * 两类场景：
 * - live-sim 场景（S1–S3）：动作在 Wilson–Cowan 引擎里发生
 *   （SimClient.pulse / setWeight / setParams），必须经 App 传入的
 *   回调执行；本模块的 runScenarioCompute 对它们抛错，说明需要
 *   实时仿真，而不是静默返回假数字。
 * - compute 场景（S4–S15）：同步跑真实后端函数，返回关键结果数字。
 *   其中 S5–S7、S10–S11 需要球形正向模型 fixture（由 CI 生成的
 *   app/public/forward-assets/sphere-model.json，不入库）；fixture
 *   为 null 时抛错，不编造 lead-field。
 *
 * 预设精确值见契约 docs/frontend-backend-contract.md §1.12。
 */
import type { EegRecording } from './eegData.ts';
import { DEFAULT_JANSEN_RIT_PARAMS, JANSEN_RIT_ID } from './jansenRitColumn.ts';
import {
  analyseErp,
  differenceWaveErp,
  epochOddballExperiment,
  filterEpochsByCondition,
  runAlphaLimitCycle,
  runOddballExperiment,
} from './lateResponse.ts';
import { DEFAULT_HH_PARAMS, simulateHodgkinHuxley } from './cellular.ts';
import { runExperiment } from './eegRecording.ts';
import {
  compareControlVsNoControl,
  runAB,
} from './experiments.ts';
import { bandPowers, erspItc, welchPsd } from './signalProcessing.ts';
import { blindTest } from './sourceLocalization.ts';
import { forwardHeadPotential, topoAtTime } from './topography.ts';
import { sphereElectrodePotentials, SPHERE_MODEL_ID, type SphereFixture } from './sphereForward.ts';
import { demoSphereSensors, potentialMicrovolts } from './volumeConduction.ts';
import type { Vec3Mm } from './volumeConduction.ts';

/* ── 四个模式（计划 §16.1）────────────────────────────────────────── */

export type AppMode = 'play' | 'waves' | 'eeg' | 'explore';

export const APP_MODES: readonly AppMode[] = ['play', 'waves', 'eeg', 'explore'];

export const MODE_LABELS: Record<AppMode, string> = {
  play: 'PLAY',
  waves: 'WAVES',
  eeg: 'EEG',
  explore: 'EXPLORE',
};

export const MODE_DESCRIPTIONS: Record<AppMode, string> = {
  play: '直接触碰大脑、施加输入、改变参数、观察网络响应。',
  waves: '探索振荡、脑电频段、功率谱和神经动力学。',
  eeg: '探索头部物理模型、电极、EEG、ERP、时频、地形和源定位。',
  explore: '探索解剖、脑图谱、标准坐标以及多尺度神经元模型。',
};

export function isAppMode(v: string): v is AppMode {
  return (APP_MODES as readonly string[]).includes(v);
}

/** 模式切换状态机：只接受四个已知模式，其余抛错（不静默回落）。 */
export function transitionMode(_from: AppMode, to: string): AppMode {
  if (!isAppMode(to)) throw new RangeError(`Unknown app mode: ${to}`);
  return to;
}

/* ── 场景定义 ─────────────────────────────────────────────────────── */

export type LabTarget = 'eeg' | 'head' | 'cellular' | 'experiment' | 'dipole' | null;

export interface ScenarioDef {
  id: number;
  title: string;
  mode: AppMode;
  summary: string;
  /** 预设精确值（契约 §1.12 登记的同一份值）。 */
  preset: Record<string, number | string | number[] | string[]>;
  /** 真实后端：`模块.函数`，与契约 §1.12 的控件→后端映射一致。 */
  backend: string;
  requiresFixture: boolean;
  needsLiveSim: boolean;
  /** 运行后建议打开的实验台（仅导航，计算本身已在 launcher 里跑完）。 */
  openLab: LabTarget;
  /** 打开 EEG 实验台时默认切到的 tab（仅 S6/S8/S9/S10/S11 用）。 */
  eegTab?: 'eeg' | 'waves' | 'erp' | 'tfr' | 'topo' | 'inverse';
}

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 1, title: '触碰大脑，看网络如何响应', mode: 'play',
    summary: '脉冲 40 号脑区（演示脑区），在 RESPONSE 面板看真实快照的峰值 ΔE。',
    preset: { node: 40 },
    backend: 'simClient.ts SimClient.pulse',
    requiresFixture: false, needsLiveSim: true, openLab: null,
  },
  {
    id: 2, title: '改变一条连接，看传播有何不同', mode: 'play',
    summary: '把 73→54 的连接权重改 0 再脉冲 73 号脑区，响应窗口填满后恢复原始权重。',
    preset: { fromNode: 73, toNode: 54, newWeight: 0, pulseNode: 73 },
    backend: 'simClient.ts SimClient.setWeight + pulse + resetWeight',
    requiresFixture: false, needsLiveSim: true, openLab: null,
  },
  {
    id: 3, title: '改变兴奋／抑制参数，观察振荡', mode: 'play',
    summary: 'c_ei 由 4.0 改为 6.0 再脉冲 40 号脑区；改完的值留在 PARAMETERS 面板，可手动改回。',
    preset: { c_eiFrom: 4, c_eiTo: 6, pulseNode: 40 },
    backend: 'simClient.ts SimClient.setParams({ c_ei }) + pulse',
    requiresFixture: false, needsLiveSim: true, openLab: null,
  },
  {
    id: 4, title: '产生并观察 Alpha 节律', mode: 'waves',
    summary: 'JR p0=220 极限环跑 12 s（去前 2 s），Welch PSD 读 alpha 峰与占比。',
    preset: { p0PerS: 220, durationMs: 12000, settleMs: 2000, sampleDtMs: 4 },
    backend: 'lateResponse.ts runAlphaLimitCycle + signalProcessing.ts welchPsd/bandPowers',
    requiresFixture: false, needsLiveSim: false, openLab: null,
  },
  {
    id: 5, title: '移动电流源，看 EEG 如何变化', mode: 'eeg',
    summary: '球形头模型里偶极子由 [0,0,16] 移到 [16,0,16] mm，看 Cz 电位变化。',
    preset: { sourceFromMm: [0, 0, 16], sourceToMm: [16, 0, 16], momentNAm: [0, 10, 0], montage: '10-20' },
    backend: 'sphereForward.ts sphereElectrodePotentials',
    requiresFixture: true, needsLiveSim: false, openLab: 'head',
  },
  {
    id: 6, title: '从 10–20 切换到 10–10 和 10–05', mode: 'eeg',
    summary: '同一柱模型实验在三个导联下各跑 2 s，比较导联数与 Pz RMS。',
    preset: { montages: ['10-20', '10-10', '10-05'], durationMs: 2000, sourceModel: 'wc', seed: 1 },
    backend: 'eegRecording.ts runExperiment',
    requiresFixture: true, needsLiveSim: false, openLab: 'eeg', eegTab: 'eeg',
  },
  {
    id: 7, title: '移动 Cz 附近的电极，看测量如何变化', mode: 'eeg',
    summary: '同一偶极子下逐个读 Cz 邻近电极 FCz / C1 / Cz / C2 / CPz 的电位——是离散电极步进，不是连续拖动。',
    preset: { electrodes: ['FCz', 'C1', 'Cz', 'C2', 'CPz'], sourceMm: [0, 0, 16], momentNAm: [0, 10, 0], montage: '10-10' },
    backend: 'sphereForward.ts sphereElectrodePotentials',
    requiresFixture: true, needsLiveSim: false, openLab: 'head',
  },
  {
    id: 8, title: '重复刺激，观察 ERP 平均', mode: 'eeg',
    summary: 'oddball 实验 40 试次（32 标准 + 8 oddball），分段平均后读 oddball 峰值与差异波。',
    preset: { nTrials: 40, isiMs: 1000, noiseRmsUv: 0, seed: 1, channel: 'Pz' },
    backend: 'lateResponse.ts runOddballExperiment + epochOddballExperiment + analyseErp',
    requiresFixture: false, needsLiveSim: false, openLab: 'eeg', eegTab: 'erp',
  },
  {
    id: 9, title: '查看时频图中的功率变化', mode: 'eeg',
    summary: '同一份 oddball 试次集做 Morlet ERSP，读 100–500 ms / 8–30 Hz 窗内平均 ERSP 与 ITC。',
    preset: { nTrials: 40, isiMs: 1000, method: 'morlet', tWindowMs: [100, 500], fWindowHz: [8, 30] },
    backend: 'lateResponse.ts runOddballExperiment + signalProcessing.ts erspItc',
    requiresFixture: false, needsLiveSim: false, openLab: 'eeg', eegTab: 'tfr',
  },
  {
    id: 10, title: '比较头皮地形图和真实电流源位置', mode: 'eeg',
    summary: '同一份 2 s EEG 记录在 1050 ms 做球面样条地形，与已知源 [0,0,16] mm 的正向头皮电位峰值电极对照。',
    preset: { durationMs: 2000, atTimeMs: 1050, sourceMm: [0, 0, 16], momentNAm: [0, 10, 0], montage: '10-20' },
    backend: 'topography.ts topoAtTime + forwardHeadPotential',
    requiresFixture: true, needsLiveSim: false, openLab: 'eeg', eegTab: 'topo',
  },
  {
    id: 11, title: '运行源定位，比较估计和真实位置', mode: 'eeg',
    summary: '盲测：真源 [16,16,16] mm、矩 [0,10,0] nA·m，偶极子拟合与 MNE 各报定位误差。',
    preset: { truePositionMm: [16, 16, 16], trueMomentNAm: [0, 10, 0], montage: '10-20', noiseRmsUv: 0, seed: 7 },
    backend: 'sourceLocalization.ts blindTest',
    requiresFixture: true, needsLiveSim: false, openLab: 'eeg', eegTab: 'inverse',
  },
  {
    id: 12, title: '在两个大脑中进行单参数对照', mode: 'play',
    summary: 'JR 柱 A/B 各跑 2 s，只改事件驱动（120 vs 300 1/s），比较峰值与 ERP 峰差。',
    preset: { durationMs: 2000, eventTms: 1000, eventDurationMs: 100, driveA: 120, driveB: 300 },
    backend: 'experiments.ts runAB',
    requiresFixture: false, needsLiveSim: false, openLab: 'experiment',
  },
  {
    id: 13, title: '进入神经元层面，注入电流观察动作电位', mode: 'explore',
    summary: 'Hodgkin–Huxley 标准参数，10 µA/cm² 阶跃电流 10–60 ms，数动作电位。',
    preset: { model: 'hh', currentDensityUAperCm2: 10, onMs: 10, offMs: 60, durationMs: 200 },
    backend: 'cellular.ts simulateHodgkinHuxley',
    requiresFixture: false, needsLiveSim: false, openLab: 'cellular',
  },
  {
    id: 14, title: '比较不同组织电导率的正向计算', mode: 'explore',
    summary: '均匀无限导体解析偶极子公式，同一偶极子/传感器下 σ=0.10 / 0.33 / 1.00 S/m 各算一次电位。',
    preset: { dipolePositionMm: [0, 0, 0], momentNAm: [10, 0, 0], sensor: 'S10', sigmasSPerM: [0.1, 0.33, 1] },
    backend: 'volumeConduction.ts potentialMicrovolts',
    requiresFixture: false, needsLiveSim: false, openLab: 'dipole',
  },
  {
    id: 15, title: '构建一个简化 EEG 闭环控制实验', mode: 'play',
    summary: '阈值闭环 3 s（事件 1000 ms / 300 1/s，阈值 0.1 µV、输出 −80 1/s），与无控制对照比 RMS。',
    preset: { durationMs: 3000, eventTms: 1000, eventDurationMs: 100, drivePerS: 300, thresholdUv: 0.1, outputPerS: -80, delayMs: 0 },
    backend: 'experiments.ts runClosedLoop + compareControlVsNoControl',
    requiresFixture: false, needsLiveSim: false, openLab: 'experiment',
  },
];

export function getScenario(id: number): ScenarioDef {
  const def = SCENARIOS.find((s) => s.id === id);
  if (!def) throw new RangeError(`Unknown scenario id: ${id}`);
  return def;
}

/* ── 预设校验（纯函数，不跑模型）──────────────────────────────────── */

function isVec3(v: unknown): v is Vec3Mm {
  return Array.isArray(v) && v.length === 3 && v.every((x) => Number.isFinite(x));
}

/** 校验全部 15 个场景的预设：范围、单位、枚举值，非法即抛错。 */
export function validateScenarioPresets(): void {
  for (const s of SCENARIOS) {
    const p = s.preset;
    switch (s.id) {
      case 1:
        if (p.node !== 40) throw new RangeError('S1: node must be 40');
        break;
      case 2:
        if (p.fromNode !== 73 || p.toNode !== 54 || p.newWeight !== 0 || p.pulseNode !== 73) {
          throw new RangeError('S2: preset must be 73->54 weight 0, pulse 73');
        }
        break;
      case 3: {
        const to = p.c_eiTo as number;
        if (p.c_eiFrom !== 4 || to !== 6 || !(to >= 3 && to <= 8)) {
          throw new RangeError('S3: c_ei must move 4.0 -> 6.0 within [3, 8]');
        }
        break;
      }
      case 4:
        if (p.p0PerS !== 220 || p.durationMs !== 12000 || p.settleMs !== 2000) {
          throw new RangeError('S4: JR p0 must be 220, 12 s, settle 2 s');
        }
        break;
      case 5:
        if (!isVec3(p.sourceFromMm) || !isVec3(p.sourceToMm) || !isVec3(p.momentNAm)) {
          throw new RangeError('S5: source/moment must be vec3');
        }
        break;
      case 6: {
        const m = p.montages as string[];
        if (m.length !== 3 || m[0] !== '10-20' || m[1] !== '10-10' || m[2] !== '10-05') {
          throw new RangeError('S6: montages must be 10-20 / 10-10 / 10-05');
        }
        if (p.durationMs !== 2000) throw new RangeError('S6: durationMs must be 2000');
        break;
      }
      case 7: {
        const e = p.electrodes as string[];
        if (e.length !== 5 || e[2] !== 'Cz' || new Set(e).size !== 5) {
          throw new RangeError('S7: electrodes must be 5 distinct labels centred on Cz');
        }
        // FCz / C1 / C2 / CPz 不是 10-20 标签（10-20 只有 Cz），必须走 10-10。
        if (p.montage !== '10-10') throw new RangeError('S7: montage must be 10-10 (FCz/C1/C2/CPz are 10-10 labels)');
        break;
      }
      case 8:
      case 9:
        if (p.nTrials !== 40 || p.isiMs !== 1000) throw new RangeError(`S${s.id}: oddball must be 40 trials, ISI 1000 ms`);
        break;
      case 10:
        if (p.durationMs !== 2000 || p.atTimeMs !== 1050) throw new RangeError('S10: duration 2000 ms, atTime 1050 ms (50 ms after the 1000 ms event, near peak; 400 ms is before any event and the topo is identically zero)');
        break;
      case 11:
        if (!isVec3(p.truePositionMm) || (p.noiseRmsUv as number) !== 0 || p.seed !== 7) {
          throw new RangeError('S11: blind test must be noise 0, seed 7');
        }
        break;
      case 12:
        if (p.driveA !== 120 || p.driveB !== 300 || p.durationMs !== 2000) {
          throw new RangeError('S12: AB drives must be 120 vs 300, duration 2000 ms');
        }
        break;
      case 13:
        if (p.currentDensityUAperCm2 !== 10 || p.onMs !== 10 || p.offMs !== 60) {
          throw new RangeError('S13: HH step must be 10 uA/cm2, 10-60 ms');
        }
        break;
      case 14: {
        const sig = p.sigmasSPerM as number[];
        if (sig.length !== 3 || sig[0] !== 0.1 || sig[1] !== 0.33 || sig[2] !== 1) {
          throw new RangeError('S14: sigmas must be 0.10 / 0.33 / 1.00 S/m');
        }
        break;
      }
      case 15:
        if (p.thresholdUv !== 0.1 || p.outputPerS !== -80 || p.durationMs !== 3000) {
          throw new RangeError('S15: threshold 0.1 uV, output -80 1/s, duration 3000 ms');
        }
        break;
      default:
        throw new RangeError(`No preset validation for scenario ${s.id}`);
    }
  }
  // 与真实后端默认值的交叉核对（不是只在表里自洽）：
  // JR 默认 p0=90（低分支），场景 4 显式用 220 极限环；HH 默认参数即场景 13 用的参数。
  if (DEFAULT_JANSEN_RIT_PARAMS.baselineInputPerS !== 90) {
    throw new RangeError('JR default p0 changed: expected 90');
  }
  if (DEFAULT_HH_PARAMS.dtMs !== 0.025) {
    throw new RangeError('HH default dtMs changed: expected 0.025 ms');
  }
}

/* ── 计算结果 ─────────────────────────────────────────────────────── */

export interface KeyNumber {
  label: string;
  value: number;
  unit: string;
}

export interface ScenarioResult {
  scenarioId: number;
  title: string;
  keyNumbers: KeyNumber[];
  note: string;
  /** 计算耗时（墙钟），ms。 */
  durationMs: number;
  /** S4 专用：由真实 JR 极限环算出的 Pz 记录，供 WAVES 模式画 PSD。 */
  alphaRecording?: EegRecording;
}

export interface ScenarioContext {
  fixture: SphereFixture | null;
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
}

function rms(values: readonly number[]): number {
  return Math.sqrt(values.reduce((s, v) => s + v * v, 0) / Math.max(1, values.length));
}

function requireFixture(ctx: ScenarioContext, id: number): SphereFixture {
  if (!ctx.fixture) {
    throw new Error(
      `Scenario ${id} needs the sphere forward model (app/public/forward-assets/sphere-model.json). ` +
        'Generate it with scientific/forward/generate_sphere_model.py; no lead-field is fabricated.',
    );
  }
  return ctx.fixture;
}

/** S4 的 JR 极限环转成单通道 Pz 记录（250 Hz），供 WAVES 模式复用。 */
export function alphaLimitCycleRecording(): EegRecording {
  const r = runAlphaLimitCycle({ durationMs: 12000, settleMs: 2000, sampleDtMs: 4 });
  return {
    version: 1,
    sfreqHz: 250,
    timesMs: r.timesMs,
    channels: [{ label: 'Pz', positionMm: [0, -50, 90] }],
    dataUv: [r.pzUv],
    reference: { mode: 'average' },
    montage: '10-20',
    forwardModelId: SPHERE_MODEL_ID,
    sourceModelId: JANSEN_RIT_ID,
    seed: 1,
    noise: null,
  };
}

function runOddballEpochs() {
  const { recording, events } = runOddballExperiment({ nTrials: 40, isiMs: 1000, noiseRmsUv: 0, seed: 1 });
  const epochs = epochOddballExperiment(recording, events);
  return { recording, events, epochs };
}

const TFR_FREQS_HZ = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40];

/**
 * 跑一个可计算场景（S4–S15），返回关键结果数字。
 * S1–S3 需要实时仿真引擎，在此抛错（由 launcher 经 App 的 SimClient 回调执行）；
 * 需要 fixture 而 ctx.fixture 为 null 时抛错，不编造数据。
 */
export function runScenarioCompute(id: number, ctx: ScenarioContext): ScenarioResult {
  const def = getScenario(id);
  const t0 = Date.now();
  const done = (keyNumbers: KeyNumber[], note: string, extra?: Partial<ScenarioResult>): ScenarioResult => ({
    scenarioId: id,
    title: def.title,
    keyNumbers,
    note,
    durationMs: Date.now() - t0,
    ...extra,
  });
  switch (id) {
    case 1:
    case 2:
    case 3:
      throw new Error(
        `Scenario ${id} needs the live Wilson–Cowan simulation (SimClient); ` +
          'run it from the app, not from runScenarioCompute.',
      );
    case 4: {
      const recording = alphaLimitCycleRecording();
      const x = recording.dataUv[0];
      const xc = x.map((v) => v - mean(x));
      const { freqsHz, psd } = welchPsd(xc, 250, { nFft: 1024 });
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
      return done(
        [
          { label: 'alpha 峰频率', value: peakHz, unit: 'Hz' },
          { label: 'alpha 功率占比', value: total > 0 ? bands.alpha / total : 0, unit: '' },
          { label: 'Pz RMS', value: rms(xc), unit: 'µV' },
        ],
        'JR p0=220 极限环（自发节律，非外部驱动）；alpha 占比接近 1 是纯极限环无宽带背景的已知局限。',
        { alphaRecording: recording },
      );
    }
    case 5: {
      const fixture = requireFixture(ctx, 5);
      const from = sphereElectrodePotentials(fixture, [0, 0, 16], [0, 10, 0], '10-20', { mode: 'average' });
      const to = sphereElectrodePotentials(fixture, [16, 0, 16], [0, 10, 0], '10-20', { mode: 'average' });
      const iCz = from.sensors.findIndex((s) => s.label === 'Cz');
      if (iCz < 0) throw new Error('Scenario 5: Cz not in 10-20 montage');
      const vFrom = from.voltageUv[iCz];
      const vTo = to.voltageUv[iCz];
      return done(
        [
          { label: 'Cz 电位（源 [0,0,16]）', value: vFrom, unit: 'µV' },
          { label: 'Cz 电位（源 [16,0,16]）', value: vTo, unit: 'µV' },
          { label: 'Cz 变化量', value: vTo - vFrom, unit: 'µV' },
        ],
        '四层球形头正向模型（MNE），偶极矩 [0,10,0] nA·m，平均参考；源位置为球心坐标（HEAD 球心系）。',
      );
    }
    case 6: {
      const fixture = requireFixture(ctx, 6);
      const keyNumbers: KeyNumber[] = [];
      for (const montage of ['10-20', '10-10', '10-05'] as const) {
        const { recording } = runExperiment({ fixture, durationMs: 2000, montage, sourceModel: 'wc', seed: 1 });
        const pzIdx = recording.channels.findIndex((c) => c.label === 'Pz');
        keyNumbers.push(
          { label: `${montage} 导联数`, value: recording.channels.length, unit: '导' },
          { label: `${montage} Pz RMS`, value: pzIdx >= 0 ? rms(recording.dataUv[pzIdx]) : NaN, unit: 'µV' },
        );
      }
      return done(keyNumbers, '同一柱模型（WC，种子 1）+ 同一球形正向模型，只换导联；通道数 19 / 94 / 343。');
    }
    case 7: {
      const fixture = requireFixture(ctx, 7);
      const { sensors, voltageUv } = sphereElectrodePotentials(
        fixture, [0, 0, 16], [0, 10, 0], '10-10', { mode: 'average' },
      );
      const labels = ['FCz', 'C1', 'Cz', 'C2', 'CPz'];
      const keyNumbers: KeyNumber[] = [];
      for (const label of labels) {
        const i = sensors.findIndex((s) => s.label === label);
        if (i < 0) throw new Error(`Scenario 7: electrode ${label} not in 10-10 montage`);
        keyNumbers.push({ label: `${label} 电位`, value: voltageUv[i], unit: 'µV' });
      }
      const vals = keyNumbers.map((k) => k.value);
      keyNumbers.push({ label: '五电极极差', value: Math.max(...vals) - Math.min(...vals), unit: 'µV' });
      return done(
        keyNumbers,
        '邻近电极步进：同一偶极子下逐个切离散电极读数，不是连续拖动电极位置；电极位置由 10-10 导联固定。',
      );
    }
    case 8: {
      const { epochs } = runOddballEpochs();
      const odd = analyseErp(filterEpochsByCondition(epochs, 'oddball'), 'Pz');
      const std = analyseErp(filterEpochsByCondition(epochs, 'standard'), 'Pz');
      const diff = differenceWaveErp(odd, std, 0);
      return done(
        [
          { label: 'oddball 峰值', value: odd.peakUv, unit: 'µV' },
          { label: 'oddball 峰潜伏期', value: odd.peakLatencyMs, unit: 'ms' },
          { label: '差异波 300–500 ms 均值', value: diff.windowMeanUv, unit: 'µV' },
          { label: 'oddball 试次数', value: odd.n, unit: '个' },
        ],
        'oddball 40 试次（32 标准 + 8 oddball），分段 −200–800 ms、基线 −200–0 ms；模型峰约 0.17 µV，远小于真实 P300（已知幅度缺口，见 PR6）。',
      );
    }
    case 9: {
      const { epochs } = runOddballEpochs();
      const tfr = erspItc(epochs, 'Pz', TFR_FREQS_HZ, 'morlet', epochs.baselineMs);
      let sE = 0;
      let sI = 0;
      let n = 0;
      for (let f = 0; f < TFR_FREQS_HZ.length; f++) {
        if (TFR_FREQS_HZ[f] < 8 || TFR_FREQS_HZ[f] > 30) continue;
        for (let j = 0; j < tfr.timesMs.length; j++) {
          if (tfr.timesMs[j] < 100 || tfr.timesMs[j] > 500) continue;
          sE += tfr.erspDb[f][j];
          sI += tfr.itc[f][j];
          n++;
        }
      }
      return done(
        [
          { label: '窗内平均 ERSP', value: n > 0 ? sE / n : NaN, unit: 'dB' },
          { label: '窗内平均 ITC', value: n > 0 ? sI / n : NaN, unit: '' },
          { label: '试次数', value: epochs.trials.length, unit: '个' },
        ],
        'Morlet（cycles=5）ERSP，窗 100–500 ms / 8–30 Hz；与 ERP 用同一份 oddball 试次集。',
      );
    }
    case 10: {
      const fixture = requireFixture(ctx, 10);
      const { recording } = runExperiment({ fixture, durationMs: 2000, montage: '10-20', sourceModel: 'wc', seed: 1 });
      const atTimeMs = def.preset.atTimeMs as number;
      const topo = topoAtTime(recording, atTimeMs);
      let topoPeak = topo.electrodeValues[0];
      for (const e of topo.electrodeValues) {
        if (Math.abs(e.valueUv) > Math.abs(topoPeak.valueUv)) topoPeak = e;
      }
      const fwd = forwardHeadPotential(fixture, [0, 0, 16], [0, 10, 0], { mode: 'average' });
      let fwdPeakIdx = 0;
      for (let i = 0; i < fwd.valueUv.length; i++) {
        if (Math.abs(fwd.valueUv[i]) > Math.abs(fwd.valueUv[fwdPeakIdx])) fwdPeakIdx = i;
      }
      return done(
        [
          { label: '地形峰值电位', value: topoPeak.valueUv, unit: 'µV' },
          { label: '正向峰值电位', value: fwd.valueUv[fwdPeakIdx], unit: 'µV' },
        ],
        `地形（实测记录 ${atTimeMs} ms，球面样条插值）峰值电极 ${topoPeak.label}；` +
          `正向（已知源 [0,0,16] mm 直接求值）峰值电极 ${fwd.labels[fwdPeakIdx]}；` +
          '两张图数据来源不同：2D 图是记录值的插值，3D 图是 L·q 的直接求值。',
      );
    }
    case 11: {
      const fixture = requireFixture(ctx, 11);
      const result = blindTest(fixture, '10-20', [16, 16, 16], [0, 10, 0], {
        noiseRmsUv: 0, seed: 7, lambda2: 1 / 9, mneNoiseRmsUv: 1.0,
      });
      return done(
        [
          { label: '偶极子拟合定位误差', value: result.dipole.localizationErrorMm, unit: 'mm' },
          { label: 'MNE 定位误差', value: result.mne.localizationErrorMm, unit: 'mm' },
          { label: '偶极子拟合残差 RMS', value: result.dipoleResidualRmsUv, unit: 'µV' },
        ],
        '盲测：逆解只读 lead-field + 电位数据，真值只在事后算误差；无噪声，种子 7。',
      );
    }
    case 12: {
      const { comparison } = runAB(
        { durationMs: 2000, events: [{ tMs: 1000, durationMs: 100, drivePerS: 120 }] },
        { durationMs: 2000, events: [{ tMs: 1000, durationMs: 100, drivePerS: 300 }] },
      );
      return done(
        [
          { label: 'y0 峰值差（B−A）', value: comparison.peakY0DiffMv, unit: 'mV' },
          { label: 'Pz RMS 差（B−A）', value: comparison.rmsEegDiffUv, unit: 'µV' },
          { label: 'ERP 峰差（B−A）', value: comparison.erpPeakDiffUv, unit: 'µV' },
        ],
        '双脑 A/B：同一 JR 柱、同一时长与事件时刻，只改事件驱动 120 vs 300 1/s。',
      );
    }
    case 13: {
      const trace = simulateHodgkinHuxley(DEFAULT_HH_PARAMS, 200, (t) => (t >= 10 && t < 60 ? 10 : 0));
      const peakV = Math.max(...trace.vMv);
      return done(
        [
          { label: '动作电位数', value: trace.spikeTimesMs.length, unit: '个' },
          { label: '膜电位峰值', value: peakV, unit: 'mV' },
          { label: '首个锋电位', value: trace.spikeTimesMs.length > 0 ? trace.spikeTimesMs[0] : NaN, unit: 'ms' },
        ],
        'Hodgkin–Huxley 1952 标准参数，静息 −65 mV；10 µA/cm² 阶跃 10–60 ms。',
      );
    }
    case 14: {
      const sensors = demoSphereSensors(90);
      const s10 = sensors.find((s) => s.label === 'S10');
      if (!s10) throw new Error('Scenario 14: S10 sensor missing');
      const keyNumbers: KeyNumber[] = [];
      for (const sigma of [0.1, 0.33, 1] as const) {
        const v = potentialMicrovolts(
          { positionMm: [0, 0, 0], momentNAm: [10, 0, 0] }, s10.positionMm, sigma,
        );
        keyNumbers.push({ label: `σ=${sigma.toFixed(2)} S/m 时 S10 电位`, value: v, unit: 'µV' });
      }
      return done(
        keyNumbers,
        '均匀无限导体解析公式 V = p·r / (4πσ|r|³)，电位与 1/σ 成正比；传感器 S10 在 [90,0,0] mm（示意传感器，非 10-20 电极）。',
      );
    }
    case 15: {
      const base = { durationMs: 3000, events: [{ tMs: 1000, durationMs: 100, drivePerS: 300 }] };
      const cl = {
        feature: { kind: 'instant' as const },
        controller: 'threshold' as const,
        threshold: { threshold: 0.1, outputPerS: -80 },
        delayMs: 0,
        measurementNoiseRmsUv: 0.02,
        noiseSeed: 7,
      };
      const cmp = compareControlVsNoControl(base, cl);
      return done(
        [
          { label: '触发占比', value: cmp.triggerFraction, unit: '' },
          { label: '有控制 vs 无控制 Pz RMS 差', value: cmp.rmsEegDiffUv, unit: 'µV' },
          { label: '有控制 vs 无控制 Pz 峰值差', value: cmp.peakEegDiffUv, unit: 'µV' },
          { label: '无控制 Pz RMS', value: cmp.noControl.metrics.rmsEegUv, unit: 'µV' },
        ],
        '阈值闭环（特征 instant，阈值 0.1 µV，触发输出 −80 1/s，延迟 0 ms，测量噪声 0.02 µV）；仅模拟环境，不控制人体设备。',
      );
    }
    default:
      throw new RangeError(`runScenarioCompute: no compute path for scenario ${id}`);
  }
}
