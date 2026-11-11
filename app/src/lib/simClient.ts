/**
 * 主线程仿真客户端（Phase 3）。
 *
 * 封装 module Worker：初始化（传连接矩阵）、发命令、收快照。
 * 快照约 60 Hz；订阅者自行节流。客户端不做任何物理计算，
 * 所有数字都来自 Worker 里的 WASM 引擎。
 *
 * 另挂一个测试桥 `window.__brainSim`（只读状态 + 与 UI 相同的命令），
 * 供 Playwright 因果测试使用；它不产生任何额外活动。
 */
import type { SimParams, Snapshot, WorkerInMessage, WorkerOutMessage } from '../worker/protocol';

export interface StimulusMarker {
  /** 刺激开始的仿真时间 ms（以发送时最近快照为准）。 */
  t_ms: number;
  node: number;
  /** 'pulse' | 'hold'。 */
  kind: 'pulse' | 'hold';
}

/**
 * PR2 — 响应阈值与窗口口径（与审查报告、Phase 2 实测一致）。
 * 响应阈值沿用 Phase 2 的 max|ΔE| ≥ 0.01；窗口取基线前 500 ms 至
 * 刺激后约 2 s（演示预设下脉冲瞬态约在刺激后 70–200 ms 达峰、
 * 2 s 内基本恢复，窗口足够覆盖全程）。
 */
export const RESPONSE_THRESHOLD = 0.01;
/** ΔE 色标满格值：平方根压缩下 |ΔE| = 0.1 即满格，0.01 的变化约占 32% 色深。 */
export const DELTA_FULL = 0.1;
export const RESPONSE_WINDOW_PRE_MS = 500;
export const RESPONSE_WINDOW_POST_MS = 2000;

/** 最近一次刺激的基线：刺激发送前最近快照的 E（不编造）。 */
export interface ResponseBaseline {
  t_ms: number;
  node: number;
  e: Float64Array;
}

/** 响应窗口：基线前后真实快照切片（从 snapHistory 里切，不另造数据源）。 */
export interface ResponseWindow {
  baselineT_ms: number;
  node: number;
  t0_ms: number;
  t1_ms: number;
  snapshots: Array<{ t_ms: number; e: Float64Array; i: Float64Array }>;
}

/** 某脑区在窗口内的有符号峰值 ΔE（取 |ΔE| 最大那一刻的值，带符号）。 */
export interface RegionPeak {
  node: number;
  peakDeltaE: number;
}

export interface ResponseSummary {
  baselineT_ms: number;
  node: number;
  threshold: number;
  /** 超过阈值的脑区数。 */
  count: number;
  /** 按 |peakDeltaE| 从大到小排，全部超过阈值的脑区。 */
  responders: RegionPeak[];
}

/** 三类标记的脑区 id 列表（供 __brainSim 调试桥与 3D 标记读取）。 */
export interface ResponseGroups {
  /** 输入位置：被刺激的脑区（琥珀色环）。 */
  input: number | null;
  /** 局部响应：被刺激脑区且超过阈值（琥珀实心标记）。 */
  local: number[];
  /** 网络响应：其他超过阈值的脑区（蓝色小点）。 */
  network: number[];
  threshold: number;
  responders: RegionPeak[];
}

/** 回放状态（由 App 提供，SimClient 只转发给调试桥）。 */
export interface ReplayState {
  active: boolean;
  playing: boolean;
  speed: number;
  tMs: number;
  baselineT_ms: number | null;
  windowT0_ms: number | null;
  windowT1_ms: number | null;
}

/** 参数归一化值 k in [0,1] -> 模型参数。映射与安全范围见 docs/model-spec.md §8.7。
 *  （PR2 前称旋钮映射；控件已换成滑杆，映射本身一个字没变。） */
