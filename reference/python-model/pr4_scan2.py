"""PR4 scan round 2: oscillation hunt with (a) multiple initial conditions
(a limit cycle can coexist with a stable fixed point — starting only at
E=I=0 misses it) and (b) a constant background drive P (Table 1's 20 Hz
claim carries P=0.5; applied here via the sustained bias, +0.5 on every
node, which is exactly a constant input to P).

Run: python3 reference/python-model/pr4_scan2.py  (from the repo root)
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def fft_peak(e_trace, dt_ms=1.0):
    x = np.asarray(e_trace, dtype=np.float64)
    x = x - x.mean()
    n = len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=dt_ms / 1000.0)
    spec[0] = 0.0
    k = int(np.argmax(spec))
    return float(freqs[k]), float(np.ptp(e_trace))


def single_node(params, drive=0.0, dur=8000.0):
    """Run from a grid of ICs; report the most oscillatory endpoint."""
    W = np.array([[0.0]])
    L = np.array([[0.0]])
    best = None
    for e0 in (0.0, 0.3, 0.6):
        for i0 in (0.0, 0.3, 0.6):
            sim = Simulator(W, L, params, e0=e0, i0=i0)
            if drive != 0.0:
                sim.set_bias(0, drive)
            r = sim.run(dur)
            tail = r.E[int(4000):, 0]
            f, ptp = fft_peak(tail)
            rec = {
                "mean_E": float(tail.mean()),
                "std": float(tail.std()),
                "ptp": ptp,
                "freq_Hz": f,
                "finite": bool(np.all(np.isfinite(r.E))),
                "ic": (e0, i0),
            }
            if best is None or rec["std"] > best["std"]:
                best = rec
    return best


TABLE1 = {
    "c_ee": 10.0, "c_ei": 6.0, "c_ie": 10.0, "c_ii": 1.0,
    "a_e": 1.0, "a_i": 1.0, "b_e": 0.0, "b_i": 0.0,
    "theta_e": 2.0, "theta_i": 3.5, "alpha_e": 1.2, "alpha_i": 2.0,
}
DEMO = Params.demo().__dict__

CANDIDATES = {
    "table1": (TABLE1, 0.0),
    "table1+P0.5": (TABLE1, 0.5),
    "table1+P0.2": (TABLE1, 0.2),
    "table1+P1.0": (TABLE1, 1.0),
    "demo+P0.5": (DEMO, 0.5),
    "demo+tau_i50": ({**DEMO, "tau_i": 50.0}, 0.0),
    "demo+tau_i100": ({**DEMO, "tau_i": 100.0}, 0.0),
    "demo+tau_i50+c_ei6": ({**DEMO, "tau_i": 50.0, "c_ei": 6.0}, 0.0),
    "demo+tau_i50+c_ii1": ({**DEMO, "tau_i": 50.0, "c_ii": 1.0}, 0.0),
    "demo+c_ee16": ({**DEMO, "c_ee": 16.0}, 0.0),
    "demo+c_ee16+tau_i50": ({**DEMO, "c_ee": 16.0, "tau_i": 50.0}, 0.0),
    "demo+c_ie20": ({**DEMO, "c_ie": 20.0}, 0.0),
    "demo+c_ie20+tau_i50": ({**DEMO, "c_ie": 20.0, "tau_i": 50.0}, 0.0),
    "demo+tau_e20+tau_i50": ({**DEMO, "tau_e": 20.0, "tau_i": 50.0}, 0.0),
    "demo+theta_e0": ({**DEMO, "theta_e": 0.0}, 0.0),
    "demo+theta_e0+tau_i50": ({**DEMO, "theta_e": 0.0, "tau_i": 50.0}, 0.0),
    "table1+P0.5+tau_i20": ({**TABLE1, "tau_i": 20.0}, 0.5),
    "table1+P0.5+Gnet": (TABLE1, 0.5),  # network checked below
}


def main():
    print("== single node, IC grid, 8 s (best IC shown) ==")
    survivors = []
    for name, (over, drive) in CANDIDATES.items():
        if name.endswith("Gnet"):
            continue
        p = Params(**over)
        s = single_node(p, drive=drive)
        osc = s["std"] > 0.01 and s["finite"]
        print(f"{name:26s} meanE={s['mean_E']:.4f} std={s['std']:.4f} "
              f"ptp={s['ptp']:.4f} f={s['freq_Hz']:6.2f} Hz ic={s['ic']} "
              f"finite={s['finite']} {'OSC?' if osc else ''}")
        if osc:
            survivors.append(name)
    print(f"survivors: {survivors}")

    print("== network (G=0.35, 8 s) for survivors + table1+P0.5 ==")
    weights, lengths = load_connectivity(ASSET)
    for name in dict.fromkeys(survivors + ["table1+P0.5"]):
        over, drive = CANDIDATES[name]
        p = Params(**{**over, "G": 0.35})
        sim = Simulator(weights, lengths, p)
        if drive != 0.0:
            for n in range(sim.n):
                sim.set_bias(n, drive)
        r = sim.run(8000.0)
        mean_e = r.E.mean(axis=1)
        tail = mean_e[int(4000):]
        f, ptp = fft_peak(tail)
        print(f"{name:26s} meanE={tail.mean():.4f} maxMeanE={mean_e.max():.4f} "
              f"stdMeanE={tail.std():.4f} ptpMeanE={ptp:.4f} f={f:6.2f} Hz "
              f"finite={bool(np.all(np.isfinite(r.E)))}")


if __name__ == "__main__":
    main()
