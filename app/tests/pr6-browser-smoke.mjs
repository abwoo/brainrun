/**
 * PR6 浏览器冒烟（B1 搭架，B2 补频谱/ERP tab；轻量冒烟，不做全量交互测试）。
 *
 * 跑法：node app/tests/pr6-browser-smoke.mjs
 * 前置：`npm run build` 已跑过（dist 须含最新代码 + 球形 fixture；
 * fixture 由 `scientific/forward/generate_sphere_model.py` 生成后才进
 * dist，顺序错了这里会直接报错说明）。
 *
 * 步骤：
 * 1. 球形 fixture 缺失时用 eeg-venv 的 Python 生成（MNE 1.11.0）。
 * 2. 预览服务器：先检查 127.0.0.1:4173 是否已在服务（curl 式探活），
 *    在就复用；死了就起 `vite preview --port 4173`（只装浏览器二进
 *    制，绝不用 `--with-deps` 装 Playwright 系统依赖）。
 * 3. 打开 EEG 实验 → 运行一次实验 → 断言波形数值真的变化
 *    （Pz 折线 y 值有范围；三种参考各不相同；换种子 + 开噪声后波形变）。
 * 4. 1920×1080 与 978px 各看一眼：对话框不出视口、无横向溢出。
 * 5. B2 新 tab 冒烟（集成时补，2026-11-12）：有记录后点开“频谱”tab
 *    （PSD/频段功率/预设真实渲染）与“ERP”tab（切分试次后 ERP 波形 +
 *    条件对照表真实渲染），两 tab 均无页面报错。
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE+'#advanced', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: 'EEG 分析', exact: true }).click({ timeout: 60000 });
  const dialog = page.getByRole('dialog', { name: 'EEG 分析实验' });
  await dialog.waitFor({ timeout: 30000 });
  // 正向模型加载完成（页脚露出模型 id）。
  await dialog.getByText('mne-four-layer-sphere-ras-v1', { exact: false })
    .waitFor({ timeout: 30000 });
  await dialog.getByTestId('eeg-empty').waitFor();

  const readPz = () => dialog.locator('svg[data-channel="Pz"] polyline').getAttribute('points');
  const yRange = (points) => {
    const ys = points.split(' ').map((p) => Number(p.split(',')[1]));
    return Math.max(...ys) - Math.min(...ys);
  };

  // 运行一次实验（默认 10 秒 WC、平均参考、无噪声）。
  await dialog.getByRole('button', { name: '运行实验', exact: true }).click();
  await dialog.getByTestId('eeg-waveform').waitFor({ timeout: 30000 });
  const pathAvg = await readPz();
  assert.ok(pathAvg && pathAvg.length > 100, 'Pz waveform must render after run');
  assert.ok(yRange(pathAvg) > 1, `Pz waveform values must vary (y range ${yRange(pathAvg)})`);
  const summary = await dialog.getByTestId('eeg-summary').textContent();
  assert.ok(summary?.includes('19 通道'), `summary must show 19 channels, got ${summary}`);
  assert.ok(summary?.includes('平均参考'), `summary must show average reference, got ${summary}`);
  console.log('run 1 (average, no noise): Pz y-range =', yRange(pathAvg).toFixed(1));

  // R4：三种参考的波形数值各不相同（浏览器内实测）。
  await dialog.getByLabel('参考方式').selectOption('infinity');
  const pathInf = await readPz();
  assert.notEqual(pathInf, pathAvg, 'infinity reference must change waveform values');
  await dialog.getByLabel('参考方式').selectOption('electrode');
  await dialog.getByLabel('参考电极').selectOption('Cz');
  const pathEl = await readPz();
  assert.notEqual(pathEl, pathAvg, 'electrode reference must change waveform values');
  assert.notEqual(pathEl, pathInf, 'electrode vs infinity must differ');
  console.log('reference switch: average/infinity/electrode waveforms all differ');

  // 换种子 + 开噪声后波形变（噪声真的进了记录）。
  await dialog.locator('.eeg-noise-toggle input[type="checkbox"]').check();
  await dialog.getByLabel('噪声种子').fill('2');
  await dialog.getByRole('button', { name: '运行实验', exact: true }).click();
  await dialog.getByText('种子 2', { exact: false }).waitFor({ timeout: 30000 });
  const pathSeed2 = await readPz();
  assert.notEqual(pathSeed2, pathEl, 'seed 2 + noise must change waveform values');
  assert.ok(yRange(pathSeed2) > 1, 'noisy waveform must vary');
  console.log('run 2 (seed 2 + noise): Pz y-range =', yRange(pathSeed2).toFixed(1));

  // 5. B2 新 tab 冒烟：有记录后点开“频谱”与“ERP”，真实渲染、无页面报错。
  // 频谱 tab：同一份记录的 PSD/频段功率/预设（Alpha 探索）都画出来。
  await dialog.getByRole('tab', { name: '频谱', exact: true }).click();
  await dialog.getByText('频段 / PSD（WAVES）').waitFor({ timeout: 30000 });
  await dialog.getByText('Alpha 探索', { exact: false }).waitFor({ timeout: 30000 });
  console.log('waves tab renders: PSD + band powers + presets');
  // ERP tab：切分试次（MNE 口径）按钮可用（事件表非空），点后 ERP 波形 +
  // 条件对照表（峰值/潜伏期/窗均值）真实渲染。
  await dialog.getByRole('tab', { name: 'ERP', exact: true }).click();
  await dialog.getByText('事件相关电位（ERP）', { exact: false }).waitFor({ timeout: 30000 });
  const epochBtn = dialog.getByRole('button', { name: '切分试次（MNE 口径）', exact: true });
  assert.ok(await epochBtn.isEnabled(), 'epoch button must be enabled once events exist');
  await epochBtn.click();
  await dialog.getByText('已切分：', { exact: false }).waitFor({ timeout: 30000 });
  await dialog.getByText('ERP 波形（µV）').waitFor({ timeout: 30000 });
  await dialog.getByText('300–500 ms 均值（µV）').waitFor({ timeout: 30000 });
  console.log('erp tab renders: epochs + ERP waveform + condition table');

  // 布局冒烟：1920×1080 与 978px 下对话框不出视口、无横向溢出。
  for (const [w, h] of [[1920, 1080], [978, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(300);
    const box = await dialog.boundingBox();
    assert.ok(box && box.width <= w && box.height <= h,
      `dialog must fit ${w}x${h}, got ${box?.width}x${box?.height}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${w}px viewport has horizontal overflow ${overflow}px`);
    console.log(`layout ok at ${w}x${h}: dialog ${Math.round(box.width)}x${Math.round(box.height)}`);
  }

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('PR6 browser smoke: PASS');
} finally {
  await browser?.close();
  if (serverProc) serverProc.kill();
}
