# PR-13 细胞级 / 多尺度模型（PR7 第一批）

> 状态：2026-11-12，PR-13 子代理交付。实现 `app/src/lib/cellular.ts`
>（纯 TS，不 import 任何 npm 包），Python 对照
> `reference/python-model/cellular_reference.py`（SciPy DOP853），
> NEURON 9.0.2 内置 `hh` 机制交叉验证通过。
> Wilson–Cowan / Jansen–Rit 原样保留；不同模型里同名变量不混淆
>（JR 的 `y0` 是锥体群体突触后电位 mV，HH 的 `V` 是单神经元膜电位 mV）。
> 测试：TS 15/15（`tests/pr7/cellular.test.mjs`），Python 14/14
>（`tests/pr7/test_cellular.py`；eeg-venv 下 NEURON 1 项跳过，
> neuron-venv 下 14/14 全过）。

## 1. 模型、方程与参数

时间一律 ms，电位 mV，电流 pA（HH 例外用 uA/cm^2 与 mS/cm^2），
电导 nS（HH 例外 mS/cm^2），电容 pF（HH 例外 uF/cm^2），
偶极矩 nA·m，电位 uV，频率 Hz。

### 1.1 LIF（Leaky Integrate-and-Fire）

`C dV/dt = -gL (V - EL) + I`，精确子阈值更新：

`V(t+dt) = Vinf + (V - Vinf) exp(-dt/tau)`，`Vinf = EL + I/gL`，`tau = C/gL`。

| 参数 | 值 | 来源 |
|---|---|---|
| C | 250 pF | Dayan & Abbott 2001 教科书标准值 |
| gL | 25 nS（tau=10 ms） | 同上 |
| EL | -65 mV | 同上 |
| Vth / Vreset | -50 / -65 mV | 同上 |
| 不应期 | 2 ms | 同上 |
| 步长 dt | 0.1 ms | 本项目定值 |

流变电流 `rheobase = gL (Vth - EL) = 375 pA`。稳态发放率解析式：

`f = 1 / (t_ref + tau ln((I·R - (Vreset-EL)) / (I·R - (Vth-EL))))`，
`R = 1/gL`（GOhm），`I·R` 单位 mV（pA × GOhm = mV）。
不应期语义（TS 与 Python 同一条）：不应期内膜电位钉在复位电位、
不应期时钟递减；步末越阈即发放、复位并开始不应期。

### 1.2 Hodgkin–Huxley（HH1952）

Hodgkin & Huxley 1952, J. Physiol. 117:500–544（枪乌贼大轴突，6.3 °C）：

`C dV/dt = I - gNa m^3 h (V-ENa) - gK n^4 (V-EK) - gL (V-EL)`

| 参数 | 值 |
|---|---|
| C | 1 uF/cm^2 |
| gNa / gK / gL | 120 / 36 / 0.3 mS/cm^2 |
| ENa / EK / EL | +50 / -77 / -54.387 mV |
| Vrest | -65 mV（门控稳态参考点） |
| RK4 步长 | 0.025 ms |

门控速率（`v = V - Vrest`）：

- `alpha_m = 0.1(25-v)/(exp((25-v)/10)-1)`，`beta_m = 4 exp(-v/18)`
- `alpha_h = 0.07 exp(-v/20)`，`beta_h = 1/(exp((30-v)/10)+1)`
- `alpha_n = 0.01(10-v)/(exp((10-v)/10)-1)`，`beta_n = 0.125 exp(-v/80)`

`alpha_m` 在 `v=+25`、 `alpha_n` 在 `v=+10` 处奇异，两边都用
`x/(exp(x)-1)` 的级数（`|x|<1e-6` 时 `1 - x/2 + x^2/12 - x^4/720`）处理。
静息门控稳态值：`m0=0.052932，h0=0.596121，n0=0.317677`。
发放检测：膜电位上穿 0 mV（TS 记步末时刻，Python 记线性插值时刻，
差 ≤ dt=0.025 ms）。

注意：HH 漏电池 EL=-54.387 mV 不是静息电位——静息处 Na 窗口电流
平衡了它，真实不动点在 -64.9964 mV（见 §3.2）。这不是 bug，是 HH1952
本来的性质。

### 1.3 多房室神经元（胞体 + 顶树突/基树突）

形态（锥体细胞教科书量级，写清不是某个实测神经元的重建）：

| 房室 | 直径 | 长度 | 面积 | 电容 | 漏电导 |
|---|---|---|---|---|---|
| 胞体 | 20 um | 20 um | 1256.6 um^2 | 12.57 pF | 3.77 nS |
| 顶树突 | 2 um | 200 um | 1256.6 um^2 | 12.57 pF | 3.77 nS |
| 基树突 | 2 um | 100 um | 628.3 um^2 | 6.28 pF | 1.88 nS |

