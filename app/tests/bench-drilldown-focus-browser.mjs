/**
 * Bench drill-down focus browser test (2026-11-19, pictorial-bench
 * follow-up Issue 1 — real bug, root-caused by the investigator).
 *
 * The drill-down shell's overlay effect had `onClose` in its dep array
 * (BenchDrillDown.tsx), and every drill-down passes an inline
 * `onClose={() => setDrill(null)}`, so the effect re-ran on EVERY render
 * (~15 Hz, Worker snapshots keep coming even while paused). Each re-run
 * yanked focus back to the Back button ~80 ms after it landed in any
 * control: typed keys never reached the input, Enter activated Back and
 * closed the dialog, and a yank mid-typing could blur-commit a
 * half-typed draft. The fix makes the effect mount-only and reads
 * onClose through a ref.
 *
 * This test pins the general case, not just the one number box:
 * 1. Type a value + Enter in the coupling number box (experiment-computer
 *    workspace): the value must stick in the engine (g becomes the typed
 *    value) AND the dialog must stay open. Pre-fix the focus is yanked
 *    to Back within ~80 ms, so the typed keys never land and Enter
 *    closes the dialog instead.
 * 2. Arrow keys must move the slider (same root cause: focus never
 *    reached the range input, so arrows went to the Back button).
 * 3. Escape must still close the dialog (the effect's keydown listener
 *    must keep working after the fix).
 *
 * Focus is asserted directly too: after focusing a control and waiting
 * 500 ms (several snapshot cycles), focus must still be in that control.
 *
 * 跑法：BENCH_PREVIEW_PORT=4175 node app/tests/bench-drilldown-focus-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture）。
 * 端口用环境变量是为与 4173/4174 上的并行 worker 互不干扰。
 *
 * 稳健性：本地无头 Chromium 很慢（SwiftShader ~1fps），轮询用慷慨上限。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appDir = join(root, 'app');
const PORT = Number(process.env.BENCH_PREVIEW_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}/`;

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

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

let serverProc = null;
if (await reachable(BASE)) {
  console.log(`reusing preview server on ${BASE}`);
} else {
  const viteBin = join(appDir, 'node_modules', '.bin', 'vite');
  serverProc = spawn(viteBin,
    ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { cwd: appDir, stdio: 'pipe' });
  const deadline = Date.now() + 30000;
  while (!(await reachable(BASE))) {
    if (Date.now() > deadline) {
      serverProc.kill();
      throw new Error(`vite preview did not come up on ${PORT} within 30 s`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`started preview server on ${BASE}`);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('crash', () => errors.push('PAGE CRASHED'));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('closed-loop-bench').waitFor({ timeout: 60000 });

  const drill = page.getByTestId('bench-drilldown');
  const openNode = async (node) => {
    await page.getByTestId(`pict-node-${node}`).focus();
    await page.keyboard.press('Enter');
    await drill.waitFor({ timeout: 15000 });
  };
  // Which element currently holds focus, as a short human-readable label.
  const focusedLabel = () => page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return '(none)';
    const testId = el.getAttribute?.('data-testid');
    if (testId) return `testid=${testId}`;
    const aria = el.getAttribute?.('aria-label');
    return `${el.tagName.toLowerCase()}${aria ? ` aria-label="${aria}"` : ''}`;
  });
  const engineG = () => page.evaluate(() => window.__brainSim?.getParams?.().g);

  // ---- 引擎就绪：协议按钮可用，默认 g = 0.35 ----
  const protocolBtns = page.locator('.bench-protocol-btn');
  const btnDeadline = Date.now() + 60000;
  for (;;) {
    if (!(await protocolBtns.nth(1).isDisabled())) break;
    if (Date.now() > btnDeadline) assert.fail('protocol button never became enabled');
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__brainSim?.getParams, null, { timeout: 30000 });
  assert.equal(await engineG(), 0.35, `engine g must start at 0.35, got ${await engineG()}`);
  console.log('engine ready, g = 0.35');

  // ---- (1) 数字框里打字 + 回车：值进引擎，对话框还开着 ----
  await openNode('experiment');
  const numBox = drill.getByRole('spinbutton', { name: /脑区互相带动的强度/ });
  await numBox.waitFor({ timeout: 15000 });
  await numBox.click();
  // 焦点刚落下就等 500 ms：快照 ~15 Hz，修前焦点 80 ms 内就被抢走。
  await page.waitForTimeout(500);
  assert.equal(await focusedLabel(), 'input aria-label="脑区互相带动的强度 "',
    `focus must stay in the coupling number box after 500 ms, got ${await focusedLabel()}`);
  console.log('focus stays in the number box after 500 ms');
  // 全选再打字，避免在原值 "0.35" 后面追加。
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('0.4', { delay: 100 });
  assert.equal(await focusedLabel(), 'input aria-label="脑区互相带动的强度 "',
    `focus must still be in the number box after typing, got ${await focusedLabel()}`);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__brainSim.getParams().g === 0.4, null, { timeout: 30000 });
  assert.equal(await numBox.inputValue(), '0.4',
    `number box must show the typed value, got ${await numBox.inputValue()}`);
  assert.ok(await drill.isVisible(),
    'dialog must still be open after typing a value + Enter (pre-fix Enter activated Back and closed it)');
  console.log('typed 0.4 + Enter: engine g = 0.4, dialog still open');

  // ---- (2) 方向键动滑条：同一根因，焦点到不了滑条方向键就没用 ----
  // g 的量程是 0–0.4，当前 0.4 已顶格，ArrowLeft 应退一格到 0.39。
  // 用 focus() 而不用 click()：点滑条轨道会按点击位置改值。
  const slider = drill.getByRole('slider', { name: '脑区互相带动的强度', exact: true });
  await slider.waitFor({ timeout: 15000 });
  await slider.focus();
  await page.waitForTimeout(500);
  assert.equal(await focusedLabel(), 'input aria-label="脑区互相带动的强度"',
    `focus must stay on the coupling slider after 500 ms, got ${await focusedLabel()}`);
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(() => window.__brainSim.getParams().g === 0.39, null, { timeout: 30000 });
  console.log('ArrowLeft on the slider: engine g = 0.39');

  // ---- (3) Escape 仍能关对话框（effect 的 keydown 监听不能修丢） ----
  await page.keyboard.press('Escape');
  await drill.waitFor({ state: 'detached', timeout: 15000 });
  console.log('Escape closed the dialog');

  console.log(`PASS bench drill-down focus: type 0.4 + Enter sticks (g 0.4, dialog open), ` +
    `ArrowLeft moves slider (g 0.39), Escape still closes, pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
