/**
 * PR-14 (brainrun 2.0 plan §15.3/§15.4): brain-stimulation laboratory.
 *
 * Four levels, in order of physical completeness. The level labels are
 * part of the science, not decoration: a higher level is a *more complete
 * physical chain*, not a stronger claim about the real brain.
 *
 * - Level A — direct neural-model input. A written drive is added to a
 *   local WC or JR column. Labelled, in the UI and in the docs, as
 *   "direct model input, NOT a complete tES/TMS physical stimulus".
 * - Level B — TES electric field. Scalp electrodes (position on the
 *   95 mm head sphere, current in mA) -> electric field inside the head
 *   from the closed-form point-current-source solution in an infinite
 *   homogeneous isotropic conductor:
 *     E(r) = sum_k I_k (r - r_k) / (4 pi sigma |r - r_k|^3).
 *   This is an analytic approximation, NOT a SimNIBS/FEM head model:
 *   it ignores the skull's low conductivity, all tissue boundaries,
 *   anisotropy and the real head shape, and it overestimates the field
 *   near an electrode (no skull to drop voltage across). See
 *   docs/pr7-stimulation.md §2.
 * - Level C — TMS electromagnetic field. A circular coil (radius, turns,
 *   dI/dt) -> Faraday induced electric field in a uniform conductor
 *   (sigma = 0.33 S/m) from the analytic loop integral
 *     E(r) = -mu0 N (dI/dt) / (4 pi) * oint dl / |r - r'|.
 *   The integral is evaluated by the trapezoid rule on the closed loop
 *   (periodic integrand: 360 segments already agree with 3600 segments
 *   to <1e-6 V/m at the reference target). No scalar-potential term:
 *   in a uniform infinite conductor there is no surface charge to
 *   cancel the induced field. The thin-wire loop has no skull/brain
 *   boundary either. See docs/pr7-stimulation.md §3.
 *   PR8-D adds, inside the same analytic framework (no FEM solver):
 *   a figure-8 coil (two circular loops, centres offset by one radius
 *   in the coil plane, opposite currents — linear superposition of two
 *   `tmsInducedField` calls) and a biphasic dI/dt(t) waveform
 *   (one cosine cycle, `biphasicDIdtAt`); E(t) follows by linearity
 *   in dI/dt. FEM/BEM fields were evaluated and NOT implemented in
 *   this batch (see tests/pr8/debug-rounds-d.md): a full FEM solver
 *   (mesh, tissue conductivities, boundary conditions) is out of
 *   scope for the polish/release batch; the analytic models above
 *   remain the documented approximation with their limits stated.
 * - Level D — field to neural response. The cortical-normal component
 *   of the field at the target (V/m) is mapped through a written,
 *   UNCALIBRATED transfer gain onto a WC/JR column's added input P,
 *   and the column response runs through the assumed dipole coupling
 *   (q(t)) and the Pz proxy gain (0.16 uV/(nA*m), same value as PR6)
 *   to an EEG trace. A strong field is NOT claimed to excite or
 *   inhibit a real brain: the response model is itself a hypothesis,
 *   and the gain is a free parameter the user can see and change.
 *
 * Sensory laboratory (§15.3): periodic visual stimulation (flicker
 * frequency -> sinusoidal modulation drive on a visual-area WC column,
 * mapping written below) and simplified auditory stimulation (tone
 * bursts -> rectangular envelope drive; the tone frequency in Hz is
 * recorded as metadata and does NOT enter the dynamics, because a
 * 0.5-1 ms column step cannot resolve a kHz carrier and no tonotopic
 * mapping is claimed). Repetition, intensity and ISI scans are defined
 * as explicit experiments on top of these drives. Responses are
 * measured with the PR6 functions (welchPsd / peakInWindow from
 * signalProcessing.ts) by the caller/tests, not re-implemented here.
 *
 * Units everywhere: mm / nA*m / uV / ms / Hz / mA / V/m.
 * Coordinates: head-RAS, sphere-centred mm (sphere centre = origin),
 * the same frame as sphereForward.ts. All functions are deterministic:
 * same inputs -> bitwise-identical outputs (no RNG anywhere in this file).
 */
import type { Vec3Mm } from './volumeConduction';
export type { Vec3Mm } from './volumeConduction';
import {
  createLocalCorticalColumn,
  DEFAULT_MORPHOLOGY,
  DEFAULT_RATE_PARAMS,
  type DipoleMorphology,
  type LocalRateParams,
} from './localCorticalColumn.ts';
import {
  createJansenRitColumn,
  DEFAULT_JANSEN_RIT_PARAMS,
  type JansenRitParams,
} from './jansenRitColumn.ts';

export const STIMULATION_ID = 'brain-stimulation-lab-pr14-v1';
export const TES_MODEL_ID = 'tes-uniform-infinite-point-source-v1';
export const TMS_MODEL_ID = 'tms-circular-coil-uniform-conductor-v1';
/** PR8-D: figure-8 = two circular loops, opposite currents, linear sum. */
export const FIGURE_EIGHT_MODEL_ID = 'tms-figure-eight-two-loop-v1';
/** PR8-D: biphasic dI/dt(t) = peak * cos(2 pi t / T) on [0, T], else 0. */
export const BIPHASIC_WAVEFORM_ID = 'tms-biphasic-cosine-didt-v1';
/** PR8-D: default biphasic pulse period, ms (real biphasic TMS ~0.2-0.4 ms). */
export const DEFAULT_BIPHASIC_PERIOD_MS = 0.3;
/** PR8-D: biphasic period UI range, ms. */
export const BIPHASIC_PERIOD_RANGE_MS: readonly [number, number] = [0.1, 1.0];
export const LEVEL_D_ID = 'field-to-column-uncalibrated-gain-v1';
export const SENSORY_ID = 'sensory-input-defined-mapping-v1';

