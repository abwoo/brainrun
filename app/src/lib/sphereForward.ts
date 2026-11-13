/**
 * Read-only browser runtime for precomputed analytic MNE or P1-FEM spherical EEG
 * forward lead field. Coordinates are head-RAS, sphere-centred millimetres.
 * All gain coefficients are µV/(nA.m); moments are nA.m.
 *
 * The physical forward solve is performed offline by the identified solver. Live source moves
 * perform TRILINEAR INTERPOLATION between validated grid solutions, not a new
 * BEM/FEM solve. This module must NOT be used as a cortical atlas transform.
 */
import type { Vec3Mm } from './volumeConduction';

export type MontageKey = '10-20' | '10-10' | '10-05';
export type SphereReference = { mode: 'average' | 'infinity' }
  | { mode: 'electrode'; label: string };

export interface SphereSensor {
  label: string;
  /** Sphere-centred head RAS position; mm. */
  position_mm: Vec3Mm;
  /** Original MNE montage head RAS position before radial projection; mm. */
  original_head_mm: Vec3Mm;
}
/** Numerical identity retained in exported projections; the geometry remains spherical. */
export interface FemNumerics {
 solver:'P1-tetrahedral-conductivity';mesh_sha256:string;nodes:number;tetrahedra:number;surface_vertices:number;
 pair_separation_mm:number;source_load:'barycentric-current-balanced-Cartesian-pairs';
 boundary:'insulating-Neumann';datum:'surface-area-mean-zero';relative_residual:number;reciprocity_error:number;
 max_mne_relative_l2:number;offgrid_max_mne_relative_l2:number;validation_scope:string;
 numpy_version:string;scipy_version:string;
}
export const FEM_MODEL_ID='p1-four-layer-spherical-fem-v1';
export const isSphericalFemModel=(id:string):boolean=>[FEM_MODEL_ID,FEM_MODEL_ID+'-skull-0.002',FEM_MODEL_ID+'-skull-0.008'].includes(id);
export function sphereAssetFile(id:string):string {
 const base=isSphericalFemModel(id)?FEM_MODEL_ID:SPHERE_MODEL_ID;
 if(![base,base+'-skull-0.002',base+'-skull-0.008'].includes(id))throw new Error('Unknown spherical conductor');
 const prefix=base===FEM_MODEL_ID?'fem':'sphere';
 return id===base?prefix+'-model.json':prefix+'-skull-'+id.slice(-5)+'.json';
}
export interface SphereFixture {
  fem?:FemNumerics;
  scalp_field_grid?: {
    positions_mm:Vec3Mm[];triangles:number[];gain_uv_per_nAm:number[][];method:string;
  };
  model_id: string;
  coordinate_frame: string;
  mne_version: string;
  radius_mm: number;
  brain_inner_radius_mm: number;
  source_grid_axis_mm: number[];
  conductivities_S_m: number[];
  montages: Record<MontageKey, string[]>;
  sensors: SphereSensor[];
  /** Indexed by sensor; within each row grid index * 3 + XYZ component. */
  gain_uv_per_nAm: number[][];
}
export const SPHERE_MODEL_ID = 'mne-four-layer-sphere-ras-v1';
const MONTAGES: MontageKey[] = ['10-20', '10-10', '10-05'];

