"""PR3 unit tests for the Python Wilson-Cowan reference implementation.

Mirrors the PR3 tests in crates/brain-core/src/lib.rs (same scenarios,
same thresholds, same measured numbers) so a semantic drift between the
two implementations shows up here.  Run:

    python3 -m unittest test_pr3 -v
from reference/python-model/ (stdlib unittest only; numpy required).
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
from wilson_cowan import Params, Simulator, StimulusEvent


def chain_sim(w10: float) -> Simulator:
    w = np.zeros((3, 3))
    w[1, 0] = w10
    w[2, 1] = 1.5
    lengths = np.zeros((3, 3))
    lengths[1, 0] = 30.0
    lengths[2, 1] = 30.0
    return Simulator(w, lengths, Params.demo())


def chain_peak_delta(w10: float) -> float:
    """Peak rise of node 1's E after t=500 ms vs its value at t=500 ms,
    for a 100 ms pulse on node 0 (amplitude 2.0)."""
    ev = [StimulusEvent(node=0, start_ms=500.0, duration_ms=100.0, amplitude=2.0)]
    sim = chain_sim(w10)
    r = sim.run(1500.0, ev)
    return float(np.max(r.E[500:, 1] - r.E[500, 1]))


class TestSetWeight(unittest.TestCase):
    def test_single_sided_and_clamped(self):
        w = np.array([[0.0, 1.0], [2.0, 0.0]])
        lengths = np.array([[0.0, 10.0], [10.0, 0.0]])
        sim = Simulator(w, lengths, Params.demo())
        # Clamp above the range; opposite side untouched (single-sided).
        self.assertEqual(sim.set_weight(0, 1, 5.0), 3.0)
        self.assertEqual(sim.weight(0, 1), 3.0)
        self.assertEqual(sim.weight(1, 0), 2.0)
        self.assertEqual(sim.original_weight(0, 1), 1.0)
        # Clamp below the range.
        self.assertEqual(sim.set_weight(0, 1, -2.0), 0.0)
        # Diagonal and out-of-range indices are rejected, never crash.
        with self.assertRaises(ValueError):
            sim.set_weight(0, 0, 1.0)
        with self.assertRaises(ValueError):
            sim.set_weight(0, 2, 1.0)
        self.assertEqual(sim.weight(0, 0), 0.0)
        # Restore one edge / all edges.
        self.assertEqual(sim.reset_weight(0, 1), 1.0)
        sim.set_weight(1, 0, 0.5)
        sim.reset_all_weights()
        self.assertEqual(sim.weight(0, 1), 1.0)
        self.assertEqual(sim.weight(1, 0), 2.0)

    def test_zero_kills_downstream_double_enhances(self):
        peak_base = chain_peak_delta(1.0)
        self.assertGreater(peak_base, 0.002, f"baseline peak too small: {peak_base}")
        # Zero the only edge into node 1: response must vanish exactly
        # (node 1 then has no inputs at all).
        sim = chain_sim(1.0)
        sim.set_weight(1, 0, 0.0)
        ev = [StimulusEvent(node=0, start_ms=500.0, duration_ms=100.0, amplitude=2.0)]
        r = sim.run(1500.0, ev)
        peak_zero = float(np.max(np.abs(r.E[500:, 1] - r.E[500, 1])))
        self.assertEqual(peak_zero, 0.0, f"zeroed edge still responds: {peak_zero}")
        # Double the edge: downstream peak must grow clearly.
        peak_double = chain_peak_delta(2.0)
        self.assertGreater(
            peak_double, peak_base * 1.5,
            f"doubled edge did not enhance: base {peak_base}, doubled {peak_double}",
        )


class TestBias(unittest.TestCase):
    def test_raises_and_lowers_steady_e(self):
        # Demo preset single node: settled E* ≈ 0.011.
        sim = Simulator(np.zeros((1, 1)), np.zeros((1, 1)), Params.demo())
        r0 = sim.run(2000.0, [])
        e_base = float(r0.E[-1, 0])
        self.assertAlmostEqual(e_base, 0.011, delta=0.002)
        # Positive (excitatory) bias raises the steady state, and the
        # reported P actually carries the bias.
        sim.reset()
        self.assertEqual(sim.set_bias(0, 0.5), 0.5)
        r1 = sim.run(2000.0, [])
        e_pos = float(r1.E[-1, 0])
        self.assertGreater(e_pos, e_base + 0.005, f"{e_base} -> {e_pos}")
        self.assertAlmostEqual(float(r1.P[100, 0]), 0.5, places=12)
        # Negative (inhibitory) bias lowers it.
        sim.reset()
        self.assertEqual(sim.set_bias(0, -0.5), -0.5)
        r2 = sim.run(2000.0, [])
        e_neg = float(r2.E[-1, 0])
        self.assertLess(e_neg, e_base - 0.002, f"{e_base} -> {e_neg}")
        self.assertGreater(e_neg, 0.0)
        # Bias clamps to [−1, +1]; bad node rejected.
        self.assertEqual(sim.set_bias(0, 2.0), 1.0)
        self.assertEqual(sim.set_bias(0, -2.0), -1.0)
        with self.assertRaises(ValueError):
            sim.set_bias(1, 0.5)
        # Clearing the bias restores the un-biased trajectory exactly.
        sim.reset()  # reset() also clears bias (PR3 semantics)
        self.assertEqual(sim.bias_value(0), 0.0)
        r3 = sim.run(2000.0, [])
        np.testing.assert_array_equal(r3.E, r0.E)
        np.testing.assert_array_equal(r3.I, r0.I)

    def test_reset_preserves_weights_but_clears_bias(self):
        sim = chain_sim(1.0)
        sim.set_weight(1, 0, 0.0)
        sim.set_bias(0, 0.5)
        sim.run(100.0, [])
        sim.reset()
        self.assertEqual(sim.weight(1, 0), 0.0, "reset must NOT restore weights")
        self.assertEqual(sim.original_weight(1, 0), 1.0)
        self.assertEqual(sim.bias_value(0), 0.0, "reset must clear bias")
        self.assertEqual(sim.step_count, 0)
        np.testing.assert_array_equal(sim.E, np.zeros(3))
        sim.reset_all_weights()
        self.assertEqual(sim.weight(1, 0), 1.0)


if __name__ == "__main__":
    unittest.main()
