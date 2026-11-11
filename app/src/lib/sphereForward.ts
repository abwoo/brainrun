/**
 * Read-only browser runtime for an MNE-Python generated four-layer sphere EEG
 * forward lead field. Coordinates are head-RAS, sphere-centred millimetres.
 * All gain coefficients are µV/(nA.m); moments are nA.m.
 *
 * The physical forward solve is performed by MNE offline. Live source moves
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
export interface SphereFixture {
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
  if (data.model_id !== SPHERE_MODEL_ID ||
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
    if (Math.abs(radii - data.radius_mm) > 0.01) {
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

/**
 * Source dipole projection through all model electrodes. Applying a different
 * montage re-references only the selected subset, never all 345 electrodes.
 */
export function sphereElectrodePotentials(
  fixture: SphereFixture, sourceMm: Vec3Mm, momentNAm: Vec3Mm,
  montage: MontageKey = '10-20',
  reference: SphereReference = { mode: 'average' },
): { sensors: SphereSensor[]; voltageUv: number[] } {
  if (momentNAm.length !== 3 || !momentNAm.every(Number.isFinite)) {
    throw new RangeError('Moment vector must contain three finite nA.m numbers');
  }
  const labels = fixture.montages[montage];
  if (!labels) throw new Error('Unknown montage: ' + montage);
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
