/**
 * Phase 2 闭环实验台 — 帽电极方向映射测试（Phase 2 item 1）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-electrodes.test.mjs
 * 用合成小 fixture / 合成 BEM 模型，不依赖 app/public/forward-assets/
 *（它们是 gitignored 的本地生成物）。
 *
 * 覆盖：
 * - 预设标签 → 电极方向：19/32/64/128/256 五档数量精确、方向为单位向量、
 *   与 fixture 位置归一化一致、标签与预设一致；
 * - BEM 与球形的电极来源选择：球形走预设标签、BEM 走模板自带电极且忽略
 *   预设、来源未加载时返回 null（不给过期标记）；
 * - 错误：未知标签、零位置抛 RangeError。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBenchCapChannels } from '../../app/src/lib/benchCap.ts';
import {
  bemElectrodeDirections, selectBenchElectrodes, sphereElectrodeDirections,
} from '../../app/src/lib/benchElectrodes.ts';

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

function makeFixture() {
  const labels1020 = ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'];
  const labels1010 = ['Cz', ...Array.from({ length: 93 }, (_, j) => `A${j + 1}`)];
  const labels1005 = ['Cz', ...Array.from({ length: 342 }, (_, j) => `B${j + 1}`)];
  const allLabels = [...new Set([...labels1020, ...labels1010, ...labels1005])];
  const positions = {};
  fibonacciSphere(allLabels.length).forEach((p, j) => { positions[allLabels[j]] = p; });
  positions.Cz = [0, 0, 95];
  const sensors = allLabels.map((label) => ({
    label,
    position_mm: positions[label],
    original_head_mm: positions[label],
  }));
  return {
    fixture: {
      model_id: 'test-sphere-v1',
      coordinate_frame: 'head-RAS-sphere-centered',
      mne_version: 'test',
      radius_mm: 95,
      brain_inner_radius_mm: 80,
      source_grid_axis_mm: [0],
      conductivities_S_m: [0.3],
      montages: { '10-20': labels1020, '10-10': labels1010, '10-05': labels1005 },
      sensors,
      gain_uv_per_nAm: [],
    },
    positions,
  };
}

/** 合成模板 BEM：电极在原点为球心的半径 90 mm 球面上（只用电极字段）。 */
function makeBemModel(count = 32) {
  const pts = fibonacciSphere(count, 90);
  return {
    electrodes: pts.map((p, j) => ({ label: `E${j + 1}`, head_mm: p })),
  };
}

const approxUnit = (d) => Math.abs(Math.hypot(...d) - 1) < 1e-12;

test('五档预设：标签 → 方向，数量精确、方向为单位向量、与位置归一化一致', () => {
  const { fixture, positions } = makeFixture();
  for (const [preset, count] of [
    ['10-20-19', 19], ['10-10-32', 32], ['10-10-64', 64],
    ['10-5-128', 128], ['10-5-256', 256],
  ]) {
    const sel = selectBenchCapChannels(fixture, preset);
    assert.equal(sel.channelCount, count);
    const dirs = sphereElectrodeDirections(fixture, sel.labels);
    assert.equal(dirs.length, count);
    assert.deepEqual(dirs.map((d) => d.label), sel.labels);
    for (const d of dirs) {
      assert.ok(approxUnit(d.direction), `${preset} ${d.label} direction not unit: ${d.direction}`);
      const p = positions[d.label];
      const expected = p.map((v) => v / 95);
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(d.direction[k] - expected[k]) < 1e-12,
          `${preset} ${d.label} axis ${k}: ${d.direction[k]} vs ${expected[k]}`);
      }
    }
    assert.equal(new Set(dirs.map((d) => d.label)).size, count);
  }
});

test('方向只取决于标签位置：同一标签在不同预设里方向相同', () => {
  const { fixture } = makeFixture();
  const d32 = sphereElectrodeDirections(
    fixture, selectBenchCapChannels(fixture, '10-10-32').labels);
  const d64 = sphereElectrodeDirections(
    fixture, selectBenchCapChannels(fixture, '10-10-64').labels);
  const byLabel64 = new Map(d64.map((d) => [d.label, d.direction]));
  for (const d of d32) {
    assert.deepEqual(d.direction, byLabel64.get(d.label));
  }
  assert.ok(d32.every((d) => d.label === 'Cz' || byLabel64.has(d.label)));
});

test('来源选择：球形走预设标签，BEM 走模板自带电极且忽略预设', () => {
  const { fixture } = makeFixture();
  const capSelection = selectBenchCapChannels(fixture, '10-10-64');
  const bemModel = makeBemModel(32);
  const sphere = selectBenchElectrodes({
    headModel: 'sphere', fixture, capSelection, bemModel,
  });
  assert.equal(sphere.source, 'sphere');
  assert.equal(sphere.electrodes.length, 64);
  assert.deepEqual(sphere.electrodes.map((e) => e.label), capSelection.labels);
  const bem = selectBenchElectrodes({
    headModel: 'bem', fixture, capSelection, bemModel,
  });
  assert.equal(bem.source, 'bem');
  assert.equal(bem.electrodes.length, 32);
  assert.deepEqual(bem.electrodes.map((e) => e.label), bemModel.electrodes.map((e) => e.label));
  for (const e of bem.electrodes) assert.ok(approxUnit(e.direction));
});

test('来源未加载时返回 null：球形无 fixture / 无 cap 选择、BEM 无模板模型', () => {
  const { fixture } = makeFixture();
  const capSelection = selectBenchCapChannels(fixture, '10-10-64');
  const bemModel = makeBemModel(32);
  assert.equal(selectBenchElectrodes({
    headModel: 'sphere', fixture: null, capSelection, bemModel,
  }), null);
  assert.equal(selectBenchElectrodes({
    headModel: 'sphere', fixture, capSelection: null, bemModel,
  }), null);
  assert.equal(selectBenchElectrodes({
    headModel: 'bem', fixture, capSelection, bemModel: null,
  }), null);
});

test('BEM 方向：head_mm 归一化，标签与模型一致', () => {
  const bemModel = makeBemModel(8);
  const dirs = bemElectrodeDirections(bemModel);
  assert.equal(dirs.length, 8);
  dirs.forEach((d, j) => {
    assert.equal(d.label, `E${j + 1}`);
    assert.ok(approxUnit(d.direction));
    const expected = bemModel.electrodes[j].head_mm.map((v) => v / 90);
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(d.direction[k] - expected[k]) < 1e-12);
    }
  });
});

test('错误：未知标签、零位置抛 RangeError，不静默给错方向', () => {
  const { fixture } = makeFixture();
  assert.throws(() => sphereElectrodeDirections(fixture, ['NoSuchLabel']), (e) => {
    assert.ok(e instanceof RangeError);
    assert.match(e.message, /NoSuchLabel/);
    return true;
  });
  assert.throws(() => bemElectrodeDirections({
    electrodes: [{ label: 'E0', head_mm: [0, 0, 0] }],
  }), (e) => {
    assert.ok(e instanceof RangeError);
    return true;
  });
});
