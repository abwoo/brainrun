# 前后端契约（Frontend–Backend Contract）

> **状态：** PR5（`feat/pr5-physics-core`，HEAD `3261673`）定稿，2026-11-11 核实。
> **适用范围：** brainrun 2.0 PR-04+05+06（物理核心）及后续 PR5–PR8 全程。
> **规则来源：** 用户 2026-11-11 22:53 定——前端（React/Three.js 界面、`app/src/lib/*.ts`、Worker 协议）与后端（Rust/WASM 引擎、Python 对照、`scientific/forward` 的 MNE 模型）共用同一份契约；改任一侧时同步改契约与另一侧，并用测试卡住漂移。
> **测试节奏新规（2026-11-11 22:57 用户定）：** 每轮 PR 只保留该轮必需的方法学测试 + 构建通过 + 新功能冒烟；全面回归、浏览器交互全套、前端布局全面扫查、性能、五维验收、十个演示全部推迟到 PR8 合并之后做一次最终大测试。本契约的漂移测试（`tests/pr5/contract.test.mjs`）属于方法学测试（单位与坐标正确性），按新规保留。布局正确性要求见 §9——新界面按契约做对、不留已知遮挡，全面扫查留到最后。
>
> **核实方法：** 本文件所有数值、范围、单位均从源码读出（文件行号见各表），未核实的写“未核实”，不编造。漂移测试 `tests/pr5/contract.test.mjs` 直接读两边源码/导出值做对照。

## 0. 单位与符号总则

| 量 | 符号 | 单位 | 说明 |
|---|---|---|---|
| 长度 / 位置 / 半径 | — | mm（毫米） | 所有坐标一律 mm；Python 生成脚本里以 m 为单位的量（`ORIGIN_M`、`RADIUS_M`）只在生成时出现，进 fixture 前一律 ×1000 |
| 偶极矩 | q / moment | nA·m（纳安·米） | 前端三个实验的滑杆、局部皮层柱输出、lead field 输入均为 nA·m |
| 电位 | V | µV（微伏） | lead field 增益单位 µV/(nA·m)；`V = gain · q` |
| 电导率 | σ | S/m | 均匀导体默认 0.33；四层球 σ = (0.33, 1.0, 0.004, 0.33) S/m（脑、脑脊液、颅骨、头皮） |
| 时间 | t | ms（毫秒） | 仿真时钟固定步长 `dt = 1 ms`；快照时间戳 `t_ms` |
| 频率 | f | Hz | 正弦驱动 10 Hz；MNE fixture 生成时 `sfreq=250 Hz`（仅生成参数，不进入产品） |
| 神经活动 E / I | E, I | 无量纲（0–1 速率分数） | Wilson–Cowan 群体发放率；ΔE 阈值 0.01 亦无量纲 |
| 模型输入 P | P | 模型单位 | 刺激幅度、偏置、OU 驱动、正弦驱动全部以“P 的模型单位”计，不换算成物理电流 |
| 耦合权重 C | C_ij | 无量纲（TVB 原始权重 0–3） | 对角线恒为 0 |
| 延迟 | idelay | 步数（= ms，因 dt=1） | `idelay = rint((length/speed)/dt)`，round-half-to-even，TVB 规则 |

**换算链（唯一允许的换算）：** `pA × mm = 1e-6 nA·m`（局部皮层柱，见 §1.5）；MNE 原始正向矩阵 `V/(A·m) → µV/(nA·m)` 乘 `1e-9 × 1e6 = 1e-3`（`scientific/forward/generate_sphere_model.py`）。除此之外禁止任何隐式单位换算。

---

## 1. 参数总表

### 1.1 Wilson–Cowan 引擎固定参数（A-set + demo 预设，无 UI 控件）

来源：`crates/brain-core/src/lib.rs` `Params::default()`（L152–193）、`Params::demo()`（L201–210）。前端无对应控件——这些值是产品常量，改动即改模型，必须同步改 `docs/model-spec.md` 与本契约。

| 参数 | 符号 | 值 | 单位 | 前端 | 后端 |
|---|---|---|---|---|---|
| 兴奋自耦合 | c_ee | 12.0 | 无量纲 | 无控件 | `Params.c_ee` |
| 抑制自耦合 | c_ei | 4.0（默认；可调见 §1.2） | 无量纲 | EXC/INH 滑杆 | `Params.c_ei` |
| 兴奋→抑制 | c_ie | 13.0 | 无量纲 | 无控件 | `Params.c_ie` |
| 抑制自耦合 | c_ii | 11.0 | 无量纲 | 无控件 | `Params.c_ii` |
| 时间常数 | τ_e / τ_i | 10.0 / 10.0 | ms | 无控件 | `Params.tau_e/tau_i` |
| Sigmoid 参数 | a_e/b_e/a_i/b_i | 1.2 / 2.8 / 1.0 / 4.0 | 无量纲 | 无控件 | `Params.a_e/b_e/a_i/b_i` |
| 阈值 | θ_e / θ_i | **1.0** / 0.0 | 无量纲 | 无控件 | `Params.theta_e/theta_i` |
| θ_e 说明 | — | A-set 原值 0.0；demo 预设改为 1.0（消掉高分支不动点，E\*≈0.011） | — | — | `Params::demo()` |
| 其余 sigmoid 系数 | c_e/c_i/r_e/r_i/k_e/k_i/α_e/α_i | 全部 1.0 | 无量纲 | 无控件 | `Params` 同名字段 |
| 全局耦合 | G | 0.35（默认；可调见 §1.2） | 无量纲 | CONNECTIVITY 滑杆 | `Params.g` |
| 传导速度 | speed | 3.0 | mm/ms | 无控件 | `Params.speed`（TVB Connectivity.speed 默认） |
| 积分步长 | dt | 1.0 | ms | 无控件 | `Params.dt`（固定，不可调） |
| 白噪声幅 | noise_amp | 0.0 | P 模型单位 | 无控件 | `Params.noise_amp`（0 = 确定性） |
| 恒定背景输入 | drive_const | 0.0 | P 模型单位 | 无控件 | `Params.drive_const`（进快照、RESET 保留；与 PR3 偏置不同，偏置 RESET 清除） |
| 节点数 | n | 76 | — | 固定 | `WasmSim::new` 钉死 76（`crates/brain-wasm/src/lib.rs` L48–52，`Params::demo()` 构造） |

### 1.2 四个主滑杆（`App.tsx` + `ParamControl.tsx`，经 `KNOB_MAP` 映射）

映射定义：`app/src/lib/simClient.ts` `KNOB_MAP`；默认值 `DEFAULT_PARAMS`；滑杆本身是归一化 k∈[0,1]（`ParamControl` range 0–1000，步进 1，即 k 步进 0.001；滚轮步进 0.02，Shift 0.1；双击恢复默认 k）。数字框输入映射后的实际值，越界 clamp 到 min/max 再反推 k。

