# BrainRun P0-1A — 控件真实作用与科学数据流审计

基线：main `888640d0`（PR8 合并后）；本轮分支 `p0-1-control-causality-audit`。
结论：**P0-1 尚未完成**。本 PR 修复/明确少量已核实的高风险断点，并建立覆盖全部原生控件声明的自动审计入口；它不能替代真实浏览器触发后的跨模型因果测试。

## 0. 审计口径

完成必须能够证明：**用户手势 → 具体命令 → 物理模型/数学状态变化 → 数值产物 → 所有订阅视图的一致反馈**。每条链路记录以下六个字段：

1. 来源控件（模块、可见名称、启用条件）。
2. 命令（函数/消息、参数、目标引擎、仿真时刻）。
3. 状态改变（模型/实验 ID、版本、参数快照、前后值）。
4. 输出（有量纲的波形/统计量/空间场，明确计算方法）。
5. 订阅者（主 3D、波形、EEG/ERP/TFR/地形/逆解等）。
6. 验证（数值断言 + 真实浏览器操作 + 参考实现）。

分类：`LIVE` 写入主 76 区 WASM；`DERIVED` 从现有记录计算；`INDEPENDENT` 运行独立求解器；`VISUAL` 只改渲染/选区；`NAV` 仅导航；`BLOCKED` 前提未满足必须明确禁用。不能将 `INDEPENDENT` 或 `NAV` 宣称为 `LIVE`。

## 1. 原生控件表面覆盖

`tests/p0-1/control-flow.test.mjs` 使用 TypeScript JSX AST 遍历 17 个主要 React 源文件中的所有原生 `button/input/select/textarea` 声明，列出位置、绑定的回调以及控件类型，并对无 `onClick/onChange` 的控件失败。基线为 **207 个静态 JSX 控件声明**，不是运行时循环展开的按钮总数，也不是 207 条因果路径已验证。

| 表面 | 静态声明量 | 重要语义 |
| --- | ---: | --- |
| App 主界面 | 44 | 主仿真、脉冲/重置/连接/背景/回放；模式、实验台入口 |
| EXPLORE | 6 | 搜索和脑区选择；坐标演示与细胞台导航 |
| CellularLab | 18 | 独立 LIF/HH/多房室；可选假设增益反向写回 |
| 场景启动器 | 5 | S1–S3 LIVE，S4–S15 大多 INDEPENDENT；入口仅 NAV |
| EEG 分析及 EEG 波形 | 15 | 独立记录/直播推导/重新参考/导出 |
| ERP/TFR/地形/逆解/WAVES | 26 | 记录派生、late 独立事件、独立正向采样图 |
| HEAD/DIPOLE/LocalBEM | 30 | 独立正向/本地模板解；直播源仅部分接入 |
| StimLab | 29 | 简化 TES/TMS/感觉输入，场→神经增益未校准 |
| ExperimentLab | 34 | 独立 JR A/B、时间机器/闭环 + 部分 LIVE 桥接 |
| BrainScene | 0 | Canvas Pointer/OrbitControls，未纳入原生 JSX 按钮计数 |

统计为 207 个静态声明。此表只用于核查扫描范围；新增控件应自动进入 AST 报告。**AST 能查事件绑定，不能证明计算真实性。**

## 2. 本批已核实并处理的断点

| ID | 用户动作 → 实际命令 | 本批前 | 本批后 | 后续仍缺 |
| --- | --- | --- | --- | --- |
| C01 | EXPLORE 点脑区 → `App.selectedId` → 3D/ActivityChart/CellularLab 选区 | EXPLORE 私有 `selectedId`，不同步 | 用 App 的 `selectedRegionId/onSelectRegion`，只选区不假冒脉冲；`aria-pressed` | 真实浏览器点击后验证跨面板读数/视觉 |
| C02 | “用该电流跑 LIF” → `wcToLifCurrentPA` → `simulateLif` → `result` | 只改下拉/电流，下次手动“运行仿真”才算 | 一次点击将映射电流显式传给 `run(overrides)` 并立即计算；解决 React setState 非同步时的旧值 | 物理跨尺度增益尚未经校准 |
| C03 | “用该电流跑 HH” → `wcToHhCurrentDensityUAperCm2` → `simulateHodgkinHuxley` → `result` | 同 C02 | 与 C02 同样直接运行 | 同 C02 |
| C04 | S4–S15“打开实验台” → 导航 | 按钮文案似乎能打开刚跑完的实验 | 显示“进入独立实验台（不载入结果）”；明确不共享此结果；原有数值计算不删 | P0-2/P0-4 要保留整份实验 Session 并带入视图 |
| C05 | ERP “late oddball” → 独立 `runOddballExperiment` → `epochs` → TFR | 仅在小字中介绍，用户可能误以为 EEG/PSD 同步 | 按钮与说明明确：替换 ERP/TFR 试次，不替换 Raw/PSD/地形 | P0-4 必须用来源 ID 约束并消除跨记录混用 |
| C06 | 地形右侧源参数 → `forwardHeadPotential` → SVG 平面点投影 | 视觉标题误称“3D 头皮电位”且与左图共享记录的直觉矛盾 | 明示独立源、独立计算、2D 投影非 3D 场 | P0-4 必须统一源/时间，再增真实可旋转 3D 场 |
| C07 | EEG 分析 footnote | 宣称六 tab 都共用同一记录，忽视 late/右侧地形独立计算 | 明确分支和不同来源 | P0-4 真正统一数据与时钟 |

## 3. 现有路径审计状态（不虚报通过）

