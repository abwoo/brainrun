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
];
function source(p) { return readFileSync(join(ROOT, p), 'utf8'); }
// TypeScript 7 uses a native compiler and does not expose the historical
// lib/typescript.js parser. Scan JSX opening tags with balanced {…} and quoted
// strings instead. This is a SOURCE-LEVEL audit, not an AST or runtime proof.
function scan() {
  const rows = [];
  for (const path of CONTROL_FILES) {
    const code = source(path);
    const re = /<(button|input|select|textarea)\b/g;
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
  assert.ok(rows.length >= 190, `Unexpectedly small control surface: ${rows.length}`);
  for (const c of rows) {
    const handler = c.name === 'button' ? 'onClick' : 'onChange';
    assert.ok(c.attrs.includes(handler),
      `${c.path}:${c.line} <${c.name}> missing ${handler}; mark disabled or wire a real action`);
  }
  const counts = Object.fromEntries(CONTROL_FILES.map(p => [p, rows.filter(r => r.path === p).length]));
  console.log('P0-1 JSX control inventory:', JSON.stringify({ total: rows.length, counts }));
});

test('C01: EXPLORE selection writes App selectedId shared by scene and activity chart', () => {
  const explore = source('app/src/components/ExplorePanel.tsx');
  const app = source('app/src/App.tsx');
  assert.match(explore, /selectedRegionId: number \| null/);
  assert.match(explore, /onSelectRegion: \(id: number\) => void/);
  assert.match(explore, /onClick=\{\(\) => onSelectRegion\(r\.id\)\}/);
  assert.doesNotMatch(explore, /const \[selectedId, setSelectedId\] = useState/);
  assert.match(app, /selectedRegionId=\{selectedId\}/);
  assert.match(app, /onSelectRegion=\{setSelectedId\}/);
  assert.match(app, /<BrainScene[\s\S]*?selectedId=\{selectedId\}/);
  assert.match(app, /<ActivityChart[\s\S]*?selectedId=\{selectedId\}/);
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

test('C04: scenario launcher does not pretend navigation imports scenario results', () => {
  const launcher = source('app/src/components/ScenarioLauncher.tsx');
  assert.match(launcher, /进入独立实验台（不载入结果）/);
  assert.match(launcher, /onOpenLab\(s\.openLab, s\.eegTab\)/);
  const app = source('app/src/App.tsx');
  assert.match(app, /场景摘要尚未自动载入实验台/);
});

test('C05/C07: independent late ERP epochs cannot be silently described as shared raw EEG', () => {
  const erp = source('app/src/components/ErpTab.tsx');
  const shell = source('app/src/components/EegAnalysisLab.tsx');
  assert.match(erp, /运行独立 oddball（替换 ERP\/TFR 试次）/);
  assert.match(erp, /不会替换 EEG 原始记录/);
  assert.match(shell, /late ERP 可替换 ERP\/TFR 试次/);
});

test('C06: separate source projection is labeled 2D and independent', () => {
  const topo = source('app/src/components/TopoTab.tsx');
  assert.match(topo, /头皮采样点的 2D 投影/);
  assert.match(topo, /不是同一时刻、同一源的第二种视图/);
  assert.match(topo, /forwardHeadPotential\(loadedFixture, srcPos, moment, \{ mode: reference \}\)/);
  assert.match(topo, /topoAtTime\(recording, atTimeMs\)/);
});
