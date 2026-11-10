# Brain Physics Playground — Phase 0 核实报告

核实时间：2026-11-10。方法：GitHub API（文件清单/大小）、raw.githubusercontent 下载小文件实测（connectivity_76.zip 44KB、cortex_16384.zip 638KB、regionMapping 文本）、TVB 官方文档、CHIMERA 源码。未下载大文件。

## 1. TVB 数据：三个文件全部真实存在 ✅（但有一处重要提醒）

仓库：https://github.com/the-virtual-brain/tvb-data（默认分支 master）

| 计划里的文件 | 仓库内确切路径 | 大小 | 下载链接 |
|---|---|---|---|
| connectivity_76.zip | `tvb_data/connectivity/connectivity_76.zip` | 44,190 字节 | https://raw.githubusercontent.com/the-virtual-brain/tvb-data/master/tvb_data/connectivity/connectivity_76.zip |
| cortex_16384.zip | `tvb_data/surfaceData/cortex_16384.zip` | 638,133 字节 | https://raw.githubusercontent.com/the-virtual-brain/tvb-data/master/tvb_data/surfaceData/cortex_16384.zip |
| regionMapping_16k_76.txt | `tvb_data/regionMapping/regionMapping_16k_76.txt` | 48,362 字节 | https://raw.githubusercontent.com/the-virtual-brain/tvb-data/master/tvb_data/regionMapping/regionMapping_16k_76.txt |

### ⚠️ 提醒 1：该仓库已声明 DEPRECATED
README 首行：`Using this repository (tvb-data) from Github is now considered DEPRECATED. We advise you to use our Zenodo repository instead: https://zenodo.org/records/10128131`。Zenodo 记录实测存在（HTTP 200），标题 "tvb-data - Extended Dataset"，但只有一个文件 `tvb_data.zip`（337,115,643 字节 ≈ 322 MB），且 API 元数据里 license 为空。建议 Phase 0 从 Zenodo 取数，或继续用 GitHub 上的单个小文件（两者内容是否完全一致未核实）。

### ⚠️ 提醒 2：许可证不明确，计划 Phase 0 第 6 项验收不能直接打勾
- 仓库根目录 `LICENSE` 文件实测内容是 **GPLv3**（"(c) 2012-2019, Baycrest Centre for Geriatric Care"），并要求引用 Sanz-Leon et al. 2013（Frontiers in Neuroinformatics 7:10, doi:10.3389/fninf.2013.00010）。
- 但 GitHub API 对该仓库的 license 判定是 `Other / NOASSERTION`，且 LICENSE 正文是针对 TVB 软件的，**没有单独说明数据文件是否同样适用 GPLv3**。数据再分发（放进 brainrun 仓库随产品发布）是否合规，未核实到明确说法——需在 Phase 0 另行确认，不能默认“能直接分发”。
- 替代做法（未核实可行性，仅作提示）：只在构建时下载、不把数据文件提交进仓库；或联系 TVB 确认。

### connectivity_76.zip 实测内容（已下载解压验证）
- 包含：`weights.txt`、`tract_lengths.txt`、`areas.txt`、`centres.txt`、`cortical.txt`、`info.txt`、`average_orientations.txt`。
- `info.txt` 原文：`weights_unit = "au"`，`length_unit = "mm"`，`area_unit = "mm^2"`。即**权重单位是任意单位（au），长度单位是 mm**。
- `weights.txt`：实测 **76×76** 矩阵，值域 **0–3，且全是整数 0/1/2/3**，非零元 1560 个。注意：这是粗粒度的整数权重，不是连续的纤维束计数/FA 值；使用前需决定是否归一化。
- ⚠️ **对角线非零**：对角元最大 3.0，即存在自连接权重，建模前应把对角线清零（否则每个脑区会自己驱动自己）。
- `tract_lengths.txt`：实测 **76×76**，值域 **0–153.49 mm**，非零元 5402 个——远多于权重的非零元（1560）。即很多权重为 0 的边也有长度值，延迟只应对权重 > 0 的边生效。
- `areas.txt`：76 行（mm²）；`centres.txt`：76 行，含脑区标签（如 rA1、rAMYG）与 xyz 坐标；`cortical.txt`：76 行，全为 1。

### cortex_16384.zip 实测内容（已下载解压验证）
- 包含：`vertices.txt`（16,384 行）、`triangles.txt`（32,760 行）、`vertex_normals.txt`（16,384 行）。
- 顶点坐标单位未在文件内标注，但数值范围 x ∈ [-89.7, 89.0]、y ∈ [-73.6, 71.5]、z ∈ [-68.7, 68.4]，与 mm 量级一致（与 centres.txt 同一量级）；三角形索引 0–16383，合法。
- **未核实到**：该网格是否分左右半球存储、坐标系是 MNI 还是 TVB 自定义、法线是否已归一化。

