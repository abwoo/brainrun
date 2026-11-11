# PR8-C · 科学复核 + 定位 + 文档 + 许可 调试记录

> 分工 C，工作区 `~/workspace/brainrun-pr8-c`（main `453e5707` 的拷贝，
> 分支 `pr8-polish-release`）。**只改文档**（`docs/`、README.md），
> 未改任何产品代码（`app/src`、`crates`、`scientific`、`tests` 下的测试
> 代码均未动）；只在本地工作，未 push、未开 PR、未合并。
> 每个数字均从代码或已有实测文档中核实并注明出处；不确定的写“未核实”，不猜。

## 1. 核对记录（代码 → 文档，逐项）

| # | 核对项 | 代码出处 | 文档落点 | 结果 |
|---|---|---|---|---|
| N1 | WC 局部柱参数（τ_E 12 / τ_I 20 ms，c 2.8/2.4/2.6/0.2，tonic 0.1，sigmoid 2.5/1.1，dt 1 ms） | `app/src/lib/localCorticalColumn.ts` L59–70 | model-spec §10.4 | 一致 |
| N2 | 偶极矩假设链（N=1,000,000、c=0.08、200/100 pA、0.5 mm） | 同上 L71–77 | model-spec §10.4 | 一致 |
| N3 | JR 标准参数（A 3.25、 B 22、a 100、b 50、C 135/108/33.75/33.75、e0 2.5、v0 6、r 0.56、p0 90、dt 0.5 ms） | `app/src/lib/jansenRitColumn.ts` L82–96 | model-spec §10.5 | 一致 |
| N4 | JR 换算斜率 g = 200 pA/mV；JR/WC 峰值比 0.234、潜伏期差 68 ms | 同上 L80；`docs/pr5-jansen-rit.md` §4 | model-spec §10.5 | 一致 |
| N5 | 四层球形头（半径 95 mm、脑内 85.5 mm、相对半径 0.90/0.92/0.97/1.0、电导率 0.33/1.0/0.004/0.33、网格 [-48,-16,16,48]³、导联 19/94/343） | `scientific/forward/generate_sphere_model.py` L21–29、L39–46；`app/src/lib/sphereForward.ts` L36 | model-spec §10.2 | 一致 |
| N6 | 解析偶极子（σ 0.33、12 示意传感器半径 90 mm、奇点 < 1 mm 抛错） | `app/src/lib/volumeConduction.ts` L33–34、L51–75、L112 | model-spec §10.1 | 一致 |
| N7 | 晚期机制（τ_slow 200、delay 100、gain 2.5、守卫 5000；标准 120 / 靶 300 1/s；40 试次；ISI 1000；分段 −200–800、基线 −200–0、剔除 150 µV；峰窗 250–600、窗均值 300–500；Pz 增益 0.16，范围 0.130–0.188） | `app/src/lib/lateResponse.ts` L69–111 | model-spec §11.3 | 一致 |
| N8 | 多导 EEG（250 Hz、默认时长 10000 ms、源 [0,0,16]、噪声默认 2/1/0.5/0.5 µV、滑杆 0–10） | `app/src/lib/eegRecording.ts` L74–101 | model-spec §11.1 | 一致 |
| N9 | 频段定义（delta 0.5–4、theta 4–8、alpha 8–13、beta 13–30、gamma 30–45） | `app/src/lib/eegData.ts`（`EEG_BANDS`，由 `signalProcessing.ts` L48–49、L67–69 转引） | model-spec §11.2 | 一致 |
| N10 | 细胞级（LIF 250 pF/25 nS/−65/−50/−65 mV/2 ms/0.1 ms；流变 375 pA；HH 120/36/0.3、+50/−77/−54.387、dt 0.025 ms；`CELLULAR_ID`） | `app/src/lib/cellular.ts` L25、L59–69 | model-spec §12.1 | 一致（其余细胞数字沿用 `docs/pr7-cellular.md` 已实测值，未重算） |
| N11 | 刺激（TES σ 0.33、TMS 默认线圈 35 mm/10 匝/1e8 A/s、`STIMULATION_ID`） | `app/src/lib/stimulation.ts` L71–73、L87、L270 | model-spec §12.2 | 一致（其余刺激数字沿用 `docs/pr7-stimulation.md` 已实测值） |
| N12 | 实验（dt 0.5 ms、控制节拍 4 ms、Pz 增益复用 0.16） | `app/src/lib/experiments.ts` L62–65；`app/src/lib/depthWeightedInverse.ts` L63–66（depth 默认 0.8、eLORETA 20 轮/1e-3） | model-spec §12.3 | 一致 |
| N13 | 四个主滑杆（刺激 0.5–2.0、持续 20–500 ms、c_ei 3–8、G 0–0.4；横向滑杆 + 数字框 + 步进 + 双击恢复） | `app/src/App.tsx` L1182–1250（`ValueSlider`/`ParamControl`，L48–113）；契约 §1.2 | README 玩法 | 一致；README 原“四个旋钮”已修正 |
| N14 | 顶栏实验台入口（HEAD EEG、EEG 分析、DIPOLE LAB、细胞实验、刺激实验、对照实验、模型信息；PLAY 为暂停/继续开关） | `app/src/App.tsx` L689–745 | README 玩法 | 一致；总规范 PLAY/WAVES/EEG/EXPLORE 四个模式名目前没有作为并列模式入口实现，已在 README 如实写清 |
| N15 | 公开 EEG 约束数字（P300 8.89 µV @410 ms、300–500 均值 6.94、基线 RMS 6.07、alpha Pz 10.00 Hz；WC 差 12.6 倍、JR 差 53.8 倍） | `docs/pr5-public-eeg-constraint.md`（已有实测文档，未重跑数据） | model-spec §10.6、§13 | 一致 |
| N16 | PR6/PR7 机制后数字（oddball 峰 0.174 @352 ms、均值 0.070、alpha 10.99 Hz/占比 99.8%、深度偏置表、细胞路线 −0.059 µV/2.50 µV、适应 300→177→127→106→98） | `docs/pr6-erp-mechanism.md` §3–§5、`docs/pr6-topo-inverse.md` §3、`docs/pr7-cellular.md` §5、`docs/pr7-experiments.md` §3、`tests/pr7/debug-rounds.md` 末节 | model-spec §11–§13 | 一致 |

