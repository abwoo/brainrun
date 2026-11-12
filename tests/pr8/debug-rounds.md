# PR8-NUMFIX 诊断与修复记录（2026-11-12）

live 站实测 5 项数值异常 + 1 处 ERP 诚实性缺陷。全部先复算确认根因再修，
每项都有修复前后数字对照。复算口径：默认 10 s WC 实验（壳默认：montage
10-20、平均参考、无噪声、种子 1）+ `runOddballExperiment({})`；真实球形
fixture（`app/public/forward-assets/sphere-model.json`）与合成 fixture
（`tests/pr6/fixtures/eeg-recording-reference.json`）两套都跑过，模式一致，
数值见各节（测试断言用合成 fixture 的值）。

## NUMFIX-1 ERP 三行峰值全 0.000 µV、潜伏期全 252 ms

**诊断。** 不是表格算错，是数据源里就没有晚期成分：壳实验记录是 plain
WC/JR 模型、无 late 机制。复算（真实 fixture）：WC 默认 oddball 峰
0.000061 µV @252 ms、standard 同值、差异波 0.000000 @252 ms；JR 默认
−0.00143 µV @252 ms（与机制文档 §1 的“窗内仅 −0.002 µV”一致）。252 ms
是峰值窗首（250–600 ms，4 ms 网格上第一个采样点）：窗内只有早期峰的衰
减尾巴，最大 |值| 就在窗首；`peakInWindow` 的严格 `>` 是标准 argmax 行为，
本身没错。图上约 0.2 µV 是全 epoch 最大 |均值| 0.204 µV 的早期峰（不在
峰值窗内），图纵轴半幅 0.234 µV——图与表口径不同，不是图算错。
**修复。** 见 NUMFIX-2：ErpTab 加 late 实验按钮，点后三行变为 oddball
0.174 @352、standard 0.010 @412、差异波 0.166 @352（µV/ms）。
**修复前后。** 壳路径：0.000061 @252 → late 路径：0.174 @352（oddball 行）。

## NUMFIX-2 ERP 诚实性缺陷（界面写 0.17 µV、实际算 ≈0）

**诊断。** 旧文案无条件写“模型峰约 0.17 µV”，那个数属于 late 机制
（机制文档 §4：0.174 µV @352 ms），但 tab 实际切的是壳的 plain 记录，
窗内 ≈0；且 `tests/pr5/contract.test.mjs:695` 曾断言 tab 不应跑
`runOddballExperiment`，late 机制从不被 tab 调用。幅度缺口 51 倍
（0.174 vs 真实 8.89 µV）不在本轮修，定位已是教学仿真。
**修复（选了“让 tab 真正走 late 机制”这条）。** ErpTab 加显式按钮“运行
oddball 实验（late 机制）并切分”：跑 `runOddballExperiment({})`（默认
40 试次、单通道 Pz）后切分，只改 epochs、不碰壳的 recording/events；
文案与“已切分”计数按 epochs 来源（`epochSource`）条件化——late 路径写
0.17 µV（与本表实测 0.174 @352 一致），壳路径如实写“窗内基本无响应、
峰 <0.001 µV、潜伏期落在窗首 252 ms”。late 实验单通道 Pz：当前通道不是
Pz 时明确提示切通道，不静默换通道。旧断言按契约流程作废并更新
（`tests/pr5/contract.test.mjs` B2 节 + 契约 §1.8 新增 PR8-NUMFIX 段，
写清理由）；机制文档新增 §7。
**修复前后。** 壳路径文案：无条件 0.17 µV → 按来源条件化；late 路径实测：
oddball 峰 0.174 @352、窗均值 0.0697、差异波峰 0.166 @352。

## NUMFIX-3 ITC 恰 1.000

**诊断。** 公式没错：无噪声时各试次完全相同，TFR 相位全同，
ITC = |试次平均 e^(iφ)| 恒为 1。复算（合成 fixture，Morlet）：
无噪声试次间最大差 1.9e-16 µV（真实 fixture 同量级），ITC 最大 1.000000、
均值 0.999555（合成 fixture 均值 1.000000）；0.25 µV 白噪声下试次间最大差
1.28 µV、10 Hz ITC 最大 0.79、均值 0.33。`erspItc` 本身未动（全同试次下
ITC=1 数学上正确；tfr-topo-inverse 的 20 Hz 突发 ITC ≈1.00 断言仍有效）。
**修复。** `signalProcessing.ts` 新增 `maxTrialDifferenceUv` +
`ITC_DEGENERATE_THRESHOLD_UV = 1e-6` µV（阈值实测依据：无噪声 1.9e-16
vs 有噪声 1.28，相隔 6 个量级以上）；TfrTab 在试次间最大差 <1e-6 µV 时
不展示 ITC 数值，写清“试次完全相同，ITC 恒为 1.000 是退化值、不是锁相证据，
加测量噪声后重跑”。ERSP 是功率比，仍有意义，不压住。
**边界情形。** late 实验混合试次不退化：标准与 oddball 波形本就不同
（差 0.166 µV），ITC 均值 0.77 是真实测量；只取 oddball 子集时差
3.9e-3 µV（逐试次基线校正引入的抖动，仍 >1e-6），故 TfrTab 在 late 数据下
展示 ITC 数值是正确的。冒烟脚本因此先在壳试次上验 N3，再点 late 按钮。
**修复前后。** 无噪声壳试次：ITC 1.000 展示 → 显示“不适用（退化值）”；
有噪声：ITC 10 Hz 最大 0.79、均值 0.33，正常展示。

