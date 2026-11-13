import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {capturePhysicalProjection,validatePhysicalProjection} from '../../app/src/lib/physicalProjection.ts';
import {setHeadModelSelection} from '../../app/src/lib/headModelSelection.ts';
import {registerPhysicalFixture,setPhysicalSource,fixtureForPhysicalRecording} from '../../app/src/lib/physicalExperiment.ts';
import {moveSphereElectrodes,sphereElectrodePotentials} from '../../app/src/lib/sphereForward.ts';
import {runNativeExperiment} from '../../app/src/lib/nativeEeg.ts';
import {reReferenceRecording} from '../../app/src/lib/eegRecording.ts';
import {recordingForwardAtTime} from '../../app/src/lib/topography.ts';
import {buildLeadField} from '../../app/src/lib/sourceLocalization.ts';
const model=JSON.parse(readFileSync('app/public/forward-assets/sphere-model.json','utf8'));
const other=JSON.parse(readFileSync('app/public/forward-assets/sphere-skull-0.008.json','utf8'));
const samples=Array.from({length:2001},(_,t)=>({t_ms:t,e:Float64Array.of(.1+.02*Math.sin(2*Math.PI*10*t/1000)),i:Float64Array.of(.1+.005*Math.sin(2*Math.PI*6*t/1000))}));
test('250/500 Hz native EEG uses the actual moved/subset sphere operator and retains its inverse/field after geometry changes',()=>{
 setHeadModelSelection('sphere');
 const moved=moveSphereElectrodes(model,{Cz:17}),labels=['Cz','F3','F4','C3','C4','Pz'],direction=[.6,.8,0];
 registerPhysicalFixture(moved);
 setPhysicalSource({modelId:model.model_id,position:[16,16,16],axis:'free',direction,montage:'10-20',reference:{mode:'average'},
  selectedLabels:labels,electrodeVertices:{Cz:17},secondary:undefined,moment:20});
 const p=capturePhysicalProjection();
 const unit=sphereElectrodePotentials(moved,[16,16,16],direction,'10-20',{mode:'infinity'},labels);
 assert.deepEqual(p.infinityGainUvPerNAm,unit.voltageUv);
 for(const sfreqHz of [250,500]){
  const {recording:rec,events}=runNativeExperiment({projection:p,samples,node:0,baselineE:.1,baselineI:.1,sfreqHz,
   reference:{mode:'infinity'},markers:[{kind:'pulse',node:0,t_ms:500,amplitude:1}],noise:null});
  assert.deepEqual(rec.channels.map(c=>c.label),labels);assert.equal(rec.physicalProjection.modelId,model.model_id);
  assert.equal(rec.sourceSeries.mapping,'assumed-physical-primary');assert.equal(rec.nativeSource.baselineE,.1);
  assert.equal(rec.reference.mode,'average','the captured physical reference wins over unrelated next-run settings');
  assert.equal(events[0].tMs,436);assert.equal(rec.acquisition.validStartMs,64);
  const q=rec.sourceSeries.sources[0].momentsNAm;
  rec.rawDataUvInfinity.forEach((row,c)=>row.forEach((v,j)=>assert.ok(Math.abs(v-unit.voltageUv[c]*q[j])<1e-12)));
  rec.timesMs.forEach((_,j)=>assert.ok(Math.abs(rec.dataUv.reduce((a,row)=>a+row[j],0))<1e-12));
  registerPhysicalFixture(other);setPhysicalSource({modelId:other.model_id,electrodeVertices:{},selectedLabels:undefined,position:[-16,-16,16]});
  const processed=reReferenceRecording({...rec},{mode:'electrode',label:'Cz'});
  assert.equal(fixtureForPhysicalRecording(processed),moved,'reference/provenance cloning keeps the original model context');
  const field=recordingForwardAtTime(fixtureForPhysicalRecording(processed),processed,400),j=processed.timesMs.indexOf(400);
  processed.channels.forEach((c,k)=>assert.ok(Math.abs(field.valueUv[field.labels.indexOf(c.label)]-processed.dataUv[k][j])<1e-12));
  const lf=buildLeadField(fixtureForPhysicalRecording(processed),processed.montage,processed.reference,labels);
  const index=lf.sourcePositionsMm.findIndex(p=>p.every((v,k)=>v===[16,16,16][k]));
  lf.gain.forEach((row,c)=>assert.ok(Math.abs((row[3*index]*direction[0]+row[3*index+1]*direction[1])*q[j]-processed.dataUv[c][j])<1e-12));
  assert.equal(processed.dataRevision,1);
 }
 assert.throws(()=>validatePhysicalProjection({...p,coordinateFrame:'HEAD_RAS_MM'}),/frame/);
 assert.throws(()=>validatePhysicalProjection({...p,channels:[p.channels[0],p.channels[0]],infinityGainUvPerNAm:[1,2]}),/channels/);
});
