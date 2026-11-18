/**
 * Phase 1 闭环实验台 — 协议引擎（`implementation-plan.md` §1.4）。
 *
 * 客户端调度器，不写新 Worker 消息。调度按快照 `t_ms`（模型时钟）
 * 触发，不用墙钟 `setTimeout` 定刺激时间；刺激真正的时间以 Worker
 * ACK 为准（见 `confirmFromMarkers`）。
 *
 * 协议：
 * - single-pulse：开始时发一次，随后 `running = false` 并发
 *   `protocol-stopped`（reason `'completed'`）。
 * - oddball：ISI 默认 1000 ms；每第 5 个试次为 oddball（与
 *   `runOddballExperiment` 同口径：`(k + 1) % 5 === 0`，见
 *   `lib/lateResponse.ts`）；standard 幅度默认 1.0、oddball 幅度
 *   默认 2.0；节点默认听觉节点（经 `sensoryTargetNodes(regions,
 *   'auditory')`，即 lA1/rA1，取第一个）。
 * - flicker：周期 `1000 / frequencyHz` ms，每个周期给视觉节点
 *   （`sensoryTargetNodes(regions, 'visual')`，lV1/rV1）各发一次
 *   脉冲；频率默认 10 Hz（范围 1–30）；幅度直接给 0.5–2.0
 *   （默认 1.0），不另搞 intensity→amplitude 的隐藏换算。
 * - closed-loop：`start` 时调 `configureFeedback(config)` 直通
 *   `set_native_feedback`，`tick` 不做事；反馈的 detected/applied
 *   由组件经 `subscribeNativeFeedback` / `getNativeFeedback` 读到后
 *   经公开方法 `emitFeedbackEvent(e)` 转进来。
 *
 * 脉冲幅度与时长走 `pulseAt` 的客户端钳制（幅度 [-2, 2]、时长
 * [20, 500] ms，与 `SimClient.pulseAt` 一致）；引擎在调用前同样
 * 钳制一次，保证假 `pulseAt` 也能看到钳制后的值。
 *
 * 响应锚定：`SimClient.pulseAt()` 返回 void、没有 `command_id`，
 * 所以 ACK 匹配用“节点 + 最近 tMs”：引擎发刺激时记
 * `{localId, node, provisionalTms, rtMs}`，`confirmFromMarkers`
 * 在 markers 里找同节点、且 `t_ms ∈ [provisionalTms - 20,
 * provisionalTms + 500]` 的 marker；找到且 `t_ms` 已被 ACK 修正
 * （与 provisional 不同）→ 在 `marker.t_ms + rtMs` 处发 `response`
 * 事件（`confirmed: true`）；500 ms 模型时间后仍未修正 → 用
 * provisional 时间 + RT 发 `response`（`confirmed: false`）；
 * 超过 500 ms 仍无 marker → 丢弃该次响应并计数
 * （`droppedResponses` 只读）。
 */
import type { NativeFeedbackConfig } from './nativeFeedback.ts';
import type { StimulusMarker } from './simClient.ts';
import { sensoryTargetNodes } from './eegRecording.ts';
import type { createSimulatedSubject } from './benchSubject.ts';

export type BenchProtocolId = 'single-pulse' | 'oddball' | 'flicker' | 'closed-loop';

export interface BenchProtocolParams {
  'single-pulse': { node: number; amplitude?: number; durationMs?: number };
  oddball: {
    node?: number;
    standardAmplitude?: number;
    oddballAmplitude?: number;
    isiMs?: number;
    oddballEvery?: number;
    durationMs?: number;
  };
  flicker: {
    nodes?: number[];
    frequencyHz?: number;
    amplitude?: number;
    durationMs?: number;
  };
  'closed-loop': NativeFeedbackConfig;
}

