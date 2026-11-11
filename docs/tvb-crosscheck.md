# TVB 官方数值对照（PR1 任务 4）

用 TVB 官方 `tvb-library` 的 `WilsonCowan` 模型、官方 `Simulator`、
官方 `HeunDeterministic` 积分器，跑与我们的引擎等价的配置并逐点对照。
结论先行：**方程、参数、延迟、耦合定义全部对得上；逐点偏差的唯一
系统性来源是 TVB 在 Heun 校正步冻结延迟耦合，而我们的引擎在校正步
用一步更新的延迟耦合**——这一点已被因果验证（§7.3），不是猜测。
演示预设下的偏差 ≤ 2.5e-04，相对 0.48 的响应幅度可忽略；A-set 下
2.7e-02 的偏差只出现在网络翻向高态的瞬态爬升段，翻过去后两边回到
同一不动点（终态差 1.4e-10）。**没有为迎合 TVB 改引擎、改参数、
放宽容差。**

对照脚本：`reference/tvb-crosscheck/crosscheck.py`；
数字输出：`reference/tvb-crosscheck/outputs/crosscheck.json`
（另有运行日志 `outputs/run.log`）。
本报告关闭 `docs/validation.md` §9 的“未与 TVB 官方实现逐数对照”项。

## §0 环境与复现

| 项 | 实测值 |
|---|---|
| tvb-library | **2.10.0**（`pip show tvb-library`，2026-11-11 安装） |
| Python | 3.12.3 |
| numpy / scipy / numba | 2.5.4 / 1.18.1 / 0.68.1 |
| 我们的参照实现 | `reference/python-model/wilson_cowan.py`（Python ↔ Rust 最大偏差 3.33e-16，`docs/validation.md` §3；本次对照以 Python 实现为桥，不直接跑 Rust 二进制） |
| 连接矩阵 | `app/public/brain-assets/connectivity.json`（权重与长度，对角线已清零，权重浮点原值） |
| 运行耗时 | 全套 4 场景 + 探针 + 冻结验证约 7 秒 |

```bash
# 虚拟环境在 ~/tvb-venv（不在仓库内）。注意：任务原定 /tmp/tvb-venv，
# 但本机 /tmp 是 512 MB tmpfs，装 tvb-library（numpy/scipy/numba/
# matplotlib 等）中途即报 No space left on device，改放 ~/tvb-venv。
# 如 /tmp 够大，把下面路径换成 /tmp/tvb-venv 即可，其余不变。
~/tvb-venv/bin/python reference/tvb-crosscheck/crosscheck.py
# 输出数字到 stdout 与 reference/tvb-crosscheck/outputs/crosscheck.json
```

安装命令（已执行过）：`python3 -m venv ~/tvb-venv &&
~/tvb-venv/bin/pip install --no-cache-dir tvb-library`。
安装中途曾因 PyPI 大文件下载中断失败一次，重试后成功，与结果无关。

## §1 结论：四个场景的最大偏差

G = 0.35，dt = 1 ms，速度 3.0 mm/ms，初值 E = I = 0，噪声关闭。
自由运行 1000 ms；刺激场景 2000 ms，节点 40（lAMYG）幅度 2.0、
t ∈ [1000, 1100) ms。

| 场景 | 步数 | max\|ΔE\| | rms ΔE | max\|ΔI\| | 最大偏差位置 |
|---|---|---|---|---|---|
| 自由运行，A-set | 1000 | **2.726e-02** | 1.803e-03 | 1.514e-02 | t=59 ms，节点 2（rAMYG） |
| 刺激，A-set | 2000 | **2.726e-02** | 1.275e-03 | 1.514e-02 | 同上（刺激前已出现，见 §7.2） |
| 自由运行，演示预设 | 1000 | **7.458e-05** | 9.250e-06 | 1.221e-05 | t=42 ms，节点 59 |
| 刺激，演示预设 | 2000 | **2.490e-04** | 1.597e-05 | 7.814e-05 | t=1034 ms，节点 59 |

