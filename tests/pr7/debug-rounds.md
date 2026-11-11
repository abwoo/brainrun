# PR7 · 多尺度与高级实验（计划 PR-13–15）调试记录

总协调：本批执行总协调（主代理的子代理）。工作区 ~/workspace/brainrun-pr7，分支
`pr7-multiscale`（base main d845c1a1，PR6 合并点）。分工：A=PR-13 细胞级
（~/workspace/brainrun-pr7-a）、B=PR-14 TES/TMS/感觉（~/workspace/brainrun-pr7-b）、
C=PR-15 双脑/时间机器/闭环（~/workspace/brainrun-pr7-c）。三方只产新文件，
不改共享文件，由总协调集成后经 API 推同一分支、开 Draft PR（预计 GitHub PR #8）。

## 规则（2026-11-11 用户定，PR5–PR8 全程）
- 每轮只保留该轮必需的方法学测试 + 构建通过 + 新功能冒烟；完整回归、浏览器交互
  全套、前端布局全面扫查、性能、五维验收、十个演示一律推迟到 PR8 合并之后。
  合并门槛 = 方法学测试通过 + 构建通过 + 冒烟通过。
- 测试止损：同一测试因非产品问题（系统/环境原因）失败超过 3 次，自动停掉、记录
  后继续，绝不陷入循环。产品真问题必须修；不许改期望、删场景、放宽门槛
  （容差低于数值方法自身精度时例外，须有误差底实测依据并写清）。
- 前后端对齐：新增前端入口必须对应真实后端实现；契约增补写进
  docs/frontend-backend-contract.md 并扩展契约测试。
- 前端：不许组件遮挡、GUI 框太小显示不全；新增面板 1920×1080 与 978px 各看一眼。
- PR 保持 Draft，不标 Ready，不合并；不做 live 站验证（统一验证在 PR8 之后）。

## 承接 PR6 的残留缺口（本批范围）
- 幅度：oddball 峰 0.174 µV vs 真实 8.89 µV（51 倍），JR sigmoid 饱和天花板约 0.21 µV。
- 基线 RMS 仍是 0；alpha 占比 99.8% vs 真实 Pz 30.3%；试次独立重启、无跨试次适应。
- MNE 深度偏置未修（深部源误差 32–96 mm）：本批顺手可做深度加权/dSPM/eLORETA，
  做不了就明确留给 PR8。

## 搭建记录
- 2026-11-12：main 克隆到 ~/workspace/brainrun-pr7（HEAD d845c1a1 已核对），新建分支
  pr7-multiscale；tests/pr6/debug-rounds.md 补上本地那行 CI 变绿记录（run
  43082978168 + run 43082978017，2026-11-12 约 02:35）；scripts/push-to-pr7-branch.py
  由 PR6 版改写（分支名与默认文案已改，仍是 API 方式，绝不直接 git push）。
- 注意：分支 pr7-multiscale 在 GitHub 上尚不存在，首次推送须先建分支 ref
  （POST /git/refs，指向 main d845c1a1），再用 push-to-pr7-branch.py
  （--expected-head d845c1a1）推首个提交；不要用 push-to-main.py 误推 main。

## 集成记录（总协调，2026-11-12）

- 三路汇报均已收到并独立复核：A（TS 15/15、Python 14/14 含 NEURON）、B（TS 13/13、
  Python 12/12）、C（TS 27/27、Python 21/21），复核均在我自己的重跑下全绿，
  文件行数/大小与汇报一致；三方均未改现有文件（App.tsx 引用数 0、dist 已删）。
- 集成改动（总协调）：三路新文件全部拷入主树；App.tsx 接线（三个 topbar chip +
  三个 modal 挂载；CellularLab/ExperimentLab 用 `eeg-lab-modal` 宽版包起来，
  ExperimentLab 的球形 fixture 在打开时加载，null 时源定位对照不可用）；
  契约追加 §1.9（细胞）/§1.10（刺激）/§1.11（实验+深度），三方原报的 §1.9
  编号冲突已重排；漂移测试 tests/pr5/contract.test.mjs 追加 PR7 三组断言。
- 集成时修掉的两个真问题（都是测试/接线层，产品模型未动）：
  1. 契约测试两处测试 bug：`DIPOLE_N_CELLS = 1_000_000` 的下划线千分位被
     正则截成 1；Python 里 `CONTROL_DT_MS` 是表达式不是字面量。已修，断言本身未动。
  2. 构建抓到 CellularLab.tsx 未用 import `DEFAULT_WC_TO_CELLULAR_PARAMS`
     （TS6133），已删。A 在自己的拷贝里跑的是 `npx tsc --noEmit`——该命令在本
     仓库根配置下是空跑（`files: []`），`npm run build` 里的 `tsc -b` 才是真检查；
     B、C 汇报里已写明此点，A 未写明但同样受影响。
