# PR8-B 第一阶段 debug 记录（布局审计 + 视觉打磨 + 无教程走查）

> 分工 B 第一阶段：只写文档和审计记录，不改任何产品代码。
> 基线 main 453e5707，分支 `pr8-polish-release`，工作区 `~/workspace/brainrun-pr8-b`。
> 预览端口 4174（与 A 路 4173 区分）。

## 审计方法

- 工具：Playwright（Python，`~/workspace/brainrun/.venv/bin/python`），
  Chromium headless + SwiftShader WebGL。
- 脚本：`tests/pr8/audit-layout.py`（完整版：量测 + 截图 + 走查），
  `tests/pr8/audit-slim.py`（补跑：978 视口量测 + 走查，截图停掉），
  `tests/pr8/probe-followups.py`（收尾探针：978 TIME、HEAD EEG 重开、
  源定位 number input 定位）。
- 每视图的程序化量测：`documentElement.scrollWidth − innerWidth`（横向溢出）、
  元素 `scrollWidth > clientWidth`（内容被裁）、ellipsis 且内容溢出（文字截断）、
  顶栏 chip 两两重叠、对话框 `boundingBox` 是否出视口；外加截图目视复核。
- 走查：新开页面、不看教程，依次做选脑区、给刺激、看 EEG、换模式四项核心操作，
  记录悬停提示、选中反馈、响应面板文案、EEG 波形可见性与模式按钮存在性。

## 覆盖

- 视口：1920×1080 与 978×800。
- 视图：主界面 + 7 个实验台（DipoleLab、HeadSphereLab、LocalBEMLab、
  EegAnalysisLab 及其 EEG/频谱/ERP/时频/地形/源定位六个 tab、
  CellularLab、StimLab、ExperimentLab）= 每视口 13 个量测点，
  共 26 个量测点，全部跑完。
- 截图：26 张（`tests/pr8/layout-shots/`，每视图每视口各一）。
  走查截图 3 张因环境截图超时缺失（见下），量测与结论不受影响。
- 页面报错：三轮共 0 个 page error / console error。

## 发现的问题数

- 确认的显示瑕疵：2 个，均为低严重度——
  L-01 HeadSphere/Dipole 控制区 +4px 溢出（两视口）；
  L-02 源定位 λ² 输入框值显示不全（两视口，值 `0.1111111111111111`
  未格式化、框内只见 `0.11111`）。
- 观察项（非缺陷，第二阶段打磨候选）：4 个——
  L-03 978 顶栏 chip 竖排单字；L-04 978 长页、TIME 与 PARAMETERS 距首屏太远；
  L-05 EEG 各 tab 空记录时为空态、无引导；L-06 LocalBEM 无文件时为空态小对话框。
- 遮挡 / 横向溢出 / 文字截断 / 对话框出视口：0 个。

## 走查结论

- 选脑区 ✓、给刺激 ✓、看 EEG ✓——三项均能无教程完成。
  悬停提示 `lCC — 点击刺激 · 按住持续输入` 可见；点击选中 lCC #75，
  响应面板出现基线文案与响应列表（峰值 ΔE +0.482）；
  顶栏 `EEG 分析` 入口直接找到，运行实验后波形渲染。
- 换模式 ✗——2.0 的 PLAY / WAVES / EEG / EXPLORE 模式切换不存在；
  顶栏 PLAY 只是播放/暂停。这是离 80% 目标最远的一处，
  等 A 路合入后按 `docs/no-tutorial-user-test-protocol.md` 重测。
- 最弱的一环是首次刺激的发现性：只靠悬停提示与底栏小字，
  不悬停、不读底栏就不知道大脑能点；刺激与响应的因果也要靠视线
  在舞台与右侧面板之间跳跃才能建立。
- 走查时间数字被截图超时污染（选脑区 29.8 秒含两次 10 秒截图超时），
  实际交互约 2–3 秒，不可作首次操作时间引用。

## 过程记录（轮次）

### 第一轮（audit-layout.py 首次运行）

- 结果：26 个量测点全跑完，0 page error；走查误点了 LIVE ACTIVITY 的
  小 canvas（页面第一块 canvas），不是 3D 大脑。
- 根因：工作区拷贝缺失三份构建时生成的 gitignored 资产——
  `app/public/brain-assets/`（TVB 脑数据）、球形 fixture、WASM 产物——
  主界面 3D 舞台因此是“脑数据加载失败”空态，3D canvas 不存在，
  走查与主界面量测均在空态下做（实验台对话框不受影响）。
- 处理：按仓库自有流程补齐——`scripts/build-wasm.sh`、
  `scientific/forward/generate_sphere_model.py`（eeg-venv）、
  `scripts/prepare-brain-data/fetch.py && prepare.py`
  （钉死提交 f1a3e7d，SHA-256 校验通过）；`npm ci && npm run build`；
  预览 4174 恢复 200。第一轮的主界面量测与走查结论作废，实验台量测保留。

