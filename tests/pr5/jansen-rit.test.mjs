import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  JANSEN_RIT_ID, JANSEN_RIT_LIMITATION, JR_PSP_TO_CURRENT_PA_PER_MV,
  DEFAULT_JANSEN_RIT_PARAMS, DEFAULT_JR_MORPHOLOGY,
  validateJansenRitParams, jansenRitSigmoidPerS,
  equivalentMomentNAmJR, equilibrateJansenRit, createJansenRitColumn,
} from '../../app/src/lib/jansenRitColumn.ts';
import {
  DEFAULT_MORPHOLOGY, alignedDipoleVectorNAm, createLocalCorticalColumn,
} from '../../app/src/lib/localCorticalColumn.ts';
import {templateSourcePotentials} from '../../app/src/lib/fsaverageBEM.ts';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol,
  'expected ' + a + ' ~ ' + b + ' (tolerance ' + tol + ')');

/** Shared comparison protocol: same 80-120 ms window, 600 ms run, 1 ms
 *  sampling. The JR sim advances 0.5 ms per step, so it takes two substeps
 *  per 1 ms sample (same pulse across both). */
function runComparison() {
  const wc = createLocalCorticalColumn();
  const jr = createJansenRitColumn();
  const wcQ = [0], jrQ = [0];
  for (let ms = 0; ms < 600; ms++) {
    const stim = ms >= 80 && ms < 120;
    wcQ.push(wc.step(stim ? 1.4 : 0).equivalentMomentNAm);
    jr.step(stim ? 120 : 0);
    jrQ.push(jr.step(stim ? 120 : 0).equivalentMomentNAm);
  }
  return {wcQ, jrQ};
}
function peakOf(q) {
  let i = 0;
  for (let k = 1; k < q.length; k++) if (Math.abs(q[k]) > Math.abs(q[i])) i = k;
  return {peak: q[i], latencyMs: i};
}
function halfLifeMs(q) {
  const {peak, latencyMs} = peakOf(q);
  for (let k = latencyMs + 1; k < q.length; k++) {
    if (Math.abs(q[k]) < Math.abs(peak) / 2) return k - latencyMs;
  }
  return NaN;
}
/** FFT peak (excl. DC) of the detrended, Hann-windowed post-stimulus
 *  segment, resampled to ~4 ms spacing; mirrors the Python reference
 *  metric. `dtMs` is the spacing of the input series in ms. */
function dominantFreqHz(q, dtMs) {
  const startIdx = Math.round(120 / dtMs);
  const stride = Math.max(1, Math.round(4 / dtMs));
  const seg = [];
  for (let k = startIdx; k < q.length; k += stride) seg.push(q[k]);
  const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
  const win = seg.map((v, i) =>
    (v - mean) * 0.5 * (1 - Math.cos(2 * Math.PI * i / (seg.length - 1))));
  const durationS = (seg.length - 1) * stride * dtMs / 1000;
  let best = 1, bestMag = -1;
  for (let k = 1; k < seg.length / 2; k++) {
    let re = 0, im = 0;
    for (let n = 0; n < win.length; n++) {
      const ang = 2 * Math.PI * k * n / win.length;
      re += win[n] * Math.cos(ang); im -= win[n] * Math.sin(ang);
    }
    const mag = Math.hypot(re, im);
    if (mag > bestMag) { bestMag = mag; best = k; }
  }
  return best / durationS;
}

test('mechanistic units and reference identity explicitly mark assumed biology', () => {
  assert.match(JANSEN_RIT_ID, /assumed-dipole/);
  assert.match(JANSEN_RIT_LIMITATION, /未经人体数据校准/);
  assert.equal(DEFAULT_JANSEN_RIT_PARAMS.dtMs, 0.5);
  assert.equal(JR_PSP_TO_CURRENT_PA_PER_MV, 200);
  assert.equal(DEFAULT_JR_MORPHOLOGY.effectivePyramidalCells,
    DEFAULT_MORPHOLOGY.effectivePyramidalCells);
  assert.equal(DEFAULT_JR_MORPHOLOGY.coherence, DEFAULT_MORPHOLOGY.coherence);
  assert.equal(DEFAULT_JR_MORPHOLOGY.dipoleSeparationMm,
    DEFAULT_MORPHOLOGY.dipoleSeparationMm);
});

test('dimension: 1 mV x 200 pA/mV x 1M cells x 1 coherence x 1 mm = 200 nA*m', () => {
  const m = {
    effectivePyramidalCells: 1_000_000, coherence: 1,
    excitatoryCurrentPA: 200, inhibitoryCurrentPA: 100, dipoleSeparationMm: 1,
  };
  near(equivalentMomentNAmJR(1, 0, m), 200);
  near(equivalentMomentNAmJR(0.5, 0.25, m), 50);
});

