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

const modelPath=resolve('../.local-assets/pr5/fsaverage-bem.json');
const model=JSON.parse(readFileSync(modelPath,'utf8'));
assert.equal(model.model_id,'fsaverage-mne-three-layer-bem-v1');
assert.equal(model.source_positions.length,16);
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
  assert.equal(await menu.locator('option').count(),16);
  await dialog.getByText('aparc', {exact:false}).first().waitFor();
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
  await menu.selectOption('15');
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
