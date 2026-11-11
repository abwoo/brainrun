# PR-15 — 双脑对照、时间机器、闭环控制（计划 PR-15）

> 状态：PR-15 子代理（C）交付，base main `d845c1a1`。本批只做方法学测试 +
> 类型检查；完整回归、浏览器全套、性能、五维验收推迟到 PR8 之后。
> 组件 `ExperimentLab.tsx` 未接进 `App.tsx`（由总协调集成）。
> 闭环初版仅用于模拟环境，不直接控制人体设备。

## 1. 设计

### 1.1 被控对象：局部 Jansen–Rit 皮层柱

全部三个功能共用一个被控对象：`jansenRitColumn.ts` 的局部 JR 柱
（Jansen & Rit 1995，三群体、六个一阶 ODE）。`experiments.ts` 没有另发明
一套动力学：导数与 `jansenRitColumn.ts` 的 `derivative` 逐项同式
（RK4，dt = 0.5 ms），sigmoid 直接复用 `jansenRitSigmoidPerS`，偶极矩
耦合复用 `equivalentMomentNAmJR`，Pz 代理增益复用 PR6 的
`PZ_GAIN_UV_PER_NAM`（0.16 µV/(nA·m)，`lateResponse.ts`）。
之所以不用 `createJansenRitColumn` 的闭包对象，是因为时间机器需要读写
完整的六维状态（y0–y5，含三个导数分量）做快照/恢复，而该对象只暴露
y0/y1/y2；测试里用该对象作预言机，同一自由运行逐值相同（差 0.0）。

链路：事件驱动（1/s）→ JR 柱 y0(t) [mV] → q(t) [nA·m] → Pz 代理 EEG
（µV，q × 0.16）。q(t) → Pz 的耦合链是 PR5 的显式假设
（N × coherence × 电流 × 长度不可辨识），幅度未经人体数据校准；
本模块只比较同一假设链下的条件差异，不宣称绝对幅度。

### 1.2 双脑 A/B 对照（plan §15.1）

`runAB(configA, configB)`：两个实验实例，相同初始状态、相同模型、
相同种子、相同输入事件，只改一个条件。共享时间轴（0.5 ms 网格，
时长不同直接抛错）。比较输出是数值差异：y0 峰值差（mV）、峰值时刻差
（ms）、Pz RMS 差（µV）、y0 轨迹最大/平均绝对差（mV）、Welch PSD
峰值频率与峰移（Hz，y0 去均值后，nFft=1024，df≈0.244 Hz）、事件锁定
平均 ERP 峰值差与潜伏期差（µV/ms，复用 A1 的 `epochRecording` /
`averageEpochs` / `peakInWindow`，窗 −200–800 ms、基线 −200–0 ms、
峰窗 0–600 ms）。

源定位对照：`compareLocalization(fixture, montage, a, b)`，在给定时刻
的偶极矩下正向生成多导 EEG → `blindTest`（偶极子拟合 + MNE 逆解，
盲测语义：真值不进逆解函数）→ 比较两条件的定位误差（mm）与分布
范围（mm）。同步旋转在组件里实现（总协调集成时接 BrainScene 的
同步旋转 props；本组件只做数值对照表，不画 3D）。

### 1.3 时间机器（plan §15.2）

`TimeMachine`：`JrPlant` 的单步包装器。

- 暂停：`pause()` / `resume()`，暂停时 `step()` 返回 null、不推进。
- 单步：一次一个 dt（0.5 ms）。
- 历史缓冲：每 10 ms 一份快照（可配 `snapshotIntervalMs`），带 t_ms
  与六维状态、事件起始状态、适应资源、控制器状态、读数（y0/q/Pz），
  全部 JSON 可序列化。
- 回放：`replay(t0, t1)` 返回已记录的快照；慢动作倍率是视图参数
  （组件按倍率步进快照），不改变物理。
- 恢复：`restore(snap)` 回到该时刻状态并截断其后历史；恢复点快照
  本身若不在历史里会被补进（否则分支点处少一个快照——实测教训）。
- 分支：`fork(snap, patch)` 复制机器并应用参数补丁（改 JR 参数 /
  基线输入 / 事件驱动等）；分支点之前两条轨迹逐值相同（同一份历史），
  分支点之后按新参数跑；`compareBranches(a, b, branchMs)` 量化分叉
  （分支前最大差、分支后最大/平均差）。

确定性：柱模型本身无 RNG；测量噪声是按节拍序号索引的确定性函数
（splitmix32 哈希 → Box–Muller，种子进配置），不是流式 RNG——从快照
恢复后重跑，同一序号的噪声逐值相同，分支点之前轨迹逐值重合（实测差 0.0）。

