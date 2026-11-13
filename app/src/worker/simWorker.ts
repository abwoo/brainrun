import {NativeFeedback,type NativeFeedbackSnapshot,type FeedbackAction} from '../lib/nativeFeedback';
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
import { advanceAcquiring } from '../lib/nativeAcquisition';
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
  // PR4 — background activity, seeds, snapshots.
  set_background_mode(mode: number): number;
  background_mode(): number;
  set_seed(seed: number): void;
  seed(): number;
  ou_tau_ms(): number;
  ou_sigma(): number;
  drive_const(): number;
  ext_sine_amp(): number;
  ext_sine_freq_hz(): number;
  snapshot_ou(): Float64Array;
  take_snapshot(): string;
  restore_snapshot(json: string): void;
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
/** PR4：按住预警阈值——全网平均 E 超过它且有按住在进行中时，视为
 * “正在走向锁定”，在锁定发生前就提示。基线约 0.011、锁定 0.15，
 * 0.05 夹在中间且远高于一次脉冲的瞬态均值。 */
const APPROACH_MEAN_E = 0.05;
const MAX_CATCHUP_STEPS = 200;

let sim: WasmSimInstance | null = null;

let feedback:NativeFeedback|null=null;
let running = false;
let paused = false;
let snapshotHz = 60;
/** Authoritative identity for every fixed-step neural trajectory. */
let runId = '';
let lastTickWall = 0;
/** 每次 tick 实际推进的步数换算：累计墙钟毫秒。 */
let wallAccumMs = 0;

/** 待发送的脉冲事件（绝对仿真时间）。 */
let pulses: Array<{ node: number; start_ms: number; duration_ms: number; amplitude: number }> = [];
let activeInputs:Array<{node:number;start_ms:number;duration_ms:number;amplitude:number}>=[];
/** 进行中的按住（节点 → 按住开始的仿真时间 ms）。按住事件在收到消息时
 * 立即提交进引擎，收到松开消息时立即删除——不经过 tick 中转，否则一次
 * 快点击若被主线程卡顿拖成“按住”，开始与结束消息可能落在同一个 tick
 * 间隙里，事件还没进引擎就被删掉，刺激就丢了。 */
const holds = new Map<number, number>();

/** PR4：Worker 内保存的实验快照（id → {仿真时间, JSON}）。'manual' 是
 * 用户手动保存的（主线程同时存一份进 localStorage）；'auto' 是每次按住
 * 开始时自动存的（按住开始前那一刻的状态），只活在内存里，RESET 时清掉，
 * 绝不覆盖 'manual'。 */
const snapshots = new Map<string, { t_ms: number; json: string }>();

/** 最近快照的全网平均 E（时间戳，仿真 ms），用于锁定判断。 */
const meanHistory: Array<{ t_ms: number; mean_e: number }> = [];

/**
 * 锁定闩：网络是双稳态，高活动态不会自己退回，所以锁定一旦成立就闩住，
 * 直到 RESET 或恢复快照才清掉。不闩的话，锁定判断会在阈值附近来回翻，
 * 警告横幅与锁定横幅反复切换，横幅上的恢复按钮跟着反复卸载，用户点不上。
 */
let lockedLatched = false;

function post(msg: WorkerOutMessage): void {
  (self as unknown as { postMessage: (m: WorkerOutMessage) => void }).postMessage(msg);
}

