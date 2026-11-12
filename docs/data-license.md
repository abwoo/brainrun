# BrainRun 数据许可核查（PR1 任务 2）

核查日期：2026-11-11。核查对象：`app/public/brain-assets/` 中的 6 个已提交文件，以及生成它们的上游 TVB 示例数据。核查方法：逐项读上游原文（仓库 LICENSE / README / 数据子目录清单、TVB 官方文档、Zenodo API 元数据、论文原文）与本地原始文件，不依赖二手转述。以下引文均为核查当日实际读到的原文。

## 2026-11-12 复核注记（PR8-C，文档复核，未重新拉取上游）

- **结论无变化：TVB 示例数据再分发许可仍不确定。** 本次复核未发现
  上游许可状态的新信息：未收到 TVB 方面的书面回复（发邮件仍未定，
  等用户拍板），`tvb-data` 仓库仍为已归档状态，构建时生成
  （`fetch.py` 钉死提交 `f1a3e7d` + SHA-256 校验）仍是现行做法，
  衍生资产仍不进仓库。重写公开历史仍未定。
- **fsaverage 派生数据仍不得公开再分发**（FreeSurfer Part B §3 第三方
  权利 + MNE OSF 镜像来源链未核实），见
  `docs/pr5-license-and-zero-config.md`。
- **onavg 零配置替代调查更新**（2026-11-12，见
  `docs/model-spec.md` §13.2）：onavg 模板 CC0 已再次核实
  （TemplateFlow `template_description.json` 的 `"License": "CC0"`）；
  但根目录清单只含球面表面与 dparc 标签，未见 pial/white 表面，
  无头皮/颅骨壳、电极位置与已验证配准，单文件大小未核实
  （DataLad annex 对象）。建议：推进作单独立项小验证，
  不在本批建数据管线、不换网格。
- **GitHub PR #6（另一方 CI 回归门禁 PR）仍开着**，未合并、未关闭，
  等用户定夺；本文件只写状态。

## 结论先行

**不确定。**在 tvb-data 仓库、TVB 官方文档、Zenodo 记录、Sanz-Leon et al. 2013 论文这四处，没有任何一处明确许可“把 TVB 示例数据（或其预处理衍生资产）再分发到另一个公开仓库 / 公开网站”；也没有任何一处明确禁止。现有的 6 个衍生资产处于“无明确授权、靠默认假设在分发”的状态，不能写成“已许可”，也不能写成“已确认不许可”。

## 逐项证据

### E1. tvb-data 仓库根 LICENSE：全文是针对 TVB 软件的 GPLv3，未提及数据文件

- 来源：`https://raw.githubusercontent.com/the-virtual-brain/tvb-data/master/LICENSE`（2026-11-11 实测可读，全文 1263 行）
- 原文关键句（文件头，第 0–17 行）：
  > "TheVirtualBrain is a brain-simulation software. See also http://www.thevirtualbrain.org"
  > "(c) 2012-2019, Baycrest Centre for Geriatric Care ("Baycrest") and others"
  > "This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version."
- 其后是完整的 GPLv3 全文（"GPL_LICENSE.TXT"），以及引用要求：
  > "CITATION: When using The Virtual Brain for scientific publications, please cite it as follows: Paula Sanz Leon, Stuart A. Knock, M. Marmaduke Woodman, Lia Domide, Jochen Mersmann, Anthony R. McIntosh, Viktor Jirsa (2013) The Virtual Brain: a simulator of primate brain network dynamics. Frontiers in Neuroinformatics (7:10. doi: 10.3389/fninf.2013.00010)"
- 判定：全文主语是 "This program" / "TheVirtualBrain … software"，**没有任何一句话说明该许可是否覆盖 `tvb_data/` 目录下的数据文件**。引用要求针对的是“在科学出版物中使用 TVB”，不是数据再分发授权。

### E2. GitHub API 对该仓库的许可判定：Other / NOASSERTION（即未识别出有效许可）

