# PR6 · 时频 / 地形 / 源定位（PR-10/11/12，B3）

> 状态：方法学测试通过（TS 16/16、Python 10/10），`npx tsc -b`、`npm run build`、
> `npm run lint`（0 errors）通过。完整回归、浏览器全套、布局扫查、性能、
> 五维验收、十个演示推迟到 PR8 之后（2026-11-11 22:57 测试节奏新规）。
> 分支 `pr6-eeg-analysis`，base main `f0d5087`。

## 0. 一句话结论

- PR-10：STFT / Morlet / multitaper 三种方法各算出 ERSP（dB）与 ITC；
  multitaper ERSP 的小规模逐点对照已补（A1 残留项），TS 与 Python 逐点一致；
  三种方法的结果不直接混比——同一份 ERP 数据，Morlet 10 Hz 峰值 3.36 dB、
  STFT 5.37 dB，本来就不一样。
- PR-11：2D 地形是球面样条插值（Perrin 法），3D 头皮电位是 345 个传感器
  位置的正向计算值（L·q，无插值）；两张图在 UI 上分开展示并写清来源差异。
- PR-12：偶极子拟合无噪声、源在网格点上时精确恢复（误差 0.0 mm）；
  MNE 最小范数逆解（无深度加权）是差的峰值定位器——深部/切向源峰值误差
  32–64 mm（无噪声）乃至 ~100 mm（0.5 µV 噪声），只有表浅径向源能准确定位。
  这是最小范数估计的深度偏置，不是正向模型的错。

## 1. PR-10 时频：ERSP 与 ITC

实现：复用 A1 的 `app/src/lib/signalProcessing.ts`（`erspItc`），本批不另写
时频算法。UI 在 `app/src/components/TfrTab.tsx`。

### 1.1 方法与参数

| 方法 | 参数 | 口径 |
| --- | --- | --- |
| STFT | nFft = min(256, epoch 长的 2 的幂)，hop = nFft/2，周期 Hann 窗 | 功率 µV²（纯正弦幅值 A 在中心频率处 = A²/2） |
| Morlet | cycles = 5，σ_t = cycles/(2πf)，±3σ 截断，FFT 卷积 | 同上 |
| multitaper | NW = 4、K = 7 锥，窗长 = 7 个周期（低频窗可能长于整个 epoch） | 同上 |

- ERSP = 10·log10(试次平均功率 / 基线功率)，基线为 `baselineMs` 窗内
  试次平均功率的时间均值（逐频率），单位 dB；ITC = |试次平均 e^(iφ)|，
  无量纲 0–1。
- 频率网格（UI）：2–40 Hz（2, 4, …, 40 共 15 点）；频段功率随时间用
  Morlet（cycles = 5）逐试次算功率、频段内平均、试次平均，单位 µV²。
- 三种方法的功率口径同为 µV²，但窗长与泄漏特性不同，**结果不直接混比**：
  同一份合成 ERP（Pz，6 试次），10 Hz ERSP 峰值 Morlet 3.36 dB、
  STFT 5.37 dB、multitaper 3.45 dB。UI 写清当前方法与参数。

### 1.2 对照表

| 对照 | 结果 |
| --- | --- |
| multitaper ERSP 小 fixture（3 试次 × 128 采样，频率 [5, 10, 20, 40] Hz）TS vs Python 逐点 | ERSP 1e-6 dB、ITC 1e-9 内一致（`tests/pr6/tfr-topo-inverse.test.mjs`）；Python 侧新鲜度由 `test_tfr_topo_inverse.py` 卡住 |
| 20 Hz 突发形态（小 fixture，t ≥ 0 才出现） | 刺激后 100–300 ms ERSP 均值 +5.73 dB、ITC 均值 1.000（Python 实测；TS 同值，逐点对照已含） |
| beta 带（13–30 Hz）功率随时间（小 fixture，Morlet） | 刺激后 100–300 ms 均值 / 基线均值 = 19.1 倍 |
| STFT / Morlet / multitaper 在 ERP fixture 上 | 各自 ERSP 有限、ITC ∈ [0, 1]、10 Hz 峰值均 > 1 dB（bump 存在）；STFT 与 Morlet 峰值差 2.01 dB（> 0.5 dB，不断言相等） |
| morlet / stft ERSP vs Python fixture | A1 已做（`signal-processing.test.mjs`），本批不重复 |

### 1.3 A1 残留项已补