function acknowledge(msg: WorkerInMessage, phase: 'accepted' | 'applied' = 'applied'): void {
  // An ACK is sent AFTER the Worker has handled the command, never at click
  // dispatch time. Stimulus means accepted/queued with start=sim.time_ms().
  if (sim && msg.command_id !== undefined && msg.run_id) {
    post({
      type: 'command_ack',
      run_id: msg.run_id,
      command_id: msg.command_id,
      command_type: msg.type,
      t_ms: sim.time_ms(),
      phase,
    });
  }
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
  const lockNow =
    windowMs >= LOCK_WINDOW_MS * 0.9 &&
    meanHistory.length > 0 &&
    meanHistory.every((h) => h.mean_e > LOCK_MEAN_E);
  if (lockNow) lockedLatched = true;
  const locked = lockedLatched;
  // PR4：按住预警。hold_active = 有按住在进行；approaching_lock =
  // 按住中且均值已明显抬升（> 0.05）但尚未锁定；lock_progress =
  // mean_e / 0.15（0–1），即离锁定阈值还有多远。
  const holdEntries = [...holds.entries()];
  const hold_active = holdEntries.length > 0;
  const hold_node = hold_active ? holdEntries[0][0] : null;
  const hold_ms = hold_active ? t_ms - Math.min(...holdEntries.map(([, s]) => s)) : 0;
  const lock_progress = Math.min(1, Math.max(0, mean_e / LOCK_MEAN_E));
  const approaching_lock = hold_active && mean_e > APPROACH_MEAN_E && !locked;
  return {
    type: 'snapshot',
    run_id: runId,
    t_ms,
    e,
    i,
    p,
    mean_e,
    locked,
    hold_active,
    hold_node,
    hold_ms,
    lock_progress,
    approaching_lock,
    diverged: sim.diverged(),
    divergence_detail: sim.divergence_detail(),
    paused,
  };
}