| 控件（App.tsx） | 参数 | 映射公式（k∈[0,1]） | UI 范围（数字框 min/max，inputStep） | 默认值 | 引擎 clamp（WASM） | Worker 消息 |
|---|---|---|---|---|---|---|
| STIMULUS | stim_amplitude（刺激幅度） | `0.5·4^k`（非线性） | 0.5–2.0，step 0.01 | 2.0（k=1） | **0–4.0**（见残留 R1：引擎比 UI 宽） | `set_params {stim_amplitude}` → `WasmSim::set_stim_amplitude`（L160） |
| DURATION | stim_duration_ms（脉冲持续） | `20 + k·480`（线性） | 20–500 ms，step 1 | 100 ms | 20–500 | `set_params {stim_duration_ms}` → `set_stim_duration_ms`（L169） |
| EXC/INH | c_ei（抑制自耦合） | `3 + k·5`（线性） | 3–8，step 0.1 | 4.0 | 3–8 | `set_params {c_ei}` → `set_c_ei`（L149） |
| CONNECTIVITY | G（全局耦合斜率） | `k·0.4`（线性） | 0–0.4，step 0.01 | 0.35 | 0–0.4 | `set_params {g}` → `set_g`（L139） |

一致性要求：`KNOB_MAP.<x>(0/1)` 必须等于 UI min/max；UI min/max 必须是引擎 clamp 的子集（理想是相等；stim_amplitude 例外，见 R1）。反向映射 `stimulusK/durationK/c_eiK/gK` 必须与正向映射互逆（漂移测试覆盖）。

### 1.3 背景活动模式（PR4）

UI：`App.tsx` BACKGROUND 面板三按钮（Quiet / Spontaneous / Oscillatory）→ `SimClient.setBackgroundMode(mode)` → Worker `set_background_mode` → `WasmSim::set_background_mode(mode: u8)`（`crates/brain-wasm/src/lib.rs` L199–214）。编码：Quiet=0，Spontaneous=1，Oscillatory=2；越界值忽略（模式不变）。Worker 回 `mode_applied`（见 §3），UI 只显示引擎回传的 `ModeParams`，不自己写死数字。

| 模式 | 机制 | 参数（固定常量，无 UI 控件） | 默认模式 |
|---|---|---|---|
| quiet | 无背景输入 | — | 否 |
| spontaneous | 每节点 OU 过程加入 P：`dx = −(x/τ)dt + σ·√(2dt/τ)·N(0,1)`，Euler–Maruyama，每步推进一次 | τ = `ou_tau_ms` = **100 ms**；σ = `ou_sigma` = **0.10** P 模型单位（`Params::default()`） | **是**（`DEFAULT_BACKGROUND_MODE = 'spontaneous'`） |
| oscillatory | 全脑同相外部正弦驱动 `P_sine(t) = amp·sin(2π·f·t)`，t 为绝对仿真时间 | amp = `ext_sine_amp` = **0.30**，f = `ext_sine_freq_hz` = **10 Hz**（`Params::oscillatory()`，L231–240；切到该模式时 WASM 从预设重载这两个值，`set_background_mode` L201–208） | 否 |

注意：Oscillatory 是**明确标注的外部驱动**，不是自发节律——该 Wilson–Cowan 参数族经扫描无稳定自发极限环。σ=0.20 会在 1.3–35.9 s 内锁死、σ=0.15 在变点击时间下 2/24 翻转，均已被实测否决；0.10 是通过全部三项安全检查的最大 σ（见 `simClient.ts` 内 `DEFAULT_BACKGROUND_MODE` 注释）。

种子：UI 数字框（min 0，step 1，无 max）→ `SimClient.setSeed`（`max(0, floor(v))`）→ Worker `set_seed` → `WasmSim::set_seed` → `Simulator::reseed`（`crates/brain-core/src/lib.rs` L486）：只改后续 RNG 抽取，不动 E/I、OU 状态、权重、偏置；要从头重跑须再点 RESET（RESET 按 `params.seed` 重置 RNG）。

### 1.4 权重 / 偏置 / 锁定 / 按住（PR3–PR4）

| 项目 | 前端 | 范围 / 阈值 | 后端 |
|---|---|---|---|
| 连接权重 C_ij | REGION 面板 `ValueSlider`（min/max 取 `WEIGHT_MIN/MAX` 常量，step 0.05，3 位小数）→ `SimClient.setWeight(i,j,w)` | **0–3**，越界 clamp；**单边**修改（只改 C_ij，不改 C_ji）；对角线恒 0（拒绝修改）；RESET 保留已改权重，只能由恢复动作改回 | `Simulator::set_weight`（brain-core L576；`WEIGHT_MIN/MAX` L550–551）、`WasmSim::set_weight`（L298）；恢复：`reset_weight` / `reset_all_weights` |
| 持续偏置 bias | REGION 面板开关 + 滑杆（`BIAS_MIN/MAX`，step 0.05）→ `SimClient.setBias` | **−1–+1** P 模型单位，越界 clamp；0 = 清除；开启默认值 `BIAS_DEFAULT_ON = +0.5`；RESET 清除（与权重不同） | `Simulator::set_bias`（brain-core L614；`BIAS_MIN/MAX` L553–554）、`WasmSim::set_bias`（L331）；`clear_bias` / `clear_all_bias` |
| 锁定判断 | 锁定横幅（读快照 `locked`） | 全网平均 E 在过去 **500 ms** 内持续 **> 0.15** 即锁定；一旦锁定即闩住，直到 RESET 或恢复快照才清 | Worker `LOCK_MEAN_E = 0.15`、`LOCK_WINDOW_MS = 500`（`simWorker.ts` L91–92）；`lockedLatched` 闩 |
| 按住预警 | 预警横幅（读快照 `approaching_lock` / `lock_progress`） | 按住进行中且 mean E **> 0.05** 但未锁定；`lock_progress = mean_e / 0.15`（钳制 0–1） | Worker `APPROACH_MEAN_E = 0.05`（L95） |
| 按住判定 | BrainScene 指针事件 | 静止按住 **300 ms** 触发持续输入（`HOLD_DELAY_MS = 300`）；移动 **> 6 px** 视为拖动（`CLICK_MOVE_THRESHOLD_PX = 6`），不触发刺激；短于 300 ms 的按压是点击（脉冲） | Worker `hold_start` 以 `duration = 1e9 ms` 的极长事件实现按住，`hold_end` 删除；按住开始前 Worker 自动存 `auto` 快照 |
| 响应分析 | RESPONSE 面板 | 阈值 `RESPONSE_THRESHOLD = 0.01`（max\|ΔE| ≥ 0.01 记为响应）；窗口基线前 500 ms 至刺激后 2000 ms（`RESPONSE_WINDOW_PRE_MS = 500`，`RESPONSE_WINDOW_POST_MS = 2000`）；色标满格 `DELTA_FULL = 0.1` | 前端分析量（读快照历史），无后端对应物；回放速度 1× / 0.5× / 0.25× 只改变观看，不改变物理 |
| 快照频率 | 无 UI 控件（固定 60 Hz） | 默认 **60 Hz**，Worker clamp **1–120 Hz** | Worker `snapshotHz`（`simWorker.ts` L97，`set_snapshot_hz` L402–404）；`MAX_CATCHUP_STEPS = 200`（后台切回追赶上限） |

