"""PR4 OU 60 s safety scan on the REAL network (seed matters: locking is a
stochastic event).  For each (sigma, seed): 60 s run, first crossing time
of the 0.15 lock threshold (None = never), max mean E, median node E std
over the last 10 s (only meaningful when not locked).

Run: python3 reference/python-model/pr4_ou_60s_scan.py  (from the repo root)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import BG_SPONTANEOUS, Params, Simulator, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def main():
    weights, lengths = load_connectivity(ASSET)
    for sigma in (0.05, 0.10, 0.15, 0.20):
        for seed in (0, 1, 2):
            p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                          "ou_sigma": sigma, "ou_tau_ms": 100.0, "seed": seed})
            sim = Simulator(weights, lengths, p)
            r = sim.run(60000.0, snapshot_every=10)
            mean_e = r.E.mean(axis=1)
            over = np.where(mean_e > 0.15)[0]
            first = None if len(over) == 0 else float(over[0] * 10 / 1000.0)
            tail = r.E[int(50000 // 10):]
            med_std = float(np.median(tail.std(axis=0)))
            print(f"sigma={sigma:.2f} seed={seed}  maxMeanE={mean_e.max():.4f} "
                  f"firstLock_s={first} medianNodeStd(last10s)={med_std:.4f} "
                  f"finite={bool(np.all(np.isfinite(r.E)))}", flush=True)


if __name__ == "__main__":
    main()
