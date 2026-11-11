import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  server: { port: 0, host: '127.0.0.1', strictPort: false },
  logLevel: 'error',
});
let browser;
try {
  await server.listen();
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
  const resetHead = await measure();
  assert.ok(Math.abs(resetHead-base) < 0.001,
    'reset must recover original MNE sphere EEG voltage');
  await page.screenshot({ path: '../tests/pr5/shots/mne-head-sphere.png', fullPage: true });
  assert.deepEqual(errors, [], 'no JavaScript runtime exceptions');
  console.log('PR5 browser smoke PASS: 12 voltages, moment, orientation, reset, 3D drag, screenshot, no pageerror');
} finally {
  await browser?.close();
  await server.close();
}
