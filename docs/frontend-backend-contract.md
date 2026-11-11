# 前后端契约（Frontend–Backend Contract）

> **状态：** PR5（`feat/pr5-physics-core`，HEAD `3261673`）定稿，2026-11-11 核实。
> PR6 增补（2026-11-12，A2）：R1（stim_amplitude 收紧）、R2（快照 JSON 加版本）、
> R6（MNI152/Talairach 类型消除）已解决，见 §1.2 / §2 / §4.2 / §4.3 / §7。
> PR6 增补（2026-11-12，B1）：PR-07 多导 EEG（§1.6），R4（电极参考 UI 入口）
> 已解决，见 §1.6 / §5.3 U1 / §7。
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
| STIMULUS | stim_amplitude（刺激幅度） | `0.5·4^k`（非线性） | 0.5–2.0，step 0.01 | 2.0（k=1） | **0.5–2.0**（PR6 R1 已收紧，与 UI 相等） | `set_params {stim_amplitude}` → `WasmSim::set_stim_amplitude`（L160） |
| DURATION | stim_duration_ms（脉冲持续） | `20 + k·480`（线性） | 20–500 ms，step 1 | 100 ms | 20–500 | `set_params {stim_duration_ms}` → `set_stim_duration_ms`（L169） |
| EXC/INH | c_ei（抑制自耦合） | `3 + k·5`（线性） | 3–8，step 0.1 | 4.0 | 3–8 | `set_params {c_ei}` → `set_c_ei`（L149） |
| CONNECTIVITY | G（全局耦合斜率） | `k·0.4`（线性） | 0–0.4，step 0.01 | 0.35 | 0–0.4 | `set_params {g}` → `set_g`（L139） |

一致性要求：`KNOB_MAP.<x>(0/1)` 必须等于 UI min/max；UI min/max 必须等于引擎 clamp（四者如今全部相等，PR6 R1 之前 stim_amplitude 例外）。反向映射 `stimulusK/durationK/c_eiK/gK` 必须与正向映射互逆（漂移测试覆盖）。

**幅度有两条路径，不要混为一谈：**上面这行管的是 `stim_amplitude` 参数（默认脉冲幅度），引擎 clamp 0.5–2.0。另一条是单次事件的 `amplitude` 字段（Worker `stimulus` / `hold_start` 消息、调试桥 `pulse(node, amplitude?)`），经 `WasmSim::add_stimulus` 直接入队，**不钳制**——它从来没有钳制过。`reference/python-model/experiments.py` 的幅度 sweep 用到 4.0，走的就是这条直接事件路径，不受 `set_stim_amplitude` clamp 影响；收紧 setter 没有动它。`protocol.ts` 的 `stim_amplitude` 注释须同步写 0.5–2.0（PR6 由总协调改，见 §7 R1）。

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

### 1.6 PR6 PR-07 多导 EEG（B1，2026-11-12）

模块：`app/src/lib/eegRecording.ts`（`runExperiment` / `simulateSourceMoments` / `projectMoments` / `applyReference` / `reReferenceRecording` / `generateNoise` / `recordingToCsv` / `recordingToJson`）；共享类型 `app/src/lib/eegData.ts`（`EegRecording` / `EegEvent` / `EegReference` / `NoiseParams`，`EEG_BANDS` 唯一定义）；Python 对照 `scientific/eeg/eeg_reference.py`（mulberry32 / 噪声 / 参考 / 投影同公式，柱模型用 SciPy DOP853 分段积分）；测试 `tests/pr6/eeg-recording.test.mjs`（13 项）与 `tests/pr6/test_eeg_recording.py`（12 项）；UI `app/src/components/EegAnalysisLab.tsx`（实验壳，六个 tab 共用同一份记录）+ `app/src/components/EegWaveTab.tsx`（EEG tab）+ `App.tsx` 的 “EEG 分析” chip。

数据链路：柱模型 q(t)（WC 或 JR，二选一或双源线性叠加）→ 球形 lead-field（`sphereForward.ts` `interpolateSphereGain`，三线性插值）→ 多通道 µV（无限远参考）→ 噪声（独立生成、独立标注）→ 参考变换。只支持 **250 Hz**：柱模型按自身步长（WC 1 ms、JR 0.5 ms）积分后下采样到 4 ms，其它采样率下 4 ms 网格与步长不对齐，`runExperiment` 直接抛错，不静默近似。