### 1.5 PR5 物理核心

#### (a) 均匀无限导体解析偶极子（教学基线，非真实头模型）

模块：`app/src/lib/volumeConduction.ts`（`MODEL_ID = 'homogeneous-unbounded-dipole-v1'`）。
公式 `V(r) = p·(r−r₀) / [4πσ|r−r₀|³]`，σ 默认 `DEFAULT_CONDUCTIVITY_S_M = 0.33 S/m`；r < 1 mm 时抛错（点源奇点）。
UI：`DipoleLab.tsx`——偶极矩滑杆 **−30–+30 nA·m**（step 0.5，默认 10）、方向 X/Y/Z、位置拖动（钳制在半径 55 mm 内）、电导率滑杆 **0.10–1.00 S/m**（step 0.01，默认 0.33）、参考 平均/无限远、示意传感器 `demoSphereSensors(90)`（半径 90 mm 的 12 个 S01–S12，**不是** 10-20 电极）。参考类型 `Reference` 后端支持 `infinity | average | electrode` 三种，UI 只暴露前两种（见 §5 未暴露能力 U1）。

#### (b) MNE 四层球形头正向模型

生成：`scientific/forward/generate_sphere_model.py`（MNE 1.11.0 钉死版本；`app/public/forward-assets/sphere-model.json` 由 CI 生成，**不入库**）。
前端运行：`app/src/lib/sphereForward.ts`（`SPHERE_MODEL_ID = 'mne-four-layer-sphere-ras-v1'`）。

| 参数 | 值 | 来源 |
|---|---|---|
| 球半径 | **95 mm**（`RADIUS_M = 0.095 m`） | 生成脚本 L21 |
| 球心（HEAD 坐标） | **[0, 0, 40] mm**（`ORIGIN_M = [0,0,0.04] m`） | 生成脚本 L20；fixture `origin_in_head_mm` |
| 相对半径（脑/脑脊液/颅骨/头皮） | (0.90, 0.92, 0.97, 1.0) → 脑内半径 **85.5 mm** | 生成脚本 L27 |
| 电导率 σ | **(0.33, 1.0, 0.004, 0.33) S/m** | 生成脚本 L29 |
| 源网格 | 轴 [−48, −16, 16, 48] mm → 4³ = 64 点；网格间**三线性插值**，越界抛错 | 生成脚本 L22；`interpolateSphereGain` |
| 电极 | 345 个传感器（10-05 全集方向径向投影到 95 mm 球面）；导联 10-20 = 19 导、10-10 = 94 导、10-05 = 343 导 | 生成脚本；`validateSphereFixture` 校验传感器在球面上（允差 0.01 mm） |
| 增益 | µV/(nA·m)，MNE 原始 `V/(A·m) × 1e-3` | 生成脚本 L92；`gain_uv_per_nAm` |
| 参考 | `SphereReference`：`average | infinity | electrode` | `sphereElectrodePotentials`；UI 只暴露 average/infinity（见 U1） |

UI：`HeadSphereLab.tsx`——偶极矩 **−30–+30 nA·m**（step 0.5，默认 10）、源位置每轴钳制 **±48 mm**（网格边界）、导联选择 10-20 / 10-10 / 10-05、查看电极默认 Cz（切导联时重置为 Cz；Cz 在三个导联中都有）。

#### (c) fsaverage 真实模板 MRI/BEM（本地文件，用户自备，不分发）

模块：`app/src/lib/fsaverageBEM.ts`（`FSAVERAGE_BEM_MODEL_ID = 'fsaverage-mne-three-layer-bem-v1'`）；生成：`scientific/forward/generate_fsaverage_bem.py`。
坐标 HEAD RAS mm；偶极矩 nA·m；电位 µV；增益 `uV_per_nA_m`；**无插值**——点选吸附到最近的已预计算皮层源（`findNearestValidatedSource`）。
校验硬性要求（`validateFsaverageBEM`）：`subject='fsaverage'`、`frame='HEAD_RAS_MM'`、`gain_unit='uV_per_nA_m'`、`source_moment_unit='nA_m'`、`interpolation` 以 `none` 开头、`license_status='REVIEW_REQUIRED_FREESURFER_DERIVED_ASSET'`、皮层法向为单位向量、MNI305 定义字符串必须同时含 `MNI305` 与 `not MNI152`。
UI：`LocalBEMLab.tsx`——文件导入本地 JSON、手动偶极子（矩 ±30 nA·m，step 0.5，默认 10；方向 X/Y/Z）或局部皮层柱模式（见 §1.5(d)）；参考 average/infinity（`electrode` 模式后端支持、UI 未暴露，见 U1）；显示所选源的 `mni305_mm`（mm）。

#### (d) 局部皮层柱 E/I → 偶极矩（显式假设，非校准）

模块：`app/src/lib/localCorticalColumn.ts`（`COUPLING_ID = 'local-wc-cortical-column-assumed-dipole-v1'`）；Python 独立对照：`scientific/forward/local_column_scipy_reference.py`（SciPy DOP853，数值交叉验证用，非生物学标定）。
公式：`q = N · coherence · L · (I_exc·ΔE − I_inh·ΔI)`，pA×mm → nA·m 乘 `1e-6`；`q_vector = q · 法向（HEAD 单位向量）`。

| 参数 | TS 默认（`DEFAULT_RATE_PARAMS` / `DEFAULT_MORPHOLOGY`） | Python 对照 | 单位 |
|---|---|---|---|
| τ_E / τ_I | 12 / 20 | `TAU_E_MS=12.0` / `TAU_I_MS=20.0` | ms |
| c_EE / c_EI / c_IE / c_II | 2.8 / 2.4 / 2.6 / 0.2 | `C_EE/C_EI/C_IE/C_II` 同值 | 无量纲 |
| tonicDrive | 0.1 | `TONIC=0.1` | 无量纲 |
| sigmoidSlope / sigmoidThreshold | 2.5 / 1.1 | `SLOPE=2.5` / `THRESHOLD=1.1` | 无量纲 |
| dtMs | 1 | （RK4 步长，Python 用自适应 DOP853 对照） | ms |
| effectivePyramidalCells N | 1,000,000 | `N=1_000_000` | 个（假设） |
| coherence | 0.08 | `COHERENCE=.08` | 无量纲 0–1 |
| excitatoryCurrentPA / inhibitoryCurrentPA | 200 / 100 | `I_E_PA=200.` / `I_I_PA=100.` | pA/神经元（假设） |
| dipoleSeparationMm L | 0.5 | `L_MM=.5` | mm（假设） |

