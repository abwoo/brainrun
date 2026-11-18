/**
 * Phase 1 闭环实验台 — 台子记录组装测试（implementation-plan.md §1.6）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-recording.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ExperimentSession } from '../../app/src/lib/experimentSession.ts';
import { setLiveRecordingStore } from '../../app/src/lib/eegRecording.ts';
import { reReferenceRecording } from '../../app/src/lib/eegRecording.ts';
import {
  assembleBenchRecording,
  benchRecordingToStoreValue,
} from '../../app/src/lib/benchRecording.ts';

const RUN_ID = 'run-derived-test-1';

function makeSession() {
  return new ExperimentSession(
    {
      origin: 'live-derived', solverId: 'live-wc-integration-fir-v1',
      anatomyId: 'test-sphere', registration: 'unregistered', seed: 1,
      parentRunId: 'run-upstream-1', clock: 'solver-integration-ms',
    },
    { idFactory: () => RUN_ID, nowIso: () => '2026-11-18T00:00:00.000Z' },
  ).getSnapshot();
}

/** 2 导、250 Hz、0–4000 ms 的合成 Raw（相对时间），含 infinity 参考数据。 */
function makeNativeRecording() {
  const nSamples = 1001;
  const timesMs = Array.from({ length: nSamples }, (_, j) => j * 4);
  const data = [
    timesMs.map((t) => Math.sin((2 * Math.PI * 10 * t) / 1000)),
    timesMs.map((t) => 0.5 * Math.sin((2 * Math.PI * 10 * t) / 1000)),
  ];
  const recording = {
    version: 1,
    sfreqHz: 250,
    timesMs,
    channels: [
      { label: 'Cz', positionMm: [0, 0, 95] },
      { label: 'Pz', positionMm: [0, -50, 80] },
    ],
    dataUv: data.map((row) => [...row]),
    rawDataUvInfinity: data.map((row) => [...row]),
    reference: { mode: 'average' },
    montage: '10-20',
    forwardModelId: 'test-sphere-v1',
    sourceModelId: 'live-wc-integration-fir-v1',
    seed: 1,
    noise: null,
    nativeSource: { node: 0, baselineE: 0.01, baselineI: 0.01, morphology: {}, mapping: 'uncalibrated-population-to-primary-dipole' },
  };
  return {
    recording,
    events: [{ id: 0, type: 'pulse', condition: 'unclassified', tMs: 1000, drive: 1, driveUnit: 'wc' }],
    t0Ms: 5000,
    sourcePositionMm: [0, 0, 16],
  };
}

const CAP = {
  preset: '10-20-19', montage: '10-20', channelCount: 19,
  labels: ['Fp1', 'Fp2', 'F7', 'F3', 'Fz', 'F4', 'F8', 'T7', 'C3', 'Cz', 'C4', 'T8', 'P7', 'P3', 'Pz', 'P4', 'P8', 'O1', 'O2'],
};

function assemble(extraEvents, amplifier = null) {
  return assembleBenchRecording({
    native: makeNativeRecording(),
    extraEvents,
    session: makeSession(),
    protocol: 'oddball',
    amplifier: amplifier ?? {
      sampleRateHz: 250, reference: { mode: 'average' },
      bandpass: { lowHz: 0.5, highHz: 40 }, gain: 2,
    },
    cap: CAP,
    headModel: 'sphere',
  });
}

test('事件排序与相对时间换算：extraEvents 绝对 Worker ms → tMs - t0Ms', () => {
  const br = assemble([
    { id: 0, type: 'response', condition: 'unclassified', tMs: 6100, drive: 380, driveUnit: 'ms' },
    { id: 1, type: 'pulse', condition: 'oddball', tMs: 7000, drive: 2, driveUnit: 'wc' },
  ]);
  assert.equal(br.runId, RUN_ID);
  // native pulse 1000、response 1100、extra pulse 2000，按 tMs 排序。
  assert.deepEqual(br.events.map((e) => e.tMs), [1000, 1100, 2000]);
  assert.deepEqual(br.events.map((e) => e.type), ['pulse', 'response', 'pulse']);
  assert.deepEqual(br.events.map((e) => e.id), [0, 1, 2]);
  assert.ok(br.events.every((e) => e.runId === RUN_ID));
  assert.equal(br.recording.provenance.upstreamStartMs, 5000);
  assert.equal(br.recording.provenance.runId, RUN_ID);
  assert.equal(br.recording.experiment.session.provenance.runId, RUN_ID);
  assert.equal(br.recording.experiment.parameters.protocol, 'oddball');
  assert.equal(br.recording.experiment.parameters.headModel, 'sphere');
});

test('epochs 只锚定 pulse 事件：response 事件不切分', () => {
  const br = assemble([
    { id: 0, type: 'response', condition: 'unclassified', tMs: 6100, drive: 380, driveUnit: 'ms' },
    { id: 1, type: 'pulse', condition: 'oddball', tMs: 7000, drive: 2, driveUnit: 'wc' },
  ]);
  assert.ok(br.epochs !== null);
  assert.equal(br.epochs.trials.length, 2);
  assert.deepEqual(br.epochs.events.map((e) => e.tMs), [1000, 2000]);
  assert.ok(br.epochs.events.every((e) => e.type === 'pulse'));
  assert.deepEqual([br.epochs.tminMs, br.epochs.tmaxMs, br.epochs.baselineMs], [-200, 800, [-200, 0]]);
  // 每个 epoch 251 个采样（-200..800 ms @ 250 Hz）。
  assert.equal(br.epochs.timesMs.length, 251);
});

