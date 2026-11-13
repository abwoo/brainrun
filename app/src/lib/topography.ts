/**
 * PR6 — 地形：2D 球面样条插值 + 3D 正向头皮电位（B3，PR-11）。
 *
 * 两张图严格区分（设计稿 §2 B3 / PR-11）：
 * - 2D 地形：电极实测值之间的**插值**（Perrin 球面样条，见下）。图上
 *   任意两电极之间的值都是算出来的，不是测到的；UI 上必须写清“插值”。
 * - 3D 头皮电位：345 个传感器位置的**正向计算值**（`forwardHeadPotential`，
 *   每点都是 L·q 直接求值，电极之间不做插值）。源位置的三线性插值是
 *   球形正向模型本身的已有行为（`sphereForward.ts` 有文档），不是
 *   本模块在电极之间插值——两者不要混为一谈。
 *
 * 单位：位置 mm、电位 µV、偶极矩 nA·m；地形网格坐标 x/y 为头顶俯视
 * 图上的单位圆坐标（x = X/R，y = Y/R，R = 95 mm 球半径；×95 得 mm）。
 * 俯视图：+X 向右（右耳方向）、+Y 向上（鼻尖方向，即头坐标 +Y 朝前）。
 *
 * Python 对照：`scientific/eeg/inverse_reference.py` 的
 * `spherical_spline_topography`（同公式实现），测试点上逐点对照。
 */

import type { EegRecording } from './eegData.ts';
import type { TopoResult } from './eegData.ts';
import type { Vec3Mm } from './volumeConduction.ts';
import {
  interpolateSphereGain,
  validateSphereFixture,
  type SphereFixture,
  type SphereReference,
} from './sphereForward.ts';

/* ── Perrin 球面样条（Perrin et al. 1989, 1990）────────────────────── */

/** 样条阶数 m（Perrin 推荐 m = 4：插值面足够光滑，不过拟合噪声）。 */
export const SPLINE_ORDER_M = 4;
/** Legendre 展开截断阶数 n（Perrin 常用 7；再高对 19 导无增益且病态）。 */
export const SPLINE_N_MAX = 7;
/** 正则化 λ：G + λI，默认 1e-5（相对 G 对角 ~0.015 很小，近乎精确插值）。 */
export const SPLINE_LAMBDA_DEFAULT = 1e-5;

export interface TopoElectrode {
  label: string;
  /** 球面上的电极位置，mm（球心为原点的头坐标，模长 = 球半径 95 mm）。 */
  positionMm: Vec3Mm;
}

/** G(x) = (1/4π)·Σ_{n=1}^{N} (2n+1)/(n^m·(n+1)^m)·P_n(x)，x = cos(夹角)。 */
export function splineKernelG(cosAngle: number, m: number = SPLINE_ORDER_M, nMax: number = SPLINE_N_MAX): number {
  if (!(cosAngle >= -1 && cosAngle <= 1)) {
    throw new RangeError(`splineKernelG: cosAngle must be in [-1, 1], got ${cosAngle}`);
  }
  // Legendre P_n(x) 递推：P_0 = 1，P_1 = x，(n+1)P_{n+1} = (2n+1)xP_n − nP_{n−1}。
  let pPrev = 1; // P_0(x)
  let pCurr = cosAngle; // P_1(x)；循环开头恒有 pCurr = P_n(x)
  let sum = 0;
  for (let n = 1; n <= nMax; n++) {
    const denom = n ** m * (n + 1) ** m;
    sum += ((2 * n + 1) / denom) * pCurr;
    // 递推到下一阶（n+1 阶的 P 值进入 pCurr；pPrev 留作下一轮）。
    const pNext = ((2 * n + 1) * cosAngle * pCurr - n * pPrev) / (n + 1);
    pPrev = pCurr;
    pCurr = pNext;
  }
  return sum / (4 * Math.PI);
}

/** 解稠密线性方程组 A·x = b（部分主元高斯消元；A 会被复制，不改输入）。 */
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

export interface SplineCoefficients {
  /** 每电极的权重 C_i（与 electrodes 一一对应）。 */
  weights: number[];
  /** 常数项 c0（约束 ΣC_i = 0 下的解）。 */
  c0: number;
  electrodes: TopoElectrode[];
  m: number;
  nMax: number;
  lambda: number;
}

