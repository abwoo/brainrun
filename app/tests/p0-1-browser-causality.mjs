/**
 * Real browser P0-1 causal smoke for PR #10:
 * C01 EXPLORE list selection → App → 3D stage → REGION panel, no stimulus;
 * C02/C03 mapped neural current buttons → immediate LIF/HH solver traces.
 * Requires production dist + generated brain assets/wasm (PR5 workflow).
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
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__brainSim?.isReady?.() === true,
    null, { timeout: 60000 });

  const stage = page.locator('section.stage');
  const beforeRegion = await stage.getAttribute('data-selected-region-id');
  assert.equal(beforeRegion, 'none', 'fresh launch must not pretend a region is already selected');
  const pulsesBefore = await page.evaluate(() =>
    window.__brainSim.getMarkers().filter(m => m.kind === 'pulse').length);

  await page.locator('button[data-mode="explore"]').click();
  await page.getByRole('searchbox', { name: '按名称或编号搜索脑区' }).fill('40');
  const regionButton = page.getByRole('button', { name: /^#40\s/ });
  await regionButton.click();
  await page.waitForFunction(() =>
    document.querySelector('section.stage')?.getAttribute('data-selected-region-id') === '40',
    null, { timeout: 5000 });
  assert.equal(await regionButton.getAttribute('aria-pressed'), 'true');
  const pulsesAfter = await page.evaluate(() =>
    window.__brainSim.getMarkers().filter(m => m.kind === 'pulse').length);
  assert.equal(pulsesAfter, pulsesBefore,
    'selecting a region in EXPLORE must not silently stimulate it');

  await page.locator('button[data-mode="play"]').click();
  await page.getByRole('button', { name: /^更多/ }).click();
  const regionTexts = await page.locator('.region-panel .region-facts dd').allTextContents();
  assert.ok(regionTexts.some(t => t.includes('#40 / 76')),
    'EXPLORE selection must be reflected in shared REGION data, not private list state');

  await page.getByRole('button', { name: '细胞实验', exact: true }).click();
  const lab = page.getByRole('dialog', { name: '细胞级实验' });
  await lab.waitFor({ timeout: 30000 });
  const mappedLif = lab.getByRole('button', { name: '用该电流跑 LIF', exact: true });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')]
      .find(x => x.textContent?.trim() === '用该电流跑 LIF');
    return b !== undefined && !b.disabled;
  }, null, { timeout: 10000 });
  assert.equal(await lab.getByRole('img', { name: '膜电位' }).count(), 0,
    'before mapped run no cell voltage plot should exist');
  await mappedLif.click();
  await lab.getByRole('img', { name: '膜电位' }).waitFor({ timeout: 10000 });
  assert.match(await lab.textContent(), /脉冲 [0-9]+ pA（100–300 ms）/,
    'LIF current mapping must run solver now, not just alter the slider');

  const mappedHh = lab.getByRole('button', { name: '用该电流跑 HH', exact: true });
  await mappedHh.click();
  await lab.getByRole('img', { name: 'Na 电导 gNa' }).waitFor({ timeout: 10000 });
  await lab.getByRole('img', { name: 'K 电导 gK' }).waitFor({ timeout: 10000 });
  assert.match(await lab.textContent(), /阶跃 [0-9.]+ uA\/cm\^2（10–60 ms）/,
    'HH mapping must run solver immediately');
  // P0-1B: old numerical curves MUST disappear when an input slider changes.
  // Otherwise an interactive slider misleadingly displays results from
  // parameters that are no longer selected.
  await lab.locator('#hh-amp').fill('12');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('[role="dialog"]')].some(d =>
      d.getAttribute('aria-label') === '细胞级实验' &&
      d.querySelectorAll('svg[aria-label="Na 电导 gNa"]').length === 0),
    null,{timeout:10000});
  assert.equal(await lab.getByRole('img',{name:'Na 电导 gNa'}).count(),0,
    'editing HH current must invalidate the now-stale trace');
  await lab.getByRole('button',{name:'运行仿真',exact:true}).click();
  await lab.getByRole('img',{name:'Na 电导 gNa'}).waitFor({timeout:10000});
  assert.ok(errors.length === 0, 'browser page errors: ' + errors.join('; '));

  await mkdir('../tests/p0-1/shots', { recursive: true });
  await page.screenshot({ path: '../tests/p0-1/shots/control-causality.png', fullPage: true });
  console.log('P0-1 browser C01/C02/C03 PASS: shared selection and immediate cell solver runs');
} finally {
  if (browser) await browser.close();
  await server.httpServer.close();
}
