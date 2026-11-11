/**
 * Run ONLY with explicit local fsaverage FreeSurfer-derived asset.
 * Tests the REAL 3D model/EEG values in Chromium and does not upload images
 * or dataset artifacts to GitHub.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const modelPath=resolve(process.env.PR5_MODEL_FILE || '../.local-assets/pr5/fsaverage-bem.json');
const expectedSources=Number(process.env.PR5_EXPECTED_SOURCES||16);
const expectedElectrodes=Number(process.env.PR5_EXPECTED_ELECTRODES||19);
const model=JSON.parse(readFileSync(modelPath,'utf8'));
assert.equal(model.model_id,'fsaverage-mne-three-layer-bem-v1');
assert.equal(model.source_positions.length,expectedSources);
assert.equal(model.electrodes.length,expectedElectrodes);
assert.ok(model.meshes.cortex.lh.vertices_head_mm.length<10000,
  'real anatomical display vertices must be reduced');

const server=await createServer({
  server:{host:'127.0.0.1',port:0,strictPort:false},
  logLevel:'error',
});
let browser;
try{
  await server.listen();
  const local=server.resolvedUrls?.local?.[0];
  assert.ok(local,'Vite local server missing');
  browser=await chromium.launch({
    headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl'],
  });
  const page=await browser.newPage({viewport:{width:1680,height:1050}});
  page.setDefaultTimeout(60000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(new URL('pr5-real-bem.html',local).toString(),
    {waitUntil:'domcontentloaded'});
  const dialog=page.getByRole('dialog',{name:'真实模板 MRI BEM 实验'});
  await dialog.waitFor();
  await dialog.getByLabel('导入本地 BEM 模型').setInputFiles(modelPath);
  const menu=dialog.getByLabel('皮层源位置');
  await menu.waitFor();
  assert.equal(await menu.locator('option').count(),expectedSources);
  await dialog.getByText('模板 fsaverage', {exact:false}).waitFor();
  assert.ok((await dialog.getByText('MNI305 (mm)',{exact:false}).textContent())?.includes(','),
    'real MRI-derived MNI305 coordinate displayed');
  const canvas=dialog.locator('canvas').first();
  await canvas.waitFor();
  const box=await canvas.boundingBox();
  assert.ok(box?.width>300&&box.height>300,'real anatomical 3D canvas is visible');

  const voltage=async()=>{
    const text=await dialog.getByText('电位：',{exact:false}).textContent();
    const m=text?.match(/(-?[0-9]+(?:[.][0-9]+)?)[ ]*µV/);
    assert.ok(m,'missing valid head-model EEG microvolts: '+text);
    return Number(m[1]);
  };
  const base=await voltage();
  await menu.selectOption(String(expectedSources-1));
  const moved=await voltage();
  assert.ok(Math.abs(base-moved)>.0001,
    'picking another genuine MNE cortex source changes real BEM EEG voltage');
  await dialog.getByLabel('MRI BEM源方向').selectOption('Z');
  const rotated=await voltage();
  assert.ok(Math.abs(moved-rotated)>.0001,
    'physically rotating dipole moment changes the actual MNE BEM projection');
  await dialog.getByRole('button',{name:'重置模板实验'}).click();
  const reset=await voltage();
  assert.ok(Math.abs(reset-base)<1e-4,
    'restored source index, orientation and current return the reference voltage');
  // PR5 independent local cortical ODE -> assumed synaptic current -> MRI
  // cortical normal -> MNE/BEM electrode projection (no pre-authored trace).
  await dialog.getByLabel('BEM物理源模式').selectOption('local-column');
  await dialog.getByText('等效偶极矩：', {exact:false}).waitFor();
  const momentText=()=>dialog.getByText('等效偶极矩：',{exact:false}).textContent();
  const beforeMoment=await momentText();
  assert.ok(beforeMoment?.includes('0.0000 nA·m'),'column starts at equilibrium');
  await dialog.getByRole('button',{name:'施加局部刺激'}).click();
  await page.waitForTimeout(120);
  const duringMoment=await momentText();
  const match=duringMoment?.match(/(-?[0-9]+(?:[.][0-9]+)?) nA·m/);
  assert.ok(match,'source must expose numerical physical units');
  assert.ok(Math.abs(Number(match[1]))>.005,
    'stimulus must change ODE-driven equivalent current dipole');
  const observed=await dialog.getByText('电位：',{exact:false}).textContent();
  assert.match(observed??'',/µV/,'dipole projects through EEG BEM');
  await dialog.getByRole('button',{name:'暂停神经动力学'}).click();
  const paused=await dialog.getByText('模拟时钟',{exact:false}).textContent();
  await page.waitForTimeout(130);
  const pausedAgain=await dialog.getByText('模拟时钟',{exact:false}).textContent();
  assert.equal(pausedAgain,paused,'pause must freeze model clock');
  await dialog.getByRole('button',{name:'重置神经动力学'}).click();
  const baseline=await momentText();
  assert.ok(baseline?.includes('0.0000 nA·m'),'reset must restore equilibrium');
  await dialog.getByLabel('BEM物理源模式').selectOption('manual');
  assert.deepEqual(errors,[],'zero browser runtime errors');

  console.log(JSON.stringify({
    status:'PASS',
    browser:'Chromium SwiftShader',
    model:model.model_id,
    source_count:model.source_positions.length,
    electrodes:model.electrodes.length,
    visible_canvas:true,
    scientific_values:{baseline_uV:base,changed_source_uV:moved,
      rotated_dipole_uV:rotated,reset_uV:reset},
    image_artifacts:'NOT_DISTRIBUTED_LICENSE_REVIEW',
  }));
}finally{
  await browser?.close();
  await server.close();
}
