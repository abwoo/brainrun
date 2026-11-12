/**
 * PR8-LINK — §4.1 统一仿真状态：六实验台接主仿真的联动断言测试。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/methods-link.test.mjs
 *
 * 覆盖（每项修前失败、修后通过；新路径的“修前失败”指导出/接线不存在）：
 *  L1 直播推导：改 G（E 迹 ×2）→ EEG 记录 Pz 峰值 ×2（线性管线，噪声 null）。
 *  L2 换选区（E 迹不同）→ 记录不同；无响应脑区（平坦 E）→ Pz ≈ 0。
 *  L3 直播推导的事件只来自真实脉冲标记（同脑区、窗内才计入；hold 不计入）。
 *  L4 插值精度：线性 E 斜坡经 60 Hz→250 Hz 插值后 q 与解析值一致（<1e-9）。
 *  L5 源位置钳制：TVB 中心超网格时 runLiveExperiment 不抛错，且等于钳制后位置的结果。
 *  L6 记录持久化 store：写入后读回同一份记录与事件。
 *  L7 细胞耦合数值：前向 wcToLifCurrentPA(0.5)=489 pA；反向
 *      firingRateToPopulationDriveP(60 Hz)=0.12 P 单位。
 *  L8 感觉映射：视觉→双侧 V1，听觉→双侧 A1（按 brainData label 找）。
 *  L9 接线存在性（源码级）：CellularLab 无手填 E（删掉 useState(0.5)）、
 *      App 把 live E/P 与 handleBiasChange 传进 CellularLab、StimLab 用
 *      onPulse、HEAD/DIPOLE 有直播源与“独立演示”标注、ExperimentLab 有
 *      直播闭环/直播回放、SimClient 有 pulseAt 且幅度钳制 [-2, 2]。
 *
 * 合成快照历史：60 Hz（t = k×1000/60 ms），E/I 为 Float64Array（76 区），
 * 只在目标脑区放响应 bump，其余脑区平坦——与真实快照的形状一致。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  clampSourcePositionMm,
  deriveLiveMoments,
  getLiveRecordingStore,
  runLiveExperiment,
  sensoryTargetNodes,
  setLiveRecordingStore,
  LIVE_DERIVATION_ID,
  LIVE_SNAPSHOT_HZ,
} from '../../app/src/lib/eegRecording.ts';
import {
  equivalentMomentNAm,
  DEFAULT_MORPHOLOGY,
} from '../../app/src/lib/localCorticalColumn.ts';
import {
  firingRateToPopulationDriveP,
  wcToLifCurrentPA,
  wcToHhCurrentDensityUAperCm2,
} from '../../app/src/lib/cellular.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(join(root, p), 'utf8');
const fx = JSON.parse(src('tests/pr6/fixtures/eeg-recording-reference.json'));
const synth = fx.synthetic_fixture;

const N_REGIONS = 76;
const NODE = 40;
const BASE_E = 0.011;
const BASE_I = 0.02;

/** 60 Hz 合成快照历史（10 s），目标脑区一个高斯 bump，其余平坦。 */
function synthHistory({ bump = 0.4, node = NODE, bumpT = 5000, bumpW = 300 } = {}) {
  const samples = [];
  const n = 601; // 0..10000 ms，60 Hz
  for (let k = 0; k < n; k++) {
    const t = (k * 1000) / 60;
    const g = Math.exp(-(((t - bumpT) / bumpW) ** 2));
    const e = new Float64Array(N_REGIONS).fill(BASE_E);
    const i = new Float64Array(N_REGIONS).fill(BASE_I);
    e[node] = BASE_E + bump * g;
    i[node] = BASE_I + 0.05 * bump * g;
    samples.push({ t_ms: t, e, i });
  }
  return samples;
}

function pzPeak(rec) {
  const idx = rec.channels.findIndex((c) => c.label === 'Pz');
  assert.ok(idx >= 0, 'recording 应含 Pz 通道');
  return Math.max(...rec.dataUv[idx].map(Math.abs));
}

