"""Candidate preset scan: find a parameter set with a transient (non-latching)
stimulus response, as the A-set is bistable (verified in
verify_fixed_points.py).

EXPLORATORY Phase 2 script (see g_scan.py header): its network numbers
were computed under the superseded mean-field coupling and are STALE
(single-node numbers are coupling-independent and remain valid).
Authoritative numbers are in docs/validation.md (experiments.py).
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"

CANDIDATES = {
    "A-set (reference)": {},
    "A + b_e=3.5": {"b_e": 3.5},
    "A + b_e=4.0": {"b_e": 4.0},
    "A + c_ee=10": {"c_ee": 10.0},
    "A + c_ee=9": {"c_ee": 9.0},
    "A + theta_e=1.0": {"theta_e": 1.0},
    "A + theta_e=2.0": {"theta_e": 2.0},
    # Sanz-Leon et al. 2014 / Daffertshofer & van Wijk 2011, TVB docs Table 1
    # (20 Hz peak oscillation preset); P=0.5 is a constant background drive.
    "oscillatory Table 1": {
        "c_ee": 10.0, "c_ei": 6.0, "c_ie": 10.0, "c_ii": 1.0,
        "a_e": 1.0, "a_i": 1.0, "b_e": 0.0, "b_i": 0.0,
        "theta_e": 2.0, "theta_i": 3.5, "alpha_e": 1.2, "alpha_i": 2.0,
    },
}


def single_node_check(params: Params):
    W = np.array([[0.0]])
    L = np.array([[0.0]])
    # Basin: endpoints from a grid of ICs.
    endpoints = set()
    for e0 in (0.0, 0.3, 0.6, 1.0):
        for i0 in (0.0, 0.3, 0.6, 1.0):
            sim = Simulator(W, L, params, e0=e0, i0=i0)
            r = sim.run(2000.0)
            endpoints.add(round(float(r.E[-1, 0]), 3))
    # Pulse response from the default IC.
    sim = Simulator(W, L, params)
    r = sim.run(5000.0, events=[StimulusEvent(0, 1000.0, 100.0, 2.0)])
    t = r.t_ms
    pre = float(r.E[(t >= 500) & (t < 1000)].mean())
    peak = float(r.E[t >= 1000].max())
    post = float(r.E[(t >= 4000)].mean())
    after = r.E[(t >= 1100)]
    tt = t[t >= 1100]
    idx = np.where(np.abs(after - pre) < 0.01)[0]
    t_ret = float(tt[idx[0]] - 1100) if len(idx) else None
    # Baseline temporal stability (last 1000 ms of an unstimulated run).
    sim2 = Simulator(W, L, params)
    r2 = sim2.run(5000.0)
    tstd = float(r2.E[-1000:].std())
    return {
        "n_fixed_points": len(endpoints),
        "endpoints": sorted(endpoints),
        "baseline_E": pre,
        "baseline_temporal_std": tstd,
        "peak_dE": peak - pre,
        "post_E": post,
        "return_ms": t_ret,
    }


def network_check(params: Params, weights, lengths):
    sim = Simulator(weights, lengths, Params(**{**params.__dict__, "G": 0.25}))
    r = sim.run(5000.0, events=[StimulusEvent(40, 1000.0, 100.0, 2.0)])
    t = r.t_ms
    pre = r.E[(t >= 500) & (t < 1000)].mean(axis=0)
    post = r.E[(t >= 1000) & (t < 2000)]
    peak = np.abs(post - pre[None, :]).max(axis=0)
    others = np.delete(peak, 40)
    return {
        "stim_peak_dE": float(peak[40]),
        "network_mean_peak_dE": float(others.mean()),
        "nodes_over_0.01": int((others > 0.01).sum()),
        "network_post_mean_E": float(r.E[(t >= 4000)].mean()),
    }


def main():
    weights, lengths = load_connectivity(ASSET)
    for name, over in CANDIDATES.items():
        p = Params(**over)
        s = single_node_check(p)
        n = network_check(p, weights, lengths)
        print(f"{name}")
        print(
            f"  single: fixed_pts={s['n_fixed_points']} {s['endpoints']} "
            f"baseline_E={s['baseline_E']:.4f} temporal_std={s['baseline_temporal_std']:.5f} "
            f"peak_dE={s['peak_dE']:.4f} post_E={s['post_E']:.4f} return_ms={s['return_ms']}"
        )
        print(
            f"  network G=0.25: stim_peak={n['stim_peak_dE']:.4f} "
            f"net_mean={n['network_mean_peak_dE']:.4f} nodes>0.01: {n['nodes_over_0.01']}/75 "
            f"post_mean_E={n['network_post_mean_E']:.4f}"
        )


if __name__ == "__main__":
    main()