| 参数 | 值 / 范围 | 默认值 | 单位 | 前端 | 后端 |
|---|---|---|---|---|---|
| 采样率 sfreqHz | 只支持 250 | 250 | Hz | 无控件（固定） | `DEFAULT_SFREQ_HZ = 250`（`eegRecording.ts`）；Python `SFREQ_HZ = 250.0` |
| 时长 durationMs | 4 的倍数，且 ≥ eventIntervalMs + driveDurationMs + 500（至少 1 个事件） | 10000 | ms | 下拉 2 / 5 / 10 秒 | `DEFAULT_DURATION_MS = 10000` |
| 导联 montage | 10-20（19 导）/ 10-10（94 导）/ 10-05（343 导） | 10-20 | — | 下拉（切换重建传感器配置） | `sphereForward.ts` `fixture.montages`；`channelsForMontage` |
| 参考 reference | average / infinity / electrode（电极参考有 UI 入口，见 R4） | average | — | 参考下拉 + 电极选择器（`EegWaveTab.tsx`） | `applyReference`；`reReferenceRecording` 从 `rawDataUvInfinity` 重算 |
| 源模型 sourceModel | wc / jr / both（双源线性叠加） | wc | — | 下拉 | `COUPLING_ID` / `JANSEN_RIT_ID`（§1.5(d)(e)）；both 的 sourceModelId 为两者拼接 |
| 源位置 sourcePositionMm | 球形网格内（每轴 −48–+48） | [0, 0, 16] | mm | 无控件（固定假设值） | `DEFAULT_SOURCE_POSITION_MM`；第二源 [16, −16, 16]（仅 both） |
| 源朝向 sourceNormalHead | 单位向量 | [0, 0, 1] | — | 无控件 | `DEFAULT_SOURCE_NORMAL_HEAD` |
| 事件间隔 eventIntervalMs | 1000（固定） | 1000 | ms | 无控件 | 首个事件在 1000 ms，之后每 1000 ms 一次；末个驱动窗须在记录内（留 500 ms 尾） |
| 驱动时长 driveDurationMs | 100（固定） | 100 | ms | 无控件 | `DEFAULT_DRIVE_DURATION_MS = 100` |
| WC 驱动 wcDrive | 无量纲（`step()` 允许 \|stim\| ≤ 10） | 1.0 | 无量纲 | 无控件 | `DEFAULT_WC_DRIVE = 1.0` |
| JR 驱动 jrDrivePerS | 1/s（`step()` 允许 [0, 1000]） | 120 | 1/s | 无控件 | `DEFAULT_JR_DRIVE_PER_S = 120`（与 PR5 `PULSE_PER_S` 同值） |
| JR 静息输入 jrBaselineInputPerS | 90（低分支稳定不动点；220 是极限环，建柱时抛错） | 90 | 1/s | 无控件 | `DEFAULT_JR_BASELINE_INPUT_PER_S = 90` |
| 噪声种子 seed | 整数 | 1 | — | 数字框（min 0，step 1） | `DEFAULT_SEED = 1`；同种子同参数两次运行逐值相同（JSON 级断言） |
| 白噪声 whiteRmsUv | 0–10（UI 滑杆） | 2（开噪声时） | µV RMS | 滑杆 step 0.1 | `generateNoise`（mulberry32 + Box–Muller，每通道归一化到目标 RMS） |
| 粉红噪声 pinkRmsUv | 0–10（UI 滑杆） | 1（开噪声时） | µV RMS | 滑杆 step 0.1 | Voss–McCartney（16 行，每通道归一化到目标 RMS） |
| 工频 line50HzRmsUv | 0–10（UI 滑杆） | 0.5（开噪声时） | µV RMS | 滑杆 step 0.1 | 50 Hz 正弦（随机相位，每通道归一化到目标 RMS） |
| 慢漂移 driftRmsUv | 0–10（UI 滑杆） | 0.5（开噪声时） | µV RMS | 滑杆 step 0.1 | 0.1 / 0.23 / 0.41 Hz 三正弦等幅叠加（每通道归一化到目标 RMS） |

**噪声/伪迹标注：** 四个成分各自由独立逻辑生成，`generateNoise` 返回的 `components` 带 `kind` + `label`（含“伪迹，非神经源”），绝不混入神经源信号；总噪声 RMS ≈ sqrt(Σ RMS²)（成分间交叉项，测试容差 5%）。`recording.noise` 为 `null` 时无噪声；UI 关闭噪声即传 `null`。

**参考（R4）：** `EegReference` 三种模式 average / infinity / electrode；`runExperiment` 先把信号 + 噪声的无限远参考数据存进 `EegRecording.rawDataUvInfinity`（`eegData.ts` 新增的可选字段，加法扩展），再按所选参考生成 `dataUv`；`reReferenceRecording` 从原始数据重算，切换参考不损失信息、不重新跑模型；缺原始数据时抛错，不从已参考过的数据反推。三种参考的数值两两最大差 > 0.01 µV（实测 1.87 / 7.08 / 7.55 µV，见 `tests/pr6/eeg-recording.test.mjs` 的 R4 测试）。

**事件：** 运行实验时按固定间隔产生脉冲事件（`EegEvent`，type `pulse`，条件 standard/oddball 交替，时间戳是仿真时钟 ms）；2 s 只有 1 个事件（1000 ms），10 s 有 9 个（1000–9000 ms）。ERP 分段/平均不在本文件，由 A1 的 `epochRecording` / `averageEpochs` 做（B2 的 ErpTab）。

