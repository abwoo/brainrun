# PR #5 · fsaverage 真实头部 BEM 验证与本地体验

## 当前结论

**真实 MRI 模板、三层 BEM、电极和解剖脑图谱的物理计算链条已经有独立验证实现。**
但它是 FreeSurfer **fsaverage 平均人脑模板**，绝非某个人的个体 MRI，也没有把现有 76 节点 TVB 示例网络自动注册到这套人类模板。

当前可验证的功能：
- MRI (FreeSurfer fsaverage) → Head RAS 配准，真实头皮、颅骨、脑边界；
- 左右半球各选取 N 个皮层源点，源点记录原始顶点、`aparc` 脑图谱名称；
- 固定电流偶极子三个正交方向，MNE `make_forward_dipole` 配合模板 BEM 计算各电极 lead-field；
- MNE 标准 `10–20` / `10–10` / `10–05`，不是球形投影；
- MRI → MNI305 坐标转换使用 MNE/FreeSurfer 的 `read_talxfm`。输出标为 **MNI305 (mni_tal)**，**不是 MNI152 或真正 Talairach 图谱**；
- 浏览器使用 `gains_uV_per_nAm` 计算电位。源位置**吸附到已离线求解的皮层点**，不对未知位置制造不可靠的插值；
- 轻量化的皮层表面**只用于显示**，而 BEM、源和电极的物理计算仍使用原始位置。

## 数据许可与部署限制（阻塞项）

`fsaverage` 来自 FreeSurfer。此处的模板数据、显示网格、派生正向矩阵仍需要依据 FreeSurfer 数据许可核查再分发范围、保留署名与许可证的义务，以及拟采用的商业/开源发布方式。

**当前策略：**
- 脚本可在 CI 临时环境下载与验证，但不把模型数据上传为 GitHub Artifacts。
- `.local-assets/` 已加入 `.gitignore`，本地生成的解剖资产不提交 Git。
- GitHub Pages 只部署无受限模板文件的普通 BrainRun 和四层球模型。
- 真实 MRI BEM 模式通过本地 JSON 选择器导入，由用户自己决定是否取得和使用相应模板数据。
- **不要**将 `.local-assets/pr5/fsaverage-bem.json` 复制到 `app/public/` 或公开网站，除非已完成并记录第三方许可审查。

权威协议：https://www.freesurfer.net/fswiki/FreeSurferSoftwareLicense

## 可复现本地执行

```bash
python3 -m pip install 'mne==1.11.0' 'nibabel>=5,<6' 'trimesh>=4,<5' 'fast-simplification>=0.1,<1'
python3 scientific/forward/generate_fsaverage_bem.py \
    --download --sources-per-hemisphere 8 --montage 10-20 \
    --display-mesh-faces 12000 \
    --output .local-assets/pr5/fsaverage-bem.json
python3 -m unittest discover -s tests/pr5 -p test_fsaverage_bem_helpers.py -v
python3 -m unittest discover -s tests/pr5 -p test_fsaverage_bem_live.py -v

cd app
npm ci
npm run dev
```

然后打开 BrainRun 主界面：

**HEAD EEG → 进阶：真实 MRI/BEM → 导入本地 BEM 模型**，选择上面生成的 `fsaverage-bem.json`。

如需要更多可点选的源，改用 `--sources-per-hemisphere 64`（仅在确认计算资源和数值验证后）；若需要更密集的电极，改用 `--montage 10-05`。每种组合都需要对其物理结果和端到端浏览器性能重新验收，不能沿用 16 源、19 电极的测试结论。

## 科学正确性与误差

当前分层 BEM 是典型的准静态电磁正向建模，不是 Maxwell 全波/细胞离子通道模型。模型计算量单位：

- 解剖几何、电极位置、皮层源：HEAD RAS，mm；
- 电流偶极矩：nA·m；
- EEG 正向矩阵：µV/(nA·m)；
- 合成 EEG 电位：µV；
- 标准坐标：FreeSurfer/MNE MNI305 (mni_tal)，非 MNI152/Talairach。

验收要求：
1. MRI↔Head 变换、左右半球与坐标单位往返一致。
2. 真实解剖 mesh 非同心球；真实 scalp 位置、三层边界和 cortex 均有有效三角形。
3. 每个电极位置落在可接受的模板头皮近邻范围，不能随意投射到统一球面后声称是 MRI-BEM。
4. 离线 lead-field 与独立新算的 MNE BEM 结果一致。
5. 前端改变真实物理源点、偶极矩方向/强度、参考后，EEG 依照同一正向矩阵改变。
6. 用户拖拽或选择新源点只允许落在已求解点；源空间密度不足时标注限制，不允许假装连续高分辨率。
7. FreeSurfer 派生资产禁止未经审查发布。

## 合并前仍须完成

- **可直接发布的合规解剖资产策略**（许可证/署名/传播条件/商业用途复核）；
- 无需用户手动导入数据的简易体验，且符合前述许可；
- 从 Wilson–Cowan 等神经动力学状态到具单位电流源的**独立验证生理映射**（不是随意乘常数）；
- 对源空间、脑图谱和电极在高密度配置下进一步数值验证；
- MNI152 和 Talairach 的准确区分及经过验证的转换；
- Apple Silicon macOS Chrome/Safari 的 GPU 性能和长时间稳定性测试；
- CHIMERA 级的视觉、手势、无教程探索体验验收。

**合并原则：** 当前所有 green CI 只证明代码已验证的范围。尚未满足全部 PR5 合并门槛，因此继续保持 Draft。
