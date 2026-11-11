"""PR8-D — TES/TMS 补齐 Python 对照测试：8 字形线圈 + 双相波形。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr8 -p 'test_stimulation_pr8.py' -v

对照链：本模块的独立实现（`scientific/forward/stimulation_reference.py`，
numpy + 3600 段环路积分）vs 已提交 fixture（同文件生成）vs TS
（`app/src/lib/stimulation.ts`，360 段；逐项对照见
tests/pr8/methods-stimulation.test.mjs）。
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


class TestFigureEight(unittest.TestCase):
    def test_loop_centres_offset_by_one_radius_opposite_currents(self):
        a, b = S.figure_eight_coils(S.TMS_COIL)
        self.assertEqual(a["centerMm"], FIXTURE["figure8"]["loopCentresMm"][0])
        self.assertEqual(b["centerMm"], FIXTURE["figure8"]["loopCentresMm"][1])
        self.assertEqual(a["dIdtAPerS"], S.TMS_COIL["dIdtAPerS"])
        self.assertEqual(b["dIdtAPerS"], -S.TMS_COIL["dIdtAPerS"])
        # 默认轴 +Z：偏移沿 y（u = axis × [1,0,0] = [0,1,0]）。
        self.assertEqual(a["centerMm"], [0.0, 35.0, 102.0])
        self.assertEqual(b["centerMm"], [0.0, -35.0, 102.0])

    def test_field_is_linear_sum_and_matches_fixture(self):
        a, b = S.figure_eight_coils(S.TMS_COIL)
        fa = S.tms_field(a, S.TMS_TARGET_MM)
        fb = S.tms_field(b, S.TMS_TARGET_MM)
        f8 = S.figure_eight_field(S.TMS_COIL, S.TMS_TARGET_MM)
        np.testing.assert_allclose(f8, fa + fb, atol=1e-12)
        np.testing.assert_allclose(f8, FIXTURE["figure8"]["fieldVm"], atol=1e-9)
        self.assertAlmostEqual(float(np.linalg.norm(f8)),
                               FIXTURE["figure8"]["magnitudeVm"], places=9)

    def test_focal_under_junction_circular_zero_on_axis(self):
        circ_axis = S.tms_field(S.TMS_COIL, [0, 0, 70])
        self.assertLess(float(np.linalg.norm(circ_axis)), 1e-9)
        f8_axis = S.figure_eight_field(S.TMS_COIL, [0, 0, 70])
        self.assertAlmostEqual(float(np.linalg.norm(f8_axis)),
                               FIXTURE["figure8"]["axisFieldMagnitudeVm"], places=9)
        self.assertGreater(float(np.linalg.norm(f8_axis)), 100.0)
        # 默认目标：8 字形 131.58 > 圆环 84.99 V/m。
        f8 = S.figure_eight_field(S.TMS_COIL, S.TMS_TARGET_MM)
        circ = S.tms_field(S.TMS_COIL, S.TMS_TARGET_MM)
        self.assertGreater(float(np.linalg.norm(f8)), float(np.linalg.norm(circ)))

    def test_segment_convergence_360_vs_3600(self):
        f360 = S.figure_eight_field(S.TMS_COIL, S.TMS_TARGET_MM, n_segments=360)
        np.testing.assert_allclose(f360, FIXTURE["figure8"]["fieldVm360Segments"], atol=1e-9)
        np.testing.assert_allclose(f360, FIXTURE["figure8"]["fieldVm"], atol=1e-4)


class TestBiphasic(unittest.TestCase):
    def test_didt_cosine_cycle(self):
        t_period = S.BIPHASIC_PERIOD_MS
        self.assertEqual(t_period, 0.3)
        self.assertEqual(S.biphasic_didt(0.0, 1e8), 1e8)
        self.assertAlmostEqual(S.biphasic_didt(t_period / 4, 1e8), 0.0, places=6)
        self.assertAlmostEqual(S.biphasic_didt(t_period / 2, 1e8), -1e8, places=6)
        self.assertEqual(S.biphasic_didt(-0.01, 1e8), 0.0)
        self.assertEqual(S.biphasic_didt(t_period + 0.01, 1e8), 0.0)

    def test_pulse_matches_fixture(self):
        fx = FIXTURE["biphasic"]
        self.assertEqual(fx["periodMs"], 0.3)
        self.assertEqual(len(fx["timesMs"]), 31)
        base = S.tms_field(S.TMS_COIL, S.TMS_TARGET_MM)
        for t, d, f in zip(fx["timesMs"], fx["dIdtAPerS"], fx["fieldVm"]):
            self.assertAlmostEqual(d, S.biphasic_didt(t, S.TMS_COIL["dIdtAPerS"]), places=6)
            np.testing.assert_allclose(
                f, base * S.biphasic_didt(t, 1.0), atol=1e-9)
        self.assertAlmostEqual(fx["peakMagnitudeVm"], float(np.linalg.norm(base)), places=9)
        # 半周期处 E 反号。
        np.testing.assert_allclose(fx["fieldVm"][15], [-v for v in fx["fieldVm"][0]], atol=1e-9)


if __name__ == "__main__":
    unittest.main()
