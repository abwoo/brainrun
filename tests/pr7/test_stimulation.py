"""PR-14 (brainrun 2.0 plan §15.3/§15.4) — stimulation Python对照测试。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr7 -p 'test_stimulation.py' -v

对照链：
- TES：闭式点源解 live 重算 vs 已提交 fixture；叠加线性；方向。
- TMS：圆环积分 live 重算 vs fixture；360 段 vs 3600 段收敛；轴上为零；
  方位角方向；随 dI/dt 线性。
- Level D：WC/JR 峰值随场单调（DOP853 live 重算）；fixture 回归。
- 感觉：闪烁 FFT 峰落在刺激频率；听觉强度/ISI 扫描有序。
- 确定性：同一实验两次运行逐值相同。

幅度差距不断言“通过”：Level D 增益未经校准（TES 量级场在默认增益下
几乎不动柱子、TMS 量级场才动），测试只断言映射单调、有定义且未被
悄悄钳制/重缩放。
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scientific" / "forward"))
import stimulation_reference as S

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/pr7/fixtures/stimulation-reference.json").read_text())


class TestTes(unittest.TestCase):
    def test_closed_form_matches_fixture(self):
        f = S.tes_field(S.TES_ELECTRODES, S.TES_TARGET_MM)
        np.testing.assert_allclose(f, FIXTURE["tes"]["fieldVm"], rtol=0, atol=1e-12)
        self.assertAlmostEqual(float(np.linalg.norm(f)),
                               FIXTURE["tes"]["magnitudeVm"], places=12)
        self.assertAlmostEqual(float(np.linalg.norm(f)), 0.7926961168085789, places=9)
        # Field under the anode points mostly downward (-z); Ex vanishes by symmetry.
        self.assertLess(f[2], -0.7)
        self.assertAlmostEqual(f[0], 0.0, places=12)
        for pt in FIXTURE["tes"]["gridSample"]:
            g = S.tes_field(S.TES_ELECTRODES, pt["positionMm"])
            np.testing.assert_allclose(g, pt["fieldVm"], rtol=0, atol=1e-12)

    def test_linearity_in_current_and_conductivity(self):
        base = S.tes_field(S.TES_ELECTRODES, S.TES_TARGET_MM)
        doubled = S.tes_field(
            [{**e, "currentMA": e["currentMA"] * 2} for e in S.TES_ELECTRODES],
            S.TES_TARGET_MM)
        np.testing.assert_allclose(doubled, 2 * base, rtol=1e-12, atol=0)
        half_sigma = S.tes_field(S.TES_ELECTRODES, S.TES_TARGET_MM,
                                 sigma=S.SIGMA_S_PER_M / 2)
        np.testing.assert_allclose(half_sigma, 2 * base, rtol=1e-12, atol=0)

    def test_normal_component(self):
        f = S.tes_field(S.TES_ELECTRODES, S.TES_TARGET_MM)
        normal = float(np.dot(f, S.TES_TARGET_NORMAL))
        self.assertAlmostEqual(normal, FIXTURE["tes"]["normalFieldVm"], places=12)
        self.assertAlmostEqual(normal, f[2], places=12)


class TestTms(unittest.TestCase):
    def test_loop_integral_matches_fixture(self):
        f = S.tms_field(S.TMS_COIL, S.TMS_TARGET_MM, n_segments=3600)
        np.testing.assert_allclose(f, FIXTURE["tms"]["fieldVm"], rtol=0, atol=1e-12)
        self.assertAlmostEqual(float(np.linalg.norm(f)),
                               FIXTURE["tms"]["magnitudeVm"], places=9)
        self.assertAlmostEqual(float(np.linalg.norm(f)), 84.99438468225266, places=6)

    def test_segment_convergence_and_axis_null(self):
        f360 = S.tms_field(S.TMS_COIL, S.TMS_TARGET_MM, n_segments=360)
        np.testing.assert_allclose(f360, FIXTURE["tms"]["fieldVm360Segments"],
                                   rtol=0, atol=1e-12)
        np.testing.assert_allclose(f360, FIXTURE["tms"]["fieldVm"],
                                   rtol=0, atol=1e-6)
        self.assertLess(FIXTURE["tms"]["axisFieldMagnitudeVm"], 1e-9)

    def test_direction_and_linearity(self):
        f = S.tms_field(S.TMS_COIL, S.TMS_TARGET_MM, n_segments=3600)
        # Azimuthal: purely -y for a target at +x from a +z-axis coil.
        self.assertAlmostEqual(f[0], 0.0, places=9)
        self.assertAlmostEqual(f[2], 0.0, places=9)
        self.assertLess(f[1], 0.0)
        coil2 = dict(S.TMS_COIL, dIdtAPerS=S.TMS_COIL["dIdtAPerS"] * 2)
        f2 = S.tms_field(coil2, S.TMS_TARGET_MM, n_segments=3600)
        np.testing.assert_allclose(f2, 2 * f, rtol=1e-12, atol=0)


class TestLevelD(unittest.TestCase):
    def test_wc_peaks_monotonic_and_match_fixture(self):
        peaks = []
        for field in S.LEVEL_D_FIELDS_VM:
            _, q = S.run_wc_pieces(S.level_d_pieces(field, S.FIELD_TO_WC_GAIN, "wc"), 600.0)
            peaks.append(float(np.max(np.abs(q))))
        np.testing.assert_allclose(peaks, FIXTURE["levelD"]["wc"]["peaks"],
                                   rtol=1e-9, atol=1e-12)
        for a, b in zip(peaks, peaks[1:]):
            self.assertGreaterEqual(b, a)
        self.assertLess(peaks[0], 1e-12)
        self.assertGreater(peaks[4], 4.0)
        # No sign flip: the response at the peak is positive for every field.
        for field in (25.0, 50.0, 100.0, 200.0):
            _, q = S.run_wc_pieces(S.level_d_pieces(field, S.FIELD_TO_WC_GAIN, "wc"), 600.0)
            self.assertGreater(q[int(np.argmax(np.abs(q)))], 0.0)

    def test_jr_peaks_monotonic_and_match_fixture(self):
        peaks = []
        for field in S.LEVEL_D_FIELDS_VM:
            _, q = S.run_jr_pieces(S.level_d_pieces(field, S.FIELD_TO_JR_GAIN, "jr"), 600.0)
            peaks.append(float(np.max(np.abs(q))))
        np.testing.assert_allclose(peaks, FIXTURE["levelD"]["jr"]["peaks"],
                                   rtol=1e-9, atol=1e-12)
        for a, b in zip(peaks, peaks[1:]):
            self.assertGreaterEqual(b, a)
        # The 25 -> 50 V/m jump is a JR branch switch, not a calibrated
        # dose-response: small below the switch, ~1 nA*m above it.
        self.assertLess(peaks[1], 0.2)
        self.assertGreater(peaks[2], 0.9)

    def test_gain_is_uncalibrated_and_not_clamped(self):
        # Default gains map 100 V/m onto the PR5 comparison pulses
        # (WC 1.0, JR 100 1/s) and map a TES-scale 0.79 V/m onto almost
        # nothing (WC 0.0079, JR 0.79 1/s). That scale gap is the point.
        self.assertAlmostEqual(0.7926961168085789 * S.FIELD_TO_WC_GAIN, 0.00792696116808579)
        self.assertAlmostEqual(100.0 * S.FIELD_TO_JR_GAIN, 100.0)


class TestSensory(unittest.TestCase):
    def test_flicker_fft_peak_at_stimulus_frequency(self):
        for freq in (8.0, 10.0, 20.0):
            t, q = S.run_wc_flicker(freq, 1.0)
            seg = q[t >= 500]
            seg = seg - np.mean(seg)
            spec = np.abs(np.fft.rfft(seg * np.hanning(len(seg))))
            fr = np.fft.rfftfreq(len(seg), d=0.004)
            peak = float(fr[int(np.argmax(spec[1:])) + 1])
            self.assertAlmostEqual(peak, freq, delta=0.5)
        _, q1 = S.run_wc_flicker(10.0, 1.0)
        _, qh = S.run_wc_flicker(10.0, 0.5)
        self.assertLess(float(np.max(np.abs(qh))), float(np.max(np.abs(q1))))
        np.testing.assert_allclose(
            FIXTURE["flickerWc"]["peakHalfIntensity"],
            float(np.max(np.abs(qh))), rtol=1e-9, atol=0)

    def test_auditory_scans_ordered_and_match_fixture(self):
        means = []
        for isi in (250.0, 500.0, 1000.0):
            t, q = S.run_wc_pieces(S.auditory_pieces(isi, 1.0), 3000.0)
            means.append(S.fixed_window_mean_abs_q(t, q, 500.0))
        np.testing.assert_allclose(
            means,
            [d["fixedWindowMeanAbsQNAm"] for d in FIXTURE["auditoryWc"]["isiScan"]],
            rtol=1e-9, atol=0)
        self.assertGreater(means[0], means[1])
        self.assertGreater(means[1], means[2])
        peaks = []
        for intensity in (0.25, 0.5, 1.0):
            t, q = S.run_wc_pieces(S.auditory_pieces(500.0, intensity), 1500.0)
            peaks.append(float(np.max(np.abs(q))))
        np.testing.assert_allclose(
            peaks,
            [d["peakAbsQNAm"] for d in FIXTURE["auditoryWc"]["intensityScan"]],
            rtol=1e-9, atol=0)
        self.assertLess(peaks[0], peaks[1])
        self.assertLess(peaks[1], peaks[2])

    def test_determinism(self):
        t1, q1 = S.run_wc_flicker(10.0, 1.0)
        t2, q2 = S.run_wc_flicker(10.0, 1.0)
        np.testing.assert_array_equal(t1, t2)
        np.testing.assert_array_equal(q1, q2)


if __name__ == "__main__":
    unittest.main()
