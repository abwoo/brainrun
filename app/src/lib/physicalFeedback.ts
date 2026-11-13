import {getHeadModelSelection} from './headModelSelection.ts';
import {getTemplateMeasurementSource} from './templateExperiment.ts';
import {getTemplateModel,templateSourcePotentials} from './fsaverageBEM.ts';
import {getPhysicalSource,getPhysicalFixture} from './physicalExperiment.ts';
import {sphereElectrodePotentials,type SphereFixture} from './sphereForward.ts';
import {DEFAULT_MORPHOLOGY} from './localCorticalColumn.ts';
import type {FeedbackEegMapping} from './nativeFeedback.ts';
/** Freeze a primary-source measurement operator, not an anatomical network registration.
 * Neural activity modulates the primary source via explicit, uncalibrated assumptions.
 */
export function physicalFeedbackMapping(fallback:SphereFixture|null):FeedbackEegMapping {
 if(getHeadModelSelection()==='bem'){
  const model=getTemplateModel(),state=getTemplateMeasurementSource();
  if(!model)throw new Error('The selected template BEM is not ready');
  if(!['10-20','10-10','10-05'].includes(model.montage))throw new Error('Unsupported template montage');
  const source=model.source_positions[state.sourceIndex];
  if(!source)throw new Error('The selected cortical source is absent');
  const values=templateSourcePotentials(model,state.sourceIndex,state.direction,state.reference);
  const index=model.electrodes.findIndex(e=>e.label===state.electrode);
  if(index<0)throw new Error('The selected template sensor is absent');
  return {headModel:'bem',coordinateFrame:'HEAD_RAS_MM',montage:model.montage as FeedbackEegMapping['montage'],
   gainUvPerNAm:values[index],baselineE:0,baselineI:0,lowpassHz:40,morphology:{...DEFAULT_MORPHOLOGY},
   modelId:model.model_id,electrode:state.electrode,sourcePositionMm:[...source.head_mm],direction:[...state.direction],
   reference:{...state.reference},electrodes:model.electrodes.map(e=>({label:e.label,positionMm:[...e.head_mm]})),
   sourceRevision:state.revision,templateSource:{index:state.sourceIndex,vertex:source.vertex,hemisphere:source.hemisphere,
    atlas:source.atlas,region:source.region,anatomicalRegistration:'MNE-fsaverage-MRI-to-HEAD'},
   mapping:'assumed-primary-source'};
 }
 const state=getPhysicalSource(),model=getPhysicalFixture()??fallback;
 if(!model||model.model_id!==state.modelId)throw new Error('The selected physical model is not ready');
 const v=sphereElectrodePotentials(model,state.position,state.direction,state.montage,state.reference,state.selectedLabels);
 const index=v.sensors.findIndex(s=>s.label===state.electrode);
 if(index<0)throw new Error('The selected sensor is absent from this montage');
 return {...(model.fem?{forwardNumerics:{...model.fem}}:{}),headModel:'sphere',coordinateFrame:'head-RAS-sphere-centered',sourceRevision:state.revision,montage:state.montage,gainUvPerNAm:v.voltageUv[index],baselineE:0,baselineI:0,lowpassHz:40,
  morphology:{...DEFAULT_MORPHOLOGY},modelId:model.model_id,electrode:state.electrode,
  sourcePositionMm:[...state.position],direction:[...state.direction],reference:{...state.reference},
  electrodes:v.sensors.map(s=>({label:s.label,positionMm:[...s.position_mm]})),mapping:'assumed-primary-source'};
}
