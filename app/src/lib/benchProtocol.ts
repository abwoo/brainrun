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
 * - 两个量不要混成一个字段：`durationMs` 是整轮协议的运行时长
 *   （不传 = 一直跑到 `stop()`），`pulseDurationMs` 是每次刺激
 *   的脉冲时长（默认 100 ms）。2026-11-18 之前台子把 UI 上的
 *   “刺激时长”（100 ms）直接传进 `durationMs`，oddball/flicker
 *   每轮只跑 100 ms、只发 1 个试次就 `completed`，永远到不了
 *   trial 5、永远没有受试者响应；此后调用方必须把两者分开传。
 * - closed-loop：`start` 时调 `configureFeedback(config)` 直通
 *   `set_native_feedback`，`tick` 不做事；反馈的 detected/applied
 *   由组件经 `subscribeNativeFeedback` / `getNativeFeedback` 读到后
 *   经公开方法 `emitFeedbackEvent(e)` 转进来。
 *
 * 脉冲幅度与时长走 `pulseAt` 的客户端钳制（幅度 [-2, 2]、时长
 * [20, 500] ms，与 `SimClient.pulseAt` 一致）；引擎在调用前同样
 * 钳制一次，保证假 `pulseAt` 也能看到钳制后的值。
 *
 * 响应锚定：`SimClient.pulseAt()` 返回本次刺激的 marker 对象（与
 * Worker ACK 原地修正 `t_ms` 的是同一引用），引擎发刺激时就把它记
 * 在 `PendingResponse.marker` 里；`confirmFromMarkers` 凭引用认自己
 * 的 marker——ACK 修正到 provisional + 600 ms、第一次确认才看到时
 * 也能锚到修正时间，不会丢。引用丢了（marker 离开 50 条数组）时
 * 回退到“节点 + 最近 tMs”窗口匹配：`t_ms ∈ [provisionalTms - 20,
 * provisionalTms + 500]`；找到且 `t_ms` 已被 ACK 修正（与 provisional
 * 不同）→ 在 `marker.t_ms + rtMs` 处发 `response` 事件（`confirmed: true`）；
 * 500 ms 模型时间后仍未修正 → 用 provisional 时间 + RT 发 `response`
 * （`confirmed: false`）；超过 500 ms 仍无 marker → 丢弃该次响应并计数
 * （`droppedResponses` 只读）。
 *
 * Phase 4 — 慢 ACK（修正晚于 +500 ms，headless 下实测可达约 600 ms）：
 * 发刺激时 `pulseAt` 直接返回 marker 对象并记在 `PendingResponse.marker`
 * 里，`confirmFromMarkers` 第一次确认就凭引用认出它、锚到修正时间，
 * 不用等先看到 provisional marker 再记引用；SimClient 的 marker 对象
 * 在数组里是同一引用，ACK 到达时原地改 t_ms，所以后续
 * `confirmFromMarkers` 凭引用认出自己的 marker、锚到修正时间，
 * 不会套住邻试次的 marker；markerSeen 的待定响应宽限到
 * `+LATE_ACK_GRACE_MS`（2000 ms）才按 provisional 发未确认响应，
 * 无 marker 的仍在 +500 ms 丢弃。另见 `findAckMarker`（手动刺激的 ACK
 * 匹配，同样只认修正过的 marker）。
 *
 * `provisionalTms` 是发刺激那次 `tick()` 的模型时间（即 marker
 * 被创建时的快照时间），不是试次的计划时间：`pulseAt` 调用的
 * marker 以调用时的快照时间创建。Phase 3 之前 `tick()` 被延迟时
 * 一次可发出多个试次、它们的 marker 都是同一个 tick 时间；若按
 * 计划时间匹配，窗口会套住上一个试次 ACK 后的 marker，响应就锚
 * 到错的试次上（2026-11-18 预览实测：trial 5 的响应锚到了 trial 4
 * 的 marker，响应−触发只有 242 ms）。Phase 3 起去重：一次 tick
 * 最多发一个试次（最新到期的那一个），其余记为跳过（`skippedTrials`
 * + `trial-skipped` 事件），永不突发连发；响应仍按 dispatch 时间
 * 锚定（见 `confirmFromMarkers`）。`stimulus-sent` 事件的
 * `tMs` 仍是计划时间（协议时间线），不受此影响。
 *
 * Phase 3 回路时延（模型 ms，见 `BenchLoopTiming` / `LOOP_TIMING_BOUNDS`）：
 * - trigger→command：闭环动作 `applyMs − detectedMs`（应恒等于
 *   `delayMs + 1`，按 action id 配对实测，不假设）；
 * - dispatch→ACK：ACK 修正后的 `marker.t_ms − provisionalTms`；
 * - observation lag：收到 applied 事件时客户端最新快照 `tMs − applyMs`
 *  （客户端视图落后多少；可为负，表示快照还没走到施加时刻）。
 * 三者都由 `getLoopTiming()` 读出（最新值 + 各自样本数），供控制条读数。
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
    /** 整轮运行时长（ms）；不传 = 一直跑到 stop()。不是脉冲时长。 */
    durationMs?: number;
    /** 每次刺激的脉冲时长（ms），默认 100；不传时回退到 durationMs（旧调用兼容）。 */
    pulseDurationMs?: number;
  };
  flicker: {
    nodes?: number[];
    frequencyHz?: number;
    amplitude?: number;
    /** 整轮运行时长（ms）；不传 = 一直跑到 stop()。不是脉冲时长。 */
    durationMs?: number;
    /** 每次刺激的脉冲时长（ms），默认 100；不传时回退到 durationMs（旧调用兼容）。 */
    pulseDurationMs?: number;
  };
  'closed-loop': NativeFeedbackConfig;
}

