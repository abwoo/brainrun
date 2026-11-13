import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {moveSphereElectrodes,sphereElectrodePotentials,SPHERE_MODEL_ID} from '../../app/src/lib/sphereForward.ts';
import {registerPhysicalFixture,setPhysicalSource,preparePhysicalAnalysis,sourceWaveformAt} from '../../app/src/lib/physicalExperiment.ts';
import {getLiveRecordingStore} from '../../app/src/lib/eegRecording.ts';
import {recordingForwardAtTime} from '../../app/src/lib/topography.ts';
const fixture=JSON.parse(readFileSync('app/public/forward-assets/sphere-model.json','utf8'));
test('electrode move replaces geometry and gain; dual sources add and cancel in Raw and field',()=>{
 const moved=moveSphereElectrodes(fixture,{Cz:17});
 const c=moved.sensors.findIndex(s=>s.label==='Cz');
 assert.deepEqual(moved.sensors[c].position_mm,fixture.scalp_field_grid.positions_mm[17]);
 assert.deepEqual(moved.gain_uv_per_nAm[c],fixture.scalp_field_grid.gain_uv_per_nAm[17]);
 registerPhysicalFixture(moved);
 setPhysicalSource({modelId:SPHERE_MODEL_ID,electrodeVertices:{Cz:17},position:[16,0,16],axis:'X',moment:10,
  waveform:'constant',timeMs:0,montage:'10-20',reference:{mode:'average'},secondary:undefined});
 const a=preparePhysicalAnalysis();
 setPhysicalSource({secondary:{position:[16,0,16],direction:[1,0,0],moment:10}});
 const doubled=preparePhysicalAnalysis();
 doubled.dataUv.forEach((row,i)=>assert.ok(Math.abs(row[0]-2*a.dataUv[i][0])<1e-12));
 setPhysicalSource({secondary:{position:[16,0,16],direction:[1,0,0],moment:-10}});
 const zero=preparePhysicalAnalysis();assert.ok(zero.dataUv.every(row=>Math.abs(row[0])<1e-12));
 const dense=recordingForwardAtTime(moved,zero,0);assert.ok(dense.valueUv.every(v=>Math.abs(v)<1e-12));
 assert.throws(()=>moveSphereElectrodes(fixture,{Cz:-1}),/vertex/);
});
test('defined input q(t), source histories, event clock and observation are deterministic',()=>{
 setPhysicalSource({secondary:undefined,waveform:'pulse',timeMs:600});
 const rec=preparePhysicalAnalysis(500),j=rec.timesMs.indexOf(600),field=recordingForwardAtTime(moveSphereElectrodes(fixture,{Cz:17}),rec,600);
 assert.equal(sourceWaveformAt('pulse',400),0);assert.equal(sourceWaveformAt('pulse',600),1);
 assert.ok(rec.dataUv.some(row=>Math.abs(row[j])>1e-6));assert.ok(rec.dataUv.every(row=>row[0]===0));
 rec.channels.forEach((c,i)=>assert.ok(Math.abs(rec.dataUv[i][j]-field.valueUv[field.labels.indexOf(c.label)])<1e-12));
 assert.equal(getLiveRecordingStore().events[0].tMs,500);assert.equal(getLiveRecordingStore().events[0].driveUnit,'nA_m');
 assert.equal(getLiveRecordingStore().workspace.atTimeMs,600);
 const before=JSON.stringify(rec.dataUv);setPhysicalSource({timeMs:900});assert.equal(JSON.stringify(preparePhysicalAnalysis(500).dataUv),before);
});
test('conductivity changes computed coefficients without moving sources or sensors',()=>{
 const a=JSON.parse(readFileSync('app/public/forward-assets/sphere-skull-0.002.json','utf8'));
 const b=JSON.parse(readFileSync('app/public/forward-assets/sphere-skull-0.008.json','utf8'));
 const av=sphereElectrodePotentials(a,[16,16,16],[0,0,10]).voltageUv;
 const bv=sphereElectrodePotentials(b,[16,16,16],[0,0,10]).voltageUv;
 assert.ok(av.some((v,i)=>Math.abs(v-bv[i])>1e-3));
 assert.deepEqual(a.sensors,b.sensors);assert.notEqual(a.model_id,b.model_id);
});