export const STIMULATION_LIMITATION =
  'Level A 是直接模型输入，不是完整 tES/TMS 物理刺激；Level B/C 是均匀导体解析近似，'
  + '无颅骨/边界/FEM；Level D 的电场→神经增益未经校准，电场强不等于真实大脑必然兴奋或抑制；'
  + '感觉输入是一套有定义的输入映射，不是真实视觉/听觉皮层复现。';

/** Head-sphere radius (mm), same value as sphereForward.ts / the MNE sphere model. */
export const HEAD_RADIUS_MM = 95;
/** Brain inner radius (mm): 0.90 * 95, same as the MNE four-layer sphere. */
export const BRAIN_INNER_RADIUS_MM = 85.5;
/** Uniform brain conductivity (S/m), same default as volumeConduction.ts. */
export const TES_SIGMA_DEFAULT_S_M = 0.33;
/** Vacuum permeability (H/m). */
export const MU0_H_PER_M = 4 * Math.PI * 1e-7;
/** Pz proxy gain (uV per nA*m), same central value as PR6 lateResponse.ts. */
export const STIM_PZ_GAIN_UV_PER_NAM = 0.16;

export type StimLevel = 'A' | 'B' | 'C' | 'D';
export type ColumnModel = 'wc' | 'jr';

/* ── shared helpers ─────────────────────────────────────────────── */

function finiteVec3(v: Vec3Mm, name: string): void {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) {
    throw new RangeError(name + ' must contain exactly three finite numbers');
  }
}
function unitVec3(v: Vec3Mm, name: string): Vec3Mm {
  finiteVec3(v, name);
  const n = Math.hypot(...v);
  if (Math.abs(n - 1) > 1e-3) {
    throw new RangeError(name + ' must already be a unit vector');
  }
  return [v[0] / n, v[1] / n, v[2] / n];
}
function dot(a: Vec3Mm, b: Vec3Mm): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Component of a field along a cortical surface normal (unit vector). */
export function normalComponentVm(fieldVm: Vec3Mm, normalHead: Vec3Mm): number {
  finiteVec3(fieldVm, 'fieldVm');
  const n = unitVec3(normalHead, 'normalHead');
  return dot(fieldVm, n);
}

/* ── Level B: TES ───────────────────────────────────────────────── */

export interface TesElectrode {
  label: string;
  /** Scalp position, sphere-centred head-RAS mm; must lie on the 95 mm sphere. */
  positionMm: Vec3Mm;
  /** Injected current, mA. Positive = anode (source), negative = cathode (sink). */
  currentMA: number;
}
export interface TesFieldResult {
  fieldVm: Vec3Mm;
  magnitudeVm: number;
  modelId: string;
  sigmaSPerM: number;
}

export const DEFAULT_TES_ELECTRODES: readonly TesElectrode[] = Object.freeze([
  { label: 'Anode', positionMm: [0, 0, 95], currentMA: 2 },
  { label: 'Cathode', positionMm: [0, -95, 0], currentMA: -2 },
]);
/** Default TES target: cortical depth under the anode, mm. */
export const DEFAULT_TES_TARGET_MM: Vec3Mm = [0, 0, 70];
/** Default cortical normal at the target (radial, outward). */
export const DEFAULT_TARGET_NORMAL_HEAD: Vec3Mm = [0, 0, 1];

export function validateTesElectrodes(electrodes: readonly TesElectrode[]): void {
  if (!Array.isArray(electrodes) || electrodes.length < 2 || electrodes.length > 8) {
    throw new RangeError('TES needs 2-8 electrodes');
  }
  const labels = new Set<string>();
  let totalMA = 0;
  for (const e of electrodes) {
    finiteVec3(e.positionMm, 'electrode.positionMm');
    if (!e.label || labels.has(e.label)) {
      throw new RangeError('TES electrode labels must be nonempty and unique');
    }
    labels.add(e.label);
    const r = Math.hypot(...e.positionMm);
    if (Math.abs(r - HEAD_RADIUS_MM) > 1) {
      throw new RangeError(
        `TES electrode ${e.label} must lie on the ${HEAD_RADIUS_MM} mm scalp sphere (r=${r.toFixed(1)} mm)`,
      );
    }
    if (!Number.isFinite(e.currentMA) || Math.abs(e.currentMA) > 4) {
      throw new RangeError(`TES electrode ${e.label}: |current| must be <= 4 mA`);
    }
    totalMA += e.currentMA;
  }
  if (Math.abs(totalMA) > 1e-9) {
    throw new RangeError(`TES currents must sum to zero (charge balance), got ${totalMA} mA`);
  }
}

function validateTesTarget(targetMm: Vec3Mm, electrodes: readonly TesElectrode[]): void {
  finiteVec3(targetMm, 'targetMm');
  if (Math.hypot(...targetMm) > BRAIN_INNER_RADIUS_MM) {
    throw new RangeError('TES target must lie inside the brain sphere (r <= 85.5 mm)');
  }
  for (const e of electrodes) {
    const d = Math.hypot(
      targetMm[0] - e.positionMm[0],
      targetMm[1] - e.positionMm[1],
      targetMm[2] - e.positionMm[2],
    );
    if (d < 5) {
      throw new RangeError('TES target must stay >= 5 mm from every electrode (point-source singularity)');
    }
  }
}

/**
 * Level B: E(r) = sum_k I_k (r - r_k) / (4 pi sigma |r - r_k|^3),
 * point current sources in an infinite homogeneous isotropic conductor.
 * Inputs in mm/mA, output in V/m. Linear in current: doubling every
 * electrode current exactly doubles the field.
 */