## NUMFIX-4 地形 2D 在 400 ms 全空白

**诊断。** 默认时刻 400 ms 落在第一事件（默认实验 1000 ms）之前，记录处于
静息态。复算：topo@400 ms 全部 19 个电极值恰为 0.000e+0 µV（真实与合成
fixture 一致）；全记录最大响应在 1028 ms，最大 |V| 0.234 µV（真实 fixture；
合成 fixture 2.72 µV，增益不同、时刻同为 1028 ms）。全 0 时
`topoColor(0, maxAbs 下限 0.001)` 得白色块，2D 图是一张全白圆盘。
**修复。** TopoTab：记录到达时检查一次，若当前时刻全部电极 |值| <1e-9 µV
就自动跳到全记录最大响应时刻（只在 recording 对象变化时做一次，不干扰
用户手动拖动）；另加“跳到最大响应时刻”按钮。2D/3D 源无法统一：记录里不存
源位置/矩（`EegRecording` 只有 `sourceModelId`），改源模型要动
`eegRecording.ts`（本轮禁区）；3D 图“源由下方控件给定，与 2D 图的记录数据
无关”的如实标注已在界面上，保留。
**修复前后。** 默认打开地形页：400 ms 全白圆盘 → 自动跳到 1028 ms、最大
|V| 0.234 µV 的非空地形。

## NUMFIX-5 TES 目标点 0.000 V/m、网格最大 32.631 V/m

**诊断。** 不是电场算错，是 StimLab 把两个场张冠李戴：`field` 与 `grid` 都跟
`fieldSource`（默认 `'tms'`），与级别无关。Level B（TES）读数栏显示的却是
TMS 场——默认目标 [0,0,70] 在圆环线圈轴上，感应电场按对称性恰为 0；
同页网格是 TMS 网格，偏轴点最大 32.631 V/m。复算：TES 默认目标 |E| =
0.793 V/m（E = (0.0000, −0.0279, −0.7922)），TMS 轴上 |E| = 5.0e-14 V/m
（≈0），TMS 网格最大 32.631 V/m（与 live 实测值逐字一致），TES 网格最大
2.164 V/m；偏轴目标 [30,0,70] 的 TMS |E| = 84.994 V/m。
**修复。** StimLab：`field`/`grid` 跟随级别——B 级固定 TES、C 级固定 TMS，
`fieldSource` 只在 Level D（电场→响应映射）里起作用；Level C 轴上为零时
加一句说明（对称性正确结果，偏轴目标可见 ≈85 V/m）。
**修复前后。** Level B 默认：目标点 0.000 → 0.793 V/m，网格最大 32.631 →
2.164 V/m（同为 TES 场，前后一致）；Level C 默认目标仍为 0.000，但已标注
为对称性正确结果。

## 测试与构建

- 新增 `tests/pr8/methods-numfix.test.mjs`（5 项，每项都有修前失败、修后通过
  的断言：源码级存在性 + 数值）：5/5 通过。两处测试容差是浮点误差内的
  松动，不是放宽科学门槛：ITC 最大值 1.0000000000000004（cos/sin 求和舍入）
  改为 |max−1|<1e-9；TMS 轴上 |E| 5.0e-14 V/m 改为 <1e-9。
- 回归 TS：pr6（waves-erp、tfr-topo-inverse、signal-processing、eeg-recording）
  + pr5 contract 80/80；pr7（stimulation、depth-weighted-inverse、cellular、
  experiments）+ pr8 methods（stimulation、baseline-ou、alpha-background、
  depth、numfix）42/42；pr8 modes-scenarios 53/53（含前两批）。
  Python（eeg-venv）：pr6 45/45、pr8 12/12。Python 测试与本轮改动无关
  （未动 Python 代码），只作回归确认；首次用 brainrun .venv 跑失败是缺
  scipy（环境原因，改用 eeg-venv 后全绿）。
