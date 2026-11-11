/**
 * PR5: Jansen-Rit neural-mass route as an INDEPENDENT check on the
 * Wilson-Cowan local-column -> dipole coupling.
 *
 * Jansen-Rit (Jansen & Rit 1995, Biol. Cybern. 73:357-366): three
 * populations (pyramidal cells, excitatory and inhibitory interneurons),
 * second-order synaptic kernels, sigmoid firing-rate nonlinearity.
 * Time in ms, potentials in mV, sigmoid output in 1/s (converted to per-ms
 * inside the derivatives, exactly as in scientific/forward/
 * jansen_rit_reference.py).
 *
 * The model EEG proxy is the pyramidal-population postsynaptic potential
 * y0(t) [mV] -- the quantity Jansen & Rit themselves use as the EEG
 * output -- NOT its time derivative and NOT a firing rate. The dipole
 * coupling is the SAME assumed chain as the Wilson-Cowan route: the
 * baseline-subtracted PSP is mapped to an effective per-neuron
 * transmembrane-current change through an assumed slope g [pA/mV],
 * then q = N * coherence * length * g * (y0 - y0_0) * 1e-6 [nA*m].
 * g is deliberately set equal to the WC route's assumed per-neuron
 * excitatory current (200 pA) so both routes share one current scale.
 * That slope is an ASSUMPTION, not a measurement: the N x coherence x
 * current x length product is structurally non-identifiable from EEG
 * amplitude alone, exactly as for the WC route. Neither route is "real EEG".
 *
 * Resting state (this project's comparison protocol): mean afferent input
 * p0 = 90 1/s (the mean used by Wendling et al. 2002 for the same
 * equations), LOW resting branch. The Jansen-Rit equations are bistable
 * at low input and the standard p0 = 220 1/s operating point is a
 * ~10.5 Hz limit cycle (alpha), not a fixed point; see
 * docs/pr5-jansen-rit.md. Equilibration integrates from zero, which
 * converges onto the strongly stable low branch at p0 = 90.
 */
import {
  DEFAULT_MORPHOLOGY, validateMorphology,
  type DipoleMorphology,
} from './localCorticalColumn.ts';

export interface JansenRitParams {
  /** Excitatory synaptic gain A, mV. */
  gainExcMv: number;
  /** Inhibitory synaptic gain B, mV. */
  gainInhMv: number;
  /** Excitatory lumped rate constant a, 1/s. */
  rateExcPerS: number;
  /** Inhibitory lumped rate constant b, 1/s. */
  rateInhPerS: number;
  c1: number; c2: number; c3: number; c4: number;
  /** Sigmoid maximum firing rate 2*e0 is stored as e0, 1/s. */
  sigmoidMaxPerS: number;
  /** Sigmoid half-activation potential v0, mV. */
  sigmoidHalfMv: number;
  /** Sigmoid slope r, 1/mV. */
  sigmoidSlopePerMv: number;
  /** Resting mean afferent input p0, 1/s. */
  baselineInputPerS: number;
  dtMs: number;
}
export interface JansenRitState {
  tMs: number;
  /** Pyramidal-population PSP y0, mV (model EEG proxy). */
  y0: number;
  /** Excitatory-interneuron PSP y1, mV. */
  y1: number;
  /** Inhibitory-interneuron PSP y2, mV. */
  y2: number;
  /** Net PSP seen by pyramidal cells, y1 - y2, mV. */
  y1MinusY2: number;
  baselineY0: number;
  baselineY1: number;
  baselineY2: number;
  equivalentMomentNAm: number;
}
export const JANSEN_RIT_ID = 'local-jansen-rit-assumed-dipole-v1';
export const JANSEN_RIT_LIMITATION =
  '局部 Jansen-Rit 锥体 PSP → 皮层偶极矩是显式假设的可解释机制演示，'
  + 'pA/mV 斜率未经人体数据校准；与 Wilson-Cowan 路线可比但不可辨识，'
  + '两者都不是真实脑电。';
/** Assumed PSP-to-current slope, pA per mV; equals the WC route's assumed
 *  per-neuron excitatory current so both routes share one current scale. */
