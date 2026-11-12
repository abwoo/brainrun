/**
 * P0-1B real 3D pointer / solver / cross-view contracts.
 * Run with built production dist and generated WASM+TVB assets.
 * Does NOT validate EEG-physics registration or claim 250Hz live source rate.
 */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { preview } from 'vite';

const server = await preview({ preview:{port:0,host:'127.0.0.1',strictPort:false}, logLevel:'error' });
let browser;
try {
  const url = server.resolvedUrls?.local?.[0];
  assert.ok(url, 'vite preview URL absent');
  browser = await chromium.launch({
    headless:true, args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']
  });
  const page = await browser.newPage({viewport:{width:1600,height:900}});
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.__brainSim?.isReady?.() && window.__brainScene?.getCameraPosition(),null,{timeout:60000});
  // Disable camera auto-rotation: camera movement must be caused by the tested orbit gesture.
  const rotate=page.getByRole('button',{name:/^旋转 (开|关)$/});
  if ((await rotate.textContent()).includes('开')) await rotate.click();
  const scene=page.locator('.brain-scene');
  const box=await scene.boundingBox();
  assert.ok(box?.width>250 && box?.height>250);
  const x=box.x+box.width/2, y=box.y+box.height/2-40;
  const sim=(code)=>page.evaluate(code);
  await sim(()=>window.__brainSim.reset());
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms>=0);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('section.stage').getAttribute('data-selected-region-id'),'none');

  const before=await sim(()=>window.__brainScene.getCameraPosition());
  const markCount=()=>sim(()=>window.__brainSim.getMarkers().length);
  const markersBefore=await markCount();
  await page.mouse.move(x,y);
  await page.mouse.down();
  await page.mouse.move(x+100,y+25,{steps:12});
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after=await sim(()=>window.__brainScene.getCameraPosition());
  assert.ok(Math.hypot(...after.map((v,i)=>v-before[i]))>0.3,
    'left drag actually orbits the 3D camera');
  assert.equal(await page.locator('section.stage').getAttribute('data-selected-region-id'),'none',
    'orbit must not select a brain region just by pointerdown');
  assert.equal(await markCount(),markersBefore,
    'orbit drag must not pulse/hold; no misleading visual feedback');

  // Reset camera using explicitly visual-only background double click.
  await page.mouse.dblclick(box.x+15,box.y+15);
  await page.waitForTimeout(1000);
  const cameraNow=await sim(()=>window.__brainScene.getCameraPosition());
  const target=await sim(()=>window.__brainScene.getDefaultCameraPosition());
  assert.ok(Math.hypot(...cameraNow.map((v,i)=>v-target[i]))<5,
    'double click background returns camera close to default, without a solver event');
  assert.equal(await markCount(),markersBefore);

  await page.mouse.click(x,y,{button:'right'});
  assert.equal(await page.locator('section.stage').getAttribute('data-selected-region-id'),'none',
    'secondary mouse button cannot select a brain region');
  assert.equal(await markCount(),markersBefore,
    'right click cannot change neural stimulus');
  // Synthetic unpaired pointerup after leave/cancel does not synthesize pulse.
  await scene.locator('canvas').first().evaluate(el=>
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,button:0,pointerType:'mouse',clientX:x,clientY:y}))
  );
  assert.equal(await markCount(),markersBefore,'stray pointerup must never stimulate');

  // Genuine primary click must select a region, send a pulse, and propagate
  // to the same-region 3D scene, ActivityChart, response window, and E state.
  await sim(()=>window.__brainSim.resetPeakTracking());
  await page.mouse.click(x,y);
  await page.waitForFunction(()=>
    document.querySelector('section.stage')?.getAttribute('data-selected-region-id')!=='none',
    null,{timeout:10000});
  const id=Number(await page.locator('section.stage').getAttribute('data-selected-region-id'));
  assert.ok(Number.isInteger(id)&&id>=0&&id<76);
  await page.waitForFunction(node=>
    window.__brainSim.getMarkers().some(m=>m.kind==='pulse'&&m.node===node),
    id,{timeout:10000});
  assert.equal(await page.locator('.chart-wrap').getAttribute('data-selected-region-id'),String(id),
    'LIVE ACTIVITY chart selection must match 3D');
  const hit=await sim(()=>window.__brainScene.getLastStimulusPoint());
  assert.equal(hit.node,id);
  assert.equal(hit.fromHit,true,'confirmation ring location must come from real raycast surface hit');
  await page.waitForFunction(node=>
    window.__brainSim.getPeakE()?.[node]>0.05,
    id,{timeout:30000});
  const actualPeak=await sim(node=>window.__brainSim.getPeakE()[node],id);
  assert.ok(actualPeak>0.05,`3D click must change E from solver: ${actualPeak}`);
  const baseline=await sim(()=>window.__brainSim.getBaseline());
  assert.equal(baseline.node,id,'response baseline must refer to same selected brain region');
  const groups=await sim(()=>window.__brainSim.getResponseGroups());
  assert.equal(groups.input,id,'response markers must refer to the touched region');

  await page.getByRole('button',{name:/^更多/}).click();
  await page.waitForFunction(node=>
    document.querySelector('.region-panel')?.textContent?.includes(`#${node} / 76`),
    id,{timeout:10000});
  // E readout and network response share the physical snapshot.
  await sim(()=>window.__brainSim.pause());
  await page.waitForTimeout(280);
  const eRead=await page.locator('.region-facts div').filter({hasText:'兴奋活动 E'}).locator('dd').first().textContent();
  const eModel=await sim(node=>window.__brainSim.getSnapshot()?.e?.[node],id);
  assert.ok(Math.abs(Number(eRead)-eModel)<0.006,
    `selected E in REGION panel differs from neural model E: ${eRead} vs ${eModel}`);

  // Visual-only coloration changes the presentation but not E or simulated time.
  await page.getByRole('button',{name:'活动变化 ΔE'}).first().click();
  const view=await sim(()=>window.__brainScene.getColorDebug());
  assert.equal(view.colorMode,'delta');
  assert.equal(view.hasBaseline,true);
  const eAfter=await sim(node=>window.__brainSim.getSnapshot().e[node],id);
  assert.equal(eAfter,eModel,'changing E/ΔE visualization must not modify model E');
  assert.equal(await page.locator('.chart-wrap').getAttribute('data-selected-region-id'),String(id));

  // UI edge and bias are meaningful model controls, not decorative sliders.
  const edge=page.locator('.weight-item').first();
  assert.ok(await edge.count(),'selected region must have at least one edge control');
  const edgeName=await edge.getAttribute('data-edge');
  assert.match(edgeName,/^\d+-\d+$/);
  const [targetNode,sourceNode]=edgeName.split('-').map(Number);
  const wBefore=await sim(([i,j])=>window.__brainSim.getWeight(i,j),[targetNode,sourceNode]);
  await edge.locator('button.edge-step').last().click();
  const wAfter=await sim(([i,j])=>window.__brainSim.getWeight(i,j),[targetNode,sourceNode]);
  assert.notEqual(wAfter,wBefore,'edge plus button must update the actual network adjacency');
  await edge.getByRole('button',{name:'恢复原始值'}).click();
  const wRestored=await sim(([i,j])=>window.__brainSim.getWeight(i,j),[targetNode,sourceNode]);
  assert.equal(wRestored,await sim(([i,j])=>window.__brainSim.getOriginalWeight(i,j),[targetNode,sourceNode]));

  const bias=page.locator('.region-panel').getByRole('button',{name:/^偏置/});
  const biasBefore=await sim(node=>window.__brainSim.getBias(node),id);
  assert.equal(biasBefore,0);
  await bias.click();
  const biasAfter=await sim(node=>window.__brainSim.getBias(node),id);
  assert.ok(biasAfter>0,'bias toggle must change real region drive');
  await page.waitForFunction(node=>
    window.__brainScene.getBiasMarkers()?.some(x=>x.node===node),id,{timeout:10000});
  await bias.click();
  assert.equal(await sim(node=>window.__brainSim.getBias(node),id),0);

  await mkdir('../tests/p0-1/shots',{recursive:true});
  await page.screenshot({path:'../tests/p0-1/shots/3d-pointer-crossview.png',fullPage:true});
  assert.deepEqual(errors,[],'page errors during actual gestures');
  console.log('P0-1B PASS: orbit/right-click/cancel inert; click -> E+response+chart; edges/bias -> WASM');
} finally {
  await browser?.close();
  await server.httpServer.close();
}