/**
 * PR6 — 源定位：偶极子拟合 + MNE 最小范数逆解（B3，PR-12）。
 *
 * 正向模型：PR5 的 MNE 四层球形头 lead-field（`SphereFixture`，
 * 64 点源网格，轴 [−48, −16, 16, 48] mm；网格间三线性插值是正向
 * 模型本身的已有行为）。两种逆解都只用 lead-field + 测得的电位，
 * **真值标签绝不进逆解函数**——真值只在事后 `evaluate*` 里用来
 * 算定位误差（盲测，见 `blindTest`）。
 *
 * 方法：
 * - 偶极子拟合：对 64 个网格点逐个做最小二乘拟合（3 分量偶极矩），
 *   取残差 RMS 最小者。单偶极子模型正确时（无噪声、源在网格点上）
 *   应精确恢复；残差 RMS 是“单偶极子模型是否够用”的判据。
 * - MNE 逆解：最小范数解 s = Lᵀ(LLᵀ + λ²σ²I)⁻¹V，源先验 R = I
 *  （**无深度加权**——这是 MNE 默认 depth=0.8 之外的选择，见下），
 *   噪声协方差 C = σ²I（σ = `noiseRmsUv`，默认 1.0 µV），
 *   λ² 默认 1/9（MNE 默认 SNR = 3，即 λ² = 1/SNR²）。
 *   峰值位置 = 各网格点 |s| 最大者；分布范围 spread = 以 |s|² 为
 *   权重的、到峰值点的 RMS 距离。
 *
 * 诚实说明（实测结论，见 `docs/pr6-topo-inverse.md`）：无深度加权
 * 的 MNE 在这张 64 点粗网格上是**差的峰值定位器**——深部/切向源
 * 的峰值误差可达 32–64 mm（无噪声）乃至 ~100 mm（0.5 µV 噪声），
 * 只有表浅径向源能准确定位。这是最小范数估计的深度偏置（表浅源
 * 的 lead-field 列模大，解被拉向表面），不是正向模型的错（偶极
 * 子拟合在同一数据上无噪声时误差 0.0 mm）。深度加权 / dSPM /
 * eLORETA 不在本批做，列为残留项。
 *
 * 参考变换：lead-field 的列与数据用**同一**参考（默认 average）；
 * average 参考对 lead-field 列做“减该列在所选导联上的均值”，与
 * `sphereElectrodePotentials` 的数据变换同口径。不一致的参考会
 * 让逆解系统性地错——测试里有断言卡住。
 *
 * 单位：位置 mm、偶极矩 nA·m、电位 µV、λ² 无量纲、σ µV。
 *
 * Python 对照：`scientific/eeg/inverse_reference.py`（numpy 同公式
 * 实现 + MNE `make_inverse_operator`/`apply_inverse` 峰值交叉验证）。
 */

import type { DipoleFitResult, MneInverseResult } from './eegData.ts';
import type { Vec3Mm } from './volumeConduction.ts';
import {
  sphereElectrodePotentials,
  validateSphereFixture,
  type MontageKey,
  type SphereFixture,
  type SphereReference,
} from './sphereForward.ts';

/** MNE 正则化 λ² 默认值 1/9（MNE 默认 SNR = 3，λ² = 1/SNR²）。 */
export const MNE_LAMBDA2_DEFAULT = 1 / 9;
/** 噪声 RMS σ 默认值 1.0 µV（噪声协方差 C = σ²I 的 σ）。 */
export const MNE_NOISE_RMS_UV_DEFAULT = 1.0;

export interface LeadField {
  /** 所选导联标签（与 gain 行一一对应）。 */
  labels: string[];
  /** 64 个源网格点位置，mm（轴 [−48, −16, 16, 48]，x 快变→z 慢变与 fixture 一致）。 */
  sourcePositionsMm: Vec3Mm[];
  /** [传感器][192]，列布局：网格点 × 3（x/y/z 分量），µV/(nA·m)，已按参考变换。 */
  gain: number[][];
  montage: MontageKey;
  reference: SphereReference;
}

function asVec3(v: readonly number[]): Vec3Mm {
  return [v[0], v[1], v[2]];
}

