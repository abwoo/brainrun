# PR5 · 公开 EEG 数据约束：WC / JR 两条路线对照真实脑电

## 一句话结论

两条路线在 Pz 处的刺激响应幅度都比真实 P300 小一个数量级以上（WC 需把
N×coherence×pA×mm 乘积放大 12.6 倍，JR 需放大 53.8 倍才能对上峰值），
而且两条路线在 300–500 ms 窗口内基本没有响应、也没有持续的静息节律，
所以这三项失败是结构性的，不是调一个幅度系数能修好的。放大乘积不等于
证实了细胞数或同步性。

## 数据集（许可已核实）

| 项目 | 内容 |
| --- | --- |
| 名称 | EEG data from an auditory oddball task（Delorme, 2020） |
| OpenNeuro 编号 | ds003061，版本 1.1.2 |
| DOI | 10.18112/openneuro.ds003061.v1.1.2 |
| 许可 | **CC0**（`dataset_description.json` 中 `"License": "CC0"` 字段，2026-11-11 直接读取核实；OpenNeuro 非 embargo 数据集按平台政策以 CC0 发布） |
| 链接 | https://openneuro.org/datasets/ds003061 |
| 任务 | 听觉 oddball，全程闭眼；750 个刺激/ run：70% 标准音 500 Hz，15% 靶刺激 1000 Hz（按键），15% 白噪声干扰音；约 1 个/秒 |
| 被试 | 共 13 人；**本约束只用 sub-001 的 run-1**（一个被试、一个 run、64 导） |
| 记录 | BioSemi ActiveTwo，64 导 EEG（10-20 电极帽），CMS/DRL 参考，存储采样率 256 Hz，时长 758 s |

下载（公开 URL，无需登录、无需密钥；只下载一个 run，约 63 MB）：

```bash
mkdir public-eeg-data
curl -O https://s3.amazonaws.com/openneuro.org/ds003061/sub-001/eeg/sub-001_task-P300_run-1_eeg.set
curl -O https://s3.amazonaws.com/openneuro.org/ds003061/sub-001/eeg/sub-001_task-P300_run-1_events.tsv
# 两个文件都放进 public-eeg-data/；原始 .set 文件不要提交进仓库，用完可删
```

## 方法（固定处理流程，写死在脚本里）

脚本：`scientific/forward/public_eeg_constraint.py`（MNE 1.11.0）。
输出摘要：`scientific/forward/public_eeg_reference_values.json`（9.6 KB，只含衍生数值）。

- 通道：前 64 个 EEG 通道；滤波 0.5–40 Hz；平均参考。
- 分段：−200–800 ms，基线 −200–0 ms；峰峰值 > 150 µV 的试次剔除。
  747 个刺激中保留 678 个（oddball 99/113，standard 476/522，noise 103/112）。
- 条件：oddball = `oddball` + `oddball_with_reponse`；
  standard = `standard` + `standard_with_reponse`。
- PSD：Welch 法，1–40 Hz，n_fft = 1024（4 s 窗）。
- 模型侧：WC 与 JR 的 q(t) 波形取 `tests/pr5/fixtures/` 中的独立 SciPy
  参考（刺激 80–120 ms，与耦合文档一致）；经四层球形头正向模型
  （与 `generate_sphere_model.py` 相同参数）推到 Pz 电极，平均参考。
  Pz 增益中央值 0.160 µV/(nA·m)，4 个顶叶源变体范围 0.130–0.188。
  这是一个单源球形近似的数量级桥梁，不是针对该被试的源定位；
  P300 本身是分布式响应，所以这里只做数量级对照。

复现：

```bash
python -m pip install mne==1.11.0 numpy scipy
python scientific/forward/public_eeg_constraint.py --data-dir public-eeg-data
python -m unittest discover -s tests/pr5 -p 'test_public_eeg_constraint.py' -v
```

## 三类约束量（实测，sub-001 run-1）

### (a) 幅度

| 量 | 数值 |
| --- | --- |
| 连续 RMS，Pz（0.5–40 Hz，平均参考） | 8.58 µV |
| 刺激前基线 RMS（−200–0 ms），Pz | 6.07 µV（Cz 5.48，Oz 10.02） |
| Oddball ERP，Pz，250–600 ms 窗峰值 | **8.89 µV，潜伏期 410 ms** |
| Oddball ERP，Pz，300–500 ms 均值 | 6.94 µV |
| Oddball − standard 差异波，Pz，峰值 | **9.14 µV，414 ms**；300–500 ms 均值 6.88 µV |
| Standard ERP，Pz，300–500 ms 均值 | 0.06 µV（窗口内基本平坦） |
| N1，Cz，oddball / standard | −2.83 µV @ 109 ms / −2.73 µV @ 117 ms |

### (b) 主导频率

| 量 | 数值 |
| --- | --- |
| Alpha 峰（4–13 Hz 内），Pz / Cz / Oz | 10.00 / 9.50 / **9.25 Hz** |
| Alpha 功率占比（占 1–40 Hz 总功率），Oz | **69.3%**（Pz 30.3%，Cz 37.4%） |
| 频段占比，Pz | delta 43.4%，theta 10.9%，alpha 30.3%，beta 13.6% |

