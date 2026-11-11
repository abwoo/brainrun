/**
 * PR-15 拉伸项 — MNE 深度偏置：深度加权 / dSPM / eLORETA（PR6 残留）。
 *
 * 背景（PR6 实测，`docs/pr6-topo-inverse.md` §3.6）：无深度加权的 MNE
 *（R = I）在 64 点粗网格上是差的峰值定位器——深部源峰值误差 32–96 mm，
 * 只有表浅径向源能准确定位。这是最小范数估计的深度偏置（表浅源的
 * lead-field 列模大，解被拉向表面），不是正向模型的错（偶极子拟合
 * 在同一数据上无噪声时误差 0.0 mm）。
 *
 * 本模块复用 `sourceLocalization.ts` 的 `buildLeadField` /
 * `solveLinearSystem` / `localizationErrorMm` / `gaussianNoise`，不改
 * 原文件；只在逆解这一步换源先验 R / 做噪声归一化 / 迭代重加权。
 *
 * 方法（单位：位置 mm、偶极矩 nA·m、电位 µV、λ² 无量纲、σ µV）：
 * - 深度加权 MNE：R = diag(w_j²)，w_j = ||L_j||^(−depth)，depth 默认
 *   0.8（MNE 默认值；`mneInverse` 的 R = I 相当于 depth = 0）。
 *   s = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹ V。
 * - dSPM（Dale et al. 2000）：对同一逆算子 G = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹
 *   做噪声归一化，dSPM_j = |s_j| / √(Σ_c (G C Gᵀ)_{j,c})，C = σ²I，
 *   峰值 = dSPM 最大者。depth 参数决定用 plain（0）还是深度加权算子。
 * - eLORETA（Pascual-Marqui 2007 的标量近似）：迭代重加权，
 *   w_j ← √(trace(B_j)/3)，B = Lᵀ (L W⁻¹ Lᵀ + λ²σ²I)⁻¹ L 的第 j 个
 *   3×3 对角块，W = diag(w_j²)；R = W⁻¹。完整 eLORETA 用 3×3 块的
 *   矩阵平方根，这里取块迹平均——是近似，见文档局限。
 *
 * ── 诚实结论（实测，见 `docs/pr7-experiments.md` §5 与 fixture）──
 * 无噪声、10-20 导联、平均参考、λ² = 1/9、σ = 1.0 µV：
 * - 深源 [16,16,16]：plain MNE 55.43 mm → 深度加权 45.25 mm
 *   （改善但未修好）→ dSPM 0.00 mm（修好）→ eLORETA 近似 32.00 mm
 *   （改善，12 轮收敛）。
 * - 浅源 [48,48,48]：plain MNE 0.00 mm → 深度加权 0.00 mm（保持）
 *   → dSPM 55.43 mm（变坏：噪声归一化把峰值推向深部网格点）
 *   → eLORETA 近似 78.38 mm（变坏）。
 * - 有噪声（0.5 µV）：深源 depth 96.00 mm（比 plain 的 78.38 更差）、
 *   eLORETA 90.51 mm；浅源 eLORETA 78.38 mm。
 * 即：在这张粗网格上，没有一种方法同时修好深浅两端；dSPM 不是免费
 * 午餐，eLORETA 近似也不是。残留仍在，见文档。
 *
 * Python 对照：`scientific/eeg/depth_reference.py`（numpy 同公式）；
 * fixture `tests/pr7/fixtures/depth-reference.json`。
 */

import {
  buildLeadField,
  gaussianNoise,
  localizationErrorMm,
  mneInverse,
  MNE_LAMBDA2_DEFAULT,
  MNE_NOISE_RMS_UV_DEFAULT,
  solveLinearSystem,
  type LeadField,
} from './sourceLocalization.ts';
import {
  sphereElectrodePotentials,
  validateSphereFixture,
  type MontageKey,
  type SphereFixture,
  type SphereReference,
} from './sphereForward.ts';
import type { Vec3Mm } from './volumeConduction.ts';

