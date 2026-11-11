/**
 * PR5 前后端契约漂移测试（方法学测试：单位与坐标正确性）。
 *
 * 规则：直接读两边源码 / 导出值做对照，不只断言文档存在。
 * 跑法：node --experimental-strip-types --test tests/pr5/contract.test.mjs
 * 契约：docs/frontend-backend-contract.md（§1–§5 登记的值以这里为准绳）。
 *
 * 注意：本测试不依赖 CI 生成的 app/public/forward-assets/sphere-model.json
 *（该 fixture 不入库），只读源码与生成脚本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  KNOB_MAP, DEFAULT_PARAMS, WEIGHT_MIN, WEIGHT_MAX, BIAS_MIN, BIAS_MAX,
  BIAS_DEFAULT_ON, RESPONSE_THRESHOLD, RESPONSE_WINDOW_PRE_MS,
  RESPONSE_WINDOW_POST_MS, DELTA_FULL, BACKGROUND_MODES,
  DEFAULT_BACKGROUND_MODE, MANUAL_SNAPSHOT_KEY, SNAPSHOT_SCHEMA_VERSION,
} from '../../app/src/lib/simClient.ts';
import {
  DEFAULT_RATE_PARAMS, DEFAULT_MORPHOLOGY, COUPLING_ID,
} from '../../app/src/lib/localCorticalColumn.ts';
import {
  DEFAULT_CONDUCTIVITY_S_M, MODEL_ID, demoSphereSensors,
} from '../../app/src/lib/volumeConduction.ts';
import {
  SPHERE_MODEL_ID,
} from '../../app/src/lib/sphereForward.ts';
import {
  MNE_HEAD_TO_SPHERE, validateTransform,
} from '../../app/src/lib/coordinates.ts';
import {
  FSAVERAGE_BEM_MODEL_ID,
} from '../../app/src/lib/fsaverageBEM.ts';
import {
  DEFAULT_JANSEN_RIT_PARAMS, JANSEN_RIT_ID, JR_PSP_TO_CURRENT_PA_PER_MV,
} from '../../app/src/lib/jansenRitColumn.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(join(root, rel), 'utf8');

const protocolTs = src('app/src/worker/protocol.ts');
const simWorkerTs = src('app/src/worker/simWorker.ts');
const simClientTs = src('app/src/lib/simClient.ts');
const appTsx = src('app/src/App.tsx');
const brainCoreRs = src('crates/brain-core/src/lib.rs');
const brainWasmRs = src('crates/brain-wasm/src/lib.rs');
const spherePy = src('scientific/forward/generate_sphere_model.py');
const bemPy = src('scientific/forward/generate_fsaverage_bem.py');
const columnPy = src('scientific/forward/local_column_scipy_reference.py');
const jrPy = src('scientific/forward/jansen_rit_reference.py');
const jrTs = src('app/src/lib/jansenRitColumn.ts');

const near = (a, b, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) <= tol, `expected ${a} ≈ ${b} within ${tol}`);

/** 在 Rust 函数体内找 clamp(a, b)。 */
function wasmClamp(fnName) {
  const i = brainWasmRs.indexOf(`pub fn ${fnName}(`);
  assert.ok(i >= 0, `missing WASM fn ${fnName}`);
  const m = brainWasmRs.slice(i, i + 400).match(/\.clamp\(([\d.]+),\s*([\d.]+)\)/);
  assert.ok(m, `no clamp in ${fnName}`);
  return [Number(m[1]), Number(m[2])];
}

/** 在 Rust Default impl 块里找 `field: value,`。 */
function rustDefault(field) {
  const start = brainCoreRs.indexOf('impl Default for Params');
  const end = brainCoreRs.indexOf('impl Params', start);
  const block = brainCoreRs.slice(start, end);
  const m = block.match(new RegExp(`\\b${field}:\\s*([\\d.]+)`));
  assert.ok(m, `no Default.${field}`);
  return Number(m[1]);
}

