import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateFsaverageBEM,findNearestValidatedSource,templateSourcePotentials}
  from '../../app/src/lib/fsaverageBEM.ts';

const model=JSON.parse(readFileSync(new URL(
  '../../.local-assets/pr5/fsaverage-bem-dense.json',import.meta.url),'utf8'));
test('high-density MNE BEM has 128 cortical sources and 343 actual montage electrodes',()=>{
  validateFsaverageBEM(model);
  assert.equal(model.source_positions.length,128);
  assert.equal(model.electrodes.length,343);
  assert.equal(model.montage,'10-05');
  assert.equal(model.gains_uV_per_nAm.length,343);
  assert.equal(model.gains_uV_per_nAm[0].length,384);
  assert.equal(model.standard_coordinate_definition.includes('not MNI152'),true);
});
test('every high-density cortex node is finite, labeled, and in a real hemisphere',()=>{
  for(const s of model.source_positions){
    assert.ok(['lh','rh'].includes(s.hemisphere));
    assert.equal(s.head_mm.length,3);
    assert.equal(s.normal_head_unit.length,3);
    assert.ok(Math.abs(Math.hypot(...s.normal_head_unit)-1)<1e-5);
    assert.equal(s.mni305_mm.length,3);
    assert.ok(s.head_mm.every(Number.isFinite));
    assert.ok(s.mni305_mm.every(Number.isFinite));
    const nearest=findNearestValidatedSource(model,s.head_mm,s.hemisphere);
    assert.ok(nearest.distanceMm<1e-9);
  }
});
test('343-channel real MRI BEM is linear, polarity-correct, and average-reference zero',()=>{
  for(const i of [0,1,31,63,64,96,127]){
    const p=templateSourcePotentials(model,i,[12,-4,6]);
    const negative=templateSourcePotentials(model,i,[-12,4,-6]);
    assert.equal(p.length,343);
    assert.ok(p.every(Number.isFinite));
    assert.ok(Math.abs(p.reduce((a,b)=>a+b,0))<1e-8);
    p.forEach((v,j)=>assert.ok(Math.abs(v+negative[j])<1e-8));
  }
});
test('fast source selection and online field projection at 343 sensors',()=>{
  const begin=performance.now();
  for(let i=0;i<128;i++){
    const p=templateSourcePotentials(model,i,[10,1,1]);
    assert.equal(p.length,343);
  }
  const ms=performance.now()-begin;
  // Coarse runner throughput guard, not a claimed product FPS number.
  assert.ok(ms<2000,'128 real BEM source projections too slow: '+ms+' ms');
});
