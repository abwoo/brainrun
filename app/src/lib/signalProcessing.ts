/**
 * PR6 — 信号处理核心（A1）。
 *
 * TS 实现；Python 对照在 `scientific/eeg/signal_reference.py`，数值对照
 * 容差见 `tests/pr6/signal-processing.test.mjs` 与
 * `tests/pr6/test_signal_processing.py`（均为舍入量级，不为通过而放宽）。
 *
 * 接口签名按 `docs/pr6-design.md` §1.2 写死（wave-2 的 B2/B3 按此写代码）；
 * 本文件只多出一个辅助导出 `dpssTapers`（供测试直接对照 scipy 的 DPSS，
 * 不属于 §1.2 契约）与一个本地 `EEG_BANDS` 常量（见下）。
 *
 * ── 量纲 ─────────────────────────────────────────────────────────────
 * 输入信号一律 µV；采样率 Hz；时间 ms；频率 Hz。
 * - Welch / multitaper PSD：µV²/Hz（密度，对频率积分 = 方差 µV²）。
 * - STFT / Morlet / multitaper TFR 功率：µV²（每频点均方功率；纯正弦
 *   幅值 A 在中心频率处功率 = A²/2，与 Welch 密度不同，不可混比）。
 * - ERSP：dB，10·log10(功率/基线功率)；ITC：无量纲 0–1。
 * - ERP 平均/SEM：µV；峰值 µV；潜伏期 ms。
 *
 * ── 约定 ─────────────────────────────────────────────────────────────
 * - FFT：正变换 e^(−2πi·…)，与 numpy `fft` 同号；`fftInPlace` 要求长度
 *   为 2 的幂（radix-2 原地算法），否则抛 RangeError。
 * - Hann 窗一律取**周期**形式 w[n] = 0.5 − 0.5·cos(2πn/N)（scipy
 *   `get_window('hann', N, fftbins=True)`），不是 numpy `hanning` 的
 *   对称形式（两者最大差约 0.0094，PSD 会差出 1e-4 量级，必须区分）。
 * - Welch / STFT / multitaper：每段不做去均值（scipy `detrend=False`），
 *   调用方如需去漂移请先高通或去均值；段尾不足一段的部分丢弃。
 * - STFT：scipy `signal.stft(boundary='zeros', padded=True)` 同款补零——
 *   信号左右各补 nFft/2 个零，末尾再补零凑整段数；帧中心覆盖整个记录
 *   （含两端）。两端半窗是零，功率在边缘被拉低，这是边界效应，不是 bug。
 * - Morlet：小波 ψ[n] = π^(−1/4)·σ_s^(−1/2)·exp(−n²/2σ_s²)·exp(i2πfn/fs)，
 *   σ_s = cycles·fs/(2πf)（单位：采样点），支撑截断在 ±3σ_s；卷积用 FFT
 *   实现，'same' 对齐（小波中心对准当前采样点）。功率标定因子
 *   K = 2/(C²·S1²)，C 为小波峰值归一化常数，S1 = Σexp(−n²/2σ_s²)；
 *   该标定使中心频率处纯正弦（幅值 A）的功率 = A²/2（实测 12.4989 vs
 *   12.5，残差来自负频泄漏，见 Python 对照测试）。
 *   注意：MNE `tfr_morlet` 的功率是本标定的 2·σ_s·√π 倍（MNE 小波
 *   ℓ² 范数为 √2 而非 1），两边数值对照时必须先除掉该因子，见
 *   `tests/pr6/test_signal_processing.py`。
 * - Multitaper：DPSS 锥由 Slepian–Pollak 三对角矩阵
 *   （对角 ((N−1−2n)/2)²·cos(2πW)，次对角 (n+1)(N−1−n)/2，W = NW/N）
 *   的特征向量求得，用隐式 QL（`tqli`，Numerical Recipes 同款）求解，
 *   按特征值从大到小取前 K 条；与 scipy `windows.dpss` 对照到 1e-13
 *   量级（符号不定，比较时允许逐条翻转）。锥按 (N, NW, K) 缓存。
 *   `multitaperPsd` 把记录切成约 1 s 的段（段长 = clamp(round(fs),64,1024)
 *   采样点，50% 重叠），逐段加锥平均——长记录不整体求 DPSS，避免
 *   O(N³) 特征求解失控；频率分辨率 df = fs/nextPow2(段长)。
 * - 频段：`EEG_BANDS` 的唯一定义在 `eegData.ts`（设计稿 §1.1），本模块
 *   从那里 import（delta 0.5–4、theta 4–8、alpha 8–13、beta 13–30、
 *   gamma 30–45 Hz）；不许另写一份，漂移由测试卡住。
 * - Epoch：事件时刻取最近采样点（不做亚采样插值，t=0 即该采样点，
 *   误差 ≤ dt/2，250 Hz 下 ≤ 2 ms）；基线校正减去基线窗内均值；
 *   峰峰值剔除在基线校正后做、任一通道超限即剔除（MNE 口径）；
 *   `kept` 与输入事件一一对应，`trials`/`events` 只含保留试次。
 * - 峰值 `peakInWindow`：取窗内绝对值最大的采样点（MNE
 *   `Evoked.get_peak(mode='abs')` 口径），返回带符号的峰值与潜伏期。
 *
 * ── 分辨率 ───────────────────────────────────────────────────────────
 * - Welch/STFT：频率分辨率 df = fs/nFft；时间分辨率（STFT）= hop/fs。
 * - Morlet：时间分辨率 σ_t = cycles/(2πf)，频率分辨率 ~ f/cycles；
 *   低频小波很长（5 Hz、cycles=5、fs=250 时 ±3σ 约 ±1.2 s），短 epoch
 *   两端会被零边界污染，只看中心段。
 * - multitaper TFR：每频率窗长 = 7/fs·(1/f) 个周期（MNE
 *   `tfr_multitaper` 同款），低频窗可能长于整个 epoch，此时窗 = 全段。
 */

