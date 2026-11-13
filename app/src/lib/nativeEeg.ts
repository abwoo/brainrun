import type { EegRecording,EegEvent } from './eegData.ts';
import { channelsForMontage,projectMoments,applyReference,generateNoise,clampSourcePositionMm,
 type RunLiveExperimentOptions } from './eegRecording.ts';
import {equivalentMomentNAm} from './localCorticalColumn.ts';
import {filterAndDecimate} from './nativeAcquisition.ts';
export const NATIVE_EEG_ID='live-wc-integration-fir-v1';
export function runNativeExperiment(opts:RunLiveExperimentOptions & {sfreqHz?:250|500}):{
 recording:EegRecording;events:EegEvent[];t0Ms:number;sourcePositionMm:readonly[number,number,number]
}{
 const rate=opts.sfreqHz??250,samples=opts.samples,node=opts.node;
 if(samples.length<1001)throw new RangeError('Need at least 1 s of native integration history');
 if(!Number.isInteger(node)||node<0||node>=samples[0].e.length)throw new RangeError('Invalid source node');
 const moments=samples.map((s,j)=>{
  if(j&&Math.abs(s.t_ms-samples[j-1].t_ms-1)>1e-8)throw new Error('Native integration history has a gap');
  if(s.e.length!==samples[0].e.length||s.i.length!==s.e.length)throw new Error('Native state dimensions differ');
  if(![s.e[node],s.i[node],s.t_ms,opts.baselineE,opts.baselineI].every(Number.isFinite))
    throw new Error('Invalid native integration value');
  return equivalentMomentNAm(s.e[node],s.i[node],opts.baselineE,opts.baselineI,opts.morphology);
 });
 const filtered=filterAndDecimate(moments,rate);
 const t0Ms=samples[0].t_ms+filtered.offsetMs;
 const timesMs=filtered.values.map((_,j)=>j*filtered.stepMs);
 const montage=opts.montage??'10-20',reference=opts.reference??{mode:'average'};
 const sourcePositionMm=clampSourcePositionMm(opts.fixture,opts.positionMm);
 const channels=channelsForMontage(opts.fixture,montage);
 const raw=projectMoments(opts.fixture,sourcePositionMm,opts.normalHead??[0,0,1],filtered.values,montage);
 const noise=opts.noise??null,seed=opts.seed??1;
 if(noise){
  const generated=generateNoise(noise,channels.length,timesMs.length,rate,seed);
  for(let c=0;c<channels.length;c++)for(let j=0;j<timesMs.length;j++)raw[c][j]+=generated.total[c][j];
 }
 const recording:EegRecording={
  version:1,sfreqHz:rate,timesMs,channels,dataUv:applyReference(raw,reference,channels.map(c=>c.label)),
  rawDataUvInfinity:raw,reference:{...reference},montage,forwardModelId:opts.fixture.model_id,
  sourceModelId:NATIVE_EEG_ID,seed,noise,
  sourceSeries:{coordinateFrame:'head-RAS-sphere-centered',mapping:'tvb-demo-unregistered',
   sources:[{positionMm:sourcePositionMm,direction:opts.normalHead??[0,0,1],momentsNAm:filtered.values}]},
  acquisition:{source:'solver-integration',integrationRateHz:1000,sampleRateHz:rate,
   validStartMs:t0Ms,validEndMs:t0Ms+(timesMs.at(-1)??0),
   filter:{method:'centered-Hamming-sinc-FIR',taps:filtered.taps,cutoffHz:filtered.cutoffHz,
    discardedEdgeMs:filtered.offsetMs,phase:'offline-zero-phase'}},
 };
 const events:EegEvent[]=[];
 for(const marker of opts.markers??[]){
  const tMs=marker.t_ms-t0Ms;
  if(marker.kind==='pulse'&&marker.node===node&&tMs>=0&&tMs<=(timesMs.at(-1)??0))
   events.push({id:events.length,type:'pulse',condition:'unclassified',tMs,drive:marker.amplitude??1,driveUnit:'wc'});
 }
 return {recording,events,t0Ms,sourcePositionMm};
}
