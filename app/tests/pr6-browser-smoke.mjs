/**
 * PR6 浏览器冒烟（bench 版；2026-11-18 P4 后重写，旧 EEG 实验页已砍；
 * 2026-11-19 简化改写：协议下拉改成四个大按钮，样本数/参考/种子/
 * 记录分析进“详情 / 诊断”面板；先开面板再操作。
 * 2026-11-19 图像化改写：诊断面板按设计删除，内容分进各节点
 * drill-down（测试电脑 / 放大器 / 脑电帽 / 实验电脑）；本文件按新
 * 映射重写，断言口径不变。
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
 * 3. 打开台子（默认入口，无需再点 'EEG 分析'）→ 等自动采集出一份
 *    记录 → 断言数值真的变化（WavesTab 的 Welch PSD 折线 y 值有范围；
 *    平均 / Cz / M1 三种参考各不相同；种子控件可填）。
 * 4. 1920×1080 与 978px 各看一眼：台子不出视口宽、无横向溢出。
 * 5. B2 新 tab 冒烟：跑一次 oddball 协议攒出试次后点开“频谱”tab
 *    （PSD/频段功率/预设真实渲染）与“ERP”tab（切分试次后 ERP 波形 +
 *    条件对照表真实渲染），两 tab 均无页面报错。
 *
 * 旧断言 → 台子映射（无等价物的已删，见文件末尾 DROPPED）：
 * - 'EEG 分析' 按钮 + 'EEG 分析实验' 对话框 → 台子本身就是默认入口
 *   （data-testid="closed-loop-bench"），无对话框。
 * - 'mne-four-layer-sphere-ras-v1' 模型 id 文本 → 无等价物（台子不显示
 *   模型 id），已删。
 * - 'eeg-empty' → 无等价物；等价等待是波形视图出现 “样本数 N>0”。
 * - '运行实验' → 台子自动采集（10 s 原生历史窗）；协议运行是
 *   '运行协议'（ERP 一节用 oddball 协议攒试次）。
 * - 'eeg-waveform' 里 Pz polyline y 值范围 → WavesTab 的 Welch PSD
 *   polyline y 值范围（同一口径：像素 y-range > 1）。
 * - 'eeg-summary' 的 '19 通道' / '平均参考' → 脑电帽 drill-down 里
 *   '10-10 · 64 通道' 与放大器 drill-down 读数 '参考: 平均'。
 * - 参考 'infinity' / 'electrode' + '参考电极 Cz' → 放大器 drill-down
 *   里单个 '参考' combobox：average / cz / m1（三档各不相同，沿用旧口径）。
 * - '噪声种子' + 开噪声后波形变 → 无等价物（台子无噪声开关；记录种子
 *   恒为 1；'种子' 是受试者反应时种子，只改 RT 序列，不改波形），已删；
 *   只保留种子控件可填为 2 的断言，种子对 RT 的实际作用由 ERP 一节的
 *   response 事件覆盖。
 * - 对话框宽高断言 → 台子是整页滚动页，只断言宽不出视口 + 无横向溢出。
 * - 诊断面板（bench-diagnostics-toggle / bench-diagnostics）→ 2026-11-19
 *   图像化改版已删：记录/波形/分析在测试电脑 drill-down，参考在放大器
 *   drill-down，帽预设在脑电帽 drill-down，种子在实验电脑 drill-down。
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('crash', () => errors.push('PAGE CRASHED'));
  // 台子是默认入口（任何非 #basic 的 hash 都进台子）；不用再点 'EEG 分析'。
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await page.getByTestId('closed-loop-bench').waitFor({ timeout: 60000 });
  // 协议按钮没点亮前是灰的（引擎未就绪）；等它可用再往下走。
  await page.locator('.bench-protocol-btn', { hasText: '稀有刺激' })
    .waitFor({ state: 'visible', timeout: 60000 });

  // drill-down 开关：SVG 节点用键盘 Enter 打开（节点中心常被头节点
  // 的 HTML 遮层挡住鼠标点击）；关用返回按钮。一次只开一个。
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
  const drill = () => page.getByTestId('bench-drilldown');

  // 测试电脑 drill-down：记录读数（样本数 / 事件数 / 试次数）与波形画布。
  // 等自动采集出一份记录（旧 eeg-empty 的等价等待）。
  // 本地无头 Chromium 很慢（SwiftShader ~1fps），放宽到 180 s。
  await openNode('test');
  await drill().getByText(/样本数\s+[1-9]\d*/).first().waitFor({ timeout: 180000 });
  await drill().locator('canvas.bench-wave').waitFor({ timeout: 30000 });
  console.log('recording present:',
    await drill().getByText(/样本数/).first().textContent());

  // 脑电帽 drill-down：默认帽预设 10-10-64（64 通道）。
  // 旧 eeg-summary 的等价物。
  await closeDrill();
  await openNode('cap');
  const capText = await drill().textContent();
  assert.ok(capText?.includes('10-10'), `cap must show default montage 10-10, got ${capText}`);
  assert.ok(capText?.includes('64 通道'), `cap must show 64 channels, got ${capText}`);
  console.log('cap: 10-10 · 64 通道');

  // 放大器 drill-down：参考 combobox + 读数（旧 '参考方式' / '平均参考'
  // 的等价物）。注意：getByLabel('参考') 会同时命中 ControlField 的
  // group 与 select，必须用 combobox 角色定位。
  await closeDrill();
  await openNode('amplifier');
  const refSel = page.getByRole('combobox', { name: '参考', exact: true });
  const ampReadout = () => drill().locator('.bench-readout');
  assert.equal(await refSel.inputValue(), 'average', 'default reference must be average');
  assert.ok((await ampReadout().textContent())?.includes('参考: 平均'),
    `amplifier readout must show average reference, got ${await ampReadout().textContent()}`);

  // PSD 折线（旧 Pz polyline 的等价物；WavesTab 的 Welch PSD polyline）。
  const readPsd = () => page.locator('svg[aria-label*="Welch PSD"] polyline').getAttribute('points');
  const yRange = (points) => {
    const ys = points.split(' ').map((p) => Number(p.split(',')[1]));
    return Math.max(...ys) - Math.min(...ys);
  };
  const openWavesTab = async () => {
    await openNode('test');
    await page.getByRole('tab', { name: '频谱', exact: true }).click();
    await page.getByText('频段 / PSD（WAVES）').waitFor({ timeout: 60000 });
    await page.getByText('Alpha 探索', { exact: false }).waitFor({ timeout: 60000 });
  };
  // 新参考切过去后等 PSD 折线真的变了再读（重采是同步的，但无头下重渲染慢）。
  const waitPsdChange = async (prev) => {
    const deadline = Date.now() + 60000;
    for (;;) {
      const cur = await readPsd();
      if (cur && cur !== prev) return cur;
      if (Date.now() > deadline) throw new Error('PSD polyline did not change after reference switch');
      await page.waitForTimeout(1000);
    }
  };
  // 切换参考：回放大器 drill-down，改参考 + 点“重新采集”，再回测试电脑看 PSD。
  const switchReference = async (value, readoutText) => {
    await closeDrill();
    await openNode('amplifier');
    await refSel.selectOption(value);
    await page.getByRole('button', { name: '重新采集', exact: true }).click();
    assert.ok((await ampReadout().textContent())?.includes(readoutText),
      `amplifier readout must show ${readoutText}, got ${await ampReadout().textContent()}`);
    await closeDrill();
  };

  // 运行 1（默认平均参考）：PSD 折线画出来且 y 值有范围。
  await closeDrill();
  await openWavesTab();
  const psdAvg = await readPsd();
  assert.ok(psdAvg && psdAvg.length > 100, 'PSD polyline must render');
  assert.ok(yRange(psdAvg) > 1, `PSD values must vary (y range ${yRange(psdAvg)})`);
  console.log('run 1 (average): PSD y-range =', yRange(psdAvg).toFixed(1));

  // R4：三种参考的 PSD 数值各不相同（浏览器内实测；台子无 infinity 参考，
  // 三档是 average / cz / m1——见 DROPPED）。
  await switchReference('cz', '参考: Cz');
  await openWavesTab();
  const psdCz = await waitPsdChange(psdAvg);
  assert.ok(yRange(psdCz) > 1, 'Cz-reference PSD must vary');
  assert.notEqual(psdCz, psdAvg, 'Cz reference must change PSD values');
  console.log('reference switch: average/Cz PSDs differ');

  await closeDrill();
  await openNode('amplifier');
  assert.ok(await refSel.locator('option[value="m1"]').isEnabled(),
    'M1 reference option must be enabled with the default 10-10-64 preset');
  await switchReference('m1', '参考: M1');
  await openWavesTab();
  const psdM1 = await waitPsdChange(psdCz);
  assert.ok(yRange(psdM1) > 1, 'M1-reference PSD must vary');
  assert.notEqual(psdM1, psdAvg, 'M1 reference must change PSD values');
  assert.notEqual(psdM1, psdCz, 'M1 vs Cz must differ');
  console.log('reference switch: average/Cz/M1 PSDs all differ');

  // 种子控件（实验电脑 drill-down 作曲器里的“种子” RangeControl）：填 2 即生效。
  // 旧断言“换种子 + 开噪声后波形变”无等价物（见 DROPPED），只断言控件本身。
  await closeDrill();
  await openNode('experiment');
  const seedNum = page.locator('input.range-number[aria-label="随机种子 "]');
  await seedNum.fill('2');
  await seedNum.press('Enter');
  assert.equal(await seedNum.inputValue(), '2', 'seed input must take 2');
  console.log('seed control accepts 2 (subject RT seed; does not touch the waveform)');

  // 5. B2 新 tab 冒烟：跑 oddball 协议攒出 standard + oddball 试次，
  // 立刻重组记录（协议仍在跑：10 s 窗口里始终有新鲜脉冲），再看 ERP。
  // drill-down 是遮层：点主视图协议按钮前必须先关掉它。
  await closeDrill();
  await page.locator('.bench-protocol-btn', { hasText: '稀有刺激' }).click();
  await page.getByRole('button', { name: '运行协议', exact: true }).click();
  // 试次数在测试电脑 drill-down 的记录读数里（“样本数 N · 事件数 N · 试次数 N”）。
  await openNode('test');
  const trialRe = /试次数[:：]?\s*(\d+)/;
  const trialDeadline = Date.now() + 240000;
  let trials = 0;
  for (;;) {
    const txt = await drill().getByText(/试次数/).first().textContent();
    const m = txt?.match(trialRe);
    trials = m ? Number(m[1]) : 0;
    if (trials >= 10) break; // 试次 5 与 10 是 oddball：10 次保证 2 个 oddball + 8 个 standard
    if (Date.now() > trialDeadline) throw new Error(`oddball protocol produced only ${trials} trials in 240 s`);
    await page.waitForTimeout(2000);
  }
  console.log('oddball trials fired:', trials);
  // 先重组记录再停协议：停协议不重组记录，晚点窗口就滑过这批脉冲。
  await page.getByRole('button', { name: '更新记录', exact: true }).click();
  await closeDrill();
  await page.getByRole('button', { name: '停止协议', exact: true }).click();
  // 记录事件表：脉冲与受试者响应都在（种子 2 的受试者答过 oddball）。
  await openNode('test');
  await page.getByTestId('bench-recording-events').waitFor({ timeout: 60000 });
  const eventsNote = await page.locator('[data-testid="bench-recording-events"] p').textContent();
  const pulseM = eventsNote?.match(/pulse\s+(\d+)/);
  assert.ok(pulseM && Number(pulseM[1]) >= 5, `recording must hold >=5 pulse events, got ${eventsNote}`);
  const respM = eventsNote?.match(/response\s+(\d+)/);
  assert.ok(respM && Number(respM[1]) >= 1, `recording must hold >=1 subject response, got ${eventsNote}`);
  console.log('recording events:', eventsNote);
  // 频谱 tab 已在上面验过；这里只验 ERP tab。
  await page.getByRole('tab', { name: 'ERP', exact: true }).click();
  await page.getByText('事件相关电位（ERP）', { exact: false }).waitFor({ timeout: 60000 });
  const epochBtn = page.getByRole('button', { name: '切分试次（MNE 口径）', exact: true });
  assert.ok(await epochBtn.isEnabled(), 'epoch button must be enabled once events exist');
  await epochBtn.click();
  await page.getByText('已切分：', { exact: false }).waitFor({ timeout: 60000 });
  await page.getByText('ERP 波形（µV）').waitFor({ timeout: 60000 });
  await page.getByText('300–500 ms 均值（µV）').waitFor({ timeout: 60000 });
  console.log('erp tab renders: epochs + ERP waveform + condition table');
  await closeDrill();

  // 布局冒烟：1920×1080 与 978px 下台子宽不出视口、无横向溢出
  //（台子是整页滚动页，无对话框，故不做高 fit 断言）。
  for (const [w, h] of [[1920, 1080], [978, 800]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    const box = await page.getByTestId('closed-loop-bench').boundingBox();
    assert.ok(box && box.width <= w,
      `bench must fit ${w}px width, got ${box?.width}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `${w}px viewport has horizontal overflow ${overflow}px`);
    console.log(`layout ok at ${w}x${h}: bench ${Math.round(box.width)}px wide, overflow ${overflow}px`);
  }

  assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
  console.log('PR6 browser smoke: PASS');
} finally {
  await browser?.close();
  if (serverProc) serverProc.kill();
}

// DROPPED（旧断言，无台子等价物；不许为测试加产品 UI）：
// - 'mne-four-layer-sphere-ras-v1' 文本：台子加载同一份球形 fixture，但
//   界面不显示模型 id。
// - 'eeg-empty' testid：台子没有空态 testid；等价等待是“样本数 N>0”。
// - '运行实验' 按钮：台子没有这个按钮；采集是自动的，协议运行是“运行协议”。
// - 参考 'infinity'：台子参考只有 average / cz / m1，无 infinity 档。
// - '噪声种子' 填 2 + 开噪声后波形变 + '种子 2' 文本：台子无噪声开关；
//   记录种子恒为 1（runNativeExperiment 写死）；'种子' 是受试者反应时种子，
//   只改 RT 序列，不改波形。种子控件可填的断言保留，波形变化的断言删除。
// - 对话框宽高 fit 断言：台子无对话框，是整页滚动页。
// - 诊断面板（bench-diagnostics-toggle / bench-diagnostics）：2026-11-19
//   图像化改版按设计删除，内容分进各节点 drill-down（见文件头映射）。