multitaper 分支的 ERSP 此前两边各写了一份、只验了自洽，未做 TS↔Python
逐点对照。本批补了一个小规模 fixture（`tests/pr6/fixtures/
multitaper-ersp-small.json`，3 试次 × 1 通道 × 128 采样，−200..308 ms），
小是有意的：multitaper TFR 两边都是逐点卷积实现，全尺寸 epoch 做逐点
对照太慢；对照本身仍是逐点、容差 1e-6 dB，没有放宽。
信号设计：20 Hz 正弦突发（t ≥ 0 才出现）+ 白噪声（seed 11），每试次
相位相同。注意两点解读陷阱（已写进测试注释）：基线窗内 ERSP 均值不为 0
（log 均值 ≠ 均值的 log，加上窗边缘效应，20 Hz 基线均值 −4.12 dB，
两边同公式故逐点一致）；5/40 Hz 也有正 ERSP（突发起始沿的宽带泄漏，
不是 20 Hz 的频率特异性）。

### 1.4 残留缺口

- 区域选择（时间–频率窗平均 ERSP/ITC）只在 UI 里实现，未进方法学测试
  的逐点对照（算法就是窗内平均，测试覆盖了底层 ERSP 的逐点正确性）。
- ERSP 的 Python 对照目前只覆盖 multitaper 小 fixture 与 A1 的
  morlet/stft 全尺寸 fixture；STFT 在长记录上的边界效应（两端半窗为零）
  与 A1 文档一致，未另做新测试。

## 2. PR-11 地形：2D 插值 + 3D 正向头皮电位

实现：`app/src/lib/topography.ts`；Python 对照：
`scientific/eeg/inverse_reference.py`（同公式实现）；UI 在
`app/src/components/TopoTab.tsx`。

### 2.1 方法与参数

**2D 地形——球面样条插值（Perrin et al. 1989, 1990），明确标注为插值。**

- 核：G(x) = (1/4π)·Σ_{n=1}^{7} (2n+1)/(n⁴·(n+1)⁴)·P_n(x)，x = cos(夹角)；
  样条阶数 m = 4，Legendre 截断 n ≤ 7，正则化 λ = 1e-5。
- 解 [G+λI, 1; 1ᵀ, 0]·[C; c0] = [V; 0]，约束 ΣC_i = 0（无整体漂移）。
- 网格：头顶俯视图单位圆（x = X/R，y = Y/R，R = 95 mm；+X 向右、+Y 向前），
  25×25 网格、只保留单位圆内点（441 点）。
- λ = 1e-5 是平滑样条：电极点上的复现误差 = λ·|C_i|，实测最大 1.03e-2 µV
  （电极值范围 −0.73–0.77 µV）。这是有意行为，不是求解错误——
  直接重算增广方程组的残差为 5.5e-15。测试断言电极点误差 ≤ 0.02 µV。
- 网格值不离谱外推：实测网格范围 −0.73–0.82 µV，电极值范围外扩 ≤ 0.1 µV
  （测试断言）。

**3D 头皮电位——正向计算值，345 个传感器位置，无插值。**

- `forwardHeadPotential`：对 fixture 全部 345 个传感器位置做 V = L·q
  直接求值（`interpolateSphereGain`，源位置的三线性插值是球形正向模型
  本身的已有行为，不是本模块在电极之间插值）。
- 参考：average 减 345 点均值（注意：不是只减所选导联的均值）、
  infinity 不变、electrode 减指定电极的值；与 `sphereElectrodePotentials`
  同口径。实测：infinity 参考下与 `sphereElectrodePotentials`
  （10-05 子集）逐点差 0.00e+0；average 参考下 345 点均值为 0（< 1e-12）。
- UI 的 3D 面板源由 tab 内控件给定（默认 [0, 0, 16] mm、Y 向 10 nA·m），
  与 2D 图的记录数据无关——两张图的数据来源本来就不一样，不要混读。

### 2.2 对照表

| 对照 | 结果 |
| --- | --- |
| 球面样条网格（19 导，源 [16,16,16] mm、矩 [0,10,5] nA·m）TS vs Python 逐点 | 441 点，1e-9 内一致 |
| 样条在电极点上复现 | TS 与 Python 各自最大误差 ≤ 0.02 µV（实测 1.03e-2 µV） |
| 正向头皮电位 vs `sphereElectrodePotentials`（10-05，infinity） | 343 个共有传感器逐点差 0.00e+0 |
| `topoAtTime`（记录时刻取最近采样点） | 电极值与输入记录一致（1e-12），`forwardValues` 为空（2D 图没有正向值） |

### 2.3 残留缺口

- 2D 图只画俯视图（单位圆）；没有 3D 头皮曲面渲染（Three.js 场景由
  HeadSphereLab 负责，本 tab 只画 345 个传感器位置的俯视散点）。
