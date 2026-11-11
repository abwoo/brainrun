/**
 * Worker <-> 主线程协议（Phase 3）。
 *
 * 仿真时钟只在 Worker 里推进（固定 1 ms 步长，与屏幕刷新解耦）；
 * 主线程只发命令、只读快照。快照里只有模型状态，没有任何视觉加工。
 */

export interface SimParams {
  /** 全局耦合斜率 G，范围 0–0.4（Phase 2：>= 0.5 基线翻转）。 */
  g: number;
  /** 抑制自耦合 c_ei，范围 3–8（Phase 2：降到 2 会翻转全网）。 */
  c_ei: number;
  /** 刺激幅度（模型单位），STIMULUS 滑杆非线性映射结果，UI 暴露范围
   *  0.5–2.0。引擎侧 clamp 同样是 0.5–2.0（crates/brain-wasm/src/lib.rs
   *  set_stim_amplitude，PR6 R1 已从旧的更宽范围收紧，与 UI 相等），所以
   *  前端发出的值一定能被引擎原样接受。注意：这只管默认脉冲幅度
   *  参数；调试桥 pulse(node, amplitude?) 的单次事件幅度经 add_stimulus
   *  直接入队，不钳制。见 docs/frontend-backend-contract.md §1.2。 */
  stim_amplitude: number;
  /** 脉冲持续时间 ms（DURATION 滑杆），范围 20–500。 */
  stim_duration_ms: number;
}

export type WorkerInMessage =
  | { type: 'init'; weights: number[]; lengths: number[] }
  | { type: 'stimulus'; node: number; amplitude: number; duration_ms: number }
  | { type: 'hold_start'; node: number; amplitude: number }
  | { type: 'hold_end'; node: number }
  | { type: 'set_params'; params: Partial<SimParams> }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'reset' }
  // reset_paused: atomic reset + pause in one message.  Sending reset
  // then pause as two messages leaves a race window where live ticks
  // run between them and consume RNG draws, so same-seed reruns would
  // differ (measured: t_ms up to 50 ms within 120 ms of a reset).
  // Deterministic stepping (advance_ms) must use this, never reset+pause.
  | { type: 'reset_paused' }
  | { type: 'set_snapshot_hz'; hz: number }
  // PR3 — direct manipulation.  Weights are structural edits: they take
  // effect from the next step and SURVIVE reset (only the reset_weight /
  // reset_all_weights messages change them back).  Bias is an applied
  // input: it is cleared by reset, like stimuli.
  | { type: 'set_weight'; i: number; j: number; w: number }
  | { type: 'reset_weight'; i: number; j: number }
  | { type: 'reset_all_weights' }
  | { type: 'set_bias'; node: number; value: number }
  | { type: 'clear_bias'; node: number }
  | { type: 'clear_all_bias' }
  // PR4 — background activity, deterministic stepping, snapshots.
  // set_background_mode only changes bg_mode (+ the sine parameters for
  // Oscillatory); local Wilson–Cowan parameters and knob values are
  // untouched.  advance_ms steps the engine exactly N ms and only
  // works while paused (deterministic test / replay stepping).
  // save_snapshot stores a complete experiment snapshot in the Worker
  // and reports it to the main thread (which persists manual snapshots
  // in localStorage); restore_snapshot restores one by id + JSON.
  // The 'auto' snapshot is taken by the Worker itself at hold start,
  // before the hold event is added, and never overwrites 'manual'.
  | { type: 'set_background_mode'; mode: 'quiet' | 'spontaneous' | 'oscillatory' }
  | { type: 'set_seed'; seed: number }
  | { type: 'advance_ms'; ms: number }
  | { type: 'save_snapshot'; id: string }
  | { type: 'restore_snapshot'; id: string; json: string };

/** Background mode as reported back after a mode change. */
export interface ModeParams {
  mode: 'quiet' | 'spontaneous' | 'oscillatory';
  /** OU correlation time (ms) — Spontaneous mode. */
  ou_tau_ms: number;
  /** OU stationary std (model units of P) — Spontaneous mode. */
  ou_sigma: number;
  /** External sine amplitude (model units of P) — Oscillatory mode. */
  ext_sine_amp: number;
  /** External sine frequency (Hz) — Oscillatory mode. */
  ext_sine_freq_hz: number;
}

export interface Snapshot {
  type: 'snapshot';
  /** 仿真时间 ms。 */
  t_ms: number;
  /** 76 节点 E。 */
  e: Float64Array;
  /** 76 节点 I。 */
  i: Float64Array;
  /** 上一步实际施加的 P。 */
  p: Float64Array;
  /** 全网平均 E。 */
  mean_e: number;
  /**
   * 网络锁定标志：过去 500 ms 仿真时间内全网平均 E 持续 > 0.15。
   * 演示预设基线均值 E 约 0.011，锁住态约 0.24（Phase 2 实测），
   * 阈值 0.15 夹在两者之间；瞬态响应（<500 ms）不会误报。
   */
  locked: boolean;
  /**
   * PR4 — 长按预警：当前有按住输入在进行中（hold_active），且全网
   * 平均 E 已明显高于基线（> 0.05）但尚未锁定（approaching_lock）。
   * lock_progress = mean_e / 0.15（0–1），即“离锁定还有多远”；
   * hold_ms 是当前按住已持续的仿真毫秒数。锁定本身是网络进入了
   * 新的稳定状态，不是软件卡住；松开即停输入，一键可恢复到按住前。
   */
  hold_active: boolean;
  hold_node: number | null;
  hold_ms: number;
  lock_progress: number;
  approaching_lock: boolean;
  diverged: boolean;
  divergence_detail: string;
  paused: boolean;
}

export type WorkerOutMessage =
  | { type: 'ready'; n_nodes: number; dt_ms: number }
  | Snapshot
  | { type: 'mode_applied'; params: ModeParams }
  | { type: 'snapshot_saved'; id: string; t_ms: number; json: string }
  | { type: 'snapshot_restored'; id: string; t_ms: number }
  | { type: 'error'; message: string };