export interface BenchProtocolEvent {
  kind: 'protocol-started' | 'stimulus-sent' | 'response' | 'feedback-detected' | 'feedback-applied' | 'feedback-suppressed' | 'trial-skipped' | 'protocol-stopped';
  tMs: number;
  /** 发刺激那次 tick/start 的快照时间（模型 ms）：marker 创建时的
   * provisional t_ms，与 tMs（计划时间）不同——命令日志凭它做 ACK
   * 匹配（见 findAckMarker），否则 provisional marker 会被误认成
   * 已确认。仅 'stimulus-sent'。 */
  dispatchTms?: number;
  /** 本次刺激的 marker 对象（pulseAt 返回值，与 SimClient 数组里
   * 同一引用）：命令日志凭引用确认 ACK，不会套住邻试次的 marker。
   * 假 pulseAt 不返回值时为 undefined，调用方回退到窗口匹配。
   * 仅 'stimulus-sent'。 */
  marker?: StimulusMarker;
  trialIndex?: number;
  condition?: 'standard' | 'oddball';
  node?: number;
  amplitude?: number;
  durationMs?: number;
  rtMs?: number;
  confirmed?: boolean;
  reason?: string;
  /** 本次 tick 因去重跳过的试次数（仅 'trial-skipped'）。 */
  skippedCount?: number;
  /** 闭环动作 id（仅 feedback-detected / feedback-applied）：配对 trigger→command 用。 */
  actionId?: number;
  /** 闭环动作的 Worker 检出 / 施加时刻（模型 ms，仅 feedback-detected / feedback-applied）。 */
  detectedMs?: number;
  applyMs?: number;
  /** 收到 applied 事件时客户端最新快照的 tMs（模型 ms）：算 observation lag 用。 */
  observedAtTms?: number;
  /** 累计被冷却抑制的次数（仅 'feedback-suppressed'，取自 Worker 快照）。 */
  suppressedCount?: number;
  /** 最后一次被抑制的特征值（仅 'feedback-suppressed'）。 */
  suppressedValue?: number;
}

/**
 * Phase 3 回路时延（全部模型 ms；null = 该指标尚未测到样本）。
 * triggerToCommandMs 应恒等于动作的 delayMs + 1（Worker 侧调度保证，
 * 这里按 action id 配对实测，不假设）；dispatchToAckMs 与 observationLagMs
 * 的门见 `LOOP_TIMING_BOUNDS`（由 60 Hz 快照间隔 ≈16.7 ms 推导，见该处注释）。
 */
export interface BenchLoopTiming {
  triggerToCommandMs: number | null;
  dispatchToAckMs: number | null;
  observationLagMs: number | null;
  /** 最后一次测到 trigger→command 的动作 id（null = 未测到）。 */
  lastActionId: number | null;
  /** 各指标已测样本数（0 = 未测到）。 */
  samples: { triggerToCommand: number; dispatchToAck: number; observationLag: number };
}

