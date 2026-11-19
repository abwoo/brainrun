/**
 * Bench simplified-view browser test (2026-11-19 主视图简化).
 *
 * 钉住两件事：
 * 1. “（未确认）”标记永不出现在用户眼前：跑一次 oddball（攒出试次与
 *    受试者响应）后，主视图与诊断面板打开时整页文本里都没有“未确认”
 *    与 "(unconfirmed)"。确认态仍记在记录数据里（trace 事件与响应行
 *    的 confirmed 字段、命令日志的 ACK 匹配逻辑都不动），只是在界面上
 *    再也不渲染：出现就是发生了。
 * 2. 主视图（诊断面板关闭时）只剩 5 秒能看懂的东西：3D 头 + 波形 +
 *    四个协议按钮 + 运行/停止 + 一条人话状态行 + 页脚诚实注；最近几跳、
 *    响应表、丢弃数、闭环延迟读数、放大器设置、帽预设都不在主视图里。
 *    另钉：大脑 q 读数从一开始就有真值，不是永久的 "—"。
 *
 * 跑法：node app/tests/bench-simplified-view-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture；
 * fixture 由 `scientific/forward/generate_sphere_model.py` 生成后才进
 * dist，顺序错了这里会直接报错说明）。
 *
 * 稳健性：本地无头 Chromium 很慢（SwiftShader ~1fps），轮询用慷慨上限、
 * 只认有无与增长量，不认精确数值。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const appDir = join(root, 'app');
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}/`;

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

// 1. 球形 fixture（CI/本地生成，不入库）。
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
// 2. dist 必须已构建且含 fixture（构建时才把 public/ 拷进 dist）。
assert.ok(existsSync(join(appDir, 'dist', 'index.html')),
  'dist missing: run `npm run build` in app/ first');
assert.ok(existsSync(join(appDir, 'dist', 'forward-assets', 'sphere-model.json')),
  'dist lacks the sphere fixture: regenerate the fixture, then `npm run build` again');

// 3. 预览服务器：先探活 4173，死了重起。
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
      throw new Error('vite preview did not come up on 4173 within 30 s');
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`started preview server on ${BASE}`);
}

const num = (txt, re) => {
  const m = txt?.match(re);
  return m ? Number(m[1].replace(/,/g, '')) : null;
};

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 978, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('closed-loop-bench').waitFor({ timeout: 60000 });

  const bodyText = async () =>
    ((await page.locator('body').innerText()) ?? '').replace(/\s+/g, ' ').trim();
  const assertNoUnconfirmed = async (where) => {
    const txt = await bodyText();
    assert.ok(!txt.includes('未确认'), `${where}: page must not show “未确认”; body: ${txt.slice(0, 400)}`);
    assert.ok(!txt.includes('(unconfirmed)'), `${where}: page must not show "(unconfirmed)"; body: ${txt.slice(0, 400)}`);
  };

  // ---- 引擎就绪：协议按钮可用 ----
  const oddballBtn = page.locator('.bench-protocol-btn', { hasText: 'oddball' });
  const btnDeadline = Date.now() + 60000;
  for (;;) {
    if (!(await oddballBtn.isDisabled())) break;
    if (Date.now() > btnDeadline) assert.fail('protocol button never became enabled');
    await page.waitForTimeout(250);
  }

  // ---- 主视图（诊断面板关闭）：只剩 5 秒能看懂的东西 ----
  assert.equal(await page.getByTestId('bench-diagnostics').count(), 0,
    'diagnostics panel must start closed');
  assert.equal(await page.locator('.bench-protocol-btn').count(), 4,
    'main view must show exactly 4 protocol buttons');
  for (const name of ['单脉冲', 'oddball', '闪烁', '闭环触发']) {
    assert.ok(await page.locator('.bench-protocol-btn').getByText(name, { exact: true }).count() >= 1,
      `protocol button ${name} must be visible in the main view`);
  }
  assert.ok(await page.getByRole('button', { name: '运行协议', exact: true }).isVisible(),
    'run button must be visible in the main view');
  assert.ok(await page.getByRole('button', { name: '停止协议', exact: true }).isVisible(),
    'stop button must be visible in the main view');
  assert.equal(await page.getByTestId('bench-status-line').count(), 1,
    'main view must have exactly one status line');
  assert.ok((await page.getByTestId('bench-status-line').textContent())?.includes('还没开始'),
    'status line must say 还没开始 before any run');
  assert.ok(await page.locator('.bench-network').isVisible(), '3D head must be visible');
  assert.ok(await page.locator('canvas.bench-wave').isVisible(), 'live waveform must be visible');
  assert.ok(await page.locator('.bench-footnote').isVisible(), 'footer honesty note must be visible');
  assert.ok((await page.locator('.bench-footnote').textContent())?.includes('51'),
    'footer must keep the 51× amplitude-gap honesty note');
  // 大脑 q：从一开始就有真值，不是永久的 "—"。
  const qLine = page.getByTestId('bench-brain-q');
  await qLine.waitFor({ timeout: 60000 });
  const qText = (await qLine.textContent() ?? '').replace(/\s+/g, ' ').trim();
  assert.match(qText, /-?\d+\.\d+ nA·m/, `brain q must show a real value, got ${qText}`);
  assert.ok(!qText.includes('—'), `brain q must not be a dash, got ${qText}`);
  console.log('main view kept elements ok; brain q:', qText);

  // 主视图里不该有的东西：最近几跳、响应表、丢弃数、闭环延迟、放大器、帽预设。
  assert.equal(await page.locator('.bench-flow-hops').count(), 0, 'hop list must be hidden in main view');
  assert.equal(await page.getByTestId('bench-loop-timing').count(), 0, 'loop-timing readout must be hidden in main view');
  assert.equal(await page.getByTestId('bench-experiment-computer').count(), 0, 'experiment-computer details must be hidden in main view');
  assert.equal(await page.getByTestId('bench-stimulator').count(), 0, 'stimulator details must be hidden in main view');
  assert.equal(await page.getByRole('combobox', { name: '脑电帽预设', exact: true }).count(), 0, 'cap preset must be hidden in main view');
  assert.equal(await page.getByRole('combobox', { name: '采样率', exact: true }).count(), 0, 'amplifier settings must be hidden in main view');
  assert.equal(await page.getByText('丢弃的响应').count(), 0, 'dropped-response count must be hidden in main view');
  assert.equal(await page.getByText('放大器设置').count(), 0, 'amplifier settings toggle must not exist in main view');
  await assertNoUnconfirmed('main view before run');
  console.log('main view hidden elements ok; no unconfirmed marks before run');

  // ---- 跑一次 oddball，攒出试次与受试者响应 ----
  await oddballBtn.click();
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  await page.getByTestId('bench-diagnostics-toggle').click();
  await page.getByTestId('bench-diagnostics').waitFor({ timeout: 15000 });
  const expReadout = page.locator('[data-testid="bench-experiment-computer"] .bench-readout').first();
  const trialDeadline = Date.now() + 240000;
  let trials = 0;
  for (;;) {
    const txt = (await expReadout.textContent() ?? '').replace(/\s+/g, ' ').trim();
    trials = num(txt, /试次数[:：]?\s*(\d+)/) ?? 0;
    if (trials >= 10) break;
    if (Date.now() > trialDeadline) throw new Error(`oddball produced only ${trials} trials in 240 s`);
    await page.waitForTimeout(2000);
  }
  console.log('oddball trials fired:', trials);
  await page.getByRole('button', { name: '停止协议', exact: true }).click();
  await page.waitForTimeout(3000);

  // ---- 诊断面板打开时：响应表里有真实响应行，且整页没有确认标记 ----
  const responseRows = page.locator('[data-testid="bench-experiment-computer"] table tbody tr');
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length >= 2,
    '[data-testid="bench-experiment-computer"] table tbody tr',
    { timeout: 60000 },
  );
  const hopCount = await page.locator('.bench-flow-hop').count();
  assert.ok(hopCount >= 1, `trace must hold hops after the run, got ${hopCount}`);
  const rowCount = await responseRows.count();
  await assertNoUnconfirmed('diagnostics open after oddball run');
  console.log(`diagnostics open: ${rowCount} response rows, ${hopCount} hops, no unconfirmed marks`);

  // ---- 再关上面板：主视图同样没有确认标记 ----
  await page.getByTestId('bench-diagnostics-toggle').click();
  await page.getByTestId('bench-diagnostics').waitFor({ state: 'detached', timeout: 15000 });
  await assertNoUnconfirmed('main view after oddball run');
  console.log('main view after run: still no unconfirmed marks');

  console.log(`PASS bench simplified-view: 4 protocol buttons, 1 status line, brain q live, ` +
    `${trials} oddball trials, ${rowCount} response rows shown, ` +
    `“未确认” nowhere (main + diagnostics), pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