function assertFiniteVec(v: readonly number[], name: string): void {
  if (v.length !== 3 || !v.every(Number.isFinite)) {
    throw new RangeError(`${name} must contain three finite numbers, got [${v}]`);
  }
}

/** 解稠密线性方程组 A·x = b（部分主元高斯消元；不改输入）。 */
export function solveLinearSystem(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  if (aIn.length !== n || aIn.some((row) => row.length !== n)) {
    throw new RangeError(`solveLinearSystem: A must be ${n}x${n}`);
  }
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let piv = col;
    let pivAbs = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r][col]);
      if (v > pivAbs) {
        pivAbs = v;
        piv = r;
      }
    }
    if (pivAbs === 0) throw new Error('solveLinearSystem: singular matrix');
    if (piv !== col) {
      [a[col], a[piv]] = [a[piv], a[col]];
      [b[col], b[piv]] = [b[piv], b[col]];
    }
    for (let r = col + 1; r < n; r++) {
      const f = a[r][col] / a[col][col];
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r][c] -= f * a[col][c];
      b[r] -= f * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let c = r + 1; c < n; c++) s -= a[r][c] * x[c];
    x[r] = s / a[r][r];
  }
  return x;
}

/** mulberry32 确定性 RNG（种子复现用，与 B1 的噪声种子口径同类）。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 确定性高斯噪声（Box–Muller，µV；种子固定则逐点复现）。 */
export function gaussianNoise(n: number, rmsUv: number, seed: number): number[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`gaussianNoise: n must be a non-negative integer, got ${n}`);
  if (!(rmsUv >= 0)) throw new RangeError(`gaussianNoise: rmsUv must be >= 0, got ${rmsUv}`);
  const rand = mulberry32(seed);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * u2;
    out[i] = rmsUv * r * Math.cos(th);
    if (i + 1 < n) out[i + 1] = rmsUv * r * Math.sin(th);
  }
  return out;
}

/**
 * 从 fixture 建 lead-field（[传感器][192]）。
 * 网格点就是 fixture 的源网格（64 点），增益直接取 fixture 的列，
 * 不做额外插值。参考变换按列做（与数据侧同口径）：
 * average 减列均值、electrode 减参考电极行、infinity 不变。
 */
export function buildLeadField(
  fixture: SphereFixture,
  montage: MontageKey,
  reference: SphereReference = { mode: 'average' },
): LeadField {
  validateSphereFixture(fixture);
  const labels = fixture.montages[montage];
  if (!labels) throw new Error(`Unknown montage: ${montage}`);
  const index = new Map(fixture.sensors.map((s, i) => [s.label, i]));
  const rows: number[][] = [];
  for (const label of labels) {
    const i = index.get(label);
    if (i === undefined) throw new Error(`Montage sensor not in lead field: ${label}`);
    rows.push([...fixture.gain_uv_per_nAm[i]]);
  }
  const nCol = rows[0].length;
  if (reference.mode === 'average') {
    for (let j = 0; j < nCol; j++) {
      let mean = 0;
      for (let i = 0; i < rows.length; i++) mean += rows[i][j];
      mean /= rows.length;
      for (let i = 0; i < rows.length; i++) rows[i][j] -= mean;
    }
  } else if (reference.mode === 'electrode') {
    const refRow = rows[labels.indexOf(reference.label)];
    if (!refRow) throw new RangeError(`Reference electrode ${reference.label} not in montage ${montage}`);
    for (let i = 0; i < rows.length; i++) {
      for (let j = 0; j < nCol; j++) rows[i][j] -= refRow[j];
    }
  } else if (reference.mode !== 'infinity') {
    throw new Error('Unsupported reference');
  }
  const axis = fixture.source_grid_axis_mm;
  const sourcePositionsMm: Vec3Mm[] = [];
  for (const x of axis) {
    for (const y of axis) {
      for (const z of axis) sourcePositionsMm.push([x, y, z]);
    }
  }
  if (sourcePositionsMm.length * 3 !== nCol) {
    throw new Error(`Lead field column count ${nCol} != 3 * ${sourcePositionsMm.length} grid points`);
  }
  return { labels: [...labels], sourcePositionsMm, gain: rows, montage, reference };
}