function pzRms(rec) {
  const idx = rec.channels.findIndex((c) => c.label === 'Pz');
  const row = rec.dataUv[idx];
  return Math.sqrt(row.reduce((s, v) => s + v * v, 0) / row.length);
}

test('L1 改 G（E 迹 ×2）→ 直播推导的 Pz 峰值 ×2（线性管线）', () => {
  const base = { fixture: synth, samples: synthHistory({ bump: 0.4 }), node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [0, 0, 16], noise: null };
  const r1 = runLiveExperiment(base);
  const r2 = runLiveExperiment({ ...base, samples: synthHistory({ bump: 0.8 }) });
  assert.equal(r1.recording.sourceModelId, LIVE_DERIVATION_ID);
  assert.equal(r1.recording.sfreqHz, 250);
  const p1 = pzPeak(r1.recording);
  const p2 = pzPeak(r2.recording);
  assert.ok(p1 > 0.01, `G1 时 Pz 峰值应可见，实测 ${p1}（合成 fixture Pz 增益约 0.014 uV/(nA·m)，不是真实 fixture 的 0.16）`);
  const ratio = p2 / p1;
  assert.ok(Math.abs(ratio - 2) < 1e-9, `Pz 峰值比应为 2，实测 ${ratio}`);
  assert.equal(r1.recording.timesMs.length, 2501, '10 s 窗 × 250 Hz + t=0');
});

test('L2 换选区 → 记录不同；平坦脑区 → Pz ≈ 0', () => {
  const hist = synthHistory({ bump: 0.4 });
  const withBump = runLiveExperiment({ fixture: synth, samples: hist, node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [0, 0, 16], noise: null });
  // 换到一个全程平坦的脑区（同一份历史，E 迹不同）。
  const flat = runLiveExperiment({ fixture: synth, samples: hist, node: 41,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [0, 0, 16], noise: null });
  assert.ok(pzPeak(withBump.recording) > 0.01, '有响应脑区的 Pz 峰值应可见');
  assert.ok(pzPeak(flat.recording) < 1e-12, `平坦脑区的 Pz 应 ≈0，实测 ${pzPeak(flat.recording)}`);
  // 同一脑区、换源位置（钳制后仍在网格内）→ 通道图样不同。
  const moved = runLiveExperiment({ fixture: synth, samples: hist, node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [16, -16, 16], noise: null });
  assert.notDeepEqual(moved.recording.dataUv, withBump.recording.dataUv);
});

test('L3 直播事件只来自真实脉冲标记（同脑区、窗内、pulse 才计入）', () => {
  const hist = synthHistory({ bump: 0.4 });
  const markers = [
    { t_ms: 2000, node: NODE, kind: 'pulse', amplitude: 2 },
    { t_ms: 4000, node: NODE, kind: 'pulse', amplitude: 2 },
    { t_ms: 6000, node: 41, kind: 'pulse', amplitude: 2 }, // 别的脑区，不计
    { t_ms: 8000, node: NODE, kind: 'hold', amplitude: 2 }, // hold，不计
  ];
  const { events } = runLiveExperiment({ fixture: synth, samples: hist, node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [0, 0, 16], noise: null, markers });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.tMs), [2000, 4000]);
  assert.deepEqual(events.map((e) => e.condition), ['standard', 'oddball']);
  assert.deepEqual(events.map((e) => e.drive), [2, 2]);
  assert.deepEqual(events.map((e) => e.driveUnit), ['wc', 'wc']);
  const none = runLiveExperiment({ fixture: synth, samples: hist, node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [0, 0, 16], noise: null });
  assert.equal(none.events.length, 0, '无脉冲标记时事件表为空（ERP tab 显示“还没有事件表”，不崩）');
  assert.ok(pzPeak(none.recording) > 0.01, '无事件时记录本身仍有信号');
});