/** 深度加权指数默认值 0.8（MNE 默认 depth）。 */
export const DEPTH_WEIGHT_DEFAULT = 0.8;
/** eLORETA 迭代上限与收敛阈值（最大相对变化）。 */
export const ELORETA_MAX_ITER_DEFAULT = 20;
export const ELORETA_TOL_DEFAULT = 1e-3;

export interface DepthInverseEstimate {
  method: 'MNE-depth' | 'dSPM' | 'eLORETA';
  /** 估计分布峰值位置，mm（dSPM 为 dSPM 值最大者，其余为 |s| 最大者）。 */
  estimatedPositionMm: Vec3Mm;
  /** 峰值 |s|，nA·m（dSPM 为峰值 dSPM 值，无量纲——注意不要与 nA·m 混淆，
   *  见 `peakValueUnit`）。 */
  peakValue: number;
  peakValueUnit: 'nA·m' | 'dimensionless';
  /** 分布范围：以 |s|² 为权重的、到峰值点的 RMS 距离，mm。 */
  spreadMm: number;
  lambda2: number;
  noiseRmsUv: number;
  depth: number;
  /** 各网格点的 |s|，nA·m（dSPM 为各点 dSPM 值，无量纲）。 */
  sourceNorms: number[];
  gridIndex: number;
}

/** 每源的 lead-field 列模（3 分量、全部通道的 ℓ² 范数）。 */
export function columnNorms(leadField: LeadField): number[] {
  const nSrc = leadField.sourcePositionsMm.length;
  const norms = new Array<number>(nSrc).fill(0);
  for (let i = 0; i < leadField.gain.length; i++) {
    const row = leadField.gain[i];
    for (let s = 0; s < nSrc; s++) {
      norms[s] += row[3 * s] ** 2 + row[3 * s + 1] ** 2 + row[3 * s + 2] ** 2;
    }
  }
  return norms.map((v) => Math.sqrt(v));
}

/** 深度权重 w_j = ||L_j||^(−depth)（每源一个标量，三分量共用）。 */
export function depthWeights(leadField: LeadField, depth: number): number[] {
  if (!Number.isFinite(depth) || depth < 0 || depth > 2) {
    throw new RangeError(`depthWeights: depth must be in [0, 2], got ${depth}`);
  }
  return columnNorms(leadField).map((n) => (n === 0 ? 0 : n ** -depth));
}

function peakAndSpread(
  sourceNorms: number[],
  leadField: LeadField,
): { gridIndex: number; estimatedPositionMm: Vec3Mm; spreadMm: number; peakValue: number } {
  let peakIdx = 0;
  let peakVal = -1;
  for (let s = 0; s < sourceNorms.length; s++) {
    if (sourceNorms[s] > peakVal) {
      peakVal = sourceNorms[s];
      peakIdx = s;
    }
  }
  const peakPos = leadField.sourcePositionsMm[peakIdx];
  let wSum = 0;
  let wDist2 = 0;
  for (let s = 0; s < sourceNorms.length; s++) {
    const w = sourceNorms[s] * sourceNorms[s];
    wSum += w;
    const d = localizationErrorMm(leadField.sourcePositionsMm[s], peakPos);
    wDist2 += w * d * d;
  }
  return {
    gridIndex: peakIdx,
    estimatedPositionMm: peakPos,
    spreadMm: wSum > 0 ? Math.sqrt(wDist2 / wSum) : 0,
    peakValue: peakVal,
  };
}

