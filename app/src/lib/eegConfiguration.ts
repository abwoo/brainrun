import type { EegRecording, EegReference, NoiseParams } from './eegData.ts';
import type { MontageKey } from './sphereForward.ts';
export interface EegRunConfiguration {
 sourceModel:'wc'|'jr'|'both'; durationMs:number; montage:MontageKey;
 reference:EegReference; noise:NoiseParams|null; seed:number;
}
export const defaultEegConfiguration=():EegRunConfiguration=>({
 sourceModel:'wc',durationMs:10000,montage:'10-20',reference:{mode:'average'},noise:null,seed:1,
});
export function configurationForRecording(rec:EegRecording|null):EegRunConfiguration {
 if(!rec)return defaultEegConfiguration();
 const source=rec.experiment?.parameters.sourceModel;
 return {
  sourceModel:source==='wc'||source==='jr'||source==='both'?source:
   rec.sourceModelId.includes('jansen')?'jr':rec.sourceModelId.includes('dual')?'both':'wc',
  durationMs:rec.timesMs.length?rec.timesMs[rec.timesMs.length-1]-rec.timesMs[0]:10000,
  montage:rec.montage,reference:{...rec.reference},noise:rec.noise?{...rec.noise}:null,seed:rec.seed,
 };
}
export function configurationsEqual(a:EegRunConfiguration,b:EegRunConfiguration):boolean {
 return a.sourceModel===b.sourceModel&&a.durationMs===b.durationMs&&a.montage===b.montage&&a.seed===b.seed
 &&a.reference.mode===b.reference.mode
 &&(a.reference.mode!=='electrode'||b.reference.mode==='electrode'&&a.reference.label===b.reference.label)
 &&(['whiteRmsUv','pinkRmsUv','line50HzRmsUv','driftRmsUv'] as const).every(k=>(a.noise?.[k]??0)===(b.noise?.[k]??0));
}
