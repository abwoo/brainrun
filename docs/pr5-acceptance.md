# PR5 · 物理核心合并门槛（实时审查清单）

**状态：Draft / Partial.** 本文件区分已通过自动化验证的物理基线与未完成的完整首批目标。仅有科学数值测试通过，不能视为 PR5 全部完成。

## 当前已交付

| 模块 | 当前能力 | 重要限制 |
| --- | --- | --- |
| 无限均匀导体解析正向模型 | 偶极子位置/方向/强度/导电率/参考，12 示例传感器电位；浏览器 3D 拖动 | 无任何头部边界；不是 BEM/人体 EEG |
| MNE 四层球形头正向模型 | 头部同心分层脑组织/CSF/颅骨/头皮；MNE 1.11 make_forward_dipole；真实物理 lead-field | 球体并非 MRI 模板解剖形状 |
| 标准电极方向 | MNE standard_1020 / standard_1005；10-20 基础 19、扩展 10-10 94、10-05 343 | 对原始 head-space 坐标做**球面径向投影**，非原始实测或个体电极坐标 |
| 源位置与单位 | HEAD RAS 毫米；球心 MNE HEAD 坐标 [0,0,40] mm；矩 nA·m；电位 µV | 未经 MNI 或 Talairach 配准；与 TVB 76 区皮层**不对齐** |
| 网格与运行时 | [-48,-16,16,48]^3 mm 64 个源位置 × 3 方向；MNE 离线算矩阵、浏览器三线性插值 | 源不能拖出支持域；非每帧在线 BEM 求解 |
| 参考选择 | 球形头实际电极平均参考或无限远参考 | 仅模拟电位，不是设备采样信号 |
| 跨空间转换 | 显式头坐标→球心坐标、带出处的 4×4 仿射变换工具 | 没有证据时拒绝任意 tvb ↔ head ↔ MRI ↔ MNI ↔ Talairach 转换 |
| 自动化 | 数值、球形导体 MNE 独立对照、浏览器交互、类型、Lint、截图 | 浏览器目前是 SwiftShader，非 Apple Silicon GPU 验收 |

## MNE 模型复现方法

```bash
python -m pip install mne==1.11.0
python scientific/forward/generate_sphere_model.py
python -m unittest discover -s tests/pr5 -p 'test_sphere_model.py' -v
node --experimental-strip-types --test tests/pr5/volume-conduction.test.mjs
node --experimental-strip-types --test tests/pr5/sphere-forward.test.mjs
node --experimental-strip-types --test tests/pr5/coordinates.test.mjs
```

生成的文件 `app/public/forward-assets/sphere-model.json` 是构建产物，不提交到 Git。GitHub Pages workflow 会在打包前生成它。

**验证方法：**
- MNE 重新求解选定网格节点，与已保存矩阵比较（量纲、坐标、方向）。
- 六个离网格位置，以直接 MNE 求解为真值，三线性插值的相对 L2 误差必须 **小于 3%**（指定测试空间内）；该误差不是完整源空间的全域上界。
- 检验幅度线性、极性翻转、独立参考选择、接近网格边界的连续性、输入异常、传感器空间位置和标准电极命名。
- 浏览器检测真正的数值变化、恢复和 3D 拖动。

## **PR5 完整合并前仍需解决的阻塞事项**

- [ ] **真实人类解剖几何：** 不再把球形皮层/颅骨称作实际解剖；使用明确授权、来源和版本的可视化头皮、颅骨、皮层表面数据。
- [ ] **统一物理几何与源空间：** 真实网格、电极、源和连通图谱的同一坐标系及左右方向已验；没有把 TVB 混合跨物种示例连接映射到标准人类 MRI 而未配准。
- [ ] **真实头部 BEM（或等价、独立验证的 FEM）：** 与 MNE 的参考解进行数值对照，不只依赖球形正向模型。
- [ ] **真实模板 EEG 电极：** 在对应头皮网格上验证 10-20/10-10/10-05 的投影与位置，限定准确度；不能将球面投影宣称为原始电极位置。
- [ ] **图谱与坐标：** 至少一种有可靠授权与模板对应的人类脑图谱；HEAD/MRI/MNI/Talairach 转换若不可验证，应禁用而不是伪造；Talairach 必须标明近似和适用性。
- [ ] **神经模型到源的有依据映射：** Wilson–Cowan E/I 是无量纲群体状态，必须经过有来源的生理源模型与参数校准，或将独立偶极子实验清晰标为教学仿真。
- [ ] **直接操纵真实 3D 头部的完整链条：** 拖动源→正向计算→10-20 等实际电极→数值/地形更新的端到端浏览器验收。
- [ ] **发布许可与可复现数据获取：** 处理 fsaverage / MNE 模板等素材的分发条款；未经确认不得重新分发衍生数据。此前 TVB 示例数据的许可不确定性仍需遵照 PR1 处理。
- [ ] **真实硬件/浏览器测试：** macOS Apple Silicon Chrome/Safari、长时间交互稳定性、GPU 帧率、移动触控与无障碍操作。
- [ ] **回归测试：** 当前 main 已合并的 PR1–PR4 测试集必须在完整版本上再次通过。

**重要科学边界：** 即使未来 BEM 正向计算与源定位均工作，也不意味着获得了真实人类认知功能的高保真模拟。PR5 主要保证正向电生理的几何和物理计算链条真实、可追溯。

## 合并政策

**仅当以上阻塞项全部有源码、独立测试、数据授权和交互证据，才将 PR #5 从 Draft 标记为 Ready for Review。** 不因为小模型正确、演示可玩或 CI 绿色，就提前声称首批全部完成。

