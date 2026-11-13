import {ExperimentSession,type ExperimentSessionSnapshot} from './experimentSession.ts';
import type {WorkerOutMessage} from '../worker/protocol.ts';
import type {EegRecording,EegEvent,EegReference} from './eegData.ts';
import type {Vec3Mm} from './volumeConduction.ts';
type Measurement=Extract<WorkerOutMessage,{type:'native_feedback'}>;
export const FEEDBACK_EEG_ID='native-feedback-physical-eeg-v1';
/** Copy the actual measured native window. Never re-synthesize from display snapshots. */
export function recordingFromFeedback(message:Measurement,upstream:ExperimentSessionSnapshot,history:readonly Measurement[]):{recording:EegRecording;events:EegEvent[]} {
 const state=message.state,m=state?.config.eeg;
 if(message.phase!=='observed'||message.run_id!==upstream.provenance.runId||!state||!m||!m.montage)
  throw new Error('A current physical EEG controller measurement is required');
 const samples=state.samples;
 if(samples.length<2||samples.some((s,i)=>!Number.isFinite(s.value)||!Number.isInteger(s.tMs)||(i>0&&s.tMs!==samples[i-1].tMs+1)))
  throw new Error('At least two consecutive native EEG samples are required');
 if(samples.at(-1)!.tMs!==message.t_ms)throw new Error('Feedback window is not current');
 const sensors=m.electrodes as Array<{label:string;positionMm:number[]}>;
 const sensor=Array.isArray(sensors)?sensors.find(s=>s.label===m.electrode):undefined;
 if(!sensor||sensor.positionMm.length!==3||!sensor.positionMm.every(Number.isFinite))throw new Error('Missing frozen feedback sensor geometry');
 const reference=m.reference as EegReference;
 if(!reference||!['average','infinity','electrode'].includes(reference.mode))throw new Error('Missing frozen feedback reference');
 const t0=samples[0].tMs,timesMs=samples.map(s=>s.tMs-t0),durationMs=timesMs.at(-1)!;
 const session=new ExperimentSession({origin:'live-derived',clock:'solver-integration-ms',solverId:FEEDBACK_EEG_ID,
  anatomyId:m.modelId,registration:'unregistered',seed:upstream.provenance.seed,parentRunId:message.run_id});
 session.recordModelTime(session.runId,durationMs);
 session.recordArtifact({id:'feedback-window',runId:session.runId,kind:'eeg-raw',tMs:0,
  sourceId:'native-controller-node-'+state.config.node,methodId:'causal-first-order-lowpass-v1'});
 const recording:EegRecording={version:1,sfreqHz:1000,effectiveBandwidthHz:m.lowpassHz,timesMs,
  channels:[{label:m.electrode,positionMm:[...sensor.positionMm] as unknown as Vec3Mm}],dataUv:[samples.map(s=>s.value)],
  reference:{...reference},montage:m.montage,forwardModelId:m.modelId,sourceModelId:FEEDBACK_EEG_ID,
  seed:upstream.provenance.seed??0,noise:null,
  provenance:{...session.provenance,upstreamStartMs:t0},
  experiment:{session:session.getSnapshot(),parameters:{sourceNode:state.config.node,measurementOperator:JSON.parse(JSON.stringify(m)),
   montage:m.montage,reference:{...reference},noise:null,seed:upstream.provenance.seed??0,sfreqHz:1000,durationMs,
   upstreamEndMs:message.t_ms,controllerStartedMs:state.startedMs,
   processing:{method:'causal-first-order-lowpass-v1',cutoffHz:m.lowpassHz,phase:'causal',initialValueUv:0,
    filteredFromMs:state.startedMs,exportedWindowStartMs:t0},
   controllerState:JSON.parse(JSON.stringify(state)),
   limitations:'Single measured sensor; retained feedback window, not a full recording. Assumed uncalibrated primary source. No raw infinity-reference channel is retained; re-referencing is unavailable.'}}};
 const events:EegEvent[]=history.filter(e=>e.run_id===message.run_id&&e.phase==='applied'&&e.action&&e.t_ms>=t0&&e.t_ms<=message.t_ms)
  .map((e,i)=>({id:i,runId:session.runId,type:'pulse',condition:'unclassified',tMs:e.t_ms-t0,drive:e.action!.amplitude,driveUnit:'wc'}));
 return {recording,events};
}
