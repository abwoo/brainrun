import type {Vec3Mm} from './volumeConduction.ts';
import type {EegChannel,EegReference} from './eegData.ts';
import {getHeadModelSelection} from './headModelSelection.ts';
import {getPhysicalSource,getPhysicalFixture} from './physicalExperiment.ts';
import {getTemplateMeasurementSource} from './templateExperiment.ts';
import {getTemplateModel,templateSourcePotentials} from './fsaverageBEM.ts';
import {sphereElectrodePotentials,type SphereFixture,type MontageKey} from './sphereForward.ts';
import {setForwardContext} from './forwardContext.ts';
export interface PhysicalProjection {
 version:1;headModel:'sphere'|'bem';modelId:string;coordinateFrame:'head-RAS-sphere-centered'|'HEAD_RAS_MM';
 sourceUsage:'native-primary-geometry-only';sourcePositionMm:Vec3Mm;direction:Vec3Mm;sourceRevision:number;
 montage:MontageKey;reference:EegReference;channels:EegChannel[];infinityGainUvPerNAm:number[];
 sphereGeometry?:{electrodeVertices:Record<string,number>;selectedLabels?:readonly string[]};
 templateSource?:{index:number;vertex:number;hemisphere:'lh'|'rh';atlas:string;region:string;anatomicalRegistration:'MNE-fsaverage-MRI-to-HEAD'};
}
export function validatePhysicalProjection(p:PhysicalProjection):void {
 const reference=p?.reference;
 if(!p||p.version!==1||p.sourceUsage!=='native-primary-geometry-only'||!p.modelId||
  !['sphere','bem'].includes(p.headModel)||!['10-20','10-10','10-05'].includes(p.montage)||
  !Number.isInteger(p.sourceRevision)||p.sourceRevision<0||
  p.sourcePositionMm?.length!==3||!p.sourcePositionMm.every(Number.isFinite)||
  p.direction?.length!==3||!p.direction.every(Number.isFinite)||Math.abs(Math.hypot(...p.direction)-1)>1e-8||
  !Array.isArray(p.channels)||!p.channels.length||new Set(p.channels.map(c=>c.label)).size!==p.channels.length||
  p.channels.some(c=>!c.label||c.positionMm?.length!==3||!c.positionMm.every(Number.isFinite))||
  !Array.isArray(p.infinityGainUvPerNAm)||p.infinityGainUvPerNAm.length!==p.channels.length||!p.infinityGainUvPerNAm.every(Number.isFinite)||
  !reference||!['average','infinity','electrode'].includes(reference.mode)||
  (reference.mode==='electrode'&&!p.channels.some(c=>c.label===reference.label))||
  (p.headModel==='sphere'&&p.coordinateFrame!=='head-RAS-sphere-centered')||
  (p.headModel==='bem'&&(p.coordinateFrame!=='HEAD_RAS_MM'||!p.templateSource||
    !Number.isInteger(p.templateSource.index)||p.templateSource.index<0||!Number.isInteger(p.templateSource.vertex)||p.templateSource.vertex<0||
    !['lh','rh'].includes(p.templateSource.hemisphere)||p.templateSource.anatomicalRegistration!=='MNE-fsaverage-MRI-to-HEAD')))
  throw new Error('Invalid physical projection geometry, frame or channels');
}
/** Capture the primary geometry. Native E/I supplies q(t); manual strength/pulse/second source do not. */
export function capturePhysicalProjection(fallback:SphereFixture|null=null):PhysicalProjection {
 if(getHeadModelSelection()==='bem'){
  const model=getTemplateModel(),state=getTemplateMeasurementSource();
  if(!model)throw new Error('Selected template BEM is not ready');
  const source=model.source_positions[state.sourceIndex];if(!source)throw new Error('Selected BEM source is absent');
  const p:PhysicalProjection={version:1,headModel:'bem',modelId:model.model_id,coordinateFrame:'HEAD_RAS_MM',
   sourceUsage:'native-primary-geometry-only',sourcePositionMm:[...source.head_mm],direction:[...state.direction],sourceRevision:state.revision,
   montage:model.montage as MontageKey,reference:{...state.reference},channels:model.electrodes.map(e=>({label:e.label,positionMm:[...e.head_mm] as Vec3Mm})),
   infinityGainUvPerNAm:templateSourcePotentials(model,state.sourceIndex,state.direction,{mode:'infinity'}),
   templateSource:{index:state.sourceIndex,vertex:source.vertex,hemisphere:source.hemisphere,atlas:source.atlas,region:source.region,
    anatomicalRegistration:'MNE-fsaverage-MRI-to-HEAD'}};
  validatePhysicalProjection(p);setForwardContext(p,{bem:model});return p;
 }
 const model=getPhysicalFixture()??fallback,state=getPhysicalSource();
 if(!model||model.model_id!==state.modelId)throw new Error('Selected physical sphere is not ready');
 const result=sphereElectrodePotentials(model,state.position,state.direction,state.montage,{mode:'infinity'},state.selectedLabels);
 const p:PhysicalProjection={version:1,headModel:'sphere',modelId:model.model_id,coordinateFrame:'head-RAS-sphere-centered',
  sourceUsage:'native-primary-geometry-only',sourcePositionMm:[...state.position],direction:[...state.direction],sourceRevision:state.revision,
  montage:state.montage,reference:{...state.reference},channels:result.sensors.map(s=>({label:s.label,positionMm:[...s.position_mm] as Vec3Mm})),
  infinityGainUvPerNAm:[...result.voltageUv],sphereGeometry:{electrodeVertices:{...state.electrodeVertices},
   ...(state.selectedLabels?{selectedLabels:[...state.selectedLabels]}:{})}};
 validatePhysicalProjection(p);setForwardContext(p,{sphere:model});return p;
}

export function physicalProjectionReady(fallback:SphereFixture|null=null):boolean {
 if(getHeadModelSelection()==='bem')return getTemplateModel()!==null;
 const model=getPhysicalFixture()??fallback;return !!model&&model.model_id===getPhysicalSource().modelId;
}
