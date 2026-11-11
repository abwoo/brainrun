/**
 * 仿真 Worker（Phase 3，module worker）。
 *
 * - 在 Worker 内初始化 WASM 引擎（演示预设），用 setTimeout 循环推进：
 *   模型按真实时间 1 ms 步进（每 tick 按流逝的墙钟时间补步，上限 200 步，
 *   避免后台切回后追赶失控），约 60 Hz 向主线程发快照。
 * - 暂停时不推进（时钟冻结），恢复后从断点继续；重置回到确定性初态
 *   并继续运行（reset 同时清零 Worker 内的 paused 标志，见 B6b 修复）。
 * - 脉冲与按住都是刺激事件：脉冲 [start, start+duration)，按住用极长
 *   duration 的事件，松开即删除。参数修改通过明确事件提交，只影响后续步。
 * - 快照只读：Worker 不做任何视觉加工；锁定判断只读全网平均 E。
 */
import type { Snapshot, WorkerInMessage, WorkerOutMessage } from './protocol';

/**
 * wasm-bindgen --target web 产物的结构化类型（与
 * app/public/wasm/brain_wasm.d.ts 一致）。不用 `typeof import(...)`，
 * 因为 '/wasm/...' 是运行时才解析的 public 资源路径，TS 无法解析。
 */
interface WasmSimInstance {
  n_nodes(): number;
  dt_ms(): number;
  time_ms(): number;
  step(): boolean;
  advance(ms: number): number;
  add_stimulus(node: number, start_ms: number, duration_ms: number, amplitude: number): void;
  clear_stimuli_on_node(node: number): void;
  set_g(g: number): void;
  g(): number;
  set_c_ei(v: number): void;
  c_ei(): number;
  set_stim_amplitude(a: number): void;
  stim_amplitude(): number;
  set_stim_duration_ms(d: number): void;
  stim_duration_ms(): number;
  // PR3 — direct manipulation (see crates/brain-wasm/src/lib.rs).
  set_weight(i: number, j: number, w: number): number;
  get_weight(i: number, j: number): number;
  original_weight(i: number, j: number): number;
  get_weights(): Float64Array;
  reset_weight(i: number, j: number): number;
  reset_all_weights(): void;
  set_bias(node: number, value: number): number;
  get_bias(node: number): number;
  clear_bias(node: number): void;
  clear_all_bias(): void;
  reset(): void;
  snapshot_e(): Float64Array;
  snapshot_i(): Float64Array;
  snapshot_p(): Float64Array;
  diverged(): boolean;
  divergence_detail(): string;
  mean_e(): number;
}

interface WasmModuleShape {
  default: () => Promise<unknown>;
  WasmSim: new (weights: Float64Array, lengths: Float64Array) => WasmSimInstance;
}

// wasm-bindgen --target web 的产物放在 app/public/wasm/；
// BASE_URL 在本地为 '/'、GitHub Pages 构建时为 '/brainrun/'，
// 用 import.meta.env.BASE_URL 拼地址，两边都对。
// @vite-ignore 让 Vite 不要尝试打包这个运行时地址。
async function loadWasm(): Promise<WasmModuleShape> {
  const url = `${import.meta.env.BASE_URL}wasm/brain_wasm.js`;
  const mod = (await import(/* @vite-ignore */ url)) as unknown as WasmModuleShape;
  await mod.default();
  return mod;
}

const LOCK_MEAN_E = 0.15; // 见 protocol.ts
const LOCK_WINDOW_MS = 500;
const MAX_CATCHUP_STEPS = 200;

let sim: WasmSimInstance | null = null;

let running = false;
let paused = false;
let snapshotHz = 60;
let lastTickWall = 0;
/** 每次 tick 实际推进的步数换算：累计墙钟毫秒。 */
let wallAccumMs = 0;

/** 待发送的脉冲事件（绝对仿真时间）。 */
let pulses: Array<{ node: number; start_ms: number; duration_ms: number; amplitude: number }> = [];
/** 进行中的按住（节点集合）。按住事件在收到消息时立即提交进引擎，
 * 收到松开消息时立即删除——不经过 tick 中转，否则一次快点击若被
 * 主线程卡顿拖成“按住”，开始与结束消息可能落在同一个 tick 间隙里，
 * 事件还没进引擎就被删掉，刺激就丢了。 */
const holds = new Set<number>();

/** 最近快照的全网平均 E（时间戳，仿真 ms），用于锁定判断。 */
const meanHistory: Array<{ t_ms: number; mean_e: number }> = [];

function post(msg: WorkerOutMessage): void {
  (self as unknown as { postMessage: (m: WorkerOutMessage) => void }).postMessage(msg);
}

function snapshot(): Snapshot | null {
  if (!sim) return null;
  const t_ms = sim.time_ms();
  const e = Float64Array.from(sim.snapshot_e());
  const i = Float64Array.from(sim.snapshot_i());
  const p = Float64Array.from(sim.snapshot_p());
  const mean_e = sim.mean_e();
  meanHistory.push({ t_ms, mean_e });
  while (meanHistory.length > 0 && t_ms - meanHistory[0].t_ms > LOCK_WINDOW_MS) {
    meanHistory.shift();
  }
  const windowMs = meanHistory.length > 0 ? t_ms - meanHistory[0].t_ms : 0;
  const locked =
    windowMs >= LOCK_WINDOW_MS * 0.9 &&
    meanHistory.length > 0 &&
    meanHistory.every((h) => h.mean_e > LOCK_MEAN_E);
  return {
    type: 'snapshot',
    t_ms,
    e,
    i,
    p,
    mean_e,
    locked,
    diverged: sim.diverged(),
    divergence_detail: sim.divergence_detail(),
    paused,
  };
}

