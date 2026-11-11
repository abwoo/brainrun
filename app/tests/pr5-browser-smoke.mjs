import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';
import * as THREE from 'three';

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

  await page.getByRole('button', { name: 'DIPOLE LAB' }).click();
  const modal = page.getByRole('dialog', { name: '电流偶极子物理实验' });
  await modal.waitFor();
  await modal.getByText('均匀、各向同性、无限导体', { exact: false }).waitFor();
  const sensorReadings = () => modal.locator('span.mono').allTextContents();
  const initial = await sensorReadings();
  assert.equal(initial.length, 12, 'must expose 12 computed sensor readouts');
  const initialNumbers = initial.map(Number);
  assert.ok(initialNumbers.every(Number.isFinite), 'all sensor outputs must be finite');
  const slider = modal.getByRole('slider', { name: '偶极矩强度' });
  await slider.focus();
  await slider.press('End');
  const changed = (await sensorReadings()).map(Number);
  assert.ok(changed.some((v, i) => Math.abs(v - initialNumbers[i]) > 0.01),
    'changing source moment must change the computed sensor voltage');

  const dir = modal.getByLabel('电流源方向');
  await dir.selectOption('Z');
  const rotated = (await sensorReadings()).map(Number);
  assert.ok(rotated.some((v, i) => Math.abs(v - changed[i]) > 0.01),
    'changing dipole axis must change sensor voltages');
  await modal.getByRole('button', { name: '重置实验' }).click();
  const reset = (await sensorReadings()).map(Number);
  reset.forEach((v, i) => assert.ok(Math.abs(v - initialNumbers[i]) < 0.001));

  // Three.js source object is projected at the centre of the camera view.
  const canvas = modal.locator('canvas').first();
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  assert.ok(box && box.width >= 100 && box.height >= 100, '3D canvas is visible');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 35, y + 12, { steps: 8 });
  await page.mouse.up();
  const coordinates = await modal.getByText('位置 (mm)：', { exact: false }).textContent();
  assert.ok(coordinates && !coordinates.includes('0.0, 0.0, 0.0'),
    'source drag must update the numerical position');

  await mkdir('../tests/pr5/shots', { recursive: true });
  await page.screenshot({ path: '../tests/pr5/shots/dipole-lab.png', fullPage: true });
  // MNE four-layer sphere: layout switching, physical gain changes and reset.
  await modal.getByRole('button', { name: '关闭' }).click();
  await page.getByRole('button', { name: 'HEAD EEG' }).click();
  const head = page.getByRole('dialog', { name: '分层球形头EEG物理实验' });
  await head.getByText('mne-four-layer-sphere-ras-v1', {exact:false}).waitFor();
  await head.getByLabel('选中电极').selectOption('Fp1');
  const measure = async () => {
    const value = await head.getByText('当前电极电位：', {exact:false}).textContent();
    const match = value?.match(/(-?[0-9]+(?:[.][0-9]+)?)[ ]*µV/);
    assert.ok(match, 'EEG electrode reading must have numeric µV unit: '+value);
    return Number(match[1]);
  };
  const base = await measure();
  const gain = head.getByRole('slider', { name: '球形头偶极矩' });
  await gain.focus();
  await gain.press('End');
  const stronger = await measure();
  assert.ok(Math.abs(stronger-base) > 0.001,
    'changing the MNE sphere source moment must change real EEG voltage');
  await head.getByLabel('球形头电流源方向').selectOption('Z');
  const rotatedVoltage = await measure();
  assert.ok(Math.abs(rotatedVoltage-stronger) > 0.001,
    'changing the sphere source orientation must change EEG voltage');
  await head.getByLabel('电极布局').selectOption('10-05');
  assert.equal(await head.getByLabel('选中电极').locator('option').count(),343);
  await head.getByLabel('电极布局').selectOption('10-20');
  assert.equal(await head.getByLabel('选中电极').locator('option').count(),19);
  await head.getByRole('button', { name: '重置球形实验' }).click();
  // Reset restores the selected electrode to Cz. Compare like-for-like: Fp1.
  await head.getByLabel('选中电极').selectOption('Fp1');
  const resetHead = await measure();
  assert.ok(Math.abs(resetHead-base) < 0.001,
    'reset must recover original MNE sphere EEG voltage');
  // Real pointer drag on the 3D source, not just a model setter.
  // Independent geometric projection to the canvas from the actual documented camera.
  const headCanvas = head.locator('canvas').first();
  const bbox = await headCanvas.boundingBox();
  assert.ok(bbox?.width > 300, 'head canvas visible');
  const camera = new THREE.PerspectiveCamera(42, bbox.width/bbox.height, 1, 1000);
  camera.up.set(0, 0, 1);
  camera.position.set(175, 165, 230);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ndc = new THREE.Vector3(0,0,16).project(camera);
  const sx = bbox.x + bbox.width*(ndc.x+1)/2;
  const sy = bbox.y + bbox.height*(1-ndc.y)/2;
  const preDrag = await measure();
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx+32, sy+14, {steps:8});
  await page.mouse.up();
  const dragLocation = await head.getByText('源位置 mm：', {exact:false}).textContent();
  assert.ok(dragLocation && !dragLocation.includes('0.0, 0.0, 16.0'),
    'MNE spherical source must move when dragged in 3D');
  const postDrag = await measure();
  assert.ok(Math.abs(postDrag-preDrag) > 0.0005,
    '3D source drag must change actual MNE-derived electrode voltage');
  await page.screenshot({ path: '../tests/pr5/shots/mne-head-sphere.png', fullPage: true });
  // Local-only real MRI/BEM UI: verify browser file loading, source selection,
  // current dipole parameter causality and source reset WITHOUT shipping
  // any FreeSurfer-derived asset. This test uses a tiny synthetic fixture;
  // real BEM correctness is independently checked by the MNE live job.
  await head.getByRole('button', {name:'打开本地真实 MRI BEM'}).click();
  const real = page.getByRole('dialog', {name:'真实模板 MRI BEM 实验'});
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
    source_positions:[
      {hemisphere:'lh',vertex:0,head_mm:[-30,0,0],atlas:'aparc',region:'test-left'},
      {hemisphere:'rh',vertex:1,head_mm:[30,0,0],atlas:'aparc',region:'test-right'},
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
  await real.getByLabel('导入本地 BEM 模型').setInputFiles({
    name:'SYNTHETIC-NOT-REAL-BEM.json',
    mimeType:'application/json',
    buffer:Buffer.from(JSON.stringify(localFixture),'utf8'),
  });
  await real.getByText('test-left', {exact:false}).first().waitFor();
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
  assert.deepEqual(errors, [], 'no JavaScript runtime exceptions');
  console.log('PR5 browser smoke PASS: 12 voltages, moment, orientation, reset, 3D drag, screenshot, no pageerror');
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.httpServer.close(err => err ? reject(err) : resolve()));
}
