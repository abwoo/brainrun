/**
 * Bench follow-up UI browser test (2026-11-19, PR #41 live-run follow-ups).
 *
 * 钉住四件事（每件修前失败、修后通过）：
 * 1. 命令日志记协议刺激：跑 oddball 攒出 ≥3 个试次后，诊断面板里刺激器
 *    一节的命令日志必须有真实行（目标/幅度/时长都是真值），不再是
 *    “暂无命令”；停表后点“发送一次刺激”，日志行数再涨 1。
 * 2. 闭环延迟读数没有真值就不出现：没跑闭环协议时，诊断面板里
 *    `bench-loop-timing` 必须不存在（而不是挂一个 "—"）。
 * 3. “停止协议”按钮不折行：1920px 与 978px 下标签都只占一行
 *    （Range 量出的文本行盒数为 1）。
 * 4. 协议按钮 2 是中文名：四个协议按钮依次为
 *    单脉冲 / 稀有刺激 / 闪烁 / 闭环触发。
 *
 * 跑法：BENCH_PREVIEW_PORT=4174 node app/tests/bench-followup-ui-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture；
 * fixture 由 `scientific/forward/generate_sphere_model.py` 生成后才进
 * dist，顺序错了这里会直接报错说明）。
 * 端口用环境变量是为与 4173 上的并行 worker 互不干扰；默认仍是 4173，
 * 与其余 bench 测试一致。
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

// 3. 预览服务器：先探活，死了重起。
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
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('closed-loop-bench').waitFor({ timeout: 60000 });

  // ---- 引擎就绪：协议按钮可用（按位置取第 2 个跑 oddball，不依赖名字） ----
  const protocolBtns = page.locator('.bench-protocol-btn');
  const btnDeadline = Date.now() + 60000;
  for (;;) {
    if (!(await protocolBtns.nth(1).isDisabled())) break;
    if (Date.now() > btnDeadline) assert.fail('protocol button never became enabled');
    await page.waitForTimeout(250);
  }

  // ---- (4) 四个协议按钮全是中文名 ----
  assert.equal(await protocolBtns.count(), 4, 'main view must show exactly 4 protocol buttons');
  const names = [];
  for (let i = 0; i < 4; i++) {
    names.push(((await protocolBtns.nth(i).locator('.bench-protocol-name').textContent()) ?? '').trim());
  }
  assert.deepEqual(names, ['单脉冲', '稀有刺激', '闪烁', '闭环触发'],
    `protocol buttons must be named in Chinese, got ${JSON.stringify(names)}`);
  console.log('protocol buttons:', JSON.stringify(names));

  // ---- (3) “停止协议”不折行：1920px 与 978px 各量一次 ----
  // Range 行盒数：标签折行时文本节点占 2 个行盒，单行只占 1 个。
  const stopLabelLines = async () => page.evaluate(() => {
    const btn = [...document.querySelectorAll('.bench-strip-run .ui-button')]
      .find((b) => (b.textContent ?? '').trim() === '停止协议');
    if (!btn) return -1;
    const range = document.createRange();
    range.selectNodeContents(btn);
    return range.getClientRects().length;
  });
  const stopBox = async () => page.getByRole('button', { name: '停止协议', exact: true }).boundingBox();
  let lines = await stopLabelLines();
  let box = await stopBox();
  console.log(`stop button @1920: lines=${lines} height=${box?.height}`);
  assert.equal(lines, 1, `stop button label must fit on one line @1920px, got ${lines} lines`);
  await page.setViewportSize({ width: 978, height: 800 });
  await page.waitForTimeout(1000);
  lines = await stopLabelLines();
  box = await stopBox();
  console.log(`stop button @978: lines=${lines} height=${box?.height}`);
  assert.equal(lines, 1, `stop button label must fit on one line @978px, got ${lines} lines`);

  // ---- 打开诊断面板 ----
  await page.getByTestId('bench-diagnostics-toggle').click();
  await page.getByTestId('bench-diagnostics').waitFor({ timeout: 15000 });

  // ---- (2) 没跑闭环协议时，闭环延迟读数根本不出现 ----
  assert.equal(await page.getByTestId('bench-loop-timing').count(), 0,
    'loop-timing readout must not render without a real value (no dash placeholder)');

  // ---- (1) 跑 oddball：命令日志必须记下协议刺激 ----
  await protocolBtns.nth(1).click();
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  const expReadout = page.locator('[data-testid="bench-experiment-computer"] .bench-readout').first();
  const trialDeadline = Date.now() + 240000;
  let trials = 0;
  for (;;) {
    const txt = (await expReadout.textContent() ?? '').replace(/\s+/g, ' ').trim();
    trials = num(txt, /试次数[:：]?\s*(\d+)/) ?? 0;
    if (trials >= 3) break;
    if (Date.now() > trialDeadline) throw new Error(`oddball produced only ${trials} trials in 240 s`);
    await page.waitForTimeout(2000);
  }
  console.log('oddball trials fired:', trials);
  const stimRows = page.locator('[data-testid="bench-stimulator"] table tbody tr');
  const stimSectionText = async () =>
    ((await page.getByTestId('bench-stimulator').innerText()) ?? '').replace(/\s+/g, ' ').trim();
  // 日志行是 250 ms 轮询里由 marker 匹配确认、但行本身在刺激发出时就记下；
  // 给渲染留一点时间，再数行。
  const logDeadline = Date.now() + 60000;
  let rowCount = 0;
  for (;;) {
    rowCount = await stimRows.count();
    if (rowCount >= 1 && !(await stimSectionText()).includes('暂无命令')) break;
    if (Date.now() > logDeadline) break;
    await page.waitForTimeout(1000);
  }
  assert.ok(rowCount >= 1,
    `command log must hold protocol stimuli after ${trials} oddball trials, got ${rowCount} rows`);
  assert.ok(!(await stimSectionText()).includes('暂无命令'),
    'command log must not say “暂无命令” after protocol stimuli fired');
  const firstRow = ((await stimRows.first().innerText()) ?? '').replace(/\s+/g, ' ').trim();
  assert.match(firstRow, /\d+\.\d+/, `command-log row must carry a real amplitude, got: ${firstRow}`);
  assert.ok(firstRow.includes('ms'), `command-log row must carry a real duration, got: ${firstRow}`);
  console.log(`command log after oddball: ${rowCount} rows; first row: ${firstRow}`);

  // ---- 停表，再手动发一次刺激：日志末行变成新的一条 ----
  // 表只显示最后 8 行，行数到顶后不再涨，改认末行内容变化（手动那条
  // 的 ACK 时间是新的模型时间，末行文本一定变）。
  await page.getByRole('button', { name: '停止协议', exact: true }).click();
  await page.waitForTimeout(3000);
  const lastRowText = async () =>
    ((await stimRows.last().innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
  const beforeManual = await lastRowText();
  await page.getByRole('button', { name: '发送一次刺激', exact: true }).click();
  const manualDeadline = Date.now() + 30000;
  let afterManual = beforeManual;
  for (;;) {
    afterManual = await lastRowText();
    if (afterManual !== beforeManual && afterManual.length > 0) break;
    if (Date.now() > manualDeadline) break;
    await page.waitForTimeout(1000);
  }
  assert.notEqual(afterManual, beforeManual,
    `manual pulse must append a command-log row (last row stayed: ${beforeManual})`);
  console.log(`command log last row after manual pulse: ${afterManual}`);

  console.log(`PASS bench follow-up UI: protocol names zh, stop button 1 line @1920+978, ` +
    `no loop-timing dash, ${trials} oddball trials logged (${rowCount} rows), ` +
    `manual pulse logged, pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
