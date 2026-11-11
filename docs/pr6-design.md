# PR6 设计：EEG 分析（计划 PR-07–PR-12）

> **状态：** 设计稿，总协调 2026-11-12 定。分支 `pr6-eeg-analysis`，base main `f0d5087`
> （PR5 已合并）。GitHub PR 编号注意：PR #6 已被一个 CI PR
> （`ci/main-regression-gates-20261111`，开着）占用，本批的 PR 在 GitHub 上
> 会是 **#7**，标题仍写 “PR6: EEG 分析…”（2.0 批次编号），不要为抢编号改标题。
> **本批只做方法学测试 + 构建 + 冒烟**（2026-11-11 22:57 测试节奏新规）；
> 完整回归、浏览器全套、布局扫查、性能、五维验收、十个演示全部推迟到 PR8 之后。
> **不做 live 站验证**（统一验证推迟到 PR8 之后）。

## 0. 范围与验收门槛

| 计划 PR | 内容 | 验收（方法学级） |
| --- | --- | --- |
| PR-07 | 多导 EEG、参考方式、噪声 | 多通道同时仿真；参考切换真实改变数值（平均/无限远/电极三者数值各不相同）；噪声有明确参数与单位（µV RMS）、可种子复现；导联切换重建传感器配置 |
| PR-08 | 振荡、PSD、频段（WAVES 模式） | 节律来自真实动力学模型：JR p0=220 极限环的 alpha 峰实测值与 ds003061（Pz 10.00 Hz / Oz 9.25 Hz）量化对照；频段功率 Delta/Theta/Alpha/Beta/Gamma 全部来自同一份 EEG；绝不允许“每频段叠加正弦”伪造节律，纯正弦只作已标注的外部驱动 |
| PR-09 | ERP、事件、试次系统 | MNE 口径 epoch 切分、基线校正、叠加平均；峰值幅度/潜伏期、时间窗均值、差异波、试次变异性（SEM）；P300/N400 类成分只能来自真实任务 + 生成机制或明确标注教学合成，绝不直接加固定 P300 波形；晚期成分机制是本批主攻方向（PR5 结构性缺口：300–500 ms 窗内模型≈0 vs 真实 6.94 µV），量化改进，做不到就如实写清缺口 |
| PR-10 | 时频、ERSP、ITC | STFT / Morlet / multitaper 三种方法，ERSP（dB，基线归一化）与 ITC；与 Python 参考（SciPy/MNE）数值对照；三种方法的结果不直接混比，须注明方法与参数 |
| PR-11 | 地形：2D + 3D 头皮电位 | 2D 地形（电极插值，明确标注为插值）与 3D 头皮电位（正向计算值，345 个传感器位置的真实 L·q，无插值）严格区分，两种图不混为一谈 |
| PR-12 | 源定位：偶极子拟合 + MNE 逆解 | 已知真值对照 + 盲测（不向逆解泄露真值标签），报告定位误差数值（mm）与分布范围；不同电极数/噪声水平/正则化下的表现 |

共享数据基础（计划 §18 依赖关系）：PR-06/PR-07 是 ERP、时频、地形、源定位
共享的数据基础。**全批只用一份 EEG 记录**：一个实验产生 `EegRecording` +
`EegEvent[]`，ERP/时频/地形/源定位全部读同一份记录，不许各写一套不相关的
模拟波形来提前宣称后续功能完成。

## 1. 共享接口（定死，wave-2 三个子代理按此写，互不改接口）

### 1.1 `app/src/lib/eegData.ts`（B1 新建并拥有）