`Ra=100 Ohm·cm`，`Cm=1 uF/cm^2`，漏密度 `0.3 mS/cm^2`。
轴向电导由圆柱几何算出（`R_half = Ra·(L/2)/A_cross`，两段串联再倒数）：

- 胞体–顶树突：31.38 nS（顶树突半段 31.8 MOhm 主导）
- 胞体–基树突：62.71 nS
- 胞体 HH 绝对电导：gNa=1508 nS，gK=452 nS（密度 × 胞体面积）

电缆长度常数（顶树突，`lambda = sqrt(d·Rm/(4·Ra))`，`Rm=3333 Ohm·cm^2`）：
**408 um**。房室中心间距（细胞偶极的几何源–汇间距）：
顶树突 110 um，基树突 60 um。

被动漏反转的口径（本次实现中发现并修正的一处，见
`tests/pr7/debug-rounds-a.md` R2）：被动房室的漏反转在静息电位
**-65 mV**，不是 HH 漏电池 -54.387 mV——主动胞体的 HH 漏电池靠 Na
窗口电流在静息处平衡，被动房室没有这个平衡，漏必须反转在静息本身。
主动胞体仍用 HH 漏电池，被动胞体与树突用 -65 mV。

### 1.4 突触后电流（电导型）

`I_syn（外向）= g(t)·(V - Erev)`，1 nS × 1 mV = 1 pA；
膜方程减去它，即注入电流 = `-g(t)·(V - Erev)`。

| kind | Erev | alpha tau | 指数 tau |
|---|---|---|---|
| AMPA-like（兴奋） | 0 mV | 2 ms | 2 ms |
| GABA-like（抑制） | -75 mV | 8 ms | 10 ms |

核：alpha `g = gMax·x·exp(1-x)`，`x=(t-t0)/tau`（`t=t0+tau` 时取峰 gMax）；
指数 `g = gMax·exp(-(t-t0)/tau)`。数值均为教科书量级
（Dayan & Abbott；Koch），不是拟合值。静息 -65 mV、g=1 nS 时：
AMPA 外向电流 -65 pA（注入 +65 pA，去极化），GABA 外向电流 +10 pA
（注入 -10 pA，超极化）。

### 1.5 跨尺度耦合（假设，未校准）

前向：WC/JR 脑区活动 `E`（无量纲，静息均值 `E0=0.011`，契约 §4.1）→
细胞注入电流，线性映射 `I = 增益 × (E - E0)`。

| 映射 | 增益（假设） | E=0.5 算出的数 | E=0.1 算出的数 |
|---|---|---|---|
| → LIF 电流 | 1000 pA/单位 E | 489 pA（刚过流变 375 pA，约 60 Hz） | 89 pA（阈下） |
| → HH 电流密度 | 20 uA/cm^2/单位 E | 9.78 uA/cm^2（恰在持续电流阈值 ~9.8 附近） | 1.78（静默） |

两套细胞模型单位不同（pA 对 uA/cm^2），一个增益不可能对两者同时合理，
所以分开给、各自写清算出的数；增益是假设，不是拟合值。
反向：细胞发放率 → 群体驱动 `dP = 0.002 × (rate_Hz - 0)`（P 单位/Hz，
假设）；60 Hz LIF 发放 → dP=0.12。

偶极链共用 PR5 的假设数（未重拟合）：`N=1,000,000`，`coherence=0.08`，
Pz 增益 `0.16 uV/(nA·m)`（PR6 §1.8）。细胞偶极矩用多房室模型自己的
几何：`q = I_axial × d × 1e-6 [nA·m]`，`d=0.11 mm`（胞体–顶树突中心间距），
不另取 PR5 的假设间距 0.5 mm。

多尺度缩放：放大到某脑区时切到真实的细胞级模型（本引擎），不是放大的
动画——UI 文案（CellularLab 顶部）与本文写明。

## 2. NEURON 交叉验证（用上了）

独立 venv `~/workspace/neuron-venv`，`pip install neuron` 一次成功
（neuron 9.0.2，含 numpy 2.5.4；另装 scipy 1.18.1 以跑同一份参考脚本），
30 分钟限时内完成。比较：NEURON 内置 `hh` 机制的单房室胞体
（L=20 um，d=20 um，`hh.el` 设为 -54.387 mV 以与 HH1952 一致，
`celsius=6.3`，固定步长 dt=0.025 ms，`secondorder=2` Crank–Nicolson），
IClamp 10 uA/cm^2（换算为 nA：密度 × 面积 × 1000），10–60 ms，
对 DOP853 同协议：

