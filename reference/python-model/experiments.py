"""Validation experiment battery (Python side).

Produces every number that goes into docs/validation.md, all from real
runs of reference/python-model/wilson_cowan.py.  Writes
outputs/experiments.json.  The Python<->Rust parity numbers come from
compare.py (outputs/compare.json) and are NOT recomputed here.
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

PULSE = [StimulusEvent(40, 1000.0, 100.0, 2.0)]


def row_normalise(weights: np.ndarray) -> np.ndarray:
    row_sum = weights.sum(axis=1, keepdims=True)
    out = np.zeros_like(weights)
    np.divide(weights, row_sum, out=out, where=row_sum > 0)
    return out


def response_metrics(result, stim_node=40):
    t = result.t_ms
    pre = (t >= 500.0) & (t < 1000.0)
    post = (t >= 1000.0) & (t < 2000.0)
    base = result.E[pre].mean(axis=0)
    peak = np.abs(result.E[post] - base[None, :]).max(axis=0)
    others = np.delete(peak, stim_node)
    after = result.E[(t >= 1100), stim_node]
    tt = t[t >= 1100]
    idx = np.where(np.abs(after - base[stim_node]) < 0.01)[0]
    return {
        "baseline_mean_E": float(result.E[pre].mean()),
        "baseline_max_temporal_std": float(result.E[pre].std(axis=0).max()),
        "stim_peak_dE": float(peak[stim_node]),
        "network_mean_peak_dE": float(others.mean()),
        "network_max_peak_dE": float(others.max()),
        "nodes_over_0.01": int((others > 0.01).sum()),
        "nodes_over_0.05": int((others > 0.05).sum()),
        "return_ms_after_stimulus": float(tt[idx[0]] - 1100) if len(idx) else None,
        "network_mean_E_4000_5000ms": float(result.E[(t >= 4000)].mean()),
    }


def run(weights, lengths, params, duration=5000.0, events=None):
    sim = Simulator(weights, lengths, params)
    return sim.run(duration, events=events or [])


def main():
    weights, lengths = load_connectivity(ASSET)
    out = {}

    # 1. G sweep, demo preset (theta_e=1.0, raw coupling).
    out["g_sweep_demo"] = {}
    for G in (0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6):
        r = run(weights, lengths, Params(theta_e=1.0, G=G), events=PULSE)
        out["g_sweep_demo"][f"G={G}"] = response_metrics(r)
        m = out["g_sweep_demo"][f"G={G}"]
        print(f"G={G:<4} base={m['baseline_mean_E']:.4f} stim={m['stim_peak_dE']:.4f} "
              f"net_mean={m['network_mean_peak_dE']:.4f} nodes>0.01:{m['nodes_over_0.01']}/75 "
              f"return={m['return_ms_after_stimulus']} post={m['network_mean_E_4000_5000ms']:.4f}")

    # 2. Stimulus amplitude sweep, demo preset, G=0.4.
    out["stim_amplitude_sweep"] = {}
    for amp in (0.5, 1.0, 2.0, 4.0):
        r = run(weights, lengths, Params.demo(),
                events=[StimulusEvent(40, 1000.0, 100.0, amp)])
        out["stim_amplitude_sweep"][f"amp={amp}"] = response_metrics(r)
        m = out["stim_amplitude_sweep"][f"amp={amp}"]
        print(f"amp={amp:<4} stim={m['stim_peak_dE']:.4f} net_mean={m['network_mean_peak_dE']:.4f} "
              f"nodes>0.01:{m['nodes_over_0.01']}/75 return={m['return_ms_after_stimulus']} "
              f"post={m['network_mean_E_4000_5000ms']:.4f}")

    # 3. Inhibition sweep (c_ei), demo preset, G=0.4.
    out["c_ei_sweep"] = {}
    for c_ei in (2.0, 4.0, 8.0):
        r = run(weights, lengths, Params(theta_e=1.0, c_ei=c_ei), events=PULSE)
        out["c_ei_sweep"][f"c_ei={c_ei}"] = response_metrics(r)
        m = out["c_ei_sweep"][f"c_ei={c_ei}"]
        print(f"c_ei={c_ei:<4} stim={m['stim_peak_dE']:.4f} net_mean={m['network_mean_peak_dE']:.4f} "
              f"nodes>0.01:{m['nodes_over_0.01']}/75 return={m['return_ms_after_stimulus']}")

    # 4. Hold stimuli (press-and-hold), demo preset, G=0.4.
    out["hold"] = {}
    for dur in (500.0, 2000.0):
        r = run(weights, lengths, Params.demo(),
                events=[StimulusEvent(40, 1000.0, dur, 2.0)])
        t = r.t_ms
        pre = float(r.E[(t >= 500) & (t < 1000), 40].mean())
        during = float(r.E[(t >= 1000 + dur - 100) & (t < 1000 + dur), 40].mean())
        post = float(r.E[(t >= 4000), 40].mean())
        out["hold"][f"hold_{int(dur)}ms"] = {
            "node40_pre": pre, "node40_end_of_hold": during, "node40_post_4000ms": post,
            "network_mean_E_4000_5000ms": float(r.E[(t >= 4000)].mean()),
        }
        print(f"hold {int(dur)}ms: node40 pre={pre:.4f} end_of_hold={during:.4f} post={post:.4f}")

    # 5. dt sensitivity: dt in {0.5, 1, 2} vs dt=0.5 reference, common 2 ms grid.
    out["dt_sensitivity"] = {}
    ref = run(weights, lengths, Params(theta_e=1.0, dt=0.5), duration=2000.0, events=PULSE)
    ref_grid = ref.E[::4]  # dt=0.5 -> every 4th step = 2 ms grid
    for dt in (1.0, 2.0):
        r = run(weights, lengths, Params(theta_e=1.0, dt=dt), duration=2000.0, events=PULSE)
        step = int(2.0 / dt)
        grid = r.E[::step]
        n = min(len(ref_grid), len(grid))
        d = np.abs(ref_grid[:n] - grid[:n])
        out["dt_sensitivity"][f"dt={dt}_vs_0.5"] = {
            "max_abs_dE": float(d.max()), "rms_dE": float(np.sqrt((d ** 2).mean())),
        }
        print(f"dt={dt} vs 0.5: max|dE|={d.max():.3e} rms={np.sqrt((d**2).mean()):.3e}")

    # 6. Boundary conditions: extreme stimulus / coupling must stay finite
    # (or raise DivergenceError, never silently NaN).
    out["boundary"] = {}
    for label, params, events in [
        ("stim_amp_20", Params.demo(), [StimulusEvent(40, 500.0, 100.0, 20.0)]),
        ("G_20", Params(theta_e=1.0, G=20.0), PULSE),
        ("G_100", Params(theta_e=1.0, G=100.0), PULSE),
        ("stim_amp_20_G_20", Params(theta_e=1.0, G=20.0), [StimulusEvent(40, 500.0, 100.0, 20.0)]),
    ]:
        try:
            r = run(weights, lengths, params, duration=2000.0, events=events)
            finite = bool(np.all(np.isfinite(r.E)) and np.all(np.isfinite(r.I)))
            out["boundary"][label] = {"outcome": "finished_finite" if finite else "finished_nonfinite",
                                      "E_max": float(r.E.max()), "E_min": float(r.E.min())}
        except Exception as e:  # noqa: BLE001 - DivergenceError expected here
            out["boundary"][label] = {"outcome": f"raised {type(e).__name__}: {e}"}
        print(f"boundary {label}: {out['boundary'][label]}")

    # 7. Coupling comparison: mean-field (row-normalised) vs raw-sum.
    # Mean-field is emulated by feeding pre-normalised weights; the
    # engine itself only implements raw-sum (TVB convention).
    out["coupling_comparison"] = {}
    chat = row_normalise(weights)
    for label, w, G in [
        ("mean-field G=0.25 (A-set)", None, 0.25),   # A-set local params
        ("mean-field G=4.0 (b_e=3.5)", None, 4.0),
        ("raw G=0.2 (b_e=3.5)", None, 0.2),
    ]:
        if "A-set" in label:
            p = Params(G=G)
            r = run(chat, lengths, p, events=PULSE)
        else:
            p = Params(theta_e=0.0, b_e=3.5, G=G)
            r = run(chat if "mean-field" in label else weights, lengths, p, events=PULSE)
        out["coupling_comparison"][label] = response_metrics(r)
        m = out["coupling_comparison"][label]
        print(f"{label}: base={m['baseline_mean_E']:.4f} stim={m['stim_peak_dE']:.4f} "
              f"net_mean={m['network_mean_peak_dE']:.4f} nodes>0.01:{m['nodes_over_0.01']}/75 "
              f"return={m['return_ms_after_stimulus']} post={m['network_mean_E_4000_5000ms']:.4f}")

    # 8. A-set reference behaviour (single node + network, for §1).
    out["a_set_reference"] = {}
    # (fresh simulator per amplitude to avoid state carry-over)
    for amp in (0.05, 0.1):
        s = Simulator(np.array([[0.0]]), np.array([[0.0]]), Params())
        r = s.run(5000.0, events=[StimulusEvent(0, 1000.0, 100.0, amp)])
        t = r.t_ms
        out["a_set_reference"][f"single_node_amp={amp}"] = {
            "pre_E": float(r.E[(t >= 500) & (t < 1000)].mean()),
            "peak_E": float(r.E[t >= 1000].max()),
            "post_E_4000_5000ms": float(r.E[(t >= 4000)].mean()),
        }
        print(f"A-set single node amp={amp}: {out['a_set_reference'][f'single_node_amp={amp}']}")

    (OUT / "experiments.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    print("wrote", OUT / "experiments.json")


if __name__ == "__main__":
    main()
