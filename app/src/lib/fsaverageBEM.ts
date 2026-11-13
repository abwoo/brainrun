/**
 * Human template MRI/BEM EEG lead-field runtime (optional local asset).
 *
 * Produced by scientific/forward/generate_fsaverage_bem.py from FreeSurfer's
 * fsaverage human template; public derivatives carry the FreeSurfer 1.0 terms and modification notice.
 * HEAD RAS coordinates in millimetres, source current dipoles in nA.m,
 * electrode potential in µV. The forward matrix was solved by MNE offline.
 *
 * Crucially, there is NO implicit interpolation between unrelated cortical
 * source vertices: pointer selection SNAPS to a precomputed physical source.
 * No unvalidated MNI/Talairach or TVB coordinate conversion is performed.
 */
import type { Vec3Mm } from './volumeConduction';

export const FSAVERAGE_BEM_MODEL_ID = 'fsaverage-mne-three-layer-bem-v1';

export interface HeadMesh {
  vertices_head_mm: Vec3Mm[];
  triangles: [number, number, number][];
}
export interface CorticalNode {
  hemisphere: 'lh' | 'rh';
  vertex: number;
  head_mm: Vec3Mm;
  /** Original MNE cortical normal rotated from MRI to HEAD; signed orientation. */
  normal_head_unit: Vec3Mm;
  /** MNE/FreeSurfer mni_tal (MNI305), NOT MNI152 or true Talairach. */
  mni305_mm: Vec3Mm;
  atlas: string;
  region: string;
}
export interface RegisteredElectrode {
  label: string;
  head_mm: Vec3Mm;
}
export interface LocalFsaverageBEM {
  model_id: string;
  subject: 'fsaverage';
  subject_type: string;
  montage: string;
  frame: 'HEAD_RAS_MM';
  gain_unit: 'uV_per_nA_m';
  source_moment_unit: 'nA_m';
  interpolation: string;
  license_status: string;
  distribution_notice?:string;license_source?:string;modified_by?:string;
  comparison_sphere?:{description:string;gains_uV_per_nAm:number[][]};
  transform_mri_to_head_rowmajor: number[][];
  transform_mri_to_mni305_rowmajor: number[][];
  standard_coordinate_definition: string;
  source_positions: CorticalNode[];
  electrodes: RegisteredElectrode[];
  gains_uV_per_nAm: number[][];
  meshes: {
    scalp: HeadMesh;
    skull: HeadMesh;
    brain: HeadMesh;
    cortex: {lh: HeadMesh;rh: HeadMesh};
  };
}

export type TemplateReference =
  | {mode:'infinity'}
  | {mode:'average'}
  | {mode:'electrode';label:string};

