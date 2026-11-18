/**
 * Phase 1 闭环实验台 — 协议引擎测试（implementation-plan.md §1.4）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-protocol.test.mjs
 * 假时钟 + 假 pulseAt/subject：不碰 Worker，不用墙钟。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchProtocolEngine } from '../../app/src/lib/benchProtocol.ts';

/** 脑区表：rA1=0、lA1=38、rV1=35、lV1=73（与 regions.json 的 id 一致）。 */
function fakeRegions() {
  const regions = Array.from({ length: 76 }, (_, j) => ({ label: `n${j}` }));
  regions[0] = { label: 'rA1' };
  regions[38] = { label: 'lA1' };
  regions[35] = { label: 'rV1' };
  regions[73] = { label: 'lV1' };
  return regions;
}

/** 固定 RT 380 ms 的假受试者（响应锚定测试需要已知 RT）。 */
function fakeSubject(rtMs = 380) {
  return {
    nextOddballResponse: (trialIndex, stimulusTms) => ({
      trialIndex, stimulusTms, responseTms: stimulusTms + rtMs, rtMs, key: 'Space',
    }),
    reset: () => {},
  };
}

function harness(subject = fakeSubject()) {
  const pulses = [];
  const events = [];
  const feedbackConfigs = [];
  const engine = createBenchProtocolEngine({
    pulseAt: (node, amplitude, durationMs) => pulses.push({ node, amplitude, durationMs }),
    configureFeedback: (config) => feedbackConfigs.push(config),
    subject,
    onEvent: (e) => events.push({ ...e }),
    regions: fakeRegions(),
  });
  return { engine, pulses, events, feedbackConfigs };
}

test('oddball 试次顺序：第 5/10/15 个为 oddball，其余 standard；幅度 2.0/1.0', () => {
  const { engine, pulses, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, durationMs: 20000 }, 0);
  assert.equal(engine.running, true);
  for (let t = 0; t <= 15000; t += 1000) engine.tick(t);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  assert.equal(stimuli.length, 16);
  assert.equal(engine.trialIndex, 16);
  for (let k = 1; k <= 16; k++) {
    const s = stimuli[k - 1];
    assert.equal(s.trialIndex, k);
    assert.equal(s.tMs, (k - 1) * 1000);
    if (k % 5 === 0) {
      assert.equal(s.condition, 'oddball');
      assert.equal(s.amplitude, 2.0);
    } else {
      assert.equal(s.condition, 'standard');
      assert.equal(s.amplitude, 1.0);
    }
  }
  // 默认听觉节点：sensoryTargetNodes(regions, 'auditory') 的第一个 = rA1 = 0。
  assert.ok(pulses.every((p) => p.node === 0));
  assert.equal(pulses.length, 16);
});

test('flicker 脉冲周期正确：10 Hz → 每 100 ms 给 lV1/rV1 各发一次', () => {
  const { engine, events } = harness();
  engine.start('flicker', { frequencyHz: 10, durationMs: 1000 }, 5000);
  engine.tick(5000);
  engine.tick(5100);
  engine.tick(5250);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  // 周期 0/100/200 ms（t=5250 时只到 200 ms 的周期），每周期 2 个节点。
  assert.deepEqual(stimuli.map((s) => s.tMs), [5000, 5000, 5100, 5100, 5200, 5200]);
  assert.deepEqual(stimuli.map((s) => s.node).sort(), [35, 35, 35, 73, 73, 73]);
  assert.ok(stimuli.every((s) => s.amplitude === 1.0));
});

test('single-pulse 只发一次，随后 running=false 并发 completed', () => {
  const { engine, pulses, events } = harness();
  engine.start('single-pulse', { node: 12, amplitude: 1.5, durationMs: 100 }, 1000);
  assert.equal(pulses.length, 1);
  assert.deepEqual(pulses[0], { node: 12, amplitude: 1.5, durationMs: 100 });
  assert.equal(engine.running, false);
  assert.equal(engine.trialIndex, 1);
  engine.tick(2000);
  assert.equal(pulses.length, 1);
  const stopped = events.find((e) => e.kind === 'protocol-stopped');
  assert.equal(stopped.reason, 'completed');
  assert.equal(stopped.tMs, 1000);
});

