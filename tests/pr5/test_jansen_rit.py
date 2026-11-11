"""Independent scientific checks of the Jansen-Rit route (PR5).

Mirrors tests/pr5/test_sphere_model.py in style (unittest, run with
`python3 -m unittest tests.pr5.test_jansen_rit -v` from the repo root).
All numbers are recomputed here from scientific/forward/
jansen_rit_reference.py; the JSON fixture is only a cross-check target
for the TypeScript implementation, not the source of truth here.

What this pins down:
- the standard Jansen-Rit parameters (Jansen & Rit 1995),
- the low-branch resting fixed point at p0 = 90 1/s and its stability,
- the stimulus response (peak, latency, half-life, spectrum),
- the bistability that forces the low-branch choice (upper branch switches
  state instead of returning), and the ~10.5 Hz alpha limit cycle at the
  standard p0 = 220 1/s operating point,
- the JR-vs-WC comparison numbers under the shared protocol.
"""
import importlib.util
import json
from pathlib import Path
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
JR_SCRIPT = ROOT / "scientific/forward/jansen_rit_reference.py"
WC_SCRIPT = ROOT / "scientific/forward/local_column_scipy_reference.py"
JR_FIXTURE = ROOT / "tests/pr5/fixtures/jansen-rit-reference.json"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


jr = _load("pr5_jansen_rit_reference", JR_SCRIPT)


def _metrics(t_ms, q):
    peak_i = int(np.argmax(np.abs(q)))
    return {
        "peak_q": float(q[peak_i]),
        "latency_ms": float(t_ms[peak_i]),
        "half_life_ms": jr.half_life_ms(t_ms, q),
        "dom_freq_hz": jr.dominant_freq_hz(t_ms, q),
        "q_end": float(q[-1]),
    }


def _run_jr(p0, pulse, t_end=600.0, y_start=None):
    """DOP853 run of the JR equations; returns (t_ms, y0, y1, y2)."""
    from scipy.integrate import solve_ivp

    if y_start is None:
        base3 = jr.algebraic_fixed_point(p0, [0.01, 1.0, 0.5])
        y_start = np.array([base3[0], base3[1], base3[2], 0, 0, 0])
    pieces = [(0.0, 80.0, p0), (80.0, 120.0, p0 + pulse), (120.0, t_end, p0)]
    ts, ys = [0.0], [y_start.copy()]
    state = y_start.copy()
    for start, stop, p in pieces:
        sample = np.arange(start + 1, stop + 0.01, 1, dtype=float)
        res = solve_ivp(lambda t, y: jr.rates_ms(t, y, p), (start, stop), state,
                        method="DOP853", rtol=1e-11, atol=1e-13, t_eval=sample)
        assert res.success, res.message
        ts.extend(res.t.tolist())
        ys.extend(res.y.T.tolist())
        state = res.y[:, -1]
    arr = np.array(ys)
    return np.array(ts), arr[:, 0], arr[:, 1], arr[:, 2]


class JansenRitReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ref = jr.make_reference()
        cls.t = np.array([s["t_ms"] for s in cls.ref["samples"]])
        cls.q = np.array([s["q_nAm"] for s in cls.ref["samples"]])
        cls.m = cls.ref["metrics"]
        wc = _load("pr5_local_column_reference", WC_SCRIPT)
        wc_ref = wc.make_reference()
        cls.wc_t = np.array([s["t_ms"] for s in wc_ref["samples"]])
        cls.wc_q = np.array([s["q_nAm"] for s in wc_ref["samples"]])
        cls.wc_m = _metrics(cls.wc_t, cls.wc_q)

    def test_standard_parameters_are_jansen_rit_1995(self):
        self.assertEqual(jr.A_MV, 3.25)
        self.assertEqual(jr.B_MV, 22.0)
        self.assertEqual(jr.A_RATE, 100.0)
        self.assertEqual(jr.B_RATE, 50.0)
        self.assertEqual((jr.C1, jr.C2, jr.C3, jr.C4), (135.0, 108.0, 33.75, 33.75))
        self.assertEqual((jr.E0, jr.V0_MV, jr.R_PER_MV), (2.5, 6.0, 0.56))

    def test_low_branch_resting_fixed_point(self):
        base = jr.algebraic_fixed_point(90.0, [0.01, 1.0, 0.5])
        self.assertAlmostEqual(base[0], 0.01006, places=4)
        self.assertAlmostEqual(base[1], 4.1387, places=3)
        self.assertAlmostEqual(base[2], 2.9933, places=3)
        y6 = np.array([base[0], base[1], base[2], 0, 0, 0])
        self.assertLess(np.max(np.abs(jr.rates_ms(0.0, y6, 90.0))), 1e-11)

    def test_stimulus_response_metrics(self):
        self.assertAlmostEqual(self.m["peak_q_nAm"], 1.032, delta=0.01)
        self.assertAlmostEqual(self.m["peak_latency_ms"], 176.0, delta=4.0)
        self.assertAlmostEqual(self.m["half_life_ms"], 32.0, delta=4.0)
        # Single transient: spectrum peaks at the lowest resolvable bin
        # (2.07 Hz for the 480 ms window), not at an oscillation.
        self.assertAlmostEqual(self.m["dominant_freq_hz"], 2.07, delta=0.5)
        self.assertLess(abs(self.m["q_at_600ms_nAm"]), 1e-3)

    def test_fixture_matches_recomputed_reference(self):
        saved = json.loads(JR_FIXTURE.read_text())
        self.assertAlmostEqual(saved["metrics"]["peak_q_nAm"],
                               self.m["peak_q_nAm"], places=9)
        self.assertEqual(len(saved["samples"]), len(self.ref["samples"]))

    def test_dose_response_is_steep_then_saturating(self):
        # Documented nonlinearity: the response jumps ~9x between a 60 and
        # a 120 1/s pulse (sigmoid recruitment of the excitatory loop),
        # then saturates; it always returns to baseline.
        peaks = {}
        for pulse in (30.0, 60.0, 120.0, 180.0):
            t, y0, _, _ = _run_jr(90.0, pulse)
            peaks[pulse] = float(np.max(y0 - y0[0]))
            self.assertLess(abs(y0[-1] - y0[0]), 1e-3)
        self.assertLess(peaks[60.0], 0.03)
        self.assertGreater(peaks[120.0], 0.10)
        self.assertLess(peaks[120.0], 0.16)
        self.assertLess(abs(peaks[180.0] - peaks[120.0]), 0.01)

    def test_upper_branch_switches_state_instead_of_returning(self):
        # At p0 = 90 the UPPER fixed point (y0 ~ 0.098 mV) is only
        # marginally stable: the same 120 1/s pulse kicks the system onto
        # the low branch (y0 ~ 0.010 mV) permanently. That is why the
        # comparison protocol uses the low branch.
        upper = jr.algebraic_fixed_point(90.0, [0.1, 5.0, 2.0])
        y_start = np.array([upper[0], upper[1], upper[2], 0, 0, 0])
        t, y0, _, _ = _run_jr(90.0, 120.0, y_start=y_start)
        low = jr.algebraic_fixed_point(90.0, [0.01, 1.0, 0.5])
        self.assertLess(abs(y0[-1] - low[0]), 0.005)
        self.assertLess(y0[-1] - upper[0], -0.05)

    def test_standard_operating_point_is_an_alpha_limit_cycle(self):
        # p0 = 220 1/s (Jansen & Rit 1995): the fixed point is unstable and
        # the system settles into a ~10.5 Hz limit cycle -- the model's
        # signature alpha rhythm, not a resting fixed point.
        upper = jr.algebraic_fixed_point(220.0, [0.1, 5.0, 2.0])
        y_start = np.array([upper[0], upper[1], upper[2], 0, 0, 0])
        y_start[0] += 0.05
        t, y0, _, _ = _run_jr(220.0, 0.0, t_end=5000.0, y_start=y_start)
        tail = y0[t >= 3000.0]
        self.assertGreater(float(np.std(tail)), 0.005)
        seg = tail - np.mean(tail)
        spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
        freqs = np.fft.rfftfreq(len(seg), d=0.001)
        dom = float(freqs[int(np.argmax(spec[1:])) + 1])
        self.assertGreaterEqual(dom, 9.0)
        self.assertLessEqual(dom, 12.0)

    def test_jr_vs_wc_comparison_ranges(self):
        ratio = self.m["peak_q_nAm"] / self.wc_m["peak_q"]
        self.assertGreater(ratio, 0.15)
        self.assertLess(ratio, 0.35)
        latency_diff = self.m["peak_latency_ms"] - self.wc_m["latency_ms"]
        self.assertGreaterEqual(latency_diff, 50.0)
        self.assertLessEqual(latency_diff, 85.0)
        self.assertGreater(self.m["half_life_ms"], self.wc_m["half_life_ms"])
        self.assertGreaterEqual(self.m["half_life_ms"], 22.0)
        self.assertLessEqual(self.m["half_life_ms"], 45.0)
        self.assertGreaterEqual(self.wc_m["half_life_ms"], 12.0)
        self.assertLessEqual(self.wc_m["half_life_ms"], 30.0)


if __name__ == "__main__":
    unittest.main()