| 指标 | 数值 |
|---|---|
| 发放数 | 双方都是 4 个 |
| 发放时刻最大差 | 0.047 ms |
| 锋电位峰值 | NEURON 40.29 mV，DOP853 40.23 mV（差 0.06 mV） |
| 锋外（距发放 ±5 ms 以外）最大差 | 0.064 mV |
| 平均绝对差 | 0.196 mV |
| 逐点最大差 | 10.30 mV，全部集中在锋电位上升支 |

上升支的 10.30 mV 是相位差不是模型差：上升支 dV/dt 达数百 mV/ms，
约 0.02 ms 的相位差就对应 mV 级逐点差；把 dt 减半到 0.0125 ms
也不减小它（锋外 ±2 ms 窗仍为 3.34 mV），说明不是步长误差。
结论：同一模型、同一发放、同一峰值；NEURON 与 DOP853 一致。

## 3. 验证结果

### 3.1 LIF

- 静息 I=0 时 V 恒为 -65 mV，零发放。
- 600 pA 恒定电流 500 ms：模拟 84.44 Hz，解析 84.69 Hz；轨迹与
  DOP853 逐位一致（最大差 0.0 mV，发放时刻差 4.5e-11 ms）。
- f-I 曲线（0–2000 pA，11 点）：模拟值与解析稳态率差 ≤1.0%，
  流变以下（≤375 pA）零发放。

### 3.2 HH

| 检查 | 结果 | 对照 |
|---|---|---|
| 静息电位（I=0，200 ms） | -64.9964 mV | HH1952：-65 mV 参考点，差 0.0036 mV |
| 锋电位峰值（10 uA/cm^2，10–60 ms） | +39.77 mV @12.1 ms | HH1952 原文约 +40 mV |
| 半宽 | 1.49 ms | 教科书约 1–2 ms |
| 发放数 | 4 个（50 ms 窗） | — |
| 1 ms 脉冲阈值（二分） | 6.93 uA/cm^2 | — |
| 持续 5 uA/cm^2 | 只有起始 1 个发放、之后静默 | 双稳区下分支（I0≈6.26 以下无极限环） |
| 持续 12 uA/cm^2 | 22 个（300 ms） | 重复发放 |
| 不应期（两发 1 ms/20 uA/cm^2） | 间隔 3 ms 第二发失败、15 ms 成功 | 绝对不应期 |
| DOP853 自身误差底（rtol 1e-12→1e-13） | 6.8e-9 mV | 远低于一切容差 |

### 3.3 多房室

- 被动稳态（300 pA 顶树突，550–600 ms 均值）与 3×3 线性方程精确解
  差 ~1e-11 mV；去极化衰减比（胞体/顶树突）**0.8486**，介于无限电缆
  `exp(-200/408)=0.613` 与 1 之间（有限电缆末端封闭，反射使衰减更小），
  符合电缆理论。
- 主动胞体（1000 pA，10–12 ms）：1 个锋电位，峰值 +37.40 mV，
  半宽 1.56 ms；顶树突见衰减的反向传播锋电位（峰值低于胞体）。

### 3.4 TS/Python 逐点对照与收敛（误差底实测）

| 对照 | dt=0.025 ms 实测最大差 | dt=0.0125 ms | 收敛比 |
|---|---|---|---|
| LIF V(t) | 0.0 mV（精确更新） | — | — |
| HH V(t) | 5.7e-3 mV | 2.8e-4 mV | 20.4 倍（RK4 四阶，期望 ~16 倍） |
| HH m/h/n | 7.0e-6 | 4.5e-7 | — |
| HH gNa | 2.8e-4 mS/cm^2 | 1.8e-5 | — |
| 多房室被动 V(t) | 3.6e-5 mV | — | — |
| 多房室主动 V(t) | 7.5e-3 mV | 3.3e-4 mV | 23 倍 |
| 多房室主动 I_axial | 0.25 pA | 0.011 pA | 23 倍 |

测试容差取误差底的约 3–4 倍（HH V 0.02 mV、多房室 V 0.02 mV/
被动 1e-3 mV、I_axial 1 pA、LIF 1e-9 mV），仍比动作电位 ~105 mV
摆幅、PSP ~10 mV 小 3 个量级以上，不是为通过而放宽。
确定性：同参数两次运行逐值相同（JSON 级断言）；非法参数抛错
（LIF 负电容、HH dt>0.1 ms、突触负电导、E 越出 [0,1] 等）。

## 4. 局限

