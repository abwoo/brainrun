# TVB 之外的替代数据源调查（2026-11-11）

用户问题：除了 TVB，还有什么能提供同类数据（皮层网格 + 脑区划分 + 连接矩阵 + 纤维长度）？

## 结论先行

没有“开箱即用、许可干净、直接替换 TVB 三件套”的现成方案。TVB 的三件套是配套的；替代品都是散件——分区、表面、纤维束各有来源，要拼起来、自己聚合成矩阵、再验证。最有希望的组合是 onavg 表面（CC0）+ Schaefer 分区 + Elias 985 人规范连接组（CC-BY）聚合出矩阵，但那是一条新的数据管线，不是换个 URL。

## 候选逐个说

### 1. Elias et al. 2024 规范连接组（最有希望的真人连接组）

- 是什么：985 名 HCP 健康年轻人的多壳扩散数据做的群体平均全脑连接组，MNI 空间，约 1200 万条纤维束，迄今最大。Sci Data 2024, 11:353，doi:10.1038/s41597-024-03197-0。
- 许可：论文本身 CC-BY 4.0；数据在 FigShare 公开可下载，Lead-DBS 上也有现成版本（dTOR-985）。
- 缺什么：给的是纤维束集合，不是现成的 N×N 权重矩阵。要按某个分区（如 Schaefer 100/200 区）聚合成矩阵、算纤维长度，得自己写处理管线并验证。
- 来源：https://pmc.ncbi.nlm.nih.gov/articles/PMC11002007/

### 2. Schaefer 2018 图谱（人类皮层分区）

- 是什么：基于 1489 人静息态 fMRI 的皮层分区，100–1000 区多档，ThomasYeoLab/CBIG 发布。
- 许可：不干净。CBIG 仓库有 MIT 许可（代码层面），但 nilearn 官方页面把图谱数据的许可写成 unknown；AtlasPack 元数据写 MIT。图谱数据本身的再分发许可没有钉死的文件。
- 缺什么：只有分区，没有连接矩阵；矩阵要靠扩散数据 + 纤维追踪另算。
- 来源：https://github.com/ThomasYeoLab/CBIG/tree/master/stable_projects/brain_parcellation/Schaefer2018_LocalGlobal

### 3. onavg 皮层表面模板（最干净的网格替代）

- 是什么：基于 1031 名 OpenNeuro 参与者数据做的开放人脑皮层表面模板，Nature Methods 2024。
- 许可：CC0 1.0，公开可自由用，已进 TemplateFlow（tplonavg）。
- 缺什么：只有表面模板，没有分区、没有连接矩阵。
- 来源：https://github.com/feilong/tplonavg

### 4. HCP（人类连接组计划）原始数据

- 是什么：1200 名年轻成人的高质量多模态数据，金标准。
- 许可/获取：Open Access 数据要注册 ConnectomeDB、同意 Open Access Data Use Terms 才能下载；不能放进公开仓库的 CI 自动下载。衍生数据（如 DSI Studio fiber hub 里的）有 CC BY-SA 4.0 的版本，但原始数据要走 DUA。
- 结论：不适合“公开仓库自动下载”这个用法。

### 5. Brainnetome 图谱

- 是什么：210 皮层 + 36 皮层下分区，基于连接架构的著名人类图谱（Fan et al. 2016）。
- 许可：论文 CC BY-NC（非商业）；图谱本身“免费提供给研究者”，但没有明确的再分发许可文件，NC 限制也在。换它比 TVB 干净不到哪去。
- 缺什么：只有分区，没有现成连接矩阵。
- 来源：http://atlas.brainnetome.org

### 6. OpenNeuro + DSI Studio fiber hub

- 是什么：OpenNeuro 平台数据全部 CC0；DSI Studio 的 fiber hub 有 37,000+ 预处理好的纤维数据集，OpenNeuro 来源的衍生数据按 CC0 分发。
- 缺什么：那是原始扫描或纤维方向数据，要聚合成连接矩阵仍需处理管线；逐个数据集的许可要逐个核对，不能一概而论。

## 如果要换，工作量在哪

1. 选分区（Schaefer 100 区较现实）并拿到它在表面网格上的顶点映射；
2. 拿 Elias 纤维束按分区聚合成权重矩阵 + 纤维长度矩阵；
3. 生成与现有 brain-assets 同格式的 6 个文件，跑 Python/Rust 对照重测；
4. 换了连接组，动力学行为会变：演示预设、G 安全范围、8/75 响应这些数字都要重测，不能沿用；
5. 每一步的许可都要逐个钉死，写进 data-license.md。

审查报告的原建议是“增加一种经过验证的人类连接组作为另一种模型选择”，不是替换 TVB。建议路线：先合 PR1（把 TVB 这边的口径收好），替代数据单独做一个小验证——下载 Elias 纤维束 + Schaefer 分区，聚合出 100 区矩阵跑通 Python 对照，看动力学是否合理，再决定做不做“第二套可选连接组”。