```ts
import type { Vec3Mm } from './volumeConduction';
import type { MontageKey } from './sphereForward';

export interface EegChannel { label: string; positionMm: Vec3Mm; }
export type EegReference =
  | { mode: 'average' | 'infinity' }
  | { mode: 'electrode'; label: string };
export interface NoiseParams {
  whiteRmsUv: number;   // 白噪声 RMS，µV
  pinkRmsUv: number;    // 1/f 噪声 RMS，µV
  line50HzRmsUv: number;// 50 Hz 工频 RMS，µV
  driftRmsUv: number;   // 慢漂移 RMS，µV
}
export interface EegRecording {
  version: 1;
  sfreqHz: number;            // 采样率，Hz（默认 250，与 ds003061 一致）
  timesMs: number[];          // 采样时刻，ms
  channels: EegChannel[];     // 导联标签与位置
  dataUv: number[][];         // [通道][采样]，µV
  reference: EegReference;
  montage: MontageKey;
  forwardModelId: string;     // 如 SPHERE_MODEL_ID
  sourceModelId: string;      // 如 JANSEN_RIT_ID / COUPLING_ID
  seed: number;
  noise: NoiseParams | null;  // null = 无噪声
}
export interface EegEvent {
  id: number;
  type: 'standard' | 'oddball' | 'noise' | 'pulse';
  tMs: number;                // 仿真时钟上的时间戳，ms（不是浏览器墙钟）
  condition: 'standard' | 'oddball';
  drive: number;              // 该事件用的刺激驱动（WC 无量纲 / JR 1/s，二者分开记）
  driveUnit: 'wc' | 'jr';
}
export interface EpochSet {
  tminMs: number; tmaxMs: number;
  baselineMs: [number, number];   // 如 [-200, 0]
  timesMs: number[];              // 相对事件的采样时刻，ms
  trials: number[][][];           // [试次][通道][采样]，µV，已基线校正
  kept: boolean[];                // 每试次是否保留（峰峰值剔除）
  events: EegEvent[];             // 保留试次对应的事件（与 trials 一一对应）
  sfreqHz: number;
  channels: string[];
}
export interface ErpResult {
  timesMs: number[];
  meanUv: number[][];   // [通道][采样]
  semUv: number[][];    // [通道][采样]
  n: number;
  peakUv: number; peakLatencyMs: number; windowMeanUv: number; // 针对指定通道+窗口
  channel: string; windowMs: [number, number];
}
export interface PsdResult {
  freqsHz: number[];
  psdUv2PerHz: number[][];   // [通道][频率]
  bandPowerUv2: Record<'delta'|'theta'|'alpha'|'beta'|'gamma', number[]>; // 每通道
  peakHz: number[];          // 每通道
}
export const EEG_BANDS: Record<'delta'|'theta'|'alpha'|'beta'|'gamma', [number, number]> =
  { delta: [0.5, 4], theta: [4, 8], alpha: [8, 13], beta: [13, 30], gamma: [30, 45] };
export interface TfrResult {
  timesMs: number[]; freqsHz: number[];
  powerDb: number[][];   // [频率][时间]，单通道
  itc: number[][];       // [频率][时间]，单通道
  channel: string;
  method: 'stft' | 'morlet' | 'multitaper';
}
export interface TopoResult {
  atTimeMs: number;
  electrodeValues: { label: string; valueUv: number }[];  // 所选导联的实测值
  grid: { x: number; y: number; valueUv: number }[];      // 2D 插值场（球面样条）
  method: 'spherical-spline';
  forwardValues: { label: string; valueUv: number }[];    // 3D：345 个传感器位置的正向计算值
}
export interface DipoleFitResult {
  estimatedPositionMm: Vec3Mm; estimatedMomentNAm: Vec3Mm;
  residualRmsUv: number;
  truePositionMm: Vec3Mm; trueMomentNAm: Vec3Mm;
  localizationErrorMm: number;
}
export interface MneInverseResult {
  estimatedPositionMm: Vec3Mm;   // 估计分布峰值位置
  peakValue: number; spreadMm: number;
  localizationErrorMm: number; truePositionMm: Vec3Mm;
  lambda2: number; method: 'MNE';
}
```

### 1.2 `app/src/lib/signalProcessing.ts`（A1 新建并拥有）

```ts
export function fftInPlace(re: Float64Array, im: Float64Array): void; // radix-2
export function welchPsd(x: number[], sfreqHz: number,
  opts?: { nFft?: number; overlap?: number }): { freqsHz: number[]; psd: number[] };
export function bandPowers(freqsHz: number[], psd: number[]):
  Record<'delta'|'theta'|'alpha'|'beta'|'gamma', number>;
export function stft(x: number[], sfreqHz: number,
  opts?: { nFft?: number; hop?: number }): { timesMs: number[]; freqsHz: number[]; power: number[][]; phase: number[][] };
export function morletTfr(x: number[], sfreqHz: number, freqsHz: number[],
  opts?: { cycles?: number }): { timesMs: number[]; power: number[][]; phase: number[][] };
export function multitaperPsd(x: number[], sfreqHz: number,
  opts?: { nw?: number; k?: number }): { freqsHz: number[]; psd: number[] };
// DPSS 锥：优先 TS 内实现；如实现成本过高，允许 Python 离线生成锥 fixture
// （注明来源与参数，fixture 入库），TS 只做加锥平均——与球形 lead-field 同一模式。
export function epochRecording(rec: EegRecording, events: EegEvent[],
  tminMs: number, tmaxMs: number, baselineMs: [number, number],
  rejectPeakToPeakUv?: number): EpochSet;
export function averageEpochs(epochs: EpochSet): { timesMs: number[]; meanUv: number[][]; semUv: number[][]; n: number };
export function erspItc(epochs: EpochSet, channel: string, freqsHz: number[],
  method: 'stft' | 'morlet' | 'multitaper', baselineMs: [number, number]):
  { erspDb: number[][]; itc: number[][]; timesMs: number[] };
export function peakInWindow(timesMs: number[], values: number[], winMs: [number, number]):
  { peakUv: number; latencyMs: number; windowMeanUv: number };
```

