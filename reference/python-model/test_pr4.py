"""PR4 Python tests: OU determinism + Rust/Python bit-agreement, snapshot
round-trip, 60 s no-lock on the REAL network, oscillatory preset FFT.

Run: python3 -m unittest test_pr4  (from reference/python-model/)
The Rust/Python cross-checks shell out to `cargo run --release --bin
brain-core-run` (same pattern as compare.py); they take ~1 min.
"""
import json
import math
import os
import subprocess
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import (
    BG_OSCILLATORY,
    BG_QUIET,
    BG_SPONTANEOUS,
    Params,
    Simulator,
    SplitMix64,
    StimulusEvent,
    load_connectivity,
)

ROOT = Path(__file__).resolve().parents[2]
ASSET = ROOT / "app/public/brain-assets/connectivity.json"
CRATE = ROOT / "crates/brain-core"
OUT = Path(__file__).parent / "outputs"

PARAM_FIELDS = (
    "c_ee", "c_ei", "c_ie", "c_ii", "tau_e", "tau_i", "a_e", "b_e",
    "a_i", "b_i", "theta_e", "theta_i", "c_e", "c_i", "r_e", "r_i",
    "k_e", "k_i", "alpha_e", "alpha_i", "speed", "dt",
    "stim_amplitude", "stim_duration_ms", "noise_amp", "seed",
    "ou_tau_ms", "ou_sigma", "drive_const",
    "ext_sine_amp", "ext_sine_freq_hz",
)
BG_NAMES = {BG_QUIET: "Quiet", BG_SPONTANEOUS: "Spontaneous",
            BG_OSCILLATORY: "Oscillatory"}


def params_to_json(p: Params) -> dict:
    d = {k: getattr(p, k) for k in PARAM_FIELDS}
    d["G"] = p.G
    d["bg_mode"] = BG_NAMES[p.bg_mode]
    return d


def run_rust(params: Params, duration_ms: float, events, tag: str):
    scen = {
        "duration_ms": duration_ms,
        "params": params_to_json(params),
        "events": [
            {"node": e.node, "start_ms": e.start_ms,
             "duration_ms": e.duration_ms, "amplitude": e.amplitude}
            for e in events
        ],
        "e0": 0.0,
        "i0": 0.0,
    }
    OUT.mkdir(exist_ok=True)
    scen_path = OUT / f"scenario_pr4_{tag}.json"
    out_path = OUT / f"rust_pr4_{tag}.json"
    scen_path.write_text(json.dumps(scen), encoding="utf-8")
    env = dict(os.environ)
    env["PATH"] = os.path.expanduser("~/.cargo/bin") + ":" + env.get("PATH", "")
    res = subprocess.run(
        ["cargo", "run", "--release", "--quiet", "--bin", "brain-core-run", "--",
         "--connectivity", str(ASSET), "--scenario", str(scen_path),
         "--output", str(out_path)],
        cwd=CRATE, env=env, capture_output=True, text=True, timeout=600,
    )
    if res.returncode != 0:
        raise RuntimeError(f"rust run failed ({tag}): {res.stdout}\n{res.stderr}")
    data = json.loads(out_path.read_text(encoding="utf-8"))
    return {"E": np.array(data["E"]), "I": np.array(data["I"]),
            "P": np.array(data["P"])}


def new_sim(params=None):
    w, lengths = load_connectivity(ASSET)
    return Simulator(w, lengths, params or Params.demo())


def fft_peak(x, dt_ms=1.0):
    x = np.asarray(x, dtype=np.float64)
    x = x - x.mean()
    n = len(x)
    spec = np.abs(np.fft.rfft(x * np.hanning(n)))
    freqs = np.fft.rfftfreq(n, d=dt_ms / 1000.0)
    spec[0] = 0.0
    return float(freqs[int(np.argmax(spec))])


class TestPR4OU(unittest.TestCase):
    def test_ou_deterministic_same_seed_differs_across_seeds(self):
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS})
        sim = new_sim(p)
        r1 = sim.run(2000.0)
        sim.reset()
        r2 = sim.run(2000.0)
        np.testing.assert_array_equal(r1.E, r2.E)
        np.testing.assert_array_equal(r1.P, r2.P)
        self.assertTrue(np.any(sim.ou != 0.0), "OU state stayed zero")
        sim.reseed(1)
        sim.reset()
        r3 = sim.run(2000.0)
        self.assertFalse(np.array_equal(r1.E, r3.E),
                         "different seed gave an identical trajectory")

    def test_ou_single_update_per_step(self):
        # One Euler–Maruyama update driven by the FIRST Gaussian draw.
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS})
        sim = Simulator(np.array([[0.0]]), np.array([[0.0]]), p)
        sim._ou_step()
        rng = SplitMix64(0)
        g0 = rng.next_gaussian()
        expected = p.ou_sigma * math.sqrt(2.0 * p.dt / p.ou_tau_ms) * g0
        self.assertAlmostEqual(sim.ou[0], expected, places=15)

    def test_ou_rust_python_bit_agreement(self):
        # Spontaneous + white noise on: the OU draws and the noise draws
        # share one RNG, so the draw ORDER is part of the agreement.
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                      "noise_amp": 0.1, "seed": 7})
        sim = new_sim(p)
        py = sim.run(2000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)])
        rs = run_rust(p, 2000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)],
                      "ou_noise")
        self.assertLess(np.abs(py.E - rs["E"]).max(), 1e-12)
        self.assertLess(np.abs(py.P - rs["P"]).max(), 1e-12)

    def test_sine_rust_python_bit_agreement(self):
        p = Params.oscillatory()
        sim = new_sim(p)
        py = sim.run(2000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)])
        rs = run_rust(p, 2000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)],
                      "sine")
        self.assertLess(np.abs(py.E - rs["E"]).max(), 1e-12)
        self.assertLess(np.abs(py.P - rs["P"]).max(), 1e-12)