export function tesElectricField(
  electrodes: readonly TesElectrode[],
  targetMm: Vec3Mm,
  sigmaSPerM: number = TES_SIGMA_DEFAULT_S_M,
): TesFieldResult {
  validateTesElectrodes(electrodes);
  validateTesTarget(targetMm, electrodes);
  if (!Number.isFinite(sigmaSPerM) || sigmaSPerM <= 0) {
    throw new RangeError('TES conductivity must be a finite positive value in S/m');
  }
  const t = [targetMm[0] * 1e-3, targetMm[1] * 1e-3, targetMm[2] * 1e-3];
  const field = [0, 0, 0];
  for (const e of electrodes) {
    const rk = [e.positionMm[0] * 1e-3, e.positionMm[1] * 1e-3, e.positionMm[2] * 1e-3];
    const rx = t[0] - rk[0], ry = t[1] - rk[1], rz = t[2] - rk[2];
    const d = Math.hypot(rx, ry, rz);
    const coef = (e.currentMA * 1e-3) / (4 * Math.PI * sigmaSPerM * d * d * d);
    field[0] += coef * rx; field[1] += coef * ry; field[2] += coef * rz;
  }
  const out: Vec3Mm = [field[0], field[1], field[2]];
  return { fieldVm: out, magnitudeVm: Math.hypot(...out), modelId: TES_MODEL_ID, sigmaSPerM };
}

export interface FieldGridPoint {
  positionMm: Vec3Mm;
  fieldVm: Vec3Mm;
  magnitudeVm: number;
}

/** TES field sampled on a cubic grid inside the brain sphere, for 3D display. */
export function tesFieldGrid(
  electrodes: readonly TesElectrode[],
  sigmaSPerM: number = TES_SIGMA_DEFAULT_S_M,
  stepMm: number = 20,
): FieldGridPoint[] {
  if (!Number.isFinite(stepMm) || stepMm <= 0 || stepMm > 40) {
    throw new RangeError('TES grid step must be in (0, 40] mm');
  }
  const pts: FieldGridPoint[] = [];
  for (let x = -80; x <= 80; x += stepMm) {
    for (let y = -80; y <= 80; y += stepMm) {
      for (let z = -80; z <= 80; z += stepMm) {
        if (Math.hypot(x, y, z) > BRAIN_INNER_RADIUS_MM) continue;
        const f = tesElectricField(electrodes, [x, y, z], sigmaSPerM);
        pts.push({ positionMm: [x, y, z], fieldVm: f.fieldVm, magnitudeVm: f.magnitudeVm });
      }
    }
  }
  return pts;
}

/* ── Level C: TMS ───────────────────────────────────────────────── */

export interface TmsCoil {
  /** Coil centre, sphere-centred head-RAS mm (just above the scalp). */
  centerMm: Vec3Mm;
  /** Coil axis (unit vector): normal to the coil plane. */
  axis: Vec3Mm;
  /** Loop radius, mm. */
  radiusMm: number;
  /** Number of turns (identical coaxial loops). */
  turns: number;
  /** Current slew rate dI/dt, A/s. Sign sets the induced-field direction. */
  dIdtAPerS: number;
}
export interface TmsFieldResult {
  fieldVm: Vec3Mm;
  magnitudeVm: number;
  modelId: string;
  sigmaSPerM: number;
}

export const DEFAULT_TMS_COIL: Readonly<TmsCoil> = Object.freeze({
  centerMm: [0, 0, 102] as Vec3Mm,
  axis: [0, 0, 1] as Vec3Mm,
  radiusMm: 35,
  turns: 10,
  dIdtAPerS: 1e8,
});
/** Default TMS target: cortical depth, radially offset from the coil axis. */
export const DEFAULT_TMS_TARGET_MM: Vec3Mm = [30, 0, 70];
/** Trapezoid segments on the loop; 360 already agrees with 3600 to <1e-6 V/m. */
export const TMS_LOOP_SEGMENTS_DEFAULT = 360;

export function validateTmsCoil(coil: TmsCoil): void {
  finiteVec3(coil.centerMm, 'coil.centerMm');
  unitVec3(coil.axis, 'coil.axis');
  if (!Number.isFinite(coil.radiusMm) || coil.radiusMm < 10 || coil.radiusMm > 100) {
    throw new RangeError('TMS coil radius must be in [10, 100] mm');
  }
  if (!Number.isFinite(coil.turns) || !Number.isInteger(coil.turns) ||
      coil.turns < 1 || coil.turns > 50) {
    throw new RangeError('TMS turns must be an integer in [1, 50]');
  }
  if (!Number.isFinite(coil.dIdtAPerS) || Math.abs(coil.dIdtAPerS) > 2e8) {
    throw new RangeError('TMS |dI/dt| must be <= 2e8 A/s');
  }
}

function coilBasis(axis: Vec3Mm): [Vec3Mm, Vec3Mm] {
  const a: Vec3Mm = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const ux = axis[1] * a[2] - axis[2] * a[1];
  const uy = axis[2] * a[0] - axis[0] * a[2];
  const uz = axis[0] * a[1] - axis[1] * a[0];
  const un = Math.hypot(ux, uy, uz);
  const u: Vec3Mm = [ux / un, uy / un, uz / un];
  const v: Vec3Mm = [
    axis[1] * u[2] - axis[2] * u[1],
    axis[2] * u[0] - axis[0] * u[2],
    axis[0] * u[1] - axis[1] * u[0],
  ];
  return [u, v];
}

/**
 * Level C: Faraday induced field of a circular loop in a uniform
 * conductor, E(r) = -mu0 N (dI/dt) / (4 pi) * oint dl / |r - r'|.
 * The loop integral is dimensionless (dl and |r - r'| both in mm, the
 * ratio cancels); E comes out in V/m with mu0 in H/m and dI/dt in A/s.
 * Consequences of the formula, not bugs: E = 0 on the coil axis
 * (symmetry), E is azimuthal (perpendicular to the coil axis and to the
 * radial offset), and E scales linearly with N and with dI/dt.
 * The tissue conductivity does not enter E (it enters J = sigma E);
 * sigma = 0.33 S/m is recorded as the assumed uniform tissue model.
 */
