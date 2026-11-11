"""PR3 cross-check — Python side: run the SAME scenarios as
tests/pr3/crosscheck-node.mjs through the Python reference (with the PR3
set_weight / set_bias API) and dump sampled E traces + scalars to
tests/pr3/python-scenarios.json.

Run:  python3 tests/pr3/crosscheck-python.py   (from the repo root)
NOTE: Simulator.run() measures event times relative to each run() call,
so the pulse event uses start_ms=0.0 on the second run() after a 2000 ms
settle — exactly the same step alignment as the Node side, where the
event is scheduled at the then-current absolute time.
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference" / "python-model"))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

ASSET = ROOT / "app" / "public" / "brain-assets" / "connectivity.json"


def new_sim():
    w, lengths = load_connectivity(ASSET)
    return Simulator(w, lengths, Params.demo())


def sampled_trace(result, sample_every=10):
    """Rows at steps 10, 20, ... (matches the Node sampler, which records
    after every 10th 1 ms step)."""
    return result.E[sample_every::sample_every].tolist()


def peak_delta(trace, node):
    base = trace[0][node]
    return float(max(row[node] - base for row in trace))


def tail_mean(trace, node, n=50):
    rows = trace[-n:]
    return float(sum(r[node] for r in rows) / len(rows))


out = {}

# S0: baseline pulse on node 73 (lV1) -> target 54 (lPCS), W[54][73]=3.0.
sim = new_sim()
sim.run(2000.0, [])
e_pre = sim.E.copy().tolist()
r = sim.run(2000.0, [StimulusEvent(node=73, start_ms=0.0, duration_ms=100.0, amplitude=2.0)])
trace = sampled_trace(r)
out["S0_pulse73_baseline"] = {"trace": trace, "ePre": e_pre, "peak_dE54": peak_delta(trace, 54)}

# S1: same pulse with the edge 73 -> 54 zeroed (single-sided).
sim = new_sim()
stored = sim.set_weight(54, 73, 0.0)
reverse = sim.weight(73, 54)
sim.run(2000.0, [])
r = sim.run(2000.0, [StimulusEvent(node=73, start_ms=0.0, duration_ms=100.0, amplitude=2.0)])
trace = sampled_trace(r)
out["S1_pulse73_weight54_73_zero"] = {
    "trace": trace, "stored": stored, "reverse": reverse, "peak_dE54": peak_delta(trace, 54),
}

# S2: pulse on node 69, edge into 40 doubled (W[40][69] 1.0 -> 2.0) + baseline.
sim = new_sim()
sim.run(2000.0, [])
r = sim.run(2000.0, [StimulusEvent(node=69, start_ms=0.0, duration_ms=100.0, amplitude=2.0)])
trace = sampled_trace(r)
out["S2a_pulse69_baseline"] = {"trace": trace, "peak_dE40": peak_delta(trace, 40)}
sim = new_sim()
sim.set_weight(40, 69, 2.0)
reverse2 = sim.weight(69, 40)
sim.run(2000.0, [])
r = sim.run(2000.0, [StimulusEvent(node=69, start_ms=0.0, duration_ms=100.0, amplitude=2.0)])
trace = sampled_trace(r)
out["S2b_pulse69_weight40_69_doubled"] = {"trace": trace, "reverse": reverse2, "peak_dE40": peak_delta(trace, 40)}

# S3: sustained excitatory bias +0.5 on node 40.
sim = new_sim()
sim.set_bias(40, 0.5)
r = sim.run(3000.0, [])
trace = sampled_trace(r)
out["S3_bias40_plus05"] = {"trace": trace, "steady_E40": tail_mean(trace, 40), "steady_E0": tail_mean(trace, 0)}

# S4: sustained inhibitory bias -0.5 on node 40.
sim = new_sim()
sim.set_bias(40, -0.5)
r = sim.run(3000.0, [])
trace = sampled_trace(r)
out["S4_bias40_minus05"] = {"trace": trace, "steady_E40": tail_mean(trace, 40), "steady_E0": tail_mean(trace, 0)}

# S5: bias on then cleared -> back to the un-biased steady state.
sim = new_sim()
sim.set_bias(40, 0.5)
sim.run(2000.0, [])
e_biased = float(sim.E[40])
sim.clear_bias(40)
r = sim.run(2000.0, [])
trace = sampled_trace(r)
out["S5_bias40_cleared"] = {"trace": trace, "eBiased": e_biased, "steady_E40": tail_mean(trace, 40)}

# S0b: no-bias steady state.
sim = new_sim()
r = sim.run(3000.0, [])
trace = sampled_trace(r)
out["S0b_no_bias_steady"] = {"trace": trace, "steady_E40": tail_mean(trace, 40), "steady_E0": tail_mean(trace, 0)}

with open(ROOT / "tests" / "pr3" / "python-scenarios.json", "w", encoding="utf-8") as fh:
    json.dump(out, fh)
for k, v in out.items():
    scalars = " ".join(
        f"{kk}={vv:.6f}" for kk, vv in v.items() if kk not in ("trace", "ePre") and isinstance(vv, float)
    )
    print(f"{k}: {scalars}")
print("wrote tests/pr3/python-scenarios.json")