### 1.4 闭环控制（plan §15.5）

`runClosedLoop(cfg)`：植物以 0.5 ms 步进，控制器以 4 ms 节拍（250 Hz）运行。

- 模拟 EEG：Pz 代理（µV）。
- 特征提取：`FeatureExtractor`，三种——`instant`（瞬时 Pz，µV）、
  `rms`（滑窗 RMS，µV）、`alphaPower`（Goertzel 单频功率，µV²，
  默认 10 Hz、252 ms 窗；标定：纯正弦幅值 A 在中心频率处功率 = A²/2，
  与 Morlet 同口径）。
- 状态判定 → 控制器：
  - 固定阈值：特征 > 阈值时输出固定控制量（默认 −80 1/s，负值 = 抑制），
    否则 0。
  - PID（位置式）：u = Kp·e + Ki·∫e dt + Kd·de/dt，e = 设定点 − 特征；
    抗饱和：输出饱和且误差会把输出进一步推向饱和时暂停积分
    （条件积分），另有积分钳制 `integralClamp`。
  - 输出单位 1/s，加在静息输入 p0 上（总输入钳制 ≥ 0）；默认范围
    [−90, 300] 1/s。
- 延迟：延迟线（4 ms 的整数倍），控制器输出经延迟后施加。
- 噪声：测量噪声按节拍序号索引、种子复现（与时间机器同款哈希）。
- 输出指标：触发占比、首触发时刻（ms）、相对首个事件的响应时延
  （ms）、控制峰值（1/s）、max|y0|（mV）、max|Pz|（µV）、RMS、
  发散标志。`compareControlVsNoControl` 做有控制/无控制数值对照。
- 一阶植物上的 PID 阶跃响应（`simulatePidStepResponse`，精确指数积分）
  是控制器本身的干净验证，与 JR 植物无关。

### 1.5 跨试次适应（PR6 残留，顺带实现）

可选 `adaptation: { utilization: U, tauRecMs: τ_rec }`（Tsodyks–Markram
式单资源模型）：每次事件起始消耗可用资源（有效驱动 = 设定驱动 ×
剩余资源，资源 ×= (1−U)），资源按 τ_rec 指数恢复。不开时试次独立
重启、无适应。实测：5 次重复驱动（300 1/s，间隔 200 ms，U=0.5，
τ_rec=1000 ms）有效驱动 300 → 177.20 → 126.93 → 106.35 → 97.93 1/s。

### 1.6 拉伸项：MNE 深度偏置（PR6 残留）

新模块 `app/src/lib/depthWeightedInverse.ts`（复用
`sourceLocalization.ts` 的 `buildLeadField` / `solveLinearSystem` /
`localizationErrorMm` / `gaussianNoise`，不改原文件）+
`scientific/eeg/depth_reference.py`（numpy 同公式）。

- 深度加权 MNE：R = diag(w_j²)，w_j = ||L_j||^(−depth)，depth 默认
  0.8（MNE 默认值；depth = 0 退化为 plain MNE，测试断言）。
- dSPM：对逆算子 G = R Lᵀ (L R Lᵀ + λ²σ²I)⁻¹ 做噪声归一化，
  dSPM_j = |s_j| / √(Σ_c (G C Gᵀ)_{j,c})，C = σ²I。
- eLORETA（标量近似）：w_j ← √(trace(B_j)/3)，B 为
  Lᵀ (L W⁻¹ Lᵀ + λ²σ²I)⁻¹ L 的第 j 个 3×3 对角块；完整版用块的矩阵
  平方根，这里是块迹平均近似。**关键修正**：权重方程是尺度不变的，
  每轮须把 w 按最大值归一化，否则迭代沿尺度方向坍缩到 1e-150、
  终解沦为任意峰（实测教训：不归一化时 20 轮后权重全为 1e-150，
  TS 与 Python 落在不同任意峰上）。归一化后 12 轮收敛
  （max 相对变化 < 1e-3）。权重迭代与数据 V 无关（只取决于
  lead field 与 λ），是不动点性质，不是 bug。

## 2. 控制律方程

JR 柱（与 `jansenRitColumn.ts` 同式，时间 ms、电位 mV、输入 1/s）：

