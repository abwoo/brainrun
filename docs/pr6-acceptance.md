# PR6 · EEG 分析合并门槛（实时审查清单）

**状态：Draft / Partial.** 本文件区分已通过方法学测试的部分与未完成的
第二批目标。仅有方法学测试通过，不能视为 PR6 全部完成；完整回归、浏览器
交互全套、前端布局全面扫查、性能、五维验收、十个演示全部推迟到 PR8 之后。

## 验收门槛（计划 PR-07–PR-12）

| 模块 | 门槛 | 状态 |
| --- | --- | --- |
| PR-07 多导 EEG | 多通道同时仿真；参考切换真实改变数值；噪声参数与单位明确、可种子复现；导联切换重建传感器配置 | 已通过（2026-11-12，B1）：`tests/pr6/eeg-recording.test.mjs` 13/13、`tests/pr6/test_eeg_recording.py` 12/12。柱模型 q(t)（WC/JR/双源）→ 球形 lead-field → 250 Hz 多通道 µV；参考三模式两两最大差 1.87 / 7.08 / 7.55 µV（> 0.01 µV 门槛）；噪声四成分各归一化到目标 RMS（µV），同种子 JSON 级复现；10-20=19 导、10-10=25 导，标签与 fixture 一致（**口径注：25 导是合成测试 fixture `tests/pr6/fixtures/eeg-recording-reference.json` 的 `synthetic_fixture` 里的通道数，不是真实球形模型的导联数；真实模型为 10-20=19、10-10=94、10-05=343，见 `docs/model-spec.md` §10.2；2026-11-12 PR8-C 核对**）；TS/Python 对照：投影与参考逐位一致、噪声差 ≤8e-14、WC q 差 2.0e-6 nA·m、JR q 差 1.9e-8 nA·m、全跑电压差 1.35e-6 µV。 |
| PR-08 频段/PSD | JR p0=220 alpha 峰实测值与 ds003061 量化对照；频段功率来自同一份 EEG；无“每频段叠加正弦”伪造 | **已通过（2026-11-12，B2）**：JR p0=220 极限环 10 s 连续记录，Welch 峰 y0 与 Pz 同为 **10.99 Hz**（ds003061 Pz 10.00 / Oz 9.25 Hz，偏差 +0.99 / +1.74 Hz）；alpha 占比 99.8%（纯极限环、无宽带背景，虚高已知）；Pz RMS 0.017 µV（真实基线 6.07 µV，差 ~360 倍）；频段功率全部来自同一份信号；预设只上 Alpha 探索（JR p0=220），Oscillatory 10 Hz 正弦仍标注为外部驱动。测试 `tests/pr6/waves-erp.test.mjs` + `test_waves_erp.py` 相关项全绿；详见 `docs/pr6-erp-mechanism.md` §3 |
| PR-09 ERP | MNE 口径分段/基线/平均；峰值幅度与潜伏期、差异波、SEM；晚期成分机制量化改进（或如实写清缺口） | **已通过（2026-11-12，B2）**：MNE 口径 epoch（−200–800 ms、基线 −200–0、>150 µV 剔除）+ 平均/SEM + 峰值/潜伏期/窗均值 + 差异波 + 试次数量效应（SEM ∝ 1/√n）全实现，MNE `Epochs`/`Evoked` 独立对照一致；晚期机制（慢突触电流 + 延迟再入，`lateResponse.ts`）：oddball 峰 **0.174 µV @352 ms**、300–500 ms 均值 **0.070 µV**（机制前 ~0.00006 µV），差异波峰 0.166 µV @352 ms，oddball 选择性 8.1×；**幅度缺口如实保留**：峰值仍差真实 8.89 µV 约 51 倍（y0 饱和天花板约 0.21 µV），无重缩放，守卫测试覆盖。TS 10/10、Python 7/7；详见 `docs/pr6-erp-mechanism.md` §4–§5 |
| PR-10 时频 | STFT / Morlet / multitaper、ERSP 与 ITC，与 Python 参考数值对照 | ✅ 已通过（2026-11-12，B3）：TS `tests/pr6/tfr-topo-inverse.test.mjs` 16/16、Python `tests/pr6/test_tfr_topo_inverse.py` 10/10。multitaper ERSP 小规模 fixture（A1 残留项）TS vs Python 逐点一致（ERSP 1e-6 dB、ITC 1e-9）；20 Hz 突发刺激后 ERSP +5.73 dB、ITC 1.000；beta 带功率刺激后/基线 = 19.1 倍；STFT 与 Morlet 10 Hz 峰值差 2.01 dB（方法不混比，见 docs/pr6-topo-inverse.md §1） |
| PR-11 地形 | 2D 插值地形与 3D 正向头皮电位严格区分 | ✅ 已通过（2026-11-12，B3）：球面样条（Perrin，m=4、n≤7、λ=1e-5）网格 TS vs Python 逐点 1e-9（441 点）；电极点复现误差 ≤ 0.02 µV（实测 1.03e-2）；3D 正向 345 点与 `sphereElectrodePotentials`（10-05，infinity）逐点差 0.00e+0；UI 两图分开展示并写清来源差异（见 docs/pr6-topo-inverse.md §2） |
| PR-12 源定位 | 偶极子拟合 + MNE 逆解；盲测定位误差数值 | ✅ 已通过（2026-11-12，B3）：盲测无噪声 5 配置 TS vs Python 逐项一致（偶极子误差 0.0 mm、残差 < 1e-9 µV；MNE 峰值/分布范围相对 1e-6）；MNE 真实管线（`make_inverse_operator`/`apply_inverse`）峰值网格点 3/3 相同、相关 0.990–0.995；表现表 18 行（见 docs/pr6-topo-inverse.md §3.2）：偶极子拟合无噪声 0.0 mm、0.5 µV 噪声下 0–55 mm（残差≈噪声水平）；MNE 无深度加权：深部源 32–96 mm、表浅角源 0.0 mm、分布范围 20–105 mm（深度偏置，残留项，未包装成成功） |
| 契约残留 | R1（stim_amplitude 引擎 clamp）、R2（快照 JSON 版本）、R4（电极参考 UI）、R6（MNI152/Talairach 类型消除） | R1 已解决（2026-11-12，A2，方案 (a)：WASM clamp 0–4.0 → 0.5–2.0，与 UI 相等；漂移测试 19/19、cargo 21/21）；R2 已解决（2026-11-12，A2：StateSnapshot.version=1，旧 JSON 视为 1 恢复；同上）；R6 已解决（2026-11-12，A2：两标签已出 CoordinateSpace 类型，parseCoordinateSpace 为唯一字符串入口；同上）；R4 已解决（2026-11-12，B1：EEG 分析实验的参考下拉已有 average/infinity/electrode 三种 + 电极选择器，三种参考数值各不相同，漂移测试 16/16；三个 PR5 实验的参考下拉仍只有两种，缺口如实保留） |
| 回归 | 构建通过；本批方法学测试通过；新功能冒烟通过 | A2 部分已验证（2026-11-12）：`npx tsc -b` 通过；`npm run build` 通过；`npm run lint` 通过（0 errors、9 warnings，均为既有 React refs 警告，不在 A2 文件内）；B1 部分已验证（2026-11-12）：`npx tsc -b` 通过；`npm run build` 通过；`npm run lint` 通过（0 errors、9 warnings，同上，B1 文件内 0 warnings）；PR-07 方法学测试通过（TS 13/13、Python 12/12、漂移测试 16/16）；浏览器冒烟通过（2026-11-12，`app/tests/pr6-browser-smoke.mjs`，stub tab 在位时验证）：运行实验后 Pz 波形 y 范围 24.8（有真实变化）；平均/无限远/电极三种参考波形各不相同；种子 2 + 开噪声后波形变（y 范围 39.3）；1920×1080 对话框 1100×972、978×800 对话框 938×736，均不出视口、无横向溢出、0 页面报错。；B3 部分已验证（2026-11-12）：B3 方法学测试 TS 16/16 + Python 10/10 + 契约漂移测试 15/15（含新增 B3 断言）；`npx tsc -b`、`npm run build`、`npm run lint`（0 errors；warnings 9 个，均为既有 React refs 警告，B3 文件内 0 个）；冒烟待 B2 落地、壳接好后由总协调统一做。 B2 集成后总协调复核（2026-11-12）：TS pr6 59/59（signal 20 + eeg-recording 13 + tfr-topo-inverse 16 + waves-erp 10）、contract 18/18（含新增 §1.8 断言 1 项）、coordinates 5/5；Python 45/45（16 + 12 + 10 + 7）；cargo 21/21（brain-core；brain-wasm 0 测试）；`npx tsc -b` 通过（缺模块报错已清零）；`npm run build` 通过；`npm run lint` 通过（0 errors、9 warnings，均为既有 React refs 警告，B2 文件内 0 条）；浏览器冒烟通过（`app/tests/pr6-browser-smoke.mjs`，已补频谱/ERP tab 检查）：Pz y 范围 24.8/39.3、三参考各不相同、频谱 tab 与 ERP tab 真实渲染（切分试次后 ERP 波形 + 条件表）、1920×1080 与 978px 对话框不出视口、无横向溢出、0 页面报错。 |