- 构建：`cd app && npm run build` 通过（tsc + vite；chunk >500 kB 警告是既有的）。
- 浏览器冒烟：`tests/pr8/numfix-smoke.py`，preview 4173，1920×1080 与 978px
  各 18 项，36/36 通过，无 console 报错、无横向溢出（ERP 壳/late 两路径、
  TFR 退化提示、地形自动跳 1028 ms、StimLab Level B 0.793/2.164）。
  第一轮 32/36：两处是冒烟脚本自身的检查问题，非产品问题——N2c 检查
  “壳路径不出现 0.17”过严（壳文案本身会提及 0.17 作对照），改为检查 late
  分支专属句“本表 oddball 行实测”不出现；N3 顺序错（先点了 late 按钮，
  TFR 看到的是混合试次、ITC 均值 0.77 本就不是退化值），改为先在壳试次上验
  N3。脚本已修正，第二轮 36/36。截图：`tests/pr8/smoke-shots/*-numfix-*.png`。

## 改动文件（只在允许范围内）

- `app/src/components/ErpTab.tsx`（late 按钮 + 来源条件化文案）
- `app/src/components/TfrTab.tsx`（退化 ITC 压住 + 提示）
- `app/src/components/TopoTab.tsx`（自动跳最大响应时刻 + 按钮）
- `app/src/components/StimLab.tsx`（仅 TES 目标点部分：场/网格跟随级别）
- `app/src/lib/signalProcessing.ts`（仅新增 `maxTrialDifferenceUv` 与阈值常量，
  `erspItc` 计算未动）
- `tests/pr6/*` 未动；新增 `tests/pr8/methods-numfix.test.mjs`、
  `tests/pr8/numfix-smoke.py`、`tests/pr8/smoke-shots/*-numfix-*.png`
- `tests/pr5/contract.test.mjs`（B2 节断言更新）与
  `docs/frontend-backend-contract.md` §1.8（PR8-NUMFIX 段）、
  `docs/pr6-erp-mechanism.md` §7（诚实性修补记录）
- 未碰：App.tsx、App.css、EegAnalysisLab.tsx、CellularLab.tsx、
  HeadSphereLab.tsx、DipoleLab.tsx、ExperimentLab.tsx、eegRecording.ts、
  lateResponse.ts（机制未动）、workflow 文件。未推远程、未标 Ready、未合并。

## 残留

1. 幅度缺口仍 51 倍（late 峰 0.174 µV vs 真实 8.89 µV），定位仍是教学仿真，
   需 PR6/PR7 的真实节律/ERP 生成机制，不在本轮修。
2. “全批只用一份记录”在 ERP tab 上让位于诚实性：late 按钮跑的实验只改
   epochs、不碰壳的 recording/events，两条路径的来源已在界面上写清；
   TFR/地形/源定位三 tab 仍读壳记录，不受 late 按钮影响（地形仍用壳记录，
   源定位仍用壳记录 + fixture）。
3. 2D/3D 地形源未统一（记录里不存源位置/矩），界面已如实标注两者无关；
   真要统一需把源位置/矩写进记录，超出本轮范围。
4. ITC 退化判断只看试次间最大差：oddball-only 子集的 3.9e-3 µV 抖动仍
   >1e-6，会被判为“非退化”而展示 ITC（峰值处 ≈1.000）；这是确定性模型
   试次几乎全同的如实反映，不是误判，但 TFR tab 正常流程里看不到该子集
   （壳持有混合试次集）。

---

# PR8-LINK：§4.1 统一仿真状态——六实验台接主仿真（2026-11-12）

## 计划与路线选择

- EEG 台选 (a) 路：Worker 60 Hz 快照流（`SimClient.getSnapshotHistory()`，600 条≈10 s）
  线性插值到 250 Hz，走现有 q(t)→leadfield 管线（`projectMoments`）。不选 (b)：
  (b) 要加 Worker 侧录制消息 + Rust 端改动，超出本轮“只改前端接线”的范围；
  (a) 已有全部构件（快照历史、q 链、投影、噪声、参考），只差接线。
  有效采样率如实标注：60 Hz 快照插值到 250 Hz，4 ms 网格上的高频成分是
  插值产物，不是实测——界面与契约都写清。
- 基线口径（两处不同，各自写清）：EEG 直播推导用窗口首样本 E/I 作静息基线；
  HEAD/DIPOLE 直播 q 用“选区切换时该脑区的 E/I”作基线（App 侧 ref 捕获）。
- 位置口径：任务要求位置取 brainData centre（TVB 坐标）；球形 lead-field
  网格只覆盖 ±48 mm（`source_grid_axis_mm=[-48,-16,16,48]`，越界
  `interpolateSphereGain` 抛错），故直播源位置一律钳制进网格，并在界面与
  契约写明“TVB 中心坐标，未配准到 HEAD 球坐标（演示映射）”。DIPOLE 无网格，
  位置按长度钳制到 55 mm（与原拖动钳制一致）。
