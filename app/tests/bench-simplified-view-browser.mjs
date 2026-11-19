/**
 * Bench pictorial-view browser test (2026-11-19 图解台子改写).
 *
 * 钉住两件事：
 * 1. “（未确认）”标记永不出现在用户眼前：跑一次 oddball（攒出试次与
 *    受试者响应）后，主视图与每个 drill-down 打开时整页文本里都没有
 *    “未确认”与 "(unconfirmed)"。确认态仍记在记录数据里（trace 事件与
 *    响应行的 confirmed 字段、命令日志的 ACK 匹配逻辑都不动），只是在
 *    界面上再也不渲染：出现就是发生了。
 * 2. 主视图是一张回路图 + 控制条：7 个节点、头节点里有 Three.js 画布
 *    与 64 个电极圆盘（非绿球）、波形缩略图、四个协议按钮 + 运行/停止
 *    + 一条人话状态行 + 页脚诚实注；大脑 q 芯片在大脑节点下方，从一
 *    开始就有真值。最近几跳、响应表、丢弃数、闭环延迟读数、放大器设置、
 *    帽预设都不在主视图里，只在各自的 drill-down 里。
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

// 3. 预览服务器：先探活（默认 4173，BENCH_PREVIEW_PORT 可改），死了重起。
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
  // 节点是 SVG <g role="button">：大脑节点的中心被 Three.js 画布盖住，
  // 鼠标点不到；统一用键盘 Enter 打开（也顺带验键盘可达）。
  const openNode = async (node) => {
    await page.getByTestId(`pict-node-${node}`).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('bench-drilldown').waitFor({ timeout: 15000 });
  };
  const closeDrill = async () => {
    await page.getByTestId('bench-drilldown-back').click();
    await page.getByTestId('bench-drilldown').waitFor({ state: 'detached', timeout: 15000 });
  };

  // ---- 引擎就绪：协议按钮可用 ----
  const oddballBtn = page.locator('.bench-protocol-btn', { hasText: '稀有刺激' });
  const btnDeadline = Date.now() + 60000;
  for (;;) {
    if (!(await oddballBtn.isDisabled())) break;
    if (Date.now() > btnDeadline) assert.fail('protocol button never became enabled');
    await page.waitForTimeout(250);
  }

  // ---- 主视图是一张回路图：7 个节点 + 头节点画布 + 圆盘 ----
  await page.getByTestId('pictorial-loop').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-testid^="pict-node-"]').count(), 7,
    'picture must have exactly 7 nodes');
  assert.ok(await page.locator('.pict-head-slot canvas').isVisible(),
    'head node must hold the Three.js canvas');
  assert.ok(await page.locator('.pict-thumb canvas').isVisible(),
    'recording-PC screen must show the waveform thumbnail');
  const discs = await page.evaluate(() => window.__pictorialHead?.getElectrodeDiscs?.() ?? null);
  assert.ok(discs && discs.length === 64, `cap must show 64 discs, got ${discs?.length}`);
  assert.ok(discs.every((d) => d.geometry === 'CylinderGeometry'),
    'cap discs must be cylinders, not spheres');
  assert.ok(discs.every((d) => d.color === '#c8d2dc'),
    'cap discs must be #c8d2dc, not green dots');
  assert.equal(await page.locator('.bench-protocol-btn').count(), 4,
    'control bar must show exactly 4 protocol buttons');
  for (const name of ['单脉冲', '稀有刺激', '闪烁', '闭环触发']) {
    assert.ok(await page.locator('.bench-protocol-btn').getByText(name, { exact: true }).count() >= 1,
      `protocol button ${name} must be visible in the control bar`);
  }
  assert.ok(await page.getByRole('button', { name: '运行协议', exact: true }).isVisible(),
    'run button must be visible in the control bar');
  assert.ok(await page.getByRole('button', { name: '停止协议', exact: true }).isVisible(),
    'stop button must be visible in the control bar');
  assert.equal(await page.getByTestId('bench-status-line').count(), 1,
    'main view must have exactly one status line');
  assert.ok((await page.getByTestId('bench-status-line').textContent())?.includes('还没开始'),
    'status line must say 还没开始 before any run');
  assert.ok(await page.locator('.bench-footnote').isVisible(), 'footer honesty note must be visible');
  assert.ok((await page.locator('.bench-footnote').textContent())?.includes('51'),
    'footer must keep the 51× amplitude-gap honesty note');
  // 大脑 q 芯片在大脑节点下方：从一开始就有真值，不是永久的 "—"。
  const qLine = page.getByTestId('bench-brain-q');
  await qLine.waitFor({ timeout: 60000 });
  const qText = (await qLine.textContent() ?? '').replace(/\s+/g, ' ').trim();
  assert.match(qText, /-?\d+\.\d+ nA·m/, `brain q must show a real value, got ${qText}`);
  assert.ok(!qText.includes('—'), `brain q must not be a dash, got ${qText}`);
  assert.ok(await page.locator('.pict-q [data-testid="bench-brain-q"]').isVisible(),
    'brain q chip must sit under the head node');
  console.log('picture ok; brain q:', qText);

  // 主视图里不该有的东西：诊断面板已删除，最近几跳、响应表、丢弃数、
  // 闭环延迟、放大器、帽预设只在 drill-down 里。
  assert.equal(await page.getByTestId('bench-diagnostics').count(), 0, 'diagnostics panel must not exist');
  assert.equal(await page.getByTestId('bench-diagnostics-toggle').count(), 0, 'diagnostics toggle must not exist');
  assert.equal(await page.getByTestId('bench-drilldown').count(), 0, 'no drill-down may be open at start');
  assert.equal(await page.locator('.bench-flow-hops').count(), 0, 'hop list must be hidden in main view');
  assert.equal(await page.getByTestId('bench-loop-timing').count(), 0, 'loop-timing readout must be hidden in main view');
  assert.equal(await page.getByRole('combobox', { name: '脑电帽预设', exact: true }).count(), 0, 'cap preset must be hidden in main view');
  assert.equal(await page.getByRole('combobox', { name: '采样率', exact: true }).count(), 0, 'amplifier settings must be hidden in main view');
  assert.equal(await page.getByText('丢弃的响应').count(), 0, 'dropped-response count must be hidden in main view');
  assert.equal(await page.getByText('放大器设置').count(), 0, 'amplifier settings toggle must not exist in main view');
  await assertNoUnconfirmed('main view before run');
  console.log('main view hidden elements ok; no unconfirmed marks before run');

  // ---- 跑一次 oddball，攒出试次与受试者响应（试次数在实验电脑里读） ----
  await oddballBtn.click();
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  await openNode('experiment');
  const expReadout = page.getByTestId('bench-drilldown').locator('.bench-readout').first();
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
  await page.getByTestId('bench-drilldown').getByRole('button', { name: '停止协议', exact: true }).click();
  await page.waitForTimeout(3000);

  // ---- 实验电脑里：响应表有真实响应行，整页没有确认标记 ----
  const responseRows = page.getByTestId('bench-drilldown').locator('table tbody tr');
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length >= 2,
    '[data-testid="bench-drilldown"] table tbody tr',
    { timeout: 60000 },
  );
  const rowCount = await responseRows.count();
  await assertNoUnconfirmed('experiment drill-down after oddball run');
  console.log(`experiment drill-down: ${rowCount} response rows, no unconfirmed marks`);
  await closeDrill();

  // ---- 测试电脑里：回路追踪有跳，整页没有确认标记 ----
  await openNode('test');
  const hopCount = await page.locator('.bench-flow-hop').count();
  assert.ok(hopCount >= 1, `trace must hold hops after the run, got ${hopCount}`);
  await assertNoUnconfirmed('test drill-down after oddball run');
  console.log(`test drill-down: ${hopCount} hops, no unconfirmed marks`);
  await closeDrill();

  // ---- 回到主视图：同样没有确认标记 ----
  await assertNoUnconfirmed('main view after oddball run');
  console.log('main view after run: still no unconfirmed marks');

  console.log(`PASS bench pictorial-view: 7 nodes, 64 discs, 4 protocol buttons, 1 status line, brain q live, ` +
    `${trials} oddball trials, ${rowCount} response rows shown, ${hopCount} hops, ` +
    `“未确认” nowhere (main + drill-downs), pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
