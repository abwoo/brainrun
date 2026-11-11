import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateFsaverageBEM, findNearestValidatedSource,
  templateSourcePotentials, FSAVERAGE_BEM_MODEL_ID,
} from '../../app/src/lib/fsaverageBEM.ts';

const mesh={
  vertices_head_mm: [[0,0,0],[1,0,0],[0,1,0],[0,0,1]],
  triangles: [[0,1,2],[0,1,3],[1,2,3],[0,2,3]],
};
const fixture={
  model_id:FSAVERAGE_BEM_MODEL_ID,
  subject:'fsaverage',
  subject_type:'human-averaged-anatomical-template-not-individual',
  montage:'10-20',
  frame:'HEAD_RAS_MM',gain_unit:'uV_per_nA_m',source_moment_unit:'nA_m',
  interpolation:'none; only precomputed source vertices are physically validated',
  license_status:'REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET',
  transform_mri_to_head_rowmajor:[[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]],
  source_positions:[
    {hemisphere:'lh',vertex:10,head_mm:[-30,0,0],atlas:'aparc',region:'lh.precentral'},
    {hemisphere:'rh',vertex:11,head_mm:[30,0,0],atlas:'aparc',region:'rh.precentral'},
  ],
  electrodes:[
    {label:'Cz',head_mm:[0,0,100]},
    {label:'Pz',head_mm:[0,-50,90]},
    {label:'Fz',head_mm:[0,50,90]},
  ],
  gains_uV_per_nAm:[
    [1,2,3,4,5,6],[-1,0,2,3,0,-2],[0,1,2,3,4,5],
  ],
  meshes:{brain:mesh,skull:mesh,scalp:mesh,cortex:{lh:mesh,rh:mesh}},
};
const near=(a,b,eps=1e-10)=>assert.ok(Math.abs(a-b)<eps, a+' vs '+b);

test('validated MRI-BEM fixture enforces correct physical units and version',()=>{
  validateFsaverageBEM(fixture);
  assert.throws(()=>validateFsaverageBEM({...fixture,gain_unit:'V'}),/metadata/);
  assert.throws(()=>validateFsaverageBEM({...fixture,frame:'MNI'}),/metadata/);
  assert.throws(()=>validateFsaverageBEM({...fixture,license_status:'APPROVED'}),/metadata/);
  assert.throws(()=>validateFsaverageBEM({...fixture,interpolation:'linear'}),/metadata/);
});
test('finite 3-vector dipole matrix multiplication has expected µV values',()=>{
  const x=templateSourcePotentials(fixture,0,[10,0,0],{mode:'infinity'});
  assert.deepEqual(x,[10,-10,0]);
  const y=templateSourcePotentials(fixture,1,[0,2,0],{mode:'infinity'});
  assert.deepEqual(y,[10,0,8]);
});
test('source moment scaling / polarity and linear superposition',()=>{
  const pos=templateSourcePotentials(fixture,1,[1,2,3],{mode:'infinity'});
  const neg=templateSourcePotentials(fixture,1,[-1,-2,-3],{mode:'infinity'});
  pos.forEach((v,i)=>near(v,-neg[i]));
  const a=templateSourcePotentials(fixture,1,[1,0,0],{mode:'infinity'});
  const b=templateSourcePotentials(fixture,1,[0,2,3],{mode:'infinity'});
  pos.forEach((v,i)=>near(v,a[i]+b[i]));
});
test('sensor-average reference produces a strictly zero-mean potential',()=>{
  const vals=templateSourcePotentials(fixture,1,[8,2,-2]);
  near(vals.reduce((a,b)=>a+b,0),0);
  const r=templateSourcePotentials(fixture,1,[8,2,-2],{mode:'electrode',label:'Cz'});
  near(r[0],0);
  assert.throws(()=>templateSourcePotentials(fixture,1,[1,0,0],
    {mode:'electrode',label:'Oz'}),/Unknown/);
});
test('snap to closest validated cortical position and preserve hemisphere',()=>{
  const left=findNearestValidatedSource(fixture,[-31,0,0]);
  assert.equal(left.index,0);
  near(left.distanceMm,1);
  const right=findNearestValidatedSource(fixture,[28,0,0]);
  assert.equal(right.index,1);
  near(right.distanceMm,2);
  assert.equal(findNearestValidatedSource(fixture,[28,0,0],'lh').index,0);
  assert.throws(()=>findNearestValidatedSource(fixture,[NaN,0,0]),/Invalid/);
});
test('invalid source/electrode indices and malformed triangles rejected',()=>{
  assert.throws(()=>templateSourcePotentials(fixture,99,[1,0,0]),/outside/);
  assert.throws(()=>templateSourcePotentials(fixture,0,[Infinity,0,0]),/Invalid/);
  assert.throws(()=>validateFsaverageBEM({
    ...fixture,gains_uV_per_nAm:[[1,2,3],...fixture.gains_uV_per_nAm.slice(1)],
  }),/lead-field/);
  assert.throws(()=>validateFsaverageBEM({
    ...fixture,electrodes:[fixture.electrodes[0],fixture.electrodes[0],fixture.electrodes[2]],
  }),/Duplicate/);
  assert.throws(()=>validateFsaverageBEM({
    ...fixture,meshes:{...fixture.meshes,scalp:{...mesh,triangles:[[0,1,22]]}},
  }),/triangle/);
});
