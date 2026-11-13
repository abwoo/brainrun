import {DEFAULT_MORPHOLOGY} from '../../app/src/lib/localCorticalColumn.ts';
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