export function validateSphereFixture(data: SphereFixture): void {
  const isFem=isSphericalFemModel(data.model_id);
  if ((!isFem&&![SPHERE_MODEL_ID,SPHERE_MODEL_ID+'-skull-0.002',SPHERE_MODEL_ID+'-skull-0.008'].includes(data.model_id)) ||
      data.coordinate_frame !== 'head-RAS-sphere-centered' ||
      !Array.isArray(data.source_grid_axis_mm) ||
      data.source_grid_axis_mm.length < 2 ||
      !data.source_grid_axis_mm.every(Number.isFinite) ||
      !Array.isArray(data.sensors) || data.sensors.length < 19 ||
      !Number.isFinite(data.radius_mm) ||
      !Number.isFinite(data.brain_inner_radius_mm) ||
      data.radius_mm <= data.brain_inner_radius_mm ||
      data.brain_inner_radius_mm <= 0) {
    throw new Error('Invalid sphere forward model metadata');
  }
  if(isFem){
    const f=data.fem;
    if(!f||f.solver!=='P1-tetrahedral-conductivity'||!/^[a-f0-9]{64}$/.test(f.mesh_sha256)||
      ![f.nodes,f.tetrahedra,f.surface_vertices].every(n=>Number.isInteger(n)&&n>0)||
      f.surface_vertices!==data.scalp_field_grid?.positions_mm.length||
      f.pair_separation_mm!==2||f.source_load!=='barycentric-current-balanced-Cartesian-pairs'||
      f.boundary!=='insulating-Neumann'||f.datum!=='surface-area-mean-zero'||
      ![f.relative_residual,f.reciprocity_error,f.max_mne_relative_l2,f.offgrid_max_mne_relative_l2].every(n=>Number.isFinite(n)&&n>=0)||
      f.relative_residual>=1e-8||f.reciprocity_error>=1e-9||f.max_mne_relative_l2>=.05||f.offgrid_max_mne_relative_l2>=.05||
      data.source_grid_axis_mm.join(',')!=='-16,16'||data.conductivities_S_m?.length!==4||
      data.conductivities_S_m.some((v,i)=>v!==[.33,1,data.model_id.endsWith('0.002') ? 0.002 : data.model_id.endsWith('0.008') ? 0.008 : 0.004,.33][i]))
       throw new Error('Invalid FEM numerical identity or validation metadata');
  }else if(data.fem)throw new Error('FEM coefficients cannot be labeled as an analytic MNE model');
  const grid = data.source_grid_axis_mm;
  if (grid.some((a, i) => i > 0 && a <= grid[i - 1])) {
    throw new Error('Source grid must be strictly ascending');
  }
  const names = new Set<string>();
  const gridCols = 3 * grid.length ** 3;
  if (!Array.isArray(data.gain_uv_per_nAm) ||
      data.gain_uv_per_nAm.length !== data.sensors.length) {
    throw new Error('Sphere gain matrix row count does not match sensors');
  }
  data.sensors.forEach((s, i) => {
    if (!s.label || names.has(s.label) ||
        !Array.isArray(s.position_mm) ||
        !s.position_mm.every(Number.isFinite) ||
        s.position_mm.length !== 3) {
      throw new Error('Invalid or duplicate EEG sensor');
    }
    names.add(s.label);
    const radii = Math.hypot(...s.position_mm);
    if (isFem ? radii<data.radius_mm*.99||radii>data.radius_mm+.01 : Math.abs(radii - data.radius_mm) > 0.01) {
      throw new Error('EEG sensor does not lie on the expected spherical scalp');
    }
    const row = data.gain_uv_per_nAm[i];
    if (!Array.isArray(row) || row.length !== gridCols ||
        !row.every(Number.isFinite)) {
      throw new Error('Invalid or nonfinite lead field coefficients');
    }
  });
  for (const key of MONTAGES) {
    const labels = data.montages?.[key];
    if (!Array.isArray(labels) || labels.length < 19 ||
        new Set(labels).size !== labels.length ||
        labels.some(label => !names.has(label))) {
      throw new Error('Missing or inconsistent montage ' + key);
    }
  }
  const scalp=data.scalp_field_grid;
  if(scalp){
    if(!Array.isArray(scalp.positions_mm)||scalp.positions_mm.length!==scalp.gain_uv_per_nAm.length||
       scalp.positions_mm.some(p=>p.length!==3||!p.every(Number.isFinite)||Math.abs(Math.hypot(...p)-data.radius_mm)>.01)||
       scalp.triangles.length%3!==0||scalp.triangles.some(j=>!Number.isInteger(j)||j<0||j>=scalp.positions_mm.length)||
       scalp.gain_uv_per_nAm.some(row=>row.length!==gridCols||!row.every(Number.isFinite)))
      throw new Error('Invalid scalp vertex lead field or geometry');
  }

}

const indexAndWeight = (axis: number[], x: number): [number, number] => {
  const min = axis[0], max = axis[axis.length - 1];
  if (!Number.isFinite(x) || x < min || x > max) {
    throw new RangeError('Source position outside the validated lead-field grid');
  }
  for (let i = 0; i < axis.length - 1; i++) {
    if (x <= axis[i + 1]) return [i, (x - axis[i]) / (axis[i + 1] - axis[i])];
  }
  return [axis.length - 2, 1];
};

