/**
 * PR8-NUMFIX — live 站实测 5 项数值异常 + 1 处 ERP 诚实性缺陷的修复测试。
 *
 * 跑法：node --experimental-strip-types --test tests/pr8/methods-numfix.test.mjs
 *
 * 诊断复算（默认 10 s WC 实验，合成 fixture
 * `tests/pr6/fixtures/eeg-recording-reference.json`；真实球形 fixture
 * 复算值见 tests/pr8/debug-rounds.md）：
 * - 壳记录（plain WC，无 late 机制）ERP：oddball/standard/差异波峰全 <0.001 µV、
 *   潜伏期全 252 ms（峰值窗首；窗内只有早期峰的衰减尾巴，图上纵轴半幅
 *   0.234 µV 是全 epoch 最大 |均值| 0.204 µV 的早期峰，不在峰值窗内）；
 * - late 机制 oddball 实验：oddball 峰 0.174 µV @352 ms、窗均值 0.0697 µV；
 * - 无噪声时试次间最大差 1.9e-16 µV → ITC 恒 1.000（退化值）；0.25 µV
 *   白噪声下试次间最大差 1.28 µV、10 Hz ITC 均值 0.33；
 * - topo@400 ms 全部电极值恰为 0（第一事件在 1000 ms，400 ms 是刺激前静息态），
 *   全记录最大响应在 1028 ms；
 * - TES 默认目标 [0,0,70] |E| = 0.793 V/m；TMS 同目标在圆环轴上 |E| = 0
 *   （对称性，正确值）；TMS 网格最大 32.631 V/m（偏轴点）。
 *
 * 每项都有一条“修前失败、修后通过”的断言（源码级存在性断言 + 数值断言），
 * 不只改文案。erspItc 本身的计算未动（ITC=1 在全同试次下数学上正确，
 * 退化的是默认实验的试次，不是公式；见 tfr-topo-inverse.test.mjs 的
 * 20 Hz 突发 ITC ≈ 1.00 断言，仍有效）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { runExperiment } from '../../app/src/lib/eegRecording.ts';
import {
  analyseErp,
  differenceWaveErp,
  epochOddballExperiment,
  filterEpochsByCondition,
  runOddballExperiment,
} from '../../app/src/lib/lateResponse.ts';
import {
  ITC_DEGENERATE_THRESHOLD_UV,
  erspItc,
  maxTrialDifferenceUv,
} from '../../app/src/lib/signalProcessing.ts';
import { topoAtTime } from '../../app/src/lib/topography.ts';
import {
  DEFAULT_TES_ELECTRODES,
  DEFAULT_TMS_COIL,
  tesElectricField,
  tesFieldGrid,
  tmsFieldForShape,
  tmsFieldGrid,
} from '../../app/src/lib/stimulation.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => readFileSync(join(root, p), 'utf8');
const fx = JSON.parse(src('tests/pr6/fixtures/eeg-recording-reference.json'));
const synth = fx.synthetic_fixture;
const NOISE = fx.noise.params;

function shellRun(noise) {
  return runExperiment({
    fixture: synth,
    durationMs: 10000,
    montage: '10-20',
    reference: { mode: 'average' },
    sourceModel: 'wc',
    noise: noise ?? null,
    seed: 1,
  });
}

test('NUMFIX-1 ERP：壳记录窗内峰 ≈0 @窗首（复现），late 路径峰 0.174 @352（修复）', () => {
  // 壳路径（修前状态的数值刻画）：三行峰值全 <0.001 µV、潜伏期全 252 ms。
  const { recording, events } = shellRun(null);
  const ep = epochOddballExperiment(recording, events);
  const odd = analyseErp(filterEpochsByCondition(ep, 'oddball'), 'Pz');
  const std = analyseErp(filterEpochsByCondition(ep, 'standard'), 'Pz');
  const diff = differenceWaveErp(odd, std, ep.channels.indexOf('Pz'));
  for (const [name, r] of [['oddball', odd], ['standard', std], ['diff', diff]]) {
    assert.ok(Math.abs(r.peakUv) < 0.001, `shell ${name} peak ${r.peakUv} 应 <0.001 µV`);
    assert.equal(r.peakLatencyMs, 252, `shell ${name} latency 应为窗首 252 ms`);
  }
  // late 路径（ErpTab 新增按钮走的管线）：oddball 峰 0.174 µV @352 ms。
  const late = runOddballExperiment({});
  const lateEp = epochOddballExperiment(late.recording, late.events);
  const lateOdd = analyseErp(filterEpochsByCondition(lateEp, 'oddball'), 'Pz');
  assert.ok(Math.abs(lateOdd.peakUv - 0.174) < 0.005, `late odd peak ${lateOdd.peakUv}`);
  assert.ok(Math.abs(lateOdd.peakLatencyMs - 352) <= 4, `late odd latency ${lateOdd.peakLatencyMs}`);
  assert.ok(Math.abs(lateOdd.windowMeanUv - 0.0697) < 0.005, `late odd window mean ${lateOdd.windowMeanUv}`);
  // ErpTab 必须真有这条路径（修前：文件不含 runOddballExperiment，断言失败）。
  const erpTab = src('app/src/components/ErpTab.tsx');
  assert.ok(erpTab.includes('runOddballExperiment'), 'ErpTab 应 import 并跑 late oddball 实验');
  assert.ok(erpTab.includes('运行 oddball 实验（late 机制）并切分'), 'ErpTab 应有显式 late 按钮');
});

test('NUMFIX-2 ERP 诚实性：文案按 epochs 来源条件化，不许无条件写 0.17 µV', () => {
  const erpTab = src('app/src/components/ErpTab.tsx');
  assert.ok(erpTab.includes("epochSource?.kind === 'late'"), '文案应按 epochs 来源条件化');
  // 0.17 µV 那句只许出现在 late 分支里：全文件只应有一处“模型峰约 0.17 µV”，
  // 且它必须在 late 分支的 JSX 内（修前：无条件出现一次，断言失败）。
  const idx = erpTab.indexOf('模型峰约 0.17 µV');
  assert.ok(idx > 0, 'late 分支应写模型峰约 0.17 µV');
  assert.equal(erpTab.indexOf('模型峰约 0.17 µV', idx + 1), -1, '0.17 µV 只应出现一次（late 分支）');
  const lateBranch = erpTab.indexOf("epochSource?.kind === 'late' ? (");
  assert.ok(lateBranch > 0 && idx > lateBranch, '0.17 µV 应在 late 分支内');
  // 壳路径文案必须如实写窗内无响应（修前无此句）。
  assert.ok(erpTab.includes('窗内基本无响应'), '壳路径文案应写窗内基本无响应');
  assert.ok(erpTab.includes('峰值小于 0.001 µV'), '壳路径文案应写峰 <0.001 µV');
  // 幅度缺口仍在，不许靠重缩放修掉（lateResponse 全文不含 rescale，契约守卫）。
  assert.ok(!/rescale/i.test(src('app/src/lib/lateResponse.ts')), 'lateResponse.ts 不应含 rescale');
});

test('NUMFIX-3 ITC：无噪声试次全同 → ITC 恒 1.000 是退化值；有噪声才可读', () => {
  // 退化阈值 1e-6 µV 的实测依据：无噪声 1.9e-16 µV，0.25 µV 白噪声 1.28 µV。
  assert.equal(ITC_DEGENERATE_THRESHOLD_UV, 1e-6);
  const { recording, events } = shellRun(null);
  const ep = epochOddballExperiment(recording, events);
  const dPlain = maxTrialDifferenceUv(ep, 'Pz');
  assert.ok(dPlain < ITC_DEGENERATE_THRESHOLD_UV, `无噪声试次间最大差 ${dPlain} 应 <1e-6 µV`);
  const tfr = erspItc(ep, 'Pz', [10], 'morlet', ep.baselineMs);
  assert.ok(Math.abs(Math.max(...tfr.itc[0]) - 1) < 1e-9, '无噪声 ITC 最大值应为 1.000（退化，浮点误差内）');
  assert.ok(tfr.itc[0].reduce((a, b) => a + b, 0) / tfr.itc[0].length > 0.99, '无噪声 ITC 均值应 >0.99');
  // 有噪声：试次有了差异，ITC 恢复为可读测量（<1，且 10 Hz 均值约 0.27）。
  const noisy = shellRun(NOISE);
  const epN = epochOddballExperiment(noisy.recording, noisy.events);
  const dNoisy = maxTrialDifferenceUv(epN, 'Pz');
  assert.ok(dNoisy > 0.1, `有噪声试次间最大差 ${dNoisy} 应 >0.1 µV`);
  const tfrN = erspItc(epN, 'Pz', [10], 'morlet', epN.baselineMs);
  assert.ok(Math.max(...tfrN.itc[0]) < 0.9, `有噪声 ITC 最大值 ${Math.max(...tfrN.itc[0])} 应 <0.9`);
  // 边界情形（阈值 1e-6 的适用范围）：late 实验的混合试次不退化——标准与
  // oddball 波形本就不同（差 0.166 µV），ITC 均值 0.77 是真实测量；
  // 只取 oddball 子集时差 3.9e-3 µV（逐试次基线校正引入），仍 >1e-6，
  // 故 TfrTab 在 late 数据下展示 ITC 数值是正确的，不压住。
  const late = runOddballExperiment({});
  const lateEp = epochOddballExperiment(late.recording, late.events);
  assert.ok(maxTrialDifferenceUv(lateEp, 'Pz') > 0.1, 'late 混合试次差应 >0.1 µV（条件不同）');
  const lateOddEp = filterEpochsByCondition(lateEp, 'oddball');
  assert.ok(maxTrialDifferenceUv(lateOddEp, 'Pz') > 1e-6, 'late oddball 子集差应 >1e-6 µV（基线校正抖动）');
  // TfrTab 必须在退化时压住 ITC 数值、写清原因（修前无此处理）。
  const tfrTab = src('app/src/components/TfrTab.tsx');
  assert.ok(tfrTab.includes('ITC_DEGENERATE_THRESHOLD_UV'), 'TfrTab 应用退化阈值判断');
  assert.ok(tfrTab.includes('不适用（试次完全相同'), 'TfrTab 退化时应写 ITC 不适用');
});

test('NUMFIX-4 地形：400 ms 全是 0 是刺激前静息态；最大响应在 1028 ms', () => {
  const { recording } = shellRun(null);
  assert.equal(recording.timesMs[0], 0);
  const t400 = topoAtTime(recording, 400);
  assert.ok(
    t400.electrodeValues.every((e) => e.valueUv === 0),
    'topo@400 ms 全部电极值应恰为 0（第一事件在 1000 ms，400 ms 是刺激前静息态）',
  );
  // 全记录最大响应时刻：1028 ms（第一事件后约 28 ms），最大 |V| > 0.05 µV。
  let bestT = 0;
  let bestV = 0;
  for (let j = 0; j < recording.timesMs.length; j++) {
    const m = Math.max(...recording.dataUv.map((row) => Math.abs(row[j])));
    if (m > bestV) {
      bestV = m;
      bestT = recording.timesMs[j];
    }
  }
  assert.equal(bestT, 1028, `最大响应时刻应为 1028 ms，实测 ${bestT}`);
  assert.ok(bestV > 0.05, `最大响应 ${bestV} 应 >0.05 µV`);
  const tBest = topoAtTime(recording, bestT);
  assert.ok(
    Math.max(...tBest.electrodeValues.map((e) => Math.abs(e.valueUv))) > 0.05,
    '最大响应时刻的地形应非空',
  );
  // TopoTab 必须在记录到达时自动跳到最大响应时刻（修前无此逻辑）。
  const topoTab = src('app/src/components/TopoTab.tsx');
  assert.ok(topoTab.includes('跳到最大响应时刻'), 'TopoTab 应有跳到最大响应时刻的按钮');
  assert.ok(topoTab.includes('maxResponse'), 'TopoTab 应算全记录最大响应时刻');
  // 2D/3D 来源差异仍须如实标注（不假装同源）。
  assert.ok(topoTab.includes('与 2D 图的记录数据无关'), 'TopoTab 应写清 3D 源与 2D 记录无关');
});

test('NUMFIX-5 TES：Level B 读数必须是 TES 场（0.793 V/m），不是轴上为零的 TMS 场', () => {
  // 数值：TES 默认目标 |E| = 0.793 V/m；TMS 同目标在圆环轴上 |E| = 0（对称性，正确值）；
  // TMS 网格最大 32.631 V/m（偏轴点）——旧 UI 把三者混在一起才显得异常。
  const tes = tesElectricField(DEFAULT_TES_ELECTRODES, [0, 0, 70], 0.33);
  assert.ok(Math.abs(tes.magnitudeVm - 0.793) < 0.01, `TES 目标 |E| ${tes.magnitudeVm} 应 ≈0.793 V/m`);
  const tms = tmsFieldForShape(DEFAULT_TMS_COIL, 'circular', [0, 0, 70]);
  assert.ok(tms.magnitudeVm < 1e-9, `TMS 轴上目标 |E| ${tms.magnitudeVm} 应为 0（对称性，浮点误差内）`);
  const tmsGrid = tmsFieldGrid(DEFAULT_TMS_COIL, 40);
  assert.ok(
    Math.abs(Math.max(...tmsGrid.map((p) => p.magnitudeVm)) - 32.631) < 0.01,
    `TMS 网格最大 |E| 应 ≈32.631 V/m`,
  );
  const tesGrid = tesFieldGrid(DEFAULT_TES_ELECTRODES, 0.33, 40);
  assert.ok(
    Math.abs(Math.max(...tesGrid.map((p) => p.magnitudeVm)) - 2.164) < 0.01,
    `TES 网格最大 |E| 应 ≈2.164 V/m`,
  );
  // StimLab 的场与网格必须跟随级别（修前：field/grid 跟 fieldSource，默认 'tms'，
  // Level B 读数栏显示 TMS 场 0.000；修后 B→TES、C→TMS，fieldSource 只用于 D）。
  const stimLab = src('app/src/components/StimLab.tsx');
  assert.ok(stimLab.includes("level === 'B' ? 'tes'"), 'StimLab 场来源应按级别定（B→TES）');
  assert.ok(!stimLab.includes("const field = fieldSource === 'tes' ? tes : tms;"),
    'StimLab 不应再让目标处电场直接跟 fieldSource');
  assert.ok(stimLab.includes('activeFieldSource'), 'StimLab 应有按级别算出的有效场来源');
});
