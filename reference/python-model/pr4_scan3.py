"""PR4 scan round 3: (a) network-level oscillation check — per-node std, not
just mean-E (a desynchronised rhythm would hide in the mean); (b) sizing of
the fallback external sine drive for the Oscillatory mode.

Round 2 conclusion stands for the single node: no candidate oscillated.
This round checks whether delayed network coupling rescues a rhythm.
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def fft_peak(x, dt_ms=1.0):
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    n = len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=dt_ms / 1000.0)
    spec[0] = 0.0
    return float(freqs[int(np.argmax(spec))]), float(np.ptp(x))


def network_stats(params, weights, lengths, drive=0.0, dur=8000.0):
    sim = Simulator(weights, lengths, params)
    if drive != 0.0:
        for n in range(sim.n):
            sim.set_bias(n, drive)
    r = sim.run(dur)
    tail = r.E[int(4000):]
    node_std = tail.std(axis=0)
    mean_e = r.E.mean(axis=1)[int(4000):]
    f, ptp = fft_peak(mean_e)
    return {
        "max_node_std": float(node_std.max()),
        "mean_node_std": float(node_std.mean()),
        "mean_E": float(mean_e.mean()),
        "max_mean_E": float(r.E.mean(axis=1).max()),
        "meanE_fft_Hz": f,
        "meanE_ptp": ptp,
        "finite": bool(np.all(np.isfinite(r.E))),
    }


TABLE1 = {
    "c_ee": 10.0, "c_ei": 6.0, "c_ie": 10.0, "c_ii": 1.0,
    "a_e": 1.0, "a_i": 1.0, "b_e": 0.0, "b_i": 0.0,
    "theta_e": 2.0, "theta_i": 3.5, "alpha_e": 1.2, "alpha_i": 2.0,
}


def main():
    weights, lengths = load_connectivity(ASSET)
    print("== (a) network per-node oscillation check, G=0.35, 8 s ==")
    for name, over, drive in [
        ("demo", Params.demo().__dict__, 0.0),
        ("demo+P0.5", Params.demo().__dict__, 0.5),
        ("table1", TABLE1, 0.0),
        ("table1+P0.5", TABLE1, 0.5),
        ("demo+tau_i50", {**Params.demo().__dict__, "tau_i": 50.0}, 0.0),
        ("demo+tau_i50+P0.5", {**Params.demo().__dict__, "tau_i": 50.0}, 0.5),
    ]:
        p = Params(**{**over, "G": 0.35})
        s = network_stats(p, weights, lengths, drive=drive)
        print(f"{name:22s} maxNodeStd={s['max_node_std']:.5f} meanNodeStd={s['mean_node_std']:.5f} "
              f"meanE={s['mean_E']:.4f} maxMeanE={s['max_mean_E']:.4f} "
              f"meanE_fft={s['meanE_fft_Hz']:6.2f} Hz ptp={s['meanE_ptp']:.4f} finite={s['finite']}")


if __name__ == "__main__":
    main()