Python 对照（A1）：`scientific/eeg/signal_reference.py`（numpy/scipy；multitaper
可用 `scipy.signal.windows.dpss`；ERP 对照可用 MNE `Epochs`/`Evoked`）与
`tests/pr6/test_signal_processing.py`。TS 与 Python 同一输入的数值对照容差
写进测试（PSD 相对误差、ERP 绝对误差 µV 级等，按量纲定，不放宽）。

### 1.3 实验壳 `app/src/components/EegAnalysisLab.tsx`（B1 拥有）

- 入口：App.tsx 新增 chip “EEG 分析”（B1 改 App.tsx，别的人不碰）。
- 壳持有共享状态：`recording: EegRecording | null`、`events: EegEvent[]`、
  `epochs: EpochSet | null`、`selectedChannel: string`、`reference`、`montage`。
- 六个 tab，各自独立文件，props 约定如下（壳传什么，tab 就接什么，不许 tab
  自己再去各写一套数据源）：
  - `EegWaveTab.tsx`（B1）：`{ recording, reference, onReferenceChange, montage, onMontageChange, noise, onNoiseChange, onRunExperiment, running }`
  - `WavesTab.tsx`（B2）：`{ recording, channel }`
  - `ErpTab.tsx`（B2）：`{ recording, events, epochs, onEpochsChange, channel }`
  - `TfrTab.tsx`（B3）：`{ epochs, channel }`
  - `TopoTab.tsx`（B3）：`{ recording, atTimeMs, onAtTimeMsChange }`
  - `InverseTab.tsx`（B3）：`{ recording, fixture }`（fixture 指球形 lead-field，供逆解用）
- “运行实验”按钮在 EEG tab（B1）：按给定参数跑柱模型 → 正向模型 → 噪声 →
  生成 recording + events。ERP tab 只做分段/平均，不重新跑模型。

## 2. 各子任务的科学要求

### A1 信号处理核心
- FFT/Welch/STFT/Morlet/multitaper/ERSP/ITC/epoch/基线/平均/峰值，TS 与
  Python 双实现、数值对照；频段定义见 §1.1 `EEG_BANDS`；所有量纲写清
  （µV、µV²/Hz、dB、ms、Hz）；边界效应、频率/时间分辨率、基线时段写进
  文档与测试注释。
- 约束数据复用：`scientific/forward/public_eeg_reference_values.json`
  （ds003061 实测值）已在仓库里，不用重下数据；原始 .set 在
  `~/workspace/eeg-constraint-data/`（只读，绝不提交进仓库）。

### A2 契约残留 + CI + 脚手架
- R1 `stim_amplitude`：先查全部测试/代码里有没有用到 >2.0 的幅度；没有就
  把 WASM clamp 从 0–4.0 收紧到 0.5–2.0（与 UI 一致），改
  `crates/brain-wasm/src/lib.rs` + 契约 §1.2 + `protocol.ts` 注释 + 漂移测试；
  如有正当用例超 2.0，改走 (b)：引擎范围 0–4.0 为准、UI 只暴露子集，并把
  UI 文案与注释写清，不许含糊。
- R2 快照 JSON 加版本：`crates/brain-core/src/lib.rs` 的 `StateSnapshot`
  加 `version: u32`（serde 默认值 1，旧 JSON 仍能恢复）；`simClient.ts`
  的解析同步读它；契约 §4.2/§4.3 更新；漂移测试加断言。`cargo test` 验证。
