/**
 * Bench brain-q 高状态判断测试（2026-11-19 stuck-q 调查）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-high-state.test.mjs
 *
 * 阈值是 Worker 自己的锁定口径（LOCK_MEAN_E = 0.15、500 ms 窗口、闩住
 * 直到 RESET/恢复快照），不是测试现编的；下面的数值取自 2026-11-19
 * 本地预览实测：安静基线 meanE 0.015、E[0] 0.010–0.020；oddball 翻进
 * 高态后 meanE 0.461、E[0] 0.4996、q 2.899 连停 30 秒以上。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBenchQHighState, BENCH_HIGH_STATE_MEAN_E, BENCH_HIGH_STATE_NODE_E,
} from '../../app/src/lib/benchHighState.ts';

/** 76 节点 E 数组：默认全是安静值 0.015，可点名改几个节点。 */
function fakeE(overrides = {}) {
  const e = new Float64Array(76).fill(0.015);
  for (const [k, v] of Object.entries(overrides)) e[Number(k)] = v;
  return e;
}

test('thresholds are the engine lock thresholds (0.15), not invented', () => {
  assert.equal(BENCH_HIGH_STATE_MEAN_E, 0.15);
  assert.equal(BENCH_HIGH_STATE_NODE_E, 0.15);
});

test('measured high state (locked, meanE 0.461, E[0] 0.4996) is high', () => {
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.461, e: fakeE({ 0: 0.4996 }) }, 0),
    true,
  );
});

test('measured quiet baseline (unlocked, meanE 0.015, E[0] 0.010-0.020) is not high', () => {
  for (const e0 of [0.01, 0.014, 0.02]) {
    assert.equal(
      isBenchQHighState({ locked: false, mean_e: 0.015, e: fakeE({ 0: e0 }) }, 0),
      false,
    );
  }
});

test('latched but mean_e back below threshold is not high (mirrors NetworkStatePanel)', () => {
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.015, e: fakeE({ 0: 0.4996 }) }, 0),
    false,
  );
});

test('network locked but the q node itself stayed low is not high', () => {
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.461, e: fakeE({ 0: 0.02 }) }, 0),
    false,
  );
});

test('boundary is strict: exactly 0.15 is not high', () => {
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.15, e: fakeE({ 0: 0.4996 }) }, 0),
    false,
  );
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.461, e: fakeE({ 0: 0.15 }) }, 0),
    false,
  );
});

test('null snapshot or out-of-range node never shows the note', () => {
  assert.equal(isBenchQHighState(null, 0), false);
  assert.equal(isBenchQHighState(undefined, 0), false);
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.461, e: fakeE({ 0: 0.4996 }) }, 76),
    false,
  );
  assert.equal(
    isBenchQHighState({ locked: true, mean_e: 0.461, e: fakeE({ 0: 0.4996 }) }, -1),
    false,
  );
});
