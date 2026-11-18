/**
 * Phase 2 闭环实验台 — 设置 store 测试（design §2/§4：设置上提到 App 外部
 * store，工作区切换时不丢）。
 * 跑法：node --experimental-strip-types --test tests/bench/bench-settings.test.mjs
 *
 * 覆盖：默认值与 Phase 1 的 useState 初始值一致；改设置会更新 store 并通知
 * 订阅者；非法枚举值抛 RangeError；状态在“模拟卸载/重挂载”（退订后重新订阅、
 * 重新读取）后仍在；reset 恢复默认值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BENCH_SETTINGS_DEFAULTS, getBenchSettings, resetBenchSettings,
  setBenchSettings, subscribeBenchSettings,
} from '../../app/src/lib/benchSettings.ts';

test('defaults match the Phase 1 useState initial values', () => {
  resetBenchSettings();
  assert.deepEqual(getBenchSettings(), {
    capPreset: '10-10-64',
    sampleRate: 250,
    referenceSel: 'average',
    bandpassOn: true,
    lowDraft: 0.5,
    highDraft: 40,
    lowHz: 0.5,
    highHz: 40,
    gain: 1,
    selectedChannel: 'Pz',
    protocolId: 'single-pulse',
    subjectSeed: 1,
    rtMinMs: 320,
    rtMaxMs: 440,
    oddballStandardAmp: 1,
    oddballAmp: 2,
    oddballIsiMs: 1000,
    oddballEvery: 5,
    oddballDurationMs: 100,
    flickerFreqHz: 10,
    flickerAmp: 1,
    flickerDurationMs: 100,
    clFeature: 'instant',
    clThreshold: 0.5,
    clAmplitude: 1,
    clDurationMs: 100,
    clPeriodMs: 1000,
    clCooldownMs: 500,
    clMaxTriggers: 100,
    stimTarget: null,
  });
  assert.deepEqual(BENCH_SETTINGS_DEFAULTS, getBenchSettings());
});

test('changing a setting updates the store and notifies subscribers once', () => {
  resetBenchSettings();
  let calls = 0;
  const unsubscribe = subscribeBenchSettings(() => { calls += 1; });
  setBenchSettings({ capPreset: '10-5-128', sampleRate: 500, gain: 2.5 });
  assert.equal(getBenchSettings().capPreset, '10-5-128');
  assert.equal(getBenchSettings().sampleRate, 500);
  assert.equal(getBenchSettings().gain, 2.5);
  assert.equal(calls, 1);
  // Untouched fields keep their defaults.
  assert.equal(getBenchSettings().protocolId, 'single-pulse');
  assert.equal(getBenchSettings().selectedChannel, 'Pz');
  unsubscribe();
  // A no-change patch notifies nobody.
  calls = 0;
  const unsubscribe2 = subscribeBenchSettings(() => { calls += 1; });
  setBenchSettings({ gain: 2.5 });
  assert.equal(calls, 0);
  unsubscribe2();
});

test('every setting field round-trips through the store', () => {
  resetBenchSettings();
  setBenchSettings({
    capPreset: '10-20-19', referenceSel: 'cz', bandpassOn: false,
    lowDraft: 1, highDraft: 30, lowHz: 1, highHz: 30, selectedChannel: 'Cz',
    protocolId: 'oddball', subjectSeed: 42, rtMinMs: 300, rtMaxMs: 500,
    oddballStandardAmp: 1.5, oddballAmp: 1.8, oddballIsiMs: 1200,
    oddballEvery: 4, oddballDurationMs: 150,
    flickerFreqHz: 12, flickerAmp: 1.2, flickerDurationMs: 80,
    clFeature: 'rms', clThreshold: 0.7, clAmplitude: 1.5, clDurationMs: 120,
    clPeriodMs: 800, clCooldownMs: 200, clMaxTriggers: 10, stimTarget: 12,
  });
  const s = getBenchSettings();
  assert.equal(s.capPreset, '10-20-19');
  assert.equal(s.referenceSel, 'cz');
  assert.equal(s.bandpassOn, false);
  assert.equal(s.lowDraft, 1);
  assert.equal(s.highDraft, 30);
  assert.equal(s.lowHz, 1);
  assert.equal(s.highHz, 30);
  assert.equal(s.selectedChannel, 'Cz');
  assert.equal(s.protocolId, 'oddball');
  assert.equal(s.subjectSeed, 42);
  assert.equal(s.rtMinMs, 300);
  assert.equal(s.rtMaxMs, 500);
  assert.equal(s.oddballStandardAmp, 1.5);
  assert.equal(s.oddballAmp, 1.8);
  assert.equal(s.oddballIsiMs, 1200);
  assert.equal(s.oddballEvery, 4);
  assert.equal(s.oddballDurationMs, 150);
  assert.equal(s.flickerFreqHz, 12);
  assert.equal(s.flickerAmp, 1.2);
  assert.equal(s.flickerDurationMs, 80);
  assert.equal(s.clFeature, 'rms');
  assert.equal(s.clThreshold, 0.7);
  assert.equal(s.clAmplitude, 1.5);
  assert.equal(s.clDurationMs, 120);
  assert.equal(s.clPeriodMs, 800);
  assert.equal(s.clCooldownMs, 200);
  assert.equal(s.clMaxTriggers, 10);
  assert.equal(s.stimTarget, 12);
});

test('state survives a simulated unmount/remount cycle', () => {
  resetBenchSettings();
  // Mount 1: a component subscribes and the user changes settings.
  let calls = 0;
  const unsubscribeMount1 = subscribeBenchSettings(() => { calls += 1; });
  setBenchSettings({
    capPreset: '10-10-32', sampleRate: 500, referenceSel: 'm1',
    bandpassOn: false, lowHz: 2, highHz: 30, gain: 2,
    selectedChannel: 'Cz', protocolId: 'closed-loop',
    subjectSeed: 7, rtMinMs: 300, rtMaxMs: 460,
    oddballAmp: 1.5, flickerFreqHz: 15, clThreshold: 0.8, stimTarget: 40,
  });
  assert.equal(calls, 1);
  // Unmount: every subscription drops. The store is module-level, so the
  // values must outlive the component that set them.
  unsubscribeMount1();
  // Remount: a fresh subscription re-reads the store.
  const afterRemount = getBenchSettings();
  assert.equal(afterRemount.capPreset, '10-10-32');
  assert.equal(afterRemount.sampleRate, 500);
  assert.equal(afterRemount.referenceSel, 'm1');
  assert.equal(afterRemount.bandpassOn, false);
  assert.equal(afterRemount.lowHz, 2);
  assert.equal(afterRemount.highHz, 30);
  assert.equal(afterRemount.gain, 2);
  assert.equal(afterRemount.selectedChannel, 'Cz');
  assert.equal(afterRemount.protocolId, 'closed-loop');
  assert.equal(afterRemount.subjectSeed, 7);
  assert.equal(afterRemount.rtMinMs, 300);
  assert.equal(afterRemount.rtMaxMs, 460);
  assert.equal(afterRemount.oddballAmp, 1.5);
  assert.equal(afterRemount.flickerFreqHz, 15);
  assert.equal(afterRemount.clThreshold, 0.8);
  assert.equal(afterRemount.stimTarget, 40);
  // The remounted subscriber is notified of later changes.
  calls = 0;
  const unsubscribeMount2 = subscribeBenchSettings(() => { calls += 1; });
  setBenchSettings({ gain: 3 });
  assert.equal(calls, 1);
  assert.equal(getBenchSettings().gain, 3);
  unsubscribeMount2();
});

test('unknown enum values throw RangeError and leave the store unchanged', () => {
  resetBenchSettings();
  assert.throws(() => setBenchSettings({ capPreset: '10-10-99' }), RangeError);
  assert.throws(() => setBenchSettings({ sampleRate: 1000 }), RangeError);
  assert.throws(() => setBenchSettings({ referenceSel: 'linked-ears' }), RangeError);
  assert.throws(() => setBenchSettings({ protocolId: 'ssvep' }), RangeError);
  assert.throws(() => setBenchSettings({ clFeature: 'peak' }), RangeError);
  assert.deepEqual(getBenchSettings(), BENCH_SETTINGS_DEFAULTS);
});

test('reset restores the Phase 1 defaults', () => {
  setBenchSettings({ capPreset: '10-5-256', protocolId: 'flicker', gain: 5 });
  resetBenchSettings();
  assert.deepEqual(getBenchSettings(), BENCH_SETTINGS_DEFAULTS);
});
