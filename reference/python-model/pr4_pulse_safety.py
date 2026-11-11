"""PR4 pulse-safety scan: does a STANDARD pulse (node 40, amp 2.0, 100 ms)
still return to baseline when a background drive is on?

Background: S0/S3 cross-checks showed that with OU sigma=0.20 or sine
amp=0.50, the same pulse that is a transient in Quiet mode tips the
network into the high state (mean E 0.24-0.46, staying).  This scan maps
the boundary: for each background level, settle 2 s, pulse, then watch
mean E at +500 ms and +3 s after the pulse.  Recovery = mean E back
below 0.03 at +3 s.

Run: python3 reference/python-model/pr4_pulse_safety.py  (from the repo root)
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


def pulse_recovery(params, node=40, settle=2000.0, watch=3000.0):
    weights, lengths = load_connectivity(ASSET)
    sim = Simulator(weights, lengths, params)
    sim.run(settle)
    r = sim.run(watch, [StimulusEvent(node, 0.0, 100.0, 2.0)])
    mean_e = r.E.mean(axis=1)
    return {
        "meanE_pre": float(mean_e[0]),
        "meanE_+500ms": float(mean_e[500]),
        "meanE_+3s": float(mean_e[-1]),
        "maxMeanE": float(mean_e.max()),
        "recovered": bool(mean_e[-1] < 0.03),
    }


def main():
    print("== pulse recovery vs OU sigma (Spontaneous, seed 0) ==")
    for sigma in (0.05, 0.10, 0.15, 0.20):
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                      "ou_sigma": sigma, "seed": 0})
        s = pulse_recovery(p)
        print(f"sigma={sigma:.2f}  pre={s['meanE_pre']:.4f} +500ms={s['meanE_+500ms']:.4f} "
              f"+3s={s['meanE_+3s']:.4f} max={s['maxMeanE']:.4f} "
              f"{'RECOVERED' if s['recovered'] else 'LOCKED'}")
    print("== pulse recovery vs sine amp (Oscillatory, 10 Hz) ==")
    for amp in (0.2, 0.3, 0.5):
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_OSCILLATORY,
                      "ext_sine_amp": amp, "ext_sine_freq_hz": 10.0})
        s = pulse_recovery(p)
        print(f"amp={amp:.1f}  pre={s['meanE_pre']:.4f} +500ms={s['meanE_+500ms']:.4f} "
              f"+3s={s['meanE_+3s']:.4f} max={s['maxMeanE']:.4f} "
              f"{'RECOVERED' if s['recovered'] else 'LOCKED'}")
    print("== quiet reference (same pulse) ==")
    s = pulse_recovery(Params.demo())
    print(f"quiet  pre={s['meanE_pre']:.4f} +500ms={s['meanE_+500ms']:.4f} "
          f"+3s={s['meanE_+3s']:.4f} max={s['maxMeanE']:.4f} "
          f"{'RECOVERED' if s['recovered'] else 'LOCKED'}")


if __name__ == "__main__":
    main()
