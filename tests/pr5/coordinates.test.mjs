import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransform, inverseTransform, composeTransforms, validateTransform,
  MNE_HEAD_TO_SPHERE,
} from '../../app/src/lib/coordinates.ts';
const near=(a,b)=>a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-8,'xyz['+i+'] mismatch'));
test('explicit MNE head to sphere coordinates',()=>{
  near(applyTransform(MNE_HEAD_TO_SPHERE,[10,-20,40]),[10,-20,0]);
  near(applyTransform(inverseTransform(MNE_HEAD_TO_SPHERE),[10,-20,0]),[10,-20,40]);
});
test('inverting a general affine rotation/scale/translation is exact',()=>{
  const t={from:'head-ras-mm',to:'mri-ras-mm',
    matrix:[0,-2,0,20, 2,0,0,-10, 0,0,1.5,5, 0,0,0,1],
    method:'synthetic',provenance:'unit test',errorMm:0.2};
  const p=[12,-3,4],q=applyTransform(t,p),r=applyTransform(inverseTransform(t),q);
  near(p,r);
  const identity=composeTransforms(t,inverseTransform(t));
  near(applyTransform(identity,p),p);
  assert.ok(Math.abs(identity.errorMm-.4)<1e-8);
});
test('rejects guessed MNI or Talairach transforms without evidence',()=>{
  const t={...MNE_HEAD_TO_SPHERE,to:'mni152-mm',
    provenance:'',method:'',errorMm:null};
  assert.throws(()=>validateTransform(t),/Invalid/);
  assert.throws(()=>composeTransforms(MNE_HEAD_TO_SPHERE,
    {...MNE_HEAD_TO_SPHERE,to:'talairach-mm'}),/frames do not match/);
});
test('invalid matrices and singular transforms are rejected',()=>{
  const bad={...MNE_HEAD_TO_SPHERE,matrix:[0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,1]};
  assert.throws(()=>inverseTransform(bad),/singular/);
  assert.throws(()=>validateTransform({...bad,matrix:[1,0]}),/Invalid/);
  assert.throws(()=>applyTransform(MNE_HEAD_TO_SPHERE,[NaN,0,0]),/finite/);
});
