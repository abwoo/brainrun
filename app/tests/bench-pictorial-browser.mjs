/**
 * Bench pictorial pinning test (2026-11-19 图解台子).
 *
 * 钉住图解台子的八件事：
 * 1. 图完整：7 个节点，头节点里有 Three.js 画布，帽圆盘是圆柱体
 *    #c8d2dc、不是绿球（`window.__pictorialHead` 探针区分）。
 * 2. 每个节点都能打开，里面是真控件（不是占位）。
 * 3. 返回按钮回到回路图，不丢运行态。
 * 4. 跑稀有刺激时节点高亮 + 边上有脉冲点 + 状态行“正在运行”。
 * 5. 主视图与每个 drill-down 里都没有“未确认”/“(unconfirmed)”。
 * 6. 组成器是真的：动 g，`__brainSim.getParams().g` 跟着变；动 B2/B3，
 *    Worker 回报的 `getModeParams()` 跟着变；改反应时下限，下一轮的
 *    响应 RT 下限跟着变（B2–B4 若直通被丢弃则不应出现，本分支未丢弃，
 *    故断言它们存在且可用）。
 * 7. ERP 按钮读“运行稀有刺激实验（同步全部分析）”，“运行 oddball”
 *    在整页不再出现。
 * 8. 稀有试次响应时手得 `.hand-pressing` 下压。
 *
 * 跑法：node app/tests/bench-pictorial-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture）。
 * 稳健性：本地无头 Chromium 很慢（SwiftShader ~1fps），轮询用慷慨上限、
 * 只认有无与大小关系，不认精确数值。手下压只有 250 ms，用 100 ms
 * 轮询的 waitForFunction 捕捉。
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
  const page = await browser.newPage({ viewport: { width: 978, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('crash', () => errors.push('PAGE CRASHED'));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('closed-loop-bench').waitFor({ timeout: 60000 });

  const bodyText = async () =>
    ((await page.locator('body').innerText()) ?? '').replace(/\s+/g, ' ').trim();
  const assertNoUnconfirmed = async (where) => {
    const txt = await bodyText();
    assert.ok(!txt.includes('未确认'), `${where}: page must not show “未确认”; body: ${txt.slice(0, 400)}`);
    assert.ok(!txt.includes('(unconfirmed)'), `${where}: page must not show "(unconfirmed)"; body: ${txt.slice(0, 400)}`);
  };
  const openNode = async (node) => {
    if (node === 'cap') {
      // The cap is the 7th logical node, but it lives inside the 3D head
      // (no SVG <g>): open it by clicking a real disc — Cz projected to
      // screen coordinates through the debug bridge.
      const pos = await page.evaluate(() => {
        const p = window.__pictorialHead?.projectDisc?.('Cz');
        if (!p) return null;
        const rect = document.querySelector('.pict-head-slot canvas').getBoundingClientRect();
        return { x: rect.left + p.x, y: rect.top + p.y };
      });
      assert.ok(pos, 'Cz disc must project to a screen position');
      await page.mouse.click(pos.x, pos.y);
      await page.getByTestId('bench-drilldown').waitFor({ timeout: 15000 });
      return;
    }
    await page.getByTestId(`pict-node-${node}`).focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('bench-drilldown').waitFor({ timeout: 15000 });
  };
  const closeDrill = async () => {
    await page.getByTestId('bench-drilldown-back').click();
    await page.getByTestId('bench-drilldown').waitFor({ state: 'detached', timeout: 15000 });
  };
  // RangeControl 的 range input：Playwright fill 在部分版本对 range
  // 不触发 React onChange，失败时用原生 setter + input 事件兜底。
  const setSlider = async (name, value) => {
    const slider = page.getByRole('slider', { name, exact: true });
    await slider.waitFor({ timeout: 15000 });
    try {
      await slider.fill(String(value), { timeout: 5000 });
    } catch {
      await slider.evaluate((el, v) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, String(v));
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, String(value));
    }
  };
  const drill = page.getByTestId('bench-drilldown');

  // ---- 引擎就绪 ----
  const oddballBtn = page.locator('.bench-protocol-btn', { hasText: '稀有刺激' });
  const btnDeadline = Date.now() + 60000;
  for (;;) {
    if (!(await oddballBtn.isDisabled())) break;
    if (Date.now() > btnDeadline) assert.fail('protocol button never became enabled');
    await page.waitForTimeout(250);
  }
  await page.waitForFunction(() => window.__brainSim?.getParams, null, { timeout: 30000 });

  // ---- (1) 图完整 ----
  // 7 个逻辑节点：6 个 SVG 节点 + 帽（第 7 个，活在 Three.js 头里，
  // 没有 SVG <g>；它的存在由 64 个圆盘证明）。
  assert.equal(await page.locator('[data-testid^="pict-node-"]').count(), 6,
    'picture must have 6 SVG nodes (brain, peripheral, amplifier, test, experiment, stimulator)');
  assert.ok(await page.locator('.pict-head-slot canvas').isVisible(),
    'head node must hold the Three.js canvas');
  const discs = await page.evaluate(() => window.__pictorialHead?.getElectrodeDiscs?.() ?? null);
  assert.ok(discs && discs.length === 64, `cap must show 64 discs, got ${discs?.length}`);
  assert.ok(discs.every((d) => d.geometry === 'CylinderGeometry'),
    'cap discs must be cylinders, not spheres');
  assert.ok(discs.every((d) => d.color === '#c8d2dc'),
    'cap discs must be #c8d2dc, not the old green dots');
  assert.ok(!discs.some((d) => d.color === '#2fd47a'),
    'no disc may carry the old green-dot colour #2fd47a');
  assert.ok(await page.locator('.pict-thumb canvas').isVisible(),
    'recording-PC screen must show the waveform thumbnail');
  console.log('(1) picture complete: 6 SVG nodes + cap (64 cylinder discs #c8d2dc) = 7 nodes');

  // ---- (2) 每个节点打开都有真控件 + (5) 每个 drill-down 都没有确认标记 ----
  const nodeChecks = [
    ['brain', async () => {
      await page.getByTestId('bench-brain-q-drilldown').waitFor({ timeout: 15000 });
    }],
    ['cap', async () => {
      assert.ok(await drill.getByRole('combobox', { name: '脑电帽预设', exact: true }).isVisible());
      assert.ok((await drill.locator('.bench-channel-grid .chip').count()) > 0, 'cap must list channels');
    }],
    ['amplifier', async () => {
      assert.ok(await drill.getByRole('combobox', { name: '采样率', exact: true }).isVisible());
      assert.ok(await drill.getByRole('combobox', { name: '参考', exact: true }).isVisible());
    }],
    ['test', async () => {
      assert.ok(await drill.locator('canvas.bench-wave').isVisible());
      assert.ok(await drill.getByRole('tab', { name: 'ERP' }).isVisible());
    }],
    ['experiment', async () => {
      assert.ok(await drill.getByText('① 设计实验').isVisible());
      assert.ok(await drill.getByText('② 组成被试').isVisible());
      assert.ok(await drill.getByText('③ 运行与观察').isVisible());
      assert.ok((await drill.getByRole('slider').count()) >= 8, 'composer must expose its sliders');
    }],
    ['stimulator', async () => {
      assert.ok(await drill.getByRole('button', { name: '发送一次刺激', exact: true }).isVisible());
      assert.ok(await drill.getByText('命令日志').isVisible());
    }],
    ['peripheral', async () => {
      assert.ok(await drill.getByText('接口预留').isVisible());
    }],
  ];
  for (const [node, check] of nodeChecks) {
    await openNode(node);
    await check();
    await assertNoUnconfirmed(`${node} drill-down`);
    await closeDrill();
  }
  console.log('(2)+(5) every node opens with real controls, no unconfirmed marks in any drill-down');

  // ---- (7) ERP 按钮新文案 + “运行 oddball”不再出现 ----
  await openNode('test');
  assert.ok(await drill.getByRole('button', { name: '运行稀有刺激实验（同步全部分析）', exact: true }).isVisible(),
    'ERP button must read 运行稀有刺激实验（同步全部分析）');
  const allText = await bodyText();
  assert.ok(!allText.includes('运行 oddball'), '“运行 oddball” must appear nowhere on the page');
  await closeDrill();
  console.log('(7) ERP button renamed; “运行 oddball” nowhere');

  // ---- (6a) 组成器真接线：g 与 B2/B3 动起来，引擎读回跟着变 ----
  await openNode('experiment');
  await setSlider('脑区互相带动的强度', 0.4);
  await page.waitForFunction(
    () => window.__brainSim.getParams().g === 0.4, null, { timeout: 30000 });
  const subjectLine = ((await page.locator('.pict-q-subject').textContent()) ?? '');
  assert.ok(subjectLine.includes('耦合 0.40'),
    `q-chip subject line must follow the g slider, got: ${subjectLine}`);
  // B1 切振荡：引擎把正弦驱动重置为 0.30 @ 10 Hz，滑动条同步跟进。
  await drill.getByRole('button', { name: '振荡', exact: true }).click();
  await page.waitForFunction(
    () => window.__brainSim.getModeParams()?.ext_sine_amp === 0.3, null, { timeout: 30000 });
  // B2/B3：改值，Worker 回报的 mode_applied 跟着变（引擎侧真值，非镜像）。
  await setSlider('背景噪声的起伏', 0.12);
  await page.waitForFunction(
    () => window.__brainSim.getModeParams()?.ou_sigma === 0.12, null, { timeout: 30000 });
  await setSlider('振荡驱动的幅度', 0.25);
  await page.waitForFunction(
    () => window.__brainSim.getModeParams()?.ext_sine_amp === 0.25, null, { timeout: 30000 });
  console.log('(6a) composer is real: g=0.40 in getParams, ou_sigma=0.12 + ext_sine_amp=0.25 in Worker mode_applied');
  // 恢复默认被试，再把 RT 范围改成 900–1200 ms（下一轮的 RT 下限跟着变）。
  await drill.getByRole('button', { name: '恢复默认被试', exact: true }).click();
  await page.waitForTimeout(1000);
  await setSlider('反应时上限', 1200);
  await setSlider('反应时下限', 900);
  await closeDrill();

  // ---- (4)+(3)+(6b)+(8)：跑一轮 oddball ----
  await oddballBtn.click();
  // 手下压只有 250 ms：运行一开始就用 100 ms 轮询等它出现。
  // 先挂 .catch：测试中途若因别的原因退出，未 await 的它不得以未处理
  // 拒绝炸掉进程、盖住真正的错误；(8) 处 await 时仍会正常抛出。
  const handPressed = page.waitForFunction(
    () => document.querySelector('.hand-pressing'), null,
    { timeout: 180000, polling: 100 });
  handPressed.catch(() => {});
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  console.log(`[${new Date().toISOString()}] run clicked`);
  const statusLine = page.getByTestId('bench-status-line');
  const readStatus = async () =>
    ((await statusLine.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  // 先确认协议真的跑起来了，再看高亮/脉冲（跑不起来是另一回事）。
  const runDeadline = Date.now() + 60000;
  for (;;) {
    if ((await readStatus()).includes('正在运行')) break;
    if (Date.now() > runDeadline) assert.fail(`protocol never started; status: ${await readStatus()}`);
    await page.waitForTimeout(1000);
  }
  console.log(`[${new Date().toISOString()}] status is 正在运行`);
  // (4) 节点高亮 + 边脉冲 + 运行状态。
  await page.waitForFunction(
    () => document.querySelectorAll('.pict-node-active').length >= 1
      && document.querySelectorAll('.pict-pulse').length >= 1,
    null, { timeout: 60000 });
  assert.ok((await readStatus()).includes('正在运行'), 'status must say 正在运行 while the protocol runs');
  console.log('(4) running: node highlighted + edge pulse + 正在运行');
  // (3) 打开 drill-down 再回来，运行态不丢。
  await openNode('experiment');
  assert.ok((await readStatus()).includes('正在运行'),
    'status must stay 正在运行 with the drill-down open');
  await closeDrill();
  assert.ok((await readStatus()).includes('正在运行'),
    'status must stay 正在运行 after returning from the drill-down');
  console.log('(3) back button returns without losing run state');
  // (6b) 等第一条响应行：RT 必须 ≥ 900（新下限），且 < 1200（新上限）。
  await openNode('experiment');
  const firstRt = async () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="bench-drilldown"] table tbody tr')];
    for (const r of rows) {
      const tds = r.querySelectorAll('td');
      if (tds.length >= 4) {
        const m = tds[3].textContent.match(/([\d.]+)/);
        if (m) return Number(m[1]);
      }
    }
    return null;
  });
  let rt = null;
  const rtDeadline = Date.now() + 180000;
  for (;;) {
    rt = await firstRt();
    if (rt !== null) break;
    if (Date.now() > rtDeadline) throw new Error('no subject response appeared in 180 s');
    await page.waitForTimeout(2000);
  }
  assert.ok(rt >= 900 && rt < 1200, `first response RT must follow the new 900–1200 ms floor, got ${rt}`);
  console.log(`(6b) RT floor is real: first response RT ${rt} ms (range was 900–1200)`);
  // (8) 手在稀有试次响应时下压过（与上面同一轮运行里捕捉）。
  await handPressed;
  console.log('(8) hand got .hand-pressing on a rare-trial response');
  await page.getByTestId('bench-drilldown').getByRole('button', { name: '停止协议', exact: true }).click();
  await page.waitForTimeout(3000);
  await closeDrill();

  // ---- (5) 跑完回主视图，仍没有确认标记 ----
  await assertNoUnconfirmed('main view after oddball run');
  console.log('(5) no unconfirmed marks in the main view after the run');

  console.log(`PASS bench pictorial: 7 nodes, 64 discs, all drill-downs real, ` +
    `composer g/ou_sigma/ext_sine_amp read back from the engine, RT floor ${rt} ms, ` +
    `highlight+pulse while running, back keeps run state, hand pressed, pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
