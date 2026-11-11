# PR5 · 测试日志（CI/回归/许可子代理，2026-11-11）

## 本轮 CI 诊断

- GitHub Actions run 43032235876：`physics-and-types` 唯一失败步骤是第 26 步
  “Install Playwright Chromium”（`npx playwright install --with-deps chromium`）；
  第 1–25 步全部通过（含类型检查、生产构建、Lint、全部物理验证、Rust 回归、
  WASM 编译、Python 参考测试），第 27 步浏览器冒烟测试因此被跳过。
  结论：环境/脚手架问题，不是产品问题。
- 修复（`.github/workflows/pr5-physics.yml`，其余步骤未动）：
  第 26 步改为最多重试 3 次、每次失败后等待 30 秒；保留
  `--with-deps chromium`，不改用 runner 自带系统 Chromium。理由：失败点是
  apt/系统依赖安装的瞬时环境波动；pinned 的 Playwright 1.56.1 浏览器及其
  精确系统依赖正是冒烟测试验证过的组合，换系统 Chromium 会无声改变受测
  浏览器。Workflow YAML 已本地校验通过。

## 测试节奏新规（2026-11-11 用户定）

- PR5 本轮合并门槛 = 方法学测试通过 + 构建通过 + 冒烟通过。方法学测试指：
  MNE 正向模型对照、Jansen–Rit 对比 Wilson–Cowan、公开 EEG/MEG 约束、
  单位与坐标正确性、引擎数值对照。
- 全量回归（PR1–PR4 浏览器测试、浏览器交互全套、前端布局全面扫查、性能、
  五维验收、十个演示）推迟到 PR8 合并之后，与最终 MVP 统一验证合并做一次
  最终大测试。本轮不跑这些，CI 里也不加。
- 许可/零配置、MNI152/Talairach 禁用核查、推送脚本三项范围不变。

## 回归结果（本轮，2026-11-11，分支 feat/pr5-physics-core HEAD 3261673）

### 第 1 轮（脚本漏了 CI 的前置生成步骤，部分失败均为环境/搭建原因）

| 测试 | 结果 | 原因 |
| --- | --- | --- |
| `cargo test`（crates/brain-core） | 通过 | — |
| `reference/python-model/test_wilson_cowan.py` | 失败 2 项 | 缺 `app/public/brain-assets/connectivity.json`：脚本未先跑 `fetch.py`/`prepare.py`（CI 在 Python 测试前跑这两步） |
| `reference/python-model/test_pr3.py` | 通过 | — |
| `reference/python-model/test_pr4.py` | 失败多项 | 同上，缺 brain-assets |
| `npx tsc -b`（app） | 失败 | `app/node_modules` 未装：`npx tsc` 误装了无关的 `tsc@2.0.4`；CI 在此之前跑 `npm ci` |
| `npm run build`（app） | 失败（127） | 同上，`tsc: not found` |
| `node --experimental-strip-types --test tests/pr5/*.test.mjs` | 5 项失败 | 见下表 |

第 1 轮 `tests/pr5` 5 项失败分解：

| 失败 | 原因 | 性质 |
| --- | --- | --- |
| `coordinates.test.mjs` “rejects guessed MNI or Talairach transforms” | **产品侧真问题（我引入的）**：新禁用报错信息不含 `Invalid`，且 `composeTransforms` 先校验后判帧，导致组合断言期望的 `/frames do not match/` 被禁用报错抢先 | 已修，见下 |
| `fsaverage-bem-dense.test.mjs` | 缺 `.local-assets/pr5/fsaverage-bem-dense.json`（需本地生成，CI 不生成） | 环境/搭建 |
| `local-column-real-bem.test.mjs` | 缺 `.local-assets/pr5/fsaverage-bem.json`（需本地生成） | 环境/搭建 |
| `local-column-coupling.test.mjs` “independent SciPy DOP853 …” | 缺 `tests/pr5/fixtures/local-column-reference.json`（CI 先跑 `local_column_scipy_reference.py` 生成，脚本漏了） | 环境/搭建 |
| `sphere-forward.test.mjs` | 缺 `app/public/forward-assets/sphere-model.json`（CI 先跑 `generate_sphere_model.py`，脚本漏了） | 环境/搭建 |

### 坐标禁用修复（产品侧真问题，第 1 轮发现并修掉）