export function tmsInducedField(
  coil: TmsCoil,
  targetMm: Vec3Mm,
  segments: number = TMS_LOOP_SEGMENTS_DEFAULT,
): TmsFieldResult {
  validateTmsCoil(coil);
  finiteVec3(targetMm, 'targetMm');
  if (Math.hypot(...targetMm) > BRAIN_INNER_RADIUS_MM) {
    throw new RangeError('TMS target must lie inside the brain sphere (r <= 85.5 mm)');
  }
  if (!Number.isInteger(segments) || segments < 36 || segments > 7200) {
    throw new RangeError('TMS loop segments must be an integer in [36, 7200]');
  }
  const [u, v] = coilBasis(coil.axis);
  const dTheta = (2 * Math.PI) / segments;
  let ax = 0, ay = 0, az = 0;
  let minDistMm = Infinity;
  for (let k = 0; k < segments; k++) {
    const th = k * dTheta;
    const c = Math.cos(th), s = Math.sin(th);
    const px = coil.centerMm[0] + coil.radiusMm * (c * u[0] + s * v[0]);
    const py = coil.centerMm[1] + coil.radiusMm * (c * u[1] + s * v[1]);
    const pz = coil.centerMm[2] + coil.radiusMm * (c * u[2] + s * v[2]);
    const dx = targetMm[0] - px, dy = targetMm[1] - py, dz = targetMm[2] - pz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < minDistMm) minDistMm = dist;
    const dlx = coil.radiusMm * (-s * u[0] + c * v[0]) * dTheta;
    const dly = coil.radiusMm * (-s * u[1] + c * v[1]) * dTheta;
    const dlz = coil.radiusMm * (-s * u[2] + c * v[2]) * dTheta;
    ax += dlx / dist; ay += dly / dist; az += dlz / dist;
  }
  if (minDistMm < 2) {
    throw new RangeError('TMS target must stay >= 2 mm from the coil wire (thin-wire singularity)');
  }
  const coef = (-MU0_H_PER_M / (4 * Math.PI)) * coil.turns * coil.dIdtAPerS;
  const out: Vec3Mm = [coef * ax, coef * ay, coef * az];
  return {
    fieldVm: out, magnitudeVm: Math.hypot(...out),
    modelId: TMS_MODEL_ID, sigmaSPerM: TES_SIGMA_DEFAULT_S_M,
  };
}

/** TMS induced field sampled on a cubic grid inside the brain sphere, for 3D display. */
export function tmsFieldGrid(
  coil: TmsCoil,
  stepMm: number = 20,
  segments: number = TMS_LOOP_SEGMENTS_DEFAULT,
): FieldGridPoint[] {
  if (!Number.isFinite(stepMm) || stepMm <= 0 || stepMm > 40) {
    throw new RangeError('TMS grid step must be in (0, 40] mm');
  }
  const pts: FieldGridPoint[] = [];
  for (let x = -80; x <= 80; x += stepMm) {
    for (let y = -80; y <= 80; y += stepMm) {
      for (let z = -80; z <= 80; z += stepMm) {
        if (Math.hypot(x, y, z) > BRAIN_INNER_RADIUS_MM) continue;
        const f = tmsInducedField(coil, [x, y, z], segments);
        pts.push({ positionMm: [x, y, z], fieldVm: f.fieldVm, magnitudeVm: f.magnitudeVm });
      }
    }
  }
  return pts;
}

/* ── PR8-D: figure-8 coil (linear superposition of two circular loops) ── */

export type TmsCoilShape = 'circular' | 'figure8';

/**
 * Figure-8 coil as two circular loops: same radius/turns/axis, centres
 * offset by one loop radius in the coil plane (along the first basis
 * vector u of `coilBasis(axis)`), so the loops touch at the original
 * coil centre; the second loop carries the opposite current
 * (dI/dt negated). At the junction the two induced fields add
 * constructively — that is the point of a figure-8 coil (focal field
 * under the junction, vs zero on the axis of a single circular loop).
 * Both loops are validated by `tmsInducedField` (radius/turns/dI/dt
 * ranges, >= 2 mm from the wire), so no new validation is needed here.
 */
export function figureEightLoopCoils(coil: TmsCoil): [TmsCoil, TmsCoil] {
  validateTmsCoil(coil);
  const [u] = coilBasis(coil.axis);
  const r = coil.radiusMm;
  const plus: TmsCoil = {
    ...coil,
    centerMm: [
      coil.centerMm[0] + r * u[0],
      coil.centerMm[1] + r * u[1],
      coil.centerMm[2] + r * u[2],
    ],
  };
  const minus: TmsCoil = {
    ...coil,
    centerMm: [
      coil.centerMm[0] - r * u[0],
      coil.centerMm[1] - r * u[1],
      coil.centerMm[2] - r * u[2],
    ],
    dIdtAPerS: -coil.dIdtAPerS,
  };
  return [plus, minus];
}

/**
 * Figure-8 induced field: exact linear sum of the two loop fields
 * (same uniform-conductor analytic model as the circular coil; no new
 * physics is claimed). E is linear in dI/dt, so negating one loop's
 * current negates its field contribution.
 */
export function tmsFigureEightField(
  coil: TmsCoil,
  targetMm: Vec3Mm,
  segments: number = TMS_LOOP_SEGMENTS_DEFAULT,
): TmsFieldResult {
  const [a, b] = figureEightLoopCoils(coil);
  const fa = tmsInducedField(a, targetMm, segments);
  const fb = tmsInducedField(b, targetMm, segments);
  const out: Vec3Mm = [
    fa.fieldVm[0] + fb.fieldVm[0],
    fa.fieldVm[1] + fb.fieldVm[1],
    fa.fieldVm[2] + fb.fieldVm[2],
  ];
  return {
    fieldVm: out, magnitudeVm: Math.hypot(...out),
    modelId: FIGURE_EIGHT_MODEL_ID, sigmaSPerM: TES_SIGMA_DEFAULT_S_M,
  };
}