test('单位常量：电导率、模型 ID、增益换算前后端一致', () => {
  assert.equal(DEFAULT_CONDUCTIVITY_S_M, 0.33);
  assert.ok(spherePy.includes('SIGMAS_S_M = (0.33, 1.0, 0.004, 0.33)'));
  assert.equal(MODEL_ID, 'homogeneous-unbounded-dipole-v1');
  assert.equal(SPHERE_MODEL_ID, 'mne-four-layer-sphere-ras-v1');
  assert.ok(spherePy.includes('"model_id": "mne-four-layer-sphere-ras-v1"'));
  // MNE 原始 V/(A.m) -> µV/(nA.m) 乘 1e-9 * 1e6。
  assert.ok(spherePy.includes('1e-9 * 1e6'));
  assert.equal(FSAVERAGE_BEM_MODEL_ID, 'fsaverage-mne-three-layer-bem-v1');
  assert.equal(COUPLING_ID, 'local-wc-cortical-column-assumed-dipole-v1');
  // 解析偶极子：传感器在 90 mm 示意球面上，不是 10-20 电极。
  for (const s of demoSphereSensors(90)) near(Math.hypot(...s.positionMm), 90, 1e-9);
  assert.equal(demoSphereSensors(90).length, 12);
});

test('四滑杆：KNOB_MAP 端点 = UI 数字框范围 ⊆ 引擎 clamp', () => {
  // KNOB_MAP 端点。
  near(KNOB_MAP.stimulusAmplitude(0), 0.5);
  near(KNOB_MAP.stimulusAmplitude(1), 2.0);
  near(KNOB_MAP.durationMs(0), 20);
  near(KNOB_MAP.durationMs(1), 500);
  near(KNOB_MAP.c_ei(0), 3);
  near(KNOB_MAP.c_ei(1), 8);
  near(KNOB_MAP.g(0), 0);
  near(KNOB_MAP.g(1), 0.4);
  // 往返互逆。
  for (const k of [0, 0.25, 0.5, 0.75, 1]) {
    near(KNOB_MAP.stimulusK(KNOB_MAP.stimulusAmplitude(k)), k);
    near(KNOB_MAP.durationK(KNOB_MAP.durationMs(k)), k);
    near(KNOB_MAP.c_eiK(KNOB_MAP.c_ei(k)), k);
    near(KNOB_MAP.gK(KNOB_MAP.g(k)), k);
  }
  // UI 数字框 min/max（App.tsx ParamControl）。
  for (const [mn, mx] of [['min={0.5}', 'max={2.0}'], ['min={20}', 'max={500}'],
    ['min={3}', 'max={8}'], ['min={0}', 'max={0.4}']]) {
    assert.ok(appTsx.includes(mn), `App.tsx 缺 ${mn}`);
    assert.ok(appTsx.includes(mx), `App.tsx 缺 ${mx}`);
  }
  // 引擎 clamp：g / c_ei / duration 与 UI 完全相等；stim_amplitude 例外——
  // 引擎 0–4.0 比 UI 0.5–2.0 宽（契约残留 R1），只断言子集关系，不伪装相等。
  assert.deepEqual(wasmClamp('set_g'), [0, 0.4]);
  assert.deepEqual(wasmClamp('set_c_ei'), [3, 8]);
  assert.deepEqual(wasmClamp('set_stim_duration_ms'), [20, 500]);
  assert.deepEqual(wasmClamp('set_stim_amplitude'), [0, 4.0]);
  assert.ok(0.5 >= 0 && 2.0 <= 4.0, 'UI stim 幅值范围必须是引擎 clamp 的子集');
  assert.ok(protocolTs.includes('0–4.0'),
    'protocol.ts 必须如实写明 stim_amplitude 引擎 clamp 与 UI 范围的差异（D1）');
});