```
y0' = y3, y1' = y4, y2' = y5
y3' = A·a·S(y1−y2) − 2a·y3 − a²·y0
y4' = A·a·(p/1000 + c2·S(c1·y0)) − 2a·y4 − a²·y1
y5' = B·b·c4·S(c3·y0) − 2b·y5 − b²·y2
S(v) = 2·e0 / (1 + exp(r·(v0−v)))，a = rateExc/1000，b = rateInh/1000
q = N·coherence·L·g·(y0 − y0_0)·1e-6 [nA·m]，Pz = q × 0.16 [µV]
```

适应（Tsodyks–Markram 单资源）：事件起始时 x *= (1−U)，其余时间
dx/dt = (1−x)/τ_rec；有效驱动 = 设定驱动 × x。

Goertzel 功率：窗内 N 采样，X = Σ x[n]·e^(−i2πfn/fs)，
功率 = (2|X|/N)²/2 [µV²]。

PID：u = Kp·e + Ki·∫e dt + Kd·de/dt，e = 设定点 − 特征，
u ∈ [−90, 300] 1/s（可配），条件积分抗饱和。

一阶植物阶跃响应：dx/dt = (u−x)/τ，步内 u 恒定用精确指数积分
x += (u−x)(1−e^(−dt/τ))。

深度加权 / dSPM / eLORETA：见 §1.6。

## 3. 验证数值

### 3.1 双脑对照

| 检查 | 实测值 |
|---|---|
| JR 步进器 vs `createJansenRitColumn` 预言机（自由运行 2000 ms，事件 120 1/s） | y0/q 差 0.0（逐值相同） |
| 同配置两次运行 | JSON 级相等 |
| TS vs Python 自由运行（4000 步） | y0 最坏差 8.3e-17 mV，q 7.8e-16 nA·m，Pz 1.2e-16 µV（容差 1e-9） |
| 双脑同配置 → 比较输出 | 全部差 0.0 |
| 双脑改驱动 120 → 300 1/s | y0 峰差 0.00689 mV，ERP 峰差 0.00898 µV（与 Python 一致到 1e-9） |
| PSD 峰移（p0=220 极限环 vs p0=90） | alpha 峰 10.99 Hz；基线是平坦不动点（沉降段方差 < 1e-12 mV²），PSD 峰对平坦信号无意义、不作峰位置断言 |
| 源定位对照（10-20，平均参考，无噪声） | 深源 [16,16,16]：偶极子 0 mm，MNE 55.43 mm；浅源 [48,48,48]：偶极子 0 mm，MNE 0 mm；MNE 误差差 −55.43 mm，分布范围差 −33.27 mm |

### 3.2 时间机器

| 检查 | 实测值 |
|---|---|
| 单步 | 一次 0.5 ms；暂停时不推进 |
| 快照恢复往返（JSON 序列化后恢复、重跑） | 分支点后轨迹差 0.0 |
| 回放 | 201 份快照（每 10 ms）；replay(900, 1100) = 21 份，快照值等于同一运行的 y0/q（差 0.0） |
| 分支比较（1000 ms 处驱动 120 → 300） | 分支前最大差 0.0；分支后最大差 0.0776 mV（10 ms 快照采样与 Python 一致到 1e-9；0.5 ms 全轨迹采样为 0.07760 mV，差约 5e-5 mV 是采样网格不同） |
| 跨试次适应 | 有效驱动 300 → 177.20 → 126.93 → 106.35 → 97.93 1/s（与 Python 一致到 1e-9） |

### 3.3 闭环控制

| 检查 | 实测值 |
|---|---|
| Goertzel 标定（幅值 5 µV 的 10 Hz 纯正弦） | 功率 12.5 µV²（差 < 1e-9） |
| PID 阶跃响应（一阶植物 τ=200 ms，kp=2、ki=10、设定点 1.0） | 超调 0%、安定 388 ms、稳态误差 7.1e-9（与 Python 一致） |
| 阈值触发（瞬时特征，阈值 0.1 µV，输出 −80 1/s，噪声 0.02 µV） | 首触发 1044 ms、响应时延 44 ms、触发占比 2.27%（与 Python 一致） |
| 延迟 40 ms | 首触发恰好后移 40 ms（1044 → 1084 ms，时延 84 ms） |
| 有控制 vs 无控制（阈值抑制） | RMS 差 −0.00163 µV（−5.7%），峰值差 −0.00178 µV（与 Python 一致到 1e-9） |
| 纯噪声误触发率（alpha 功率，阈值 0.05 µV²，噪声 0.5 µV） | 建窗后（t ≥ 300 ms）0.34%（< 1%）；全程 2.0% 来自前 252 ms 滑窗建窗期（窗未满、功率估计方差大） |
| 60 s 稳定性（闭环阈值，TS） | max\|y0\| = 0.158 mV，不发散，跑满 60 s（约 0.2 s 计算） |
| PID 调节行为（附带观察） | PID 跟踪设定点：特征低于设定点时输出正值、把活动往设定点上拉（rms 特征、设定点 0.05 µV 时 RMS 从 0.0284 升到 0.0558 µV）——这是设定点跟踪，不是抑制；阈值模式才是抑制 |

