/**
 * Phase 1 闭环实验台 — 带通滤波 node 行为测试（implementation-plan.md §1.2）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-filter.test.mjs
 * Python 行为对照见 tests/bench/test_bench_filter.py（同一组断言）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bandpassFilter, validateBandpassParams } from '../../app/src/lib/signalProcessing.ts';

const SFREQ = 250;
const sine = (freqHz, seconds = 2, amplitude = 1) =>
  Array.from({ length: Math.round(seconds * SFREQ) }, (_, j) =>
    amplitude * Math.sin((2 * Math.PI * freqHz * j) / SFREQ));
const rms = (x) => Math.sqrt(x.reduce((a, b) => a + b * b, 0) / x.length);
/** 去掉首尾边缘瞬态（默认 129 taps → 各 64 采样）后再算 RMS。 */
const central = (x, edge = 100) => x.slice(edge, x.length - edge);

test('10 Hz 正弦通过：通带增益 0.9–1.1', () => {
  const params = { lowHz: 0.5, highHz: 40, sfreqHz: SFREQ };
  const out = bandpassFilter(sine(10), params);
  assert.equal(out.length, sine(10).length);
  const gain = rms(central(out)) / rms(central(sine(10)));
  assert.ok(gain >= 0.9 && gain <= 1.1, `10 Hz gain ${gain}`);
});

test('100 Hz 在 sfreq 250 / low 0.5 / high 40 下衰减 > 40 dB', () => {
  const params = { lowHz: 0.5, highHz: 40, sfreqHz: SFREQ };
  const out = bandpassFilter(sine(100), params);
  const ratio = rms(central(out)) / rms(central(sine(100)));
  const db = 20 * Math.log10(ratio);
  assert.ok(db < -40, `100 Hz attenuation ${db} dB (ratio ${ratio})`);
});

test('直流被去掉', () => {
  const params = { lowHz: 0.5, highHz: 40, sfreqHz: SFREQ };
  const dc = new Array(500).fill(1.0);
  const out = bandpassFilter(dc, params);
  assert.ok(rms(central(out)) < 0.01, `DC residual RMS ${rms(central(out))}`);
});

test('同输入两次结果相同', () => {
  const params = { lowHz: 0.5, highHz: 40, sfreqHz: SFREQ };
  const input = sine(10).map((v, j) => v + 0.3 * Math.sin((2 * Math.PI * 3 * j) / SFREQ));
  assert.deepEqual(bandpassFilter(input, params), bandpassFilter(input, params));
});

test('非法参数抛错', () => {
  assert.throws(() => validateBandpassParams({ lowHz: 0, highHz: 40, sfreqHz: 250 }), RangeError);
  assert.throws(() => validateBandpassParams({ lowHz: 40, highHz: 40, sfreqHz: 250 }), RangeError);
  assert.throws(() => validateBandpassParams({ lowHz: 50, highHz: 40, sfreqHz: 250 }), RangeError);
  assert.throws(() => validateBandpassParams({ lowHz: 0.5, highHz: 125, sfreqHz: 250 }), RangeError);
  assert.throws(() => validateBandpassParams({ lowHz: 0.5, highHz: 40, sfreqHz: 250, taps: 128 }), RangeError);
  assert.throws(() => validateBandpassParams({ lowHz: 0.5, highHz: 40, sfreqHz: 250, taps: 14 }), RangeError);
  assert.throws(() => bandpassFilter([1, Number.NaN, 3], { lowHz: 0.5, highHz: 40, sfreqHz: 250 }), RangeError);
});