import { EEG_BANDS } from './eegData.ts';
import type { EegRecording, EegEvent, EpochSet, EegBandName } from './eegData.ts';
export { EEG_BANDS } from './eegData.ts';
export type { EegBandName } from './eegData.ts';

/* ── 小工具 ─────────────────────────────────────────────────────────── */

function assertFiniteArray(x: readonly number[], name: string): void {
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i])) throw new RangeError(`${name}[${i}] is not finite`);
  }
}

function assertPositiveFinite(v: number, name: string): void {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${name} must be a finite positive number, got ${v}`);
}

/** 大于等于 v 的最小的 2 的幂（v ≥ 1）。 */
function nextPow2(v: number): number {
  let p = 1;
  while (p < v) p <<= 1;
  return p;
}

/** v 向下取整到 2 的幂（v ≥ 1 时 ≥ 1）。 */
function floorPow2(v: number): number {
  let p = 1;
  while (p * 2 <= v) p <<= 1;
  return p;
}

/** 周期 Hann 窗（scipy fftbins=True），长度 N。 */
function hannPeriodic(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** hypot 的防溢出写法（Numerical Recipes `pythag`）。 */
function pythag(a: number, b: number): number {
  const absa = Math.abs(a);
  const absb = Math.abs(b);
  if (absa > absb) return absa * Math.sqrt(1 + (absb / absa) ** 2);
  if (absb === 0) return 0;
  return absb * Math.sqrt(1 + (absa / absb) ** 2);
}

/* ── FFT ────────────────────────────────────────────────────────────── */

/**
 * Radix-2 原地 FFT（正变换，e^(−2πi·…)，与 numpy `fft` 同号）。
 * `re`/`im` 等长且长度为 2 的幂；长度 1 为 no-op；否则抛 RangeError。
 * 逆变换请用内部 `fftComplex(..., inverse=true)`（共轭技巧）。
 */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length) throw new RangeError(`fftInPlace: re/im length mismatch ${n} vs ${im.length}`);
  if (n === 0) throw new RangeError('fftInPlace: empty input');
  if ((n & (n - 1)) !== 0) throw new RangeError(`fftInPlace: length must be a power of two, got ${n}`);
  // 位反转重排。
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // 蝶形：每级用递推旋转因子。
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j];
        const ui = im[i + j];
        const vr = re[i + j + half] * cwr - im[i + j + half] * cwi;
        const vi = re[i + j + half] * cwi + im[i + j + half] * cwr;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const nwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = nwr;
      }
    }
  }
}

/** 对实信号做长度 nFft 的 FFT（零填充到 nFft），返回 re/im。 */
function fftOfReal(x: readonly number[], nFft: number): { re: Float64Array; im: Float64Array } {
  const re = new Float64Array(nFft);
  const im = new Float64Array(nFft);
  const m = Math.min(x.length, nFft);
  for (let i = 0; i < m; i++) re[i] = x[i];
  fftInPlace(re, im);
  return { re, im };
}

/** 复数 FFT（inverse=true 时为逆变换，含 1/N 缩放），原地。 */
function fftComplex(re: Float64Array, im: Float64Array, inverse: boolean): void {
  if (!inverse) {
    fftInPlace(re, im);
    return;
  }
  for (let i = 0; i < re.length; i++) im[i] = -im[i];
  fftInPlace(re, im);
  const n = re.length;
  for (let i = 0; i < n; i++) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

/**
 * 单边周期图功率（µV²/Hz 密度口径）：|X|²/(fs·Σw²)，DC 与 Nyquist
 * 不加倍，其余频点 ×2。`re`/`im` 为长度 nFft 的 FFT 结果。
 */
function oneSidedPsdDensity(
  re: Float64Array, im: Float64Array, nFft: number, sfreqHz: number, winEnergy: number,
): number[] {
  const kMax = nFft / 2;
  const psd = new Array<number>(kMax + 1);
  const scale = 1 / (sfreqHz * winEnergy);
  for (let k = 0; k <= kMax; k++) {
    const p = (re[k] * re[k] + im[k] * im[k]) * scale;
    psd[k] = k === 0 || k === kMax ? p : 2 * p;
  }
  return psd;
}

/** rfft 频率轴（Hz），长度 nFft/2+1。 */
function rfftFreqs(nFft: number, sfreqHz: number): number[] {
  const freqs: number[] = [];
  for (let k = 0; k <= nFft / 2; k++) freqs.push((k * sfreqHz) / nFft);
  return freqs;
}

/* ── Welch PSD ──────────────────────────────────────────────────────── */

/**
 * Welch PSD（µV²/Hz）。
 * Hann（周期）窗、50% 重叠（默认），段长 `nFft`（默认 256 采样点；
 * 非 2 的幂向下取整到 2 的幂；信号短于 nFft 时段长缩到信号内最大
 * 的 2 的幂，信号短于 8 点抛错）。每段不去均值。频率分辨率 df = fs/nFft。
 */
export function welchPsd(
  x: number[],
  sfreqHz: number,
  opts?: { nFft?: number; overlap?: number },
): { freqsHz: number[]; psd: number[] } {
  assertPositiveFinite(sfreqHz, 'sfreqHz');
  assertFiniteArray(x, 'x');
  if (x.length < 8) throw new RangeError(`welchPsd: signal too short (${x.length} samples)`);
  let nFft = floorPow2(opts?.nFft ?? 256);
  if (nFft < 8) nFft = 8;
  if (nFft > x.length) nFft = floorPow2(x.length);
  const overlap = opts?.overlap ?? 0.5;
  if (!Number.isFinite(overlap) || overlap < 0 || overlap >= 1) {
    throw new RangeError(`welchPsd: overlap must be in [0, 1), got ${overlap}`);
  }
  const step = Math.max(1, Math.round(nFft * (1 - overlap)));
  const win = hannPeriodic(nFft);
  let winEnergy = 0;
  for (let i = 0; i < nFft; i++) winEnergy += win[i] * win[i];
  const kMax = nFft / 2;
  const acc = new Float64Array(kMax + 1);
  let nSeg = 0;
  for (let start = 0; start + nFft <= x.length; start += step) {
    const seg = new Array<number>(nFft);
    for (let i = 0; i < nFft; i++) seg[i] = x[start + i] * win[i];
    const { re, im } = fftOfReal(seg, nFft);
    const p = oneSidedPsdDensity(re, im, nFft, sfreqHz, winEnergy);
    for (let k = 0; k <= kMax; k++) acc[k] += p[k];
    nSeg++;
  }
  if (nSeg === 0) throw new RangeError('welchPsd: no full segment (signal shorter than nFft)');
  const psd = Array.from(acc, (v) => v / nSeg);
  return { freqsHz: rfftFreqs(nFft, sfreqHz), psd };
}

/* ── 频段功率 ───────────────────────────────────────────────────────── */

/**
 * 频段功率（µV²）：对 PSD（µV²/Hz）按 §1.1 `EEG_BANDS` 在每个频段内
 * 做梯形积分。频段端点闭区间，相邻频段共用端点频点，积分时该点
 * 的功率会被两边各计一次（量级可忽略，见测试注释）。频段内不足
 * 2 个频点时退化为矩形（1 点）或 0（0 点）。
 */
export function bandPowers(
  freqsHz: number[],
  psd: number[],
): Record<EegBandName, number> {
  if (freqsHz.length !== psd.length) {
    throw new RangeError(`bandPowers: freqs/psd length mismatch ${freqsHz.length} vs ${psd.length}`);
  }
  if (freqsHz.length < 2) throw new RangeError('bandPowers: need at least 2 frequency points');
  assertFiniteArray(freqsHz, 'freqsHz');
  assertFiniteArray(psd, 'psd');
  for (let i = 1; i < freqsHz.length; i++) {
    if (!(freqsHz[i] > freqsHz[i - 1])) throw new RangeError('bandPowers: freqsHz must be strictly increasing');
  }
  for (let i = 0; i < psd.length; i++) {
    if (psd[i] < 0) throw new RangeError(`bandPowers: psd[${i}] is negative (${psd[i]})`);
  }
  const dfTyp = freqsHz[1] - freqsHz[0];
  const out = {} as Record<EegBandName, number>;
  for (const band of Object.keys(EEG_BANDS) as EegBandName[]) {
    const [lo, hi] = EEG_BANDS[band];
    const idx: number[] = [];
    for (let i = 0; i < freqsHz.length; i++) {
      if (freqsHz[i] >= lo && freqsHz[i] <= hi) idx.push(i);
    }
    if (idx.length === 0) {
      out[band] = 0;
    } else if (idx.length === 1) {
      out[band] = psd[idx[0]] * dfTyp;
    } else {
      let s = 0;
      for (let j = 0; j + 1 < idx.length; j++) {
        const a = idx[j];
        const b = idx[j + 1];
        s += 0.5 * (psd[a] + psd[b]) * (freqsHz[b] - freqsHz[a]);
      }
      out[band] = s;
    }
  }
  return out;
}

/* ── STFT ───────────────────────────────────────────────────────────── */

/**
 * STFT。返回每频点的均方功率（µV²，见文件头：纯正弦幅值 A 在中心
 * 频点处功率 = A²/2）与相位（rad，atan2，与 numpy/scipy 同号）。
 * `power`/`phase` 按 [频率][时间] 排列；`timesMs` 为帧中心时刻（ms，
 * 以信号起点为 0）。补零约定与 scipy `stft(boundary='zeros',
 * padded=True)` 相同（左右各补 nFft/2 个零，末尾补零凑整段数），
 * 两端帧的半个窗是零，边缘功率被拉低。默认 nFft=256、hop=nFft/2
 *（50% 重叠）；频率分辨率 df = fs/nFft，时间分辨率 = hop/fs。
 */
export function stft(
  x: number[],
  sfreqHz: number,
  opts?: { nFft?: number; hop?: number },
): { timesMs: number[]; freqsHz: number[]; power: number[][]; phase: number[][] } {
  assertPositiveFinite(sfreqHz, 'sfreqHz');
  assertFiniteArray(x, 'x');
  if (x.length < 8) throw new RangeError(`stft: signal too short (${x.length} samples)`);
  let nFft = floorPow2(opts?.nFft ?? 256);
  if (nFft < 8) nFft = 8;
  if (nFft > x.length) nFft = floorPow2(x.length);
  const hop = opts?.hop ?? nFft / 2;
  if (!Number.isInteger(hop) || hop < 1 || hop > nFft) {
    throw new RangeError(`stft: hop must be an integer in [1, nFft], got ${hop}`);
  }
  const win = hannPeriodic(nFft);
  let winSum = 0;
  for (let i = 0; i < nFft; i++) winSum += win[i];
  const winSum2 = winSum * winSum;
  const pad = nFft / 2;
  const nFrames = 1 + Math.ceil(x.length / hop);
  const paddedLen = nFft + (nFrames - 1) * hop;
  const xp = new Float64Array(paddedLen);
  for (let i = 0; i < x.length; i++) xp[pad + i] = x[i];
  const kMax = nFft / 2;
  const freqsHz = rfftFreqs(nFft, sfreqHz);
  const timesMs: number[] = [];
  const power: number[][] = [];
  const phase: number[][] = [];
  for (let k = 0; k <= kMax; k++) {
    power.push(new Array<number>(nFrames).fill(0));
    phase.push(new Array<number>(nFrames).fill(0));
  }
  for (let f = 0; f < nFrames; f++) {
    const start = f * hop;
    const seg = new Array<number>(nFft);
    for (let i = 0; i < nFft; i++) seg[i] = xp[start + i] * win[i];
    const { re, im } = fftOfReal(seg, nFft);
    for (let k = 0; k <= kMax; k++) {
      const mag2 = (re[k] * re[k] + im[k] * im[k]) / winSum2;
      power[k][f] = k === 0 || k === kMax ? mag2 : 2 * mag2;
      phase[k][f] = Math.atan2(im[k], re[k]);
    }
    timesMs.push((f * hop * 1000) / sfreqHz);
  }
  return { timesMs, freqsHz, power, phase };
}

/* ── Morlet 小波时频 ────────────────────────────────────────────────── */

/**
 * Morlet 小波时频（µV² 功率 + 相位 rad，按 [频率][时间] 排列；
 * `timesMs` 为逐采样点时刻，以信号起点为 0）。
 * 小波与功率标定见文件头；`cycles` 默认 5（σ_t = cycles/(2πf)，
 * 时间分辨率 ~ σ_t，频率分辨率 ~ f/cycles）。卷积在信号两端
 * 之外补零，±3σ_t 内的边缘帧会被边界污染，只看中心段。
 */
export function morletTfr(
  x: number[],
  sfreqHz: number,
  freqsHz: number[],
  opts?: { cycles?: number },
): { timesMs: number[]; power: number[][]; phase: number[][] } {
  assertPositiveFinite(sfreqHz, 'sfreqHz');
  assertFiniteArray(x, 'x');
  assertFiniteArray(freqsHz, 'freqsHz');
  if (x.length < 8) throw new RangeError(`morletTfr: signal too short (${x.length} samples)`);
  const cycles = opts?.cycles ?? 5;
  if (!Number.isFinite(cycles) || cycles <= 0) {
    throw new RangeError(`morletTfr: cycles must be positive, got ${cycles}`);
  }
  const n = x.length;
  const timesMs = Array.from({ length: n }, (_, i) => (i * 1000) / sfreqHz);
  const power: number[][] = [];
  const phase: number[][] = [];
  for (const f of freqsHz) {
    if (!(f > 0)) throw new RangeError(`morletTfr: frequencies must be positive, got ${f}`);
    if (f >= sfreqHz / 2) throw new RangeError(`morletTfr: frequency ${f} Hz at/above Nyquist ${sfreqHz / 2} Hz`);
    const sigmaS = (cycles * sfreqHz) / (2 * Math.PI * f);
    if (sigmaS < 1) {
      throw new RangeError(`morletTfr: wavelet under-resolved at ${f} Hz (sigma ${sigmaS.toFixed(2)} samples < 1)`);
    }
    const m = Math.ceil(3 * sigmaS);
    const lw = 2 * m + 1;
    const c = Math.PI ** -0.25 * sigmaS ** -0.5;
    let s1 = 0;
    for (let i = -m; i <= m; i++) s1 += Math.exp(-(i * i) / (2 * sigmaS * sigmaS));
    const kCal = 2 / (c * c * s1 * s1);
    // 小波 ψ[n]（n = −m..m），存为 re/im；卷积核 h = conj(ψ 反转)。
    const nFft = nextPow2(n + lw);
    const xr = new Float64Array(nFft);
    const xi = new Float64Array(nFft);
    for (let i = 0; i < n; i++) xr[i] = x[i];
    fftInPlace(xr, xi);
    const hr = new Float64Array(nFft);
    const hi = new Float64Array(nFft);
    for (let j = 0; j < lw; j++) {
      // h[j] = conj(ψ[m − j])：ψ 索引 n = m − j。
      const nn = m - j;
      const env = Math.exp(-(nn * nn) / (2 * sigmaS * sigmaS));
      const ph = (2 * Math.PI * f * nn) / sfreqHz;
      hr[j] = c * env * Math.cos(ph);
      hi[j] = -c * env * Math.sin(ph);
    }
    fftInPlace(hr, hi);
    const cr = new Float64Array(nFft);
    const ci = new Float64Array(nFft);
    for (let i = 0; i < nFft; i++) {
      cr[i] = xr[i] * hr[i] - xi[i] * hi[i];
      ci[i] = xr[i] * hi[i] + xi[i] * hr[i];
    }
    fftComplex(cr, ci, true);
    const pRow = new Array<number>(n);
    const phRow = new Array<number>(n);
    for (let t = 0; t < n; t++) {
      const yr = cr[m + t];
      const yi = ci[m + t];
      pRow[t] = (yr * yr + yi * yi) * kCal;
      phRow[t] = Math.atan2(yi, yr);
    }
    power.push(pRow);
    phase.push(phRow);
  }
  return { timesMs, power, phase };
}

/* ── DPSS 锥（Slepian 序列）────────────────────────────────────────── */

/**
 * 隐式 QL 算法（Numerical Recipes `tqli`）：求对称三对角矩阵的
 * 全部特征值与特征向量。`d` 为对角（出参为特征值，未排序），
 * `e[0..n-2]` 为次对角（会被改写），`z` 为 n×n 行主序矩阵
 * （初值为单位阵；出参的第 j 列是特征值 `d[j]` 的特征向量）。
 */
function tqli(d: Float64Array, e: Float64Array, z: Float64Array): void {
  const n = d.length;
  const eps = Number.EPSILON;
  for (let i = 1; i < n; i++) e[i - 1] = e[i];
  e[n - 1] = 0;
  for (let l = 0; l < n; l++) {
    let iter = 0;
    let m = l;
    do {
      for (m = l; m < n - 1; m++) {
        const dd = Math.abs(d[m]) + Math.abs(d[m + 1]);
        if (Math.abs(e[m]) <= eps * dd) break;
      }
      if (m !== l) {
        if (++iter === 30) throw new Error('tqli: too many iterations (DPSS eigensolve failed to converge)');
        let g = (d[l + 1] - d[l]) / (2 * e[l]);
        let r = pythag(g, 1);
        g = d[m] - d[l] + e[l] / (g + (g >= 0 ? Math.abs(r) : -Math.abs(r)));
        let s = 1;
        let c = 1;
        let p = 0;
        let i = l;
        for (i = m - 1; i >= l; i--) {
          const f = s * e[i];
          const b = c * e[i];
          e[i + 1] = r = pythag(f, g);
          if (r === 0) {
            d[i + 1] -= p;
            e[m] = 0;
            break;
          }
          s = f / r;
          c = g / r;
          g = d[i + 1] - p;
          r = (d[i] - g) * s + 2 * c * b;
          d[i + 1] = g + (p = s * r);
          g = c * r - b;
          for (let k = 0; k < n; k++) {
            const fz = z[k * n + i + 1];
            z[k * n + i + 1] = s * z[k * n + i] + c * fz;
            z[k * n + i] = c * z[k * n + i] - s * fz;
          }
        }
        if (r === 0 && i >= l) continue;
        d[l] -= p;
        e[l] = g;
        e[m] = 0;
      }
    } while (m !== l);
  }
}

const dpssCache = new Map<string, number[][]>();

/**
 * DPSS 锥（Slepian 序列），辅助导出（不属于 §1.2 契约，供测试直接
 * 对照 scipy `windows.dpss`）。
 * 返回 K 条长度 N 的锥，每条 ℓ² 范数为 1，相互正交；按谱集中度
 * 从高到低排列。符号约定：每条锥绝对值最大的元素取正（特征向量
 * 本身符号不定；功率计算不受符号影响，逐条比较时允许翻转）。
 * 要求 0 < NW < N/2，1 ≤ K ≤ min(2·NW−1, N)，K 为整数。
 * 复杂度 O(N³)（tqli 全特征向量），N ≤ 1024 时可接受，结果按
 * (N, NW, K) 缓存。
 */
export function dpssTapers(n: number, nw: number, k: number): number[][] {
  if (!Number.isInteger(n) || n < 8) throw new RangeError(`dpssTapers: n must be an integer >= 8, got ${n}`);
  if (!Number.isFinite(nw) || nw <= 0 || nw >= n / 2) {
    throw new RangeError(`dpssTapers: nw must satisfy 0 < nw < n/2, got nw=${nw}, n=${n}`);
  }
  if (!Number.isInteger(k) || k < 1 || k > Math.min(2 * nw - 1, n)) {
    throw new RangeError(`dpssTapers: k must be an integer in [1, min(2*nw-1, n)], got k=${k}, nw=${nw}`);
  }
  const key = `${n}:${nw}:${k}`;
  const hit = dpssCache.get(key);
  if (hit) return hit;
  const w = nw / n;
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const q = (n - 1 - 2 * i) / 2;
    d[i] = q * q * Math.cos(2 * Math.PI * w);
  }
  // 次对角用 Numerical Recipes 的约定：e[0] 不用，e[i]（i=1..n−1）为
  // 第 i−1 行与第 i 行之间的元素；i*(n−i)/2。tqli 开头会把 e 下移一位。
  e[0] = 0;
  for (let i = 1; i < n; i++) e[i] = (i * (n - i)) / 2;
  const z = new Float64Array(n * n);
  for (let i = 0; i < n; i++) z[i * n + i] = 1;
  tqli(d, e, z);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => d[b] - d[a]);
  const tapers: number[][] = [];
  for (let t = 0; t < k; t++) {
    const col = order[t];
    const taper = new Array<number>(n);
    let maxAbs = -1;
    let maxIdx = 0;
    for (let i = 0; i < n; i++) {
      taper[i] = z[i * n + col];
      if (Math.abs(taper[i]) > maxAbs) {
        maxAbs = Math.abs(taper[i]);
        maxIdx = i;
      }
    }
    if (taper[maxIdx] < 0) {
      for (let i = 0; i < n; i++) taper[i] = -taper[i];
    }
    tapers.push(taper);
  }
  dpssCache.set(key, tapers);
  return tapers;
}

/* ── Multitaper PSD ─────────────────────────────────────────────────── */

/**
 * Multitaper PSD（µV²/Hz，Thomson 口径：K 条锥的加锥周期图平均，
 * 锥为单位能量，单边加倍，与 Welch 同一密度标定）。
 * 默认 NW=4、K=2·NW−1=7。记录切成约 1 s 的段（段长 =
 * clamp(round(fs), 64, 1024) 采样点，50% 重叠）逐段平均；短于
 * 一段的记录用单段（锥长 = 记录长）。频率分辨率 df = fs/nextPow2(段长)。
 * 白噪声谱应平坦；纯正弦峰位与 Welch 一致、方差更小。
 */
export function multitaperPsd(
  x: number[],
  sfreqHz: number,
  opts?: { nw?: number; k?: number },
): { freqsHz: number[]; psd: number[] } {
  assertPositiveFinite(sfreqHz, 'sfreqHz');
  assertFiniteArray(x, 'x');
  if (x.length < 8) throw new RangeError(`multitaperPsd: signal too short (${x.length} samples)`);
  const nw = opts?.nw ?? 4;
  const k = opts?.k ?? Math.max(1, Math.floor(2 * nw - 1));
  const segLen = Math.min(Math.max(Math.round(sfreqHz), 64), 1024);
  const segLenEff = Math.min(segLen, x.length);
  if (!Number.isFinite(nw) || nw <= 0 || nw >= segLenEff / 2) {
    throw new RangeError(`multitaperPsd: nw must satisfy 0 < nw < segLen/2, got nw=${nw}, segLen=${segLenEff}`);
  }
  if (!Number.isInteger(k) || k < 1 || k > Math.min(2 * nw - 1, segLenEff)) {
    throw new RangeError(`multitaperPsd: k must be an integer in [1, min(2*nw-1, segLen)], got k=${k}, nw=${nw}`);
  }
  const nFft = nextPow2(segLenEff);
  const kMax = nFft / 2;
  const tapers = dpssTapers(segLenEff, nw, k);
  const taperEnergy: number[] = tapers.map((v) => v.reduce((s, a) => s + a * a, 0));
  const acc = new Float64Array(kMax + 1);
  let nSeg = 0;
  const step = Math.max(1, Math.floor(segLenEff / 2));
  if (x.length <= segLenEff) {
    // 单段。
    for (let t = 0; t < k; t++) {
      const seg = new Array<number>(nFft).fill(0);
      for (let i = 0; i < segLenEff; i++) seg[i] = x[i] * tapers[t][i];
      const { re, im } = fftOfReal(seg, nFft);
      const p = oneSidedPsdDensity(re, im, nFft, sfreqHz, taperEnergy[t]);
      for (let kk = 0; kk <= kMax; kk++) acc[kk] += p[kk];
    }
    nSeg = 1;
  } else {
    for (let start = 0; start + segLenEff <= x.length; start += step) {
      for (let t = 0; t < k; t++) {
        const seg = new Array<number>(nFft).fill(0);
        for (let i = 0; i < segLenEff; i++) seg[i] = x[start + i] * tapers[t][i];
        const { re, im } = fftOfReal(seg, nFft);
        const p = oneSidedPsdDensity(re, im, nFft, sfreqHz, taperEnergy[t]);
        for (let kk = 0; kk <= kMax; kk++) acc[kk] += p[kk];
      }
      nSeg++;
    }
  }
  const psd = Array.from(acc, (v) => v / (nSeg * k));
  return { freqsHz: rfftFreqs(nFft, sfreqHz), psd };
}

/* ── Epoch 切分 / 平均 / ERSP-ITC / 峰值 ─────────────────────────── */

/** 检查记录时间轴是否均匀（容差 1e-9 相对量级），返回 dt（ms）。 */
function recordingDtMs(rec: EegRecording): number {
  const t = rec.timesMs;
  if (t.length < 2) throw new RangeError('epochRecording: recording needs at least 2 samples');
  const dt = (t[t.length - 1] - t[0]) / (t.length - 1);
  if (!(dt > 0)) throw new RangeError('epochRecording: timesMs must be increasing');
  const tol = 1e-9 * Math.max(1, Math.abs(t[t.length - 1] - t[0]));
  for (let i = 1; i < t.length; i++) {
    if (Math.abs(t[i] - t[i - 1] - dt) > tol) {
      throw new RangeError('epochRecording: timesMs must be a uniform grid');
    }
  }
  return dt;
}

/**
 * MNE 口径 epoch 切分（µV）。
 * - 事件时刻取最近采样点（不插值，t=0 即该采样点，误差 ≤ dt/2）。
 * - epoch 采样时刻 = tminMs + j·dt（j=0..n−1），n = round((tmax−tmin)·fs/1000)+1。
 * - 基线校正：逐试次逐通道减去基线窗内均值；基线窗在 epoch 内无
 *   采样点时抛错。
 * - 峰峰值剔除（`rejectPeakToPeakUv` 给出时）：基线校正后任一通道
 *   峰峰值超限即剔除（MNE 口径；ds003061 约束值 150 µV）。
 * - 出界 epoch（事件太靠近记录首尾）直接记 kept=false，不抛错。
 * - `kept` 与输入事件一一对应；`trials`/`events` 只含保留试次。
 */
export function epochRecording(
  rec: EegRecording,
  events: EegEvent[],
  tminMs: number,
  tmaxMs: number,
  baselineMs: [number, number],
  rejectPeakToPeakUv?: number,
): EpochSet {
  assertPositiveFinite(rec.sfreqHz, 'rec.sfreqHz');
  if (!Number.isFinite(tminMs) || !Number.isFinite(tmaxMs) || tmaxMs <= tminMs) {
    throw new RangeError(`epochRecording: need tminMs < tmaxMs, got [${tminMs}, ${tmaxMs}]`);
  }
  if (baselineMs[0] > baselineMs[1]) {
    throw new RangeError(`epochRecording: baselineMs must satisfy lo <= hi, got [${baselineMs}]`);
  }
  if (rejectPeakToPeakUv !== undefined && (!Number.isFinite(rejectPeakToPeakUv) || rejectPeakToPeakUv <= 0)) {
    throw new RangeError(`epochRecording: rejectPeakToPeakUv must be positive, got ${rejectPeakToPeakUv}`);
  }
  const sfreqHz = rec.sfreqHz;
  const dtMs = recordingDtMs(rec);
  const dtMsExpected = 1000 / sfreqHz;
  if (Math.abs(dtMs - dtMsExpected) > 1e-6 * dtMsExpected) {
    throw new RangeError(
      `epochRecording: timesMs spacing ${dtMs} ms disagrees with sfreqHz ${sfreqHz} Hz (dt ${dtMsExpected} ms)`,
    );
  }
  const nT = Math.round(((tmaxMs - tminMs) * sfreqHz) / 1000) + 1;
  if (nT < 1) throw new RangeError('epochRecording: epoch has no samples');
  const timesMs = Array.from({ length: nT }, (_, j) => tminMs + j * dtMsExpected);
  const baseIdx: number[] = [];
  for (let j = 0; j < nT; j++) {
    if (timesMs[j] >= baselineMs[0] - 1e-9 && timesMs[j] <= baselineMs[1] + 1e-9) baseIdx.push(j);
  }
  if (baseIdx.length === 0) {
    throw new RangeError(`epochRecording: baseline window [${baselineMs}] has no samples in the epoch`);
  }
  const nCh = rec.channels.length;
  if (nCh === 0) throw new RangeError('epochRecording: recording has no channels');
  if (rec.dataUv.length !== nCh) throw new RangeError('epochRecording: dataUv/channel count mismatch');
  const nSamples = rec.timesMs.length;
  const t0 = rec.timesMs[0];
  const kept: boolean[] = [];
  const trials: number[][][] = [];
  const keptEvents: EegEvent[] = [];
  const i0Offset = Math.round((tminMs * sfreqHz) / 1000);
  for (const ev of events) {
    let iEv = Math.round(((ev.tMs - t0) * sfreqHz) / 1000);
    iEv = Math.max(0, Math.min(nSamples - 1, iEv));
    const i0 = iEv + i0Offset;
    const i1 = i0 + nT - 1;
    if (i0 < 0 || i1 >= nSamples) {
      kept.push(false);
      continue;
    }
    const trial: number[][] = [];
    let reject = false;
    for (let c = 0; c < nCh; c++) {
      const row = rec.dataUv[c];
      const ep = new Array<number>(nT);
      let baseSum = 0;
      for (let j = 0; j < nT; j++) ep[j] = row[i0 + j];
      for (const j of baseIdx) baseSum += ep[j];
      const baseMean = baseSum / baseIdx.length;
      let mn = Infinity;
      let mx = -Infinity;
      for (let j = 0; j < nT; j++) {
        ep[j] -= baseMean;
        if (ep[j] < mn) mn = ep[j];
        if (ep[j] > mx) mx = ep[j];
      }
      if (rejectPeakToPeakUv !== undefined && mx - mn > rejectPeakToPeakUv) reject = true;
      trial.push(ep);
    }
    if (reject) {
      kept.push(false);
      continue;
    }
    kept.push(true);
    trials.push(trial);
    keptEvents.push(ev);
  }
  return {
    tminMs,
    tmaxMs,
    baselineMs: [baselineMs[0], baselineMs[1]],
    timesMs,
    trials,
    kept,
    events: keptEvents,
    sfreqHz,
    channels: rec.channels.map((c) => c.label),
  };
}

/**
 * 叠加平均（µV）：逐通道逐采样点求均值与标准误 SEM = s/√n
 *（s 为样本标准差，ddof=1）。n=1 时 SEM 无定义，记 0（已注明，
 * 不是估计为 0）。n=0 抛错。
 */
export function averageEpochs(epochs: EpochSet): {
  timesMs: number[];
  meanUv: number[][];
  semUv: number[][];
  n: number;
} {
  const n = epochs.trials.length;
  if (n === 0) throw new RangeError('averageEpochs: no trials');
  const nCh = epochs.trials[0].length;
  const nT = epochs.trials[0][0].length;
  const meanUv: number[][] = [];
  const semUv: number[][] = [];
  for (let c = 0; c < nCh; c++) {
    const mRow = new Array<number>(nT).fill(0);
    const sRow = new Array<number>(nT).fill(0);
    for (let j = 0; j < nT; j++) {
      let s = 0;
      for (let t = 0; t < n; t++) s += epochs.trials[t][c][j];
      const m = s / n;
      mRow[j] = m;
      if (n > 1) {
        let ss = 0;
        for (let t = 0; t < n; t++) {
          const d = epochs.trials[t][c][j] - m;
          ss += d * d;
        }
        sRow[j] = Math.sqrt(ss / (n - 1)) / Math.sqrt(n);
      }
    }
    meanUv.push(mRow);
    semUv.push(sRow);
  }
  return { timesMs: [...epochs.timesMs], meanUv, semUv, n };
}

/** 滑动窗 multitaper 时频（内部用）：每频率窗长 = 7 个周期（MNE `tfr_multitaper` 同款）。 */
function multitaperTfr(
  x: number[],
  sfreqHz: number,
  freqsHz: number[],
): { timesMs: number[]; power: number[][]; phase: number[][] } {
  const n = x.length;
  const nw = 4;
  const k = 7;
  const timesMs = Array.from({ length: n }, (_, i) => (i * 1000) / sfreqHz);
  const power: number[][] = [];
  const phase: number[][] = [];
  for (const f of freqsHz) {
    if (!(f > 0)) throw new RangeError(`erspItc/multitaper: frequencies must be positive, got ${f}`);
    if (f >= sfreqHz / 2) throw new RangeError(`erspItc/multitaper: frequency ${f} Hz at/above Nyquist`);
    let len = Math.round((7 * sfreqHz) / f);
    len = Math.max(16, Math.min(len, n));
    const tapers = dpssTapers(len, nw, k);
    // 正弦标定：power = mean_k|Y_k|² · 2/mean_k(S_k²)，S_k = Σv_k，
    // 使中心频率处纯正弦（幅值 A）的功率 = A²/2（与 Morlet 同口径）。
    let meanS2 = 0;
    for (const v of tapers) {
      const s = v.reduce((a, b) => a + b, 0);
      meanS2 += s * s;
    }
    meanS2 /= k;
    const kCal = 2 / meanS2;
    const nFft = nextPow2(len);
    const bin = Math.min(Math.round((f * nFft) / sfreqHz), nFft / 2);
    const half = Math.floor(len / 2);
    const pRow = new Array<number>(n);
    const phRow = new Array<number>(n);
    for (let t = 0; t < n; t++) {
      // 以 t 为中心的窗，窗外补零。
      let acc = 0;
      let yr0 = 0;
      let yi0 = 0;
      for (let ti = 0; ti < k; ti++) {
        const v = tapers[ti];
        let yr = 0;
        let yi = 0;
        for (let i = 0; i < len; i++) {
          const idx = t - half + i;
          const xv = idx >= 0 && idx < n ? x[idx] : 0;
          const ang = (-2 * Math.PI * bin * i) / nFft;
          const wv = xv * v[i];
          yr += wv * Math.cos(ang);
          yi += wv * Math.sin(ang);
        }
        acc += yr * yr + yi * yi;
        if (ti === 0) {
          yr0 = yr;
          yi0 = yi;
        }
      }
      pRow[t] = (acc / k) * kCal;
      // ITC 相位取首条锥（集中度最高）的系数相位；窄带信号各锥相位近同。
      phRow[t] = Math.atan2(yi0, yr0);
    }
    power.push(pRow);
    phase.push(phRow);
  }
  return { timesMs, power, phase };
}

/**
 * ERSP（dB）与 ITC（无量纲 0–1），单通道，按 [频率][时间] 排列。
 * - 方法 `stft`/`morlet` 复用同名函数；`multitaper` 为滑动窗
 *   multitaper（窗长 = 7 个周期，见 `multitaperTfr`）。三种方法
 *   的功率口径同为 µV²，但窗长与泄漏特性不同，**结果不直接混比**，
 *   必须注明方法与参数（设计稿 PR-10）。
 * - ERSP = 10·log10(试次平均功率 / 基线平均功率)，基线为
 *   `baselineMs` 窗内试次平均功率的时间均值（逐频率）。基线窗在
 *   TFR 时间轴上无采样点、或基线功率为 0 时抛错。
 * - ITC = |试次平均 e^(iφ)|，φ 为各试次的 TFR 相位。
 * - `timesMs` 为 TFR 时间轴（stft 为帧中心，morlet/multitaper 为
 *   逐采样点），以 epoch 起点（tminMs）为基准的相对时刻。
 */
export function erspItc(
  epochs: EpochSet,
  channel: string,
  freqsHz: number[],
  method: 'stft' | 'morlet' | 'multitaper',
  baselineMs: [number, number],
): { erspDb: number[][]; itc: number[][]; timesMs: number[] } {
  const chIdx = epochs.channels.indexOf(channel);
  if (chIdx < 0) throw new RangeError(`erspItc: channel ${channel} not in EpochSet`);
  if (epochs.trials.length === 0) throw new RangeError('erspItc: no trials');
  assertFiniteArray(freqsHz, 'freqsHz');
  if (freqsHz.length === 0) throw new RangeError('erspItc: empty freqsHz');
  if (baselineMs[0] > baselineMs[1]) {
    throw new RangeError(`erspItc: baselineMs must satisfy lo <= hi, got [${baselineMs}]`);
  }
  const sfreqHz = epochs.sfreqHz;
  const t0 = epochs.timesMs[0];
  const nF = freqsHz.length;
  // 各试次的 TFR（功率 µV²、相位 rad），先求试次平均功率与 ITC。
  let tfrTimes: number[] = [];
  const sumPower: number[][] = [];
  const sumRe: number[][] = [];
  const sumIm: number[][] = [];
  for (let f = 0; f < nF; f++) {
    sumPower.push([]);
    sumRe.push([]);
    sumIm.push([]);
  }
  const nTrials = epochs.trials.length;
  for (let t = 0; t < nTrials; t++) {
    const x = epochs.trials[t][chIdx];
    let tfr: { timesMs: number[]; power: number[][]; phase: number[][] };
    let stftNFft = 0;
    if (method === 'stft') {
      stftNFft = Math.min(256, floorPow2(Math.max(8, x.length)));
      tfr = stft(x, sfreqHz, { nFft: stftNFft, hop: Math.max(1, Math.floor(stftNFft / 2)) });
    } else if (method === 'morlet') {
      tfr = morletTfr(x, sfreqHz, freqsHz, { cycles: 5 });
    } else {
      tfr = multitaperTfr(x, sfreqHz, freqsHz);
    }
    if (t === 0) {
      tfrTimes = tfr.timesMs.map((v) => v + t0);
      for (let f = 0; f < nF; f++) {
        sumPower[f] = new Array<number>(tfrTimes.length).fill(0);
        sumRe[f] = new Array<number>(tfrTimes.length).fill(0);
        sumIm[f] = new Array<number>(tfrTimes.length).fill(0);
      }
    }
    // STFT 返回全部 FFT 频点，需按下式把请求的频率映射到最近频点；
    // morlet/multitaper 直接返回请求的频率，行号即频率序号。
    for (let f = 0; f < nF; f++) {
      const row =
        method === 'stft'
          ? Math.min(Math.round((freqsHz[f] * stftNFft) / sfreqHz), stftNFft / 2)
          : f;
      for (let j = 0; j < tfrTimes.length; j++) {
        sumPower[f][j] += tfr.power[row][j];
        sumRe[f][j] += Math.cos(tfr.phase[row][j]);
        sumIm[f][j] += Math.sin(tfr.phase[row][j]);
      }
    }
  }
  const baseIdx: number[] = [];
  for (let j = 0; j < tfrTimes.length; j++) {
    if (tfrTimes[j] >= baselineMs[0] - 1e-9 && tfrTimes[j] <= baselineMs[1] + 1e-9) baseIdx.push(j);
  }
  if (baseIdx.length === 0) {
    throw new RangeError(`erspItc: baseline window [${baselineMs}] has no samples on the TFR time axis`);
  }
  const erspDb: number[][] = [];
  const itc: number[][] = [];
  for (let f = 0; f < nF; f++) {
    const avgP = sumPower[f].map((v) => v / nTrials);
    let base = 0;
    for (const j of baseIdx) base += avgP[j];
    base /= baseIdx.length;
    if (!(base > 0)) throw new RangeError(`erspItc: baseline power is ${base} at ${freqsHz[f]} Hz`);
    const eRow = avgP.map((v) => 10 * Math.log10(v / base));
    const iRow = sumRe[f].map((re, j) => Math.hypot(re, sumIm[f][j]) / nTrials);
    erspDb.push(eRow);
    itc.push(iRow);
  }
  return { erspDb, itc, timesMs: tfrTimes };
}

/**
 * 窗内峰值（MNE `get_peak(mode='abs')` 口径）：取窗内 |值| 最大的
 * 采样点，返回带符号的峰值 `peakUv`、潜伏期 `latencyMs` 与窗内均值
 * `windowMeanUv`。窗内无采样点时抛错。典型用法：P300 窗 250–600 ms
 *（峰值）与 300–500 ms（窗均值），见 ds003061 约束值。
 */
export function peakInWindow(
  timesMs: number[],
  values: number[],
  winMs: [number, number],
): { peakUv: number; latencyMs: number; windowMeanUv: number } {
  if (timesMs.length !== values.length) {
    throw new RangeError(`peakInWindow: times/values length mismatch ${timesMs.length} vs ${values.length}`);
  }
  if (timesMs.length === 0) throw new RangeError('peakInWindow: empty input');
  assertFiniteArray(timesMs, 'timesMs');
  assertFiniteArray(values, 'values');
  if (winMs[0] > winMs[1]) throw new RangeError(`peakInWindow: window must satisfy lo <= hi, got [${winMs}]`);
  let peakAbs = -1;
  let peakUv = 0;
  let latencyMs = 0;
  let sum = 0;
  let cnt = 0;
  for (let i = 0; i < timesMs.length; i++) {
    if (timesMs[i] >= winMs[0] - 1e-9 && timesMs[i] <= winMs[1] + 1e-9) {
      sum += values[i];
      cnt++;
      if (Math.abs(values[i]) > peakAbs) {
        peakAbs = Math.abs(values[i]);
        peakUv = values[i];
        latencyMs = timesMs[i];
      }
    }
  }
  if (cnt === 0) throw new RangeError(`peakInWindow: window [${winMs}] has no samples`);
  return { peakUv, latencyMs, windowMeanUv: sum / cnt };
}