标定教训：阈值 0.5 µV 高于响应峰值（Pz 峰 ≈ 0.19 µV），控制器永不
触发；改用 0.1 µV + 噪声 0.02 µV 后正常触发。PID 一阶植物增益
kp=2、ki=1 时慢极点时间常数约 2.9 s、2 s 内稳态误差 0.12；ki=10
后安定 388 ms。

### 3.4 拉伸项：深度偏置前后对照

条件：10-20 导联、平均参考、λ² = 1/9、σ = 1.0 µV、无噪声（另有一组
0.5 µV 噪声，numpy 种子 7 的数据存进 fixture、TS 直接读存下的数据跑逆解）。

| 源 | plain MNE | depth 0.8 | dSPM | eLORETA 近似 |
|---|---|---|---|---|
| 深 [16,16,16]，无噪声 | 55.43 mm | 45.25 mm | 0.00 mm | 32.00 mm（12 轮收敛） |
| 浅 [48,48,48]，无噪声 | 0.00 mm | 0.00 mm | 55.43 mm | 78.38 mm |
| 深，0.5 µV 噪声 | 78.38 mm | 96.00 mm | 45.25 mm | 90.51 mm |
| 浅，0.5 µV 噪声 | 0.00 mm | 0.00 mm | 55.43 mm | 78.38 mm |

结论：没有一种方法同时修好深浅两端。深度加权只部分改善无噪声深源，
有噪声时反而更差；dSPM 修好深源但把浅源峰值推向深部网格点；
eLORETA 近似改善深源但坏浅源。残留仍在：粗网格（64 点）+ 平均参考
下的深度偏置未根治，需更密源网格 / 真实 BEM / 正则化调参，留给 PR8。

## 4. 测试

- `tests/pr7/experiments.test.mjs`：21 项，全绿（约 2.2 s）。
  跑法：`node --experimental-strip-types --test tests/pr7/experiments.test.mjs`。
  球形正向模型须先生成（`scientific/forward/generate_sphere_model.py`，
  CI 同款；缺失时测试按 PR6 同款报错退出，不静默跳过）。
- `tests/pr7/test_experiments.py`：16 项，全绿（约 4.7 s）。
  跑法：`~/workspace/eeg-venv/bin/python -m unittest discover -s tests/pr7 -p 'test_experiments.py' -v`。
- `tests/pr7/depth-weighted-inverse.test.mjs`：6 项，全绿。
- `tests/pr7/test_depth_weighted.py`：5 项，全绿。
- 类型检查：`npx tsc --noEmit`（app 目录）通过。
- Fixture：`tests/pr7/fixtures/experiments-reference.json`（由
  `reference/python-model/experiments_pr7.py --write-fixture` 生成）、
  `tests/pr7/fixtures/depth-reference.json`（由
  `scientific/eeg/depth_reference.py --write-fixture` 生成）。
  容差依据：TS/Python 同一 RK4、同一 float64 运算顺序，自由运行差
  实测 8e-16（Math.exp 与 math.exp 末位差异累积），容差 1e-9；
  分布范围相对 1e-6（TS 高斯消元 vs numpy 求解的末位差异）；
  分支分叉量全轨迹 vs 快照采样差约 5e-5 mV（采样网格不同），
  该项容差 1e-3 mV。均不是为通过而放宽。

## 5. 局限与残留

- 基线 RMS 仍是 0、alpha 占比 99.8% vs 真实 30.3%（PR6 已知缺口），
  不属本批范围，留给 PR8。
- Pz 代理幅度未经人体数据校准（PR5 假设链）；闭环效应量（RMS −5.7%）
  是同一假设链下的相对量，不宣称绝对生理效应。
- 极限环模式（p0=220）的 q 以沉降段 y0 均值为基线（与 PR6
  `runAlphaLimitCycle` 同口径）；不动点模式用不动点 y0 为基线。
- 闭环只在单柱 JR 植物上验证，未接全脑 Wilson–Cowan 网络、
  未接真实 EEG 数据；PID 在 JR 回路上的调节方向是设定点跟踪，
  不是通用“抑制”——用阈值模式做抑制对照。