function tick(): void {
  if (!running || !sim) return;
  const now = Date.now();
  const elapsed = lastTickWall === 0 ? 0 : now - lastTickWall;
  lastTickWall = now;
  if (!paused && !sim.diverged()) {
    wallAccumMs += elapsed;
    let steps = Math.floor(wallAccumMs);
    if (steps > MAX_CATCHUP_STEPS) {
      // 后台切回等情况：丢弃追赶，只推进上限步数，避免雪崩。
      steps = MAX_CATCHUP_STEPS;
      wallAccumMs = 0;
    } else {
      wallAccumMs -= steps;
    }
    // 把当前脉冲事件同步进引擎（绝对仿真时间），只提交一次。
    // 脉冲的 start 已是过去时间也没关系：引擎按 [start, start+dur)
    // 判断，剩余时长照常生效；tick 间隔约 16 ms，远小于脉冲时长。
    for (const pulse of pulses) {
      sim.add_stimulus(pulse.node, pulse.start_ms, pulse.duration_ms, pulse.amplitude);
    }
    pulses = [];
    if (steps > 0) sim.advance(steps);
  }
  const snap = snapshot();
  if (snap) post(snap);
  setTimeout(tick, Math.round(1000 / snapshotHz));
}

self.addEventListener('message', (ev: MessageEvent<WorkerInMessage>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'init': {
        if (sim) return; // 只初始化一次
        void loadWasm().then((mod) => {
          sim = new mod.WasmSim(
            new Float64Array(msg.weights),
            new Float64Array(msg.lengths),
          );
          running = true;
          paused = false;
          lastTickWall = Date.now();
          post({ type: 'ready', n_nodes: sim!.n_nodes(), dt_ms: sim!.dt_ms() });
          setTimeout(tick, Math.round(1000 / snapshotHz));
        }).catch((err: unknown) => {
          post({ type: 'error', message: `WASM 加载失败: ${err instanceof Error ? err.message : String(err)}` });
        });
        return;
      }
      case 'stimulus': {
        if (!sim) return;
        pulses.push({
          node: msg.node,
          start_ms: sim.time_ms(),
          duration_ms: msg.duration_ms,
          amplitude: msg.amplitude,
        });
        return;
      }
      case 'hold_start': {
        if (!sim) return;
        if (!holds.has(msg.node)) {
          holds.add(msg.node);
          sim.add_stimulus(msg.node, sim.time_ms(), 1e9, msg.amplitude);
        }
        return;
      }
      case 'hold_end': {
        if (!sim) return;
        if (holds.has(msg.node)) {
          holds.delete(msg.node);
          sim.clear_stimuli_on_node(msg.node);
        }
        return;
      }
      case 'set_params': {
        if (!sim) return;
        const p = msg.params;
        if (p.g !== undefined) sim.set_g(p.g);
        if (p.c_ei !== undefined) sim.set_c_ei(p.c_ei);
        if (p.stim_amplitude !== undefined) sim.set_stim_amplitude(p.stim_amplitude);
        if (p.stim_duration_ms !== undefined) sim.set_stim_duration_ms(p.stim_duration_ms);
        return;
      }
      // PR3 — direct manipulation.  Weight edits take effect from the
      // next step and survive reset (the engine keeps them; only the
      // reset_weight / reset_all_weights messages change them back).
      // Bias is an applied input and is cleared by reset.
      case 'set_weight': {
        if (!sim) return;
        sim.set_weight(msg.i, msg.j, msg.w);
        return;
      }
      case 'reset_weight': {
        if (!sim) return;
        sim.reset_weight(msg.i, msg.j);
        return;
      }
      case 'reset_all_weights': {
        if (!sim) return;
        sim.reset_all_weights();
        return;
      }
      case 'set_bias': {
        if (!sim) return;
        sim.set_bias(msg.node, msg.value);
        return;
      }
      case 'clear_bias': {
        if (!sim) return;
        sim.clear_bias(msg.node);
        return;
      }
      case 'clear_all_bias': {
        if (!sim) return;
        sim.clear_all_bias();
        return;
      }
      case 'pause': {
        paused = true;
        wallAccumMs = 0;
        return;
      }
      case 'resume': {
        paused = false;
        lastTickWall = Date.now();
        wallAccumMs = 0;
        return;
      }
      case 'reset': {
        if (!sim) return;
        sim.reset();
        pulses = [];
        holds.clear();
        meanHistory.length = 0;
        wallAccumMs = 0;
        lastTickWall = Date.now();
        // Reset 恢复的是“确定性初始状态 + 继续运行”：paused 标志也必须清零。
        // paused 只活在 Worker 里，快照把它回传、界面只读快照镜像它——
        // 若 reset 不清 paused，界面以为在运行而 Worker 一直停着（B6b：
        // Pause 后点 RESET，TIME 永远停在 0.0 s）。不要在 App 侧再发一个
        // resume 来“修”它：那样会留下两个事实来源，下一个只调 reset 的
        // 调用方（例如测试桥）还会踩同一个坑。
        paused = false;
        return;
      }
      case 'set_snapshot_hz': {
        snapshotHz = Math.min(120, Math.max(1, msg.hz));
        return;
      }
    }
  } catch (err: unknown) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
