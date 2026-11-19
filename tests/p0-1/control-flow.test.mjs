/**
 * P0-1A: exhaustive *syntactic* inventory of native JSX controls and
 * targeted semantic regression checks. The source-level scan is NOT a substitute for
 * Playwright causal verification or scientific validation.
 *
 * Run after `cd app && npm ci`:
 * node --test tests/p0-1/control-flow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const CONTROL_FILES = [
  'app/src/App.tsx',
  'app/src/components/ExplorePanel.tsx',
  'app/src/components/CellularLab.tsx',
  'app/src/components/ScenarioLauncher.tsx',
  'app/src/components/EegAnalysisLab.tsx',
  'app/src/components/EegWaveTab.tsx',
  'app/src/components/ErpTab.tsx',
  'app/src/components/TfrTab.tsx',
  'app/src/components/TopoTab.tsx',
  'app/src/components/InverseTab.tsx',
  'app/src/components/WavesTab.tsx',
  'app/src/components/HeadSphereLab.tsx',
  'app/src/components/LocalBEMLab.tsx',
  'app/src/components/DipoleLab.tsx',
  'app/src/components/StimLab.tsx',
  'app/src/components/ExperimentLab.tsx',
  'app/src/components/BrainScene.tsx',
  'app/src/components/ActivityChart.tsx',
  'app/src/components/ParamControl.tsx',
  'app/src/components/PhysicsHome.tsx',
  'app/src/components/NetworkStatePanel.tsx',
  'app/src/components/ui/ControlField.tsx',
  'app/src/components/ui/LanguageSwitch.tsx',
  // Phase 4：台子是唯一入口，全部控件都须进网；Dropdown.tsx 本体不列入——
  // 它的 <select {...selectProps}> 经展开转发 handler，字面量上无 onChange，
  // 列入会误报；各调用点的 <Dropdown onChange=…> 已在网内。
  // 最小 3D 闭环（2026-11-19）：旧台子展示（ClosedLoopBench /
  // PictorialLoop / BenchDrillDown / SimulatedHand）已删除，改由
  // MinimalLoop.tsx 进网（运行/停止 + 两个回到回路图 + 通道网格按钮，
  // 共 4 个）；场景点按是原生 canvas 指针事件，不在字面量口径内（与
  // BrainScene 同款，见 P0-1B 段）。
  'app/src/components/MinimalLoop.tsx',
];
function source(p) { return readFileSync(join(ROOT, p), 'utf8'); }
// TypeScript 7 uses a native compiler and does not expose the historical
// lib/typescript.js parser. Scan JSX opening tags with balanced {…} and quoted
// strings instead. This is a SOURCE-LEVEL audit, not an AST or runtime proof.
function scan() {
  const rows = [];
  for (const path of CONTROL_FILES) {
    const code = source(path);
    const re = /<(button|input|select|textarea|Dropdown)\b/g;
    for (const match of code.matchAll(re)) {
      const pos = match.index;
      let depth = 0;
      let quote = null;
      let escaped = false;
      let end = -1;
      for (let i = pos; i < code.length; i++) {
        const ch = code[i];
        if (quote !== null) {
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (ch === quote) quote = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') { depth++; continue; }
        if (ch === '}' && depth > 0) { depth--; continue; }
        if (ch === '>' && depth === 0) { end = i; break; }
      }
      assert.ok(end !== -1, `Unterminated <${match[1]}> opening tag: ${path}:${pos}`);
      const openingTag = code.slice(pos, end + 1);
      const attrs = [...openingTag.matchAll(/\b([A-Za-z_][A-Za-z_0-9]*)\s*=/g)]
        .map(m => m[1]);
      const line = code.slice(0, pos).split('\n').length;
      rows.push({ path, line, name: match[1], attrs,
        callback: attrs.filter(a => a.startsWith('on')) });
    }
  }
  return rows;
}

test('P0-1 surface: all native JSX controls have a bound interaction handler', () => {
  const rows = scan();
  // 最小 3D 闭环实测 216（旧 244 − 台子 27 − PictorialLoop 4 −
  // BenchDrillDown 1 − SimulatedHand 0 + MinimalLoop 4：运行/停止 +
  // 波形放大回到回路图 + 通道视图回到回路图 + 通道网格按钮）。
  // 场景点按是原生 canvas 指针事件，不在字面量口径内（与 BrainScene
  // 同款，见 P0-1B 段）；SVG 节点 <g role="button"> 已随旧台子删除。
  // 下限即实测值，入口再删须同步改这里与台账，不得悄悄放宽。
  assert.ok(rows.length >= 216, `Unexpectedly small control surface: ${rows.length}`);
  for (const c of rows) {
    const handler = c.name === 'button' ? 'onClick' : 'onChange';
    assert.ok(c.attrs.includes(handler),
      `${c.path}:${c.line} <${c.name}> missing ${handler}; mark disabled or wire a real action`);
  }
  const counts = Object.fromEntries(CONTROL_FILES.map(p => [p, rows.filter(r => r.path === p).length]));
  console.log('P0-1 JSX control inventory:', JSON.stringify({ total: rows.length, counts }));
});

test('C01: minimal loop is the only bench entry; region selection stays in #basic', () => {
  // 最小 3D 闭环（2026-11-19）：旧台子展示删除，App 的 bench 分支只挂
  // MinimalLoop；最小版里没有脑区选区（点大脑开 64 通道视图，不选脑
  // 区），选区只剩 #basic 回退（PhysicsHome 的 BrainScene 网络视图）
  // 还在用 App 的 selectedId。
  const app = source('app/src/App.tsx');
  const minimal = source('app/src/components/MinimalLoop.tsx');
  assert.doesNotMatch(app, /ExplorePanel/);
  assert.doesNotMatch(minimal, /ExplorePanel/);
  // Mount/import forms only: the App header comment names the deleted
  // files as documentation, which must not trip this test.
  assert.doesNotMatch(app, /<ClosedLoopBench/);
  assert.doesNotMatch(app, /<PictorialLoop/);
  assert.doesNotMatch(app, /<BenchDrillDown/);
  assert.doesNotMatch(app, /<PictorialHead/);
  assert.doesNotMatch(app, /<SimulatedHand/);
  assert.doesNotMatch(app, /from '\.\/components\/ClosedLoopBench'/);
  assert.match(app, /<MinimalLoop/);
  assert.doesNotMatch(minimal, /selectedId/);
  assert.match(app, /<BrainScene[\s\S]*?selectedId=\{selectedId\}/);
  assert.match(app, /<BrainScene[\s\S]*?onSelect=\{setSelectedId\}/);
});

test('C02/C03: mapped live currents trigger the actual LIF/HH solvers on the same click', () => {
  const s = source('app/src/components/CellularLab.tsx');
  assert.match(s, /run\(\{ kind: 'lif', lifCurrentPA: mapped, synapse: false \}\)/);
  assert.match(s, /run\(\{ kind: 'hh', hhCurrentDensity: mapped \}\)/);
  assert.match(s, /const effectiveAmpPA = overrides\.lifCurrentPA \?\? ampPA/);
  assert.match(s, /const effectiveAmpHH = overrides\.hhCurrentDensity \?\? ampHH/);
  assert.match(s, /simulateLif\(DEFAULT_LIF_PARAMS, 500/);
  assert.match(s, /simulateHodgkinHuxley\(DEFAULT_HH_PARAMS, 200/);
  assert.match(s, /setResult\(\{/);
});

test('C04: scenario launcher entry is cut; scenarios lib stays with no UI entry', () => {
  // Phase 4：一键场景启动器随 #advanced 删除；场景定义（lib/scenarios.ts）
  // 未动，全仓无 UI 入口（App.tsx 头注释已写明）。
  const app = source('app/src/App.tsx');
  const minimal = source('app/src/components/MinimalLoop.tsx');
  assert.doesNotMatch(app, /ScenarioLauncher/);
  assert.doesNotMatch(minimal, /ScenarioLauncher/);
  assert.match(app, /scenarios\.ts etc\. stay, with no UI entry/);
});

test('C05/C07: late ERP publishes its source Raw, events and epochs together', () => {
  const erp = source('app/src/components/ErpTab.tsx');
  const shell = source('app/src/components/EegAnalysisLab.tsx');
  assert.match(erp, /运行稀有刺激实验（同步全部分析）/);
  assert.match(erp, /onEpochsChange\(ep, 'independent-late', \{ recording: rec, events: evs, parameters: paramsSnapshot \}\)/);
  assert.match(shell, /setRecording\(rec\)/);
  assert.match(shell, /setEvents\(input\.events\.map/);
  assert.match(shell, /setEpochs\(\{ \.\.\.ep, provenance: session\.provenance/);
  assert.match(shell, /setSelectedChannel\(input\.recording\.channels\[0\]\.label\)/);
});

test('C06: separate source projection is labeled 2D and independent', () => {
  const topo = source('app/src/components/TopoTab.tsx');
  assert.match(topo, /头皮采样点的 2D 投影/);
  assert.match(topo, /不是同一时刻、同一源的第二种视图/);
  assert.match(topo, /forwardHeadPotential\(loadedFixture, srcPos, moment, \{ mode: reference \}\)/);
  assert.match(topo, /topoAtTime\(recording, atTimeMs\)/);
});

test('P0-1B: explicit non-JSX gesture, wheel, and multi-view causal observers remain wired', () => {
  const scene = source('app/src/components/BrainScene.tsx');
  for (const name of ['pointermove', 'pointerrawupdate', 'pointerdown', 'pointerup',
                      'pointercancel', 'pointerleave', 'dblclick']) {
    const nativeListener = new RegExp(String.raw`addEventListener\s*\(\s*['"]${name}['"]`);
    assert.match(scene, nativeListener, `3D canvas missing native ${name} registration`);
  }
  assert.match(scene, /if \(!e\.isPrimary \|\| \(e\.pointerType === 'mouse' && e\.button !== 0\)\) return;/);
  assert.match(scene, /if \(!pointerDown \|\| !e\.isPrimary\) return;/);
  assert.match(scene, /if \(moved\) return; \/\/ 拖拽旋转/);
  assert.match(scene, /onSelectRef\.current\(id\);/);
  assert.match(scene, /onPulseRef\.current\(id\);/);

  const chart = source('app/src/components/ActivityChart.tsx');
  assert.match(chart, /sim\.subscribe\(\(snap: Snapshot\)/);
  assert.match(chart, /snap\.e\[id\]/);
  assert.match(chart, /data-selected-region-id=\{selectedId \?\? 'none'\}/);

  const control = source('app/src/components/ParamControl.tsx');
  assert.match(control, /el\.addEventListener\('wheel', onWheel, \{ passive: false \}\)/);
  assert.match(control, /onChangeRef\.current\(/);
  assert.match(control, /onChange\(Number\(e\.target\.value\) \/ 1000\)/);
});

test('P0-1B: every native JSX control has a scientific-scope entry, not a fabricated runtime proof', () => {
  const registry = JSON.parse(source('docs/p0-1b-control-register.json'));
  const actual = scan();
  assert.equal(registry.counts.total, actual.length);
  assert.equal(actual.length, 216, '最小 3D 闭环重数：244 − 台子 27 − PictorialLoop 4 − BenchDrillDown 1 − SimulatedHand 0 + MinimalLoop 4');
  assert.equal(registry.entries.length, actual.length);
  assert.equal(new Set(registry.entries.map(c => c.controlId)).size, actual.length,
    'every JSX control needs a distinct audit ID');
  const allowed = new Set(['LIVE', 'SELECTION', 'VISUAL', 'NAV', 'EXPORT',
    'INDEPENDENT', 'DERIVED', 'CONFIG', 'MIXED', 'DIAGNOSTIC', 'REVIEW']);
  const currentByFile = new Map();
  for (const row of actual) {
    const file = row.path.split('/').at(-1).replace('.tsx', '');
    const n = (currentByFile.get(file) ?? 0) + 1;
    currentByFile.set(file, n);
    const expected = registry.entries.find(x => x.controlId ===
      file + ':' + row.name + ':' + n);
    assert.ok(expected, 'missing registry entry ' + row.path + ':' + row.line);
    assert.equal(expected.path, row.path);
    assert.ok(allowed.has(expected.category));
    assert.equal(expected.evidence, 'static-handler-bound (not runtime-proven)');
    assert.ok(expected.modelBoundary?.length > 10,
      'every control needs a documented physical/model scope');
    if (row.name === 'button') assert.ok(expected.events.includes('onClick'));
    else assert.ok(expected.events.includes('onChange'));
  }
  assert.equal(registry.nativeCanvas.events.length, 7,
    '3D native pointer events must be audited outside static JSX census');
});