- 漏洞：旧 `validateTransform` 只校验方法/出处非空与矩阵合法，调用者填一个
  像样的 `method`/`provenance` 就能让 `applyTransform` 静默输出假 MNI152 /
  Talairach 数值——此前测试只覆盖了空方法/空出处的拒绝，未覆盖此路径。
- 修复（仅 `app/src/lib/coordinates.ts`）：`validateTransform` 现拒绝任何
  `from`/`to` 涉及 `mni152-mm`、`talairach-mm` 的转换（报错以 `Invalid
  coordinate transform: ... is disabled in PR5` 开头）；`composeTransforms`
  改为先判帧连续性、再校验内容，保证帧不匹配时仍报 `frames do not match`；
  同一 choke point 亦拒绝任何涉及 `tvb-demo-mm` 的转换（TVB 76 区 → 人类
  模板无任何合法映射入口）。
- 验证：`/tmp/check-coords.mjs` 一次性脚本 5/5 通过（假 MNI152、假 Talairach、
  TVB→head、组合进 MNI152、求逆均抛错；合法 head→sphere 仍为 `[10,-20,0]`）；
  现有 `tests/pr5/coordinates.test.mjs` 4/4 通过（修复后重跑）。

### 第 2 轮（补齐 CI 同款前置生成步骤后重跑）

前置生成（均按 CI/文档顺序，首次执行即成功）：

| 步骤 | 结果 |
| --- | --- |
| `python3 -m pip install mne==1.11.0`（系统 Python） | 失败 1 次：PEP 668 externally-managed-environment，系统 Python 拒绝 pip 安装 |
| 改用新建 venv `~/workspace/brainrun-pr5/.venv`（gitignored）安装 `mne==1.11.0 nibabel trimesh fast-simplification` | 成功 |
| `scripts/prepare-brain-data/fetch.py && prepare.py`（TVB brain-assets） | 成功 |
| `scientific/forward/generate_sphere_model.py` | 成功 |
| `scientific/forward/local_column_scipy_reference.py` | 成功（系统 Python 自带 scipy 1.11.4） |
| `generate_fsaverage_bem.py --download --sources-per-hemisphere 8 --montage 10-20` | 成功 |
| `generate_fsaverage_bem.py --download --sources-per-hemisphere 64 --montage 10-05`（dense） | 成功 |

重跑结果：

| 测试 | 结果 |
| --- | --- |
| `npx tsc -b`（app，`npm ci` 后） | 通过 |
| `npm run build`（app） | 通过 |
| `python3 reference/python-model/test_wilson_cowan.py` | 通过（OK） |
| `python3 reference/python-model/test_pr3.py` | 通过（OK） |
| `python3 reference/python-model/test_pr4.py` | 通过（OK） |
| `cargo test`（crates/brain-core，第 1 轮） | 通过（Rust 代码本轮未动，不重跑） |
| `node --experimental-strip-types --test tests/pr5/*.test.mjs`（第 2 轮全量） | 70/75 通过；5 项失败全为并发子代理在途工作或生成时序问题，见下 |
| PR5 浏览器冒烟 `app/tests/pr5-browser-smoke.mjs` | 第 1 次失败：本地缺 Playwright 1.56.1 对应的 `chromium_headless_shell-1194`（缓存只有 1254）；第 2 次失败：`__brainSim.isReady()` 45 秒超时——本地从未跑过 `scripts/build-wasm.sh`，`app/public/wasm/` 不存在（CI 在冒烟前编译 WASM，脚本漏了）。两次均为环境/搭建原因，已补装浏览器并正在补编译 WASM 后重跑 |

### 第 2 轮 `tests/pr5` 5 项失败分解（全部已定位，非本子代理产品问题）

| 失败 | 原因 | 归属与状态 |
| --- | --- | --- |
| `fsaverage-bem-dense.test.mjs` ENOENT | 重跑时 `.local-assets/pr5/fsaverage-bem-dense.json` 尚未落盘（与生成步骤时序重叠；文件本身已生成成功，2.6 MB） | 环境时序；单独重跑 4/4 通过 |
| `jansen-rit.test.mjs` 4 项（PSP、JR vs WC、alpha 极限环等） | 该文件与 `app/src/lib/jansenRitColumn.ts` 是另一子代理（Jansen–Rit）在途工作；重跑时对方正在改文件（mtime 15:03–15:04，与重跑重叠） | 他人范围；对方改完后单独重跑 12/12 通过 |
| 注：第 2 轮全量 75 项中其余 70 项（含 `coordinates` 4 项、`contract` 13 项）均通过 |

