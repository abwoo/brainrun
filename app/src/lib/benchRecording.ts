/**
 * Phase 1 闭环实验台 — 台子的一份记录（`implementation-plan.md` §1.6）。
 *
 * 复用：`runNativeExperiment`（Raw，250/500 Hz，原生 1 ms）、
 * `epochRecording`（切试次）、`LiveRecordingStoreValue` +
 * `setLiveRecordingStore`（单槽 store，runId 一致性由它强制执行）。
 * 不新写记录类型。
 *
 * 组装规则：
 * - `extraEvents` 的 `tMs` 是绝对 Worker ms；组装时换算成记录相对
 *   时间（`tMs - t0Ms`），并全部盖上同一个 `runId`。`runId` 取
 *   `session.provenance.runId`；`native.recording` 已带 provenance
 *   且 runId 与 session 不一致时抛错，不静默混用；`extraEvents`
 *   里自带 runId 且与该 runId 不一致时同样抛错。
 * - 事件按 `tMs` 排序后重排 `id`（0 起连续）；epochs 只围绕
 *   `type: 'pulse'` 的触发事件切（`epochRecording(rec, events,
 *   -200, 800, [-200, 0])`，与现有 ERP 口径一致），response 事件
 *   只进事件表、不做切分锚点。
 * - `recording.experiment = { session, parameters: { protocol,
 *   amplifier, cap, headModel, ... } }`，按
 *   `EegAnalysisLab.tsx:279-320` 的组装方式写；调用方传进来的
 *   `session` 是派生会话快照（调用方按 EegAnalysisLab 的做法先用
 *   `makeDerivedSession` 从上游会话派生）；`provenance.upstreamStartMs
 *   = t0Ms`。
 * - 增益：只记在采集元数据里（`experiment.parameters.amplifier`），
 *   不许乘进 `dataUv`；UI 显示的“放大器输出 µV” = 参考后 × 增益。
 * - 参考切换：用 `reReferenceRecording`（无损重算），不要自己写
 *   参考变换。切换后 `epochs.dataRevision` 与 `epochs.provenance`
 *   会同步盖章，否则 `setLiveRecordingStore` 会以“过期分段”拒收。
 */
import type { EegRecording, EegEvent, EpochSet, EegReference } from './eegData.ts';
import type { ExperimentSessionSnapshot } from './experimentSession.ts';
import { epochRecording } from './signalProcessing.ts';
import { reReferenceRecording, type LiveRecordingStoreValue } from './eegRecording.ts';
import type { BenchProtocolId } from './benchProtocol.ts';
import type { BenchCapSelection } from './benchCap.ts';

export interface AmplifierConfig {
  sampleRateHz: 250 | 500;
  reference: EegReference;
  bandpass: { lowHz: number; highHz: number } | null;
  gain: number;
}

export interface BenchRecording {
  recording: EegRecording;
  events: EegEvent[];
  epochs: EpochSet | null;
  runId: string;
  protocol: BenchProtocolId | null;
  amplifier: AmplifierConfig;
  cap: BenchCapSelection;
  headModel: 'sphere' | 'bem';
}

export interface AssembleBenchRecordingInput {
  native: {
    recording: EegRecording;
    events: EegEvent[];
    t0Ms: number;
    sourcePositionMm: number[];
  };
  /** triggers + responses，绝对模型时间（tMs 为 Worker ms）。 */
  extraEvents: EegEvent[];
  /** 派生会话快照（调用方按 EegAnalysisLab 的做法派生，见模块文档）。 */
  session: ExperimentSessionSnapshot;
  protocol: BenchProtocolId | null;
  amplifier: AmplifierConfig;
  cap: BenchCapSelection;
  headModel: 'sphere' | 'bem';
}

const sameReference = (a: EegReference, b: EegReference): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export function assembleBenchRecording(input: AssembleBenchRecordingInput): BenchRecording {
  const { native, session } = input;
  const runId = session.provenance.runId;
  const nativeRunId = native.recording.provenance?.runId;
  if (nativeRunId !== undefined && nativeRunId !== runId) {
    throw new Error(
      `assembleBenchRecording: native recording runId ${nativeRunId} does not match session runId ${runId}`,
    );
  }
  for (const ev of input.extraEvents) {
    if (ev.runId !== undefined && ev.runId !== runId) {
      throw new Error(
        `assembleBenchRecording: extra event runId ${ev.runId} does not match session runId ${runId}`,
      );
    }
  }
  if (!Number.isFinite(input.amplifier.gain) || input.amplifier.gain <= 0) {
    throw new RangeError(`assembleBenchRecording: amplifier gain must be positive, got ${input.amplifier.gain}`);
  }

  // 参考切换：无损重算，不自己写参考变换。增益不乘进 dataUv。
  let rec = native.recording;
  if (!sameReference(rec.reference, input.amplifier.reference)) {
    rec = reReferenceRecording(rec, input.amplifier.reference);
  }
  rec = {
    ...rec,
    experiment: {
      session,
      parameters: {
        protocol: input.protocol,
        amplifier: input.amplifier,
        cap: input.cap,
        headModel: input.headModel,
        node: rec.nativeSource?.node,
        physicalProjection: rec.physicalProjection,
        nativeSource: rec.nativeSource,
        montage: rec.montage,
        reference: rec.reference,
        noise: rec.noise,
        seed: rec.seed,
        sfreqHz: rec.sfreqHz,
        acquisition: rec.acquisition,
      },
    },
    provenance: { ...(rec.provenance ?? session.provenance), upstreamStartMs: input.native.t0Ms },
  };

  // 事件：native 事件已是相对时间；extraEvents 是绝对 Worker ms，换算。
  const events: EegEvent[] = [
    ...native.events.map((e) => ({ ...e, runId })),
    ...input.extraEvents.map((e) => ({ ...e, tMs: e.tMs - input.native.t0Ms, runId })),
  ]
    .sort((a, b) => a.tMs - b.tMs)
    .map((e, j) => ({ ...e, id: j }));

  // epochs 只锚定 pulse 事件；response 事件只进事件表。
  const pulseEvents = events.filter((e) => e.type === 'pulse');
  let epochs: EpochSet | null = null;
  if (pulseEvents.length > 0) {
    const cut = epochRecording(rec, pulseEvents, -200, 800, [-200, 0]);
    epochs = {
      ...cut,
      dataRevision: rec.dataRevision ?? 0,
      provenance: rec.provenance,
    };
  }

  return {
    recording: rec,
    events,
    epochs,
    runId,
    protocol: input.protocol,
    amplifier: input.amplifier,
    cap: input.cap,
    headModel: input.headModel,
  };
}

export function benchRecordingToStoreValue(br: BenchRecording): LiveRecordingStoreValue {
  return { recording: br.recording, events: br.events, epochs: br.epochs };
}
