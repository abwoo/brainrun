/** Fixed model-clock feedback on dimensionless neural E, never browser frames.
 * A full native window is required for RMS. A decision at t schedules input
 * no earlier than t+1 ms. This is a simulation controller, not device control.
 */
export interface NativeFeedbackConfig {
 node:number;feature:'instant'|'rms';threshold:number;amplitude:number;durationMs:number;
 periodMs:number;windowMs:number;cooldownMs:number;delayMs:number;maxTriggers:number;
}
export interface FeedbackAction {id:number;detectedMs:number;applyMs:number;featureValue:number;node:number;amplitude:number;durationMs:number;}
export interface NativeFeedbackSnapshot {
 config:NativeFeedbackConfig;startedMs:number;nextEvalMs:number;count:number;lastTriggerMs:number|null;
 samples:Array<{tMs:number;value:number}>;pending:FeedbackAction[];
}
export function validateFeedbackConfig(c:NativeFeedbackConfig,nNodes:number):void {
 if(!c||!Number.isInteger(c.node)||c.node<0||c.node>=nNodes||!['instant','rms'].includes(c.feature)||
  !Number.isFinite(c.threshold)||c.threshold<0||c.threshold>1||!Number.isFinite(c.amplitude)||Math.abs(c.amplitude)>2||
  ![c.durationMs,c.periodMs,c.windowMs,c.cooldownMs,c.delayMs,c.maxTriggers].every(Number.isInteger)||
  c.durationMs<1||c.durationMs>500||c.periodMs<1||c.periodMs>1000||c.windowMs<1||c.windowMs>10000||
  c.cooldownMs<0||c.delayMs<0||c.delayMs>5000||c.maxTriggers<1||c.maxTriggers>100)
  throw new RangeError('Invalid native feedback configuration');
}
export class NativeFeedback {
 private state:NativeFeedbackSnapshot;
 constructor(config:NativeFeedbackConfig,nNodes:number,startedMs:number){
  validateFeedbackConfig(config,nNodes);
  if(!Number.isInteger(startedMs)||startedMs<0)throw new RangeError('Invalid controller start time');
  this.state={config:{...config},startedMs,
   nextEvalMs:startedMs+(config.feature==='rms'?Math.ceil(config.windowMs/config.periodMs)*config.periodMs:config.periodMs),
   count:0,lastTriggerMs:null,samples:[],pending:[]};
 }
 get active():boolean {return this.state.count<this.state.config.maxTriggers||this.state.pending.length>0;}
 snapshot():NativeFeedbackSnapshot {return JSON.parse(JSON.stringify(this.state)) as NativeFeedbackSnapshot;}
 static restore(data:NativeFeedbackSnapshot,nNodes:number):NativeFeedback {
  const restored=new NativeFeedback(data.config,nNodes,data.startedMs);
  if(!Number.isInteger(data.nextEvalMs)||data.nextEvalMs<data.startedMs||!Number.isInteger(data.count)||data.count<0||data.count>data.config.maxTriggers||
   (data.lastTriggerMs!==null&&(!Number.isInteger(data.lastTriggerMs)||data.lastTriggerMs<data.startedMs))||
   !Array.isArray(data.samples)||data.samples.length>data.config.windowMs+1||
   data.samples.some((s,i)=>!Number.isInteger(s.tMs)||!Number.isFinite(s.value)||s.value<0||s.value>1||(i>0&&s.tMs<=data.samples[i-1].tMs))||
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
 afterStep(tMs:number,e:Float64Array):FeedbackAction|null {
  const s=this.state,c=s.config,value=e[c.node];
  if(!Number.isFinite(value))throw new Error('Invalid native E sample');
  if(s.samples.length&&tMs<=s.samples[s.samples.length-1].tMs)throw new Error('Non-monotone controller clock');
  s.samples.push({tMs,value});while(s.samples.length&&s.samples[0].tMs<=tMs-c.windowMs)s.samples.shift();
  if(tMs<s.nextEvalMs||s.count>=c.maxTriggers)return null;
  s.nextEvalMs+=c.periodMs;
  if(c.feature==='rms'&&s.samples.length<c.windowMs)return null;
  const featureValue=c.feature==='instant'?value:Math.sqrt(s.samples.reduce((sum,v)=>sum+v.value*v.value,0)/s.samples.length);
  if(featureValue<=c.threshold||(s.lastTriggerMs!==null&&tMs-s.lastTriggerMs<c.cooldownMs))return null;
  s.count++;s.lastTriggerMs=tMs;
  const action:FeedbackAction={id:s.count,detectedMs:tMs,applyMs:tMs+c.delayMs+1,featureValue,
   node:c.node,amplitude:c.amplitude,durationMs:c.durationMs};
  s.pending.push(action);return {...action};
 }
}
