import test from 'node:test';
import assert from 'node:assert/strict';
import {configurationForRecording,configurationsEqual} from '../../app/src/lib/eegConfiguration.ts';
import {reReferenceRecording,recordingToJson,recordingToCsv,setLiveRecordingStore} from '../../app/src/lib/eegRecording.ts';
import {ExperimentSession} from '../../app/src/lib/experimentSession.ts';
function recording(){
 const session=new ExperimentSession({origin:'independent',solverId:'test-wc',anatomyId:'sphere',registration:'unregistered',seed:17});
 return {version:1,sfreqHz:250,timesMs:[0,4],channels:[{label:'Cz',positionMm:[0,0,95]},{label:'Pz',positionMm:[0,-60,70]}],
 dataUv:[[1,2],[-1,-2]],rawDataUvInfinity:[[3,6],[1,2]],reference:{mode:'average'},montage:'10-10',
 forwardModelId:'sphere',sourceModelId:'local-wc',seed:17,noise:{whiteRmsUv:1,pinkRmsUv:0,line50HzRmsUv:0,driftRmsUv:0},
 provenance:session.provenance,experiment:{session:session.getSnapshot(),parameters:{sourceModel:'jr',reference:{mode:'average'}}}};
}
test('configuration restores actual acquisition fields; draft edits leave Raw untouched',()=>{
 const r=recording(),c=configurationForRecording(r);
 assert.equal(c.montage,'10-10');assert.equal(c.seed,17);assert.equal(c.sourceModel,'jr');assert.equal(c.noise.whiteRmsUv,1);
 const before=JSON.stringify(r),draft={...c,montage:'10-05'};
 assert.equal(configurationsEqual(c,draft),false);assert.equal(JSON.stringify(r),before);
});
test('reference values, exported metadata and processing lineage agree without changing acquisition identity',()=>{
 const r=recording(),original=JSON.stringify(r),a=reReferenceRecording(r,{mode:'electrode',label:'Cz'});
 assert.deepEqual(a.dataUv,[[0,0],[-2,-4]]);
 assert.equal(a.provenance.runId,r.provenance.runId);assert.equal(a.dataRevision,1);
 assert.deepEqual(a.experiment.parameters.reference,a.reference);
 const b=reReferenceRecording(a,{mode:'infinity'});
 assert.deepEqual(b.dataUv,r.rawDataUvInfinity);assert.equal(b.dataRevision,2);
 assert.equal(b.processingHistory[1].parentRevision,1);
 assert.equal(b.processingHistory[1].inputData,'raw-infinity');
 const json=JSON.parse(recordingToJson(b));
 assert.equal(json.experiment.parameters.dataRevision,2);assert.equal(json.processingHistory.length,2);
 assert.ok(recordingToCsv(b).includes('# data_revision=2'));
 assert.equal(JSON.stringify(r),original);
});
test('stale epochs cannot be exported under a newer Raw processing revision',()=>{
 const a=reReferenceRecording(recording(),{mode:'infinity'});
 const epochs={provenance:a.provenance,events:[],dataRevision:0};
 assert.throws(()=>setLiveRecordingStore({recording:a,events:[],epochs}),/Stale epochs/);
 setLiveRecordingStore({recording:a,events:[],epochs:null});
 assert.equal(JSON.parse(recordingToJson(a)).epochs,null);setLiveRecordingStore(null);
});
