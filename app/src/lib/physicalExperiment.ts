import {configurationForRecording} from './eegConfiguration.ts';
import type { Vec3Mm } from './volumeConduction.ts';
import {sphereElectrodePotentials,SPHERE_MODEL_ID,type SphereFixture,type MontageKey} from './sphereForward.ts';
import type {EegRecording,EegReference} from './eegData.ts';
import {ExperimentSession} from './experimentSession.ts';
import {setLiveRecordingStore,getLiveRecordingStore} from './eegRecording.ts';
export interface PhysicalSourceState {
 waveform:'constant'|'pulse';timeMs:number;modelId:string;electrodeVertices:Record<string,number>;secondary?:{position:Vec3Mm;direction:Vec3Mm;moment:number};
 revision:number;position:Vec3Mm;axis:'X'|'Y'|'Z'|'free';direction:Vec3Mm;moment:number;
 montage:MontageKey;reference:EegReference;electrode:string;
}
const initial=():PhysicalSourceState=>({waveform:'constant',timeMs:0,modelId:SPHERE_MODEL_ID,electrodeVertices:{},revision:0,position:[16,0,16],axis:'X',direction:[1,0,0],moment:10,
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
 const oldFields={waveform:state.waveform,modelId:state.modelId,electrodeVertices:state.electrodeVertices,secondary:state.secondary,position:state.position,axis:state.axis,direction:state.direction,moment:state.moment,montage:state.montage,reference:state.reference};
 const newFields={waveform:next.waveform,modelId:next.modelId,electrodeVertices:next.electrodeVertices,secondary:next.secondary,position:next.position,axis:next.axis,direction:next.direction,moment:next.moment,montage:next.montage,reference:next.reference};
 const physicalChange=JSON.stringify(oldFields)!==JSON.stringify(newFields);
 if(!physicalChange&&next.electrode===state.electrode&&next.timeMs===state.timeMs)return state;
 if(next.secondary&&(!Number.isFinite(next.secondary.moment)||next.secondary.position.length!==3||
   !next.secondary.position.every(Number.isFinite)||Math.abs(Math.hypot(...next.secondary.direction)-1)>1e-8))
   throw new Error('Invalid secondary dipole');
 state=Object.freeze({...next,position:Object.freeze([...next.position]) as Vec3Mm,
  direction:Object.freeze([...next.direction]) as Vec3Mm,
  electrodeVertices:Object.freeze({...next.electrodeVertices}),
  secondary:next.secondary?Object.freeze({...next.secondary,position:Object.freeze([...next.secondary.position]) as Vec3Mm,direction:Object.freeze([...next.secondary.direction]) as Vec3Mm}):undefined,
  reference:Object.freeze({...next.reference}),revision:state.revision+(physicalChange?1:0)});
 const current=getLiveRecordingStore();
 if(physicalChange&&current?.recording.sourceSnapshot)setLiveRecordingStore(null);
 listeners.forEach(fn=>fn());return state;
}
let fixture:SphereFixture|null=null;
export function physicalFixtureReady():boolean {return fixture!==null&&fixture.model_id===state.modelId;}
export function getPhysicalFixture():SphereFixture|null{return fixture;}
export function fixtureForPhysicalRecording(rec:EegRecording):SphereFixture {
 if(!fixture||fixture.model_id!==rec.forwardModelId||rec.channels.some(c=>{
  const s=fixture!.sensors.find(x=>x.label===c.label);return !s||c.positionMm.some((x,k)=>Math.abs(x-s.position_mm[k])>1e-5);
 }))throw new Error('Physical recording geometry or conductor mismatch');
 return fixture;
}
export function registerPhysicalFixture(data:SphereFixture):void {fixture=data;listeners.forEach(fn=>fn());}
export function preparePhysicalAnalysis(rate:250|500=250):EegRecording {
 if(!physicalFixtureReady()||!fixture)throw new Error('Physical forward model is not ready');
 const source=state,direction:Vec3Mm=source.direction;
 const potentials=sphereElectrodePotentials(fixture,source.position,[direction[0]*source.moment,direction[1]*source.moment,direction[2]*source.moment],
  source.montage,{mode:'infinity'});
 const allSources=[{position:source.position,direction:source.direction,moment:source.moment},...(source.secondary?[source.secondary]:[])];
 const second=source.secondary?sphereElectrodePotentials(fixture,source.secondary.position,source.secondary.direction.map(x=>x*source.secondary!.moment) as unknown as Vec3Mm,source.montage,{mode:'infinity'}):null;
 if(second)potentials.voltageUv=potentials.voltageUv.map((v,i)=>v+second.voltageUv[i]);
 const channels=potentials.sensors.map(s=>({label:s.label,positionMm:s.position_mm}));
 const session=new ExperimentSession({origin:'independent',solverId:source.waveform==='constant'?'manual-static-dipole-v1':'manual-defined-current-v1',
  anatomyId:fixture.model_id,registration:'unregistered',seed:0});
 const timesMs=Array.from({length:2*rate+1},(_,i)=>1000*i/rate);
 const raw=potentials.voltageUv.map(v=>timesMs.map(t=>v*sourceWaveformAt(source.waveform,t)));
 // A time-independent source has a constant voltage. Never invent neural oscillations.
 const ref=source.reference;
 const referenced=sphereElectrodePotentials(fixture,source.position,[direction[0]*source.moment,direction[1]*source.moment,direction[2]*source.moment],
  source.montage,ref);
 if(source.secondary){
  const other=sphereElectrodePotentials(fixture,source.secondary.position,source.secondary.direction.map(x=>x*source.secondary!.moment) as unknown as Vec3Mm,source.montage,ref);
  referenced.voltageUv=referenced.voltageUv.map((v,i)=>v+other.voltageUv[i]);
 }
 session.recordModelTime(session.runId,2000);
 session.recordArtifact({id:'physical-raw',runId:session.runId,kind:'eeg-raw',tMs:0,
  sourceId:'manual-source-r'+source.revision,methodId:source.waveform==='constant'?'constant-source-forward-v1':'defined-half-sine-source-forward-v1'});
 const rec:EegRecording={version:1,sfreqHz:rate,timesMs,channels,rawDataUvInfinity:raw,
  dataUv:referenced.voltageUv.map(v=>timesMs.map(t=>v*sourceWaveformAt(source.waveform,t))),reference:{...ref},montage:source.montage,
  forwardModelId:fixture.model_id,sourceModelId:source.waveform==='constant'?'manual-static-dipole-v1':'manual-defined-current-v1',seed:0,noise:null,
  sourceSeries:{coordinateFrame:'head-RAS-sphere-centered',mapping:'manual-physical',
   sources:allSources.map(s=>({positionMm:s.position,direction:s.direction,momentsNAm:timesMs.map(t=>s.moment*sourceWaveformAt(source.waveform,t))}))},
  sourceSnapshot:{...source,position:[...source.position] as Vec3Mm},
  provenance:session.provenance,experiment:{session:session.getSnapshot(),parameters:{
   sourceState:source,durationMs:2000,sfreqHz:rate,montage:source.montage,reference:ref,seed:0,noise:null,
  }}};
 const events=source.waveform==='pulse'?[{id:0,runId:session.runId,type:'pulse' as const,tMs:500,condition:'unclassified' as const,drive:source.moment,driveUnit:'nA_m' as const}]:[];
 setLiveRecordingStore({recording:rec,events,epochs:null,workspace:{configuration:configurationForRecording(rec),selectedChannel:source.electrode,atTimeMs:source.timeMs}});return rec;
}

/** Explicit input moment, not a physiological ERP: 200 ms half-sine from 500 ms. */
export function sourceWaveformAt(mode:'constant'|'pulse',tMs:number):number {
 if(!Number.isFinite(tMs))throw new RangeError('Invalid source time');
 return mode==='constant'?1:tMs<500||tMs>700?0:Math.sin(Math.PI*(tMs-500)/200);
}