关键对照点（不是偏差，是两边一致的证据）：

- 刺激节点 40 的峰值 E：A-set 自由运行两边同为 0.4969；
  A-set 刺激两边同为 0.4997；演示预设刺激 TVB 0.494194、我们 0.494196
  （差 2.3e-06）。
- A-set 终态全网均值 E：TVB 0.487958981004、我们 0.487958981003
  （差 1.4e-12）——两边翻向同一个高不动点。
- 演示预设终态全网均值 E：TVB 0.014884620447、我们 0.014884620645
  （差 2.0e-10）。

## §2 TVB 源码实测（tvb-library 2.10.0）

以下均逐行核对过 `~/tvb-venv/lib/python3.12/site-packages/tvb/` 内的
源码，不是按文档转述。文件行号以 2.10.0 安装包为准。

### 2.1 WilsonCowan 模型（`simulator/models/wilson_cowan.py`）

- `state_variables = ['E', 'I']`，`_nvar = 2`，`cvar = [0, 1]`；
  `stvar` 默认为 `None`，`configure()` 时置为 `cvar` 的拷贝，即 `[0, 1]`
  （这对刺激语义有决定性影响，见 §6）。
- `dfun` 走 numba 核 `_numba_dfun`（`guvectorize`），方程与我们的
  `docs/model-spec.md` §2 完全一致：
  `x_e = α_e·(c_ee·E − c_ei·I + P − θ_e + coupling + lc_E + lc_I)`，
  `x_i = α_i·(c_ie·E − c_ii·I + Q − θ_i + lc_E + lc_I)`，
  其中 `lc_E = local_coupling·E`、`lc_I = local_coupling·I`；
  I 方程用的是 `c_ii·I`（在线文档写成 `c_ee·I` 是笔误，以源码为准，
  与 model-spec §2 的结论一致）。
- **局部耦合 `local` 同时进入 E、I 两个方程**（TVB 源码如此）。
  本对照与我们的引擎一样取 `local = 0`（无表面仿真时
  `Simulator._prepare_local_coupling()` 返回 `0.0`），故无影响。
- **纠正 model-spec §2 的一处旧结论**：Phase 0 曾写“当前 master 源码
  全文无 `shift` 字样”。2.10.0 里 `shift_sigmoid` 不仅存在，而且是
  `WilsonCowan` 的正式参数，**默认值 `True`**：
  为真时 sigmoid 改为 `S(x) − S(0)` 的形式，即
  `s_e = c_e·(1/(1+exp(−a_e·(x_e−b_e))) − 1/(1+exp(a_e·b_e)))`，
  使得 `S(0) = 0`、E = I = 0 成为不动点。我们的引擎实现的是
  **不移位**的形式，相当于 `shift_sigmoid = False`，本次对照明确把
  TVB 侧设为 `False`（映射表 §3）。用默认值 `True` 跑会得到另一套
  动力学，不可比——这不是引擎 bug，是参数化差异，见 §8。
- 代码默认值（`NArray` 的 `default`）与 A-set 一致：
  c_ee 12、c_ei 4、c_ie 13、c_ii 11、τ 10、a_e 1.2、b_e 2.8、a_i 1.0、
  b_i 4.0、θ 0、c_e/c_i 1、r/k/α 1、P/Q 0。文档 Table 0 的 B 套
  （Wilson & Cowan 1972 图 4）只是文献值，不用。
- `state_variable_range = {E: [0, 1], I: [0, 1]}` 只用于随机初值的
  取值范围；本次传入显式零初值，不用它。
- `WilsonCowan` **没有定义 `state_variable_boundaries`**（基类默认
  `None`），因此积分器的 `integration_bound_and_clamp` 在本次运行中
  是空操作——**TVB 侧没有任何钳制**（脚本已断言
  `integrator_boundaries is None`）。E/I 超出 [0, 1] 也不会被钳回，
  本次运行中 E ∈ [0, 0.5]、I ∈ [0, 0.27]，钳制问题本来也不触发。