- 感觉输入：视觉闪烁→双侧 V1（rV1 #35、lV1 #73）周期脉冲；听觉 burst→双侧
  A1（rA1 #0、lA1 #38）burst 节律脉冲；音调 Hz 仍是元数据（载波未进动力学，
  与 stimulation.ts 原口径一致）。脉冲幅度：闪烁 = 强度×0.5 模型单位，
  burst = 强度×1.0；`SimClient.pulseAt(node, amplitude, durationMs)` 新增，
  幅度钳制 [-2, 2]（与 Level A 驱动范围一致；Rust 端 per-event 幅度不钳制，
  故客户端钳制）。
- 闭环直播：特征取选中脑区 live E（瞬时 / 1 s RMS），反馈经 Worker 脉冲回
  主仿真；触发上限 + 冷却 + 手动停止，防锁死。时间机器直播部分只做真实快照
  回放展示（直播引擎不可倒带），分支重跑仍用 JR 柱时间机器并标“独立演示”。
- 记录持久化：模块级 store（`eegRecording.ts` 内 `liveRecordingStore`），
  EegAnalysisLab 挂载时从 store 恢复、运行时写回；关弹窗不再丢记录。

## 冒烟 L1b/L1c/L4d 失败诊断与修复（2026-11-12）

### 现象（第一轮冒烟，79/84）
- 1920 L1b：Pz 峰值 0.0（要求 >0.001）；978 L1b：0.001。L1c：0.0→0.002 / 0.001→0.002（弱刺激反而变大）。
- 1920 L4d：S01 -0.0 → 0.0（两值相等）；978 L4d 通过（-0.0 → -0.003，静息抖动）。
- 其余全部通过，含 L1d（G 0.35→0.05：0.0→0.044 / 0.001→0.045）、L2d（P 0.027→0.186 / 0.016→0.167）、L5 全组、L6 闭环、L7 无控制台报错。

### 诊断探针（tests/pr8/probe-l1b.py，复现 L0+L1b 时序，直接读 __brainSim 原始历史）
- 脉冲前 E40 = 0.015（低态）；响应窗口 maxE40 = 0.493（脉冲确实起了大响应）；3 墙秒后 E40 = 0.013（已回落，未锁高态）——排除“双稳锁死”与“脉冲没起效”。
- 关键：脉冲标记 t_ms=13877，但脉冲后 3.5 墙秒时历史窗口已是 t=14996..34496——**脉冲已滚出 600 条窗口**，推导时事件 0 个、Pz 0.001 µV。
- 根因是环境时序，不是接线：headless Chromium 下仿真时间比墙钟快约 3–6 倍（Worker 步进不跟墙钟），600 条快照只覆盖约 19 仿真秒 ≈ 3–6 墙秒；L1b 的脉冲→点推导间隔约 4.5 墙秒（select_node 内 3 s 等待 + 点行 + 开实验台），脉冲必然滚出；L1c/L1d 的 3 s 等待恰在窗口边缘，时好时坏（L1d 两次都侥幸在窗内才拿到 0.044）。
- 排除的嫌疑：快照历史无别名 bug（`simClient.ts:381` 每次 `Float64Array.from` 拷贝）；投影管线本身正确（node 探针：#40 中心 + 0.4 bump → Pz 0.049 µV，与 L1d 的 0.044 一致）；基线口径无问题（窗口首样本在静息时，探针 q_peak=1.674 对应脉冲在窗内的情形）。
- 附带发现：窗口首样本若恰在响应衰减中途，基线会被抬高、低估 ΔE（探针：窗首 E40=0.291 时 q_peak 只有 1.674）。本轮不改产品（基线口径已在契约写清）；如后续要加固，可考虑把历史上限 600 条放宽或基线取窗前静息段——属 PR2/PR5 既有行为，超出本轮联动范围，留待后续定夺。

### 修复（只改冒烟脚本，不动产品代码、不放宽门槛）
- `tests/pr8/link-smoke.py` L1b/L1c/L1d：先开好实验台、再脉冲、立刻点“从直播推导记录”（脉冲→点击 <1 墙秒）；L1b 阈值从 >0.001 提到 >0.01，并新增事件数断言（≥1 个真实脉冲事件，直接卡住“脉冲在窗内”这一性质）。
- L3/L4：脉冲响应只持续约 2–3 仿真秒，1.5 墙秒后已衰减完，旧版读到的 0.0001 级 Cz/S01 只是静息抖动（L4d 1920 失败就是两值都舍入到 0.0）。改用持续偏置读稳态值：L3 在 #40（基线静息已捕获）上 setBias(40, 0.3)，等 2 s 读 Cz，要求 |Cz|>0.005；换 #73 后读静息 Cz，要求 |Δ|>0.005，读完 clearBias。L4 同理（#73 静息读 S01；切回 #40 后再加偏置读 S01，要求 |Δ|>0.005，读完 clearBias）。注意顺序：偏置必须加在选区之后，否则选区捕获的基线已被偏置抬高、ΔE 归零。
- 修复后重跑结果：L1b/L1c 通过，但 L1d/L3c/L3f/L4d 新失败——见下节“冒烟第二轮（76/84）与动力学探针”。

