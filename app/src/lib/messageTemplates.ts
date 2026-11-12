export const messageTemplates: ReadonlyArray<{ zh: string; en: string }> = [
  {
    "zh": "运行 S{0}",
    "en": "Run S{0}"
  },
  {
    "zh": "源点 {0} 坐标",
    "en": "Source {0} coordinate"
  },
  {
    "zh": "通道 {0}（已选）",
    "en": "Channel {0} (selected)"
  },
  {
    "zh": "阶跃 {0} uA/cm^2（10–60 ms）。HH1952 标准参数，静息 -65 mV，锋电位峰值约 +40 mV。",
    "en": "Step {0} µA/cm² over 10–60 ms. Standard HH1952 parameters, resting potential −65 mV, spike peak approximately +40 mV."
  },
  {
    "zh": "前向输入：选中脑区 #{0} {1} 的直播 E = {2}（无量纲，静息均值 E0=0.011）；该脑区当前 P = {3}（主仿真快照值）。",
    "en": "Forward input: region #{0} {1}, live E={2} (dimensionless; resting mean E0=0.011), current P={3} from the main simulation."
  },
  {
    "zh": "基线：刺激前 t={0} s · {1} #{2}。窗口：基线前 500 ms 至刺激后约 2 s 的真实快照。",
    "en": "Prestimulus baseline t={0} s · {1} #{2}. Actual snapshots from 500 ms before baseline to approximately 2 s after input."
  },
  {
    "zh": "源脑区 #{0} {1}（中心 {2} mm，TVB 坐标、未配准 HEAD，钳制进 ±48 mm 球网格）",
    "en": "Source region #{0} {1}, center {2} mm (TVB coordinates, not registered to HEAD; clamped to the ±48 mm grid)"
  },
  {
    "zh": "{0} 减小",
    "en": "Decrease {0}"
  },
  {
    "zh": "{0} 增大",
    "en": "Increase {0}"
  },
  {
    "zh": "{0} 数值",
    "en": "{0} value"
  },
  {
    "zh": "快照已恢复（仿真时间 {0} s）",
    "en": "Snapshot restored at model time {0} s"
  },
  {
    "zh": "基线 t={0} ms（之前 {1}）· 窗口基线 t={2} ms ·",
    "en": "Baseline t={0} ms (previous {1}); response baseline t={2} ms ·"
  },
  {
    "zh": "快照 {0} 条 · 末条 t={1} ms · 窗口末尾 t1={2} ms",
    "en": "{0} snapshots; latest t={1} ms; window end t1={2} ms"
  },
  {
    "zh": "基线 t={0} ms（之前 {1}）· 尚无响应窗口",
    "en": "Baseline t={0} ms (previous {1}); response window not yet available"
  },
  {
    "zh": "响应窗口未在 12 s 内填满（可到 RESPONSE 面板手工查看）。最后看到：{0}",
    "en": "The response window did not finish within 12 seconds. Inspect it in the response panel. Last status: {0}"
  },
  {
    "zh": "窗口 {0} s · 录制快照 {1} 条（仍在随仿真推进填满）",
    "en": "Window {0} s · {1} snapshots, still collecting"
  },
  {
    "zh": "脉冲 {0} ms · 20–500",
    "en": "Pulse {0} ms · range 20–500"
  },
  {
    "zh": "{0} 持续偏置",
    "en": "{0} sustained bias"
  },
  {
    "zh": "回放 REPLAY · {0}× · 录制窗口（真实快照）",
    "en": "Replay · {0}× · recorded model snapshots"
  },
  {
    "zh": "{0} — 点击刺激 · 按住持续输入",
    "en": "{0} · click to stimulate; hold for continuous input"
  },
  {
    "zh": "{0} Hz（流变 {1} pA）。",
    "en": "{0} Hz (rheobase {1} pA)."
  },
  {
    "zh": "阶跃 {0} uA/cm^2（10–60 ms）。HH1952 标准参数，",
    "en": "Step {0} µA/cm² from 10–60 ms. Standard HH1952 parameters,"
  },
  {
    "zh": "胞体 HH 主动 + 顶/基树突被动电缆；{0}",
    "en": "Active HH cell body with passive apical and basal cables; {0}"
  },
  {
    "zh": "注入 {0} pA（10–12 ms）。胞体 d=20 um、顶树突 d=2 um L=200 um，",
    "en": "Inject {0} pA from 10–12 ms. Soma diameter 20 µm; apical diameter 2 µm and length 200 µm,"
  },
  {
    "zh": "；该脑区当前 P = {0}（主仿真快照值）。",
    "en": "; current regional input P={0} from the main model."
  },
  {
    "zh": "本次运行发放率 {0} Hz → dP = {1}（无量纲）。",
    "en": "Firing rate {0} Hz → assumed input dP={1}."
  },
  {
    "zh": "快照 {0} 条（实测 {1} Hz）· 事件 {2} 个（真实脉冲）·",
    "en": "{0} snapshots ({1} Hz measured) · {2} actual pulse events ·"
  },
  {
    "zh": "Pz 峰值 {0} µV · 源位置钳制进球网格。",
    "en": "Pz peak {0} µV · source position clamped to the spherical grid."
  },
  {
    "zh": "· 有效来源采样≈{0} Hz（不是原生 250 Hz EEG）",
    "en": "· effective source rate ≈{0} Hz, not native 250 Hz EEG"
  },
  {
    "zh": "独立运行 {0}（不可与 Raw 直接比较）",
    "en": "Independent run {0}; not directly comparable to Raw"
  },
  {
    "zh": "通道 {0}{1}",
    "en": "Channel {0}{1}"
  },
  {
    "zh": "{0} RMS，微伏",
    "en": "{0} RMS in µV"
  },
  {
    "zh": "通道 {0} 不在试次集中",
    "en": "Channel {0} is not in the epoch set"
  },
  {
    "zh": "{0} 通道 oddball 与 standard 的 ERP 波形",
    "en": "{0}: oddball and standard ERP waveforms"
  },
  {
    "zh": "{0} 通道 oddball 减 standard 差异波",
    "en": "{0}: oddball minus standard ERP"
  },
  {
    "zh": "深源 [16,16,16] mm：偶极子误差 {0} mm，",
    "en": "Deep source [16,16,16] mm: dipole error {0} mm,"
  },
  {
    "zh": "MNE 误差 {0} mm；",
    "en": "MNE error {0} mm;"
  },
  {
    "zh": "浅源 [48,48,48] mm：偶极子误差 {0} mm，",
    "en": "Shallow source [48,48,48] mm: dipole error {0} mm,"
  },
  {
    "zh": "MNE 误差差（B−A）{0} mm，分布范围差 {1} mm。",
    "en": "MNE error difference (B−A): {0} mm; spread difference: {1} mm."
  },
  {
    "zh": "深源：plain MNE {0} mm →",
    "en": "Deep source: plain MNE {0} mm →"
  },
  {
    "zh": "深度加权 {0} mm →",
    "en": "depth-weighted {0} mm →"
  },
  {
    "zh": "浅源：plain {0} mm →",
    "en": "Shallow source: plain {0} mm →"
  },
  {
    "zh": "直播 A（#{0} {1}）：响应窗口 {2} 条快照，峰值 ΔE {3}；",
    "en": "Live A (#{0} {1}): {2} response snapshots, peak ΔE={3};"
  },
  {
    "zh": "直播推导 Pz 峰值 {0} µV，RMS {1} µV。",
    "en": "Live-derived Pz peak {0} µV, RMS {1} µV."
  },
  {
    "zh": "没有 {0} ms 的快照",
    "en": "No snapshot at {0} ms"
  },
  {
    "zh": "分支点 {0} ms：分支前最大差 {1} mV，",
    "en": "Branch at {0} ms: maximum pre-branch difference {1} mV,"
  },
  {
    "zh": "分支后最大差 {0} mV（驱动改为 {1} 1/s）。",
    "en": "maximum post-branch difference {0} mV (drive {1} 1/s)."
  },
  {
    "zh": "触发占比 {0}%，",
    "en": "Triggered in {0}% of samples,"
  },
  {
    "zh": "控制峰值 {0} 1/s，",
    "en": "peak output {0} 1/s,"
  },
  {
    "zh": "发散：{0}。",
    "en": "Diverged: {0}."
  },
  {
    "zh": "有控制 vs 无控制：RMS 差 {0} µV，",
    "en": "Controlled minus uncontrolled: RMS {0} µV,"
  },
  {
    "zh": "峰值差 {0} µV。",
    "en": "peak {0} µV."
  },
  {
    "zh": "t={0} s 特征 {1} > 阈值 {2} → 脉冲 #{3}（幅度 {4}，100 ms），第 {5}/{6} 次",
    "en": "t={0} s: feature {1} exceeds threshold {2}; pulse #{3}, strength {4}, 100 ms; trigger {5}/{6}"
  },
  {
    "zh": "{0}：未被拒绝（异常，应核查）",
    "en": "{0}: not rejected; check registration handling"
  },
  {
    "zh": "{0}：已拒绝——{1}",
    "en": "{0}: rejected — {1}"
  },
  {
    "zh": "中央 y 切片场箭头（|y|≤20 mm，{0} 个真实场矢量，X–Z 投影）",
    "en": "Field vectors in central y slice (|y|≤20 mm; {0} computed vectors projected onto X–Z)"
  },
  {
    "zh": "双相脉冲 {0} 随时间变化曲线",
    "en": "Biphasic pulse: {0} over time"
  },
  {
    "zh": "选中脑区 #{0} {1}（中心 {2} mm）",
    "en": "Selected region #{0} {1}, center {2} mm"
  },
  {
    "zh": "· 已向 #{0} {1} 发直播脉冲（幅度 {2}，{3} ms；见主界面 RESPONSE）",
    "en": "· live pulse sent to #{0} {1}: strength {2}, duration {3} ms"
  },
  {
    "zh": "Level A 直接驱动 {0}（{1}，{2} ms）{3}",
    "en": "Level A direct drive {0} ({1}, {2} ms){3}"
  },
  {
    "zh": "Level D {0} 场法向分量 {1} V/m → 驱动 {2}（增益 {3}，未校准）{4}",
    "en": "Level D: {0} normal field {1} V/m → drive {2}, gain {3} (uncalibrated){4}"
  },
  {
    "zh": "视觉闪烁 {0} Hz，强度 {1}（WC 柱，零均值正弦驱动）",
    "en": "Visual flicker {0} Hz, intensity {1}: zero-mean sinusoidal drive to a WC column"
  },
  {
    "zh": "听觉 burst 串：音调 {0} Hz（元数据，载波未进动力学），强度 {1}，ISI {2} ms",
    "en": "Auditory bursts: tone {0} Hz (metadata only), intensity {1}, interval {2} ms"
  },
  {
    "zh": "WC {0} 模型单位，JR {1} 1/s",
    "en": "WC {0} model units; JR {1} 1/s"
  },
  {
    "zh": "通道 {0} 不在记录中",
    "en": "Channel {0} is not in this recording"
  },
  {
    "zh": "{0} 通道 Welch PSD（0.5–45 Hz，log 坐标）",
    "en": "{0} Welch spectrum, 0.5–45 Hz, logarithmic scale"
  },
  {
    "zh": "加载失败 {0}: HTTP {1}",
    "en": "Could not load {0}: HTTP {1}"
  },
  {
    "zh": "加载失败 regions.json: HTTP {0}",
    "en": "Could not load regions.json: HTTP {0}"
  },
  {
    "zh": "加载失败 connectivity.json: HTTP {0}",
    "en": "Could not load connectivity.json: HTTP {0}"
  },
  {
    "zh": "vertices.bin 长度异常: {0}，期望 {1}",
    "en": "Invalid vertices.bin length {0}; expected {1}"
  },
  {
    "zh": "triangles.bin 长度异常: {0}，期望 {1}",
    "en": "Invalid triangles.bin length {0}; expected {1}"
  },
  {
    "zh": "regionMap.bin 长度异常: {0}，期望 16384",
    "en": "Invalid regionMap.bin length {0}; expected 16384"
  },
  {
    "zh": "regions.json 脑区数异常: {0}，期望 76",
    "en": "Unexpected region count {0}; expected 76"
  },
  {
    "zh": "电极参考 ({0})",
    "en": "Electrode reference ({0})"
  },
  {
    "zh": "{0} 电位",
    "en": "{0} potential"
  },
  {
    "zh": "地形（实测记录 {0} ms，球面样条插值）峰值电极 {1}；",
    "en": "Interpolated scalp map at {0} ms: peak electrode {1};"
  },
  {
    "zh": "正向（已知源 [0,0,16] mm 直接求值）峰值电极 {0}；",
    "en": "Known forward source [0,0,16] mm: peak electrode {0};"
  },
  {
    "zh": "σ={0} S/m 时 S10 电位",
    "en": "S10 potential at conductivity σ={0} S/m"
  },
  {
    "zh": "没有可恢复的快照：{0}",
    "en": "No snapshot available: {0}"
  },
  {
    "zh": "{0} — 点击选择位置",
    "en": "{0} · click to select a location"
  }
];
