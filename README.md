# Brain Physics Playground

一个可以在浏览器里直接动手玩的 3D 大脑神经动力学模拟器：点一下脑区，
真实的 Wilson–Cowan 神经群体模型就会算出响应，你能立刻在 3D 大脑和
实时波形上看到它，并通过旋钮改变刺激、耦合与兴奋/抑制，再点一次比较结果。

在线演示：**https://abwoo.github.io/brainrun/**

> 定位：CHIMERA 式的直观交互体验，科学计算的真实性是底线。
> 没有假动画：所有颜色、波形、读数都只读模型快照；
> 没有教程也能玩：触碰 → 观察 → 调节 → 发现。
>
> 数据说明：默认连接组是**演示用连接组（Demo Connectome）**——
> TVB 示例数据的猕猴 CoCoMac + 人类 DSI 混合矩阵，
> 不是某个真人的个体化连接网络；模拟结果是模型在该演示连接组上的
> 行为，不代表真实人脑的客观反应。点右上角「模型信息」查看完整说明。

## 本地运行

```bash
# 1. 准备脑数据（构建时下载 TVB 示例数据并生成资产，不提交进仓库）
python3 scripts/prepare-brain-data/fetch.py
python3 scripts/prepare-brain-data/prepare.py

# 1b. 构建 PR5 的 MNE 四层球形 EEG 正向模型（无须下载人类 MRI）
python3 -m pip install mne==1.11.0
python3 scientific/forward/generate_sphere_model.py

# 2. 编译 Rust 引擎为 WASM（需要 cargo + wasm-pack）
bash scripts/build-wasm.sh

# 3. 安装前端依赖并启动
cd app
npm install
npm run dev
```

打开 http://127.0.0.1:5173/ 即可玩。生产构建：`npm run build`；
GitHub Pages 构建：`npm run build:pages`（基路径 `/brainrun/`）。

## 玩法

- **点击脑区**：施加一次短暂刺激，看活动变化与网络响应。
- **HEAD EEG**：独立的四层球形物理头模型，直接拖动电流源、改变方向/强度、切换标准电极布局，看 MNE 预计算的电位实时变化；不是人类 MRI/BEM。
- **DIPOLE LAB**：均匀无限导体解析物理基线（12 个示意传感器），用于比较边界条件的影响。
- **按住脑区**：持续输入，松开即停（按住过久会把网络锁在高活动态——这是网络进入了新的稳定状态，不是软件卡住；横幅上点「恢复到按住前」可一键回到按住前，或点 RESET）。
- **背景活动**：安静 / 自发 / 振荡三档，默认自发——每脑区持续收到 Ornstein–Uhlenbeck 背景输入（τ = 100 ms、σ = 0.10），同一随机种子重跑逐值相同；振荡档是明确标注的 10 Hz 正弦外部驱动（不是自发节律，见 `docs/model-spec.md` §9）。
- **实验快照**：保存当前完整实验状态（一键恢复，恢复后继续跑的轨迹与不恢复逐值一致）；手动快照存浏览器本地，刷新后还在，按住开始时另存一份自动快照，不覆盖手动快照。
- **四个旋钮**：刺激强度、持续时间、兴奋/抑制、连接强度——全部直通模型参数。
- **CONNECT**：只看选中脑区的主要连接；**PLAY**：暂停/继续仿真时钟；
  **RESET**：恢复默认参数与确定性初始状态。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite |
| 3D 渲染 | Three.js（TVB 示例数据皮层网格，16,384 顶点） |
| 波形 | Canvas 2D（示波器风） |
| 计算核心 | Rust（Wilson–Cowan 模型，Heun 积分，1 ms 步长） |
| 浏览器计算 | WebAssembly + Web Worker（模型按真实时间推进，与渲染解耦） |
| 科学参考实现 | Python / NumPy（与 Rust 实现逐数对照，最大偏差 3.4e-16） |

## 模型

每个脑区是一对兴奋/抑制神经群体（Wilson–Cowan），76 个脑区通过
TVB 示例数据（Demo Connectome）的结构连接矩阵耦合，延迟由纤维长度 /
3.0 mm/ms 传导速度决定。该连接矩阵权重主要来自猕猴 CoCoMac 示踪数据，
胼胝体连接是人类 DSI 纤维束宽度缩放后填入的双半球混合矩阵，
皮层下结构未包含；TVB 官方声明该数据集为数值测试与理论探索定制，
生物物理真实性有限。详见 `docs/model-spec.md` 与应用内「模型信息」。

**默认预设**：TVB 的 A-set 参数只改一个值——θ_e 从 0 改为 1.0，
全局耦合 G = 0.35。原因：纯 A-set 本身是双稳态的（三个不动点，
两个稳定），幅度 ≥ 0.1 的点击会让被点脑区永久锁在高活动态，
“点击—响应—恢复—再点击”的循环转不起来；改一个 θ_e 后单节点只剩
一个稳定点，100 ms 脉冲峰值 ΔE = 0.482、72 ms 内恢复，
8/75 个脑区瞬态响应。纯 A-set 仍保留在代码里作参考配置。
详见 `docs/model-spec.md` 与 `docs/validation.md`。

## 数据来源与引用

脑结构与连接数据来自 The Virtual Brain 的示例数据（`tvb-data`）：
76 节点连接矩阵、16,384 顶点皮层网格、脑区映射三者配套对齐。
**这是演示用连接组（Demo Connectome），不是真人个体化连接网络**：
权重主要来自猕猴 CoCoMac 神经示踪数据，胼胝体连接是人类 DSI 纤维束
宽度缩放后填入的双半球混合矩阵，皮层下结构未包含；TVB 官方声明该
数据集“为数值测试与理论探索定制，生物物理真实性有限，
不应以此为依据”。原始数据文件不进仓库，构建时下载、预处理脚本见
`scripts/prepare-brain-data/`。引用：

> Sanz-Leon, P., Knock, S. A., Spiegler, A., & Jirsa, V. K. (2015).
> Mathematical framework for large-scale brain network modeling in
> The Virtual Brain. *NeuroImage*, 111, 385–430.
> 数据：Sanz-Leon et al. (2013), *Front. Neuroinform.* 7:10.

## 许可

- 代码以 MIT 许可发布，见根目录 `LICENSE` 文件；第三方说明见 `NOTICE.md`。
- 脑数据许可：核查结论见 `docs/data-license.md`。`tvb-data` 仓库的
  LICENSE 为 GPLv3，但未单独说明数据文件是否同样适用，再分发许可
  目前未完全明确；原始数据与预处理衍生资产均不进仓库，构建时下载
  并生成（见 `docs/data-license.md`），引用与来源见
  `app/public/brain-assets/meta.json`（构建时生成）。
  公开使用前请自行确认数据许可。

## PR #5 的科学与发布边界

当前新增的 HEAD EEG 使用 MNE 的四层同心球近似，不是个体化头部 BEM 或真实人类图谱。10–20 基础 19 点、扩展 10–10 94 点、10–05 343 点由 MNE 模板电极方向径向投影到同一球面，**不能将投影点直接称为实际个体头皮位置**。源空间为球心附近的有限三维立方网格，源移动时采用经过 MNE 数值比对的三线性插值；**不代表已将 TVB 76 区 E/I 神经活动映射成具有单位的皮层电流源**。模型来源、限定参数、可复现实验、未完成的 MRI/图谱/BEM/许可门槛详见 [`docs/pr5-acceptance.md`](docs/pr5-acceptance.md)。

## 验收

- 科学验证与对照：`docs/validation.md`
- MVP 最终验收（五个演示场景 + A/B/C/D 清单）：`docs/acceptance.md`