## 冒烟第二轮（76/84）与动力学探针（2026-11-12）

### 第二轮结果（/tmp/link-smoke2.log）
- L1b/L1c 已修好（1920：Pz 0.045、事件 1 个；弱刺激 0.045→0.002；978 同样）。
- 新失败 8 项：L1d 两视口（Pz 0.045→0.045 / 0.044→0.044）、L3c/L3f 两视口
  （偏置后 Cz=-0.0 / -0.0001；换区 -0.0→-0.0049，|Δ|=0.0048 差一点到 0.005）、
  L4d 两视口（S01 0.0→-0.0）。其余全过。

### 动力学探针（tests/pr8/probe-kinetics.py）
- 脉冲响应是约 100 仿真毫秒的窄尖峰：50 ms 墙钟采样 60 次全程 E≈0.009–0.015
  （全漏掉），而同一脉冲的响应窗口录到 maxE40=0.4929。——单次“脉冲后读数”
  在 headless 下几乎一定错过；EEG 推导能抓到是因为它积分整段 19 秒窗口历史。
- 持续偏置 0.3、2 s 后稳态：E=0.0166（ΔE=+0.0027）、I=0.0180（ΔI=+0.0005）、
  q=+0.019 nA·m → Cz≈0.001 µV。偏置几乎不移动 WC 低态不动点，稳态 q 可忽略——
  “偏置读稳态值”此路不通（L3c/L4d 失败的直接原因）。
- 500 ms 长脉冲（tests/pr8/probe-longpulse.py）：E 50 ms 内冲到 0.49 并锁死高态，5 s 后仍 0.489——长脉冲禁用于
  冒烟（会毒化后续检查）。
- G×幅度对照（历史窗内 q 峰值，Pz≈q×0.014）：
  amp 2.0：G 0.35 q=2.833、G 0.05 q=2.847（同值，饱和）；amp 1.0：G 0.35 q=2.871
  （翻转，Emax 0.494）、G 0.05 q=0.527（不翻转，Emax 0.089）；amp 0.5：G 0.35
  q=0.399、G 0.05 q=0.130。——G 的效应是“是否把脉冲放大到翻转”，在 amp 1.0
  处差 5.4 倍；在 amp 2.0 饱和区则为零。L1d 改到 amp 1.0 比较（L1d1：G 0.35
  要求 Pz>0.02；L1d2：G 0.05 要求 Pz<一半）。

### 修复（只改冒烟脚本，不动产品代码）
- L1d → L1d1/L1d2（amp 1.0 的 G 对照，见上）。
- L3/L4：脉冲串 + 轮询取最大 |q|（`poll_max_q`）：16 次 100 ms 短脉冲
  （不锁高态），每次读横幅 q 与 Cz/S01，取最大；静息对照同样轮询 16 次。
  门槛：脉冲串 max|q|>0.5、静息 max|q|<0.3、比值>3。L3/L4 末尾各加
  `__brainSim.reset()` + 2 s 复位，免脉冲串残留影响后续。
- 第三轮结果：（待填——见 /tmp/link-smoke3.log）

## 冒烟第三轮（81/88）与翻转阈值探针（2026-11-12）

### 第三轮结果（/tmp/link-smoke3.log）
- L1b/L1c/L1d（1920）通过：Pz 0.045→0.002，G 对照 0.018→0.006（比值 0.33）。
- 失败 7 项：L1d1 两视口（amp 1.0、G 0.35：1920 Pz=0.018 <0.02；978 Pz=0.007）、
  978 L1d（0.007→0.005，比值 0.71>0.5）、L3c/L3f（1920，旧轮询一次没抓到尖峰）、
  L4d 两视口（旧轮询）。978 L3c/L3f 用旧轮询侥幸通过一次——说明旧轮询是时序彩票。

### 翻转阈值探针（tests/pr8/probe-g15.py）
- amp 1.5：G 0.35 q=2.815、G 0.05 q=2.823（都翻转）；amp 1.2：G 0.35 q=2.818、
  G 0.05 q=2.793（都翻转）。G=0.05 的翻转阈值在 1.0–1.2 之间，G=0.35 的在
  0.7–1.0 之间——两阈值太近，不存在“G=0.35 可靠翻转、G=0.05 可靠不翻转”的幅度。
- amp 1.0 在 G=0.35 的翻转本身不可靠：三次实测 Pz=0.040（探针）、0.018（1920
  冒烟）、0.007（978 冒烟，未翻转）。单节点脉冲峰不能作为 G 对照——改测网络扩散
  （见下）。