/** Dispatch on coil shape (UI + Level D share this, so both see the same field). */
export function tmsFieldForShape(
  coil: TmsCoil,
  shape: TmsCoilShape,
  targetMm: Vec3Mm,
  segments: number = TMS_LOOP_SEGMENTS_DEFAULT,
): TmsFieldResult {
  if (shape !== 'circular' && shape !== 'figure8') {
    throw new RangeError(`Unknown TMS coil shape ${String(shape)}`);
  }
  return shape === 'figure8'
    ? tmsFigureEightField(coil, targetMm, segments)
    : tmsInducedField(coil, targetMm, segments);
}

/** Figure-8 induced field sampled on a cubic grid inside the brain sphere. */
export function figureEightFieldGrid(
  coil: TmsCoil,
  stepMm: number = 20,
  segments: number = TMS_LOOP_SEGMENTS_DEFAULT,
): FieldGridPoint[] {
  if (!Number.isFinite(stepMm) || stepMm <= 0 || stepMm > 40) {
    throw new RangeError('Figure-8 grid step must be in (0, 40] mm');
  }
  const pts: FieldGridPoint[] = [];
  for (let x = -80; x <= 80; x += stepMm) {
    for (let y = -80; y <= 80; y += stepMm) {
      for (let z = -80; z <= 80; z += stepMm) {
        if (Math.hypot(x, y, z) > BRAIN_INNER_RADIUS_MM) continue;
        const f = tmsFigureEightField(coil, [x, y, z], segments);
        pts.push({ positionMm: [x, y, z], fieldVm: f.fieldVm, magnitudeVm: f.magnitudeVm });
      }
    }
  }
  return pts;
}

/* ── PR8-D: biphasic TMS waveform ───────────────────────────────────── */

/**
 * Biphasic current slew rate: one full cosine cycle,
 *   dI/dt(t) = peak * cos(2 pi t / T) for 0 <= t <= T, else 0.
 * This is the dI/dt of a sinusoidal coil current I(t) = I0 sin(2 pi t / T)
 * over one period (first half-cycle positive, second negative — the
 * defining shape of a biphasic TMS pulse; cf. a monophasic pulse, whose
 * dI/dt does not reverse sign). The induced field follows by linearity:
 * E(t) = E_peak * cos(2 pi t / T), where E_peak is the static field at
 * dI/dt = peak. No capacitive recharge tail or coil resistance is modelled.
 */
export function biphasicDIdtAt(
  tMs: number,
  peakDIdtAPerS: number,
  periodMs: number = DEFAULT_BIPHASIC_PERIOD_MS,
): number {
  if (!Number.isFinite(tMs) || !Number.isFinite(peakDIdtAPerS) ||
      Math.abs(peakDIdtAPerS) > 2e8) {
    throw new RangeError('biphasicDIdtAt: tMs must be finite and |peak dI/dt| <= 2e8 A/s');
  }
  if (!Number.isFinite(periodMs) || periodMs < 0.05 || periodMs > 2) {
    throw new RangeError('biphasicDIdtAt: periodMs must be in [0.05, 2] ms');
  }
  if (tMs < 0 || tMs > periodMs) return 0;
  return peakDIdtAPerS * Math.cos((2 * Math.PI * tMs) / periodMs);
}

export interface BiphasicPulseResult {
  shape: TmsCoilShape;
  timesMs: number[];
  /** dI/dt(t), A/s. */
  dIdtAPerS: number[];
  /** E(t) at the target, V/m (linear in dI/dt). */
  fieldVm: Vec3Mm[];
  magnitudeVm: number[];
  /** |E| at t = 0 (peak of the first half-cycle), V/m. */
  peakMagnitudeVm: number;
  peakTimeMs: number;
  modelId: string;
  waveformId: string;
}

/**
 * E(t) through one biphasic TMS pulse at the target: the static field
 * at peak dI/dt is computed once (circular or figure-8, same analytic
 * model), then scaled by cos(2 pi t / T). Exact by linearity — the
 * pulse is NOT re-integrated per sample.
 */
export function tmsBiphasicPulse(
  coil: TmsCoil,
  targetMm: Vec3Mm,
  opts: {
    shape?: TmsCoilShape;
    peakDIdtAPerS?: number;
    periodMs?: number;
    sampleDtMs?: number;
    segments?: number;
  } = {},
): BiphasicPulseResult {
  const shape = opts.shape ?? 'circular';
  const periodMs = opts.periodMs ?? DEFAULT_BIPHASIC_PERIOD_MS;
  const sampleDtMs = opts.sampleDtMs ?? 0.01;
  const peak = opts.peakDIdtAPerS ?? coil.dIdtAPerS;
  if (!Number.isFinite(sampleDtMs) || sampleDtMs <= 0 || sampleDtMs > periodMs / 4) {
    throw new RangeError('tmsBiphasicPulse: sampleDtMs must be in (0, periodMs/4]');
  }
  const nSteps = Math.round(periodMs / sampleDtMs);
  if (nSteps < 4 || Math.abs(nSteps * sampleDtMs - periodMs) > 1e-9) {
    throw new RangeError('tmsBiphasicPulse: periodMs must be a multiple of sampleDtMs (>= 4 samples)');
  }
  const base = tmsFieldForShape(
    { ...coil, dIdtAPerS: peak }, shape, targetMm, opts.segments,
  );
  const timesMs: number[] = [];
  const dIdt: number[] = [];
  const fieldVm: Vec3Mm[] = [];
  const magnitudeVm: number[] = [];
  for (let i = 0; i <= nSteps; i++) {
    const t = i * sampleDtMs;
    const d = biphasicDIdtAt(t, peak, periodMs);
    const s = peak === 0 ? 0 : d / peak;
    timesMs.push(t);
    dIdt.push(d);
    const f: Vec3Mm = [base.fieldVm[0] * s, base.fieldVm[1] * s, base.fieldVm[2] * s];
    fieldVm.push(f);
    magnitudeVm.push(Math.hypot(...f));
  }
  return {
    shape, timesMs, dIdtAPerS: dIdt, fieldVm, magnitudeVm,
    peakMagnitudeVm: base.magnitudeVm, peakTimeMs: 0,
    modelId: base.modelId, waveformId: BIPHASIC_WAVEFORM_ID,
  };
}

