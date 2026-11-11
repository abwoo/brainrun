"""PR-13 细胞级模型 — Python 测试。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr7 -p 'test_*.py' -v
NEURON 交叉验证需 ~/workspace/neuron-venv/bin/python（装有 neuron 9.0.2）；
在 eeg-venv 下跑时 NEURON 部分跳过（skip），其余全部照常。

两层验证：
1. Python 对照实现（reference/python-model/cellular_reference.py）自身
   的性质：LIF f-I 与解析率、HH 静息/锋电位/阈值/不应期、被动稳态
   与线性方程解、突触核峰值、跨尺度映射数、幅度实验数。
2. Fixture 新鲜度：重新生成 tests/pr7/fixtures/cellular-reference.json，
   与存量逐值比较（TS 测试读的就是这份 fixture，过期即失败）。
   DOP853 是确定性积分器，同版本同输入下重算一致；容差取相对 1e-9 /
   绝对 1e-9（远严于任何物理量级，只防跨环境浮点末位漂移）。
   NEURON 比较只在 neuron 包可导入时重跑并比对（锋电位时间差 < 0.1 ms、
   锋外最大差 < 0.1 mV）；否则跳过，不谎称已验证。
"""
import importlib.util
import json
import math
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REF_PATH = ROOT / "reference" / "python-model" / "cellular_reference.py"
FIXTURE_PATH = ROOT / "tests" / "pr7" / "fixtures" / "cellular-reference.json"

_spec = importlib.util.spec_from_file_location("cellular_reference", REF_PATH)
cr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(cr)

FIXTURE = json.loads(FIXTURE_PATH.read_text())
M = FIXTURE["metrics"]
P = FIXTURE["parameters"]


def assert_close(test, a, b, rtol, atol, label):
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    test.assertEqual(a.shape, b.shape, f"{label}: shape {a.shape} vs {b.shape}")
    err = np.abs(a - b)
    tol = atol + rtol * np.abs(b)
    test.assertTrue(np.all(err <= tol),
                    f"{label}: max err {err.max():.3e} at "
                    f"{np.unravel_index(int(np.argmax(err)), err.shape)}")


class TestLif(unittest.TestCase):
    def test_rest_and_rheobase(self):
        rest = cr.simulate_lif(lambda _t: 0.0, 100.0)
        self.assertEqual(rest["spike_times_ms"], [])
        self.assertAlmostEqual(rest["v_mv"][-1], -65.0, places=12)
        self.assertAlmostEqual(cr.LIF_GLEAK_NS * (cr.LIF_VTH_MV - cr.LIF_EL_MV),
                               375.0, places=9)

    def test_fi_curve_matches_analytic(self):
        fi = cr.lif_fi_curve([0.0, 200.0, 300.0, 375.0, 400.0, 500.0, 600.0,
                              800.0, 1000.0, 1500.0, 2000.0])
        for row in fi:
            if row["analytic_hz"] == 0.0:
                self.assertEqual(row["sim_hz"], 0.0, f'I={row["i_pa"]} pA')
            else:
                rel = abs(row["sim_hz"] - row["analytic_hz"]) / row["analytic_hz"]
                self.assertLessEqual(rel, 0.02, f'I={row["i_pa"]} pA: {row}')
        row600 = fi[6]
        self.assertAlmostEqual(row600["sim_hz"], 84.4444, places=2)
        self.assertAlmostEqual(row600["analytic_hz"], 84.6862, places=2)


class TestHodgkinHuxley(unittest.TestCase):
    def test_resting_potential(self):
        rest = cr.simulate_hh(lambda _t: 0.0, 200.0)
        # True fixed point is -64.9964 mV (HH leak battery -54.387 mV is
        # balanced by the Na window current); -65 mV is the reference
        # point, not the exact fixed point.
        self.assertAlmostEqual(rest["v_mv"][-1], -64.996379, places=5)
        self.assertEqual(rest["spike_times_ms"], [])
        m0, h0, n0 = cr.hh_steady_gating(0.0)
        self.assertAlmostEqual(m0, 0.052932, places=6)
        self.assertAlmostEqual(h0, 0.596121, places=6)
        self.assertAlmostEqual(n0, 0.317677, places=6)

    def test_action_potential_shape(self):
        hh = cr.simulate_hh(lambda t: 10.0 if 10.0 <= t < 60.0 else 0.0, 100.0)
        met = cr.hh_ap_metrics(hh)
        self.assertAlmostEqual(met["peak_mv"], 39.774, places=2)
        self.assertAlmostEqual(met["half_width_ms"], 1.485, places=2)
        self.assertEqual(met["n_spikes"], 4)
        self.assertAlmostEqual(met["peak_latency_ms"], 12.1, places=1)

    def test_threshold_and_refractory(self):
        self.assertAlmostEqual(M["hh_threshold_1ms_pulse_ua_per_cm2"], 6.934,
                               places=2)
        sub = cr.simulate_hh(lambda _t: 5.0, 300.0, dt_out_ms=0.1)
        self.assertEqual(len(sub["spike_times_ms"]), 1)
        self.assertTrue(all(s < 100.0 for s in sub["spike_times_ms"]))
        sup = cr.simulate_hh(lambda _t: 12.0, 300.0, dt_out_ms=0.1)
        self.assertGreaterEqual(len(sup["spike_times_ms"]), 15)
        self.assertEqual(M["hh_refractory_two_pulse"]["gap_3.0ms"], 1)
        self.assertEqual(M["hh_refractory_two_pulse"]["gap_15.0ms"], 2)

    def test_dop853_self_error_floor(self):
        # Tightening rtol 1e-12 -> 1e-13 moves V by only 6.8e-9 mV: the
        # DOP853 error floor is far below every test tolerance used here.
        self.assertLess(M["hh_dop853_self_error_mv"], 1e-7)


