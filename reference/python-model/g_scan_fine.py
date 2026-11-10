"""Fine G scan: locate the low-branch -> high-branch transition and check
temporal stability properly (per-node std over time, not pooled).

EXPLORATORY Phase 2 script (see g_scan.py header): written under the
superseded mean-field coupling; numbers are STALE.  Authoritative
numbers are in docs/validation.md (experiments.py).
"""
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


def main():
    weights, lengths = load_connectivity(ASSET)
    out = {}
    for G in (0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45):
        params = Params(G=G)
        sim = Simulator(weights, lengths, params)
        base = sim.run(5000.0)
        tail = base.E[-1000:]  # last 1000 ms
        temporal_std = tail.std(axis=0)  # per node, over time
        sim.reset()
        stim = sim.run(5000.0, events=[StimulusEvent(node=40, start_ms=1000.0, duration_ms=100.0, amplitude=2.0)])
        t = stim.t_ms
        pre = (t >= 500.0) & (t < 1000.0)
        post = (t >= 1000.0) & (t < 2000.0)
        base_vec = stim.E[pre].mean(axis=0)
        post_peak = np.abs(stim.E[post] - base_vec[None, :]).max(axis=0)
        others = np.delete(post_peak, 40)
        row = {
            "baseline_mean_E": float(tail.mean()),
            "baseline_max_temporal_std": float(temporal_std.max()),
            "baseline_mean_temporal_std": float(temporal_std.mean()),
            "stim_peak_dE": float(post_peak[40]),
            "network_mean_peak_dE": float(others.mean()),
            "nodes_over_0.01": int((others > 0.01).sum()),
        }
        out[f"G={G}"] = row
        print(
            f"G={G:<5} mean_E={row['baseline_mean_E']:.4f} "
            f"max_temporal_std={row['baseline_max_temporal_std']:.6f} "
            f"mean_temporal_std={row['baseline_mean_temporal_std']:.6f} | "
            f"stim={row['stim_peak_dE']:.4f} net_mean={row['network_mean_peak_dE']:.4f} "
            f"nodes>0.01: {row['nodes_over_0.01']}/75"
        )
    outpath = Path(__file__).parent / "outputs" / "g_scan_fine.json"
    outpath.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", outpath)


if __name__ == "__main__":
    main()