**状态字段（§4 补充）：** `EegRecording`：`version: 1`、`sfreqHz`、`timesMs`（0 起 4 ms 网格）、`channels`（标签 + 球面位置 mm）、`dataUv`（[通道][采样]，µV，已参考）、`reference`、`montage`、`forwardModelId`（`SPHERE_MODEL_ID`）、`sourceModelId`、`seed`、`noise`（`NoiseParams | null`）、`rawDataUvInfinity?`（无限远参考原始数据，与 `dataUv` 同形；有它才能无损切换参考）。导出：`recordingToCsv`（`#` 注释行写参考/导联/模型 id/种子/噪声，表头 `time_ms,<通道…>`，全精度）与 `recordingToJson`（含 `rawDataUvInfinity`，保证可复现参考切换）。

**UI 控件 → 后端函数（§8.5）：** “运行实验”按钮 → `EegAnalysisLab.handleRunExperiment` → `runExperiment`（`eegRecording.ts`）；参考下拉/电极选择器 → `handleReferenceChange` → `reReferenceRecording`；导联下拉 → `handleMontageChange`（只影响下次运行；电极参考标签若不在新导联内，先回平均参考）；噪声开关/滑杆 → `noise` 状态 → 下次运行进 `generateNoise`；通道选择 → `selectedChannel`（波形行点击亦可）；导出 CSV/JSON → `recordingToCsv` / `recordingToJson`。六个 tab（EEG / 频谱 / ERP / 时频 / 地形 / 源定位）共用壳持有的同一份 `recording` + `events` + `epochs`，props 按设计稿 §1.3。

**对照容差（方法学级）：** 投影/参考/噪声 TS vs Python 逐值对照 1e-9 相对（实测最大差 8e-14）；柱模型 q(t) TS RK4 vs Python DOP853：WC 绝对 1e-5 nA·m + 相对 1e-6（实测差 2.0e-6 nA·m）、JR 绝对 1e-6 nA·m + 相对 1e-6（实测差 1.9e-8 nA·m）；全跑电压绝对 1e-5 µV + 相对 1e-6（实测最大差 1.35e-6 µV）。容差由实测的积分器差异定，仍比 µV 级物理效应小 6 个量级以上，不是为通过而放宽。

---

### 1.7 PR6 时频 / 地形 / 源定位（B3：PR-10/11/12）

模块：`app/src/lib/topography.ts`（PR-11）、`app/src/lib/sourceLocalization.ts`
（PR-12）；时频算法复用 A1 的 `app/src/lib/signalProcessing.ts`
（`erspItc` 等，见 §1.2 的 PR6 增补——A1 部分由总协调登记，本节只登 B3
新增的参数）；Python 对照：`scientific/eeg/inverse_reference.py`
（球面样条 + 偶极子拟合 + MNE 逆解的 numpy 同公式实现 + MNE
`make_inverse_operator`/`apply_inverse` 峰值交叉验证；multitaper ERSP
小 fixture 用 `scientific/eeg/signal_reference.py` 的 `ersp_itc`）。
UI：`app/src/components/TfrTab.tsx`、`TopoTab.tsx`、`InverseTab.tsx`
（壳 `EegAnalysisLab.tsx` 由 B1 拥有；本节的控件只登记参数与默认值，
不登记壳的状态字段）。

