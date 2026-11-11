import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyTransform, inverseTransform, composeTransforms, validateTransform,
  parseCoordinateSpace,
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
test('PR6 R6: parseCoordinateSpace is the only string->space entry point',()=>{
  // The four remaining CoordinateSpace labels parse.
  for (const s of ['head-ras-mm','head-sphere-centered-mm','mri-ras-mm','tvb-demo-mm']) {
    assert.equal(parseCoordinateSpace(s), s);
  }
  // MNI152 / Talairach are not constructible any more: the parser
  // refuses them AND says why (no validated registration, MNI305 only).
  for (const s of ['mni152-mm','talairach-mm']) {
    assert.throws(()=>parseCoordinateSpace(s),/no validated registration/,
      `${s} 必须被拒绝并说明原因`);
  }
  // Unknown strings are refused too (no silent fallthrough to a neighbour).
  assert.throws(()=>parseCoordinateSpace('mni305-mm'),/Unknown coordinate space/);
  assert.throws(()=>parseCoordinateSpace(''),/Unknown coordinate space/);
  // validateTransform stays the runtime choke point: an untyped string
  // that still names a disabled space is rejected there as well, so
  // the behaviour-level assertions above keep passing unchanged.
  assert.throws(()=>validateTransform({...MNE_HEAD_TO_SPHERE,to:'mni152-mm'}),/Invalid/);
});
