/**
 * PR5 integrated scientific test: SciPy-independent Wilson-Cowan trajectory
 * → cellular current moment in nA·m → MNE fsaverage cortical normal in HEAD
 * → REAL 3-layer BEM EEG leadfield for either 19 or 343 electrodes.
 *
 * Note: validates the numerical physical chain under declared assumptions,
 * NOT any subject-calibrated relationship between E/I fractions and EEG.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createLocalCorticalColumn,alignedDipoleVectorNAm,
  DEFAULT_MORPHOLOGY,COUPLING_LIMITATION,
} from '../../app/src/lib/localCorticalColumn.ts';
import {validateFsaverageBEM,templateSourcePotentials}
  from '../../app/src/lib/fsaverageBEM.ts';

const modelPath=process.env.PR5_MODEL_FILE ??
  '.local-assets/pr5/fsaverage-bem.json';
const model=JSON.parse(readFileSync(modelPath,'utf8'));
const ref=JSON.parse(readFileSync('tests/pr5/fixtures/local-column-reference.json','utf8'));
const near=(a,b,tol=1e-6)=>assert.ok(Math.abs(a-b)<=tol,
  'expected '+a+' ~ '+b+' within '+tol);

test('MRI HEAD normals and BEM physical units are validated for source projection',()=>{
  validateFsaverageBEM(model);
  assert.equal(model.gain_unit,'uV_per_nA_m');
  assert.equal(model.source_moment_unit,'nA_m');
  assert.match(COUPLING_LIMITATION,/并非受试者校准/);
  assert.ok([19,343].includes(model.electrodes.length));
  assert.ok(model.source_positions.every(s=>
    Math.abs(Math.hypot(...s.normal_head_unit)-1)<1e-5));
});
test('physical source dynamics use SciPy-verified model and MNE-source normal',()=>{
  const sim=createLocalCorticalColumn();
  const selectedNode=3;
  const node=model.source_positions[selectedNode];
  const normal=node.normal_head_unit;
  const col=model.electrodes.findIndex(x=>x.label==='Cz');
  assert.ok(col>=0);
  let peak=0;
  for(const sample of ref.samples) {
    while(sim.read().tMs<sample.t_ms) {
      const t=sim.read().tMs;
      sim.step(t>=80&&t<120?1.4:0);
    }
    const s=sim.read();
    near(s.e,sample.e,5e-7);
    near(s.i,sample.i,5e-7);
    near(s.equivalentMomentNAm,sample.q_nAm,3e-5);
    const vector=alignedDipoleVectorNAm(s.equivalentMomentNAm,normal);
    const values=templateSourcePotentials(model,selectedNode,vector,{mode:'infinity'});
    const row=model.gains_uV_per_nAm[col];
    const off=selectedNode*3;
    const expected=sample.q_nAm*(
      row[off]*normal[0]+row[off+1]*normal[1]+row[off+2]*normal[2]);
    near(values[col],expected,1e-4);
    peak=Math.max(peak,...values.map(Math.abs));
  }
  assert.ok(peak>.0001,'validated mechanistic stimulus produces BEM EEG changes');
});
test('coupling physical assumptions and references remain independently separable',()=>{
  const s=createLocalCorticalColumn();
  for(let i=0;i<220;i++)s.step(i>=80&&i<120?1.4:0);
  const q=s.read().equivalentMomentNAm;
  assert.ok(Math.abs(q)>1e-7);
  const p=model.source_positions[0].normal_head_unit;
  const vector=alignedDipoleVectorNAm(q,p);
  const raw=templateSourcePotentials(model,0,vector,{mode:'infinity'});
  const avg=templateSourcePotentials(model,0,vector,{mode:'average'});
  const mean=raw.reduce((a,b)=>a+b,0)/raw.length;
  raw.forEach((v,i)=>near(avg[i],v-mean,1e-9));
  near(avg.reduce((a,b)=>a+b,0),0,1e-9);
  const doubled=alignedDipoleVectorNAm(2*q,p);
  const raw2=templateSourcePotentials(model,0,doubled,{mode:'infinity'});
  raw.forEach((v,i)=>near(raw2[i],2*v,1e-9));
  assert.equal(DEFAULT_MORPHOLOGY.coherence,.08);
});