### 第 3 轮（截至 2026-11-11 15:06 UTC）

- `tests/pr5` 全量 glob 重跑：**77/78 通过**，仅剩 1 项失败：
  `contract.test.mjs` “Jansen–Rit：TS 默认 = Python 对照，耦合链与 WC 路线同形；
  暂无 UI 入口”——断言 `LocalBEMLab.tsx` 等组件**不应**引入 `jansenRitColumn`
  （U5 未消项）。但 `LocalBEMLab.tsx` 在 15:06:53 被另一子代理改动，已接入
  JR（WC/JR 并排面板，`columnModel` 状态），与该测试 15:04 的期望冲突。
  这是**跨子代理时序冲突**，不在本子代理文件归属内（`app/src/components/*`、
  `tests/pr5/contract.test.mjs`、`docs/frontend-backend-contract.md` 均禁动），
  需总协调裁决：由契约子代理更新该断言（U5 已消），或由 JR 子代理回退 UI 接入。
  本子代理不改他人文件。另注：该 contract 测试中“坐标系：球心 [0,0,40] mm；
  MNI152/Talairach 禁用”一项**通过**，从契约侧印证了坐标禁用修复。
- `jansen-rit.test.mjs` 单独重跑：12/12 通过。`fsaverage-bem-dense.test.mjs`
  单独重跑：4/4 通过。`coordinates.test.mjs`：4/4 通过。
- 冒烟测试：本地已装 Playwright Chromium（`npx playwright install chromium`
  成功，`chromium_headless_shell-1194` 已下载）；正在补跑 `scripts/build-wasm.sh`
  （含 `cargo install wasm-pack`）后重跑冒烟。
- 冒烟第 2、3 次运行均在同一处失败：`page.screenshot`（第 141 行，
  dipole-lab 全页截图）30 秒超时，`waiting for fonts to load... fonts loaded`
  后挂起；两次之前的所有功能断言均已通过（WASM 启动、时钟推进、峰值、
  12 路传感器有限值、偶极矩/方向改变电压、重置、3D 拖动更新位置），且截图
  文件本身每次都已落盘并为有效 PNG（1600×1965 / 1600×2069 RGB）。判定为
  headless-shell + SwiftShader 下全页截图的环境抖动，非产品问题。
- 冒烟第 4 次运行（同一截图步骤第 3 次尝试，未超止损上限）**通过**：
  `PR5 browser smoke PASS: 12 voltages, moment, orientation, reset, 3D drag,
  screenshot, no pageerror`；4 张截图全部落盘且有效（dipole-lab、
  mne-head-sphere、mri-bem-local-synthetic，另有 JR 子代理的 jr-panel 两张）。
  冒烟结论：通过。

## 止损记录

- 本轮无测试因非产品问题失败超过 3 次，无测试被停掉。
- 第 1 轮的失败均为第 1 次出现，且均为脚本漏前置步骤或我引入的真问题，
  按规则修掉/补齐后重跑，未进入循环。
- 冒烟测试截图步骤连续失败 2 次后第 3 次尝试通过，未达“超过 3 次停掉”的
  上限；若再失败即按规则停掉并记录，实际已通过，无需停。
- 注意：`tests/pr5/*.test.mjs` 全量 glob 包含两个本地资产测试
  （`fsaverage-bem-dense`、`local-column-real-bem`），CI 工作流不跑这两项，
  它们只在本地生成 `.local-assets/` 后才可跑；资产已生成，本轮一并重跑。

## 许可 / 零配置（2026-11-11）

- FreeSurfer Part B 已按官方原文逐条核对（§1–§8），详见
  `docs/pr5-license-and-zero-config.md` 一（续）。
- 结论：§1 原则上允许再分发，但须随附完整 Part B 文本 + §1(b) 固定开头
  措辞 + 署名保留 + 修改标注，随附许可包尚未制作；§3 第三方权利
  （40 名受试者底层 MRI 数据、`aparc` 图谱单独权利）未清除；实际副本
  来自 MNE OSF 镜像、来源链未经核实。**fsaverage 派生数据仍不得公开
  再分发**，继续本地导入。
- 零配置：首屏默认四层球模型（无受限数据）已落地；许可干净的真实解剖
  替代已识别为 onavg（CC0，Ma 等 2024《Nature Methods》，1,031 脑，
  TemplateFlow `tpl-onavg`），但其 BEM 所需头皮/颅骨壳、配准与数值验证
  均未建成，暂无现成的完整头部替代，不得声称已就绪。