- 来源：`https://api.github.com/repos/the-virtual-brain/tvb-data`（2026-11-11 实测）
- 原文：
  > `"license": {"key": "other", "name": "Other", "spdx_id": "NOASSERTION", "url": null}`
  > `"description": "DEPRECATED: This repository contains demo data for TVB software. Use the Zenodo Copy"`
  > `"archived": true, "default_branch": "master", "created": "2017-05-02T07:52:25Z", "pushed": "2024-10-24T06:20:35Z"`
- 判定：GitHub 的许可证检测器没有把该仓库识别为任何已知许可。结合 E1，GPLv3 文本虽然存在，但检测器未予确认——这本身不是法律结论，但说明“仓库是 GPLv3”这个说法在机器可读层面就不成立，不能拿来当作分发依据。

### E3. tvb-data 仓库 README（README.rst）：只说“供 TVB 使用”，无再分发授权

- 来源：`https://raw.githubusercontent.com/the-virtual-brain/tvb-data/master/README.rst`（2026-11-11 实测全文 60 行；注意文件名是 `README.rst`，不是 `README.md`）
- 原文关键句：
  > "**Using this repository (tvb-data) from Github is now considered DEPRECATED. We advise you to use our Zenodo repository instead: https://zenodo.org/records/10128131**"
  > "Various demonstration datasets for use with The Virtual Brain are provided here."
  > "Here you will find: * compatible file/folder structures that can be uploaded thorugh the web interface of TVB; and * the default datasets used when working in `console` or library mode."
  > "This package should be treated as a regular Python module."
- 判定：全文只描述“下载后在 TVB 里使用”，**没有“可以再分发 / 可以放进你自己的仓库 / 可以公开托管”等表述**。同时确认该仓库已废弃、已归档（archived），指向 Zenodo。

### E4. tvb-data 仓库 setup.py：license 字段同样只写 GPL v3，且指向软件

- 来源：`https://raw.githubusercontent.com/the-virtual-brain/tvb-data/master/setup.py`（2026-11-11 实测）
- 原文关键句：
  > `license="GPL v3",`（第 100 行）
  > 文件头注释与 LICENSE 相同："This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License…"
- 判定：与 E1 同一口径，未单独说明数据。PyPI 上 `tvb-data` 的 license 字段实测也是这份 LICENSE 全文的粘贴，同样没有针对数据的单独声明。

### E5. 数据子目录与本地原始包：没有任何许可文件，数据文件内无任何授权文字

- 来源（2026-11-11 实测）：
  - GitHub API 目录清单：`tvb_data/` 下只有 `__init__.py`（空）与 15 个数据子目录；`tvb_data/connectivity/`、`tvb_data/surfaceData/`、`tvb_data/regionMapping/` 三个相关子目录内只有 `.zip` / `.txt` 数据文件与空 `__init__.py`（surfaceData 另有一个 `surface_fixes.py`），**无任何 LICENSE / README / NOTICE 类文件**。
  - 本地原始包 `scripts/prepare-brain-data/raw/`：`connectivity_76.zip` 内只有 7 个 `.txt`（`weights.txt`、`tract_lengths.txt`、`areas.txt`、`centres.txt`、`cortical.txt`、`info.txt`、`average_orientations.txt`），`cortex_16384.zip` 内只有 3 个 `.txt`；对全部原始文件做全文检索（`licen|copyright|GPL|redistrib|citation`），**零命中**。`info.txt` 全文只有单位说明：`weights_unit = "au"`，`length_unit = "mm"`，`area_unit = "mm^2"`。
- 判定：数据文件本身不携带任何授权信息。`prepare.py` 头部与 `meta.json` 里的 "TVB 数据再分发许可未明确" 与本次核查一致。

### E6. Zenodo 记录 10128131：元数据里 license 字段根本不存在，描述中无再分发说法

