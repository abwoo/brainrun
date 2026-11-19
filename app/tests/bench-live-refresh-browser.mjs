/**
 * Bench live-refresh browser test (fix for the frozen 样本数/波形/事件数).
 * 2026-11-19 简化改写：协议下拉改成四个大按钮，样本数/事件数读数与
 * 记录分析进“详情 / 诊断”面板；先开面板再读数。
 *
 * 回归：样本数/波形/事件数都读同一份记录，记录只在引擎就绪时组装一次，
 * 运行中不刷新（除非手动点“更新记录”），导致运行中样本数卡住、波形是
 * 静止快照、事件数恒为 0。修法：协议运行中每 5 秒自动重采一次，停止时
 * 再刷一次。本测试断言：oddball 运行中样本数会涨、事件数会大于 0，
 * 停止后记录里至少有 1 个受试者响应。
 *
 * 跑法：node app/tests/bench-live-refresh-browser.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture；
 * fixture 由 `scientific/forward/generate_sphere_model.py` 生成后才进
 * dist，顺序错了这里会直接报错说明）。
 *
 * 稳健性：本地无头 Chromium 很慢（SwiftShader ~1fps），轮询用 240 秒
 * 慷慨上限、断言“增长量”而非精确数值。样本数只在 10 秒原生历史窗内
 * 增长（上限约 2500），所以断言是“比基线多 250 以上”，不是一直涨。
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

  // 诊断面板先打开、一直开着：样本数/事件数读数与记录分析都在里面。
  const diagToggle = page.getByTestId('bench-diagnostics-toggle');
  await diagToggle.click();
  const diag = page.getByTestId('bench-diagnostics');
  await diag.waitFor({ timeout: 15000 });
  const waveStage = diag.locator('section[aria-label="记录"]');

  // 等自动采集出一份记录（诊断面板记录读数 “样本数 N>0”）。
  await waveStage.getByText(/样本数\s+[1-9]\d*/).first().waitFor({ timeout: 180000 });

  const readWave = async () => {
    const txt = (await waveStage.locator('.bench-readout').first().textContent() ?? '')
      .replace(/\s+/g, ' ').trim();
    return {
      txt,
      samples: num(txt, /样本数\s+([\d,]+)/),
      events: num(txt, /事件数\s+([\d,]+)/),
      trials: num(txt, /试次数\s+(\d+)/),
      modelTms: num(txt, /模型时间\s+([\d,]+)/),
    };
  };

  // 基线：引擎就绪后的第一份记录（冻住的起点；修前它永远是终点）。
  const baseline = await readWave();
  assert.ok(baseline.samples !== null && baseline.samples > 0,
    `baseline samples must be > 0, got ${JSON.stringify(baseline)}`);
  console.log('baseline:', baseline.txt);

  // 跑 oddball：10 次试次保证 2 个 oddball（每 5 次一次）+ 8 个 standard。
  await page.locator('.bench-protocol-btn', { hasText: '稀有刺激' }).click();
  await page.getByRole('button', { name: '运行协议', exact: true }).click();

  // 轮询直到三条同时成立（240 秒上限；无头渲染慢，只认增长量）：
  // 样本数比基线多 250 以上（10 秒窗内可达约 2500），事件数大于 0，
  // 试次数至少 10（保证 oddball 反应已发生）。
  const deadline = Date.now() + 240000;
  let last = baseline;
  let grew = false;
  for (;;) {
    await page.waitForTimeout(5000);
    last = await readWave();
    const samplesGrew = last.samples !== null && last.samples > baseline.samples + 250;
    const eventsSeen = last.events !== null && last.events > 0;
    const trialsDone = last.trials !== null && last.trials >= 10;
    console.log(`poll samples=${last.samples} events=${last.events} trials=${last.trials} modelT=${last.modelTms} (baseline samples=${baseline.samples})`);
    if (samplesGrew && eventsSeen && trialsDone) { grew = true; break; }
    if (Date.now() > deadline) break;
  }
  assert.ok(grew, `live refresh failed: samples/events did not grow during oddball run; ` +
    `baseline samples=${baseline.samples}, last=${JSON.stringify(last)}`);

  // 停止协议：停表时自动再刷一次，记录里应已含受试者响应。
  await page.getByRole('button', { name: '停止协议', exact: true }).click();
  await page.waitForTimeout(3000);
  const finalWave = await readWave();
  assert.ok(finalWave.samples !== null && finalWave.samples > baseline.samples,
    `samples must stay above baseline after stop, got ${finalWave.samples} vs baseline ${baseline.samples}`);
  assert.ok(finalWave.events !== null && finalWave.events > 0,
    `events must stay > 0 after stop, got ${finalWave.events}`);
  console.log('final wave:', finalWave.txt);

  await page.getByTestId('bench-recording-events').waitFor({ timeout: 60000 });
  const eventsNote = await page.locator('[data-testid="bench-recording-events"] p').textContent();
  const respM = eventsNote?.match(/response\s+(\d+)/);
  assert.ok(respM && Number(respM[1]) >= 1,
    `recording must hold >=1 subject response after stop-refresh, got ${eventsNote}`);
  console.log('recording events:', eventsNote);
  console.log(`PASS bench live-refresh: baseline samples=${baseline.samples} -> ` +
    `final samples=${finalWave.samples}, events=${finalWave.events}, responses>=1, pageErrors=${errors.length}`);
  assert.equal(errors.length, 0, `page/console errors: ${errors.join(' ;; ')}`);
} finally {
  await browser?.close().catch(() => {});
  serverProc?.kill();
}
