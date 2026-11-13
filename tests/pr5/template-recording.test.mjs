import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerTemplateModel} from '../../app/src/lib/fsaverageBEM.ts';
import {setTemplateSource,prepareTemplateAnalysis,templateLeadField,templateRecordingForward} from '../../app/src/lib/templateExperiment.ts';
import {dipoleFit} from '../../app/src/lib/sourceLocalization.ts';
import {reReferenceRecording} from '../../app/src/lib/eegRecording.ts';
const model=JSON.parse(readFileSync('app/public/forward-assets/fsaverage-bem.json','utf8'));
test('real template Raw, shared cursor, leadfield and reference use matching geometry',()=>{
 registerTemplateModel(model);
 setTemplateSource({sourceIndex:2,moment:12,direction:[0,1,0],reference:{mode:'average'},electrode:'Cz'});
 const rec=prepareTemplateAnalysis(),forward=templateRecordingForward(rec,1000),lf=templateLeadField(rec);
 assert.equal(rec.forwardModelId,model.model_id);assert.equal(rec.sourceSeries.coordinateFrame,'HEAD_RAS_MM');
 assert.equal(forward.atTimeMs,1000);
 rec.dataUv.forEach((row,c)=>assert.ok(Math.abs(row[250]-forward.valueUv[c])<1e-12));
 const fit=dipoleFit(lf,rec.dataUv.map(row=>row[250]));
 assert.ok(fit.residualRmsUv<1e-6);
 assert.ok(Math.hypot(...fit.estimatedPositionMm.map((x,k)=>x-model.source_positions[2].head_mm[k]))<1e-3);
 const processed=reReferenceRecording(rec,{mode:'electrode',label:'Cz'});
 const f=templateRecordingForward(processed,1000);
 processed.dataUv.forEach((row,c)=>assert.ok(Math.abs(row[250]-f.valueUv[c])<1e-12));
 assert.ok(model.distribution_notice.includes('PART B. DOWNLOADING AGREEMENT'));
 assert.ok(model.comparison_sphere.gains_uV_per_nAm.some((r,i)=>r.some((x,k)=>Math.abs(x-model.gains_uV_per_nAm[i][k])>1e-6)));
 assert.throws(()=>templateLeadField({...rec,channels:rec.channels.map((c,i)=>i===0?{...c,positionMm:[0,0,0]}:c)}),/geometry/);
});
test('BEM feedback freezes selected source, reference, sensor and HEAD coordinates; native filter and restore keep that operator',async()=>{
 const {physicalFeedbackMapping}=await import('../../app/src/lib/physicalFeedback.ts');
 const {setHeadModelSelection}=await import('../../app/src/lib/headModelSelection.ts');
 const {templateSourcePotentials}=await import('../../app/src/lib/fsaverageBEM.ts');
 const {NativeFeedback}=await import('../../app/src/lib/nativeFeedback.ts');
 const {equivalentMomentNAm}=await import('../../app/src/lib/localCorticalColumn.ts');
 setHeadModelSelection('bem');
 try{
  const direction=[.6,.8,0],sourceIndex=3,electrode='Pz';
  for(const reference of [{mode:'average'},{mode:'infinity'},{mode:'electrode',label:'Cz'}]){
   setTemplateSource({sourceIndex,moment:10,direction,reference,electrode});
   const mapping=physicalFeedbackMapping(null);
   const c=model.electrodes.findIndex(e=>e.label===electrode),j=3*sourceIndex;
   const raw=model.gains_uV_per_nAm.map(row=>row[j]*direction[0]+row[j+1]*direction[1]);
   const offset=reference.mode==='average'?raw.reduce((a,b)=>a+b,0)/raw.length:reference.mode==='electrode'?raw[model.electrodes.findIndex(e=>e.label==='Cz')]:0;
   assert.ok(Math.abs(mapping.gainUvPerNAm-(raw[c]-offset))<1e-12);
   assert.equal(mapping.headModel,'bem');assert.equal(mapping.coordinateFrame,'HEAD_RAS_MM');
   assert.deepEqual(mapping.sourcePositionMm,model.source_positions[sourceIndex].head_mm);
   assert.deepEqual(mapping.templateSource,{index:sourceIndex,vertex:model.source_positions[sourceIndex].vertex,
    hemisphere:model.source_positions[sourceIndex].hemisphere,atlas:model.source_positions[sourceIndex].atlas,
    region:model.source_positions[sourceIndex].region,anatomicalRegistration:'MNE-fsaverage-MRI-to-HEAD'});
   const cfg={node:0,feature:'instant',threshold:0,amplitude:.2,durationMs:100,periodMs:1,windowMs:1000,cooldownMs:2000,delayMs:0,maxTriggers:2,
    eeg:{...mapping,baselineE:.1,baselineI:.1}};
   const ctl=new NativeFeedback(cfg,1,0),q=equivalentMomentNAm(.11,.1,.1,.1,mapping.morphology);
   ctl.afterStep(1,new Float64Array([.11]),new Float64Array([.1]));
   const expected=mapping.gainUvPerNAm*q*(1-Math.exp(-2*Math.PI*40/1000));
   assert.ok(Math.abs(ctl.snapshot().samples[0].value-expected)<1e-12);
   const copy=NativeFeedback.restore(ctl.snapshot(),1);
   setTemplateSource({sourceIndex:1,moment:20,direction:[0,0,1],reference:{mode:'average'},electrode:'Cz'});
   for(let t=2;t<=20;t++){
    assert.deepEqual(ctl.beforeStep(t),copy.beforeStep(t));
    assert.deepEqual(ctl.afterStep(t,new Float64Array([.12]),new Float64Array([.1])),
     copy.afterStep(t,new Float64Array([.12]),new Float64Array([.1])));
   }
   assert.deepEqual(ctl.snapshot(),copy.snapshot());
   assert.equal(ctl.snapshot().config.eeg.templateSource.index,sourceIndex);
   assert.notEqual(physicalFeedbackMapping(null).sourceRevision,mapping.sourceRevision);
   assert.throws(()=>new NativeFeedback({...cfg,eeg:{...cfg.eeg,coordinateFrame:'head-RAS-sphere-centered'}},1,0),/coordinate/);
   assert.throws(()=>new NativeFeedback({...cfg,eeg:{...cfg.eeg,templateSource:undefined}},1,0),/coordinate/);
   assert.deepEqual(templateSourcePotentials(model,sourceIndex,direction,reference)[c],mapping.gainUvPerNAm);
  }
 }finally{setHeadModelSelection('sphere');}
});