class TestSynapse(unittest.TestCase):
    def test_kernel_peaks_and_signs(self):
        self.assertAlmostEqual(
            cr.synapse_conductance_ns("ampa", 1.0, 12.0, [10.0], "alpha"),
            1.0, places=12)
        self.assertAlmostEqual(
            cr.synapse_conductance_ns("gaba", 1.0, 18.0, [10.0], "alpha"),
            1.0, places=12)
        self.assertAlmostEqual(
            cr.synapse_conductance_ns("ampa", 1.0, 12.0, [10.0], "exponential"),
            math.exp(-1.0), places=12)
        self.assertAlmostEqual(cr.synapse_current_pa(1.0, -65.0, 0.0), -65.0)
        self.assertAlmostEqual(cr.synapse_current_pa(1.0, -65.0, -75.0), 10.0)


class TestMulticompartment(unittest.TestCase):
    def test_morphology_derivation(self):
        d = cr.derive_multicomp_morphology()
        self.assertAlmostEqual(d["c_soma_pf"], 12.566371, places=3)
        self.assertAlmostEqual(d["g_axial_apical_ns"], 31.384542, places=3)
        self.assertAlmostEqual(d["g_axial_basal_ns"], 62.70644, places=3)
        self.assertAlmostEqual(d["g_na_soma_ns"], 1507.964474, places=3)
        self.assertAlmostEqual(cr.cable_length_constant_um(), 408.248, places=2)

    def test_passive_steady_state_matches_linear_solve(self):
        mc = cr.simulate_multicomp(lambda _t: 0.0,
                                   lambda t: 300.0 if 100.0 <= t < 600.0 else 0.0,
                                   lambda _t: 0.0, 600.0, soma_active=False)
        mask = mc["t_ms"] >= 550.0
        exact = cr.passive_steady_state(300.0)
        for key, j in (("v_soma_mv", 0), ("v_apical_mv", 1), ("v_basal_mv", 2)):
            self.assertAlmostEqual(float(np.mean(mc[key][mask])), exact[j],
                                   places=6)
        # Depolarisation attenuation 0.8486: between the infinite-cable
        # value exp(-200/408) = 0.613 (sealed end reflects) and 1.
        att = M["multicomp_passive_attenuation_soma_over_apical"]
        self.assertGreater(att, math.exp(-200.0 / cr.cable_length_constant_um()))
        self.assertLess(att, 1.0)
        self.assertAlmostEqual(att, 0.848589, places=4)

    def test_active_ap_and_backpropagation(self):
        mc = cr.simulate_multicomp(lambda t: 1000.0 if 10.0 <= t < 12.0 else 0.0,
                                   lambda _t: 0.0, lambda _t: 0.0, 60.0,
                                   dt_out_ms=0.05)
        self.assertEqual(len(mc["spike_times_ms"]), 1)
        met = cr.hh_ap_metrics({"t_ms": mc["t_ms"], "v_mv": mc["v_soma_mv"],
                                "spike_times_ms": mc["spike_times_ms"]})
        self.assertAlmostEqual(met["peak_mv"], 37.398, places=2)
        self.assertLess(float(np.max(mc["v_apical_mv"])),
                        float(np.max(mc["v_soma_mv"])))


