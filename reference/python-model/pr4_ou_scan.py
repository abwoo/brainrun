"""PR4 OU sizing: choose (sigma, tau) for the Spontaneous mode.

Criteria: per-node E must fluctuate visibly (median node E std and
excursions vs the quiet baseline 0.011 — the Delta-E view shows
|dE| = 0.01 at ~32% colour depth), while the network must stay far
from the 0.15 lock threshold over long runs.  10 s runs here for
sizing; the authoritative 60 s check is the Rust unit test
(pr4_spontaneous_60s_no_lock) and the browser test.

Run: python3 reference/python-model/pr4_ou_scan.py  (from the repo root)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import BG_SPONTANEOUS, Params, Simulator, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def main():
    weights, lengths = load_connectivity(ASSET)
    print("== OU sizing, demo network G=0.35, seed 0, 10 s ==")
    for sigma, tau in [(0.05, 100.0), (0.1, 100.0), (0.2, 100.0),
                       (0.3, 100.0), (0.5, 100.0), (0.2, 50.0), (0.2, 200.0)]:
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                      "ou_sigma": sigma, "ou_tau_ms": tau, "seed": 0})
        sim = Simulator(weights, lengths, p)
        r = sim.run(10000.0, snapshot_every=5)
        tail = r.E[int(4000 // 5):]
        node_std = tail.std(axis=0)
        mean_e = r.E.mean(axis=1)
        print(f"sigma={sigma:.2f} tau={tau:5.0f} ms  medianNodeStd={np.median(node_std):.4f} "
              f"maxNodeStd={node_std.max():.4f} max|E-base|={np.abs(tail - 0.011).max():.4f} "
              f"meanE std={mean_e[int(4000 // 5):].std():.5f} maxMeanE={mean_e.max():.4f}")


if __name__ == "__main__":
    main()