test('默认值：前端 DEFAULT_PARAMS = Rust demo 预设', () => {
  assert.equal(DEFAULT_PARAMS.g, rustDefault('g'));
  assert.equal(DEFAULT_PARAMS.c_ei, rustDefault('c_ei'));
  assert.equal(DEFAULT_PARAMS.stim_amplitude, rustDefault('stim_amplitude'));
  assert.equal(DEFAULT_PARAMS.stim_duration_ms, rustDefault('stim_duration_ms'));
  near(DEFAULT_PARAMS.g, 0.35);
  near(DEFAULT_PARAMS.c_ei, 4.0);
  near(DEFAULT_PARAMS.stim_amplitude, 2.0);
  near(DEFAULT_PARAMS.stim_duration_ms, 100);
  // demo 预设：theta_e 0 -> 1.0（A-set 原值 0.0）。
  const demoStart = brainCoreRs.indexOf('pub fn demo()');
  assert.ok(brainCoreRs.slice(demoStart, demoStart + 300).includes('theta_e: 1.0'));
  assert.equal(rustDefault('theta_e'), 0.0);
});

test('背景模式：三模式编码、OU/正弦常量、种子语义前后一致', () => {
  assert.deepEqual(BACKGROUND_MODES, ['quiet', 'spontaneous', 'oscillatory']);
  assert.equal(DEFAULT_BACKGROUND_MODE, 'spontaneous');
  // Worker 编码 quiet=0 / spontaneous=1 / oscillatory=2。
  assert.ok(simWorkerTs.includes(
    "msg.mode === 'quiet' ? 0 : msg.mode === 'spontaneous' ? 1 : 2"));
  assert.ok(brainWasmRs.includes('0 => self.sim.params.bg_mode = BgMode::Quiet'));
  assert.ok(brainWasmRs.includes('1 => self.sim.params.bg_mode = BgMode::Spontaneous'));
  // Oscillatory 分支是块（先取预设再赋值），只断言块内出现该模式。
  {
    const i = brainWasmRs.indexOf('2 => {', brainWasmRs.indexOf('pub fn set_background_mode'));
    assert.ok(i >= 0, 'WASM 缺模式编码 2');
    assert.ok(brainWasmRs.slice(i, i + 400).includes('BgMode::Oscillatory'));
  }
  // OU 默认 τ=100 ms、σ=0.10；正弦 10 Hz；oscillatory 预设 amp=0.30。
  near(rustDefault('ou_tau_ms'), 100);
  near(rustDefault('ou_sigma'), 0.10);
  near(rustDefault('ext_sine_freq_hz'), 10);
  const oscStart = brainCoreRs.indexOf('pub fn oscillatory()');
  const oscBlock = brainCoreRs.slice(oscStart, oscStart + 600);
  assert.ok(oscBlock.includes('ext_sine_amp: 0.30'));
  assert.ok(oscBlock.includes('ext_sine_freq_hz: 10.0'));
  // 快照解析回退默认值与 Rust Default 一致（ext_sine_amp 回退 0 = Default，非预设 0.30）。
  assert.ok(simClientTs.includes('ou_tau_ms ?? 100'));
  assert.ok(simClientTs.includes('ou_sigma ?? 0.10'));
  assert.ok(simClientTs.includes('ext_sine_amp ?? 0'));
  assert.ok(simClientTs.includes('ext_sine_freq_hz ?? 10'));
  // 种子：客户端钳制 ≥0 整数。
  assert.ok(simClientTs.includes('Math.max(0, Math.floor(seed))'));
});