- 来源：`https://zenodo.org/api/records/10128131`（2026-11-11 实测，HTTP 200）
- 实测元数据：
  - 标题："tvb-data - Extended Dataset"；版本 2.8.1；发布日期 2023-11-14；DOI `10.5281/zenodo.10128131`；创建者 TVB Team（TVB Foundation）；`access_right: "open"`。
  - **metadata 的全部键名**：`access_right, communities, creators, description, doi, grants, keywords, notes, publication_date, references, relations, resource_type, title, version`——**没有 `license` 键**（用 API 返回的原始 JSON 逐键核对过，不是“值为空”，是字段不存在）。
  - 唯一文件：`tvb_data.zip`，337,115,643 字节，md5 `08ae19833ba8ac158c91fbcb988b9bf0`。
  - 描述全文关键句：
    > "Various demonstration datasets for use with The Virtual Brain project are provided here."
    > "Here you will find: - compatible file/folder structures that can be uploaded through the web interface of TVB. … - the default datasets used when working in `console` or library mode."
    > "More information on TVB documentation site: http://docs.thevirtualbrain.org/ or on the main webpage of the project https://www.thevirtualbrain.org/"
  - 参考文献栏只列出两篇论文（Sanz-Leon et al. 2013；Schirner et al. 2022），无许可声明。
- 判定：Zenodo 这条官方推荐的替代来源**没有给出任何许可证**。`access_right: "open"` 只表示可以公开下载，不等于授予再分发许可。另：该 322 MB 压缩包的内容与 GitHub 上三个小文件是否完全一致，本次未核实（未下载）。

### E7. TVB 官方文档《A Description of a Complete Dataset》：只说“可以使用”，不说“可以再分发”

- 来源：`https://docs.thevirtualbrain.org/manuals/UserGuide/Complete_Dataset_Description.html`（TVB 2.9-18196 文档，2026-11-11 实测全文 934 行）
- 原文关键句（"The TVB demonstration dataset" 一节）：
  > "**DISCLAIMER:** This dataset was custom made and built to serve the purpose of numerically testing the simulator, as well as for theoretical exploration. It does have, however, certain issues with regard to biophysical realism and so it shouldn't be used/relied-upon for that purpose."
  > "The default TVB connectivity is a bi-hemispheric hybrid CoCoMac/DSI matrix."
  > "Weights are primarily CoCoMac – exceptions are colossal connections. These are DSI fibre bundle widths scaled to fill the 0-3 of CoCoMac."
  > "Demo data as described in this chapter, can be found on Zenodo: https://zenodo.org/record/10128131, or inside TVB_Distribution… These demo files can be used together with the GUI and/or the script interfaces, or taken as reference for you, when creating TVB compatible dataset."
- 另：该页 "Other datasets" 一节对 Hagmann 数据明确写 "Permissions: On request to the authors"，对 HCP 数据写 "available after agreeing with the privacy and sharing conditions"——说明 TVB 文档**有在别处写明数据权限的习惯**，但对自家演示数据集这一节**没有写任何权限条款**。
- 判定：文档只授予“在 TVB 里使用 / 作为参考”，没有再分发授权；同时该节确认演示数据集的权重主要来自 CoCoMac（猕猴示踪数据库）加人类 DSI 混合，存在第三方来源。

### E8. Sanz-Leon et al. 2013 论文：正文是 CC BY，但对数据再分发没有任何说法

- 来源：`https://www.frontiersin.org/journals/neuroinformatics/articles/10.3389/fninf.2013.00010/full`（2026-11-11 实测全文）
- 实测结果：
  - 文章本身的许可声明（文末）：
    > "This is an open-access article distributed under the terms of the Creative Commons Attribution License, which permits use, distribution and reproduction in other forums, provided the original authors and source are credited and subject to any copyright notices concerning any third-party graphics etc."
  - 全文检索 "redistribut"：**零命中**；检索 "Data Availability"：**零命中**（2013 年的文章无此栏目）。
  - 文中提到演示数据集两处，均只作描述，无授权表述：
    > "Such details are specific to the connectivity demonstration dataset included in the distribution packages of TVB."
    > "The *Connectivity* upon which the large-scale network is built was the demonstration dataset. It is bi-hemispheric and consists of 74 nodes, i.e., 37 regions per hemisphere."
  - 注意：论文所写的演示数据集是 **74 节点**，而本仓库用的 `connectivity_76` 是 76 节点，版本已有漂移，论文不能直接当作当前文件的授权依据。