### 2.2 积分器（`simulator/integrators.py`）

- `Simulator` 默认积分器就是 `HeunDeterministic`，默认 `dt` 为
  0.01220703125 ms（为 1024 Hz 采样设计）；本次显式设 `dt = 1.0`。
- `HeunDeterministic.scheme`（第 296–318 行）：
  ```python
  m_dx_tn = dfun(X, coupling, local_coupling)
  inter = X + self.dt * (m_dx_tn + stimulus)
  self.integration_bound_and_clamp(inter)
  dX = (m_dx_tn + dfun(inter, coupling, local_coupling)) * self.dt / 2.0
  X_next = X + dX + self.dt * stimulus
  ```
  与我们的 Heun 预测—校正同阶同构，但有两处结构差异（§4）：
  一是 `stimulus` 以 `dt·stimulus` 的形式加在状态上、**在 `dfun`
  之外**；二是两次 `dfun` 调用共用**同一个** `coupling` 数组。
- 噪声：`HeunDeterministic` 是确定性积分器，无噪声项；本次不用
  `HeunStochastic`，噪声即关闭，与我们的 `noise_amp = 0` 对应。

### 2.3 耦合（`simulator/coupling.py`）

- `Linear(SparseCoupling)`：`pre = x_j`，`post(gx) = a·gx + b`，
  即 `coupling = a·Σ_j C_ij·E_j(t−d_ij)`，与我们的
  `G·Σ C_ij·E_j(t−d_ij)` 同构，`a` 对应 `G`。
- **2.10.0 里 `Linear.a` 的默认值是 0.00390625**，不是 model-spec
  §8.2 写的 0.0042（那是更早版本的默认值）。本次显式设 `a = 0.35`、
  `b = 0`。用默认值跑传播不可见，与 validation §2 的实测一致。
- 耦合变量 `cvar = [0, 1]`：历史里 E、I 都存，但 `Linear.pre` 只取
  `x_j`——实际求和用的是 `cvar` 选出的变量；`SparseCoupling`
  按 `history.query_sparse` 返回的延迟状态求和，权重取自
  `connectivity.weights` 的非零元，不做归一化。

### 2.4 连接与延迟（`datatypes/connectivity.py`）

- `speed` 默认 `array([3.0])`，本次显式设 3.0 mm/ms。
- `configure()`：`delays = tract_lengths / speed`。
- `set_idelays(dt)`（第 308–326 行）：
  `idelays = numpy.rint(delays / dt).astype(int32)`，即四舍五入、
  .5 向偶数舍入，与我们的 `round_ties_even` **逐字同一规则**。
  `horizon = idelays.max() + 1`。
- 本资产上实测：TVB 的 `idelays` 与我们的 `build_idelays` 在
  **全部 1494 条权重 > 0 的边上完全相等**（最大差 0），最大延迟
  46 步，horizon 47。权重为 0 的边 TVB 的 idelay 也是 0——因为本
  资产的长度矩阵只在权重 > 0 的边上保留长度，其余为 0，延迟恒为 0；
  所谓“TVB 也给零权重边算延迟”的差别在本资产上不存在。

### 2.5 历史与监视器

- `SparseHistory.query_sparse(step)`：延迟状态取自环形历史缓冲的
  `(step−1−idelay) mod horizon` 行；初值历史填零，t < 0 读初值。
  与我们的“步数 < 0 读初值”一致（§5 有时间标签的细节）。
- `Raw` 监视器：`period` 被忽略，每积分步记录一次；
  `variables_of_interest = ("E", "I")` 须显式设在模型上，否则
  默认只录 E。本次两变量都录。

## §3 参数映射表

TVB 官方参数名 ↔ 我们的参数名/值，逐个对应（A-set；演示预设只改 θ_e）。

