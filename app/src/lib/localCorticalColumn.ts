/**
 * PR5: explicitly assumed local cortical-column → equivalent dipole coupling.
 *
 * NOT a calibration of TVB's 76-node cross-species demo connectome and NOT
 * an empirically established inverse mapping from Wilson–Cowan E/I to EEG.
 *
 * A stable independent Wilson–Cowan rate population [E,I ∈ 0..1] is driven
 * by a stimulus. Signed changes from its equilibrium are interpreted as
 * illustrative changes of aligned transmembrane currents per neuron.
 *
 * Current dipole moment: q = N * coherence * length_m *
 * (I_exc_A_per_neuron * ΔE - I_inh_A_per_neuron * ΔI).
 * Converting pA × mm to nA·m gives factor 1e-6.
 * Projection: q_vector[nA·m] = q * unit_surface_normal_in_HEAD.
 * The MNE/BEM lead field alone maps q_vector -> V_electrode[µV].
 *
 * These quantities are hypotheses, not measured subject parameters.
 * Alignment orientation sign is a convention and cortical normal may not
 * perfectly represent real pyramidal dendrites (especially sulcal cortex).
 */
import type { Vec3Mm } from './volumeConduction';

export interface LocalRateParams {
  tauEMs: number;
  tauIMs: number;
  cEE: number;
  cEI: number;
  cIE: number;
  cII: number;
  tonicDrive: number;
  sigmoidSlope: number;
  sigmoidThreshold: number;
  dtMs: number;
}
export interface DipoleMorphology {
  /** Effective aligned cortical pyramidal cells (not measured). */
  effectivePyramidalCells: number;
  /** Fraction whose current dipoles add coherently. */
  coherence: number;
  /** Assumed effective E-related signed transmembrane current per neuron. */
  excitatoryCurrentPA: number;
  /** Assumed effective I-related opposing transmembrane current per neuron. */
  inhibitoryCurrentPA: number;
  /** Effective separation of current source and sink, mm. */
  dipoleSeparationMm: number;
}
export interface ColumnState {
  tMs: number;
  e: number;
  i: number;
  baselineE: number;
  baselineI: number;
  equivalentMomentNAm: number;
}
export const COUPLING_ID = 'local-wc-cortical-column-assumed-dipole-v1';
export const COUPLING_LIMITATION =
  '局部 Wilson–Cowan E/I → 皮层偶极矩是显式假设的可解释机制演示，并非受试者校准；不能映射既有 TVB 76 区网络到 fsaverage。';

export const DEFAULT_RATE_PARAMS: Readonly<LocalRateParams> = Object.freeze({
  tauEMs: 12,
  tauIMs: 20,
  cEE: 2.8,
  cEI: 2.4,
  cIE: 2.6,
  cII: 0.2,
  tonicDrive: 0.1,
  sigmoidSlope: 2.5,
  sigmoidThreshold: 1.1,
  dtMs: 1,
});
export const DEFAULT_MORPHOLOGY: Readonly<DipoleMorphology> = Object.freeze({
  effectivePyramidalCells: 1_000_000,
  coherence: 0.08,
  excitatoryCurrentPA: 200,
  inhibitoryCurrentPA: 100,
  dipoleSeparationMm: 0.5,
});

export function validateRateParams(p: LocalRateParams): void {
  const values = Object.values(p);
  if (values.length !== 10 || values.some(v=>!Number.isFinite(v)) ||
      p.tauEMs <= 0 || p.tauIMs <= 0 ||
      p.sigmoidSlope <= 0 ||
      p.dtMs <= 0 || p.dtMs > Math.min(p.tauEMs,p.tauIMs)/2 ||
      [p.cEE,p.cEI,p.cIE,p.cII].some(v=>v < 0)) {
    throw new RangeError('Invalid local population rate parameters');
  }
}
export function validateMorphology(p: DipoleMorphology):void {
  if (Object.values(p).length !== 5 ||
      Object.values(p).some(v=>!Number.isFinite(v)) ||
      p.effectivePyramidalCells <= 0 ||
      p.coherence<0 || p.coherence>1 ||
      p.excitatoryCurrentPA<=0 || p.inhibitoryCurrentPA<=0 ||
      p.dipoleSeparationMm<=0) {
    throw new RangeError('Invalid positive cellular current/morphology parameters');
  }
}
export function equivalentMomentNAm(
  e:number, i:number, baselineE:number, baselineI:number,
  morph:DipoleMorphology=DEFAULT_MORPHOLOGY,
):number {
  validateMorphology(morph);
  if (![e,i,baselineE,baselineI].every(Number.isFinite) ||
      [e,i,baselineE,baselineI].some(v=>v<0||v>1)) {
    throw new RangeError('E and I must be finite rate fractions between 0 and 1');
  }
  const effectivePA=morph.excitatoryCurrentPA*(e-baselineE) -
    morph.inhibitoryCurrentPA*(i-baselineI);
  // pA × mm = 1e-6 nA·m, explicitly including N and alignment.
  return morph.effectivePyramidalCells*morph.coherence*
    morph.dipoleSeparationMm*effectivePA*1e-6;
}
export function alignedDipoleVectorNAm(
  magnitudeNAm:number, normalHead:Vec3Mm,
): Vec3Mm {
  if (!Number.isFinite(magnitudeNAm) || normalHead.length!==3 ||
      !normalHead.every(Number.isFinite)) {
    throw new RangeError('Nonfinite dipole or invalid HEAD normal');
  }
  const norm=Math.hypot(...normalHead);
  if (Math.abs(norm-1)>1e-3) {
    throw new RangeError('Cortical source normal must already be a unit vector');
  }
  return [
    magnitudeNAm*normalHead[0],
    magnitudeNAm*normalHead[1],
    magnitudeNAm*normalHead[2],
  ];
}