export interface BenchProtocolEvent {
  kind: 'protocol-started' | 'stimulus-sent' | 'response' | 'feedback-detected' | 'feedback-applied' | 'protocol-stopped';
  tMs: number;
  trialIndex?: number;
  condition?: 'standard' | 'oddball';
  node?: number;
  amplitude?: number;
  durationMs?: number;
  rtMs?: number;
  confirmed?: boolean;
  reason?: string;
}

export interface BenchProtocolEngine {
  start(protocol: BenchProtocolId, params: BenchProtocolParams[BenchProtocolId], startTms: number): void;
  tick(tMs: number): void;
  confirmFromMarkers(markers: readonly StimulusMarker[]): void;
  stop(reason?: string): void;
  /** 组件把从 `subscribeNativeFeedback` 读到的反馈转成协议事件时调。 */
  emitFeedbackEvent(e: BenchProtocolEvent): void;
  readonly running: boolean;
  readonly protocol: BenchProtocolId | null;
  readonly trialIndex: number;
  readonly droppedResponses: number;
}

export interface BenchProtocolDeps {
  pulseAt: (node: number, amplitude: number, durationMs: number) => void;
  configureFeedback: (config: NativeFeedbackConfig | null) => void;
  subject: ReturnType<typeof createSimulatedSubject>;
  onEvent: (e: BenchProtocolEvent) => void;
  /** 脑区表（`data.regions`），用于解析感觉靶节点；不传则协议参数必须显式给节点。 */
  regions?: ReadonlyArray<{ label: string }>;
}

const clampAmplitude = (a: number): number => Math.min(2, Math.max(-2, a));
const clampDurationMs = (d: number): number => Math.min(500, Math.max(20, d));

const assertNode = (node: number): void => {
  if (!Number.isInteger(node) || node < 0 || node > 75) {
    throw new RangeError(`benchProtocol: node must be an integer in [0, 75], got ${node}`);
  }
};

interface PendingResponse {
  localId: number;
  node: number;
  provisionalTms: number;
  rtMs: number;
  trialIndex: number;
  /** 已在 markers 里看到同节点事件，但 t_ms 尚未被 ACK 修正（仍等于 provisional）。 */
  markerSeen: boolean;
}