| TVB（`WilsonCowan` / `Linear` / `Connectivity` / 积分器） | 我们（`Params`） | 值（A-set / 演示预设） | 备注 |
|---|---|---|---|
| `c_ee` | `c_ee` | 12.0 | 代码默认值即 A-set |
| `c_ei` | `c_ei` | 4.0 | |
| `c_ie` | `c_ie` | 13.0 | |
| `c_ii` | `c_ii` | 11.0 | I 方程用 `c_ii`，文档笔误除外 |
| `tau_e`, `tau_i` | `tau_e`, `tau_i` | 10.0 ms | |
| `a_e` | `a_e` | 1.2 | |
| `b_e` | `b_e` | 2.8 | |
| `a_i` | `a_i` | 1.0 | |
| `b_i` | `b_i` | 4.0 | |
| `theta_e` | `theta_e` | 0.0 / **1.0** | 演示预设唯一改动 |
| `theta_i` | `theta_i` | 0.0 | |
| `c_e`, `c_i` | `c_e`, `c_i` | 1.0 | |
| `r_e`, `r_i` | `r_e`, `r_i` | 1.0 | |
| `k_e`, `k_i` | `k_e`, `k_i` | 1.0 | |
| `alpha_e`, `alpha_i` | `alpha_e`, `alpha_i` | 1.0 | |
| `P`, `Q` | 刺激事件的幅度（`P`，见 §6） | 0 / 脉冲时 P[40]=2.0，Q 恒 0 | TVB 的 `P` 是静态模型参数，时变靠分段切换 |
| `shift_sigmoid` | （无此参数；我们的 sigmoid 不移位） | TVB 侧显式设 **False** | 默认 True 会改变方程，见 §2.1 |
| `Linear.a` | `G` | 0.35 | TVB 默认 0.00390625，不用 |
| `Linear.b` | — | 0.0 | |
| `Connectivity.speed` | `speed` | 3.0 mm/ms | TVB 默认值 |
| `HeunDeterministic.dt` | `dt` | 1.0 ms | TVB 默认 0.0122 ms，不用 |
| 局部耦合 `local_coupling` | `local` | 0.0 | 无表面仿真时 TVB 返回 0.0；且 TVB 的 local 同时进 E、I 方程 |
| 噪声 | `noise_amp` | 0（关闭） | 确定性 Heun，无噪声项 |
| 初值 | `e0`, `i0` | E = I = 0（全部 76 节点，47 步历史全零） | 显式初值，不用随机初值 |
| `state_variable_range` | — | E/I [0, 1] | 只框随机初值，本次不用 |
| `state_variable_boundaries` | — | 无（`None`） | 积分器钳制为空操作 |

## §4 积分器：同为 Heun，但耦合的更新时点不同

这是**唯一**的系统性差异来源，其余全部对齐后它解释了全部偏差（§7.3）。

我们的引擎（`crates/brain-core/src/lib.rs`，`reference/python-model/wilson_cowan.py`）：

```
d1 = f(E, I, coupling(s),   P)        # 预测步：延迟耦合取自 step s
E* = E + dt·d1
d2 = f(E*, I*, coupling(s+1), P)      # 校正步：延迟耦合取自 step s+1
E' = E + dt/2·(d1 + d2)
```

TVB（`HeunDeterministic.scheme` + `Simulator.__call__`）：每步先由
`_loop_compute_node_coupling(step)` 从历史算出**一个**耦合数组
`coupling(s)`，两次 `dfun` 共用它：

```
d1 = f(X,   coupling(s))              # 预测步
X* = X + dt·(d1 + stimulus)
d2 = f(X*,  coupling(s))              # 校正步：耦合不更新
X' = X + dt/2·(d1 + d2) + dt·stimulus
```