| 参数 | 符号 | 值 / 范围 | 单位 | 前端 | 后端 |
|---|---|---|---|---|---|
| ERSP 方法 | method | `stft` / `morlet` / `multitaper`（UI 下拉，默认 `morlet`） | — | `TfrTab.tsx` 方法选择 | `erspItc(epochs, channel, freqs, method, baseline)` |
| ERSP 频率网格 | freqsHz | 2–40 Hz（UI 固定 15 点：2, 4, …, 40） | Hz | `TfrTab.tsx` `FREQS_HZ` | 同左（`erspItc` 的 `freqsHz` 参数） |
| Morlet 周期数 | cycles | 5（固定） | 无量纲 | `TfrTab.tsx`（频段功率与 `erspItc` 内部同值） | `morletTfr(..., { cycles: 5 })` |
| multitaper 锥 | NW / K | 4 / 7（固定，`erspItc` 内部） | — | 无控件（方法内固定） | `multitaperTfr`（`signalProcessing.ts` 内部，NW=4、K=7、窗长 7 个周期） |
| ERSP 基线 | baselineMs | EpochSet 的 `baselineMs`（默认 [−200, 0]） | ms | 无控件（读 EpochSet） | `erspItc` 的 `baselineMs` 参数 |
| 频段功率频段 | band | delta/theta/alpha/beta/gamma（UI 下拉，默认 `beta`；频段定义见 `EEG_BANDS`，唯一定义在 `eegData.ts`） | Hz | `TfrTab.tsx` 频段选择 | `morletTfr` 逐试次功率 → 频段内平均 |
| 球面样条阶数 | m | 4（固定） | — | 无控件 | `topography.ts` `SPLINE_ORDER_M = 4`；Python `SPLINE_ORDER_M = 4` |
| 球面样条截断 | nMax | 7（固定） | — | 无控件 | `topography.ts` `SPLINE_N_MAX = 7`；Python 同值 |
| 球面样条正则化 | λ | 1e-5（固定） | — | 无控件 | `topography.ts` `SPLINE_LAMBDA_DEFAULT = 1e-5`；Python 同值 |
| 地形网格分辨率 | gridResolution | 25（固定）→ 单位圆内 441 点 | — | 无控件 | `sphericalSplineTopography(..., { gridResolution: 25 })` |
| 3D 头皮电位源位置 | sourceMm | 每轴 ±48 mm（UI 数字框，步进 8，默认 [0, 0, 16]） | mm | `TopoTab.tsx` 源位置输入 | `forwardHeadPotential(fixture, sourceMm, ...)`；越界抛错（网格边界） |
| 3D 头皮电位偶极矩 | momentNAm | ±30 nA·m（UI 滑杆，step 0.5，默认 Y 向 10） | nA·m | `TopoTab.tsx` 矩滑杆 | 同上；范围与 PR5 HeadSphereLab 同值 |
| 3D 参考 | reference | `average` / `infinity`（UI 下拉，默认 `average`） | — | `TopoTab.tsx` 参考选择 | `forwardHeadPotential(..., reference)`；average 减 345 点均值 |
| 偶极子拟合网格 | — | 64 点（fixture 源网格，轴 [−48, −16, 16, 48] mm） | mm | 无控件 | `buildLeadField` 的 `sourcePositionsMm`；Python `source_grid_positions_mm()` |
| 偶极子拟合法方程脊 | ridge | 1e-12·trace/3（相对值，固定） | — | 无控件 | `dipoleFit` 内部 |
| MNE 正则化 | λ² | **1/9**（默认；UI 数字框 0.001–1，step 0.01） | 无量纲 | `InverseTab.tsx` λ² 输入 | `mneInverse(..., { lambda2 })`；Python `MNE_LAMBDA2_DEFAULT = 1/9` |
| MNE 噪声 σ | σ | **1.0** µV（默认；UI 数字框 0.1–10，step 0.1） | µV | `InverseTab.tsx` 噪声 σ 输入 | `mneInverse(..., { noiseRmsUv })`；Python `MNE_NOISE_RMS_UV_DEFAULT = 1.0` |
| MNE 源先验 | R | I（无深度加权，固定——不是 MNE 默认 depth=0.8，见 docs/pr6-topo-inverse.md §3.6） | — | 无控件 | `mneInverse` 内部；Python `mne_inverse` 同式 |
| 盲测附加噪声 | noiseRmsUv | 0–2 µV（UI 滑杆，step 0.1，默认 0；种子固定 7） | µV | `InverseTab.tsx` 噪声滑杆 | `blindTest(..., { noiseRmsUv, seed: 7 })`；TS 用 mulberry32+Box–Muller，Python 用 numpy（流不同，不逐点比） |
| 盲测导联 | montage | `10-20` / `10-10` / `10-05`（UI 下拉，默认 `10-20`） | — | `InverseTab.tsx` 导联选择 | `blindTest(fixture, montage, ...)` |

**默认值三处一致（漂移测试卡住）：** λ² = 1/9（TS `MNE_LAMBDA2_DEFAULT` /
Python `MNE_LAMBDA2_DEFAULT` / UI 输入初始值）、σ = 1.0 µV（TS
`MNE_NOISE_RMS_UV_DEFAULT` / Python `MNE_NOISE_RMS_UV_DEFAULT` / UI
输入初始值）、样条 m = 4 / nMax = 7 / λ = 1e-5（TS `SPLINE_ORDER_M` /
`SPLINE_N_MAX` / `SPLINE_LAMBDA_DEFAULT` / Python 同名常量）。
**单位：** 位置 mm、偶极矩 nA·m、电位 µV、ERSP dB、ITC 无量纲、λ² 无量纲、
σ µV。**三种时频方法的 ERSP 不直接混比**（同一份数据峰值本来就不一样，
见 docs/pr6-topo-inverse.md §1.1），UI 必须注明方法与参数。

### 1.8 PR6 WAVES / ERP / 晚期机制参数（B2，2026-11-12）

模块：`app/src/lib/lateResponse.ts`（`LATE_RESPONSE_ID = 'local-jansen-rit-slow-late-v1'`）；
Python 独立对照：`scientific/eeg/late_response_reference.py`（SciPy DOP853）；
机制文档：`docs/pr6-erp-mechanism.md`；UI：`app/src/components/WavesTab.tsx`、
`app/src/components/ErpTab.tsx`（props 约定见 `docs/pr6-design.md` §1.3，壳由 B1 写）。

