# brain-core（Rust）

Brain Physics Playground 的 Wilson–Cowan 引擎（Rust 实现），
与 `reference/python-model` 的 Python 实现逐数对齐
（最大偏差 ≤ 3.4e-16，见 `reference/python-model/compare.py`）。

库本身零依赖；`serde`/`serde_json` 只用于 `brain-core-run` 二进制。

## 运行

```bash
cargo test --release            # 7 个测试
cargo run --release --bin brain-core-run -- \
  --connectivity ../../app/public/brain-assets/connectivity.json \
  --scenario scenario.json --output out.json
```

场景 JSON：`{ "duration_ms": 5000.0, "params": { ... }, "events": [...],
"e0": 0.0, "i0": 0.0 }`（`params` 为完整参数对象，`G` 为耦合斜率；
`events` 为 `[{ "node": 40, "start_ms": 1000.0, "duration_ms": 100.0,
"amplitude": 2.0 }]`）。输出 JSON：`{ "t_ms": [...], "E": [[...]],
"I": [[...]], "P": [[...]] }`，每步一行（行 0 为 t=0）。

## 关键约定（详见 `docs/model-spec.md` Phase 2 附录）

- 方程为 TVB 源码实测形式，I 方程用 `c_ii·I`；Heun 固定步长，默认 dt=1 ms。
- 耦合为原始权重求和 × 线性斜率 G（TVB 惯例）；传导速度 3.0 mm/ms；
  延迟步数 `round_ties_even(长度/速度/dt)`。
- `Params::default()` 为纯 A-set 参考配置；产品默认用 `Params::demo()`
  （A-set + θ_e 0 → 1.0，G=0.35）——A-set 单节点是双稳态的，
  见 `docs/validation.md` §1。
- 发散（非有限值或 |E|,|I| > 1e6）立即报错，不静默。
- 噪声为 SplitMix64 均匀白噪声（默认关闭），与 Python 实现逐字一致。
