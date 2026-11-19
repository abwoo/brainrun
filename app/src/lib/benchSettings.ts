/**
 * Phase 2 — bench settings store (design §2/§4, Phase 2 item: lift bench
 * settings out of ClosedLoopBench so they survive workspace switches).
 *
 * Same pattern as headModelSelection.ts: module-level state + listeners,
 * read in the component via useSyncExternalStore. App.tsx unmounts
 * ClosedLoopBench whenever the workspace leaves 'bench', so anything kept
 * in its useState resets to defaults on the next visit. Settings live here
 * and outlive the mount; no control or backend call changes — the store
 * only holds what the controls already held.
 *
 * Preserved across a workspace switch: everything in BenchSettings
 * (cap preset, sample rate, reference, band-pass on/off + low/high drafts
 * and applied values, gain, selected channel, protocol id + all protocol
 * params, subject seed + RT range, stimulator target override).
 *
 * NOT preserved (stays local to ClosedLoopBench on purpose): the live run
 * — acquisition + bench recording, protocol running state, trial/response
 * counts, response table, stimulator command log, loop trace, displayed
 * series. A switch mid-run therefore stops the visible run: the protocol
 * engine is torn down with the component, its timers stop, and the run
 * must be started again after returning. The underlying Worker simulation
 * keeps running (it lives in App), so re-acquisition after remount picks
 * up the live model state; nothing is silently corrupted, but in-flight
 * protocol progress and the trace are gone.
 */
import { BENCH_CAP_PRESETS, type BenchCapPreset } from './benchCap.ts';
import type { BenchProtocolId } from './benchProtocol.ts';

export type BenchReferenceSel = 'average' | 'cz' | 'm1';
export type BenchClosedLoopFeature = 'instant' | 'rms';

export interface BenchSettings {
  capPreset: BenchCapPreset;
  sampleRate: 250 | 500;
  referenceSel: BenchReferenceSel;
  bandpassOn: boolean;
  lowDraft: number;
  highDraft: number;
  lowHz: number;
  highHz: number;
  gain: number;
  selectedChannel: string;
  protocolId: BenchProtocolId;
  subjectSeed: number;
  rtMinMs: number;
  rtMaxMs: number;
  oddballStandardAmp: number;
  oddballAmp: number;
  oddballIsiMs: number;
  oddballEvery: number;
  oddballDurationMs: number;
  flickerFreqHz: number;
  flickerAmp: number;
  flickerDurationMs: number;
  clFeature: BenchClosedLoopFeature;
  clThreshold: number;
  clAmplitude: number;
  clDurationMs: number;
  clPeriodMs: number;
  clCooldownMs: number;
  clMaxTriggers: number;
  /** Stimulator target override; null means "follow the selected region". */
  stimTarget: number | null;
  /** Subject composer (pictorial bench, design §5): real WC / background
   * parameters only. Ranges are the engine's hard boundaries
   * (see benchSubjects.ts COMPOSER_SLIDERS). */
  g: number;
  cEi: number;
  ouSigma: number;
  extSineAmp: number;
  extSineFreqHz: number;
}

/** Phase 1 defaults, unchanged — every value matches the old useState initial. */
export const BENCH_SETTINGS_DEFAULTS: BenchSettings = {
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
  /** 闭环默认阈值与幅度（2026-11-19 实测校准，见 tests/bench/bench-closed-loop-defaults.test.mjs）：
   * Spontaneous 下节点 0（rA1）E 均值约 0.014、最大值约 0.019，旧阈值 0.5
   * 高出最大值约 25 倍、60 s 内 0 次触发；0.016 使约 12–15% 的评估越过阈值，
   * 两个种子上 60 s 内触发 7 次与 9 次。幅度 1.0 的重复脉冲会把双稳态网络
   * 翻进 E≈0.5 的高态并锁死（60 s 内 18–58 次触发）；0.7 在两个种子上均不
   * 翻转，单脉冲 max|ΔE| 0.0211（响应阈值 0.01 的约 2 倍）。节点仍为默认
   * 0（未选脑区时的回退值），冷却 500 ms 与评估周期 1000 ms 不变。 */
  clThreshold: 0.016,
  clAmplitude: 0.7,
  clDurationMs: 100,
  clPeriodMs: 1000,
  clCooldownMs: 500,
  clMaxTriggers: 100,
  stimTarget: null,
  g: 0.35,
  cEi: 4.0,
  ouSigma: 0.10,
  extSineAmp: 0,
  extSineFreqHz: 10,
};

