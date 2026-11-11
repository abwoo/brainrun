"""PR4 exploratory scan: find a Wilson-Cowan parameter regime with a stable
self-sustained rhythm (limit cycle) under the CURRENT equations, and size the
OU background drive.

Run: python3 reference/python-model/pr4_scan.py  (from the repo root)
Part A: oscillatory candidates — single node first (cheap), then the 76-node
network at G=0.35 for survivors. Metrics: FFT peak frequency of E over the
last 4 s of an 8 s unstimulated run, peak-to-peak amplitude, sustained-ness
(std of last 1 s vs previous 1 s), mean E, finiteness.
Part B: OU sizing (needs the OU implementation in wilson_cowan.py; if OU is
not implemented yet this part exits with a message).
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def fft_peak(e_trace, dt_ms=1.0):
    """Dominant frequency (Hz) and peak-to-peak amplitude of a 1-D E trace."""
    x = np.asarray(e_trace, dtype=np.float64)
    x = x - x.mean()
    n = len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=dt_ms / 1000.0)
    spec[0] = 0.0  # ignore DC
    k = int(np.argmax(spec))
    return float(freqs[k]), float(spec[k]), float(np.ptp(e_trace))


def single_node_osc(params, dur=8000.0):
    W = np.array([[0.0]])
    L = np.array([[0.0]])
    sim = Simulator(W, L, params)
    r = sim.run(dur)
    tail = r.E[int(4000):, 0]
    f, mag, ptp = fft_peak(tail)
    last1 = r.E[int(7000):, 0].std()
    prev1 = r.E[int(6000):int(7000), 0].std()
    return {
        "mean_E": float(r.E[int(4000):].mean()),
        "std": float(tail.std()),
        "ptp": ptp,
        "freq_Hz": f,
        "sustained_ratio": float(last1 / prev1) if prev1 > 0 else float("nan"),
        "finite": bool(np.all(np.isfinite(r.E))),
    }


def network_osc(params, weights, lengths, dur=8000.0):
    sim = Simulator(weights, lengths, params)
    r = sim.run(dur)
    mean_e = r.E.mean(axis=1)
    tail = mean_e[int(4000):]
    f, mag, ptp = fft_peak(tail)
    return {
        "mean_E": float(mean_e[int(4000):].mean()),
        "max_mean_E": float(mean_e.max()),
        "std_mean_E": float(tail.std()),
        "ptp_mean_E": ptp,
        "freq_Hz": f,
        "finite": bool(np.all(np.isfinite(r.E))),
    }


CANDIDATES = {
    # TVB docs Table 1 (Sanz-Leon 2014 / Daffertshofer & van Wijk 2011),
    # 20 Hz peak claim; P=0.5 constant drive NOT applied here (no P field
    # in the engine yet) — see part A2 for the drive variant.
    "table1": {
        "c_ee": 10.0, "c_ei": 6.0, "c_ie": 10.0, "c_ii": 1.0,
        "a_e": 1.0, "a_i": 1.0, "b_e": 0.0, "b_i": 0.0,
        "theta_e": 2.0, "theta_i": 3.5, "alpha_e": 1.2, "alpha_i": 2.0,
    },
    "demo": {"theta_e": 1.0},
    "demo+tau_i20": {"theta_e": 1.0, "tau_i": 20.0},
    "demo+tau_i40": {"theta_e": 1.0, "tau_i": 40.0},
    "demo+c_ii1": {"theta_e": 1.0, "c_ii": 1.0},
    "demo+c_ii5": {"theta_e": 1.0, "c_ii": 5.0},
    "demo+c_ei6": {"theta_e": 1.0, "c_ei": 6.0},
    "demo+c_ei6+tau_i20": {"theta_e": 1.0, "c_ei": 6.0, "tau_i": 20.0},
    "demo+c_ei6+c_ii1": {"theta_e": 1.0, "c_ei": 6.0, "c_ii": 1.0},
    "demo+theta_e2": {"theta_e": 2.0},
    "demo+theta_e2+tau_i20": {"theta_e": 2.0, "tau_i": 20.0},
    "demo+alpha_i2": {"theta_e": 1.0, "alpha_i": 2.0},
    "demo+theta_i3.5": {"theta_e": 1.0, "theta_i": 3.5},
    "demo+b0": {"theta_e": 1.0, "b_e": 0.0, "b_i": 0.0},
    "table1-noalpha": {
        "c_ee": 10.0, "c_ei": 6.0, "c_ie": 10.0, "c_ii": 1.0,
        "a_e": 1.0, "a_i": 1.0, "b_e": 0.0, "b_i": 0.0,
        "theta_e": 2.0, "theta_i": 3.5,
    },
    "table1+theta_e1": {
        "c_ee": 10.0, "c_ei": 6.0, "c_ie": 10.0, "c_ii": 1.0,
        "a_e": 1.0, "a_i": 1.0, "b_e": 0.0, "b_i": 0.0,
        "theta_e": 1.0, "theta_i": 3.5, "alpha_e": 1.2, "alpha_i": 2.0,
    },
}


def main():
    print("== Part A: single-node oscillation scan (8 s, last 4 s analysed) ==")
    survivors = []
    for name, over in CANDIDATES.items():
        p = Params.demo() if name == "demo" else Params(**{**Params.demo().__dict__, **over}) \
            if name != "table1" else Params(**over)
        # NOTE: Params(**over) for table1 drops demo theta_e — table1 sets
        # its own theta_e=2.0, so this is the pure Table 1 set. For the
        # demo+* variants the base is demo (theta_e=1.0).
        try:
            s = single_node_osc(p)
        except Exception as exc:  # noqa: BLE001 - exploratory scan
            print(f"{name:28s} ERROR {exc}")
            continue
        osc = s["std"] > 0.01 and 0.5 < s["sustained_ratio"] < 2.0 and s["finite"]
        print(f"{name:28s} meanE={s['mean_E']:.4f} std={s['std']:.4f} "
              f"ptp={s['ptp']:.4f} f={s['freq_Hz']:6.2f} Hz sust={s['sustained_ratio']:.2f} "
              f"finite={s['finite']} {'OSC?' if osc else ''}")
        if osc:
            survivors.append(name)
    print(f"single-node survivors: {survivors}")

    print("== Part A2: network check (G=0.35, 8 s) for survivors + table1 ==")
    weights, lengths = load_connectivity(ASSET)
    for name in dict.fromkeys(survivors + ["table1"]):
        over = CANDIDATES[name]
        p = Params(**over) if name == "table1" else Params(**{**Params.demo().__dict__, **over})
        p = Params(**{**p.__dict__, "G": 0.35})
        try:
            n = network_osc(p, weights, lengths)
        except Exception as exc:  # noqa: BLE001
            print(f"{name:28s} ERROR {exc}")
            continue
        print(f"{name:28s} meanE={n['mean_E']:.4f} maxMeanE={n['max_mean_E']:.4f} "
              f"stdMeanE={n['std_mean_E']:.4f} ptpMeanE={n['ptp_mean_E']:.4f} "
              f"f={n['freq_Hz']:6.2f} Hz finite={n['finite']}")


if __name__ == "__main__":
    main()