/** 两点间欧氏距离，mm。 */
export function localizationErrorMm(a: Vec3Mm, b: Vec3Mm): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/* ── 偶极子拟合 ─────────────────────────────────────────────────────── */

export interface DipoleFitEstimate {
  estimatedPositionMm: Vec3Mm;
  estimatedMomentNAm: Vec3Mm;
  /** 最优网格点的残差 RMS，µV（单偶极子模型够不够用的判据）。 */
  residualRmsUv: number;
  gridIndex: number;
  /** 64 个网格点各自的残差 RMS，µV（诊断用：第二优者是否接近）。 */
  residualRmsByGrid: number[];
}

function checkData(leadField: LeadField, dataUv: number[]): void {
  if (dataUv.length !== leadField.labels.length) {
    throw new RangeError(
      `data length ${dataUv.length} != lead field channel count ${leadField.labels.length}`,
    );
  }
  if (!dataUv.every(Number.isFinite)) throw new RangeError('dataUv contains non-finite values');
  if (dataUv.length < 3) throw new RangeError('dipole fit needs at least 3 channels');
}

/**
 * 偶极子拟合：64 个网格点逐个最小二乘（3 分量矩），取残差 RMS 最小者。
 * 只读 lead-field + 数据；真值不进本函数。
 * 法方程加相对脊 1e-12·trace/3 防奇异（网格点间 lead-field 列近乎
 * 共线时，法方程本身病态；脊只保数值稳定，不改变最优点的选择）。
 */
export function dipoleFit(leadField: LeadField, dataUv: number[]): DipoleFitEstimate {
  checkData(leadField, dataUv);
  const nCh = dataUv.length;
  const nSrc = leadField.sourcePositionsMm.length;
  let best: DipoleFitEstimate | null = null;
  const residualRmsByGrid = new Array<number>(nSrc).fill(0);
  for (let s = 0; s < nSrc; s++) {
    // A = L[:, 3s:3s+3]；法方程 M = AᵀA（3×3），rhs = AᵀV。
    const m = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const rhs = [0, 0, 0];
    for (let i = 0; i < nCh; i++) {
      const row = leadField.gain[i];
      const a0 = row[3 * s];
      const a1 = row[3 * s + 1];
      const a2 = row[3 * s + 2];
      const v = dataUv[i];
      m[0][0] += a0 * a0;
      m[0][1] += a0 * a1;
      m[0][2] += a0 * a2;
      m[1][1] += a1 * a1;
      m[1][2] += a1 * a2;
      m[2][2] += a2 * a2;
      rhs[0] += a0 * v;
      rhs[1] += a1 * v;
      rhs[2] += a2 * v;
    }
    m[1][0] = m[0][1];
    m[2][0] = m[0][2];
    m[2][1] = m[1][2];
    const trace = m[0][0] + m[1][1] + m[2][2];
    const ridge = 1e-12 * (trace / 3);
    m[0][0] += ridge;
    m[1][1] += ridge;
    m[2][2] += ridge;
    const q = solveLinearSystem(m, rhs);
    let ss = 0;
    for (let i = 0; i < nCh; i++) {
      const row = leadField.gain[i];
      const pred = row[3 * s] * q[0] + row[3 * s + 1] * q[1] + row[3 * s + 2] * q[2];
      const r = dataUv[i] - pred;
      ss += r * r;
    }
    const rms = Math.sqrt(ss / nCh);
    residualRmsByGrid[s] = rms;
    if (best === null || rms < best.residualRmsUv) {
      best = {
        estimatedPositionMm: leadField.sourcePositionsMm[s],
        estimatedMomentNAm: asVec3(q),
        residualRmsUv: rms,
        gridIndex: s,
        residualRmsByGrid,
      };
    }
  }
  // best 持有 residualRmsByGrid 的引用：循环结束时数组已填满 64 项。
  return best as DipoleFitEstimate;
}

/* ── MNE 最小范数逆解 ───────────────────────────────────────────────── */