- 方法学测试（主树，集成后）：TS 76/76（细胞 15 + 刺激 13 + 实验 21 + 深度 6 +
  契约 21）；Python 47/47（eeg-venv，1 项 NEURON 跳过，预期内）+ 细胞 14/14
  （neuron-venv，含 NEURON）。另：`tests/pr7/*.test.mjs` 初跑时因缺生成物
  `app/public/forward-assets/sphere-model.json`（gitignored，CI 同款脚本生成）
  报错退出，按测试提示用 `generate_sphere_model.py` 生成后通过（860,283 字节，
  不入库）。
- 构建：`scripts/build-wasm.sh` + `npm run build` 通过（729 ms；chunk > 500 kB
  警告是既有现象，非 PR7 引入，代码分割留给 PR8）。
- 浏览器冒烟（tests/pr7/pr7-smoke.py，本地 preview）：22/24。S2–S5 全过：
  三个实验台在 1920×1080 与 978px 下打开、运行、渲染、无横向溢出
  （modal scrollWidth = clientWidth）、topbar 10 个 chip 全部可见。
  唯二失败是 S1（TIME 不前进）：**环境问题，非产品回归**——对照实验：
  同一探针跑 PR6 树（main d845c1a1，不含任何 PR7 改动）同样 TIME 0.0、
  PLAY 一直“加载中”；网络请求 0 失败、Worker 可构造、wasm 可 fetch、无
  console 报错，属本机 headless Chromium 下 Worker/WASM 启动静默挂起
  （与 PR4 时代的环境抖动同类）。按测试止损规则不再追，记在此处；
  新功能冒烟已通过，S1 留待 PR8 后的统一验证（云端浏览器）复核。
- PR6 缺口本批进展（数字）：幅度仍未闭合——细胞路线持续 PSP 只有 −0.059 µV
  （差 151 倍）、同步齐射峰值 2.50 µV 仅 1 ms 瞬态，缺口不在模型类别；
  跨试次适应已实现（有效驱动 300 → 177 → 127 → 106 → 98 1/s）；
  深度偏置部分推进——无噪声深源 55.43 → dSPM 0.00 mm，但浅源 dSPM 变坏到
  55.43 mm、有噪声深源 depth 96.00 mm 更差，没有一种方法同时修好深浅两端，
  残留仍在（见契约 §1.11 诚实边界）；基线 RMS 仍 0、alpha 占比 99.8% 未动，留给 PR8。

## 推送与 PR（总协调，2026-11-12）
- 推送：分支 pr7-multiscale 在 GitHub 上新建（POST /git/refs，指向 main
  d845c1a1），首个提交 fb50bca 由 scripts/push-to-pr7-branch.py --yes 推上
  （API 方式，约 10.6 分钟逐文件建 blob；main 未动；脚本尾部打印的
  pull/7 链接是模板残留，实际 PR 号是 #8）。
- PR #8 已开：https://github.com/abwoo/brainrun/pull/8 ，Draft，标题
  “PR7: 多尺度与高级实验（细胞级模型 / TES·TMS·感觉输入 / 双脑·时间机器·闭环）”，
  head pr7-multiscale fb50bca，base main d845c1a1，42 个文件 +14529/−2，
  mergeable True；正文见 ~/workspace/pr7-body.md（诚实写清已验证/未验证/残留项）。
- CI：physics-and-types 与 eeg-analysis 两路检查进行中（开 PR 时状态）。
  首轮结果（fb50bca）：**eeg-analysis 失败**——第 8 步 PR6 Python 方法学测试
  exit code 1；physics-and-types 27 个测试步骤全 success，第 28 步
  “Upload PR5 browser screenshot”失败、job 长时间停在 in_progress
  （疑似 GitHub Actions 基础设施抖动，与日志下载 502 同期）。
- CI 失败诊断（总协调，2026-11-12）：本地同一命令 45/45 全绿；球形增益做
  CI 量级的非均匀扰动（每元素独立 ×(1+N(0,3.2e-6))）后复现——
  test_blind_table_freshness 峰值断言 1.29e-05 > 1e-5。根因是 PR6 修补时
  用的均匀扰动模拟低估了约 6 倍：CI 现场重算的增益漂移是非均匀的，
  经 MNE 白化/逆解放大后峰值相对误差可达 1.92e-5（8 种子实测
  5.3e-06…1.92e-05，6/8 种子超 1e-5）。修法（只改测试容差与注释，
  未动产品代码/fixture/科学门槛）：峰值相对容差 1e-5 → 1e-4（Python
  test_tfr_topo_inverse.py 与 TS tfr-topo-inverse.test.mjs 同步改），
  spread 保持 1e-5（实测最大 4.4e-6）。验证：干净基线 Python 45/45、
  TS pr6 59/59；8 种子非均匀扰动下 Python 盲测 8/8、TS 盲测（最差两种子）
  16/16 通过；sphere-model.json 每次模拟后均恢复逐位相同。详见
  tests/pr6/debug-rounds.md 末节。修补随第二个提交推到同一分支，CI 结果待补。
- eeg-analysis 重跑尝试：rerun-failed-jobs 被接受后 run 43094678195 以
  startup_failure 告终（未起步，非产品问题）；以第二个提交重新触发为准。

