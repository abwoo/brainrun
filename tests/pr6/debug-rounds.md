# PR6 debug rounds

> 每轮只保留该轮必需的方法学测试 + 构建通过 + 新功能冒烟（2026-11-11 22:57
> 测试节奏新规）。同一测试因非产品问题（系统/环境原因）失败超过 3 次即
> 停掉它、在此记录原因后继续，绝不陷入循环。产品真问题必须修，不许改期望、
> 删场景、放宽门槛来让测试通过。

## 方法学测试命令

```bash
# TS 单元测试（Node 24）
node --experimental-strip-types --test tests/pr6/*.test.mjs
# Python 对照（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）
python -m unittest discover -s tests/pr6 -p 'test_*.py' -v
# Rust 引擎
cargo test --manifest-path crates/brain-core/Cargo.toml
# 前端
cd app && npx tsc -b && npm run build && npm run lint
# 浏览器冒烟（需先起预览服务器 + 生成球形 fixture，见各轮记录）
node app/tests/pr6-browser-smoke.mjs
```

## 轮次记录

### 第 1 轮 · A2 契约残留 + CI + 脚手架（2026-11-12）

工作副本 `~/workspace/brainrun-pr6-a2`（分支 `pr6-eeg-analysis`，base main `f0d5087`）。
只动 A2 归属文件；不推分支、不碰 GitHub。

- R1（方案 (a) 收紧）：全仓 grep 确认无任何 `set_stim_amplitude`
  用例超过 2.0（UI 最大 2.0、测试最大 2.0）；唯一超 2.0 的幅度是
  `reference/python-model/experiments.py` 幅度 sweep 的 4.0，走
  StimulusEvent 直接事件幅度（`add_stimulus` 不钳制），不经过本
  setter，不受影响。`crates/brain-wasm/src/lib.rs`
  `set_stim_amplitude` clamp 由 0–4.0 收紧到 0.5–2.0，与 UI 相等；
  契约 §1.2 + §6 D1 + §7 R1 已同步；漂移测试断言由子集改为相等。
  待总协调补一处（不在 A2 归属内）：`app/src/worker/protocol.ts`
  的 `stim_amplitude` 注释仍写“引擎侧 clamp 是 0–4.0”，须改为
  0.5–2.0（exact 文案见 A2 汇报）；改完后漂移测试应追加断言
  protocol.ts 不再含 '0–4.0'。
- R2（快照 JSON 加版本）：`StateSnapshot` 加 `version: u32`
 （`STATE_SNAPSHOT_VERSION = 1`；`#[serde(default =
  "default_snapshot_version")]`，缺字段的旧 JSON 视为 1 恢复）；
  `take_snapshot` 写 1；`simClient.parseSnapshotSummary` 同步读
  `snap.version ?? 1` 进 `SnapshotSummary.version`；契约 §4.2/§4.3/§7
  已同步；新增 Rust 单元测试
  `pr6_snapshot_version_written_and_old_json_restores_as_v1`。
- R6（MNI152/Talairach 类型消除）：`'mni152-mm' | 'talairach-mm'`
  已从 `CoordinateSpace` 联合类型中去掉；新增
  `parseCoordinateSpace(s: string): CoordinateSpace`（有效标签直通，
  禁用空间抛 `RangeError` 并说明原因，未知字符串亦抛错）；
  `validateTransform` choke point 与 `DISABLED_SPACES` 运行时集合
  保留（后者改型为字符串集合，防未类型化字符串），行为级断言不变；
  契约 §2/§7 已同步；`tests/pr5/coordinates.test.mjs` 新增 1 个测试。
- CI：新建 `.github/workflows/pr6-eeg.yml`（仿 pr5-physics.yml，只跑
  PR6 方法学测试；glob 拾取 `tests/pr6/*.test.mjs`；Playwright 只
  `npx playwright install chromium`，绝不用 `--with-deps`；
  `app/tests/pr6-browser-smoke.mjs` 不存在时跳过并明确输出原因）。
