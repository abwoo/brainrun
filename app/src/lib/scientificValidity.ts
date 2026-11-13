import type {EegRecording,EpochSet} from './eegData.ts';
/** An interpolation/output grid never increases the information bandwidth.
 * This is an analysis ceiling, not a promise of flat passband or calibration.
 */
export function analysisBandwidthHz(data:EegRecording|EpochSet):number {
 let limit=data.sfreqHz/2;
 if(data.effectiveBandwidthHz!==undefined)limit=Math.min(limit,data.effectiveBandwidthHz);
 if('acquisition' in data&&data.acquisition)limit=Math.min(limit,data.acquisition.filter.cutoffHz);
 if(data.provenance&&'effectiveSourceSnapshotHz' in data.provenance){
  const rate=data.provenance.effectiveSourceSnapshotHz;
  if(typeof rate==='number')limit=Math.min(limit,rate/2);
 }
 if(!Number.isFinite(limit)||limit<=0)throw new Error('Invalid signal bandwidth metadata');
 return limit;
}
export function supportedAnalysisFrequencies(data:EegRecording|EpochSet,frequencies:number[]):number[]{
 const limit=analysisBandwidthHz(data);return frequencies.filter(f=>Number.isFinite(f)&&f>0&&f<limit);
}