export const KNOB_MAP = {
  /** STIMULUS：非线性 0.5 * 4^k，k=0 -> 0.5，k=1 -> 2.0（默认）。 */
  stimulusAmplitude: (k: number): number => 0.5 * Math.pow(4, k),
  stimulusK: (amplitude: number): number => Math.log2(amplitude / 0.5) / 2,
  /** DURATION：线性 20–500 ms，默认 100 ms。 */
  durationMs: (k: number): number => 20 + k * 480,
  durationK: (ms: number): number => (ms - 20) / 480,
  /** EXC/INH：c_ei 线性 3–8，默认 4.0。低于 3 会翻转，不许更低。 */
  c_ei: (k: number): number => 3 + k * 5,
  c_eiK: (c_ei: number): number => (c_ei - 3) / 5,
  /** CONNECTIVITY：G 线性 0–0.4，默认 0.35。高于 0.4 基线翻转。 */
  g: (k: number): number => k * 0.4,
  gK: (g: number): number => g / 0.4,
};

export const DEFAULT_PARAMS: SimParams = {
  g: 0.35,
  c_ei: 4.0,
  stim_amplitude: 2.0,
  stim_duration_ms: 100,
};

export type SnapshotListener = (snap: Snapshot) => void;

export class SimClient {
  private worker: Worker | null = null;
  private listeners = new Set<SnapshotListener>();
  private latest: Snapshot | null = null;
  private markers: StimulusMarker[] = [];
  /** 自上次清零以来各脑区 E 的峰值（60 Hz 快照流逐条更新）。主线程
   *  每帧只读到最新快照，200 ms 的脉冲瞬态会被帧率采样漏掉；峰值
   *  追踪在消息到达时就更新，所以不会漏。仅供调试桥读取。 */
  private peakE: Float64Array | null = null;
  /** 最近快照的短历史（Worker 时间戳 + 全脑 E/I，供调试桥与 PR2 回放读取）。
   *  主线程每帧只看到最新快照，拿不到“+200 ms 时 E 是多少”这种
   *  时间点值；历史在消息到达时逐条记下（60 Hz），上限 600 条
   *  （10 s），旧的丢弃。仅供调试桥读取。 */
  private snapHistory: Array<{ t_ms: number; e: Float64Array; i: Float64Array }> = [];
  private static readonly SNAP_HISTORY_MAX = 600;
  /** PR2：最近一次刺激的基线（刺激发送前最近快照的 E）与刺激时间。
   *  从未刺激过时为 null，不编造基线。RESET 时清掉。 */
  private baselineE: Float64Array | null = null;
  private baselineT: number | null = null;
  private baselineNode: number | null = null;
  /** PR2：钉住的响应窗口——最近一次刺激的 [基线−500 ms, 刺激+2 s]
   *  快照切片，单独保存、不随 snapHistory 的 600 条滚动上限被逐出。
   *  否则回放在刺激后约 10 秒就因历史滚动而丢失（600 条在 60 Hz
   *  下只覆盖 10 秒）。mark() 时用历史播种刺激前半段，快照到达
   *  时续接刺激后半段；RESET 或下一次刺激时重建。 */
  private pinnedWindow: ResponseWindow | null = null;
  /** PR2：回放状态提供方（App 持有回放状态，SimClient 只转发给调试桥）。 */
  private replayProvider: (() => ReplayState) | null = null;
  private holdStartWall: { node: number; wallMs: number } | null = null;
  private params: SimParams = { ...DEFAULT_PARAMS };
  private ready = false;
  private readyListeners: Array<() => void> = [];
  private error: string | null = null;