test('baseline-subtracted PSP gives exactly zero physical source', () => {
  near(equivalentMomentNAmJR(0.37, 0.37), 0);
  const sim = createJansenRitColumn();
  const x = sim.read();
  near(x.equivalentMomentNAm, 0);
  near(x.tMs, 0);
  near(x.y1MinusY2, x.y1 - x.y2);
});

test('sigmoid stays in (0, 2*e0) and is monotone', () => {
  const p = DEFAULT_JANSEN_RIT_PARAMS;
  near(jansenRitSigmoidPerS(6, p), p.sigmoidMaxPerS, 1e-12);
  assert.ok(jansenRitSigmoidPerS(-50, p) < 0.01);
  assert.ok(jansenRitSigmoidPerS(50, p) > 2 * p.sigmoidMaxPerS - 0.01);
  assert.ok(jansenRitSigmoidPerS(0, p) < jansenRitSigmoidPerS(10, p));
});

test('N and coherence are structurally non-identifiable from one EEG amplitude', () => {
  const m = {...DEFAULT_JR_MORPHOLOGY};
  const ref = equivalentMomentNAmJR(0.14, 0.01, m);
  const alt = {...m, effectivePyramidalCells: m.effectivePyramidalCells * 2,
    coherence: m.coherence / 2};
  near(equivalentMomentNAmJR(0.14, 0.01, alt), ref, 1e-12);
  // Doubling the source-sink length doubles q, so length trades against
  // the assumed pA/mV slope; N x coherence alone cannot be split by any
  // single EEG amplitude.
  near(equivalentMomentNAmJR(0.14, 0.01, {...m,
    dipoleSeparationMm: m.dipoleSeparationMm * 2}), 2 * ref, 1e-12);
});

test('bad parameters, morphology and drive inputs fail explicitly', () => {
  assert.throws(() => validateJansenRitParams(
    {...DEFAULT_JANSEN_RIT_PARAMS, rateExcPerS: -1}), /Invalid/);
  assert.throws(() => validateJansenRitParams(
    {...DEFAULT_JANSEN_RIT_PARAMS, dtMs: 50}), /Invalid/);
  assert.throws(() => validateJansenRitParams(
    {...DEFAULT_JANSEN_RIT_PARAMS, baselineInputPerS: -5}), /Invalid/);
  assert.throws(() => equivalentMomentNAmJR(NaN, 0), /finite/);
  assert.throws(() => createJansenRitColumn().step(-1), /Unphysical/);
  assert.throws(() => createJansenRitColumn().step(5000), /Unphysical/);
  // No stable fixed point at the standard p0 = 220 1/s (limit cycle):
  // equilibration must fail loudly, not return a wrong resting point.
  assert.throws(() => equilibrateJansenRit(
    {...DEFAULT_JANSEN_RIT_PARAMS, baselineInputPerS: 220}),
    /No stable physical equilibrium/);
});

test('same input timeline produces deterministic PSP, moment and reset', () => {
  const a = createJansenRitColumn(), b = createJansenRitColumn();
  const drive = (sim) => {
    while (sim.read().tMs < 600) {
      const time = sim.read().tMs;
      sim.step(time >= 80 && time < 120 ? 120 : 0);
    }
  };
  drive(a); drive(b);
  assert.deepEqual(a.read(), b.read());
  assert.ok(Math.abs(a.read().equivalentMomentNAm) < 0.01,
    'response returns to baseline');
  a.reset();
  assert.deepEqual(a.read(), createJansenRitColumn().read());
});

test('stimulus causes a positive PSP transient that returns to baseline', () => {
  const s = createJansenRitColumn();
  while (s.read().tMs < 80) s.step();
  const base = s.read();
  while (s.read().tMs < 120) s.step(120);
  // The PSP peaks ~56 ms after stimulus offset (synaptic-kernel delay),
  // so the rise is checked at the response peak, not at stimulus offset.
  while (s.read().tMs < 180) s.step();
  const excited = s.read();
  assert.ok(excited.y0 > base.y0 + 0.05, 'PSP rises on stimulus');
  assert.ok(excited.equivalentMomentNAm > 0.5, 'dipole moment rises');
  while (s.read().tMs < 2180) s.step();
  near(s.read().equivalentMomentNAm, 0, 1e-8);
});

