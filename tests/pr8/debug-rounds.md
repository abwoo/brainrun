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
