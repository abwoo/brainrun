/**
 * Bench brain-q high-state browser test (2026-11-19 stuck-q investigation).
 *
 * 钉住一件事：重复 oddball 把网络翻进高活动态之后，大脑 q 读数会停在
 * 一个数上不动（本地实测：E[0] 0.4996、meanE 0.461、q 2.899 连停 30 秒
 * 以上，模型时钟照常走、求解器没冻住；重置后 E 回 0.015、q 重新波动）。
 * 这不是显示 bug，是真实的高稳态；主视图必须在 q 读数旁边用人话讲清
 * 这一点，并把“重置”放到同一处，而不是让用户对着一个不动的数字猜。
 *
 * 断言：
 * 1. 跑 oddball 翻进高态后，主视图 q 读数旁出现高状态说明
 *    [data-testid="bench-q-high-state"]，文案讲清“不是卡住了”，里面有
 *    一个“重置”按钮。
 * 2. 点那个重置按钮后，说明消失，q 回到小数值并重新波动。
 * 3. 高状态说明出现之前（安静基线），主视图里没有它。
 *
 * 跑法：node app/tests/bench-q-high-state-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture）。
 * 稳健性：本地无头 Chromium 很慢（SwiftShader ~1fps），轮询用慷慨上限、
 * 只认有无与大小关系，不认精确数值。
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

const qVal = async (page) => {
  const el = page.getByTestId('bench-brain-q');
  if ((await el.count()) === 0) return null;
  const m = ((await el.textContent()) ?? '').match(/(-?[\d.]+)\s*nA·m/);
  return m ? Number(m[1]) : null;
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
  await page.getByTestId('closed-loop-bench').waitFor({ timeout: 120000 });

  const oddballBtn = page.locator('.bench-protocol-btn', { hasText: '稀有刺激' });
  const btnDeadline = Date.now() + 120000;
  for (;;) {
    if (!(await oddballBtn.isDisabled())) break;
    if (Date.now() > btnDeadline) assert.fail('protocol button never became enabled');
    await page.waitForTimeout(500);
  }

  // ---- 安静基线：q 是小数值且在波动，高状态说明不出现 ----
  const qLine = page.getByTestId('bench-brain-q');
  await qLine.waitFor({ timeout: 120000 });
  const qBefore1 = await qVal(page);
  await page.waitForTimeout(4000);
  const qBefore2 = await qVal(page);
  assert.ok(qBefore1 !== null && Math.abs(qBefore1) < 0.5,
    `baseline q must be small, got ${qBefore1}`);
  assert.ok(qBefore2 !== null && Math.abs(qBefore2) < 0.5,
    `baseline q must stay small, got ${qBefore2}`);
  assert.equal(await page.getByTestId('bench-q-high-state').count(), 0,
    'high-state note must not show on the quiet baseline');
  console.log(`baseline q: ${qBefore1} -> ${qBefore2}, no high-state note (ok)`);

  // ---- 跑 oddball 翻进高态：q 停住，说明出现 ----
  await oddballBtn.click();
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  const note = page.getByTestId('bench-q-high-state');
  const noteDeadline = Date.now() + 240000;
  let noteSeen = false;
  let qHigh = null;
  for (;;) {
    if ((await note.count()) > 0) { noteSeen = true; break; }
    if (Date.now() > noteDeadline) break;
    await page.waitForTimeout(2000);
  }
  assert.ok(noteSeen, 'high-state note must appear after oddball flips the network');
  const noteText = ((await note.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  assert.ok(noteText.includes('高状态'), `note must say 高状态, got: ${noteText}`);
  assert.ok(noteText.includes('不是卡住了'), `note must say 不是卡住了, got: ${noteText}`);
  qHigh = await qVal(page);
  assert.ok(qHigh !== null && qHigh > 1, `q must be stuck high, got ${qHigh}`);
  await page.waitForTimeout(4000);
  const qHigh2 = await qVal(page);
  // 高态是带噪声的稳态（E 在 0.4995–0.4997 量级晃动），q 读数保留 3 位小数，
  // 4 秒内漂 0.001 属“几乎不动”，不断言逐位相等，只断言停在高位且漂移极小。
  assert.ok(qHigh2 !== null && Math.abs(qHigh2 - qHigh) <= 0.005,
    `q must stay put in the high state, got ${qHigh} then ${qHigh2}`);
  console.log(`high state: q stuck at ${qHigh}, note: ${noteText}`);

  // ---- 停止协议后高态仍在（状态不靠协议跑不跑），说明不消失 ----
  await page.getByRole('button', { name: '停止协议', exact: true }).click();
  await page.waitForTimeout(3000);
  assert.equal(await note.count(), 1,
    'high-state note must persist after stopping the protocol (the state stays)');

  // ---- 点说明里的重置：说明消失，q 回到小数值并重新波动 ----
  await note.getByRole('button', { name: /重置/ }).click();
  const goneDeadline = Date.now() + 120000;
  for (;;) {
    if ((await note.count()) === 0) break;
    if (Date.now() > goneDeadline) assert.fail('high-state note must disappear after reset');
    await page.waitForTimeout(1000);
  }
  let qAfter = null;
  const qDeadline = Date.now() + 120000;
  for (;;) {
    qAfter = await qVal(page);
    if (qAfter !== null && Math.abs(qAfter) < 0.5) break;
    if (Date.now() > qDeadline) assert.fail(`q must fall back after reset, got ${qAfter}`);
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(4000);
  const qAfter2 = await qVal(page);
  assert.ok(qAfter2 !== null && Math.abs(qAfter2) < 0.5,
    `q must stay small after reset, got ${qAfter2}`);
  console.log(`after reset from the note: q ${qAfter} -> ${qAfter2}, note gone`);

  console.log(`PASS bench q high-state: baseline q ${qBefore1}/${qBefore2}, ` +
    `stuck q ${qHigh}, note shown with reset, reset recovers q to ${qAfter}/${qAfter2}, ` +
    `pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