### regionMapping_16k_76.txt 实测
- 16,384 个值，**0-based，取值 0–75，76 个脑区全部出现，无未映射顶点**（没有 -1）。与 76 节点连接矩阵、16384 顶点网格在数量上一致，可直接对齐。
- 另有同名 `.bz2`（6,115 字节）与 `.zip`（7,667 字节）版本。

## 2. CHIMERA 参考：仓库真实存在 ✅，但“3D 渲染方式”需纠正计划的表述

仓库：https://github.com/jamesondh/chimera-vocal-synth（公开，默认分支 main）
- 创建于 2026-11-05，162 次提交，截至核实日 1404 stars、156 forks，**MIT 许可证**。
- 一句话定位（README 原文）："A physical-modeling voice synthesizer in the browser. Every sound comes from a simulated airway (lungs, vocal folds or syrinx, a branched vocal tract, lips, nose), not from samples."
- 技术栈与计划一致，实测 `package.json`：React 19.3.1、**three 0.186.1**、zustand 5.0.16、Vite 8.3.6、Bun；`Cargo.toml` + `crates/chimera-wasm`：Rust 编译为 WASM 跑在 AudioWorklet。`src/ui/render/anatomy3d.ts`（64,529 字节）实测以 `import * as THREE from "three"` 开头。

### 实际看到的 UI 布局与视觉风格
来源：`docs/ui-redesign.md`（"UI redesign: the vector display"）、`src/ui/colors.ts`、`src/ui/render/`、README。以下均为原文/源码实测：

- **整体风格**：WarGames NORAD 屏幕风——纯黑底上的细发光线条，无填充面板，无扫描线/曲面畸变，无终端打字机效果。
- **颜色分工（`src/ui/colors.ts` 实测色值）**：蓝色 = 身体与结构（`blue #4fb6f2`、`blueMid #3487c4`、`blueDim #1f5f8c`、`frame #133954`）；琥珀色 = 声音（`amber #ffb340`，另有 heat 色阶暗琥珀 `#3a2408` → `#ffb340` → `#fff8ec`）；绿 `#5be381`、红 `#ff5d40`、粉 `#ff73cf`、白 `#eef6f8` 是四个控制槽位颜色；背景纯黑 `#000000`。计划里“蓝色解剖结构、琥珀色动态信号”的概括与源码一致。
- **字体**：Hershey Simplex 单线大写字母（`public/fonts/`）。
- **布局**：顶部栏 + 网格：左侧一个高大的主屏幕（脸部/生物），右侧一列随模式变化的仪表屏；窄于约 1100px 时纵向堆叠。`Screen` 组件画细线框、标题与副标题。
- **控件**：编码器旋钮（Encoder）替代滑杆——底层是原生 `<input type="range">`，上层画旋钮与大数字；每屏 4 个旋钮，可翻页；Chips（带框大写标签，点亮表示开启）替代开关与分段按钮。
- **渲染方式（关键纠正）**：矢量仪表屏用 **Canvas 2D**，不是 WebGL/Three.js——“用 `globalCompositeOperation = 'lighter'` 画锐利线条，再把画布缩放到低分辨率层模糊后叠回做辉光”，并明确写道 "WebGL only if a trace says so"。**Three.js 只用于 3D 解剖视图**（`anatomy3d.ts`），且该 3D 视图是**正中矢状切面的头，用发光线条画出来的线框风格**（"drawn as glowing lines like everything else"），舌头/软腭是带肋纹的曲面、嘴唇是面片——**不是写实 shaded 的实体网格大脑**。计划若照搬“真实皮层网格 + Three.js 实体渲染”没问题，但不应说 CHIMERA 本身就是这么做的；CHIMERA 的 3D 是线条风切面，不是实体器官。
- **模式**：Play / Speak / Sing / Beatbox / Bestiary / Duet；所有屏幕内容都由实时引擎状态驱动（气道压力、气流、声带、频谱、共振峰）。
- 另有 `docs/architecture.md`（声学 FDTD 模型）、`docs/rust-engine.md`（实时与确定性约定）、`docs/mockups/`（矢量显示 mockup）可作视觉参考。

## 3. Wilson–Cowan 模型：标准方程与两套 TVB 默认参数