- 推送脚本：新建 `scripts/push-to-pr6-branch.py`（BRANCH 改为
  `pr6-eeg-analysis`，其余安全规则照搬；PR 链接改为 GitHub #7）。
  干跑验证通过：218 文件、23297 KiB、目标
  `abwoo/brainrun@pr6-eeg-analysis`，未发送任何东西。

验证结果（本轮）：

```bash
node --experimental-strip-types --test tests/pr5/contract.test.mjs tests/pr5/coordinates.test.mjs
# 19/19 通过（基线 18 + 新增 R6 测试 1）
cargo test --manifest-path crates/brain-core/Cargo.toml
# 21/21 通过（基线 20 + 新增 R2 测试 1；约 87 s，含 60 s 自发基线测试）
cd app && npx tsc -b && npm run build && npm run lint
# tsc -b 通过（exit 0）；npm run build 通过（exit 0；仅有预存的 chunk >500 kB
# 警告）；npm run lint 通过（exit 0；9 warnings、0 errors，全部在
# ParamControl.tsx / ActivityChart.tsx / App.tsx 的 React refs 上，与 A2
# 改动无关，属既有警告）。注：本地 clone 原先无 node_modules，须先 npm ci。
python3 scripts/push-to-pr6-branch.py
# 干跑通过：218 文件、23297 KiB，目标 pr6-eeg-analysis，未发送
```

## 总协调集成记录（2026-11-12，A2 合并进主 clone）

- A2 的 9 改 + 2 新建已原样拷入主 clone（`git status` 核对：7 改 + .github/workflows/pr6-eeg.yml、scripts/push-to-pr6-branch.py、docs/pr6-acceptance.md、tests/pr6/ 为新增；docs/pr6-design.md 与 A2 副本一致，未动）。
- protocol.ts 注释按 A2 汇报的 exact 文案补改（总协调做，A2 未越界）；漂移测试追加断言 protocol.ts 不再含 '0–4.0'。集成时该断言先失败一次：新注释里 “已从 0–4.0 收紧” 仍含该字面串——把注释改写为 “已从旧的更宽范围收紧” 后通过（断言本意是旧的错误说法不得残留，历史提法也不留字面串）。
- 主 clone 复核全绿：contract + coordinates 19/19；cargo 21/21（含新 R2 测试）；tsc exit 0；build 通过；lint 9 warnings、0 errors（既有）。
- A1（信号处理核心）仍在跑；wave-2（B1/B2/B3）等 A1 回报、接口落定后再派。

## 总协调集成记录（2026-11-12，A1 合并进主 clone）

- A1 的 6 个新建文件已原样拷入主 clone：app/src/lib/signalProcessing.ts（993 行）、
  scientific/eeg/signal_reference.py（670 行）、tests/pr6/signal-processing.test.mjs、
  tests/pr6/test_signal_processing.py、tests/pr6/fixtures/signal-reference.json、
  tests/pr6/fixtures/dpss-tapers.json。未拷 tests/pr6/debug-rounds.md 与
  docs/pr6-acceptance.md 的 A1 副本（是集成前的旧骨架）。
- 总协调裁决（A1 汇报的 EEG_BANDS 两处并存问题）：`eegData.ts` 由总协调按设计稿
  §1.1 新建（全部共享类型 + EEG_BANDS 唯一定义），`signalProcessing.ts` 改为
  从它 import 并 re-export；B1 不再重建该文件，只在其上扩展。另修了两个集成
  问题：(1) A1 的 `'./eegData'` 无扩展名 import 在 Node strip-types 下解析失败
  （本项目约定一律写 `.ts` 扩展名），已全改成 `.ts`；(2) 只 re-export 不引入
  本地绑定导致 `bandPowers` 内 `EEG_BANDS is not defined`，补了 value import。