- 判定：CC BY 覆盖的是**论文正文本身**，不是数据集；论文对数据再分发只字未提。引用该论文是 TVB 要求的署名义务，不是再分发许可。

## 重点回答：已提交的 6 个衍生资产，再分发是否被许可？

**不确定——没有找到许可依据。** 逐个资产的情况：

| 已提交资产 | 内容实质（按 `scripts/prepare-brain-data/prepare.py` 实测） | 与原始数据的关系 | 再分发状态 |
|---|---|---|---|
| `vertices.bin` | 16384×3 顶点坐标，Float32 LE | TVB 原始坐标**原值重编码，未做任何修改**（prepare.py 文档字符串原话） | 不确定（等同于再分发原始顶点数据） |
| `triangles.bin` | 32760×3 三角形索引，Uint32 LE | 原始索引原值重编码 | 不确定（等同于再分发原始网格拓扑） |
| `regionMap.bin` | 16384 个脑区 id（0–75），Uint8 | 原始映射文件原值重编码 | 不确定（等同于再分发原始映射） |
| `regions.json` | 76 个脑区的 label / centre / area / cortical | `centres.txt`、`areas.txt`、`cortical.txt` 的逐行转录 | 不确定（等同于再分发原始脑区表） |
| `connectivity.json` | 76×76 权重（对角线清零）与长度（仅保留权重 > 0 的边） | 原始权重/长度矩阵的**轻度修改版**：对角元清零、零权重边的长度置 0，其余原值保留 | 不确定（仍是原始矩阵的衍生品，不是独立创作） |
| `meta.json` | 来源 URL、引用、校验小结、许可说明 | 本仓库自己写的元数据，不含 TVB 原始数据 | 本文件本身可分发；但其中 "license_note" 已如实写明许可未明确 |

### 原始数据文件 vs 预处理衍生资产：许可状态没有区别

- **原始数据文件**：`scripts/prepare-brain-data/raw/` 下的三个文件不进仓库（`.gitignore` 已忽略），只在本地使用。这一层目前没有合规问题——下载并在本地使用，是 E3/E7 明确描述的用法（"for use with TVB" / "can be used together with the GUI and/or the script interfaces"）。
- **预处理衍生资产**：6 个文件**不是**独立创作。5 个含数据的资产（除 `meta.json` 外）是对原始数值的逐值转码或轻度筛选：顶点/三角面/映射是原值换格式，连接矩阵只改了对角线与零权重边的长度。按常识，改格式、清对角线不改变“这些数值来自 TVB 演示数据集”这一事实，**不能靠“已经预处理过”绕开原始数据的许可问题**。README 里“原始数据不进仓库，但预处理资产可以进仓库”的做法，**并不自动解决衍生数据的再分发许可问题**（与 `docs/review-2026-11-11.md` 的批评一致）。
- 一个附带的反向核查：即使假设 GPLv3 覆盖这些数据文件，现状也不满足 GPLv3 的要求——GPLv3 第 5、6 条要求分发修改版时附带 GPL 文本、标明修改、并以源码形式提供对应源文件（此处即原始 `.txt` 数据与 `prepare.py`），而 `brain-assets/` 里既无 GPL 文本，也无原始数据。所以“按 GPLv3 分发”这条路目前也是走不通的，**不是**一个可直接援引的合规依据。

### 代码许可与数据许可无关

- 仓库根目录 `LICENSE` 为 MIT（Copyright (c) 2026 abwoo），`NOTICE.md` 已明确“以下第三方内容各有自己的来源与许可，**不在 MIT 代码许可的覆盖范围内**”。MIT 只覆盖本仓库自己的代码，不能用来覆盖 TVB 数据及其衍生资产。

## 不确定之处（逐条）