function xyz(v: unknown, label: string): asserts v is Vec3Mm {
  if (!Array.isArray(v) || v.length !== 3 ||
      !v.every(Number.isFinite)) throw new RangeError('Invalid coordinate: ' + label);
}
function validateMesh(mesh: HeadMesh, name: string): void {
  if (!mesh || !Array.isArray(mesh.vertices_head_mm) ||
      !Array.isArray(mesh.triangles) ||
      mesh.vertices_head_mm.length < 3 || mesh.triangles.length < 1) {
    throw new Error('Missing geometry: ' + name);
  }
  const count=mesh.vertices_head_mm.length;
  mesh.vertices_head_mm.forEach((p,i) => xyz(p,name+' vertex '+i));
  for (const t of mesh.triangles) {
    if (!Array.isArray(t) || t.length!==3 ||
        !t.every(i=>Number.isInteger(i)&&i>=0&&i<count)) {
      throw new Error('Invalid triangle in '+name);
    }
  }
}
export function validateFsaverageBEM(f:LocalFsaverageBEM):void {
  if (!f || f.model_id!==FSAVERAGE_BEM_MODEL_ID ||
      f.subject!=='fsaverage' || f.frame!=='HEAD_RAS_MM' ||
      f.gain_unit!=='uV_per_nA_m' || f.source_moment_unit!=='nA_m' ||
      !f.interpolation.startsWith('none') ||
      !['REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET','FREESURFER_1_0_WITH_NOTICE'].includes(f.license_status)) {
    throw new Error('Invalid or unreviewed template BEM model metadata');
  }
  if(f.license_status==='FREESURFER_1_0_WITH_NOTICE'&&(
    !f.distribution_notice?.includes('PART B. DOWNLOADING AGREEMENT')||
    !f.distribution_notice?.includes('All or portions of this licensed product')||!f.modified_by))
    throw new Error('Missing FreeSurfer distribution terms or modification notice');
  if (!Array.isArray(f.transform_mri_to_head_rowmajor) ||
      f.transform_mri_to_head_rowmajor.length!==4 ||
      f.transform_mri_to_head_rowmajor.some(row=>
        !Array.isArray(row)||row.length!==4||!row.every(Number.isFinite))) {
    throw new Error('Missing explicit MRI to HEAD transform');
  }
  if (!Array.isArray(f.transform_mri_to_mni305_rowmajor) ||
      f.transform_mri_to_mni305_rowmajor.length!==4 ||
      f.transform_mri_to_mni305_rowmajor.some(row=>
        !Array.isArray(row)||row.length!==4||!row.every(Number.isFinite)) ||
      !f.standard_coordinate_definition.includes('MNI305') ||
      !f.standard_coordinate_definition.includes('not MNI152')) {
    throw new Error('MNI305 transform must be sourced and must not masquerade as MNI152/Talairach');
  }
  if (!Array.isArray(f.source_positions) || !f.source_positions.length ||
      !Array.isArray(f.electrodes) || !f.electrodes.length ||
      !Array.isArray(f.gains_uV_per_nAm) ||
      f.gains_uV_per_nAm.length!==f.electrodes.length) {
    throw new Error('Invalid BEM source/electrode dimensions');
  }
  for (const source of f.source_positions) {
    xyz(source.head_mm,'cortical source');
    xyz(source.normal_head_unit,'source normal');
    if (Math.abs(Math.hypot(...source.normal_head_unit)-1)>1e-3) {
      throw new Error('Cortical normal is not a unit direction');
    }
    xyz(source.mni305_mm,'FreeSurfer MNI305 coordinate');
    if (!['lh','rh'].includes(source.hemisphere) ||
        !Number.isInteger(source.vertex) || source.vertex<0 ||
        typeof source.region!=='string' || typeof source.atlas!=='string') {
      throw new Error('Invalid cortical vertex source or atlas label');
    }
  }
  const labels=new Set<string>();
  for (let i=0;i<f.electrodes.length;i++){
    const e=f.electrodes[i];xyz(e.head_mm,'electrode');
    if (!e.label || labels.has(e.label)) throw new Error('Duplicate/blank EEG electrode');
    labels.add(e.label);
    const row=f.gains_uV_per_nAm[i];
    if (!Array.isArray(row) || row.length!==3*f.source_positions.length ||
        !row.every(Number.isFinite)) {
      throw new Error('Invalid BEM lead-field or physical unit data');
    }
  }
  validateMesh(f.meshes.scalp,'scalp');
  validateMesh(f.meshes.skull,'skull');
  validateMesh(f.meshes.brain,'brain');
  validateMesh(f.meshes.cortex.lh,'left cortical surface');
  validateMesh(f.meshes.cortex.rh,'right cortical surface');
}
export function findNearestValidatedSource(
  fixture:LocalFsaverageBEM, targetHeadMm:Vec3Mm,
  allowedHemisphere?:'lh'|'rh',
): {index:number;distanceMm:number} {
  xyz(targetHeadMm,'target');
  let index=-1, min=Infinity;
  fixture.source_positions.forEach((node,i)=>{
    if (allowedHemisphere && node.hemisphere!==allowedHemisphere) return;
    const d=Math.hypot(...node.head_mm.map((v,k)=>v-targetHeadMm[k]));
    if (d<min){min=d;index=i;}
  });
  if (index<0)throw new RangeError('No precomputed cortex source in requested hemisphere');
  return {index,distanceMm:min};
}
export function templateSourcePotentials(
  fixture:LocalFsaverageBEM, sourceIndex:number, dipoleMomentNAm:Vec3Mm,
  reference:TemplateReference={mode:'average'},
): number[]{
  if (!Number.isInteger(sourceIndex) || sourceIndex<0 ||
      sourceIndex>=fixture.source_positions.length)
      throw new RangeError('Source index outside precomputed cortical space');
  xyz(dipoleMomentNAm,'dipole moment');
  const offset=3*sourceIndex;
  const values=fixture.gains_uV_per_nAm.map(row=>
    row[offset]*dipoleMomentNAm[0] +
    row[offset+1]*dipoleMomentNAm[1] +
    row[offset+2]*dipoleMomentNAm[2]);
  let ref=0;
  if(reference.mode==='average')ref=values.reduce((a,b)=>a+b,0)/values.length;
  else if(reference.mode==='electrode') {
    const i=fixture.electrodes.findIndex(e=>e.label===reference.label);
    if(i===-1)throw new RangeError('Unknown registered electrode');
    ref=values[i];
  } else if(reference.mode!=='infinity'){
    throw new Error('Invalid reference');
  }
  return values.map(v=>v-ref);
}

/** Cache only the validated template; every downstream view uses this exact matrix. */
let publicTemplate:LocalFsaverageBEM|null=null;
export function registerTemplateModel(model:LocalFsaverageBEM):void {validateFsaverageBEM(model);publicTemplate=model;}
export function getTemplateModel():LocalFsaverageBEM|null{return publicTemplate;}
