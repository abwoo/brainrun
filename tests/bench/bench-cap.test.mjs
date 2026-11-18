/**
 * Phase 1 闭环实验台 — 脑电帽预设测试（implementation-plan.md §1.1）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-cap.test.mjs
 * 用合成小 fixture，不依赖 app/public/forward-assets/sphere-model.json
 *（它是 gitignored 的本地生成物）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BENCH_CAP_PRESETS, selectBenchCapChannels } from '../../app/src/lib/benchCap.ts';

/** 半径 95 mm 球面上的 Fibonacci 采样点（确定性）。 */
function fibonacciSphere(n, radius = 95) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let j = 0; j < n; j++) {
    const y = 1 - (2 * j) / (n - 1);
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * j;
    pts.push([radius * Math.cos(theta) * r, radius * y, radius * Math.sin(theta) * r]);
  }
  return pts;
}

function makeFixture(montages, positionsByLabel) {
  const sensors = Object.entries(positionsByLabel).map(([label, position_mm]) => ({
    label,
    position_mm,
    original_head_mm: position_mm,
  }));
  return {
    model_id: 'test-sphere-v1',
    coordinate_frame: 'head-RAS-sphere-centered',
    mne_version: 'test',
    radius_mm: 95,
    brain_inner_radius_mm: 80,
    source_grid_axis_mm: [0],
    conductivities_S_m: [0.3],
    montages,
    sensors,
    gain_uv_per_nAm: [],
  };
}

test('10-20-19:数量精确、含 Cz、标签在 fixture 内、两次结果相同', () => {
  const labels1020 = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
  const positions = {};
  fibonacciSphere(labels1020.length).forEach((p, j) => { positions[labels1020[j]] = p; });
  positions.Cz = [0, 0, 95];
  const fixture = makeFixture({ '10-20': labels1020 }, positions);
  const a = selectBenchCapChannels(fixture, '10-20-19');
  const b = selectBenchCapChannels(fixture, '10-20-19');
  assert.equal(a.channelCount, 19);
  assert.equal(a.labels.length, 19);
  assert.ok(a.labels.includes('Cz'));
  assert.deepEqual(a, b);
  for (const label of a.labels) assert.ok(labels1020.includes(label), `label ${label} not in fixture`);
  assert.equal(new Set(a.labels).size, 19);
});

test('10-10-32/64:从 94 个标签里最远点采样，数量精确且含 Cz', () => {
  const labels1010 = ['Cz', ...Array.from({ length: 93 }, (_, j) => `X${j + 1}`)];
  const positions = {};
  fibonacciSphere(labels1010.length).forEach((p, j) => { positions[labels1010[j]] = p; });
  positions.Cz = [0, 0, 95];
  const fixture = makeFixture({ '10-10': labels1010 }, positions);
  for (const preset of ['10-10-32', '10-10-64']) {
    const sel = selectBenchCapChannels(fixture, preset);
    assert.equal(sel.labels.length, sel.channelCount);
    assert.ok(sel.labels.includes('Cz'));
    assert.equal(new Set(sel.labels).size, sel.labels.length);
    // 返回的 labels 按 fixture 导联顺序排，不是采样顺序。
    const idx = sel.labels.map((l) => labels1010.indexOf(l));
    assert.deepEqual(idx, [...idx].sort((x, y) => x - y));
  }
  assert.equal(selectBenchCapChannels(fixture, '10-10-32').labels.length, 32);
  assert.equal(selectBenchCapChannels(fixture, '10-10-64').labels.length, 64);
});

test('最远点采样：比“前 N 个” spread 得更开（不偏额部）', () => {
  const labels1010 = ['Cz', ...Array.from({ length: 93 }, (_, j) => `X${j + 1}`)];
  const positions = {};
  fibonacciSphere(labels1010.length).forEach((p, j) => { positions[labels1010[j]] = p; });
  positions.Cz = [0, 0, 95];
  const fixture = makeFixture({ '10-10': labels1010 }, positions);
  const sel = selectBenchCapChannels(fixture, '10-10-32');
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const minPair = (labels) => {
    let m = Infinity;
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        m = Math.min(m, dist(positions[labels[i]], positions[labels[j]]));
      }
    }
    return m;
  };
  // 最远点采样的最小成对间距应大于“前 32 个”的最小成对间距。
  assert.ok(minPair(sel.labels) > minPair(labels1010.slice(0, 32)));
});

test('count 超过可用标签时抛 RangeError，不静默截断', () => {
  const labels1010 = ['Cz', ...Array.from({ length: 9 }, (_, j) => `Y${j + 1}`)];
  const positions = {};
  fibonacciSphere(labels1010.length).forEach((p, j) => { positions[labels1010[j]] = p; });
  positions.Cz = [0, 0, 95];
  const fixture = makeFixture({ '10-10': labels1010 }, positions);
  assert.throws(() => selectBenchCapChannels(fixture, '10-10-32'), (e) => {
    assert.ok(e instanceof RangeError);
    assert.match(e.message, /10-10/);
    assert.match(e.message, /32/);
    assert.match(e.message, /10/);
    return true;
  });
});

test('预设表：5 个预设、导联与通道数与计划一致', () => {
  assert.deepEqual(
    BENCH_CAP_PRESETS.map((p) => [p.preset, p.montage, p.channelCount]),
    [
      ['10-20-19', '10-20', 19],
      ['10-10-32', '10-10', 32],
      ['10-10-64', '10-10', 64],
      ['10-5-128', '10-05', 128],
      ['10-5-256', '10-05', 256],
    ],
  );
});