说明：Pz 在 1–40 Hz 全频段的 PSD 峰值落在 1.00 Hz（0.5 Hz 高通后低频
功率仍占主导），所以 alpha 峰按 4–13 Hz 频段内取；Oz 的 alpha 峰
9.25 Hz、占比 69.3% 是典型的闭眼静息 alpha 形态。

### (c) 刺激响应形态（0–500 ms，Pz）

Oddball 刺激后先有一个小的早期负向（Pz −1.76 µV @ 86 ms），随后是
宽大的正向成分，在 410 ms 达到 8.89 µV，300–500 ms 均值 6.94 µV；
standard 刺激在同一窗口内基本没有正向成分（0.06 µV）。差异波峰值
9.14 µV @ 414 ms。也就是说，真实响应的主体是一个 300–600 ms 的
晚期正成分，而不是刺激后 100 ms 内的瞬时偏转。

文献一致性检查（只作 sanity check，约束本身来自上面实测）：
Polich (2007, Clin. Neurophysiol. 118:2128–2148) 指出听觉 oddball 的
P300 在 Pz 通常 300–600 ms 达峰、幅度约 10 µV 量级；实测 8.89 µV @
410 ms 落在该范围内。闭眼静息以枕区 alpha（8–13 Hz）为主，实测 Oz
9.25 Hz、占比 69.3%，符合该模式。

## 与模型输出的对照

| 对照项 | 实测 | WC 路线 | JR 路线 |
| --- | --- | --- | --- |
| 峰值偶极矩 \|q\| | — | 4.413 nA·m @ 108 ms | 1.032 nA·m @ 176 ms |
| 峰值推到 Pz | — | 0.71 µV（范围 0.57–0.83） | 0.17 µV（范围 0.13–0.19） |
| **幅度：P300 峰值 8.89 µV** | 8.89 µV | **FAIL，相差 12.6 倍** | **FAIL，相差 53.8 倍** |
| **形态：300–500 ms 均值 6.94 µV** | 6.94 µV | **FAIL，模型仅 0.0002 µV** | **FAIL，模型仅 0.0065 µV** |
| **基线：刺激前 RMS 6.07 µV** | 6.07 µV | **FAIL，模型基线 q = 0** | **FAIL，模型基线 q = 0** |
| **频率：alpha 峰 10.0 Hz（Pz）** | 10.0 Hz | **FAIL，2.07 Hz（瞬时脉冲谱峰，非节律）** | **FAIL，2.07 Hz（同上）** |

通过标准：实测值的 2 倍以内算通过（已放得很宽，因单源球形近似本身
有不确定性）。两条路线的差距远超该标准，所以结论不依赖于通过线的
具体取值，也不依赖于 Pz 增益在 0.130–0.188 范围内的具体选择。

## 解读：失败在哪里，分别意味着什么

1. **幅度失败是可量化的，但不可“校准”。** 要让峰值对上 P300，
   WC 需把 N×coherence×pA×mm 乘积放大 12.6 倍，JR 需放大 53.8 倍。
   该乘积在结构上不可辨识：细胞数翻倍、同步比例减半，输出完全不变。
   所以任何这样的放大都只是“把乘积调到对上”，不能写成证实了细胞数、
   同步性或单细胞电流。测试里有专门的守卫断言防止这种写法。
2. **形态失败是结构性的。** 两条路线的刺激都是 80–120 ms 的 40 ms
   方波驱动，响应在驱动结束不久即衰减殆尽（WC 峰值在 108 ms，
   300–500 ms 窗内最大 |q| 仅 0.0011 nA·m；JR 峰值在 176 ms，
   窗内最大 0.041 nA·m）。真实 P300 的主体在 300–600 ms。
   模型里根本没有产生晚期正成分的机制，调大幅度也长不出这个成分。
3. **基线失败是结构性的。** 两条路线按定义以基线为零（q 是相对基线的
   变化），所以静息脑电 RMS 预测为 0，而实测 Pz 基线 RMS 为 6.07 µV。
   模型没有持续的自发活动可供放大；要对照静息幅度，必须先给模型加
   自发驱动或噪声背景。
4. **频率失败要分两层说。** 在本次对照协议里，两条路线都没有持续节律：
   WC 的 q(t) 是单次瞬时偏转；JR 用的是 p0 = 90 的低不动点分支（强稳定），
   其 2.07 Hz 只是 120–600 ms 瞬时段 FFT 的谱峰，不是节律。
   但 JR 方程本身在标准工作点 p0 = 220 时是一个约 10.5 Hz 的极限环
   （alpha 量级），这是该路线自带的、尚未拿这份数据检验过的候选，
   见残留项第 3 条。不要把“本次协议下无节律”说成“JR 方程不能产生 alpha”。

## 残留项

1. 单被试、单 run：引用组水平约束前，需在 ds003061 其余被试上重复。
2. 球形头增益，非 fsaverage 真实 BEM lead-field：真实 BEM 的零配置分发
   定下来后，用 BEM 重跑模型对照。
3. JR 未测 p0 = 220 的 alpha 极限环工作点：那是 JR 路线对照 alpha 峰
   （Pz 10.00 Hz / Oz 9.25 Hz）的直接候选，应作为下一步。
4. 本数据集全程闭眼，无睁眼对照，alpha 阻断无法检验。
5. 本对照只用 Pz 单电极增益；多电极地形对照（Pz vs Cz vs Oz 的相对
   幅度）尚未做。