- 主 clone 复核全绿：TS 39/39（signal-processing 20 + contract/coordinates 19）；
  Python 16/16；tsc exit 0；build 通过；lint 9 warnings、0 errors（既有）。
- A1 残留：multitaper 分支 ERSP 未做 TS↔Python 逐点对照——已交 B3 补一个小规模
  fixture 对照；`docs/pr6-acceptance.md` 待 wave-2 各填实测结果。

## 总协调集成记录（2026-11-12，B1 合并进主 clone）

- B1 的 8 新建 + 6 修改已拷入主 clone（eegRecording.ts、eeg_reference.py、
  eeg-recording 双测试、fixture、EegAnalysisLab.tsx、EegWaveTab.tsx、
  pr6-browser-smoke.mjs；App.tsx/App.css/eegData.ts/contract/acceptance/
  contract.test.mjs 的修改经 diff 核对均为 B1 所述的加法内容）。
  eegData.ts 只加了可选字段 rawDataUvInfinity（无损切换参考用），现有
  字段/类型/EEG_BANDS 一字未动。
- 主 clone 复核：TS 54/54（eeg-recording 13 + signal-processing 20 +
  contract 16 + coordinates 5）；Python 28/28（16 + 12）；tsc 只报 5 处
  缺模块（WavesTab/ErpTab/TfrTab/TopoTab/InverseTab），是 B2/B3 未落地的
  预期内缺口，不是产品问题；build 与浏览器冒烟等 B2/B3 落地后再跑。
- B1 汇报注记 #4 的核对：A2 说的 “19/19” 是 contract(14) + coordinates(5)
  两文件合计，不是 contract 单文件；B1 加 2 项断言后 contract 单文件为
  16 项，数字对得上，无不一致。
- B2（PR-08/09）、B3（PR-10/11/12）仍在跑；它们的 contract/acceptance
  修改基于集成前版本，落地时由总协调手工合并各自段落。

## 总协调集成记录（2026-11-12，B3 合并进主 clone）

- B3 的 11 新建已拷入主 clone（topography.ts、sourceLocalization.ts、
  inverse_reference.py、tfr-topo-inverse 双测试、三个 tab、pr6-topo-inverse.md、
  两个 fixture）。B3 的三个共享文件（contract、acceptance、contract.test.mjs）
  基于集成前版本，**手工合并**：contract 的 B3 §1.6 改号为 §1.7 插在 B1 §1.6
  之后（B1 的 §1.6 与 R4 已解决状态保留，B3 文件里的旧版 U1/R4 两行未取）；
  acceptance 的 PR-10/11/12 三行取 B3 的已通过版本、回归行追加 B3 验证记录、
  残留项追加 MNE 深度偏置/幅度压缩/网格粗/对角噪声协方差四条（R4 已解决行保留）；
  contract.test.mjs 追加 B3 的 import 与 1 项测试（§1.6 字样同步改号为 §1.7）。
- 集成时遇到一个 fixture 缺失：主 clone 里没有 sphere-model.json（生成物、
  不入库），tfr-topo-inverse TS 测试加载即抛错、Python 5 项跳过；已在主 clone
  用 eeg-venv 跑 generate_sphere_model.py 生成（345 导、64 网格点），重跑后全绿。
- 主 clone 复核：TS 71/71（pr6 49 + contract 17 + coordinates 5）；Python 38/38
  （5 项跳过恢复后全跑）；tsc 只报 2 处缺模块（WavesTab/ErpTab），是 B2 未落地的
  预期内缺口；build 与浏览器冒烟等 B2 落地后再跑。
- B3 诚实发现已记入验收与文档：无深度加权 MNE 深部源误差 32–96 mm（表现表
  18 行），未包装成成功；修法（深度加权/dSPM/eLORETA）单独成项。

## 总协调集成记录（2026-11-12，B2 合并进主 clone）

