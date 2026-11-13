import {equivalentMomentNAm,validateMorphology,type DipoleMorphology} from './localCorticalColumn.ts';
/** Fixed model-clock feedback on dimensionless neural E, never browser frames.
 * A full native window is required for RMS. A decision at t schedules input
 * no earlier than t+1 ms. This is a simulation controller, not device control.
 */
export interface FeedbackEegMapping {
 gainUvPerNAm:number;baselineE:number;baselineI:number;lowpassHz:number;
 morphology:DipoleMorphology;modelId:string;electrode:string;
 sourcePositionMm:readonly number[];direction:readonly number[];
 reference:unknown;electrodes:unknown;mapping:'assumed-primary-source';
}
export interface NativeFeedbackConfig {
 eeg?:FeedbackEegMapping;
 node:number;feature:'instant'|'rms';threshold:number;amplitude:number;durationMs:number;
 periodMs:number;windowMs:number;cooldownMs:number;delayMs:number;maxTriggers:number;
}
export interface FeedbackAction {id:number;detectedMs:number;applyMs:number;featureValue:number;featureUnit?:'uV'|'E_fraction';node:number;amplitude:number;durationMs:number;}
export interface NativeFeedbackSnapshot {
 lowpassUv?:number;
 config:NativeFeedbackConfig;startedMs:number;nextEvalMs:number;count:number;lastTriggerMs:number|null;
 samples:Array<{tMs:number;value:number}>;pending:FeedbackAction[];
}
export function validateFeedbackConfig(c:NativeFeedbackConfig,nNodes:number):void {
 if(!c||!Number.isInteger(c.node)||c.node<0||c.node>=nNodes||!['instant','rms'].includes(c.feature)||
  !Number.isFinite(c.threshold)||c.threshold<0||c.threshold>(c.eeg?1000:1)||!Number.isFinite(c.amplitude)||Math.abs(c.amplitude)>2||
  ![c.durationMs,c.periodMs,c.windowMs,c.cooldownMs,c.delayMs,c.maxTriggers].every(Number.isInteger)||
  c.durationMs<1||c.durationMs>500||c.periodMs<1||c.periodMs>1000||c.windowMs<1||c.windowMs>10000||
  c.cooldownMs<0||c.delayMs<0||c.delayMs>5000||c.maxTriggers<1||c.maxTriggers>100)
  throw new RangeError('Invalid native feedback configuration');
 if(c.eeg){const m=c.eeg;validateMorphology(m.morphology);
  if(!Number.isFinite(m.gainUvPerNAm)||![m.baselineE,m.baselineI].every(x=>Number.isFinite(x)&&x>=0&&x<=1)||
    !Number.isFinite(m.lowpassHz)||m.lowpassHz<=0||m.lowpassHz>100||!m.modelId||!m.electrode||m.mapping!=='assumed-primary-source'||
    m.sourcePositionMm.length!==3||!m.sourcePositionMm.every(Number.isFinite)||m.direction.length!==3||!m.direction.every(Number.isFinite)||Math.abs(Math.hypot(...m.direction)-1)>1e-8)
   throw new RangeError('Invalid physical EEG feedback mapping');
 }
}
export class NativeFeedback {
 private state:NativeFeedbackSnapshot;
 constructor(config:NativeFeedbackConfig,nNodes:number,startedMs:number){
  validateFeedbackConfig(config,nNodes);
  if(!Number.isInteger(startedMs)||startedMs<0)throw new RangeError('Invalid controller start time');
  this.state={config:JSON.parse(JSON.stringify(config)) as NativeFeedbackConfig,...(config.eeg?{lowpassUv:0}:{}),startedMs,
   nextEvalMs:startedMs+(config.feature==='rms'?Math.ceil(config.windowMs/config.periodMs)*config.periodMs:config.periodMs),
   count:0,lastTriggerMs:null,samples:[],pending:[]};
 }
 get active():boolean {return this.state.count<this.state.config.maxTriggers||this.state.pending.length>0;}
 snapshot():NativeFeedbackSnapshot {return JSON.parse(JSON.stringify(this.state)) as NativeFeedbackSnapshot;}
 static restore(data:NativeFeedbackSnapshot,nNodes:number):NativeFeedback {
  const restored=new NativeFeedback(data.config,nNodes,data.startedMs);
  if((data.config.eeg&&!Number.isFinite(data.lowpassUv))||!Number.isInteger(data.nextEvalMs)||data.nextEvalMs<data.startedMs||!Number.isInteger(data.count)||data.count<0||data.count>data.config.maxTriggers||
   (data.lastTriggerMs!==null&&(!Number.isInteger(data.lastTriggerMs)||data.lastTriggerMs<data.startedMs))||
   !Array.isArray(data.samples)||data.samples.length>data.config.windowMs+1||
   data.samples.some((s,i)=>!Number.isInteger(s.tMs)||!Number.isFinite(s.value)||(!data.config.eeg&&(s.value<0||s.value>1))||(i>0&&s.tMs<=data.samples[i-1].tMs))||
   !Array.isArray(data.pending)||data.pending.some(a=>!Number.isInteger(a.id)||a.id<1||a.id>data.count||
    !Number.isInteger(a.detectedMs)||!Number.isInteger(a.applyMs)||a.applyMs!==a.detectedMs+data.config.delayMs+1||
    a.node!==data.config.node||a.amplitude!==data.config.amplitude||a.durationMs!==data.config.durationMs||!Number.isFinite(a.featureValue)))
   throw new Error('Invalid native feedback snapshot');
  restored.state=JSON.parse(JSON.stringify(data)) as NativeFeedbackSnapshot;return restored;
 }
 beforeStep(tMs:number):FeedbackAction[] {
  const due=this.state.pending.filter(a=>a.applyMs<=tMs);
  this.state.pending=this.state.pending.filter(a=>a.applyMs>tMs);return due;
 }
 afterStep(tMs:number,e:Float64Array,i?:Float64Array):FeedbackAction|null {
  const s=this.state,c=s.config;
  let value=e[c.node];
  if(c.eeg){
   if(!i)throw new Error('Physical EEG feedback requires native E and I');
   const m=c.eeg,q=equivalentMomentNAm(e[c.node],i[c.node],m.baselineE,m.baselineI,m.morphology);
   const rawUv=m.gainUvPerNAm*q,alpha=1-Math.exp(-2*Math.PI*m.lowpassHz/1000);
   s.lowpassUv=(s.lowpassUv??0)+alpha*(rawUv-(s.lowpassUv??0));value=s.lowpassUv;
  }
  if(!Number.isFinite(value))throw new Error('Invalid native E sample');
  if(s.samples.length&&tMs<=s.samples[s.samples.length-1].tMs)throw new Error('Non-monotone controller clock');
  s.samples.push({tMs,value});while(s.samples.length&&s.samples[0].tMs<=tMs-c.windowMs)s.samples.shift();
  if(tMs<s.nextEvalMs||s.count>=c.maxTriggers)return null;
  s.nextEvalMs+=c.periodMs;
  if(c.feature==='rms'&&s.samples.length<c.windowMs)return null;
  const featureValue=c.feature==='instant'?(c.eeg?Math.abs(value):value):Math.sqrt(s.samples.reduce((sum,v)=>sum+v.value*v.value,0)/s.samples.length);
  if(featureValue<=c.threshold||(s.lastTriggerMs!==null&&tMs-s.lastTriggerMs<c.cooldownMs))return null;
  s.count++;s.lastTriggerMs=tMs;
  const action:FeedbackAction={id:s.count,detectedMs:tMs,applyMs:tMs+c.delayMs+1,featureValue,featureUnit:c.eeg?'uV':'E_fraction',
   node:c.node,amplitude:c.amplitude,durationMs:c.durationMs};
  s.pending.push(action);return {...action};
 }
}
