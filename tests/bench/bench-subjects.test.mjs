/**
 * Subject composer parameter table tests (pictorial bench, design §5).
 *
 * Covers: every slider's range/default (the engine's hard boundaries, not
 * UI choices), the combination-summary wording rules (fixed thresholds,
 * no disease names, no clinical judgement), and the q-chip subject line.
 *
 * Run: node --experimental-strip-types --test tests/bench/bench-subjects.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPOSER_SLIDERS, EPILEPSY_DIRECTIONS, SUMMARY_THRESHOLDS,
  subjectSummaryLine, summarizeCombination,
} from '../../app/src/lib/benchSubjects.ts';
import { BENCH_SETTINGS_DEFAULTS } from '../../app/src/lib/benchSettings.ts';

const byId = Object.fromEntries(COMPOSER_SLIDERS.map((s) => [s.id, s]));

test('slider table: ranges and defaults are the engine hard boundaries', () => {
  // A1: g >= 0.5 flips the baseline (protocol.ts); A2: c_ei = 2 flips the
  // network (protocol.ts). B2: 0.20 locks with no input (simClient.ts).
  // B3: 0.30 preset works, 0.50 does not return (pr4_pulse_safety.py).
  assert.deepEqual(byId.g, { id: 'g', group: 'A', field: 'g', min: 0, max: 0.4, step: 0.01, default: 0.35, unit: '' });
  assert.deepEqual(byId.cEi, { id: 'cEi', group: 'A', field: 'cEi', min: 3, max: 8, step: 0.1, default: 4.0, unit: '' });
  assert.deepEqual(byId.ouSigma, { id: 'ouSigma', group: 'B', field: 'ouSigma', min: 0.02, max: 0.15, step: 0.005, default: 0.10, unit: '' });
  assert.deepEqual(byId.extSineAmp, { id: 'extSineAmp', group: 'B', field: 'extSineAmp', min: 0, max: 0.4, step: 0.01, default: 0, unit: '' });
  assert.deepEqual(byId.extSineFreqHz, { id: 'extSineFreqHz', group: 'B', field: 'extSineFreqHz', min: 1, max: 30, step: 0.5, default: 10, unit: 'Hz' });
  assert.deepEqual(byId.rtMinMs, { id: 'rtMinMs', group: 'C', field: 'rtMinMs', min: 50, max: 1000, step: 10, default: 320, unit: 'ms' });
  assert.deepEqual(byId.rtMaxMs, { id: 'rtMaxMs', group: 'C', field: 'rtMaxMs', min: 50, max: 2000, step: 10, default: 440, unit: 'ms' });
  assert.deepEqual(byId.subjectSeed, { id: 'subjectSeed', group: 'C', field: 'subjectSeed', min: 1, max: 9999, step: 1, default: 1, unit: '' });
  assert.equal(COMPOSER_SLIDERS.length, 8);
});

test('slider defaults match the bench settings store defaults', () => {
  for (const s of COMPOSER_SLIDERS) {
    assert.equal(
      BENCH_SETTINGS_DEFAULTS[s.field], s.default,
      `${s.field}: store default must equal the composer table default`,
    );
  }
});

test('combination summary: thresholds and wording rules', () => {
  const base = {
    g: 0.35, cEi: 4.0, ouSigma: 0.10, extSineAmp: 0, extSineFreqHz: 10,
    background: 'spontaneous', rtMinMs: 320, rtMaxMs: 440,
  };
  assert.equal(
    summarizeCombination(base, 'zh-CN'),
    '参数接近默认；反应时 320–440 ms。',
  );
  assert.equal(
    summarizeCombination(base, 'en-US'),
    'parameters near default; RT 320–440 ms.',
  );
  // Exactly at the thresholds counts as the trait.
  const allThree = { ...base, g: SUMMARY_THRESHOLDS.highCouplingG, cEi: SUMMARY_THRESHOLDS.weakInhibitionCEi, ouSigma: SUMMARY_THRESHOLDS.largeNoiseOuSigma };
  assert.equal(
    summarizeCombination(allThree, 'zh-CN'),
    '高耦合 + 弱抑制 + 大噪声：网络容易整体翻进高活动态；反应时 320–440 ms。',
  );
  assert.equal(
    summarizeCombination(allThree, 'en-US'),
    'high coupling + weak inhibition + large noise: the network easily flips into whole-network high activity; RT 320–440 ms.',
  );
  // One trait only: the softer verdict.
  assert.equal(
    summarizeCombination({ ...base, g: 0.39 }, 'zh-CN'),
    '高耦合：网络比默认更容易同步；反应时 320–440 ms。',
  );
  // Just below a threshold: no trait.
  assert.equal(
    summarizeCombination({ ...base, g: 0.379, cEi: 3.6, ouSigma: 0.119 }, 'zh-CN'),
    '参数接近默认；反应时 320–440 ms。',
  );
  // Strong rhythmic drive only counts in oscillatory mode with amplitude.
  assert.equal(
    summarizeCombination({ ...base, background: 'oscillatory', extSineAmp: 0.3 }, 'zh-CN'),
    '强节律驱动 0.30 @ 10 Hz：网络比默认更容易同步；反应时 320–440 ms。',
  );
  assert.equal(
    summarizeCombination({ ...base, background: 'spontaneous', extSineAmp: 0.3 }, 'zh-CN'),
    '参数接近默认；反应时 320–440 ms。',
  );
});

test('combination summary never names a disease or gives a judgement', () => {
  const states = [
    { g: 0.4, cEi: 3, ouSigma: 0.15, extSineAmp: 0.4, extSineFreqHz: 30, background: 'oscillatory', rtMinMs: 50, rtMaxMs: 2000 },
    { g: 0, cEi: 8, ouSigma: 0.02, extSineAmp: 0, extSineFreqHz: 1, background: 'quiet', rtMinMs: 1000, rtMaxMs: 2000 },
  ];
  for (const s of states) {
    for (const locale of ['zh-CN', 'en-US']) {
      const text = summarizeCombination(s, locale);
      assert.doesNotMatch(text, /癫痫|epilep/i, `summary must not name a disease: ${text}`);
      assert.doesNotMatch(text, /诊断|diagnos/i, `summary must not give a diagnosis: ${text}`);
      assert.doesNotMatch(text, /患者|patient/i, `summary must not call the subject a patient: ${text}`);
    }
  }
});

test('subject summary line for the q chip', () => {
  const s = {
    g: 0.35, cEi: 4.0, ouSigma: 0.10, extSineAmp: 0, extSineFreqHz: 10,
    background: 'spontaneous', rtMinMs: 320, rtMaxMs: 440,
  };
  assert.equal(
    subjectSummaryLine(s, 'zh-CN'),
    '被试：耦合 0.35 · 抑制 4.0 · 自发 · 噪声 0.10 · RT 320–440 ms（模型参数组合）',
  );
  assert.equal(
    subjectSummaryLine(s, 'en-US'),
    'Subject: coupling 0.35 · inhibition 4.0 · spontaneous · noise 0.10 · RT 320–440 ms (model parameter combination)',
  );
});

test('epilepsy directions: four parameter directions, no fake knob', () => {
  assert.equal(EPILEPSY_DIRECTIONS.length, 4);
  assert.deepEqual(EPILEPSY_DIRECTIONS.map((d) => d.id),
    ['coupling', 'inhibition', 'baseline', 'rhythm']);
  // The directions describe parameters; only the explanatory framing may
  // name the phenomenon, never as a subject label or diagnosis.
  for (const d of EPILEPSY_DIRECTIONS) {
    assert.ok(d.bodyZh.length > 10 && d.bodyEn.length > 10);
    assert.doesNotMatch(d.titleZh, /癫痫/, 'direction titles must not name a disease');
  }
});