- eLORETA 是标量近似（块迹平均），不是完整 3×3 块矩阵平方根版；
  深度偏置未根治（见 §3.4）。
- `ExperimentLab.tsx` 未接进 `App.tsx`（由总协调集成）；同步旋转
  需总协调接 BrainScene 的同步旋转 props，本组件只做数值对照表。
- 球形正向模型 `app/public/forward-assets/sphere-model.json` 是本地
  生成的（CI 同款脚本），不入库；测试缺失时报错退出。

## 6. 契约追加条目（给总协调写进 `frontend-backend-contract.md`）

> 以下条目由本模块新引入，参数名、范围、单位按此登记；总协调写入
> 契约 §1.9（PR-15）后，本模块的漂移测试由总协调补。

| 参数 | 符号 | 值 / 范围 | 单位 | 前端 | 后端 |
|---|---|---|---|---|---|
| 实验步长 | dt | 0.5（固定，不可调） | ms | `experiments.ts` `DT_MS` | Python `DT_MS = 0.5` |
| 控制器节拍 | — | 4（每 8 个植物步） | ms | `CONTROL_DT_MS` | Python `CONTROL_DT_MS = 4.0` |
| JR 静息输入 | p0 | 90（默认；220 为 ~10.5 Hz 极限环，须配 `limitCycle: true`） | 1/s | `ExperimentConfig.baselineInputPerS` | Python 同名 |
| 事件驱动 | drive | [0, 1000] | 1/s | `ExperimentEventInput.drivePerS` | Python 同名 |
| 事件时长 | — | > 0，0.5 的整数倍 | ms | `ExperimentEventInput.durationMs` | Python 同名 |
| 适应利用率 | U | (0, 1) | 无量纲 | `AdaptationConfig.utilization` | Python 同名 |
| 适应恢复 | τ_rec | > 0 | ms | `AdaptationConfig.tauRecMs` | Python 同名 |
| 快照间隔 | — | 10（默认），0.5 的整数倍 | ms | `TimeMachine.snapshotIntervalMs` | Python `snapshot_interval_ms` |
| Pz 代理增益 | — | 0.16（复用 PR6 `PZ_GAIN_UV_PER_NAM`） | µV/(nA·m) | `experiments.ts` | Python `PZ_GAIN_UV_PER_NAM = 0.16` |
| 特征窗 | — | 252（默认） | ms | `FeatureConfig.windowMs` | Python 同名 |
| 特征目标频率 | — | 10（默认） | Hz | `FeatureConfig.targetFreqHz` | Python 同名 |
| 阈值输出 | u_on | 默认 −80（负值 = 抑制） | 1/s | `ThresholdConfig.outputPerS` | Python 同名 |
| PID 输出范围 | — | [−90, 300]（默认） | 1/s | `PidParams.outputMinPerS/outputMaxPerS` | Python 同名 |
| 控制器延迟 | — | ≥ 0，4 的整数倍 | ms | `ClosedLoopConfig.delayMs` | Python `delay_ms` |
| 测量噪声 | — | ≥ 0（RMS） | µV | `ClosedLoopConfig.measurementNoiseRmsUv` | Python 同名 |
| 深度加权指数 | depth | [0, 2]，默认 0.8 | 无量纲 | `depthWeightedInverse.ts` `DEPTH_WEIGHT_DEFAULT` | Python `DEPTH_DEFAULT = 0.8` |
| eLORETA 迭代 | — | ≤ 20（默认），收敛阈值 1e-3（max 相对变化） | — | `eloretaInverse` | Python 同名 |
| 坐标系 | — | 位置 mm、偶极矩 nA·m、电位 µV、时间 ms、频率 Hz | — | 与契约 §0 一致 | 同左 |

函数映射（前端 → Python 对照）：
`runSingleExperiment` ↔ `run_single_experiment`；
`runAB`/`compareRuns` ↔ `run_ab`/`compare_runs`；
`TimeMachine` ↔ `TimeMachine`（step/step_to/restore/fork/replay）；
`PidController` ↔ `PidController`；`simulatePidStepResponse` ↔
`simulate_pid_step_response`；`runClosedLoop` ↔ `run_closed_loop`；
`compareControlVsNoControl`（TS 独有，无 Python 对照——由 fixture
数值覆盖）；`depthWeightedMneInverse`/`dspmInverse`/`eloretaInverse`/
`evaluateDepthMethods` ↔ `depth_weighted_mne`/`dspm`/`eloreta`/
`evaluate_case`。
