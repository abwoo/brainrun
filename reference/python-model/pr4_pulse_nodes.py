"""PR4 node sweep: which nodes flip the network when pulsed under
a Spontaneous background drive?

Finding (2026-11-11): at OU sigma=0.10, pulses on node 40 flip 0/24
and on node 73 flip 0/12 — but pulses on node 69 (lTCI) flip 6/12
(mean E 0.24 or 0.46, staying; dE[40] peak ~0.48 is the flip, not a
downstream response).  The flip rate depends on the PULSED NODE, not
just on sigma: hub nodes drive many nodes at once, and the background
drive lowers the barrier.  This scan maps the flip-prone set at
sigma 0.10 and 0.05 (3 seeds x 4 click times for node 69; a 12-node
sweep at seed 0 x 2 times for the rest).

Run: python3 reference/python-model/pr4_pulse_nodes.py  (from the repo root)
RECOVERED = mean E < 0.03 three seconds after the pulse.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import (
    BG_SPONTANEOUS,
    Params,
    Simulator,
    StimulusEvent,
    load_connectivity,
)

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"
W, L = load_connectivity(ASSET)


def click(params, node, at_ms, watch=3000.0):
    sim = Simulator(W, L, params)
    sim.run(float(at_ms))
    r = sim.run(watch, [StimulusEvent(node, 0.0, 100.0, 2.0)])
    mean_e = r.E.mean(axis=1)
    return float(mean_e[-1])


def main():
    for sigma in (0.05, 0.10):
        print(f"== OU sigma={sigma:.2f}: node 69 (lTCI), 3 seeds x 4 times ==")
        flips = 0
        for seed in (0, 1, 2):
            for t in (500, 1000, 2000, 4000):
                p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                              "ou_sigma": sigma, "seed": seed})
                last = click(p, 69, t)
                tag = "LOCKED" if last >= 0.03 else "recovered"
                if last >= 0.03:
                    flips += 1
                print(f"  node 69 seed={seed} @{t}ms: +3s meanE={last:.4f} {tag}")
        print(f"==> node 69 sigma={sigma:.2f}: {flips}/12 flipped\n")

    print("== OU sigma=0.10: 12-node sweep, seed 0, 2 times each ==")
    nodes = (0, 10, 20, 30, 40, 47, 54, 55, 59, 60, 69, 73)
    for node in nodes:
        flips = 0
        for t in (1000, 3000):
            p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                          "ou_sigma": 0.10, "seed": 0})
            last = click(p, node, t)
            if last >= 0.03:
                flips += 1
            print(f"  node {node} @ {t}ms: +3s meanE={last:.4f} "
                  f"{'LOCKED' if last >= 0.03 else 'recovered'}")
        print(f"  ==> node {node}: {flips}/2 flipped")
    print("== OU sigma=0.05: same 12-node sweep, seed 0, 2 times each ==")
    for node in nodes:
        flips = 0
        for t in (1000, 3000):
            p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                          "ou_sigma": 0.05, "seed": 0})
            last = click(p, node, t)
            if last >= 0.03:
                flips += 1
        print(f"  ==> node {node}: {flips}/2 flipped")


if __name__ == "__main__":
    main()
