import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

// Production Vite preview is required: the original wasm-bindgen module
// is an ES module copied to /public/wasm, and Vite DEV disallows importing
// directly from /public. Preview serves the real build, like GitHub Pages.
const server = await preview({
  preview: { port: 0, host: '127.0.0.1', strictPort: false },
  logLevel: 'error',
});
let browser;
try {
  const url = server.resolvedUrls?.local?.[0];
  assert.ok(url, 'Vite did not provide a local URL');
  browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // Phase 4: the bench is the default entry (any hash except #basic).
  // The old #advanced workspace is gone; the sim boots on the bench.
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  // PR1–PR4 regression: the original Rust/WASM neural simulation must
  // still boot and respond physically after the new physics lab is added.
  await page.waitForFunction(() => window.__brainSim?.isReady?.() === true,
    null, {timeout: 45000});
  const beforeTime = await page.evaluate(() => window.__brainSim.getSnapshot()?.t_ms ?? 0);
  await page.waitForTimeout(900);
  const afterTime = await page.evaluate(() => window.__brainSim.getSnapshot()?.t_ms ?? 0);
  assert.ok(afterTime > beforeTime, 'original Wilson-Cowan clock advances');
  await page.evaluate(() => {
    window.__brainSim.resetPeakTracking();
    window.__brainSim.pulse(40);
  });
  await page.waitForTimeout(1200);
  const originalPeak = await page.evaluate(() => window.__brainSim.getPeakE()?.[40] ?? 0);
  assert.ok(originalPeak > 0.05,
    'PR1–PR4 original BrainRun neural stimulus still produces a real peak');

  // DROPPED (deliberate coverage change, Phase 4 cut — not a silent
  // weakening): the DipoleLab browser section (button '电流源' → dialog
  // '电流偶极子物理实验', 12 sensor readouts, moment slider, direction Z,
  // reset, 3D drag) has NO entry anywhere after the P4 cut. Its entry was
  // deliberately removed; app/src/components/DipoleLab.tsx remains as an
  // unmounted file and no new entry is invented just for this test.
  // The dipole physics itself is still covered at node level by
  // tests/pr5/volume-conduction.test.mjs (homogeneous-unbounded-dipole-v1:
  // analytic µV values, sign reversal, 1/r^2, moment doubling, linear
  // superposition, 12 illustrative sensors) and by the DipoleLab source
  // contract checks in tests/pr5/contract.test.mjs.

  // MNE four-layer sphere: layout switching, physical gain changes and reset.
  // Phase 4: HeadSphereLab is EMBEDDED in #basic (PhysicsHome renders it
  // when the head model is 'sphere'); there is no dialog and no '头部电位'
  // button any more. Interact with the embedded lab directly.
  await page.goto(url+'#basic', { waitUntil: 'domcontentloaded' });
  const head = page.getByTestId('manual-electric');
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="physical-field"]')?.dataset.modelId
      === 'mne-four-layer-sphere-ras-v1',
    null, { timeout: 60000 });
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="selected-potential"]')?.dataset.voltage !== '',
    null, { timeout: 30000 });
  // The bench shares physical-source state with #basic: its cap preset
  // pushes its montage + channel subset into the shared state, so a fresh
  // #basic load after the bench starts from the cap's subset (average
  // reference over the subset), not from full defaults. Normalise to the
  // lab's own defaults first, so the reset assertion below compares
  // like-for-like.
  await head.getByRole('button', { name: '恢复默认', exact: true }).click();
  await head.getByRole('combobox', { name: '查看电极', exact: true }).selectOption('Fp1');
  const measure = async () => {
    const value = await head.getByTestId('selected-potential').getAttribute('data-voltage');
    assert.ok(value !== null && value !== '' && Number.isFinite(Number(value)),
      'EEG electrode reading must have numeric µV value: '+value);
    return Number(value);
  };
  const base = await measure();
  const gain = head.getByRole('slider', { name: '源强度', exact: true });
  await gain.focus();
  await gain.press('End');
  const stronger = await measure();
  assert.ok(Math.abs(stronger-base) > 0.001,
    'changing the MNE sphere source moment must change real EEG voltage');
  await head.getByRole('combobox', { name: '电流方向', exact: true }).selectOption('Z');
  const rotatedVoltage = await measure();
  assert.ok(Math.abs(rotatedVoltage-stronger) > 0.001,
    'changing the sphere source orientation must change EEG voltage');
  // The layout control lives inside the collapsed "更多设置与模型说明" details.
  await head.getByText('更多设置与模型说明', { exact: true }).click();
  await head.getByRole('combobox', { name: '电极布局', exact: true }).selectOption('10-05');
  assert.equal(await head.getByRole('combobox', { name: '查看电极', exact: true }).locator('option').count(),343);
  await head.getByRole('combobox', { name: '电极布局', exact: true }).selectOption('10-20');
  assert.equal(await head.getByRole('combobox', { name: '查看电极', exact: true }).locator('option').count(),19);
  await head.getByRole('button', { name: '恢复默认', exact: true }).click();
  // Reset restores the selected electrode to Cz. Compare like-for-like: Fp1.
  await head.getByRole('combobox', { name: '查看电极', exact: true }).selectOption('Fp1');
  const resetHead = await measure();
  assert.ok(Math.abs(resetHead-base) < 0.001,
    'reset must recover original MNE sphere EEG voltage');
  // Real pointer drag on the 3D source, not just a model setter.
  // The embedded lab exposes the source's actual screen point through
  // window.__headPhysics (same bridge pattern as physical-field-browser.mjs).
  const headCanvas = head.getByTestId('physical-field').locator('canvas').first();
  await headCanvas.waitFor();
  // The aside interactions above scroll the page: the canvas may sit above
  // the viewport, and the source's client coordinates would then be
  // negative (mouse events would hit nothing). Bring it into view first.
  await headCanvas.scrollIntoViewIfNeeded();
  const bbox = await headCanvas.boundingBox();
  assert.ok(bbox?.width > 300, 'head canvas visible');
  await page.waitForFunction(() => typeof window.__headPhysics?.source === 'function',
    null, { timeout: 30000 });
  const positionValue = (name) =>
    head.getByRole('spinbutton', { name, exact: true }).inputValue();
  const prePosition = [
    await positionValue('左右位置 mm'),
    await positionValue('前后位置 mm'),
    await positionValue('上下位置 mm'),
  ];
  const preDrag = await measure();
  const src = await page.evaluate(() => window.__headPhysics.source());
  await page.mouse.move(src.x, src.y);
  await page.mouse.down();
  await page.mouse.move(src.x+32, src.y+14, {steps:8});
  await page.mouse.up();
  const postPosition = [
    await positionValue('左右位置 mm'),
    await positionValue('前后位置 mm'),
    await positionValue('上下位置 mm'),
  ];
  assert.ok(postPosition.some((v, i) => v !== prePosition[i]),
    'MNE spherical source must move when dragged in 3D');
  const postDrag = await measure();
  assert.ok(Math.abs(postDrag-preDrag) > 0.0005,
    '3D source drag must change actual MNE-derived electrode voltage');
  await mkdir('../tests/pr5/shots', { recursive: true });
  await page.screenshot({ path: '../tests/pr5/shots/mne-head-sphere.png', fullPage: true });
  // Local-only real MRI/BEM UI: verify browser file loading, source selection,
  // current dipole parameter causality and source reset WITHOUT shipping
  // any FreeSurfer-derived asset. This test uses a tiny synthetic fixture;
  // real BEM correctness is independently checked by the MNE live job.
  // Phase 4: LocalBEMLab is EMBEDDED in #basic when the head model is BEM
  // (PhysicsHome switches headModel); it is a region, not a dialog.
  await page.getByText('头部模型 · 球形教学模型', { exact: false }).click();
  await page.getByRole('combobox', { name: '头部模型', exact: true }).selectOption('bem');
  const real = page.getByRole('region', { name: '真实模板 MRI BEM 实验' });
  await real.waitFor({ timeout: 30000 });
  // NOTE: [data-testid="template-physics"] only renders once a model is
  // loaded. With no real fsaverage asset present the template fetch 404s,
  // so the readiness signal here is the region itself; the fixture upload
  // below is what produces the data (and the testid) in this test.
  const tetra = {
    vertices_head_mm:[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],
    triangles:[[0,1,2],[0,1,3],[1,2,3],[0,2,3]],
  };
  const localFixture = {
    model_id:'fsaverage-mne-three-layer-bem-v1',
    subject:'fsaverage',
    subject_type:'SYNTHETIC_BROWSER_TEST_ONLY',
    montage:'10-20',
    frame:'HEAD_RAS_MM',
    gain_unit:'uV_per_nA_m',source_moment_unit:'nA_m',
    interpolation:'none; synthetic sample, never redistributed',
    license_status:'REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET',
    transform_mri_to_head_rowmajor:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    transform_mri_to_mni305_rowmajor:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
    standard_coordinate_definition:'MNI305, not MNI152 or true Talairach',
    source_positions:[
      {hemisphere:'lh',vertex:0,head_mm:[-30,0,0],normal_head_unit:[0,0,1],mni305_mm:[-30,0,0],atlas:'aparc',region:'test-left'},
      {hemisphere:'rh',vertex:1,head_mm:[30,0,0],normal_head_unit:[0,0,-1],mni305_mm:[30,0,0],atlas:'aparc',region:'test-right'},
    ],
    electrodes:[
      {label:'Cz',head_mm:[0,0,100]},
      {label:'Pz',head_mm:[0,-50,90]},
      {label:'Fz',head_mm:[0,50,90]},
    ],
    gains_uV_per_nAm:[
      [1,2,3,4,5,6],[-1,0,2,3,0,-2],[0,1,2,3,4,5],
    ],
    meshes:{brain:tetra,skull:tetra,scalp:tetra,
      cortex:{lh:tetra,rh:tetra}},
  };
  // The file input lives inside the collapsed "高级：导入其他兼容模型" details.
  await real.getByText('高级：导入其他兼容模型', { exact: false }).click();
  await real.getByLabel('导入本地 BEM 模型').setInputFiles({
    name:'SYNTHETIC-NOT-REAL-BEM.json',
    mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(localFixture),'utf8'),
  });
  await real.getByText('模板 fsaverage', {exact:false}).waitFor();
  await page.getByTestId('template-physics').waitFor({ timeout: 30000 });
  const sourceMenu = real.getByLabel('皮层源位置');
  assert.equal(await sourceMenu.locator('option').count(),2);
  const localVoltage = async () => {
    const text = await real.getByText('电位：', {exact:false}).textContent();
    const m = text?.match(/(-?[0-9]+(?:[.][0-9]+)?)[ ]*µV/);
    assert.ok(m,'MRI BEM display voltage must be finite µV: '+text);
    return Number(m[1]);
  };
  const localBase = await localVoltage();
  await sourceMenu.selectOption('1');
  const localMoved = await localVoltage();
  assert.ok(Math.abs(localMoved-localBase)>.001,
    'switching precomputed cortex source must change gain matrix column');
  await real.getByLabel('MRI BEM源方向').selectOption('Z');
  const localRotated=await localVoltage();
  assert.ok(Math.abs(localRotated-localMoved)>.001,
    'rotating dipole moment must change the displayed voltage');
  await real.getByRole('button',{name:'重置模板实验'}).click();
  const localReset=await localVoltage();
  assert.ok(Math.abs(localReset-localBase)<.001,
    'reset must recover selected source and physical dipole parameters');
  const localCanvas=real.locator('canvas').first();
  await localCanvas.waitFor();
  assert.ok((await localCanvas.boundingBox())?.width>200,
    'loaded BEM human anatomy uses real Three.js renderer');
  await page.screenshot({path:'../tests/pr5/shots/mri-bem-local-synthetic.png',fullPage:true});
  // DROPPED (deliberate coverage change, Phase 4 cut — not a silent
  // weakening): the local-column ODE section (BEM物理源模式 → local-column,
  // 等效偶极矩, 施加局部刺激, 模拟时钟 ≥80 ms, 暂停/重置神经动力学) has
  // NO equivalent in the embedded #basic lab: LocalBEMLab.tsx renders the
  // source-mode switch only when `{!embedded && ...}`, so the embedded lab
  // is manual-dipole only. The ODE→dipole→BEM chain is still covered at
  // node level (tests/pr5/local-column-coupling.test.mjs,
  // tests/pr5/local-column-real-bem.test.mjs, tests/pr5/jansen-rit.test.mjs)
  // and in the browser by app/tests/pr5-real-bem-browser.mjs, which renders
  // the same LocalBEMLab as a dialog through the pr5-real-bem harness
  // (pr5-fsaverage-bem.yml) including the local-column section.
  assert.deepEqual(errors, [], 'no JavaScript runtime exceptions');
  console.log('PR5 browser smoke PASS: sim boot/clock/peak, sphere moment, orientation, layouts 343/19, reset, 3D drag, BEM fixture source/orientation/reset, screenshots, no pageerror');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(err => err ? reject(err) : resolve()));
}