即 TVB 的校正步用的延迟耦合比我们的**滞后一步**：对延迟 d 的边，
TVB 校正步用 `E_j(s−d)`，我们用 `E_j(s+1−d)`。本资产最小延迟 2 步，
故不存在 `idelay = 0` 时读预测值的分叉；差异纯粹是这一项的一步滞后。
从数值积分的角度看，两种做法都是 Heun 的合法变体（TVB 把耦合当作
步内冻结的外生输入，我们把它当作状态依赖项在校正步刷新），没有
谁对谁错；但数字上它们不等价，偏差量级见 §7。

## §5 延迟与时间标签

- 延迟规则逐字相同（§2.4），最大延迟 46 步，horizon 47。
- 一个 TVB 特有的时间标签细节：传入 N 行初值历史后，
  `configure()` 使 `current_step = N−1`（这里是 46），Raw 监视器的
  第一个采样点标为 t = 47 ms，尽管它是 t = 0 之后的第一个积分步。
  初值历史 47 行全是零，标签平移是精确的（不是近似），脚本在每段
  都断言偏移恒为 46 ms 并减掉它；分段续跑（§6）同样处理。
  对齐后两边时间网格逐点相等（`assert np.array_equal` 通过）。

## §6 刺激：`Simulator.stimulus` 不能复现我们的脉冲

### 6.1 TVB 的刺激入口不是 P

`Simulator.stimulus`（如 `StimuliRegion`）的时空模式经
`_loop_update_stimulus` 写进 `stimulus[model.stvar, :, :]`。
WilsonCowan 的 `stvar = [0, 1]`（`configure()` 后实测），即刺激
同时写到 E、I 两行；随后 `HeunDeterministic.scheme` 把它以
`dt·stimulus` 加到状态上，**在 `dfun` 之外**（§2.2 代码）。
也就是说 TVB 的 stimulus 是直接加在 `dE/dt`、`dI/dt` 上的外加
驱动，单位是“状态变量/毫秒”，不是 Wilson–Cowan 方程里的外部
输入 P。

### 6.2 探针：一步的差别是 177 倍

对官方 `HeunDeterministic.scheme` 做单步探针（零状态、零耦合、
dt = 1 ms，`shift_sigmoid = False`）：

| | 一步后节点 40 的 ΔE |
|---|---|
| TVB stimulus = 2.0（只写 E 行，最好情况） | **1.8513** |
| TVB stimulus = 0 | 0.00325 |
| 我们的引擎 P = 2.0（进 sigmoid 内） | **0.01045** |

`StimuliRegion` 幅度 2.0 一步就把 E 推高 1.85，而我们的 P 脉冲
第一毫秒只推高 0.010——两者不是同一物理量，调幅度也无法换算
（TVB stimulus 的响应不经过 sigmoid 的阈值/饱和，形状完全不同；
且它还会同时驱动 I，除非手动把 `stvar` 改成 `[0]`，那已不是
官方默认行为）。因此 **`Simulator.stimulus` 路线判定为不可比**，
没有用它跑对照场景。

### 6.3 刺激场景实际用的等价路线：分段切换模型 P

TVB 的 `P` 是静态模型参数，但 `WilsonCowan.dfun` 每次调用都重读
`self.P`，且 `P` 可取逐节点数组（`ModelNumbaDfun` 的空间化规则
允许长度 76 的参数）。刺激场景因此用官方 `Simulator` 分三段续跑，
段间切换逐节点 `P`：

1. 0–1000 ms：`P = 0`（全部节点）；
2. 1000–1100 ms：`P[40] = 2.0`，其余为 0；
3. 1100–2000 ms：`P = 0`。

这正是我们的引擎在 t ∈ [1000, 1100) 施加的 `P(t)`，经过的是官方
的 `dfun`、官方耦合、官方历史、官方积分器。切换点与我们的事件
边界逐毫秒对齐（段 2 的第一步用 P = 2.0，段 3 的第一步用 P = 0）。
验证：演示预设下刺激峰值 TVB 0.494194、我们 0.494196（§1），
且 §7.3 的冻结验证在刺激场景同样通过（2.0e-09），说明 P 切换
确实按预期生效。

