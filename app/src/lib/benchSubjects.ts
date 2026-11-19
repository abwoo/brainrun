/**
 * Subject composer parameter table (pictorial bench, design §5).
 *
 * Pure data + pure functions, no UI, no Worker calls — unit-testable on
 * its own (tests/bench/bench-subjects.test.mjs).
 *
 * A subject is a combination of REAL model parameters, not a preset person
 * and not a clinical diagnosis. The table below is the complete set the
 * Wilson–Cowan engine can express about a subject:
 *   A. excitation / inhibition balance (WC本体参数 g, c_ei)
 *   B. background activity & rhythm (OU noise ou_sigma, sine drive
 *      ext_sine_amp / ext_sine_freq_hz, background mode)
 *   C. cognition & behaviour (RT range + seed — the simulated subject's
 *      behaviour parameters, benchSubject.ts)
 *
 * Ranges are hard boundaries from the engine, not UI choices:
 * - g 0–0.4: protocol.ts — at >= 0.5 the baseline itself flips.
 * - c_ei 3–8: protocol.ts — at 2 the whole network flips on stimulation.
 * - ou_sigma 0.02–0.15: simClient.ts — 0.20 locks with no input within
 *   1.3–35.9 s, 0.10 is the largest value that passed; 0.15 is borderline.
 * - ext_sine_amp 0–0.4 (model units of P): crates/brain-core — the
 *   oscillatory preset drives at 0.30 (10 Hz, returns to baseline);
 *   a 0.50 drive does NOT return (pr4_pulse_safety.py). 0.4 stays below
 *   the failing 0.50 with margin.
 * - ext_sine_freq_hz 1–30 Hz: the sine is P_sine(t) = amp *
 *   sin(2*pi*f*t) with f in Hz (brain-core lib.rs); 1–30 Hz is the
 *   flicker protocol's frequency range (benchProtocol).
 *
 * Deliberately NOT here (design §5.4): miss/false-alarm rates (the
 * simulated subject assumes none — benchSubject Phase 1), global weight
 * scaling (no such parameter), per-region bias (an applied input, not a
 * subject trait), stimulus amplitude/duration (the experimenter's side),
 * closed-loop thresholds (protocol parameters).
 */

/** One composer slider: the parameter it drives, its range and default. */
export interface ComposerSliderDef {
  id: 'g' | 'cEi' | 'ouSigma' | 'extSineAmp' | 'extSineFreqHz' | 'rtMinMs' | 'rtMaxMs' | 'subjectSeed';
  group: 'A' | 'B' | 'C';
  /** benchSettings field name (C-group fields predate the composer). */
  field: 'g' | 'cEi' | 'ouSigma' | 'extSineAmp' | 'extSineFreqHz' | 'rtMinMs' | 'rtMaxMs' | 'subjectSeed';
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
}

export const COMPOSER_SLIDERS: readonly ComposerSliderDef[] = [
  { id: 'g', group: 'A', field: 'g', min: 0, max: 0.4, step: 0.01, default: 0.35, unit: '' },
  { id: 'cEi', group: 'A', field: 'cEi', min: 3, max: 8, step: 0.1, default: 4.0, unit: '' },
  { id: 'ouSigma', group: 'B', field: 'ouSigma', min: 0.02, max: 0.15, step: 0.005, default: 0.10, unit: '' },
  { id: 'extSineAmp', group: 'B', field: 'extSineAmp', min: 0, max: 0.4, step: 0.01, default: 0, unit: '' },
  { id: 'extSineFreqHz', group: 'B', field: 'extSineFreqHz', min: 1, max: 30, step: 0.5, default: 10, unit: 'Hz' },
  { id: 'rtMinMs', group: 'C', field: 'rtMinMs', min: 50, max: 1000, step: 10, default: 320, unit: 'ms' },
  { id: 'rtMaxMs', group: 'C', field: 'rtMaxMs', min: 50, max: 2000, step: 10, default: 440, unit: 'ms' },
  { id: 'subjectSeed', group: 'C', field: 'subjectSeed', min: 1, max: 9999, step: 1, default: 1, unit: '' },
];

/** Combination-summary thresholds (design §5.3, fixed — not free text). */
export const SUMMARY_THRESHOLDS = {
  highCouplingG: 0.38,
  weakInhibitionCEi: 3.5,
  largeNoiseOuSigma: 0.12,
  strongRhythmAmp: 0.2,
} as const;

export interface ComposerState {
  g: number;
  cEi: number;
  ouSigma: number;
  extSineAmp: number;
  extSineFreqHz: number;
  background: 'quiet' | 'spontaneous' | 'oscillatory';
  rtMinMs: number;
  rtMaxMs: number;
}

export type ComposerLocale = 'zh-CN' | 'en-US';

/**
 * Read-only one-line summary of the current parameter combination.
 * Describes ONLY the parameter combination — no disease names, no
 * clinical judgement. Example (zh): "高耦合 + 弱抑制 + 大噪声：
 * 网络容易整体翻进高活动态；反应时 320–440 ms。"
 */
