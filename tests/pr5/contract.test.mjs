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
import {
  DEFAULT_SFREQ_HZ, DEFAULT_DURATION_MS, DEFAULT_EVENT_INTERVAL_MS,
  DEFAULT_DRIVE_DURATION_MS, DEFAULT_WC_DRIVE, DEFAULT_JR_DRIVE_PER_S,
  DEFAULT_JR_BASELINE_INPUT_PER_S, DEFAULT_SEED, DEFAULT_NOISE,
  NOISE_SLIDER_MIN_UV, NOISE_SLIDER_MAX_UV,
} from '../../app/src/lib/eegRecording.ts';
import {
  MNE_LAMBDA2_DEFAULT, MNE_NOISE_RMS_UV_DEFAULT,
} from '../../app/src/lib/sourceLocalization.ts';
import {
  SPLINE_ORDER_M, SPLINE_N_MAX, SPLINE_LAMBDA_DEFAULT,
} from '../../app/src/lib/topography.ts';

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

test('四滑杆：KNOB_MAP 端点 = UI 数字框范围 = 引擎 clamp', () => {
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
  // 引擎 clamp：四者如今与 UI 完全相等。PR6 R1 已裁决为 (a)：WASM
  // set_stim_amplitude 从 0–4.0 收紧到 0.5–2.0，与 UI 一致（此前
  // 引擎比 UI 宽是契约残留 R1）。收紧的依据：全仓 grep 无任何
  // set_stim_amplitude 用例超过 2.0（UI 最大 2.0、测试最大 2.0）；
  // 唯一超 2.0 的幅度是 reference/python-model/experiments.py 里
  // 幅度 sweep 的 4.0，但它走的是 StimulusEvent 直接事件幅度
  // （add_stimulus 不钳制），根本不经过本 setter，不受影响。
  assert.deepEqual(wasmClamp('set_g'), [0, 0.4]);
  assert.deepEqual(wasmClamp('set_c_ei'), [3, 8]);
  assert.deepEqual(wasmClamp('set_stim_duration_ms'), [20, 500]);
  assert.deepEqual(wasmClamp('set_stim_amplitude'), [0.5, 2.0]);
  assert.deepEqual(wasmClamp('set_stim_amplitude'),
    [KNOB_MAP.stimulusAmplitude(0), KNOB_MAP.stimulusAmplitude(1)],
    'stim_amplitude 引擎 clamp 必须等于 UI 范围（R1 已解决，不再是子集）');
  // protocol.ts 的 stim_amplitude 注释必须写明 UI 范围 0.5–2.0，且不再
  // 含 PR5 旧文案 “引擎侧 clamp 是 0–4.0”（PR6 R1 已收紧到 0.5–2.0，
  // 总协调已按 A2 汇报的 exact 文案改完注释）。
  assert.ok(protocolTs.includes('0.5–2.0'),
    'protocol.ts 必须写明 stim_amplitude UI 范围 0.5–2.0');
  assert.ok(!protocolTs.includes('0–4.0'),
    'protocol.ts 不得再含 PR5 旧文案 0–4.0（R1 已收紧）');
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
  // PR6 R6：MNI152 / Talairach 已从 CoordinateSpace 联合类型中消除
  // （只断言类型块本身；注释、DISABLED_SPACES 运行时集合与
  // parseCoordinateSpace 的拒绝分支里仍会出现这两个字符串，那是
  // 有意的运行时防线，不是类型残留）。唯一字符串入口是
  // parseCoordinateSpace，遇禁用空间抛错并说明原因。
  const unionStart = coordsTs.indexOf('export type CoordinateSpace');
  const unionBlock = coordsTs.slice(unionStart, coordsTs.indexOf(';', unionStart));
  assert.ok(!unionBlock.includes('mni152-mm') && !unionBlock.includes('talairach-mm'),
    'CoordinateSpace 不得再含 mni152-mm / talairach-mm（R6 已解决）');
  assert.ok(coordsTs.includes('export function parseCoordinateSpace(s: string): CoordinateSpace'));
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
  // PR6 R2：快照 JSON 本身带版本。Rust StateSnapshot 有 version: u32，
  // 缺字段时 serde 默认 1（旧 JSON 仍能恢复）；take_snapshot 写 1；
  // simClient 解析时同步读 snap.version（缺字段默认 1）。
  assert.ok(snapBlock.includes('version: u32'), 'StateSnapshot 缺 version 字段');
  assert.ok(snapBlock.includes('default_snapshot_version'),
    'StateSnapshot.version 必须带 serde 默认值（旧 JSON 兼容）');
  assert.ok(brainCoreRs.includes('pub const STATE_SNAPSHOT_VERSION: u32 = 1;'));
  assert.ok(brainCoreRs.includes('version: STATE_SNAPSHOT_VERSION'),
    'take_snapshot 必须写 version');
  assert.ok(simClientTs.includes('version?: number'),
    'parseSnapshotSummary 必须读快照 JSON 的 version');
  assert.ok(simClientTs.includes('version: snap.version ?? 1'),
    'parseSnapshotSummary 缺 version 时默认 1');
  assert.ok(simClientTs.includes('version: number'),
    'SnapshotSummary 必须带 version 字段');
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

test('PR-07 EEG：采样率/参考/噪声/导联参数前后端一致（契约 §1.6）', () => {
  // 采样率只支持 250 Hz（与 ds003061 一致）；时长/事件/驱动默认值。
  assert.equal(DEFAULT_SFREQ_HZ, 250);
  assert.equal(DEFAULT_DURATION_MS, 10000);
  assert.equal(DEFAULT_EVENT_INTERVAL_MS, 1000);
  assert.equal(DEFAULT_DRIVE_DURATION_MS, 100);
  assert.equal(DEFAULT_WC_DRIVE, 1.0);
  assert.equal(DEFAULT_JR_DRIVE_PER_S, 120);
  assert.equal(DEFAULT_JR_BASELINE_INPUT_PER_S, 90);
  assert.equal(DEFAULT_SEED, 1);
  // 噪声：四成分 RMS 默认值与滑杆范围；Python 对照同值（源码对照）。
  assert.deepEqual(DEFAULT_NOISE, { whiteRmsUv: 2, pinkRmsUv: 1, line50HzRmsUv: 0.5, driftRmsUv: 0.5 });
  assert.equal(NOISE_SLIDER_MIN_UV, 0);
  assert.equal(NOISE_SLIDER_MAX_UV, 10);
  const eegPy = src('scientific/eeg/eeg_reference.py');
  assert.ok(eegPy.includes('SFREQ_HZ = 250.0'), 'Python 采样率须为 250');
  assert.ok(eegPy.includes('DEFAULT_WC_DRIVE = 1.0'));
  assert.ok(eegPy.includes('DEFAULT_JR_DRIVE_PER_S = 120.0'));
  assert.ok(eegPy.includes('DEFAULT_JR_BASELINE_PER_S = 90.0'));
  assert.ok(eegPy.includes('"whiteRmsUv": 2.0'));
  assert.ok(eegPy.includes('"pinkRmsUv": 1.0'));
  // 正向模型 id 与球形头一致（同一份 fixture）。
  assert.equal(SPHERE_MODEL_ID, 'mne-four-layer-sphere-ras-v1');
  const eegTs = src('app/src/lib/eegRecording.ts');
  assert.ok(eegTs.includes('SPHERE_MODEL_ID'), 'eegRecording 须用球形头模型 id');
  assert.ok(eegTs.includes('rawDataUvInfinity'), '须存无限远参考原始数据以便无损切换参考');
  // 契约 §1.6 已登记全部参数名。
  const contract = src('docs/frontend-backend-contract.md');
  for (const key of ['whiteRmsUv', 'pinkRmsUv', 'line50HzRmsUv', 'driftRmsUv',
    'DEFAULT_SFREQ_HZ', 'reReferenceRecording', 'rawDataUvInfinity', '1.6 PR6 PR-07']) {
    assert.ok(contract.includes(key), `契约 §1.6 缺 ${key}`);
  }
  // UI 滑杆范围与后端常量一致（EegWaveTab 用 NOISE_SLIDER_* 常量）。
  const waveTab = src('app/src/components/EegWaveTab.tsx');
  assert.ok(waveTab.includes('NOISE_SLIDER_MIN_UV'), '噪声滑杆 min 须读后端常量');
  assert.ok(waveTab.includes('NOISE_SLIDER_MAX_UV'), '噪声滑杆 max 须读后端常量');
});

test('R4：电极参考已有 UI 入口（EEG 分析实验）；App 入口与六 tab 挂载一致', () => {
  // EEG tab：三种参考选项 + 电极选择器（R4 的 UI 入口）。
  const waveTab = src('app/src/components/EegWaveTab.tsx');
  assert.ok(waveTab.includes('<option value="average">'), 'EEG tab 缺 average 选项');
  assert.ok(waveTab.includes('<option value="infinity">'), 'EEG tab 缺 infinity 选项');
  assert.ok(waveTab.includes('<option value="electrode">'), 'EEG tab 缺 electrode 选项（R4 入口）');
  assert.ok(waveTab.includes('aria-label="参考电极"'), 'EEG tab 缺参考电极选择器');
  assert.ok(waveTab.includes('reReferenceRecording') || waveTab.includes('onReferenceChange'),
    'EEG tab 参考切换须经壳的 reReferenceRecording');
  // App：顶栏有 “EEG 分析” chip，并挂载 EegAnalysisLab。
  assert.ok(appTsx.includes('EEG 分析'), 'App 缺 “EEG 分析” 入口 chip');
  assert.ok(appTsx.includes('<EegAnalysisLab'), 'App 未挂载 EegAnalysisLab');
  assert.ok(appTsx.includes("import EegAnalysisLab from './components/EegAnalysisLab'"));
  // 壳：import 全部六个 tab（WavesTab / ErpTab / TfrTab / TopoTab / InverseTab
  // 由 B2/B3 并行写；此处只断言壳按设计稿 §1.3 挂载，不碰其实现）。
  const lab = src('app/src/components/EegAnalysisLab.tsx');
  for (const tab of ['EegWaveTab', 'WavesTab', 'ErpTab', 'TfrTab', 'TopoTab', 'InverseTab']) {
    assert.ok(lab.includes(`import ${tab} from './${tab}'`), `壳未 import ${tab}`);
    assert.ok(lab.includes(`<${tab}`), `壳未挂载 <${tab}>`);
  }
  // 壳持有共享状态：recording / events / epochs / selectedChannel / reference / montage。
  for (const state of ['useState<EegRecording | null>(null)', 'useState<EegEvent[]>([])',
    'useState<EpochSet | null>(null)', "useState('Pz')", "useState<EegReference>({ mode: 'average' })",
    "useState<MontageKey>('10-20')"]) {
    assert.ok(lab.includes(state), `壳缺共享状态 ${state}`);
  }
  // 契约 R4 已标记解决（§7），U1 已更新为“EEG 分析实验已暴露”。
  const contract = src('docs/frontend-backend-contract.md');
  assert.ok(contract.includes('R4 | ~~`electrode` 参考方式无 UI 入口~~ **已解决'),
    '契约 §7 R4 须标记已解决');
  assert.ok(contract.includes('EEG 分析实验已暴露'), '契约 §5.3 U1 须更新为 EEG 实验已暴露');
  // 三个 PR5 实验仍只有两种参考（U1 剩余缺口如实保留；旧断言不改）。
  for (const labFile of ['app/src/components/DipoleLab.tsx',
    'app/src/components/HeadSphereLab.tsx', 'app/src/components/LocalBEMLab.tsx']) {
    assert.ok(!src(labFile).includes('<option value="electrode">'), `${labFile} 不应有 electrode 选项`);
  }
});

test('PR6 时频/地形/逆解（B3）：TS 默认 = Python 对照 = UI 初始值；契约 §1.7 已登记', () => {
  // 默认值三处一致：MNE λ² = 1/9、σ = 1.0 µV；样条 m = 4、nMax = 7、λ = 1e-5。
  const pyNum = (py, name) => {
    const m = py.match(new RegExp(`^${name}\\s*=\\s*([\\d.eE+\\-/ ]+)`, 'm'));
    assert.ok(m, `Python 缺 ${name}`);
    return Function(`return (${m[1].trim()})`)();
  };
  const invPy = src('scientific/eeg/inverse_reference.py');
  near(MNE_LAMBDA2_DEFAULT, 1 / 9);
  near(MNE_LAMBDA2_DEFAULT, pyNum(invPy, 'MNE_LAMBDA2_DEFAULT'));
  near(MNE_NOISE_RMS_UV_DEFAULT, 1.0);
  near(MNE_NOISE_RMS_UV_DEFAULT, pyNum(invPy, 'MNE_NOISE_RMS_UV_DEFAULT'));
  assert.equal(SPLINE_ORDER_M, 4);
  assert.equal(SPLINE_ORDER_M, pyNum(invPy, 'SPLINE_ORDER_M'));
  assert.equal(SPLINE_N_MAX, 7);
  assert.equal(SPLINE_N_MAX, pyNum(invPy, 'SPLINE_N_MAX'));
  near(SPLINE_LAMBDA_DEFAULT, 1e-5);
  near(SPLINE_LAMBDA_DEFAULT, pyNum(invPy, 'SPLINE_LAMBDA_DEFAULT'));
  // UI 初始值与 TS 默认同值（InverseTab 的 useState 初始值读 TS 常量）。
  const invTab = src('app/src/components/InverseTab.tsx');
  assert.ok(invTab.includes('useState(MNE_LAMBDA2_DEFAULT)'), 'InverseTab λ² 初始值应读 TS 默认');
  assert.ok(invTab.includes('useState(MNE_NOISE_RMS_UV_DEFAULT)'), 'InverseTab σ 初始值应读 TS 默认');
  // 契约 §1.7 已登记本节参数表（不是只写在代码注释里）。
  const contract = src('docs/frontend-backend-contract.md');
  assert.ok(contract.includes('### 1.7 PR6 时频 / 地形 / 源定位（B3：PR-10/11/12）'));
  assert.ok(contract.includes('MNE_LAMBDA2_DEFAULT'));
  assert.ok(contract.includes('SPLINE_LAMBDA_DEFAULT'));
  // 2D/3D 来源差异写进 UI 文案：2D 写“插值”，3D 写“无插值”。
  const topoTab = src('app/src/components/TopoTab.tsx');
  assert.ok(topoTab.includes('插值'), 'TopoTab 应写清 2D 图是插值');
  assert.ok(topoTab.includes('无插值'), 'TopoTab 应写清 3D 图无插值');
  // 逆解函数签名里没有真值参数（盲测卫生，见 tests/pr6/tfr-topo-inverse.test.mjs）。
  const invTs = src('app/src/lib/sourceLocalization.ts');
  assert.ok(invTs.includes('export function dipoleFit(leadField: LeadField, dataUv: number[])'));
  assert.ok(invTs.includes('export function mneInverse('));
  assert.ok(!/export function (dipoleFit|mneInverse)\([^)]*true/i.test(invTs),
    'dipoleFit/mneInverse 签名里不应有真值参数');
});

test('PR6 WAVES/ERP（B2）：晚期机制默认 = Python 对照 = fixture；Pz 增益不重缩放；契约 §1.8 已登记', () => {
  const lateTs = src('app/src/lib/lateResponse.ts');
  const latePy = src('scientific/eeg/late_response_reference.py');
  const fixture = JSON.parse(src('tests/pr6/fixtures/late-response-reference.json'));
  const ref = JSON.parse(src('scientific/forward/public_eeg_reference_values.json'));
  // 1. 默认三处一致：TS 默认 = Python 对照 = fixture mechanism 段。
  const tsField = (name) => {
    const m = lateTs.match(new RegExp(`\\b${name}:\\s*([\\d.]+)`));
    assert.ok(m, `TS 缺字段 ${name}`);
    return Number(m[1]);
  };
  const tsConst = (name) => {
    const m = lateTs.match(new RegExp(`\\b${name}\\s*=\\s*(-?[\\d.]+)`));
    assert.ok(m, `TS 缺常量 ${name}`);
    return Number(m[1]);
  };
  const pyConst = (name) => {
    const m = latePy.match(new RegExp(`^${name}\\s*=\\s*([\\d.]+)`, 'm'));
    assert.ok(m, `Python 缺常量 ${name}`);
    return Number(m[1]);
  };
  assert.equal(tsField('tauSlowMs'), 200);
  assert.equal(tsField('tauSlowMs'), pyConst('TAU_SLOW_MS'));
  assert.equal(tsField('tauSlowMs'), fixture.mechanism.tau_slow_ms);
  assert.equal(tsField('delayMs'), 100);
  assert.equal(tsField('delayMs'), pyConst('DELAY_MS'));
  assert.equal(tsField('delayMs'), fixture.mechanism.delay_ms);
  assert.equal(tsField('slowGain'), 2.5);
  assert.equal(tsField('slowGain'), pyConst('SLOW_GAIN'));
  assert.equal(tsField('slowGain'), fixture.mechanism.slow_gain);
  assert.equal(tsField('slowMaxPerS'), 5000);
  assert.equal(tsField('slowMaxPerS'), pyConst('SLOW_MAX_PER_S'));
  assert.equal(tsField('slowMaxPerS'), fixture.mechanism.slow_max_per_s);
  // 2. Pz 增益固定 0.16，且 lateResponse.ts 全文不含 rescale（幅度不做重缩放）。
  assert.equal(tsConst('PZ_GAIN_UV_PER_NAM'), 0.16);
  assert.equal(tsConst('PZ_GAIN_UV_PER_NAM'), pyConst('PZ_GAIN_UV_PER_NAM'));
  assert.ok(!/rescale/i.test(lateTs), 'lateResponse.ts 不应含 rescale');
  // 3. 驱动/刺激时长/剔除阈值与 ds003061 方法口径一致（epoch −200–800 ms、
  // 基线 −200–0 ms、剔除 150 µV）。
  assert.equal(tsConst('STANDARD_DRIVE_PER_S'), 120);
  assert.equal(tsConst('STANDARD_DRIVE_PER_S'), pyConst('STANDARD_DRIVE_PER_S'));
  assert.equal(tsConst('ODDBALL_DRIVE_PER_S'), 300);
  assert.equal(tsConst('ODDBALL_DRIVE_PER_S'), pyConst('ODDBALL_DRIVE_PER_S'));
  assert.equal(tsConst('STIM_DURATION_MS'), 40);
  assert.equal(tsConst('STIM_DURATION_MS'), pyConst('STIM_DURATION_MS'));
  assert.equal(tsConst('ERP_REJECT_PEAK_TO_PEAK_UV'), 150);
  assert.equal(tsConst('ERP_REJECT_PEAK_TO_PEAK_UV'), ref.method.reject_peak_to_peak_uv);
  assert.equal(tsConst('ERP_TMIN_MS'), ref.method.epoch_s[0] * 1000);
  assert.equal(tsConst('ERP_TMAX_MS'), ref.method.epoch_s[1] * 1000);
  assert.ok(lateTs.includes('ERP_BASELINE_MS: readonly [number, number] = [-200, 0];'),
    'ERP 基线窗应为 [-200, 0] ms');
  assert.equal(ref.method.baseline_s[0] * 1000, -200);
  assert.equal(ref.method.baseline_s[1] * 1000, 0);
  // 4. 机制 ID 字面量一致；动态一半（runOddballExperiment 返回的
  // recording.sourceModelId 等于它）由 waves-erp.test.mjs 断言并跑过。
  assert.ok(lateTs.includes("export const LATE_RESPONSE_ID = 'local-jansen-rit-slow-late-v1';"));
  const wavesTest = src('tests/pr6/waves-erp.test.mjs');
  assert.ok(wavesTest.includes('assert.equal(recording.sourceModelId, LATE_RESPONSE_ID)'),
    'waves-erp.test.mjs 应动态断言 sourceModelId');
  // 5. 两 tab 存在且 props 与设计稿 §1.3 一致；两文件均不 import 实验运行器
  // （WavesTab 不跑 runAlphaLimitCycle，ErpTab 不跑 runOddballExperiment）。
  const wavesTab = src('app/src/components/WavesTab.tsx');
  const erpTab = src('app/src/components/ErpTab.tsx');
  const lab = src('app/src/components/EegAnalysisLab.tsx');
  assert.ok(wavesTab.includes('export default function WavesTab({'));
  assert.ok(wavesTab.includes('recording: EegRecording | null;'));
  assert.ok(wavesTab.includes('channel: string;'));
  assert.ok(lab.includes('<WavesTab recording={recording} channel={selectedChannel} />'),
    '壳挂载 WavesTab 的 props 应与设计稿一致');
  assert.ok(erpTab.includes('export default function ErpTab({'));
  assert.ok(erpTab.includes('events: EegEvent[];'));
  assert.ok(erpTab.includes('epochs: EpochSet | null;'));
  assert.ok(erpTab.includes('onEpochsChange: (epochs: EpochSet) => void;'));
  assert.ok(lab.includes('<ErpTab'), '壳应挂载 ErpTab');
  for (const f of [wavesTab, erpTab]) {
    assert.ok(!f.includes('runOddballExperiment'), 'tab 不应跑 oddball 实验');
    assert.ok(!f.includes('runAlphaLimitCycle'), 'tab 不应跑极限环实验');
  }
  // 契约 §1.8 已登记本节参数表（不是只写在代码注释里）。
  const contract = src('docs/frontend-backend-contract.md');
  assert.ok(contract.includes('### 1.8 PR6 WAVES / ERP / 晚期机制参数（B2，2026-11-12）'));
  assert.ok(contract.includes('DEFAULT_LATE_RESPONSE_PARAMS'));
  assert.ok(contract.includes('PZ_GAIN_UV_PER_NAM'));
  assert.ok(contract.includes("LATE_RESPONSE_ID = 'local-jansen-rit-slow-late-v1'"));
});