出处：Wilson & Cowan 1972, Biophysical Journal 12:1–24（方程 11、12）；TVB 2.9-18196 官方文档 http://docs.thevirtualbrain.org/api/tvb.simulator.models.html（`wilson_cowan` 节）；TVB 源码 https://github.com/the-virtual-brain/tvb-library/blob/master/tvb/simulator/models/wilson_cowan.py（`dfun`，第 312–341 行，实测）。

### 标准方程（单节点，Neuromatch 教程形式）
```
τ_E dE/dt = -E + F_E(w_EE·E - w_EI·I + P)
τ_I dI/dt = -I + F_I(w_IE·E - w_II·I + Q)
F(x; a, θ) = 1 / (1 + exp(-a·(x - θ)))
```
来源：https://compneuro.neuromatch.io/tutorials/W2D5_DynamicalSystems/student/W2D5_Tutorial2.html

### TVB 的实际实现形式（源码实测，以此为准）
```
x_e = α_e·(c_ee·E - c_ei·I + P - θ_e + coupling_E + local)
x_i = α_i·(c_ie·E - c_ii·I + Q - θ_i + local)
S_e = c_e / (1 + exp(-a_e·(x_e - b_e)))
S_i = c_i / (1 + exp(-a_i·(x_i - b_i)))
dE/dt = (-E + (k_e - r_e·E)·S_e) / τ_e
dI/dt = (-I + (k_i - r_i·I)·S_i) / τ_i
```
其中 coupling 只进入 E 方程（长程耦合是外部输入 P 的入口，见 TVB 文档）；E、I 状态范围 [0, 1]。

### 两套“默认参数”并存——必须选定一套（均已核实）
TVB 文档同一页面给出两套，注意它们**不一样**：

**A. TVB 代码实际默认值（`tvb-library` 源码实测，与 Sanz-Leon et al. 2015 表 11a 一致）——推荐作为 MVP 默认值：**

| 参数 | 值 | | 参数 | 值 |
|---|---|---|---|---|
| c_ee | 12.0 | | c_ei | 4.0 |
| c_ie | 13.0 | | c_ii | 11.0 |
| τ_e, τ_i | 10.0 ms | | a_e | 1.2 |
| b_e | 2.8 | | a_i | 1.0 |
| b_i | 4.0 | | θ_e, θ_i | 0.0 |
| c_e, c_i | 1.0 | | r_e, r_i | 1.0 |
| k_e, k_i | 1.0 | | α_e, α_i | 1.0 |
| P, Q | 0.0 | | | |

**B. TVB 文档 Table 0（引自 Wilson & Cowan 1972 图 4，第 10 页）——仅作文献对照：**

τ_e, τ_i = 9.0；c_ee = 11.0；c_ei = 3.0；c_ie = 12.0；c_ii = 10.0；a_e = 0.2；a_i = 0.0；b_e = 1.8；b_i = 3.0；θ_e, θ_i = -1.0；α_e, α_i = 1.0；P, Q = -1.0；k_e, k_i = 0.0；r_e, r_i = 0.0；c_e, c_i = 0.0；shift_sigmoid = True。

另有一套出自 Sanz-Leon et al. 2014 / Daffertshofer & van Wijk 2011 的振荡参数（TVB 文档 Table 1，20 Hz 峰值）：k = 1.0，τ = 10.0，c_ee = 10.0，c_ei = 6.0，c_ie = 10.0，c_ii = 1.0，a = 1.0，b = 0.0，θ_e = 2.0，θ_i = 3.5，α_e = 1.2，α_i = 2.0，P = 0.5，Q = 0.0，c_e, c_i = 1.0。可作为“振荡演示”预设的候选，需另行验证。

### 两个文档层面的小问题（已核实）
1. TVB 在线文档渲染的通用方程里，I 方程写的是 `c_ie·E_k - c_ee·I_k`，与参数定义矛盾；**源码实测为 `c_ie·E - c_ii·I`**，以源码为准，文档该处疑似笔误。
2. 文档 Table 0 列出 `shift_sigmoid = True`，但当前 `tvb-library` master 源码全文无 `shift` 字样（grep 0 命中）。该开关在 TVB 2.9 文档版里是否存在、语义如何，未核实到——MVP 应按源码形式实现，不引入该参数。

## 未核实到的事项
- tvb-data 的 Zenodo 压缩包内容与 GitHub 单个文件是否完全一致。
- connectivity_76 的原始出处（Hagmann 等）与采集细节；cortex_16384 的坐标系归属（MNI 与否）、半球划分方式。
- 数据文件随产品再分发的许可结论（见 §1 提醒 2）。
- CHIMERA 3D 视图的帧率/性能数据；其 mockup 图的实际观感（只读了文字规范与色值，未逐像素看图）。