**晚期机制**（慢 NMDA-like 突触电流 + 延迟再入）：快通路的传入驱动同时驱动
第二慢的二阶突触核 `dr/dt = w`、`dw/dt = a_s²·(gain·stim(t−delay) − r) − 2·a_s·w`，
输出 r(t) [1/s] 反馈回同一 JR 柱：`p(t) = p0 + stim(t) + r(t)`。带参数的动力学
机制，不是加固定 P300 波形；静息时 r = 0 精确成立，基线即普通 JR p0=90 低分支
不动点。RK4 各级取该级时刻的驱动与级状态的 r（k4 在步末取左极限），TS RK4 与
Python DOP853 的 oddball 试次逐点差 y0 最大 9.7e-8 mV（<1e-6 级）。

| 参数 | TS 默认（`DEFAULT_LATE_RESPONSE_PARAMS` 等） | Python 对照 | 单位 |
|---|---|---|---|
| tauSlowMs τ_slow | 200 | `TAU_SLOW_MS=200.0` | ms |
| delayMs | 100 | `DELAY_MS=100.0` | ms |
| slowGain | 2.5 | `SLOW_GAIN=2.5` | 无量纲 |
| slowMaxPerS（数值守卫） | 5000 | `SLOW_MAX_PER_S=5000.0` | 1/s |
| 刺激时长 | 40（`STIM_DURATION_MS`） | `STIM_DURATION_MS=40.0` | ms |
| 标准驱动 / 靶刺激驱动 | 120 / 300 | `STANDARD_DRIVE_PER_S=120.0` / `ODDBALL_DRIVE_PER_S=300.0` | 1/s |
| Pz 增益 | 0.16（`PZ_GAIN_UV_PER_NAM`，范围 0.13–0.188 只作不确定性说明） | `PZ_GAIN_UV_PER_NAM=0.16` | µV/(nA·m) |
| 试次数 / ISI | 40（32 标准 + 8 oddball）/ 1000（`DEFAULT_N_TRIALS` / `DEFAULT_ISI_MS`） | 同协议（MNE 对照 10 试次） | — / ms |
| Epoch 口径 | −200–800 ms、基线 −200–0 ms、峰峰值 >150 µV 剔除 | MNE `Epochs` 同口径 | ms / µV |
| 峰值窗 / 窗均值窗 | 250–600 ms / 300–500 ms | MNE `get_peak(mode='abs')` 同窗 | ms |

校验：`validateLateResponseParams`（τ 20–1000 ms、延迟 0–500 ms、增益 0–100、
守卫上限 (0, 100000] 1/s）；刺激只接受 [0, 1000] 1/s；`step` 内有 JR 同款发散
守卫（y0/y1/y2 越出 [−10, 100] mV、非有限值、r 超守卫即抛错）；`detectLatch`
（末尾 100 ms 内 |q| 均值 > 峰值 |q| 的 5% 即判锁存）：默认增益 2.5 不锁存，
增益 4.0/6.0 锁存且被检出（安全边界见机制文档 §2）。
**幅度不做重缩放**：Pz 增益固定用 PR5 球形头中央值 0.16，N×coherence×pA×mm
乘积不可辨识（翻倍 N 即翻倍输出，测试覆盖）；模型 oddball 峰 0.174 µV vs
真实 8.89 µV 的缺口如实保留，见机制文档 §5。

**WAVES（PR-08）**：JR p0=220 极限环（`runAlphaLimitCycle`，从零起跑 12 s、
去前 2 s，`equilibrate: false`——p0=220 无稳定不动点）；Welch PSD 用 A1 的
`welchPsd`（nFft=1024，df≈0.244 Hz，先减均值，与 scipy 同口径）；实测 alpha
峰 10.99 Hz（y0 与 Pz 同值；ds003061 Pz 10.00 Hz / Oz 9.25 Hz）；alpha 占比
99.8%（纯极限环、无宽带背景，虚高已知）。预设只上已验证的：Alpha 探索 =
JR p0=220；其余频段只作同一份信号的频段功率读数；Oscillatory 10 Hz 正弦驱动
仍标注为外部驱动，不是自发节律。

**ERP（PR-09）**：`runOddballExperiment` 生成单通道 Pz 记录（250 Hz）+
`EegEvent[]`（仿真时钟时间戳 = 累计 ISI）+ 参数快照（快照随结果对象返回，
`EegEvent` 类型无快照字段）；`epochOddballExperiment` / `analyseErp` /
`differenceWaveErp` / `filterEpochsByCondition` 是 A1 函数之上的条件对照
（`EpochSet` / `ErpResult` 类型见 `eegData.ts` §1.1）。测量噪声（白噪声、
有种子、可复现）只为试次 SEM / 试次数量效应演示提供试次变异性，明确标注为
测量噪声、不是神经源活动，默认 0；B1 的 PR-07 全噪声模型落地后由壳层替换。

**前端入口：已有。** `WavesTab.tsx`（PSD/频段/峰值/预设，只显示与计算，不跑模型）、
`ErpTab.tsx`（切分试次按钮 + ERP 波形 + 峰值/潜伏期/差异波/条件对照表，只做
分段/平均/显示，不重新跑模型）。两 tab 均为 §5.2 的前端本地计算（后端在
`app/src/lib`，不在 WASM 引擎——符合设计，不是空壳）；“运行实验”按钮在 EEG 页
（B1 的壳），不在本 tab 内。

