/**
 * Real browser P0-1 causal smoke for PR #10 (rewritten for Phase 4):
 * C01 selection must not stimulate; an explicit stimulus must produce a
 * real solver peak. The old EXPLORE list / PLAY mode / REGION panel /
 * cellular-lab UI is gone with the #advanced workspace; selection now goes
 * through the #basic network tab's region combobox and stimulation through
 * its explicit "施加一次刺激" button. Requires production dist + generated
 * brain assets/wasm (PR5 workflow).
 *
 * DROPPED (deliberate coverage change, Phase 4 cut — not a silent
 * weakening): the C02/C03 cellular section (button '细胞实验' → dialog
 * '细胞级实验', '用该电流跑 LIF' / '用该电流跑 HH', Na/K conductance
 * plots, HH-slider invalidation). CellularLab.tsx remains as an unmounted
 * file with no importer rendering it, so the LIF/HH current mapping has no
 * browser UI anywhere after the cut. The solver mapping itself is still
 * covered at node level by tests/pr7/cellular.test.mjs and
 * tests/pr7/test_cellular.py. Likewise the EXPLORE searchbox, the '更多'
 * button and the REGION panel facts have no equivalent in the new UI; the
 * shared-selection contract they exercised is covered here through the
 * region combobox + chart-wrap selection attribute.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({
  preview: { port: 0, host: '127.0.0.1', strictPort: false },
  logLevel: 'error',
});
let browser;
try {
  const url = server.resolvedUrls?.local?.[0];
  assert.ok(url, 'vite preview returned no local URL');
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url+'#basic', { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: '脑区与传播', exact: true }).click();
  await page.waitForFunction(() => window.__brainSim?.isReady?.() === true,
    null, { timeout: 60000 });

  const chart = page.locator('.chart-wrap');
  const beforeRegion = await chart.getAttribute('data-selected-region-id');
  assert.equal(beforeRegion, 'none', 'fresh launch must not pretend a region is already selected');
  const pulsesBefore = await page.evaluate(() =>
    window.__brainSim.getMarkers().filter(m => m.kind === 'pulse').length);

  // C01: selecting a region in the network tab must not silently stimulate it.
  await page.getByRole('combobox', { name: '选择脑区', exact: true }).selectOption('40');
  await page.waitForFunction(() =>
    document.querySelector('.chart-wrap')?.getAttribute('data-selected-region-id') === '40',
    null, { timeout: 5000 });
  const pulsesAfter = await page.evaluate(() =>
    window.__brainSim.getMarkers().filter(m => m.kind === 'pulse').length);
  assert.equal(pulsesAfter, pulsesBefore,
    'selecting a region must not silently stimulate it');

  // Explicit stimulus: the button is the only way to stimulate now
  // (3D click selects without pulsing, pointerStimulates={false}).
  await page.evaluate(() => window.__brainSim.resetPeakTracking());
  await page.getByRole('button', { name: '施加一次刺激', exact: true }).click();
  await page.waitForFunction(() =>
    window.__brainSim.getMarkers().some(m => m.kind === 'pulse' && m.node === 40),
    null, { timeout: 10000 });
  await page.waitForFunction(() =>
    window.__brainSim.getPeakE()?.[40] > 0.05,
    null, { timeout: 30000 });
  const actualPeak = await page.evaluate(() => window.__brainSim.getPeakE()[40]);
  assert.ok(actualPeak > 0.05, `explicit stimulus must change E from solver: ${actualPeak}`);
  assert.ok(errors.length === 0, 'browser page errors: ' + errors.join('; '));

  await mkdir('../tests/p0-1/shots', { recursive: true });
  await page.screenshot({ path: '../tests/p0-1/shots/control-causality.png', fullPage: true });
  console.log('P0-1 browser C01 PASS: shared selection without stimulus; explicit stimulus produces a real solver peak');
} finally {
  if (browser) await browser.close();
  await server.httpServer.close();
}
