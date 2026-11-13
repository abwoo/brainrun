import type { Vec3Mm } from './volumeConduction.ts';
import {sphereElectrodePotentials,SPHERE_MODEL_ID,type SphereFixture,type MontageKey} from './sphereForward.ts';
import type {EegRecording,EegReference} from './eegData.ts';
import {ExperimentSession} from './experimentSession.ts';
import {setLiveRecordingStore,getLiveRecordingStore} from './eegRecording.ts';
export interface PhysicalSourceState {
 revision:number;position:Vec3Mm;axis:'X'|'Y'|'Z'|'free';direction:Vec3Mm;moment:number;
 montage:MontageKey;reference:EegReference;electrode:string;
}
const initial=():PhysicalSourceState=>({revision:0,position:[16,0,16],axis:'X',direction:[1,0,0],moment:10,
 montage:'10-20',reference:{mode:'average'},electrode:'Cz'});
let state=initial();
const listeners=new Set<()=>void>();
export function getPhysicalSource():PhysicalSourceState{return state;}
export function subscribePhysicalSource(fn:()=>void):()=>void {listeners.add(fn);return ()=>{listeners.delete(fn);};}
export function setPhysicalSource(patch:Partial<Omit<PhysicalSourceState,'revision'>>):PhysicalSourceState {
 const next={...state,...patch,position:patch.position?[...patch.position] as Vec3Mm:state.position};
 const direction:Vec3Mm=next.axis==='free'?next.direction:next.axis==='X'?[1,0,0]:next.axis==='Y'?[0,1,0]:[0,0,1];
 const norm=Math.hypot(...direction);
 if(!direction.every(Number.isFinite)||norm<1e-12||!next.position.every(Number.isFinite)||!Number.isFinite(next.moment))
  throw new RangeError('Invalid physical source');
 next.direction=Math.abs(norm-1)>1e-12?[direction[0]/norm,direction[1]/norm,direction[2]/norm]:direction;
 const oldFields={position:state.position,axis:state.axis,direction:state.direction,moment:state.moment,montage:state.montage,reference:state.reference};
 const newFields={position:next.position,axis:next.axis,direction:next.direction,moment:next.moment,montage:next.montage,reference:next.reference};
 const physicalChange=JSON.stringify(oldFields)!==JSON.stringify(newFields);
 if(!physicalChange&&next.electrode===state.electrode)return state;
 state=Object.freeze({...next,position:Object.freeze([...next.position]) as Vec3Mm,
  direction:Object.freeze([...next.direction]) as Vec3Mm,
  reference:Object.freeze({...next.reference}),revision:state.revision+(physicalChange?1:0)});
 const current=getLiveRecordingStore();
 if(physicalChange&&current?.recording.sourceSnapshot)setLiveRecordingStore(null);
 listeners.forEach(fn=>fn());return state;
}
let fixture:SphereFixture|null=null;
export function physicalFixtureReady():boolean {return fixture!==null;}
export function registerPhysicalFixture(data:SphereFixture):void {fixture=data;listeners.forEach(fn=>fn());}
export function preparePhysicalAnalysis(rate:250|500=250):EegRecording {
 if(!fixture)throw new Error('Physical forward model is not ready');
 const source=state,direction:Vec3Mm=source.direction;
 const potentials=sphereElectrodePotentials(fixture,source.position,[direction[0]*source.moment,direction[1]*source.moment,direction[2]*source.moment],
  source.montage,{mode:'infinity'});
 const channels=potentials.sensors.map(s=>({label:s.label,positionMm:s.position_mm}));
 const session=new ExperimentSession({origin:'independent',solverId:'manual-static-dipole-v1',
  anatomyId:SPHERE_MODEL_ID,registration:'unregistered',seed:0});
 const timesMs=Array.from({length:2*rate+1},(_,i)=>1000*i/rate);
 const raw=potentials.voltageUv.map(v=>timesMs.map(()=>v));
 // A time-independent source has a constant voltage. Never invent neural oscillations.
 const ref=source.reference;
 const referenced=sphereElectrodePotentials(fixture,source.position,[direction[0]*source.moment,direction[1]*source.moment,direction[2]*source.moment],
  source.montage,ref);
 session.recordModelTime(session.runId,2000);
 session.recordArtifact({id:'physical-raw',runId:session.runId,kind:'eeg-raw',tMs:0,
  sourceId:'manual-source-r'+source.revision,methodId:'constant-source-forward-v1'});
 const rec:EegRecording={version:1,sfreqHz:rate,timesMs,channels,rawDataUvInfinity:raw,
  dataUv:referenced.voltageUv.map(v=>timesMs.map(()=>v)),reference:{...ref},montage:source.montage,
  forwardModelId:SPHERE_MODEL_ID,sourceModelId:'manual-static-dipole-v1',seed:0,noise:null,
  sourceSeries:{coordinateFrame:'head-RAS-sphere-centered',mapping:'manual-physical',
   sources:[{positionMm:source.position,direction,momentsNAm:timesMs.map(()=>source.moment)}]},
  sourceSnapshot:{...source,position:[...source.position] as Vec3Mm},
  provenance:session.provenance,experiment:{session:session.getSnapshot(),parameters:{
   sourceState:source,durationMs:2000,sfreqHz:rate,montage:source.montage,reference:ref,seed:0,noise:null,
  }}};
 setLiveRecordingStore({recording:rec,events:[],epochs:null});return rec;
}
