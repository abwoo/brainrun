import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {preview} from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByRole('tab',{name:'Regions & activity',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim?.isReady()&&window.__brainSim.getSnapshot());
 const run=async node=>{
  await page.getByRole('combobox',{name:'Choose brain region',exact:true}).selectOption(String(node));
  await page.evaluate(()=>{const s=window.__brainSim;s.setSeed(7);s.setBackgroundMode('quiet');s.resetPaused();});
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms===0);
  await page.evaluate(()=>window.__brainSim.advanceMs(500));
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms===500);
  await page.evaluate(node=>{const s=window.__brainSim;for(let j=0;j<8;j++)s.pulseAt(node,2,500);s.advanceMs(3500);},node);
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms===4000);
  const before=await page.evaluate(node=>{const s=window.__brainSim;return {t:s.getSnapshot().t_ms,e:s.getSnapshot().e[node],i:s.getSnapshot().i[node],
   inputs:s.getSnapshot().active_input_count,queued:s.getSnapshot().queued_input_count,
   saved:s.getExperimentBundle().snapshots.find(x=>x.id==='pulse-baseline'),run:s.getSnapshot().run_id,
   native:s.getNativeHistory().slice(-100).map(x=>({e:x.e[node],i:x.i[node]}))};},node);
  assert.ok(before.saved);assert.equal(before.saved.t_ms,500,'overlapping pulses preserve the original recovery point');
  assert.equal(before.inputs,0,'finite input must end');assert.equal(before.queued,0);
  await page.evaluate(()=>window.__brainSim.advanceMs(1000));
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms===5000);
  assert.equal(await page.getByTestId('network-state').getAttribute('data-active-inputs'),'0');
  assert.equal(await page.locator('.chart-wrap').getAttribute('data-y-max'),'1');
  console.log('Repeated-input measured case '+JSON.stringify({node,t:before.t,e:before.e,i:before.i,nativeTail:before.native.slice(-3)}));
  const checkpoint=JSON.parse(before.saved.json);
  await page.getByRole('button',{name:'Restore before input',exact:true}).click();
  await page.waitForFunction(old=>window.__brainSim.getSnapshot()?.run_id!==old&&window.__brainSim.getSnapshot()?.t_ms===500,before.run);
  const recovered=await page.evaluate(()=>{const s=window.__brainSim.getSnapshot();return {e:Array.from(s.e),i:Array.from(s.i),active:s.active_input_count};});
  assert.deepEqual(recovered.e,checkpoint.e);assert.deepEqual(recovered.i,checkpoint.i);assert.equal(recovered.active,0);
  await page.evaluate(()=>window.__brainSim.resume());
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms>=600&&!window.__brainSim.getSnapshot()?.paused);
  await page.waitForFunction(()=>window.__brainActivity.getBufferedSamples().length>2);
  const chart=await page.evaluate(()=>window.__brainActivity.getBufferedSamples());
  assert.ok(chart.every(x=>x.t_ms<4000),'rewinding must clear old-run chart samples');
  await page.getByRole('button',{name:'Use gentle input settings',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Input strength',exact:true}).inputValue(),'0.5');
  assert.equal(await page.getByRole('spinbutton',{name:'Duration ms',exact:true}).inputValue(),'20');
  await page.getByRole('button',{name:'Apply one input',exact:true}).click();
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.active_input_count===0&&window.__brainSim.getMarkers().length>0);
  const t=await page.evaluate(()=>window.__brainSim.getSnapshot().t_ms);
  await page.waitForFunction(t=>window.__brainSim.getSnapshot()?.t_ms>t+100,t);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.paused);
  await page.waitForFunction(()=>document.querySelector('[data-testid="network-state"]')?.dataset.state==='paused');
  return {node,recovered:true};
 };
 await run(0);await run(40);await run(69);
 assert.deepEqual(errors,[]);
 console.log('Repeated strong pulses: native clock continues, inputs expire, exact pre-input recovery, same-run chart reset, gentle UI controls and pause status PASS');
}finally{await browser?.close();await server.httpServer.close();}