export interface MneInverseEstimate {
  /** 估计分布峰值位置（各网格点 |s| 最大者），mm。 */
  estimatedPositionMm: Vec3Mm;
  /** 峰值 |s|，nA·m（注意：最小范数解的幅度被正则化压缩，不是真值幅度）。 */
  peakValue: number;
  /** 分布范围：以 |s|² 为权重的、到峰值点的 RMS 距离，mm。 */
  spreadMm: number;
  lambda2: number;
  noiseRmsUv: number;
  method: 'MNE';
  /** 各网格点的 |s|，nA·m（64 项，诊断/作图用）。 */
  sourceNorms: number[];
  /** 各网格点的 3 分量矩（64×3，nA·m）。 */
  sourceMoments: Vec3Mm[];
  gridIndex: number;
}

/**
 * MNE 逆解：s = Lᵀ(LLᵀ + λ²σ²I)⁻¹V，R = I（无深度加权），C = σ²I。
 * 只读 lead-field + 数据；真值不进本函数。λ² 与 σ 均可调，默认值
 * 见文件头（λ² = 1/9，σ = 1.0 µV）。
 */
export function mneInverse(
  leadField: LeadField,
  dataUv: number[],
  opts?: { lambda2?: number; noiseRmsUv?: number },
): MneInverseEstimate {
  checkData(leadField, dataUv);
  const lambda2 = opts?.lambda2 ?? MNE_LAMBDA2_DEFAULT;
  const noiseRmsUv = opts?.noiseRmsUv ?? MNE_NOISE_RMS_UV_DEFAULT;
  if (!(lambda2 > 0)) throw new RangeError(`mneInverse: lambda2 must be > 0, got ${lambda2}`);
  if (!(noiseRmsUv > 0)) throw new RangeError(`mneInverse: noiseRmsUv must be > 0, got ${noiseRmsUv}`);
  const nCh = dataUv.length;
  const nSrc = leadField.sourcePositionsMm.length;
  const L = leadField.gain;
  // A = L·Lᵀ + λ²σ²I（n×n），解 A·y = V，再 s = Lᵀy。
  const reg = lambda2 * noiseRmsUv * noiseRmsUv;
  const a: number[][] = [];
  for (let i = 0; i < nCh; i++) {
    const row = new Array<number>(nCh).fill(0);
    for (let j = 0; j < nCh; j++) {
      let s = 0;
      for (let k = 0; k < 3 * nSrc; k++) s += L[i][k] * L[j][k];
      row[j] = s + (i === j ? reg : 0);
    }
    a.push(row);
  }
  const y = solveLinearSystem(a, [...dataUv]);
  const sourceMoments: Vec3Mm[] = [];
  const sourceNorms = new Array<number>(nSrc).fill(0);
  let peakIdx = 0;
  let peakVal = -1;
  for (let s = 0; s < nSrc; s++) {
    const q: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let i = 0; i < nCh; i++) v += L[i][3 * s + c] * y[i];
      q[c] = v;
    }
    const nrm = Math.hypot(q[0], q[1], q[2]);
    sourceMoments.push([q[0], q[1], q[2]]);
    sourceNorms[s] = nrm;
    if (nrm > peakVal) {
      peakVal = nrm;
      peakIdx = s;
    }
  }
  const peakPos = leadField.sourcePositionsMm[peakIdx];
  let wSum = 0;
  let wDist2 = 0;
  for (let s = 0; s < nSrc; s++) {
    const w = sourceNorms[s] * sourceNorms[s];
    wSum += w;
    const d = localizationErrorMm(leadField.sourcePositionsMm[s], peakPos);
    wDist2 += w * d * d;
  }
  const spreadMm = wSum > 0 ? Math.sqrt(wDist2 / wSum) : 0;
  return {
    estimatedPositionMm: peakPos,
    peakValue: peakVal,
    spreadMm,
    lambda2,
    noiseRmsUv,
    method: 'MNE',
    sourceNorms,
    sourceMoments,
    gridIndex: peakIdx,
  };
}

/* ── 事后评估（真值只在这里出现）────────────────────────────────────── */

