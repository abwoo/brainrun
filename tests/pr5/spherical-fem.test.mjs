import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FEM_MODEL_ID,SPHERE_MODEL_ID,validateSphereFixture,moveSphereElectrodes,sphereElectrodePotentials,sphereAssetFile} from '../../app/src/lib/sphereForward.ts';
import {getPhysicalSource,setPhysicalSource,registerPhysicalFixture,preparePhysicalAnalysis,fixtureForPhysicalRecording} from '../../app/src/lib/physicalExperiment.ts';
import {capturePhysicalProjection} from '../../app/src/lib/physicalProjection.ts';
import {runNativeExperiment} from '../../app/src/lib/nativeEeg.ts';
import {reReferenceRecording} from '../../app/src/lib/eegRecording.ts';
import {physicalFeedbackMapping} from '../../app/src/lib/physicalFeedback.ts';
const fixture=JSON.parse(readFileSync('app/public/forward-assets/fem-model.json','utf8'));
test('real FEM metadata, geometry, conductivity and source bounds survive validation',()=>{
 validateSphereFixture(fixture);
 assert.equal(fixture.model_id,FEM_MODEL_ID);
 assert.equal(fixture.fem.surface_vertices,2562);
 assert.equal(fixture.fem.nodes,30745);
 assert.equal(fixture.fem.tetrahedra,174080);
 assert.equal(sphereAssetFile(FEM_MODEL_ID),'fem-model.json');
 assert.equal(sphereAssetFile(FEM_MODEL_ID+'-skull-0.008'),'fem-skull-0.008.json');
 assert.throws(()=>sphereAssetFile('invented-fem'));
 assert.throws(()=>validateSphereFixture({...fixture,model_id:SPHERE_MODEL_ID}));
 assert.throws(()=>validateSphereFixture({...fixture,fem:undefined}));
 assert.throws(()=>validateSphereFixture({...fixture,fem:{...fixture.fem,relative_residual:1}}));
 assert.throws(()=>sphereElectrodePotentials(fixture,[17,0,0],[1,0,0]));
 const values=[.002,.004,.008].map(sigma=>{
  const id=FEM_MODEL_ID+(sigma===.004?'':'-skull-'+sigma.toFixed(3));
  const f=JSON.parse(readFileSync('app/public/forward-assets/'+sphereAssetFile(id),'utf8'));
  validateSphereFixture(f);
  assert.equal(f.conductivities_S_m[2],sigma);
  return sphereElectrodePotentials(f,[16,0,16],[10,0,0]).voltageUv;
 });
 assert.ok(values[0].some((v,i)=>Math.abs(v-values[2][i])>1e-4));
});
test('FEM source, moved sensor, shared Raw, frozen native projection and controller use the same operator',()=>{
 const moved=moveSphereElectrodes(fixture,{Cz:100});
 setPhysicalSource({...getPhysicalSource(),modelId:FEM_MODEL_ID,position:[16,0,16],direction:[1,0,0],axis:'X',
  moment:10,montage:'10-20',selectedLabels:undefined,electrode:'Cz',reference:{mode:'average'},
  electrodeVertices:{Cz:100},waveform:'pulse',timeMs:600,secondary:undefined});
 registerPhysicalFixture(moved);
 const raw=preparePhysicalAnalysis(500),expected=sphereElectrodePotentials(moved,[16,0,16],[10,0,0]);
 const i=raw.channels.findIndex(c=>c.label==='Cz');
 assert.equal(raw.dataUv[i][300],expected.voltageUv[i]);
 assert.equal(raw.experiment.parameters.forwardNumerics.mesh_sha256,fixture.fem.mesh_sha256);
 const processed=reReferenceRecording(raw,{mode:'electrode',label:'Cz'});
 assert.ok(processed.dataUv[i].every(v=>v===0));
 assert.equal(fixtureForPhysicalRecording(processed),moved);
 const p=capturePhysicalProjection(),m=physicalFeedbackMapping(null);
 assert.equal(p.modelId,FEM_MODEL_ID);
 assert.equal(p.forwardNumerics.datum,'surface-area-mean-zero');
 assert.deepEqual(p.channels[i].positionMm,fixture.scalp_field_grid.positions_mm[100]);
 const infinity=sphereElectrodePotentials(moved,[16,0,16],[1,0,0],'10-20',{mode:'infinity'});
 assert.deepEqual(p.infinityGainUvPerNAm,infinity.voltageUv);
 const mean=p.infinityGainUvPerNAm.reduce((a,b)=>a+b,0)/p.channels.length;
 assert.ok(Math.abs(m.gainUvPerNAm-(p.infinityGainUvPerNAm[i]-mean))<1e-12);
 assert.deepEqual(m.forwardNumerics,p.forwardNumerics);
 const samples=Array.from({length:1001},(_,j)=>({t_ms:j,e:[.1+.01*Math.sin(j/50)],i:[.05]}));
 const native=runNativeExperiment({projection:p,samples,node:0,baselineE:.1,baselineI:.05,sfreqHz:500,noise:null,seed:0}).recording;
 for(const t of [0,20,100]){
  const q=native.sourceSeries.sources[0].momentsNAm[t];
  assert.ok(Math.abs(native.dataUv[i][t]-q*m.gainUvPerNAm)<1e-12);
 }
 registerPhysicalFixture({...moved,model_id:SPHERE_MODEL_ID});
 assert.equal(fixtureForPhysicalRecording(native),moved,'retained recording cannot inherit a later conductor');
});
