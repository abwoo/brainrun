"""PR4 pulse-timing scan: is pulse safety timing-dependent?

Finding (2026-11-11): at OU sigma=0.15, a standard pulse (node 40,
amp 2.0, 100 ms) at absolute t=1000 ms flips the network to a partial
high state (mean E 0.24-0.25, staying), while the same pulse at t=2000 ms
recovers (max mean E 0.026).  The OU state at click time decides the
outcome.  This scan measures the flip rate: pulses at 8 absolute times
x 3 seeds for sigma in {0.05, 0.10, 0.15}, plus sine-phase dependence
for the oscillatory preset (pulse at 4 sine phases).

Run: python3 reference/python-model/pr4_pulse_timing.py  (from the repo root)
Each line: one click; RECOVERED = mean E < 0.03 three seconds after the
pulse, LOCKED = still above 0.03 (partial or full high state).
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import (
    BG_OSCILLATORY,
    BG_SPONTANEOUS,
    Params,
    Simulator,
    StimulusEvent,
    load_connectivity,
)

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"
W, L = load_connectivity(ASSET)


def click(params, at_ms, node=40, watch=3000.0):
    sim = Simulator(W, L, params)
    sim.run(float(at_ms))
    r = sim.run(watch, [StimulusEvent(node, 0.0, 100.0, 2.0)])
    mean_e = r.E.mean(axis=1)
    return float(mean_e[-1]), float(mean_e.max())


def main():
    times = (500, 1000, 1500, 2000, 2500, 3000, 4000, 5000)
    for sigma in (0.05, 0.10, 0.15):
        flips = 0
        total = 0
        for seed in (0, 1, 2):
            p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                          "ou_sigma": sigma, "seed": seed})
            for t in times:
                last, mx = click(p, t)
                total += 1
                tag = "RECOVERED" if last < 0.03 else "LOCKED"
                if last >= 0.03:
                    flips += 1
                print(f"OU sigma={sigma:.2f} seed={seed} click@{t}ms: +3s={last:.4f} "
                      f"max={mx:.4f} {tag}")
        print(f"==> OU sigma={sigma:.2f}: {flips}/{total} clicks flipped\n")

    print("== oscillatory 0.30/10 Hz: pulse at 4 sine phases (seed-free) ==")
    p = Params(**{**Params.demo().__dict__, "bg_mode": BG_OSCILLATORY,
                  "ext_sine_amp": 0.30, "ext_sine_freq_hz": 10.0})
    for phase_ms in (2000, 2025, 2050, 2075):  # 0, 90, 180, 270 deg at 10 Hz
        last, mx = click(p, phase_ms)
        tag = "RECOVERED" if last < 0.03 else "LOCKED"
        print(f"osc click@{phase_ms}ms (phase {(phase_ms % 100)}ms): +3s={last:.4f} "
              f"max={mx:.4f} {tag}")


if __name__ == "__main__":
    main()