- HH 是枪乌贼大轴突 6.3 °C 的模型，不是 37 °C 哺乳动物皮层锥体细胞；
  哺乳动物神经元还有 M 电流、Ih、Ca 电流等，这里都没有。
- 多房室只有 3 个房室、无主动树突通道、无突触可塑性、无髓鞘；
  形态是教科书量级的小锥体细胞（总面积 ~3140 um^2），输入电阻高
  （75 pA 顶树突驱动即产生约 7.5 mV 胞体去极化），不是某个实测细胞。
- 突触是单指数/alpha 电导核，无短时程可塑性、无 NMDA 电压依赖。
- 跨尺度耦合增益未校准；80,000 细胞完全同步是外推假设，不是观测。
- 细胞路线算的是胞体–顶树突轴向电流的偶极矩；真实皮层偶极矩还涉及
  顶树突突触电流的空间分布、皮层折叠导致的朝向抵消等，这里都没有。

## 5. 细胞路线对 PR6 幅度缺口的量化回答

缺口：oddball P300 真实峰值 8.89 uV，需要偶极矩 55.56 nA·m；
JR 路线峰值 1.09 nA·m（0.174 uV），差 51 倍，JR sigmoid 饱和天花板约
0.21 uV。细胞路线（不重缩放，数字实测）：

| 细胞路线实验 | 每细胞偶极矩 | 群体 q（×80,000） | Pz |
|---|---|---|---|
| 持续 PSP：75 pA 顶树突驱动，300–500 ms 均值，被动胞体 | -4.60e-6 nA·m | -0.368 nA·m | **-0.059 uV** |
| 同上，主动胞体（0 发放） | — | -0.506 nA·m | **-0.081 uV** |
| 同步动作电位齐射峰值（2000 pA/2 ms 胞体脉冲） | 1.77e-4 nA·m | 14.15 nA·m | **+2.50 uV（峰值，约 1 ms 瞬态）** |
| 真实 oddball P300 需要 | — | 55.56 nA·m | 8.89 uV |

结论：**细胞路线没有弥合缺口。**持续 PSP 路线距真实值差 151 倍
（0.368 vs 55.56 nA·m），与 JR 路线的 1.09 nA·m 同量级；
即使 80,000 个细胞完全同步发放动作电位，峰值也只有 2.50 uV，
不到真实值一半，而且只是约 1 ms 的瞬态，不是 200 ms 持续的 ERP。
缺口在群体规模/同步性/校准，不在模型类别——换一类细胞模型
并不能把 0.06–0.17 uV 变成 8.89 uV；要弥合缺口，需要的是
更大规模的同步群体、不同的电流尺度假设，或接受“教学仿真”定位。
（CellularLab 的幅度面板实时重算这三个数。）

## 6. 文件与复现

带走的新文件（只新建，未改任何现有文件）：

- `app/src/lib/cellular.ts`——细胞引擎（LIF/HH/多房室/突触/跨尺度耦合）
- `reference/python-model/cellular_reference.py`——SciPy DOP853 对照
  + NEURON 交叉验证 + 幅度实验 + fixture 生成
- `tests/pr7/fixtures/cellular-reference.json`——对照 fixture（762,624 字节）
- `tests/pr7/cellular.test.mjs`——TS 测试 15 项
- `tests/pr7/test_cellular.py`——Python 测试 14 项
- `app/src/components/CellularLab.tsx`——细胞级实验台 UI
- `docs/pr7-cellular.md`——本文档
- `tests/pr7/debug-rounds-a.md`——过程记录

复现：

```bash
# 生成 fixture（含 NEURON 比较；需 neuron-venv）
~/workspace/neuron-venv/bin/python reference/python-model/cellular_reference.py
# TS 测试
node --experimental-strip-types --test tests/pr7/cellular.test.mjs
# Python 测试（eeg-venv：NEURON 1 项跳过；neuron-venv：全跑）
~/workspace/eeg-venv/bin/python -m unittest discover -s tests/pr7 -p 'test_*.py' -v
# 类型检查
cd app && npx tsc --noEmit
```

## 7. 契约追加（草案，供总协调写入 frontend-backend-contract.md）

> 以下条目文本按契约现有格式拟定；参数值均从 `cellular.ts` /
> `cellular_reference.py` 读出，未核实的已标明。

### 7.1 PR-13 细胞级模型（新增 §1.9）

