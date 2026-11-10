"""Default 5-second reference run (demo preset).

Burn-in 1000 ms with no stimulus, then a 100 ms, amplitude 2.0 pulse
on node 40 (lAMYG) at t=1000 ms.  Writes:
  outputs/default_run.json  — summary numbers
  outputs/default_run_traces.npz — full t / E / I / P traces
  outputs/default_run_node40.csv — node-40 E trace sampled every 10 ms
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

HERE = Path(__file__).parent
ASSET = HERE.parents[1] / "app/public/brain-assets/connectivity.json"
OUT = HERE / "outputs"


def main():
    weights, lengths = load_connectivity(ASSET)
    params = Params.demo()
    sim = Simulator(weights, lengths, params)
    result = sim.run(
        5000.0,
        events=[StimulusEvent(node=40, start_ms=1000.0, duration_ms=100.0, amplitude=params.stim_amplitude)],
    )
    t, E, I, P = result.t_ms, result.E, result.I, result.P
    pre = (t >= 500.0) & (t < 1000.0)
    post = (t >= 1000.0) & (t < 2000.0)
    base = E[pre].mean(axis=0)
    peak = np.abs(E[post] - base[None, :]).max(axis=0)
    others = np.delete(peak, 40)
    after = E[(t >= 1100), 40]
    tt = t[t >= 1100]
    idx = np.where(np.abs(after - base[40]) < 0.01)[0]
    summary = {
        "params": {"preset": "demo (A-set, theta_e=1.0)", **{k: getattr(params, k) for k in
                    ("c_ee", "c_ei", "c_ie", "c_ii", "tau_e", "tau_i", "a_e", "b_e",
                     "a_i", "b_i", "theta_e", "theta_i", "G", "speed", "dt",
                     "stim_amplitude", "stim_duration_ms", "noise_amp", "seed")}},
        "duration_ms": 5000.0,
        "stimulus": {"node": 40, "label": "lAMYG", "start_ms": 1000.0, "duration_ms": 100.0, "amplitude": 2.0},
        "baseline": {
            "mean_E": float(E[pre].mean()),
            "max_temporal_std_E": float(E[pre].std(axis=0).max()),
            "mean_E_node40": float(base[40]),
        },
        "response": {
            "stim_node_peak_dE": float(peak[40]),
            "network_mean_peak_dE": float(others.mean()),
            "network_max_peak_dE": float(others.max()),
            "nodes_over_0.01": int((others > 0.01).sum()),
            "nodes_over_0.05": int((others > 0.05).sum()),
            "return_to_baseline_ms_after_stimulus": float(tt[idx[0]] - 1100) if len(idx) else None,
            "network_mean_E_4000_5000ms": float(E[(t >= 4000)].mean()),
        },
        "ranges": {
            "E_min": float(E.min()), "E_max": float(E.max()),
            "I_min": float(I.min()), "I_max": float(I.max()),
            "P_max": float(P.max()),
        },
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "default_run.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    np.savez_compressed(OUT / "default_run_traces.npz", t_ms=t, E=E, I=I, P=P)
    sel = np.arange(0, len(t), 10)
    csv_lines = ["t_ms,E_node40_lAMYG,I_node40_lAMYG"]
    csv_lines += [f"{t[i]:.0f},{E[i, 40]:.6f},{I[i, 40]:.6f}" for i in sel]
    (OUT / "default_run_node40.csv").write_text("\n".join(csv_lines), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