export function evaluateDipoleFit(
  fit: DipoleFitEstimate,
  truePositionMm: Vec3Mm,
  trueMomentNAm: Vec3Mm,
): DipoleFitResult {
  assertFiniteVec(truePositionMm, 'truePositionMm');
  assertFiniteVec(trueMomentNAm, 'trueMomentNAm');
  return {
    estimatedPositionMm: fit.estimatedPositionMm,
    estimatedMomentNAm: fit.estimatedMomentNAm,
    residualRmsUv: fit.residualRmsUv,
    truePositionMm: [truePositionMm[0], truePositionMm[1], truePositionMm[2]],
    trueMomentNAm: [trueMomentNAm[0], trueMomentNAm[1], trueMomentNAm[2]],
    localizationErrorMm: localizationErrorMm(fit.estimatedPositionMm, truePositionMm),
  };
}

export function evaluateMneInverse(
  inv: MneInverseEstimate,
  truePositionMm: Vec3Mm,
): MneInverseResult {
  assertFiniteVec(truePositionMm, 'truePositionMm');
  return {
    estimatedPositionMm: inv.estimatedPositionMm,
    peakValue: inv.peakValue,
    spreadMm: inv.spreadMm,
    localizationErrorMm: localizationErrorMm(inv.estimatedPositionMm, truePositionMm),
    truePositionMm: [truePositionMm[0], truePositionMm[1], truePositionMm[2]],
    lambda2: inv.lambda2,
    method: 'MNE',
  };
}

/* ── 盲测（Ground Truth vs Estimated）────────────────────────────────── */

export interface BlindTestOptions {
  reference?: SphereReference;
  /** 附加高斯噪声 RMS，µV；0 = 无噪声。默认 0。 */
  noiseRmsUv?: number;
  /** 噪声种子（noiseRmsUv > 0 时用；默认 7）。 */
  seed?: number;
  lambda2?: number;
  /** MNE 的噪声 σ（µV）；默认与 MNE_NOISE_RMS_UV_DEFAULT 相同。 */
  mneNoiseRmsUv?: number;
}

export interface BlindTestResult {
  dipole: DipoleFitResult;
  mne: MneInverseResult;
  /** 逆解看到的数据（µV，含噪声），与 labels 一一对应。 */
  dataUv: number[];
  labels: string[];
  /** 拟合/逆解内部诊断（不含真值）。 */
  dipoleResidualRmsUv: number;
  mneSpreadMm: number;
  mnePeakValue: number;
}

/**
 * 盲测：已知源 → 正向 EEG → 逆解。
 * 真值只用来合成数据（`sphereElectrodePotentials`）和事后算误差；
 * `dipoleFit` / `mneInverse` 收到的只有数据 + lead-field，函数
 * 内部没有任何真值标签。测试里请断言这一点（逆解函数签名里没有
 * 真值参数）。
 */
export function blindTest(
  fixture: SphereFixture,
  montage: MontageKey,
  truePositionMm: Vec3Mm,
  trueMomentNAm: Vec3Mm,
  opts?: BlindTestOptions,
): BlindTestResult {
  assertFiniteVec(truePositionMm, 'truePositionMm');
  assertFiniteVec(trueMomentNAm, 'trueMomentNAm');
  const reference = opts?.reference ?? { mode: 'average' };
  const { voltageUv, sensors } = sphereElectrodePotentials(
    fixture,
    truePositionMm,
    trueMomentNAm,
    montage,
    reference,
  );
  const noiseRmsUv = opts?.noiseRmsUv ?? 0;
  if (!(noiseRmsUv >= 0)) throw new RangeError(`blindTest: noiseRmsUv must be >= 0, got ${noiseRmsUv}`);
  const noise = noiseRmsUv > 0 ? gaussianNoise(voltageUv.length, noiseRmsUv, opts?.seed ?? 7) : null;
  const dataUv = noise ? voltageUv.map((v, i) => v + noise[i]) : [...voltageUv];
  const leadField = buildLeadField(fixture, montage, reference);
  const fit = dipoleFit(leadField, dataUv);
  const inv = mneInverse(leadField, dataUv, {
    lambda2: opts?.lambda2,
    noiseRmsUv: opts?.mneNoiseRmsUv,
  });
  return {
    dipole: evaluateDipoleFit(fit, truePositionMm, trueMomentNAm),
    mne: evaluateMneInverse(inv, truePositionMm),
    dataUv,
    labels: sensors.map((s) => s.label),
    dipoleResidualRmsUv: fit.residualRmsUv,
    mneSpreadMm: inv.spreadMm,
    mnePeakValue: inv.peakValue,
  };
}