| 模块 / 控件类别 | 引擎或求解器 | 当前可确认的反馈 | 归类 | 阻塞性缺口 |
| --- | --- | --- | --- | --- |
| 主 3D 点击、长按、重置 | Rust/WASM `SimClient` → Worker | E/I、响应图与主 3D | LIVE | 事件 Worker ACK/仿真时刻严格性待 P0-2 |
| G/c_ei 参数、单边连接权重、BIAS | WASM 网络引擎 | 主 E/I 与连接面板 | LIVE | 尚未原生接到同一 EEG/ERP/TFR Run |
| 着色、连线显隐、自动旋转、相机 | Three.js | 只改变视觉 | VISUAL | 必须与物理变化明确区分 |
| PLAY/WAVES/EEG/EXPLORE | App 模式 | 导航/显示 | NAV | 模式切换不意味着切换同一实验求解器 |
| 场景 S1–S3 | LIVE 引擎，摘要记录 | 主 E/I/RESPONSE | LIVE | 会话快照和同源记录不足 |
| 场景 S4–S15 | 独立 JR、球形正向、HH 等 | 关键结果数字 | INDEPENDENT | 不自动载入实验台；场景 S7 仅离散电极 |
| HEAD EEG 直播选项 | LIVE E/I 经假设 q，再进球形 lead field | 头部选定电极读数 | DERIVED | TVB 坐标与 HEAD **未配准**，钳制只供演示 |
| HEAD EEG 手动偶极子 | 球形 MNE 预计算模型 | 电极电位 | INDEPENDENT | 不应宣称与主脑同源 |
| LocalBEM 导入 | 用户自行提供模板 | BEM 电极电位 | INDEPENDENT/BLOCKED | 无自带 fsaverage；不保证真实人脑个体校准 |
| EEG“运行实验” | 独立 WC/JR 柱→球形 lead field | Raw、事件、PSD、分段、地形等 | INDEPENDENT | 不是主 LIVE 网络 |
| EEG“从直播推导” | 约 60Hz E/I 快照→250Hz 插值→假设 q | 新记录与衍生视图 | DERIVED | **非 250Hz 原生神经源流**，P0-3；高于快照 Nyquist 的信息缺失 |
| ERP late 按钮 | 独立晚期机制 | Epochs/TFR | INDEPENDENT | 不与当前 Raw/PSD/地形保持同一试验，P0-4 |
| Topo 左图 vs 右图 | 当前记录插值 vs 独立 `Lq` | 两张二维示意图 | DERIVED / INDEPENDENT | 时间和物理源不同；不能对照为同一场 |
| 逆解盲测 vs 当前记录 | `blindTest` / `buildLeadField` | 分别给误差/估计值 | INDEPENDENT / DERIVED | 盲测真源≠当前记录真源，深度偏置未解决 |
| 细胞映射后反向 BIAS | 独立 LIF/HH→ `firingRateToPopulationDriveP` → `SimClient.setBias` | 主 E/I 可以改变 | INDEPENDENT→LIVE | 映射假设，时间轴未严格耦合 |
| TES/TMS Level B/C | 均匀导体解析场 | 电场数值 | INDEPENDENT | 非 SimNIBS FEM；场箭头和真实边界未完 |
| 感觉刺激 | 浏览器计时脉冲→ LIVE 选区 | 主 E/I 可改变 | INDEPENDENT→LIVE | 事件时钟依赖墙钟，P0-2 |
| A/B、回放分叉、PID | 独立 JR 柱 | 数值比较/回放/控制指标 | INDEPENDENT | 不等于 LIVE 全脑 A/B/时间机器 |
| LIVE 阈值闭环 | 浏览器轮询 E 然后 `pulseAt` | 主网络响应 | LIVE（E 控制） | **不是 EEG 闭环**；墙钟不是模型时钟 |
| MNI152/Talairach 检测按钮 | 明确拒绝未注册坐标 | 错误提示 | VISUAL/DIAGNOSTIC | 新手不应接触内部探针，留 P0-6 |

## 4. 有意没有越序解决的问题

- **P0-2**：没有 `runId` 和唯一实验时钟，不能靠一堆组件局部 React state 假装已统一。
- **P0-3**：没有把 60Hz 快照插值的 250Hz 记录冒充采样率合规的原生连续 EEG。
- **P0-4**：没有用文案替换真正的 RAW→Epochs→TFR→Topo/Inverse 同源性。
- **P0-5**：没有将未注册的 TVB 坐标钳制说成真实配准或将跨尺度假设说成机制已证实。
- **P0-6**：未做真人首次使用测试。
- **P1-1 / P1-2**：未补可再分发的人体连接组、FEM 或真机科学验收。

## 5. P0-1 剩余必过门槛

1. **全量语义审计**：用 AST 导出的每个控件清单逐条建立响应对象与模型作用；有可点击却无求解输出的控件必须进入 `VISUAL/NAV/INDEPENDENT` 或禁用。
2. **浏览器 E2E**：至少执行 C01–C07 的真实点击，记录前后状态及跨视图变化，并对错误路径提供截图。
3. **模型时间核对**：异步命令下发时的 ACK、Worker 实际执行时间与图上标记严格一致，归 P0-2。
4. **用户可见结果**：不以测试静态源码包含某个函数名作为因果链通过；至少一条数值变化与视图变化实际观测通过。
5. **绿色门禁**：P0-1 AST 控件覆盖、源代码回归、TS 类型检查、Lint、既有科学方法测试通过。CI 红灯不合并。

后续工作按 P0-2→P0-3→P0-4→P0-5→P0-6→P1-1→P1-2 严格顺序实施；本 PR 不宣称完成后面任何阶段。
