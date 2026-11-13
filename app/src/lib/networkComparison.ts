import type {SimClient,StimulusMarker} from './simClient';
import type {NativeSample} from './nativeAcquisition';
import type {ExperimentSessionSnapshot} from './experimentSession';
export interface NetworkBranch {
 snapshotId:string;stateJson:string;markers:StimulusMarker[];
 feedbackEvents:ReturnType<SimClient['getExperimentBundle']>['nativeFeedback']['events'];
 run:ExperimentSessionSnapshot;samples:NativeSample[];g:number;
}
export interface NetworkComparison {
 schemaVersion:1;model:'rust-wasm-wilson-cowan-76';originSnapshotId:string;originJson:string;originRunId:string;
 startMs:number;durationMs:number;node:number;a:NetworkBranch;b:NetworkBranch;
 metrics:{selectedRmsDifference:number;globalMaxDifference:number};
}
function advanceBranch(sim:SimClient,target:number,ms:number):Promise<void>{
 return new Promise((resolve,reject)=>{
  const run=sim.getExperimentSession().provenance.runId;
  const timer=setTimeout(()=>{off();reject(new Error('Worker comparison advance timed out'));},20000);
  const off=sim.subscribe(s=>{if(s.run_id===run&&s.t_ms>=target){clearTimeout(timer);off();resolve();}});
  sim.advanceMs(ms);
 });
}
let busy=false;
/** Fork the same complete kernel/RNG/delays/inputs/controller state; change G only.
 * Both trajectories use native 1 ms acquisition. Finish paused at the origin.
 * Unique branch snapshots never overwrite the user's manual snapshot.
 */
export async function compareNetworkBranches(sim:SimClient,node:number,gB:number,durationMs=2000):Promise<NetworkComparison>{
 if(busy)throw new Error('A network comparison is already running');
 if(!sim.isReady()||!Number.isInteger(node)||node<0||node>=(sim.getLatest()?.e.length??0)||
  !Number.isFinite(gB)||gB<0||gB>.4||!Number.isInteger(durationMs)||durationMs<1000||durationMs>5000)
  throw new RangeError('Invalid network comparison settings');
 busy=true;sim.pause();const comparisonId=crypto.randomUUID(),originId='network-comparison-'+comparisonId+'-origin';
 let originSaved=false;
 try{
  const saved=await sim.saveSnapshot(originId);originSaved=true;
  const origin=sim.getSavedSnapshot(originId)!;
  const kernel=JSON.parse(origin.json) as {e:number[];i:number[];params:{g:number}};
  const first:NativeSample={t_ms:saved.t_ms,e:new Float64Array(kernel.e),i:new Float64Array(kernel.i)};
  const runBranch=async(label:'a'|'b',g:number):Promise<NetworkBranch>=>{
   await sim.restoreSnapshot(originId);
   if(label==='b')sim.setParams({g});
   await advanceBranch(sim,saved.t_ms+durationMs,durationMs);
   const history=sim.getNativeHistory().filter(s=>s.t_ms>saved.t_ms&&s.t_ms<=saved.t_ms+durationMs);
   if(history.length!==durationMs||history.some((s,i)=>s.t_ms!==saved.t_ms+i+1))throw new Error('Incomplete native branch history');
   const snapshotId='network-comparison-'+comparisonId+'-'+label;
   await sim.saveSnapshot(snapshotId);
   return {snapshotId,stateJson:sim.getSavedSnapshot(snapshotId)!.json,markers:sim.getMarkers().map(m=>({...m})),
    feedbackEvents:sim.getExperimentBundle().nativeFeedback.events,run:sim.getExperimentSession(),samples:[first,...history],g};
  };
  const a=await runBranch('a',kernel.params.g),b=await runBranch('b',gB);
  let sum=0,max=0;
  for(let j=0;j<a.samples.length;j++){
   const av=a.samples[j].e,bv=b.samples[j].e;sum+=(av[node]-bv[node])**2;
   for(let k=0;k<av.length;k++)max=Math.max(max,Math.abs(av[k]-bv[k]));
  }
  return {schemaVersion:1,model:'rust-wasm-wilson-cowan-76',originSnapshotId:originId,originJson:origin.json,
   originRunId:origin.sourceRunId??a.run.provenance.parentRunId??'',startMs:saved.t_ms,durationMs,node,a,b,
   metrics:{selectedRmsDifference:Math.sqrt(sum/a.samples.length),globalMaxDifference:max}};
 }finally{
  try{if(originSaved)await sim.restoreSnapshot(originId);}finally{busy=false;}
 }
}
export function networkComparisonJson(result:NetworkComparison):string {
 return JSON.stringify(result,(_key,value)=>value instanceof Float64Array?Array.from(value):value,2);
}