/* ── Level A: direct drive ──────────────────────────────────────── */

export interface DirectDriveOptions {
  model: ColumnModel;
  /** Added input during the stimulus window: WC model units, or JR 1/s. */
  drive: number;
  /** Stimulus window length, ms. */
  durationMs?: number;
  /** Stimulus onset, ms (default 100, the PR5 comparison protocol). */
  stimOnMs?: number;
  /** Total run length, ms. */
  totalMs?: number;
  /** Output sampling interval, ms (must be a multiple of the column dt). */
  sampleDtMs?: number;
  wcParams?: LocalRateParams;
  jrParams?: JansenRitParams;
  morphology?: DipoleMorphology;
}
export interface ColumnResponse {
  timesMs: number[];
  qNAm: number[];
  /** Pz proxy EEG (uV): q * 0.16 uV/(nA*m). */
  eegUv: number[];
  peakAbsQNAm: number;
  peakTimeMs: number;
  model: ColumnModel;
  modelId: string;
}

function runColumnResponse(
  model: ColumnModel,
  driveAt: (tMs: number) => number,
  totalMs: number,
  sampleDtMs: number,
  wcParams: LocalRateParams,
  jrParams: JansenRitParams,
  morphology: DipoleMorphology,
): ColumnResponse {
  if (model === 'wc') {
    const col = createLocalCorticalColumn(wcParams, morphology);
    const dt = wcParams.dtMs;
    if (Math.abs(sampleDtMs / dt - Math.round(sampleDtMs / dt)) > 1e-9) {
      throw new RangeError('sampleDtMs must be a multiple of the WC column dt (1 ms)');
    }
    const stepsPerSample = Math.round(sampleDtMs / dt);
    const timesMs: number[] = [], qNAm: number[] = [];
    const nSteps = Math.round(totalMs / dt);
    for (let i = 0; i <= nSteps; i++) {
      if (i % stepsPerSample === 0) {
        const s = col.read();
        timesMs.push(s.tMs); qNAm.push(s.equivalentMomentNAm);
      }
      // Drive sampled at the step MIDPOINT, not the step start: for the
      // rectangular drives used elsewhere the edges sit on integer ms,
      // so this changes nothing there, but for a continuously varying
      // drive (flicker sine) it turns a first-order sampling error into
      // a second-order one. Measured: flicker q(t) vs continuous DOP853
      // drops from 0.047 to 3.4e-4 nA*m (see tests/pr7/debug-rounds-b.md).
      if (i < nSteps) col.step(driveAt(col.read().tMs + dt / 2));
    }
    let peak = 0, peakT = 0;
    qNAm.forEach((q, i) => { if (Math.abs(q) > peak) { peak = Math.abs(q); peakT = timesMs[i]; } });
    return {
      timesMs, qNAm, eegUv: qNAm.map(q => q * STIM_PZ_GAIN_UV_PER_NAM),
      peakAbsQNAm: peak, peakTimeMs: peakT, model,
      modelId: 'local-wc-cortical-column-assumed-dipole-v1',
    };
  }
  const col = createJansenRitColumn(jrParams, morphology);
  const dt = jrParams.dtMs;
  if (Math.abs(sampleDtMs / dt - Math.round(sampleDtMs / dt)) > 1e-9) {
    throw new RangeError('sampleDtMs must be a multiple of the JR column dt (0.5 ms)');
  }
  const stepsPerSample = Math.round(sampleDtMs / dt);
  const timesMs: number[] = [], qNAm: number[] = [];
  const nSteps = Math.round(totalMs / dt);
  for (let i = 0; i <= nSteps; i++) {
    if (i % stepsPerSample === 0) {
      const s = col.read();
      timesMs.push(s.tMs); qNAm.push(s.equivalentMomentNAm);
    }
    // Drive sampled at the step midpoint (see the WC branch above).
    if (i < nSteps) col.step(driveAt(col.read().tMs + dt / 2));
  }
  let peak = 0, peakT = 0;
  qNAm.forEach((q, i) => { if (Math.abs(q) > peak) { peak = Math.abs(q); peakT = timesMs[i]; } });
  return {
    timesMs, qNAm, eegUv: qNAm.map(q => q * STIM_PZ_GAIN_UV_PER_NAM),
    peakAbsQNAm: peak, peakTimeMs: peakT, model,
    modelId: 'local-jansen-rit-assumed-dipole-v1',
  };
}

/**
 * Level A: a rectangular added input on a local column, starting at
 * stimOnMs. This is a direct model input, NOT a tES/TMS stimulus:
 * no electrodes, no coil, no field is computed here.
 */
export function runDirectDrive(opts: DirectDriveOptions): ColumnResponse {
  const durationMs = opts.durationMs ?? 100;
  const stimOnMs = opts.stimOnMs ?? 100;
  const totalMs = opts.totalMs ?? 600;
  const sampleDtMs = opts.sampleDtMs ?? 4;
  if (!Number.isFinite(opts.drive)) throw new RangeError('Direct drive must be finite');
  if (opts.model === 'wc' && Math.abs(opts.drive) > 10) {
    throw new RangeError('WC direct drive must satisfy |drive| <= 10 model units');
  }
  if (opts.model === 'jr' && (opts.drive < 0 || opts.drive > 1000)) {
    throw new RangeError('JR direct drive must be in [0, 1000] 1/s');
  }
  if (durationMs <= 0 || stimOnMs < 0 || totalMs <= stimOnMs + durationMs) {
    throw new RangeError('Direct-drive window must fit inside the run');
  }
  const driveAt = (t: number) =>
    t >= stimOnMs && t < stimOnMs + durationMs ? opts.drive : 0;
  return runColumnResponse(
    opts.model, driveAt, totalMs, sampleDtMs,
    opts.wcParams ?? DEFAULT_RATE_PARAMS,
    opts.jrParams ?? DEFAULT_JANSEN_RIT_PARAMS,
    opts.morphology ?? DEFAULT_MORPHOLOGY,
  );
}