## §7 结果与每一个系统性差异的解释

### 7.1 偏差的时间剖面

`max|ΔE|` 随时间的变化（全部节点的最大值）：

| t（ms） | A-set 自由/刺激 | 演示预设自由 | 演示预设刺激 |
|---|---|---|---|
| 10 | 6.6e-05 | 4.7e-06 | 4.7e-06 |
| 30 | 4.3e-03 | 6.1e-05 | 6.1e-05 |
| 59 | **2.7e-02** | 6.3e-05 | 6.3e-05 |
| 100 | 1.7e-03 | 3.4e-05 | 3.4e-05 |
| 200 | 1.3e-10 | 4.2e-06 | 4.2e-06 |
| 500 | 1.4e-10 | 2.7e-09 | 2.7e-09 |
| 1000 | 1.4e-10 | 1.2e-09 | 1.2e-09 |
| 1034 | — | — | 2.5e-04 |
| 1100 | — | — | 1.8e-04 |
| 2000 | — | — | 1.2e-09 |

读法：

- **A-set**：偏差在网络从零态爬向高态的陡峭段（t ≈ 30–60 ms）
  迅速放大到 2.7e-02（节点 2，rAMYG，强连接节点先翻），翻过去后
  指数衰减到 1.4e-10——两边收敛到同一高不动点，终态一致。
  A-set 刺激场景的最大偏差与自由运行**完全相同**（同一 t、同一节点），
  因为刺激开始时（t = 1000 ms）网络早已饱和在高态，脉冲几乎不起作用
  （t = 1034 ms 时偏差仅 1.2e-07）。这符合 validation §1 的双稳态结论。
- **演示预设**：系统强收缩（唯一稳定点），偏差全程 ≤ 2.5e-04，
  刺激响应段（t = 1034 ms，节点 59）达到峰值后衰减回 1.2e-09。
  相对 0.48 的响应峰值，最大偏差为 0.05%。

### 7.2 为什么 A-set 的偏差比演示预设大 100 倍

不是方程对不上，而是同一处一步滞后在不同动力学下的放大倍数不同：
A-set 单节点在低不动点附近有鞍点方向，网络爬升段对耦合的时点
敏感，微小的时间滞后被正反馈放大成 2.7e-02 的相位差；演示预设
（θ_e = 1.0）是强收缩的，滞后不放大。§7.3 的因果验证证实了这一点。

### 7.3 因果验证：冻结耦合变体复现 TVB 到 1e-08

只改我们的引擎一处——校正步复用预测步的延迟耦合矩阵
（即 TVB 的做法），其余逐行不变——再与 TVB 对照。
该变体在脚本里叫 `frozen_run`，是交付物的一部分：

| 场景 | 冻结变体 vs TVB max\|ΔE\| | 冻结变体 vs TVB max\|ΔI\| | 我们的引擎 vs TVB max\|ΔE\| |
|---|---|---|---|
| 自由运行，A-set | **1.37e-08** | 7.00e-09 | 2.726e-02 |
| 自由运行，演示预设 | **1.23e-09** | 2.32e-10 | 7.458e-05 |
| 刺激，演示预设 | **2.02e-09** | 7.71e-10 | 2.490e-04 |

冻结前后偏差缩小 6 个数量级：**全部系统性偏差来自 §4 的耦合
更新时点，别无其他来源**。方程、参数、延迟、初值、刺激路线
至此全部排除。

### 7.4 冻结后残余的 1e-08 / 1e-09 是什么

不是未解释的差异，是浮点求和顺序与 `exp` 实现的机器噪声：
TVB 的 `SparseCoupling` 用 `reduceat` 按非零元顺序求和，我们的
NumPy 实现用 `np.sum` 按行求和；numba 核的 `exp` 与 NumPy/Rust
的 `exp` 在最后 1 ulp 上也可能不同。残余量级（≤ 1.4e-08）比
结构效应小 6 个数量级，且在演示预设下只有 1e-09，不作进一步追查。