test('权重/偏置 clamp 前后端一致，偏置开启默认值在范围内', () => {
  assert.equal(WEIGHT_MIN, 0);
  assert.equal(WEIGHT_MAX, 3);
  assert.equal(BIAS_MIN, -1);
  assert.equal(BIAS_MAX, 1);
  assert.ok(brainCoreRs.includes('pub const WEIGHT_MIN: f64 = 0.0;'));
  assert.ok(brainCoreRs.includes('pub const WEIGHT_MAX: f64 = 3.0;'));
  assert.ok(brainCoreRs.includes('pub const BIAS_MIN: f64 = -1.0;'));
  assert.ok(brainCoreRs.includes('pub const BIAS_MAX: f64 = 1.0;'));
  near(BIAS_DEFAULT_ON, 0.5);
  assert.ok(BIAS_DEFAULT_ON > BIAS_MIN && BIAS_DEFAULT_ON < BIAS_MAX);
  // UI 滑杆用常量，不手写数字。
  assert.ok(appTsx.includes('min={WEIGHT_MIN}') && appTsx.includes('max={WEIGHT_MAX}'));
  assert.ok(appTsx.includes('min={BIAS_MIN}') && appTsx.includes('max={BIAS_MAX}'));
});

test('锁定/按住/响应/快照频率常量前后一致', () => {
  assert.ok(simWorkerTs.includes('const LOCK_MEAN_E = 0.15;'));
  assert.ok(simWorkerTs.includes('const LOCK_WINDOW_MS = 500;'));
  assert.ok(simWorkerTs.includes('const APPROACH_MEAN_E = 0.05;'));
  assert.ok(simWorkerTs.includes('let snapshotHz = 60;'));
  assert.ok(simWorkerTs.includes('snapshotHz = Math.min(120, Math.max(1, msg.hz));'));
  assert.ok(simWorkerTs.includes('const MAX_CATCHUP_STEPS = 200;'));
  assert.ok(protocolTs.includes('0.15') && protocolTs.includes('500 ms'));
  const brainScene = src('app/src/components/BrainScene.tsx');
  assert.ok(brainScene.includes('const HOLD_DELAY_MS = 300;'));
  assert.ok(brainScene.includes('const CLICK_MOVE_THRESHOLD_PX = 6;'));
  assert.equal(RESPONSE_THRESHOLD, 0.01);
  assert.equal(RESPONSE_WINDOW_PRE_MS, 500);
  assert.equal(RESPONSE_WINDOW_POST_MS, 2000);
  assert.equal(DELTA_FULL, 0.1);
  assert.ok(simClientTs.includes('SNAP_HISTORY_MAX = 600'));
  // setSnapshotHz 客户端镜像 Worker 的 1–120 clamp（D2 修复）。
  assert.ok(simClientTs.includes('Math.min(120, Math.max(1, Math.round(hz)))'));
});

test('坐标系：球心 [0,0,40] mm；MNI152/Talairach 禁用', () => {
  // 生成脚本 ORIGIN_M z=0.04 m = 40 mm；球半径 95 mm；网格 ±48 mm。
  assert.ok(spherePy.includes('ORIGIN_M = np.array([0.0, 0.0, 0.04])'));
  assert.ok(spherePy.includes('RADIUS_M = 0.095'));
  assert.ok(spherePy.includes('GRID_MM = [-48.0, -16.0, 16.0, 48.0]'));
  assert.ok(spherePy.includes('RELATIVE_RADII = (0.90, 0.92, 0.97, 1.0)'));
  near(0.095 * 1000 * 0.90, 85.5);
  // 唯一已验证变换：HEAD RAS -> 球心坐标，z 平移 -40 mm。
  assert.equal(MNE_HEAD_TO_SPHERE.matrix[11], -40);
  assert.equal(MNE_HEAD_TO_SPHERE.errorMm, 0);
  // 禁用（行为级）：DISABLED_SPACES + validateTransform choke point。
  // 已验证变换可通过；任何 from/to 触及禁用空间的变换都抛错。
  validateTransform(MNE_HEAD_TO_SPHERE);
  for (const space of ['mni152-mm', 'talairach-mm', 'tvb-demo-mm']) {
    assert.throws(
      () => validateTransform({ ...MNE_HEAD_TO_SPHERE, from: space }),
      RangeError, `from=${space} 必须被拒绝`);
    assert.throws(
      () => validateTransform({ ...MNE_HEAD_TO_SPHERE, to: space }),
      RangeError, `to=${space} 必须被拒绝`);
  }
  const coordsTs = src('app/src/lib/coordinates.ts');
  assert.ok(coordsTs.includes('DISABLED_SPACES'));
  // fsaverage：mni305 不是 MNI152，校验强制写明 not MNI152。
  const bemTs = src('app/src/lib/fsaverageBEM.ts');
  assert.ok(bemTs.includes("includes('not MNI152')"));
  assert.ok(bemTs.includes('MNI305'));
  assert.ok(bemPy.includes('not MNI152 and not Talairach'));
  assert.ok(bemPy.includes('Expected explicit HEAD<->MRI transform, not MNI/Talairach'));
});

