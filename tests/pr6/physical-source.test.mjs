import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerPhysicalFixture,setPhysicalSource,getPhysicalSource,preparePhysicalAnalysis} from '../../app/src/lib/physicalExperiment.ts';
import {getLiveRecordingStore,reReferenceRecording,runExperiment} from '../../app/src/lib/eegRecording.ts';
import {sphereElectrodePotentials} from '../../app/src/lib/sphereForward.ts';
import {recordingForwardAtTime} from '../../app/src/lib/topography.ts';
const fixture=JSON.parse(readFileSync('app/public/forward-assets/sphere-model.json','utf8'));
registerPhysicalFixture(fixture);
test('manual position, direction and strength produce the same GUI potentials and exported constant time courses',()=>{
 setPhysicalSource({position:[30,0,16],axis:'Z',moment:20,montage:'10-20',reference:{mode:'average'}});
 const rec=preparePhysicalAnalysis();
 const expected=sphereElectrodePotentials(fixture,[30,0,16],[0,0,20],'10-20',{mode:'average'});
 assert.deepEqual(rec.dataUv.map(row=>row[0]),expected.voltageUv);
 assert.ok(rec.dataUv.every(row=>row.every(v=>v===row[0])),'static sources must not invent oscillations');
 assert.equal(rec.sourceSnapshot.revision,getPhysicalSource().revision);
 const before=getPhysicalSource().revision;
 setPhysicalSource({electrode:'Pz'});
 assert.equal(getPhysicalSource().revision,before,'observation selection is not a physical source change');
 assert.equal(getLiveRecordingStore().recording,rec);
 setPhysicalSource({moment:10});
 assert.equal(getLiveRecordingStore(),null,'changed physical source invalidates prior analysis');
});
test('dense forward samples use the SAME recording-channel reference, rather than the dense-grid average',()=>{
 const rec=preparePhysicalAnalysis(),field=recordingForwardAtTime(fixture,rec,400);
 rec.channels.forEach((channel,c)=>{
  assert.ok(Math.abs(field.valueUv[field.labels.indexOf(channel.label)]-rec.dataUv[c][100])<1e-12);
 });
 const electrode=reReferenceRecording(rec,{mode:'electrode',label:'Cz'});
 const f=recordingForwardAtTime(fixture,electrode,1000);
 assert.ok(Math.abs(f.valueUv[f.labels.indexOf('Cz')])<1e-12);
});
test('dynamic two-source history is projected at the requested sample, never an independently selected peak',()=>{
 const {recording:rec}=runExperiment({fixture,durationMs:2000,sourceModel:'both',noise:null});
 assert.equal(rec.sourceSeries.sources.length,2);
 for(const time of [400,1100,1600]){
  const field=recordingForwardAtTime(fixture,rec,time),j=rec.timesMs.indexOf(time);
  assert.equal(field.atTimeMs,time);
  rec.channels.forEach((channel,c)=>assert.ok(Math.abs(field.valueUv[field.labels.indexOf(channel.label)]-rec.dataUv[c][j])<1e-10));
 }
});
