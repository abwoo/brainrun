"""PR3 cross-check — compare: WASM (Rust) vs Python reference on the same
76-node scenarios (tests/pr3/wasm-scenarios.json vs python-scenarios.json).

Asserts every sampled E value agrees to < 1e-9 and every scenario scalar
agrees to < 1e-9, then prints the causal table the PR3 browser test relies
on (weight-zero kills the downstream response, doubling enhances it,
bias + raises / bias − lowers E, clearing the bias restores baseline).

Run:  python3 tests/pr3/crosscheck-compare.py   (from the repo root)
Exit code non-zero on any mismatch.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOL = 1e-9

wasm = json.loads((ROOT / "tests" / "pr3" / "wasm-scenarios.json").read_text())
py = json.loads((ROOT / "tests" / "pr3" / "python-scenarios.json").read_text())

assert set(wasm) == set(py), f"scenario mismatch: {set(wasm) ^ set(py)}"
failures = []

for name in sorted(wasm):
    w, p = wasm[name], py[name]
    assert len(w["trace"]) == len(p["trace"]), f"{name}: trace length {len(w['trace'])} vs {len(p['trace'])}"
    max_diff = 0.0
    for wr, pr in zip(w["trace"], p["trace"]):
        for a, b in zip(wr, pr):
            d = abs(a - b)
            if d > max_diff:
                max_diff = d
    status = "PASS" if max_diff < TOL else "FAIL"
    if max_diff >= TOL:
        failures.append(f"{name}: max |dE| = {max_diff:.3e}")
    print(f"{status}  {name}: max |WASM-Python| over trace = {max_diff:.3e}")
    for k in sorted(set(w) & set(p)):
        if k in ("trace", "ePre"):
            continue
        if isinstance(w[k], (int, float)) and isinstance(p[k], (int, float)):
            d = abs(w[k] - p[k])
            ok = d < TOL
            if not ok:
                failures.append(f"{name}.{k}: {w[k]} vs {p[k]}")
            print(f"    {'PASS' if ok else 'FAIL'}  {k}: wasm={w[k]:.6f} python={p[k]:.6f} diff={d:.3e}")

print()
print("causal table (Python numbers; WASM agrees to <1e-9):")
s0 = py["S0_pulse73_baseline"]["peak_dE54"]
s1 = py["S1_pulse73_weight54_73_zero"]["peak_dE54"]
s2a = py["S2a_pulse69_baseline"]["peak_dE40"]
s2b = py["S2b_pulse69_weight40_69_doubled"]["peak_dE40"]
b0 = py["S0b_no_bias_steady"]["steady_E40"]
b3 = py["S3_bias40_plus05"]["steady_E40"]
b4 = py["S4_bias40_minus05"]["steady_E40"]
b5 = py["S5_bias40_cleared"]["steady_E40"]
print(f"  pulse 73 -> peak dE[54]: baseline {s0:.4f}, W[54][73]=0 -> {s1:.4f} ({s1 / s0 * 100:.1f}% of baseline)")
print(f"  pulse 69 -> peak dE[40]: baseline {s2a:.4f}, W[40][69] 1.0->2.0 -> {s2b:.4f} ({s2b / s2a:.2f}x)")
print(f"  steady E[40]: no bias {b0:.4f}, bias +0.5 -> {b3:.4f}, bias -0.5 -> {b4:.4f}, bias cleared -> {b5:.4f}")
print(f"  steady E[0] (unconnected to 40): no bias {py['S0b_no_bias_steady']['steady_E0']:.4f},"
      f" bias +0.5 -> {py['S3_bias40_plus05']['steady_E0']:.4f}, bias -0.5 -> {py['S4_bias40_minus05']['steady_E0']:.4f}")
# Causal assertions the browser test will re-check live (thresholds with
# margin around these measured numbers, not copied from any earlier report).
checks = [
    ("zeroed edge kills downstream response", s1 < 0.3 * s0 and s1 < 0.01, f"{s1:.4f} vs {s0:.4f}"),
    ("doubled edge enhances downstream response", s2b > 1.3 * s2a, f"{s2b:.4f} vs {s2a:.4f}"),
    ("positive bias raises E[40]", b3 > b0 + 0.005, f"{b3:.4f} vs {b0:.4f}"),
    ("negative bias lowers E[40]", b4 < b0 - 0.002, f"{b4:.4f} vs {b0:.4f}"),
    ("cleared bias restores baseline", abs(b5 - b0) < 0.001, f"{b5:.4f} vs {b0:.4f}"),
]
for name, ok, detail in checks:
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        failures.append(name)

if failures:
    print(f"\nFAILED ({len(failures)}):")
    for f in failures:
        print(f"  - {f}")
    sys.exit(1)
print("\nAll WASM↔Python cross-checks passed.")