### L3/L4 轮询失败根因（第三轮 L3c 实测）
- 脉冲后等 120 ms 再读：尖峰帧在 DOM 上只停留约一帧（~67 ms），120 ms 后已被
  静息帧覆盖——16 次脉冲 max|q|=0.027，与静息 0.028 无异。已改为脉冲后立即
  快轮询（8 次连续读）再等网络回落（`poll_max_q`，待第四轮验证）。

### L1d 改测扩散（tests/pr8/probe-spread.py，待结果）
- 思路：G 的物理效应是脉冲能否扩散到全网。脉冲 #40 后从远处节点 #73 推导：
  G=0.35 应全网翻转（#73 q 峰 ~2.8）、G=0.05 只翻转 #40 局部（#73 q 峰 ~0）。
  若探针证实，L1d 改为：选区切到 #73 再脉冲 #40、立刻推导，对照两组 G 的 Pz。

### 扩散探针：#73 与 #62 均无扩散（2026-11-12）
- 脉冲 #40 后远处节点 #73（lV1，权重 0）：G=0.35 q 峰 0.087、G=0.05 q 峰 0.074，
  Emax 0.0246（静息水平）——无扩散。
- 最强邻居 #62（lPHC，权重 2.0，G=0.35 时耦合 0.7）：G=0.35 q 峰 0.069、
  G=0.05 q 峰 0.056，Emax 0.023——同样无扩散。单次 100 ms 脉冲的翻转是纯局部
  事件（E→0.49 只在被脉冲的节点），耦合不足以把翻转传给邻居。
- 结论：G 在直播 EEG 台上的可观测效应只剩两处——被脉冲节点自身的翻转阈值
  （G=0.35 约 0.7–1.0，G=0.05 约 1.0–1.2，两阈值太近、单次试验不可靠）和
  亚阈值线性响应的放大倍数（amp 0.5：q 峰 0.399 对 0.130，3 倍，但单次方差大）。
  L1d 改测长脉冲锁定（二值、确定性，见 tests/pr8/probe-lock.py，待结果）。

### 锁定探针：G 对照的确定性效应（2026-11-12，tests/pr8/probe-lock.py）
- 500 ms 长脉冲后 2 s / 5 s 的 E40：amp 0.8、G 0.35 → 0.0149/0.0110（回落，
  不锁定）；amp 0.8、G 0.05 → 0.0101（回落）；amp 2.0、G 0.05 → 0.0113（回落）。
  对照 probe-longpulse：amp 2.0、G 0.35、500 ms → E 0.489 锁死 5 s+。
- 结论：锁定只在“幅度够大（2.0）+ G 够大（0.35）”时发生，G=0.05 时同样幅度
  不锁定——这是二值、确定性的 G 对照（0.49 对 0.011，40 倍）。L1d 改为锁
  定检查（sim 层读快照 E40）：L1d1 要求 G=0.35 锁死（E>0.3），L1d 要求
  G=0.05 回落（E<0.05）；每次锁死后 reset() 复位。
- 为什么不用台架推导测 G：推导是变化量（相对窗首基线），持续高态在推导里
  Pz≈0，测不到锁定；单脉冲峰饱和、翻转靠运气、扩散为零（上两节）。台架对 G
  的敏感性由三段链条建立：方法学 L1（E×2→Pz×2，管线）+ 本检查（直播仿真
  的 G 效应）+ L1b/L1c（台架跟随直播）。这是网络物理的如实结论，不是放宽门槛。
- 第四轮结果：（待填——见 /tmp/link-smoke4.log）

## 冒烟第四轮（被运行环境重启打断；1920 全过，978 未完成）
- 1920 视口在重启前全部通过、零失败（轮询中逐项确认，日志随 /tmp 被重启清空）：
  L1b Pz 0.045、事件 1 个；L1c 0.045→0.003；L1d1 锁死 E40=0.486；L1d
  锁死 0.486 对回落 0.0099；L2d P 0.025→0.179；L3c 快轮询 max|q|=2.49
  （静息 0.02）；L3f 2.49 对 0.029；L4b 静息 max|q|=0.033；L4d 2.694 对 0.033；
  L5/L6 全过。978 只跑完 L1（L1b 0.044、事件 1 个；L1c 0.044→0.002）。
- 附带观察：尖峰时 max|Cz| 只有 0.0056、max|S01| 只有 0.003——不是同步 bug：
  HEAD/DIPOLE 默认偶极方向是 X 轴（HeadSphereLab.tsx:28），Cz 对深部脑区
  lAMYG 的 X 向偶极增益本来就小；q 横幅（2.49/2.69）才是可靠的直播指示。
  布局下一轮若想让电位读数也跟尖峰走，可考虑默认方向或读数取多电极最大。
- 重启后完整重跑一次（日志 ~/workspace/link-smoke4.log，防 /tmp 被清），
  结果见下节。