### 第二轮（补齐资产后重跑，audit-layout.py）

- 结果：1920 主界面大脑正常渲染；TIME 探针修正后实测前进
  （`TIME 12.9 S → 18.1 S`）；EEG 运行成功；但在刺激实验截图处
  崩溃（截图超时未捕获，整轮中断），978 视口与走查未跑。
- 另：本轮里 EEG 运行与 LocalBEM 路径各超时 1 次（后证实为环境抖动）；
  EEG 各 tab 在无记录时为空态（对话框仅 186–268px 高），
  由此确认 L-05。

### 第三轮（加固后重跑，audit-layout.py）

- 加固：截图超时重试一次、失败只记录不抛；等 `PLAY — 运行中` 真就绪
  再截图；TIME 探针后暂停仿真以降负载；各视口/走查加 try 保护。
- 结果：1920 量测与第一、二轮完全一致；背景参数就绪后显示
  `τ = 100 ms，σ = 0.10`（第一轮的 `—` 是就绪前探针时机问题，不是缺陷）。
- 中止原因：截图在 SwiftShader 下反复超时（GPU 进程 CPU 占用 ~131%，
  截图要等字体与合成器），同一环境问题超 3 次，按止损规则停掉截图测试、
  杀掉本轮，改跑瘦身版。已确认 1920 量测三轮一致，无需再跑。

### 瘦身补跑（audit-slim.py：978 量测 + 走查，截图停掉）

- 结果：978 全部 13 个量测点跑完，与第一轮完全一致；走查用真 3D 画布
  （`section.stage canvas`，1293×978）完成，结论见上；0 page error。
- 瘦身跑里 978 下 TIME 探针与 LocalBEM 路径点击各超时 1 次，
  随后用 `probe-followups.py` 直接读 DOM 复核均正常
  （TIME 8.8 S → 12.7 S 前进；HEAD EEG 关后再点成功；
  LocalBEM 对话框 938×141），定性为环境抖动、非产品问题。

### 收尾探针（probe-followups.py）

- 确认 λ² 输入框是唯一 +66px 的元素：值 `0.1111111111111111`、
  框宽 72px（实占 64px）、`scrollWidth 130px`；同 tab 其余 4 个
  数字输入框无溢出。L-02 由此定稿。
- 978 主界面截图用“先暂停仿真再截图”成功补拍（`978x800_main.png`），
  顶栏竖排单字（L-03）与舞台下方提示文案均可见。

## 环境问题汇总（只记录，不追）

- S1（TIME 不前进）未复现：TIME 在 1920 与 978 均正常前进。
- 截图超时：SwiftShader GPU 进程饱和所致；先暂停仿真可明显提高成功率，
  第二阶段如需补截图请沿用此法。走查的 3 张截图因此缺失，
  已删第一轮误拍的 3 张走查截图（拍的是 activity 图，不是走查），避免误导。
- 瘦身跑的两处单次超时（978 TIME 探针、LocalBEM 路径点击）经直接复核
  均正常，定性为环境抖动。

## 交付文件

- `tests/pr8/layout-audit.md`：布局基线审计报告（问题清单 L-01–L-06、走查、缺口清单）。
- `tests/pr8/layout-audit-raw.json`：合并后的原始量测数据
  （1920 取第一轮、978 与走查取瘦身跑；另存 `tests/pr8/layout-audit-raw-978.json`）。
- `tests/pr8/layout-shots/`：26 张截图。
- `tests/pr8/audit-layout.py` / `tests/pr8/audit-slim.py` / `tests/pr8/probe-followups.py`：审计脚本。
- `docs/no-tutorial-user-test-protocol.md`：无教程用户测试操作规程
  （7 个验收任务、成功标准、记录项、80% 目标）。

## 未改产品代码

- `app/src`、`app/src/components`、`crates`、`app/src/lib` 均未动；
  `git status` 应只显示 `tests/pr8/` 与 `docs/` 下的新文件，
  其余为构建时生成的 gitignored 资产（`app/dist/`、`app/public/wasm/`、
  `app/public/brain-assets/`、`app/public/forward-assets/`、
  `scripts/prepare-brain-data/raw/`、`app/node_modules/`）。

## 第二阶段待办（等总协调通知 A 路合入后）

1. 在集成树上重跑全部布局审计（`tests/pr8/audit-layout.py`），
   修 L-01、L-02，处理 L-03–L-06。
2. 统一七个实验台的 CHIMERA 风格（一致的面板头、颜色、字号），
   只做最小必要的统一，不大改视觉。
3. 再跑一遍无教程走查，确认模式切换入口出现后四项核心操作全通，
   卡点已修；随后按 `docs/no-tutorial-user-test-protocol.md` 做真人测试。