/** 用对角先验 R（192 维，逐分量）解 s = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹ V。 */
function solveWithDiagonalPrior(
  leadField: LeadField,
  dataUv: number[],
  rDiag: number[],
  lambda2: number,
  noiseRmsUv: number,
): { s: number[]; aInv: number[][] } {
  const nCh = dataUv.length;
  const nCol = rDiag.length;
  const L = leadField.gain;
  const reg = lambda2 * noiseRmsUv * noiseRmsUv;
  const a: number[][] = [];
  for (let i = 0; i < nCh; i++) {
    const row = new Array<number>(nCh).fill(0);
    for (let j = 0; j < nCh; j++) {
      let sum = 0;
      for (let k = 0; k < nCol; k++) sum += L[i][k] * rDiag[k] * L[j][k];
      row[j] = sum + (i === j ? reg : 0);
    }
    a.push(row);
  }
  const y = solveLinearSystem(a, [...dataUv]);
  const s = new Array<number>(nCol).fill(0);
  for (let k = 0; k < nCol; k++) {
    let v = 0;
    for (let i = 0; i < nCh; i++) v += L[i][k] * y[i];
    s[k] = rDiag[k] * v;
  }
  // A⁻¹：逐列解 A x = e_i（dSPM / eLORETA 用）。
  const aInv: number[][] = [];
  for (let i = 0; i < nCh; i++) {
    const e = new Array<number>(nCh).fill(0);
    e[i] = 1;
    aInv.push(solveLinearSystem(a, e));
  }
  // aInv 目前是按列存的解向量（aInv[i] 是第 i 列）；转成行主序矩阵。
  const m: number[][] = [];
  for (let r = 0; r < nCh; r++) {
    const row = new Array<number>(nCh).fill(0);
    for (let c = 0; c < nCh; c++) row[c] = aInv[c][r];
    m.push(row);
  }
  return { s, aInv: m };
}

function checkData(leadField: LeadField, dataUv: number[]): void {
  if (dataUv.length !== leadField.labels.length) {
    throw new RangeError(
      `data length ${dataUv.length} != lead field channel count ${leadField.labels.length}`,
    );
  }
  if (!dataUv.every(Number.isFinite)) throw new RangeError('dataUv contains non-finite values');
}

function sourceNormsOf(s: number[]): number[] {
  const nSrc = s.length / 3;
  const norms = new Array<number>(nSrc).fill(0);
  for (let j = 0; j < nSrc; j++) {
    norms[j] = Math.hypot(s[3 * j], s[3 * j + 1], s[3 * j + 2]);
  }
  return norms;
}

/**
 * 深度加权 MNE：R = diag(w_j²)，w_j = ||L_j||^(−depth)。
 * depth = 0 时退化为 plain MNE（与 `mneInverse` 同式）。
 */
export function depthWeightedMneInverse(
  leadField: LeadField,
  dataUv: number[],
  opts?: { lambda2?: number; noiseRmsUv?: number; depth?: number },
): DepthInverseEstimate {
  checkData(leadField, dataUv);
  const lambda2 = opts?.lambda2 ?? MNE_LAMBDA2_DEFAULT;
  const noiseRmsUv = opts?.noiseRmsUv ?? MNE_NOISE_RMS_UV_DEFAULT;
  const depth = opts?.depth ?? DEPTH_WEIGHT_DEFAULT;
  if (!(lambda2 > 0)) throw new RangeError(`depthWeightedMneInverse: lambda2 must be > 0, got ${lambda2}`);
  if (!(noiseRmsUv > 0)) throw new RangeError(`depthWeightedMneInverse: noiseRmsUv must be > 0, got ${noiseRmsUv}`);
  const w = depthWeights(leadField, depth);
  const rDiag: number[] = [];
  for (const wj of w) rDiag.push(wj * wj, wj * wj, wj * wj);
  const { s } = solveWithDiagonalPrior(leadField, dataUv, rDiag, lambda2, noiseRmsUv);
  const norms = sourceNormsOf(s);
  const pk = peakAndSpread(norms, leadField);
  return {
    method: 'MNE-depth',
    estimatedPositionMm: pk.estimatedPositionMm,
    peakValue: pk.peakValue,
    peakValueUnit: 'nA·m',
    spreadMm: pk.spreadMm,
    lambda2,
    noiseRmsUv,
    depth,
    sourceNorms: norms,
    gridIndex: pk.gridIndex,
  };
}