- B2 的 8 新建已拷入主 clone（lateResponse.ts、late_response_reference.py、
  waves-erp 双测试、late-response-reference.json fixture、WavesTab.tsx、
  ErpTab.tsx、pr6-erp-mechanism.md）。B2 的两个共享文件（contract、
  acceptance）基于集成前版本，**手工合并**：contract 的 B2 §1.6 改号为 §1.8
  插在 B3 §1.7 之后（B1 的 §1.6、B3 的 §1.7 均保留；B2 的 R4 旧行未取，
  主 clone 里 R4 已由 B1 解决）；acceptance 的 PR-08/09 两行与缺口表四行取
  B2 的已通过版本、残留项追加 B2 七条（其中漂移测试与冒烟两条的状态已由
  集成动作本身更新：§1.8 断言已追加、冒烟已由总协调跑过，见回归行）；
  contract.test.mjs 追加 B2 的 5 条断言（1 项测试）。
- 集成时修掉一个测试正则 bug（不是产品问题）：新断言里 `ERP_TMIN_MS = -200`
  是负数，原正则 `[\d.]+` 匹配不到，改为 `-?[\d.]+` 后通过；未动任何期望值。
- B2 的两个 tab 与 B1 的壳 props 逐字对上（WavesTab `{ recording, channel }`、
  ErpTab `{ recording, events, epochs, onEpochsChange, channel }`），tsc 的
  2 处缺模块报错清零。冒烟脚本由总协调补了第 5 步（频谱/ERP tab 真实渲染
  检查），不碰 B1 已有的断言；跑冒烟前主 clone 的 app/node_modules 里没有
  playwright（不在 package.json 依赖里），按 CI workflow 同款命令
  `npm install --no-save --package-lock=false playwright@1.56.1` 本地装上，
  package.json/package-lock 未动；Chromium 二进制用缓存，未走 apt。
- 主 clone 复核（全绿）：TS pr6 59/59、contract 18/18、coordinates 5/5；
  Python 45/45；cargo 21/21（brain-core）；tsc 通过；build 通过；lint
  0 errors、9 warnings（既有）；浏览器冒烟 PASS（含新 tab 检查，0 页面报错）。
- B2 诚实发现已记入验收与文档：晚期机制形态修好（300–500 ms 均值
  0.00006→0.070 µV）、幅度基本没动（峰 0.174 vs 真实 8.89 µV，51 倍），
  天花板是 JR sigmoid 饱和（约 0.21 µV），无重缩放；缺口如实保留。

## CI 漂移诊断与修补（2026-11-12，修补执行人）

- 现象：PR #7（分支 pr6-eeg-analysis，提交 940ae5f）的 CI run 43070474642
  failure，唯一失败点是 eeg-analysis job 第 8 步「PR6 Python methodology
  tests」，4 个用例失败；其余步骤被跳过。另一路 PR5 基线 run 43070476134
  success。本地（~/workspace/eeg-venv）Python 45/45 全绿。
- 4 个失败用例与 CI 实测漂移（CI 日志 ~/workspace/pr6-ci-fail.log）：
  1. test_regenerated_fixture_matches_stored：q_nAm[4] -1.665e-15 vs -1.110e-16
     （差 1.55e-15，容差 atol 1e-15）；
  2. test_jr_q_matches_fixture：JR q 最大误差 1.038e-10（容差 1e-12）；
  3. test_blind_table_freshness：mne spread_mm 78.10473943 vs 78.10474639
     （差 6.96e-6，places=6）；
  4. test_fixture_freshness：topo values 最大误差 2.460e-06（容差 1e-9）。