test('feedback follows a local-column viewport pose without replacing the retained manual example',async()=>{
 const {setHeadModelSelection}=await import('../../app/src/lib/headModelSelection.ts');
 const {setTemplateMeasurementSource,getTemplateSource}=await import('../../app/src/lib/templateExperiment.ts');
 const {physicalFeedbackMapping}=await import('../../app/src/lib/physicalFeedback.ts');
 const {templateSourcePotentials}=await import('../../app/src/lib/fsaverageBEM.ts');
 setTemplateSource({sourceIndex:1,moment:10,direction:[1,0,0],reference:{mode:'average'},electrode:'Cz'});
 const sourceIndex=5,direction=model.source_positions[sourceIndex].normal_head_unit;
 setTemplateMeasurementSource({sourceIndex,direction,reference:{mode:'infinity'},electrode:'Pz'});
 setHeadModelSelection('bem');
 try{
  const m=physicalFeedbackMapping(null);
  assert.equal(m.templateSource.index,sourceIndex);assert.deepEqual(m.direction,direction);
  assert.equal(m.gainUvPerNAm,templateSourcePotentials(model,sourceIndex,direction,{mode:'infinity'})[model.electrodes.findIndex(e=>e.label==='Pz')]);
  assert.equal(getTemplateSource().sourceIndex,1,'independent manual experiment is not overwritten by local-column activity');
 }finally{setHeadModelSelection('sphere');}
});
