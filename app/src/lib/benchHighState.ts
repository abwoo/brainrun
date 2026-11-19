/**
 * Bench brain-q 高状态判断（2026-11-19 stuck-q 调查）。
 *
 * 背景：重复 oddball 会把双稳态网络翻进高活动态，q 读数随之停在一个数
 * 上不动（本地实测：翻进高态后 E[0] 0.4996、meanE 0.461、q 2.899 连停
 * 30 秒以上；模型时钟照常走、求解器没冻住；重置后 E 回 0.015、q 重新
 * 波动）。这不是显示 bug，是真实的高稳态；台子主视图必须在 q 读数旁
 * 边用人话讲清这一点。
 *
 * 信号：直接用 Worker 自己的锁定闩 `snap.locked`，不另发明阈值。
 * Worker（app/src/worker/simWorker.ts）里 LOCK_MEAN_E = 0.15、窗口
 * 500 ms：全网平均 E 在窗口内持续 > 0.15 就闩住，直到 RESET 或恢复快
 * 照才清掉；闩住本身就是“高态不会自己退回”的意思。主工作区
 * NetworkStatePanel 的 'high' 状态用的也是同一组门
 * （`s.locked && s.mean_e > .15`，节点再加 `s.e[selectedId] > .15`），
 * 这里照抄，不另起一套口径。
 *
 * 本次实测与阈值的距离（2026-11-19 本地预览，oddball 21 试次）：
 * 安静基线 meanE 0.015、E[0] 0.010–0.020；高态 meanE 0.461、E[0]
 * 0.4996。0.15 夹在两者中间，两边都有 7 倍以上的余量。
 */
export const BENCH_HIGH_STATE_MEAN_E = 0.15;
export const BENCH_HIGH_STATE_NODE_E = 0.15;

/** `isBenchQHighState` 只读的最小快照形状（Worker Snapshot 的子集）。 */
export interface BenchHighStateSnapshot {
  /** Worker 锁定闩：高态一旦成立就闩住，直到 RESET/恢复快照。 */
  locked: boolean;
  /** 全网平均 E。 */
  mean_e: number;
  /** 各节点 E（Float64Array 或普通数组都行）。 */
  e: ArrayLike<number>;
}

/**
 * q 跟的那个脑区是不是正处在网络高态里：网络已锁定、且全网平均 E
 * 与该脑区 E 都高于引擎锁定阈值 0.15。三个条件缺一不可——只看 locked
 * 会在闩住后均值回落时误报；只看均值会把单次强刺激的瞬态抬升当成
 * 高态；不看 qNode 的 E 会在用户选了一个没翻高的脑区时错怪 q。
 * snap 为空或 qNode 越界时返回 false（不显示说明，而不是猜一个）。
 */
export function isBenchQHighState(
  snap: BenchHighStateSnapshot | null | undefined,
  qNode: number,
): boolean {
  if (!snap || !snap.locked) return false;
  if (!(snap.mean_e > BENCH_HIGH_STATE_MEAN_E)) return false;
  const nodeE = snap.e?.[qNode];
  return (
    typeof nodeE === 'number' &&
    Number.isFinite(nodeE) &&
    nodeE > BENCH_HIGH_STATE_NODE_E
  );
}
