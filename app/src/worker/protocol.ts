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
  /** 刺激幅度（模型单位），STIMULUS 旋钮非线性映射结果，范围 0.5–2.0。 */
  stim_amplitude: number;
  /** 脉冲持续时间 ms（DURATION 旋钮），范围 20–500。 */
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
  | { type: 'set_snapshot_hz'; hz: number };

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
  diverged: boolean;
  divergence_detail: string;
  paused: boolean;
}

export type WorkerOutMessage =
  | { type: 'ready'; n_nodes: number; dt_ms: number }
  | Snapshot
  | { type: 'error'; message: string };