校验：`validateRateParams`（τ>0、斜率>0、dt ≤ min(τ_E,τ_I)/2、耦合 ≥0）；`validateMorphology`（N>0、coherence∈[0,1]、电流>0、L>0）；`step(stimulus)` 拒绝 |stimulus|>10；基线由 5000 ms 无刺激积分求不动点（残差 ≤1e-7），不是手写 E 基线。
UI（`LocalBEMLab.tsx` 局部皮层柱模式）：刺激驱动滑杆 **0.4–2.5**（step 0.1，默认 **1.4**，与 Python 对照刺激驱动 1.4 一致；注意 Python 对照刺激窗 80–120 ms=40 ms，UI 刺激窗为 200 ms，两者是不同实验设置，不是漂移）；形态学参数 UI 只读展示 `DEFAULT_MORPHOLOGY`，无编辑控件（有意为之：假设参数不许在界面上悄悄改）。

#### (e) Jansen–Rit 模型（独立验证路线，已定稿——并行子代理 2026-11-11 落地）

模块：`app/src/lib/jansenRitColumn.ts`（`JANSEN_RIT_ID = 'local-jansen-rit-assumed-dipole-v1'`）；Python 独立对照：`scientific/forward/jansen_rit_reference.py`（SciPy DOP853，数值交叉验证用，非生物学标定）；出处 Jansen & Rit 1995, Biol. Cybern. 73:357–366。
状态：三群体（锥体细胞、兴奋/抑制中间神经元），二阶突触核化为六个一阶 ODE（y0–y5）；时间 ms、电位 mV、sigmoid 输出 1/s（导数内换算为 /ms）。
EEG 代理：锥体群体突触后电位 **y0(t) [mV]**（Jansen–Rit 本人用的 EEG 输出），不是其导数、不是发放率。
耦合链与 WC 路线**同形**：`q = N · coherence · L · g · (y0 − y0_0) · 1e-6 [nA·m]`，其中 g 为假设的 PSP→电流斜率；N×coherence×电流×长度乘积同样结构不可辨识。两条路线都不是真实脑电。

| 参数 | TS 默认（`DEFAULT_JANSEN_RIT_PARAMS`） | Python 对照 | 单位 |
|---|---|---|---|
| gainExcMv A / gainInhMv B | 3.25 / 22 | `A_MV=3.25` / `B_MV=22.0` | mV |
| rateExcPerS a / rateInhPerS b | 100 / 50 | `A_RATE=100.0` / `B_RATE=50.0` | 1/s |
| c1 / c2 / c3 / c4 | 135 / 108 / 33.75 / 33.75 | `C1..C4` 同值 | 无量纲 |
| sigmoidMaxPerS e0 | 2.5（sigmoid 为 `2·e0/(1+exp(r·(v0−v)))`） | `E0=2.5` | 1/s |
| sigmoidHalfMv v0 / sigmoidSlopePerMv r | 6 / 0.56 | `V0_MV=6.0` / `R_PER_MV=0.56` | mV / 1/mV |
| baselineInputPerS p0 | 90（Wendling et al. 2002 同方程的均值，**低分支**静息态） | `P0_PER_S=90.0` | 1/s |
| dtMs | 0.5（RK4，步长 0.5 ms；实测：dt=1 ms 时 RK4 与 DOP853 在 y1 上差 7.6e-6 mV，0.5 ms 时全部状态变量 <1e-6，最大 4.6e-7 mV，q(t) 差 2.3e-8 nA·m） | （Python 用自适应 DOP853 对照） | ms |
| PSP→电流斜率 g | `JR_PSP_TO_CURRENT_PA_PER_MV = 200` pA/mV（有意等于 WC 路线的假设兴奋电流 200 pA，两路线共用一个电流尺度） | `G_PA_PER_MV=200.0` | pA/mV（假设） |
| 形态学 N / coherence / L | 与 WC 路线共用 `DEFAULT_MORPHOLOGY`（1,000,000 / 0.08 / 0.5 mm） | `N_CELLS` / `COHERENCE` / `L_MM` 同值 | 见 §1.5(d) |

校验：`validateJansenRitParams`（增益/速率>0、e0>0、斜率>0、p0≥0、c1–c4≥0、dt ≤ min(1000/a, 1000/b)/2）；`step(addedInputPerS)` 只接受 [0, 1000] 1/s 的附加输入，y0/y1/y2 越出 [−10, 100] mV 即报发散；基线由 5000 ms 从零积分求不动点（残差 ≤1e-6），p0=220 的标准工作点是约 10.5 Hz 极限环（alpha）而非不动点，在此会大声失败、不静默返回错点。
对照协议（与 WC 路线同窗）：刺激 80–120 ms、附加输入 120 1/s、总窗 600 ms（Python `PULSE_PER_S=120.0`，`STIM_ON/OFF_MS=80/120`）。
**前端入口：已有。** `app/src/components/LocalBEMLab.tsx` 局部皮层柱模式下有“源模型”切换（Wilson–Cowan / Jansen–Rit），两路线在同一刺激时钟上锁步运行、并排显示 q(t) 与电极电位。`docs/pr5-jansen-rit.md` 已落盘。见 §5.3 U5（已消项）。

---

## 2. 坐标系

| 坐标系（`CoordinateSpace`，`app/src/lib/coordinates.ts`） | 含义 | 状态 |
|---|---|---|
| `head-ras-mm` | MNE HEAD RAS，mm；球心在 [0,0,40] | 已实现（MNE 坐标） |
| `head-sphere-centered-mm` | 球心为原点的 HEAD RAS，mm；球心 [0,0,40] mm | 已实现（球形头模型坐标） |
| `mri-ras-mm` | fsaverage MRI RAS，mm | 已实现（仅经显式 `transform_mri_to_head` 变换，见 BEM fixture） |
| `mni152-mm` | MNI152 模板坐标 | **禁用：无已验证配准，禁止使用** |
| `talairach-mm` | Talairach 坐标 | **禁用：无已验证配准，禁止使用** |
| `tvb-demo-mm` | TVB 演示数据原始坐标，mm | 演示渲染坐标，**不与 HEAD/MRI/MNI 互通** |

**唯一已验证的变换：** `MNE_HEAD_TO_SPHERE`（`coordinates.ts`）：HEAD RAS → 球心坐标，纯平移 z −40 mm（矩阵 [1,0,0,0, 0,1,0,0, 0,0,1,−40, 0,0,0,1]，`errorMm = 0`），对应生成脚本 `ORIGIN_M = [0,0,0.04] m`。`validateTransform` 要求 4×4 仿射矩阵最后一行 (0,0,0,1)、method 与 provenance 非空、errorMm ≥ 0 或 null。