- 根本原因（已实测，不是猜测）：跨环境浮点确定性，不是代码回归。
  - 版本一致：CI 装 mne==1.11.0 → numpy 2.5.4、scipy 1.18.1、Python 3.12，
    与本地 eeg-venv 逐字相同；本地与 CI 同为 Ubuntu 24.04、glibc 2.39。
  - 本地重算与存量 fixture 逐位相同（差 0）：fixture 新鲜、代码未回归，
    重算 fixture 不能修 CI（CI 算出的数与本地不同）。
  - DOP853 误差底：把 rtol 从 1e-10 收紧到 1e-12 重算，JR q 变化
    2.19e-10（相对 1.9e-10）——积分器自身在 rtol=1e-10 下的精度就
    是 ~2e-10，CI 漂移 1.038e-10 落在其内；1e-12 的测试容差比积分器
    自己的精度还严 100 倍。q_nAm[4] 是刺激前精确零，存量 -1.11e-16
    与 CI 的 -1.67e-15 都是积分器 atol=1e-12 合同内的噪声。
  - BLAS 线程敏感性：只改 OMP/OPENBLAS/MKL_NUM_THREADS=1，盲测 spread
    就移动 1.4e-14～2.1e-14——线程数本身就会改结果。
  - 增益敏感性：球形增益矩阵做 1e-7 相对扰动，盲测 spread 移动可达
    4.84e-6；CI 的地形漂移 2.46e-6（0.77 µV 的 3.2e-6 相对）反推 CI
    现场重算的球形正向模型（MNE 四层球求解，颅骨低电导致病态）与本地
    增益差约 3e-6 相对。forward_eeg 是增益的线性映射，地形值只可能
    来自增益差异——代码路径上没有别的变量。
  - 结论：4 个失败全是“测试容差低于跨环境浮点确定性”，不是产品问题。
    修法按任务书二选一：代码无回归、fixture 无需重算，改容差到实测
    的跨环境确定性之上，并写清依据。
- 改了什么（只改测试容差与注释，未动任何产品代码、fixture、科学门槛）：
  - tests/pr6/test_eeg_recording.py：JR q (1e-12, 1e-12) → (1e-9, 1e-9)
    （误差底 2.19e-10 之上约 5 倍；仍比 TS/Python JR 互认 1.9e-8 严 20 倍）；
    fixture 新鲜度 (1e-12, 1e-15) → (1e-9, 1e-12)（atol 取 DOP853 自己的
    atol=1e-12；rtol 同 JR）。
  - tests/pr6/test_tfr_topo_inverse.py：地形电极电位 atol 1e-9 → 1e-5 µV
    （CI 漂移 2.46e-6；仍比同文件样条复现容差 0.02 µV 严 2000 倍）；
    网格值 places=9 → 绝对 1e-5 µV（不能用相对容差：过零点附近相对误差
    虚大，CI 量级扰动下可达 2.45e-4，绝对误差实测最大 1.59e-6）；
    盲测 peak_value places=6 → 相对 1e-5、spread_mm places=6 → 相对 1e-5
    （CI 漂移：峰 3.58e-6 相对、spread 8.9e-8 相对；位置分量仍精确相等）。
  - tests/pr6/tfr-topo-inverse.test.mjs（TS 盲测，同根因、预先修掉，
    否则 CI 第 9 步会倒在这里）：MNE 峰值/分布范围 1e-6 相对 → 1e-5 相对
    （本机 3.2e-6 增益扰动下实测 TS 峰值相对误差 3.08e-6；其余 TS 测试
    用存量 fixture 或自洽比较，不依赖 CI 现场重算的球形模型，不受影响）。
  - 其余断言一字未动：位置分量精确相等、峰值网格点相等、相关 > 0.98、
    样条复现 ≤ 0.02 µV、偶极子矩 1e-6、残差 places=9 等全部保留。
- 验证（本地，eeg-venv / node）：
  - 干净基线：Python 45/45、TS pr6 59/59 全绿。
  - CI 模拟（球形增益做 CI 量级的 3.2e-6 相对扰动后重跑）：Python 45/45、
    TS 59/59 全绿；扰动前曾暴露的另两处同级脆弱断言（peak_value places=6、
    网格值 places=9）已一并按同一依据修掉。
  - 每次模拟后 sphere-model.json 均从备份恢复（与分支存量逐位相同）。