test('L4 插值精度：线性 E 斜坡 60 Hz→250 Hz 后 q 与解析值一致', () => {
  const samples = [];
  for (let k = 0; k <= 600; k++) {
    const t = (k * 1000) / 60;
    const e = new Float64Array(N_REGIONS).fill(BASE_E);
    const i = new Float64Array(N_REGIONS).fill(BASE_I);
    e[NODE] = BASE_E + 0.4 * (t / 10000);
    samples.push({ t_ms: t, e, i });
  }
  const { timesMs, momentsNAm } = deriveLiveMoments(samples, NODE, BASE_E, BASE_I);
  assert.equal(timesMs.length, 2501);
  let maxErr = 0;
  for (let j = 0; j < timesMs.length; j++) {
    const e = BASE_E + 0.4 * (timesMs[j] / 10000);
    const expect = equivalentMomentNAm(e, BASE_I, BASE_E, BASE_I, DEFAULT_MORPHOLOGY);
    maxErr = Math.max(maxErr, Math.abs(momentsNAm[j] - expect));
  }
  assert.ok(maxErr < 1e-9, `插值 q 误差应 <1e-9，实测 ${maxErr}`);
});

test('L5 源位置钳制：TVB 中心超网格时不抛错，且等于钳制后位置的结果', () => {
  const raw = [79.2, -15.6, -16];
  const clamped = clampSourcePositionMm(synth, raw);
  assert.deepEqual(clamped, [48, -15.6, -16]);
  const hist = synthHistory({ bump: 0.4 });
  const opts = { fixture: synth, samples: hist, node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, noise: null };
  const a = runLiveExperiment({ ...opts, positionMm: raw });
  const b = runLiveExperiment({ ...opts, positionMm: clamped });
  assert.deepEqual(a.recording.dataUv, b.recording.dataUv);
  assert.deepEqual(a.recording.channels, b.recording.channels);
});

test('L6 记录持久化 store：写入后读回同一份记录与事件', () => {
  const hist = synthHistory({ bump: 0.4 });
  const { recording, events } = runLiveExperiment({ fixture: synth, samples: hist, node: NODE,
    baselineE: BASE_E, baselineI: BASE_I, positionMm: [0, 0, 16], noise: null,
    markers: [{ t_ms: 3000, node: NODE, kind: 'pulse', amplitude: 2 }] });
  setLiveRecordingStore({ recording, events, epochs: null });
  const back = getLiveRecordingStore();
  assert.ok(back, 'store 应有记录');
  assert.equal(back.recording.sourceModelId, LIVE_DERIVATION_ID);
  assert.equal(back.events.length, 1);
  assert.equal(back.events[0].tMs, 3000);
  assert.equal(pzRms(back.recording), pzRms(recording));
  setLiveRecordingStore(null);
  assert.equal(getLiveRecordingStore(), null);
});

test('L7 细胞耦合数值：前向 E=0.5 → LIF 489 pA；反向 60 Hz → dP=0.12', () => {
  assert.equal(wcToLifCurrentPA(0.5), 489, '1000×(0.5−0.011)=489 pA');
  assert.ok(Math.abs(wcToHhCurrentDensityUAperCm2(0.5) - 9.78) < 1e-9);
  assert.equal(firingRateToPopulationDriveP(60), 0.12, '0.002×60=0.12 P 单位');
  assert.equal(firingRateToPopulationDriveP(0), 0);
});

test('L8 感觉映射：视觉→双侧 V1，听觉→双侧 A1（按 brainData label）', () => {
  const regions = JSON.parse(readFileSync(join(root, 'app/public/brain-assets/regions.json'), 'utf8'));
  assert.deepEqual(sensoryTargetNodes(regions, 'visual'), [35, 73]);
  assert.deepEqual(sensoryTargetNodes(regions, 'auditory'), [0, 38]);
  // label 缺失时返回空数组，不编造节点。
  assert.deepEqual(sensoryTargetNodes([{ label: 'rV1' }], 'auditory'), []);
  assert.deepEqual(sensoryTargetNodes([], 'visual'), []);
});