- R6 MNI152/Talairach 类型消除：把 `'mni152-mm' | 'talairach-mm'` 从
  `CoordinateSpace` 联合类型里去掉，改为字符串解析函数
  `parseCoordinateSpace(s: string): CoordinateSpace`（遇禁用空间抛错并给
  出原因）；`validateTransform` 的 choke point 保留（行为级断言不变）；
  更新 `tests/pr5/coordinates.test.mjs` 与契约 §2/§7 R6（R6 变已解决）。
  注意：不要改坏已有测试的断言语义——拒绝行为必须保持。
- CI：新建 `.github/workflows/pr6-eeg.yml`，仿照 `pr5-physics.yml` 但只跑
  PR6 方法学测试：Node 24 → `npm ci` → MNE 1.11.0 → 生成球形模型 →
  `python -m unittest discover -s tests/pr6 -p 'test_*.py'` →
  `node --experimental-strip-types --test tests/pr6/*.test.mjs` →
  `cargo test` → `npx tsc -b` → `npm run build` → `npm run lint` →
  Playwright 安装（**绝不用 `--with-deps`**，只 `npx playwright install chromium`，
  PR5 已证实 runner apt DNS 是坏的）→ `node app/tests/pr6-browser-smoke.mjs`。
  用 glob 跑 pr6 测试，让 wave-2 的测试文件自动被拾取。
- 推送脚本：仿照 `scripts/push-to-branch.py` 新建
  `scripts/push-to-pr6-branch.py`（BRANCH 改为 `pr6-eeg-analysis`，
  其余安全规则照搬：干跑默认、禁推路径、main 移动检查、绝不 `git push`
  原始凭证）。只做干跑验证，**不要自己推分支**（集成由总协调推）。
- 脚手架：`tests/pr6/debug-rounds.md`（记录格式照 tests/pr5 的）、
  `docs/pr6-acceptance.md`（PR-07–12 的门槛表 + 残留项，初版由 A2 写骨架，
  wave-2 各填自己的实测结果）。

### B1 PR-07 多导 EEG（+ R4 电极参考 UI）
- `app/src/lib/eegRecording.ts`：连续多导 EEG 生成——柱模型 q(t)（WC/JR
  二选一或双源叠加，线性叠加）→ 球形 lead-field（`sphereForward.ts`，
  运行时 fixture 由 CI/本地生成，不入库）→ 多通道 µV；采样率 250 Hz
  （柱模型 0.5/1 ms 步进下采样到 4 ms）；参考变换 average/infinity/
  electrode（**R4 在此修**：电极参考要有 UI 入口 + 电极选择器，三个
  参考方式数值必须各不相同，测试断言）；噪声模型：白噪声 + 1/f 粉红
  噪声 + 50 Hz 工频 + 慢漂移，各自 RMS（µV）、种子复现（mulberry32 或
  同类确定性 RNG，种子进 recording）；伪迹/噪声有独立生成逻辑并标注，
  不得误标为神经源活动；导联切换（10-20/10-10/10-05）重建传感器配置；
  导出 CSV/JSON（通道、时间、µV、参考、模型 id）。
- Python 对照 `scientific/eeg/eeg_reference.py` + `tests/pr6/test_eeg_recording.py`；
  TS 测试 `tests/pr6/eeg-recording.test.mjs`：参考数值差异、噪声统计
  （RMS 在容差内）、种子复现（同种子 bit 一致）、线性叠加、导联切换。
- UI：拥有 `EegAnalysisLab.tsx` 壳 + `EegWaveTab.tsx`（EEG tab：运行实验、
  参考、导联、噪声、通道选择、多导波形显示）+ App.tsx 的 “EEG 分析” 入口。
  波形显示用 SVG/canvas 折线（复用 LocalBEMLab 的 QTrace 风格即可）。

### B2 PR-08 WAVES + PR-09 ERP（主攻：晚期成分机制）
- PR-08：JR p0=220 极限环实测——跑 10 s 连续记录，Welch PSD 测 alpha 峰
  （y0 与 Pz EEG 两处），与 ds003061（Pz 10.00 Hz / Oz 9.25 Hz）量化对照，
  给出峰值 Hz、偏差、频段功率占比；预设只上已验证的（Alpha 探索 = JR
  p0=220；其余频段只作同一份信号的频段功率读数，不许为每个频段各编一
  个“节律”）；Oscillatory 10 Hz 正弦驱动仍标注为外部驱动，不是自发节律。
