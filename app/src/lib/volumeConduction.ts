/**
 * PR #5 — analytic electric dipole potential in an infinite homogeneous
 * isotropic conductor (SI units). Scientifically valid baseline / teaching
 * demonstration; NOT a bounded human-head EEG forward solution.
 *
 * Coordinates: right-anterior-superior (RAS), millimetres, head-local frame.
 * Source dipole moment: nA·m, potential output: µV, conductivity: S/m.
 *
 * V(r) = p · (r - r0) / [4πσ |r-r0|^3]
 * Under an unbounded, homogeneous, isotropic, quasi-static conductor.
 * The geometry is intentionally independent of the demo 3D scalp sphere:
 * no skull/scalp boundary condition, BEM, anisotropy, cortical source map,
 * montage, or neurodynamic-to-dipole coupling is claimed.
 */
export type Vec3Mm = readonly [number, number, number];

export interface Dipole {
  positionMm: Vec3Mm;
  /** Vector electric current dipole moment in nanoampere-metres. */
  momentNAm: Vec3Mm;
}

export interface Sensor {
  label: string;
  positionMm: Vec3Mm;
}

export type Reference =
  | { mode: 'infinity' }
  | { mode: 'average' }
  | { mode: 'electrode'; label: string };

export const DEFAULT_CONDUCTIVITY_S_M = 0.33;
export const MODEL_ID = 'homogeneous-unbounded-dipole-v1';
export const MODEL_LIMITATION =
  '均匀、各向同性、无限导体解析解；不包含头皮/颅骨边界、BEM/FEM、标准10–20电极或真实人脑源映射。';

function finiteVector(v: Vec3Mm, name: string): void {
  if (v.length !== 3 || !v.every(Number.isFinite)) {
    throw new RangeError(name + ' must contain exactly three finite numbers');
  }
}

function finiteConductivity(sigma: number): void {
  if (!Number.isFinite(sigma) || sigma <= 0) {
    throw new RangeError('Conductivity must be a finite positive value in S/m');
  }
}

/** Potential referenced to infinity; distances and moments converted to SI. */
export function potentialMicrovolts(
  dipole: Dipole,
  sensorMm: Vec3Mm,
  conductivitySPerM = DEFAULT_CONDUCTIVITY_S_M,
): number {
  finiteVector(dipole.positionMm, 'dipole.positionMm');
  finiteVector(dipole.momentNAm, 'dipole.momentNAm');
  finiteVector(sensorMm, 'sensorMm');
  finiteConductivity(conductivitySPerM);

  const rx = (sensorMm[0] - dipole.positionMm[0]) * 1e-3;
  const ry = (sensorMm[1] - dipole.positionMm[1]) * 1e-3;
  const rz = (sensorMm[2] - dipole.positionMm[2]) * 1e-3;
  const r = Math.hypot(rx, ry, rz);
  if (r < 1e-3) {
    throw new RangeError('A point-source model is singular within 1 mm of a sensor');
  }
  const dot = (dipole.momentNAm[0] * rx +
    dipole.momentNAm[1] * ry +
    dipole.momentNAm[2] * rz) * 1e-9;
  const volts = dot / (4 * Math.PI * conductivitySPerM * r * r * r);
  return volts * 1e6;
}

/** Linear superposition followed by the requested re-referencing operation. */
export function sensorPotentialsMicrovolts(
  dipoles: readonly Dipole[],
  sensors: readonly Sensor[],
  reference: Reference = { mode: 'average' },
  conductivitySPerM = DEFAULT_CONDUCTIVITY_S_M,
): number[] {
  finiteConductivity(conductivitySPerM);
  if (sensors.length < 1) throw new RangeError('At least one sensor is required');
  const labels = new Set<string>();
  for (const sensor of sensors) {
    finiteVector(sensor.positionMm, 'sensor.positionMm');
    if (!sensor.label || labels.has(sensor.label)) {
      throw new RangeError('Sensor labels must be nonempty and unique');
    }
    labels.add(sensor.label);
  }
  const raw = sensors.map((s) => dipoles.reduce(
    (sum, d) => sum + potentialMicrovolts(d, s.positionMm, conductivitySPerM), 0));
  let referenceUv = 0;
  if (reference.mode === 'average') {
    referenceUv = raw.reduce((a, b) => a + b, 0) / raw.length;
  } else if (reference.mode === 'electrode') {
    const index = sensors.findIndex((s) => s.label === reference.label);
    if (index < 0) throw new RangeError('Unknown reference sensor: ' + reference.label);
    referenceUv = raw[index];
  } else if (reference.mode !== 'infinity') {
    throw new RangeError('Unsupported reference mode');
  }
  return raw.map((v) => v - referenceUv);
}

/**
 * S01...S12 are deliberately NOT named as 10-20/10-10/10-05 electrodes.
 * The unit directions define an illustrative spherical measurement array,
 * not a registered scalp montage or a realistic head boundary.
 */
export function demoSphereSensors(radiusMm = 90): Sensor[] {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0) {
    throw new RangeError('Sensor sphere radius must be positive');
  }
  const directions: readonly Vec3Mm[] = [
    [0, 0, 1], [1, 0, 1], [-1, 0, 1], [0, 1, 1],
    [0, -1, 1], [1, 1, 0.5], [-1, 1, 0.5], [1, -1, 0.5],
    [-1, -1, 0.5], [1, 0, 0], [-1, 0, 0], [0, -1, 0],
  ];
  return directions.map((d, i) => {
    const scale = radiusMm / Math.hypot(...d);
    return { label: 'S' + String(i + 1).padStart(2, '0'),
      positionMm: [d[0] * scale, d[1] * scale, d[2] * scale] };
  });
}
