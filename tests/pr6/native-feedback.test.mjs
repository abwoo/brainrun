import {DEFAULT_MORPHOLOGY} from '../../app/src/lib/localCorticalColumn.ts';
import {erspItc} from '../../app/src/lib/signalProcessing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeFeedback,validateFeedbackConfig,cooldownRemainingMs} from '../../app/src/lib/nativeFeedback.ts';
import {analysisBandwidthHz,supportedAnalysisFrequencies} from '../../app/src/lib/scientificValidity.ts';
const config={node:0,feature:'instant',threshold:.1,amplitude:.2,durationMs:100,periodMs:250,windowMs:1000,cooldownMs:2000,delayMs:0,maxTriggers:2};
test('native feedback decisions, delay and cooldown use model ms',()=>{
 const c=new NativeFeedback(config,1,0),decisions=[],applied=[];
 for(let t=0;t<2500;t++){
  applied.push(...c.beforeStep(t));const d=c.afterStep(t+1,new Float64Array([.2]));if(d)decisions.push(d);
 }
 assert.deepEqual(decisions.map(x=>x.detectedMs),[250,2250]);
 assert.deepEqual(applied.map(x=>x.applyMs),[251,2251]);
 assert.equal(c.active,false);
 assert.throws(()=>validateFeedbackConfig({...config,amplitude:3},1),/Invalid/);
});
test('RMS requires a complete native window; snapshot preserves a pending delayed action',()=>{
 const c=new NativeFeedback({...config,feature:'rms',delayMs:17},1,0);
 for(let t=1;t<1000;t++)assert.equal(c.afterStep(t,new Float64Array([.2])),null);
 const event=c.afterStep(1000,new Float64Array([.2]));assert.ok(Math.abs(event.featureValue-.2)<1e-12);
 const restored=NativeFeedback.restore(c.snapshot(),1);
 assert.deepEqual(c.beforeStep(1017),[]);assert.deepEqual(restored.beforeStep(1017),[]);
 assert.deepEqual(c.beforeStep(1018),restored.beforeStep(1018));
 assert.equal(event.applyMs,1018);
});
test('Phase 3 — 冷却抑制可见：冷却期内触发记 suppressedCount/lastSuppressedMs/lastSuppressedValue，不静默',()=>{
 const c=new NativeFeedback({...config,periodMs:250,cooldownMs:2000,maxTriggers:10},1,0);
 assert.equal(cooldownRemainingMs(c.snapshot(),0),0);
 const decisions=[];
 for(let t=0;t<2500;t++){
  c.beforeStep(t);const d=c.afterStep(t+1,new Float64Array([.2]));if(d)decisions.push(d);
 }
 assert.deepEqual(decisions.map(x=>x.detectedMs),[250,2250]);
 const s=c.snapshot();
 // 评估点 500/750/1000/1250/1500/1750/2000 都在冷却期内（距上次触发 < 2000 ms），
 // 第二次触发（2250）之后 2500 的评估也在冷却期内。
 assert.equal(s.suppressedCount,8);
 assert.equal(s.lastSuppressedMs,2500);
 assert.equal(s.lastSuppressedValue,.2);
 // 冷却剩余（以最终快照的 lastTriggerMs=2250 计）：2300 时剩余 2250+2000−2300=1950；
 // 3000 时剩余 1250；5000 时已冷完。
 assert.equal(cooldownRemainingMs(c.snapshot(),2300),1950);
 assert.equal(cooldownRemainingMs(c.snapshot(),3000),1250);
 assert.equal(cooldownRemainingMs(c.snapshot(),5000),0);
 // 快照往返保留抑制记录。
 assert.equal(NativeFeedback.restore(s,1).snapshot().suppressedCount,8);
});
test('Phase 3 — restore 校验新字段：抑制记录不一致、pending id 重复、已施加 id 重回 pending 都拒绝；旧快照仍能恢复',()=>{
 const c=new NativeFeedback({...config,periodMs:1,cooldownMs:2000,delayMs:17,maxTriggers:10},1,0);
 const first=c.afterStep(1,new Float64Array([.2]));
 assert.equal(first.applyMs,19);
 // 之后每 1 ms 评估一次，2–600 ms 的评估全在冷却期内（距触发 1 ms 不到 2000 ms），
 // 共 599 次抑制；这里不调 beforeStep，让 pending 动作一直留在快照里。
 for(let t=1;t<600;t++){c.afterStep(t+1,new Float64Array([.2]));}
 const snap=c.snapshot();
 assert.equal(snap.suppressedCount,599);
 assert.equal(snap.lastSuppressedMs,600);
 assert.equal(NativeFeedback.restore(snap,1).snapshot().suppressedCount,599);
 // 抑制计数 0 但记了抑制时间/值：自相矛盾，拒绝。
 assert.throws(()=>NativeFeedback.restore({...snap,suppressedCount:0},1),/Invalid/);
 assert.throws(()=>NativeFeedback.restore({...snap,suppressedCount:2,lastSuppressedMs:null},1),/Invalid/);
 // pending 里同一个动作出现两次：拒绝。
 assert.throws(()=>NativeFeedback.restore({...snap,pending:[snap.pending[0],snap.pending[0]]},1),/Invalid/);
 // 先施加动作 id 1，再把同一 id 塞回 pending：已施加过的 id 不许重回，拒绝。
 const applied=c.beforeStep(19);
 assert.equal(applied.length,1);
 const afterApply=c.snapshot();
 assert.deepEqual(afterApply.appliedIds,[1]);
 assert.deepEqual(afterApply.pending,[]);
 assert.throws(()=>NativeFeedback.restore({...afterApply,pending:[applied[0]]},1),/Invalid/);
 // Phase 3 之前存的快照没有新字段：缺失时按“未抑制、未施加”补默认，不拒绝。
 const legacy={...snap};
 delete legacy.suppressedCount;delete legacy.lastSuppressedMs;delete legacy.lastSuppressedValue;delete legacy.appliedIds;
 const legacyRestored=NativeFeedback.restore(legacy,1);
 assert.equal(legacyRestored.snapshot().suppressedCount,0);
 assert.equal(legacyRestored.snapshot().lastSuppressedMs,null);
 assert.deepEqual(legacyRestored.snapshot().appliedIds,[]);
});
test('Phase 3 — restore 不双发：同一动作在一个实例里只施加一次，迟到的恢复也一样',()=>{
 const c=new NativeFeedback({...config,periodMs:1,cooldownMs:0,delayMs:17,maxTriggers:10},1,0);
 const d=c.afterStep(1,new Float64Array([.2]));
 assert.equal(d.id,1);assert.equal(d.applyMs,19);
 const snap=c.snapshot();
 const r1=NativeFeedback.restore(snap,1);
 assert.deepEqual(r1.beforeStep(18),[]);
 assert.equal(r1.beforeStep(19).length,1);
 assert.deepEqual(r1.beforeStep(20),[]);
 assert.deepEqual(r1.beforeStep(19),[]);
 // 原实例同样只发一次。
 assert.equal(c.beforeStep(19).length,1);
 assert.deepEqual(c.beforeStep(19),[]);
 // 快照恢复得晚、applyMs 已过去（调用方时钟 5000）：仍只发一次，不重发。
 const r2=NativeFeedback.restore(snap,1);
 assert.equal(r2.beforeStep(5000).length,1);
 assert.deepEqual(r2.beforeStep(5001),[]);
});
test('interpolated 250 Hz grid cannot authorize 40 Hz analysis',()=>{
 const data={sfreqHz:250,effectiveBandwidthHz:30,provenance:{effectiveSourceSnapshotHz:60}};
 assert.equal(analysisBandwidthHz(data),30);
 assert.deepEqual(supportedAnalysisFrequencies(data,[2,10,28,30,40]),[2,10,28]);
 assert.equal(analysisBandwidthHz({sfreqHz:500,acquisition:{filter:{cutoffHz:200}}}),200);
});