/** Bounded trilinear interpolation; returns full 3-vector gain per sensor. */
export function interpolateSphereGain(
  fixture: SphereFixture, positionMm: Vec3Mm,
): Vec3Mm[] {
  const grid = fixture.source_grid_axis_mm;
  const n = grid.length;
  const [ix, wx] = indexAndWeight(grid, positionMm[0]);
  const [iy, wy] = indexAndWeight(grid, positionMm[1]);
  const [iz, wz] = indexAndWeight(grid, positionMm[2]);
  const corners: [number, number][] = [];
  for (let dx = 0; dx <= 1; dx++)
    for (let dy = 0; dy <= 1; dy++)
      for (let dz = 0; dz <= 1; dz++) {
        const gridIdx = ((ix + dx) * n + (iy + dy)) * n + iz + dz;
        const weight = (dx ? wx : 1-wx) * (dy ? wy : 1-wy) * (dz ? wz : 1-wz);
        corners.push([gridIdx * 3, weight]);
      }
  return fixture.gain_uv_per_nAm.map(row => {
    const v = [0, 0, 0];
    for (const [j, w] of corners)
      for (let k = 0; k < 3; k++) v[k] += w * row[j+k];
    return v as unknown as Vec3Mm;
  });
}

/** Explicit ordered channel subset; the standard montage definition stays intact. */
export function sphereChannelLabels(fixture:SphereFixture,montage:MontageKey,selectedLabels?:readonly string[]):string[] {
 const base=fixture.montages[montage];if(!base)throw new Error('Unknown montage: '+montage);
 const labels=selectedLabels??base;
 if(labels.length<4||new Set(labels).size!==labels.length||labels.some(label=>!base.includes(label)))
  throw new RangeError('Select at least four unique electrodes from the current montage');
 return [...labels];
}

/**
 * Source dipole projection through all model electrodes. Applying a different
 * montage re-references only the selected subset, never all 345 electrodes.
 */
export function sphereElectrodePotentials(
  fixture: SphereFixture, sourceMm: Vec3Mm, momentNAm: Vec3Mm,
  montage: MontageKey = '10-20',
  reference: SphereReference = { mode: 'average' },
  selectedLabels?:readonly string[],
): { sensors: SphereSensor[]; voltageUv: number[] } {
  if (momentNAm.length !== 3 || !momentNAm.every(Number.isFinite)) {
    throw new RangeError('Moment vector must contain three finite nA.m numbers');
  }
  const labels = sphereChannelLabels(fixture,montage,selectedLabels);
  const indices = new Map(fixture.sensors.map((s, i) => [s.label, i]));
  const gain = interpolateSphereGain(fixture, sourceMm);
  const values = labels.map(label => {
    const i = indices.get(label);
    if (i === undefined) throw new Error('Montage sensor not in lead field: ' + label);
    return gain[i][0] * momentNAm[0] +
      gain[i][1] * momentNAm[1] + gain[i][2] * momentNAm[2];
  });
  let ref = 0;
  if (reference.mode === 'average') {
    ref = values.reduce((a,b)=>a+b,0)/values.length;
  } else if (reference.mode === 'electrode') {
    const i = labels.indexOf(reference.label);
    if (i < 0) throw new RangeError('Reference electrode not in current montage');
    ref = values[i];
  } else if (reference.mode !== 'infinity') {
    throw new Error('Unsupported reference');
  }
  return {
    sensors: labels.map(label => fixture.sensors[indices.get(label)!]),
    voltageUv: values.map(v => v-ref),
  };
}

/** Constrained electrode moves SNAP to an independently solved scalp vertex.
 * Replace both position AND leadfield row. No stale standard-montage matrix survives.
 */
export function moveSphereElectrodes(fixture:SphereFixture,vertices:Record<string,number>):SphereFixture {
 const grid=fixture.scalp_field_grid;if(!grid&&Object.keys(vertices).length)throw new Error('No scalp forward grid');
 const sensors=fixture.sensors.map(s=>{
  const j=vertices[s.label];if(j===undefined)return s;
  if(!Number.isInteger(j)||j<0||j>=grid!.positions_mm.length)throw new Error('Invalid scalp vertex');
  return {...s,position_mm:grid!.positions_mm[j]};
 });
 for(const label of Object.keys(vertices))if(!fixture.sensors.some(s=>s.label===label))throw new Error('Unknown electrode');
 const model={...fixture,sensors,gain_uv_per_nAm:fixture.sensors.map((s,i)=>vertices[s.label]===undefined?fixture.gain_uv_per_nAm[i]:grid!.gain_uv_per_nAm[vertices[s.label]])};
 validateSphereFixture(model);return model;
}
