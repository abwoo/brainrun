# PR8-A debug rounds — 四个模式 + 15 个一键科学场景

分工 A：计划 §16.1（四个模式）、§16.2（渐进式展示）、§16.3（15 个一键场景）。
工作区 `~/workspace/brainrun-pr8-a`（main 453e5707 的拷贝，分支 `pr8-polish-release`）。
只在本地工作，不 push、不开 PR、不合并。

## 0. 接续情况：复用了哪些半成品

上一位执行人留下的半成品共两件，全部复用、未重写：

- `app/src/lib/scenarios.ts`（615 行）：15 个场景定义、模式类型与状态机、
  `runScenarioCompute`、`validateScenarioPresets`、`alphaLimitCycleRecording`。
- `app/src/components/ExplorePanel.tsx`（227 行）：EXPLORE 模式面板。

其余按任务说明所写，确实什么都没有：无 ScenarioLauncher、无 App 集成、
无契约 §1.12、无测试、无 debug 记录、无本地 commit。

## 1. 半成品核验（先读、先核验、再复用）

### 1.1 scenarios.ts：逐一核对 backend 映射

逐个核对了全部 15 个场景声明的后端函数名、签名与调用方式
（`eegRecording.ts`、`lateResponse.ts`、`cellular.ts`、`experiments.ts`、
`signalProcessing.ts`、`sourceLocalization.ts`、`topography.ts`、
`sphereForward.ts`、`volumeConduction.ts`），并用真实 fixture 实跑
S4–S15（见 §1.2）。结论：映射全部真实，只发现两处真 bug（S7、S10，
见下），其余未动。

### 1.2 实跑数字（2026-11-12，fixture 齐全）

- S4：alpha 峰 10.9863 Hz、占比 0.9981、Pz RMS 0.0167 µV。
- S5：Cz 0.1303 → 0.1292 µV，变化 −0.0011 µV。
- S6：导联 19 / 94 / 343，Pz RMS 0.0283 / 0.0328 / 0.0305 µV。
- S7（修后）：FCz 0.4254、C1 0.1625、Cz 0.1686、C2 0.1670、CPz −0.1344 µV，极差 0.5599 µV。
- S8：oddball 峰 0.1742 µV @352 ms、差异波 300–500 ms 均值 0.0612 µV、8 试次。
- S9：窗内平均 ERSP 2.6384 dB、ITC 0.7905、40 试次。
- S10（修后）：地形峰 0.1755 µV @Cz，正向峰 −0.7341 µV @Oz。
- S11：偶极子拟合误差 0.0000 mm、MNE 55.4256 mm、残差 RMS 0.0000 µV。
- S12：y0 峰差 0.0069 mV、Pz RMS 差 0.0057 µV、ERP 峰差 0.0090 µV。
- S13：4 个动作电位、膜电位峰 39.7685 mV、首个 11.9250 ms。
- S14：σ=0.10 / 0.33 / 1.00 S/m 时 S10 电位 0.9824 / 0.2977 / 0.0982 µV（严格 1/σ）。
- S15：触发占比 0.0227、RMS 差 −0.0016 µV、峰值差 −0.0018 µV、无控制 Pz RMS 0.0284 µV。
- S1–S3 在 `runScenarioCompute` 里按设计抛错（需实时引擎）；S5–S7、S10、S11
  在 fixture 为 null 时按设计抛错，不编造 lead-field。

### 1.3 修掉的两个真 bug（都在 scenarios.ts，测试先抓到、再修）

- **S7 导联错（B1）：** 预设与计算都写 10-20，但 FCz / C1 / C2 / CPz
  不是 10-20 标签（MNE 标准 10-20 只有 Cz），实跑抛
  `Scenario 7: electrode FCz not in 10-20 montage`。修法：导联改 10-10
  （五电极全在 10-10 里），预设、计算调用、报错文案、备注同步改；
  `validateScenarioPresets` 增加 `montage === '10-10'` 交叉断言。
  未改电极列表（场景本意就是 Cz 附近五个点）。
