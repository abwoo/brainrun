/**
 * P0-2 actual Worker/wasm acceptance clock and session lineage in Chromium.
 * Uses the same production bundle and TVB demo assets as the existing PR5 E2E.
 */
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { preview } from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});
let browser;
try {
 const url=server.resolvedUrls?.local?.[0];assert.ok(url);
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage({viewport:{width:1600,height:900}});
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>window.__brainSim?.isReady?.()===true,null,{timeout:60000});
 const get=()=>page.evaluate(()=>window.__brainSim.getExperimentSession());
 const first=await get();
 assert.equal(first.provenance.origin,'live-wasm');
 assert.equal(first.provenance.registration,'unregistered');
 assert.ok(first.provenance.runId);
 const pre=await page.evaluate(()=>window.__brainSim.getSnapshot().t_ms);
 await page.evaluate(()=>window.__brainSim.pulse(40,1.2,90));
 await page.waitForFunction(()=>window.__brainSim.getExperimentSession().commands
   .some(c=>c.command==='stimulus'),null,{timeout:15000});
 const after=await get();
 const pulse=after.commands.find(c=>c.command==='stimulus');
 assert.ok(pulse,'actual Worker acknowledgement');
 assert.equal(pulse.runId,first.provenance.runId);
 assert.equal(pulse.status,'accepted','pulse is queued, not falsely called computed EEG');
 assert.equal(pulse.inputs.node,40);
 assert.equal(pulse.inputs.duration_ms,90);
 assert.equal(pulse.inputs.amplitude,1.2);
 assert.ok(pulse.tMs>=pre,'accepted time must not precede last Worker snapshot');
 await page.waitForFunction(()=>window.__brainSim.getMarkers()
   .some(m=>m.kind==='pulse'&&m.node===40&&m.t_ms===
     window.__brainSim.getExperimentSession().commands.find(c=>c.command==='stimulus')?.tMs),
   null,{timeout:15000});
 await page.evaluate(()=>window.__brainSim.pause());
 await page.waitForFunction(()=>window.__brainSim.getExperimentSession().commands
   .some(c=>c.command==='pause'&&c.status==='applied'),null,{timeout:15000});
 await page.evaluate(()=>window.__brainSim.setBias(40,.3));
 await page.waitForFunction(()=>window.__brainSim.getExperimentSession().commands
   .some(c=>c.command==='set_bias'&&c.inputs.value===.3),null,{timeout:15000});
 const commands=(await get()).commands;
 assert.ok(commands.some(c=>c.command==='set_bias'&&c.status==='applied'&&c.inputs.node===40));
 // Reset is a new timeline, not a continuation of the old run at t=0.
 await page.evaluate(()=>window.__brainSim.resetPaused());
 await page.waitForFunction(old=>{
  const x=window.__brainSim.getExperimentSession();
  return x.provenance.runId!==old && x.commands.some(c=>c.command==='reset_paused');
 },first.provenance.runId,{timeout:15000});
 const next=await get();
 assert.equal(next.provenance.parentRunId,first.provenance.runId);
 assert.equal(next.provenance.origin,'live-wasm');
 assert.ok(next.commands.every(c=>c.runId===next.provenance.runId));
 assert.equal(next.commands.some(c=>c.command==='stimulus'),false);
 await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms===0,
   null,{timeout:10000});
 await page.evaluate(()=>window.__brainSim.advanceMs(12));
 await page.waitForFunction(()=>window.__brainSim.getExperimentSession().commands
   .some(c=>c.command==='advance_ms'&&c.status==='applied'),null,{timeout:15000});
 const result=await get();
 assert.equal(result.lastModelTimeMs,12);
 assert.deepEqual(result.snapshotTimesMs.filter(t=>t>12),[]);
 assert.ok(result.commands.every(c=>c.runId===result.provenance.runId));
 await page.getByRole('button',{name:/^更多/}).click();
 await page.waitForFunction(id=>document.querySelector('[data-live-run-id]')?.getAttribute('data-live-run-id')===id,
   result.provenance.runId,{timeout:15000});
 assert.deepEqual(errors,[]);
 console.log('P0-2 LIVE runId + accepted/applied Worker time and reset isolation PASS');
} finally {
 await browser?.close();
 await server.httpServer.close();
}
