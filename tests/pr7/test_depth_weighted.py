"""PR-15 拉伸项 — MNE 深度偏置 Python 对照测试。

跑法（MNE 1.11.0；本地用 ~/workspace/eeg-venv/bin/python）：
    python -m unittest discover -s tests/pr7 -p 'test_depth_weighted.py' -v

对照链：本模块的独立实现（`scientific/eeg/depth_reference.py`，numpy）
vs TS（`app/src/lib/depthWeightedInverse.ts`）：峰值位置精确相等、
定位误差精确相等、分布范围相对 1e-6（见 TS 测试）；本文件断言
Python 自身与已提交的 `tests/pr7/fixtures/depth-reference.json`
逐项一致（fixture 由 depth_reference.py --write-fixture 生成）。

球形正向模型须先生成（CI/本地）：
    ~/workspace/eeg-venv/bin/python scientific/forward/generate_sphere_model.py
"""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scientific" / "eeg"))
import depth_reference as D

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "tests/pr7/fixtures/depth-reference.json").read_text())


class TestDepthFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sphere = D.load_sphere()

    def test_cases_match_fixture(self):
        for name, pos, mom in [("deep", [16, 16, 16], [0, 10, 5]),
                               ("shallow", [48, 48, 48], [0, 10, 5])]:
            for suffix, noise in [("", 0.0), ("_noisy", 0.5)]:
                got = D.evaluate_case(self.sphere, "10-20", pos, mom,
                                      noise_rms_uv=noise, noise_seed=7)
                want = FIXTURE["cases"][name + suffix]
                for key in ("plain_mne", "depth_weighted", "dspm", "eloreta"):
                    self.assertEqual(got[key]["estimated_position_mm"],
                                     want[key]["estimated_position_mm"],
                                     f"{name}{suffix} {key} position")
                    self.assertAlmostEqual(got[key]["localization_error_mm"],
                                           want[key]["localization_error_mm"], places=9)
                    self.assertAlmostEqual(got[key]["spread_mm"], want[key]["spread_mm"],
                                           delta=1e-6 * max(1.0, want[key]["spread_mm"]))

    def test_depth_zero_equals_plain(self):
        L, _, pos = D.build_lead_field(self.sphere, "10-20", "average")
        V, _ = D.forward_data(self.sphere, "10-20", [16, 16, 16], [0, 10, 5], "average")
        plain = D.mne_plain(L, V, pos)
        dw0 = D.depth_weighted_mne(L, V, pos, depth=0.0)
        self.assertEqual(dw0["estimated_position_mm"], plain["estimated_position_mm"])
        self.assertAlmostEqual(dw0["peak_value"], plain["peak_value"], places=9)

    def test_depth_weights_deep_larger_than_shallow(self):
        L, _, pos = D.build_lead_field(self.sphere, "10-20", "average")
        w = D.depth_weights(L, D.DEPTH_DEFAULT)
        idx = lambda p: int(np.argmin(np.linalg.norm(pos - np.asarray(p, dtype=float), axis=1)))
        self.assertGreater(w[idx([16, 16, 16])], w[idx([48, 48, 48])])

    def test_eloreta_converges(self):
        for name in ("deep", "shallow"):
            elo = FIXTURE["cases"][name]["eloreta"]
            self.assertLessEqual(elo["iterations"], 20)
            self.assertLess(elo["final_max_change"], 1e-3)

    def test_no_method_dominates_both_depths(self):
        # 诚实结论的回归锚：dSPM 修好深源但坏浅源；深度加权只部分改善深源。
        deep = FIXTURE["cases"]["deep"]
        shallow = FIXTURE["cases"]["shallow"]
        self.assertEqual(deep["dspm"]["localization_error_mm"], 0.0)
        self.assertGreater(shallow["dspm"]["localization_error_mm"], 50.0)
        self.assertLess(deep["depth_weighted"]["localization_error_mm"],
                        deep["plain_mne"]["localization_error_mm"])
        self.assertGreater(deep["depth_weighted"]["localization_error_mm"], 0.0)


if __name__ == "__main__":
    unittest.main()