- **S10 采样时刻错（B2）：** 原 atTimeMs=400 ms 在唯一事件（t=1000 ms）
  之前，地形恒为 0.0000 µV，场景的对照无意义。修法：atTimeMs 改 1050 ms
  （事件后 50 ms，近峰值），并把计算里写死的 `topoAtTime(recording, 400)`
  与备注里的 “400 ms” 改成读预设；校验同步收紧，说明 400 ms 为何不行。
  修后地形峰 0.1755 µV @Cz。
- 另：我的检查脚本第一次把 `validateSphereFixture`（返回 void）的返回值
  当 fixture 传，误报 S5 缺 fixture——脚本 bug，不是产品 bug，已修正脚本。

### 1.4 ExplorePanel 核验

- 引用的 `brainData.ts`（`topConnections` L87）与 `coordinates.ts`
  （`MNE_HEAD_TO_SPHERE` L177、`applyTransform` L117、`inverseTransform` L131、
  `parseCoordinateSpace` L42）真实存在、语义与注释一致；MNI152 / Talairach
  确实抛 `RangeError`。
- 修掉一处 TS 错：`Vec3Mm` 是只读元组，`next[i] = ...` 索引赋值编译不过
  （`tsc` 报错 TS2542）；改按轴显式重建元组。构建因此前一直过不了，
  不是新引入的问题。

## 2. 本轮做的事

### 2.1 四个模式（App.tsx）

- 顶栏新增 `.mode-switch`（四个按钮，`data-mode`、`aria-pressed`、
  `transitionMode` 状态机），默认 PLAY。
- PLAY：现有主场景不变。WAVES：主场景 + `WavesTab`（真实 PSD/频段内容；
  记录来自 S4 的 JR 极限环，侧栏有“运行场景 4”按钮；未跑过 S4 时显示
  WavesTab 原有的空态提示）。EEG：`EegAnalysisLab` 内联渲染
  （新增 `inline` / `initialTab` props；`initialTab` 变化时切 tab，
  S8–S11 的“打开实验台”可直达对应 tab；内联时无 backdrop、无关闭按钮，
  用模式切换退出）。EXPLORE：主场景 + 已有的 `ExplorePanel` + 细胞实验室入口。
- `EegAnalysisLab` 的弹窗用法未变（HEAD EEG 芯片仍走弹窗）。

### 2.2 渐进式展示（§16.2，“更多”开关）

- 默认：3D 大脑 + 少量控制 + 实时测量窗口（LIVE ACTIVITY、RESPONSE）+
  简单操作说明（底栏）。BACKGROUND / PARAMETERS / REGION 三块面板收到
  “更多”后面；开关在顶栏与侧栏底部各一处。
- 类名与选择器（`.param`、`data-param`、`.resp-row`、`data-edge` 等）与改前
  完全一致，现有测试的定位不动。**但注意：** 旧版 PR2–PR4 浏览器测试在点
  参数/脑区控件前须先点“更多”（默认 `.param` 数量为 0，展开后为 4；
  这是 16.2 的既定行为变化，不是定位破坏；按 2026-11-11 测试节奏新规，
  旧全量回归本就推迟到 PR8 合并之后做最终大测试，届时在那套测试里补
  一次“点更多”的前置步骤即可）。
- 顶栏与 `.topbar-controls` 补 `flex-wrap: wrap`，否则新增的 6 个芯片在
  978px 下会溢出（冒烟 A7 已验无溢出）。

### 2.3 15 个一键科学场景（ScenarioLauncher.tsx，新建）

- 新建 `app/src/components/ScenarioLauncher.tsx`：顶栏“一键场景”芯片打开的弹窗，
  15 个场景全部复用 `SCENARIOS` 与 `runScenarioCompute`。
- 每个场景 = 预设 + 真实动作 + 实验记录：运行逻辑在 `App.runScenarioById`
  （单一事实来源；WAVES 侧栏的“运行场景 4”调同一函数）。S1–S3 走
  `App.runLiveScenario`（真实引擎动作：`pulse` / `setWeight`+`pulse`+
  `resetWeight` / `setParams({c_ei})`+`pulse`），峰值 ΔE 从响应窗口快照算出
  再记入记录；S2 跑完恢复原始权重（`finally` 保证），S3 的 c_ei=6.0 留在
  PARAMETERS 面板（按场景定义，可手动改回）。