**禁用方式（写死在代码里，不是文档口号）：**
- `coordinates.ts` 的 `CoordinateSpace` 类型把 `mni152-mm` / `talairach-mm` 列为标签，并有 `DISABLED_SPACES` 集合（`'mni152-mm'`、`'talairach-mm'`、`'tvb-demo-mm'`）——`validateTransform` 是唯一 choke point（`applyTransform` / `inverseTransform` / `composeTransforms` 都经过它），任何 from/to 触及禁用空间的变换直接抛 `RangeError`，再合理的矩阵也算不出禁用空间里的数。
- `fsaverageBEM.ts` 的 `CorticalNode.mni305_mm` 明确标注是 MNE/FreeSurfer `mni_tal`（**MNI305，不是 MNI152、不是真 Talairach**）；`validateFsaverageBEM` 强制 fixture 的 `standard_coordinate_definition` 同时含 `MNI305` 与 `not MNI152`，否则拒绝加载。
- `scientific/forward/generate_fsaverage_bem.py` 遇 MNI/Talairach 要求直接抛错（"Expected explicit HEAD<->MRI transform, not MNI/Talairach"）。
- TVB 76 区网络与 fsaverage 皮层**不互通**：局部皮层柱是独立小模型，不映射 TVB 节点；三个 PR5 实验（DipoleLab / HeadSphereLab / LocalBEMLab）互相独立，不共享源位置。

---

## 3. 消息协议

### 3.1 Worker 入站（`WorkerInMessage`，`app/src/worker/protocol.ts`）——21 种，全数在 `simWorker.ts` 有处理分支

| # | 消息 | 字段（单位） | 发送方（SimClient 方法） | Worker 处理 → 后端函数 |
|---|---|---|---|---|
| 1 | `init` | `weights: number[]`（76×76 展平，0–3）、`lengths: number[]`（mm 展平） | `start()` | 加载 WASM，`new WasmSim(weights, lengths)`（`Params::demo()`）；只初始化一次；就绪后回 `ready` |
| 2 | `stimulus` | `node`（0–75）、`amplitude`（P 模型单位）、`duration_ms`（ms） | `pulse()`（用当前 `stim_amplitude/duration`）；调试桥 `pulse(node, amplitude?, duration_ms?)` | 入 `pulses` 队，下一 tick 提交 `WasmSim::add_stimulus` |
| 3 | `hold_start` | `node`、`amplitude` | `holdStart()` | 先存 `auto` 快照再加 `duration=1e9 ms` 的极长事件（`add_stimulus`） |
| 4 | `hold_end` | `node` | `holdEnd()` / `retractHold()` | 删按住，`clear_stimuli_on_node` |
| 5 | `set_params` | `params: Partial<SimParams>`（g / c_ei / stim_amplitude / stim_duration_ms） | `setParams(patch)` | 逐字段 `set_g / set_c_ei / set_stim_amplitude / set_stim_duration_ms`（WASM clamp，见 §1.2） |
| 6 | `pause` | — | `pause()` | `paused = true`，清 `wallAccumMs` |
| 7 | `resume` | — | `resume()` | `paused = false`，重置墙钟 |
| 8 | `reset` | — | `reset()` | `WasmSim::reset()`（清偏置、OU、RNG、事件；**保留权重与背景模式**）；清 `auto` 快照、锁定闩、历史；`paused` 清零（B6b） |
| 9 | `reset_paused` | — | `resetPaused()`（仅调试桥） | 同 `reset`，但原子地 `paused = true`（确定性步进用；禁止用 reset+pause 两条消息代替） |
| 10 | `set_snapshot_hz` | `hz`（Hz，Worker clamp 1–120） | `setSnapshotHz()`（PR5 新增；此前为孤儿消息，见 §6 D2）+ 调试桥 | `snapshotHz = clamp(hz, 1, 120)` |
| 11 | `set_weight` | `i, j`（0–75）、`w`（0–3） | `setWeight()`（客户端先 clamp） | `WasmSim::set_weight` → `Simulator::set_weight`（单边，clamp，立即生效，RESET 保留） |
| 12 | `reset_weight` | `i, j` | `resetWeight()` | `WasmSim::reset_weight` |
| 13 | `reset_all_weights` | — | `resetAllWeights()` | `WasmSim::reset_all_weights` |
| 14 | `set_bias` | `node`、`value`（−1–+1） | `setBias()`（0 时改发 `clear_bias`） | `WasmSim::set_bias` → `Simulator::set_bias` |
| 15 | `clear_bias` | `node` | `clearBias()` | `WasmSim::clear_bias` |
| 16 | `clear_all_bias` | — | `clearAllBias()` | `WasmSim::clear_all_bias` |
| 17 | `set_background_mode` | `mode: 'quiet' \| 'spontaneous' \| 'oscillatory'` | `setBackgroundMode()` | 编码 0/1/2 → `WasmSim::set_background_mode`；回 `mode_applied` |
| 18 | `set_seed` | `seed`（≥0 整数；客户端 `max(0, floor)`） | `setSeed()` | `WasmSim::set_seed` → `Simulator::reseed` |
| 19 | `advance_ms` | `ms`（ms） | `advanceMs()`（仅调试桥） | 仅暂停时推进（运行中忽略），随后发一条快照 |
| 20 | `save_snapshot` | `id: string`（`'manual'` \| `'auto'`） | `saveSnapshot()`（manual） | `WasmSim::take_snapshot()` → JSON；回 `snapshot_saved` |
| 21 | `restore_snapshot` | `id`、`json: string` | `restoreSnapshot(id)` | `WasmSim::restore_snapshot(json)`；清脉冲/按住/锁定闩/历史；回 `snapshot_restored` + 一条快照 |

**时序约束（已验证的坑）：**
- `start()` 发 `init` 后立即发的 `set_params` 会在 WASM 加载完成前被 Worker 丢弃（`sim` 尚不存在）——无害，因为引擎构造即用 `Params::demo()`，其值与 `DEFAULT_PARAMS` 一致；`set_background_mode` 必须等 `ready`（`onReady` 回调里发）。
- `reset` 与 `pause` 分开发会在中间漏进 live tick、消耗 RNG 导致同种子重跑不一致（实测 reset 后 120 ms 内 t_ms 可跑到 50 ms）——确定性步进必须用 `reset_paused`。
- Worker 在 WASM 加载完成前收到的所有消息（除 `init`）都会被静默丢弃（`if (!sim) return`）；UI 控件在 `simReady` 前禁用。

### 3.2 Worker 出站（`WorkerOutMessage`）——6 种