test('L9 接线存在性：六台的 props/标注/方法都在源码里', () => {
  const app = src('app/src/App.tsx');
  const eegLab = src('app/src/components/EegAnalysisLab.tsx');
  const cellLab = src('app/src/components/CellularLab.tsx');
  const headLab = src('app/src/components/HeadSphereLab.tsx');
  const dipoleLab = src('app/src/components/DipoleLab.tsx');
  const stimLab = src('app/src/components/StimLab.tsx');
  const expLab = src('app/src/components/ExperimentLab.tsx');
  const client = src('app/src/lib/simClient.ts');
  const contract = src('docs/frontend-backend-contract.md');

  // EEG：直播推导 + 有效采样率标注 + 记录持久化。
  assert.ok(eegLab.includes('runLiveExperiment'), 'EegAnalysisLab 应调用 runLiveExperiment');
  assert.ok(eegLab.includes('有效采样率'), 'EEG 台应标注有效采样率 60 Hz');
  assert.ok(eegLab.includes('getLiveRecordingStore'), 'EEG 台应从 store 恢复记录');
  // 细胞：删掉手填 E，live E 由 App 传；反向经 handleBiasChange 应用。
  assert.ok(!cellLab.includes('useState(0.5)'), 'CellularLab 不应再有手填默认 0.50');
  assert.ok(!cellLab.includes('setRegionE'), 'CellularLab 不应再有手填 E 的 setter');
  assert.ok(cellLab.includes('liveE'), 'CellularLab 应接收 liveE prop');
  assert.ok(app.includes('liveE={selectedE}'), 'App 应把 live E 传进 CellularLab');
  assert.ok(app.includes('onApplyBias={handleBiasChange}'), 'App 应把 handleBiasChange 作反向应用');
  assert.ok(cellLab.includes('onApplyBias'), 'CellularLab 应有反向应用入口');
  // HEAD / DIPOLE：直播源 + 独立演示标注。
  for (const [name, code] of [['HeadSphereLab', headLab], ['DipoleLab', dipoleLab]]) {
    assert.ok(code.includes('liveSource'), `${name} 应接收 liveSource`);
    assert.ok(code.includes('直播源'), `${name} 应标注直播源`);
    assert.ok(code.includes('独立演示'), `${name} 未接通时应标“独立演示”`);
  }
  // 刺激：感觉输入经 onPulse 进动力学；目标默认选中脑区。
  assert.ok(stimLab.includes('onPulse'), 'StimLab 应接收 onPulse');
  assert.ok(stimLab.includes('sensoryTargetNodes'), 'StimLab 应按 label 找感觉靶区');
  assert.ok(!stimLab.includes('仅记录，不进入动力学'), '听觉不应再写“仅记录、不进入动力学”');
  assert.ok(app.includes('onPulse='), 'App 应把 pulseAt 传进 StimLab');
  // 对照：直播 A、直播回放、直播闭环。
  assert.ok(expLab.includes('直播闭环'), 'ExperimentLab 应有直播闭环');
  assert.ok(expLab.includes('直播回放'), 'ExperimentLab 应有直播回放');
  assert.ok(expLab.includes('runLiveExperiment'), '对照 A 应复用直播推导');
  // SimClient：pulseAt + 幅度钳制 [-2, 2]。
  assert.ok(client.includes('pulseAt('), 'SimClient 应有 pulseAt');
  assert.ok(/pulseAt[\s\S]{0,400}Math\.min\(2, Math\.max\(-2/.test(client), 'pulseAt 幅度应钳制到 [-2, 2]');
  // 契约 §1.14 已登记。
  assert.ok(contract.includes('### 1.14 PR8-LINK'), '契约应新增 §1.14');
  assert.ok(contract.includes(LIVE_DERIVATION_ID), '契约应登记直播推导 ID');
  assert.equal(LIVE_SNAPSHOT_HZ, 60);
});