/* ── Level D: field -> neural response ──────────────────────────── */

/**
 * UNCALIBRATED transfer gains (default values, user-visible and editable):
 * - WC: 0.01 model units per (V/m) — a TMS-scale field of 100 V/m maps
 *   to a drive of 1.0, the same scale as the PR5 WC comparison pulse (1.4).
 * - JR: 1.0 (1/s) per (V/m) — 100 V/m maps to 100 1/s, the same scale as
 *   the PR5 JR comparison pulse (120 1/s).
 * A TES-scale field (~0.1-1 V/m) therefore moves almost nothing at the
 * default gain; that scale gap is a result, not a bug, and the gain is
 * exposed so the user can see what it would take. Neither gain has been
 * fitted to human data. Do not quote Level D responses as predictions
 * about a real brain.
 */
export const FIELD_TO_WC_GAIN_DEFAULT = 0.01;
export const FIELD_TO_JR_GAIN_DEFAULT = 1.0;

export interface FieldToDriveResult {
  /** Normal field component used, V/m. */
  normalFieldVm: number;
  /** WC added input, model units. */
  wcDrive: number;
  /** JR added input, 1/s. */
  jrDrivePerS: number;
}

export function fieldToDrive(
  normalFieldVm: number,
  opts: { wcGain?: number; jrGain?: number } = {},
): FieldToDriveResult {
  const wcGain = opts.wcGain ?? FIELD_TO_WC_GAIN_DEFAULT;
  const jrGain = opts.jrGain ?? FIELD_TO_JR_GAIN_DEFAULT;
  if (!Number.isFinite(normalFieldVm)) throw new RangeError('Field must be finite');
  if (!Number.isFinite(wcGain) || wcGain < 0 || !Number.isFinite(jrGain) || jrGain < 0) {
    throw new RangeError('Level D gains must be finite and >= 0');
  }
  const wcDrive = wcGain * normalFieldVm;
  const jrDrivePerS = jrGain * normalFieldVm;
  if (Math.abs(wcDrive) > 10 || jrDrivePerS < 0 || jrDrivePerS > 1000) {
    throw new RangeError(
      `Level D drive out of column range (WC ${wcDrive.toFixed(3)}, JR ${jrDrivePerS.toFixed(1)} 1/s): ` +
      'lower the gain or the field; the gain is uncalibrated and must not be hidden by clamping',
    );
  }
  return { normalFieldVm, wcDrive, jrDrivePerS };
}

export interface LevelDOptions {
  /** Full field vector at the target, V/m (from Level B or C). */
  fieldVm: Vec3Mm;
  /** Cortical surface normal at the target (unit vector). */
  normalHead?: Vec3Mm;
  model: ColumnModel;
  wcGain?: number;
  jrGain?: number;
  durationMs?: number;
  stimOnMs?: number;
  totalMs?: number;
  sampleDtMs?: number;
}
export interface LevelDResponse extends ColumnResponse {
  normalFieldVm: number;
  driveApplied: number;
  gainUsed: number;
}

/** Level D: field -> normal component -> uncalibrated gain -> column response. */
export function runLevelDResponse(opts: LevelDOptions): LevelDResponse {
  finiteVec3(opts.fieldVm, 'fieldVm');
  const normal = opts.normalHead ?? DEFAULT_TARGET_NORMAL_HEAD;
  const eNormal = normalComponentVm(opts.fieldVm, normal);
  const drive = fieldToDrive(eNormal, { wcGain: opts.wcGain, jrGain: opts.jrGain });
  const applied = opts.model === 'wc' ? drive.wcDrive : drive.jrDrivePerS;
  const gainUsed = opts.model === 'wc'
    ? (opts.wcGain ?? FIELD_TO_WC_GAIN_DEFAULT)
    : (opts.jrGain ?? FIELD_TO_JR_GAIN_DEFAULT);
  const resp = runDirectDrive({
    model: opts.model, drive: applied,
    durationMs: opts.durationMs, stimOnMs: opts.stimOnMs,
    totalMs: opts.totalMs, sampleDtMs: opts.sampleDtMs,
  });
  return { ...resp, normalFieldVm: eNormal, driveApplied: applied, gainUsed };
}

/* ── Sensory laboratory (§15.3) ─────────────────────────────────── */

/**
 * Visual flicker: sinusoidal modulation drive on a WC column.
 *   drive(t) = intensity * 0.5 * sin(2 pi f t),  model units, zero mean.
 * Amplitude 0.5 at intensity 1 is the same scale as the WC comparison
 * drives (1.0-1.4); the mapping is written here so it can be argued
 * with, not hidden. The column is WC, not JR: a JR column cannot take
 * the negative half-cycle (its step() rejects added input < 0) and its
 * p0 = 90 low branch latches under sustained positive drive, so it
 * cannot track a periodic input at all (measured, see docs §5).
 */
export const VISUAL_DRIVE_AMPLITUDE = 0.5;
export const VISUAL_FLICKER_DURATION_MS_DEFAULT = 4000;

export function visualFlickerDriveAt(tMs: number, freqHz: number, intensity: number): number {
  if (!Number.isFinite(freqHz) || freqHz <= 0 || freqHz > 60) {
    throw new RangeError('Flicker frequency must be in (0, 60] Hz');
  }
  if (!Number.isFinite(intensity) || intensity < 0 || intensity > 1) {
    throw new RangeError('Flicker intensity must be in [0, 1]');
  }
  return intensity * VISUAL_DRIVE_AMPLITUDE * Math.sin((2 * Math.PI * freqHz * tMs) / 1000);
}

