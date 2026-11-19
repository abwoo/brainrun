/**
 * Minimal 3D closed-loop invariants (2026-11-19 rebuild).
 *
 * Static guards for the rules the browser test cannot cheaply prove:
 * - no focus theft anywhere in the new code (PR #45 iron rule);
 * - the protocol/subject are fixed literals, not UI controls;
 * - the deleted bench presentation stays deleted;
 * - the open overlays are memoized so they do not re-render at the
 *   ~15 Hz snapshot rate (crash investigation, 2026-11-19);
 * - rendering/refresh throttle while an overlay is open or the tab
 *   is backgrounded (same investigation).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(join(root, rel), 'utf8');

const minimalLoop = src('app/src/components/MinimalLoop.tsx');
const minimalScene = src('app/src/components/MinimalScene.tsx');
const app = src('app/src/App.tsx');

test('no focus theft: no .focus() / autoFocus in the minimal code', () => {
  for (const [name, text] of [['MinimalLoop', minimalLoop], ['MinimalScene', minimalScene]]) {
    // A bare `.focus(` also matches the comments that name the rule, so
    // require a receiver (identifier / `)` / `]`) directly before the dot.
    assert.doesNotMatch(text, /[A-Za-z0-9_)\]]\.focus\(/, `${name} must never call .focus()`);
    assert.doesNotMatch(text, /autoFocus/, `${name} must never use autoFocus`);
  }
  // The only keyboard effect is mount-only (empty dep array) and reads
  // onClose through a ref — a changing callback must never land in an
  // effect dep array (PR #45 iron rule).
  assert.match(minimalLoop, /closeRef\.current = closeOverlay;/);
  assert.match(minimalLoop, /window\.addEventListener\('keydown', onKey\);\n    return \(\) => window\.removeEventListener\('keydown', onKey\);\n  \}, \[\]\);/);
});

test('fixed protocol and subject are literals; no sliders or protocol menu', () => {
  assert.ok(minimalLoop.includes('standardAmplitude: 1, oddballAmplitude: 2,'),
    'oddball amplitudes are fixed literals 1 / 2');
  assert.ok(minimalLoop.includes('isiMs: 1000, oddballEvery: 5, pulseDurationMs: 100,'),
    'oddball timing is fixed literals 1000 ms / every 5th / 100 ms');
  // Fixed subject: MinimalLoop applies DEFAULT_PARAMS verbatim on
  // engine-ready (g 0.35 / c_ei 4.0 / ou_sigma 0.10 live there), forces
  // spontaneous background, and builds the simulated subject from the
  // fixed seed / RT window. No UI can change any of it.
  const simClient = src('app/src/lib/simClient.ts');
  assert.ok(simClient.includes('g: 0.35,'), 'DEFAULT_PARAMS g is 0.35');
  assert.ok(simClient.includes('c_ei: 4.0,'), 'DEFAULT_PARAMS c_ei is 4.0');
  assert.ok(simClient.includes('ou_sigma: 0.10,'), 'DEFAULT_PARAMS ou_sigma is 0.10');
  assert.ok(minimalLoop.includes('sim.setParams({ ...DEFAULT_PARAMS })'),
    'minimal loop applies DEFAULT_PARAMS verbatim');
  assert.ok(minimalLoop.includes("sim.setBackgroundMode('spontaneous')"),
    'minimal loop forces spontaneous background');
  assert.ok(minimalLoop.includes('createSimulatedSubject({ seed: 1, rtMinMs: 320, rtMaxMs: 440 })'),
    'simulated subject is fixed seed 1 / RT 320–440 ms');
  assert.doesNotMatch(minimalLoop, /RangeControl/, 'no sliders in the minimal loop');
  assert.doesNotMatch(minimalLoop, /<select/, 'no dropdowns in the minimal loop');
});

test('deleted bench presentation stays deleted from the minimal code', () => {
  for (const [name, text] of [['MinimalLoop', minimalLoop], ['MinimalScene', minimalScene]]) {
    assert.doesNotMatch(text, /<ClosedLoopBench/, `${name} must not mount the old bench`);
    assert.doesNotMatch(text, /<PictorialLoop/, `${name} must not mount the old pictorial loop`);
    assert.doesNotMatch(text, /<BenchDrillDown/, `${name} must not mount the old drill-down`);
    assert.doesNotMatch(text, /<ErpTab|<TopoTab|<EegAnalysisLab/,
      `${name} must not mount analysis tabs`);
    assert.doesNotMatch(text, /<LanguageSwitch/, `${name} must not render the language switch`);
    assert.doesNotMatch(text, /liveMomentNAm/, `${name} must not show a live moment readout`);
  }
  assert.match(app, /<MinimalLoop/, 'App mounts the minimal loop');
  assert.doesNotMatch(app, /<ClosedLoopBench/, 'App must not mount the old bench');
});

test('overlays are memoized and throttle rendering while open', () => {
  assert.match(minimalLoop, /memo\(function WaveOverlay/, 'wave overlay must be memoized');
  assert.match(minimalLoop, /memo\(function ChannelOverlay/, 'channel overlay must be memoized');
  // Acquisition refresh is skipped while an overlay is open or the tab
  // is backgrounded; the protocol clock (engine.tick) is not.
  assert.match(minimalLoop, /overlayRef\.current !== null \|\| document\.hidden/,
    'refresh must be throttled while an overlay is open or the tab is hidden');
  assert.match(minimalScene, /overlayOpenRef\.current \|\| document\.hidden/,
    'scene must throttle WebGL rendering while an overlay is open or the tab is hidden');
  assert.match(minimalScene, /now - lastRender < 500/, 'throttled rendering must cap at ~2 fps');
});

/**
 * Big single-channel view must show the real model output (2026-11-19).
 *
 * Live defect: the brain overlay's big waveform was one flat line with a
 * "±1.0 µV" label while the 8-channel view on the same run visibly
 * fluctuated. Root cause was benchWaveform.ts drawWaveform flooring its
 * auto-scale peak at 1 µV (the multi-channel painter floors at 1e-6):
 * a ~0.001 µV model signal (R-05) deflects ~0.1 px under a 1 µV scale.
 * This test draws a 0.001 µV sine through the real drawWaveform (the
 * repo's own typescript transpiles the single dependency-free module)
 * onto a stub canvas and asserts the trace actually spans the canvas
 * and the label prints the true peak instead of "±1.0 µV" / "±0.0 µV".
 */