- PR-09：事件系统（仿真时钟时间戳、事件类型、试次编号、参数快照）+
  oddball 实验（标准/靶刺激两种条件、固定 ISI、多次试次）+ MNE 口径
  epoch（−200–800 ms、基线 −200–0、峰峰值 >150 µV 剔除）+ 平均/SEM +
  峰值幅度与潜伏期（250–600 ms 窗）+ 时间窗均值（300–500 ms）+ 差异波
  （oddball−standard）+ 试次数量效应（ERP 与不确定性随试次数更新）。
  **晚期成分机制**（`app/src/lib/lateResponse.ts` 新建）：在 JR 柱上加
  一个真实的慢机制（建议：慢突触反馈/慢兴奋再入环，τ 约 150–300 ms，
  带延迟；具体形式由 B2 定，但必须是带参数的动力学机制，不是加固定
  波形）；TS RK4 + Python SciPy DOP853 双实现、数值对照（<1e-6 级）；
  安全检查（不动点/极限环性质、发散守卫）；验证：oddball 条件 300–500 ms
  均值、峰值幅度与潜伏期，对照 ds003061（8.89 µV @410 ms、300–500 ms
  均值 6.94 µV、差异波 9.14 µV @414 ms），给出改进前后的数字表；
  **做不到就如实写清缺口**（幅度差距仍是校准缺口，不得靠放大乘积
  “修好”——乘积不可辨识，守卫测试要留着）。
  文档：`docs/pr6-erp-mechanism.md`（机制、参数、对照表、残留缺口）。
- UI：`WavesTab.tsx`（PSD/频段/峰值/预设）、`ErpTab.tsx`（试次、ERP 波形、
  峰值/潜伏期、差异波、条件对照）。
- 测试：`tests/pr6/waves-erp.test.mjs`、`tests/pr6/test_waves_erp.py`
  （含 JR alpha 实测、ERP 与 MNE 对照、晚期机制形态数）。

### B3 PR-10 时频 + PR-11 地形 + PR-12 源定位
- PR-10：用 A1 的 STFT/Morlet/multitaper 对同一份 EpochSet 做 ERSP
  （dB，基线归一化）与 ITC；时×频×功率热图（canvas）、频段功率随时间、
  时间–频率区域选择；与 Python（SciPy/MNE）数值对照；注明方法与参数，
  三种方法的结果不直接混比。
- PR-11：`app/src/lib/topography.ts`——2D 地形用球面样条插值（Perrin
  法，注明是插值）；3D 头皮电位用 345 个传感器位置的正向计算值
  （`sphereElectrodePotentials` 全 10-05 集，L·q，无插值）；两种图在
  UI 上分开展示并写清来源差异。Python 对照：同一组电极值，TS 插值与
  Python 同公式实现在测试点上对照。
- PR-12：`app/src/lib/sourceLocalization.ts`——偶极子拟合（在 64 点源
  网格 × 方向上做最小二乘拟合，报告残差 RMS）+ MNE 最小范数逆解
  （lead-field + 噪声协方差 + 正则化 λ²，可调，默认写清）；Ground
  Truth vs Estimated 模式：已知源 → 正向 EEG → 盲测逆解（测试里真值
  标签不进逆解函数）→ 报告定位误差 mm 与分布范围；不同电极数/噪声/
  正则化下的表现表。Python 对照 `scientific/eeg/inverse_reference.py`
  （MNE `make_inverse_operator`/`apply_inverse` 同数据对照）。
- UI：`TfrTab.tsx`、`TopoTab.tsx`、`InverseTab.tsx`。
  文档：`docs/pr6-topo-inverse.md`。
- 测试：`tests/pr6/tfr-topo-inverse.test.mjs`、`tests/pr6/test_tfr_topo_inverse.py`
  （含盲测定位误差数）。

## 3. 文件归属（不许越界改别人的文件）

