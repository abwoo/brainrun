# BrainRun — 第三方说明（NOTICE）

本仓库的代码以 MIT 许可发布（见根目录 `LICENSE` 文件）。以下第三方内容
各有自己的来源与许可，**不在 MIT 代码许可的覆盖范围内**。

## 脑数据：The Virtual Brain 示例数据（Demo Connectome）

- 来源：The Virtual Brain（TVB）示例数据集 `tvb-data`：
  76 节点连接矩阵 `connectivity_76`、16,384 顶点皮层网格 `cortex_16384`、
  脑区映射 `regionMapping_16k_76`。
- 性质：**演示用连接组（Demo Connectome）**。权重主要来自猕猴 CoCoMac
  神经示踪数据，胼胝体连接是人类 DSI 纤维束宽度缩放后填入的双半球
  混合矩阵，皮层下结构未包含；不是某个真人的 MRI / 扩散 MRI 测得的
  个体化连接网络。TVB 官方声明该数据集“为数值测试与理论探索定制，
  生物物理真实性有限，不应以此为依据”。
- 引用（使用数据时必须标注）：Sanz-Leon, P., Knock, S. A., Woodman, M. M.,
  Domide, L., Mersmann, J., McIntosh, A. R., & Jirsa, V. (2013).
  The Virtual Brain: a simulator of primate brain network dynamics.
  *Frontiers in Neuroinformatics*, 7:10. doi:10.3389/fninf.2013.00010
- 许可状态：**核查结论见 `docs/data-license.md`**（PR1）。`tvb-data` 仓库
  根 LICENSE 为 GPLv3，但未单独说明数据文件是否同样适用，数据再分发
  许可未完全明确。原始数据文件与预处理衍生资产均不进本仓库，
  由构建时下载并生成（`scripts/prepare-brain-data/fetch.py` +
  `prepare.py`）；`app/public/brain-assets/` 只含构建时生成的资产。

## 运行时依赖（前端）

| 依赖 | 许可 | 用途 |
|---|---|---|
| three | MIT | 3D 皮层网格渲染 |
| react、react-dom | MIT | 界面 |
| vite | MIT | 构建与开发服务器（构建时） |
| typescript | Apache-2.0 | 类型检查（构建时） |
| @vitejs/plugin-react | MIT | Vite React 插件（构建时） |
| @types/* | MIT | 类型声明（构建时） |
| oxlint | MIT | 代码检查（开发时） |

## 运行时依赖（Rust 引擎）

| 依赖 | 许可 | 用途 |
|---|---|---|
| serde、serde_json | MIT OR Apache-2.0 | 场景 JSON 序列化 |
| wasm-bindgen | MIT OR Apache-2.0 | Rust → WASM 绑定 |

`crates/brain-core` 与 `crates/brain-wasm` 本身声明 `MIT OR Apache-2.0`
（见各自 `Cargo.toml`），与仓库根目录 MIT 代码许可无冲突。

## 模型方法引用

- Wilson, H. R., & Cowan, J. D. (1972). Excitatory and inhibitory
  interactions in localized populations of model neurons.
  *Biophysical Journal*, 12(1), 1–24.
- Sanz-Leon, P., Knock, S. A., Spiegler, A., & Jirsa, V. K. (2015).
  Mathematical framework for large-scale brain network modeling in
  The Virtual Brain. *NeuroImage*, 111, 385–430.

## fsaverage template derivative (2026-11-13)

The optional anatomical head model is a **modified derivative**, not the original FreeSurfer distribution or an individual MRI. BrainRun transforms MRI geometry to HEAD, decimates display surfaces, selects cortical vertices and calculates EEG lead fields with MNE 1.11.0. The source archives are pinned by SHA-256 from the official [MNE fsaverage 1.0 mirror](https://github.com/mne-tools/mne-data/releases/tag/fsaverage-1.0); the mirror explicitly identifies the former OSF archives. Full [FreeSurfer 1.0 terms](licenses/FreeSurfer-1.0.txt) and [MNE mirror BSD notice](licenses/MNE-data-BSD-3-Clause.txt) accompany every public model JSON. The code MIT license does not replace these data terms. No MRI volumes or unrelated PALS-B12 labels are served.

Attribution: FreeSurfer/MGH fsaverage; Fischl, Sereno, Tootell & Dale (1999), High-resolution intersubject averaging and a coordinate system for the cortical surface, Human Brain Mapping 8:272–284. The aparc labels originate from the Desikan–Killiany cortical parcellation (Desikan et al., 2006, NeuroImage 31:968–980). BEM and template registration are provided by MNE. Research/teaching only; no clinical approval or source-author endorsement is implied.