| 消息 | 字段（单位） | 说明 |
|---|---|---|
| `ready` | `n_nodes`（=76）、`dt_ms`（=1） | WASM 就绪 |
| `snapshot` | 见 §4.1（`Snapshot` 接口，t_ms / e / i / p / mean_e / locked / hold_* / diverged / paused） | 约 60 Hz；只读模型状态，无视觉加工 |
| `mode_applied` | `params: ModeParams`（mode / ou_tau_ms / ou_sigma / ext_sine_amp / ext_sine_freq_hz） | 模式切换后引擎实际用的参数；UI 只读它 |
| `snapshot_saved` | `id`、`t_ms`、`json` | `save_snapshot` / `hold_start`（auto）的确认 |
| `snapshot_restored` | `id`、`t_ms` | 恢复确认，随后补一条快照 |
| `error` | `message` | WASM 加载失败 / 恢复无快照 / 引擎异常 |

### 3.3 前端控件 → 消息 → 后端函数（总映射）

| 前端控件 | SimClient 方法 | Worker 消息 | 后端函数（文件行号） |
|---|---|---|---|
| 3D 脑区点击 | `pulse(node)` | `stimulus` | `WasmSim::add_stimulus`（brain-wasm L113） |
| 3D 脑区按住/松开 | `holdStart(node)` / `holdEnd(node)` | `hold_start` / `hold_end` | 同上（duration 1e9 ms）+ `clear_stimuli_on_node`（L123） |
| STIMULUS / DURATION / EXC/INH / CONNECTIVITY 滑杆 | `setParams(patch)` | `set_params` | `set_g`（L139）/`set_c_ei`（L149）/`set_stim_amplitude`（L160）/`set_stim_duration_ms`（L169） |
| 权重滑杆（REGION） | `setWeight / resetWeight / resetAllWeights` | `set_weight / reset_weight / reset_all_weights` | `WasmSim::set_weight`（L298）等 → `Simulator::set_weight`（brain-core L576）等 |
| 偏置开关/滑杆（REGION） | `setBias / clearBias / clearAllBias` | `set_bias / clear_bias / clear_all_bias` | `WasmSim::set_bias`（L331）等 → `Simulator::set_bias`（brain-core L614）等 |
| 背景模式三按钮 | `setBackgroundMode` | `set_background_mode` | `WasmSim::set_background_mode`（L199） |
| 随机种子数字框 | `setSeed` | `set_seed` | `WasmSim::set_seed`（L228）→ `Simulator::reseed`（brain-core L486） |
| PLAY/暂停按钮 | `pause / resume` | `pause / resume` | Worker 内 `paused` 标志 |
| RESET 按钮 | `reset`（+ `setParams(DEFAULT_PARAMS)`） | `reset` | `WasmSim::reset`（L183）→ `Simulator::reset`（brain-core L457） |
| 保存快照 / 恢复手动快照 / 恢复到按住前 | `saveSnapshot / restoreSnapshot` | `save_snapshot / restore_snapshot` | `WasmSim::take_snapshot`（L271）/ `restore_snapshot`（L281）→ `Simulator::take_snapshot`（brain-core L494）/ `restore_snapshot`（L517） |
| 回放滑杆 / 速度按钮（1×/0.5×/0.25×） | —（纯前端） | —（无消息） | 无后端；只读已录制的快照历史，不触碰引擎 |
| 着色切换（绝对 E / ΔE） | —（纯前端） | — | 无后端；视图状态 |
| DipoleLab 全部控件 | —（纯前端） | — | `volumeConduction.ts` 解析公式（前端本地计算，非 WASM 引擎） |
| HeadSphereLab 全部控件 | —（纯前端） | — | `sphereForward.ts` 插值 + MNE 离线 lead field（前端本地计算） |
| LocalBEMLab 全部控件 | —（纯前端） | — | `fsaverageBEM.ts` + `localCorticalColumn.ts`（前端本地计算） |

---

## 4. 状态结构

### 4.1 快照（Worker → 主线程，`Snapshot`，`protocol.ts`）

| 字段 | 类型 | 单位 | 说明 |
|---|---|---|---|
| `type` | `'snapshot'` | — | 消息类型 |
| `t_ms` | number | ms | 仿真时间 |
| `e` / `i` | Float64Array(76) | 无量纲 0–1 | 各节点 E / I |
| `p` | Float64Array(76) | P 模型单位 | 上一步实际施加的 P |
| `mean_e` | number | 无量纲 | 全网平均 E |
| `locked` | boolean | — | 锁定闩（§1.4）；基线 mean E ≈0.011，锁住态 ≈0.24 |
| `hold_active` / `hold_node` / `hold_ms` | boolean / number\|null / number | ms | 按住进行中 / 按住节点 / 已按住仿真 ms |
| `lock_progress` | number | 0–1 | = mean_e / 0.15，钳制 |
| `approaching_lock` | boolean | — | 按住中且 mean E > 0.05 且未锁定 |
| `diverged` / `divergence_detail` | boolean / string | — | 发散标志与详情 |
| `paused` | boolean | — | Worker 内 paused 标志的只读镜像 |

主线程侧：`SimClient` 保存最近 600 条快照历史（`SNAP_HISTORY_MAX = 600`，60 Hz 下覆盖 10 s）；响应窗口（基线前 500 ms 至刺激后 2 s）单独钉住保存，不随滚动历史逐出。

### 4.2 实验快照（Rust `StateSnapshot`，`crates/brain-core/src/lib.rs` L401–415）

完整可恢复状态，JSON 序列化后走 Worker `snapshot_saved` / `restore_snapshot` 与 localStorage。字段：`params`（全部 `Params`，含 bg_mode / ou_* / ext_sine_* / seed / drive_const）、`weights`（76×76 live 权重）、`bias`（76）、`step_count`、`rng_state`（SplitMix64 内部状态）、`ou`（76）、`e`、`i`、`e_hist`、`hist_base`、`e0`、`i0`。**`weights_orig` 故意不存**（构造后永不变，恢复不能污染 TVB 原始值对照）。
恢复语义：恢复后与快照时刻 bit-identical（同一 RNG 序列、同一 OU 状态、同一延迟历史）；节点数不匹配时恢复失败且**不修改任何状态**。

### 4.3 localStorage 与版本

| 键 | 内容 | 版本机制 |
|---|---|---|
| `brainrun.snapshot.manual.v1`（`MANUAL_SNAPSHOT_KEY`） | `StoredSnapshot`：`{id:'manual', t_ms, json, savedAtWall, version}` | 键名后缀 `.v1` + 记录内 `version` 字段（`SNAPSHOT_SCHEMA_VERSION = 1`，`simClient.ts`，PR5 新增）；读取时缺 `version` 视为 1（PR5 之前写下的记录），其他版本拒绝、不做静默迁移 |
| `auto` 快照 | 只活在 Worker 内存 + `SimClient` 内存，**永不写 localStorage**；RESET 时清掉，绝不覆盖 `manual` | — |

