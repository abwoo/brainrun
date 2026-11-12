# UI 统一冒烟调试记录（tests/pr8/ui-smoke.py）

分支 `fix/ui-unification`（main `888640d0`）。冒烟最终结果：**84/84 全过**
（1920×1080 与 978px 各 42 项，36 个下拉框逐个换值验证 + 零控制台报错 +
横向溢出 0）。完整日志：`tests/pr8/ui-smoke-run7.log`。

以下是在冒烟过程中遇到的环境与产品问题——**都不是 Dropdown 重构的回归**，
重构只换了 `<select>` 的渲染组件，不改数据与接线；以下问题在 main 原生
`<select>` 下同样存在（或与控件无关）。记在这里供最终大测试参考。

## 1. 机器资源紧张，Playwright 原生 click 会把 renderer 拖死

- 本机 1.5 共享 CPU / 8 GB 内存；冒烟期间另有最终大测试与可用性走查的
  浏览器在跑，负载一度到 10.00，空闲内存低至 141 MB，同时存在 6 个 vite
  preview 与 18 个 Chrome 进程。
- 症状：`get_by_role("button", name="EEG 分析").click()` 在可操作性检查
  （滚动/命中测试/稳定性轮询，多次 CDP 往返）中超时，随后
  `TargetClosedError`（renderer 目标关闭）。轻量探针证明按钮本身正常：
  唯一匹配、矩形 [1376, 10, 80, 30]、可见、可用、`elementFromPoint`
  返回按钮自身、无遮挡；同一选择器在 PR8 link-smoke 里曾正常工作。
- 对策：冒烟一律用 JS 点击（`el.click()`，照样走 React onClick）与 JS
  改值（原生 setter + `change` 事件，照样走 React onChange），绕开 CDP
  可操作性检查；仿真就绪后先暂停直播再验控件；`--disable-gpu
  --disable-dev-shm-usage` 启动浏览器；每视口失败重开浏览器重试一次。

## 2. 预览服务器在内存压力下死过两次

- 4177 端口的 `vite preview` 在冒烟中途死过（一次是整批 node/chrome
  进程同时消失，疑似系统内存压力下的 OOM 处理；一次是运行时重启后
  /tmp 与进程一并清空）。冒烟脚本的 `page.goto` 已加 6 次重试
  （每次 15 秒超时、间隔 10 秒）；运行时重启后需手动重起 preview。

## 3. PLAY 暂停按钮有时点不下去（产品观察，main 已有）

- 现象：就绪后立刻点 PLAY，有时标签仍为“运行中”，`t_ms` 继续走；
  有时点一次就变成“已暂停”且 `t_ms` 冻结。复现不稳定。
- 可能原因：就绪瞬间按钮仍 `disabled`（React 的 `simReady` 状态落后于
  Worker 的 `isReady()`），或快照同步（`setPaused(s.paused)`）把
  `paused` 顶回。未深入定位——与 Dropdown 无关。
- 对策：冒烟同时直接调 `window.__brainSim.pause()`（API 确定性暂停），
  并以 `getSnapshot().t_ms` 两次读数相同为准确认暂停，最多重试 3 次。

## 4. 壳实验“运行实验”完成时间波动极大（环境 + 产品）

- 同一配置（JR、2000 ms、10-10 导联）有时 30 秒内完成，有时 180 秒
  未完成（通道下拉一直 disabled）。代码注释称“10 秒双源约几百毫秒”，
  但在 swiftshader 渲染循环 + 多浏览器并跑的本机上，主线程常被抢占。
- 对策：通道可用等待放宽到 180 秒；若超时，通道/参考电极/地形/源定位
  按设计无下拉框可验，记一条阻塞原因后跳过，不逐个空等 30 秒。
- 注：run7 两视口的运行均在 180 秒内完成。

## 5. ERP 页“切分试次（MNE 口径）”不出“已切分”（产品观察，main 已有）

- 现象：壳实验完成后点“切分试次”，4 次尝试（run3–run6）30 秒内均未
  出现“已切分”；随后点“运行 oddball 实验（late 机制）并切分”在 run6
  也未出，页面无报错、无崩溃（topbar/modal 仍在，tab 切换正常）。
  但在无壳记录的干净会话里，late 按钮 1 秒就出“已切分”，时频下拉框
  随即出现。壳切分失败的根因未定位（疑似壳实验事件表为空——
  `handleEpoch` 在 `events.length === 0` 时只显示错误文案、不出
  epochs；或切分后流程问题）。与 Dropdown 无关：切分不出时 TfrTab
  按设计只显示占位文案、无下拉框（`!epochs` 时 early return）。
- 对策：冒烟的时频验证改走 late 机制路径（不依赖壳记录），并把时频
  检查提到壳实验之前做；壳切分本身不在本轮验证范围内。
- 另：跑之前参考电极按设计只有 `Cz` 一个选项（`recording` 为空时
  options 默认 `['Cz']`），不是缺陷；冒烟改为跑完实验后再验该下拉框
  （此时 94 个选项）。

## 6. 时频/地形/源定位 tab 在无记录时无下拉框（产品原有行为）

- TfrTab（`!epochs`）、TopoTab / InverseTab（无 recording）都会 early
  return 占位文案，这是 PR6/PR8 的原有设计，不是 Dropdown 回归。
  冒烟按依赖关系驱动 UI 到露出下拉框的状态再验：epochs 走 late 机制，
  recording 走壳实验。
