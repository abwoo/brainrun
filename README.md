# Brain Physics Playground

一个可以在浏览器里直接动手玩的 3D 大脑神经动力学模拟器：点一下脑区，
真实的 Wilson–Cowan 神经群体模型就会算出响应，你能立刻在 3D 大脑和
实时波形上看到它，并通过旋钮改变刺激、耦合与兴奋/抑制，再点一次比较结果。

在线演示：**https://abwoo.github.io/brainrun/**

> 定位：CHIMERA 式的直观交互体验，科学计算的真实性是底线。
> 没有假动画：所有颜色、波形、读数都只读模型快照；
> 没有教程也能玩：触碰 → 观察 → 调节 → 发现。

## 本地运行

```bash
# 1. 准备脑数据（构建时下载 TVB 示例数据，不提交进仓库）
python3 scripts/prepare-brain-data/prepare.py

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
- **按住脑区**：持续输入，松开即停（按住过久会把网络锁在高活动态，点 RESET 恢复）。
- **四个旋钮**：刺激强度、持续时间、兴奋/抑制、连接强度——全部直通模型参数。
- **CONNECT**：只看选中脑区的主要连接；**PLAY**：暂停/继续仿真时钟；
  **RESET**：恢复默认参数与确定性初始状态。

## 技术栈

| 模块 | 技术 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite |
| 3D 渲染 | Three.js（真实 TVB 皮层网格，16,384 顶点） |
| 波形 | Canvas 2D（示波器风） |
| 计算核心 | Rust（Wilson–Cowan 模型，Heun 积分，1 ms 步长） |
| 浏览器计算 | WebAssembly + Web Worker（模型按真实时间推进，与渲染解耦） |
| 科学参考实现 | Python / NumPy（与 Rust 实现逐数对照，最大偏差 3.4e-16） |

## 模型

每个脑区是一对兴奋/抑制神经群体（Wilson–Cowan），76 个脑区通过
TVB 的结构连接矩阵耦合，延迟由纤维长度 / 3.0 mm/ms 传导速度决定。

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
原始数据文件不进仓库，构建时下载、预处理脚本见
`scripts/prepare-brain-data/`。引用：

> Sanz-Leon, P., Knock, S. A., Spiegler, A., & Jirsa, V. K. (2015).
> Mathematical framework for large-scale brain network modeling in
> The Virtual Brain. *NeuroImage*, 111, 385–430.
> 数据：Sanz-Leon et al. (2013), *Front. Neuroinform.* 7:10.

## 许可

- 代码以 MIT 许可发布（LICENSE 文件待补）。
- 脑数据许可：`tvb-data` 仓库的 LICENSE 为 GPLv3，但未单独说明数据文件
  是否同样适用，再分发许可目前未明确；本仓库只收录预处理后的轻量资产，
  原始数据文件不进仓库，引用与来源见 `app/public/brain-assets/meta.json`。
  公开使用前请自行确认数据许可。

## 验收

- 科学验证与对照：`docs/validation.md`
- MVP 最终验收（五个演示场景 + A/B/C/D 清单）：`docs/acceptance.md`