/** Stable explicit sigmoid; physical input is dimensionless drive. */
function sigmoid(z:number, p:LocalRateParams):number {
  const a=p.sigmoidSlope*(z-p.sigmoidThreshold);
  if(a>=0){const k=Math.exp(-a);return 1/(1+k);}
  const k=Math.exp(a);return k/(1+k);
}
type RatePair = readonly [number,number];
function derivative(s:RatePair, input:number, p:LocalRateParams):RatePair {
  const [e,i]=s;
  return [
    (-e+sigmoid(p.cEE*e-p.cEI*i+p.tonicDrive+input,p))/p.tauEMs,
    (-i+sigmoid(p.cIE*e-p.cII*i+p.tonicDrive,p))/p.tauIMs,
  ];
}
function rk4(s:RatePair, stimulus:number, p:LocalRateParams, dt:number):RatePair {
  const k1=derivative(s,stimulus,p);
  const k2=derivative([s[0]+dt*k1[0]/2,s[1]+dt*k1[1]/2],stimulus,p);
  const k3=derivative([s[0]+dt*k2[0]/2,s[1]+dt*k2[1]/2],stimulus,p);
  const k4=derivative([s[0]+dt*k3[0],s[1]+dt*k3[1]],stimulus,p);
  return [
    s[0]+dt*(k1[0]+2*k2[0]+2*k3[0]+k4[0])/6,
    s[1]+dt*(k1[1]+2*k2[1]+2*k3[1]+k4[1])/6,
  ];
}

/** Find fixed point by unforced physical time integration, not a handpicked E baseline. */
export function equilibrateLocalColumn(p:LocalRateParams=DEFAULT_RATE_PARAMS):RatePair {
  validateRateParams(p);
  let state:RatePair=[0.1,0.1];
  const duration=5000;
  for(let t=0;t<duration;t+=p.dtMs)
    state=rk4(state,0,p,Math.min(p.dtMs,duration-t));
  const residual=derivative(state,0,p);
  if (Math.max(Math.abs(residual[0]),Math.abs(residual[1]))>1e-7 ||
      state.some(v=>!Number.isFinite(v)||v<0||v>1)) {
    throw new RangeError('No stable physical equilibrium for these rate parameters');
  }
  return state;
}

/** Deterministic local population with explicit simulated clock (ms). */
export function createLocalCorticalColumn(
  params:LocalRateParams=DEFAULT_RATE_PARAMS,
  morphology:DipoleMorphology=DEFAULT_MORPHOLOGY,
) {
  validateRateParams(params);
  validateMorphology(morphology);
  const [baselineE,baselineI]=equilibrateLocalColumn(params);
  let state:RatePair=[baselineE,baselineI];
  let t=0;
  const read=():ColumnState=>({
    tMs:t,e:state[0],i:state[1],baselineE,baselineI,
    equivalentMomentNAm:equivalentMomentNAm(
      state[0],state[1],baselineE,baselineI,morphology),
  });
  return {
    read,
    reset:():ColumnState=>{state=[baselineE,baselineI];t=0;return read();},
    /** Each step is an actual ODE solution over the interval; stimulation constant over step. */
    step:(stimulus=0):ColumnState=>{
      if(!Number.isFinite(stimulus)||Math.abs(stimulus)>10)
        throw new RangeError('Unphysical/nonfinite external rate drive');
      state=rk4(state,stimulus,params,params.dtMs);
      if(state.some(v=>!Number.isFinite(v)||v<0||v>1))
        throw new RangeError('Neural population diverged');
      t+=params.dtMs;
      return read();
    },
  };
}