export const JR_PSP_TO_CURRENT_PA_PER_MV = 200;

export const DEFAULT_JANSEN_RIT_PARAMS: Readonly<JansenRitParams> =
  Object.freeze({
    // RK4 step 0.5 ms (same RK4 scheme as the WC route, finer step):
    // at dt = 1 ms the RK4-vs-DOP853 error in y1 reaches 7.6e-6 mV, at
    // 0.5 ms every state variable stays below 1e-6 (max 4.6e-7 mV) and
    // the q(t) error below 3e-8 nA*m. Measured, not assumed.
    gainExcMv: 3.25,
    gainInhMv: 22,
    rateExcPerS: 100,
    rateInhPerS: 50,
    c1: 135, c2: 108, c3: 33.75, c4: 33.75,
    sigmoidMaxPerS: 2.5,
    sigmoidHalfMv: 6,
    sigmoidSlopePerMv: 0.56,
    baselineInputPerS: 90,
    dtMs: 0.5,
  });
/** Same morphology numbers as the WC route (shared assumed chain). */
export const DEFAULT_JR_MORPHOLOGY: Readonly<DipoleMorphology> =
  DEFAULT_MORPHOLOGY;

export function validateJansenRitParams(p: JansenRitParams): void {
  const values = Object.values(p);
  if (values.length !== 13 || values.some(v => !Number.isFinite(v)) ||
      p.gainExcMv <= 0 || p.gainInhMv <= 0 ||
      p.rateExcPerS <= 0 || p.rateInhPerS <= 0 ||
      p.sigmoidMaxPerS <= 0 || p.sigmoidSlopePerMv <= 0 ||
      p.baselineInputPerS < 0 ||
      [p.c1, p.c2, p.c3, p.c4].some(v => v < 0) ||
      p.dtMs <= 0 ||
      p.dtMs > Math.min(1000 / p.rateExcPerS, 1000 / p.rateInhPerS) / 2) {
    throw new RangeError('Invalid Jansen-Rit parameters');
  }
}

export function equivalentMomentNAmJR(
  y0: number, baselineY0: number,
  morph: DipoleMorphology = DEFAULT_JR_MORPHOLOGY,
): number {
  validateMorphology(morph);
  if (![y0, baselineY0].every(Number.isFinite)) {
    throw new RangeError('Pyramidal PSP must be finite');
  }
  // pA x mm = 1e-6 nA*m, explicitly including N and coherence.
  return morph.effectivePyramidalCells * morph.coherence *
    morph.dipoleSeparationMm * JR_PSP_TO_CURRENT_PA_PER_MV *
    (y0 - baselineY0) * 1e-6;
}

/** Sigmoid firing rate in 1/s; input potential in mV. */
export function jansenRitSigmoidPerS(vMv: number, p: JansenRitParams): number {
  const a = p.sigmoidSlopePerMv * (p.sigmoidHalfMv - vMv);
  // S(v) = 2*e0 / (1 + exp(a)); stable form in both branches.
  if (a >= 0) { const k = Math.exp(-a); return 2 * p.sigmoidMaxPerS * k / (1 + k); }
  const k = Math.exp(a); return 2 * p.sigmoidMaxPerS / (1 + k);
}

export type JansenRitFullState = readonly [number, number, number, number, number, number];

