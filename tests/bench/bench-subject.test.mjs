/**
 * Phase 1 闭环实验台 — 模拟受试者测试（implementation-plan.md §1.3）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-subject.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulatedSubject } from '../../app/src/lib/benchSubject.ts';

test('同一种子两次序列相同、RT 全在默认界内、只按 Space', () => {
  const a = createSimulatedSubject({ seed: 7 });
  const b = createSimulatedSubject({ seed: 7 });
  const seqA = Array.from({ length: 10 }, (_, k) => a.nextOddballResponse(k + 1, k * 1000));
  const seqB = Array.from({ length: 10 }, (_, k) => b.nextOddballResponse(k + 1, k * 1000));
  assert.deepEqual(seqA, seqB);
  for (const r of seqA) {
    assert.ok(r.rtMs >= 320 && r.rtMs <= 440, `RT ${r.rtMs} out of [320, 440]`);
    assert.equal(r.key, 'Space');
    assert.equal(r.responseTms, r.stimulusTms + r.rtMs);
  }
});

test('换种子序列不同', () => {
  const a = createSimulatedSubject({ seed: 1 });
  const b = createSimulatedSubject({ seed: 2 });
  const seqA = Array.from({ length: 5 }, (_, k) => a.nextOddballResponse(k + 1, k * 1000).rtMs);
  const seqB = Array.from({ length: 5 }, (_, k) => b.nextOddballResponse(k + 1, k * 1000).rtMs);
  assert.notDeepEqual(seqA, seqB);
});

test('reset() 后序列重来', () => {
  const s = createSimulatedSubject({ seed: 42 });
  const first = Array.from({ length: 5 }, (_, k) => s.nextOddballResponse(k + 1, k * 1000).rtMs);
  s.reset();
  const second = Array.from({ length: 5 }, (_, k) => s.nextOddballResponse(k + 1, k * 1000).rtMs);
  assert.deepEqual(first, second);
});

test('自定义 RT 范围生效、非法范围抛错', () => {
  const s = createSimulatedSubject({ seed: 3, rtMinMs: 200, rtMaxMs: 250 });
  for (let k = 0; k < 20; k++) {
    const rt = s.nextOddballResponse(k + 1, k * 1000).rtMs;
    assert.ok(rt >= 200 && rt <= 250, `RT ${rt} out of [200, 250]`);
  }
  assert.throws(() => createSimulatedSubject({ seed: 1, rtMinMs: 500, rtMaxMs: 400 }), RangeError);
});