class TestCrossScaleAndAmplitude(unittest.TestCase):
    def test_coupling_maps(self):
        self.assertAlmostEqual(cr.wc_to_lif_current_pa(0.5), 489.0, places=9)
        self.assertAlmostEqual(cr.wc_to_lif_current_pa(0.1), 89.0, places=9)
        self.assertAlmostEqual(cr.wc_to_hh_current_density_ua_per_cm2(0.5),
                               9.78, places=9)
        self.assertAlmostEqual(cr.firing_rate_to_population_drive_p(60.0),
                               0.12, places=12)
        self.assertAlmostEqual(cr.cellular_dipole_nam(1608.0318, 0.11),
                               1.76883498e-4, places=12)
        self.assertAlmostEqual(cr.implied_scalp_uv(55.5625), 8.89, places=9)

    def test_amplitude_gap_numbers(self):
        amp = M["amplitude_experiment"]
        # Sustained PSP route: |Pz| < 0.1 uV, >100x short of true 8.89 uV.
        self.assertLess(abs(amp["sustained_psp"]["pz_uv"]), 0.1)
        self.assertAlmostEqual(amp["sustained_psp"]["pz_uv"], -0.058885,
                               places=4)
        self.assertEqual(amp["sustained_psp"]["n_spikes"], 0)
        self.assertGreater(
            amp["required_for_true_oddball"]["q_nam"] /
            abs(amp["sustained_psp"]["q_population_nam"]), 100)
        # Synchronous AP volley: 2.50 uV peak, still below 8.89 uV and
        # only a ~1 ms transient, not a 200 ms sustained ERP.
        self.assertLess(amp["ap_volley"]["pz_peak_uv"], 8.89)
        self.assertAlmostEqual(amp["ap_volley"]["pz_peak_uv"], 2.498478,
                               places=4)


class TestFixtureFreshness(unittest.TestCase):
    def test_regenerated_fixture_matches_stored(self):
        fresh = cr.make_reference()
        # The NEURON comparison depends on the neuron package (only in
        # neuron-venv); it is covered by test_neuron_hh_cross_check and
        # excluded here so this test also runs under eeg-venv.
        fresh_metrics = {k: v for k, v in fresh["metrics"].items()
                         if k != "neuron_hh_comparison"}
        stored_metrics = {k: v for k, v in M.items()
                          if k != "neuron_hh_comparison"}
        # Metrics: compare numerically (floats with rtol/atol 1e-9).
        def cmp(a, b, label):
            if isinstance(a, dict):
                self.assertEqual(set(a), set(b), label)
                for k in a:
                    cmp(a[k], b[k], f"{label}.{k}")
            elif isinstance(a, list):
                self.assertEqual(len(a), len(b), label)
                for i, (x, y) in enumerate(zip(a, b)):
                    cmp(x, y, f"{label}[{i}]")
            elif isinstance(a, float) or isinstance(b, float):
                if a is None or b is None:
                    self.assertEqual(a, b, label)
                else:
                    self.assertTrue(abs(a - b) <= 1e-9 + 1e-9 * abs(b),
                                    f"{label}: {a} vs {b}")
            else:
                self.assertEqual(a, b, label)
        cmp(fresh_metrics, stored_metrics, "metrics")
        cmp(fresh["parameters"], P, "parameters")
        for key, series in fresh["series"].items():
            if isinstance(series, dict):
                for col, vals in series.items():
                    assert_close(self, vals, FIXTURE["series"][key][col],
                                 1e-9, 1e-9, f"series.{key}.{col}")
            elif isinstance(series, list) and series and isinstance(series[0], dict):
                cmp(series, FIXTURE["series"][key], f"series.{key}")
            else:
                assert_close(self, series, FIXTURE["series"][key],
                             1e-9, 1e-9, f"series.{key}")

    @unittest.skipUnless(importlib.util.find_spec("neuron") is not None,
                         "NEURON not installed in this venv")
    def test_neuron_hh_cross_check(self):
        n = cr.neuron_hh_comparison()
        self.assertTrue(n["available"])
        self.assertEqual(n["neuron_n_spikes"], 4)
        self.assertEqual(n["dop853_n_spikes"], 4)
        self.assertLessEqual(n["max_spike_time_diff_ms"], 0.1)
        self.assertLessEqual(abs(n["neuron_peak_mv"] - n["dop853_peak_mv"]), 0.1)
        self.assertLessEqual(n["max_abs_diff_outside_spike_windows_mv"], 0.1)
        # The stored fixture was generated with NEURON available; the
        # numbers must match the fresh run (same NEURON version).
        stored = M["neuron_hh_comparison"]
        self.assertAlmostEqual(n["max_spike_time_diff_ms"],
                               stored["max_spike_time_diff_ms"], places=3)
        self.assertAlmostEqual(n["max_abs_diff_outside_spike_windows_mv"],
                               stored["max_abs_diff_outside_spike_windows_mv"],
                               places=3)


if __name__ == "__main__":
    unittest.main()