function unitVector(p: Vec3Mm): [number, number, number] {
  const n = Math.hypot(p[0], p[1], p[2]);
  if (!(n > 0) || !Number.isFinite(n)) throw new RangeError('electrode position must be a finite non-zero vector');
  return [p[0] / n, p[1] / n, p[2] / n];
}

/**
 * 求球面样条系数：解 [G+λI, 1; 1ᵀ, 0]·[C; c0] = [V; 0]。
 * 约束 ΣC_i = 0 保证插值面在球面上无整体漂移（Perrin 原文条件）。
 * 要求 ≥ 4 个电极（少于 4 个时 G 矩阵退化，插值无意义）。
 */
export function sphericalSplineCoefficients(
  electrodes: TopoElectrode[],
  valuesUv: number[],
  opts?: { m?: number; nMax?: number; lambda?: number },
): SplineCoefficients {
  if (electrodes.length !== valuesUv.length) {
    throw new RangeError(`sphericalSplineCoefficients: ${electrodes.length} electrodes vs ${valuesUv.length} values`);
  }
  if (electrodes.length < 4) {
    throw new RangeError(`sphericalSplineCoefficients: need at least 4 electrodes, got ${electrodes.length}`);
  }
  for (let i = 0; i < valuesUv.length; i++) {
    if (!Number.isFinite(valuesUv[i])) throw new RangeError(`valuesUv[${i}] is not finite`);
  }
  const m = opts?.m ?? SPLINE_ORDER_M;
  const nMax = opts?.nMax ?? SPLINE_N_MAX;
  const lambda = opts?.lambda ?? SPLINE_LAMBDA_DEFAULT;
  if (!(m >= 1) || !Number.isInteger(m)) throw new RangeError(`spline order m must be a positive integer, got ${m}`);
  if (!(nMax >= 1) || !Number.isInteger(nMax)) throw new RangeError(`spline nMax must be a positive integer, got ${nMax}`);
  if (!(lambda >= 0)) throw new RangeError(`spline lambda must be >= 0, got ${lambda}`);
  const n = electrodes.length;
  const u = electrodes.map((e) => unitVector(e.positionMm));
  // G 矩阵（n×n，对称）+ 增广行/列。
  const a: number[][] = [];
  for (let i = 0; i <= n; i++) a.push(new Array<number>(n + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cos = Math.max(-1, Math.min(1, u[i][0] * u[j][0] + u[i][1] * u[j][1] + u[i][2] * u[j][2]));
      a[i][j] = splineKernelG(cos, m, nMax) + (i === j ? lambda : 0);
    }
    a[i][n] = 1;
    a[n][i] = 1;
  }
  const b = [...valuesUv, 0];
  const sol = solveLinearSystem(a, b);
  return { weights: sol.slice(0, n), c0: sol[n], electrodes, m, nMax, lambda };
}

/** 在单位球面方向 u（单位向量，允差 1e-6：fixture 位置为 6 位小数舍入）上求插值电位（µV）。 */
export function evaluateSpline(coeffs: SplineCoefficients, u: [number, number, number]): number {
  const n = Math.hypot(u[0], u[1], u[2]);
  if (Math.abs(n - 1) > 1e-6) throw new RangeError('evaluateSpline: direction must be a unit vector');
  const un: [number, number, number] = [u[0] / n, u[1] / n, u[2] / n];
  let v = coeffs.c0;
  for (let i = 0; i < coeffs.electrodes.length; i++) {
    const e = unitVector(coeffs.electrodes[i].positionMm);
    const cos = Math.max(-1, Math.min(1, e[0] * un[0] + e[1] * un[1] + e[2] * un[2]));
    v += coeffs.weights[i] * splineKernelG(cos, coeffs.m, coeffs.nMax);
  }
  return v;
}

export interface SplineTopographyResult {
  /** 插值系数（供测试在电极点上复核、UI 在任意点上求值）。 */
  coefficients: SplineCoefficients;
  /** 2D 插值场：头顶俯视图单位圆内网格点（x = X/R，y = Y/R）。 */
  grid: { x: number; y: number; valueUv: number }[];
  gridResolution: number;
}