test('TFR backend refuses a frequency above source bandwidth despite a 250 Hz grid',()=>{
 const epochs={sfreqHz:250,effectiveBandwidthHz:30,channels:['Cz'],trials:[[[0,1,0,-1]]],timesMs:[-4,0,4,8]};
 assert.throws(()=>erspItc(epochs,'Cz',[40],'morlet',[-4,0]),/source bandwidth/);
});

test('physical EEG uses signed forward gain and causal filter; filter state restores exactly',()=>{
 const eeg={gainUvPerNAm:2,baselineE:.1,baselineI:.1,lowpassHz:40,morphology:{...DEFAULT_MORPHOLOGY},
  modelId:'test-sphere',electrode:'Cz',sourcePositionMm:[16,0,16],direction:[1,0,0],reference:{mode:'average'},electrodes:[],mapping:'assumed-primary-source'};
 const c=new NativeFeedback({...config,periodMs:1,threshold:0,eeg},1,0);
 const first=c.afterStep(1,new Float64Array([.11]),new Float64Array([.1]));
 const expected=.16*(1-Math.exp(-2*Math.PI*40/1000));
 assert.ok(Math.abs(first.featureValue-expected)<1e-12);assert.equal(first.featureUnit,'uV');
 const copy=NativeFeedback.restore(c.snapshot(),1);
 for(let t=2;t<=100;t++){
  assert.deepEqual(c.beforeStep(t),copy.beforeStep(t));
  assert.deepEqual(c.afterStep(t,new Float64Array([.12]),new Float64Array([.1])),copy.afterStep(t,new Float64Array([.12]),new Float64Array([.1])));
 }
 assert.deepEqual(c.snapshot(),copy.snapshot());
 assert.throws(()=>new NativeFeedback({...config,eeg:{...eeg,lowpassHz:0}},1,0),/mapping/);
});

