# PR5 · 从局部神经群体到 EEG：有单位、可验证、但尚未人体校准的机制实验

## 为什么需要这一层

Wilson–Cowan 模型的 E、I 是**无量纲神经群体活动比例**，不是电流，也不是 EEG。将其直接乘以 MNE 的 lead-field 会造成单位不匹配，并制造没有生理依据的电位。

当前实现采用一个与既有 76 节点 TVB 演示**完全隔离**的局部 E/I 神经群体，结合皮层法向、明确假设的突触电流和源汇几何，建立一个可逐步检查的、量纲一致的机制实验：

```text
外部无量纲刺激 u(t)
        ↓
局部 Wilson–Cowan E(t), I(t) [dimensionless]
        ↓
[E(t)-E0], [I(t)-I0] 的假定突触电流变化 [pA/neuron]
        ↓
乘有效锥体神经元数 N × 同步比例 c × 源汇距离 ℓ [mm]
        ↓
有符号等效电流偶极矩 q(t) [nA·m]
        ↓
使用源点原始 MRI 皮层法向转换到 HEAD RAS 坐标
        ↓
MRI 模板 BEM lead-field [µV/(nA·m)]
        ↓
电极电位 V(t) [µV]（选择平均参考或理论无限远参考）
```

## 明确的物理方程和假设

记 (E(t),I(t)in[0,1])，局部神经群体动力学采用常微分方程：

[
	au_E dot E = -E + S(c_{EE}E-c_{EI}I+P+u(t)),
qquad
	au_I dot I = -I + S(c_{IE}E-c_{II}I+P).
]

[
S(x)=igl(1+exp[-a(x-	heta)]igr)^{-1}.
]

固定点 ((E_0,I_0)) 通过**无刺激动力学**求解，而不是人为指定的 EEG 基线。

等效电流偶极矩定义为：

[
q(t) =
10^{-6} , N cell_{mathrm{mm}}
Bigl[
I_{mathrm{exc,pA}}(E(t)-E_0)
-
I_{mathrm{inh,pA}}(I(t)-I_0)
Bigr]
quad[mathrm{nA,m}].
]

这里的 (10^{-6}) 严格来自单位换算：pA × mm = (10^{-6}) nA·m。

该标量乘以从原始 MRI 皮层源空间取得、旋转至 HEAD RAS 且单位化的法向 (hat n)，得到 (oldsymbol q(t)=q(t)hat n)。头皮电位由 MNE 真实 BEM 预计算矩阵决定：(oldsymbol V(t)=Loldsymbol q(t))，之后才施加参考变换。皮层法向决定假定的金字塔细胞柱方向，实际电流符号仍可能因微观源汇分布改变。

### 教学默认参数：**不是文献确定的人体生理参数**

| 名称 | 默认值 | 含义 |
| --- | ---: | --- |
| 局部神经群体时间常数 | E 12 ms，I 20 ms | 数值教学预设 |
| 连接系数 | 2.8 / 2.4 / 2.6 / 0.2 | 局部 E/I 连接假设 |
| 有效锥体细胞数 | 1,000,000 | 未按个体脑区面积实测 |
| 有效相干/同步比例 | 0.08 | 未根据 EEG/MEG 反演 |
| E 对应的假定跨膜电流 | 200 pA | 仅作单位转换与敏感度实验 |
| I 对应的假定反向电流 | 100 pA | 无实测生理校准 |
| 有效源汇距离 | 0.5 mm | 与皮层微结构相关的简化长度 |
| 模拟数值积分 | RK4，1 ms | 一致、可重复的计算 |

变化对应线性性与极性变换均可验证。但**这些测试只能证实指定假设内部的数学、数值与单位一致性，不能证明真实人脑突触动力学、绝对 EEG 幅值或 ERP/频段已被重现**。

## 无教程实验体验

当已在本地加载真实 MRI/BEM 文件后，可在 **HEAD EEG → 进阶 MRI/BEM** 的“物理源模式”中选择“局部 E/I 神经群体（假设参数）”。这时：

- 直接点击“施加局部刺激”，ODE 开始改变 E/I 活动。
- 电流偶极矩 q(t) 使用上述参数从 E/I 解即时计算，取当前皮层源位置的法向。
- 每个电极电位随同一个 q(t) 和真实 BEM lead-field 更新；不是预录波形。
- 可暂停/恢复、调整外部驱动、重置，并对照手动控制偶极子。
- 可用鼠标在 3D 皮层上选择源点，但**仅吸附到离线求解过的源点**，不将插值结果谎称为新的 BEM 数值解。

## 验证与重复性

1. 以 SciPy DOP853 分段积分独立得到 E/I 参考轨迹，包含 80–120 ms 刺激和刺激后恢复；对照前端 RK4 的时间点、E/I 与 q(t)。
2. 使用 19 个与 343 个标准 EEG 电极的 fsaverage 三层 BEM 真实矩阵，交叉核对 (oldsymbol V=Loldsymbol q)、线性叠加、参考不变性和源法向。
3. 独立的浏览器 E2E：真的点击刺激、看到电位变化、暂停物理时钟、重置回初值；保留原来的手动偶极子体验和 TVB 工作流。
4. 对非法单位、非法电导或法向、时间步长、数值发散做显式失败处理。
5. 不在 CI 或公共网页发布 FreeSurfer 模板的衍生数据；真实数据只在临时工作环境生成和使用。

参考：
- [MNE `make_forward_dipole` 源码和参数定义](https://github.com/mne-tools/mne-python/blob/main/mne/forward/_make_forward.py)
- [Neural source dipoles and pyramidal cortex orientation (Journal of Neural Engineering)](https://pmc.ncbi.nlm.nih.gov/articles/PMC12903115/)
- [Mesoscale biophysical EEG modeling from cortical columns](https://pmc.ncbi.nlm.nih.gov/articles/PMC9968827/)
- [NMM outputs are not direct field-potential proxies](https://pubmed.ncbi.nlm.nih.gov/36548999/)

## 下一项尚未解决的科学决策

必须决定并实证一种**生理意义更明确的**模型路线：例如有形态、电流源/汇动力学的 Jansen–Rit / cortical column / LFPy 桥接，结合真实受试者或公开 EEG/MEG 数据估计尺度、时常数与误差。此时才能讨论“量化逼近真实脑电”的绝对幅值、频谱与 ERP。

特别要避免：**直接把既有 TVB 76 区混合来源连接矩阵映射到 fsaverage，或者把这里标为假设的 1,000,000、0.08 等数字当成被科学证实的生理常数。**

因此这个实验是**可复现的机制教学/科研假设验证模块**，不是完整版全脑电生理真实仿真，也尚不足以独立满足整个 PR5 的合并门槛。
