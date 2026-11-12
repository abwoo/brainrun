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
import type { ModeParams, SimParams, Snapshot, WorkerInMessage, WorkerOutMessage } from '../worker/protocol';
import { ExperimentSession } from './experimentSession';
import type { ExperimentSessionSnapshot } from './experimentSession';

export type { ModeParams } from '../worker/protocol';

export interface StimulusMarker {
  /** 刺激开始的仿真时间 ms（以发送时最近快照为准）。 */
  t_ms: number;
  node: number;
  /** 'pulse' | 'hold'。 */
  kind: 'pulse' | 'hold';
  /** 发送时用的刺激幅度（模型单位；pulse 取发送时 stim_amplitude）。 */
  amplitude: number;
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

/** PR3 — direct manipulation ranges (mirror the Rust engine).
 *  Weight 0–3 (TVB raw weight range, out-of-range clamped);
 *  sustained bias −1..+1 (model units of P, 0 = no bias). */
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 3;
export const BIAS_MIN = -1;
export const BIAS_MAX = 1;
/** Bias value applied when the user switches the bias on (excitatory). */
export const BIAS_DEFAULT_ON = 0.5;

/** PR4 — background activity modes (mirror the Rust `BgMode`). */
export type BackgroundMode = 'quiet' | 'spontaneous' | 'oscillatory';
export const BACKGROUND_MODES: BackgroundMode[] = ['quiet', 'spontaneous', 'oscillatory'];
/** Default background mode (PR4, measured): Spontaneous (OU sigma
 *  0.10, tau 100 ms) — the network shows model-driven ongoing activity
 *  (median node E std 0.0020-0.0022) while staying far from lock over
 *  60 s on the real network (max mean E <= 0.017 across 3 seeds, lock
 *  threshold 0.15), and standard pulses on the demo node 40 recover on
 *  all tested seeds and click times (24/24 clicks).  Quiet remains one
 *  click away.  See docs/model-spec.md §9.
 *  QUALIFICATION (measured, do not drop): flip probability depends on
 *  the PULSED NODE.  In Quiet (zero background) pulses on nodes
 *  0/10/20/30/54/55/59/60 already flip the network 2/2 — the network
 *  is bistable and most nodes' standard pulses tip it; that predates
 *  PR4.  The background adds exactly one borderline node (69, ~50% at
 *  sigma 0.10, still borderline 1/2 at 0.05).  The safety bar for the
 *  default is therefore "no lock on open" (60 s idle) + "demo-node
 *  clicks recover", not "no node ever flips"; a pulse flip recovers
 *  via the locked banner's RESET button.
 *  NOTE: the first two candidates FAILED on the real network and were
 *  rejected by measurement: sigma 0.20 locks within 1.3-35.9 s even
 *  with no input, and sigma 0.15 looks safe at a fixed click time but
 *  flips the network on 2/24 clicks when the click time varies (the OU
 *  state at click time decides).  0.10 is the largest sigma that passes
 *  all three safety checks (60 s alone, pulse at a fixed time, pulse
 *  across 8 click times x 3 seeds, all on node 40).  See
 *  reference/python-model/pr4_ou_60s_scan.py, pr4_pulse_safety.py,
 *  pr4_pulse_timing.py and pr4_pulse_nodes.py. */
export const DEFAULT_BACKGROUND_MODE: BackgroundMode = 'spontaneous';
/** Manual snapshot localStorage key (PR4).  The auto snapshot is never
 *  written here — it lives only in Worker memory and never overwrites
 *  the manual snapshot. */
export const MANUAL_SNAPSHOT_KEY = 'brainrun.snapshot.manual.v1';

/** Snapshot storage schema version (PR5 contract).  The localStorage key
 *  already carries a `.v1` suffix; this field is the in-record version so
 *  a future schema change can be detected even if the key is reused.
 *  Readers must accept a missing `version` as 1 (records written before
 *  this field existed) and reject any other value.  See
 *  docs/frontend-backend-contract.md §4. */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** One stored snapshot: Worker time + full state JSON + wall-clock save time. */
export interface StoredSnapshot {
  id: string;
  t_ms: number;
  json: string;
  savedAtWall: number;
  /** Schema version; absent (= 1) on records written before PR5. */
  version?: number;
}

/** Snapshot summary parsed back out of a snapshot JSON (params /
 *  weights / bias), used to re-sync the UI after a restore. */
export interface SnapshotSummary {
  t_ms: number;
  /** PR6 R2: StateSnapshot JSON schema version. Missing in pre-PR6
   *  JSON, in which case the parser defaults it to 1 (same rule as
   *  the Rust serde default). */
  version: number;
  params: { g: number; c_ei: number; stim_amplitude: number; stim_duration_ms: number };
  mode: BackgroundMode;
  modeParams: ModeParams;
  weights: number[][];
  bias: number[];
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

/** PR4: parse a snapshot JSON back into the summary the UI needs to
 *  re-sync after a restore.  Returns null if the JSON is not a snapshot
 *  (corrupt localStorage entry, wrong shape). */
function parseSnapshotSummary(stored: StoredSnapshot): SnapshotSummary | null {
  try {
    const snap = JSON.parse(stored.json) as {
      /** PR6 R2: StateSnapshot JSON schema version; absent in pre-PR6 JSON. */
      version?: number;
      params?: {
        g?: number;
        c_ei?: number;
        stim_amplitude?: number;
        stim_duration_ms?: number;
        bg_mode?: string;
        ou_tau_ms?: number;
        ou_sigma?: number;
        ext_sine_amp?: number;
        ext_sine_freq_hz?: number;
      };
      weights?: number[][];
      bias?: number[];
    };
    if (!snap.params || !Array.isArray(snap.weights) || !Array.isArray(snap.bias)) {
      return null;
    }
    const modeRaw = snap.params.bg_mode ?? 'Quiet';
    const mode: BackgroundMode =
      modeRaw === 'Spontaneous'
        ? 'spontaneous'
        : modeRaw === 'Oscillatory'
          ? 'oscillatory'
          : 'quiet';
    return {
      t_ms: stored.t_ms,
      version: snap.version ?? 1,
      params: {
        g: snap.params.g ?? DEFAULT_PARAMS.g,
        c_ei: snap.params.c_ei ?? DEFAULT_PARAMS.c_ei,
        stim_amplitude: snap.params.stim_amplitude ?? DEFAULT_PARAMS.stim_amplitude,
        stim_duration_ms: snap.params.stim_duration_ms ?? DEFAULT_PARAMS.stim_duration_ms,
      },
      mode,
      modeParams: {
        mode,
        ou_tau_ms: snap.params.ou_tau_ms ?? 100,
        ou_sigma: snap.params.ou_sigma ?? 0.10,
        ext_sine_amp: snap.params.ext_sine_amp ?? 0,
        ext_sine_freq_hz: snap.params.ext_sine_freq_hz ?? 10,
      },
      weights: snap.weights,
      bias: snap.bias,
    };
  } catch {
    return null;
  }
}

export class SimClient {
  private worker: Worker | null = null;
  private listeners = new Set<SnapshotListener>();
  private latest: Snapshot | null = null;
  private markers: StimulusMarker[] = [];
  /** P0-2: LIVE session provenance. Only confirmed Worker model times count. */
  private readonly experiment = new ExperimentSession({
    origin: 'live-wasm', solverId: 'rust-wasm-wilson-cowan-76',
    anatomyId: 'tvb-demo-connectome-76', registration: 'unregistered', seed: 0,
  });
  private commandSequence = 0;
  private pendingStimulusMarkers = new Map<number, StimulusMarker>();
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
  /** PR3: TVB original weights (as passed to start()) and the live
   *  weights the engine is using.  The client mirrors what it sent to
   *  the Worker so the debug bridge can read weights back synchronously;
   *  the causal behaviour itself is verified against the engine.
   *  `modified` holds only edges whose live value differs from the
   *  original.  RESET never touches any of this (weights survive reset). */
  private originalWeights: number[][] | null = null;
  private currentWeights: number[][] | null = null;
  private modifiedWeights = new Map<string, number>();
  /** PR3: sustained bias per node (0 / absent = no bias).  RESET clears
   *  this (bias is an applied input, like a stimulus). */
  private biasMap = new Map<number, number>();
  private ready = false;
  private readyListeners: Array<() => void> = [];
  private error: string | null = null;
  /** PR4: background mode (default Spontaneous — see
   *  DEFAULT_BACKGROUND_MODE) + last mode parameters reported by the
   *  Worker after a mode change. */
  private backgroundMode: BackgroundMode = DEFAULT_BACKGROUND_MODE;
  private modeParams: ModeParams | null = null;
  private seed = 0;
  /** PR4: stored snapshots (id → snapshot).  'manual' is also persisted
   *  to localStorage; 'auto' lives only here (memory) and in the Worker. */
  private snapshots = new Map<string, StoredSnapshot>();
  private snapshotWaiters = new Map<
    string,
    Array<(info: { id: string; t_ms: number }) => void>
  >();
  private restoreWaiters = new Map<
    string,
    Array<(summary: SnapshotSummary) => void>
  >();