**快照 JSON 本身无版本字段**（Rust `StateSnapshot` serde 输出无 `version`）——见残留 R2。`SimClient.parseSnapshotSummary` 从 JSON 读回 UI 同步用的子集：`params.{g, c_ei, stim_amplitude, stim_duration_ms, bg_mode, ou_tau_ms, ou_sigma, ext_sine_amp, ext_sine_freq_hz}`、`weights`、`bias`；缺失字段的回退默认值与 Rust `Params::default()` 一致（ou_tau 100、ou_sigma 0.10、ext_sine_amp 0、ext_sine_freq 10；注意 oscillatory 预设的 amp 是 0.30，回退 0 对应的是 `Params::default()`，不是 oscillatory 预设）。

### 4.4 版本 / 迁移规则

- 新增参数 / 消息 / 状态字段时：**必须**带默认值（后端 `Default` 或前端回退值，二者相等）、在 §1/§3/§4 登记、进漂移测试；不许出现“前端发了、后端不认”或“后端存了、前端读不到”的字段。
- `StateSnapshot` 加字段：Rust 侧 serde 默认值 + 旧 JSON 仍能恢复（或显式拒绝并报错，禁止静默错恢复）；`StoredSnapshot` 的 `version` 随之 +1，读取逻辑按 §4.3 拒绝未知版本。
- localStorage 键名带版本后缀（现为 `.v1`）；换 schema 即换键，不复用旧键写新格式。
- 坐标系 / 单位改动：视为破坏性变更，必须同步改 §0/§2、生成脚本、fixture `model_id`（`mne-four-layer-sphere-ras-v1` 等含版本号，换模型即换 id，旧 fixture 拒绝加载）。

---

## 5. 空壳检查清单

逐控件核对（前端控件 → 后端实现，函数名+行号见 §3.3）。结论：**没有纯空壳控件**（即没有声称改模型、实际只改界面的控件）。以下三类不是空壳，但须如实记录：

### 5.1 纯视图控件（不声称改模型，不算空壳）

回放滑杆/速度（1×/0.5×/0.25×）、回放播放/暂停、着色切换（绝对 E / ΔE）、自动旋转、显示连接开关、三个 PR5 实验的打开/关闭按钮。它们只改变观看方式，界面文案也如实写“回放只改变观看速度，不改变物理方程”。

### 5.2 前端本地计算的控件（后端在 `app/src/lib`，不在 WASM 引擎——符合设计，不是空壳）

DipoleLab / HeadSphereLab / LocalBEMLab 的全部控件：偶极矩、方向、位置、导联、参考、电导率、局部皮层柱运行/刺激/重置。其“后端”是 `volumeConduction.ts` / `sphereForward.ts` / `fsaverageBEM.ts` / `localCorticalColumn.ts` 的真实计算函数（公式与校验见 §1.5），不是摆设。注意它们与 76 节点 Wilson–Cowan 引擎**不互通**（界面文案已写明）。

### 5.3 未暴露的后端能力（有实现、无 UI 入口——不是空壳，是缺口，列出不补）

| # | 后端能力 | 位置 | 现状 |
|---|---|---|---|
| U1 | 参考方式 `electrode`（以某电极为参考） | `volumeConduction.ts` `Reference`、`sphereForward.ts` `SphereReference`、`fsaverageBEM.ts` `TemplateReference` | 三个实验的 UI 参考下拉都只有 `average` / `infinity` 两种；`electrode` 有完整实现但无界面入口。如需暴露，须在三个实验各加电极选择并同步改契约与漂移测试 |
| U2 | `set_snapshot_hz`（快照频率 1–120 Hz） | Worker 已处理；PR5 新增 `SimClient.setSnapshotHz` + 调试桥入口 | 产品 UI 固定 60 Hz，不设控件（有意为之）；现可通过调试桥调用，不再是孤儿消息 |
| U3 | `advance_ms` / `reset_paused`（确定性步进） | Worker 已处理；`SimClient` 有方法 | 仅调试桥 / PR4 测试用，UI 无入口（有意为之：确定性步进是测试工具，不是产品功能） |
| U4 | OU 参数（τ/σ）、正弦幅/频、drive_const、noise_amp、speed、θ_e、其余 A-set 参数 | Rust `Params` | 固定常量，无 UI 控件（有意为之：PR4 实测否决了 σ=0.15/0.20，不开放调节）；任何开放都须先过安全扫描再改契约 |
| U5 | Jansen–Rit 局部皮层柱（独立验证路线） | `app/src/lib/jansenRitColumn.ts` + `scientific/forward/jansen_rit_reference.py` | **已暴露（2026-11-11，U5 已消项）：** `LocalBEMLab` 源模型切换（Wilson–Cowan / Jansen–Rit），两路线锁步运行、并排显示 q(t) 与电极电位；`docs/pr5-jansen-rit.md` 已落盘。漂移测试覆盖 JR 参数与 UI 入口 |

### 5.4 已核实的“不是空壳”的易误判点

- 权重编辑 RESET 后保留：是设计（结构编辑），不是“RESET 失效”；界面文案已写明。
- 偏置 RESET 后清除：与权重相反，是设计（外加输入）；界面文案已写明。
- `handleReset` 不重置背景模式与种子：与 Rust `reset()` 保留 `bg_mode` 一致，不是遗漏。
- 种子输入无 max：`SimClient.setSeed` 做 `max(0, floor)`；WASM `seed as u64`，负值到不了引擎。

---

## 6. 本轮修掉的漂移（PR5 契约子代理，2026-11-11）

| # | 漂移 | 修复（只动允许的文件） | 验证 |
|---|---|---|---|
| D1 | `protocol.ts` 的 `SimParams.stim_amplitude` 注释写“范围 0.5–2.0”，但引擎 clamp 是 0–4.0（`crates/brain-wasm/src/lib.rs` L160–161）——注释即契约，注释与引擎不一致 | 改 `protocol.ts` 注释为实情：UI 暴露 0.5–2.0，引擎 clamp 0–4.0，UI 范围是引擎范围的真子集；完整裁决见残留 R1（引擎侧改动超出本子代理文件归属，需 Rust 侧定） | 漂移测试：UI 端点 ⊆ 引擎 clamp；UI 端点 = KNOB_MAP 端点 = 数字框 min/max |
| D2 | `set_snapshot_hz` 是孤儿消息：`protocol.ts` 定义了它，`simWorker.ts` 处理了它，但 `SimClient` 与 `App` 全无发送方——协议与客户端漂移 | `app/src/lib/simClient.ts` 新增 `setSnapshotHz(hz)`（客户端镜像 Worker 的 1–120 Hz clamp）+ 调试桥入口；UI 仍固定 60 Hz 不设控件 | 漂移测试：21 种入站消息每种都有 `SimClient` 发送点；21 种每种都有 Worker 处理分支 |
| D3 | 快照持久化无记录内版本：`StoredSnapshot` 只有键名后缀 `.v1`，记录本身无版本字段；将来换 schema 无法识别旧记录 | `simClient.ts` 新增 `SNAPSHOT_SCHEMA_VERSION = 1` 与 `StoredSnapshot.version` 字段；写入时带版本；读取时缺版本视为 1（兼容 PR5 前的记录），其他版本拒绝 | 漂移测试：常量=1；读取逻辑含版本分支（源码对照） |

