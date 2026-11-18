/**
 * Phase 1 闭环实验台 — 回路追踪日志测试（implementation-plan.md §1.5）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-trace.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchTrace } from '../../app/src/lib/benchTrace.ts';

const ev = (tMs, hop = 'amplifier', confirmed = false) => ({
  tMs, hop, kind: 'sample', label: 'amp-out', value: '1.0 uV', confirmed,
});

test('顺序：append 顺序即列表顺序，seq 从 1 单调递增', () => {
  const trace = createBenchTrace();
  const a = trace.append(ev(0, 'amplifier'));
  const b = trace.append(ev(1, 'test-computer', true));
  const c = trace.append(ev(2, 'brain'));
  assert.deepEqual([a.seq, b.seq, c.seq], [1, 2, 3]);
  assert.deepEqual(trace.list().map((e) => e.seq), [1, 2, 3]);
  assert.deepEqual(trace.list().map((e) => e.hop), ['amplifier', 'test-computer', 'brain']);
  assert.equal(trace.list()[1].confirmed, true);
});

test('cap 丢弃：超 cap 丢最旧的，seq 不重用', () => {
  const trace = createBenchTrace(3);
  for (let j = 0; j < 5; j++) trace.append(ev(j));
  const list = trace.list();
  assert.equal(list.length, 3);
  assert.deepEqual(list.map((e) => e.seq), [3, 4, 5]);
  assert.deepEqual(list.map((e) => e.tMs), [2, 3, 4]);
  assert.throws(() => createBenchTrace(0), RangeError);
});

test('clear()：清空列表，seq 继续递增', () => {
  const trace = createBenchTrace();
  trace.append(ev(0));
  trace.append(ev(1));
  trace.clear();
  assert.deepEqual(trace.list(), []);
  const next = trace.append(ev(2));
  assert.equal(next.seq, 3);
});

test('默认 cap 为 200', () => {
  const trace = createBenchTrace();
  for (let j = 0; j < 250; j++) trace.append(ev(j));
  assert.equal(trace.list().length, 200);
  assert.equal(trace.list()[0].seq, 51);
});