  /** 启动 Worker 并用连接矩阵初始化引擎。 */
  start(weights: number[][], lengths: number[][]): void {
    if (this.worker) return;
    this.worker = new Worker(new URL('../worker/simWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.addEventListener('message', (ev: MessageEvent<WorkerOutMessage>) => {
      const msg = ev.data;
      if (msg.type === 'command_ack') {
        if (msg.run_id !== this.experiment.runId) return;
        this.experiment.recordAcknowledgement(msg.run_id, {
          id: msg.command_id, runId: msg.run_id, command: msg.command_type,
          tMs: msg.t_ms, status: msg.phase,
        });
        // Legacy pulse marker is now corrected to the time at which the
        // Worker actually accepted the stimulation command; the dispatch
        // snapshot (<=16 ms old) is not the true stimulus timestamp.
        const marker = this.pendingStimulusMarkers.get(msg.command_id);
        if (marker) {
          marker.t_ms = msg.t_ms;
          this.pendingStimulusMarkers.delete(msg.command_id);
        }
      } else if (msg.type === 'ready') {
        this.ready = true;
        const cbs = this.readyListeners;
        this.readyListeners = [];
        cbs.forEach((cb) => cb());
      } else if (msg.type === 'mode_applied') {
        // PR4: the Worker confirms the mode + the applied OU/sine
        // parameters (the UI reads these, it never assumes them).
        this.backgroundMode = msg.params.mode;
        this.modeParams = msg.params;
      } else if (msg.type === 'snapshot_saved') {
        // PR4: keep the snapshot in memory; manual snapshots are also
        // persisted to localStorage (auto snapshots never are).
        const stored: StoredSnapshot = {
          id: msg.id,
          t_ms: msg.t_ms,
          json: msg.json,
          savedAtWall: Date.now(),
          version: SNAPSHOT_SCHEMA_VERSION,
        };
        this.snapshots.set(msg.id, stored);
        if (msg.run_id === undefined || msg.run_id === this.experiment.runId) {
          this.experiment.recordArtifact({
            id: `snapshot:${msg.id}:${msg.t_ms}`,
            runId: this.experiment.runId, kind: 'snapshot', tMs: msg.t_ms,
            sourceId: 'wasm-worker-state-json', methodId: 'WasmSim.take_snapshot',
          });
        }
        if (msg.id === 'manual') {
          try {
            window.localStorage.setItem(MANUAL_SNAPSHOT_KEY, JSON.stringify(stored));
          } catch {
            // localStorage full / unavailable: the in-memory copy still works.
          }
        }
        const waiters = this.snapshotWaiters.get(msg.id) ?? [];
        this.snapshotWaiters.delete(msg.id);
        waiters.forEach((cb) => cb({ id: msg.id, t_ms: msg.t_ms }));
      } else if (msg.type === 'snapshot_restored') {
        // PR4: a restore rewound the engine — re-sync the client mirrors
        // from the snapshot JSON (params, weights, bias) and drop the
        // response data, which belongs to the pre-restore trajectory.
        const stored = this.snapshots.get(msg.id);
        const summary = stored ? parseSnapshotSummary(stored) : null;
        if (summary) this.applySnapshotSummary(summary);
        this.markers = [];
        this.holdStartWall = null;
        this.peakE = null;
        this.snapHistory = [];
        this.baselineE = null;
        this.baselineT = null;
        this.baselineNode = null;
        this.pinnedWindow = null;
        const waiters = this.restoreWaiters.get(msg.id) ?? [];
        this.restoreWaiters.delete(msg.id);
        if (summary) waiters.forEach((cb) => cb(summary));
      } else if (msg.type === 'snapshot') {
        // A reset or rewind starts a new run. Ignore queued snapshots from
        // earlier runs even if they arrive after the UI initiates the reset.
        if (msg.run_id && msg.run_id !== this.experiment.runId) return;
        if (msg.run_id) this.experiment.recordModelTime(msg.run_id, msg.t_ms);
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
    // PR3: keep the TVB originals + a live mirror of the weights.
    this.originalWeights = weights.map((r) => [...r]);
    this.currentWeights = weights.map((r) => [...r]);
    this.modifiedWeights.clear();
    this.biasMap.clear();
    this.send({
      type: 'init', run_id: this.experiment.runId,
      weights: flat(weights),
      lengths: flat(lengths),
    });
    // 把默认参数同步进引擎（引擎默认已是演示预设，此处显式确认一遍）。
    this.onReady(() => this.send({ type: 'set_params', params: { ...this.params } }));
    // PR4：引擎默认是 Quiet（旧行为）；产品默认模式由客户端在引擎就绪
    // 后发 set_background_mode 设定——不能在 init 后立刻发，Worker 在
    // WASM 加载完成前会丢弃消息（sim 尚未创建）。
    this.onReady(() => {
      this.send({ type: 'set_background_mode', mode: this.backgroundMode });
    });
    // PR4：恢复上次浏览器会话里手动保存的快照（localStorage；自动快照
    // 从不写 localStorage，所以这里只有 manual）。
    try {
      const raw = window.localStorage.getItem(MANUAL_SNAPSHOT_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as StoredSnapshot;
        // Missing version = pre-PR5 record, treated as v1; any other
        // version is rejected (no silent migration of unknown schemas).
        const version = stored.version ?? 1;
        if (
          stored &&
          stored.id === 'manual' &&
          typeof stored.json === 'string' &&
          version === SNAPSHOT_SCHEMA_VERSION
        ) {
          this.snapshots.set('manual', stored);
        }
      }
    } catch {
      // localStorage 不可用或内容损坏：没有可恢复的手动快照。
    }
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

  /** P0-2: provenance, actual Worker command ACKs and snapshots in one run. */
  getExperimentSession(): ExperimentSessionSnapshot {
    return this.experiment.getSnapshot();
  }

  subscribeExperimentSession(cb: (session: ExperimentSessionSnapshot) => void): () => void {
    return this.experiment.subscribe(cb);
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

  private send(msg: WorkerInMessage): number | null {
    if (!this.worker) return null;
    if (msg.type === 'init') {
      this.worker.postMessage(msg);
      return null;
    }
    const command_id = ++this.commandSequence;
    this.worker.postMessage({
      ...msg, run_id: this.experiment.runId, command_id,
    } satisfies WorkerInMessage);
    return command_id;
  }

  private mark(kind: 'pulse' | 'hold', node: number, amplitude: number): StimulusMarker {
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
    const marker = { t_ms, node, kind, amplitude };
    this.markers.push(marker);
    if (this.markers.length > 50) this.markers.splice(0, this.markers.length - 50);
    return marker;
  }

  /** 脉冲刺激：用当前参数的幅度与持续时间。 */
  pulse(node: number): void {
    const marker = this.mark('pulse', node, this.params.stim_amplitude);
    const commandId = this.send({
      type: 'stimulus',
      node,
      amplitude: this.params.stim_amplitude,
      duration_ms: this.params.stim_duration_ms,
    });
    if (commandId !== null) this.pendingStimulusMarkers.set(commandId, marker);
  }

  /** PR8-LINK：带幅度的单次脉冲（感觉输入 / 刺激实验 / 直播闭环用）。
   *  幅度钳制到 [−2, 2]（与 Level A 直接驱动范围一致；Rust 端 per-event
   *  幅度不钳制，故客户端钳制）；持续时间钳制到 [20, 500] ms（与 UI
   *  脉冲时长范围一致）。与 pulse() 一样记标记、钉响应窗口。 */
  pulseAt(node: number, amplitude: number, durationMs: number): void {
    const amp = Math.min(2, Math.max(-2, amplitude));
    const dur = Math.min(500, Math.max(20, durationMs));
    const marker = this.mark('pulse', node, amp);
    const commandId = this.send({ type: 'stimulus', node, amplitude: amp, duration_ms: dur });
    if (commandId !== null) this.pendingStimulusMarkers.set(commandId, marker);
  }

  holdStart(node: number): void {
    const marker = this.mark('hold', node, this.params.stim_amplitude);
    this.holdStartWall = { node, wallMs: Date.now() };
    const commandId = this.send({ type: 'hold_start', node, amplitude: this.params.stim_amplitude });
    if (commandId !== null) this.pendingStimulusMarkers.set(commandId, marker);
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
    this.experiment.newRun({ seed: this.seed });
    this.pendingStimulusMarkers.clear();
    this.markers = [];
    this.holdStartWall = null;
    this.peakE = null;
    this.snapHistory = [];
    // PR2：清掉基线与响应窗口（下一次刺激前显示“尚未刺激”）。
    this.baselineE = null;
    this.baselineT = null;
    this.baselineNode = null;
    this.pinnedWindow = null;
    // PR4: RESET clears the sustained bias (applied input) but NEVER
    // the edited weights — modifiedWeights / currentWeights survive.
    // The engine side clears its bias in its own reset().
    this.biasMap.clear();
    // PR4：RESET 清掉自动快照（它对应“按住前”，按住已随 RESET 消失）；
    // 手动快照是用户存的东西，RESET 不动它（Worker 侧同样处理）。
    this.snapshots.delete('auto');
    this.send({ type: 'reset' });
  }

  /** Atomic reset + pause (one Worker message).  Deterministic stepping
   *  must use this, never reset() followed by pause(): the two-message
   *  form leaves a race window where live ticks consume RNG draws and
   *  same-seed reruns differ.  Client-side state clearing mirrors
   *  reset() exactly. */
  resetPaused(): void {
    this.experiment.newRun({ seed: this.seed });
    this.pendingStimulusMarkers.clear();
    this.markers = [];
    this.holdStartWall = null;
    this.peakE = null;
    this.snapHistory = [];
    this.baselineE = null;
    this.baselineT = null;
    this.baselineNode = null;
    this.pinnedWindow = null;
    this.biasMap.clear();
    this.snapshots.delete('auto');
    this.send({ type: 'reset_paused' });
  }

  // -- PR3: runtime weight editing (single-sided, range 0–3) -----------
  /** Set one weight, SINGLE-SIDED (only C_ij, never C_ji).  Clamped to
   *  [0, 3]; returns the value actually stored.  Takes effect from the
   *  next simulation step and survives reset. */
  setWeight(i: number, j: number, w: number): number {
    const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, w));
    if (this.currentWeights && this.originalWeights) {
      this.currentWeights[i][j] = clamped;
      const key = `${i},${j}`;
      if (Math.abs(clamped - this.originalWeights[i][j]) > 1e-12) {
        this.modifiedWeights.set(key, clamped);
      } else {
        this.modifiedWeights.delete(key);
      }
    }
    this.send({ type: 'set_weight', i, j, w: clamped });
    return clamped;
  }

  /** Current live weight C_ij (client mirror of what was sent). */
  getWeight(i: number, j: number): number | null {
    return this.currentWeights ? this.currentWeights[i][j] : null;
  }

  /** TVB original weight C_ij. */
  getOriginalWeight(i: number, j: number): number | null {
    return this.originalWeights ? this.originalWeights[i][j] : null;
  }

  /** Live weights, flat row-major (null before start). */
  getWeights(): number[] | null {
    return this.currentWeights ? this.currentWeights.flat() : null;
  }

  /** TVB original weights, flat row-major (null before start). */
  getOriginalWeights(): number[] | null {
    return this.originalWeights ? this.originalWeights.flat() : null;
  }

  /** Edges whose live value differs from the TVB original. */
  getModifiedWeights(): Array<{ i: number; j: number; w: number; original: number }> {
    const out: Array<{ i: number; j: number; w: number; original: number }> = [];
    for (const [key, w] of this.modifiedWeights) {
      const [i, j] = key.split(',').map(Number);
      out.push({ i, j, w, original: this.originalWeights?.[i]?.[j] ?? NaN });
    }
    out.sort((a, b) => a.i - b.i || a.j - b.j);
    return out;
  }

  /** Restore one weight to its TVB original value. */
  resetWeight(i: number, j: number): void {
    if (this.currentWeights && this.originalWeights) {
      this.currentWeights[i][j] = this.originalWeights[i][j];
      this.modifiedWeights.delete(`${i},${j}`);
    }
    this.send({ type: 'reset_weight', i, j });
  }

  /** Restore ALL weights to their TVB original values. */
  resetAllWeights(): void {
    if (this.currentWeights && this.originalWeights) {
      this.currentWeights = this.originalWeights.map((r) => [...r]);
      this.modifiedWeights.clear();
    }
    this.send({ type: 'reset_all_weights' });
  }

  // -- PR3: sustained bias input (range −1..+1, 0 = off) ---------------
  /** Set the sustained bias on `node` (a continuous input added to P
   *  every step, NOT a pulse).  Clamped to [−1, +1]; 0 clears it.
   *  Returns the value actually stored. */
  setBias(node: number, value: number): number {
    const clamped = Math.min(BIAS_MAX, Math.max(BIAS_MIN, value));
    if (clamped === 0) {
      this.biasMap.delete(node);
      this.send({ type: 'clear_bias', node });
    } else {
      this.biasMap.set(node, clamped);
      this.send({ type: 'set_bias', node, value: clamped });
    }
    return clamped;
  }

  /** Clear the sustained bias on one node (back to 0 = no bias). */
  clearBias(node: number): void {
    this.biasMap.delete(node);
    this.send({ type: 'clear_bias', node });
  }

  /** Clear the sustained bias on all nodes. */
  clearAllBias(): void {
    this.biasMap.clear();
    this.send({ type: 'clear_all_bias' });
  }

  /** Current sustained bias on `node` (0 = no bias). */
  getBias(node: number): number {
    return this.biasMap.get(node) ?? 0;
  }

  /** All nodes with a non-zero sustained bias. */
  getAllBias(): Array<{ node: number; value: number }> {
    return [...this.biasMap.entries()]
      .map(([node, value]) => ({ node, value }))
      .sort((a, b) => a.node - b.node);
  }

  // -- PR4: background activity, seeds, deterministic stepping ---------
  /** Set the background activity mode.  Only changes bg_mode (+ the
   *  sine parameters for Oscillatory); local parameters and knob values
   *  are untouched.  The Worker confirms via 'mode_applied'. */
  setBackgroundMode(mode: BackgroundMode): void {
    this.backgroundMode = mode;
    this.send({ type: 'set_background_mode', mode });
  }

  /** Current background activity mode (client-side intent; the Worker
   *  confirms it via 'mode_applied'). */
  getBackgroundMode(): BackgroundMode {
    return this.backgroundMode;
  }

  /** Last mode parameters reported by the Worker (OU tau/sigma, sine
   *  amp/freq); null before the first mode confirmation. */
  getModeParams(): ModeParams | null {
    return this.modeParams ? { ...this.modeParams } : null;
  }

  /** Change the deterministic seed (see WASM `set_seed`): future RNG
   *  draws follow the new seed from the next step on; E/I, OU state,
   *  weights and bias are NOT touched.  To replay from the start with
   *  the new seed, call `reset()` afterwards. */
  setSeed(seed: number): void {
    this.seed = Math.max(0, Math.floor(seed));
    this.send({ type: 'set_seed', seed: this.seed });
  }

  getSeed(): number {
    return this.seed;
  }

  /** Advance the engine exactly `ms` ms.  Only works while paused
   *  (the Worker ignores it while running, so step counts stay
   *  deterministic).  Used by the PR4 tests for exact reproducibility
   *  checks; the live UI never calls it. */
  advanceMs(ms: number): void {
    this.send({ type: 'advance_ms', ms });
  }

  /** Set the Worker snapshot broadcast rate (Hz).  The Worker clamps to
   *  1–120 Hz (default 60 Hz); this method mirrors that clamp so the
   *  client never asks for an out-of-range rate.  PR5 contract fix: the
   *  `set_snapshot_hz` message previously had a Worker handler but no
   *  client sender at all (orphan message).  It is exposed through the
   *  debug bridge for tests; the live UI keeps the 60 Hz default and
   *  never calls it. */
  setSnapshotHz(hz: number): void {
    const clamped = Math.min(120, Math.max(1, Math.round(hz)));
    this.send({ type: 'set_snapshot_hz', hz: clamped });
  }

  // -- PR4: experiment snapshots ----------------------------------------
  /** Save a manual snapshot (returns a promise resolved when the
   *  Worker confirms).  Manual snapshots persist in localStorage
   *  (key `MANUAL_SNAPSHOT_KEY`) and survive reloads and RESETs. */
  saveSnapshot(): Promise<{ id: string; t_ms: number }> {
    return new Promise((resolve) => {
      const list = this.snapshotWaiters.get('manual') ?? [];
      list.push(resolve);
      this.snapshotWaiters.set('manual', list);
      this.send({ type: 'save_snapshot', id: 'manual' });
    });
  }

  /** Restore a snapshot by id ('manual' | 'auto').  Resolves with the
   *  parsed summary (params / weights / bias) so the caller can re-sync
   *  the UI.  Rejects (never resolves) if no snapshot with that id
   *  exists — the caller should check `getSnapshotInfo()` first. */
  restoreSnapshot(id: string): Promise<SnapshotSummary> {
    const stored = this.snapshots.get(id);
    if (!stored) {
      return Promise.reject(new Error(`没有可恢复的快照：${id}`));
    }
    this.experiment.newRun({ seed: this.seed });
    this.pendingStimulusMarkers.clear();
    return new Promise((resolve) => {
      const list = this.restoreWaiters.get(id) ?? [];
      list.push(resolve);
      this.restoreWaiters.set(id, list);
      this.send({ type: 'restore_snapshot', id, json: stored.json });
    });
  }

  /** Which snapshots exist (Worker time + wall-clock save time). */
  getSnapshotInfo(): {
    manual: { t_ms: number; savedAtWall: number } | null;
    auto: { t_ms: number; savedAtWall: number } | null;
  } {
    const pick = (id: string) => {
      const s = this.snapshots.get(id);
      return s ? { t_ms: s.t_ms, savedAtWall: s.savedAtWall } : null;
    };
    return { manual: pick('manual'), auto: pick('auto') };
  }

  /** Re-sync the client mirrors from a restored snapshot's summary:
   *  parameters, background mode, live weights (and which edges differ
   *  from the TVB originals), sustained bias. */
  private applySnapshotSummary(summary: SnapshotSummary): void {
    this.params = { ...summary.params };
    this.backgroundMode = summary.mode;
    this.modeParams = summary.modeParams;
    if (this.originalWeights) {
      this.currentWeights = summary.weights.map((r) => [...r]);
      this.modifiedWeights.clear();
      for (let i = 0; i < summary.weights.length; i++) {
        for (let j = 0; j < summary.weights[i].length; j++) {
          const orig = this.originalWeights[i]?.[j];
          if (orig !== undefined && Math.abs(summary.weights[i][j] - orig) > 1e-12) {
            this.modifiedWeights.set(`${i},${j}`, summary.weights[i][j]);
          }
        }
      }
    }
    this.biasMap.clear();
    summary.bias.forEach((value, node) => {
      if (value !== 0) this.biasMap.set(node, value);
    });
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
      getExperimentSession: () => this.getExperimentSession(),
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
        const marker = this.mark('pulse', node, amplitude ?? this.params.stim_amplitude);
        const commandId = this.send({
          type: 'stimulus',
          node,
          amplitude: amplitude ?? this.params.stim_amplitude,
          duration_ms: duration_ms ?? this.params.stim_duration_ms,
        });
        if (commandId !== null) this.pendingStimulusMarkers.set(commandId, marker);
      },
      // PR8-LINK 调试桥：带幅度的单次脉冲（与 UI 的感觉输入 / 直播闭环相同入口）。
      pulseAt: (node: number, amplitude: number, duration_ms: number) =>
        this.pulseAt(node, amplitude, duration_ms),
      holdStart: (node: number) => this.holdStart(node),
      holdEnd: (node: number) => this.holdEnd(node),
      retractHold: (node: number) => this.retractHold(node),
      setParams: (p: Partial<SimParams>) => this.setParams(p),
      pause: () => this.pause(),
      resume: () => this.resume(),
      reset: () => this.reset(),
      resetPaused: () => this.resetPaused(),
      isReady: () => this.isReady(),
      getError: () => this.getError(),
      // PR3 调试桥：权重与偏置（只读已发送的值 + 与 UI 相同的命令，
      // 不产生额外活动；因果行为本身由脉冲响应验证）。
      setWeight: (i: number, j: number, w: number) => this.setWeight(i, j, w),
      getWeight: (i: number, j: number) => this.getWeight(i, j),
      getOriginalWeight: (i: number, j: number) => this.getOriginalWeight(i, j),
      getWeights: () => this.getWeights(),
      getOriginalWeights: () => this.getOriginalWeights(),
      getModifiedWeights: () => this.getModifiedWeights(),
      resetWeight: (i: number, j: number) => this.resetWeight(i, j),
      resetAllWeights: () => this.resetAllWeights(),
      setBias: (node: number, value: number) => this.setBias(node, value),
      getBias: (node: number) => this.getBias(node),
      getAllBias: () => this.getAllBias(),
      clearBias: (node: number) => this.clearBias(node),
      clearAllBias: () => this.clearAllBias(),
      // PR4 调试桥：背景模式 / 种子 / 确定性步进 / 快照（只读已发送的
      // 值 + 与 UI 相同的命令，不产生额外活动）。
      setBackgroundMode: (mode: BackgroundMode) => this.setBackgroundMode(mode),
      getBackgroundMode: () => this.getBackgroundMode(),
      getModeParams: () => this.getModeParams(),
      setSeed: (seed: number) => this.setSeed(seed),
      getSeed: () => this.getSeed(),
      advanceMs: (ms: number) => this.advanceMs(ms),
      setSnapshotHz: (hz: number) => this.setSnapshotHz(hz),
      saveSnapshot: () => this.saveSnapshot(),
      restoreSnapshot: (id: string) => this.restoreSnapshot(id),
      getSnapshotInfo: () => this.getSnapshotInfo(),
    };
  }
}