/**
 * dSPM：对逆算子 G = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹ 做噪声归一化。
 * `depth` = 0 用 plain MNE 算子；> 0 用深度加权算子。
 * dSPM_j = |s_j| / √(Σ_c (G C Gᵀ)_{j,c})，C = σ²I；峰值取 dSPM 最大者。
 */
export function dspmInverse(
  leadField: LeadField,
  dataUv: number[],
  opts?: { lambda2?: number; noiseRmsUv?: number; depth?: number },
): DepthInverseEstimate & { dspmValues: number[]; mnePeakPositionMm: Vec3Mm } {
  checkData(leadField, dataUv);
  const lambda2 = opts?.lambda2 ?? MNE_LAMBDA2_DEFAULT;
  const noiseRmsUv = opts?.noiseRmsUv ?? MNE_NOISE_RMS_UV_DEFAULT;
  const depth = opts?.depth ?? 0;
  if (!(lambda2 > 0)) throw new RangeError(`dspmInverse: lambda2 must be > 0, got ${lambda2}`);
  if (!(noiseRmsUv > 0)) throw new RangeError(`dspmInverse: noiseRmsUv must be > 0, got ${noiseRmsUv}`);
  const w = depthWeights(leadField, depth);
  const rDiag: number[] = [];
  for (const wj of w) rDiag.push(wj * wj, wj * wj, wj * wj);
  const { s, aInv } = solveWithDiagonalPrior(leadField, dataUv, rDiag, lambda2, noiseRmsUv);
  const nCh = dataUv.length;
  const L = leadField.gain;
  // G[k][i] = R[k] · Σ_j L[j][k] · A⁻¹[j][i]。
  const norms = sourceNormsOf(s);
  const dspmValues = new Array<number>(norms.length).fill(0);
  for (let j = 0; j < norms.length; j++) {
    let noiseVarSum = 0;
    for (let c = 0; c < 3; c++) {
      const k = 3 * j + c;
      let g2 = 0;
      for (let i = 0; i < nCh; i++) {
        let g = 0;
        for (let jj = 0; jj < nCh; jj++) g += L[jj][k] * aInv[jj][i];
        g *= rDiag[k];
        g2 += g * g;
      }
      noiseVarSum += noiseRmsUv * noiseRmsUv * g2;
    }
    dspmValues[j] = noiseVarSum > 0 ? norms[j] / Math.sqrt(noiseVarSum) : 0;
  }
  const pk = peakAndSpread(dspmValues, leadField);
  const mnePk = peakAndSpread(norms, leadField);
  return {
    method: 'dSPM',
    estimatedPositionMm: pk.estimatedPositionMm,
    peakValue: pk.peakValue,
    peakValueUnit: 'dimensionless',
    spreadMm: pk.spreadMm,
    lambda2,
    noiseRmsUv,
    depth,
    sourceNorms: dspmValues,
    gridIndex: pk.gridIndex,
    dspmValues,
    mnePeakPositionMm: mnePk.estimatedPositionMm,
  };
}

/**
 * eLORETA（标量近似）：迭代重加权 w_j ← √(trace(B_j)/3)，
 * B = Lᵀ (L W⁻¹ Lᵀ + λ²σ²I)⁻¹ L 的第 j 个 3×3 对角块，W = diag(w_j²)；
 * 终解用 R = W⁻¹。完整版用块的矩阵平方根，这里是块迹平均近似。
 * 关键：权重方程是尺度不变的（w 与 c·w 是同一不动点），每轮须把
 * w 按最大值归一化，否则迭代沿尺度方向坍缩到 1e-150、终解沦为
 * 任意峰（实测教训：不归一化时 20 轮后权重全为 1e-150）。
 * 权重迭代与数据 V 无关（只取决于 lead field 与 λ），是不动点性质，
 * 不是 bug。
 */