- 每次运行追加一条实验记录（时间、场景、预设、关键结果数字、备注），
  记录状态在 App 持有、关弹窗不丢；可导出 JSON，可清空；每条记录与每个
  场景行都有 `data-record` / `data-scenario` 供测试定位；需要 fixture 的
  场景在未加载时按钮禁用并明说原因。
- S4 跑完把 JR 极限环 Pz 记录交给 App（`wavesRecording`），WAVES 模式的
  WavesTab 随即画出真实 PSD。
- **S1–S3 读数时机的修正（冒烟抓到）：** 第一版等“汇总第一次非空”就读数，
  窗口未填满时峰值被低估（1920px 冒烟：−0.0036，响应 1 个）；已改等满窗
  （最后一条快照到达窗口末尾，`t1_ms − 16ms`）再读数，零响应也不超时
  （汇总为 null 时响应数记 0）。改后重跑冒烟见 §4。

### 2.4 契约 §1.12（docs/frontend-backend-contract.md 末尾新增）

- 模式定义、15 个场景的预设精确值、控件→后端映射（按 §8.5 格式，
  含函数名与文件行号）、“更多”登记、S7/S10 两处修正的说明、
  实测关键数字。未改契约文件头。
- 模型信息弹窗文案同步（PR8-C 残留 R-C1）：按 C 路已合入的 model-spec
  §1 / §13 口径（读的是 `~/workspace/brainrun-pr8-c/docs/model-spec.md`，
  本工作区的 model-spec.md 未动，属 C 路范围），定位改为**教学仿真**，
  并补上 51 倍幅度缺口等关键数字（P300 0.174 vs 8.89 µV；300–500 ms 均值
  0.070 vs 6.94 µV，差 99 倍；差异波峰 0.166 vs 9.14 µV，差 55 倍；
  基线 RMS 0 vs 6.07 µV；alpha 占比 99.8% vs Pz 30.3% / Oz 69.3%；
  深度偏置、MNE 峰值压缩、偶极矩假设链未校准）。数字全部引自 C 路
  model-spec §13.1，未自编。

### 2.5 方法学测试与构建

- 新建 `tests/pr8/modes-scenarios.test.mjs`（17 个测试）：预设校验、
  模式状态机、15 个 id 连续无空场景、S1–S3 抛错、S4–S15 实跑有限关键数、
  S7 用 10-10、S10 采样在事件后且峰值非零、S6 导联数 19/94/343、
  S11 偶极子拟合 ~0 而 MNE 大、S13 4 个锋电位、S14 严格 1/σ、
  无 fixture 抛错、确定性、S4 记录形状（2501 点，含两端）。
- 构建：`scripts/build-wasm.sh` 通过；`cd app && npm run build` 通过
  （`tsc -b && vite build`；chunk > 500 kB 的警告是既有的，非失败）。
  `tests/pr5/contract.test.mjs` 21/21 仍绿（未动该文件，只追加了契约 §1.12）。

## 3. 遇到的问题

1. **本地无球形正向模型**（gitignored）：按任务说明用
   `~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py`
   生成 `app/public/forward-assets/sphere-model.json`（345 通道，19/94/343 导）。
2. **本地无 brain-assets**（gitignored，CI 生成）：preview 的 dist 里没有，
   脑数据 404 → 仿真从未启动（TIME 恒 0.0、S1 超时）。从主仓库
   `~/workspace/brainrun/app/public/brain-assets/` 拷贝了一份到本工作区
   （gitignored，不入库），重建后 TIME 正常推进。注意：下次 `npm run build`
   前若清掉 brain-assets 会重现——这是环境问题，不是产品问题。