## 2. 文档与代码不一致（只记录，不改代码）

| # | 问题 | 证据 | 处理 |
|---|---|---|---|
| D1 | `docs/pr6-acceptance.md` 写“10-10=25 导”无限定，易被误读为真实球形模型的导联数；真实模型是 10-10=94（MNE `standard_1020`）、10-05=343 | `tests/pr6/eeg-recording.test.mjs` L225–228 用的是合成 fixture（`tests/pr6/fixtures/eeg-recording-reference.json` 的 `synthetic_fixture`，25 通道）；`scientific/forward/generate_sphere_model.py` L39–46 用 `standard_1020`/`standard_1005`；`docs/pr5-acceptance.md` 写 10-10 94、10-05 343 | **文档侧已修**：pr6-acceptance.md 该句加口径注（25 导为合成 fixture 通道数）；model-spec §11.1 写真实数 19/94/343 并加口径注意。测试代码本身无错（合成 fixture 自洽），不改代码。 |
| D2 | 契约 §7 R1 的尾巴（protocol.ts 注释仍写 clamp 0–4.0）已过时 | `app/src/worker/protocol.ts` L14–16 现已写“引擎侧 clamp 同样是 0.5–2.0” | **文档侧已修**：契约 §7 R1 改为“尾巴已解决（2026-11-12 PR8-C 核实）”。漂移测试追加“protocol.ts 不再含 '0–4.0'”的断言未追加（测试代码，留给总协调）。 |
| D3 | App.tsx 内「模型信息」弹窗文案未同步“教学仿真”定位与已知限制数字 | `app/src/App.tsx` L1495 起仍写“基于神经生理机制的实时仿真”，未写“教学仿真”、未写 51 倍等数字 | **未改（产品代码）**：记入 `docs/pr8-acceptance.md` 残留 R-C1，待有代码权限的分工同步文案。文档侧（model-spec §1、README、发布说明）已全部同步。 |

