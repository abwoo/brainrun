/** Scientific acquisition reads EVERY integration step; display frames are independent. */
export interface NativeSample {t_ms:number;e:Float64Array;i:Float64Array}
export interface NativeChunk {
 type:'native_samples';run_id:string;start_ms:number;dt_ms:number;n_nodes:number;n_samples:number;
 /** Row-major: E[0..n_nodes), I[0..n_nodes) for every integration state. */
 values:Float64Array;
}
interface Integrator {
 time_ms():number;dt_ms():number;n_nodes():number;step():boolean;
 snapshot_e():Float64Array;snapshot_i():Float64Array;
}
export function advanceAcquiring(sim:Integrator,ms:number,run_id:string,hooks?:{beforeStep?:(tMs:number)=>void;afterStep?:(tMs:number,e:Float64Array)=>void}):NativeChunk {
 if(!Number.isFinite(ms)||ms<0)throw new RangeError('Invalid integration duration');
 const dt=sim.dt_ms(),n=sim.n_nodes(),start=sim.time_ms(),values:number[]=[];
 const capture=(integrated=false)=>{const e=sim.snapshot_e();values.push(...e,...sim.snapshot_i());if(integrated)hooks?.afterStep?.(sim.time_ms(),e);};
 capture();
 for(let j=0;j<Math.round(ms/dt);j++){hooks?.beforeStep?.(sim.time_ms());if(!sim.step())break;capture(true);}
 return {type:'native_samples',run_id,start_ms:start,dt_ms:dt,n_nodes:n,
  n_samples:values.length/(2*n),values:new Float64Array(values)};
}
export function appendNativeChunk(history:NativeSample[],chunk:NativeChunk,maxSpanMs=10000):void {
 if(chunk.values.length!==chunk.n_nodes*chunk.n_samples*2||chunk.dt_ms!==1)
  throw new Error('Invalid native integration block');
 for(let j=0;j<chunk.n_samples;j++){
  const t_ms=chunk.start_ms+j*chunk.dt_ms;
  if(history.length&&t_ms<=history[history.length-1].t_ms)continue;
  const offset=j*chunk.n_nodes*2;
  history.push({t_ms,e:chunk.values.subarray(offset,offset+chunk.n_nodes),
   i:chunk.values.subarray(offset+chunk.n_nodes,offset+2*chunk.n_nodes)});
 }
 if(history.length){
  const cutoff=history[history.length-1].t_ms-maxSpanMs;
  const first=history.findIndex(s=>s.t_ms>=cutoff);
  if(first>0)history.splice(0,first);
 }
}
/** Offline, centered windowed-sinc FIR; only fully supported samples are emitted. */
export function filterAndDecimate(values:readonly number[],rate:250|500):{
 values:number[];offsetMs:number;stepMs:number;cutoffHz:number;taps:number
} {
 if(rate!==250&&rate!==500)throw new RangeError('Native EEG supports 250 or 500 Hz');
 const taps=129,half=(taps-1)/2,fc=rate*.4/1000,stepMs=1000/rate;
 if(values.length<taps)throw new RangeError('Insufficient integration samples for FIR');
 if(values.some(x=>!Number.isFinite(x)))throw new RangeError('Nonfinite source sample');
 const kernel=Array.from({length:taps},(_,j)=>{
  const k=j-half;
  return (k===0?2*fc:Math.sin(2*Math.PI*fc*k)/(Math.PI*k))*(.54-.46*Math.cos(2*Math.PI*j/(taps-1)));
 });
 const sum=kernel.reduce((a,b)=>a+b,0);
 const out:number[]=[];
 for(let center=half;center<values.length-half;center+=stepMs){
  let y=0;for(let j=0;j<taps;j++)y+=values[center-half+j]*kernel[j]/sum;
  out.push(y);
 }
 return {values:out,offsetMs:half,stepMs,cutoffHz:rate*.4,taps};
}
