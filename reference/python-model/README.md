# Wilson–Cowan 参考实现（Python）

Brain Physics Playground 的 Python 参考引擎，与 `crates/brain-core`
的 Rust 实现逐数对齐（最大偏差 ≤ 3.4e-16，见 `compare.py`）。

## 运行

```bash
python3 -m unittest test_wilson_cowan -v   # 11 个测试（只需 NumPy）
python3 run_default.py                     # 默认 5 秒运行（演示预设）
python3 compare.py                         # Python <-> Rust 对照
python3 experiments.py                     # 全部验证实验
python3 verify_fixed_points.py             # 不动点结构（scipy 独立验证）
```

## 文件

| 文件 | 作用 |
|---|---|
| `wilson_cowan.py` | 引擎：TVB 源码形式的方程、Heun、延迟历史、刺激事件、SplitMix64 噪声 |
| `run_default.py` | 默认 5 秒运行，输出 `outputs/default_run.json` / `.npz` / 节点 40 的 CSV |
| `compare.py` | 6 个场景下 Python 与 Rust 轨迹逐点对照 |
| `experiments.py` | 验证实验（G/幅度/c_ei 扫描、按住、dt 敏感性、边界条件） |
| `verify_fixed_points.py` | scipy 独立验证不动点结构与积分器精度 |
| `test_wilson_cowan.py` | 单元测试（unittest） |
| `g_scan.py` / `g_scan_fine.py` / `preset_scan.py` | 探索性脚本（耦合定义已更换，其网络数字已过期，仅作审计记录） |
| `outputs/` | 运行产物（JSON 数字、轨迹、对照结果） |

## 关键约定（详见 `docs/model-spec.md` Phase 2 附录）

- 方程为 TVB 源码实测形式，I 方程用 `c_ii·I`；不引入 `shift_sigmoid`。
- 耦合为原始权重求和 × 线性斜率 G（TVB 惯例）；传导速度 3.0 mm/ms；
  延迟步数 `rint(长度/速度/dt)`（.5 向偶数舍入）。
- `Params()` 为纯 A-set 参考配置；产品默认用 `Params.demo()`
  （A-set + θ_e 0 → 1.0，G=0.35）——A-set 单节点是双稳态的，
  幅度 ≥ ~0.1 的脉冲会永久锁死被点脑区，见 `docs/validation.md` §1。
