import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  COUPLING_ID,DEFAULT_RATE_PARAMS,DEFAULT_MORPHOLOGY,
  validateRateParams,validateMorphology,
  equivalentMomentNAm,alignedDipoleVectorNAm,
  createLocalCorticalColumn,equilibrateLocalColumn,
} from '../../app/src/lib/localCorticalColumn.ts';
import {templateSourcePotentials} from '../../app/src/lib/fsaverageBEM.ts';

const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<=tol,
    'expected '+a+' ~ '+b+' (tolerance '+tol+')');
test('mechanistic units and reference identity explicitly mark assumed biology',()=>{
  assert.match(COUPLING_ID,/assumed-dipole/);
  assert.equal(DEFAULT_RATE_PARAMS.dtMs,1);
  assert.equal(DEFAULT_MORPHOLOGY.excitatoryCurrentPA,200);
});
test('dimension: 1 pA × 1 mm × 1 million cells × 1 coherence = 1 nA·m',()=>{
  const m={effectivePyramidalCells:1_000_000,coherence:1,
    excitatoryCurrentPA:1,inhibitoryCurrentPA:1,dipoleSeparationMm:1};
  near(equivalentMomentNAm(1,0,0,0,m),1);
});
test('baseline-subtracted activity gives exactly zero physical source',()=>{
  near(equivalentMomentNAm(.15,.3,.15,.3),0);
  const sim=createLocalCorticalColumn();
  const x=sim.read();
  near(x.equivalentMomentNAm,0);
  near(x.tMs,0);
  near(x.baselineE,equilibrateLocalColumn()[0]);
});
test('pyramidal count, coherence, dipole length and physical current each scale signal',()=>{
  const m={...DEFAULT_MORPHOLOGY};
  const a=equivalentMomentNAm(.35,.18,.12,.1,m);
  for(const key of ['effectivePyramidalCells','coherence','dipoleSeparationMm',
                    'excitatoryCurrentPA']){
    const changed={...m,[key]:m[key]*2};
    const x=equivalentMomentNAm(.35,.1,.12,.1,changed);
    const y=equivalentMomentNAm(.35,.1,.12,.1,m);
    near(x,2*y,1e-12);
  }
  assert.ok(a>0);
});
test('inhibitory activation can reverse dipole polarity, not force positive-only EEG',()=>{
  const x=equivalentMomentNAm(.25,.15,.2,.2);
  const y=equivalentMomentNAm(.2,.25,.2,.2);
  assert.ok(x>0);
  assert.ok(y<0);
});
test('cortical normal projects physical dipole vector and rejects nonunits',()=>{
  assert.deepEqual(alignedDipoleVectorNAm(5,[0,0,-1]),[0,0,-5]);
  const t=alignedDipoleVectorNAm(1,[0.6,0.8,0]);
  near(Math.hypot(...t),1);
  assert.throws(()=>alignedDipoleVectorNAm(1,[2,0,0]),/unit/);
  assert.throws(()=>alignedDipoleVectorNAm(Infinity,[1,0,0]),/Nonfinite/);
});
test('bad cell, time constants, rates and drive inputs fail explicitly',()=>{
  assert.throws(()=>validateMorphology({...DEFAULT_MORPHOLOGY,coherence:1.1}),/Invalid/);
  assert.throws(()=>validateMorphology({...DEFAULT_MORPHOLOGY,effectivePyramidalCells:NaN}),/Invalid/);
  assert.throws(()=>validateRateParams({...DEFAULT_RATE_PARAMS,dtMs:50}),/Invalid/);
  assert.throws(()=>validateRateParams({...DEFAULT_RATE_PARAMS,tauEMs:-1}),/Invalid/);
  assert.throws(()=>equivalentMomentNAm(-.1,0,0,0),/rate/);
  assert.throws(()=>createLocalCorticalColumn().step(100),/drive/);
});
test('same input timeline produces deterministic E, I, physical moment and reset',()=>{
  const a=createLocalCorticalColumn(),b=createLocalCorticalColumn();
  for(let n=0;n<600;n++){
    const stim=n>=80&&n<120?1.4:0;
    const x=a.step(stim),y=b.step(stim);
    assert.deepEqual(x,y);
  }
  assert.ok(Math.abs(a.read().equivalentMomentNAm)<.02,'steady state recovers');
  a.reset();
  assert.deepEqual(a.read(),createLocalCorticalColumn().read());
});
test('stimulus causes model-based E dynamics, physical q and later return to baseline',()=>{
  const s=createLocalCorticalColumn();
  for(let n=0;n<80;n++)s.step();
  const base=s.read();
  for(let n=0;n<40;n++)s.step(1.4);
  const excited=s.read();
  assert.ok(excited.e>base.e+.02);
  assert.ok(Math.abs(excited.equivalentMomentNAm)>.05);
  for(let n=0;n<2000;n++)s.step();
  near(s.read().equivalentMomentNAm,0,1e-8);
});
test('independent SciPy DOP853 fixed-point and trajectory cross-check',()=>{
  const ref=JSON.parse(readFileSync(new URL(
    './fixtures/local-column-reference.json',import.meta.url),'utf8'));
  const s=createLocalCorticalColumn();
  near(s.read().baselineE,ref.baseline_e,2e-8);
  near(s.read().baselineI,ref.baseline_i,2e-8);
  for(const sample of ref.samples){
    while(s.read().tMs<sample.t_ms){
      const time=s.read().tMs;
      s.step(time>=80&&time<120?1.4:0);
    }
    const x=s.read();
    near(x.tMs,sample.t_ms,1e-8);
    near(x.e,sample.e,5e-7);
    near(x.i,sample.i,5e-7);
    near(x.equivalentMomentNAm,sample.q_nAm,3e-5);
  }
});
test('dimensionally valid q is projected through existing BEM lead field',()=>{
  const m={...DEFAULT_MORPHOLOGY};
  const q=equivalentMomentNAm(.25,.1,.15,.1,m);
  const moment=alignedDipoleVectorNAm(q,[0,0,1]);
  const fixture={
    source_positions:[{head_mm:[0,0,0]}],
    electrodes:[{label:'A'},{label:'B'}],
    gains_uV_per_nAm:[[2,3,4],[2,3,-4]],
  };
  const values=templateSourcePotentials(fixture,0,moment,{mode:'infinity'});
  near(values[0],4*q);
  near(values[1],-4*q);
  const referenced=templateSourcePotentials(fixture,0,moment);
  near(referenced[0]+referenced[1],0);
});