- 插值网格分辨率固定 25×25，未做自适应加密；电极数 > 100 时样条求解
  为 (n+1)³ 量级（343 导约 4×10⁷ 次运算，一次性，可接受，未做性能测试）。

## 3. PR-12 源定位：偶极子拟合 + MNE 逆解

实现：`app/src/lib/sourceLocalization.ts`；Python 对照：
`scientific/eeg/inverse_reference.py`（numpy 同公式 + MNE
`make_inverse_operator`/`apply_inverse` 峰值交叉验证）；UI 在
`app/src/components/InverseTab.tsx`。

### 3.1 方法与参数

| 项 | 值 |
| --- | --- |
| 正向模型 | PR5 MNE 四层球形头 lead-field，64 点源网格（轴 [−48, −16, 16, 48] mm），增益 µV/(nA·m) |
| 偶极子拟合 | 64 网格点逐个最小二乘（3 分量矩），取残差 RMS 最小者；法方程加相对脊 1e-12·trace/3 防奇异 |
| MNE 逆解 | s = Lᵀ(LLᵀ + λ²σ²I)⁻¹V，源先验 R = I（**无深度加权**），噪声协方差 C = σ²I；λ² 默认 1/9（MNE 默认 SNR = 3），σ 默认 1.0 µV |
| 峰值位置 | 各网格点 \|s\| 最大者；分布范围 spread = 以 \|s\|² 为权重的、到峰值点的 RMS 距离（mm） |
| 参考 | lead-field 列与数据用同一参考（默认 average）；average 对列做“减该列在所选导联上的均值”，与 `sphereElectrodePotentials` 同口径；参考不一致时拟合残差显著变大（测试断言：> 0.05 µV） |
| 盲测 | 真值只用来合成数据与事后算误差；`dipoleFit` / `mneInverse` 签名里没有真值参数（测试用形参数量卡住）；噪声用 mulberry32 + Box–Muller（TS）/ numpy（Python），两边 RNG 流不同，有噪声配置不逐点比、各自报告 |

### 3.2 盲测表现表（Python，numpy RNG seed 7；TS 同配置的噪声数见 §3.3）

真源矩均为 10 nA·m 单方向；λ² = 1/9、σ = 1.0 µV（除注明外）。

| 导联 | 真源（mm） | 噪声 | λ² | 偶极子误差 | 偶极子残差 | MNE 误差 | MNE 分布范围 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 10-20 | [−16,−16,−16] | 0 | 1/9 | 0.0 mm | 0.000 µV | 55.4 mm | 78.1 mm |
| 10-20 | [−16,−16,−16] | 0.5 µV | 1/9 | 55.4 mm | 0.316 µV | 96.0 mm | 88.4 mm |
| 10-20 | [−16,−16,−16] | 0.5 µV | 0.01 | 55.4 mm | 0.316 µV | 96.0 mm | 99.4 mm |
| 10-20 | [48,48,48] | 0 | 1/9 | 0.0 mm | 0.000 µV | 0.0 mm | 56.8 mm |
| 10-20 | [48,48,48] | 0.5 µV | 1/9 | 32.0 mm | 0.364 µV | 0.0 mm | 75.3 mm |
| 10-20 | [48,48,48] | 0.5 µV | 0.01 | 32.0 mm | 0.364 µV | 0.0 mm | 77.0 mm |
| 10-10 | [−16,−16,−16] | 0 | 1/9 | 0.0 mm | 0.000 µV | 55.4 mm | 79.7 mm |
| 10-10 | [−16,−16,−16] | 0.5 µV | 1/9 | 32.0 mm | 0.412 µV | 78.4 mm | 95.9 mm |
| 10-10 | [−16,−16,−16] | 0.5 µV | 0.01 | 32.0 mm | 0.412 µV | 71.6 mm | 96.2 mm |
| 10-10 | [48,48,48] | 0 | 1/9 | 0.0 mm | 0.000 µV | 0.0 mm | 32.3 mm |
| 10-10 | [48,48,48] | 0.5 µV | 1/9 | 0.0 mm | 0.406 µV | 0.0 mm | 64.5 mm |
| 10-10 | [48,48,48] | 0.5 µV | 0.01 | 0.0 mm | 0.406 µV | 0.0 mm | 92.8 mm |
| 10-05 | [−16,−16,−16] | 0 | 1/9 | 0.0 mm | 0.000 µV | 45.3 mm | 69.7 mm |
| 10-05 | [−16,−16,−16] | 0.5 µV | 1/9 | 0.0 mm | 0.464 µV | 71.6 mm | 97.5 mm |
| 10-05 | [−16,−16,−16] | 0.5 µV | 0.01 | 0.0 mm | 0.464 µV | 78.4 mm | 105.0 mm |
| 10-05 | [48,48,48] | 0 | 1/9 | 0.0 mm | 0.000 µV | 0.0 mm | 20.4 mm |
| 10-05 | [48,48,48] | 0.5 µV | 1/9 | 0.0 mm | 0.464 µV | 0.0 mm | 62.0 mm |
| 10-05 | [48,48,48] | 0.5 µV | 0.01 | 0.0 mm | 0.464 µV | 0.0 mm | 95.8 mm |

