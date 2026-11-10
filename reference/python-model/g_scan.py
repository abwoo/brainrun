"""Stability / propagation scan over global coupling G.

EXPLORATORY Phase 2 script.  It was written when the coupling was
row-normalised (mean-field); the engine has since moved to raw-sum
coupling (TVB convention, see docs/validation.md §2), so the numbers
it printed are STALE and its outputs/ JSON was deleted.  Kept as an
audit record of how the demo preset was found; do not quote its
numbers — docs/validation.md (experiments.py) is authoritative.
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def baseline_stats(result):
    # Last 1000 ms of the run, all nodes pooled.
    tail = result.E[-1000:]
    return {
        "mean_E": float(tail.mean()),
        "std_E": float(tail.std()),
        "max_E": float(tail.max()),
        "min_E": float(tail.min()),
        "max_abs_drift": float(np.abs(tail[-1] - tail[0]).max()),
    }


def stim_response(result, stim_node=40, stim_t=1000.0):
    t = result.t_ms
    pre = (t >= 500.0) & (t < 1000.0)
    post = (t >= 1000.0) & (t < 2000.0)
    base = result.E[pre].mean(axis=0)
    post_peak = np.abs(result.E[post] - base[None, :]).max(axis=0)
    others = np.delete(post_peak, stim_node)
    return {
        "stim_peak_dE": float(post_peak[stim_node]),
        "network_mean_peak_dE": float(others.mean()),
        "network_max_peak_dE": float(others.max()),
        "nodes_over_0.01": int((others > 0.01).sum()),
        "nodes_over_0.05": int((others > 0.05).sum()),
    }


def main():
    weights, lengths = load_connectivity(ASSET)
    out = {}
    for G in (0.0, 0.25, 0.5, 1.0, 2.0, 4.0):
        params = Params(G=G)
        sim = Simulator(weights, lengths, params)
        base = sim.run(5000.0)
        sim.reset()
        stim = sim.run(
            5000.0,
            events=[StimulusEvent(node=40, start_ms=1000.0, duration_ms=100.0, amplitude=2.0)],
        )
        row = {"baseline": baseline_stats(base), "stimulus": stim_response(stim)}
        out[f"G={G}"] = row
        b, s = row["baseline"], row["stimulus"]
        print(
            f"G={G:<5} baseline mean_E={b['mean_E']:.4f} std_E={b['std_E']:.5f} "
            f"max_E={b['max_E']:.4f} drift={b['max_abs_drift']:.5f} | "
            f"stim peak dE={s['stim_peak_dE']:.4f} network mean={s['network_mean_peak_dE']:.4f} "
            f"max={s['network_max_peak_dE']:.4f} nodes>0.01: {s['nodes_over_0.01']}/75 "
            f"nodes>0.05: {s['nodes_over_0.05']}/75"
        )
    outpath = Path(__file__).parent / "outputs" / "g_scan.json"
    outpath.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", outpath)


if __name__ == "__main__":
    main()