模块：`app/src/lib/cellular.ts`（`CELLULAR_ID = 'local-cellular-multiscale-v1'`）；
Python 独立对照：`reference/python-model/cellular_reference.py`
（SciPy DOP853；NEURON 9.0.2 内置 `hh` 机制交叉验证）；
出处 Hodgkin & Huxley 1952, J. Physiol. 117:500–544；LIF 参数取
Dayan & Abbott 2001 教科书标准值。时间 ms、电位 mV、电流 pA
（HH 例外 uA/cm^2 与 mS/cm^2）、偶极矩 nA·m、电位 uV。
UI：`app/src/components/CellularLab.tsx`（模型选择 LIF/HH/多房室、
电流注入、膜电位与电导曲线、发放计数、跨尺度耦合面板；
每个控件对应 `cellular.ts` 里的真实函数）。

| 参数 | TS 默认 | Python 对照 | 单位 |
|---|---|---|---|
| LIF C / gL / EL / Vth / Vreset / tref / dt | 250 / 25 / -65 / -50 / -65 / 2 / 0.1 | `LIF_C_PF / LIF_GLEAK_NS / LIF_EL_MV / LIF_VTH_MV / LIF_VRESET_MV / LIF_TREF_MS / LIF_DT_MS` 同值 | pF / nS / mV / mV / mV / ms / ms |
| LIF 流变电流 | 375（导出值 `gL·(Vth-EL)`） | 同式 | pA |
| HH C / gNa / gK / gL | 1 / 120 / 36 / 0.3 | `HH_C_UF_PER_CM2 / HH_GNA_MS_PER_CM2 / HH_GK_MS_PER_CM2 / HH_GL_MS_PER_CM2` 同值 | uF/cm^2 / mS/cm^2 |
| HH ENa / EK / EL / Vrest / dt | 50 / -77 / -54.387 / -65 / 0.025 | `HH_ENA_MV / HH_EK_MV / HH_EL_MV / HH_VREST_MV / HH_DT_MS` 同值 | mV / ms |
| 多房室胞体/顶/基（d×L） | 20×20 / 2×200 / 2×100 | `MULTICOMP` 同值 | um |
| 多房室 Ra / Cm / 漏密度 / E_leak | 100 / 1 / 0.3 / -65 | 同值（`ra_ohm_cm / cm_uf_per_cm2 / g_leak_ms_per_cm2 / e_leak_mv`） | Ohm·cm / uF/cm^2 / mS/cm^2 / mV |
| 多房室 g_axial 顶/基（导出值） | 31.38 / 62.71 | 同式（圆柱几何） | nS |
| 突触 AMPA Erev / alpha tau | 0 / 2 | `SYNAPSE_DEFAULTS['ampa']` 同值 | mV / ms |
| 突触 GABA Erev / alpha tau | -75 / 8 | `SYNAPSE_DEFAULTS['gaba']` 同值 | mV / ms |
| 跨尺度 WC 基线 E0 | 0.011（契约 §4.1 的 WC 静息平均 E） | `WC_BASELINE_E` 同值 | 无量纲 |
| 跨尺度 →LIF 增益 / →HH 增益 | 1000 / 20（假设，未校准） | `WC_TO_LIF_GAIN_PA_PER_E / WC_TO_HH_GAIN_UA_PER_CM2_PER_E` 同值 | pA/单位 E / uA/cm^2/单位 E |
| 反向增益 | 0.002（假设，未校准） | `RATE_TO_P_GAIN_PER_HZ` 同值 | P 单位/Hz |
| 偶极链 N / coherence / Pz 增益 | 1,000,000 / 0.08 / 0.16（沿用 PR5/PR6，未重拟合） | `DIPOLE_N_CELLS / DIPOLE_COHERENCE / PZ_GAIN_UV_PER_NAM` 同值 | 个 / 无量纲 / uV/(nA·m) |

校验：`validateLifParams`（C/gL>0、Vth>Vreset、dt>0）；
`validateHodgkinHuxleyParams`（电容>0、电导≥0、dt≤0.1 ms）；
`validateMulticompMorphology`（全部几何/物理量>0）；
`validateSynapseParams`（gMax≥0、tau>0）；
`wcToLifCurrentPA / wcToHhCurrentDensityUAperCm2` 只接受 E∈[0,1]；
`firingRateToPopulationDriveP` 只接受 rate≥0。
发放检测：膜电位上穿 0 mV（LIF 为步末越阈）。
对照容差（方法学级）：LIF 逐点 1e-9 mV（精确更新，实测差 0.0）；
HH V 0.02 mV、m/h/n 1e-4、gNa/gK 1e-2 mS/cm^2（RK4 dt=0.025 ms
vs DOP853 实测最大差 5.7e-3 mV，dt 减半降 20.4 倍）；
多房室被动 V 1e-3 mV（实测 3.6e-5）、主动 V 0.02 mV、
轴向电流 1 pA（实测 0.25 pA）。