---

## 7. 残留项

| # | 残留 | 说明 | 归属 / 下一步 |
|---|---|---|---|
| R1 | `stim_amplitude` 引擎 clamp（0–4.0）比 UI 暴露范围（0.5–2.0）宽 | UI 发出的值一定能被引擎接受（子集关系成立），但调试桥 `pulse(node, amplitude)` / 直接 `set_params` 可以发出 2.0–4.0 的值，超出 UI 所称的“范围 0.5–2.0”。两种改法二选一，需 Rust 侧定：(a) 把 WASM clamp 收紧到 0.5–2.0；(b) 承认 0–4.0 为引擎范围、UI 只暴露其中一段，并在 `protocol.ts` 与 UI 文案写清。**在定下来之前，契约以引擎 0–4.0 为准，UI 0.5–2.0 为其子集。** | 需改 `crates/*`，超出本子代理文件归属；由总协调定 |
| R2 | 快照 JSON（Rust `StateSnapshot`）本身无 `version` 字段 | `StoredSnapshot` 包装层已有版本（D3），但裸 JSON（Worker 内 `auto` 快照、调试桥传的 JSON）仍无版本；将来 `Params` 加字段时旧 JSON 的兼容性只能靠 serde 默认值兜底，无法显式识别 | 需改 `crates/brain-core`（`StateSnapshot` 加 `version` + serde 默认值）；PR6+ 再议 |
| R3 | ~~Jansen–Rit 已定稿但无 UI 入口 + 说明文档未落盘~~ **已解决（2026-11-11）** | UI 入口已接（`LocalBEMLab` 源模型切换），`docs/pr5-jansen-rit.md` 已落盘；契约 §1.5(e) 与 §5.3 U5 已同步更新，漂移测试由“不应已接”改为断言“LocalBEMLab 已接、其余组件未接” | — |
| R4 | `electrode` 参考方式无 UI 入口 | 见 U1；有实现无入口，不算空壳，但用户在界面上选不到它 | 如需暴露，PR6+ 按 §8 清单做 |
| R5 | 球形头 fixture 未入库，本地无法跑 `sphere-forward` 类测试 | `app/public/forward-assets/sphere-model.json` 由 CI 生成、不入库；本机 clone 里没有该文件，依赖它的既有测试在本地跑不通（非产品问题）。本契约的漂移测试只读源码与生成脚本，不依赖该 fixture | 生成脚本在 CI 跑；本地复现需 `scientific/forward/generate_sphere_model.py`（MNE 1.11.0） |
| R6 | MNI152 / Talairach 仍是“禁用但未在类型层面彻底消除” | `CoordinateSpace` 仍把两者列为标签（便于显式拒绝与报错信息），禁用靠 `DISABLED_SPACES` + `validateTransform` choke point 实现（另有子代理 2026-11-11 加强）；若将来有人绕过 `validateTransform` 直接拼矩阵，类型系统拦不住 | 漂移测试卡住：断言 `validateTransform` 对禁用空间抛错（行为级），而非只数字符串出现次数 |

---

## 8. 维护规则

**改任一侧 → 同步改契约 + 另一侧 + 跑漂移测试。** 具体检查清单：

### 8.1 新增 / 修改参数
- [ ] 在 §1 参数总表登记：中英文名、符号、单位、范围、默认值、所属模块
- [ ] 前端控件（控件名、min/max/step、映射公式）与后端变量名（Rust/Python/scientific）逐一对上
- [ ] 前端滑杆 min/max/step 与后端 clamp 一致（或 UI 范围 ⊆ 后端 clamp 且在契约写清，如 R1）
- [ ] 默认值三处一致：前端 `DEFAULT_PARAMS` / `KNOB_MAP`、Rust `Params::default()/demo()`、Python 对照（如有）
- [ ] 单位写进字段名或注释（如 `_ms` / `_hz` / `_uv` / `_nAm`），禁止裸数字
- [ ] 漂移测试加对应断言（读源码/导出值对照，不只断言文档存在）

### 8.2 新增 / 修改 Worker 消息
- [ ] `protocol.ts` 类型、`simWorker.ts` 处理分支、`SimClient` 发送方法三处同增同改
- [ ] 新增消息类型无处理分支 → 漂移测试失败（硬性）
- [ ] 新增消息类型无发送方 → 列为孤儿消息，要么补发送方（如 D2），要么在契约写清“有意无发送方”的原因
- [ ] 出站消息新增字段 → `SimClient` 的消息处理分支同步读它（`mode_applied` 之类只读不假设）

### 8.3 新增 / 修改状态字段
- [ ] 在 §4 登记字段、类型、单位、语义；快照字段同时登记 Rust `StateSnapshot` 与 TS `Snapshot` 两侧
- [ ] 带版本/迁移说明：`StoredSnapshot.version` 递增或换 localStorage 键；Rust 快照加字段须带 serde 默认值
- [ ] 恢复语义写清：RESET 清什么、保留什么（权重保留 / 偏置清除 / `auto` 快照清除 / `manual` 保留）

### 8.4 新增 / 修改坐标系或单位
- [ ] 在 §0/§2 登记；换算因子写清（如 pA×mm → nA·m 的 1e-6、MNE 的 1e-3）
- [ ] MNI152 / Talairach 新增任何变换前必须先有已验证配准，否则保持禁用（R6）
- [ ] fixture `model_id` 换版本（模型一变即换 id，旧 fixture 拒绝加载）

### 8.5 新增前端控件
- [ ] 在 §3.3 登记：控件 → SimClient 方法 → Worker 消息 → 后端函数（函数名+文件行号）
- [ ] 逐一过 §5 空壳检查清单：无对应后端实现的控件不得合入，先列为“空壳”汇报
- [ ] 后端新增能力，前端必须有语义一致的入口；暂不暴露的进 §5.3（U1–U4；U5 已暴露）并写清原因

### 8.6 布局正确性要求（全面扫查推迟到 PR8 之后，但新界面现在就要做对）
- [ ] 新加的面板/弹窗/控件不得与其他组件相互遮挡；GUI 框须完整显示内容（1920×1080 与 978 px 两种宽度下）
- [ ] 已知遮挡或显示不全的问题不得留到 PR8，修掉或记入残留项
- [ ] 全面布局扫查、性能、五维验收、十个演示统一放到 PR8 合并之后做最终大测试（2026-11-11 22:57 测试节奏新规）

### 8.7 回归门槛
- 跑 `node --experimental-strip-types --test tests/pr5/contract.test.mjs`（Node 24），全绿才算契约未漂移。
- 同一测试因非产品问题（系统/环境/脚手架）失败超过 3 次即停掉它、在 `tests/pr5/debug-rounds.md` 记原因后继续；产品真问题必须修，不许改期望、删场景、放宽门槛来让测试通过。