**漂移测试断言（待总协调追加进 `tests/pr5/contract.test.mjs`——该文件属 A2，
B2 只在此登记断言文本，不越界改文件）：**
- `DEFAULT_LATE_RESPONSE_PARAMS` 三处一致：TS 默认（τ=200、delay=100、gain=2.5、
  max=5000）= Python 对照（`TAU_SLOW_MS / DELAY_MS / SLOW_GAIN / SLOW_MAX_PER_S`
  同值）= fixture `late-response-reference.json` 的 `mechanism` 段同值；
- `PZ_GAIN_UV_PER_NAM === 0.16`，且 `lateResponse.ts` 全文不含 `rescale`
  （大小写不敏感）；
- `STANDARD_DRIVE_PER_S === 120`、`ODDBALL_DRIVE_PER_S === 300`、
  `STIM_DURATION_MS === 40`、`ERP_REJECT_PEAK_TO_PEAK_UV === 150`，
  且与 `public_eeg_reference_values.json` 的方法口径（epoch −200–800 ms、
  基线 −200–0 ms、剔除 150 µV）一致；
- `LATE_RESPONSE_ID === 'local-jansen-rit-slow-late-v1'`，且
  `runOddballExperiment` 返回的 `recording.sourceModelId` 等于它；
- `WavesTab.tsx` / `ErpTab.tsx` 存在且 props 与设计稿 §1.3 一致
  （WavesTab `{ recording, channel }`、ErpTab `{ recording, events, epochs,
  onEpochsChange, channel }`），且两文件均不 import 柱模型之外的实验运行器
  （ErpTab 不跑模型）。

---

## 2. 坐标系

| 坐标系（`CoordinateSpace`，`app/src/lib/coordinates.ts`） | 含义 | 状态 |
|---|---|---|
| `head-ras-mm` | MNE HEAD RAS，mm；球心在 [0,0,40] | 已实现（MNE 坐标） |
| `head-sphere-centered-mm` | 球心为原点的 HEAD RAS，mm；球心 [0,0,40] mm | 已实现（球形头模型坐标） |
| `mri-ras-mm` | fsaverage MRI RAS，mm | 已实现（仅经显式 `transform_mri_to_head` 变换，见 BEM fixture） |
| `mni152-mm` | MNI152 模板坐标 | **已消除（PR6 R6，2026-11-12）：不在 `CoordinateSpace` 类型中；`parseCoordinateSpace` 遇此字符串抛错并说明原因（无已验证配准）；`validateTransform` 仍在运行时拒绝未类型化字符串** |
| `talairach-mm` | Talairach 坐标 | **已消除（PR6 R6，2026-11-12）：同上** |
| `tvb-demo-mm` | TVB 演示数据原始坐标，mm | 演示渲染坐标，**不与 HEAD/MRI/MNI 互通** |

**唯一已验证的变换：** `MNE_HEAD_TO_SPHERE`（`coordinates.ts`）：HEAD RAS → 球心坐标，纯平移 z −40 mm（矩阵 [1,0,0,0, 0,1,0,0, 0,0,1,−40, 0,0,0,1]，`errorMm = 0`），对应生成脚本 `ORIGIN_M = [0,0,0.04] m`。`validateTransform` 要求 4×4 仿射矩阵最后一行 (0,0,0,1)、method 与 provenance 非空、errorMm ≥ 0 或 null。

**禁用方式（写死在代码里，不是文档口号）：**
- `coordinates.ts` 的 `CoordinateSpace` 类型自 PR6 R6 起**不再列出** `mni152-mm` / `talairach-mm`；字符串到空间的唯一入口是 `parseCoordinateSpace(s)`，遇这两个字符串抛 `RangeError` 并说明原因（无已验证配准，只有 MNI305）。另有 `DISABLED_SPACES` 运行时集合（`'mni152-mm'`、`'talairach-mm'`、`'tvb-demo-mm'`）——`validateTransform` 是唯一 choke point（`applyTransform` / `inverseTransform` / `composeTransforms` 都经过它），任何 from/to 触及禁用空间的变换直接抛 `RangeError`，再合理的矩阵也算不出禁用空间里的数；该集合特意保留为字符串集合，以便未类型化字符串（JSON、JS 调用方）仍被运行时拒绝。
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

完整可恢复状态，JSON 序列化后走 Worker `snapshot_saved` / `restore_snapshot` 与 localStorage。字段：`version`（u32，=1，PR6 R2 新增；缺字段的旧 JSON 视为 1）、`params`（全部 `Params`，含 bg_mode / ou_* / ext_sine_* / seed / drive_const）、`weights`（76×76 live 权重）、`bias`（76）、`step_count`、`rng_state`（SplitMix64 内部状态）、`ou`（76）、`e`、`i`、`e_hist`、`hist_base`、`e0`、`i0`。**`weights_orig` 故意不存**（构造后永不变，恢复不能污染 TVB 原始值对照）。
恢复语义：恢复后与快照时刻 bit-identical（同一 RNG 序列、同一 OU 状态、同一延迟历史）；节点数不匹配时恢复失败且**不修改任何状态**。