function derivative(
  s: JansenRitFullState, inputPerS: number, p: JansenRitParams,
): JansenRitFullState {
  const [y0, y1, y2, y3, y4, y5] = s;
  const a = p.rateExcPerS / 1000; // 1/ms
  const b = p.rateInhPerS / 1000; // 1/ms
  const sPerMs = (v: number) => jansenRitSigmoidPerS(v, p) / 1000; // 1/ms
  const inputPerMs = inputPerS / 1000; // 1/ms
  return [
    y3,
    y4,
    y5,
    p.gainExcMv * a * sPerMs(y1 - y2) - 2 * a * y3 - a * a * y0,
    p.gainExcMv * a * (inputPerMs + p.c2 * sPerMs(p.c1 * y0)) -
      2 * a * y4 - a * a * y1,
    p.gainInhMv * b * p.c4 * sPerMs(p.c3 * y0) - 2 * b * y5 - b * b * y2,
  ];
}
function rk4(
  s: JansenRitFullState, inputPerS: number, p: JansenRitParams, dt: number,
): JansenRitFullState {
  const add = (x: JansenRitFullState, k: JansenRitFullState, f: number):
    JansenRitFullState =>
    [x[0] + f * k[0], x[1] + f * k[1], x[2] + f * k[2],
     x[3] + f * k[3], x[4] + f * k[4], x[5] + f * k[5]] as const;
  const k1 = derivative(s, inputPerS, p);
  const k2 = derivative(add(s, k1, dt / 2), inputPerS, p);
  const k3 = derivative(add(s, k2, dt / 2), inputPerS, p);
  const k4 = derivative(add(s, k3, dt), inputPerS, p);
  const w = (i: number) => dt * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]) / 6;
  return [s[0] + w(0), s[1] + w(1), s[2] + w(2),
          s[3] + w(3), s[4] + w(4), s[5] + w(5)] as const;
}

/**
 * Find the resting fixed point by physical time integration from zero,
 * exactly as the WC route equilibrates. At the default p0 = 90 1/s this
 * converges onto the strongly stable low branch; at inputs where no
 * stable fixed point exists (e.g. p0 = 220 1/s, a limit cycle) the
 * residual check fails loudly instead of silently returning a wrong point.
 */
export function equilibrateJansenRit(
  p: JansenRitParams = DEFAULT_JANSEN_RIT_PARAMS,
): JansenRitFullState {
  validateJansenRitParams(p);
  let state: JansenRitFullState = [0, 0, 0, 0, 0, 0];
  const duration = 5000;
  for (let t = 0; t < duration; t += p.dtMs) {
    state = rk4(state, p.baselineInputPerS, p,
      Math.min(p.dtMs, duration - t));
  }
  const residual = derivative(state, p.baselineInputPerS, p);
  if (Math.max(...residual.map(Math.abs)) > 1e-6 ||
      state.some(v => !Number.isFinite(v))) {
    throw new RangeError(
      'No stable physical equilibrium for these Jansen-Rit parameters');
  }
  return state;
}

/** Deterministic Jansen-Rit column with explicit simulated clock (ms). */
export function createJansenRitColumn(
  params: JansenRitParams = DEFAULT_JANSEN_RIT_PARAMS,
  morphology: DipoleMorphology = DEFAULT_JR_MORPHOLOGY,
  opts: { equilibrate?: boolean; initialState?: JansenRitFullState } = {},
) {
  validateJansenRitParams(params);
  validateMorphology(morphology);
  const equilibrate = opts.equilibrate !== false;
  const baseline = equilibrate
    ? equilibrateJansenRit(params)
    : (opts.initialState ?? [0, 0, 0, 0, 0, 0] as const);
  let state: JansenRitFullState = baseline;
  let t = 0;
  const read = (): JansenRitState => ({
    tMs: t,
    y0: state[0], y1: state[1], y2: state[2],
    y1MinusY2: state[1] - state[2],
    baselineY0: baseline[0], baselineY1: baseline[1], baselineY2: baseline[2],
    equivalentMomentNAm: equivalentMomentNAmJR(state[0], baseline[0], morphology),
  });
  return {
    read,
    reset: (): JansenRitState => { state = baseline; t = 0; return read(); },
    /** Each step is an actual ODE solution over the interval; the added
     *  input (1/s) is constant over the step. */
    step: (addedInputPerS = 0): JansenRitState => {
      if (!Number.isFinite(addedInputPerS) ||
          addedInputPerS < 0 || addedInputPerS > 1000) {
        throw new RangeError('Unphysical/nonfinite Jansen-Rit input pulse');
      }
      state = rk4(state, params.baselineInputPerS + addedInputPerS,
        params, params.dtMs);
      if (state.some(v => !Number.isFinite(v)) ||
          state[0] < -10 || state[0] > 100 ||
          state[1] < -10 || state[1] > 100 ||
          state[2] < -10 || state[2] > 100) {
        throw new RangeError('Jansen-Rit population diverged');
      }
      t += params.dtMs;
      return read();
    },
  };
}