| 子代理 | 拥有（可新建/可改） | 不许碰 |
| --- | --- | --- |
| A1 | `app/src/lib/signalProcessing.ts`、`scientific/eeg/signal_reference.py`、`tests/pr6/signal-processing.test.mjs`、`tests/pr6/test_signal_processing.py`、multitaper fixture（如需，`tests/pr6/fixtures/*`，注明来源） | 其余一切 |
| A2 | `crates/brain-wasm/src/lib.rs`（仅 R1 clamp）、`crates/brain-core/src/lib.rs`（仅 StateSnapshot version）、`app/src/lib/coordinates.ts`（仅 R6）、`app/src/lib/simClient.ts`（仅快照版本解析）、`tests/pr5/coordinates.test.mjs`、`tests/pr5/contract.test.mjs`、`docs/frontend-backend-contract.md`（§1.2/§2/§4.2/§4.3/§7 相关段落）、`.github/workflows/pr6-eeg.yml`、`scripts/push-to-pr6-branch.py`、`tests/pr6/debug-rounds.md`、`docs/pr6-acceptance.md`（骨架） | 其余一切；尤其不许改 `app/src/App.tsx`、不许改柱模型文件 |
| B1 | `app/src/lib/eegData.ts`、`app/src/lib/eegRecording.ts`、`scientific/eeg/eeg_reference.py`、`tests/pr6/eeg-recording.test.mjs`、`tests/pr6/test_eeg_recording.py`、`app/src/components/EegAnalysisLab.tsx`、`app/src/components/EegWaveTab.tsx`、`app/src/App.tsx`（仅加 “EEG 分析” 入口 + 挂载）、`app/src/App.css`（仅 EEG  lab 所需样式） | A1/A2/B2/B3 的文件 |
| B2 | `app/src/lib/lateResponse.ts`、`scientific/eeg/late_response_reference.py`、`tests/pr6/waves-erp.test.mjs`、`tests/pr6/test_waves_erp.py`、`app/src/components/WavesTab.tsx`、`app/src/components/ErpTab.tsx`、`docs/pr6-erp-mechanism.md`、`docs/pr6-acceptance.md`（填 PR-08/09 实测结果） | 其余一切 |
| B3 | `app/src/lib/topography.ts`、`app/src/lib/sourceLocalization.ts`、`scientific/eeg/inverse_reference.py`、`tests/pr6/tfr-topo-inverse.test.mjs`、`tests/pr6/test_tfr_topo_inverse.py`、`app/src/components/TfrTab.tsx`、`app/src/components/TopoTab.tsx`、`app/src/components/InverseTab.tsx`、`docs/pr6-topo-inverse.md`、`docs/pr6-acceptance.md`（填 PR-10/11/12 实测结果） | 其余一切 |

契约更新：B1/B2/B3 各自新增的参数、消息、状态字段，按契约 §8 清单登记进
`docs/frontend-backend-contract.md`（各改自己的段落，互不重叠：B1 写 EEG/参考/
噪声；B2 写 WAVES/ERP/晚期机制参数；B3 写时频/地形/逆解参数）并扩展漂移测试
（`tests/pr5/contract.test.mjs` 可追加断言；不要另起炉灶）。

## 4. 通用硬规则

- 每轮只保留该轮必需的方法学测试 + 构建通过 + 新功能冒烟；其余测试推迟到
  PR8 之后。合并门槛 = 方法学测试通过 + 构建通过 + 冒烟通过。
- 测试止损：同一测试因非产品问题（系统/环境原因）失败超过 3 次，自动停掉、
  记在 `tests/pr6/debug-rounds.md` 后继续，绝不陷入循环。产品真问题必须修，
  不许改期望、删场景、放宽门槛来让测试通过。
- 前后端对齐：新增前端入口必须对应真实后端实现；契约同步更新；漂移测试卡住。
- 前端：不许出现组件相互遮挡、GUI 框太小显示不全内容的问题；新增面板按契约
  把布局做对，1920×1080 与 978px 各看一眼（冒烟级）。
- 推送：子代理**一律不推分支**（集成由总协调做）。A2 只写推送脚本并干跑验证。
- 球形 fixture：`app/public/forward-assets/sphere-model.json` 由 CI/本地生成，
  **不入库**；本地生成用 `~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py`
  （MNE 1.11.0 已装）；需要它的测试先在测试里说明生成方式，跑不通时报清楚原因。
- ds003061 原始数据在 `~/workspace/eeg-constraint-data/`（只读），绝不提交进仓库；
  仓库里只用已有的 `scientific/forward/public_eeg_reference_values.json` 衍生数值。
- 工作方式：每个子代理先 `cp -r ~/workspace/brainrun-pr6 ~/workspace/brainrun-pr6-<代号>`
  在自己的副本里工作，汇报时列出新建/修改的文件清单 + 测试证据；总协调负责
  合并进主 clone、跑全量方法学测试、推分支、开 PR。