/**
 * Phase 3 时延门（模型 ms）。推导：Worker 快照 60 Hz，间隔 ≈16.7 ms；
 * dispatch→ACK 是“客户端最新快照 → Worker 受理命令”的往返，正常不超过
 * 一个快照间隔加 postMessage 往返，门限 100 ms ≈ 6 个间隔；observation lag
 * 是 applied 上报时刻客户端快照与施加时刻之差，正常在 ±一个快照间隔内，
 * 门限 |lag| ≤ 50 ms ≈ 3 个间隔。trigger→command 不设区间门——它必须精确
 * 等于 delayMs + 1，测试里按动作对断言。
 */
export const LOOP_TIMING_BOUNDS = {
  dispatchToAckMaxMs: 100,
  observationLagMaxAbsMs: 50,
} as const;

/**
 * 协议状态文案（2026-11-19 修：停过的协议此前误标“已暂停”）。
 *
 * 协议运行/停止与全局暂停是两层状态（见合同 §1.15 协议引擎行）：
 * 顶栏“暂停/继续”停的是整个仿真，运行/停止只管当前协议。旧文案只看
 * `protocolRunning`，停过的协议也显示“已暂停”，用户会以为顶栏的
 * “恢复”（实为恢复脉冲基线快照，`App.tsx handleRestoreSnapshot`）
 * 能续跑协议——它不能，续跑只能点“运行协议”。所以状态分四态：
 * - running：协议在跑、全局未暂停 → “运行中”
 * - paused：协议在跑、全局已暂停（模型时钟冻住）→ “已暂停”
 * - stopped：协议不在跑、但本协议已跑过（手动停止或 single-pulse
 *   发完自动停止）→ “已停止”
 * - not-started：本协议从未跑过 → “未开始”
 * `everStarted` 由组件在 `runProtocol` 置真、换协议时清零（下拉在
 * 运行中禁用，所以换协议时协议一定不在跑，清零安全）。
 */
export type BenchProtocolStatusKey = 'running' | 'paused' | 'stopped' | 'not-started';

export function protocolStatusKey(
  running: boolean,
  paused: boolean,
  everStarted: boolean,
): BenchProtocolStatusKey {
  if (running) return paused ? 'paused' : 'running';
  return everStarted ? 'stopped' : 'not-started';
}

/**
 * Phase 4 — 慢 ACK 宽限（模型 ms）：marker 已出现但尚未被 Worker 修正
 * 时，响应不在 +500 ms 期限到时按 provisional 发未确认响应，而是等到
 * 该硬上限；修正后的 marker 在此期间仍可被认到（见 confirmFromMarkers
 * 的引用匹配）。2000 ms 覆盖 headless 下实测的最慢 ACK（P3：约 579–672 ms），
 * 留有余量；超过它仍未修正，才按 provisional 发未确认响应。
 */
export const LATE_ACK_GRACE_MS = 2000;

/**
 * Phase 4 — 手动刺激的 ACK 匹配（stimLog 用）：只认 Worker 修正过的 marker。
 * marker 创建时 t_ms == dispatch 时的客户端快照时间；Worker ACK 后 t_ms
 * 被原地改成 Worker 受理时间。provisional marker（t_ms 仍等于 dispatchTms）
 * 不能算确认——否则点击后第一次轮询就“确认”，ackTms 还是点击时间，
 * 与“ACK 时间以 Worker 为准”矛盾。例外：ACK 恰好修正到 dispatchTms
 * 本身时无法区分，条目保持未确认（极少见：dispatch 快照至多滞后约 16 ms）。
 */
export function findAckMarker(
  markers: readonly StimulusMarker[],
  node: number,
  dispatchTms: number,
): StimulusMarker | undefined {
  return markers.find(
    (m) =>
      m.kind === 'pulse' &&
      m.node === node &&
      m.t_ms !== dispatchTms &&
      m.t_ms >= dispatchTms - 20 &&
      m.t_ms <= dispatchTms + 500,
  );
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
  /** Phase 3 — 本轮因去重跳过的试次总数（一次 tick 最多发一个试次）。 */
  readonly skippedTrials: number;
  /** Phase 3 — 回路时延最新值（`BenchLoopTiming`，每次调用返回新对象）。 */
  getLoopTiming(): BenchLoopTiming;
}