class TestPR4Snapshot(unittest.TestCase):
    def test_snapshot_roundtrip_exact(self):
        sim = new_sim()
        sim.set_weight(54, 73, 0.5)
        sim.set_bias(40, 0.3)
        sim.run(1500.0)
        snap = sim.take_snapshot()
        snap_E = sim.E.copy()
        cont = sim.run(500.0)
        cont_E = cont.E[-1].copy()
        # Disturb everything, then restore.
        sim.set_weight(54, 73, 2.5)
        sim.set_bias(40, -0.8)
        sim.run(100.0)
        sim.restore_snapshot(snap)
        np.testing.assert_array_equal(sim.E, snap_E)
        self.assertEqual(sim.weight(54, 73), 0.5)
        self.assertEqual(sim.bias_value(40), 0.3)
        after = sim.run(500.0)
        np.testing.assert_array_equal(after.E[-1], cont_E)
        np.testing.assert_array_equal(after.E, cont.E)

    def test_snapshot_roundtrip_with_ou_and_noise(self):
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS,
                      "noise_amp": 0.1, "seed": 3})
        sim = new_sim(p)
        sim.run(1500.0)
        snap = sim.take_snapshot()
        cont = sim.run(500.0)
        sim.restore_snapshot(snap)
        after = sim.run(500.0)
        np.testing.assert_array_equal(after.E, cont.E)
        np.testing.assert_array_equal(after.P, cont.P)


class TestPR4LongRun(unittest.TestCase):
    def test_spontaneous_60s_no_lock_real_network(self):
        # Default Spontaneous parameters, 60 s of simulation time on the
        # REAL 76-node network: far from the 0.15 lock threshold, finite,
        # and visibly active (median node E std > 0.0015; measured 0.0021
        # at sigma 0.10, 0.0010 at sigma 0.05, 0.0 in Quiet).
        p = Params(**{**Params.demo().__dict__, "bg_mode": BG_SPONTANEOUS})
        sim = new_sim(p)
        r = sim.run(60000.0, snapshot_every=10)
        mean_e = r.E.mean(axis=1)
        self.assertTrue(np.all(np.isfinite(r.E)))
        self.assertLess(float(mean_e.max()), 0.15,
                        f"max mean E {float(mean_e.max()):.4f} approached lock")
        tail = r.E[int(50000 // 10):]
        node_std = tail.std(axis=0)
        self.assertGreater(float(np.median(node_std)), 0.0015,
                           f"median node E std {float(np.median(node_std)):.5f} invisible")

    def test_quiet_stays_at_baseline(self):
        sim = new_sim()
        r = sim.run(10000.0, snapshot_every=10)
        mean_e = r.E.mean(axis=1)
        self.assertLess(float(mean_e.max()), 0.02)
        self.assertLess(float(mean_e[int(6000 // 10):].std()), 1e-9)

    def test_oscillatory_preset_fft(self):
        p = Params.oscillatory()
        sim = new_sim(p)
        r = sim.run(8000.0, snapshot_every=5)
        mean_e = r.E.mean(axis=1)
        tail = mean_e[int(4000 // 5):]
        f = fft_peak(tail, dt_ms=5.0)
        self.assertAlmostEqual(f, 10.0, delta=0.5)
        ptp = float(tail.max() - tail.min())
        self.assertGreater(ptp, 0.005)
        self.assertLess(ptp, 0.03)
        self.assertLess(float(mean_e.max()), 0.05)
        # Pulse on top still gives its full transient response.
        sim2 = new_sim(p)
        r0 = sim2.run(4000.0)
        base = r0.E.mean(axis=0)
        r2 = sim2.run(4000.0, [StimulusEvent(40, 1000.0, 100.0, 2.0)])
        peak = float(np.abs(r2.E - base[None, :]).max(axis=0)[40])
        self.assertGreater(peak, 0.4)


if __name__ == "__main__":
    unittest.main()