test('无 pulse 事件时 epochs 为 null', () => {
  const br = assemble([
    { id: 0, type: 'response', condition: 'unclassified', tMs: 6100, drive: 380, driveUnit: 'ms' },
  ]);
  // native 事件被换成只有 response：重建一个无 native 事件的输入。
  const noPulse = assembleBenchRecording({
    native: { ...makeNativeRecording(), events: [] },
    extraEvents: [{ id: 0, type: 'response', condition: 'unclassified', tMs: 6100, drive: 380, driveUnit: 'ms' }],
    session: makeSession(),
    protocol: 'single-pulse',
    amplifier: { sampleRateHz: 250, reference: { mode: 'average' }, bandpass: null, gain: 1 },
    cap: CAP,
    headModel: 'sphere',
  });
  assert.equal(noPulse.epochs, null);
  assert.equal(br.epochs !== null, true);
});

test('runId 不一致抛错：extraEvents 自带 runId 与 session 不符', () => {
  assert.throws(
    () => assemble([
      { id: 0, type: 'pulse', condition: 'unclassified', tMs: 6000, drive: 1, driveUnit: 'wc', runId: 'run-other' },
    ]),
    /does not match session runId/,
  );
});

test('runId 不一致抛错：native recording 已带 provenance 且 runId 不符', () => {
  const native = makeNativeRecording();
  native.recording = {
    ...native.recording,
    provenance: {
      runId: 'run-someone-else', parentRunId: null, origin: 'live-derived',
      clock: 'solver-integration-ms', solverId: 'x', anatomyId: 'y',
      registration: 'unregistered', seed: 1, createdAtIso: '2026-11-18T00:00:00.000Z',
    },
  };
  assert.throws(
    () => assembleBenchRecording({
      native, extraEvents: [], session: makeSession(), protocol: null,
      amplifier: { sampleRateHz: 250, reference: { mode: 'average' }, bandpass: null, gain: 1 },
      cap: CAP, headModel: 'sphere',
    }),
    /does not match session runId/,
  );
});

test('参考切换用 reReferenceRecording：Cz 参考、dataRevision 同步、增益不进 dataUv', () => {
  const before = makeNativeRecording();
  const br = assemble([], {
    sampleRateHz: 250, reference: { mode: 'electrode', label: 'Cz' },
    bandpass: { lowHz: 0.5, highHz: 40 }, gain: 2,
  });
  assert.deepEqual(br.recording.reference, { mode: 'electrode', label: 'Cz' });
  assert.equal(br.recording.dataRevision, 1);
  // 与直接调 reReferenceRecording 的结果逐点一致（增益 2 未乘进去）。
  const direct = reReferenceRecording(before.recording, { mode: 'electrode', label: 'Cz' });
  assert.deepEqual(br.recording.dataUv, direct.dataUv);
  assert.equal(br.recording.experiment.parameters.amplifier.gain, 2);
  // epochs 的 dataRevision 与 Raw 同步，否则 setLiveRecordingStore 会拒收。
  assert.equal(br.epochs.dataRevision, 1);
  assert.equal(br.epochs.provenance.runId, RUN_ID);
});

test('trigger + response 端到端：native pulse 触发与 response 事件同 runId、有序、RT 在 320–440 ms 窗口内', () => {
  // 模拟真实台子：native 事件是 Worker ACK 后的 pulse（相对 1000 ms，
  // 绝对 6000 ms = t0Ms 5000 + 1000）；extraEvents 是协议引擎锚定到
  // 同一 ACK 时间 + RT 380 ms 的 response（绝对 6380 ms）。
  const br = assemble([
    { id: 0, type: 'response', condition: 'unclassified', tMs: 6380, drive: 380, driveUnit: 'ms' },
  ]);
  const pulse = br.events.find((e) => e.type === 'pulse');
  const response = br.events.find((e) => e.type === 'response');
  assert.ok(pulse && response, 'trigger and response must both be in the assembled recording');
  assert.equal(pulse.runId, RUN_ID);
  assert.equal(response.runId, RUN_ID);
  assert.ok(response.tMs > pulse.tMs, 'response must come after the trigger');
  const rtMs = response.tMs - pulse.tMs;
  assert.ok(rtMs >= 320 && rtMs <= 440, `response - trigger = ${rtMs} ms, expected within [320, 440]`);
  assert.equal(response.drive, 380);
  assert.equal(response.driveUnit, 'ms');
  // 事件按 tMs 排序、id 连续重排；epochs 只锚定 pulse。
  assert.deepEqual(br.events.map((e) => e.tMs), [1000, 1380]);
  assert.equal(br.epochs.trials.length, 1);
  assert.equal(br.epochs.events[0].type, 'pulse');
});

test('store 值三件套 runId 一致，可被 setLiveRecordingStore 接受', () => {
  const br = assemble([
    { id: 0, type: 'response', condition: 'unclassified', tMs: 6100, drive: 380, driveUnit: 'ms' },
  ]);
  const value = benchRecordingToStoreValue(br);
  assert.equal(value.recording.provenance.runId, RUN_ID);
  assert.ok(value.events.every((e) => e.runId === RUN_ID));
  assert.equal(value.epochs.provenance.runId, RUN_ID);
  setLiveRecordingStore(value);
  setLiveRecordingStore(null);
});
