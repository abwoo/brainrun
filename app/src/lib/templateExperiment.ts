import {getTemplateModel,templateSourcePotentials,FSAVERAGE_BEM_MODEL_ID} from './fsaverageBEM.ts';
import {ExperimentSession} from './experimentSession.ts';
import {getLiveRecordingStore,setLiveRecordingStore} from './eegRecording.ts';
import type {EegRecording,EegReference} from './eegData.ts';
import type {Vec3Mm} from './volumeConduction.ts';
import type {LeadField} from './sourceLocalization.ts';
export interface TemplateSourceState {sourceIndex:number;moment:number;direction:Vec3Mm;reference:EegReference;electrode:string;revision:number;}
let state:TemplateSourceState={sourceIndex:0,moment:10,direction:[1,0,0],reference:{mode:'average'},electrode:'Cz',revision:0};
export const getTemplateSource=()=>state;
export function setTemplateSource(patch:Omit<TemplateSourceState,'revision'>):void {
 const physicalChange=JSON.stringify({...state,electrode:'',revision:0})!==JSON.stringify({...patch,electrode:'',revision:0});
 state={...patch,direction:[...patch.direction],reference:{...patch.reference},revision:state.revision+(physicalChange?1:0)};
 if(physicalChange&&getLiveRecordingStore()?.recording.templateSnapshot)setLiveRecordingStore(null);
}
export function prepareTemplateAnalysis():EegRecording {
 const model=getTemplateModel();if(!model)throw new Error('Template is not ready');
 const source=model.source_positions[state.sourceIndex];if(!source)throw new Error('Invalid template source');
 const q:Vec3Mm=[state.direction[0]*state.moment,state.direction[1]*state.moment,state.direction[2]*state.moment];
 const raw=templateSourcePotentials(model,state.sourceIndex,q,{mode:'infinity'});
 const values=templateSourcePotentials(model,state.sourceIndex,q,state.reference);
 const timesMs=Array.from({length:501},(_,i)=>4*i);
 const session=new ExperimentSession({origin:'independent',solverId:'manual-static-template-dipole-v1',anatomyId:FSAVERAGE_BEM_MODEL_ID,
  registration:'validated',seed:0});
 session.recordModelTime(session.runId,2000);
 session.recordArtifact({id:'template-raw',runId:session.runId,kind:'eeg-raw',tMs:0,sourceId:'template-source-r'+state.revision,methodId:'MNE-BEM-static-v1'});
 const rec:EegRecording={version:1,sfreqHz:250,timesMs,channels:model.electrodes.map(e=>({label:e.label,positionMm:e.head_mm})),
 dataUv:values.map(v=>timesMs.map(()=>v)),rawDataUvInfinity:raw.map(v=>timesMs.map(()=>v)),
 reference:{...state.reference},montage:model.montage as EegRecording['montage'],forwardModelId:model.model_id,
 sourceModelId:'manual-static-template-dipole-v1',seed:0,noise:null,templateSnapshot:{...state},
 sourceSeries:{coordinateFrame:'HEAD_RAS_MM',mapping:'manual-template',
  sources:[{positionMm:source.head_mm,direction:state.direction,momentsNAm:timesMs.map(()=>state.moment)}]},
 provenance:session.provenance,experiment:{session:session.getSnapshot(),parameters:{sourceState:state,
  corticalVertex:source.vertex,hemisphere:source.hemisphere,atlas:source.atlas,region:source.region,
  templateRegistration:'MNE fsaverage MRI/HEAD transform; not subject-specific',
  reference:state.reference,montage:model.montage,durationMs:2000,sfreqHz:250,noise:null,seed:0}}};
 setLiveRecordingStore({recording:rec,events:[],epochs:null});return rec;
}
export function templateLeadField(recording:EegRecording):LeadField {
 const model=getTemplateModel();
 if(!model||recording.forwardModelId!==model.model_id)throw new Error('No compatible template matrix');
 const indices=recording.channels.map(c=>{
  const i=model.electrodes.findIndex(e=>e.label===c.label);
  if(i<0||c.positionMm.some((x,k)=>Math.abs(x-model.electrodes[i].head_mm[k])>1e-5))throw new Error('Template sensor geometry mismatch');
  return i;
 });
 const rows=indices.map(i=>[...model.gains_uV_per_nAm[i]]);
 const ref=recording.reference;
 const offset=ref.mode==='average'?rows[0].map((_,k)=>rows.reduce((s,r)=>s+r[k],0)/rows.length):
 ref.mode==='electrode'?rows[recording.channels.findIndex(c=>c.label===ref.label)]:rows[0].map(()=>0);
 if(!offset)throw new Error('Reference absent');
 return {labels:recording.channels.map(c=>c.label),gain:rows.map(r=>r.map((x,k)=>x-offset[k])),
 sourcePositionsMm:model.source_positions.map(s=>s.head_mm),montage:recording.montage,reference:recording.reference};
}
export function templateRecordingForward(recording:EegRecording,atTimeMs:number) {
 const model=getTemplateModel();if(!model||recording.forwardModelId!==model.model_id||!recording.sourceSeries)throw new Error('Missing compatible template history');
 let j=0;recording.timesMs.forEach((t,k)=>{if(Math.abs(t-atTimeMs)<Math.abs(recording.timesMs[j]-atTimeMs))j=k;});
 let values=model.electrodes.map(()=>0);
 for(const source of recording.sourceSeries.sources){
  const i=model.source_positions.findIndex(p=>p.head_mm.every((x,k)=>Math.abs(x-source.positionMm[k])<1e-5));
  if(i<0||source.momentsNAm.length!==recording.timesMs.length)throw new Error('Invalid template source history');
  const q:Vec3Mm=[source.direction[0]*source.momentsNAm[j],source.direction[1]*source.momentsNAm[j],source.direction[2]*source.momentsNAm[j]];
  const v=templateSourcePotentials(model,i,q,{mode:'infinity'});values=values.map((x,k)=>x+v[k]);
 }
 const channels=recording.channels.map(c=>model.electrodes.findIndex(e=>e.label===c.label));
 if(channels.some(i=>i<0))throw new Error('Unknown template channel');
 const ref=recording.reference;
 const offset=ref.mode==='average'?channels.reduce((s,i)=>s+values[i],0)/channels.length:
 ref.mode==='electrode'?values[model.electrodes.findIndex(e=>e.label===ref.label)]:0;
 return {labels:model.electrodes.map(e=>e.label),positionsMm:model.electrodes.map(e=>e.head_mm),
  valueUv:values.map(x=>x-offset),sourceMm:recording.sourceSeries.sources[0].positionMm,
  momentNAm:[0,1,2].map(k=>recording.sourceSeries!.sources[0].direction[k]*recording.sourceSeries!.sources[0].momentsNAm[j]) as unknown as Vec3Mm,
  reference:recording.reference,atTimeMs:recording.timesMs[j],sourceCount:recording.sourceSeries.sources.length};
}