test('stop() 后不再发刺激', () => {
  const { engine, pulses, events } = harness();
  engine.start('oddball', { isiMs: 1000, durationMs: 60000 }, 0);
  engine.tick(0);
  engine.tick(1000);
  assert.equal(pulses.length, 2);
  engine.stop();
  assert.equal(engine.running, false);
  engine.tick(5000);
  engine.tick(60000);
  assert.equal(pulses.length, 2);
  assert.equal(events.find((e) => e.kind === 'protocol-stopped').reason, 'stopped');
});

test('响应锚定：marker 修正后 response = marker 时间 + RT，confirmed=true', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, durationMs: 20000 }, 0);
  for (let t = 0; t <= 4000; t += 1000) engine.tick(t);
  // 第 5 个试次（oddball）在 t=4000 发出，provisional=4000；ACK 修正为 4012。
  engine.confirmFromMarkers([{ t_ms: 4012, node: 0, kind: 'pulse', amplitude: 2 }]);
  const responses = events.filter((e) => e.kind === 'response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].tMs, 4012 + 380);
  assert.equal(responses[0].rtMs, 380);
  assert.equal(responses[0].trialIndex, 5);
  assert.equal(responses[0].confirmed, true);
});

test('响应锚定：500 ms 未修正 → provisional + RT，confirmed=false', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, durationMs: 20000 }, 0);
  for (let t = 0; t <= 4000; t += 1000) engine.tick(t);
  // marker 在但时间仍是 provisional（未被 ACK 修正）。
  engine.confirmFromMarkers([{ t_ms: 4000, node: 0, kind: 'pulse', amplitude: 2 }]);
  assert.equal(events.filter((e) => e.kind === 'response').length, 0);
  engine.tick(4499);
  assert.equal(events.filter((e) => e.kind === 'response').length, 0);
  engine.tick(4500);
  const responses = events.filter((e) => e.kind === 'response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].tMs, 4000 + 380);
  assert.equal(responses[0].confirmed, false);
});

test('响应锚定：超过 500 ms 仍无 marker → 丢弃并计数 droppedResponses', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, durationMs: 20000 }, 0);
  for (let t = 0; t <= 4000; t += 1000) engine.tick(t);
  engine.tick(4600);
  assert.equal(events.filter((e) => e.kind === 'response').length, 0);
  assert.equal(engine.droppedResponses, 1);
});

test('closed-loop：start 直通 configureFeedback，tick 不做事，stop 传 null', () => {
  const { engine, pulses, feedbackConfigs, events } = harness();
  const config = {
    node: 0, feature: 'instant', threshold: 0.5, amplitude: 1, durationMs: 100,
    periodMs: 100, windowMs: 1000, cooldownMs: 0, delayMs: 0, maxTriggers: 10,
  };
  engine.start('closed-loop', config, 0);
  assert.deepEqual(feedbackConfigs, [config]);
  assert.equal(engine.running, true);
  engine.tick(1000);
  assert.equal(pulses.length, 0);
  // 反馈事件经公开方法转入。
  engine.emitFeedbackEvent({ kind: 'feedback-detected', tMs: 1200, node: 0 });
  assert.equal(events.filter((e) => e.kind === 'feedback-detected').length, 1);
  engine.stop();
  assert.deepEqual(feedbackConfigs, [config, null]);
  // 停后 emitFeedbackEvent 不再转入。
  engine.emitFeedbackEvent({ kind: 'feedback-detected', tMs: 1300, node: 0 });
  assert.equal(events.filter((e) => e.kind === 'feedback-detected').length, 1);
});

test('非法参数抛错：flicker 频率出界、oddball ISI 非正', () => {
  const { engine } = harness();
  assert.throws(() => engine.start('flicker', { frequencyHz: 40 }, 0), RangeError);
  assert.throws(() => engine.start('oddball', { isiMs: 0 }, 0), RangeError);
  assert.throws(() => engine.start('single-pulse', { node: 76 }, 0), RangeError);
});