export interface BenchProtocolDeps {
  pulseAt: (node: number, amplitude: number, durationMs: number) => StimulusMarker;
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
  /** 发刺激那次 tick() 的模型时间（marker 创建时的快照时间），见模块头注。 */
  provisionalTms: number;
  rtMs: number;
  trialIndex: number;
  /** 已在 markers 里看到同节点事件，但 t_ms 尚未被 ACK 修正（仍等于 provisional）。 */
  markerSeen: boolean;
  /**
   * Phase 4 — 本试次自己的 marker 对象。发刺激时由 `pulseAt` 的返回值
   * 直接记下（见 `fireOddballTrial`）；旧的假 `pulseAt` 不返回值时为
   * undefined，`confirmFromMarkers` 回退到窗口匹配、首次看到时再记。
   * SimClient 的 marker 对象在数组里是同一引用，ACK 到达时原地改 t_ms；
   * 拿引用认 marker，慢 ACK 修正后仍能锚到它，不用靠时间窗口猜。
   * marker 离开 50 条数组后清掉（见 confirmFromMarkers）。
   */
  marker?: StimulusMarker;
}

export function createBenchProtocolEngine(deps: BenchProtocolDeps): BenchProtocolEngine {
  let running = false;
  let protocol: BenchProtocolId | null = null;
  let trialIndex = 0;
  let droppedResponses = 0;
  let skippedTrials = 0;
  let startTms = 0;
  let lastTms = 0;
  let nextTimeMs = 0;
  let durationMs: number | undefined;
  let localIdSeq = 0;
  const pending: PendingResponse[] = [];
  // Phase 3 — 回路时延最新值 + detected 待配对（按 action id）。
  const loopTiming: BenchLoopTiming = {
    triggerToCommandMs: null, dispatchToAckMs: null, observationLagMs: null,
    lastActionId: null, samples: { triggerToCommand: 0, dispatchToAck: 0, observationLag: 0 },
  };
  const pendingDetected = new Map<number, number>();
  const resetLoopTiming = (): void => {
    loopTiming.triggerToCommandMs = null;
    loopTiming.dispatchToAckMs = null;
    loopTiming.observationLagMs = null;
    loopTiming.lastActionId = null;
    loopTiming.samples.triggerToCommand = 0;
    loopTiming.samples.dispatchToAck = 0;
    loopTiming.samples.observationLag = 0;
    pendingDetected.clear();
  };

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
    // 已检出未施加的动作不会再施加；pendingDetected 必须清空，否则下一轮
    // action id 从 1 重排时会错配到上一轮的 detectedMs。
    pendingDetected.clear();
    if (protocol === 'closed-loop') deps.configureFeedback(null);
    deps.onEvent({ kind: 'protocol-stopped', tMs: lastTms, reason });
  };

  /** Phase 3 去重记账：一次 tick 只发最新到期的一个试次，其余记为跳过并可见。 */
  const recordSkipped = (count: number, tMs: number): void => {
    if (count <= 0) return;
    skippedTrials += count;
    deps.onEvent({ kind: 'trial-skipped', tMs, trialIndex, skippedCount: count });
  };

  /** Phase 3 — 一次 tick 内到期的试次只发最新一个：返回 {due, latestDue}，并把 nextTimeMs 推到首个未到期。 */
  const countDue = (tMs: number, periodMs: number): { due: number; latestDue: number } => {
    const endMs = durationMs === undefined ? Infinity : startTms + durationMs;
    let due = 0;
    let latestDue = -1;
    while (nextTimeMs <= tMs && nextTimeMs < endMs) {
      latestDue = nextTimeMs;
      due++;
      nextTimeMs += periodMs;
    }
    return { due, latestDue };
  };

  /** Phase 4 — 逾期处理：无 marker → +500 ms 后丢弃计数；有 marker 但
   * 尚未修正 → 宽限到 +LATE_ACK_GRACE_MS（见该常量注释），修正后的 marker
   * 仍可在 confirmFromMarkers 里凭引用认到；到硬上限仍未修正，才按
   * provisional 发未确认响应。 */
  const resolveOverduePending = (tMs: number): void => {
    for (let j = pending.length - 1; j >= 0; j--) {
      const p = pending[j];
      if (p.markerSeen) {
        if (p.provisionalTms + LATE_ACK_GRACE_MS <= tMs) {
          pending.splice(j, 1);
          deps.onEvent({
            kind: 'response', tMs: p.provisionalTms + p.rtMs, trialIndex: p.trialIndex,
            condition: 'oddball', node: p.node, rtMs: p.rtMs, confirmed: false,
          });
        }
      } else if (p.provisionalTms + 500 <= tMs) {
        pending.splice(j, 1);
        droppedResponses++;
      }
    }
  };

  const fireOddballTrial = (scheduledTms: number, tickTms: number): void => {
    trialIndex++;
    const isOddball = trialIndex % oddballEvery === 0;
    const amplitude = clampAmplitude(isOddball ? oddballAmp : oddballStandardAmp);
    // pulseAt 返回本次刺激的 marker 对象（与 SimClient 里 ACK 原地修正
    // t_ms 的是同一引用）：发刺激时就记下，confirmFromMarkers 第一次
    // 看到它就能凭引用认出来——即使 ACK 已把它修正到 provisional + 600 ms、
    // 超出首次窗口，也不会丢（见 confirmFromMarkers 的引用路径）。
    const marker = deps.pulseAt(oddballNode, amplitude, oddballDurationMs);
    deps.onEvent({
      kind: 'stimulus-sent', tMs: scheduledTms, trialIndex,
      condition: isOddball ? 'oddball' : 'standard',
      node: oddballNode, amplitude, durationMs: oddballDurationMs,
      dispatchTms: tickTms, marker,
    });
    if (isOddball) {
      const resp = deps.subject.nextOddballResponse(trialIndex, scheduledTms);
      pending.push({
        // marker 以这次 tick 的快照时间创建（见模块头注），不是计划时间。
        localId: ++localIdSeq, node: oddballNode, provisionalTms: tickTms,
        rtMs: resp.rtMs, trialIndex, markerSeen: false, marker,
      });
    }
  };

  const fireFlickerCycle = (scheduledTms: number, tickTms: number): void => {
    trialIndex++;
    for (const node of flickerNodes) {
      const marker = deps.pulseAt(node, flickerAmp, flickerDurationMs);
      deps.onEvent({
        kind: 'stimulus-sent', tMs: scheduledTms, trialIndex,
        node, amplitude: flickerAmp, durationMs: flickerDurationMs,
        dispatchTms: tickTms, marker,
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
      skippedTrials = 0;
      resetLoopTiming();

      if (p === 'single-pulse') {
        const sp = params as BenchProtocolParams['single-pulse'];
        assertNode(sp.node);
        const amplitude = clampAmplitude(sp.amplitude ?? 1.0);
        const dur = clampDurationMs(sp.durationMs ?? 100);
        running = true;
        deps.onEvent({ kind: 'protocol-started', tMs: startT });
        trialIndex = 1;
        const marker = deps.pulseAt(sp.node, amplitude, dur);
        deps.onEvent({
          kind: 'stimulus-sent', tMs: startT, trialIndex: 1,
          node: sp.node, amplitude, durationMs: dur,
          dispatchTms: startT, marker,
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
        oddballDurationMs = clampDurationMs(op.pulseDurationMs ?? op.durationMs ?? 100);
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
        flickerDurationMs = clampDurationMs(fp.pulseDurationMs ?? fp.durationMs ?? 100);
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
      if (protocol === 'oddball') {
        // Phase 3 去重：tick 被延迟（或快照合并）时到期试次只发最新一个，
        // 其余记为跳过——永不突发连发。
        const { due, latestDue } = countDue(tMs, oddballIsiMs);
        if (due > 0) {
          fireOddballTrial(latestDue, tMs);
          recordSkipped(due - 1, tMs);
        }
      } else if (protocol === 'flicker') {
        const { due, latestDue } = countDue(tMs, flickerPeriodMs);
        if (due > 0) {
          fireFlickerCycle(latestDue, tMs);
          recordSkipped(due - 1, tMs);
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
        // Phase 4 — 引用匹配优先：本试次自己的 marker 对象在发刺激时
        // 已由 pulseAt 的返回值记下（见 fireOddballTrial），直接看它在
        // 不在数组里、在不在已被 ACK 修正。SimClient 的 marker 对象在
        // 数组里是同一引用，ACK 到达时原地改 t_ms，所以慢 ACK（超过
        // +500 ms 才修正）仍能锚到修正时间，不用靠时间窗口猜，也不会
        // 套住邻试次的 marker。
        if (p.marker) {
          // 同一个 marker 对象不能确认两个待定响应：先认领的那个占住它，
          // 后一个走窗口路径找别的 marker（或继续等自己的）。
          if (used.has(p.marker)) continue;
          used.add(p.marker);
          if (!markers.includes(p.marker)) {
            // marker 已离开 50 条数组、修正再也不会来：清掉引用，等宽限
            // 到期按 provisional 发未确认响应（见 resolveOverduePending）。
            p.marker = undefined;
            continue;
          }
          if (p.marker.t_ms !== p.provisionalTms) {
            // Worker ACK 已修正刺激时间（可能很慢）：响应锚定到修正后的时间。
            loopTiming.dispatchToAckMs = p.marker.t_ms - p.provisionalTms;
            loopTiming.samples.dispatchToAck++;
            pending.splice(j, 1);
            deps.onEvent({
              kind: 'response', tMs: p.marker.t_ms + p.rtMs, trialIndex: p.trialIndex,
              condition: 'oddball', node: p.node, rtMs: p.rtMs, confirmed: true,
            });
          } else {
            // 仍是 dispatch 时的 provisional 值：继续等修正（宽限见 tick）。
            p.markerSeen = true;
          }
          continue;
        }
        // 首次看到：窗口匹配（原有行为）。窗口内已修正的 marker 立即锚定；
        // 仍是 provisional 的记下引用、等 ACK（见上）。
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
          // Phase 3 — 同一次匹配测 dispatch→ACK：修正后的 marker 时间 −
          // 发刺激那次 tick 的模型时间（正常 0–100 ms，门见 LOOP_TIMING_BOUNDS）。
          loopTiming.dispatchToAckMs = marker.t_ms - p.provisionalTms;
          loopTiming.samples.dispatchToAck++;
          pending.splice(j, 1);
          deps.onEvent({
            kind: 'response', tMs: marker.t_ms + p.rtMs, trialIndex: p.trialIndex,
            condition: 'oddball', node: p.node, rtMs: p.rtMs, confirmed: true,
          });
        } else {
          // marker 在，但时间仍是 dispatch 时的 provisional 值：记下引用、
          // 等 ACK 修正；宽限到期仍未修正才按 provisional 发未确认响应
          // （见 tick → resolveOverduePending）。
          p.marker = marker;
          p.markerSeen = true;
        }
      }
    },

    stop(reason = 'stopped'): void {
      stopInternal(reason);
    },

    emitFeedbackEvent(e: BenchProtocolEvent): void {
      if (running && protocol === 'closed-loop') {
        if (e.kind === 'feedback-detected' && e.actionId !== undefined && e.detectedMs !== undefined) {
          // 按 action id 记下检出时刻，等 applied 到达时配对。
          pendingDetected.set(e.actionId, e.detectedMs);
          if (pendingDetected.size > 16) {
            const oldest = pendingDetected.keys().next().value;
            if (oldest !== undefined) pendingDetected.delete(oldest);
          }
        } else if (e.kind === 'feedback-applied' && e.actionId !== undefined && e.applyMs !== undefined) {
          // Phase 3 — trigger→command：按 action id 配对实测 applyMs − detectedMs
          // （应恒等于 delayMs + 1；detected 事件先到则用它，未到则用 applied 自带的 detectedMs）。
          const detectedMs = pendingDetected.get(e.actionId) ?? e.detectedMs;
          pendingDetected.delete(e.actionId);
          if (detectedMs !== undefined) {
            loopTiming.triggerToCommandMs = e.applyMs - detectedMs;
            loopTiming.lastActionId = e.actionId;
            loopTiming.samples.triggerToCommand++;
          }
          if (e.observedAtTms !== undefined) {
            // observation lag：收到 applied 时客户端最新快照 − 施加时刻（可为负）。
            loopTiming.observationLagMs = e.observedAtTms - e.applyMs;
            loopTiming.samples.observationLag++;
          }
        }
        deps.onEvent(e);
      }
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
    get skippedTrials(): number {
      return skippedTrials;
    },
    getLoopTiming(): BenchLoopTiming {
      return {
        triggerToCommandMs: loopTiming.triggerToCommandMs,
        dispatchToAckMs: loopTiming.dispatchToAckMs,
        observationLagMs: loopTiming.observationLagMs,
        lastActionId: loopTiming.lastActionId,
        samples: { ...loopTiming.samples },
      };
    },
  };
}
