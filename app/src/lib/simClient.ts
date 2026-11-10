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

/** 旋钮归一化值 k in [0,1] -> 模型参数。映射与安全范围见 docs/model-spec.md §8.7。 */
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
  /** 最近快照的短历史（Worker 时间戳 + 全脑 E，供调试桥读取）。
   *  主线程每帧只看到最新快照，拿不到“+200 ms 时 E 是多少”这种
   *  时间点值；历史在消息到达时逐条记下（60 Hz），上限 600 条
   *  （10 s），旧的丢弃。仅供调试桥读取。 */
  private snapHistory: Array<{ t_ms: number; e: Float64Array }> = [];
  private static readonly SNAP_HISTORY_MAX = 600;
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
        this.snapHistory.push({ t_ms: msg.t_ms, e: Float64Array.from(msg.e) });
        if (this.snapHistory.length > SimClient.SNAP_HISTORY_MAX) {
          this.snapHistory.splice(0, this.snapHistory.length - SimClient.SNAP_HISTORY_MAX);
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

  /** 最近快照历史（Worker 时间戳 + 全脑 E 的副本）。 */
  getSnapshotHistory(): Array<{ t_ms: number; e: Float64Array }> {
    return this.snapHistory.map((s) => ({ t_ms: s.t_ms, e: Float64Array.from(s.e) }));
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
    this.markers.push({ t_ms, node, kind });
    if (this.markers.length > 50) this.markers.splice(0, this.markers.length - 50);
  }

  /** 脉冲刺激：用当前旋钮的幅度与持续时间。 */
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