另有：网格点外的源 [0,0,0]（TS，无噪声）：偶极子拟合落在最近网格点，
误差 27.7 mm（= √(3×16²)），残差 0.086 µV；MNE 误差 69.7 mm、分布 91.8 mm。
λ² 越小 MNE 峰值幅度越大（收缩越轻）：10-20 角源 λ²=1/9 时峰值 3.13 nA·m、
λ²=0.01 时 5.60 nA·m（真值 10 nA·m）；10-05 角源 λ²=1/9 时 5.26、
λ²=0.01 时 8.13、λ²=1e-6 时 10.00 nA·m。

读法：

- **偶极子拟合**：单偶极子模型正确时（无噪声、源在网格点上）精确恢复，
  误差 0.0 mm、残差 ~0。0.5 µV 噪声下误差 0–55 mm，残差 RMS ≈ 噪声水平
  （0.32–0.46 µV）——拟合把信号解释掉了，剩下的是噪声；误差是噪声所限，
  不是实现错误。导联越多越好：10-05 下噪声误差全为 0.0 mm。
- **MNE**：无深度加权的最小范数解是差的峰值定位器。深部源 [−16,−16,−16]
  无噪声也要 45–55 mm，有噪声 72–96 mm；表浅角源 [48,48,48] 无噪声
  0.0 mm。分布范围始终很大（20–105 mm）：解本身就是弥散的，峰值位置
  不可信。原因是深度偏置——表浅源的 lead-field 列模大，解被拉向表面——
  加上 64 点粗网格（间距 32 mm）。减小 λ² 不救定位（峰值幅度回升，
  位置仍错），反而放大噪声（0.5 µV 噪声 + λ²=0.01 时个别配置误差 96–106 mm）。
- MNE 峰值幅度被正则化压缩（真值 10 nA·m 时峰值 0.36–5.26 nA·m，
  取决于 λ² 与源深浅），不得把峰值读作真值幅度。

### 3.3 TS 侧有噪声数（mulberry32，seed 7；与 Python 的 numpy 流不同，只报告不逐点比）

10-20，0.5 µV 噪声：真源 [16,16,16] 偶极子误差 55.4 mm、残差 0.494 µV、
MNE 误差 71.6 mm、分布 87.6 mm；真源 [−16,−16,−16] 偶极子误差 45.3 mm、
残差 0.495 µV、MNE 误差 96.0 mm、分布 101.2 mm；真源 [48,48,48] 偶极子
误差 32.0 mm、残差 0.501 µV、MNE 误差 32.0 mm、分布 67.2 mm。

### 3.4 MNE 真实管线交叉验证

Python `mne_operator_estimate`（`make_inverse_operator` loose=0.0、
depth=None + `apply_inverse` method='MNE'，对角 σ²I 噪声协方差，
average 参考用投影实现）与 numpy 公式对照（10-20，三例）：

| 真源 | 相关 | 峰值网格点 |
| --- | --- | --- |
| [−16,−16,−16] | 0.9949 | 相同（网格点 2） |
| [−16,16,48] | 0.9904 | 相同（网格点 11） |
| [48,48,48] | 0.9913 | 相同（网格点 63） |

不逐点比：MNE 内部的 SVD/白化管线使估计向量与 numpy 公式差到
0.04–0.27 nA·m（峰值的 ~20%）。只断言峰值网格点相同 + 相关 > 0.98，
不虚报逐点一致。注意：`make_forward_dipole` 给出的是固定方向正向
（每网格点 3 个方向各为一个源），故 loose 必须为 0.0；MNE 要求 EEG
平均参考投影（`set_eeg_reference`，projection=True），数学上等价于
减均值。

### 3.5 对照表