export function summarizeCombination(s: ComposerState, locale: ComposerLocale): string {
  const traits: string[] = [];
  if (s.g >= SUMMARY_THRESHOLDS.highCouplingG) {
    traits.push(locale === 'zh-CN' ? '高耦合' : 'high coupling');
  }
  if (s.cEi <= SUMMARY_THRESHOLDS.weakInhibitionCEi) {
    traits.push(locale === 'zh-CN' ? '弱抑制' : 'weak inhibition');
  }
  if (s.ouSigma >= SUMMARY_THRESHOLDS.largeNoiseOuSigma) {
    traits.push(locale === 'zh-CN' ? '大噪声' : 'large noise');
  }
  if (s.background === 'oscillatory' && s.extSineAmp >= SUMMARY_THRESHOLDS.strongRhythmAmp) {
    traits.push(locale === 'zh-CN'
      ? `强节律驱动 ${s.extSineAmp.toFixed(2)} @ ${s.extSineFreqHz} Hz`
      : `strong rhythmic drive ${s.extSineAmp.toFixed(2)} @ ${s.extSineFreqHz} Hz`);
  }
  const verdict = traits.length >= 2
    ? (locale === 'zh-CN' ? '网络容易整体翻进高活动态' : 'the network easily flips into whole-network high activity')
    : traits.length === 1
      ? (locale === 'zh-CN' ? '网络比默认更容易同步' : 'the network synchronises more easily than the default')
      : (locale === 'zh-CN' ? '参数接近默认' : 'parameters near default');
  const rt = locale === 'zh-CN'
    ? `反应时 ${s.rtMinMs}–${s.rtMaxMs} ms`
    : `RT ${s.rtMinMs}–${s.rtMaxMs} ms`;
  if (locale === 'zh-CN') {
    if (traits.length === 0) return `${verdict}；${rt}。`;
    return `${traits.join(' + ')}：${verdict}；${rt}。`;
  }
  if (traits.length === 0) return `${verdict}; ${rt}.`;
  return `${traits.join(' + ')}: ${verdict}; ${rt}.`;
}

/** Short subject line for the head-node q chip (design §5.5 position 2). */
export function subjectSummaryLine(s: ComposerState, locale: ComposerLocale): string {
  const mode = s.background === 'quiet'
    ? (locale === 'zh-CN' ? '安静' : 'quiet')
    : s.background === 'spontaneous'
      ? (locale === 'zh-CN' ? '自发' : 'spontaneous')
      : (locale === 'zh-CN' ? '振荡' : 'oscillatory');
  if (locale === 'zh-CN') {
    return `被试：耦合 ${s.g.toFixed(2)} · 抑制 ${s.cEi.toFixed(1)} · ${mode} · 噪声 ${s.ouSigma.toFixed(2)} · RT ${s.rtMinMs}–${s.rtMaxMs} ms（模型参数组合）`;
  }
  return `Subject: coupling ${s.g.toFixed(2)} · inhibition ${s.cEi.toFixed(1)} · ${mode} · noise ${s.ouSigma.toFixed(2)} · RT ${s.rtMinMs}–${s.rtMaxMs} ms (model parameter combination)`;
}

/**
 * The four expressible "directions" (design §5.3). There is no epilepsy
 * knob in the model; each direction is a walk along a real A/B parameter.
 * The intro names the phenomenon once as an explanation; the directions
 * themselves describe parameters only.
 */
export interface EpilepsyDirection {
  id: 'coupling' | 'inhibition' | 'baseline' | 'rhythm';
  titleZh: string;
  titleEn: string;
  bodyZh: string;
  bodyEn: string;
}

export const EPILEPSY_DIRECTIONS: readonly EpilepsyDirection[] = [
  {
    id: 'coupling',
    titleZh: '方向一 · 耦合增强',
    titleEn: 'Direction 1 · Stronger coupling',
    bodyZh: 'A1 耦合强度 → 0.4。脑区互相招募，局部活动更容易扩成全网活动。',
    bodyEn: 'A1 coupling → 0.4. Regions recruit each other, so local activity spreads across the whole network more easily.',
  },
  {
    id: 'inhibition',
    titleZh: '方向二 · 抑制减弱',
    titleEn: 'Direction 2 · Weaker inhibition',
    bodyZh: 'A2 抑制强度 → 3。抑制兜不住，网络更容易翻进高活动态。注意：3 是硬边界，再低模型就失效，不是“更严重”。',
    bodyEn: 'A2 inhibition → 3. Inhibition stops holding the network back, so it flips into high activity more easily. Note: 3 is a hard boundary — lower is model failure, not "more severe".',
  },
  {
    id: 'baseline',
    titleZh: '方向三 · 基线抬高',
    titleEn: 'Direction 3 · Higher baseline',
    bodyZh: 'B2 背景噪声 ↑，背景活动 = 自发。自发基线离阈值更近，小刺激也可能激起大反应。',
    bodyEn: 'B2 background noise ↑, background = spontaneous. The spontaneous baseline sits closer to threshold, so even a small stimulus can trigger a large response.',
  },
  {
    id: 'rhythm',
    titleZh: '方向四 · 节律驱动增强',
    titleEn: 'Direction 4 · Stronger rhythmic drive',
    bodyZh: 'B3 振荡驱动幅度 ↑（背景活动 = 振荡）。外加节律把网络反复推向阈值。',
    bodyEn: 'B3 oscillatory drive ↑ (background = oscillatory). The external rhythm repeatedly pushes the network toward threshold.',
  },
];