  /** 启动 Worker 并用连接矩阵初始化引擎。 */
  start(weights: number[][], lengths: number[][]): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('../worker/simWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (ev: MessageEvent<WorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        this.ready = true;
        const cbs = this.readyListeners;
        this.readyListeners = [];
        cbs.forEach((cb) => cb());
      } else if (msg.type === 'snapshot') {
        this.latest = msg;
        if (this.peakE === null) {
          this.peakE = Float64Array.from(msg.e);
        } else {
          for (let n = 0; n < msg.e.length; n++) {
            if (msg.e[n] > this.peakE[n]) this.peakE[n] = msg.e[n];
          }
        }
        this.snapHistory.push({
          t_ms: msg.t_ms,
          e: Float64Array.from(msg.e),
          i: Float64Array.from(msg.i),
        });
        if (this.snapHistory.length > SimClient.SNAP_HISTORY_MAX) {
          this.snapHistory.splice(0, this.snapHistory.length - SimClient.SNAP_HISTORY_MAX);
        }
        // PR2：续接钉住的响应窗口（只收窗口内、且晚于已收最后一条的快照；
        // RESET 前后在途的旧时间戳快照会被这道时间单调守卫挡掉）。
        const pw = this.pinnedWindow;
        if (pw && msg.t_ms > pw.t0_ms && msg.t_ms <= pw.t1_ms) {
          const last = pw.snapshots[pw.snapshots.length - 1];
          if (!last || msg.t_ms > last.t_ms) {
            pw.snapshots.push({
              t_ms: msg.t_ms,
              e: Float64Array.from(msg.e),
              i: Float64Array.from(msg.i),
            });
          }
        }
        this.listeners.forEach((cb) => cb(msg));
      } else if (msg.type === 'error') {
        this.error = msg.message;
      }
    });
    const flat = (m: number[][]): number[] => m.flat();
    this.send({
      type: 'init',
      weights: flat(weights),
      lengths: flat(lengths),
    });
    // 把默认参数同步进引擎（引擎默认已是演示预设，此处显式确认一遍）。
    this.send({ type: 'set_params', params: { ...this.params } });
  }

  stop(): void {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  onReady(cb: () => void): void {
    if (this.ready) cb();
    else this.readyListeners.push(cb);
  }

  isReady(): boolean {
    return this.ready;
  }

  getError(): string | null {
    return this.error;
  }

  subscribe(cb: SnapshotListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  getLatest(): Snapshot | null {
    return this.latest;
  }

  getParams(): SimParams {
    return { ...this.params };
  }

  getMarkers(): StimulusMarker[] {
    return this.markers;
  }

  /** 清零峰值追踪（从下一条快照开始重新累计）。 */
  resetPeakTracking(): void {
    this.peakE = null;
  }

  /** 自上次清零以来的各脑区 E 峰值（未清零过则返回 null）。 */
  getPeakE(): Float64Array | null {
    return this.peakE ? Float64Array.from(this.peakE) : null;
  }

  /** 清零快照历史。 */
  resetSnapshotHistory(): void {
    this.snapHistory = [];
  }

  /** 最近快照历史（Worker 时间戳 + 全脑 E/I 的副本）。 */
  getSnapshotHistory(): Array<{ t_ms: number; e: Float64Array; i: Float64Array }> {
    return this.snapHistory.map((s) => ({
      t_ms: s.t_ms,
      e: Float64Array.from(s.e),
      i: Float64Array.from(s.i),
    }));
  }

  /** PR2：最近一次刺激的基线（刺激发送前最近快照的 E）；从未刺激过返回 null。 */
  getBaseline(): ResponseBaseline | null {
    if (this.baselineE === null || this.baselineT === null || this.baselineNode === null) {
      return null;
    }
    return { t_ms: this.baselineT, node: this.baselineNode, e: Float64Array.from(this.baselineE) };
  }

  /** PR2：最近一次刺激的响应窗口——基线前 500 ms 至刺激后约 2 s 的
   *  真实快照切片（mark() 时播种 + 快照到达时续接，钉住保存，不随
   *  滚动历史逐出）。窗口随新快照到达而逐渐填满；从未刺激过返回 null。 */
  getLastResponseWindow(): ResponseWindow | null {
    if (!this.pinnedWindow) return null;
    const w = this.pinnedWindow;
    return {
      baselineT_ms: w.baselineT_ms,
      node: w.node,
      t0_ms: w.t0_ms,
      t1_ms: w.t1_ms,
      snapshots: w.snapshots.map((s) => ({
        t_ms: s.t_ms,
        e: Float64Array.from(s.e),
        i: Float64Array.from(s.i),
      })),
    };
  }

  /** PR2：窗口内各脑区的 max|ΔE|（相对基线）；从未刺激过返回 null。 */
  getMaxAbsDeltaE(): Float64Array | null {
    if (this.baselineE === null) return null;
    const win = this.getLastResponseWindow();
    if (!win) return null;
    const n = this.baselineE.length;
    const out = new Float64Array(n);
    for (const s of win.snapshots) {
      for (let r = 0; r < n; r++) {
        const d = Math.abs(s.e[r] - this.baselineE[r]);
        if (d > out[r]) out[r] = d;
      }
    }
    return out;
  }

  /** PR2：窗口内超过阈值的响应脑区，按 |峰值 ΔE| 从大到小排。
   *  峰值取有符号值（|ΔE| 最大那一刻的 ΔE）。从未刺激过返回 null。 */
  getResponseSummary(threshold: number = RESPONSE_THRESHOLD): ResponseSummary | null {
    if (this.baselineE === null || this.baselineT === null || this.baselineNode === null) {
      return null;
    }
    const win = this.getLastResponseWindow();
    if (!win) return null;
    const n = this.baselineE.length;
    const best = new Float64Array(n); // 有符号峰值 ΔE
    const bestAbs = new Float64Array(n);
    for (const s of win.snapshots) {
      for (let r = 0; r < n; r++) {
        const d = s.e[r] - this.baselineE[r];
        const a = Math.abs(d);
        if (a > bestAbs[r]) {
          bestAbs[r] = a;
          best[r] = d;
        }
      }
    }
    const responders: RegionPeak[] = [];
    for (let r = 0; r < n; r++) {
      if (bestAbs[r] >= threshold) responders.push({ node: r, peakDeltaE: best[r] });
    }
    responders.sort((a, b) => Math.abs(b.peakDeltaE) - Math.abs(a.peakDeltaE));
    return {
      baselineT_ms: this.baselineT,
      node: this.baselineNode,
      threshold,
      count: responders.length,
      responders,
    };
  }

  /** PR2：三类标记的脑区 id 列表（输入 / 局部响应 / 网络响应）。 */
  getResponseGroups(threshold: number = RESPONSE_THRESHOLD): ResponseGroups {
    const summary = this.getResponseSummary(threshold);
    if (!summary) {
      return { input: null, local: [], network: [], threshold, responders: [] };
    }
    const local = summary.responders.some((r) => r.node === summary.node) ? [summary.node] : [];
    const network = summary.responders.filter((r) => r.node !== summary.node).map((r) => r.node);
    return { input: summary.node, local, network, threshold, responders: summary.responders };
  }

  /** PR2：App 把回放状态的读取函数交过来，调试桥只转发、不另存。 */
  setReplayStateProvider(fn: (() => ReplayState) | null): void {
    this.replayProvider = fn;
  }

  /** 当前按住的脑区（有则返回 node 与已按住的墙钟毫秒数）。 */
  getHold(): { node: number; heldMs: number } | null {
    if (!this.holdStartWall) return null;
    return { node: this.holdStartWall.node, heldMs: Date.now() - this.holdStartWall.wallMs };
  }

  private send(msg: WorkerInMessage): void {
    this.worker?.postMessage(msg);
  }

  private mark(kind: 'pulse' | 'hold', node: number): void {
    const t_ms = this.latest ? this.latest.t_ms : 0;
    // PR2：记下发送前最近快照的 E 作基线（ΔE 视图与响应窗口的零点）。
    // 只有真实快照到达过才有基线；否则保持上一次基线（不编造）。
    if (this.latest) {
      this.baselineE = Float64Array.from(this.latest.e);
      this.baselineT = t_ms;
      this.baselineNode = node;
      // PR2：钉住新窗口，用历史播种刺激前 500 ms 的快照（按时间排序；
      // RESET 前后在途的旧时间戳快照不在窗口时间范围里，不会混进来）。
      const t0 = t_ms - RESPONSE_WINDOW_PRE_MS;
      const t1 = t_ms + RESPONSE_WINDOW_POST_MS;
      const seed = this.snapHistory
        .filter((s) => s.t_ms >= t0 && s.t_ms <= t_ms)
        .sort((a, b) => a.t_ms - b.t_ms)
        .map((s) => ({ t_ms: s.t_ms, e: Float64Array.from(s.e), i: Float64Array.from(s.i) }));
      this.pinnedWindow = { baselineT_ms: t_ms, node, t0_ms: t0, t1_ms: t1, snapshots: seed };
    }
    this.markers.push({ t_ms, node, kind });
    if (this.markers.length > 50) this.markers.splice(0, this.markers.length - 50);
  }

  /** 脉冲刺激：用当前参数的幅度与持续时间。 */
  pulse(node: number): void {
    this.mark('pulse', node);
    this.send({
      type: 'stimulus',
      node,
      amplitude: this.params.stim_amplitude,
      duration_ms: this.params.stim_duration_ms,
    });
  }

  holdStart(node: number): void {
    this.mark('hold', node);
    this.holdStartWall = { node, wallMs: Date.now() };
    this.send({ type: 'hold_start', node, amplitude: this.params.stim_amplitude });
  }

  holdEnd(node: number): void {
    if (this.holdStartWall?.node === node) this.holdStartWall = null;
    this.send({ type: 'hold_end', node });
  }

  /** 撤回一次被证实为误判的按住（B2）：停输入，并删掉它留下的标记。
   *  调用方（BrainScene）已用指针事件时间戳证实，这次按压在按住
   *  启动之前其实已经在拖动。只删该脑区最近的一条 hold 标记，
   *  不动脉冲标记与其他脑区的记录。 */
  retractHold(node: number): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      if (this.markers[i].kind === 'hold' && this.markers[i].node === node) {
        this.markers.splice(i, 1);
        break;
      }
    }
    this.holdEnd(node);
  }

  setParams(patch: Partial<SimParams>): void {
    this.params = { ...this.params, ...patch };
    this.send({ type: 'set_params', params: patch });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  resume(): void {
    this.send({ type: 'resume' });
  }

  reset(): void {
    this.markers = [];
    this.holdStartWall = null;
    this.peakE = null;
    this.snapHistory = [];
    // PR2：清掉基线与响应窗口（下一次刺激前显示“尚未刺激”）。
    this.baselineE = null;
    this.baselineT = null;
    this.baselineNode = null;
    this.pinnedWindow = null;
    this.send({ type: 'reset' });
  }

  /** 测试桥：只读状态 + 与 UI 相同的命令，不产生额外活动。 */
  attachDebugBridge(): void {
    (window as unknown as { __brainSim?: unknown }).__brainSim = {
      getSnapshot: () => this.latest,
      getPeakE: () => this.getPeakE(),
      resetPeakTracking: () => this.resetPeakTracking(),
      getSnapshotHistory: () => this.getSnapshotHistory(),
      resetSnapshotHistory: () => this.resetSnapshotHistory(),
      getParams: () => this.getParams(),
      getMarkers: () => this.getMarkers(),
      // PR2 调试桥：基线 / 响应窗口 / max|ΔE| / 响应汇总 / 三类标记 / 回放状态。
      // 全部只读已记录的真实快照，不产生额外活动；窗口快照的 e/i 转成
      // 普通数组，便于 Playwright 里直接 JSON 序列化读取。
      getBaseline: () => {
        const b = this.getBaseline();
        return b ? { t_ms: b.t_ms, node: b.node, e: Array.from(b.e) } : null;
      },
      getLastResponseWindow: () => {
        const w = this.getLastResponseWindow();
        if (!w) return null;
        return {
          baselineT_ms: w.baselineT_ms,
          node: w.node,
          t0_ms: w.t0_ms,
          t1_ms: w.t1_ms,
          snapshots: w.snapshots.map((s) => ({
            t_ms: s.t_ms,
            e: Array.from(s.e),
            i: Array.from(s.i),
          })),
        };
      },
      getMaxAbsDeltaE: () => {
        const m = this.getMaxAbsDeltaE();
        return m ? Array.from(m) : null;
      },
      getResponseSummary: (threshold?: number) => this.getResponseSummary(threshold),
      getResponseGroups: (threshold?: number) => this.getResponseGroups(threshold),
      getReplayState: () =>
        this.replayProvider
          ? this.replayProvider()
          : {
              active: false,
              playing: false,
              speed: 1,
              tMs: 0,
              baselineT_ms: null,
              windowT0_ms: null,
              windowT1_ms: null,
            },
      pulse: (node: number, amplitude?: number, duration_ms?: number) => {
        this.mark('pulse', node);
        this.send({
          type: 'stimulus',
          node,
          amplitude: amplitude ?? this.params.stim_amplitude,
          duration_ms: duration_ms ?? this.params.stim_duration_ms,
        });
      },
      holdStart: (node: number) => this.holdStart(node),
      holdEnd: (node: number) => this.holdEnd(node),
      retractHold: (node: number) => this.retractHold(node),
      setParams: (p: Partial<SimParams>) => this.setParams(p),
      pause: () => this.pause(),
      resume: () => this.resume(),
      reset: () => this.reset(),
      isReady: () => this.isReady(),
      getError: () => this.getError(),
    };
  }
}