1. **tvb-data LICENSE 是否覆盖数据文件**：LICENSE 全文只谈 "program"/"software"，无一句提及数据；GitHub 检测为 Other / NOASSERTION。无法确认，也无法排除。
2. **Zenodo 记录为何没有 license 字段**：是上游漏填，还是有意不声明？API 返回的 metadata 里根本没有该键，无法从元数据推断。
3. **Zenodo 322 MB 压缩包与 GitHub 三个小文件是否同一内容**：未核实（未下载 322 MB 包）。若后续改从 Zenodo 取数，须先核对。
4. **上游数据的第三方权利**：演示数据集权重主要来自 CoCoMac（猕猴示踪数据库），胼胝体连接是人类 DSI 数据缩放填入的混合矩阵（E7 原文）。即使 TVB 本身同意再分发，CoCoMac / Hagmann 等原始来源是否另有条件，本次未核查到。
5. **“在 TVB 里使用”是否隐含“可在自己的公开演示里托管衍生数据”**：TVB 文档与 README 都只写了“使用”，没有写“再分发”。把“能下载使用”等同于“能公开再分发”，是没有文本依据的推断。
6. **论文 74 节点 vs 当前 76 节点**：Sanz-Leon 2013 描述的演示数据集是 74 节点，`connectivity_76` 是后续版本；论文的任何表述都不能直接套用到当前文件上。
7. **构建时生成是否彻底解决问题**：见下节推荐路径末尾的诚实说明——构建时生成解决的是“仓库里存着衍生数据文件”这一层；公开站点仍会向访问者提供这些衍生字节。彻底解决仍需上游的书面确认。
8. **本核查不是法律意见**：以上是基于公开文本的许可核查，不是律师意见。如需对外承担合规责任，应以 TVB 方面的书面回复或专业法律意见为准。

## 推荐路径：把衍生资产生成移到构建时

**首选推荐：不再提交衍生资产，改为在 Pages workflow 里下载 TVB 数据并跑 `prepare.py` 生成。** 理由：

- 它消除的是审查报告指出的具体问题——公开仓库里存着 TVB 衍生数据文件。
- 它不需要上游先表态，今天就能做；同时保留向 TVB 索取书面确认这条并行路径（见“需要用户拍板的事”第 3 条）。
- 它已被验证可行（见下文“本地验证”第 1 条的实测结果）。

### 可行性实测（2026-11-11，已在 /tmp 沙箱中验证，未动仓库文件）

1. **按提交哈希钉死的下载地址能取到与本地完全一致的原始文件**：从 `https://raw.githubusercontent.com/the-virtual-brain/tvb-data/f1a3e7dc5370158df721f206c9c9bfad55d98172/tvb_data/…`（`f1a3e7d` 为 tvb-data 仓库当前 HEAD，仓库已归档、不会再变）下载三个文件，SHA-256 与本地 `raw/` 文件逐字节一致：
   - `connectivity_76.zip`：`8b856d5fa80a8593e01dc18b95efff829ca98d2daf43cea38fd3309fed726b2e`
   - `cortex_16384.zip`：`e07db0106a71313a2ef1948271c1ce84297b73745869d9f2f7a1e1719dcb2973`
   - `regionMapping_16k_76.txt`：`e108b01017bfc4f8c3c0cedde711b2f54d18b7c05b232e297ba9d4b9528283a0`
2. **用这三个文件跑 `prepare.py`，生成的 6 个资产与仓库已提交的 6 个文件逐字节一致**（`vertices.bin`、`triangles.bin`、`regionMap.bin`、`regions.json`、`connectivity.json`、`meta.json` 全部 IDENTICAL）。说明构建时生成是确定性的，改完后线上效果不变。
3. `prepare.py` 目前**没有下载逻辑**：原始文件缺失时直接报错退出（`缺少原始文件: … (请先下载, 见本脚本头部 URL)`）。所以 workflow 里必须先有下载步骤，不能只加一行跑脚本。

### 精确改动清单（只写清单，本次未动手改）

**1. 新增 `scripts/prepare-brain-data/fetch.py`（新文件）**