test('independent SciPy DOP853 fixed-point and trajectory cross-check', () => {
  const ref = JSON.parse(readFileSync(new URL(
    './fixtures/jansen-rit-reference.json', import.meta.url), 'utf8'));
  const s = createJansenRitColumn();
  near(s.read().baselineY0, ref.baseline_y0_mV, 1e-6);
  near(s.read().baselineY1, ref.baseline_y1_mV, 1e-6);
  near(s.read().baselineY2, ref.baseline_y2_mV, 1e-6);
  for (const sample of ref.samples) {
    while (s.read().tMs < sample.t_ms) {
      const time = s.read().tMs;
      s.step(time >= 80 && time < 120 ? 120 : 0);
    }
    const x = s.read();
    near(x.tMs, sample.t_ms, 1e-8);
    near(x.y0, sample.y0, 1e-6);
    near(x.y1, sample.y1, 1e-6);
    near(x.y2, sample.y2, 1e-6);
    near(x.equivalentMomentNAm, sample.q_nAm, 1e-6);
  }
  near(Math.max(...ref.samples.map(v => Math.abs(v.q_nAm))),
    ref.metrics.peak_q_nAm, 1e-9);
});

test('JR vs WC comparison: reproducible difference ranges (same window)', () => {
  const {wcQ, jrQ} = runComparison();
  const wc = peakOf(wcQ), jr = peakOf(jrQ);
  assert.ok(wc.peak > 0 && jr.peak > 0, 'both routes give positive peaks');
  const ratio = jr.peak / wc.peak;
  assert.ok(ratio > 0.15 && ratio < 0.35,
    'JR/WC peak-moment ratio in [0.15, 0.35], got ' + ratio.toFixed(3));
  const latencyDiff = jr.latencyMs - wc.latencyMs;
  assert.ok(latencyDiff >= 50 && latencyDiff <= 85,
    'JR peak ' + latencyDiff + ' ms later than WC, expected 50-85 ms');
  const jrHalf = halfLifeMs(jrQ), wcHalf = halfLifeMs(wcQ);
  assert.ok(jrHalf >= 22 && jrHalf <= 45, 'JR half-life 22-45 ms, got ' + jrHalf);
  assert.ok(wcHalf >= 12 && wcHalf <= 30, 'WC half-life 12-30 ms, got ' + wcHalf);
  assert.ok(jrHalf > wcHalf, 'JR recovers more slowly than WC');
  // Both responses are single transients: the post-stimulus spectrum peaks
  // at the lowest resolvable bin (2.07 Hz for the 480 ms window), i.e.
  // neither route oscillates after the stimulus. The JR alpha rhythm only
  // appears at the standard p0 = 220 1/s operating point (see next test).
  const jrFreq = dominantFreqHz(jrQ, 1), wcFreq = dominantFreqHz(wcQ, 1);
  assert.ok(jrFreq >= 1.5 && jrFreq <= 3.0,
    'JR dom freq 1.5-3 Hz, got ' + jrFreq);
  assert.ok(wcFreq >= 1.5 && wcFreq <= 3.0,
    'WC dom freq 1.5-3 Hz, got ' + wcFreq);
  assert.ok(Math.abs(jrQ[600]) < 0.01 && Math.abs(wcQ[600]) < 0.01,
    'both routes return to baseline by 600 ms');
});

test('dimensionally valid JR q is projected through the same BEM lead field', () => {
  const q = equivalentMomentNAmJR(0.14, 0.01);
  const moment = alignedDipoleVectorNAm(q, [0, 0, 1]);
  const fixture = {
    source_positions: [{head_mm: [0, 0, 0]}],
    electrodes: [{label: 'A'}, {label: 'B'}],
    gains_uV_per_nAm: [[2, 3, 4], [2, 3, -4]],
  };
  const values = templateSourcePotentials(fixture, 0, moment, {mode: 'infinity'});
  near(values[0], 4 * q);
  near(values[1], -4 * q);
  const referenced = templateSourcePotentials(fixture, 0, moment);
  near(referenced[0] + referenced[1], 0);
});

test('standard p0 = 220 1/s shows the Jansen-Rit alpha limit cycle', () => {
  const s = createJansenRitColumn(
    {...DEFAULT_JANSEN_RIT_PARAMS, baselineInputPerS: 220},
    DEFAULT_JR_MORPHOLOGY, {equilibrate: false});
  // 20,000 x 0.5 ms = 10 s: the unstable mode grows slowly out of the
  // RK4 truncation seed, so the run must be long enough to reach the
  // limit cycle from a zero start.
  const trace = [];
  for (let n = 0; n < 20000; n++) trace.push(s.step(0).y0);
  const tail = trace.slice(16000);
  const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
  const std = Math.sqrt(
    tail.reduce((a, b) => a + (b - mean) ** 2, 0) / tail.length);
  assert.ok(std > 0.005, 'limit cycle oscillates, std ' + std.toFixed(4));
  const freq = dominantFreqHz(tail.map(v => v - mean), 0.5);
  assert.ok(freq >= 9 && freq <= 12, 'alpha 9-12 Hz, got ' + freq.toFixed(2));
});