test('球形头模型：导联数、源网格边界、UI 钳制一致', () => {
  // 10-20 核心 19 导（生成脚本 CORE_1020，引号内的名字计数）。
  const coreStart = spherePy.indexOf('CORE_1020 = (');
  const coreEnd = spherePy.indexOf(').split()', coreStart);
  const coreNames = [...spherePy.slice(coreStart, coreEnd).matchAll(/"([^"]+)"/g)]
    .flatMap((m) => m[1].split(/\s+/).filter(Boolean));
  assert.equal(coreNames.length, 19);
  // UI 文案导联数与 MNE 标准集一致（19 / 94 / 343）。
  const headLab = src('app/src/components/HeadSphereLab.tsx');
  assert.ok(headLab.includes('19 导'));
  assert.ok(headLab.includes('94 导'));
  assert.ok(headLab.includes('343 导'));
  // 源位置每轴钳制 ±48 mm（网格边界），偶极矩 ±30 nA·m。
  assert.ok(headLab.includes('clamp(point.x,-48,48)'));
  assert.ok(headLab.includes('min="-30" max="30"'));
  const dipoleLab = src('app/src/components/DipoleLab.tsx');
  assert.ok(dipoleLab.includes('min="-30" max="30"'));
  assert.ok(dipoleLab.includes('min="0.10" max="1.00"'));
  assert.ok(dipoleLab.includes('demoSphereSensors(90)'));
  // sphereForward 只认 head-RAS-sphere-centered fixture。
  const sphereTs = src('app/src/lib/sphereForward.ts');
  assert.ok(sphereTs.includes("coordinate_frame !== 'head-RAS-sphere-centered'"));
  assert.ok(sphereTs.includes("const MONTAGES: MontageKey[] = ['10-20', '10-10', '10-05']"));
});

test('局部皮层柱：TS 默认 = Python 对照，换算因子一致', () => {
  const pyNum = (name) => {
    const m = columnPy.match(new RegExp(`^${name}=([\\d._]+)`, 'm'));
    assert.ok(m, `Python 缺 ${name}`);
    return Number(m[1].replaceAll('_', ''));
  };
  assert.equal(DEFAULT_RATE_PARAMS.tauEMs, pyNum('TAU_E_MS'));
  assert.equal(DEFAULT_RATE_PARAMS.tauIMs, pyNum('TAU_I_MS'));
  assert.equal(DEFAULT_RATE_PARAMS.cEE, pyNum('C_EE'));
  assert.equal(DEFAULT_RATE_PARAMS.cEI, pyNum('C_EI'));
  assert.equal(DEFAULT_RATE_PARAMS.cIE, pyNum('C_IE'));
  assert.equal(DEFAULT_RATE_PARAMS.cII, pyNum('C_II'));
  assert.equal(DEFAULT_RATE_PARAMS.tonicDrive, pyNum('TONIC'));
  assert.equal(DEFAULT_RATE_PARAMS.sigmoidSlope, pyNum('SLOPE'));
  assert.equal(DEFAULT_RATE_PARAMS.sigmoidThreshold, pyNum('THRESHOLD'));
  assert.equal(DEFAULT_MORPHOLOGY.effectivePyramidalCells, pyNum('N'));
  assert.equal(DEFAULT_MORPHOLOGY.coherence, pyNum('COHERENCE'));
  assert.equal(DEFAULT_MORPHOLOGY.excitatoryCurrentPA, pyNum('I_E_PA'));
  assert.equal(DEFAULT_MORPHOLOGY.inhibitoryCurrentPA, pyNum('I_I_PA'));
  assert.equal(DEFAULT_MORPHOLOGY.dipoleSeparationMm, pyNum('L_MM'));
  // pA × mm -> nA·m 换算 1e-6，两边都有。
  assert.ok(columnPy.includes('*1e-6'));
  assert.ok(src('app/src/lib/localCorticalColumn.ts').includes('*1e-6'));
  // UI 刺激驱动默认 1.4 与 Python 对照驱动一致；刺激窗 200 ms（UI）vs 40 ms（对照）是不同实验设置，见契约 §1.5(d)。
  const localLab = src('app/src/components/LocalBEMLab.tsx');
  assert.ok(localLab.includes('useState(1.4)'));
  assert.ok(localLab.includes('min="0.4" max="2.5"'));
  assert.ok(localLab.includes('read().tMs+200'));
  assert.ok(columnPy.includes('"drive":1.4'));
});