- 作用：下载三个原始文件到 `scripts/prepare-brain-data/raw/`，并做 SHA-256 校验，任一失败即非零退出。
- 内容：复用 `prepare.py` 里已有的三个 URL 常量，但把分支从 `master` 改为钉死的提交 `f1a3e7dc5370158df721f206c9c9bfad55d98172`（仓库已归档，该提交即 HEAD，不会漂移）：
  - `https://raw.githubusercontent.com/the-virtual-brain/tvb-data/f1a3e7dc5370158df721f206c9c9bfad55d98172/tvb_data/connectivity/connectivity_76.zip`
  - `https://raw.githubusercontent.com/the-virtual-brain/tvb-data/f1a3e7dc5370158df721f206c9c9bfad55d98172/tvb_data/surfaceData/cortex_16384.zip`
  - `https://raw.githubusercontent.com/the-virtual-brain/tvb-data/f1a3e7dc5370158df721f206c9c9bfad55d98172/tvb_data/regionMapping/regionMapping_16k_76.txt`
- 校验值就用上面实测的三个 SHA-256。下载源说明：优先用 GitHub raw（文件小、已验证与本地一致）；Zenodo 的 322 MB 包暂不采用，因其内容与 GitHub 小文件的一致性尚未核实（不确定之处第 3 条）。
- 依赖：Python 3 标准库即可（`urllib` + `hashlib`），不要引入新依赖。

**2. 改 `.github/workflows/deploy-pages.yml`（只改这一处 workflow）**

- 在现有的 "Build WASM engine" 步骤之后、"Setup Node.js" 之前（或 "Build for Pages" 之前任意位置，只要在 Vite 构建之前）插入三个步骤：
  1. `Setup Python`：`actions/setup-python@v5`，`python-version: "3.12"`。
  2. `Install data-prep dependencies`：`pip install numpy`（`prepare.py` 唯一非标准库依赖）。
  3. `Generate brain assets (build-time)`：`python3 scripts/prepare-brain-data/fetch.py && python3 scripts/prepare-brain-data/prepare.py`。
- 原理：`prepare.py` 把资产写进 `app/public/brain-assets/`，Vite 构建时自动把 `public/` 内容复制进 `app/dist/`，后续 "Upload Pages artifact" 步骤无需改动。前端代码 `app/src/lib/brainData.ts` 从 `${BASE_URL}brain-assets/…` 取数，**不需要改任何应用代码**。
- 不改触发条件、不改权限、不改其余步骤。

**3. 从 git 跟踪中移除 6 个已提交资产（一个 PR 里的 `git rm` 操作）**

- 执行：`git rm app/public/brain-assets/vertices.bin app/public/brain-assets/triangles.bin app/public/brain-assets/regionMap.bin app/public/brain-assets/regions.json app/public/brain-assets/connectivity.json app/public/brain-assets/meta.json`（`meta.json` 也是 `prepare.py` 的生成物，构建时会重新生成，不单独保留）。
- 注意：这只让后续提交不再包含这些文件；**已公开的 git 历史里它们依然存在**。如需彻底抹除历史记录，须另做历史重写（`git filter-repo` 等），默认不建议（公开仓库重写历史成本高、且线上站点仍在提供这些字节），见“需要用户拍板的事”第 4 条。

**4. 改 `.gitignore`**

- 新增一行：`app/public/brain-assets/`（与现有的 `scripts/prepare-brain-data/raw/` 同一逻辑：构建时产物不进仓库）。
- 同步修改文件末尾的注释块：删掉 "Kept in the repo on purpose … `app/public/brain-assets/` (processed TVB assets …)" 这一段，改为说明该目录由 CI 构建时生成、本地开发用 `fetch.py` + `prepare.py` 生成。

**5. 改 `scripts/prepare-brain-data/prepare.py`（只改文档字符串与 `meta.json` 文案，不改处理逻辑）**

- 文件头文档字符串：把“输出（浏览器可直接用的轻量资产，放 app/public/brain-assets/）”改为“构建时生成的轻量资产（CI 里由 fetch.py 下载原始文件后生成，不提交进仓库）”；把“许可”一段的表述改为与本文件一致："TVB 数据再分发许可未明确（见 docs/data-license.md）；原始文件与衍生资产均不在仓库中，构建时下载并生成"。
- `meta.json` 的 `license_note` 字段：改为同样表述，并保留引用（Sanz-Leon et al. 2013）与来源 URL。
- 不改任何数值处理、校验逻辑与输出格式（否则上面验证过的“逐字节一致”失效）。

