"""Unit tests for the Python Wilson-Cowan reference implementation.

Run:  python3 -m unittest test_wilson_cowan -v
from reference/python-model/ (stdlib unittest only; numpy required).
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import (
    DivergenceError,
    Params,
    Simulator,
    SplitMix64,
    StimulusEvent,
    build_idelays,
    load_connectivity,
)

ASSET = Path(__file__).resolve().parents[2] / "app/public/brain-assets/connectivity.json"


class TestIdelays(unittest.TestCase):
    def test_tvb_rule_round_half_to_even(self):
        # TVB set_idelays: rint(delays / dt).  rint is round-half-to-even.
        lengths = np.array([[0.0, 7.5], [7.5, 0.0]])
        weights = np.array([[0.0, 1.0], [1.0, 0.0]])
        # delay = 7.5/3 = 2.5 ms; dt=1 -> rint(2.5) = 2 (ties to even).
        got = build_idelays(lengths, weights, dt=1.0, speed=3.0)
        self.assertEqual(got[0, 1], 2)
        self.assertEqual(got[1, 0], 2)
        # dt=0.5 -> 2.5/0.5 = 5.0 -> 5.
        got = build_idelays(lengths, weights, dt=0.5, speed=3.0)
        self.assertEqual(got[0, 1], 5)
        # Zero-weight edges get idelay 0 even if a length is present.
        got = build_idelays(np.array([[0.0, 90.0], [90.0, 0.0]]),
                            np.array([[0.0, 0.0], [0.0, 0.0]]), dt=1.0, speed=3.0)
        self.assertTrue(np.all(got == 0))

    def test_real_data_idelay_range(self):
        weights, lengths = load_connectivity(ASSET)
        idelays = build_idelays(lengths, weights, dt=1.0, speed=3.0)
        self.assertEqual(idelays.shape, (76, 76))
        self.assertEqual(idelays.min(), 0)  # diagonal / zero-weight edges
        nz = idelays[weights > 0]
        self.assertEqual(nz.min(), 2)   # min real delay 1.64 ms -> 2 steps
        self.assertEqual(nz.max(), 46)  # max real delay 46.15 ms -> 46 steps


class TestSingleNode(unittest.TestCase):
    def setUp(self):
        self.sim = Simulator(np.array([[0.0]]), np.array([[0.0]]), Params())

    def test_settles_to_low_fixed_point(self):
        r = self.sim.run(2000.0)
        self.assertAlmostEqual(r.E[-1, 0], 0.0730, places=3)
        self.assertAlmostEqual(r.I[-1, 0], 0.0314, places=3)

    def test_small_pulse_returns(self):
        r = self.sim.run(2000.0, events=[StimulusEvent(0, 1000.0, 100.0, 0.05)])
        self.assertAlmostEqual(r.E[-1, 0], 0.0730, places=3)

    def test_determinism(self):
        r1 = self.sim.run(500.0, events=[StimulusEvent(0, 100.0, 100.0, 2.0)])
        self.sim.reset()
        r2 = self.sim.run(500.0, events=[StimulusEvent(0, 100.0, 100.0, 2.0)])
        np.testing.assert_array_equal(r1.E, r2.E)
        np.testing.assert_array_equal(r1.I, r2.I)

    def test_reset_restores_initial_state(self):
        self.sim.run(500.0)
        self.sim.reset()
        self.assertEqual(self.sim.step_count, 0)
        np.testing.assert_array_equal(self.sim.E, np.zeros(1))
        np.testing.assert_array_equal(self.sim.I, np.zeros(1))


class TestNetwork(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.weights, cls.lengths = load_connectivity(ASSET)

    def test_g_zero_isolation(self):
        """G=0: stimulating one node leaves the other 75 exactly at baseline."""
        sim = Simulator(self.weights, self.lengths, Params(G=0.0))
        base = sim.run(2000.0)
        sim.reset()
        stim = sim.run(2000.0, events=[StimulusEvent(40, 1000.0, 100.0, 2.0)])
        others = np.delete(stim.E, 40, axis=1)
        others_base = np.delete(base.E, 40, axis=1)
        np.testing.assert_array_equal(others, others_base)
        self.assertGreater(float(np.abs(stim.E[:, 40] - base.E[:, 40]).max()), 0.1)

    def test_demo_preset_returns_to_baseline(self):
        sim = Simulator(self.weights, self.lengths, Params.demo())
        r = sim.run(5000.0, events=[StimulusEvent(40, 1000.0, 100.0, 2.0)])
        t = r.t_ms
        pre = float(r.E[(t >= 500) & (t < 1000)].mean())
        post = float(r.E[(t >= 4000)].mean())
        self.assertAlmostEqual(pre, post, delta=0.005)
        self.assertGreater(float(np.abs(r.E[(t >= 1000) & (t < 2000), 40] - pre).max()), 0.1)

    def test_noise_seed_determinism(self):
        events = [StimulusEvent(40, 1000.0, 100.0, 2.0)]
        sim = Simulator(self.weights, self.lengths, Params(theta_e=1.0, noise_amp=0.05, seed=42))
        r1 = sim.run(2000.0, events=events)
        sim.reset()
        r2 = sim.run(2000.0, events=events)
        np.testing.assert_array_equal(r1.E, r2.E)
        # ... and a different seed gives a different trajectory.
        sim3 = Simulator(self.weights, self.lengths, Params(theta_e=1.0, noise_amp=0.05, seed=43))
        r3 = sim3.run(2000.0, events=events)
        self.assertFalse(np.array_equal(r1.E, r3.E))

    def test_no_nan_or_inf_in_hard_conditions(self):
        # Extreme stimulus and coupling must not silently produce NaN/Inf:
        # either it stays finite or DivergenceError is raised.
        for kwargs in ({"stim_amplitude": 20.0},):
            sim = Simulator(self.weights, self.lengths, Params.demo())
            try:
                r = sim.run(2000.0, events=[StimulusEvent(40, 500.0, 100.0, kwargs["stim_amplitude"])])
            except DivergenceError:
                continue
            self.assertTrue(np.all(np.isfinite(r.E)) and np.all(np.isfinite(r.I)))


class TestRng(unittest.TestCase):
    def test_splitmix_first_values(self):
        # Reference values from the SplitMix64 definition (seed 0).
        rng = SplitMix64(0)
        self.assertEqual(rng.next_u64(), 0xE220A8397B1DCDAF)
        rng = SplitMix64(0)
        u = rng.next_f64()
        self.assertGreaterEqual(u, 0.0)
        self.assertLess(u, 1.0)


if __name__ == "__main__":
    unittest.main()