export function createBenchProtocolEngine(deps: BenchProtocolDeps): BenchProtocolEngine {
  let running = false;
  let protocol: BenchProtocolId | null = null;
  let trialIndex = 0;
  let droppedResponses = 0;
  let startTms = 0;
  let lastTms = 0;
  let nextTimeMs = 0;
  let durationMs: number | undefined;
  let localIdSeq = 0;
  const pending: PendingResponse[] = [];

  // 当前协议的发刺激参数（start 时冻结）。
  let oddballNode = 0;
  let oddballStandardAmp = 1.0;
  let oddballAmp = 2.0;
  let oddballIsiMs = 1000;
  let oddballEvery = 5;
  let oddballDurationMs = 100;
  let flickerNodes: number[] = [];
  let flickerPeriodMs = 100;
  let flickerAmp = 1.0;
  let flickerDurationMs = 100;

  const stopInternal = (reason: string): void => {
    if (!running) return;
    running = false;
    if (protocol === 'closed-loop') deps.configureFeedback(null);
    deps.onEvent({ kind: 'protocol-stopped', tMs: lastTms, reason });
  };

  /** 500 ms 模型时间后仍未被 ACK 修正的待定响应：有 marker 则按 provisional 发未确认响应，无 marker 则丢弃计数。 */
  const resolveOverduePending = (tMs: number): void => {
    for (let j = pending.length - 1; j >= 0; j--) {
      const p = pending[j];
      if (p.provisionalTms + 500 <= tMs) {
        pending.splice(j, 1);
        if (p.markerSeen) {
          deps.onEvent({
            kind: 'response', tMs: p.provisionalTms + p.rtMs, trialIndex: p.trialIndex,
            condition: 'oddball', node: p.node, rtMs: p.rtMs, confirmed: false,
          });
        } else {
          droppedResponses++;
        }
      }
    }
  };

  const fireOddballTrial = (scheduledTms: number): void => {
    trialIndex++;
    const isOddball = trialIndex % oddballEvery === 0;
    const amplitude = clampAmplitude(isOddball ? oddballAmp : oddballStandardAmp);
    deps.pulseAt(oddballNode, amplitude, oddballDurationMs);
    deps.onEvent({
      kind: 'stimulus-sent', tMs: scheduledTms, trialIndex,
      condition: isOddball ? 'oddball' : 'standard',
      node: oddballNode, amplitude, durationMs: oddballDurationMs,
    });
    if (isOddball) {
      const resp = deps.subject.nextOddballResponse(trialIndex, scheduledTms);
      pending.push({
        localId: ++localIdSeq, node: oddballNode, provisionalTms: scheduledTms,
        rtMs: resp.rtMs, trialIndex, markerSeen: false,
      });
    }
  };

  const fireFlickerCycle = (scheduledTms: number): void => {
    trialIndex++;
    for (const node of flickerNodes) {
      deps.pulseAt(node, flickerAmp, flickerDurationMs);
      deps.onEvent({
        kind: 'stimulus-sent', tMs: scheduledTms, trialIndex,
        node, amplitude: flickerAmp, durationMs: flickerDurationMs,
      });
    }
  };

  return {
    start(p: BenchProtocolId, params: BenchProtocolParams[BenchProtocolId], startT: number): void {
      if (running) throw new Error('benchProtocol: a protocol is already running; stop() it first');
      if (!Number.isFinite(startT) || startT < 0) {
        throw new RangeError(`benchProtocol: invalid startTms ${startT}`);
      }
      protocol = p;
      startTms = startT;
      lastTms = startT;
      nextTimeMs = startT;
      trialIndex = 0;
      durationMs = undefined;
      pending.length = 0;

      if (p === 'single-pulse') {
        const sp = params as BenchProtocolParams['single-pulse'];
        assertNode(sp.node);
        const amplitude = clampAmplitude(sp.amplitude ?? 1.0);
        const dur = clampDurationMs(sp.durationMs ?? 100);
        running = true;
        deps.onEvent({ kind: 'protocol-started', tMs: startT });
        trialIndex = 1;
        deps.pulseAt(sp.node, amplitude, dur);
        deps.onEvent({
          kind: 'stimulus-sent', tMs: startT, trialIndex: 1,
          node: sp.node, amplitude, durationMs: dur,
        });
        stopInternal('completed');
        return;
      }
      if (p === 'oddball') {
        const op = params as BenchProtocolParams['oddball'];
        oddballStandardAmp = op.standardAmplitude ?? 1.0;
        oddballAmp = op.oddballAmplitude ?? 2.0;
        oddballIsiMs = op.isiMs ?? 1000;
        oddballEvery = op.oddballEvery ?? 5;
        oddballDurationMs = clampDurationMs(op.durationMs ?? 100);
        durationMs = op.durationMs;
        if (!(oddballIsiMs > 0)) throw new RangeError(`benchProtocol: isiMs must be > 0, got ${oddballIsiMs}`);
        if (!Number.isInteger(oddballEvery) || oddballEvery < 1) {
          throw new RangeError(`benchProtocol: oddballEvery must be an integer >= 1, got ${oddballEvery}`);
        }
        if (![oddballStandardAmp, oddballAmp].every(Number.isFinite)) {
          throw new RangeError('benchProtocol: oddball amplitudes must be finite');
        }
        if (op.node !== undefined) {
          assertNode(op.node);
          oddballNode = op.node;
        } else {
          const auditory = deps.regions ? sensoryTargetNodes(deps.regions, 'auditory') : [];
          if (auditory.length === 0) {
            throw new Error('benchProtocol: oddball needs an explicit node or regions with auditory targets (lA1/rA1)');
          }
          oddballNode = auditory[0];
        }
      } else if (p === 'flicker') {
        const fp = params as BenchProtocolParams['flicker'];
        const frequencyHz = fp.frequencyHz ?? 10;
        if (!Number.isFinite(frequencyHz) || frequencyHz < 1 || frequencyHz > 30) {
          throw new RangeError(`benchProtocol: frequencyHz must be in [1, 30], got ${frequencyHz}`);
        }
        flickerPeriodMs = 1000 / frequencyHz;
        flickerAmp = clampAmplitude(fp.amplitude ?? 1.0);
        flickerDurationMs = clampDurationMs(fp.durationMs ?? 100);
        durationMs = fp.durationMs;
        if (fp.nodes !== undefined) {
          fp.nodes.forEach(assertNode);
          flickerNodes = [...fp.nodes];
        } else {
          const visual = deps.regions ? sensoryTargetNodes(deps.regions, 'visual') : [];
          if (visual.length === 0) {
            throw new Error('benchProtocol: flicker needs explicit nodes or regions with visual targets (lV1/rV1)');
          }
          flickerNodes = visual;
        }
        if (flickerNodes.length === 0) throw new RangeError('benchProtocol: flicker needs at least one node');
      } else {
        // closed-loop：配置直通 Worker 的 NativeFeedback 控制器。
        deps.configureFeedback(params as NativeFeedbackConfig);
      }
      running = true;
      deps.onEvent({ kind: 'protocol-started', tMs: startT });
    },

    tick(tMs: number): void {
      if (!running || protocol === null) return;
      if (!Number.isFinite(tMs)) throw new RangeError(`benchProtocol: invalid tick tMs ${tMs}`);
      lastTms = tMs;
      if (protocol === 'closed-loop') return;
      resolveOverduePending(tMs);
      if (!running) return;
      const endMs = durationMs === undefined ? Infinity : startTms + durationMs;
      if (protocol === 'oddball') {
        while (nextTimeMs <= tMs && nextTimeMs < endMs) {
          fireOddballTrial(nextTimeMs);
          nextTimeMs += oddballIsiMs;
        }
      } else if (protocol === 'flicker') {
        while (nextTimeMs <= tMs && nextTimeMs < endMs) {
          fireFlickerCycle(nextTimeMs);
          nextTimeMs += flickerPeriodMs;
        }
      }
      if (durationMs !== undefined && tMs >= startTms + durationMs) {
        stopInternal('completed');
      }
    },

    confirmFromMarkers(markers: readonly StimulusMarker[]): void {
      if (!running && pending.length === 0) return;
      const used = new Set<StimulusMarker>();
      for (let j = pending.length - 1; j >= 0; j--) {
        const p = pending[j];
        const marker = markers.find(
          (m) =>
            !used.has(m) &&
            m.node === p.node &&
            m.t_ms >= p.provisionalTms - 20 &&
            m.t_ms <= p.provisionalTms + 500,
        );
        if (!marker) continue;
        used.add(marker);
        if (marker.t_ms !== p.provisionalTms) {
          // Worker ACK 已修正刺激时间：响应锚定到修正后的时间。
          pending.splice(j, 1);
          deps.onEvent({
            kind: 'response', tMs: marker.t_ms + p.rtMs, trialIndex: p.trialIndex,
            condition: 'oddball', node: p.node, rtMs: p.rtMs, confirmed: true,
          });
        } else {
          // marker 在，但时间仍是 dispatch 时的 provisional 值：等 500 ms
          // 期限到时再按 provisional 发未确认响应（见 tick）。
          p.markerSeen = true;
        }
      }
    },

    stop(reason = 'stopped'): void {
      stopInternal(reason);
    },

    emitFeedbackEvent(e: BenchProtocolEvent): void {
      if (running && protocol === 'closed-loop') deps.onEvent(e);
    },

    get running(): boolean {
      return running;
    },
    get protocol(): BenchProtocolId | null {
      return protocol;
    },
    get trialIndex(): number {
      return trialIndex;
    },
    get droppedResponses(): number {
      return droppedResponses;
    },
  };
}