**6. 改 `docs/model-spec.md` §7（数据许可与引用）**

- 把现状描述改为与本文件一致：结论仍是“未明确”，但处理方式改为“构建时下载并生成，不再提交衍生资产”；删掉“前端资产 `app/public/brain-assets/` 只放预处理生成的轻量二进制/JSON”这句与新做法矛盾的表述；加上指向本文档的链接（`docs/data-license.md`）。

**7. 改 `README.md`（两处）**

- “许可”一节：把“本仓库只收录预处理后的轻量资产，原始数据文件不进仓库”改为“原始数据与预处理衍生资产均不进仓库，构建时下载并生成（见 `docs/data-license.md`）”；保留“公开使用前请自行确认数据许可”。
- “数据准备”一节（提到 `python3 scripts/prepare-brain-data/prepare.py` 的地方）：补充说明先跑 `fetch.py` 下载原始文件（或 CI 自动完成），本地开发的完整命令。

**8. `app/src/lib/brainData.ts`（可选，只改注释一行）**

- 文件头注释补一句：“资产由 CI 构建时生成，不提交进仓库。”不改任何代码逻辑。

### 本地验证（实施者按顺序执行）

1. 在干净的工作区执行：`rm -rf app/public/brain-assets scripts/prepare-brain-data/raw && python3 scripts/prepare-brain-data/fetch.py && python3 scripts/prepare-brain-data/prepare.py`，然后对 6 个生成文件逐个算 SHA-256，与 main 分支上的已提交文件比对，**期望 6/6 逐字节一致**（2026-11-11 已在沙箱中验证过一次，结果为 6/6 IDENTICAL）。
2. `cd app && npm run build:pages`，确认 `app/dist/brain-assets/` 包含 6 个文件且大小与原提交一致；`git status` 应显示 `app/public/brain-assets/` 被忽略、无新增跟踪文件。
3. 推分支开 PR，看 Pages workflow 全绿；合并后在云端浏览器打开 `https://abwoo.github.io/brainrun/`，确认大脑渲染、点击 lAMYG 波形尖峰、RESET 均正常（与 Phase 5 验收同一标准）。
4. 验证失败回退：若 workflow 里下载失败（上游不可达），构建应直接失败而不是静默缺资产上线——`fetch.py` 非零退出即能保证这一点；不要加 `continue-on-error`。

### 关于推荐路径的诚实说明

构建时生成解决的是**仓库再分发**这一层：公开仓库里不再存有 TVB 衍生数据文件，任何人 clone 仓库都拿不到这些字节。但它**不改变**公开站点向访问者提供这些衍生字节的事实，也不创造出一个上游许可。彻底消除不确定性只有两条路：拿到 TVB 方面的书面确认，或换用许可明确的替代数据。构建时生成是今天就能做的、风险最低的中间态，不是终点。

## 需要用户拍板的事

1. **是否采纳“构建时生成”路径**（上节清单）：采纳则按清单开 PR；不采纳则现状（公开仓库继续托管 6 个无明确授权的衍生资产）保持不变。
2. **下载源**：默认用 GitHub raw 钉死提交 `f1a3e7d`（已验证与本地一致）；如坚持用官方推荐的 Zenodo，需先下载 322 MB 包并核对内容一致性，工作量另计。
3. **是否并行向 TVB 索取书面确认**：发邮件至 `tvb.admin@thevirtualbrain.org`（setup.py 里的作者邮箱），问清两点——(a) `tvb-data` 的 GPLv3 是否覆盖数据文件；(b) 是否允许将预处理衍生资产放在公开仓库与公开网站上分发。拿到书面回复后，本文件与 `NOTICE.md` 再更新一次结论。
4. **已公开历史是否处理**：6 个资产已在公开 main 分支与已部署的 Pages 站点上存在过。默认只做“后续不再提交”（不清历史）；如要求彻底抹除，须重写公开历史并重新部署，另行决定。
5. **本核查的结论口径**：对外统一写“TVB 示例数据再分发许可未明确，衍生资产构建时生成、不进仓库”，不要写成“已获许可”或“已确认侵权”。