export function runVisualFlicker(opts: {
  freqHz: number; intensity: number; durationMs?: number; sampleDtMs?: number;
}): ColumnResponse {
  const durationMs = opts.durationMs ?? VISUAL_FLICKER_DURATION_MS_DEFAULT;
  const sampleDtMs = opts.sampleDtMs ?? 4;
  if (durationMs < 1000) throw new RangeError('Flicker run must be >= 1000 ms (need cycles to measure)');
  // Validate through the drive function before integrating.
  visualFlickerDriveAt(0, opts.freqHz, opts.intensity);
  return runColumnResponse(
    'wc', (t) => visualFlickerDriveAt(t, opts.freqHz, opts.intensity),
    durationMs, sampleDtMs, DEFAULT_RATE_PARAMS, DEFAULT_JANSEN_RIT_PARAMS, DEFAULT_MORPHOLOGY,
  );
}

/**
 * Simplified auditory stimulation: rectangular tone bursts.
 *   drive(t) = intensity * 1.0 model units during each burst, else 0.
 * The tone frequency (Hz) is metadata only: it is validated, recorded
 * in the result, and deliberately NOT fed into the dynamics — a 1 ms
 * column step cannot resolve a kHz carrier, and no tonotopic mapping
 * is claimed. Two runs that differ only in toneHz give the same column
 * trace by design; the difference is in the burst timing/intensity,
 * which is what this simplified model actually defines.
 */
export const AUDITORY_BURST_DRIVE = 1.0;
export const AUDITORY_BURST_DURATION_MS_DEFAULT = 50;

export interface AuditoryTrainOptions {
  /** Tone frequency, Hz. Metadata only (see above). */
  toneHz: number;
  intensity: number;
  isiMs: number;
  nBursts?: number;
  burstDurationMs?: number;
  firstBurstMs?: number;
  totalMs?: number;
  sampleDtMs?: number;
}
export interface AuditoryTrainResult extends ColumnResponse {
  toneHz: number;
  burstOnsetsMs: number[];
  /** Peak |q| in the 300 ms after each burst onset, nA*m. */
  perBurstPeakAbsQNAm: number[];
  /**
   * Mean |q| in the fixed window [firstBurstMs, firstBurstMs + 1000 ms].
   * Fixed window, so a shorter ISI (more bursts inside the window)
   * gives a larger value — this is the ISI-scan metric.
   */
  fixedWindowMeanAbsQNAm: number;
}

export function runAuditoryTrain(opts: AuditoryTrainOptions): AuditoryTrainResult {
  if (!Number.isFinite(opts.toneHz) || opts.toneHz < 20 || opts.toneHz > 20000) {
    throw new RangeError('Tone frequency must be in [20, 20000] Hz');
  }
  if (!Number.isFinite(opts.intensity) || opts.intensity < 0 || opts.intensity > 1) {
    throw new RangeError('Auditory intensity must be in [0, 1]');
  }
  if (!Number.isFinite(opts.isiMs) || opts.isiMs < 100 || opts.isiMs > 5000) {
    throw new RangeError('Auditory ISI must be in [100, 5000] ms');
  }
  const nBursts = opts.nBursts ?? 5;
  const burstDurationMs = opts.burstDurationMs ?? AUDITORY_BURST_DURATION_MS_DEFAULT;
  const firstBurstMs = opts.firstBurstMs ?? 500;
  const totalMs = opts.totalMs ?? 3000;
  const sampleDtMs = opts.sampleDtMs ?? 4;
  if (!Number.isInteger(nBursts) || nBursts < 1 || nBursts > 20) {
    throw new RangeError('nBursts must be an integer in [1, 20]');
  }
  if (burstDurationMs <= 0 || burstDurationMs >= opts.isiMs) {
    throw new RangeError('Burst duration must be positive and shorter than the ISI');
  }
  if (firstBurstMs + (nBursts - 1) * opts.isiMs + burstDurationMs > totalMs) {
    throw new RangeError('Auditory burst train must fit inside the run');
  }
  const onsets: number[] = [];
  for (let k = 0; k < nBursts; k++) onsets.push(firstBurstMs + k * opts.isiMs);
  const driveAt = (t: number) => {
    for (const s of onsets) {
      if (t >= s && t < s + burstDurationMs) return opts.intensity * AUDITORY_BURST_DRIVE;
    }
    return 0;
  };
  const resp = runColumnResponse(
    'wc', driveAt, totalMs, sampleDtMs,
    DEFAULT_RATE_PARAMS, DEFAULT_JANSEN_RIT_PARAMS, DEFAULT_MORPHOLOGY,
  );
  const perBurstPeakAbsQNAm = onsets.map((s) => {
    let peak = 0;
    resp.timesMs.forEach((t, i) => {
      if (t >= s && t < s + 300) peak = Math.max(peak, Math.abs(resp.qNAm[i]));
    });
    return peak;
  });
  let sum = 0, n = 0;
  resp.timesMs.forEach((t, i) => {
    if (t >= firstBurstMs && t < firstBurstMs + 1000) { sum += Math.abs(resp.qNAm[i]); n++; }
  });
  return {
    ...resp, toneHz: opts.toneHz, burstOnsetsMs: onsets,
    perBurstPeakAbsQNAm, fixedWindowMeanAbsQNAm: n > 0 ? sum / n : 0,
  };
}

/** Response summary over a time window (for scans and the UI). */
export function summarizeResponse(
  timesMs: readonly number[], qNAm: readonly number[],
  windowMs?: readonly [number, number],
): { peakAbsQNAm: number; peakTimeMs: number; meanAbsQNAm: number; nSamples: number } {
  let peak = 0, peakT = 0, sum = 0, n = 0;
  timesMs.forEach((t, i) => {
    if (windowMs && (t < windowMs[0] || t >= windowMs[1])) return;
    const a = Math.abs(qNAm[i]);
    if (a > peak) { peak = a; peakT = t; }
    sum += a; n++;
  });
  return { peakAbsQNAm: peak, peakTimeMs: peakT, meanAbsQNAm: n > 0 ? sum / n : 0, nSamples: n };
}