## PR5 结构性缺口跟踪（ds003061，sub-001 run-1）

| 对照项 | 实测 | PR5 结论 | PR6 结果 |
| --- | --- | --- | --- |
| 幅度：P300 峰值 8.89 µV @410 ms | 8.89 µV | WC 0.71 µV（差 12.6 倍）、JR 0.17 µV（差 53.8 倍） | **PR6 B2**：晚期机制后 oddball 峰 0.174 µV @352 ms（差 51 倍）、差异波峰 0.166 µV @352 ms（真实 9.14 µV，差 55 倍）。峰值幅度基本没动——y0 饱和天花板约 0.21 µV，调增益只会锁存。仍是结构性缺口 |
| 形态：300–500 ms 均值 6.94 µV | 6.94 µV | WC 0.0002 µV、JR 0.0065 µV | **PR6 B2**：oddball 均值 **0.070 µV**（机制前 0.00006 µV）、差异波均值 0.061 µV、standard 均值 0.0086 µV（真实 0.06 µV）。形态已修好（窗内非零、潜伏期在窗内、oddball 选择性 8.1×），幅度仍为真实值的 1.0% |
| 基线：刺激前 RMS 6.07 µV | 6.07 µV | 模型基线 q = 0 | **PR6 B2**：未变（本机制不管基线）。归 PR-07 噪声/背景模型 |
| 频率：alpha 峰 10.0 Hz（Pz） | 10.0 Hz | 2.07 Hz（瞬时脉冲谱峰，非节律） | **PR6 B2**：JR p0=220 极限环实测 **10.99 Hz**（y0 与 Pz 同值），偏差 +0.99 Hz；alpha 占比 99.8%（纯极限环、无宽带背景，虚高已知）；Pz RMS 0.017 µV（差 ~360 倍） |