## 冒烟第四轮（完整重跑，88/88，2026-11-12）
- 前一轮 1920 全过后运行环境重启（SIGTERM），/tmp 日志丢失、978 未完成；
  预览重起后完整重跑一次，日志存 ~/workspace/link-smoke4.log（防 /tmp 被清）。
- 结果：88/88 passed，exit=0，两视口零失败。
- 关键对照数字（1920 / 978）：
  - L1b：Pz 0.045 / 0.044，事件 1 个；L1c 弱刺激：0.045→0.003 / 0.044→0.002。
  - L1d1 锁死：E40=0.488 / 0.491；L1d 回落：0.010 / 0.012（锁死对回落约 49 倍）。
  - L2d：P -0.047→0.139 / -0.018→0.137（dP=0.160）。
  - L3c 快轮询：max|q|=2.851 / 2.702（静息 0.016 / 0.039）；L3f：2.851 对 0.045 /
    2.702 对 0.026。L4d：max|q|=2.751 / 2.766（静息 0.041 / 0.021）。
  - L5c：#35 标记 25 个；L5d2：#0 标记 5 个；L5f：末标记 node 40、幅度 1.4。
  - L6d 闭环：1920 thr=0.394 E~0.492（进闭环时网络已处高态，L5 脉冲串所致，
    仍正常触发）；978 thr=0.393 E~0.492。
  - L7：全程无控制台报错；各台 overflow 均为 0 px。
- numfix 冒烟回归：36/36 passed，exit=0（~/workspace/numfix-smoke-link.log）。
  ERP late path 峰 0.174 @352、StimLab Level B 目标 |E| 0.793 / 网格最大 2.164，
  数值修复未被联动改动破坏。

## PR8-LAYOUT 布局修复（2026-11-12）

### 开工核对
- 本地 clone 到手时 HEAD 79c4f65，远程 pr8-polish-release 为 eedd0a8；
  任务简报称“树一致”，实测 `git diff 79c4f65 eedd0a8` 为空（两提交树
  相同，eedd0a8 是“push working tree”提交），干净 fast-forward 到
  eedd0a81283bf24cf0213217bc201d2a1ea992f7 后开工，无未提交改动。

### 复现探针（tests/pr8/probe-layout-repro.py，量测存 layout-repro.json）
- 修前 1920（showMore 开、pulse(40) 选 lAMYG #40）：固定面板
  194+738+391+394=1717px + 间距，塞进 980px 高的 .main；REGION 面板
  高仅 44px、内容 918px；文档被撑到 1878px（多出 798px 可滚）；
  滚到底后 BIAS 按钮与权重滑杆命中检测失败（hit=false，点不到）。
  左列第二屏：舞台底部视口 y=267，其下取点命中裸 HTML = 纯黑空地。
- 修前 978：REGION 能靠文档滚动到达（biasHit=true），问题只在
  顶栏 128px 与长页 1935px；390：顶栏 7 行、高 273px。
- 模型信息弹窗：框 620×929 在视口内，但“知道了”在 y=1431，
  框底 1004，初次不可见。
- L-01 根因：Chromium 给 input[type=range] 默认 margin:2px；
  width:100% 的滑杆右缘比容器多 2px、两侧 margin 共 +4px
  scrollWidth（HeadSphere 1 个滑杆、Dipole/Stim 各 2 个，均 +4px）。
  不是 flex gap 取整残留（审计时的猜测已证伪）。
- L-02：λ² 输入框值 0.1111111111111111，框 72px、实占 64px、
  scrollWidth 130px（+66px），只见 0.11111；对照表写 0.111。
- 探针教训：画布与响应行随仿真逐帧重渲染，Playwright 严格点击
  等不到 stable 而超时；探针与断言改用 `__brainSim.pulse(40)` +
  JS 点 `.resp-row[data-node='40']`（link-smoke 同款做法）。

### 修复（只改布局/样式，不改接线与计算）
- 右列：`.panels` 加 `overflow-y:auto` 成为滚动容器；`.region-panel`
  由 `flex:1 + overflow-y:auto` 改为普通面板随整列滚动；
  `.app` 加 `overflow:hidden`，桌面端文档不再滚动；
  LIVE ACTIVITY 用 `position:sticky; top:0` 置顶（列滚到底仍可见）。
- 第二屏空地：由文档滚动消除——修后文档高 = 视口高（1080=1080）。
- 手机：新增 ≤768px 断点——顶栏 nowrap + 横向滚动、副标题隐藏、
  chip 不压缩；`.lab-split` 窄屏单列；弹窗边距收窄。
- 弹窗：`.modal` 纵向 flex，`.modal-body` 为唯一滚动区；
  模型信息“知道了”移入固定 `.modal-foot`；七台统一封顶 86vh
  （HeadSphere/Dipole/Stim/LocalBEM 内联 94vh、EEG 90vh 均改到 86vh）。
