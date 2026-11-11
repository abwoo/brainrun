# PR5 · fsaverage 模板、模型衍生文件与零配置发布：许可证证据清单

**状态：未完成发布级合规核查。不得将此文件视为法律意见或对商业分发的正式许可。**

## 一、目前能从官方许可确认什么

官方 [FreeSurfer Software License Agreement (2011)](https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferSoftwareLicense) 的 Part B 第 1–4 条，对其涵盖的软件和数据授予在遵守条件时使用、复制、修改、展示和分发的许可。其明确要求包括：

- 完整包含并适用其 Part B 许可条件及指定的开头告知措辞；
- 保留版权、署名、许可标记；修改版本必须明确标注，不得冒充原版；
- 如包含第三方著作权/其他许可证，发布者必须自行取得必要的授权并告知最终用户；
- 禁止将科研/模型演示当作经 FDA 批准的临床用途。

**因此不能简单声称 FreeSurfer 派生数据一律“禁止发布”或“仅限非商用”。** 但上面的主体许可也不能自动替代 fsaverage、MNE 下载档、含第三方 MRI 数据的各自许可核对。具体模板来源、贡献者和数据条款应随实际下载包逐项检查。

参考官方文本：
- [FreeSurfer Software License Part B §1–4](https://surfer.nmr.mgh.harvard.edu/fswiki/FreeSurferSoftwareLicense)
- [FreeSurfer GitHub 授权声明](https://github.com/freesurfer/freesurfer)

## 二、BrainRun PR5 数据和程序清单

| 组件 | 生成来源 | 当前传播策略 | 发布前需核实 |
| --- | --- | --- | --- |
| TypeScript/Rust/测试代码 | 本仓库自研 | 随源代码发布 | 现有开源依赖条款 |
| MNE 1.11 Python 正向求解器 | mne-tools | 通过 pip 安装 | MNE 许可证、依赖 |
| 四层球形正向矩阵 | 由 MNE 解析计算、无 MRI 数据 | GitHub Pages 生成 | 代码与数值来源说明 |
| fsaverage 模板三层 BEM | MNE 下载的 FreeSurfer 派生 MRI 几何 | 暂时仅 CI 临时环境、本地 | 精确数据来源与第三方条款、许可通知 |
| fsaverage 皮层网格（轻量化） | 原始 cortical mesh 的几何处理 | 暂时本地 | 是否属于应附条件的衍生数据 |
| `aparc` 标签 | fsaverage FreeSurfer 分区 | 暂时本地 | 原数据作者和模板条款 |
| BEM lead-field | 真实 MRI/BEM 与电极导体参数推导 | 暂时本地 | 衍生资产权益、数值来源说明 |
| 原有 TVB 76 节点演示连接 | tvb-data 数据 | 按需下载，不直接并入 BEM | 既有 GPL/数据条款与跨物种科学有效性 |

## 三、真正低门槛的合法发布目标

目标是**用户打开应用即可操作真实 3D BEM**，不必先安装 MNE、执行 Python、下载数百 MB 模板、手动导入 JSON。

应优先审查两条工程路径，并为最终选择建立自动化许可/来源守卫：

1. 若完整模板来源明确允许公开再分发：仅发布压缩、轻量化且附带适当许可和署名的必要网格与 BEM lead-field；在用户点击“真实 MRI/BEM”后延迟加载，避免默认首屏过重。
2. 若某些来源的二次分发仍无可靠权利证据：保留云端/本地生成和按需取得路径；拒绝在 GitHub Pages 直接打包无法确认的来源数据，也不应自动暗中转发第三方文件。

不应利用“只发布衍生矩阵”“只公开预生成截图”“改名 fsaverage”来规避许可核查。

## 四、PR5 真实科学验证与用户体验仍需权衡

- 128 点源、343 电极仅为高密度**验证配置**，并不等于任意皮层位置具备 BEM lead-field。
- 更密集位置的存储、体积、加载时延、数值误差与高速交互需要新的基准。
- 局部 Wilson–Cowan→nA·m 耦合系数依然是公开假设，尚未受人体 EEG/MEG 标定。
- MNI305 与 MNI152/Talairach 必须分开标注；未经可靠变换不得合并脑图谱。

## 合并判断

在完成真实模板的**来源、许可条款、引用、分发方式、版本与实际产物**核验之前，PR5 不应自行把 `.local-assets` 内容加入公开部署；许可审查完成后应重新决定技术路径，而不是把“用户自行导入”永久当成低门槛最终体验。