/**
 * 2D 地形：球面样条插值场（Perrin 法）。
 * 网格为头顶俯视图：x = X/R（右）、y = Y/R（前），只保留单位圆内
 * （x²+y² ≤ 1）的点。**返回值是插值，不是实测值**——调用方（UI）
 * 必须向用户写清这一点。
 */
export function sphericalSplineTopography(
  electrodes: TopoElectrode[],
  valuesUv: number[],
  opts?: { m?: number; nMax?: number; lambda?: number; gridResolution?: number },
): SplineTopographyResult {
  const coeffs = sphericalSplineCoefficients(electrodes, valuesUv, opts);
  const res = opts?.gridResolution ?? 25;
  if (!Number.isInteger(res) || res < 5) {
    throw new RangeError(`sphericalSplineTopography: gridResolution must be an integer >= 5, got ${res}`);
  }
  const grid: { x: number; y: number; valueUv: number }[] = [];
  for (let iy = 0; iy < res; iy++) {
    for (let ix = 0; ix < res; ix++) {
      const x = (2 * ix) / (res - 1) - 1;
      const y = 1 - (2 * iy) / (res - 1); // 行从上（前，+Y）往下排
      const r2 = x * x + y * y;
      if (r2 > 1) continue;
      // 俯视方向 u：球面点 (x·R, y·R, +√(1−r²)·R) 的单位向量。
      const z = Math.sqrt(Math.max(0, 1 - r2));
      const valueUv = evaluateSpline(coeffs, [x, y, z]);
      grid.push({ x, y, valueUv });
    }
  }
  return { coefficients: coeffs, grid, gridResolution: res };
}

/* ── 3D 头皮电位：正向计算值（无电极间插值）────────────────────────── */

export interface ForwardHeadPotential {
  /** 全部 345 个传感器（fixture 顺序），每点都是 L·q 直接求值。 */
  labels: string[];
  positionsMm: Vec3Mm[];
  /** µV，已按 reference 变换。 */
  valueUv: number[];
  sourceMm: Vec3Mm;
  momentNAm: Vec3Mm;
  reference: SphereReference;
}

/**
 * 3D 头皮电位：对 fixture 全部 345 个传感器位置做正向计算 V = L·q。
 * `interpolateSphereGain` 在源位置上做三线性插值是球形正向模型本身
 * 的已有行为（见 `sphereForward.ts`）；每个传感器位置的值都是直接
 * 求值，**电极之间不插值**——与 2D 球面样条地形严格区分。
 * 参考变换与 `sphereElectrodePotentials` 同口径：average 减全部
 * 345 个传感器值的均值（注意：不是只减所选导联的均值）；electrode
 * 减指定电极的值；infinity 不变。
 */
export function forwardHeadPotential(
  fixture: SphereFixture,
  sourceMm: Vec3Mm,
  momentNAm: Vec3Mm,
  reference: SphereReference = { mode: 'average' },
): ForwardHeadPotential {
  validateSphereFixture(fixture);
  if (momentNAm.length !== 3 || !momentNAm.every(Number.isFinite)) {
    throw new RangeError('Moment vector must contain three finite nA.m numbers');
  }
  const gains = interpolateSphereGain(fixture, sourceMm);
  let values = fixture.sensors.map((_, i) =>
    gains[i][0] * momentNAm[0] + gains[i][1] * momentNAm[1] + gains[i][2] * momentNAm[2],
  );
  if (reference.mode === 'average') {
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    values = values.map((v) => v - mean);
  } else if (reference.mode === 'electrode') {
    const idx = fixture.sensors.findIndex((s) => s.label === reference.label);
    if (idx < 0) throw new RangeError(`Reference electrode ${reference.label} not in fixture sensors`);
    const ref = values[idx];
    values = values.map((v) => v - ref);
  } else if (reference.mode !== 'infinity') {
    throw new Error('Unsupported reference');
  }
  return {
    labels: fixture.sensors.map((s) => s.label),
    positionsMm: fixture.sensors.map((s) => s.position_mm),
    valueUv: values,
    sourceMm: [sourceMm[0], sourceMm[1], sourceMm[2]],
    momentNAm: [momentNAm[0], momentNAm[1], momentNAm[2]],
    reference,
  };
}

/* ── 从记录取某一时刻的电极值 ───────────────────────────────────────── */