let settings: BenchSettings = { ...BENCH_SETTINGS_DEFAULTS };
const listeners = new Set<() => void>();

export function getBenchSettings(): BenchSettings { return settings; }
export function subscribeBenchSettings(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const CAP_PRESETS = new Set(BENCH_CAP_PRESETS.map((p) => p.preset));
const PROTOCOL_IDS: ReadonlySet<BenchProtocolId> = new Set([
  'single-pulse', 'oddball', 'flicker', 'closed-loop',
]);

/** Merge a partial patch; unknown enum values throw RangeError (same style
 * as setHeadModelSelection) instead of silently corrupting the store. A
 * patch that changes nothing notifies nobody. */
export function setBenchSettings(patch: Partial<BenchSettings>): void {
  if (patch.capPreset !== undefined && !CAP_PRESETS.has(patch.capPreset)) {
    throw new RangeError(`Unknown cap preset: ${patch.capPreset}`);
  }
  if (patch.sampleRate !== undefined && patch.sampleRate !== 250 && patch.sampleRate !== 500) {
    throw new RangeError(`Unknown sample rate: ${patch.sampleRate}`);
  }
  if (patch.referenceSel !== undefined
    && patch.referenceSel !== 'average' && patch.referenceSel !== 'cz' && patch.referenceSel !== 'm1') {
    throw new RangeError(`Unknown reference: ${patch.referenceSel}`);
  }
  if (patch.protocolId !== undefined && !PROTOCOL_IDS.has(patch.protocolId)) {
    throw new RangeError(`Unknown protocol: ${patch.protocolId}`);
  }
  if (patch.clFeature !== undefined && patch.clFeature !== 'instant' && patch.clFeature !== 'rms') {
    throw new RangeError(`Unknown closed-loop feature: ${patch.clFeature}`);
  }
  // Composer fields: out-of-range values throw (same style as the enum
  // checks above), never silently clamped — the ranges are engine hard
  // boundaries (benchSubjects.ts).
  if (patch.g !== undefined && (!Number.isFinite(patch.g) || patch.g < 0 || patch.g > 0.4)) {
    throw new RangeError(`g out of range 0–0.4: ${patch.g}`);
  }
  if (patch.cEi !== undefined && (!Number.isFinite(patch.cEi) || patch.cEi < 3 || patch.cEi > 8)) {
    throw new RangeError(`cEi out of range 3–8: ${patch.cEi}`);
  }
  if (patch.ouSigma !== undefined && (!Number.isFinite(patch.ouSigma) || patch.ouSigma < 0.02 || patch.ouSigma > 0.15)) {
    throw new RangeError(`ouSigma out of range 0.02–0.15: ${patch.ouSigma}`);
  }
  if (patch.extSineAmp !== undefined && (!Number.isFinite(patch.extSineAmp) || patch.extSineAmp < 0 || patch.extSineAmp > 0.4)) {
    throw new RangeError(`extSineAmp out of range 0–0.4: ${patch.extSineAmp}`);
  }
  if (patch.extSineFreqHz !== undefined && (!Number.isFinite(patch.extSineFreqHz) || patch.extSineFreqHz < 1 || patch.extSineFreqHz > 30)) {
    throw new RangeError(`extSineFreqHz out of range 1–30: ${patch.extSineFreqHz}`);
  }
  let changed = false;
  for (const key of Object.keys(patch) as (keyof BenchSettings)[]) {
    if (settings[key] !== patch[key]) { changed = true; break; }
  }
  if (!changed) return;
  settings = { ...settings, ...patch };
  listeners.forEach((fn) => fn());
}

/** Restore Phase 1 defaults (used by tests; no UI control calls this). */
export function resetBenchSettings(): void {
  settings = { ...BENCH_SETTINGS_DEFAULTS };
  listeners.forEach((fn) => fn());
}