test('shared EEG uses the exact causal feedback window, frozen geometry and authoritative event times',async()=>{
 const {recordingFromFeedback}=await import('../../app/src/lib/feedbackRecording.ts');
 const {reReferenceRecording}=await import('../../app/src/lib/eegRecording.ts');
 const state={config:{node:0,eeg:{montage:'10-20',modelId:'sphere-test',electrode:'Cz',lowpassHz:40,reference:{mode:'average'},
  electrodes:[{label:'Cz',positionMm:[0,0,95]}]}},startedMs:0,
  samples:[{tMs:11,value:-.2},{tMs:12,value:.3},{tMs:13,value:.8}]};
 const upstream={provenance:{runId:'upstream',seed:42},commands:[],artifacts:[],snapshotTimesMs:[],lastModelTimeMs:13};
 const message={type:'native_feedback',phase:'observed',run_id:'upstream',t_ms:13,state};
 const events=[{type:'native_feedback',run_id:'upstream',phase:'applied',t_ms:12,action:{amplitude:1}},
  {type:'native_feedback',run_id:'different-run',phase:'applied',t_ms:12,action:{amplitude:2}}];
 const {recording,events:rebased}=recordingFromFeedback(message,upstream,events);
 assert.deepEqual(recording.dataUv,[[-.2,.3,.8]]);assert.deepEqual(recording.timesMs,[0,1,2]);
 assert.equal(recording.sfreqHz,1000);assert.equal(recording.provenance.upstreamStartMs,11);
 assert.equal(recording.provenance.parentRunId,'upstream');assert.equal(recording.provenance.clock,'solver-integration-ms');
 assert.deepEqual(recording.channels,[{label:'Cz',positionMm:[0,0,95]}]);
 assert.equal(recording.experiment.parameters.processing.phase,'causal');assert.equal(recording.experiment.parameters.controllerState.startedMs,0);
 assert.equal(rebased.length,1);assert.equal(rebased[0].tMs,1);assert.equal(rebased[0].condition,'unclassified');
 state.samples[0].value=999;assert.equal(recording.dataUv[0][0],-.2,'export owns its data');
 assert.throws(()=>reReferenceRecording(recording,{mode:'infinity'}),/raw|infinity|无限远/i);
 assert.throws(()=>recordingFromFeedback({...message,t_ms:14},upstream,events),/current/);
 assert.throws(()=>recordingFromFeedback({...message,run_id:'old-run'},upstream,events),/current/);
});

test('shared head selection is explicit and unready BEM never falls back to a sphere',async()=>{
 const {getHeadModelSelection,setHeadModelSelection,subscribeHeadModelSelection}=await import('../../app/src/lib/headModelSelection.ts');
 const {physicalFeedbackMapping}=await import('../../app/src/lib/physicalFeedback.ts');
 let notifications=0;const unsubscribe=subscribeHeadModelSelection(()=>notifications++);
 try{
  assert.equal(getHeadModelSelection(),'sphere');
  setHeadModelSelection('bem');setHeadModelSelection('bem');
  assert.equal(getHeadModelSelection(),'bem');assert.equal(notifications,1);
  assert.throws(()=>physicalFeedbackMapping(null),/BEM is not ready/);
  assert.throws(()=>setHeadModelSelection('fake'),/Unknown/);
 }finally{setHeadModelSelection('sphere');unsubscribe();}
});
