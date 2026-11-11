import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODEL_ID, demoSphereSensors, potentialMicrovolts, sensorPotentialsMicrovolts,
} from '../../app/src/lib/volumeConduction.ts';

const approx = (actual, expected, rel = 1e-11) => {
  assert.ok(Math.abs(actual - expected) <= rel * Math.max(1, Math.abs(expected)),
    'expected ' + actual + ' ≈ ' + expected);
};
const d = { positionMm: [0, 0, 0], momentNAm: [10, 0, 0] };
test('model identity distinguishes ideal infinite conductor from realistic BEM', () => {
  assert.equal(MODEL_ID, 'homogeneous-unbounded-dipole-v1');
});
test('SI-unit analytic potential is correct in microvolts', () => {
  const expected = 1e6 * (10e-9 * 0.1) / (4 * Math.PI * 0.33 * 0.1 ** 3);
  approx(potentialMicrovolts(d, [100, 0, 0]), expected);
  assert.ok(expected > 0.2 && expected < 0.3);
});
test('sign reversal across a current dipole', () => {
  approx(potentialMicrovolts(d, [100, 0, 0]), -potentialMicrovolts(d, [-100, 0, 0]));
});
test('sensor perpendicular to moment has zero potential', () => {
  approx(potentialMicrovolts(d, [0, 100, 0]), 0);
});
test('doubling distance reduces magnitude by factor four', () => {
  approx(potentialMicrovolts(d, [200, 0, 0]) * 4, potentialMicrovolts(d, [100, 0, 0]));
});
test('doubling source moment doubles voltage', () => {
  approx(potentialMicrovolts({ ...d, momentNAm: [20, 0, 0] }, [100, 0, 0]),
    potentialMicrovolts(d, [100, 0, 0]) * 2);
});
test('translation invariance of source and electrode in the same RAS frame', () => {
  approx(potentialMicrovolts({ positionMm: [20, 8, -5], momentNAm: [10, 0, 0] }, [120, 8, -5]),
    potentialMicrovolts(d, [100, 0, 0]));
});
test('linear superposition and explicit infinity reference', () => {
  const sensors = [{ label: 'A', positionMm: [100, 0, 0] }];
  const actual = sensorPotentialsMicrovolts([d, { ...d, momentNAm: [-3, 0, 0] }],
    sensors, { mode: 'infinity' })[0];
  approx(actual, potentialMicrovolts({ ...d, momentNAm: [7, 0, 0] }, [100, 0, 0]));
});
test('average reference is zero mean; same input has defined electrode reference', () => {
  const sensors = demoSphereSensors();
  const avg = sensorPotentialsMicrovolts([d], sensors);
  approx(avg.reduce((a, b) => a + b, 0), 0);
  const linked = sensorPotentialsMicrovolts([d], sensors, { mode: 'electrode', label: 'S01' });
  approx(linked[0], 0);
  assert.ok(linked.some((v) => v !== 0));
});
test('conductivity inversely scales potentials', () => {
  approx(potentialMicrovolts(d, [100, 0, 0], 0.66),
    potentialMicrovolts(d, [100, 0, 0], 0.33) / 2);
});
test('point-source singularity and invalid inputs reject rather than clamp silently', () => {
  assert.throws(() => potentialMicrovolts(d, [0, 0, 0]), /singular/);
  assert.throws(() => potentialMicrovolts(d, [0.9, 0, 0]), /singular/);
  assert.throws(() => potentialMicrovolts(d, [100, 0, 0], 0), /Conductivity/);
  assert.throws(() => potentialMicrovolts(d, [NaN, 0, 0]), /finite/);
  assert.throws(() => demoSphereSensors(0), /radius/);
  assert.throws(() => sensorPotentialsMicrovolts([d], [
    { label: 'X', positionMm: [100, 0, 0] },
    { label: 'X', positionMm: [110, 0, 0] },
  ]), /unique/);
  assert.throws(() => sensorPotentialsMicrovolts([d], demoSphereSensors(),
    { mode: 'electrode', label: 'MISSING' }), /Unknown/);
});
test('illustrative sensors lie on sphere and have non-standard labels', () => {
  const sensors = demoSphereSensors(90);
  assert.equal(sensors.length, 12);
  for (const s of sensors) {
    approx(Math.hypot(...s.positionMm), 90);
    assert.match(s.label, /^S\d\d$/);
  }
});
