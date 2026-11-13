import {getPhysicalSource,getPhysicalFixture} from './physicalExperiment';
import {sphereElectrodePotentials,type SphereFixture} from './sphereForward';
import {DEFAULT_MORPHOLOGY} from './localCorticalColumn';
import type {FeedbackEegMapping} from './nativeFeedback';
/** Freeze a primary-source measurement operator, not an anatomical network registration.
 * Neural activity modulates the primary source via explicit, uncalibrated assumptions.
 */
export function physicalFeedbackMapping(fallback:SphereFixture|null):FeedbackEegMapping {
 const state=getPhysicalSource(),model=getPhysicalFixture()??fallback;
 if(!model||model.model_id!==state.modelId)throw new Error('The selected physical model is not ready');
 const v=sphereElectrodePotentials(model,state.position,state.direction,state.montage,state.reference);
 const index=v.sensors.findIndex(s=>s.label===state.electrode);
 if(index<0)throw new Error('The selected sensor is absent from this montage');
 return {gainUvPerNAm:v.voltageUv[index],baselineE:0,baselineI:0,lowpassHz:40,
  morphology:{...DEFAULT_MORPHOLOGY},modelId:model.model_id,electrode:state.electrode,
  sourcePositionMm:[...state.position],direction:[...state.direction],reference:{...state.reference},
  electrodes:v.sensors.map(s=>({label:s.label,positionMm:[...s.position_mm]})),mapping:'assumed-primary-source'};
}
