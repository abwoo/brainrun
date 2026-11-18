/**
 * Bench protocol-status browser test (2026-11-19 修：协议状态误标回归）。
 *
 * 缺陷：协议状态文案只看 `protocolRunning`——停过的协议也显示“已暂停”，
 * 用户会以为顶栏的“恢复”能续跑协议；它只是恢复脉冲基线快照（模型时间
 * 会跳回约 30 秒），续跑只能点“运行协议”。同根问题：协议运行中全局
 * 暂停时模型时钟明明冻住，状态仍显示“运行中”。修法见
 * `app/src/lib/benchProtocol.ts` `protocolStatusKey`：四态
 * 未开始 / 运行中 / 已暂停（运行中 + 全局暂停）/ 已停止（停过）；
 * 顶栏按钮改名“恢复快照”。
 *
 * 本测试断言全序列：协议下拉引擎就绪前禁用、就绪后可用；状态“未开始”
 * → 跑 oddball →“运行中”→ 全局暂停 →“已暂停”且模型时间冻住
 * → 继续 →“运行中”→ 停止协议 →“已停止”→ 点“恢复快照”仍是
 * “已停止”→ 再跑一次 →“运行中”。
 *
 * 跑法：node app/tests/bench-protocol-status-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture；
 * fixture 由 `scientific/forward/generate_sphere_model.py` 生成后才进
 * dist，顺序错了这里会直接报错说明）。
 *
 * 稳健性：本地无头 Chromium 很慢（SwiftShader ~1fps），轮询用慷慨上限、
 * 只认文案与“模型时间不变”这类定性断言，不认精确数值。
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

  const header = page.locator('.bench-header');
  const protocolSelect = page.getByRole('combobox', { name: '协议', exact: true });
  const rolesLine = page.locator('.bench-roles');
  const waveStage = page.locator('.bench-stage-side');

  // 协议下拉：引擎就绪前禁用、就绪后可用。WASM 引擎启动要几秒，所以
  // 挂载后立刻采样一定能看到禁用态；采样到可用态才算就绪（60 秒上限）。
  // 修前修后这条都应通过（下拉本身没动）；它是序列的起点锚点。
  let sawDisabled = false;
  let enabled = false;
  const selectDeadline = Date.now() + 60000;
  for (;;) {
    if (await protocolSelect.isDisabled()) sawDisabled = true;
    else { enabled = true; break; }
    if (Date.now() > selectDeadline) break;
    await page.waitForTimeout(250);
  }
  assert.ok(sawDisabled, 'protocol select must be disabled before the engine is ready');
  assert.ok(enabled, 'protocol select must become enabled once the engine is ready');
  console.log('protocol select: disabled before ready, enabled after ready');

  // 等自动采集出一份记录（波形视图读数“样本数 N>0”），再开始断言状态。
  await waveStage.getByText(/样本数\s+[1-9]\d*/).first().waitFor({ timeout: 180000 });

  const readRoles = async () =>
    ((await rolesLine.textContent()) ?? '').replace(/\s+/g, ' ').trim();
  const readModelTms = async () => {
    const txt = (await waveStage.locator('.bench-readout').first().textContent() ?? '')
      .replace(/\s+/g, ' ').trim();
    return num(txt, /模型时间\s+([\d,]+)/);
  };
  const waitForStatus = async (status, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      last = await readRoles();
      if (last.includes(status)) return last;
      if (Date.now() > deadline) break;
      await page.waitForTimeout(1000);
    }
    assert.fail(`protocol status never became “${status}”; roles line: ${last}`);
  };

  // 换 oddball：从未跑过 → “未开始”（修前这里是“已暂停”，是本缺陷的
  // 第一处误标：什么都没跑过，谈不上暂停）。
  await protocolSelect.selectOption('oddball');
  let roles = await readRoles();
  assert.ok(roles.includes('未开始'), `status must be “未开始” before any run; roles: ${roles}`);
  assert.ok(roles.includes('oddball'), `roles line must name the selected protocol; roles: ${roles}`);
  console.log('before run:', roles);

  // 跑 oddball → “运行中”。
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  roles = await waitForStatus('运行中');
  console.log('running:', roles);

  // 全局暂停（顶栏“暂停”）：协议仍在跑、模型时钟冻住 → “已暂停”
  // （修前仍显示“运行中”，是同根的第二处误标）。模型时间 4 秒内
  // 分毫不差才算冻住。注意：无头渲染约 1 fps，暂停后立刻读到的
  // DOM 可能是暂停前的旧渲染（实测：立刻读 7431，4 秒后读 7619——
  // 不是时间在走，是旧渲染被冻住的新值 7619 追上），所以先等 5 秒
  // 让一次带冻住值的新渲染落定，再读两次、隔 4 秒断言相等。
  await header.getByRole('button', { name: '暂停', exact: true }).click();
  roles = await waitForStatus('已暂停');
  console.log('globally paused:', roles);
  await page.waitForTimeout(5000);
  const t1 = await readModelTms();
  assert.ok(t1 !== null, `model time must be readable while paused; roles: ${roles}`);
  await page.waitForTimeout(4000);
  const t2 = await readModelTms();
  assert.equal(t2, t1, `model time must freeze while globally paused, got ${t1} -> ${t2}`);
  console.log(`model time frozen at ${t1} ms across 4 s`);

  // 继续 → 回到“运行中”。
  await header.getByRole('button', { name: '继续', exact: true }).click();
  roles = await waitForStatus('运行中');
  console.log('resumed:', roles);

  // 停止协议 → “已停止”（修前这里是“已暂停”，是本缺陷的核心误标：
  // 停了就是停了，顶栏的恢复快照并不能续跑它）。
  await page.getByRole('button', { name: '停止协议', exact: true }).click();
  roles = await waitForStatus('已停止');
  console.log('stopped:', roles);

  // 点顶栏“恢复快照”：只是恢复脉冲基线快照，不续跑协议，状态仍是
  // “已停止”。（按钮已由“恢复”改名“恢复快照”，旧名断言不到。）
  await header.getByRole('button', { name: '恢复快照', exact: true }).click();
  await page.waitForTimeout(3000);
  roles = await readRoles();
  assert.ok(roles.includes('已停止'),
    `status must stay “已停止” after Restore snapshot; roles: ${roles}`);
  assert.ok(!roles.includes('运行中') && !roles.includes('已暂停'),
    `status must not flip back to running/paused after Restore snapshot; roles: ${roles}`);
  console.log('after restore snapshot:', roles);

  // 再点“运行协议” → 回到“运行中”（续跑协议的唯一办法）。
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  roles = await waitForStatus('运行中');
  console.log('re-run:', roles);

  console.log(`PASS bench protocol-status: 未开始 -> 运行中 -> 已暂停 (frozen ${t1} ms) -> 运行中 -> 已停止 -> 恢复快照仍已停止 -> 运行中, pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