核对中**未发现**需要改产品代码才能修的科学错误：WC/JR/球形头/
晚期机制/细胞/刺激/实验各模块的代码参数与各自机制文档一致，
出入只在文档口径（D1–D3），均已在文档侧处理或记录。

## 3. 许可复核（2026-11-12）

- **TVB：仍不确定，无变化。** 未收到 TVB 书面回复（发邮件仍未定，
  等用户拍板）；`tvb-data` 仍已归档；构建时生成仍是现行做法；
  重写公开历史仍未定。注记已写入 `docs/data-license.md` 顶部。
- **fsaverage：仍不得公开再分发，无变化。** Part B §3 第三方权利 +
  MNE OSF 镜像来源链未核实；随附许可包尚未制作。注记已写入
  `docs/pr5-license-and-zero-config.md` §一（续）。
- **onavg 调查（本次新做）：** CC0 再次核实（TemplateFlow
  `template_description.json` `"License": "CC0"`；GitHub 仓库页
  CC0-1.0）；密度档位每半球 10k/41k/164k/655k；格式 GIFTI
  （`.surf.gii` + `.label.gii`）；托管 TemplateFlow + GitHub。
  缺口：根目录清单只含球面表面与 dparc 标签，未见 pial/white/
  inflated 表面；文件为 DataLad 软链接，**单文件大小未核实**；
  无头皮/颅骨壳、电极位置、已验证 HEAD 配准。
  **建议：推进，作单独立项小验证；不建新数据管线、不换网格。**
  详见 `docs/model-spec.md` §13.2 与
  `docs/pr5-license-and-zero-config.md` §三。
- **GitHub PR #6（另一方 CI 回归门禁 PR，分支
  `ci/main-regression-gates-20261111`）：仍开着**，未合并、未关闭，
  等用户定夺；只写状态，不擅自决定。已写入
  `docs/release-notes-draft.md` 与 `docs/data-license.md` 复核注记。

## 4. 若 D 路改善后需更新的精确位置表（不等 D 路，不编结果）

D 路（PR8 并行分工）在同时尝试改善幅度 / 基线 / alpha 占比 /
深度偏置三项。若其中任何一项的数字变了，按下表逐处更新，
**不得只改一处**（每行列出所有必须同步的位置）。

| 改善项 | 当前数字 | 若变了，必须同步更新的位置（全部） |
|---|---|---|
| 幅度缺口（P300 峰值 51 倍） | 0.174 µV @352 ms vs 8.89 µV；WC 12.6 倍、JR 53.8 倍；天花板 ~0.21 µV | ① `docs/model-spec.md` §1 定位声明段、§10.6 对照表、§11.3 对照表与结论段、§13 L1/L2 行；② `README.md` 定位引言、PR6 节、已知限制第 1 条；③ `docs/release-notes-draft.md` 定位段、包含内容 PR6 段、已知限制表第 1–2 行；④ `docs/user-guide.md` §4（“差了 51 倍”段）与 §7 第 1 条；⑤ `docs/pr8-acceptance.md` 17-4/17-5 行与五维 B 行（如数字变到可称“校准”，须重写定位——目前不假设会发生）；⑥ `docs/pr6-acceptance.md` 缺口跟踪表与 `docs/pr6-erp-mechanism.md` §5（如 D 路改机制文档，归 D 路） |
| 形态（300–500 ms 均值 99 倍） | 0.070 vs 6.94 µV；差异波峰 0.166 vs 9.14 µV | 同上 ①–⑥ 中涉及 300–500 ms 均值与差异波的每一处（model-spec §11.3/§13 L2、README 限制第 1 条、发布说明表第 2 行、用户指南 §4） |
| 基线 RMS（仍为 0） | 模型 0 vs 真实 6.07 µV；JR 极限环 Pz RMS 0.017 µV（差 ~360 倍） | ① model-spec §1、§11.2 表格、§11.3 表格“基线 RMS”行、§13 L3 行；② README 已知限制第 2 条；③ 发布说明表第 3 行；④ 用户指南 §4（静息段）与 §5；⑤ `docs/pr6-acceptance.md` 缺口跟踪表“基线”行 |
| alpha 占比（99.8%） | 纯极限环 99.8% vs 真实 Pz 30.3% / Oz 69.3%；峰 10.99 vs 10.00 Hz | ① model-spec §11.2 表格与解读段、§13 L4 行；② README 已知限制第 3 条；③ 发布说明表第 4 行；④ 用户指南 §5（alpha 段）；⑤ `docs/pr6-acceptance.md` 缺口跟踪表“频率”行 |
| 深度偏置（无方法同时修好深浅两端） | 无噪声深源 dSPM 0.00 / 浅源 55.43 mm；有噪声深源 depth 96.00 vs plain 78.38 mm | ① model-spec §12.3 对照表与结论段、§13 L5 行；② README PR7 节与已知限制第 4 条；③ 发布说明表第 5 行与包含内容 PR7 段；④ 用户指南 §4（源定位段）；⑤ `docs/pr6-topo-inverse.md` §3.6 与 `docs/pr7-experiments.md` §3.4（如 D 路改机制文档，归 D 路） |
| 以上任一项改善 | — | ⑥ `docs/pr8-acceptance.md` 17-5 行状态改为“已更新（D 路数字）”并注明日期；⑦ 本文件 §4 加一行“已按 D 路结果更新（日期）” |

