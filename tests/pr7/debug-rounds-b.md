# PR-14 debug rounds — 子代理 B（TES/TMS/感觉输入）

过程记录。只记本模块的调试与决策；总协调的记录在 `tests/pr7/debug-rounds.md`（未动）。

## Round 1 — 设计定型前的数值侦察（草稿脚本 /tmp/pr14scratch）

- TMS 几何初版把线圈中心放在 z=102、目标放在 [0,0,16]，
  算出 E ≈ 0.005 V/m——错的不是公式，是几何：目标离线圈平面 94 mm，
  偶极场按 1/r³ 衰减。改目标为皮层深度 [30,0,70] 后 E = 42.5 V/m
  （dI/dt = 5×10⁷ A/s）；默认 dI/dt 定为 1×10⁸ A/s，得 84.99 V/m。
  另发现草稿里多乘了一个 1e-3（环路积分 ∮dl/|r−r′| 无量纲，不换算），已修正。
- JR 柱不适合周期/重复刺激：p0=90 低分支双稳态，≥50 1/s 的脉冲
  50 ms 就翻到上支并锁存；闪烁驱动（均值 60 1/s 的正弦）FFT 峰落在
  ~1 Hz 而非 10 Hz。结论：感觉实验室与 Level D 默认路线用 WC 柱；
  JR 只保留单脉冲 Level D，并把 25→50 V/m 的跳变写明为分支翻转。
- WC 柱验证通过（Python DOP853）：Level D 单调 0/0.512/1.918/4.057/4.550；
  闪烁 FFT 峰精确落在刺激频率；听觉强度单调；ISI 固定窗均值有序。

## Round 2 — TS 测试 13 项，初跑 10/13

三处失败，均为测试/实现细节问题，无一处是产品科学错误：

1. 网格断言 `TMS max > 50 × TES max` 写错比较对象：40 mm 粗网格
   错过 TMS 最大值点（线圈平面在采样体积外），实测 32.6 vs 2.16。
   修正：网格只断言覆盖/有限；50× 的量级 claim 改在默认目标处验证
   （85 vs 0.79，107×）。测试期望写错，不是放宽门槛。
2. 闪烁 q(t) 差 0.047 nA·m（容差 5e-3）：TS 在步起点采样连续正弦驱动，
   是一阶误差。修实现：驱动在步中点采样（矩形驱动边沿在整数 ms，
   结果不变；正弦误差降为二阶）。实测差降到 3.41e-4 nA·m，
   容差随之收紧到 1e-3（约 3 倍误差底）。
3. 听觉强度扫描 `totalMs: 1500` 装不下 5 个 burst（ISI 500 需 2550 ms），
   `runAuditoryTrain` 抛错。测试 bug：改 totalMs 为 3000；
   fixture 峰值取自 0–1500 ms（前两个 burst），WC 无适应、
   各 burst 峰相同，故峰值一致。

## Round 3 — Python 参考的两个真 bug（对照链修好后 TS 13/13 全过）

诊断方法：TS 与 Python 在 548 ms 处逐值相同（差 0.0），552 ms 处差 0.19，
且只出现在 burst 结束点后——指向分段交接，不是积分器精度。

1. **过期状态交接**：`solve_ivp` 带 `t_eval` 时 `sol.y[:, -1]` 是最后
   一个采样点的状态，不是分段终点。burst 结束在 550 ms（非 4 ms 网格点）
   时，下一段从 548 ms 的旧状态起跑，驱动边沿被悄悄移动 2 ms。
   Level D 分段终点是 100/200 ms（网格点）所以没暴露。
   修：分段终点显式补积分（`run_wc_pieces` 与 `run_jr_pieces` 同修）。
2. **网格外采样点污染**：`t_eval` 为空的分段（超出 `t_end` 的 burst）
   会把求解器内部自适应步点追加进序列，强度扫描峰值取到 1526.58 ms
   的网格外值 4.063（网格内真峰 4.057）。修：空 `t_eval` 的分段只推进
   状态、不追加采样；超出 `t_end` 的分段直接跳过。

修完重生成 fixture：ISI 均值 0.862/0.430/0.215 与 TS 对上
（0.86213815 vs 0.86213813），TS 13/13、Python 12/12 全过。
注意：上游 `local_column_scipy_reference.py` 有同样写法，但其分段终点
80/120/600 全是 4 的倍数，不受影响——未动上游文件。

## Round 4 — 构建冒烟

- `npx tsc --noEmit` 在本仓库根配置下是空跑（`tsconfig.json` 的
  `files: []`，只引用子项目），第一次“通过”无效。教训：以
  `npm run build`（`tsc -b && vite build`）为准。
- 构建抓到 3 个真错误：StimLab 从 stimulation.ts import `Vec3Mm`
  但未 re-export；`DEFAULT_JR_MORPHOLOGY` 未使用；
  `DEFAULT_TMS_COIL` 的 `Object.freeze` 泛型推断把 `[0,0,102]` 展宽为
  `number[]`。三处均已修（re-export 类型、删未用 import、
  字面量加 `as Vec3Mm`）。
- 冒烟方法：临时把 StimLab 接进 App.tsx（import + state + 条件渲染），
  `npm run build` 通过后立即 revert；`grep StimLab App.tsx` = 0 行确认。
  构建产物 `app/dist` 已删。`tsc -b` 在共享 node_modules（pr6 的软链）
  里写的 `.tsbuildinfo` 缓存未动（只是缓存，下次构建会重算）。

## 最终实测数（写进测试断言输出与 docs/pr7-stimulation.md）

- TES vs Python 闭式解：3.47e-18 V/m；TMS vs Python 3600 段积分：1.42e-14 V/m。
- Level D q(t)：WC 2.01e-6、JR 1.81e-9 nA·m；闪烁 3.41e-4；听觉 2.64e-6 nA·m。
- Level D 峰值：WC 0/0.512/1.918/4.057/4.550；JR 0/0.065/1.024/1.125/1.171 nA·m。
- 闪烁 Welch 峰：8→7.81、10→9.77、20→19.53 Hz（df≈0.977 Hz）。
- 听觉 ISI 固定窗均值：0.862/0.430/0.215；强度峰值：0.512/1.918/4.057 nA·m。
- 测试止损：本模块无因系统/环境原因失败超过 3 次的测试，未触发停表规则。
- 未改任何现有文件：App.tsx 两次临时接线均已 revert 并验证；
  其余现有 lib/组件/测试/契约一律未动。