function feedbackReport(phase:'configured'|'detected'|'applied'|'stopped'|'restored',action?:FeedbackAction):void {
 if(sim)post({type:'native_feedback',run_id:runId,phase,t_ms:sim.time_ms(),active:feedback?.active??false,state:feedback?.snapshot()??null,...(action?{action}:{})});
}
function applyInput(node:number,start_ms:number,duration_ms:number,amplitude:number):void {
 if(!sim)return;sim.add_stimulus(node,start_ms,duration_ms,amplitude);
 activeInputs.push({node,start_ms,duration_ms,amplitude});
}
function validateInputHistory(inputs:typeof pulses):void {
 if(!sim||!Array.isArray(inputs)||inputs.some(p=>!Number.isInteger(p.node)||p.node<0||p.node>=sim!.n_nodes()||
  !Number.isFinite(p.start_ms)||p.start_ms<0||!Number.isFinite(p.duration_ms)||p.duration_ms<=0||!Number.isFinite(p.amplitude)))
  throw new Error('Invalid snapshot input history');
}
function fullSnapshot():string {
 if(!sim)throw new Error('Engine not ready');
 activeInputs=activeInputs.filter(p=>p.start_ms+p.duration_ms>sim!.time_ms());
 return JSON.stringify({...JSON.parse(sim.take_snapshot()),brainrun_native_feedback:feedback?.snapshot()??null,
  brainrun_pending_pulses:pulses,brainrun_active_inputs:activeInputs,brainrun_holds:[...holds.entries()]});
}
function acquireAdvance(ms:number):void {
 if(!sim)return;
 for(const pulse of pulses)applyInput(pulse.node,pulse.start_ms,pulse.duration_ms,pulse.amplitude);
 pulses=[];
 let remaining=Math.max(0,Math.round(ms/sim.dt_ms()))*sim.dt_ms();
 while(remaining>0&&!sim.diverged()){
  const block=Math.min(remaining,200);
  post(advanceAcquiring(sim,block,runId,{
   beforeStep:t=>{for(const action of feedback?.beforeStep(t)??[]){applyInput(action.node,t,action.durationMs,action.amplitude);feedbackReport('applied',action);}},
   afterStep:(t,e)=>{const action=feedback?.afterStep(t,e);if(action)feedbackReport('detected',action);}
  }));remaining-=block;
  activeInputs=activeInputs.filter(p=>p.start_ms+p.duration_ms>sim!.time_ms());
 }
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
      applyInput(pulse.node, pulse.start_ms, pulse.duration_ms, pulse.amplitude);
    }
    pulses = [];
    if (steps > 0) acquireAdvance(steps);
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
        if (sim) return;
        runId = msg.run_id ?? ''; // 只初始化一次
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
        acknowledge(msg, 'accepted');
        return;
      }
      case 'hold_start': {
        if (!sim) return;
        if (!holds.has(msg.node)) {
          // PR4：按住开始前先存自动快照（按住前那一刻的完整状态），
          // 再加按住事件——恢复它就是“回到按住前”。自动快照只活在
          // Worker 内存里，绝不覆盖用户手动保存的快照。
          const json = fullSnapshot();
          const t_ms = sim.time_ms();
          snapshots.set('auto', { t_ms, json });
          post({ type: 'snapshot_saved', id: 'auto', t_ms, json, run_id: runId });
          holds.set(msg.node, t_ms);
          applyInput(msg.node, t_ms, 1e9, msg.amplitude);
        }
        acknowledge(msg);
        return;
      }
      case 'hold_end': {
        if (!sim) return;
        if (holds.has(msg.node)) {
          holds.delete(msg.node);
          sim.clear_stimuli_on_node(msg.node);activeInputs=activeInputs.filter(p=>p.node!==msg.node);
        }
        acknowledge(msg);
        return;
      }
      case 'set_params': {
        if (!sim) return;
        const p = msg.params;
        if (p.g !== undefined) sim.set_g(p.g);
        if (p.c_ei !== undefined) sim.set_c_ei(p.c_ei);
        if (p.stim_amplitude !== undefined) sim.set_stim_amplitude(p.stim_amplitude);
        if (p.stim_duration_ms !== undefined) sim.set_stim_duration_ms(p.stim_duration_ms);
        acknowledge(msg);
        return;
      }
      // PR3 — direct manipulation.  Weight edits take effect from the
      // next step and survive reset (the engine keeps them; only the
      // reset_weight / reset_all_weights messages change them back).
      // Bias is an applied input and is cleared by reset.
      case 'set_weight': {
        if (!sim) return;
        sim.set_weight(msg.i, msg.j, msg.w);
        acknowledge(msg);
        return;
      }
      case 'reset_weight': {
        if (!sim) return;
        sim.reset_weight(msg.i, msg.j);
        acknowledge(msg);
        return;
      }
      case 'reset_all_weights': {
        if (!sim) return;
        sim.reset_all_weights();
        acknowledge(msg);
        return;
      }
      case 'set_bias': {
        if (!sim) return;
        sim.set_bias(msg.node, msg.value);
        acknowledge(msg);
        return;
      }
      case 'clear_bias': {
        if (!sim) return;
        sim.clear_bias(msg.node);
        acknowledge(msg);
        return;
      }
      case 'clear_all_bias': {
        if (!sim) return;
        sim.clear_all_bias();
        acknowledge(msg);
        return;
      }
      case 'pause': {
        paused = true;
        wallAccumMs = 0;
        acknowledge(msg);
        return;
      }
      case 'resume': {
        paused = false;
        lastTickWall = Date.now();
        wallAccumMs = 0;
        acknowledge(msg);
        return;
      }
      case 'reset':
      case 'reset_paused': {
        if (!sim) return;
        sim.reset();feedback=null;activeInputs=[];
        pulses = [];
        holds.clear();
        meanHistory.length = 0;
        lockedLatched = false;
        wallAccumMs = 0;
        lastTickWall = Date.now();
        // PR4：RESET 清掉自动快照（它对应的是“按住前”，按住已随 RESET
        // 消失，留着会把用户带回一次已作废的按住前状态）；手动快照是
        // 用户存的东西，RESET 不动它。
        snapshots.delete('auto');
        // Reset 恢复的是“确定性初始状态 + 继续运行”：paused 标志也必须清零。
        // paused 只活在 Worker 里，快照把它回传、界面只读快照镜像它——
        // 若 reset 不清 paused，界面以为在运行而 Worker 一直停着（B6b：
        // Pause 后点 RESET，TIME 永远停在 0.0 s）。不要在 App 侧再发一个
        // resume 来“修”它：那样会留下两个事实来源，下一个只调 reset 的
        // 调用方（例如测试桥）还会踩同一个坑。
        // reset_paused 是原子复位+暂停（确定性步进用）：reset 与 pause
        // 分两条消息发，中间会漏进 live tick——tick 推进 OU 并消耗
        // RNG，次数随时间抖动，同种子重跑就不再逐值相等（实测 reset 后
        // 120 ms 内 t_ms 能跑到 50 ms）。单条消息内处理，tick 不可能
        // 插进来，复位后状态才是确定的。
        paused = msg.type === 'reset_paused';
        if (msg.run_id) runId = msg.run_id;
        acknowledge(msg);feedbackReport('stopped');
        return;
      }
      // PR4 — background mode / seed / deterministic stepping / snapshots.
      case 'set_background_mode': {
        if (!sim) return;
        const code = msg.mode === 'quiet' ? 0 : msg.mode === 'spontaneous' ? 1 : 2;
        sim.set_background_mode(code);
        const mode = (['quiet', 'spontaneous', 'oscillatory'] as const)[sim.background_mode()];
        acknowledge(msg);
        post({
          type: 'mode_applied',
          params: {
            mode,
            ou_tau_ms: sim.ou_tau_ms(),
            ou_sigma: sim.ou_sigma(),
            ext_sine_amp: sim.ext_sine_amp(),
            ext_sine_freq_hz: sim.ext_sine_freq_hz(),
          },
        });
        return;
      }
      case 'set_seed': {
        if (!sim) return;
        sim.set_seed(msg.seed);
        acknowledge(msg);
        return;
      }
      case 'advance_ms': {
        // 只在暂停时推进：确定性步进（测试用）。运行中收到就忽略，
        // 否则 tick 循环会与这次推进重叠、步数不再确定。
        if (!sim || !paused) return;
        acquireAdvance(msg.ms);
        acknowledge(msg);
        const snap = snapshot();
        if (snap) post(snap);
        return;
      }
      case 'save_snapshot': {
        if (!sim) return;
        const json = fullSnapshot();
        const t_ms = sim.time_ms();
        snapshots.set(msg.id, { t_ms, json });
        post({ type: 'snapshot_saved', id: msg.id, t_ms, json, run_id: runId });
        acknowledge(msg);
        return;
      }
      case 'restore_snapshot': {
        if (!sim) return;
        const stored = snapshots.get(msg.id);
        const json = msg.json || stored?.json;
        if (!json) {
          post({ type: 'error', message: `没有可恢复的快照：${msg.id}` });
          return;
        }
        const restored=JSON.parse(json) as {brainrun_native_feedback?:NativeFeedbackSnapshot|null;brainrun_pending_pulses?:typeof pulses;brainrun_active_inputs?:typeof activeInputs;brainrun_holds?:Array<[number,number]>};
        const nextFeedback=restored.brainrun_native_feedback?NativeFeedback.restore(restored.brainrun_native_feedback,sim.n_nodes()):null;
        validateInputHistory(restored.brainrun_pending_pulses??[]);validateInputHistory(restored.brainrun_active_inputs??[]);
        sim.restore_snapshot(json);feedback=nextFeedback;activeInputs=[];
        for(const p of restored.brainrun_active_inputs??[])applyInput(p.node,p.start_ms,p.duration_ms,p.amplitude);
        snapshots.set(msg.id, { t_ms: sim.time_ms(), json });
        pulses=restored.brainrun_pending_pulses??[];
        holds.clear();for(const [node,time] of restored.brainrun_holds??[])holds.set(node,time);
        meanHistory.length = 0;
        lockedLatched = false;
        wallAccumMs = 0;
        lastTickWall = Date.now();
        if (msg.run_id) runId = msg.run_id;
        post({ type: 'snapshot_restored', id: msg.id, t_ms: sim.time_ms(), run_id: runId });
        feedbackReport('restored');
        acknowledge(msg);
        const snap = snapshot();
        if (snap) post(snap);
        return;
      }
      case 'set_native_feedback': {
        if(!sim)return;
        const next=msg.config?new NativeFeedback(msg.config,sim.n_nodes(),sim.time_ms()):null;
        feedback=next;acknowledge(msg);feedbackReport(msg.config?'configured':'stopped');return;
      }
      case 'set_snapshot_hz': {
        snapshotHz = Math.min(120, Math.max(1, msg.hz));
        acknowledge(msg);
        return;
      }
    }
  } catch (err: unknown) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
});
