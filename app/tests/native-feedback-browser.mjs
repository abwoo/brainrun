import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {preview} from 'vite';
const server=await preview({preview:{port:0,host:'127.0.0.1'},logLevel:'error'});
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl']});
 const page=await browser.newPage();
 await page.goto(server.resolvedUrls.local[0],{waitUntil:'domcontentloaded'});
 await page.getByRole('tab',{name:'脑区与传播',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim?.isReady()&&window.__brainSim.getSnapshot());
 await page.getByRole('combobox',{name:'选择脑区',exact:true}).selectOption('40');
 await page.evaluate(()=>{window.__brainSim.resetPaused();});
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===0));

 const config={node:40,feature:'instant',threshold:0,amplitude:.2,durationMs:100,periodMs:250,windowMs:1000,cooldownMs:2000,delayMs:0,maxTriggers:2};
 const run=async(hz)=>{
  await page.evaluate(({hz,config})=>{const s=window.__brainSim;s.setSnapshotHz(hz);s.setBackgroundMode('spontaneous');s.setSeed(7);s.resetPaused();s.configureNativeFeedback(config);s.advanceMs(2500);},{hz,config});
  await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===2500)&&window.__brainSim.getNativeFeedback()?.phase==='applied');
  return page.evaluate(()=>{const s=window.__brainSim;return {values:s.getNativeHistory().map(x=>x.e[40]),
    actions:s.getExperimentBundle().nativeFeedback.events.filter(x=>x.phase==='applied').map(x=>({t:x.t_ms,decision:x.action.detectedMs,feature:x.action.featureValue}))};});
 };
 const a=await run(10),b=await run(120);assert.deepEqual(a,b);
 assert.deepEqual(a.actions.map(x=>x.t),[251,2251]);
 await page.evaluate(config=>{const s=window.__brainSim;s.resetPaused();s.configureNativeFeedback(config);s.advanceMs(250);},config);
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===250)&&window.__brainSim.getNativeFeedback()?.phase==='detected');
 await page.evaluate(()=>window.__brainSim.saveSnapshot());
 const saved=await page.evaluate(()=>JSON.parse(window.__brainSim.getExperimentBundle().snapshots.find(x=>x.id==='manual').json));
 assert.equal(saved.brainrun_native_feedback.pending.length,1);
 await page.evaluate(()=>window.__brainSim.advanceMs(750));
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===1000));
 const trajectory=await page.evaluate(()=>window.__brainSim.getNativeHistory().filter(x=>x.t_ms>=250).map(x=>x.e[40]));
 await page.evaluate(()=>window.__brainSim.restoreSnapshot('manual'));
 await page.evaluate(()=>window.__brainSim.advanceMs(750));
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===1000));
 const replay=await page.evaluate(()=>window.__brainSim.getNativeHistory().filter(x=>x.t_ms>=250).map(x=>x.e[40]));
 assert.deepEqual(replay,trajectory,'saved controller state and pending input reproduce the native neural trajectory');
 const actions=await page.evaluate(()=>window.__brainSim.getExperimentBundle().nativeFeedback.events.filter(x=>x.phase==='applied'));
 assert.equal(actions[0].t_ms,251);


 await page.evaluate(config=>{const s=window.__brainSim;s.resetPaused();s.configureNativeFeedback(config);s.advanceMs(300);},config);
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===300));
 await page.evaluate(()=>window.__brainSim.saveSnapshot());
 const active=await page.evaluate(()=>JSON.parse(window.__brainSim.getExperimentBundle().snapshots.find(x=>x.id==='manual').json));
 assert.equal(active.brainrun_active_inputs.length,1,'snapshot must retain a currently applied pulse');
 await page.evaluate(()=>window.__brainSim.advanceMs(700));
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===1000));
 const during=await page.evaluate(()=>window.__brainSim.getNativeHistory().filter(x=>x.t_ms>=300).map(x=>x.e[40]));
 await page.evaluate(()=>window.__brainSim.restoreSnapshot('manual'));
 await page.evaluate(()=>window.__brainSim.advanceMs(700));
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===1000));
 assert.deepEqual(await page.evaluate(()=>window.__brainSim.getNativeHistory().filter(x=>x.t_ms>=300).map(x=>x.e[40])),during);
 await page.evaluate(()=>window.__brainSim.resetPaused());
 await page.waitForFunction(()=>(window.__brainSim.getSnapshot()?.run_id===window.__brainSim.getExperimentSession().provenance.runId&&window.__brainSim.getSnapshot()?.t_ms===0));
 await page.getByRole('button',{name:'高级实验',exact:true}).click();
 await page.getByRole('button',{name:/^对照与回放/}).click();
 await page.getByRole('textbox',{name:'直播闭环阈值',exact:true}).fill('0');
 await page.getByRole('button',{name:'启动直播闭环',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim.getNativeFeedback()?.phase==='configured');
 await page.evaluate(()=>window.__brainSim.advanceMs(300));
 await page.waitForFunction(()=>window.__brainSim.getNativeFeedback()?.phase==='applied');
 await page.getByRole('button',{name:'停止直播闭环',exact:true}).click();
 await page.waitForFunction(()=>window.__brainSim.getNativeFeedback()?.phase==='stopped');
 console.log('Actual Worker feedback: 1 ms acquisition, display-rate invariance, model-time action stamps and complete controller snapshot replay PASS');
}finally{await browser?.close();await server.httpServer.close();}