test('Worker 协议：21 种入站消息与 Worker 处理分支一一对应', () => {
  const inStart = protocolTs.indexOf('export type WorkerInMessage');
  const inEnd = protocolTs.indexOf('/** Background mode', inStart);
  const inBlock = protocolTs.slice(inStart, inEnd);
  const declared = [...inBlock.matchAll(/\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.equal(declared.length, 21, `入站消息应为 21 种，实得 ${declared.length}`);
  assert.equal(new Set(declared).size, 21, '入站消息类型不得重复');
  const cases = [...simWorkerTs.matchAll(/case '([^']+)':/g)].map((m) => m[1]);
  assert.deepEqual([...cases].sort(), [...declared].sort());
  // 出站 6 种：5 种字面 post + snapshot 是 WorkerOutMessage 里的裸接口引用。
  const outStart = protocolTs.indexOf('export type WorkerOutMessage');
  const outBlock = protocolTs.slice(outStart);
  const outDeclared = [...outBlock.matchAll(/\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]);
  if (/\n\s*\| Snapshot\b/.test(outBlock)) outDeclared.push('snapshot');
  assert.deepEqual([...outDeclared].sort(),
    ['error', 'mode_applied', 'ready', 'snapshot', 'snapshot_restored', 'snapshot_saved'].sort());
  const posted = [...simWorkerTs.matchAll(/post\(\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]);
  for (const t of ['ready', 'mode_applied', 'snapshot_saved', 'snapshot_restored', 'error']) {
    assert.ok(posted.includes(t), `Worker 从未 post ${t}`);
  }
  assert.ok(simWorkerTs.includes("type: 'snapshot',"), 'snapshot 经 snapshot() 变量 post');
});

test('客户端：每种入站消息都有 SimClient 发送点（无孤儿消息）', () => {
  const sent = [...simClientTs.matchAll(/send\(\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]);
  const inStart = protocolTs.indexOf('export type WorkerInMessage');
  const inEnd = protocolTs.indexOf('/** Background mode', inStart);
  const declared = [...protocolTs.slice(inStart, inEnd)
    .matchAll(/\{\s*type:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(sent)].sort(), [...declared].sort());
  // 关键：set_snapshot_hz 必须有发送方（D2 修复前是孤儿消息）。
  assert.ok(sent.includes('set_snapshot_hz'));
  assert.ok(simClientTs.includes('setSnapshotHz(hz: number)'));
});

test('快照：Rust StateSnapshot 字段、localStorage 键与版本机制一致', () => {
  const snapStart = brainCoreRs.indexOf('pub struct StateSnapshot');
  const snapBlock = brainCoreRs.slice(snapStart, brainCoreRs.indexOf('impl Simulator', snapStart));
  for (const f of ['params', 'weights', 'bias', 'step_count', 'rng_state', 'ou',
    'e', 'i', 'e_hist', 'hist_base', 'e0', 'i0']) {
    assert.ok(new RegExp(`\\b${f}:`).test(snapBlock), `StateSnapshot 缺字段 ${f}`);
  }
  assert.ok(!snapBlock.includes('weights_orig'), 'weights_orig 不得进快照（恢复不能污染原始对照）');
  // Snapshot 接口字段（protocol.ts）。
  const snapIfStart = protocolTs.indexOf('export interface Snapshot');
  const snapIf = protocolTs.slice(snapIfStart, protocolTs.indexOf('export type WorkerOutMessage', snapIfStart));
  for (const f of ['t_ms', 'e:', 'i:', 'p:', 'mean_e', 'locked', 'hold_active',
    'hold_node', 'hold_ms', 'lock_progress', 'approaching_lock', 'diverged',
    'divergence_detail', 'paused']) {
    assert.ok(snapIf.includes(f), `Snapshot 缺字段 ${f}`);
  }
  assert.equal(MANUAL_SNAPSHOT_KEY, 'brainrun.snapshot.manual.v1');
  assert.equal(SNAPSHOT_SCHEMA_VERSION, 1);
  // D3：记录内版本字段 + 缺版本视为 1 + 拒绝其他版本。
  assert.ok(simClientTs.includes('version: SNAPSHOT_SCHEMA_VERSION'));
  assert.ok(simClientTs.includes('stored.version ?? 1'));
  assert.ok(simClientTs.includes('version === SNAPSHOT_SCHEMA_VERSION'));
  // parseSnapshotSummary 读回 UI 同步用的子集。
  for (const f of ['g', 'c_ei', 'stim_amplitude', 'stim_duration_ms', 'bg_mode',
    'ou_tau_ms', 'ou_sigma', 'ext_sine_amp', 'ext_sine_freq_hz']) {
    assert.ok(simClientTs.includes(`snap.params.${f}`), `parseSnapshotSummary 缺 ${f}`);
  }
});

test('空壳检查：electrode 参考有实现无 UI 入口（缺口，非空壳）；无纯空壳控件', () => {
  // 三个实验的后端参考类型都支持 electrode，但 UI 下拉只有 average/infinity。
  for (const [file, refType] of [
    ['app/src/lib/volumeConduction.ts', 'Reference'],
    ['app/src/lib/sphereForward.ts', 'SphereReference'],
    ['app/src/lib/fsaverageBEM.ts', 'TemplateReference'],
  ]) {
    const t = src(file);
    assert.ok(t.includes("'electrode'"), `${file} 的 ${refType} 应支持 electrode`);
  }
  for (const lab of ['app/src/components/DipoleLab.tsx',
    'app/src/components/HeadSphereLab.tsx', 'app/src/components/LocalBEMLab.tsx']) {
    const t = src(lab);
    assert.ok(t.includes('<option value="average">'), `${lab} 缺 average 选项`);
    assert.ok(t.includes('<option value="infinity">'), `${lab} 缺 infinity 选项`);
    assert.ok(!t.includes('<option value="electrode">'), `${lab} 不应有 electrode 选项（U1 缺口）`);
  }
  // 四个主滑杆都真实发 set_params；回放/着色是纯视图（无消息），不是空壳。
  assert.ok(appTsx.includes("simRef.current?.setParams({ stim_amplitude:"));
  assert.ok(appTsx.includes("simRef.current?.setParams({ stim_duration_ms:"));
  assert.ok(appTsx.includes("simRef.current?.setParams({ c_ei:"));
  assert.ok(appTsx.includes("simRef.current?.setParams({ g:"));
  assert.ok(appTsx.includes('[1, 0.5, 0.25]'), '回放速度 1×/0.5×/0.25×');
});

test('Jansen–Rit：TS 默认 = Python 对照，耦合链与 WC 路线同形；已有 UI 入口', () => {
  assert.equal(JANSEN_RIT_ID, 'local-jansen-rit-assumed-dipole-v1');
  assert.equal(JR_PSP_TO_CURRENT_PA_PER_MV, 200);
  const pyNum = (name) => {
    const m = jrPy.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, 'm'));
    assert.ok(m, `Python 缺 ${name}`);
    return Number(m[1]);
  };
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.gainExcMv, pyNum('A_MV'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.gainInhMv, pyNum('B_MV'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.rateExcPerS, pyNum('A_RATE'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.rateInhPerS, pyNum('B_RATE'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.sigmoidMaxPerS, pyNum('E0'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.sigmoidHalfMv, pyNum('V0_MV'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.sigmoidSlopePerMv, pyNum('R_PER_MV'));
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.baselineInputPerS, pyNum('P0_PER_S'));
  const cMatch = jrPy.match(/C1, C2, C3, C4 = ([\d.,\s]+)/);
  assert.ok(cMatch, 'Python 缺 C1..C4');
  const [c1, c2, c3, c4] = cMatch[1].split(',').map(Number);
  assert.deepEqual(
    [DEFAULT_JANSEN_RIT_PARAMS.c1, DEFAULT_JANSEN_RIT_PARAMS.c2,
      DEFAULT_JANSEN_RIT_PARAMS.c3, DEFAULT_JANSEN_RIT_PARAMS.c4],
    [c1, c2, c3, c4]);
  // 耦合链：N / coherence / g / L 与 WC 路线共用同一套假设数，换算 1e-6。
  // dtMs = 0.5（不是 1）：实测 RK4 与 DOP853 对照，dt=1 ms 时 y1 轨迹差
  // 达 7.6e-6 mV，dt=0.5 ms 时全部状态变量 <1e-6（最大 4.6e-7 mV），
  // q(t) 差 2.3e-8 nA·m。仍是 RK4 同款积分口径，只是步长更细。
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.dtMs, 0.5);
  assert.ok(jrPy.includes('N_CELLS = 1_000_000'));
  assert.ok(jrPy.includes('COHERENCE = 0.08'));
  assert.ok(jrPy.includes('G_PA_PER_MV = 200.0'));
  assert.ok(jrPy.includes('L_MM = 0.5'));
  assert.ok(jrPy.includes('* 1e-6'));
  assert.ok(jrTs.includes('* 1e-6'));
  // 对照协议：刺激窗 80–120 ms、附加输入 120 1/s（与 WC 路线同窗）。
  assert.ok(jrPy.includes('PULSE_PER_S = 120.0'));
  assert.ok(jrPy.includes('STIM_ON_MS = 80.0'));
  assert.ok(jrPy.includes('STIM_OFF_MS = 120.0'));
  // EEG 代理是 y0（mV），不是导数/发放率；step 只接受 [0, 1000] 1/s 附加输入。
  assert.ok(jrTs.includes('Pyramidal-population PSP y0, mV (model EEG proxy)'));
  assert.ok(jrTs.includes('addedInputPerS > 1000'));
  // 已有 UI 入口（U5 已消项）：LocalBEMLab 源模型切换引入该模块；
  // 其余组件仍未引入。
  assert.ok(src('app/src/components/LocalBEMLab.tsx').includes('jansenRitColumn'),
    'LocalBEMLab 应已接 JR 入口（源模型切换）');
  for (const f of ['app/src/App.tsx', 'app/src/components/DipoleLab.tsx',
    'app/src/components/HeadSphereLab.tsx',
    'app/src/components/BrainScene.tsx']) {
    assert.ok(!src(f).includes('jansenRitColumn'), `${f} 未接 JR 入口`);
  }
  // 契约已登记 JR 参数表，不再是“待补”。
  const contract = src('docs/frontend-backend-contract.md');
  assert.ok(contract.includes('JANSEN_RIT_ID'));
  assert.ok(contract.includes('3.25 / 22'));
});