## 残留项

- R1 尾巴（总协调补）：`app/src/worker/protocol.ts` 的 `stim_amplitude`
  注释仍写“引擎侧 clamp 是 0–4.0”，须改为 0.5–2.0（exact 文案见 A2
  汇报）；改完后漂移测试应追加断言 protocol.ts 不再含 '0–4.0'。
  引擎、契约、漂移测试三处已改完并全绿。
- R1 已知边界（不是缺口）：单次事件幅度（Worker `stimulus` /
  `hold_start` 消息、调试桥 `pulse(node, amplitude?)`）经
  `add_stimulus` 直接入队，从来不钳制；Python 参考
  `experiments.py` 的幅度 sweep（用到 4.0）走这条路径，不受
  `set_stim_amplitude` clamp 影响。契约 §1.2 已写清两条路径的区别。
- R4（电极参考 UI）已解决，归 B1（PR-07）：EEG 分析实验已有三参考下拉 + 电极选择器（见上）；三个 PR5 实验仍只有两种，缺口如实保留。
- B2 残留（2026-11-12，PR-08/09）：
  - 幅度缺口未闭合：oddball 峰 0.174 µV vs 真实 8.89 µV（51 倍）、300–500 ms
    均值 0.070 vs 6.94 µV（99 倍）。y0 饱和天花板约 0.21 µV，调增益只会锁存；
    需 PR6/PR7 的真实节律机制与 ERP 生成机制，或接受“教学仿真”定位。
  - 基线仍是 0（刺激前 RMS 0 vs 真实 6.07 µV），归 PR-07 噪声/背景模型。
  - alpha 占比虚高（纯极限环 99.8% vs 真实 Pz 30.3%），模型无宽带背景。
  - 锁存边界近：默认增益 2.5 距锁存边界（~3.5–4）约 60% 裕量；误调到 4
    以上会锁存（但会被 `detectLatch` 检出，不静默通过）。
  - 试次独立重启，无跨试次适应/学习；ISI 只定事件时间戳。
  - 契约 §1.8 登记的漂移测试断言已由总协调在集成时追加进 `tests/pr5/contract.test.mjs`。
  - WavesTab/ErpTab 浏览器冒烟由总协调在集成后统一做（壳已落地，见回归行）。
- CI 说明：`.github/workflows/pr6-eeg.yml` 的
  `tests/pr6/*.test.mjs` 用 bare glob——wave-2 测试文件落地后自动被
  拾取；`app/tests/pr6-browser-smoke.mjs`（wave-2 才建）不存在时该步
  跳过并明确输出原因，不让 CI 变红。

- MNE 深度偏置未修（B3，PR-12 最重残留）：无深度加权 MNE 深部源误差 32–106 mm；修法是深度加权（MNE 默认 depth=0.8）/ dSPM / eLORETA，需与 MNE 公式逐项对齐，单独成项。
- MNE 幅度压缩（B3）：峰值幅度不是真值幅度（峰值被压至真值 4–53%），需公开 EEG/MEG 数据约束才谈校准（PR5 结构性缺口的延续）。
- 源网格粗（B3）：间距 32 mm，网格点外源至少半个间距量化误差；加密需重算 lead-field fixture。
- 噪声协方差为对角 σ²I（B3）：未估计真实通道间相关噪声；σ 默认 1.0 µV 需按记录噪声水平给。
