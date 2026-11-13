import {erspItc} from '../../app/src/lib/signalProcessing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeFeedback,validateFeedbackConfig} from '../../app/src/lib/nativeFeedback.ts';
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
