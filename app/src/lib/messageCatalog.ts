export const messageCatalog: ReadonlyArray<{ zh: string; en: string }> = [
  {
    "zh": "恢复到按住前",
    "en": "Restore before hold"
  },
  {
    "zh": "网络进入了新的稳定状态（不是软件卡住）— 长时间持续输入使全网停在高活动态",
    "en": "Sustained input has moved the network into a new stable, high-activity state. The application is still responding."
  },
  {
    "zh": "按住输入中：全网活动正在上升（平均 E",
    "en": "Input is active. Mean network activity E is"
  },
  {
    "zh": "仿真异常：",
    "en": "Simulation error:"
  },
  {
    "zh": "脑数据加载失败：",
    "en": "Could not load brain data:"
  },
  {
    "zh": "WAVES · 频段 / PSD",
    "en": "Frequency bands and power spectrum"
  },
  {
    "zh": "EXPLORE · 解剖 / 图谱 / 坐标",
    "en": "Brain regions, anatomy and coordinates"
  },
  {
    "zh": "场景 13 可生成独立 Hodgkin–Huxley 演示摘要。进入细胞实验后需重新运行； 场景摘要尚未自动载入实验台（统一实验会话将在 P0-2 实现）。",
    "en": "Scenario 13 produces an independent Hodgkin–Huxley summary. Run the cellular model again inside the lab; opening the lab does not load that scenario's results."
  },
  {
    "zh": "刺激响应 · RESPONSE",
    "en": "Response to the stimulus"
  },
  {
    "zh": "绝对活动：按兴奋活动 E 着色，固定色标——底色 E≈0.011 → 琥珀 E≈0.5。",
    "en": "Color represents excitatory activity E. The fixed scale runs from the resting color at E≈0.011 to amber at E≈0.5."
  },
  {
    "zh": "回放 · REPLAY",
    "en": "Replay"
  },
  {
    "zh": "还没有可回放的响应窗口，先刺激一次。",
    "en": "Apply a stimulus first to record a response."
  },
  {
    "zh": "回放响应窗口",
    "en": "Replay the response"
  },
  {
    "zh": "回到直播",
    "en": "Return to live simulation"
  },
  {
    "zh": "回放只改变观看速度，不改变物理方程；3D 着色与波形都读同一份录制快照。",
    "en": "Replay changes viewing speed only. Brain colors and waveforms use the same recorded snapshots; the equations are not rerun."
  },
  {
    "zh": "响应脑区（阈值 max|ΔE| ≥",
    "en": "Responding regions (threshold max|ΔE| ≥"
  },
  {
    "zh": "尚未刺激，暂无响应列表。",
    "en": "No stimulus has been applied yet."
  },
  {
    "zh": "刺激后窗口内没有脑区超过阈值",
    "en": "No region exceeded the threshold in this response window."
  },
  {
    "zh": "共",
    "en": "Total"
  },
  {
    "zh": "琥珀色环 — 输入位置（刺激点）",
    "en": "Amber ring: where input was applied"
  },
  {
    "zh": "琥珀实心 — 局部响应（被刺激的脑区）",
    "en": "Solid amber: the stimulated region's response"
  },
  {
    "zh": "蓝色小点 — 网络响应（其他响应脑区）",
    "en": "Blue dots: responses elsewhere in the network"
  },
  {
    "zh": "局部响应",
    "en": "Local response"
  },
  {
    "zh": "峰值 ΔE",
    "en": "Peak ΔE"
  },
  {
    "zh": "网络响应",
    "en": "Network response"
  },
  {
    "zh": "背景活动 · BACKGROUND",
    "en": "Background activity"
  },
  {
    "zh": "安静基线：无背景输入，什么都不做时大脑基本静止（平均 E ≈ 0.011）。与改版前行为完全一致。",
    "en": "Quiet mode has no background input. Without stimulation, mean activity stays near E≈0.011, matching the original model."
  },
  {
    "zh": "自发背景：每个脑区持续收到 Ornstein–Uhlenbeck 背景输入 （相关时间 τ =",
    "en": "Spontaneous mode gives each region continuous Ornstein–Uhlenbeck input (correlation time τ ="
  },
  {
    "zh": "振荡（外部驱动）：",
    "en": "Oscillatory mode uses an external drive:"
  },
  {
    "zh": "三种输入的关系：背景是持续输入（本面板）；偏置是你对选中脑区施加的 持续输入（REGION 面板）；脉冲是一次性输入（点击）。三者叠加进同一个 P。",
    "en": "Background input is continuous. A bias is an additional sustained input to the selected region. A click adds a brief pulse. All three contribute to the same input P."
  },
  {
    "zh": "随机种子",
    "en": "Random seed"
  },
  {
    "zh": "种子",
    "en": "Seed"
  },
  {
    "zh": "实验快照 · SNAPSHOT",
    "en": "Save and restore the experiment"
  },
  {
    "zh": "快照保存当前完整实验状态（参数、全部 76×76 权重、偏置、仿真时间、 随机种子与 RNG 状态、OU 状态、E/I、延迟历史），恢复后继续跑的轨迹 与不恢复完全一致。",
    "en": "A snapshot saves parameters, all 76×76 weights, biases, model time, random seed and generator state, OU state, E/I and delay history. Restoring it reproduces the continuation of the original trajectory."
  },
  {
    "zh": "保存快照",
    "en": "Save snapshot"
  },
  {
    "zh": "恢复手动快照",
    "en": "Restore saved snapshot"
  },
  {
    "zh": "点击与按住的区分：静止按住 300 ms 触发持续输入；移动超过 6 px 视为拖动（旋转），不触发刺激；一次短于 300 ms 的点击即使在慢机器上 也不会变成按住。",
    "en": "Hold still for 300 ms to apply continuous input. Moving more than 6 px rotates the view without stimulating. A click shorter than 300 ms remains a click even on a slow device."
  },
  {
    "zh": "点击大脑选择一个脑区，查看名称与主要连接。",
    "en": "Select a region on the brain to inspect its name and connections."
  },
  {
    "zh": "编号",
    "en": "ID"
  },
  {
    "zh": "中心坐标",
    "en": "Center coordinates"
  },
  {
    "zh": "皮层面积",
    "en": "Cortical area"
  },
  {
    "zh": "兴奋活动 E",
    "en": "Excitatory activity E"
  },
  {
    "zh": "抑制活动 I",
    "en": "Inhibitory activity I"
  },
  {
    "zh": "外部输入 P",
    "en": "External input P"
  },
  {
    "zh": "持续偏置",
    "en": "Sustained bias"
  },
  {
    "zh": "按住输入中",
    "en": "Continuous input active"
  },
  {
    "zh": "主要连接（按权重前 5）· 可编辑",
    "en": "Five strongest connections · editable"
  },
  {
    "zh": "该脑区无权重 &gt; 0 的连接。",
    "en": "This region has no connections with weight greater than zero."
  },
  {
    "zh": "已修改",
    "en": "Modified"
  },
  {
    "zh": "当前",
    "en": "Current"
  },
  {
    "zh": "恢复原始值",
    "en": "Restore original"
  },
  {
    "zh": "恢复全部原始值（",
    "en": "Restore all originals ("
  },
  {
    "zh": "权重范围 0–3，越界自动 clamp 到边界。单边修改：只改「来源脑区 → 选中脑区」这一方向，不改反向；TVB 原始矩阵基本对称但不完全对称 （最大差 3.0）。RESET 恢复仿真状态，但保留已改权重；权重只能用恢复 动作改回。当前权重可能已被用户修改，不再是 TVB 原始数据。",
    "en": "Weights range from 0 to 3; values outside this range are clamped. An edit changes only the source→selected direction. The reverse connection is unchanged. The original TVB matrix is approximately symmetric, with a maximum directional difference of 3.0. Reset preserves weight edits; use the restore controls to recover the original matrix."
  },
  {
    "zh": "持续偏置输入 · BIAS（不是点击脉冲）",
    "en": "Sustained input bias"
  },
  {
    "zh": "持续偏置：加到 Wilson–Cowan 输入项上的持续量，开着就一直生效， 直到关掉或归零；与「点击刺激」脉冲不同——脉冲只持续 20–500 ms。 范围 −1.0–+1.0，开启默认值 +0.50。正值兴奋（抬高该脑区 E）， 负值抑制（压低 E）。3D 图中以紫色八面体标记（与脉冲的琥珀色环不同）。",
    "en": "A bias remains active until switched off or set to zero. Unlike a 20–500 ms click pulse, it continuously changes the Wilson–Cowan input. Its range is −1 to +1, with +0.50 when enabled. Positive values increase activity; negative values reduce it. Purple octahedra distinguish biases from amber pulse rings."
  },
  {
    "zh": "偏置",
    "en": "Bias"
  },
  {
    "zh": "当前：",
    "en": "Current:"
  },
  {
    "zh": "连接线为结构连接示意，不是白质纤维追踪结果。 权重单位 au，长度单位 mm。",
    "en": "Connection lines illustrate structural connectivity, not reconstructed white-matter fibers. Weights use arbitrary units; lengths use millimeters."
  },
  {
    "zh": "更多",
    "en": "More"
  },
  {
    "zh": "具体参数、数学模型、单位、背景活动、脑区与连接细节收在这里。 点“更多”展开；顶栏的“更多”开关也能开合。",
    "en": "Open the advanced controls for model parameters, units, background activity and connection details."
  },
  {
    "zh": "展开更多：参数、背景活动、脑区与连接",
    "en": "Show parameters, background and connections"
  },
  {
    "zh": "点击刺激 · 按住持续输入 · 拖动旋转 · 滚轮缩放 · 双击背景恢复视角",
    "en": "Click to stimulate · hold for continuous input · drag to rotate · scroll to zoom · double-click the background to reset the view"
  },
  {
    "zh": "关闭",
    "en": "Close"
  },
  {
    "zh": "球形正向模型未加载（",
    "en": "Spherical forward model unavailable ("
  },
  {
    "zh": "模型信息 — 这是什么",
    "en": "About this model"
  },
  {
    "zh": "连接组 · Demo Connectome（演示用连接组）",
    "en": "Demonstration connectome"
  },
  {
    "zh": "76 区连接矩阵来自 The Virtual Brain 示例数据 connectivity_76。 权重主要来自猕猴 CoCoMac 神经示踪数据；胼胝体连接是人类 DSI 纤维束宽度缩放后填入的双半球混合矩阵；皮层下结构未包含。 这不是某个真人的 MRI / 扩散 MRI 测得的个体化连接网络。 TVB 官方声明：该数据集“为数值测试与理论探索定制， 生物物理真实性有限，不应以此为依据”。",
    "en": "The 76-region matrix comes from The Virtual Brain's connectivity_76 example. Most weights derive from macaque CoCoMac tracer data; callosal connections use scaled human DSI tract widths. Subcortical structures are absent. This hybrid demonstration is not an individual human MRI connectome. TVB describes it as a dataset for numerical tests and theoretical exploration with limited biophysical realism."
  },
  {
    "zh": "直接操纵 · 当前权重可能已被修改",
    "en": "Editable connections"
  },
  {
    "zh": "连接权重可编辑：选中脑区的主要连接可逐条改权重（0–3，单边： 只改来源脑区 → 选中脑区的方向，不改反向）。改过的权重标「已修改」 并与 TVB 原始值并列显示，可单条或全部恢复。RESET 恢复仿真状态， 但保留已改权重；当前权重可能已被用户修改，不再是 TVB 原始数据。",
    "en": "Edit an individual source→selected connection from 0 to 3. The reverse direction is unchanged. Modified weights appear alongside their original TVB values. Restore weights individually or together. Reset clears simulation state but keeps weight edits, so the current matrix may differ from the original dataset."
  },
  {
    "zh": "持续偏置输入：对选中脑区可加持续的正（兴奋）/负（抑制）偏置 （−1–+1，开启默认 +0.50），加到 Wilson–Cowan 输入项上直到关掉 或归零；与点击脉冲不同。RESET 清除偏置输入。刺激标记画在鼠标 实际触碰的皮层表面点上，不再是脑区中心。",
    "en": "Apply a sustained bias from −1 to +1 to the selected region; enabling it starts at +0.50. It remains active until cleared, whereas a click adds only a pulse. Reset clears biases. Stimulus markers appear at the actual cortical contact point rather than at the region center."
  },
  {
    "zh": "皮层网格",
    "en": "Cortical mesh"
  },
  {
    "zh": "16,384 顶点皮层网格同样来自 TVB 示例数据 cortex_16384， 与连接矩阵配套对齐。",
    "en": "The 16,384-vertex mesh comes from TVB's cortex_16384 example and is aligned with the demonstration connectivity matrix."
  },
  {
    "zh": "模型 · 最终定位：教学仿真",
    "en": "An educational simulation"
  },
  {
    "zh": "Wilson–Cowan 兴奋 / 抑制神经群体模型，是神经群体平均活动的 现象学模型，不是第一性原理求解器。这里模拟的是该模型在上述 演示连接组上的行为，不代表真实人脑的客观反应。",
    "en": "The Wilson–Cowan model describes average activity in excitatory and inhibitory neural populations. It is a phenomenological model, not a first-principles brain solver. The displayed responses belong to this model and demonstration connectome, not to an actual human brain."
  },
  {
    "zh": "最终定位（PR8）：教学仿真。本产品的全部 EEG / ERP 输出均为 未校准的模型演示，不是真实人脑的预测、不是临床测量、不是 个体脑电的复现。未校准的模型结果不得在任何一处被表述为真实 人脑参数或真实人脑预测。",
    "en": "All EEG and ERP outputs are uncalibrated educational simulations. They are not clinical measurements, subject-specific EEG reconstructions or predictions of human brain activity."
  },
  {
    "zh": "已知限制 · 实测数字（公开 EEG 约束 ds003061 sub-001 run-1）",
    "en": "Known numerical limitations · public EEG comparison ds003061 sub-001 run-1"
  },
  {
    "zh": "幅度缺口：oddball P300 峰值模型 0.174 µV @352 ms vs 真实 8.89 µV @410 ms，差 51 倍。300–500 ms 窗内均值模型 0.070 µV vs 真实 6.94 µV，差 99 倍；差异波峰 0.166 vs 9.14 µV，差 55 倍。形态与潜伏期已修好（oddball 选择性 8.1×、峰在窗内）， 幅度没修好：调增益只会把柱子推上锁存分支，峰值天花板约 0.21 µV。",
    "en": "The model's oddball P300 peak is 0.174 µV at 352 ms, versus 8.89 µV at 410 ms in the reference data: a 51-fold amplitude gap. The 300–500 ms mean is 0.070 versus 6.94 µV (99-fold); the difference-wave peak is 0.166 versus 9.14 µV (55-fold). Morphology and latency improved, with 8.1× oddball selectivity, but amplitude did not. Increasing gain causes latching; the peak ceiling is about 0.21 µV."
  },
  {
    "zh": "基线 RMS 仍为 0：模型刺激前 RMS 0 vs 真实 Pz 6.07 µV；JR p0=220 极限环 Pz RMS 0.017 µV，差约 360 倍。Alpha 功率占比 虚高：纯极限环 99.8% vs 真实 Pz 30.3% / Oz 69.3%（模型缺宽带 背景；频率对上量级，10.99 vs 10.00 Hz，占比数字不能直接比）。",
    "en": "Prestimulus RMS remains zero, versus 6.07 µV at Pz in the reference. The JR p0=220 limit cycle has Pz RMS 0.017 µV, about 360-fold smaller. Its alpha fraction is 99.8%, compared with Pz 30.3% and Oz 69.3%. The model lacks broadband background; matching the approximate frequency (10.99 versus 10.00 Hz) does not validate these power fractions."
  },
  {
    "zh": "源定位深度偏置：无噪声深源 plain 55.43 → dSPM 0.00 mm，但浅源 dSPM 变坏到 55.43 mm；有噪声深源 depth 96.00 mm 比 plain 78.38 mm 更差——没有一种方法同时修好深浅两端。MNE 峰值幅度被 压缩：真值 10 nA·m 时峰值只有 0.36–5.26 nA·m（λ²=1/9 时为真值 的 4–53%），不得把峰值读作真值幅度。偶极矩假设链（N=1,000,000、 c=0.08、200/100 pA、0.5 mm）全是假设、未校准，幅度与绝对 µV 值没有任何实测约束。",
    "en": "Depth bias remains: for a noiseless deep source, plain MNE error is 55.43 mm and dSPM gives 0.00 mm, while shallow-source dSPM worsens to 55.43 mm. With noise, depth weighting gives 96.00 mm versus plain 78.38 mm. No method fixes both ends. MNE peaks are regularized: a true 10 nA·m appears as 0.36–5.26 nA·m, or 4–53% at λ²=1/9. Source assumptions (N=1,000,000; coherence 0.08; currents 200/100 pA; separation 0.5 mm) are uncalibrated. Neither peak moment nor absolute voltage is an empirically validated human value."
  },
  {
    "zh": "默认预设",
    "en": "Default preset"
  },
  {
    "zh": "演示预设为 TVB A-set 只改 θ_e（0 → 1.0），全局耦合 G = 0.35。 纯 A-set 本身是双稳态的，保留在代码里作参考配置。",
    "en": "The demonstration changes only θ_e from 0 to 1.0 in TVB A-set, using global coupling G=0.35. The original bistable A-set remains in the code as a reference."
  },
  {
    "zh": "背景活动 · 三档（PR4）",
    "en": "Three background modes"
  },
  {
    "zh": "安静（Quiet）：无背景输入，与改版前行为完全一致。默认是自发 （Spontaneous）：每脑区持续收到 Ornstein–Uhlenbeck 背景输入， 相关时间 τ = 100 ms、幅度 σ = 0.10（模型单位 P），OU 状态在 引擎内每步更新一次；同一随机种子（默认 0）重跑，活动序列逐值相同。 默认参数下连续运行 60 秒仿真时间不锁死、不发散（三个种子实测 最大平均 E ≤ 0.017，锁定阈值 0.15；演示脑区 40 的标准脉冲在 三个种子 × 八个点击时刻上 24 次全部恢复，节点活动标准差中位数 约 0.002）。但要注意：翻转概率取决于被点脑区——Quiet 下 （零背景）脑区 0/10/20/30/54/55/59/60 的标准脉冲同样会把全网 翻进高活动态（网络本身双稳态，PR4 之前就有），背景只多加了 一个边界脑区 69（约一半点击翻转）。锁住后横幅上有 RESET 一键恢复。",
    "en": "Quiet mode has no background input. The default spontaneous mode applies Ornstein–Uhlenbeck input to each region with τ=100 ms and σ=0.10 model units. Its state updates at every engine step, and seed 0 reproduces identical samples. In three-seed, 60-second runs, mean E stayed at or below 0.017 without divergence or locking (lock threshold 0.15). All 24 standard pulses to region 40 recovered across three seeds and eight timings; median node activity SD was about 0.002. Switching probability still depends on the region: even without background, pulses to regions 0/10/20/30/54/55/59/60 can switch this bistable network into high activity. Background added boundary region 69, where about half the tested clicks switched state. Use reset or restore to recover."
  },
  {
    "zh": "振荡（Oscillatory）：10 Hz 正弦外部驱动（幅度 0.30，全脑同相）， 实测平均 E 在 0.0113–0.0211 之间以 10.00 Hz 振荡（FFT 峰值）， 60 秒最大平均 E 0.021，脉冲叠加其上仍有完整响应（峰值 |ΔE| 0.48， 之后回到基线；四个正弦相位上点击都恢复）。这是明确标注 的外部驱动信号，不是自发节律——参数扫描证实，本 Wilson–Cowan 参数族里没有稳定的自发极限环：全部候选（含 TVB Table 1 那套 “20 Hz 振荡参数”，有/无恒定驱动 P 0.2–1.0，从各个初值出发） 单节点与 76 区网络都收敛到不动点；Table 1 本身收敛到高活动 不动点（单节点 E*≈0.32、网络平均 E*≈0.49），接近锁定态， 故不采用。另注意：OU 幅度不是越大越好——0.20 在 1.3–35.9 秒内 自己锁死，0.15 在固定点击时刻看着安全、换八个点击时刻就有 2/24 次点击把网络翻进高活动态（点击瞬间的 OU 状态决定结果）， 正弦幅度 0.50 下脉冲也锁死；所以默认值取的是三项安全检查 （60 秒空跑、固定时刻脉冲、八个时刻 × 三个种子脉冲）全过的 最大幅度。",
    "en": "Oscillatory mode applies a 10 Hz sinusoid of amplitude 0.30 in phase across regions. Mean E ranged from 0.0113 to 0.0211, with a 10.00 Hz FFT peak. The 60-second maximum was 0.021; pulses retained a full response (peak |ΔE|≈0.48) and recovered at all four phases. This rhythm is externally driven. Scans found no stable spontaneous limit cycle in this Wilson–Cowan parameter family: candidates, including TVB Table 1 settings, converged to fixed points in both single-node and 76-region models. Table 1 approached high-activity fixed points (single E*≈0.32; network E*≈0.49), so it is not used. Larger inputs were unstable: OU σ=0.20 locked within 1.3–35.9 s; σ=0.15 switched in 2/24 pulse tests; a 0.50 sinusoid also locked. Defaults use the largest tested amplitudes that passed the 60-second, fixed-timing and three-seed/eight-timing checks."
  },
  {
    "zh": "实验快照：保存当前完整实验状态（参数、全部 76×76 权重、偏置、 仿真时间、随机种子与 RNG 状态、OU 状态、E/I、延迟历史），恢复后 继续跑的轨迹与不恢复逐值一致。手动快照存在浏览器 localStorage 里（brainrun.snapshot.manual.v1），关掉页面还在，RESET 不清； 自动快照只在内存里，每次按住开始时存按住前状态，RESET 时清掉， 绝不覆盖手动快照。长按预警：按住中平均 E 超过 0.05 时提前提示， 锁定（平均 E 持续 500 ms 超过 0.15）是网络进入了新的稳定状态， 不是软件卡住；松开即停输入，一键可恢复到按住前。",
    "en": "Snapshots contain parameters, the full 76×76 weight matrix, biases, model time, random seed and generator state, OU state, E/I and delay history. A restored run continues identically. Manual snapshots persist in browser storage under brainrun.snapshot.manual.v1 and survive reset. Automatic snapshots stay in memory, capture the state before each hold and are cleared on reset; they never overwrite manual saves. A hold warning appears above mean E=0.05. Mean E above 0.15 for 500 ms signals a stable high-activity state, not an application freeze. Release to stop input; restore to return to the pre-hold state."
  },
  {
    "zh": "引用与许可",
    "en": "References and licenses"
  },
  {
    "zh": "Sanz-Leon et al. 2013, Front. Neuroinform. 7:10。 数据许可核查见仓库 docs/data-license.md； 代码 MIT，第三方说明见 NOTICE.md。",
    "en": "Sanz-Leon et al. (2013), Frontiers in Neuroinformatics 7:10. Data-license review: docs/data-license.md. Code: MIT. Third-party notices: NOTICE.md."
  },
  {
    "zh": "知道了",
    "en": "Got it"
  },
  {
    "zh": "减小",
    "en": "Decrease"
  },
  {
    "zh": "拖动改值 · 双击恢复原始值",
    "en": "Drag to change · double-click to restore"
  },
  {
    "zh": "增大",
    "en": "Increase"
  },
  {
    "zh": "模型资源缺失：请先运行 scientific/forward/generate_sphere_model.py",
    "en": "Model assets are missing. Run scientific/forward/generate_sphere_model.py."
  },
  {
    "zh": "正在保存快照…",
    "en": "Saving snapshot…"
  },
  {
    "zh": "快照保存失败",
    "en": "Could not save the snapshot."
  },
  {
    "zh": "正在恢复快照…",
    "en": "Restoring snapshot…"
  },
  {
    "zh": "没有可恢复的快照",
    "en": "No saved snapshot is available."
  },
  {
    "zh": "仿真引擎未就绪",
    "en": "The simulation is not ready."
  },
  {
    "zh": "无基线/窗口",
    "en": "No baseline or response window"
  },
  {
    "zh": "无",
    "en": "None"
  },
  {
    "zh": "暂无响应窗口",
    "en": "No response recorded yet"
  },
  {
    "zh": "仿真引擎未就绪（WASM 加载中或加载失败）",
    "en": "The simulation is loading or could not start."
  },
  {
    "zh": "40 号脑区峰值 ΔE",
    "en": "Region 40 peak ΔE"
  },
  {
    "zh": "响应脑区数",
    "en": "Responding regions"
  },
  {
    "zh": "个",
    "en": "regions"
  },
  {
    "zh": "脉冲 40 号脑区（真实引擎动作）；峰值 ΔE 见 RESPONSE 面板。",
    "en": "A real model pulse was applied to region 40. Read its peak ΔE in the response panel."
  },
  {
    "zh": "脑数据未加载",
    "en": "Brain data are not loaded."
  },
  {
    "zh": "73 号脑区峰值 ΔE（权重 0）",
    "en": "Region 73 peak ΔE (weight 0)"
  },
  {
    "zh": "73→54 原始权重",
    "en": "Original weight 73→54"
  },
  {
    "zh": "73→54 权重改 0 后脉冲 73 号脑区；权重随后已恢复原始值。",
    "en": "Connection 73→54 was set to zero, then region 73 was stimulated. The original weight was restored afterward."
  },
  {
    "zh": "40 号脑区峰值 ΔE（c_ei=6）",
    "en": "Region 40 peak ΔE (c_ei=6)"
  },
  {
    "zh": "c_ei 由 4.0 改为 6.0 后脉冲 40 号脑区；改完的 c_ei=6.0 留在 PARAMETERS 面板，可手动改回 4.0。",
    "en": "c_ei changed from 4.0 to 6.0 before stimulating region 40. The new value remains active; restore it manually to 4.0."
  },
  {
    "zh": "球形正向模型未加载：请先运行 scientific/forward/generate_sphere_model.py 生成 app/public/forward-assets/sphere-model.json",
    "en": "The spherical forward model is unavailable. Generate app/public/forward-assets/sphere-model.json with scientific/forward/generate_sphere_model.py."
  },
  {
    "zh": "Worker 确认的实验会话 ID 与模型时间；不是 EEG 采样率",
    "en": "Worker-confirmed run identity and model time; this is not an EEG sampling rate."
  },
  {
    "zh": "模式",
    "en": "Workspace mode"
  },
  {
    "zh": "渐进式展示：默认只显示 3D 大脑、少量控制、实时测量窗口和简单说明；点“更多”展开具体参数、数学模型、单位、频段设置、电极参考、源定位算法与模型假设",
    "en": "Show model parameters, equations, units, frequency bands, electrode references, source-localization algorithms and assumptions."
  },
  {
    "zh": "一键科学场景：15 个可运行的预设实验，每个都跑真实计算并追加实验记录",
    "en": "Fifteen preset experiments run actual model calculations and save their results."
  },
  {
    "zh": "暂停 / 继续仿真时钟（模型时间冻结，画面不动）",
    "en": "Pause or resume model time"
  },
  {
    "zh": "仿真引擎加载中…",
    "en": "Starting the simulation…"
  },
  {
    "zh": "显示 / 隐藏选中脑区的主要连接弧线",
    "en": "Show or hide the selected region's main connections"
  },
  {
    "zh": "显示",
    "en": "Show"
  },
  {
    "zh": "隐藏",
    "en": "Hide"
  },
  {
    "zh": "恢复仿真状态、清除刺激与偏置输入；保留已改连接权重（权重只能用恢复动作改回）",
    "en": "Reset model state and clear stimuli and biases. Edited weights are retained until restored separately."
  },
  {
    "zh": "MNE 四层球形头模型，源与标准电极产生实时模拟 EEG 电位",
    "en": "Four-layer spherical head model with simulated sources and standard EEG electrodes."
  },
  {
    "zh": "EEG 实验含独立柱模型记录和直播快照推导；late ERP 可另生独立试次，地形右侧源另算。并非所有视图同一次实验（P0-4 待完成）。",
    "en": "EEG analysis supports independent column recordings and live-snapshot derivation. The separate forward-source demonstration is labeled explicitly; not every view represents the same physical experiment."
  },
  {
    "zh": "独立的均匀无限导体电流偶极子物理实验，不是 BEM EEG",
    "en": "Independent current-dipole experiment in a homogeneous infinite conductor; not a BEM EEG model."
  },
  {
    "zh": "细胞级实验台：LIF、Hodgkin–Huxley、多房室神经元与跨尺度耦合（PR-13）",
    "en": "Cellular models: LIF, Hodgkin–Huxley, multicompartment neurons and assumed cross-scale coupling."
  },
  {
    "zh": "脑刺激实验室：TES/TMS 电场与感觉输入，按物理完备程度分级（PR-14）",
    "en": "Stimulation models: TES/TMS fields and sensory inputs, with explicit levels of physical completeness."
  },
  {
    "zh": "对照实验：双脑 A/B、时间机器、闭环控制（PR-15）",
    "en": "Compare two models, replay saved states or explore simulated feedback control."
  },
  {
    "zh": "模型、数据来源与许可说明",
    "en": "Model assumptions, data sources and licenses"
  },
  {
    "zh": "按兴奋活动 E 着色（固定色标：底色 E≈0.011 → 琥珀 E≈0.5）",
    "en": "Color by excitatory activity E, from baseline E≈0.011 to amber at E≈0.5."
  },
  {
    "zh": "相机自动缓慢旋转（只是相机运动，不是神经活动）",
    "en": "Rotate the camera slowly; this changes the view, not neural activity."
  },
  {
    "zh": "恢复到这次按住开始前的完整状态",
    "en": "Restore the complete model state saved before this hold."
  },
  {
    "zh": "恢复仿真状态",
    "en": "Reset the simulation"
  },
  {
    "zh": "离锁定还有多远",
    "en": "Progress toward the lock threshold"
  },
  {
    "zh": "运行一键场景 4：JR p0=220 极限环跑 12 s，生成 Pz 记录供下方的 WavesTab 分析",
    "en": "Run a 12-second JR p0=220 limit cycle and analyze the resulting Pz recording."
  },
  {
    "zh": "运行中…",
    "en": "Running…"
  },
  {
    "zh": "运行场景 4：产生 Alpha 记录",
    "en": "Generate an alpha recording"
  },
  {
    "zh": "着色视图",
    "en": "Color display"
  },
  {
    "zh": "尚未刺激 — 点击大脑触发一次刺激后，这里显示基线与响应。",
    "en": "Click a brain region to apply input. Its baseline and measured model response will appear here."
  },
  {
    "zh": "从窗口起点回放录下来的快照（不重算）",
    "en": "Replay the recorded window from the start without recomputing it"
  },
  {
    "zh": "暂停",
    "en": "Pause"
  },
  {
    "zh": "继续播放",
    "en": "Resume"
  },
  {
    "zh": "回放速度",
    "en": "Playback speed"
  },
  {
    "zh": "回放进度",
    "en": "Playback position"
  },
  {
    "zh": "背景活动模式",
    "en": "Background mode"
  },
  {
    "zh": "安静 Quiet",
    "en": "Quiet"
  },
  {
    "zh": "自发 Spontaneous",
    "en": "Spontaneous"
  },
  {
    "zh": "振荡 Oscillatory",
    "en": "Externally driven oscillation"
  },
  {
    "zh": "安静基线：无背景输入，与改版前行为完全一致",
    "en": "Quiet baseline without background input"
  },
  {
    "zh": "自发背景：每脑区持续收到 Ornstein–Uhlenbeck 背景输入，活动来自模型计算",
    "en": "Each region receives continuous Ornstein–Uhlenbeck input; the model computes the resulting activity."
  },
  {
    "zh": "振荡：10 Hz 正弦外部驱动（明确标注的外部驱动信号，不是自发节律）",
    "en": "An external 10 Hz sinusoid drives the model; this is not a spontaneous rhythm."
  },
  {
    "zh": "换种子后从下一刻起按新种子抽取；要点 RESET 才能从头按新种子重跑",
    "en": "New random draws use the new seed immediately. Reset to rerun from the beginning with that seed."
  },
  {
    "zh": "手动保存当前状态到浏览器 localStorage（关掉页面还在，RESET 不清）",
    "en": "Save the current state in this browser; it survives closing the page and resetting."
  },
  {
    "zh": "恢复手动保存的快照",
    "en": "Restore the manually saved state"
  },
  {
    "zh": "恢复这次按住开始前的状态",
    "en": "Restore the state before the current hold"
  },
  {
    "zh": "手动快照：尚未保存",
    "en": "Manual snapshot: none saved"
  },
  {
    "zh": "自动快照：尚未按住（按住开始时自动存按住前状态）",
    "en": "Automatic snapshot: hold a region to save its preceding state"
  },
  {
    "zh": "刺激强度",
    "en": "Stimulus strength"
  },
  {
    "zh": "持续时间",
    "en": "Duration"
  },
  {
    "zh": "兴奋 / 抑制",
    "en": "Excitation / inhibition"
  },
  {
    "zh": "连接强度",
    "en": "Connection strength"
  },
  {
    "zh": "参数控件已接入 Wilson–Cowan 引擎 · 改动从下一步仿真开始生效",
    "en": "These controls change the Wilson–Cowan engine from its next integration step."
  },
  {
    "zh": "仿真引擎加载中，参数暂不可用…",
    "en": "The simulation is loading; parameters are not available yet."
  },
  {
    "zh": "兴奋",
    "en": "Excitation"
  },
  {
    "zh": "抑制",
    "en": "Inhibition"
  },
  {
    "zh": "开",
    "en": "On"
  },
  {
    "zh": "关",
    "en": "Off"
  },
  {
    "zh": "无偏置",
    "en": "No bias"
  },
  {
    "zh": "网络进入了新的稳定状态 — 可恢复到按住前",
    "en": "The network reached a new stable state. Restore the state before the hold to recover."
  },
  {
    "zh": "细胞级实验",
    "en": "Cellular simulation"
  },
  {
    "zh": "对照实验",
    "en": "Comparisons"
  },
  {
    "zh": "模型信息",
    "en": "Model information"
  },
  {
    "zh": "纵轴为神经群体活动（任意单位），不是微伏级 EEG 电压。",
    "en": "The vertical axis shows neural population activity in arbitrary units, not scalp EEG voltage in microvolts."
  },
  {
    "zh": "点击大脑选择一个脑区",
    "en": "Select a region on the brain"
  },
  {
    "zh": "回放窗口收集中…",
    "en": "Collecting the replay window…"
  },
  {
    "zh": "等待仿真数据…",
    "en": "Waiting for model data…"
  },
  {
    "zh": "将鼠标移到大脑上查看脑区",
    "en": "Hover over the brain to identify a region"
  },
  {
    "zh": "横轴 0–",
    "en": "Horizontal axis: 0–"
  },
  {
    "zh": "细胞级实验台（CellularLab）—— PR-13",
    "en": "Cellular models"
  },
  {
    "zh": "多尺度说明：从全脑放大到这里时，系统切换到真实的细胞级仿真模型， 不是把全脑动画放大。LIF / HH / 多房室三个模型各自独立求解； Wilson–Cowan / Jansen–Rit 原样保留，不同模型里同名变量不混淆 （JR 的 y0 是锥体群体突触后电位 mV，HH 的 V 是单神经元膜电位 mV）。",
    "en": "This lab runs actual cellular equations rather than enlarging the brain animation. LIF, HH and multicompartment neurons are independent solvers. Wilson–Cowan and Jansen–Rit remain separate models. Similarly named variables retain their meanings: JR y0 is a population postsynaptic potential; HH V is a single-neuron membrane potential, both in mV."
  },
  {
    "zh": "模型：",
    "en": "Model:"
  },
  {
    "zh": "多房室神经元",
    "en": "Multicompartment neuron"
  },
  {
    "zh": "脉冲电流（100–300 ms）：",
    "en": "Current pulse (100–300 ms):"
  },
  {
    "zh": "Hodgkin–Huxley 1952：C=1 uF/cm^2，gNa=120，gK=36，gL=0.3 mS/cm^2， ENa=+50 mV，EK=-77 mV，EL=-54.387 mV，静息 -65 mV，RK4 步长 0.025 ms。",
    "en": "Hodgkin–Huxley (1952): C=1 µF/cm²; gNa=120, gK=36, gL=0.3 mS/cm²; ENa=+50, EK=−77, EL=−54.387 mV. Resting voltage −65 mV; RK4 time step 0.025 ms."
  },
  {
    "zh": "阶跃电流（10–60 ms）：",
    "en": "Step current (10–60 ms):"
  },
  {
    "zh": "注入位置：",
    "en": "Injection site:"
  },
  {
    "zh": "胞体",
    "en": "Cell body"
  },
  {
    "zh": "顶树突",
    "en": "Apical dendrite"
  },
  {
    "zh": "基树突",
    "en": "Basal dendrite"
  },
  {
    "zh": "脉冲电流（10–12 ms）：",
    "en": "Current pulse (10–12 ms):"
  },
  {
    "zh": "运行仿真",
    "en": "Run simulation"
  },
  {
    "zh": "模型/输入更改后，运行求解器才会生成新曲线；旧结果已清除。",
    "en": "Inputs changed. Run the solver to generate a new trace; the previous result was cleared."
  },
  {
    "zh": "发放",
    "en": "Spikes"
  },
  {
    "zh": "跨尺度耦合（假设，未校准）",
    "en": "Assumed cross-scale coupling · uncalibrated"
  },
  {
    "zh": "前向：脑区活动 E（无量纲，静息均值 E0=0.011）→ 细胞注入电流， 线性映射 I = 增益 × (E − E0)。LIF 增益 1000 pA/单位 E； HH 增益 20 uA/cm^2/单位 E——两套模型单位不同，增益分开给， 各自的数都写清；增益是假设，不是拟合值。",
    "en": "Forward mapping: regional activity E, with resting mean E0=0.011, becomes injected current I=gain×(E−E0). LIF uses 1000 pA per E unit; HH uses 20 µA/cm² per E unit. These are separate assumed gains for different units, not fitted human parameters."
  },
  {
    "zh": "用该电流跑 LIF",
    "en": "Run LIF with this current"
  },
  {
    "zh": "用该电流跑 HH",
    "en": "Run HH with this current"
  },
  {
    "zh": "上方两个按钮会立即运行独立细胞求解器并更新膜电位曲线；不会自动改动主大脑。 只有明确点击下方“把 dP 应用回主仿真”才会写入主仿真的偏置（耦合增益未校准）。",
    "en": "These buttons run the independent cellular solver and update its voltage trace. They do not alter the main brain model. Only the explicit bias-application button below writes dP back; the coupling gain is uncalibrated."
  },
  {
    "zh": "反向：细胞发放率 → 群体驱动 dP = 0.002 × 发放率（P 单位/Hz，假设）。",
    "en": "Reverse mapping: firing rate becomes population input dP=0.002×rate, in model input units per Hz. This gain is assumed."
  },
  {
    "zh": "把 dP 应用回主仿真（偏置）",
    "en": "Apply dP to the main model as a bias"
  },
  {
    "zh": "已应用偏置",
    "en": "Bias applied"
  },
  {
    "zh": "细胞路线对 PR6 幅度缺口能说什么（实时计算，不重缩放）",
    "en": "What cellular modeling reveals about the amplitude gap"
  },
  {
    "zh": "问题：oddball P300 真实峰值 8.89 uV，需要偶极矩 55.56 nA·m； JR 路线只给出 1.09 nA·m（0.174 uV）。细胞路线用多房室模型的 胞体–顶树突轴向电流 × 几何间距 0.11 mm 算单细胞偶极矩， 再按 PR5 假设外推到 80,000 个同步锥体细胞、Pz 增益 0.16 uV/(nA·m)。",
    "en": "The reference oddball P300 peak is 8.89 µV, requiring 55.56 nA·m under the assumed gain. JR produces 1.09 nA·m (0.174 µV). The cellular route computes a single-cell dipole from soma–apical axial current and 0.11 mm separation, then assumes 80,000 synchronous pyramidal cells and a Pz gain of 0.16 µV/(nA·m)."
  },
  {
    "zh": "计算细胞路线幅度",
    "en": "Calculate cellular amplitude"
  },
  {
    "zh": "持续 PSP（75 pA 顶树突驱动，300–500 ms 均值）：被动胞体",
    "en": "Sustained PSP (75 pA apical drive, mean over 300–500 ms): passive cell body"
  },
  {
    "zh": "同步动作电位齐射峰值：",
    "en": "Peak synchronized spike volley:"
  },
  {
    "zh": "结论：细胞路线没有弥合缺口——持续 PSP 路线距真实值差 110–150 倍， 与 JR 路线同量级；缺口在群体规模/同步性/校准，不在模型类别。 数字见 docs/pr7-cellular.md §5。",
    "en": "The cellular route does not close the gap. Sustained PSP amplitude remains 110–150 times below the reference, similar in scale to JR. Population size, synchrony and calibration remain unresolved; changing model category alone does not fix them. See docs/pr7-cellular.md §5."
  },
  {
    "zh": "点“计算细胞路线幅度”后实时跑两段多房室仿真并给出数字。",
    "en": "Run the calculation to compare two multicompartment simulations."
  },
  {
    "zh": "突触驱动：100 ms 一发 AMPA（gMax 2 nS）、200 ms 一发 GABA（gMax 2 nS），",
    "en": "Synaptic input: one AMPA event at 100 ms and one GABA event at 200 ms, each with maximum conductance 2 nS."
  },
  {
    "zh": "无恒定注入电流。AMPA 去极化、GABA 超极化。",
    "en": "No constant injected current. AMPA depolarizes; GABA hyperpolarizes."
  },
  {
    "zh": "静息 -65 mV，锋电位峰值约 +40 mV。",
    "en": "Resting voltage −65 mV; spike peak about +40 mV."
  },
  {
    "zh": "轴向电导由几何算出（顶树突 31.38 nS）。",
    "en": "Axial conductance is computed from geometry (apical: 31.38 nS)."
  },
  {
    "zh": "膜电位",
    "en": "Membrane potential"
  },
  {
    "zh": "顶树突膜电位",
    "en": "Apical membrane potential"
  },
  {
    "zh": "基树突膜电位",
    "en": "Basal membrane potential"
  },
  {
    "zh": "Na 电导 gNa",
    "en": "Sodium conductance gNa"
  },
  {
    "zh": "K 电导 gK",
    "en": "Potassium conductance gK"
  },
  {
    "zh": "前向输入：未选脑区——先在主界面点一个脑区，E 取该脑区的直播值（约 15 Hz 更新）；这里不再手填 E。",
    "en": "Select a region in the main view to use its live E value, updated about 15 times per second. E is no longer entered manually."
  },
  {
    "zh": "先运行一次仿真，这里显示反向映射的 dP。",
    "en": "Run a simulation to inspect the resulting dP."
  },
  {
    "zh": "把 dP 经 App 的 handleBiasChange 真实应用回主仿真（setBias），不是只显示",
    "en": "Apply dP to the main simulation as an actual bias, not a display-only value"
  },
  {
    "zh": "直播源：#",
    "en": "Live source: region #"
  },
  {
    "zh": "独立演示：手动偶极子，未接主仿真（拖动源 / 改偶极矩只改本实验；想接直播先在主界面选一个脑区，再勾选“直播源”）。",
    "en": "Independent manual dipole. Dragging it or editing its moment affects this experiment only. To use live input, select a region in the main view and enable the live source."
  },
  {
    "zh": "拖动橙色电流源，旋转场景，修改偶极矩及方向。12个示意传感器电位由解析公式实时计算。",
    "en": "Drag the orange source, rotate the view, or edit its moment and orientation. The analytical formula computes potentials at 12 illustrative sensors."
  },
  {
    "zh": "电流源控制",
    "en": "Source controls"
  },
  {
    "zh": "方向",
    "en": "Orientation"
  },
  {
    "zh": "X 左右",
    "en": "X · left–right"
  },
  {
    "zh": "Y 前后",
    "en": "Y · anterior–posterior"
  },
  {
    "zh": "Z 上下",
    "en": "Z · superior–inferior"
  },
  {
    "zh": "偶极矩",
    "en": "Dipole moment"
  },
  {
    "zh": "电导率",
    "en": "Conductivity"
  },
  {
    "zh": "参考方式",
    "en": "Reference"
  },
  {
    "zh": "平均参考",
    "en": "Average reference"
  },
  {
    "zh": "无限远理论参考",
    "en": "Theoretical infinity reference"
  },
  {
    "zh": "位置 (mm)：",
    "en": "Position (mm):"
  },
  {
    "zh": "重置实验（回到手动偶极子）",
    "en": "Reset to manual dipole"
  },
  {
    "zh": "示意电极电位 · µV",
    "en": "Illustrative sensor potentials · µV"
  },
  {
    "zh": "最大电极：",
    "en": "Largest sensor:"
  },
  {
    "zh": "电流偶极子物理实验",
    "en": "Current-dipole physics"
  },
  {
    "zh": "交互式三维电流源与模拟传感器",
    "en": "Interactive 3D source and simulated sensors"
  },
  {
    "zh": "电流源方向",
    "en": "Source orientation"
  },
  {
    "zh": "（直播值，滑杆已锁定）",
    "en": "(live value; slider locked)"
  },
  {
    "zh": "偶极矩强度",
    "en": "Dipole moment magnitude"
  },
  {
    "zh": "导电率",
    "en": "Conductivity"
  },
  {
    "zh": "EEG 分析实验 — 多导 EEG · 频谱 · ERP · 时频 · 地形 · 源定位",
    "en": "EEG analysis · recordings, spectrum, event responses, time-frequency, topography and source localization"
  },
  {
    "zh": "直播推导：",
    "en": "Derive from live snapshots:"
  },
  {
    "zh": "正向模型",
    "en": "Forward model"
  },
  {
    "zh": "频谱",
    "en": "Spectrum"
  },
  {
    "zh": "时频",
    "en": "Time-frequency"
  },
  {
    "zh": "地形",
    "en": "Topography"
  },
  {
    "zh": "源定位",
    "en": "Source localization"
  },
  {
    "zh": "当前记录来自直播推导（关弹窗前跑的，还在）。",
    "en": "This live-derived recording is retained from the previous visit."
  },
  {
    "zh": "直播快照历史不足：等仿真跑满 1 秒再推导",
    "en": "Wait for at least one second of live model history before deriving a recording."
  },
  {
    "zh": "EEG 分析",
    "en": "EEG analysis"
  },
  {
    "zh": "未选脑区——先在主界面点一个脑区，再从直播推导记录。",
    "en": "Select a region in the main view before deriving a live recording."
  },
  {
    "zh": "从约 60 Hz 可视化快照构造近似 EEG 记录；不是 250 Hz 原生采样。late ERP 与地形右侧物理源仍可能独立，P0-3/4 待完成。",
    "en": "Derive an approximate EEG recording from roughly 60 Hz visualization snapshots. This is not native 250 Hz acquisition; the independent forward-source demonstration remains separate."
  },
  {
    "zh": "推导中…",
    "en": "Deriving…"
  },
  {
    "zh": "从直播推导记录",
    "en": "Derive a live recording"
  },
  {
    "zh": "主仿真快照派生",
    "en": "Derived from main-model snapshots"
  },
  {
    "zh": "独立神经群体",
    "en": "Independent neural population"
  },
  {
    "zh": "同一 Raw 运行",
    "en": "Same source recording"
  },
  {
    "zh": "当前记录来源：直播推导（直播 WC 网络快照流，60 Hz 快照插值到 250 Hz）。",
    "en": "Source: live Wilson–Cowan snapshots, interpolated from about 60 Hz to a 250 Hz grid."
  },
  {
    "zh": "当前记录来源：独立柱模型（种子/源模型跑出来的，与直播无关）。",
    "en": "Source: an independent column model using its own configuration and seed."
  },
  {
    "zh": "尚未运行实验。",
    "en": "No experiment has been run."
  },
  {
    "zh": "EEG 分析实验",
    "en": "EEG analysis experiment"
  },
  {
    "zh": "源模型",
    "en": "Source model"
  },
  {
    "zh": "Wilson–Cowan 柱（WC）",
    "en": "Wilson–Cowan column"
  },
  {
    "zh": "Jansen–Rit 柱（JR，静息 p0=90）",
    "en": "Jansen–Rit column (resting input p0=90)"
  },
  {
    "zh": "双源线性叠加（WC + JR）",
    "en": "Two sources: WC + JR"
  },
  {
    "zh": "柱模型 q(t) 经球形 lead-field 投影成多导 EEG；双源为线性叠加。",
    "en": "Column moment q(t) is projected through the spherical lead field to EEG channels. The two-source option adds their contributions linearly."
  },
  {
    "zh": "时长",
    "en": "Duration"
  },
  {
    "zh": "2 秒",
    "en": "2 seconds"
  },
  {
    "zh": "5 秒",
    "en": "5 seconds"
  },
  {
    "zh": "10 秒",
    "en": "10 seconds"
  },
  {
    "zh": "采样率 250 Hz；脉冲事件每 1000 ms 一次，条件交替。",
    "en": "Sampling grid: 250 Hz. Pulses occur every 1000 ms, with alternating condition labels."
  },
  {
    "zh": "噪声种子",
    "en": "Noise seed"
  },
  {
    "zh": "同种子同参数两次运行逐值相同。",
    "en": "Identical parameters and seeds reproduce identical numerical samples."
  },
  {
    "zh": "无限远参考",
    "en": "Infinity reference"
  },
  {
    "zh": "电极参考",
    "en": "Electrode reference"
  },
  {
    "zh": "参考电极",
    "en": "Reference electrode"
  },
  {
    "zh": "三种参考数值各不相同；切换参考不重新跑模型。",
    "en": "Each reference produces different voltages. Changing the reference does not rerun the source model."
  },
  {
    "zh": "导联",
    "en": "Montage"
  },
  {
    "zh": "切换导联重建传感器配置（10-20 为 19 导）。",
    "en": "Changing the montage rebuilds the sensor layout; 10–20 has 19 channels."
  },
  {
    "zh": "通道",
    "en": "Channel"
  },
  {
    "zh": "点波形行也可切换通道。",
    "en": "Select a channel here or click its waveform."
  },
  {
    "zh": "添加噪声（伪迹，非神经源）",
    "en": "Add measurement noise / artifacts"
  },
  {
    "zh": "导出 CSV",
    "en": "Export CSV"
  },
  {
    "zh": "导出 JSON",
    "en": "Export JSON"
  },
  {
    "zh": "正向模型加载中…",
    "en": "Loading the forward model…"
  },
  {
    "zh": "时间 0–",
    "en": "Time: 0–"
  },
  {
    "zh": "尚未运行实验。选好参数后点“运行实验”。",
    "en": "Choose settings and select Run experiment to generate a recording."
  },
  {
    "zh": "（已选）",
    "en": "(selected)"
  },
  {
    "zh": "白噪声",
    "en": "White noise"
  },
  {
    "zh": "1/f 粉红噪声",
    "en": "1/f pink noise"
  },
  {
    "zh": "50 Hz 工频",
    "en": "50 Hz line noise"
  },
  {
    "zh": "慢漂移",
    "en": "Slow drift"
  },
  {
    "zh": "跑柱模型 → 球形正向模型 → 噪声，生成多导 EEG 记录",
    "en": "Run the column and spherical forward model, then add the selected noise."
  },
  {
    "zh": "运行实验",
    "en": "Run experiment"
  },
  {
    "zh": "事件相关电位（ERP）——通道",
    "en": "Event-related potential · channel"
  },
  {
    "zh": "分段口径（MNE）：−200–800 ms、基线 −200–0 ms、峰峰值 &gt;150 µV 剔除。峰值窗 250–600 ms、 窗均值 300–500 ms。事件时间戳是仿真时钟（累计 ISI），不是浏览器墙钟。",
    "en": "Epochs: −200 to 800 ms; baseline: −200 to 0 ms. Reject peak-to-peak amplitude above 150 µV. Peak window: 250–600 ms; mean window: 300–500 ms. Events use model time, not browser time."
  },
  {
    "zh": "切分试次（MNE 口径）",
    "en": "Create epochs"
  },
  {
    "zh": "运行 oddball（同步全部分析）",
    "en": "Run oddball and update all analyses"
  },
  {
    "zh": "右边按钮跑 late 机制 oddball 实验（单通道 Pz，40 试次：32 标准 + 8 oddball）， 此操作同时载入原始记录、事件与试次；EEG、PSD、ERP、时频与可适用的分析使用同一次运行。单通道记录不支持多电极地形或源定位。 左边按钮只切分 EEG 页的当前记录；late 实验才有 0.174 µV 的晚期峰。",
    "en": "The oddball experiment runs 40 Pz trials (32 standard, 8 oddball) with the late-response mechanism. It loads Raw, events and epochs together, so EEG, spectrum, ERP and time-frequency views share that run. A single channel cannot support multielectrode topography or source localization. The other button only epochs the current EEG recording. The late experiment produces the approximately 0.174 µV late peak."
  },
  {
    "zh": "还没有 EEG 记录。先在 EEG 页运行实验（或直接点 late 机制按钮）。",
    "en": "Generate an EEG recording first, or run the oddball experiment directly."
  },
  {
    "zh": "已切分：",
    "en": "Epochs retained:"
  },
  {
    "zh": "ERP 波形（µV）",
    "en": "ERP waveform · µV"
  },
  {
    "zh": "青色实线 oddball（n=",
    "en": "Cyan solid line: oddball (n="
  },
  {
    "zh": "黄色实线是差异波（oddball − standard）。",
    "en": "Yellow line: oddball minus standard."
  },
  {
    "zh": "峰值 / 潜伏期 / 窗均值（",
    "en": "Peak, latency and window mean ("
  },
  {
    "zh": "条件",
    "en": "Condition"
  },
  {
    "zh": "试次数",
    "en": "Trials"
  },
  {
    "zh": "峰值（µV）",
    "en": "Peak (µV)"
  },
  {
    "zh": "潜伏期（ms）",
    "en": "Latency (ms)"
  },
  {
    "zh": "300–500 ms 均值（µV）",
    "en": "Mean over 300–500 ms (µV)"
  },
  {
    "zh": "峰处 SEM（µV）",
    "en": "SEM at peak (µV)"
  },
  {
    "zh": "差异波",
    "en": "Difference wave"
  },
  {
    "zh": "ds003061 实测对照（Pz）：oddball 峰",
    "en": "Reference data ds003061, Pz: oddball peak"
  },
  {
    "zh": "模型峰约 0.17 µV（本表 oddball 行实测",
    "en": "Model peak about 0.17 µV (this run:"
  },
  {
    "zh": "注意：上面表格是壳实验记录（plain WC/JR 模型，无 late 机制）算出的——250–600 ms 窗内基本无响应，峰值小于 0.001 µV（表格按 3 位小数显示为 0.000）、潜伏期落在窗首 252 ms（窗内只有早期峰的衰减尾巴，最大 |值| 在窗首）。late 机制的模型峰约 0.17 µV @352 ms（docs/pr6-erp-mechanism.md §4）要点上面“运行 oddball 实验 （late 机制）”才会出现；幅度差约 50 倍是结构性缺口，没有靠重缩放修掉。",
    "en": "This table uses the basic WC/JR recording without the late-response mechanism. Response in the 250–600 ms window is below 0.001 µV, displayed as 0.000 at three decimals. The peak occurs at the window's first sample, 252 ms, because only the early response's decay remains. Run the late oddball experiment to obtain the approximately 0.17 µV peak at 352 ms. Its roughly 50-fold amplitude gap is a structural limitation; values are not rescaled to hide it."
  },
  {
    "zh": "试次数量效应：SEM ≈ σ/√n。无噪声运行时试次完全相同、SEM 为 0（只有边界共享点带来 ~1e-4 µV 级数值差异）；加测量噪声后，试次数翻 4 倍、SEM 约减半。",
    "en": "SEM scales approximately as σ/√n. Noiseless deterministic trials are identical, apart from shared-boundary differences around 1e−4 µV. With measurement noise, quadrupling the trial count approximately halves SEM."
  },
  {
    "zh": "late 机制 oddball 实验只出单通道 Pz：请在 EEG tab 把通道切到 Pz 再看本页， 或点“切分试次”回到壳实验记录。",
    "en": "This late-response experiment produces Pz only. Choose Pz in the EEG view, or create epochs from the main recording."
  },
  {
    "zh": "需要保留的 standard 和 oddball 试次；自由脉冲不能代替实验条件。",
    "en": "Both retained standard and oddball trials are required. Arbitrary pulses do not define those task conditions."
  },
  {
    "zh": "还没有 EEG 记录，先在 EEG 页运行实验。",
    "en": "Run an EEG experiment first."
  },
  {
    "zh": "还没有事件表，先在 EEG 页运行实验。",
    "en": "Run an experiment to generate an event table."
  },
  {
    "zh": "late 机制 oddball 实验（单通道 Pz）",
    "en": "Late-response oddball experiment · Pz"
  },
  {
    "zh": "EEG 页的壳实验记录",
    "en": "Current EEG recording"
  },
  {
    "zh": "阈值 $",
    "en": "Threshold"
  },
  {
    "zh": "双脑 A/B 对照",
    "en": "Compare two model runs"
  },
  {
    "zh": "两个实验实例：相同初始状态、相同模型（Jansen–Rit 皮层柱）、相同种子、 相同输入事件，只改一个条件（这里是事件驱动，1/s）。比较输出是数值 差异（峰值差、PSD 峰移、ERP 峰差），不只是两张图。共享时间轴（0.5 ms 步长）。",
    "en": "Both Jansen–Rit instances share their initial state, model, seed and input timing. Only event drive differs, in 1/s. Results quantify peak changes, spectral shifts and ERP differences on a common 0.5 ms time grid."
  },
  {
    "zh": "驱动 A（1/s）",
    "en": "Drive A (1/s)"
  },
  {
    "zh": "驱动 B（1/s）",
    "en": "Drive B (1/s)"
  },
  {
    "zh": "时长（ms）",
    "en": "Duration (ms)"
  },
  {
    "zh": "运行对照",
    "en": "Run comparison"
  },
  {
    "zh": "指标",
    "en": "Metric"
  },
  {
    "zh": "差（B−A）",
    "en": "Difference (B−A)"
  },
  {
    "zh": "y0 峰值 |y0|（mV）",
    "en": "Peak |y0| (mV)"
  },
  {
    "zh": "y0 峰值时刻差（ms）",
    "en": "Peak-time difference (ms)"
  },
  {
    "zh": "PSD 峰值频率（Hz）",
    "en": "Spectral peak (Hz)"
  },
  {
    "zh": "ERP 峰值（µV，窗 0–600 ms）",
    "en": "ERP peak (µV, 0–600 ms)"
  },
  {
    "zh": "Pz RMS 差（µV）",
    "en": "Pz RMS difference (µV)"
  },
  {
    "zh": "y0 轨迹最大绝对差（mV）",
    "en": "Maximum |A−B| in y0 (mV)"
  },
  {
    "zh": "源定位对照（深源 vs 浅源）",
    "en": "Compare deep and shallow sources"
  },
  {
    "zh": "深度偏置对照（plain / depth / dSPM / eLORETA）",
    "en": "Depth-bias comparison: plain, depth-weighted, dSPM and eLORETA"
  },
  {
    "zh": "正向模型未加载：先运行 scientific/forward/generate_sphere_model.py",
    "en": "Generate the spherical forward model with scientific/forward/generate_sphere_model.py."
  },
  {
    "zh": "双脑 A/B 对照 · 直播 A",
    "en": "Compare against live network values"
  },
  {
    "zh": "A 取直播仿真：选中脑区在最近响应窗口里的峰值 ΔE（真实快照）+ 同一份 直播推导的 Pz 峰值/RMS（经 runLiveExperiment，与 EEG 台同一条管线）。 B 仍是上方 JR 柱对照的 B（驱动可改）；两者模型不同，只并列、不作 同口径差值。改 G、换选区后重取，A 的数值跟着变。",
    "en": "A uses the selected region's latest live response: peak ΔE and Pz peak/RMS derived through the same pipeline as the EEG lab. B remains the independent JR column above. These are different models, shown side by side without a matched subtraction. Change the live settings or selected region, then sample A again."
  },
  {
    "zh": "取直播 A（最近响应窗口）",
    "en": "Read the latest live response"
  },
  {
    "zh": "时间机器 · 直播回放",
    "en": "Replay live network history"
  },
  {
    "zh": "最近约 10 秒的真实直播快照（SimClient 快照历史，60 Hz）：拖动看选中 脑区的 E/I 是怎么走的。直播引擎不可倒带——这里只回放已记录的历史， 不改仿真状态；想从历史点改参数重跑，用下面的 JR 柱时间机器（独立演示）。",
    "en": "Inspect approximately ten seconds of recorded E/I snapshots at about 60 Hz. This replays history without rewinding the live engine or changing its state. Use the independent JR time machine below to branch and rerun from a saved state."
  },
  {
    "zh": "载入最近 10 秒直播快照",
    "en": "Load recent live history"
  },
  {
    "zh": "回放：",
    "en": "Replay position:"
  },
  {
    "zh": "时间机器 · JR 柱（独立演示）",
    "en": "Time machine · independent JR column"
  },
  {
    "zh": "独立演示：Jansen–Rit 皮层柱的时间机器，与直播仿真无关（不读主仿真快照）。 暂停、单步（一次一个 dt = 0.5 ms）、历史缓冲（每 10 ms 一份快照）、 回放（拖动已记录的快照历史）、慢动作（回放倍率只改变查看速度， 不改变物理）、恢复模型快照、从历史状态改参数后重新运行（分支）。 所有回放均来自真实保存的状态或确定性重算，不编造历史。",
    "en": "This independent Jansen–Rit column does not read the live network. Pause, step by 0.5 ms, inspect snapshots saved every 10 ms, replay slowly, restore a state, or branch with changed parameters. Playback speed changes viewing only. Every history point comes from saved state or deterministic recomputation."
  },
  {
    "zh": "跑到 2000 ms（事件 1000 ms，驱动 120 1/s）",
    "en": "Run to 2000 ms (stimulus at 1000 ms, drive 120 1/s)"
  },
  {
    "zh": "单步 +0.5 ms",
    "en": "Step +0.5 ms"
  },
  {
    "zh": "恢复到回放点",
    "en": "Restore this replay point"
  },
  {
    "zh": "分支时刻（ms）",
    "en": "Branch time (ms)"
  },
  {
    "zh": "分支后驱动（1/s）",
    "en": "Drive after branching (1/s)"
  },
  {
    "zh": "从该点改参数重跑（分支）",
    "en": "Branch and rerun"
  },
  {
    "zh": "闭环控制 · JR 柱（独立演示）",
    "en": "Feedback control · independent JR column"
  },
  {
    "zh": "独立演示：Jansen–Rit 皮层柱的闭环模拟，与直播仿真无关。 模拟 EEG（Pz 代理）→ 特征提取 → 状态判定 → 控制器 → 延迟 → 虚拟刺激 （加到 JR 输入上）→ 神经响应。控制器输出单位 1/s，加在静息输入 p0 上：正值兴奋、负值抑制。阈值模式用固定阈值触发抑制输出； PID 模式跟踪设定点（位置式，条件积分抗饱和）。",
    "en": "The simulated loop uses a Pz proxy to extract a feature, estimate state, calculate control, apply delay, and add a virtual stimulus to the JR input. Output is in 1/s added to p0: positive excites, negative inhibits. Threshold control applies a fixed inhibitory output; positional PID tracks a setpoint with conditional anti-windup. This is independent of the live network."
  },
  {
    "zh": "控制器",
    "en": "Controller"
  },
  {
    "zh": "关（无控制对照）",
    "en": "Off · uncontrolled reference"
  },
  {
    "zh": "固定阈值",
    "en": "Fixed threshold"
  },
  {
    "zh": "特征",
    "en": "Feature"
  },
  {
    "zh": "瞬时 Pz（µV）",
    "en": "Instantaneous Pz (µV)"
  },
  {
    "zh": "滑窗 RMS（µV）",
    "en": "Windowed RMS (µV)"
  },
  {
    "zh": "Alpha 功率 10 Hz（µV²）",
    "en": "Alpha power at 10 Hz (µV²)"
  },
  {
    "zh": "延迟（ms）",
    "en": "Delay (ms)"
  },
  {
    "zh": "测量噪声 RMS（µV）",
    "en": "Measurement noise RMS (µV)"
  },
  {
    "zh": "阈值（特征单位）",
    "en": "Threshold (feature units)"
  },
  {
    "zh": "触发输出（1/s，负值 = 抑制）",
    "en": "Triggered output (1/s; negative inhibits)"
  },
  {
    "zh": "Kp（1/s 每单位误差）",
    "en": "Kp (1/s per feature-error unit)"
  },
  {
    "zh": "设定点（特征单位）",
    "en": "Setpoint (feature units)"
  },
  {
    "zh": "运行闭环（3 s，事件 1000 ms，驱动 300 1/s）",
    "en": "Run 3-second feedback simulation (stimulus at 1000 ms, drive 300 1/s)"
  },
  {
    "zh": "闭环控制 · 直播闭环",
    "en": "Feedback control · live network"
  },
  {
    "zh": "特征取自直播：选中脑区 #",
    "en": "Feature from selected live region #"
  },
  {
    "zh": "瞬时 E（无量纲）",
    "en": "Instantaneous E (dimensionless)"
  },
  {
    "zh": "1 秒 RMS E（无量纲）",
    "en": "One-second RMS of E (dimensionless)"
  },
  {
    "zh": "阈值",
    "en": "Threshold"
  },
  {
    "zh": "反馈脉冲幅度（模型单位）",
    "en": "Feedback pulse strength (model units)"
  },
  {
    "zh": "触发上限（次）",
    "en": "Maximum triggers"
  },
  {
    "zh": "启动直播闭环",
    "en": "Start live feedback"
  },
  {
    "zh": "停止直播闭环",
    "en": "Stop live feedback"
  },
  {
    "zh": "先在主界面选一个脑区（直播未就绪或未选区时不可启动）。",
    "en": "Select a region and wait for the live engine before starting."
  },
  {
    "zh": "直播闭环运行中：每 250 ms 读一次直播快照，超阈值即反馈脉冲。",
    "en": "Live feedback is active. It samples every 250 ms and sends a pulse when the threshold is exceeded."
  },
  {
    "zh": "直播未就绪（仿真引擎加载中）",
    "en": "The live engine is starting."
  },
  {
    "zh": "先在主界面选一个脑区，再取直播 A",
    "en": "Select a region before sampling live A."
  },
  {
    "zh": "球形正向模型未加载：Pz 代理不可算（先看上方“先在主界面刺激一次”的 ΔE 部分）",
    "en": "The spherical model is unavailable, so the Pz proxy cannot be computed. The regional ΔE response remains available above."
  },
  {
    "zh": "先在主界面刺激一次（需要最近的响应窗口）",
    "en": "Apply a stimulus in the main view to create a response window."
  },
  {
    "zh": "直播快照历史不足：等仿真跑满 1 秒",
    "en": "Wait for at least one second of live history."
  },
  {
    "zh": "先在主界面选一个脑区，再载入直播快照",
    "en": "Select a region before loading its live history."
  },
  {
    "zh": "未触发",
    "en": "Not triggered"
  },
  {
    "zh": "是",
    "en": "Yes"
  },
  {
    "zh": "否",
    "en": "No"
  },
  {
    "zh": "脑区浏览器 — TVB 演示连接组（76 区）",
    "en": "Region browser · TVB demonstration connectome"
  },
  {
    "zh": "点选下面的脑区会同步选中主三维大脑与 LIVE ACTIVITY；仅选择，不施加刺激。",
    "en": "Selecting a region updates the main 3D view and activity trace without applying input."
  },
  {
    "zh": "数据：TVB 示例 connectivity_76（权重主要来自猕猴 CoCoMac，胼胝体为人类 DSI 缩放； 不是某个真人的连接网络）。中心坐标是 TVB 演示坐标（tvb-demo-mm）， 与 HEAD / MRI / MNI 不互通——没有已验证的配准，不换算。",
    "en": "Data: TVB connectivity_76, mainly macaque CoCoMac weights with scaled human DSI callosal connections. This is not an individual human connectome. Centers use the TVB demonstration frame, which has no validated registration to HEAD, MRI or MNI; no conversion is assumed."
  },
  {
    "zh": "没有匹配的脑区。",
    "en": "No matching regions."
  },
  {
    "zh": "选一个脑区查看详情。",
    "en": "Select a region for details."
  },
  {
    "zh": "中心坐标（TVB 演示）：",
    "en": "Center in TVB demonstration coordinates:"
  },
  {
    "zh": "皮层面积：",
    "en": "Cortical area:"
  },
  {
    "zh": "皮层标记：",
    "en": "Cortical flag:"
  },
  {
    "zh": "主要连接（按权重前 5，来源 → 该脑区）：",
    "en": "Five strongest incoming connections:"
  },
  {
    "zh": "坐标 — HEAD / 球心 / MRI / MNI305",
    "en": "Coordinate frames"
  },
  {
    "zh": "球形头模型源点（球心坐标，mm；每轴 ±48）：HEAD RAS = 球心坐标 + [0, 0, 40] mm （契约 §2 唯一已验证的变换 `MNE_HEAD_TO_SPHERE` 的逆变换，误差 0 mm）。",
    "en": "The spherical source uses sphere-centered millimeters, with each axis limited to ±48. HEAD RAS equals sphere-centered position plus [0,0,40] mm. This inverse of MNE_HEAD_TO_SPHERE is the only validated transform here (error 0 mm)."
  },
  {
    "zh": "换算失败：",
    "en": "Conversion failed:"
  },
  {
    "zh": "球心坐标（head-sphere-centered-mm）：",
    "en": "Sphere-centered coordinates:"
  },
  {
    "zh": "MRI RAS（mri-ras-mm）：无通用变换——本仓库没有 MRI↔HEAD 通用变换， 仅 fsaverage BEM fixture 自带 transform_mri_to_head，未加载该 fixture 时不显示数值。",
    "en": "There is no universal MRI↔HEAD transform. Only an imported fsaverage BEM fixture supplies transform_mri_to_head; values are unavailable without it."
  },
  {
    "zh": "MNI305：只属于 fsaverage 皮层源（MNE/FreeSurfer mni_tal），不是 TVB 脑区坐标； 此处不换算。",
    "en": "MNI305 applies only to fsaverage cortical sources through MNE/FreeSurfer mni_tal, not to TVB region centers. No conversion is performed here."
  },
  {
    "zh": "MNI152 / Talairach：禁用（无已验证配准）。点下面按钮现场验证拒绝逻辑：",
    "en": "MNI152 and Talairach are disabled because registration has not been validated. The buttons below verify rejection."
  },
  {
    "zh": "调试：拒绝未配准的 MNI152",
    "en": "Verify rejection of unregistered MNI152"
  },
  {
    "zh": "调试：拒绝未配准的 Talairach",
    "en": "Verify rejection of unregistered Talairach"
  },
  {
    "zh": "多尺度 — 细胞实验室",
    "en": "Cellular models"
  },
  {
    "zh": "LIF / Hodgkin–Huxley / 多房室神经元与跨尺度耦合（PR-13 真实实验台）， 注入电流看动作电位；一键场景 13 在这里有对应的真实计算。",
    "en": "Run LIF, Hodgkin–Huxley or multicompartment equations to inspect action potentials and explicitly assumed cross-scale coupling."
  },
  {
    "zh": "打开细胞实验",
    "en": "Open cellular lab"
  },
  {
    "zh": "按名称或编号搜索脑区",
    "en": "Search regions by name or ID"
  },
  {
    "zh": "搜索脑区名称或编号，例如 cingulate 或 40",
    "en": "Search by name or ID, such as cingulate or 40"
  },
  {
    "zh": "同步选中主三维大脑中的同一脑区（不施加刺激）",
    "en": "Select the same region in the main brain without stimulating it"
  },
  {
    "zh": "皮层",
    "en": "Cortical"
  },
  {
    "zh": "非皮层",
    "en": "Noncortical"
  },
  {
    "zh": "进阶：真实 MRI/BEM（加载自行获取的模板）",
    "en": "Advanced: import an MRI/BEM template"
  },
  {
    "zh": "经 MNE 计算的四层球形导体：脑组织、脑脊液、颅骨和头皮。是模型级 EEG 正向仿真，不是个体 MRI/BEM，亦未与 TVB 76区皮层配准。",
    "en": "This MNE four-layer spherical conductor represents brain, CSF, skull and scalp. It computes model EEG potentials, not individual MRI/BEM signals, and is not registered to the TVB cortex."
  },
  {
    "zh": "正在加载 MNE 正向模型…",
    "en": "Loading the forward model…"
  },
  {
    "zh": "模型",
    "en": "Model"
  },
  {
    "zh": "可直接操作的物理参数",
    "en": "Physical controls"
  },
  {
    "zh": "电极布局",
    "en": "Electrode layout"
  },
  {
    "zh": "10–20 基础 19 导",
    "en": "10–20 · 19 electrodes"
  },
  {
    "zh": "扩展 10–10 · 94 导",
    "en": "10–10 · 94 electrodes"
  },
  {
    "zh": "10–05 · 343 导",
    "en": "10–05 · 343 electrodes"
  },
  {
    "zh": "源方向",
    "en": "Source orientation"
  },
  {
    "zh": "EEG 参考",
    "en": "Voltage reference"
  },
  {
    "zh": "当前电极平均参考",
    "en": "Average across current electrodes"
  },
  {
    "zh": "查看电极",
    "en": "Inspect electrode"
  },
  {
    "zh": "源位置 mm：",
    "en": "Source position (mm):"
  },
  {
    "zh": "当前电极电位：",
    "en": "Selected electrode potential:"
  },
  {
    "zh": "重置球形实验（回到手动偶极子）",
    "en": "Reset the spherical model"
  },
  {
    "zh": "电极信号（幅值前 19 位）",
    "en": "Nineteen largest electrode signals"
  },
  {
    "zh": "限制：球形半径 95 mm，4 层电导率 0.33/1/0.004/0.33 S/m；源只允许在 ±48 mm 三维规则网格内，网格间三线性插值；电极取 MNE 标准布局的方向并投影到球面，不是原始头皮形状。无 MRI、MNI/Talairach、BEM/FEM、神经群体源校准；不用于临床推断。",
    "en": "Model boundaries: radius 95 mm; layer conductivities 0.33/1/0.004/0.33 S/m. Source position is confined to a ±48 mm regular grid with trilinear interpolation. Standard MNE electrode directions are projected to a sphere, not an anatomical scalp. This is not MRI/BEM/FEM, a validated MNI/Talairach mapping, or a human-calibrated neural source. It is not used for clinical inference."
  },
  {
    "zh": "分层球形头EEG物理实验",
    "en": "Layered head-conductor simulation"
  },
  {
    "zh": "打开本地真实 MRI BEM",
    "en": "Open local MRI/BEM model"
  },
  {
    "zh": "MNE四层球形头模型与可拖动源",
    "en": "Four-layer head model with draggable source"
  },
  {
    "zh": "球形头电流源方向",
    "en": "Head-model source orientation"
  },
  {
    "zh": "球形头偶极矩",
    "en": "Head-model dipole moment"
  },
  {
    "zh": "球形头参考方式",
    "en": "Head-model reference"
  },
  {
    "zh": "选中电极",
    "en": "Selected electrode"
  },
  {
    "zh": "源定位——偶极子拟合 + MNE 逆解",
    "en": "Source localization · dipole fit and MNE"
  },
  {
    "zh": "正向模型：MNE 四层球形头 lead-field（64 点源网格，轴 −48–48 mm）。 逆解只读 lead-field + 电位数据，真值标签绝不进逆解函数；真值只在盲测演示里用来合成数据与事后算误差。",
    "en": "The forward model uses MNE's four-layer spherical lead field, with 64 source-grid points between −48 and +48 mm. Inverse functions read only the lead field and potentials. Ground truth is used to generate blind-test data and evaluate error afterward, never as an inverse-solver input."
  },
  {
    "zh": "球形 lead-field 未传入（fixture 为空），逆解不可用。",
    "en": "The spherical lead field is unavailable; inverse estimation is disabled."
  },
  {
    "zh": "盲测演示（Ground Truth vs Estimated）",
    "en": "Blind test · known versus estimated source"
  },
  {
    "zh": "真源 X：",
    "en": "True source X:"
  },
  {
    "zh": "真源 Y：",
    "en": "True source Y:"
  },
  {
    "zh": "真源 Z：",
    "en": "True source Z:"
  },
  {
    "zh": "真源矩方向：",
    "en": "True moment orientation:"
  },
  {
    "zh": "真源矩（nA·m）：",
    "en": "True moment (nA·m):"
  },
  {
    "zh": "导联：",
    "en": "Montage:"
  },
  {
    "zh": "10-20（19 导）",
    "en": "10–20 · 19 channels"
  },
  {
    "zh": "10-10（94 导）",
    "en": "10–10 · 94 channels"
  },
  {
    "zh": "10-05（343 导）",
    "en": "10–05 · 343 channels"
  },
  {
    "zh": "附加噪声 RMS（µV）：",
    "en": "Added noise RMS (µV):"
  },
  {
    "zh": "MNE 噪声 σ（µV）：",
    "en": "MNE noise σ (µV):"
  },
  {
    "zh": "方法",
    "en": "Method"
  },
  {
    "zh": "估计位置（mm）",
    "en": "Estimated position (mm)"
  },
  {
    "zh": "定位误差",
    "en": "Localization error"
  },
  {
    "zh": "其他",
    "en": "Other measures"
  },
  {
    "zh": "真源",
    "en": "True source"
  },
  {
    "zh": "矩",
    "en": "Moment"
  },
  {
    "zh": "偶极子拟合",
    "en": "Dipole fit"
  },
  {
    "zh": "残差 RMS",
    "en": "Residual RMS"
  },
  {
    "zh": "峰值",
    "en": "Peak"
  },
  {
    "zh": "盲测算不出来（fixture 未加载或真源越界：位置须在 ±48 mm 内）。",
    "en": "Blind test unavailable: load the fixture and keep the source within ±48 mm."
  },
  {
    "zh": "读法：偶极子拟合无噪声、源在网格点上时误差 0.0 mm；MNE 无深度加权，深部/切向源峰值误差 32–64 mm 乃至更大， 只有表浅径向源能准确定位——这是最小范数估计的深度偏置，不是正向模型的错。噪声 0.5 µV 时偶极子拟合误差 32–55 mm（19 导）， 残差 RMS ≈ 噪声水平。",
    "en": "With no noise and a source on the grid, dipole-fit error is 0.0 mm. Unweighted MNE shows 32–64 mm or larger errors for deep or tangential sources; superficial radial sources localize better. This is minimum-norm depth bias, not a forward-model error. With 0.5 µV noise and 19 channels, dipole-fit error is 32–55 mm and residual RMS is near the noise level."
  },
  {
    "zh": "对当前记录（无真值，不编造误差）",
    "en": "Estimate from this recording · no known source"
  },
  {
    "zh": "还没有 EEG 记录。请先在 EEG tab 里运行实验。",
    "en": "Run an EEG experiment to generate a recording."
  },
  {
    "zh": "该记录的逆解算不出来（fixture 未加载或导联与 fixture 不符）。",
    "en": "Estimation is unavailable: the fixture is missing or its channel layout does not match the recording."
  },
  {
    "zh": "取全通道 RMS 最大的采样点（",
    "en": "Use the sample with the largest RMS across channels ("
  },
  {
    "zh": "偶极子拟合估计位置",
    "en": "Fitted dipole position"
  },
  {
    "zh": "偶极子拟合估计矩",
    "en": "Fitted dipole moment"
  },
  {
    "zh": "偶极子拟合残差 RMS",
    "en": "Dipole-fit residual RMS"
  },
  {
    "zh": "MNE 峰值位置",
    "en": "MNE peak location"
  },
  {
    "zh": "MNE 峰值 / 分布范围",
    "en": "MNE peak / spatial spread"
  },
  {
    "zh": "注意：此处没有真值，无法报告定位误差；两种方法位置不一致时，优先信残差小的那个， 并看 MNE 的分布范围——分布越散，峰值位置越不可信。",
    "en": "There is no ground truth for this recording, so localization error cannot be reported. If methods disagree, inspect the lower-residual fit and MNE spread. A broad distribution makes its peak location less reliable."
  },
  {
    "zh": "真源矩",
    "en": "True source moment"
  },
  {
    "zh": "附加噪声",
    "en": "Added noise"
  },
  {
    "zh": "真实人类平均解剖模板 · 三层 BEM 电位计算；不是个体化 MRI、不是临床预测。 本模式仅载入用户自行获取并生成的本地模型文件，软件不分发 FreeSurfer 模板数据。",
    "en": "A human average anatomical template with three-layer BEM. This is not individual MRI or a clinical prediction. Import your own generated model; FreeSurfer template data are not distributed with the application."
  },
  {
    "zh": "加载本地 fsaverage BEM 模型 JSON",
    "en": "Load fsaverage BEM JSON"
  },
  {
    "zh": "首次使用可在本地运行 scientific/forward/generate_fsaverage_bem.py。 模型必须带有 MRI↔HEAD 坐标、原始皮层源、aparc 标注、BEM lead-field 和真实头部几何。",
    "en": "Generate a model with scientific/forward/generate_fsaverage_bem.py. It must contain MRI↔HEAD transforms, original cortical sources, aparc annotations, the BEM lead field and head geometry."
  },
  {
    "zh": "模板",
    "en": "Template"
  },
  {
    "zh": "解剖与电流源",
    "en": "Anatomy and source"
  },
  {
    "zh": "物理源模式",
    "en": "Source mode"
  },
  {
    "zh": "手动控制偶极子",
    "en": "Manual dipole"
  },
  {
    "zh": "局部 E/I 神经群体（假设参数）",
    "en": "Local excitatory/inhibitory population · assumed parameters"
  },
  {
    "zh": "选择已验证皮层点",
    "en": "Choose a validated cortical point"
  },
  {
    "zh": "电流偶极子方向",
    "en": "Current-dipole orientation"
  },
  {
    "zh": "X · 左右",
    "en": "X · left–right"
  },
  {
    "zh": "Y · 前后",
    "en": "Y · anterior–posterior"
  },
  {
    "zh": "Z · 上下",
    "en": "Z · superior–inferior"
  },
  {
    "zh": "偶极矩：",
    "en": "Dipole moment:"
  },
  {
    "zh": "源模型（两条路线同步运行，切换只改 3D 显示用哪条）",
    "en": "Source model · both run together; this selects the displayed output"
  },
  {
    "zh": "Wilson–Cowan 局部 E/I 神经群体",
    "en": "Wilson–Cowan local E/I population"
  },
  {
    "zh": "Jansen–Rit 锥体 PSP（独立验证路线）",
    "en": "Jansen–Rit pyramidal PSP"
  },
  {
    "zh": "y0 锥体 PSP：",
    "en": "Pyramidal PSP y0:"
  },
  {
    "zh": "等效偶极矩：",
    "en": "Equivalent dipole moment:"
  },
  {
    "zh": "皮层法向：",
    "en": "Cortical normal:"
  },
  {
    "zh": "施加局部刺激",
    "en": "Apply local input"
  },
  {
    "zh": "重置神经动力学",
    "en": "Reset neural dynamics"
  },
  {
    "zh": "刺激驱动",
    "en": "Input drive"
  },
  {
    "zh": "两条路线并排比较（同一刺激、同一源、同一 BEM）",
    "en": "Compare both models · same stimulus, source and BEM"
  },
  {
    "zh": "假设：",
    "en": "Assumptions:"
  },
  {
    "zh": "EEG参考",
    "en": "EEG reference"
  },
  {
    "zh": "电极平均参考",
    "en": "Average electrode reference"
  },
  {
    "zh": "理论无限远参考",
    "en": "Theoretical infinity reference"
  },
  {
    "zh": "观察电极",
    "en": "Inspect electrode"
  },
  {
    "zh": "电位：",
    "en": "Potential:"
  },
  {
    "zh": "重置模板实验",
    "en": "Reset template model"
  },
  {
    "zh": "所选源的全部电极电位",
    "en": "All electrode potentials for the selected source"
  },
  {
    "zh": "方法：MNE make_forward_dipole + fsaverage MRI 三层 BEM； HEAD RAS 毫米，nA·m→µV。模型源只能选已预计算节点，不进行空间插值。 可选局部 E/I（Wilson–Cowan）或 Jansen–Rit 锥体 PSP→电流源均采用明确假设参数，尚无人体校准；与 TVB 76 区网络不互通，亦无经验证的 Talairach 转换。",
    "en": "Method: MNE make_forward_dipole with fsaverage MRI and three-layer BEM. Coordinates use HEAD RAS in mm; moments in nA·m produce µV. Only precomputed source nodes are available, without spatial interpolation. Both WC and JR source mappings use explicit, uncalibrated assumptions. They are not registered to the TVB network or to a validated Talairach transform."
  },
  {
    "zh": "偶极矩时间轨迹（nA·m）",
    "en": "Dipole moment over time · nA·m"
  },
  {
    "zh": "无效 MRI/BEM 模型：",
    "en": "Invalid MRI/BEM model:"
  },
  {
    "zh": "真实模板 MRI BEM 实验",
    "en": "MRI/BEM template experiment"
  },
  {
    "zh": "导入本地 BEM 模型",
    "en": "Import a local BEM model"
  },
  {
    "zh": "真实模板头皮、颅骨、皮层与可选BEM电流源",
    "en": "Template scalp, skull, cortex and selectable current source"
  },
  {
    "zh": "BEM物理源模式",
    "en": "BEM source mode"
  },
  {
    "zh": "皮层源位置",
    "en": "Cortical source position"
  },
  {
    "zh": "MRI BEM源方向",
    "en": "MRI/BEM source orientation"
  },
  {
    "zh": "MRI BEM源强度",
    "en": "MRI/BEM source magnitude"
  },
  {
    "zh": "局部源模型",
    "en": "Local source model"
  },
  {
    "zh": "暂停神经动力学",
    "en": "Pause neural dynamics"
  },
  {
    "zh": "运行神经动力学",
    "en": "Run neural dynamics"
  },
  {
    "zh": "局部刺激驱动",
    "en": "Local input drive"
  },
  {
    "zh": "Wilson–Cowan 偶极矩",
    "en": "Wilson–Cowan moment"
  },
  {
    "zh": "Jansen–Rit 偶极矩",
    "en": "Jansen–Rit moment"
  },
  {
    "zh": "MRI BEM参考",
    "en": "MRI/BEM reference"
  },
  {
    "zh": "MRI BEM电极",
    "en": "MRI/BEM electrode"
  },
  {
    "zh": "仿真未就绪",
    "en": "Simulation not ready"
  },
  {
    "zh": "拖动 / 滚轮改值 · 双击恢复默认",
    "en": "Drag or scroll to adjust · double-click to restore defaults"
  },
  {
    "zh": "一键科学场景 — 15 个可运行的预设实验（计划 §16.3）",
    "en": "Optional preset experiments"
  },
  {
    "zh": "导出实验记录 JSON（",
    "en": "Export experiment records as JSON ("
  },
  {
    "zh": "清空记录",
    "en": "Clear records"
  },
  {
    "zh": "运行失败：",
    "en": "Run failed:"
  },
  {
    "zh": "每个场景都是预设 + 真实动作 + 实验记录：S1–S3 在实时 Wilson–Cowan 引擎里跑（脉冲 / 改权重 / 改参数是真实动作，峰值 ΔE 约 2 s 后从 RESPONSE 面板读回再记入记录）；S4–S15 同步跑真实后端函数并返回关键 结果数字。S7 是离散电极步进（FCz / C1 / Cz / C2 / CPz），不是连续拖动。 目前除指定的 Alpha 记录联动外，场景仅保留计算结果摘要； 下方“进入独立实验台”不会自动载入本次场景的源、事件或记录。",
    "en": "Each preset runs a model calculation and saves a numerical summary. Scenarios 1–3 act on the live WC engine; results are read after collecting the response. Scenarios 4–15 use independent model functions. Electrode scenario 7 compares discrete sensor positions rather than dragging electrodes. Apart from the linked alpha recording, opening a lab does not automatically load the preset's source, events or data."
  },
  {
    "zh": "预设：",
    "en": "Preset:"
  },
  {
    "zh": "需球形正向模型（未加载）",
    "en": "Requires the spherical model"
  },
  {
    "zh": "进入独立实验台（不载入结果）",
    "en": "Open independent lab · results not loaded"
  },
  {
    "zh": "实验记录（",
    "en": "Experiment records ("
  },
  {
    "zh": "还没有记录。运行任意场景后，这里追加一条（时间、场景、预设、关键结果数字）。",
    "en": "No records yet. Running a preset adds its time, settings and numerical results."
  },
  {
    "zh": "预设",
    "en": "Preset"
  },
  {
    "zh": "场景预设精确值与控件→后端映射见契约 docs/frontend-backend-contract.md §1.12。",
    "en": "Exact settings and control-to-solver mappings: docs/frontend-backend-contract.md §1.12."
  },
  {
    "zh": "一键科学场景",
    "en": "Preset experiments"
  },
  {
    "zh": "球形正向模型未加载，无法运行",
    "en": "The spherical forward model must load before this experiment can run."
  },
  {
    "zh": "运行该场景并追加一条实验记录",
    "en": "Run this preset and save its results"
  },
  {
    "zh": "仅导航到独立实验台；不会自动载入本次场景的模型状态、记录或计算结果",
    "en": "Open the independent lab; this does not import the preset's state or results."
  },
  {
    "zh": "实时引擎",
    "en": "Live engine"
  },
  {
    "zh": "同步计算",
    "en": "Independent calculation"
  },
  {
    "zh": "峰值 |q|",
    "en": "Peak |q|"
  },
  {
    "zh": "中央 y 切片（|y|≤20 mm），",
    "en": "Central y slice (|y|≤20 mm),"
  },
  {
    "zh": "双相波形：dI/dt(t) = 峰值 × cos(2πt/T)，t ∈ [0, T]，其余为 0；E(t) 按线性跟随。峰值 |E|",
    "en": "Biphasic waveform: dI/dt(t)=peak×cos(2πt/T) for 0≤t≤T, zero otherwise. E(t) follows linearly. Peak |E|"
  },
  {
    "zh": "级别",
    "en": "Model level"
  },
  {
    "zh": "Level A · 直接神经模型输入",
    "en": "A · direct neural-model input"
  },
  {
    "zh": "Level B · TES 电场",
    "en": "B · TES electric field"
  },
  {
    "zh": "Level C · TMS 电磁场",
    "en": "C · TMS induced field"
  },
  {
    "zh": "Level D · 电场到神经响应",
    "en": "D · field-to-neural response"
  },
  {
    "zh": "柱模型",
    "en": "Column model"
  },
  {
    "zh": "Wilson–Cowan 柱",
    "en": "Wilson–Cowan column"
  },
  {
    "zh": "Jansen–Rit 柱",
    "en": "Jansen–Rit column"
  },
  {
    "zh": "目标位置（球心坐标，mm）",
    "en": "Target position · sphere-centered mm"
  },
  {
    "zh": "TES 电极配置 · 电流 mA",
    "en": "TES electrodes · current in mA"
  },
  {
    "zh": "阳极位置",
    "en": "Anode position"
  },
  {
    "zh": "阴极位置",
    "en": "Cathode position"
  },
  {
    "zh": "电流",
    "en": "Current"
  },
  {
    "zh": "电导率 σ",
    "en": "Conductivity σ"
  },
  {
    "zh": "TMS 线圈配置",
    "en": "TMS coil"
  },
  {
    "zh": "线圈形状",
    "en": "Coil shape"
  },
  {
    "zh": "圆环线圈（单环）",
    "en": "Circular · single loop"
  },
  {
    "zh": "8 字形线圈（双环反向电流，线性叠加）",
    "en": "Figure-eight · opposite-current loops"
  },
  {
    "zh": "线圈半径",
    "en": "Coil radius"
  },
  {
    "zh": "匝数",
    "en": "Number of turns"
  },
  {
    "zh": "电流变化率 dI/dt",
    "en": "Current slew rate dI/dt"
  },
  {
    "zh": "线圈中心 [0, 0, 102] mm，轴向 +Z（贴头皮顶部）；目标在轴上时感应电场为零（对称性）。8 字形时两环中心沿线圈平面偏移 ±半径，反向电流，交界处场相加。",
    "en": "The coil is centered at [0,0,102] mm with normal +Z, near the superior scalp. A circular coil gives zero induced field on its axis by symmetry. In the figure-eight model, loop centers are offset by one radius in opposite directions; opposite currents make their fields add at the junction."
  },
  {
    "zh": "双相 TMS 波形 · E(t)（一个脉冲周期）",
    "en": "Biphasic TMS field · one pulse cycle"
  },
  {
    "zh": "脉冲周期",
    "en": "Pulse period"
  },
  {
    "zh": "目标离线圈太近，无法计算脉冲波形。",
    "en": "The target is too close to the coil to compute the waveform."
  },
  {
    "zh": "目标处电场读数 · V/m",
    "en": "Electric field at target · V/m"
  },
  {
    "zh": "沿皮层法向（",
    "en": "Along the cortical normal ("
  },
  {
    "zh": "网格场分布（脑内",
    "en": "Intracranial field grid ("
  },
  {
    "zh": "目标在圆环线圈轴上，感应电场按对称性为零是正确结果，不是计算失败； 把目标移到偏轴预设（如 [30, 0, 70]，|E| ≈ 85 V/m）可见非零场。",
    "en": "Zero field on the circular coil axis follows from symmetry. It is a valid result. Move the target off-axis, for example to [30,0,70], to see a nonzero field (about 85 V/m in that preset)."
  },
  {
    "zh": "目标离电极/线圈太近或超出脑球，无法计算（点源奇点保护）。",
    "en": "The target is too close to an electrode or coil, or outside the brain sphere. Singularity protection prevents this calculation."
  },
  {
    "zh": "皮层法向",
    "en": "Cortical normal"
  },
  {
    "zh": "显示场箭头（中央 y 切片，真实计算值）",
    "en": "Show computed field arrows in the central y slice"
  },
  {
    "zh": "Level D · 电场到神经响应（增益未校准）",
    "en": "D · field-to-neural response · uncalibrated gain"
  },
  {
    "zh": "场来源",
    "en": "Field source"
  },
  {
    "zh": "TMS 感应电场",
    "en": "TMS induced field"
  },
  {
    "zh": "TES 电场",
    "en": "TES electric field"
  },
  {
    "zh": "目标处 |E|",
    "en": "Target |E|"
  },
  {
    "zh": "WC 增益",
    "en": "WC gain"
  },
  {
    "zh": "JR 增益",
    "en": "JR gain"
  },
  {
    "zh": "映射后驱动：",
    "en": "Mapped drive:"
  },
  {
    "zh": "响应 · 柱 q(t) → Pz 代理 EEG（0.16 µV/(nA·m)）",
    "en": "Column response q(t) and Pz proxy · assumed gain 0.16 µV/(nA·m)"
  },
  {
    "zh": "刺激时长",
    "en": "Input duration"
  },
  {
    "zh": "直接驱动",
    "en": "Direct drive"
  },
  {
    "zh": "运行响应",
    "en": "Calculate response"
  },
  {
    "zh": "感觉输入实验室",
    "en": "Sensory input models"
  },
  {
    "zh": "视觉闪烁：",
    "en": "Visual flicker:"
  },
  {
    "zh": "运行闪烁实验",
    "en": "Run flicker experiment"
  },
  {
    "zh": "停止感觉脉冲",
    "en": "Stop sensory pulses"
  },
  {
    "zh": "Welch PSD 峰：",
    "en": "Welch spectral peak:"
  },
  {
    "zh": "听觉 burst：音调",
    "en": "Auditory bursts · tone"
  },
  {
    "zh": "运行听觉实验",
    "en": "Run auditory experiment"
  },
  {
    "zh": "每 burst 后 300 ms 内峰值 |q|：",
    "en": "Peak |q| within 300 ms after each burst:"
  },
  {
    "zh": "响应结果",
    "en": "Response results"
  },
  {
    "zh": "单位：mm / nA·m / µV / ms / Hz / mA / V/m。坐标：球心头 RAS（mm），与 sphereForward.ts 同框。 TES 公式 E=Σ I(r−r_k)/(4πσ|r−r_k|³)；TMS 公式 E=−μ₀N(dI/dt)/(4π)∮dl/|r−r′|。详见 docs/pr7-stimulation.md。",
    "en": "Units: mm, nA·m, µV, ms, Hz, mA and V/m. Coordinates use sphere-centered head RAS, matching sphereForward.ts. TES: E=ΣI(r−r_k)/(4πσ|r−r_k|³). TMS: E=−μ₀N(dI/dt)/(4π)∮dl/|r−r′|. See docs/pr7-stimulation.md."
  },
  {
    "zh": "Level A · 直接神经模型输入：给局部 WC/JR 柱加一个写清的驱动，不声称是完整的 tES/TMS 物理刺激。",
    "en": "A · Add a defined drive directly to a local WC/JR column. This is a neural-input model, not complete TES/TMS physics."
  },
  {
    "zh": "Level B · TES 电场：头皮电极（mA）→ 均匀导体点源解析解算出的头内电场，无颅骨/边界/FEM。",
    "en": "B · Electrode currents in mA produce an analytical point-source field in a homogeneous conductor. Skull, boundary and FEM effects are absent."
  },
  {
    "zh": "Level C · TMS 电磁场：圆形或 8 字形线圈（半径/匝数/dI/dt）→ 法拉第感应电场，均匀导体 σ=0.33 S/m；双相波形为一个余弦周期的 dI/dt(t)，E(t) 线性跟随。",
    "en": "C · Circular or figure-eight coils use radius, turns and current slew rate to compute the Faraday-induced field. The conductor is homogeneous with σ=0.33 S/m. A biphasic pulse is one cosine cycle of dI/dt, and E(t) follows linearly."
  },
  {
    "zh": "Level D · 电场到神经响应：目标处沿皮层法向的电场分量经未校准增益映射为柱的附加输入。电场强不等于真实大脑必然兴奋/抑制。",
    "en": "D · The field component along the target's cortical normal is mapped through an uncalibrated gain to additional column input. Field strength does not establish excitation or inhibition in a real brain."
  },
  {
    "zh": "皮层顶部 [0, 0, 70]",
    "en": "Superior cortex [0,0,70]"
  },
  {
    "zh": "顶部偏右 [30, 0, 70]",
    "en": "Superior-right [30,0,70]"
  },
  {
    "zh": "前部皮层 [0, 40, 40]",
    "en": "Anterior cortex [0,40,40]"
  },
  {
    "zh": "脑中心 [0, 0, 16]",
    "en": "Brain center [0,0,16]"
  },
  {
    "zh": "顶部 [0, 0, 95]",
    "en": "Superior scalp [0,0,95]"
  },
  {
    "zh": "前部 [0, 95, 0]",
    "en": "Anterior scalp [0,95,0]"
  },
  {
    "zh": "后部 [0, -95, 0]",
    "en": "Posterior scalp [0,−95,0]"
  },
  {
    "zh": "左侧 [-95, 0, 0]",
    "en": "Left [−95,0,0]"
  },
  {
    "zh": "右侧 [95, 0, 0]",
    "en": "Right [95,0,0]"
  },
  {
    "zh": "径向 Z [0, 0, 1]",
    "en": "Radial Z [0,0,1]"
  },
  {
    "zh": "柱偶极矩随时间变化曲线",
    "en": "Column dipole moment over time"
  },
  {
    "zh": "8 字形",
    "en": "Figure-eight"
  },
  {
    "zh": "圆环",
    "en": "Circular"
  },
  {
    "zh": "· JR 柱响应未进直播 WC 网络（驱动单位 1/s，与 WC 脉冲单位不同）",
    "en": "The JR response is independent of the live WC network; JR drive in 1/s is not a WC pulse amplitude."
  },
  {
    "zh": "· 未选脑区或未接直播，脉冲未发（仅本地柱）",
    "en": "No live pulse was sent because a region or connection is missing. Only the local column ran."
  },
  {
    "zh": "模型单位",
    "en": "Model units"
  },
  {
    "zh": "未接直播（无 V1 靶区或未传 onPulse）：只跑了本地柱，未进主仿真。",
    "en": "No live V1 target or callback is available. Only the local column ran."
  },
  {
    "zh": "未接直播（无 A1 靶区或未传 onPulse）：只跑了本地柱，未进主仿真。",
    "en": "No live A1 target or callback is available. Only the local column ran."
  },
  {
    "zh": "脑刺激实验室",
    "en": "Stimulation models"
  },
  {
    "zh": "刺激级别",
    "en": "Stimulation level"
  },
  {
    "zh": "目标位置",
    "en": "Target position"
  },
  {
    "zh": "TES 电流",
    "en": "TES current"
  },
  {
    "zh": "TES 电导率",
    "en": "TES conductivity"
  },
  {
    "zh": "线圈匝数",
    "en": "Coil turns"
  },
  {
    "zh": "电流变化率",
    "en": "Current slew rate"
  },
  {
    "zh": "双相脉冲周期",
    "en": "Biphasic pulse period"
  },
  {
    "zh": "显示场箭头",
    "en": "Show field arrows"
  },
  {
    "zh": "Level D 场来源",
    "en": "Field source for level D"
  },
  {
    "zh": "超出柱输入范围：",
    "en": "Outside the column's input range:"
  },
  {
    "zh": "闪烁频率",
    "en": "Flicker frequency"
  },
  {
    "zh": "闪烁强度",
    "en": "Flicker intensity"
  },
  {
    "zh": "音调频率",
    "en": "Tone frequency"
  },
  {
    "zh": "听觉强度",
    "en": "Auditory intensity"
  },
  {
    "zh": "听觉 ISI",
    "en": "Auditory interstimulus interval"
  },
  {
    "zh": "时频（ERSP / ITC）",
    "en": "Time-frequency analysis · ERSP / ITC"
  },
  {
    "zh": "还没有 epoch 数据。请先在 ERP tab 里切分试次（MNE 口径：−200–800 ms，基线 −200–0 ms）。",
    "en": "Create epochs in the ERP view first (−200 to 800 ms; baseline −200 to 0 ms)."
  },
  {
    "zh": "全部试次都被峰峰值剔除，没有可平均的试次。",
    "en": "All trials were rejected by the peak-to-peak threshold; there are no trials to average."
  },
  {
    "zh": "时频（ERSP / ITC）——",
    "en": "Time-frequency analysis ·"
  },
  {
    "zh": "注意：当前试次完全相同（无测量噪声、确定性模型），ITC 恒为 1.000 是退化值、不是锁相证据， 本页不展示 ITC 数值。想看有意义的 ITC，请在 EEG tab 加测量噪声（如白噪声 0.25 µV）后重新运行实验。",
    "en": "These deterministic, noiseless trials are identical. ITC=1.000 is therefore degenerate, not evidence of phase locking, and is hidden. Add measurement noise, for example 0.25 µV white noise, and rerun the experiment to inspect meaningful trial variability."
  },
  {
    "zh": "方法：",
    "en": "Method:"
  },
  {
    "zh": "Morlet 小波",
    "en": "Morlet wavelet"
  },
  {
    "zh": "频段：",
    "en": "Frequency band:"
  },
  {
    "zh": "ERSP 热图（dB，",
    "en": "ERSP map (dB,"
  },
  {
    "zh": "横轴",
    "en": "Horizontal axis"
  },
  {
    "zh": "时间–频率区域选择",
    "en": "Select a time-frequency region"
  },
  {
    "zh": "时间窗：",
    "en": "Time window:"
  },
  {
    "zh": "频率窗：",
    "en": "Frequency range:"
  },
  {
    "zh": "区域内平均 ERSP",
    "en": "Mean ERSP in region"
  },
  {
    "zh": "，平均 ITC",
    "en": ", mean ITC"
  },
  {
    "zh": "不适用（试次完全相同，ITC 恒为 1.000 是退化值）",
    "en": "Not applicable: identical trials give degenerate ITC=1.000."
  },
  {
    "zh": "STFT：nFft = min(256, epoch 长的 2 的幂)，hop = nFft/2，周期 Hann 窗。时间分辨率 = hop/fs，频率分辨率 = fs/nFft。",
    "en": "STFT: nFft=min(256, largest power of two within the epoch), hop=nFft/2, periodic Hann window. Time resolution is hop/fs; frequency resolution is fs/nFft."
  },
  {
    "zh": "Morlet：cycles = 5，σ_t = cycles/(2πf)。低频小波很长，短 epoch 两端受零边界污染，只看中心段。",
    "en": "Morlet: five cycles, σ_t=cycles/(2πf). Low-frequency wavelets are long; zero-padding affects the ends of short epochs. Interpret the center segment."
  },
  {
    "zh": "Multitaper：NW = 4、K = 7 锥，窗长 = 7 个周期。低频窗可能长于整个 epoch，此时窗 = 全段。",
    "en": "Multitaper: NW=4, K=7 tapers, with a seven-cycle window. If the low-frequency window exceeds the epoch, the full epoch is used."
  },
  {
    "zh": "区域起始时间",
    "en": "Start time"
  },
  {
    "zh": "区域结束时间",
    "en": "End time"
  },
  {
    "zh": "区域起始频率",
    "en": "Lower frequency"
  },
  {
    "zh": "区域结束频率",
    "en": "Upper frequency"
  },
  {
    "zh": "地形（2D 插值 + 3D 正向头皮电位）",
    "en": "Topography · interpolation and independent forward calculation"
  },
  {
    "zh": "当前记录只有单通道；需要多电极数据才能计算头皮地形。请在 EEG 页运行多导实验。",
    "en": "This recording has one channel. Scalp topography requires multiple electrodes; generate a multichannel recording in the EEG view."
  },
  {
    "zh": "地形——",
    "en": "Topography ·"
  },
  {
    "zh": "两张图的数据来源不一样，分开看：2D 图是记录实测值的球面样条插值（电极之间是算出来的）； 3D 图是正向计算值（每个传感器位置的 L·q，电极之间不插值），源由下方控件给定，与 2D 图的记录数据无关。",
    "en": "The maps use different sources. The left map interpolates recorded electrode values with spherical splines. The right map directly evaluates L·q at sensor positions for a separately configured source; it does not interpolate between electrodes."
  },
  {
    "zh": "时刻：",
    "en": "Time:"
  },
  {
    "zh": "跳到最大响应时刻（",
    "en": "Jump to largest response ("
  },
  {
    "zh": "2D 地形——球面样条插值（Perrin 法，m = 4，n ≤ 7，λ = 1e-5）",
    "en": "Interpolated scalp map · Perrin spherical splines, m=4, n≤7, λ=1e−5"
  },
  {
    "zh": "该时刻的地形算不出来（记录或时刻异常）。",
    "en": "Topography is unavailable for this recording or time."
  },
  {
    "zh": "独立正向实验 · 头皮采样点的 2D 投影（L·q，并非可旋转 3D 场）",
    "en": "Independent forward model · 2D projection of scalp samples"
  },
  {
    "zh": "左侧 2D 地形读取当前 EEG 记录；右侧示例使用下面单独设置的源位置、方向和强度计算， 不是同一时刻、同一源的第二种视图。仅作为独立球形正向求解演示，不要直接比较两图数值。",
    "en": "The left map reads the current EEG recording. The right demonstration uses its own position, orientation and moment below. These are not two views of the same source at the same time, so their values should not be compared directly."
  },
  {
    "zh": "每个圆点都是一个传感器位置的直接计算值（",
    "en": "Each dot is evaluated directly at one sensor position ("
  },
  {
    "zh": "源 X：",
    "en": "Source X:"
  },
  {
    "zh": "源 Y：",
    "en": "Source Y:"
  },
  {
    "zh": "源 Z：",
    "en": "Source Z:"
  },
  {
    "zh": "矩方向：",
    "en": "Moment orientation:"
  },
  {
    "zh": "矩（nA·m）：",
    "en": "Moment (nA·m):"
  },
  {
    "zh": "参考：",
    "en": "Reference:"
  },
  {
    "zh": "average（减 345 点均值）",
    "en": "Average over 345 samples"
  },
  {
    "zh": "源位置限制在 ±48 mm（lead-field 网格边界，越界抛错）；矩 ±30 nA·m 与 PR5 的 HeadSphereLab 同范围。",
    "en": "Source position is restricted to the lead-field grid, ±48 mm; out-of-bounds values raise errors. Moment range is ±30 nA·m, matching the spherical-head lab."
  },
  {
    "zh": "球形正向模型未加载（3D 面板不可用）：请先生成 app/public/forward-assets/sphere-model.json，或等壳传入 fixture。",
    "en": "Load the spherical forward model to use this panel. The application requires app/public/forward-assets/sphere-model.json."
  },
  {
    "zh": "地形时刻",
    "en": "Topography time"
  },
  {
    "zh": "频段 / PSD（WAVES）",
    "en": "Frequency bands and power spectrum"
  },
  {
    "zh": "还没有 EEG 记录。先在 EEG 页运行实验（B1 的运行按钮），再回来看频谱。",
    "en": "Generate an EEG recording first, then return to its spectrum."
  },
  {
    "zh": "频段 / PSD（WAVES）——通道",
    "en": "Power spectrum · channel"
  },
  {
    "zh": "叠加 PR6 噪声背景（白 2 / 粉红 1 / 工频 0.5 / 漂移 0.5 µV RMS，伪迹，非神经源；只改变 PSD 输入，不改记录）",
    "en": "Add background artifacts for this spectrum only: white 2, pink 1, line noise 0.5 and drift 0.5 µV RMS. The stored recording is unchanged."
  },
  {
    "zh": "Welch PSD（nFft=1024，df≈0.244 Hz，周期 Hann、50% 重叠；先减均值，与 Python scipy 同口径）。 Alpha 峰",
    "en": "Welch spectrum: nFft=1024, df≈0.244 Hz, periodic Hann window, 50% overlap, mean removed; settings match SciPy. Alpha peak"
  },
  {
    "zh": "；ds003061 实测 Pz",
    "en": "; reference ds003061 Pz"
  },
  {
    "zh": "紫色虚线之间是 alpha 频段（8–13 Hz）。纵轴 log₁₀(µV²/Hz)。",
    "en": "Purple dashed lines mark alpha, 8–13 Hz. Vertical axis: log₁₀(µV²/Hz)."
  },
  {
    "zh": "频段功率占比（同一份信号，",
    "en": "Band power fractions from the same signal ("
  },
  {
    "zh": "占比分母是五个频段功率之和。JR p0=220 纯极限环的 alpha 占比约 99.8%，真实 Pz 只有 30.3% （真实脑电有宽带背景），模型无背景噪声，占比虚高是已知局限，不是拟合结果。 叠加默认噪声背景后，10 s 纯极限环 Pz 记录的 alpha 占比实测由 99.8% 降至 13.5% （噪声功率压过微弱的极限环信号，低于真实 30.3%——背景加过了头，不是校准到 30.3%； 见 PR8 方法学测试）。开关默认关闭，打开后上方同时显示未叠加时的占比以便对照。",
    "en": "Fractions use the sum of all five band powers. The noiseless JR p0=220 limit cycle has about 99.8% alpha, versus 30.3% at reference Pz. Missing broadband activity inflates this fraction; it is a known limitation, not a fit. Adding the default artifacts reduces the ten-second model recording to about 13.5% alpha because noise overwhelms the weak rhythm. That is below 30.3%, not a calibration to it. Noise is off by default; when enabled, the original fraction remains visible for comparison."
  },
  {
    "zh": "预设（只上已验证的）",
    "en": "Validated examples"
  },
  {
    "zh": "Oscillatory 10 Hz 正弦驱动 = 外部驱动，已标注，不是自发节律。",
    "en": "A 10 Hz sinusoidal input is explicitly an external drive, not a spontaneous rhythm."
  },
  {
    "zh": "其余频段不设“节律”预设：只读同一份信号的频段功率，不为每个频段各编一个节律。",
    "en": "Other bands have no synthetic rhythm presets. Their powers are measured from the same signal, without inventing a separate oscillation per band."
  },
  {
    "zh": "无法计算频谱。",
    "en": "The spectrum could not be computed."
  },
  {
    "zh": "叠加噪声背景",
    "en": "Add background artifacts"
  },
  {
    "zh": "语言",
    "en": "Language"
  },
  {
    "zh": "简体中文",
    "en": "简体中文"
  },
  {
    "zh": "英文界面逐步覆盖中。高级科学实验台的全部文字尚未翻译，不代表科学功能有差异。",
    "en": "Language selection applies throughout the interface."
  },
  {
    "zh": "互动",
    "en": "Interact"
  },
  {
    "zh": "探索",
    "en": "Explore"
  },
  {
    "zh": "触碰大脑：施加输入并观察神经网络响应",
    "en": "Apply input and observe the neural network's response"
  },
  {
    "zh": "探索振荡与频谱，区分外部驱动和自发节律",
    "en": "Explore spectra and distinguish spontaneous rhythms from external drive"
  },
  {
    "zh": "探索 EEG、ERP、时频、头皮电位与源定位",
    "en": "Inspect EEG, event responses, time-frequency, scalp potentials and source estimates"
  },
  {
    "zh": "探索脑区、图谱、坐标与细胞级模型",
    "en": "Explore brain regions, coordinate frames and cellular models"
  },
  {
    "zh": "交互式脑科学仿真",
    "en": "Interactive brain simulation"
  },
  {
    "zh": "收起",
    "en": "Less"
  },
  {
    "zh": "一键场景",
    "en": "Optional presets"
  },
  {
    "zh": "继续",
    "en": "Resume"
  },
  {
    "zh": "加载中",
    "en": "Loading"
  },
  {
    "zh": "运行中",
    "en": "Running"
  },
  {
    "zh": "已暂停",
    "en": "Paused"
  },
  {
    "zh": "连接",
    "en": "Connections"
  },
  {
    "zh": "重置",
    "en": "Reset"
  },
  {
    "zh": "头部物理",
    "en": "Head-conductor physics"
  },
  {
    "zh": "偶极子",
    "en": "Current dipole"
  },
  {
    "zh": "细胞实验",
    "en": "Cellular models"
  },
  {
    "zh": "刺激实验",
    "en": "Stimulation models"
  },
  {
    "zh": "模型说明",
    "en": "About the model"
  },
  {
    "zh": "3D 实时大脑",
    "en": "Live 3D brain"
  },
  {
    "zh": "绝对活动 E",
    "en": "Activity E"
  },
  {
    "zh": "活动变化 ΔE",
    "en": "Change from baseline ΔE"
  },
  {
    "zh": "自动旋转",
    "en": "Rotate camera"
  },
  {
    "zh": "正在加载脑数据…",
    "en": "Loading brain geometry…"
  },
  {
    "zh": "单击脑区施加刺激；拖动旋转；长按连续刺激",
    "en": "Click a region to stimulate · drag to rotate · hold for continuous input"
  },
  {
    "zh": "专注 3D",
    "en": "Focus on the model"
  },
  {
    "zh": "显示面板",
    "en": "Show controls"
  },
  {
    "zh": "3D 区域宽度",
    "en": "Model-view width"
  },
  {
    "zh": "恢复布局",
    "en": "Reset layout"
  },
  {
    "zh": "高级界面与科学参数",
    "en": "Advanced controls and scientific settings"
  },
  {
    "zh": "TVB 演示网络尚未配准到真实人类头部模型",
    "en": "The TVB demonstration connectome is not registered to human head anatomy."
  },
  {
    "zh": "直接触碰大脑、施加输入、改变参数、观察网络响应。",
    "en": "Apply input, change settings and inspect the network response."
  },
  {
    "zh": "探索振荡、脑电频段、功率谱和神经动力学。",
    "en": "Explore oscillations, frequency bands, spectra and neural dynamics."
  },
  {
    "zh": "探索头部物理模型、电极、EEG、ERP、时频、地形和源定位。",
    "en": "Explore head physics, electrodes, EEG, event responses, topography and source estimates."
  },
  {
    "zh": "探索解剖、脑图谱、标准坐标以及多尺度神经元模型。",
    "en": "Explore anatomy, atlases, coordinate frames and multiscale neuronal models."
  },
  {
    "zh": "触碰大脑，看网络如何响应",
    "en": "Apply input and watch the network respond"
  },
  {
    "zh": "脉冲 40 号脑区（演示脑区），在 RESPONSE 面板看真实快照的峰值 ΔE。",
    "en": "Stimulate demonstration region 40 and inspect its peak ΔE from actual model snapshots."
  },
  {
    "zh": "改变一条连接，看传播有何不同",
    "en": "Change a connection and inspect propagation"
  },
  {
    "zh": "把 73→54 的连接权重改 0 再脉冲 73 号脑区，响应窗口填满后恢复原始权重。",
    "en": "Set connection 73→54 to zero, stimulate region 73, collect the full response and restore the original weight."
  },
  {
    "zh": "改变兴奋／抑制参数，观察振荡",
    "en": "Change excitation/inhibition and inspect activity"
  },
  {
    "zh": "c_ei 由 4.0 改为 6.0 再脉冲 40 号脑区；改完的值留在 PARAMETERS 面板，可手动改回。",
    "en": "Change c_ei from 4.0 to 6.0 before stimulating region 40. The edited value stays active until restored."
  },
  {
    "zh": "产生并观察 Alpha 节律",
    "en": "Generate an alpha rhythm"
  },
  {
    "zh": "移动电流源，看 EEG 如何变化",
    "en": "Move a current source and inspect EEG potentials"
  },
  {
    "zh": "球形头模型里偶极子由 [0,0,16] 移到 [16,0,16] mm，看 Cz 电位变化。",
    "en": "Move the spherical-model dipole from [0,0,16] to [16,0,16] mm and compare Cz potentials."
  },
  {
    "zh": "从 10–20 切换到 10–10 和 10–05",
    "en": "Compare 10–20, 10–10 and 10–05 montages"
  },
  {
    "zh": "同一柱模型实验在三个导联下各跑 2 s，比较导联数与 Pz RMS。",
    "en": "Run the same column model for two seconds with each montage; compare channel count and Pz RMS."
  },
  {
    "zh": "移动 Cz 附近的电极，看测量如何变化",
    "en": "Compare electrodes near Cz"
  },
  {
    "zh": "同一偶极子下逐个读 Cz 邻近电极 FCz / C1 / Cz / C2 / CPz 的电位——是离散电极步进，不是连续拖动。",
    "en": "Read FCz, C1, Cz, C2 and CPz for the same dipole. These are fixed sensor positions, not continuously draggable electrodes."
  },
  {
    "zh": "重复刺激，观察 ERP 平均",
    "en": "Repeat inputs and average the event response"
  },
  {
    "zh": "oddball 实验 40 试次（32 标准 + 8 oddball），分段平均后读 oddball 峰值与差异波。",
    "en": "Run 40 oddball trials, epoch the recording and inspect the peak and difference wave."
  },
  {
    "zh": "查看时频图中的功率变化",
    "en": "Inspect power changes over time and frequency"
  },
  {
    "zh": "同一份 oddball 试次集做 Morlet ERSP，读 100–500 ms / 8–30 Hz 窗内平均 ERSP 与 ITC。",
    "en": "Analyze the same oddball epochs with Morlet ERSP and inspect the 100–500 ms, 8–30 Hz region."
  },
  {
    "zh": "比较头皮地形图和真实电流源位置",
    "en": "Compare a scalp map with a known source"
  },
  {
    "zh": "同一份 2 s EEG 记录在 1050 ms 做球面样条地形，与已知源 [0,0,16] mm 的正向头皮电位峰值电极对照。",
    "en": "Interpolate a two-second EEG recording at 1050 ms and compare peak electrodes with a separate forward source at [0,0,16] mm."
  },
  {
    "zh": "运行源定位，比较估计和真实位置",
    "en": "Estimate a source and compare with ground truth"
  },
  {
    "zh": "盲测：真源 [16,16,16] mm、矩 [0,10,0] nA·m，偶极子拟合与 MNE 各报定位误差。",
    "en": "Blind test: source [16,16,16] mm, moment [0,10,0] nA·m. Dipole fit and MNE report their localization errors."
  },
  {
    "zh": "在两个大脑中进行单参数对照",
    "en": "Compare two runs differing in one input"
  },
  {
    "zh": "JR 柱 A/B 各跑 2 s，只改事件驱动（120 vs 300 1/s），比较峰值与 ERP 峰差。",
    "en": "Run two JR columns for two seconds with event drives of 120 and 300 1/s; compare peaks and ERP."
  },
  {
    "zh": "进入神经元层面，注入电流观察动作电位",
    "en": "Inject current into a neuron and inspect spikes"
  },
  {
    "zh": "Hodgkin–Huxley 标准参数，10 µA/cm² 阶跃电流 10–60 ms，数动作电位。",
    "en": "Standard Hodgkin–Huxley parameters with a 10 µA/cm² step from 10 to 60 ms; count the action potentials."
  },
  {
    "zh": "比较不同组织电导率的正向计算",
    "en": "Compare tissue conductivities"
  },
  {
    "zh": "均匀无限导体解析偶极子公式，同一偶极子/传感器下 σ=0.10 / 0.33 / 1.00 S/m 各算一次电位。",
    "en": "Evaluate the same analytical dipole and sensor at conductivities 0.10, 0.33 and 1.00 S/m."
  },
  {
    "zh": "构建一个简化 EEG 闭环控制实验",
    "en": "Explore a simulated feedback loop"
  },
  {
    "zh": "阈值闭环 3 s（事件 1000 ms / 300 1/s，阈值 0.1 µV、输出 −80 1/s），与无控制对照比 RMS。",
    "en": "Run a three-second threshold loop with a 1000 ms event, 300 1/s drive, threshold 0.1 µV and output −80 1/s; compare RMS with no control."
  },
  {
    "zh": "alpha 峰频率",
    "en": "Alpha peak frequency"
  },
  {
    "zh": "alpha 功率占比",
    "en": "Alpha power fraction"
  },
  {
    "zh": "Cz 电位（源 [0,0,16]）",
    "en": "Cz potential · source [0,0,16]"
  },
  {
    "zh": "Cz 电位（源 [16,0,16]）",
    "en": "Cz potential · source [16,0,16]"
  },
  {
    "zh": "Cz 变化量",
    "en": "Change at Cz"
  },
  {
    "zh": "四层球形头正向模型（MNE），偶极矩 [0,10,0] nA·m，平均参考；源位置为球心坐标（HEAD 球心系）。",
    "en": "MNE four-layer spherical forward model; moment [0,10,0] nA·m, average reference, sphere-centered HEAD coordinates."
  },
  {
    "zh": "导",
    "en": "channels"
  },
  {
    "zh": "同一柱模型（WC，种子 1）+ 同一球形正向模型，只换导联；通道数 19 / 94 / 343。",
    "en": "Same WC column, seed 1 and spherical forward model; only the montage changes (19, 94 or 343 channels)."
  },
  {
    "zh": "五电极极差",
    "en": "Range across five electrodes"
  },
  {
    "zh": "邻近电极步进：同一偶极子下逐个切离散电极读数，不是连续拖动电极位置；电极位置由 10-10 导联固定。",
    "en": "Discrete electrode comparison for one dipole. Positions are fixed by the 10–10 montage; no continuous electrode dragging is performed."
  },
  {
    "zh": "oddball 峰值",
    "en": "Oddball peak"
  },
  {
    "zh": "oddball 峰潜伏期",
    "en": "Oddball peak latency"
  },
  {
    "zh": "差异波 300–500 ms 均值",
    "en": "Difference-wave mean over 300–500 ms"
  },
  {
    "zh": "oddball 试次数",
    "en": "Oddball trials"
  },
  {
    "zh": "oddball 40 试次（32 标准 + 8 oddball），分段 −200–800 ms、基线 −200–0 ms；模型峰约 0.17 µV，远小于真实 P300（已知幅度缺口，见 PR6）。",
    "en": "Forty trials: 32 standard and 8 oddball; epochs −200 to 800 ms, baseline −200 to 0 ms. The approximately 0.17 µV model peak remains far below human P300 amplitude."
  },
  {
    "zh": "窗内平均 ERSP",
    "en": "Window-mean ERSP"
  },
  {
    "zh": "窗内平均 ITC",
    "en": "Window-mean ITC"
  },
  {
    "zh": "Morlet（cycles=5）ERSP，窗 100–500 ms / 8–30 Hz；与 ERP 用同一份 oddball 试次集。",
    "en": "Five-cycle Morlet ERSP over 100–500 ms and 8–30 Hz, using the same oddball epochs as ERP."
  },
  {
    "zh": "地形峰值电位",
    "en": "Peak interpolated potential"
  },
  {
    "zh": "正向峰值电位",
    "en": "Peak forward potential"
  },
  {
    "zh": "两张图数据来源不同：2D 图是记录值的插值，3D 图是 L·q 的直接求值。",
    "en": "The maps have different sources: one interpolates recorded values; the other directly evaluates L·q."
  },
  {
    "zh": "偶极子拟合定位误差",
    "en": "Dipole-fit localization error"
  },
  {
    "zh": "MNE 定位误差",
    "en": "MNE localization error"
  },
  {
    "zh": "盲测：逆解只读 lead-field + 电位数据，真值只在事后算误差；无噪声，种子 7。",
    "en": "Blind test: inverse methods receive only the lead field and potentials. Ground truth is used afterward to measure error. No noise; seed 7."
  },
  {
    "zh": "y0 峰值差（B−A）",
    "en": "y0 peak difference (B−A)"
  },
  {
    "zh": "Pz RMS 差（B−A）",
    "en": "Pz RMS difference (B−A)"
  },
  {
    "zh": "ERP 峰差（B−A）",
    "en": "ERP peak difference (B−A)"
  },
  {
    "zh": "双脑 A/B：同一 JR 柱、同一时长与事件时刻，只改事件驱动 120 vs 300 1/s。",
    "en": "Same JR column, duration and event times; event drive alone differs, 120 versus 300 1/s."
  },
  {
    "zh": "动作电位数",
    "en": "Action potentials"
  },
  {
    "zh": "膜电位峰值",
    "en": "Peak membrane voltage"
  },
  {
    "zh": "首个锋电位",
    "en": "First spike"
  },
  {
    "zh": "Hodgkin–Huxley 1952 标准参数，静息 −65 mV；10 µA/cm² 阶跃 10–60 ms。",
    "en": "Standard Hodgkin–Huxley (1952), resting −65 mV; 10 µA/cm² step from 10 to 60 ms."
  },
  {
    "zh": "均匀无限导体解析公式 V = p·r / (4πσ|r|³)，电位与 1/σ 成正比；传感器 S10 在 [90,0,0] mm（示意传感器，非 10-20 电极）。",
    "en": "Homogeneous infinite-conductor solution V=p·r/(4πσ|r|³): voltage scales with 1/σ. Illustrative sensor S10 is at [90,0,0] mm, not a standard 10–20 electrode."
  },
  {
    "zh": "触发占比",
    "en": "Trigger fraction"
  },
  {
    "zh": "有控制 vs 无控制 Pz RMS 差",
    "en": "Controlled minus uncontrolled Pz RMS"
  },
  {
    "zh": "有控制 vs 无控制 Pz 峰值差",
    "en": "Controlled minus uncontrolled Pz peak"
  },
  {
    "zh": "无控制 Pz RMS",
    "en": "Uncontrolled Pz RMS"
  },
  {
    "zh": "阈值闭环（特征 instant，阈值 0.1 µV，触发输出 −80 1/s，延迟 0 ms，测量噪声 0.02 µV）；仅模拟环境，不控制人体设备。",
    "en": "Simulated threshold loop: instantaneous feature, 0.1 µV threshold, −80 1/s output, no delay and 0.02 µV measurement noise. It does not control human-use equipment."
  },
  {
    "zh": "细胞级模型是独立的局部实验引擎：LIF/HH/多房室参数取自发表值，跨尺度耦合增益是显式假设、未经人体数据校准；细胞路线算出的偶极矩与头皮电位是“若 80,000 个锥体细胞同步”的假设外推，不是实测 EEG，也不是对 TVB 76 区网络的映射。",
    "en": "Cellular models are independent local solvers using published LIF, HH and multicompartment parameters. Cross-scale gains are explicit, uncalibrated assumptions. Moments and scalp potentials extrapolate a hypothetical 80,000 synchronous pyramidal cells; they are not measured EEG or a mapping of the 76-region TVB network."
  },
  {
    "zh": "局部 Jansen-Rit 锥体 PSP → 皮层偶极矩是显式假设的可解释机制演示，pA/mV 斜率未经人体数据校准；与 Wilson-Cowan 路线可比但不可辨识，两者都不是真实脑电。",
    "en": "The local Jansen–Rit PSP-to-dipole mapping is an interpretable mechanism demonstration with assumed parameters. The pA/mV slope is not human-calibrated. WC and JR mappings are comparable but not identifiable; neither is real EEG."
  },
  {
    "zh": "局部 Wilson–Cowan E/I → 皮层偶极矩是显式假设的可解释机制演示，并非受试者校准；不能映射既有 TVB 76 区网络到 fsaverage。",
    "en": "The local Wilson–Cowan E/I-to-dipole mapping uses explicit assumptions, not subject calibration. It does not register the existing TVB network to fsaverage."
  },
  {
    "zh": "公开 EEG 约束是数量级与形态的证伪检验，不是校准：幅度差距只说明 N×coherence×pA×mm 乘积需放大 12.6 倍（WC）/ 53.8 倍（JR）才能对上 P300 峰值，该乘积不可辨识，放大不等于证实了细胞数或同步性；两条路线 在 300–500 ms 窗口内基本无响应、且无持续静息节律。",
    "en": "The public EEG constraint tests order of magnitude and morphology; it is not calibration. Matching the P300 peak would require scaling the assumed N×coherence×pA×mm product by 12.6 for WC or 53.8 for JR. This product is not identifiable, so scaling would not establish cell count or synchrony. These basic routes have little 300–500 ms response and no sustained resting rhythm."
  },
  {
    "zh": "Level A 是直接模型输入，不是完整 tES/TMS 物理刺激；Level B/C 是均匀导体解析近似，无颅骨/边界/FEM；Level D 的电场→神经增益未经校准，电场强不等于真实大脑必然兴奋或抑制；感觉输入是一套有定义的输入映射，不是真实视觉/听觉皮层复现。",
    "en": "Level A directly drives a neural model. Levels B/C are analytical homogeneous-conductor approximations without skull, boundary or FEM effects. Level D uses an uncalibrated field-to-neural gain; a stronger field does not establish excitation or inhibition in a real brain. Sensory inputs are defined mappings, not reproductions of human sensory cortex."
  },
  {
    "zh": "均匀、各向同性、无限导体解析解；不包含头皮/颅骨边界、BEM/FEM、标准10–20电极或真实人脑源映射。",
    "en": "Analytical homogeneous, isotropic, infinite-conductor solution. Scalp/skull boundaries, BEM/FEM, standard 10–20 electrodes and human source registration are absent."
  },
  {
    "zh": "REGIONAL NEURAL ACTIVITY · a.u. · 10 S",
    "en": "Regional neural activity · arbitrary units · 10 seconds"
  },
  {
    "zh": "当前脑区活动 · 模型值 · 10 秒",
    "en": "Regional activity · model units · 10 seconds"
  },
  {
    "zh": "一起看",
    "en": "Both"
  },
  {
    "zh": "橙线表示兴奋活动，蓝线表示抑制活动；这里显示的是模型活动值，不是电压。",
    "en": "Orange shows excitatory activity; blue shows inhibitory activity. These are model activity values, not voltages."
  },
  {
    "zh": "· 60 Hz 快照 → 线性插值 250 Hz（有效采样率 60 Hz，4 ms 网格上的高频成分为插值产物，不是实测） · 基线取窗口首样本 E/I · 事件只取真实脉冲标记 · 源模型与种子对此路无效（用直播 WC 网络）。",
    "en": "· 60 Hz snapshots → 250 Hz linear interpolation. Effective sampling rate remains 60 Hz; high-frequency content on the 4 ms grid is interpolation, not measurement. Baseline uses the first E/I sample; events use actual pulse markers. Source-model and seed controls do not affect this live WC-network route."
  },
  {
    "zh": "· 原始记录、事件与试次同步更新； 地形页右侧正向采样图另用独立偶极子 · 噪声是伪迹，不作神经源活动解释。",
    "en": "· Raw recordings, events and epochs update together. The forward-sampling panel on the topography page uses a separate dipole. Noise represents artifacts, not neural source activity."
  },
  {
    "zh": "通道 ·",
    "en": "channels ·"
  },
  {
    "zh": "采样 ·",
    "en": "samples ·"
  },
  {
    "zh": "秒 ·",
    "en": "s ·"
  },
  {
    "zh": "· 种子",
    "en": "· seed"
  },
  {
    "zh": "：最大 |V|",
    "en": ": maximum |V|"
  },
  {
    "zh": "秒； 全通道统一刻度，满格 ±",
    "en": "s; shared channel scale ±"
  },
  {
    "zh": "µV；噪声是伪迹，不画成神经源波形。",
    "en": "µV. Noise represents artifacts and is not plotted as neural source activity."
  },
  {
    "zh": "Hz，偏差",
    "en": "Hz; difference"
  },
  {
    "zh": "Hz（Oz）。记录 RMS",
    "en": "Hz (Oz). Recording RMS"
  },
  {
    "zh": "µV（真实基线 RMS 6.07 µV）。",
    "en": "µV (measured baseline RMS 6.07 µV)."
  },
  {
    "zh": "Alpha 探索 = JR p0=220 极限环，是柱模型自身的自发节律（实测峰 10.99 Hz）。",
    "en": "Alpha exploration uses the JR p0=220 limit cycle: a spontaneous column-model rhythm with measured peak 10.99 Hz."
  },
  {
    "zh": "ms，最大 |V|",
    "en": "ms; maximum |V|"
  },
  {
    "zh": "刺激前（第一事件前）记录处于静息态、全部电极值为 0，地形图是空白的—— 默认时刻 400 ms 就落在刺激前，所以本页在记录到达时会自动跳到最大响应时刻。",
    "en": "Before the first event, the model is at rest and all sensor values are zero, so the topography is blank. The default 400 ms falls before stimulation; this view therefore initially selects the largest response."
  },
  {
    "zh": "黑点 = 实测电极位置；色块 = 插值场（单位圆内网格，25×25）。最大值",
    "en": "Black dots show electrode positions; colors show an interpolated field on a 25×25 unit-circle grid. Maximum"
  },
  {
    "zh": "µV。 插值在电极点上近乎重现实测值（λ = 1e-5 平滑所致残差 ≤ 0.02 µV），但两电极之间的值仍是插值，不是测量。",
    "en": "µV. The interpolant nearly reproduces sensor values (regularization λ=1e-5 leaves residuals ≤0.02 µV). Between electrodes, values remain interpolated rather than measured."
  },
  {
    "zh": "个），不是插值。 源 [",
    "en": "sensors), not interpolation. Source ["
  },
  {
    "zh": "] mm、矩",
    "en": "] mm; moment"
  },
  {
    "zh": "nA·m、参考",
    "en": "nA·m; reference"
  },
  {
    "zh": "； 最大 |V|",
    "en": "; maximum |V|"
  },
  {
    "zh": "µV；矩",
    "en": "µV; moment"
  },
  {
    "zh": "nA·m（正则化压缩过，不是真值幅度）；分布范围",
    "en": "nA·m (attenuated by regularization, not the true magnitude); extent"
  },
  {
    "zh": "导，导联",
    "en": "channels; lead"
  },
  {
    "zh": "）为实测向量。",
    "en": ") form the observed vector."
  },
  {
    "zh": "µV（残差远大于噪声水平时，单偶极子模型不够用）",
    "en": "µV. Residuals far above the noise level indicate an inadequate single-dipole model."
  },
  {
    "zh": "试次保留，",
    "en": "epochs retained;"
  },
  {
    "zh": "试次被剔除（峰峰值超限或出界）。 来源：",
    "en": "epochs rejected for excessive peak-to-peak amplitude or out-of-bounds timing. Source:"
  },
  {
    "zh": "，色带 ±SEM），紫色虚线 standard（n=",
    "en": ", shaded ±SEM); purple dashed: standard (n="
  },
  {
    "zh": "）。 竖虚线是刺激时刻（t=0）。纵轴 ±",
    "en": "). Vertical dashed line marks stimulation (t=0). Vertical scale ±"
  },
  {
    "zh": "ms、300–500 ms 均值 6.94 µV、差异波峰",
    "en": "ms; mean over 300–500 ms: 6.94 µV; difference-wave peak"
  },
  {
    "zh": "ms）：形态对上（晚期正成分、 潜伏期在窗内、oddball 选择性），幅度差约 50 倍——这是结构性缺口，没有靠重缩放修掉， 见 docs/pr6-erp-mechanism.md。",
    "en": "ms). The model reproduces a late positive component, in-window latency and oddball selectivity, but amplitude differs by about 50-fold. This structural gap has not been hidden by rescaling. See docs/pr6-erp-mechanism.md."
  },
  {
    "zh": "个响应脑区，按峰值 |ΔE| 从大到小排；点击一行选中该脑区。",
    "en": "responsive regions, sorted by peak |ΔE|. Click a row to select a region."
  },
  {
    "zh": "→ LIF 注入电流",
    "en": "→ LIF injected current"
  },
  {
    "zh": "pA （流变 375 pA）；HH 注入电流密度",
    "en": "pA (rheobase 375 pA); HH current density"
  },
  {
    "zh": "uA/cm^2 （持续电流阈值约 9.8 uA/cm^2）。",
    "en": "µA/cm² (sustained-current threshold about 9.8 µA/cm²)."
  },
  {
    "zh": "按活动变化 ΔE = E − 刺激前基线着色（升高琥珀、降低蓝色；平方根压缩，±0.1 满格）",
    "en": "Color by ΔE = E − prestimulus baseline: increases amber, decreases blue; square-root compression, full scale ±0.1."
  },
  {
    "zh": "；发放率",
    "en": "; firing rate"
  },
  {
    "zh": "）：最小",
    "en": "): minimum"
  },
  {
    "zh": "，最大",
    "en": ", maximum"
  },
  {
    "zh": "ms；纵轴",
    "en": "ms; vertical axis"
  },
  {
    "zh": "默认目标 = 选中脑区 #",
    "en": "Default target: selected region #"
  },
  {
    "zh": "（brainData 中心，TVB 坐标、未配准 HEAD 球坐标，演示映射）；换选区后目标自动跟过去。",
    "en": "(brainData center in TVB coordinates; not registered to HEAD sphere coordinates; illustrative mapping). The target follows region selection."
  },
  {
    "zh": "mA（阳极 +，阴极 −，总和为零）",
    "en": "mA (anode +, cathode −; total current zero)"
  },
  {
    "zh": "S/m（均匀导体假设）",
    "en": "S/m (homogeneous-conductor assumption)"
  },
  {
    "zh": "）分量：",
    "en": ") component:"
  },
  {
    "zh": "点，步长 40 mm）：最大 |E|",
    "en": "points, 40 mm spacing): maximum |E|"
  },
  {
    "zh": "Hz，强度",
    "en": "Hz; strength"
  },
  {
    "zh": "（WC 柱零均值正弦驱动，见 stimulation.ts）",
    "en": "(zero-mean sinusoidal drive to the WC column; see stimulation.ts)"
  },
  {
    "zh": "Hz（元数据，载波未进动力学），强度",
    "en": "Hz (metadata; carrier excluded from the dynamics); strength"
  },
  {
    "zh": "ms；burst 节律进主仿真（颞区 A1 脉冲），不是“播放一段声音”。",
    "en": "ms. Burst timing drives the main simulation through temporal A1 pulses; it does not play audio."
  },
  {
    "zh": "ms；真实双相脉冲约 0.2–0.4 ms）",
    "en": "ms; a physical biphasic pulse is approximately 0.2–0.4 ms)"
  },
  {
    "zh": "V/m（t=0），周期",
    "en": "V/m at t=0; period"
  },
  {
    "zh": "线圈）。",
    "en": "coil)."
  },
  {
    "zh": "V/m，法向分量",
    "en": "V/m; normal component"
  },
  {
    "zh": "模型单位/(V/m)（默认",
    "en": "model units/(V/m), default"
  },
  {
    "zh": "(1/s)/(V/m)（默认",
    "en": "(1/s)/(V/m), default"
  },
  {
    "zh": "闭环初版仅用于模拟环境，不直接控制人体设备。",
    "en": "This initial closed-loop controller operates only in the simulation and does not control equipment on people."
  },
  {
    "zh": "本页 JR 柱三节的结果来自 JR 皮层柱模拟，不是人体实测；标“直播”的三节来自主仿真真实快照。",
    "en": "The three JR sections use simulated cortical-column results. Sections marked live use actual snapshots from the main simulation."
  },
  {
    "zh": "的 live E （瞬时值，或最近 1 秒的 RMS）。特征超过阈值时，经 Worker 脉冲 （pulseAt，100 ms）反馈回主仿真——不是只算 JR 柱。触发上限 + 2 秒冷却 + 手动停止：脉冲可能把双稳态网络翻进高活动态，触发到上限 自动停；停后若网络锁住，用主界面横幅的恢复/RESET 回来。",
    "en": "live E (instantaneous value or RMS over the last second). Above threshold, a 100 ms Worker pulse feeds back into the main simulation. A trigger limit, 2 s cooldown and manual stop bound the loop. Pulses can move a bistable network into a high-activity state; triggering stops at the limit. If activity remains locked high, use Restore defaults in the main workspace."
  },
  {
    "zh": "直播源：用选中脑区的直播偶极子（位置取脑区中心，q 由 live E/I 经 PR5 假设链算）",
    "en": "Live source: use the selected region’s dipole; position is its center and q is derived from live E/I through the documented PR5 assumptions."
  },
  {
    "zh": "nA·m （live E/I 经 PR5 假设链，基线 = 选区切换时该脑区的 E/I；偶极矩矢量 = q × 下方所选方向，法向是假设） · 位置 = 脑区中心（TVB 坐标、未配准 HEAD，长度钳制到 55 mm）· 改选区、改 G 后电位跟着变。",
    "en": "nA·m (derived from live E/I using PR5 assumptions; baseline is E/I when selection changes; moment vector = q × selected orientation, an assumed normal). Position uses the TVB region center, is not registered to HEAD coordinates and is clamped to 55 mm. Selection and coupling changes update the potentials."
  },
  {
    "zh": "µV（12 导中幅值最大，尖峰时跟最大值走）",
    "en": "µV (largest magnitude among 12 sensors, following the current maximum)"
  },
  {
    "zh": "V=p·(r−r₀)/(4πσ|r−r₀|³) · RAS mm · nA·m · µV。S01–S12 不是标准 EEG montage，透明球面不是颅骨/头皮导电边界，亦未将 TVB E/I 映射为电流源。",
    "en": "V=p·(r−r₀)/(4πσ|r−r₀|³), in RAS mm, nA·m and µV. S01–S12 are illustrative sensors rather than a standard EEG montage. The transparent sphere is not a skull/scalp conductor boundary, and TVB E/I is not directly mapped to a current source."
  },
  {
    "zh": "nA·m （live E/I 经 PR5 假设链，基线 = 选区切换时该脑区的 E/I；偶极矩矢量 = q × 下方所选方向，法向是假设） · 位置 = 脑区中心（TVB 坐标、未配准 HEAD，钳制进 ±48 mm 球网格）· 改选区、改 G 后电位跟着变。",
    "en": "nA·m (derived from live E/I using PR5 assumptions; baseline is E/I when selection changes; moment vector = q × selected orientation, an assumed normal). Position uses the TVB region center, is not registered to HEAD coordinates and is clamped to the ±48 mm grid. Selection and coupling changes update the potentials."
  },
  {
    "zh": "— 权重",
    "en": "— weight"
  },
  {
    "zh": "条）",
    "en": "connections)"
  },
  {
    "zh": "JR p0=220 极限环跑 12 s（去前 2 s），Welch PSD 读 alpha 峰与占比。",
    "en": "Run the JR p0=220 limit cycle for 12 s, discard the first 2 s, and use Welch PSD for the alpha peak and power share."
  }
];
