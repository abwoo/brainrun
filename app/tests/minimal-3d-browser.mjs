/**
 * Minimal 3D closed-loop browser test (2026-11-19 rebuild).
 *
 * Replaces the bench-owned browser tests that the replaced presentation
 * owned (deleted with it, listed at the bottom):
 *   app/tests/bench-pictorial-browser.mjs
 *   app/tests/bench-drilldown-focus-browser.mjs
 *   app/tests/bench-followup-ui-browser.mjs
 *   app/tests/bench-q-high-state-browser.mjs
 *   app/tests/bench-simplified-view-browser.mjs
 *   app/tests/bench-live-refresh-browser.mjs
 *   app/tests/bench-protocol-status-browser.mjs
 *   app/tests/eeg-configuration-browser.mjs
 *   app/tests/pr6-browser-smoke.mjs  (deeply drill-down / analysis-tab specific)
 * Why: every one of those tests drives ClosedLoopBench / PictorialLoop /
 * BenchDrillDown / the analysis tabs / the protocol menu — all deleted
 * by the minimal rebuild. The behaviors they guarded (loop runs, waveform
 * refreshes, protocol status, focus discipline) are re-covered here
 * against the minimal UI. The #basic browser tests are untouched and
 * still run in pr5-physics.
 *
 * What this test proves, desktop 1920x1000 and mobile 390x844 (touch):
 *  - the scene loads (64 cap discs, sim ready, a real-size canvas —
 *    the crash investigation found the old head canvas collapsed to
 *    72x1 px on mobile; here the canvas must be viewport-size);
 *  - the loop runs (oddball): status flips to running, trial count
 *    advances, 14 flow particles are visible;
 *  - the recording computer shows a multi-channel waveform strip
 *    (8 channels) and the enlarged wave overlay lists them;
 *  - brain tap opens the 64-channel view and tap-to-switch works
 *    (Cz -> large waveform of Cz);
 *  - overlays do not steal focus (activeElement unchanged across
 *    open / close / Esc);
 *  - stop returns to the stopped status and particles stop;
 *  - zero page errors, zero console errors, no reload (one navigation).
 *
 * Robustness notes (measured, not guessed):
 *  - Local headless Chromium is ~1 fps under SwiftShader, and the
 *    main thread is heavily loaded while the protocol runs. Playwright
 *    `locator.click()` times out after the click actually lands,
 *    hanging on "waiting for scheduled navigations to finish" — the
 *    same artifact the crash investigator saw on the old Run button.
 *    So this test uses raw `page.mouse` / `page.touchscreen` input
 *    and verifies effects with `waitForFunction` + generous timeouts.
 *  - The preview server is spawned on a free port (never reuses a
 *    possibly stale server on a fixed port).
 *
 * Run: `npm run build` in app/ first, then `node app/tests/minimal-3d-browser.mjs`.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appDir = join(root, 'app');

// 1. Sphere fixture (generated, not committed) + dist must be built.
const fixturePath = join(appDir, 'public', 'forward-assets', 'sphere-model.json');
if (!existsSync(fixturePath)) {
  const py = process.env.EEG_VENV_PYTHON
    ?? join(process.env.HOME ?? '', 'workspace', 'eeg-venv', 'bin', 'python');
  console.log(`sphere fixture missing, generating with ${py} ...`);
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(py, [join(root, 'scientific', 'forward', 'generate_sphere_model.py')],
    { encoding: 'utf8', timeout: 300000 });
  console.log(r.stdout);
  if (r.status !== 0) throw new Error(`generate_sphere_model.py failed: ${r.stderr}`);
}
assert.ok(existsSync(join(appDir, 'dist', 'index.html')),
  'dist missing: run `npm run build` in app/ first');
assert.ok(existsSync(join(appDir, 'dist', 'forward-assets', 'sphere-model.json')),
  'dist lacks the sphere fixture: regenerate the fixture, then `npm run build` again');

// 2. Preview server on a free port.
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}/`;
const viteBin = join(appDir, 'node_modules', '.bin', 'vite');
const serverProc = spawn(viteBin,
  ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
  { cwd: appDir, stdio: 'pipe' });
let serverLog = '';
serverProc.stdout.on('data', (d) => { serverLog += String(d); });
serverProc.stderr.on('data', (d) => { serverLog += String(d); });
async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch { return false; }
}
{
  const deadline = Date.now() + 30000;
  while (!(await reachable(BASE))) {
    if (Date.now() > deadline) {
      serverProc.kill();
      throw new Error(`vite preview did not come up on ${PORT} within 30 s:\n${serverLog}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
console.log(`preview server on ${BASE}`);

const statusText = (page) =>
  page.locator("[data-testid='minimal-status-line']").innerText();
const activeId = (page) =>
  page.evaluate(() => document.activeElement?.getAttribute?.('data-testid') ?? document.activeElement?.tagName);
const centerClick = async (page, locator) => {
  const box = await locator.boundingBox();
  assert.ok(box, 'expected a visible bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
};
const centerTap = async (page, locator) => {
  const box = await locator.boundingBox();
  assert.ok(box, 'expected a visible bounding box');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });

  for (const [label, contextOpts, tap] of [
    ['desktop 1920x1000', { viewport: { width: 1920, height: 1000 } }, centerClick],
    ['mobile 390x844 touch', {
      viewport: { width: 390, height: 844 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    }, centerTap],
  ]) {
    console.log(`\n== ${label} ==`);
    const ctx = await browser.newContext(contextOpts);
    const page = await ctx.newPage();
    const errors = [];
    const navigations = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations.push(f.url()); });

    await page.goto(BASE, { waitUntil: 'load', timeout: 60000 });
    await page.getByTestId('minimal-run-toggle').waitFor({ timeout: 60000 });
    // The run toggle renders before the sim boots; wait for the scene
    // bridge + sim ready instead of a fixed sleep.
    await page.waitForFunction(
      "() => window.__minimalLoop?.getDiscCount && window.__brainSim?.isReady?.()",
      { timeout: 120000 });

    // Scene loads: real-size canvas (not the old 72x1 collapse), 64 discs, sim ready.
    const canvasBox = await page.locator('.minimal-scene-canvas canvas').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    console.log('canvas box:', canvasBox);
    assert.ok(canvasBox.w >= 380 && canvasBox.h >= 800,
      `canvas must be viewport-size, got ${canvasBox.w}x${canvasBox.h}`);
    // The 64 discs appear when the sphere fixture finishes loading, which
    // races the sim-ready signal the wait above just observed (both land
    // ~2-4 s after load). Asserting immediately is flaky by construction:
    // wait for the discs instead. (CI failed twice at ~33 s — the mobile
    // viewport's immediate discs assert, right after the bridge wait.)
    await page.waitForFunction(
      "() => window.__minimalLoop?.getDiscCount?.() === 64",
      { timeout: 60000 });
    assert.equal(await page.evaluate(() => window.__minimalLoop?.getDiscCount?.()), 64);
    assert.equal(await page.evaluate(() => window.__brainSim?.isReady?.()), true);
    assert.match(await statusText(page), /还没开始/);
    assert.equal(await page.evaluate(() => window.__minimalLoop?.getParticleCount?.()), 0);

    // Run: status flips, trials advance, particles flow.
    await tap(page, page.getByTestId('minimal-run-toggle'));
    await page.waitForFunction(
      "() => document.querySelector('[data-testid=minimal-status-line]')?.textContent?.includes('正在运行')",
      { timeout: 60000 });
    // Particles are set visible by the scene's rAF tick, which runs ~1 fps
    // under SwiftShader — wait for them instead of asserting immediately.
    await page.waitForFunction(
      "() => window.__minimalLoop?.getParticleCount?.() === 14",
      { timeout: 60000 });
    const trials0 = await page.evaluate(() => window.__minimalLoop?.getTrialCount?.());
    await page.waitForTimeout(12000);
    const trials1 = await page.evaluate(() => window.__minimalLoop?.getTrialCount?.());
    console.log('trials:', trials0, '->', trials1);
    assert.ok(trials1 > trials0, `trial count must advance while running (${trials0} -> ${trials1})`);

    // Recording computer -> enlarged multi-channel waveform (8 channels).
    const activeBeforeWave = await activeId(page);
    const recPt = await page.evaluate(() => window.__minimalLoop?.projectNode?.('recording'));
    assert.ok(recPt, 'recording node must project on screen');
    if (label.startsWith('desktop')) await page.mouse.click(recPt.x, recPt.y);
    else await page.touchscreen.tap(recPt.x, recPt.y);
    await page.getByTestId('minimal-overlay').waitFor({ timeout: 30000 });
    assert.equal(await page.getByTestId('minimal-overlay').getAttribute('data-overlay'), 'wave');
    const channels = await page.getByTestId('minimal-wave-canvas').getAttribute('data-channels');
    console.log('wave channels:', channels);
    assert.equal(channels.split(',').length, 8, 'wave overlay must show 8 channels');
    assert.match(await page.locator("[data-testid='minimal-overlay'] .minimal-note").first().innerText(),
      /8 条通道|8 channels/);
    // The tap itself lands on the canvas (non-focusable), so the browser
    // legitimately blurs the run button to BODY on mousedown. The rule is
    // that the OVERLAY must not move focus: it must stay BODY (or the
    // pre-tap element) and never land inside the overlay.
    const activeAfterWave = await activeId(page);
    assert.ok(activeAfterWave === 'BODY' || activeAfterWave === activeBeforeWave,
      `opening the wave overlay must not move focus (was ${activeBeforeWave}, now ${activeAfterWave})`);
    assert.notEqual(activeAfterWave, 'minimal-overlay-close',
      'the overlay must not pull focus onto its close button');

    // Close via the close button; the focused close button unmounts, so
    // focus falls back to BODY — and must not land anywhere else.
    await tap(page, page.getByTestId('minimal-overlay-close'));
    await page.getByTestId('minimal-overlay').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await activeId(page), 'BODY', 'closing the overlay must leave focus on BODY');

    // Brain -> 64-channel view; tap-to-switch (Cz -> large waveform of Cz).
    const activeBeforeBrain = await activeId(page);
    const brainPt = await page.evaluate(() => window.__minimalLoop?.projectNode?.('brain'));
    assert.ok(brainPt, 'brain node must project on screen');
    if (label.startsWith('desktop')) await page.mouse.click(brainPt.x, brainPt.y);
    else await page.touchscreen.tap(brainPt.x, brainPt.y);
    await page.getByTestId('minimal-overlay').waitFor({ timeout: 30000 });
    assert.equal(await page.getByTestId('minimal-overlay').getAttribute('data-overlay'), 'channels');
    assert.equal(await page.locator("button[data-testid^='minimal-channel-']").count(), 64);
    const activeAfterBrain = await activeId(page);
    assert.ok(activeAfterBrain === 'BODY' || activeAfterBrain === activeBeforeBrain,
      `opening the channel overlay must not move focus (was ${activeBeforeBrain}, now ${activeAfterBrain})`);
    assert.notEqual(activeAfterBrain, 'minimal-overlay-close',
      'the overlay must not pull focus onto its close button');
    await tap(page, page.getByTestId('minimal-channel-Cz'));
    await page.waitForFunction(
      "() => document.querySelector('[data-testid=minimal-channel-canvas]')?.getAttribute('data-channel') === 'Cz'",
      { timeout: 15000 });
    assert.equal(await page.getByTestId('minimal-channel-Cz').getAttribute('aria-pressed'), 'true');

    // Esc closes; focus still put (Esc presses no button, so the focus
    // value must be exactly the one the overlay opened with).
    await page.keyboard.press('Escape');
    await page.getByTestId('minimal-overlay').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await activeId(page), activeAfterBrain, 'Esc must close without moving focus');

    // Stop: status flips back, particles stop.
    await tap(page, page.getByTestId('minimal-run-toggle'));
    await page.waitForFunction(
      "() => document.querySelector('[data-testid=minimal-status-line]')?.textContent?.includes('已停止')",
      { timeout: 60000 });
    await page.waitForFunction(
      "() => window.__minimalLoop?.getParticleCount?.() === 0",
      { timeout: 60000 });

    // No errors, no reload.
    assert.deepEqual(errors, [], `console/page errors on ${label}: ${errors.slice(0, 3).join(' | ')}`);
    assert.deepEqual(navigations, [BASE], `unexpected navigation on ${label}: ${navigations.join(', ')}`);
    console.log(`${label}: OK`);
    await ctx.close();
  }
  console.log('\nminimal-3d-browser: all pass');
} finally {
  if (browser) await browser.close();
  serverProc.kill();
}
