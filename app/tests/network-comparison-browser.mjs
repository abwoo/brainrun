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
 await page.waitForFunction(()=>window.__brainSim.getSnapshot()?.t_ms===0);

 await page.evaluate(()=>{const s=window.__brainSim;s.setBackgroundMode('spontaneous');s.setSeed(7);s.resetPaused();});
 await page.waitForFunction(()=>{const s=window.__brainSim;return s.getSnapshot()?.run_id===s.getExperimentSession().provenance.runId&&s.getSnapshot()?.t_ms===0;});
 await page.evaluate(()=>window.__brainSim.saveSnapshot());
 const manual=await page.evaluate(()=>window.__brainSim.getExperimentBundle().snapshots.find(x=>x.id==='manual').json);
 const equal=await page.evaluate(async()=>{
  const s=window.__brainSim;
  s.configureNativeFeedback({node:40,feature:'instant',threshold:0,amplitude:.2,durationMs:100,periodMs:250,windowMs:1000,cooldownMs:2000,delayMs:0,maxTriggers:2});
  const r=await s.compareNetworkBranches(40,s.getParams().g,1000);
  return {metrics:r.metrics,n:r.a.samples.length,a:r.a.run.provenance,b:r.b.run.provenance,origin:r.originRunId,
   actionsA:r.a.feedbackEvents.filter(x=>x.phase==='applied').map(x=>x.t_ms),
   actionsB:r.b.feedbackEvents.filter(x=>x.phase==='applied').map(x=>x.t_ms)};
 });
 assert.equal(equal.metrics.globalMaxDifference,0,'identical full state and G must reproduce stochastic trajectories exactly');
 assert.equal(equal.n,1001);assert.equal(equal.a.parentRunId,equal.origin);assert.equal(equal.b.parentRunId,equal.origin);
 assert.notEqual(equal.a.runId,equal.b.runId);assert.deepEqual(equal.actionsA,equal.actionsB);
 assert.ok(equal.actionsA.length>0);
 assert.equal(await page.evaluate(()=>window.__brainSim.getExperimentBundle().snapshots.find(x=>x.id==='manual').json),manual);
 const changed=await page.evaluate(async()=>{const r=await window.__brainSim.compareNetworkBranches(40,.2,1000);return r.metrics;});
 assert.ok(changed.globalMaxDifference>1e-6,'changing only G must change the actual full-network trajectory');
 await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByRole('button',{name:'Advanced labs',exact:true}).click();
 await page.getByRole('button',{name:/^Signal analysis/}).click();
 await page.getByRole('button',{name:'Run experiment',exact:true}).click();
 await page.getByTestId('eeg-summary').waitFor();
 const previousRun=await page.locator('[data-analysis-run-id]').getAttribute('data-analysis-run-id');
 await page.getByRole('button',{name:'More',exact:true}).click();
 await page.getByRole('button',{name:'Comparisons',exact:true}).click();
 await page.getByRole('button',{name:'Compare A/B from this state',exact:true}).click();
 await page.getByTestId('network-comparison-result').waitFor({timeout:30000});
 const ready=page.waitForEvent('download');
 await page.getByRole('button',{name:'Export complete comparison',exact:true}).click();
 const download=await ready,stream=await download.createReadStream();let text='';
 for await(const chunk of stream)text+=chunk.toString();
 const paired=JSON.parse(text);
 assert.equal(paired.a.samples.length,2001);assert.equal(paired.b.samples.length,2001);
 assert.equal(paired.a.run.provenance.parentRunId,paired.originRunId);assert.equal(paired.b.run.provenance.parentRunId,paired.originRunId);
 await page.getByRole('button',{name:'Analyze B EEG',exact:true}).click();
 await page.getByTestId('eeg-summary').waitFor();
 const rawEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Export JSON',exact:true}).click();
 const rawDownload=await rawEvent,rawStream=await rawDownload.createReadStream();let rawText='';
 for await(const chunk of rawStream)rawText+=chunk.toString();
 const rec=JSON.parse(rawText);
 assert.notEqual(rec.provenance.runId,previousRun,'an already mounted EEG view must load the chosen branch, not retain its previous Raw');
 assert.equal(rec.provenance.parentRunId,paired.b.run.provenance.runId);
 assert.equal(rec.experiment.parameters.comparisonBranch,'b');assert.equal(rec.acquisition.integrationRateHz,1000);
 assert.equal(rec.sourceSeries.sources[0].momentsNAm.length,rec.timesMs.length);
 assert.ok(rec.events.every(e=>e.runId===rec.provenance.runId));
 console.log('Matched full-network A/B: exact stochastic/control replay, G-only effect, shared origin lineage, manual-snapshot preservation and branch B -> native EEG/export PASS');
}finally{await browser?.close();await server.httpServer.close();}