| 对照 | 结果 |
| --- | --- |
| 盲测无噪声 5 配置 TS vs Python fixture 逐项 | 偶极子位置精确相等、矩 1e-6、残差 < 1e-9 µV、误差 0.0 mm；MNE 峰值位置精确相等、峰值/分布范围相对 1e-6 |
| MNE 峰值与分布范围 TS vs Python（同公式） | 相对 1e-6 内一致 |
| MNE 真实管线 vs numpy 公式 | 峰值网格点 3/3 相同，相关 0.990–0.995（见 §3.4） |
| 参考一致性 | lead-field 与数据参考不一致时偶极子拟合残差 > 0.05 µV；一致时无噪声残差 ~0 |
| fixture 增益 vs MNE 重建正向 | max\|L_mne − L_fixture\| = 2.4e-8 µV/(nA·m)（fixture 增益舍入到 9 位小数所致的量级外差异，见 §3.6） |

### 3.6 残留缺口

- **MNE 深度偏置未修**：无深度加权的 MNE 在深部/切向源上峰值误差
  32–106 mm。修法是深度加权（MNE 默认 depth=0.8）、dSPM 或 eLORETA，
  不在本批做——需要与 MNE 的深度加权公式逐项对齐，单独成项更稳妥。
  本批如实报告误差，不把 MNE 峰值包装成“定位成功”。
- **MNE 估计幅度被压缩**：峰值幅度不是真值幅度（λ²=1/9 时只有真值的
  4–53%），UI 与文档已写清；如需幅度校准，需公开 EEG/MEG 数据约束
  （PR5 结构性缺口的延续），不在本批。
- **网格粗**：源网格间距 32 mm，网格点外的源至少有半个间距的量化误差
  （[0,0,0] 实测 27.7 mm）；加密网格需重算 lead-field fixture，未做。
- **噪声协方差为对角 σ²I**：真实噪声协方差（通道间相关、工频）未估计；
  σ 需用户按记录噪声水平给，默认 1.0 µV。
- MNE 重建正向与 fixture 增益差 2.4e-8 µV/(nA·m)：大于 9 位小数舍入
  的 5e-10，疑为 MNE 正向求解的数值差异；量级相对增益（~0.1–1）可忽略，
  未深究。

## 4. 测试证据

| 测试 | 通过数 | 关键数 |
| --- | --- | --- |
| `tests/pr6/tfr-topo-inverse.test.mjs`（node --experimental-strip-types --test） | 16/16 | multitaper ERSP 逐点 1e-6 dB；样条网格逐点 1e-9；盲测无噪声逐项一致；噪声下偶极子残差 ≈ 0.5 µV |
| `tests/pr6/test_tfr_topo_inverse.py`（python -m unittest） | 10/10 | fixture 新鲜度全过；MNE 管线峰值 3/3 相同、相关 > 0.98；表现表 18 行（见 §3.2） |
| `npx tsc -b` | 通过 | — |
| `npm run build` | 通过 | — |
| `npm run lint` | 0 errors、10 warnings（9 个为既有 React refs 警告、1 个 TopoTab setState-in-effect 已修） | 修后 TopoTab 无警告（复核见汇报） |

冒烟（新增面板布局）：TfrTab / TopoTab / InverseTab 未挂进壳（壳由 B1
并行写），未做浏览器冒烟；布局按契约 §8.6 做对——面板用
`repeat(auto-fit, minmax(320px, 1fr))` 网格、无绝对定位遮挡、canvas/SVG
宽度 100% 自适应；1920×1080 与 978px 的实测留待壳接好后由总协调统一做。

## 5. 文件清单

新建：`app/src/lib/topography.ts`、`app/src/lib/sourceLocalization.ts`、
`scientific/eeg/inverse_reference.py`、`tests/pr6/tfr-topo-inverse.test.mjs`、
`tests/pr6/test_tfr_topo_inverse.py`、`app/src/components/TfrTab.tsx`、
`app/src/components/TopoTab.tsx`、`app/src/components/InverseTab.tsx`、
`docs/pr6-topo-inverse.md`、
`tests/pr6/fixtures/multitaper-ersp-small.json`、
`tests/pr6/fixtures/tfr-topo-inverse-reference.json`。
修改：`docs/frontend-backend-contract.md`（新增 §1.6，时频/地形/逆解参数登记）、
`docs/pr6-acceptance.md`（填 PR-10/11/12 行）、`tests/pr5/contract.test.mjs`
（追加 B3 漂移断言，见设计稿 §3 许可）。

球形 fixture（`app/public/forward-assets/sphere-model.json`）由
`scientific/forward/generate_sphere_model.py`（MNE 1.11.0）本地生成，
不入库；测试缺失时报出生成命令。