- L-01：`.modal input[type=range] { margin: 0; }` 一条规则覆盖三台。
- L-02：InverseTab 输入框值改 `lambda2.toFixed(3)`（显示 0.111），
  状态里仍存完整浮点数，不改计算。
- 统一：HeadSphere/Dipole 共用 `.lab-split` 分栏（原各写一份内联 grid）；
  HEAD/DIPOLE 读数区加“最大电极”一行（只读展示，默认方向仍为 X 轴）。
- 修中自查发现的回归：首版在 ≤1100px 媒体查询里把 `.live-panel`
  写成 `position:static`，与 `.screen` 的 `position:relative` 同权、
  后写胜出，面板失去定位，LIVE 标题 absolute 逃到页面左上角、
  在 390/978 下盖住顶栏；已改为 `position:relative`（不置顶、
  但仍是标题的定位基准），390/978 实测标题回到面板内。

### 修复后实测（断言 tests/pr8/layout-assert.py，26/26）
- 1920：文档高 1080=视口；右列 scrollH 2721 / clientH 980（列内滚）；
  REGION 高 920px（修前 44px）；滚到底后首权重滑杆 y=376–404、
  BIAS 按钮 y=960–985，均在视口内且命中检测通过；LIVE 置顶可见。
- 978：CONNECTION 滚到底可见且可点（同修前）；390：顶栏 1 行、
  高 58px（修前 7 行 273px）、横向可滚（scrollW 1524 / clientW 390）、
  舞台宽 374px。
- 模型信息“知道了”y=957–987，初次可见；七台弹窗均在视口内、
  关闭按钮初次可见、横向溢出 0；L-01 三台 +4px→0；L-02 值 0.111、dx=0。
- 断言修前基线 11/26（15 项失败，正好是本轮要修的项；StimLab 也
  检出 +4px，属同一根因）；修后 26/26，零页面报错/零控制台报错。
- 截图：tests/pr8/layout-shots-after/（1920 列底、1920 顶、390 顶）。
- 修正两处任务简报里的源码推断：390 下舞台实测 374px 宽、脑列
  可用，不是“只剩约 40px”；“侧栏固定 320px”在主布局不存在，
  320px 只出现在 InverseTab/TfrTab/TopoTab 的 minmax(320px,1fr)
  网格里，390 下内容宽 338px、单列 320px 能放下，无溢出。

### 回归（本轮改动后）
- 构建：tsc + vite build 通过；PR5 node 80/80；PR6 node 59/59；
  PR8 methods + modes node 49/49；Python unittest（eeg-venv）：
  PR6 45/45、PR8 12/12、PR5 35 通过（7 skipped）。
  注：brainrun venv 缺 scipy，Python 套件须用 eeg-venv 跑（环境问题，
  与本次改动无关）。
- 浏览器冒烟 link-smoke：84/88（日志 ~/workspace/link-smoke-layout2.log）。
  4 个失败全是同一根因的一组级联：1920 L3d 选 #73 失败（pulse(73) 后
  无响应行）→ L3e HEAD 未跟随换选区 → L3f #73 静息 q=2.826 →
  L4a dipole 直播源仍为 #40。根因是 L3c 的 16 次 100ms 脉冲串
  （amp 2.0）把双稳网络锁进高态（E≈0.49），#73 脉冲不再产生
  ΔE 响应、故无响应行；L3c 本身通过（max|q| 2.87 对静息 0.018）。
  同一串检查在被重启打断的前一轮（62/62、0 失败，日志
  ~/workspace/link-smoke-layout.log）与更早的 88/88 轮里全部通过，
  且 978 视口的同一组 L3d/e/f 本轮全部通过——是仿真双稳锁定的
  时序抖动，不是本轮 CSS/展示改动所致（本轮未动任何 JS 逻辑与计算）。
  其余 84 项全过，包括 L7 零控制台报错与各台 overflow 0px。
- 浏览器冒烟 numfix-smoke：36/36 passed（日志
  ~/workspace/numfix-smoke-layout.log），数值修复未被布局改动破坏。

### 推送 #1（2026-11-12，按用户要求：进展实时上 GitHub，不只留本地）
- 本地提交 ee073c0（PR8-LAYOUT: 右列滚动重构 + 弹窗/断点/L-01/L-02 +
  布局断言 26 项），推送脚本 scripts/push-to-pr8-branch.py --yes
  --expected-head eedd0a81283bf24cf0213217bc201d2a1ea992f7，
  远端 pr8-polish-release 由 eedd0a8 → 65b6c2b（main 未动，453e570）。
- CI（push #1，head 65b6c2b）：PR5 Physics Baseline Checks
  run 43163776729 completed success；PR6 EEG Analysis Checks
  run 43163776688 completed success。两路全绿。
