"""Python <-> Rust cross-validation.

For each scenario: run the Python reference implementation and the Rust
binary (brain-core-run) with identical parameters, events, ICs and
duration, then compare the E/I trajectories step by step.

Run:  python3 compare.py
Requires: cargo build (release) of crates/brain-core; writes
outputs/compare.json with the measured max/RMS differences.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent, load_connectivity

ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / "app/public/brain-assets/connectivity.json"
CRATE = ROOT / "crates/brain-core"
OUT = Path(__file__).parent / "outputs"

PARAM_FIELDS = (
    "c_ee", "c_ei", "c_ie", "c_ii", "tau_e", "tau_i", "a_e", "b_e",
    "a_i", "b_i", "theta_e", "theta_i", "c_e", "c_i", "r_e", "r_i",
    "k_e", "k_i", "alpha_e", "alpha_i", "speed", "dt",
    "stim_amplitude", "stim_duration_ms", "noise_amp", "seed",
)


def params_to_json(p: Params) -> dict:
    d = {k: getattr(p, k) for k in PARAM_FIELDS}
    d["G"] = p.G
    return d


def run_python(params: Params, duration_ms: float, events, e0=0.0, i0=0.0):
    weights, lengths = load_connectivity(ASSET)
    sim = Simulator(weights, lengths, params, e0=e0, i0=i0)
    return sim.run(duration_ms, events=events)


def run_rust(params: Params, duration_ms: float, events, e0=0.0, i0=0.0, tag="x"):
    scen = {
        "duration_ms": duration_ms,
        "params": params_to_json(params),
        "events": [
            {"node": e.node, "start_ms": e.start_ms, "duration_ms": e.duration_ms, "amplitude": e.amplitude}
            for e in events
        ],
        "e0": e0,
        "i0": i0,
    }
    scen_path = OUT / f"scenario_{tag}.json"
    out_path = OUT / f"rust_{tag}.json"
    scen_path.write_text(json.dumps(scen), encoding="utf-8")
    import os
    env = dict(os.environ)
    env["PATH"] = os.path.expanduser("~/.cargo/bin") + ":" + env.get("PATH", "")
    res = subprocess.run(
        ["cargo", "run", "--release", "--quiet", "--bin", "brain-core-run", "--",
         "--connectivity", str(ASSET), "--scenario", str(scen_path), "--output", str(out_path)],
        cwd=CRATE, env=env, capture_output=True, text=True, timeout=600,
    )
    if res.returncode != 0:
        raise RuntimeError(f"rust run failed ({tag}): {res.stdout}\n{res.stderr}")
    data = json.loads(out_path.read_text(encoding="utf-8"))
    return {
        "t_ms": np.array(data["t_ms"]),
        "E": np.array(data["E"]),
        "I": np.array(data["I"]),
        "P": np.array(data["P"]),
    }


SCENARIOS = [
    ("default_demo", Params.demo(), 5000.0,
     [StimulusEvent(40, 1000.0, 100.0, 2.0)], 0.0, 0.0),
    ("a_set_g0", Params(G=0.0), 5000.0,
     [StimulusEvent(40, 1000.0, 100.0, 2.0)], 0.0, 0.0),
    ("noise_seed42", Params(theta_e=1.0, noise_amp=0.05, seed=42), 2000.0,
     [StimulusEvent(40, 1000.0, 100.0, 2.0)], 0.0, 0.0),
    ("nonzero_ic", Params.demo(), 2000.0,
     [StimulusEvent(40, 1000.0, 100.0, 2.0)], 0.5, 0.3),
    ("dt05", Params(theta_e=1.0, dt=0.5), 2000.0,
     [StimulusEvent(40, 1000.0, 100.0, 2.0)], 0.0, 0.0),
    ("dt2", Params(theta_e=1.0, dt=2.0), 2000.0,
     [StimulusEvent(40, 1000.0, 100.0, 2.0)], 0.0, 0.0),
]


def main():
    OUT.mkdir(exist_ok=True)
    results = {}
    for tag, params, duration, events, e0, i0 in SCENARIOS:
        py = run_python(params, duration, events, e0, i0)
        rs = run_rust(params, duration, events, e0, i0, tag)
        assert np.array_equal(py.t_ms, rs["t_ms"]), f"{tag}: time grids differ"
        dE = np.abs(py.E - rs["E"])
        dI = np.abs(py.I - rs["I"])
        dP = np.abs(py.P - rs["P"])
        row = {
            "steps": int(len(py.t_ms) - 1),
            "max_abs_dE": float(dE.max()),
            "rms_dE": float(np.sqrt((dE ** 2).mean())),
            "max_abs_dI": float(dI.max()),
            "rms_dI": float(np.sqrt((dI ** 2).mean())),
            "max_abs_dP": float(dP.max()),
        }
        results[tag] = row
        print(
            f"{tag:<14} steps={row['steps']:<5} max|dE|={row['max_abs_dE']:.3e} "
            f"rms_dE={row['rms_dE']:.3e} max|dI|={row['max_abs_dI']:.3e} "
            f"rms_dI={row['rms_dI']:.3e} max|dP|={row['max_abs_dP']:.3e}"
        )
    (OUT / "compare.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print("wrote", OUT / "compare.json")


if __name__ == "__main__":
    main()