## 5. 改动文件清单（本分工，全部为文档）

| 文件 | 改动 |
|---|---|
| `docs/model-spec.md` | §1 加“教学仿真”定位 + 红线；新增 §10（PR5）、§11（PR6）、§12（PR7）、§13（最终定位与已知限制 + onavg 调查 + D 路更新位置指向） |
| `README.md` | 定位引言加教学仿真与 51 倍；开篇“旋钮”→“滑杆”；玩法补 EEG 分析/细胞/刺激/对照实验台、“四个滑杆”修正、模式说明；新增 PR6/PR7 节与已知限制摘要 |
| `docs/user-guide.md` | 新建：大白话用户指南 |
| `docs/release-notes-draft.md` | 新建：发布说明草稿（建议 v2.0.0，由用户定；未发布 GitHub Release） |
| `docs/pr8-acceptance.md` | 新建：PR-16/17 验收清单 |
| `docs/data-license.md` | 顶部加 2026-11-12 复核注记（TVB 仍不确定、fsaverage 仍不得分发、onavg 调查、PR #6 状态） |
| `docs/pr5-license-and-zero-config.md` | §一（续）“目前不能分发”加 2026-11-12 复核无变化；§三 onavg 段加 2026-11-12 调查更新（CC0 再核实、密度/格式、缺口、建议） |
| `docs/pr6-acceptance.md` | PR-07 行加口径注（25 导为合成 fixture 通道数，真实模型 19/94/343） |
| `docs/frontend-backend-contract.md` | §7 R1 尾巴改为已解决（protocol.ts L14–16 已核实） |
| `tests/pr8/debug-rounds-c.md` | 新建：本文件 |

## 6. 残留（本分工）

- R-C1：App.tsx「模型信息」弹窗文案未同步“教学仿真”定位（§2 D3），
  待代码分工。
- R-C2：PR-16（视觉优化、无教程测试、真机性能）不属 C，待其他分工。
- R-C3：五维验收与十个演示推迟到 PR8 之后最终大测试（按测试节奏新规）。
- R-C4：D 路结果未知；改善后按 §4 的表更新，不得只改一处。
- R-C5：onavg 单文件大小未核实（DataLad annex 对象）；根目录清单未见
  pial/white 表面——onavg 小验证立项时核实。
- 未核实项：onavg 各密度档的单文件大小与完整文件清单（只看了
  TemplateFlow 仓库根目录，未拉取 DataLad annex 对象）；TVB 上游许可
  状态未重新拉取（本次复核以“无新信息”记为无变化，未宣称重新核查过
  上游原文）。