export function eloretaInverse(
  leadField: LeadField,
  dataUv: number[],
  opts?: { lambda2?: number; noiseRmsUv?: number; maxIter?: number; tol?: number },
): DepthInverseEstimate & { iterations: number; finalMaxChange: number; weights: number[] } {
  checkData(leadField, dataUv);
  const lambda2 = opts?.lambda2 ?? MNE_LAMBDA2_DEFAULT;
  const noiseRmsUv = opts?.noiseRmsUv ?? MNE_NOISE_RMS_UV_DEFAULT;
  const maxIter = opts?.maxIter ?? ELORETA_MAX_ITER_DEFAULT;
  const tol = opts?.tol ?? ELORETA_TOL_DEFAULT;
  if (!(lambda2 > 0)) throw new RangeError(`eloretaInverse: lambda2 must be > 0, got ${lambda2}`);
  if (!(noiseRmsUv > 0)) throw new RangeError(`eloretaInverse: noiseRmsUv must be > 0, got ${noiseRmsUv}`);
  if (!Number.isInteger(maxIter) || maxIter < 1) {
    throw new RangeError(`eloretaInverse: maxIter must be a positive integer, got ${maxIter}`);
  }
  const nSrc = leadField.sourcePositionsMm.length;
  const nCh = dataUv.length;
  const L = leadField.gain;
  let w = new Array<number>(nSrc).fill(1);
  let iterations = 0;
  let finalMaxChange = Infinity;
  for (let it = 0; it < maxIter; it++) {
    iterations = it + 1;
    const rDiag: number[] = [];
    for (const wj of w) {
      const v = 1 / (wj * wj);
      rDiag.push(v, v, v);
    }
    const { aInv } = solveWithDiagonalPrior(leadField, dataUv, rDiag, lambda2, noiseRmsUv);
    // B = Lᵀ A⁻¹ L（192×192）；只算对角 3×3 块的迹。
    const wNew = new Array<number>(nSrc).fill(0);
    for (let j = 0; j < nSrc; j++) {
      let trace = 0;
      for (let c = 0; c < 3; c++) {
        const k = 3 * j + c;
        // B[k][k] = Σ_i Σ_jj L[i][k] · A⁻¹[i][jj] · L[jj][k]。
        let bkk = 0;
        for (let i = 0; i < nCh; i++) {
          let tmp = 0;
          for (let jj = 0; jj < nCh; jj++) tmp += aInv[i][jj] * L[jj][k];
          bkk += L[i][k] * tmp;
        }
        trace += bkk;
      }
      wNew[j] = Math.sqrt(Math.max(trace / 3, 1e-300));
    }
    // 尺度归一化（见文件头）：否则迭代沿尺度方向坍缩。
    let wMax = 0;
    for (const v of wNew) wMax = Math.max(wMax, v);
    if (wMax > 0) {
      for (let j = 0; j < nSrc; j++) wNew[j] /= wMax;
    }
    let maxChange = 0;
    for (let j = 0; j < nSrc; j++) {
      maxChange = Math.max(maxChange, Math.abs(wNew[j] - w[j]) / Math.max(w[j], 1e-300));
    }
    w = wNew;
    finalMaxChange = maxChange;
    if (maxChange < tol) break;
  }
  const rDiag: number[] = [];
  for (const wj of w) {
    const v = 1 / (wj * wj);
    rDiag.push(v, v, v);
  }
  const { s } = solveWithDiagonalPrior(leadField, dataUv, rDiag, lambda2, noiseRmsUv);
  const norms = sourceNormsOf(s);
  const pk = peakAndSpread(norms, leadField);
  return {
    method: 'eLORETA',
    estimatedPositionMm: pk.estimatedPositionMm,
    peakValue: pk.peakValue,
    peakValueUnit: 'nA·m',
    spreadMm: pk.spreadMm,
    lambda2,
    noiseRmsUv,
    depth: 0,
    sourceNorms: norms,
    gridIndex: pk.gridIndex,
    iterations,
    finalMaxChange,
    weights: [...w],
  };
}