### 7.5 没有钳制、没有归一化、没有隐藏项

逐项核实，均无影响：`state_variable_boundaries` 为 `None`
（§2.1），积分器不钳制；权重不归一化（§2.3）；`local = 0`；
噪声关闭；`state_variable_range` 只框随机初值，本次用显式零初值。
延迟在权重 > 0 的边上逐项相等（§2.4）。

## §8 不可比的部分（明说，不凑数字）

1. **`Simulator.stimulus` 路线不可比**（§6）：刺激加在 `dX/dt` 外、
   同时驱动 E 和 I，单位与 P 不同；一步探针差 177 倍。刺激场景
   改用 §6.3 的分段 P 切换路线，并标注了该路线。
2. **`shift_sigmoid = True`（TVB 默认）不可比**：它改变 sigmoid 本身
   （S(0) = 0），我们的引擎没有这个开关；对照把 TVB 侧显式设为
   `False`。用默认值跑会得到另一套动力学，不应与我们的数字直接比较。
3. **TVB 默认 `Linear.a = 0.00390625`、默认 `dt ≈ 0.0122 ms`、默认
   B 套参数**均未采用——它们是为静息态 fMRI / 文献图 4 而设的，
   与本产品的配置无关；映射表 §3 列明了实际采用的值。
4. **TVB 的随机噪声模型未对照**：本次用确定性 Heun，噪声关闭；
   我们的均匀白噪声（加在 P 上）与 TVB 的 `HeunStochastic` 噪声
   （加在状态上）语义不同，需另行对照，不在本任务内。
5. **Rust 引擎未直接跑 TVB 对照**：本次以 Python 参考实现为桥；
   Python ↔ Rust 已有 3.33e-16 的对照（`docs/validation.md` §3），
   桥接误差比本次最小偏差（7.5e-05）小 11 个数量级，可忽略。
   如需 Rust 直连，可把 `compare.py` 的 Rust 输出接进来，数字预期不变。
6. **B 套参数与振荡预设（TVB 文档 Table 1）未跑**：不在产品配置内。

## §9 对产品的含义

- **引擎不用改。** 我们的校正步刷新耦合是 Heun 的标准做法
  （把耦合当作状态依赖项），TVB 冻结耦合是把耦合当作步内冻结的
  外生输入；两者都是合法实现，产品默认（演示预设）下差异 ≤ 2.5e-04，
  远小于响应本身（0.48）与旋钮步进，不影响任何 Phase 3/4 已验证
  的行为。
- A-set 下 2.7e-02 的瞬态偏差是同一机制在双稳态翻转段的放大，
  终态一致；且 A-set 本来就不是产品默认（点击即锁死，见
  `docs/validation.md` §1），该数值的唯一作用是解释，不是告警。
- 顺带纠正两处旧文档：model-spec §2 “源码无 `shift`” 的说法在
  2.10.0 下不成立（`shift_sigmoid` 存在且默认 True）；§8.2 的
  “TVB 默认斜率 0.0042”在 2.10.0 下是 0.00390625。
  建议 PR1 后续把这两处随手订正（不属于本任务的改动范围，未动）。

## 附录：文件清单

- `reference/tvb-crosscheck/crosscheck.py`——对照脚本（含参数映射、
  TVB 侧搭建、P 分段切换、刺激语义探针、冻结耦合因果验证）。
- `reference/tvb-crosscheck/outputs/crosscheck.json`——全部数字
  （版本、配置、探针、4 场景指标与剖面、检查项、冻结验证）。
- `reference/tvb-crosscheck/outputs/run.log`——末次运行的 stdout。
- 未改动任何产品代码、引擎数学与默认参数；虚拟环境在 `~/tvb-venv`，
  不在仓库内。