- `docs/pr5-acceptance.md` 的许可/零配置、图谱与坐标、低门槛操作、
  回归测试四项阻塞项状态已更新为上述实情；顶部新增“测试节奏新规”一节。

## MNI152 / Talairach 与 TVB 映射禁用核查（2026-11-11）

- 代码：`app/src/lib/coordinates.ts` 现硬拒绝任何涉及 `mni152-mm`、
  `talairach-mm`、`tvb-demo-mm` 的转换（见上“坐标禁用修复”）。
- UI：无任何 MNI152/Talairach 转换入口（无相关 `<select>`，无组件
  import `coordinates.ts`）；`LocalBEMLab.tsx` 仅只读展示 MNI305 数值，
  明确标注非 MNI152；各 Lab 文本均为免责声明，无混用入口。
- TVB 76 区 → fsaverage：代码与 UI 中均无混用入口；`fsaverageBEM.ts`、
  `localCorticalColumn.ts`、`LocalBEMLab.tsx`、`HeadSphereLab.tsx`、
  `DipoleLab.tsx` 均有显式“不互通/不对齐”声明；生成脚本只用 `aparc`、
  不用第三方 PALS-B12 Brodmann 标注（已核实）。

## 推送脚本

- 新建 `scripts/push-to-branch.py`：复用本仓库 `scripts/push-to-main.py`
  的 gitignore 收集与 git database API（blob→tree→commit→更新 ref），
  目标为已存在的 `refs/heads/feat/pr5-physics-core`（PR #5），父提交为
  分支当前 head；默认 dry-run，`--yes` 才真推；推前核对 main SHA 在
  推送过程中未变、分支 head 与本地 HEAD（`git rev-parse HEAD`，
  默认 3261673）一致；禁推 `.local-assets/`、TVB 原始数据、
  `forward-assets/`、`brain-assets/`；绝不直接 `git push`，凭证走
  dynamic_credentials surrogate（custom.github，allowed_hosts=
  `api.github.com`），不写入文件或聊天。
- 自测：dry-run 通过——192 个文件、21,580 KiB，无禁推路径，含新建脚本
  本身；未真推。

## 残留项

- **跨子代理时序冲突 1 项（需总协调裁决）**：`tests/pr5/contract.test.mjs`
  “Jansen–Rit：TS 默认 = Python 对照…暂无 UI 入口”断言组件不应引入 JR，
  但 `LocalBEMLab.tsx` 已被另一子代理接入 JR 面板。修复归属契约子代理
  （更新断言，U5 已消）或 JR 子代理，不在本子代理文件归属内，未动。
  除此之外，`tests/pr5` 全量 glob 其余 77 项全部通过。
- fsaverage 派生数据公开再分发仍阻塞（§3 第三方权利 + MNE 镜像来源链
  + 随附许可包未制作）。
- onavg 零配置真实 BEM 路径尚未立项（需头皮/颅骨壳方案、配准与数值验证）。
- `docs/pr5-acceptance.md` 中其余阻塞项（真实人类解剖几何、统一源空间、
  真实头部 BEM、真实模板电极、神经模型到源的映射、端到端浏览器验收、
  真实硬件测试）不在本子代理范围内，未动。
- CI 侧 run 43032235876 的第 26 步失败是 GitHub runner 环境问题，
  本地无法直接复现该 runner 的 apt 波动；重试修复已上 workflow，
  需下一次 CI 运行验证。

## 最终回归总表（2026-11-11，HEAD 3261673 + 本子代理工作树改动）

| 测试 | 结果 |
| --- | --- |
| `cargo test`（crates/brain-core） | 通过 |
| `python3 reference/python-model/test_wilson_cowan.py` | 通过 |
| `python3 reference/python-model/test_pr3.py` | 通过 |
| `python3 reference/python-model/test_pr4.py` | 通过 |
| `npx tsc -b`（app） | 通过 |
| `npm run build`（app） | 通过 |
| `node --experimental-strip-types --test tests/pr5/*.test.mjs` | 77/78 通过；仅剩 contract.test.mjs 的跨子代理 U5 断言（见残留项） |
| PR5 浏览器冒烟 `app/tests/pr5-browser-smoke.mjs` | 通过（第 4 次运行） |
| 方法学测试 + 构建 + 冒烟（新规合并门槛，本子代理范围内） | 除上述 1 项他人断言外全部通过 |
