import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ExperimentSession, makeDerivedSession }
  from '../../app/src/lib/experimentSession.ts';

function ids(...ids) {
  let i=0;
  return () => ids[i++] ?? 'run-overflow';
}
const base = {origin:'live-wasm',solverId:'rust-wc-76',
  anatomyId:'tvb-demo-76',registration:'unregistered',seed:0};
const make=(factory=ids('run-1','run-2','run-3'))=>
  new ExperimentSession(base,{idFactory:factory,nowIso:()=> '2026-11-12T00:00:00.000Z'});

test('run starts with explicit model, geometry, clock and uncoupled registration',()=>{
  const s=make().getSnapshot();
  assert.equal(s.provenance.runId,'run-1');
  assert.equal(s.provenance.origin,'live-wasm');
  assert.equal(s.provenance.clock,'worker-ms');
  assert.equal(s.provenance.registration,'unregistered');
  assert.equal(s.provenance.anatomyId,'tvb-demo-76');
  assert.equal(s.lastModelTimeMs,null);
  assert.deepEqual(s.commands,[]);
  assert.deepEqual(s.snapshotTimesMs,[]);
});
test('Worker model clock is monotonic within one run; stale snapshots ignored',()=>{
  const s=make();
  assert.equal(s.recordModelTime('run-1',0),true);
  assert.equal(s.recordModelTime('run-1',16),true);
  assert.equal(s.recordModelTime('run-0',9999),false);
  assert.deepEqual(s.getSnapshot().snapshotTimesMs,[0,16]);
  assert.throws(()=>s.recordModelTime('run-1',15),/Non-monotonic/);
  assert.throws(()=>s.recordModelTime('run-1',NaN),/Invalid model time/);
  assert.equal(s.getSnapshot().lastModelTimeMs,16);
});
test('only acknowledged command times enter the scientifically authoritative ledger',()=>{
  const s=make();
  assert.equal(s.recordAcknowledgement('old',{id:1,runId:'old',
    command:'stimulus',tMs:20,status:'accepted'}),false);
  assert.deepEqual(s.getSnapshot().commands,[]);
  const ack={id:5,runId:s.runId,command:'stimulus',tMs:27,status:'accepted',
    inputs:{node:40,amplitude:1.3,duration_ms:100}};
  assert.equal(s.recordAcknowledgement(s.runId,ack),true);
  const snap=s.getSnapshot();
  assert.deepEqual(snap.commands[0],ack);
  snap.commands[0].inputs.node=7;
  assert.equal(s.getSnapshot().commands[0].inputs.node,40,'defensive copy');
  assert.throws(()=>s.recordAcknowledgement(s.runId,ack),/Duplicate/);
  assert.throws(()=>s.recordAcknowledgement(s.runId,{...ack,id:0}),/Invalid accepted/);
});
test('reset/rewind yields new run lineage and rejects old Worker responses',()=>{
  const s=make();
  s.recordModelTime(s.runId,80);
  s.recordAcknowledgement(s.runId,{id:1,runId:s.runId,command:'pulse',
    tMs:80,status:'accepted'});
  const child=s.newRun({seed:5});
  assert.equal(child,'run-2');
  assert.equal(s.getSnapshot().provenance.parentRunId,'run-1');
  assert.equal(s.getSnapshot().provenance.seed,5);
  assert.equal(s.getSnapshot().lastModelTimeMs,null);
  assert.deepEqual(s.getSnapshot().commands,[]);
  assert.equal(s.recordModelTime('run-1',90),false);
  assert.equal(s.recordAcknowledgement('run-1',
    {id:2,runId:'run-1',command:'hold_start',tMs:99,status:'applied'}),false);
  s.recordModelTime(child,0);
  assert.deepEqual(s.getSnapshot().snapshotTimesMs,[0]);
});
test('independent EEG and live-derived EEG must have explicitly distinct provenance',()=>{
  const parent=make();
  const derived=makeDerivedSession(parent.provenance,'snapshot-interp-60hz-v1',{
    idFactory:ids('derived-1'),nowIso:()=> '2026-11-12T00:00:00.000Z',
  });
  assert.equal(derived.provenance.parentRunId,'run-1');
  assert.equal(derived.provenance.origin,'live-derived');
  assert.equal(derived.provenance.clock,'derived-from-worker-snapshots');
  assert.equal(derived.provenance.registration,'unregistered');
  assert.notEqual(derived.runId,parent.runId);
  const independent=new ExperimentSession({
    origin:'independent',solverId:'wc-local-column',
    anatomyId:'mne-spherical-template',registration:'unregistered',seed:13,
  },{idFactory:ids('local-column-1')});
  assert.equal(independent.provenance.parentRunId,null);
  assert.equal(independent.provenance.clock,'independent-model-ms');
});
test('artifacts need true run, source, method and model time',()=>{
  const s=make();
  const artifact={id:'raw1',runId:s.runId,kind:'eeg-raw',
    tMs:0,sourceId:'sphere-v1',methodId:'projectMoments'};
  assert.equal(s.recordArtifact(artifact),true);
  assert.equal(s.recordArtifact({...artifact,id:'raw2',runId:'other'}),false);
  assert.throws(()=>s.recordArtifact({...artifact,id:'bad',sourceId:''}),/source/);
  assert.throws(()=>s.recordArtifact(artifact),/Duplicate/);
  assert.deepEqual(s.getSnapshot().artifacts,[artifact]);
});
test('session observers receive events and cannot mutate internal provenance',()=>{
  const s=make();const states=[];
  const off=s.subscribe(state=>states.push(state));
  s.recordModelTime(s.runId,0);
  s.recordAcknowledgement(s.runId,{id:5,runId:s.runId,command:'pause',
    tMs:0,status:'applied'});
  off();s.recordModelTime(s.runId,10);
  assert.equal(states.length,2);
  states[0].snapshotTimesMs.push(999);
  assert.deepEqual(s.getSnapshot().snapshotTimesMs,[0,10]);
});
test('Worker API contains run IDs and acknowledges only after command processing',()=>{
  const protocol=readFileSync('app/src/worker/protocol.ts','utf8');
  const worker=readFileSync('app/src/worker/simWorker.ts','utf8');
  const client=readFileSync('app/src/lib/simClient.ts','utf8');
  assert.match(protocol,/type: 'command_ack'/);
  assert.match(protocol,/run_id\?: string/);
  assert.match(worker,/t_ms: sim\.time_ms\(\)/);
  assert.match(worker,/run_id: runId/);
  assert.match(worker,/acknowledge\(msg, 'accepted'\)/);
  assert.match(client,/msg\.run_id !== this\.experiment\.runId/);
  assert.match(client,/this\.experiment\.newRun/);
  assert.match(client,/getExperimentSession\(\)/);
});