test('big single-channel waveform auto-scales to model-scale (~0.001 uV) signal', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'benchwave-test-'));
  const prevWindow = globalThis.window;
  try {
    execFileSync(join(root, 'app/node_modules/.bin/tsc'), [
      join(root, 'app/src/lib/benchWaveform.ts'),
      '--module', 'nodenext', '--target', 'es2022', '--outDir', outDir,
    ], { stdio: 'pipe' });
    const { drawWaveform } = await import(pathToFileURL(join(outDir, 'benchWaveform.js')).href);
    globalThis.window = { devicePixelRatio: 1 };
    // Stub canvas: records one point list per beginPath() (grid lines
    // have exactly 2 points; the trace has one per sample) and the label.
    const paths = [];
    const texts = [];
    let cur = null;
    const ctx = {
      scale() {}, setTransform() {}, fillRect() {},
      beginPath() { cur = []; paths.push(cur); },
      moveTo(x, y) { cur.push([x, y]); },
      lineTo(x, y) { cur.push([x, y]); },
      stroke() {}, fillText(t) { texts.push(String(t)); },
    };
    const canvas = {
      clientWidth: 600, clientHeight: 160, width: 0, height: 0,
      getContext: () => ctx,
    };
    // 5 s @ 250 Hz of a 0.001 uV sine — the model-scale signal.
    const series = Array.from({ length: 1250 },
      (_, j) => 0.001 * Math.sin((2 * Math.PI * j) / 125));
    drawWaveform(canvas, series);
    const trace = paths.reduce((a, b) => (b.length > a.length ? b : a), []);
    assert.ok(trace.length > 100, `trace must have one point per sample, got ${trace.length}`);
    const ys = trace.map((p) => p[1]);
    const span = Math.max(...ys) - Math.min(...ys);
    assert.ok(span >= 0.5 * canvas.clientHeight,
      `0.001 uV trace must span >= half the canvas, spanned ${span.toFixed(2)} px of ${canvas.clientHeight}`);
    assert.ok(!texts.some((t) => t.includes('±1.0 µV')),
      `peak label must not claim ±1.0 µV for a 0.001 µV signal, got ${JSON.stringify(texts)}`);
    assert.ok(texts.some((t) => t.includes('0.001')),
      `peak label must show the true ~0.001 µV peak, got ${JSON.stringify(texts)}`);
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('waveform shows 8 channels; channel view lists all 64', () => {
  assert.match(minimalLoop, /const WAVE_CHANNELS = \['Fp1', 'Fp2', 'F3', 'F4', 'C3', 'C4', 'Pz', 'Oz'\];/);
  assert.match(minimalLoop, /capLabels\.map\(\(label\) =>/,
    'channel view renders one chip per cap label');
  assert.ok(src('app/src/lib/benchWaveform.ts').includes('export function drawMultiChannelWaveform'),
    'multi-channel waveform painter must exist');
});
