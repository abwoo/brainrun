"""PR4 cross-check — Python side: run the SAME scenarios as
tests/pr4/crosscheck-node.mjs through the Python reference and dump
sampled E traces + scalars to tests/pr4/python-scenarios.json.

Run:  python3 tests/pr4/crosscheck-python.py   (from the repo root)
NOTE: Simulator.run() measures event times relative to each run() call,
so the pulse event uses start_ms=1000.0 on the run that starts at the
pulse time — exactly the same step alignment as the Node side, where
the event is scheduled at the then-current absolute time.
"""
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "reference" / "python-model"))
from wilson_cowan import (
    BG_OSCILLATORY,
    BG_SPONTANEOUS,
    Params,
    Simulator,
    StimulusEvent,
    load_connectivity,
)

ASSET = ROOT / "app" / "public" / "brain-assets" / "connectivity.json"
OUT = ROOT / "tests" / "pr4"


def new_sim(params=None):
    w, lengths = load_connectivity(ASSET)
    return Simulator(w, lengths, params or Params.demo())


def sampled_trace(result, sample_every=10):
    """Rows at steps 10, 20, ... (matches the Node sampler, which records
    after every 10th 1 ms step)."""
    return result.E[sample_every::sample_every].tolist()


def mean_e(trace):
    return [float(sum(row) / len(row)) for row in trace]


out = {}

# S0: Spontaneous, seed 0, 2000 ms, pulse 40 at t=1000 ms.
sim = new_sim(Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS}))
r = sim.run(2000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)])
trace = sampled_trace(r)
out["S0_spont_seed0"] = {"trace": trace, "meanE": mean_e(trace)}

# S1: same, seed 1 (must differ from S0).
sim = new_sim(Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                        "seed": 1}))
r = sim.run(2000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)])
trace = sampled_trace(r)
out["S1_spont_seed1"] = {"trace": trace, "meanE": mean_e(trace)}

# S2: Spontaneous, seed 0, no pulse.
sim = new_sim(Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS}))
r = sim.run(2000.0)
trace = sampled_trace(r)
out["S2_spont_seed0_nopulse"] = {"trace": trace, "meanE": mean_e(trace)}

# S3: Oscillatory preset, 4000 ms, pulse 40 at t=2000 ms.
sim = new_sim(Params.oscillatory())
r = sim.run(4000.0, [StimulusEvent(40, 2000.0, 100.0, 2.0)])
trace = sampled_trace(r)
out["S3_osc"] = {"trace": trace, "meanE": mean_e(trace)}

# S4: snapshot round-trip under Spontaneous. Run 1500 ms, snapshot,
# run 500 ms (control tail), restore, run 500 ms again.
sim = new_sim(Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS}))
sim.run(1500.0)
snap = sim.take_snapshot()
snap_E = sim.E.tolist()
control = sim.run(500.0)
control_trace = sampled_trace(control)
sim.restore_snapshot(snap)
restored_E = sim.E.tolist()
after = sim.run(500.0)
after_trace = sampled_trace(after)
out["S4_snapshot"] = {
    "snapE": snap_E,
    "restoredE": restored_E,
    "controlTail": control.E[-1].tolist(),
    "afterTail": after.E[-1].tolist(),
    "controlTrace": control_trace,
    "afterTrace": after_trace,
}

# S5: Quiet determinism twin — reset + rerun equals the first run.
sim = new_sim()
t1 = sampled_trace(sim.run(2000.0))
sim.reset()
t2 = sampled_trace(sim.run(2000.0))
out["S5_quiet_reset_rerun"] = {"t1": t1, "t2": t2}

(OUT / "python-scenarios.json").write_text(json.dumps(out), encoding="utf-8")
print("wrote tests/pr4/python-scenarios.json")
