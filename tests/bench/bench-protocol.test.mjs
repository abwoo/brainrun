/**
 * Phase 1 闭环实验台 — 协议引擎测试（implementation-plan.md §1.4）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-protocol.test.mjs
 * 假时钟 + 假 pulseAt/subject：不碰 Worker，不用墙钟。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBenchProtocolEngine, LOOP_TIMING_BOUNDS } from '../../app/src/lib/benchProtocol.ts';

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

test('oddball 端到端：trial 5 刺激 → ACK 修正 → 响应，响应−触发 = RT 在 320–440 ms 窗口内', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5 }, 4000);
  for (let t = 4000; t <= 8000; t += 1000) engine.tick(t);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  assert.equal(stimuli.length, 5);
  const oddballStimulus = stimuli[4];
  assert.equal(oddballStimulus.trialIndex, 5);
  assert.equal(oddballStimulus.condition, 'oddball');
  assert.equal(oddballStimulus.tMs, 8000);
  // Worker ACK 把刺激时间修正为 8012 ms。
  engine.confirmFromMarkers([{ t_ms: 8012, node: 0, kind: 'pulse', amplitude: 2 }]);
  const responses = events.filter((e) => e.kind === 'response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].tMs, 8012 + 380);
  assert.equal(responses[0].rtMs, 380);
  assert.equal(responses[0].confirmed, true);
  assert.ok(responses[0].tMs > oddballStimulus.tMs, 'response must come after the trigger');
  const rtFromAck = responses[0].tMs - 8012;
  assert.ok(rtFromAck >= 320 && rtFromAck <= 440, `response - ACK trigger = ${rtFromAck} ms, expected within [320, 440]`);
});

test('oddball：pulseDurationMs 管脉冲时长、durationMs 管整轮运行时长，两者分开', () => {
  const { engine, pulses, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, pulseDurationMs: 200, durationMs: 5000 }, 0);
  for (let t = 0; t <= 6000; t += 1000) engine.tick(t);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  // 5 s 内 0/1000/2000/3000/4000 共 5 个试次，5000 到时 completed。
  assert.equal(stimuli.length, 5);
  assert.equal(engine.running, false);
  assert.equal(events.find((e) => e.kind === 'protocol-stopped').reason, 'completed');
  // 每个脉冲都是 200 ms（pulseDurationMs），不是整轮的 5000 ms。
  assert.ok(pulses.every((p) => p.durationMs === 200));
  assert.ok(stimuli.every((s) => s.durationMs === 200));
  assert.equal(stimuli[4].condition, 'oddball');
});

test('oddball 不传 durationMs：一直跑到 stop()，不自动 completed', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, pulseDurationMs: 100 }, 0);
  for (let t = 0; t <= 10000; t += 1000) engine.tick(t);
  assert.equal(engine.running, true);
  assert.equal(engine.trialIndex, 11);
  assert.equal(events.filter((e) => e.kind === 'protocol-stopped').length, 0);
  engine.stop();
  assert.equal(engine.running, false);
});

test('flicker：pulseDurationMs 管脉冲时长、durationMs 管整轮运行时长；迟到的 tick 只发最新周期', () => {
  const { engine, pulses, events } = harness();
  engine.start('flicker', { frequencyHz: 10, pulseDurationMs: 50, durationMs: 500 }, 0);
  engine.tick(0);
  engine.tick(100);
  engine.tick(200);
  engine.tick(500);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  // 500 ms 的 tick 晚到：300/400 两个周期都到期，只发最新一个（400），300 记为跳过。
  assert.equal(stimuli.length, 8);
  assert.deepEqual(stimuli.map((s) => s.tMs), [0, 0, 100, 100, 200, 200, 400, 400]);
  assert.equal(engine.trialIndex, 4);
  assert.equal(engine.skippedTrials, 1);
  const skipped = events.filter((e) => e.kind === 'trial-skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].skippedCount, 1);
  assert.equal(skipped[0].trialIndex, 4);
  assert.ok(pulses.every((p) => p.durationMs === 50));
  assert.equal(engine.running, false);
});

test('响应锚定：tick 被延迟、一次只发最新一个试次时，按 dispatch 时间匹配，不套住上一个试次的 marker', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5 }, 0);
  for (let t = 0; t <= 3000; t += 1000) engine.tick(t); // trial 1–4，dispatch == 计划时间。
  // 下一次 tick 晚到 8500 ms：4000–8000 共 5 个试次到期，只发最新一个
  // （trial 5，计划 8000、dispatch 8500），其余 4 个记为跳过、永不补发。
  engine.tick(8500);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  assert.equal(stimuli.length, 5);
  assert.equal(stimuli[4].trialIndex, 5);
  assert.equal(stimuli[4].tMs, 8000); // stimulus-sent 仍是计划时间。
  assert.equal(engine.skippedTrials, 4);
  const skipped = events.filter((e) => e.kind === 'trial-skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].skippedCount, 4);
  assert.equal(skipped[0].trialIndex, 5);
  // markers：8120 是一次手动刺激的 marker（与计划时间 8000 接近，按计划时间
  // 匹配会错套住它），8600 才是 trial 5 自己的 marker（dispatch 8500 → ACK 8600）。
  engine.confirmFromMarkers([
    { t_ms: 8120, node: 0, kind: 'pulse', amplitude: 1 },
    { t_ms: 8600, node: 0, kind: 'pulse', amplitude: 2 },
  ]);
  const responses = events.filter((e) => e.kind === 'response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].tMs, 8600 + 380);
  assert.equal(responses[0].confirmed, true);
  // 同一次匹配测 dispatch→ACK：8600 − 8500 = 100 ms，在门限内。
  const timing = engine.getLoopTiming();
  assert.equal(timing.dispatchToAckMs, 100);
  assert.equal(timing.samples.dispatchToAck, 1);
  assert.ok(timing.dispatchToAckMs <= LOOP_TIMING_BOUNDS.dispatchToAckMaxMs);
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
  // Phase 3：Worker 的冷却抑制也经同一方法转入（trace 可见，不静默）。
  engine.emitFeedbackEvent({
    kind: 'feedback-suppressed', tMs: 1500, node: 0, suppressedCount: 3, suppressedValue: 0.8,
  });
  const suppressed = events.filter((e) => e.kind === 'feedback-suppressed');
  assert.equal(suppressed.length, 1);
  assert.equal(suppressed[0].suppressedCount, 3);
  assert.equal(suppressed[0].suppressedValue, 0.8);
  engine.stop();
  assert.deepEqual(feedbackConfigs, [config, null]);
  // 停后 emitFeedbackEvent 不再转入。
  engine.emitFeedbackEvent({ kind: 'feedback-detected', tMs: 1300, node: 0 });
  assert.equal(events.filter((e) => e.kind === 'feedback-detected').length, 1);
  engine.emitFeedbackEvent({ kind: 'feedback-suppressed', tMs: 1600, node: 0, suppressedCount: 4 });
  assert.equal(events.filter((e) => e.kind === 'feedback-suppressed').length, 1);
});

test('去重：快照合并/跳过时不突发连发——60 Hz 快照断流后回来第一 tick 只发最新一个', () => {
  const { engine, pulses, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, durationMs: 20000 }, 0);
  // 正常快照（约 60 Hz）：0–500 ms 只发 trial 1。
  for (let t = 0; t <= 500; t += 17) engine.tick(t);
  assert.equal(engine.trialIndex, 1);
  // 快照断流（tab 切后台、React 批量合并）：回来第一 tick 是 5500 ms，
  // 1000–5000 共 5 个试次到期，只发最新一个（trial 2，计划 5000），其余跳过。
  engine.tick(5500);
  assert.equal(pulses.length, 2);
  assert.equal(engine.trialIndex, 2);
  const stimuli = events.filter((e) => e.kind === 'stimulus-sent');
  assert.equal(stimuli[1].tMs, 5000);
  assert.equal(engine.skippedTrials, 4);
  const skipped = events.filter((e) => e.kind === 'trial-skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].skippedCount, 4);
  assert.equal(skipped[0].trialIndex, 2);
  // 之后恢复正常快照，继续按 ISI 发，不补发跳过的试次。
  engine.tick(6000);
  assert.equal(engine.trialIndex, 3);
  assert.equal(engine.skippedTrials, 4);
});

test('回路时延 trigger→command：detected/applied 按 action id 配对，等于 delayMs + 1', () => {
  const { engine } = harness();
  const config = {
    node: 0, feature: 'instant', threshold: 0.5, amplitude: 1, durationMs: 100,
    periodMs: 100, windowMs: 1000, cooldownMs: 0, delayMs: 37, maxTriggers: 10,
  };
  // 未测到之前全是 null / 0。
  assert.deepEqual(engine.getLoopTiming(), {
    triggerToCommandMs: null, dispatchToAckMs: null, observationLagMs: null,
    lastActionId: null, samples: { triggerToCommand: 0, dispatchToAck: 0, observationLag: 0 },
  });
  engine.start('closed-loop', config, 0);
  engine.emitFeedbackEvent({ kind: 'feedback-detected', tMs: 1200, node: 0, actionId: 1, detectedMs: 1200 });
  // applied：applyMs = detectedMs + delayMs + 1 = 1238；收到时客户端最新快照 1233，
  // 比施加时刻晚 5 ms——快照还没走到施加时刻，observation lag 为负是诚实的。
  engine.emitFeedbackEvent({
    kind: 'feedback-applied', tMs: 1238, node: 0, actionId: 1,
    detectedMs: 1200, applyMs: 1238, observedAtTms: 1233,
  });
  const timing = engine.getLoopTiming();
  assert.equal(timing.triggerToCommandMs, 38);
  assert.equal(timing.lastActionId, 1);
  assert.equal(timing.observationLagMs, -5);
  assert.ok(Math.abs(timing.observationLagMs) <= LOOP_TIMING_BOUNDS.observationLagMaxAbsMs);
  assert.equal(timing.samples.triggerToCommand, 1);
  assert.equal(timing.samples.observationLag, 1);
  // 第二个动作：applied 的快照已走到施加时刻之后，lag 为正。
  engine.emitFeedbackEvent({ kind: 'feedback-detected', tMs: 2000, node: 0, actionId: 2, detectedMs: 2000 });
  engine.emitFeedbackEvent({
    kind: 'feedback-applied', tMs: 2038, node: 0, actionId: 2,
    detectedMs: 2000, applyMs: 2038, observedAtTms: 2050,
  });
  const timing2 = engine.getLoopTiming();
  assert.equal(timing2.triggerToCommandMs, 38);
  assert.equal(timing2.lastActionId, 2);
  assert.equal(timing2.observationLagMs, 12);
  assert.equal(timing2.samples.triggerToCommand, 2);
  // 新开一轮，时延读数清零。
  engine.stop();
  engine.start('closed-loop', config, 0);
  assert.deepEqual(engine.getLoopTiming(), {
    triggerToCommandMs: null, dispatchToAckMs: null, observationLagMs: null,
    lastActionId: null, samples: { triggerToCommand: 0, dispatchToAck: 0, observationLag: 0 },
  });
});

test('回路时延：applied 先到（detected 漏掉）时仍用 applied 自带的 detectedMs 配对', () => {
  const { engine } = harness();
  const config = {
    node: 0, feature: 'instant', threshold: 0.5, amplitude: 1, durationMs: 100,
    periodMs: 100, windowMs: 1000, cooldownMs: 0, delayMs: 5, maxTriggers: 10,
  };
  engine.start('closed-loop', config, 0);
  engine.emitFeedbackEvent({
    kind: 'feedback-applied', tMs: 2006, node: 0, actionId: 2,
    detectedMs: 2000, applyMs: 2006, observedAtTms: 2006,
  });
  const timing = engine.getLoopTiming();
  assert.equal(timing.triggerToCommandMs, 6);
  assert.equal(timing.lastActionId, 2);
  assert.equal(timing.observationLagMs, 0);
});

test('回路时延：stop 后待配对清空，下一轮同 action id 不错配到上一轮', () => {
  const { engine } = harness();
  const config = {
    node: 0, feature: 'instant', threshold: 0.5, amplitude: 1, durationMs: 100,
    periodMs: 100, windowMs: 1000, cooldownMs: 0, delayMs: 0, maxTriggers: 10,
  };
  engine.start('closed-loop', config, 0);
  engine.emitFeedbackEvent({ kind: 'feedback-detected', tMs: 1000, node: 0, actionId: 1, detectedMs: 1000 });
  engine.stop();
  engine.start('closed-loop', config, 0);
  // 新一轮 action id 从 1 重排；applied 自带 detectedMs 5000，必须按它算，
  // 不能错配到上一轮残留的 detectedMs 1000（否则会是 4001）。
  engine.emitFeedbackEvent({
    kind: 'feedback-applied', tMs: 5001, node: 0, actionId: 1,
    detectedMs: 5000, applyMs: 5001, observedAtTms: 5001,
  });
  assert.equal(engine.getLoopTiming().triggerToCommandMs, 1);
});

test('回路时延 dispatch→ACK：未修正的 marker 不计，修正后才计一次', () => {
  const { engine, events } = harness();
  engine.start('oddball', { isiMs: 1000, oddballEvery: 5, durationMs: 20000 }, 0);
  for (let t = 0; t <= 4000; t += 1000) engine.tick(t);
  // trial 5（oddball）dispatch 4000；marker 在但尚未 ACK 修正。
  engine.confirmFromMarkers([{ t_ms: 4000, node: 0, kind: 'pulse', amplitude: 2 }]);
  assert.equal(engine.getLoopTiming().dispatchToAckMs, null);
  assert.equal(engine.getLoopTiming().samples.dispatchToAck, 0);
  // ACK 修正为 4017：dispatch→ACK = 17 ms（一个快照间隔），在门限内。
  engine.confirmFromMarkers([{ t_ms: 4017, node: 0, kind: 'pulse', amplitude: 2 }]);
  const timing = engine.getLoopTiming();
  assert.equal(timing.dispatchToAckMs, 17);
  assert.equal(timing.samples.dispatchToAck, 1);
  assert.ok(timing.dispatchToAckMs >= 0 && timing.dispatchToAckMs <= LOOP_TIMING_BOUNDS.dispatchToAckMaxMs);
  // 响应锚到修正后的时间。
  const responses = events.filter((e) => e.kind === 'response');
  assert.equal(responses.length, 1);
  assert.equal(responses[0].tMs, 4017 + 380);
  assert.equal(responses[0].confirmed, true);
});

test('非法参数抛错：flicker 频率出界、oddball ISI 非正', () => {
  const { engine } = harness();
  assert.throws(() => engine.start('flicker', { frequencyHz: 40 }, 0), RangeError);
  assert.throws(() => engine.start('oddball', { isiMs: 0 }, 0), RangeError);
  assert.throws(() => engine.start('single-pulse', { node: 76 }, 0), RangeError);
});