3. **冒烟脚本的选择器写错**：启动器弹窗的 `aria-label` 是“一键科学场景”，
   脚本写成了“一键场景”，误报 A4。已修正脚本（产品未动）。
4. **测试期望的端点计数错**：`alphaLimitCycleRecording` 是 2501 点
   （2000–12000 ms 每 4 ms 含两端），测试初版写 2500，2 个测试失败；
   已修正测试（产品未动）。
5. **S1 读数时机（产品问题，已修）**：见 §2.3 末尾。

## 4. 测试与冒烟结果

### 4.1 方法学测试

`node --experimental-strip-types --test tests/pr8/modes-scenarios.test.mjs`：
**17/17 通过**（约 10 s）。契约漂移测试
`tests/pr5/contract.test.mjs`：**21/21 通过**。

### 4.2 浏览器冒烟（tests/pr8/smoke-a.py，本地 preview :4173）

- 第一轮：30/36——失败的 6 项全是环境/脚本问题（TIME 不动 = 脑数据缺失，
  见 §3.2；launcher 选择器写错，见 §3.3；S1 超时是 TIME 不动的连带）。
- 修环境与脚本后第二轮：**36/36 通过**（1920×1080 与 978px 各 18 项）：
  TIME 推进、四个模式内容真实、更多 0→4→0、启动器打开、S14/S4/S5/S1
  均跑出记录并追加、WAVES 在 S4 后画出真实 PSD、启动器打开与 WAVES 下
  均无横向溢出、零 console/page 报错。截图在 `tests/pr8/smoke-shots/`。
  细节：1920px 下 S1 首轮读到峰值 −0.0036（窗口未填满，见 §2.3），
  978px 下 S1 峰值 0.4820、响应 16 个。
- S1 读数时机修正后第三轮：**35/36**。唯一失败是 1920px 的 A6（S1 在
  30 s 内未出记录）；978px 的 S1 通过（2499 ms，满窗读数）。随后用
  聚焦探针在同一构建上连跑 3 次 S1：**3/3 通过**，峰值
  0.4831 / 0.4819 / 0.4823、响应 14 / 15 / 18 个、耗时
  2202 / 2209 / 2340 ms——满窗读数本身是对的（与 PR4 已知的标准脉冲峰值
  约 0.48 一致）。1920px 那次超时未能复现，旧构建又没有诊断信息，
  无法定性；已在超时报错里补上最后看到的窗口状态（基线时刻、快照条数、
  末条时刻、窗口末尾），再出现时可直接定位。为这一项单点再跑一次
  6 分钟全量冒烟不划算，故不再重跑全量（见残留 R-A6）。

## 5. 残留

- R-A1：旧版 PR2–PR4 浏览器测试在点参数/脑区控件前须先点“更多”
  （见 §2.2）。定位（类名/选择器）未动；按测试节奏新规，旧全量回归
  推迟到 PR8 合并之后，届时补前置步骤。
- R-A2：S5 的 Cz 变化量只有 −0.0011 µV（源横向移动 16 mm 时 Cz 近乎对称），
  数字真实但演示效果弱；未改（改预设会动契约登记的场景定义，需总协调定）。
- R-A3：S10 的地形峰值电极是 Cz，正向峰值电极是 Oz——两张图数据来源不同
  （记录值插值 vs L·q 直接求值），场景备注已写明，不算不一致。
- R-A4：WavesTab 空态文案仍写“先在 EEG 页运行实验”，WAVES 模式下另有
  S4 按钮可走；未改 WavesTab（PR6 的文件，文案不算错）。
- R-A5：模型信息弹窗同步的是 C 路 model-spec §1/§13；本工作区的
  model-spec.md 仍是旧版（无 §13），由 C 路/总协调统一合入，本轮不动。
- R-A6：第三轮冒烟 1920px 的 S1 超时（1 次）未能复现（聚焦探针 3/3 通过、
  978px 冒烟通过）；超时报错已补诊断信息（最后看到的窗口状态）。若在
  最终大测试里重现，按报错里的窗口状态定位，不重跑全量冒烟。
- R-C1（已闭环）：见 §2.4。
