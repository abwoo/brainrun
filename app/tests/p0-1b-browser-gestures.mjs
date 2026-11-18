/**
 * P0-1B real 3D pointer / solver / cross-view contracts (rewritten for
 * Phase 4). Run with built production dist and generated WASM+TVB assets.
 * Does NOT validate EEG-physics registration or claim 250Hz live source rate.
 *
 * Re-pointed at the #basic network tab ('脑区与传播'), which still mounts
 * BrainScene + ActivityChart. The old #advanced workspace (section.stage,
 * REGION panel, edge-weight list, bias toggles, '活动变化 ΔE' button,
 * '更多' button, rotation toggle) is gone:
 * - Selection state is read from .chart-wrap[data-selected-region-id]
 *   instead of section.stage.
 * - No rotation toggle exists any more: App passes autoRotate={false}, so
 *   the camera never auto-rotates and the toggle step is dropped.
 * - A 3D click now SELECTS WITHOUT PULSING (BrainScene is mounted with
 *   pointerStimulates={false}); the pulse comes from the explicit
 *   '施加一次刺激' button. The click→pulse chain, the confirmation-ring
 *   check (getLastStimulusPoint) and the response-baseline/group checks now
 *   run against that explicit button pulse instead of the click.
 * - The REGION-panel E readout is replaced by the NetworkStatePanel
 *   [data-testid="network-state"][data-e] attribute (same selected-region
 *   E, same 0.006 tolerance against the model snapshot).
 * - The ΔE view toggle is gone: App fixes colorMode="delta", so the test
 *   asserts getColorDebug().colorMode === 'delta' with a real baseline
 *   after the pulse instead of clicking a toggle.
 * - Edge-weight controls (.weight-item) and bias toggles have NO equivalent
 *   anywhere after the cut (App passes biasList={[]}); those assertions
 *   are dropped, not silently but because the controls no longer exist.
 *   Weight/bias causality is covered at node level by
 *   tests/p0-1/control-flow.test.mjs.
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
  await page.goto(url+'#basic', {waitUntil:'domcontentloaded'});
  await page.getByRole('tab', { name: '脑区与传播', exact: true }).click();
  await page.waitForFunction(()=>window.__brainSim?.isReady?.() && window.__brainScene?.getCameraPosition(),null,{timeout:60000});
  const stage = page.locator('.chart-wrap');
  const scene=page.locator('.brain-scene');
  const box=await scene.boundingBox();
  assert.ok(box?.width>250 && box?.height>250);
  const x=box.x+box.width/2, y=box.y+box.height/2-40;
  const sim=(code,arg)=>page.evaluate(code,arg);
  await sim(()=>window.__brainSim.reset());
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms>=0);
  await page.waitForTimeout(150);
  assert.equal(await stage.getAttribute('data-selected-region-id'),'none');

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
  assert.equal(await stage.getAttribute('data-selected-region-id'),'none',
    'orbit must not select a brain region just by pointerdown');
  assert.equal(await markCount(),markersBefore,
    'orbit drag must not pulse/hold; no misleading visual feedback');

  // Reset camera using explicitly visual-only background double click.
  await page.mouse.dblclick(box.x+15,box.y+15);
  // SwiftShader may render <5 FPS. Check that the actual 3D camera completes
  // its 600ms RAF-based flight, not that the wall clock advanced by 1000ms.
  await page.waitForFunction(()=>{
    const sc=window.__brainScene;
    const pos=sc?.getCameraPosition(), target=sc?.getDefaultCameraPosition();
    return !!pos && !!target &&
      Math.hypot(...pos.map((v,i)=>v-target[i]))<5;
  },null,{timeout:20000,polling:100});
  const cameraNow=await sim(()=>window.__brainScene.getCameraPosition());
  const target=await sim(()=>window.__brainScene.getDefaultCameraPosition());
  assert.ok(Math.hypot(...cameraNow.map((v,i)=>v-target[i]))<5,
    'double click background must really return the 3D camera to default');
  assert.equal(await markCount(),markersBefore);

  await page.mouse.click(x,y,{button:'right'});
  assert.equal(await stage.getAttribute('data-selected-region-id'),'none',
    'secondary mouse button cannot select a brain region');
  assert.equal(await markCount(),markersBefore,
    'right click cannot change neural stimulus');
  // Synthetic unpaired pointerup after leave/cancel does not synthesize pulse.
  await scene.locator('canvas').first().evaluate((el,coords)=>
    el.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,isPrimary:true,button:0,pointerType:'mouse',clientX:coords.x,clientY:coords.y})),
    {x,y}
  );
  assert.equal(await markCount(),markersBefore,'stray pointerup must never stimulate');

  // Genuine primary click must select a region — and, with
  // pointerStimulates={false}, must NOT pulse on its own. The pulse comes
  // from the explicit stimulus button, and must propagate to the same-region
  // 3D scene, ActivityChart, response window, and E state.
  await page.mouse.click(x,y);
  await page.waitForFunction(()=>
    document.querySelector('.chart-wrap')?.getAttribute('data-selected-region-id')!=='none',
    null,{timeout:10000});
  const id=Number(await stage.getAttribute('data-selected-region-id'));
  assert.ok(Number.isInteger(id)&&id>=0&&id<76);
  assert.equal(await markCount(),markersBefore,
    '3D click selects but must not stimulate by itself');
  await sim(()=>window.__brainSim.resetPeakTracking());
  await page.getByRole('button', { name: '施加一次刺激', exact: true }).click();
  await page.waitForFunction(node=>
    window.__brainSim.getMarkers().some(m=>m.kind==='pulse'&&m.node===node),
    id,{timeout:10000});
  assert.equal(await page.locator('.chart-wrap').getAttribute('data-selected-region-id'),String(id),
    'LIVE ACTIVITY chart selection must match 3D');
  await page.waitForFunction(node=>
    window.__brainActivity?.getSelectedId()===node &&
    window.__brainActivity.getBufferedSamples().length>0,
    id,{timeout:15000});
  const chartProvenance=await sim(node=>{
    const sample=window.__brainActivity.getBufferedSamples().at(-1);
    const source=window.__brainSim.getSnapshotHistory().find(s=>s.t_ms===sample.t_ms);
    return {sample,sourceExists:!!source,
      eError:source?Math.abs(source.e[node]-sample.e):Infinity,
      iError:source?Math.abs(source.i[node]-sample.i):Infinity};
  },id);
  assert.ok(chartProvenance.sourceExists,'chart samples must have a real matching Worker timestamp');
  assert.equal(chartProvenance.eError,0,'plotted E must equal underlying solver E for same t_ms');
  assert.equal(chartProvenance.iError,0,'plotted I must equal underlying solver I for same t_ms');
  await page.waitForFunction(node=>
    window.__brainSim.getPeakE()?.[node]>0.05,
    id,{timeout:30000});
  const actualPeak=await sim(node=>window.__brainSim.getPeakE()[node],id);
  assert.ok(actualPeak>0.05,`explicit stimulus must change E from solver: ${actualPeak}`);
  const baseline=await sim(()=>window.__brainSim.getBaseline());
  assert.equal(baseline.node,id,'response baseline must refer to same selected brain region');
  const groups=await sim(()=>window.__brainSim.getResponseGroups());
  assert.equal(groups.input,id,'response markers must refer to the touched region');

  // E readout and network response share the physical snapshot.
  await sim(()=>window.__brainSim.pause());
  await page.waitForTimeout(280);
  const eRead=await page.getByTestId('network-state').getAttribute('data-e');
  const eModel=await sim(node=>window.__brainSim.getSnapshot()?.e?.[node],id);
  assert.ok(Math.abs(Number(eRead)-eModel)<0.006,
    `selected E in network state differs from neural model E: ${eRead} vs ${eModel}`);

  // ΔE colouring is fixed on (App passes colorMode="delta"): the view must
  // report delta mode with a real baseline, and E must be unchanged by it.
  await page.waitForFunction(()=>window.__brainScene.getColorDebug()?.hasBaseline===true,
    null,{timeout:15000});
  const view=await sim(()=>window.__brainScene.getColorDebug());
  assert.equal(view.colorMode,'delta');
  assert.equal(view.hasBaseline,true);
  const eAfter=await sim(node=>window.__brainSim.getSnapshot().e[node],id);
  assert.equal(eAfter,eModel,'changing E/ΔE visualization must not modify model E');
  assert.equal(await page.locator('.chart-wrap').getAttribute('data-selected-region-id'),String(id));

  await mkdir('../tests/p0-1/shots',{recursive:true});
  await page.screenshot({path:'../tests/p0-1/shots/3d-pointer-crossview.png',fullPage:true});
  assert.deepEqual(errors,[],'page errors during actual gestures');
  console.log('P0-1B PASS: orbit/right-click/cancel inert; click selects without pulsing; explicit stimulus -> E+response+chart; fixed delta colouring');
} finally {
  await browser?.close();
  await server.httpServer.close();
}