### 4.3 localStorage 与版本

| 键 | 内容 | 版本机制 |
|---|---|---|
| `brainrun.snapshot.manual.v1`（`MANUAL_SNAPSHOT_KEY`） | `StoredSnapshot`：`{id:'manual', t_ms, json, savedAtWall, version}` | 键名后缀 `.v1` + 记录内 `version` 字段（`SNAPSHOT_SCHEMA_VERSION = 1`，`simClient.ts`，PR5 新增）；读取时缺 `version` 视为 1（PR5 之前写下的记录），其他版本拒绝、不做静默迁移 |
| `auto` 快照 | 只活在 Worker 内存 + `SimClient` 内存，**永不写 localStorage**；RESET 时清掉，绝不覆盖 `manual` | — |

**快照 JSON 自带版本**（PR6 R2 已解决，见 §7 R2）：Rust `StateSnapshot` 序列化输出含 `version: 1`（`STATE_SNAPSHOT_VERSION`，`crates/brain-core/src/lib.rs`）；缺 `version` 字段的旧 JSON（PR6 之前写下的）经 serde 默认值 1 恢复，不拒绝、不静默错恢复。`SimClient.parseSnapshotSummary` 同步读 `snap.version ?? 1`，进 `SnapshotSummary.version`，并从 JSON 读回 UI 同步用的子集：`params.{g, c_ei, stim_amplitude, stim_duration_ms, bg_mode, ou_tau_ms, ou_sigma, ext_sine_amp, ext_sine_freq_hz}`、`weights`、`bias`；缺失字段的回退默认值与 Rust `Params::default()` 一致（ou_tau 100、ou_sigma 0.10、ext_sine_amp 0、ext_sine_freq 10；注意 oscillatory 预设的 amp 是 0.30，回退 0 对应的是 `Params::default()`，不是 oscillatory 预设）。`StoredSnapshot` 包装层版本（D3）不变，仍是 1。

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
| U1 | 参考方式 `electrode`（以某电极为参考） | `volumeConduction.ts` `Reference`、`sphereForward.ts` `SphereReference`、`fsaverageBEM.ts` `TemplateReference` | **EEG 分析实验已暴露（2026-11-12，PR6 PR-07，R4 已解决）：** `EegAnalysisLab` 的 EEG tab 有参考下拉（平均 / 无限远 / 电极）+ 电极选择器（当前导联的通道），三种参考数值各不相同（漂移测试断言）；切换参考走 `reReferenceRecording`，不重新跑模型。三个 PR5 实验（DipoleLab / HeadSphereLab / LocalBEMLab）的 UI 参考下拉仍只有 `average` / `infinity` 两种，`electrode` 在那里仍无界面入口（有实现无入口，缺口如实保留，不算空壳） |
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
| D1 | `protocol.ts` 的 `SimParams.stim_amplitude` 注释写“范围 0.5–2.0”，但引擎 clamp 是 0–4.0（`crates/brain-wasm/src/lib.rs` L160–161）——注释即契约，注释与引擎不一致 | 改 `protocol.ts` 注释为实情：UI 暴露 0.5–2.0，引擎 clamp 0–4.0，UI 范围是引擎范围的真子集；完整裁决见残留 R1（引擎侧改动超出本子代理文件归属，需 Rust 侧定）。**PR6 后续：R1 已裁决为 (a) 收紧引擎 clamp 到 0.5–2.0，`protocol.ts` 注释里 “引擎侧 clamp 是 0–4.0” 一句须同步改为 0.5–2.0（由总协调改，见 §7 R1）。** | 漂移测试：UI 端点 ⊆ 引擎 clamp；UI 端点 = KNOB_MAP 端点 = 数字框 min/max |
| D2 | `set_snapshot_hz` 是孤儿消息：`protocol.ts` 定义了它，`simWorker.ts` 处理了它，但 `SimClient` 与 `App` 全无发送方——协议与客户端漂移 | `app/src/lib/simClient.ts` 新增 `setSnapshotHz(hz)`（客户端镜像 Worker 的 1–120 Hz clamp）+ 调试桥入口；UI 仍固定 60 Hz 不设控件 | 漂移测试：21 种入站消息每种都有 `SimClient` 发送点；21 种每种都有 Worker 处理分支 |
| D3 | 快照持久化无记录内版本：`StoredSnapshot` 只有键名后缀 `.v1`，记录本身无版本字段；将来换 schema 无法识别旧记录 | `simClient.ts` 新增 `SNAPSHOT_SCHEMA_VERSION = 1` 与 `StoredSnapshot.version` 字段；写入时带版本；读取时缺版本视为 1（兼容 PR5 前的记录），其他版本拒绝 | 漂移测试：常量=1；读取逻辑含版本分支（源码对照） |

---

## 7. 残留项