- 推送：修补提交 b8e5eb3（父提交 940ae5f，main 未动）推到同一分支
  pr6-eeg-analysis（API 方式，凭证走 dynamic_credentials surrogate，
  未用 git push；推送本身耗时约 9.5 分钟，系逐文件建 blob 的 API 方式
  所致，非故障）。新 CI 两路全绿：run 43082978168 PR6 EEG Analysis
  Checks + run 43082978017 PR5 Physics Baseline Checks（2026-11-12
  约 02:35），eeg-analysis job 全步骤 success。合并门槛已达到，PR
  正文已更新；PR 仍为 Draft，未合并、未标 Ready，等把关人合并。

## 2026-11-12 PR7 CI 再修：盲测 MNE 峰值容差 1e-5 → 1e-4（总协调）
- 现象：PR7 分支 pr7-multiscale 首个提交 fb50bca 的 CI（PR #8），
  eeg-analysis 第 8 步 PR6 Python 方法学测试失败（exit code 1；
  日志下载接口持续 502，无法直接取 CI 日志——改由本地复现定位）。
- 本地复现：同一命令在本机 45/45 全绿；球形增益做 CI 量级的
  非均匀扰动（每元素独立 ×(1+N(0,3.2e-6))）后，
  test_blind_table_freshness 在峰值断言上失败：1.29e-05 > 1e-5。
- 根因：PR6 修补时用的模拟是均匀扰动（全矩阵同乘 (1+3.2e-6)，
  峰值只漂 3.08e-6），但 CI 现场重算的增益漂移是非均匀的——
  每元素独立漂移经 MNE 白化/逆解放大后，峰值相对误差可达
  1.92e-5。均匀扰动低估了约 6 倍，1e-5 容差在 CI 量级漂移下
  8 种子里 6 个会失败（峰值误差 5.3e-06…1.92e-05），是系统性
  脆弱，不是偶发抖动。
- 误差底实测（8 种子，非均匀 σ=3.2e-6 扰动，逐项最大值）：
  峰值相对 5.3e-06…1.92e-05；spread 相对 1.25e-06…4.40e-06；
  偶极子矩绝对 ~2e-14（容差 1e-9 内 5 个量级余量，靠正向/逆向
  同增益自洽抵消）；残差 ~3e-16。未扰动基线峰值/spread 误差
  均为 0。
- 改了什么（只改测试容差与注释，未动任何产品代码、fixture、
  科学门槛）：峰值相对容差 1e-5 → 1e-4（Python
  test_tfr_topo_inverse.py 与 TS tfr-topo-inverse.test.mjs 同步
  改）；spread 保持 1e-5（实测最大 4.4e-6，2.3 倍余量，证据
  支持不动）。1e-4 留约 5 倍余量，仍比峰值科学量级（O(1) nA·m）
  严 4 个量级；位置分量精确相等、偶极子矩 1e-9、残差 places=9
  等其余断言一字未动，真实回归仍会被位置断言抓住。
- 验证（本地，eeg-venv / node）：
  - 干净基线：Python 45/45、TS pr6 59/59 全绿。
  - CI 模拟（8 种子非均匀 3.2e-6 扰动）：Python 盲测 8/8 通过；
    TS 盲测取最差两种子（0、7）16/16 通过。
  - 每次模拟后 sphere-model.json 均从备份恢复（与分支存量逐位相同）。
- 推送：修补随 PR7 第二个提交推到同一分支 pr7-multiscale，重新
  触发 CI（SHA 与新 CI 结果见 tests/pr7/debug-rounds.md）。
- 附记：此次 eeg-analysis 失败的重新运行请求被接受后，run
  43094678195 以 startup_failure 告终（未起步，非产品问题）；
  同批 physics job 第 28 步“Upload PR5 browser screenshot”也
  失败、job 长时间停在 in_progress（27 个测试步骤全 success）——
  与日志下载 502 同期，疑似 GitHub Actions 基础设施抖动，待
  后续复核。