/**
 * 取记录在 `atTimeMs` 最近采样点上的各通道值（µV），并做 2D 插值地形。
 * 返回 `TopoResult`（`forwardValues` 为空：2D 图没有正向计算值；
 * 3D 图由 `forwardHeadPotential` 另算，见 `TopoTab.tsx`）。
 */
export function topoAtTime(
  recording: EegRecording,
  atTimeMs: number,
  opts?: { m?: number; nMax?: number; lambda?: number; gridResolution?: number },
): TopoResult {
  if (recording.channels.length === 0) throw new RangeError('topoAtTime: recording has no channels');
  if (recording.dataUv.length !== recording.channels.length) {
    throw new RangeError('topoAtTime: dataUv/channel count mismatch');
  }
  if (!Number.isFinite(atTimeMs)) throw new RangeError(`topoAtTime: atTimeMs must be finite, got ${atTimeMs}`);
  let best = 0;
  let bestDt = Infinity;
  for (let j = 0; j < recording.timesMs.length; j++) {
    const d = Math.abs(recording.timesMs[j] - atTimeMs);
    if (d < bestDt) {
      bestDt = d;
      best = j;
    }
  }
  const electrodeValues = recording.channels.map((ch, c) => ({
    label: ch.label,
    valueUv: recording.dataUv[c][best],
  }));
  const electrodes: TopoElectrode[] = recording.channels.map((ch) => ({
    label: ch.label,
    positionMm: ch.positionMm,
  }));
  const topo = sphericalSplineTopography(
    electrodes,
    electrodeValues.map((e) => e.valueUv),
    opts,
  );
  return {
    atTimeMs: recording.timesMs[best],
    electrodeValues,
    grid: topo.grid,
    method: 'spherical-spline',
    forwardValues: [],
  };
}

/** TopoResult 的 2D 网格坐标换算：单位圆坐标 → mm（俯视图，×R）。 */
export const TOPO_HEAD_RADIUS_MM = 95;

/** Same source time courses and SAME channel reference operator as the Raw.
 * Dense scalp values exclude measurement noise, which remains a separate artifact.
 */
export function recordingForwardAtTime(fixture:SphereFixture,recording:EegRecording,atTimeMs:number):
 ForwardHeadPotential & {atTimeMs:number;sourceCount:number} {
 if(recording.forwardModelId!==fixture.model_id||!recording.sourceSeries)
  throw new Error('Recording has no compatible forward source history');
 if(!Number.isFinite(atTimeMs))throw new RangeError('Invalid observation time');
 let index=0;
 for(let j=1;j<recording.timesMs.length;j++)
  if(Math.abs(recording.timesMs[j]-atTimeMs)<Math.abs(recording.timesMs[index]-atTimeMs))index=j;
 const sources=recording.sourceSeries.sources;
 if(!sources.length)throw new Error('Empty source history');
 let first:ForwardHeadPotential|null=null;
 let values=fixture.sensors.map(()=>0);
 for(const source of sources){
  if(source.momentsNAm.length!==recording.timesMs.length)throw new Error('Source and Raw clocks differ');
  const q=source.momentsNAm[index],normal=source.direction;
  const field=forwardHeadPotential(fixture,source.positionMm,[q*normal[0],q*normal[1],q*normal[2]],{mode:'infinity'});
  first??=field;values=values.map((v,k)=>v+field.valueUv[k]);
 }
 const indices=recording.channels.map(channel=>{
  const j=fixture.sensors.findIndex(sensor=>sensor.label===channel.label);
  if(j<0||channel.positionMm.some((x,k)=>Math.abs(x-fixture.sensors[j].position_mm[k])>1e-5))
   throw new Error('Electrode geometry differs from the recording');
  return j;
 });
 let offset=0;
 if(recording.reference.mode==='average')offset=indices.reduce((sum,j)=>sum+values[j],0)/indices.length;
 if(recording.reference.mode==='electrode'){
  const label=recording.reference.label;
  const j=recording.channels.findIndex(c=>c.label===label);
  if(j<0)throw new Error('Reference electrode absent from Raw');
  offset=values[indices[j]];
 }
 return {...first!,valueUv:values.map(v=>v-offset),reference:recording.reference,
  atTimeMs:recording.timesMs[index],sourceCount:sources.length};
}