| # | 残留 | 说明 | 归属 / 下一步 |
|---|---|---|---|
| R1 | ~~`stim_amplitude` 引擎 clamp（0–4.0）比 UI 暴露范围（0.5–2.0）宽~~ **已解决（2026-11-12，PR6，方案 (a)）** | 全仓 grep 无任何 `set_stim_amplitude` 用例超过 2.0（UI 最大 2.0、测试最大 2.0），WASM clamp 已从 0–4.0 收紧到 **0.5–2.0**，与 UI 相等（`crates/brain-wasm/src/lib.rs` `set_stim_amplitude`）。唯一超 2.0 的幅度是 `reference/python-model/experiments.py` 幅度 sweep 的 4.0，它走 StimulusEvent 直接事件幅度（`add_stimulus` 不钳制），不经过本 setter，不受影响。**待总协调补一处（不在 A2 文件归属内）：** `app/src/worker/protocol.ts` 的 `stim_amplitude` 注释仍写“引擎侧 clamp 是 0–4.0”，须改为 0.5–2.0（exact 文案见 A2 汇报）；漂移测试已按新 clamp 更新，待该注释改完后应追加断言 protocol.ts 不再含 '0–4.0'。 | PR6 A2 已改引擎 + 契约 §1.2 + 漂移测试；protocol.ts 注释待总协调 |
| R2 | ~~快照 JSON（Rust `StateSnapshot`）本身无 `version` 字段~~ **已解决（2026-11-12，PR6）** | `StateSnapshot` 加 `version: u32`（`STATE_SNAPSHOT_VERSION = 1`；`#[serde(default = "default_snapshot_version")]`，缺字段的旧 JSON 视为 1 恢复）；`take_snapshot` 写 1；`SimClient.parseSnapshotSummary` 同步读 `snap.version ?? 1` 进 `SnapshotSummary.version`；Rust 单元测试 `pr6_snapshot_version_written_and_old_json_restores_as_v1` 覆盖新旧两路。 | PR6 A2；`cargo test` 通过 |
| R3 | ~~Jansen–Rit 已定稿但无 UI 入口 + 说明文档未落盘~~ **已解决（2026-11-11）** | UI 入口已接（`LocalBEMLab` 源模型切换），`docs/pr5-jansen-rit.md` 已落盘；契约 §1.5(e) 与 §5.3 U5 已同步更新，漂移测试由“不应已接”改为断言“LocalBEMLab 已接、其余组件未接” | — |
| R4 | ~~`electrode` 参考方式无 UI 入口~~ **已解决（2026-11-12，PR6 PR-07，B1）** | EEG 分析实验（`EegAnalysisLab` / `EegWaveTab.tsx`）的参考下拉已有 average / infinity / electrode 三种 + 电极选择器（当前导联的通道）；三种参考的数值两两最大差 > 0.01 µV（实测 1.87 / 7.08 / 7.55 µV，`tests/pr6/eeg-recording.test.mjs` R4 测试断言）；切换参考走 `reReferenceRecording`（从 `rawDataUvInfinity` 重算，不重新跑模型）。见 §1.6 / §5.3 U1。三个 PR5 实验的参考下拉仍只有两种（U1 剩余缺口，非本轮范围）。 | PR6 B1；`tests/pr6/eeg-recording.test.mjs` 13/13 + 漂移测试通过 |
| R5 | 球形头 fixture 未入库，本地无法跑 `sphere-forward` 类测试 | `app/public/forward-assets/sphere-model.json` 由 CI 生成、不入库；本机 clone 里没有该文件，依赖它的既有测试在本地跑不通（非产品问题）。本契约的漂移测试只读源码与生成脚本，不依赖该 fixture | 生成脚本在 CI 跑；本地复现需 `scientific/forward/generate_sphere_model.py`（MNE 1.11.0） |
| R6 | ~~MNI152 / Talairach 仍是“禁用但未在类型层面彻底消除”~~ **已解决（2026-11-12，PR6）** | `'mni152-mm' | 'talairach-mm'` 已从 `CoordinateSpace` 联合类型中去掉；字符串唯一入口是新增的 `parseCoordinateSpace(s: string): CoordinateSpace`，遇禁用空间抛 `RangeError` 并说明原因（无已验证配准，只有 MNI305）；`validateTransform` choke point 与 `DISABLED_SPACES` 运行时集合保留（防未类型化字符串），行为级断言不变。 | PR6 A2；`tests/pr5/coordinates.test.mjs` + 漂移测试通过 |

---

## 8. 维护规则

**改任一侧 → 同步改契约 + 另一侧 + 跑漂移测试。** 具体检查清单：

### 8.1 新增 / 修改参数
- [ ] 在 §1 参数总表登记：中英文名、符号、单位、范围、默认值、所属模块
- [ ] 前端控件（控件名、min/max/step、映射公式）与后端变量名（Rust/Python/scientific）逐一对上
- [ ] 前端滑杆 min/max/step 与后端 clamp 一致（PR6 之前 stim_amplitude 曾是 UI ⊆ 引擎的例外，见 §7 已解决的 R1；如今四者全部相等）
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