/* ── 前后对照（盲测语义：真值只用来合成数据与事后算误差）────────────── */

export interface DepthMethodComparison {
  /** 逆解看到的数据（µV，含噪声）与导联标签。 */
  dataUv: number[];
  labels: string[];
  /** plain MNE（R = I），与 PR6 的 `mneInverse` 相同。 */
  plainMne: ReturnType<typeof mneInverse> & { localizationErrorMm: number };
  depthWeighted: DepthInverseEstimate & { localizationErrorMm: number };
  dspm: (DepthInverseEstimate & { dspmValues: number[]; mnePeakPositionMm: Vec3Mm }) & {
    localizationErrorMm: number;
  };
  eloreta: (DepthInverseEstimate & { iterations: number; finalMaxChange: number; weights: number[] }) & {
    localizationErrorMm: number;
  };
}

/**
 * 深度偏置前后对照：已知源 → 正向 EEG（可加噪声）→ 四种逆解 →
 * 各自定位误差。真值只用来合成数据和事后算误差，不进逆解函数。
 */
export function evaluateDepthMethods(
  fixture: SphereFixture,
  montage: MontageKey,
  truePositionMm: Vec3Mm,
  trueMomentNAm: Vec3Mm,
  opts?: {
    reference?: SphereReference;
    noiseRmsUv?: number;
    seed?: number;
    lambda2?: number;
    mneNoiseRmsUv?: number;
    depth?: number;
  },
): DepthMethodComparison {
  validateSphereFixture(fixture);
  const reference = opts?.reference ?? { mode: 'average' };
  const { voltageUv, sensors } = sphereElectrodePotentials(
    fixture,
    truePositionMm,
    trueMomentNAm,
    montage,
    reference,
  );
  const noiseRmsUv = opts?.noiseRmsUv ?? 0;
  if (!(noiseRmsUv >= 0)) throw new RangeError(`evaluateDepthMethods: noiseRmsUv must be >= 0, got ${noiseRmsUv}`);
  const noise = noiseRmsUv > 0 ? gaussianNoise(voltageUv.length, noiseRmsUv, opts?.seed ?? 7) : null;
  const dataUv = noise ? voltageUv.map((v, i) => v + noise[i]) : [...voltageUv];
  const leadField = buildLeadField(fixture, montage, reference);
  const lambda2 = opts?.lambda2;
  const mneNoise = opts?.mneNoiseRmsUv;
  const depth = opts?.depth ?? DEPTH_WEIGHT_DEFAULT;
  const plain = mneInverse(leadField, dataUv, { lambda2, noiseRmsUv: mneNoise });
  const dw = depthWeightedMneInverse(leadField, dataUv, {
    lambda2,
    noiseRmsUv: mneNoise,
    depth,
  });
  const dspm = dspmInverse(leadField, dataUv, {
    lambda2,
    noiseRmsUv: mneNoise,
    depth: 0,
  });
  const elo = eloretaInverse(leadField, dataUv, { lambda2, noiseRmsUv: mneNoise });
  const err = (p: Vec3Mm) => localizationErrorMm(p, truePositionMm);
  return {
    dataUv,
    labels: sensors.map((s) => s.label),
    plainMne: { ...plain, localizationErrorMm: err(plain.estimatedPositionMm) },
    depthWeighted: { ...dw, localizationErrorMm: err(dw.estimatedPositionMm) },
    dspm: { ...dspm, localizationErrorMm: err(dspm.estimatedPositionMm) },
    eloreta: { ...elo, localizationErrorMm: err(elo.estimatedPositionMm) },
  };
}
